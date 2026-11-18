"""Synchronous client for the BCV Today API (standard library only)."""

from __future__ import annotations

import contextlib
import datetime as _dt
import time
from types import TracebackType
from typing import Any, Callable, List, Mapping, Optional, Type

from . import _core
from ._core import AmountLike, DateLike
from ._transport import Transport, urllib_transport
from ._version import __version__
from .errors import BCVError, InvalidArgument, NotFound
from .models import Conversion, DayRate, History, Rates, Status

__all__ = ["BCV", "DEFAULT_USER_AGENT"]

DEFAULT_USER_AGENT = f"bcv-python/{__version__} (+https://bcv.today)"


def _utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


class BCV:
    """Client for the free, read-only BCV Today API (https://bcv.today/api/).

    Rates are bolivars (VES) per one unit of USD, EUR, CNY, TRY or RUB, as published
    by Banco Central de Venezuela. This project is not affiliated with the bank.

    Args:
        base_url: API origin. Defaults to ``https://bcv.today``.
        timeout: Per-request timeout in seconds.
        cache_ttl: Seconds to keep responses in the in-memory cache (``0`` disables it).
            The data changes at most a few times per business day.
        user_agent: ``User-Agent`` header; defaults to ``bcv-python/<version> (+https://bcv.today)``.
        transport: Advanced/testing hook: ``(url, headers, timeout) -> bcv.Response``.

    Example::

        >>> from bcv import BCV
        >>> client = BCV()
        >>> client.latest()["USD"]            # doctest: +SKIP
        Decimal('916.6477')
        >>> print(client.convert(100, "USD", "VES"))  # doctest: +SKIP
    """

    def __init__(
        self,
        base_url: str = _core.DEFAULT_BASE_URL,
        timeout: float = 10.0,
        cache_ttl: float = 300.0,
        user_agent: Optional[str] = None,
        transport: Optional[Transport] = None,
    ) -> None:
        if not base_url.startswith(("https://", "http://")):
            raise InvalidArgument(f"Invalid base_url {base_url!r}: it must start with https:// or http://.")
        self.base_url = base_url.rstrip("/")
        self.timeout = float(timeout)
        self.user_agent = user_agent or DEFAULT_USER_AGENT
        self._transport: Transport = transport or urllib_transport
        self._cache = _core.TTLCache(cache_ttl)
        # Clocks are attributes so tests can freeze time.
        self._monotonic: Callable[[], float] = time.monotonic
        self._now: Callable[[], _dt.datetime] = _utcnow

    def __repr__(self) -> str:
        return f"BCV(base_url={self.base_url!r}, timeout={self.timeout}, cache_ttl={self._cache.ttl})"

    # -------------------------------------------------------------- plumbing

    @property
    def cache_ttl(self) -> float:
        return self._cache.ttl

    def clear_cache(self) -> None:
        """Forget every cached response."""
        self._cache.clear()

    def close(self) -> None:
        """Release resources (the urllib transport holds none; provided for symmetry)."""
        self._cache.clear()

    def __enter__(self) -> BCV:
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    def _get_json(self, path: str) -> Any:
        found, value = self._cache.get(path, self._monotonic())
        if found:
            return value
        headers = {"Accept": "application/json", "User-Agent": self.user_agent}
        try:
            resp = self._transport(self.base_url + path, headers, self.timeout)
        except BCVError:
            raise
        except Exception as exc:  # any transport failure is upstream
            raise _core.unreachable(exc) from exc
        value = _core.handle_response(resp, path)
        self._cache.set(path, value, self._monotonic())
        return value

    def _today(self) -> _dt.date:
        return _core.today_caracas(self._now())

    def _day_entry(self, day: _dt.date) -> Mapping[str, Any]:
        _core.check_date(day, self._today())
        try:
            return _core.expect_object(self._get_json(_core.day_path(day)), "day snapshot")
        except NotFound:
            latest: Optional[_dt.date] = None
            with contextlib.suppress(BCVError):
                latest = self.latest().date
            raise _core.not_published(day, latest) from None

    def _history_entries(self) -> List[Mapping[str, Any]]:
        return _core.expect_list(self._get_json(_core.HISTORY_PATH), _core.HISTORY_PATH)

    # -------------------------------------------------------------- API

    def latest(self) -> Rates:
        """Official rates currently in effect (``/api/v1/rate.json``)."""
        return _core.build_rates(self._latest_entry())

    def on(self, day: DateLike, currency: Optional[str] = None) -> DayRate:
        """Rate(s) in effect on a calendar day (``date``, ``datetime`` or ``"YYYY-MM-DD"``).

        BCV does not publish on weekends and holidays: the last published rate stays in
        effect, so ``effective_date`` may be earlier than ``date`` and
        ``carried_forward`` is then ``True``. Data starts on 2021-08-02; dates after
        tomorrow (Caracas time) raise :class:`bcv.DateOutOfRange`.

        Args:
            day: The calendar day.
            currency: Restrict the result to one currency (raises
                :class:`bcv.CurrencyNotAvailable` if it was not published that day).
        """
        when = _core.parse_date(day)
        code = _core.normalize_currency(currency) if currency is not None else None
        return _core.build_day_rate(self._day_entry(when), when, code)

    def history(
        self,
        currency: str,
        days: int = 30,
        *,
        start: Optional[DateLike] = None,
        end: Optional[DateLike] = None,
    ) -> History:
        """Daily series for one currency, oldest first.

        Either the last ``days`` calendar days ending on the latest published date
        (default 30, max 1830), or an inclusive ``start``/``end`` range (``days`` is
        then ignored). Uses ``/api/v1/history.json``, which keeps the latest 1830 daily
        entries; ranges are clipped to what it covers and ``History.note`` says so.
        """
        code = _core.normalize_currency(currency)
        lo = _core.parse_date(start, "start") if start is not None else None
        hi = _core.parse_date(end, "end") if end is not None else None
        n = _core.check_days(days)
        return _core.build_history(self._history_entries(), code, n, lo, hi)

    def convert(
        self,
        amount: AmountLike,
        from_: str,
        to: str,
        date: Optional[DateLike] = None,
        *,
        decimals: Optional[int] = 2,
    ) -> Conversion:
        """Convert ``amount`` between VES, USD, EUR, CNY, TRY and RUB at the BCV rate.

        Cross rates go through the bolivar: ``result = amount * VES_per_from / VES_per_to``.
        Math uses :class:`decimal.Decimal` with 28 significant digits; ``result`` is then
        rounded to ``decimals`` places (default 2, ROUND_HALF_UP; ``None`` keeps full
        precision). Floats are converted via ``str()``; pass ``Decimal`` or ``str`` for
        exact input.

        Args:
            amount: Non-negative amount (at most 1e15).
            from_: Source currency code (case-insensitive).
            to: Target currency code.
            date: Use the rate in effect that day instead of the latest one.
            decimals: Decimal places of ``Conversion.result``.
        """
        value = _core.parse_amount(amount)
        src, dst = _core.check_conversion_args(from_, to, decimals)
        when = _core.parse_date(date) if date is not None else None
        entry = self._day_entry(when) if when is not None else self._latest_entry()
        return _core.build_conversion(entry, value, src, dst, when, decimals)

    def _latest_entry(self) -> Mapping[str, Any]:
        return _core.expect_object(self._get_json(_core.LATEST_PATH), _core.LATEST_PATH)

    def status(self) -> Status:
        """Freshness of the published data (``/api/v1/status.json``)."""
        doc = _core.expect_object(self._get_json(_core.STATUS_PATH), _core.STATUS_PATH)
        return _core.build_status(doc, self._now())
