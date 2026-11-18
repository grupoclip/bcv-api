from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

import bcv
from bcv import (
    BCV,
    BCVError,
    CurrencyNotAvailable,
    DateOutOfRange,
    InvalidAmount,
    InvalidCurrency,
    InvalidDate,
    NotFound,
    Response,
    UpstreamError,
)

from .conftest import PREFIX, FakeTransport, make_client

# ------------------------------------------------------------------ latest / parsing


def test_latest_parses_decimals_and_dates(client: BCV) -> None:
    r = client.latest()
    assert r["USD"] == Decimal("916.6477")
    assert r.eur == Decimal("1007.38665582")
    assert r["try"] == r.try_ == Decimal("18.21021713")
    assert list(r.rates) == ["USD", "EUR", "CNY", "TRY", "RUB"]
    assert r.effective_date == dt.date(2026, 11, 18)
    assert r.date == dt.date(2026, 11, 18)
    assert r.updated_at == dt.datetime(2026, 11, 18, 2, 1, 3, 699523, tzinfo=dt.timezone.utc)
    assert "bcv.today" in r.source
    assert "USD" in r and "XYZ" not in r and r.get("XYZ") is None
    assert r.to_dict()["rates"]["USD"] == 916.6477


def test_user_agent_and_accept_header(client: BCV, transport: FakeTransport) -> None:
    client.latest()
    assert transport.calls == [PREFIX + "rate.json"]
    assert transport.headers[0]["User-Agent"] == f"bcv-python/{bcv.__version__} (+https://bcv.today)"
    assert transport.headers[0]["Accept"] == "application/json"


def test_custom_base_url_and_user_agent() -> None:
    seen = []

    def t(url: str, headers: dict, timeout: float) -> Response:  # type: ignore[type-arg]
        seen.append((url, headers["User-Agent"], timeout))
        return Response(200, b'{"USD": 1, "date": "2026-01-02"}')

    c = BCV(base_url="https://example.test/", user_agent="me/1", timeout=3, transport=t)
    assert c.latest().usd == Decimal(1)
    assert seen == [("https://example.test/api/v1/rate.json", "me/1", 3.0)]


def test_parse_datetime_variants() -> None:
    from bcv._core import parse_datetime

    assert parse_datetime("2026-01-05T21:00:00Z") == dt.datetime(2026, 1, 5, 21, tzinfo=dt.timezone.utc)
    assert parse_datetime("2026-01-05T21:00:00.1+00:00") == dt.datetime(
        2026, 1, 5, 21, 0, 0, 100000, tzinfo=dt.timezone.utc
    )
    assert parse_datetime("2026-01-05T17:00:00-04:00") == dt.datetime(2026, 1, 5, 21, tzinfo=dt.timezone.utc)
    assert parse_datetime("garbage") is None
    assert parse_datetime(None) is None


# ------------------------------------------------------------------ on() / carry forward


def test_on_business_day_not_carried(client: BCV) -> None:
    d = client.on("2026-01-06")
    assert d.date == d.effective_date == dt.date(2026, 1, 6)
    assert d.carried_forward is False and d.note is None
    assert set(d.rates) == {"USD", "EUR"}


def test_on_sunday_carries_forward_saturday(client: BCV) -> None:
    d = client.on(dt.date(2026, 1, 4), currency="usd")
    assert d.date == dt.date(2026, 1, 4)
    assert d.effective_date == dt.date(2026, 1, 3)
    assert d.carried_forward is True
    assert d.rate == Decimal("304.6796")
    assert d.rates == {"USD": Decimal("304.6796")}
    assert d.note == (
        "2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV rate "
        "stays in effect until the next publication (weekends and holidays carry it forward)."
    )
    assert d.to_dict()["carried_forward"] is True
    assert "carry it forward" in str(d)


def test_on_accepts_datetime(client: BCV) -> None:
    assert client.on(dt.datetime(2026, 1, 6, 23, 59)).date == dt.date(2026, 1, 6)


def test_on_currency_missing_on_old_day(client: BCV) -> None:
    with pytest.raises(
        CurrencyNotAvailable, match=r"No EUR rate in the BCV data for 2021-08-02 .*Available that day: USD"
    ):
        client.on("2021-08-02", "EUR")


def test_rate_property_needs_single_currency(client: BCV) -> None:
    with pytest.raises(ValueError):
        _ = client.on("2026-01-06").rate


@pytest.mark.parametrize("bad", ["2026-02-30", "2026-1-4", "04/01/2026", "", "2026-01-04T00:00"])
def test_on_invalid_date(client: BCV, transport: FakeTransport, bad: str) -> None:
    with pytest.raises(InvalidDate, match="YYYY-MM-DD"):
        client.on(bad)
    assert transport.calls == []


def test_invalid_date_is_value_error(client: BCV) -> None:
    with pytest.raises(ValueError):
        client.on("nope")


def test_on_before_first_snapshot(client: BCV) -> None:
    with pytest.raises(DateOutOfRange, match="daily snapshots start on 2021-08-02"):
        client.on("2021-08-01")


def test_on_future_date(client: BCV) -> None:
    with pytest.raises(DateOutOfRange, match=r"in the future \(today in Caracas is 2026-11-18\)"):
        client.on("2026-11-20")


def test_on_tomorrow_allowed_but_not_published(client: BCV, transport: FakeTransport) -> None:
    with pytest.raises(DateOutOfRange, match=r"No BCV rate published yet for 2026-11-19\..* to 2026-11-18\."):
        client.on("2026-11-19")
    assert transport.calls[-1] == PREFIX + "rate.json"


def test_caracas_today_uses_utc_minus_4(transport: FakeTransport) -> None:
    c = make_client(transport)
    # 02:00 UTC on the 19th is still the 18th in Caracas: the 20th is "future".
    c._now = lambda: dt.datetime(2026, 11, 19, 2, 0, tzinfo=dt.timezone.utc)
    with pytest.raises(DateOutOfRange, match="today in Caracas is 2026-11-18"):
        c.on("2026-11-20")


def test_invalid_currency(client: BCV) -> None:
    with pytest.raises(InvalidCurrency, match="use one of USD, EUR, CNY, TRY, RUB"):
        client.on("2026-01-06", "GBP")


# ------------------------------------------------------------------ history


def test_history_last_n_days(client: BCV) -> None:
    h = client.history("USD", days=7)
    assert len(h) == 7
    assert h.end == dt.date(2026, 11, 18)
    assert h.start == dt.date(2026, 11, 12)
    assert [p.date for p in h] == sorted(p.date for p in h)
    assert h.first.rate <= h.max.rate and h.min.rate <= h.last.rate
    assert h.change == h.last.rate - h.first.rate
    expected = ((h.last.rate - h.first.rate) / h.first.rate * 100).quantize(Decimal("0.0001"))
    assert h.change_pct == expected
    assert h.note is None


def test_history_range_and_carry_flags(client: BCV) -> None:
    h = client.history("eur", start="2026-01-01", end=dt.date(2026, 1, 6))
    assert [p.date.isoformat() for p in h] == [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
        "2026-01-05",
        "2026-01-06",
    ]
    flags = [p.carried_forward for p in h]
    assert flags == [False, True, False, True, True, False]
    assert h.first.rate == Decimal("354.4935")
    assert h.last.rate == Decimal("360.5039")
    assert h.min.date == dt.date(2026, 1, 1) and h.max.date == dt.date(2026, 1, 6)
    rows = h.to_list()
    assert rows[0] == {"date": dt.date(2026, 1, 1), "effective_date": dt.date(2026, 1, 1), "rate": Decimal("354.4935")}


def test_history_skips_entries_without_currency_and_notes_clipping(client: BCV) -> None:
    h = client.history("EUR", start="2025-12-01", end="2026-01-02")
    assert h.start == dt.date(2026, 1, 1)
    assert h.note == "History for EUR starts on 2026-01-01; earlier dates were skipped."


def test_history_end_after_latest_note(client: BCV) -> None:
    h = client.history("USD", start="2026-11-17", end="2026-12-31")
    assert h.note == "Latest available date is 2026-11-18."


def test_history_empty_window(client: BCV) -> None:
    with pytest.raises(DateOutOfRange, match="No USD rates between 2024-01-01 and 2024-01-31"):
        client.history("USD", start="2024-01-01", end="2024-01-31")


def test_history_bad_args(client: BCV) -> None:
    with pytest.raises(InvalidDate, match="must be on or before"):
        client.history("USD", start="2026-01-06", end="2026-01-01")
    with pytest.raises(InvalidDate, match="from 1 to 1830"):
        client.history("USD", days=0)
    with pytest.raises(InvalidDate, match="from 1 to 1830"):
        client.history("USD", days=1831)
    with pytest.raises(InvalidCurrency):
        client.history("VES")


def test_history_to_dict(client: BCV) -> None:
    d = client.history("USD", days=3).to_dict()
    assert d["points"] == 3 and len(d["series"]) == 3
    assert set(d) >= {"first", "last", "min", "max", "change", "change_pct", "unit", "source"}


def test_history_to_pandas(client: BCV) -> None:
    pd = pytest.importorskip("pandas")
    df = client.history("USD", days=5).to_pandas()
    assert list(df.columns) == ["rate", "effective_date"]
    assert isinstance(df.index, pd.DatetimeIndex) and df.index.name == "date"
    assert len(df) == 5 and df.attrs["currency"] == "USD"
    assert df["rate"].dtype == "float64"


# ------------------------------------------------------------------ convert


def test_convert_usd_to_ves_latest(client: BCV) -> None:
    c = client.convert(100, "USD", "VES")
    assert c.result == Decimal("91664.77")
    assert c.result_exact == Decimal("91664.770000")
    assert c.rate == Decimal("916.6477")
    assert c.rates_used == {"USD": Decimal("916.6477")}
    assert c.effective_date == dt.date(2026, 11, 18)
    assert c.carried_forward is False and c.note is None
    assert str(c).startswith("100.00 USD = 91,664.77 VES")


def test_convert_ves_to_usd_rounds_half_up(client: BCV) -> None:
    c = client.convert("1000", "ves", "usd")
    # 1000 / 916.6477 = 1.090931... -> 1.09
    assert c.result == Decimal("1.09")
    assert c.rates_used == {"USD": Decimal("916.6477")}
    assert c.decimals == 2


def test_convert_cross_rate_via_ves(client: BCV) -> None:
    c = client.convert(Decimal("50"), "EUR", "USD", decimals=None)
    expected = Decimal("50") * Decimal("1007.38665582") / Decimal("916.6477")
    assert c.result == c.result_exact == expected
    assert c.rate == Decimal("1007.38665582") / Decimal("916.6477")
    assert set(c.rates_used) == {"EUR", "USD"}


def test_convert_rounding_half_up_exact_tie() -> None:
    t = FakeTransport({PREFIX + "rate.json": Response(200, b'{"USD": 2.5, "date": "2026-11-18"}')})
    c = make_client(t)
    assert c.convert("0.001", "USD", "VES").result == Decimal("0.00")  # 0.0025 -> 0.00
    assert c.convert("0.003", "USD", "VES").result == Decimal("0.01")  # 0.0075 -> 0.01
    assert c.convert("0.005", "USD", "VES", decimals=2).result_exact == Decimal("0.0125")
    assert c.convert("0.005", "USD", "VES", decimals=2).result == Decimal("0.01")
    assert c.convert("0.001", "USD", "VES", decimals=3).result == Decimal("0.003")  # 0.0025 -> 0.003 half-up
    assert c.convert(1, "USD", "VES", decimals=0).result == Decimal("3")  # 2.5 -> 3


def test_convert_float_amount_has_no_binary_noise(client: BCV) -> None:
    assert client.convert(0.1, "USD", "VES", decimals=None).amount == Decimal("0.1")


def test_convert_on_date_carries_forward(client: BCV) -> None:
    c = client.convert(10, "USD", "VES", date="2026-01-04")
    assert c.result == Decimal("3046.80")
    assert c.date == dt.date(2026, 1, 4)
    assert c.effective_date == dt.date(2026, 1, 3)
    assert c.carried_forward is True and c.note


def test_convert_missing_currency_that_day(client: BCV) -> None:
    with pytest.raises(CurrencyNotAvailable, match=r"No BCV rate for EUR on 2021-08-02 .*Available: USD\."):
        client.convert(1, "USD", "EUR", date="2021-08-02")


@pytest.mark.parametrize(
    ("args", "exc", "msg"),
    [
        ((1, "USD", "USD"), InvalidCurrency, "both USD"),
        ((1, "USD", "GBP"), InvalidCurrency, "Unsupported currency"),
        ((-1, "USD", "VES"), InvalidAmount, "zero or positive"),
        (("abc", "USD", "VES"), InvalidAmount, "expected a number"),
        ((float("inf"), "USD", "VES"), InvalidAmount, "finite"),
        ((Decimal("1e16"), "USD", "VES"), InvalidAmount, "1e15"),
        ((True, "USD", "VES"), InvalidAmount, "expected a number"),
    ],
)
def test_convert_invalid_args(client: BCV, transport: FakeTransport, args: tuple, exc: type, msg: str) -> None:  # type: ignore[type-arg]
    with pytest.raises(exc, match=msg):
        client.convert(*args)
    assert transport.calls == []


def test_convert_bad_decimals(client: BCV) -> None:
    with pytest.raises(InvalidAmount, match="decimals"):
        client.convert(1, "USD", "VES", decimals=-1)


# ------------------------------------------------------------------ status


def test_status(client: BCV) -> None:
    s = client.status()
    assert s.status == "ok"
    assert s.stale is False
    assert s.age_hours == 13.0  # 02:01 UTC -> 15:00 UTC
    assert s.supported_currencies == ("USD", "EUR", "CNY", "TRY", "RUB")
    assert s.effective_date == dt.date(2026, 11, 18)
    assert s.timezone == "America/Caracas" and s.api_version == "v1"
    assert s.to_dict()["stale"] is False


def test_status_stale_after_96h(transport: FakeTransport) -> None:
    c = make_client(transport)
    c._now = lambda: dt.datetime(2026, 11, 22, 3, 0, tzinfo=dt.timezone.utc)
    s = c.status()
    assert s.age_hours == 97.0 and s.stale is True
    assert "STALE" in str(s)


# ------------------------------------------------------------------ errors from upstream


def test_http_error_is_upstream() -> None:
    t = FakeTransport({PREFIX + "rate.json": Response(503, b"down")})
    with pytest.raises(UpstreamError, match="answered HTTP 503 for /api/v1/rate.json") as info:
        make_client(t).latest()
    assert info.value.status == 503


def test_invalid_json_is_upstream() -> None:
    t = FakeTransport({PREFIX + "rate.json": Response(200, b"<html>")})
    with pytest.raises(UpstreamError, match="invalid JSON for /api/v1/rate.json"):
        make_client(t).latest()


def test_wrong_shape_is_upstream() -> None:
    t = FakeTransport({PREFIX + "history.json": Response(200, b"{}")})
    with pytest.raises(UpstreamError, match="expected an array"):
        make_client(t).history("USD")


def test_network_failure_is_upstream() -> None:
    def boom(url: str, headers: object, timeout: float) -> Response:
        raise OSError("connection refused")

    with pytest.raises(UpstreamError, match=r"Could not reach the BCV Today data API \(connection refused\)"):
        make_client(boom).latest()


def test_404_on_plain_path_is_not_found(client: BCV) -> None:
    with pytest.raises(NotFound):
        client._get_json("/api/v1/nope.json")


def test_hierarchy() -> None:
    for exc in (
        InvalidDate,
        InvalidCurrency,
        InvalidAmount,
        DateOutOfRange,
        CurrencyNotAvailable,
        UpstreamError,
        NotFound,
        bcv.MissingDependency,
    ):
        assert issubclass(exc, BCVError)
    assert issubclass(InvalidDate, ValueError)
    assert issubclass(bcv.MissingDependency, ImportError)


# ------------------------------------------------------------------ cache


def test_cache_ttl(transport: FakeTransport) -> None:
    c = make_client(transport, cache_ttl=300)
    clock = [1000.0]
    c._monotonic = lambda: clock[0]
    c.latest()
    c.latest()
    c.convert(1, "USD", "VES")
    assert len(transport.calls) == 1
    clock[0] += 299
    c.latest()
    assert len(transport.calls) == 1
    clock[0] += 2
    c.latest()
    assert len(transport.calls) == 2
    c.clear_cache()
    c.latest()
    assert len(transport.calls) == 3


def test_cache_disabled(transport: FakeTransport) -> None:
    c = make_client(transport, cache_ttl=0)
    c.latest()
    c.latest()
    assert len(transport.calls) == 2


def test_errors_are_not_cached() -> None:
    t = FakeTransport({PREFIX + "rate.json": Response(500, b"")})
    c = make_client(t)
    for _ in range(2):
        with pytest.raises(UpstreamError):
            c.latest()
    assert len(t.calls) == 2


def test_context_manager(transport: FakeTransport) -> None:
    with make_client(transport) as c:
        assert c.latest().usd


def test_base_url_must_be_http() -> None:
    with pytest.raises(bcv.InvalidArgument, match="https://"):
        BCV(base_url="file:///etc")
