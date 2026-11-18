"""Live checks against https://bcv.today. Skipped unless BCV_LIVE=1."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

from bcv import BCV, CURRENCIES, DateOutOfRange

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def live() -> BCV:
    return BCV(timeout=20)


def test_live_latest(live: BCV) -> None:
    r = live.latest()
    assert r.usd is not None and r.usd > 0
    assert set(r.rates) <= set(CURRENCIES)
    assert r.effective_date >= dt.date(2026, 1, 1)


def test_live_weekend_carry_forward(live: BCV) -> None:
    d = live.on("2026-01-04", "USD")
    assert d.effective_date == dt.date(2026, 1, 3)
    assert d.carried_forward is True
    assert d.rate == Decimal("304.6796")


def test_live_first_snapshot(live: BCV) -> None:
    assert live.on("2021-08-02", "USD").rate > 0
    with pytest.raises(DateOutOfRange):
        live.on("2021-08-01")


def test_live_convert_and_history(live: BCV) -> None:
    c = live.convert(100, "USD", "VES")
    assert c.result > 0 and c.rates_used["USD"] == live.latest().usd
    h = live.history("USD", days=7)
    assert 1 <= len(h) <= 7


def test_live_status(live: BCV) -> None:
    s = live.status()
    assert s.status == "ok"
    assert "USD" in s.supported_currencies
