from __future__ import annotations

import asyncio
import datetime as dt
from decimal import Decimal
from typing import Any, Coroutine, TypeVar

import pytest

from bcv import AsyncBCV, DateOutOfRange, UpstreamError

from .conftest import FIXTURES, NOW, PREFIX

httpx = pytest.importorskip("httpx")
T = TypeVar("T")


def arun(coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


def make(calls: list, status: int | None = None) -> AsyncBCV:  # type: ignore[type-arg]
    def handler(request: Any) -> Any:
        url = str(request.url)
        calls.append((url, request.headers.get("user-agent")))
        if status is not None:
            return httpx.Response(status, content=b"")
        path = FIXTURES / url[len(PREFIX) :]
        if not path.is_file():
            return httpx.Response(404, content=b"")
        return httpx.Response(200, content=path.read_bytes())

    client = AsyncBCV(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    client._now = lambda: NOW
    return client


def test_async_methods() -> None:
    calls: list = []  # type: ignore[type-arg]

    async def go() -> None:
        async with make(calls) as c:
            r = await c.latest()
            assert r["USD"] == Decimal("916.6477")
            d = await c.on("2026-01-04", "USD")
            assert d.carried_forward and d.effective_date == dt.date(2026, 1, 3)
            conv = await c.convert(100, "USD", "VES")
            assert conv.result == Decimal("91664.77")
            h = await c.history("USD", days=7)
            assert len(h) == 7
            s = await c.status()
            assert s.status == "ok"
            with pytest.raises(DateOutOfRange, match="published yet"):
                await c.on("2026-11-19")

    arun(go())
    assert calls[0][1].startswith("bcv-python/")
    # rate.json was fetched once for latest() + convert(): cached.
    assert sum(1 for u, _ in calls if u.endswith("/rate.json")) == 1


def test_async_upstream_error() -> None:
    async def go() -> None:
        c = make([], status=500)
        with pytest.raises(UpstreamError, match="HTTP 500"):
            await c.latest()

    arun(go())
