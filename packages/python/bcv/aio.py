"""Asynchronous client (requires the optional ``bcv[async]`` extra, i.e. httpx).

``httpx`` is imported lazily when the first :class:`AsyncBCV` is created, so
``import bcv`` never needs it.
"""

from __future__ import annotations

import contextlib
import datetime as _dt
import time
from types import TracebackType
from typing import TYPE_CHECKING, Any, Callable, List, Mapping, Optional, Type

from . import _core
from ._core import AmountLike, DateLike
from .client import DEFAULT_USER_AGENT
from .errors import BCVError, MissingDependency, NotFound
from .models import Conversion, DayRate, History, Rates, Status

if TYPE_CHECKING:  # pragma: no cover
    import httpx

__all__ = ["AsyncBCV"]


def _utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


class AsyncBCV:
    """Async twin of :class:`bcv.BCV` with the same methods, as coroutines.

    Use it as an async context manager (or call :meth:`aclose`)::

        async with AsyncBCV() as client:
            rates = await client.latest()

    Args:
        base_url, timeout, cache_ttl, user_agent: as in :class:`bcv.BCV`.
        client: An existing ``httpx.AsyncClient`` to reuse (it is not closed by
            :meth:`aclose`). One is created on demand otherwise.
    """

    def __init__(
        self,
        base_url: str = _core.DEFAULT_BASE_URL,
        timeout: float = 10.0,
        cache_ttl: float = 300.0,
        user_agent: Optional[str] = None,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        try:
            import httpx
        except ImportError as exc:
            raise MissingDependency("AsyncBCV needs httpx. Install it with: pip install 'bcv[async]'") from exc
        self._httpx = httpx
        self.base_url = base_url.rstrip("/")
        self.timeout = float(timeout)
        self.user_agent = user_agent or DEFAULT_USER_AGENT
        self._client = client
        self._owns_client = client is None
        self._cache = _core.TTLCache(cache_ttl)
        self._monotonic: Callable[[], float] = time.monotonic
        self._now: Callable[[], _dt.datetime] = _utcnow

    def __repr__(self) -> str:
        return f"AsyncBCV(base_url={self.base_url!r}, timeout={self.timeout}, cache_ttl={self._cache.ttl})"

    async def __aenter__(self) -> AsyncBCV:
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Close the underlying httpx client if this object created it."""
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    def clear_cache(self) -> None:
        self._cache.clear()

    async def _get_json(self, path: str) -> Any:
        found, value = self._cache.get(path, self._monotonic())
        if found:
            return value
        if self._client is None:
            self._client = self._httpx.AsyncClient()
        headers = {"Accept": "application/json", "User-Agent": self.user_agent}
        try:
            resp = await self._client.get(self.base_url + path, headers=headers, timeout=self.timeout)
        except Exception as exc:  # any transport failure is upstream
            raise _core.unreachable(exc) from exc
        value = _core.handle_response(_core.Response(resp.status_code, resp.content), path)
        self._cache.set(path, value, self._monotonic())
        return value

    async def _latest_entry(self) -> Mapping[str, Any]:
        return _core.expect_object(await self._get_json(_core.LATEST_PATH), _core.LATEST_PATH)

    async def _day_entry(self, day: _dt.date) -> Mapping[str, Any]:
        _core.check_date(day, _core.today_caracas(self._now()))
        try:
            return _core.expect_object(await self._get_json(_core.day_path(day)), "day snapshot")
        except NotFound:
            latest: Optional[_dt.date] = None
            with contextlib.suppress(BCVError):
                latest = (await self.latest()).date
            raise _core.not_published(day, latest) from None

    async def _history_entries(self) -> List[Mapping[str, Any]]:
        return _core.expect_list(await self._get_json(_core.HISTORY_PATH), _core.HISTORY_PATH)

    async def latest(self) -> Rates:
        """See :meth:`bcv.BCV.latest`."""
        return _core.build_rates(await self._latest_entry())

    async def on(self, day: DateLike, currency: Optional[str] = None) -> DayRate:
        """See :meth:`bcv.BCV.on`."""
        when = _core.parse_date(day)
        code = _core.normalize_currency(currency) if currency is not None else None
        return _core.build_day_rate(await self._day_entry(when), when, code)

    async def history(
        self,
        currency: str,
        days: int = 30,
        *,
        start: Optional[DateLike] = None,
        end: Optional[DateLike] = None,
    ) -> History:
        """See :meth:`bcv.BCV.history`."""
        code = _core.normalize_currency(currency)
        lo = _core.parse_date(start, "start") if start is not None else None
        hi = _core.parse_date(end, "end") if end is not None else None
        n = _core.check_days(days)
        return _core.build_history(await self._history_entries(), code, n, lo, hi)

    async def convert(
        self,
        amount: AmountLike,
        from_: str,
        to: str,
        date: Optional[DateLike] = None,
        *,
        decimals: Optional[int] = 2,
    ) -> Conversion:
        """See :meth:`bcv.BCV.convert`."""
        value = _core.parse_amount(amount)
        src, dst = _core.check_conversion_args(from_, to, decimals)
        when = _core.parse_date(date) if date is not None else None
        entry = await (self._day_entry(when) if when is not None else self._latest_entry())
        return _core.build_conversion(entry, value, src, dst, when, decimals)

    async def status(self) -> Status:
        """See :meth:`bcv.BCV.status`."""
        doc = _core.expect_object(await self._get_json(_core.STATUS_PATH), _core.STATUS_PATH)
        return _core.build_status(doc, self._now())
