"""Transport-independent business rules shared by the sync and async clients.

These mirror the BCV Today MCP server (mcp/src/server.ts in the bcv-api repo):
same date validation, carry-forward semantics, history windowing and messages.
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import threading
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from typing import Any, Dict, List, Mapping, NamedTuple, Optional, Tuple, Union

from .errors import (
    CurrencyNotAvailable,
    DateOutOfRange,
    InvalidAmount,
    InvalidCurrency,
    InvalidDate,
    NotFound,
    UpstreamError,
)
from .models import CURRENCIES, Conversion, DayRate, History, HistoryPoint, Rates, Status

DEFAULT_BASE_URL = "https://bcv.today"
#: First calendar day with a /api/v1/history/{date}.json snapshot.
EARLIEST_SNAPSHOT = _dt.date(2021, 8, 2)
#: history.json keeps (at most) this many daily entries.
MAX_HISTORY_DAYS = 1830
MAX_AMOUNT = Decimal("1e15")
#: Hours without a capture after which status is considered stale (weekend + holiday).
STALE_AFTER_HOURS = 96.0
CARACAS = _dt.timezone(_dt.timedelta(hours=-4), "America/Caracas")

LATEST_PATH = "/api/v1/rate.json"
HISTORY_PATH = "/api/v1/history.json"
STATUS_PATH = "/api/v1/status.json"

DateLike = Union[_dt.date, _dt.datetime, str]
AmountLike = Union[Decimal, int, float, str]

_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_CENT = Decimal("0.0001")


class Response(NamedTuple):
    """What a transport returns: HTTP status code and raw body bytes."""

    status: int
    body: bytes


# ------------------------------------------------------------------ parsing


def parse_date(value: DateLike, label: str = "date") -> _dt.date:
    """Coerce ``value`` to a :class:`datetime.date` or raise :class:`InvalidDate`."""
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if _ISO_DATE.match(text):
            try:
                return _dt.date.fromisoformat(text)
            except ValueError:
                pass
        raise InvalidDate(f'Invalid {label} "{value}": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.')
    raise InvalidDate(f"Invalid {label} {value!r}: expected a date, datetime or YYYY-MM-DD string.")


_FRACTION = re.compile(r"\.(\d+)")


def parse_datetime(value: Any) -> Optional[_dt.datetime]:
    """Parse an ISO 8601 timestamp (tolerant of ``Z`` and any fraction length) as aware UTC."""
    if not isinstance(value, str) or not value:
        return None
    text = value.strip().replace("Z", "+00:00").replace("z", "+00:00")
    # Python 3.9/3.10 fromisoformat only accepts 3 or 6 fractional digits.
    text = _FRACTION.sub(lambda m: "." + (m.group(1) + "000000")[:6], text, count=1)
    try:
        parsed = _dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_dt.timezone.utc)
    return parsed.astimezone(_dt.timezone.utc)


def _entry_date(entry: Mapping[str, Any], key: str) -> Optional[_dt.date]:
    value = entry.get(key)
    if isinstance(value, str) and _ISO_DATE.match(value):
        try:
            return _dt.date.fromisoformat(value)
        except ValueError:
            return None
    return None


def to_decimal(value: Any) -> Optional[Decimal]:
    """A positive, finite Decimal from a JSON number, or ``None``."""
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    dec = value if isinstance(value, Decimal) else Decimal(str(value))
    if not dec.is_finite() or dec <= 0:
        return None
    return dec


def rates_of(entry: Mapping[str, Any]) -> Dict[str, Decimal]:
    """Published rates of an entry, in canonical currency order."""
    out: Dict[str, Decimal] = {}
    for code in CURRENCIES:
        dec = to_decimal(entry.get(code))
        if dec is not None:
            out[code] = dec
    return out


def normalize_currency(code: Any, allow_ves: bool = False) -> str:
    """Upper-case and validate a currency code."""
    valid = (("VES",) if allow_ves else ()) + CURRENCIES
    if isinstance(code, str):
        upper = code.strip().upper()
        if upper == "VEF" and allow_ves:  # pre-2021 name some users still type
            upper = "VES"
        if upper in valid:
            return upper
    raise InvalidCurrency(f"Unsupported currency {code!r}: use one of {', '.join(valid)}.")


def parse_amount(amount: AmountLike) -> Decimal:
    """Validate an amount; floats go through ``str()`` to avoid binary artifacts."""
    if isinstance(amount, bool):
        raise InvalidAmount(f"Invalid amount {amount!r}: expected a number.")
    try:
        if isinstance(amount, Decimal):
            dec = amount
        elif isinstance(amount, (int, float)):
            dec = Decimal(str(amount))
        elif isinstance(amount, str):
            dec = Decimal(amount.strip().replace("_", ""))
        else:
            raise InvalidAmount(f"Invalid amount {amount!r}: expected a number.")
    except InvalidOperation:
        raise InvalidAmount(f"Invalid amount {amount!r}: expected a number.") from None
    if not dec.is_finite():
        raise InvalidAmount(f"Invalid amount {amount!r}: it must be a finite number.")
    if dec < 0:
        raise InvalidAmount(f"Invalid amount {amount!r}: it must be zero or positive.")
    if dec > MAX_AMOUNT:
        raise InvalidAmount(f"Invalid amount {amount!r}: it must not exceed 1e15.")
    return dec


def decode_json(body: bytes, path: str) -> Any:
    try:
        return json.loads(body.decode("utf-8"), parse_float=Decimal)
    except (UnicodeDecodeError, ValueError):
        raise UpstreamError(f"The BCV Today data API returned invalid JSON for {path}.") from None


def handle_response(resp: Response, path: str) -> Any:
    """Turn a transport response into parsed JSON or raise the matching error."""
    if resp.status == 404:
        raise NotFound(f"Not found: {path}")
    if not 200 <= resp.status < 300:
        raise UpstreamError(
            f"The BCV Today data API answered HTTP {resp.status} for {path}. Try again in a moment.",
            resp.status,
        )
    return decode_json(resp.body, path)


def unreachable(exc: BaseException) -> UpstreamError:
    return UpstreamError(f"Could not reach the BCV Today data API ({exc}). Try again in a moment.")


def expect_object(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise UpstreamError(f"Unexpected {path} shape (expected an object).")
    return value


def expect_list(value: Any, path: str) -> List[Mapping[str, Any]]:
    if not isinstance(value, list):
        raise UpstreamError("Unexpected history.json shape (expected an array).")
    return [e for e in value if isinstance(e, dict)]


# ------------------------------------------------------------------ dates


def today_caracas(now: _dt.datetime) -> _dt.date:
    """Today's date in Caracas (UTC-4, no DST)."""
    return now.astimezone(CARACAS).date()


def weekday(day: _dt.date) -> str:
    return _WEEKDAYS[day.weekday()]


def day_path(day: _dt.date) -> str:
    return f"/api/v1/history/{day.isoformat()}.json"


def check_date(day: _dt.date, today: _dt.date) -> None:
    """Reject dates before the first snapshot or after tomorrow (Caracas)."""
    if day < EARLIEST_SNAPSHOT:
        raise DateOutOfRange(f"No BCV data for {day}: daily snapshots start on {EARLIEST_SNAPSHOT}.")
    # BCV publishes the next business day's rate in the afternoon, so allow tomorrow.
    if day > today + _dt.timedelta(days=1):
        raise DateOutOfRange(
            f"{day} is in the future (today in Caracas is {today}); "
            "BCV rates are only known up to the next business day."
        )


def not_published(day: _dt.date, latest: Optional[_dt.date]) -> DateOutOfRange:
    upto = f" to {latest}." if latest else " to the latest business day."
    return DateOutOfRange(
        f"No BCV rate published yet for {day}. Daily snapshots are available from {EARLIEST_SNAPSHOT}"
        f"{upto} Use latest() for the rate currently in effect."
    )


def carry_forward_note(day: _dt.date, effective: _dt.date) -> Optional[str]:
    if effective == day:
        return None
    return (
        f"{day} ({weekday(day)}) uses the rate with effective date {effective} ({weekday(effective)}): "
        "a published BCV rate stays in effect until the next publication "
        "(weekends and holidays carry it forward)."
    )


# ------------------------------------------------------------------ builders


def _dates(entry: Mapping[str, Any], fallback: Optional[_dt.date] = None) -> Tuple[_dt.date, _dt.date]:
    day = _entry_date(entry, "date") or fallback
    if day is None:
        raise UpstreamError("Unexpected API response: the entry has no valid 'date'.")
    return day, _entry_date(entry, "effective_date") or day


def build_rates(entry: Mapping[str, Any]) -> Rates:
    day, effective = _dates(entry)
    return Rates(
        rates=rates_of(entry),
        date=day,
        effective_date=effective,
        updated_at=parse_datetime(entry.get("updated_at")),
        raw=dict(entry),
    )


def build_day_rate(entry: Mapping[str, Any], day: _dt.date, currency: Optional[str]) -> DayRate:
    _, effective = _dates(entry, fallback=day)
    rates = rates_of(entry)
    if currency is not None:
        if currency not in rates:
            avail = ", ".join(rates) or "none"
            raise CurrencyNotAvailable(
                f"No {currency} rate in the BCV data for {day} (older entries may lack some currencies). "
                f"Available that day: {avail}."
            )
        rates = {currency: rates[currency]}
    note = carry_forward_note(day, effective)
    return DayRate(
        date=day,
        effective_date=effective,
        carried_forward=note is not None,
        rates=rates,
        updated_at=parse_datetime(entry.get("updated_at")),
        note=note,
        raw=dict(entry),
    )


def pct_change(first: Decimal, last: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 28
        return ((last - first) / first * 100).quantize(_CENT, rounding=ROUND_HALF_UP)


def check_days(days: Any) -> int:
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= MAX_HISTORY_DAYS:
        raise InvalidDate(f"Invalid days {days!r}: use a whole number from 1 to {MAX_HISTORY_DAYS}.")
    return days


def build_history(
    entries: List[Mapping[str, Any]],
    currency: str,
    days: int,
    start: Optional[_dt.date],
    end: Optional[_dt.date],
) -> History:
    if start is not None and end is not None and start > end:
        raise InvalidDate(f'"start" ({start}) must be on or before "end" ({end}).')
    series: List[HistoryPoint] = []
    for entry in entries:
        dec = to_decimal(entry.get(currency))
        day = _entry_date(entry, "date")
        if dec is None or day is None:
            continue
        series.append(HistoryPoint(day, _entry_date(entry, "effective_date") or day, dec))
    series.sort(key=lambda p: p.date)
    if not series:
        raise CurrencyNotAvailable(f"No {currency} data in the BCV history.")
    earliest, latest = series[0].date, series[-1].date

    if start is not None or end is not None:
        lo = start if start is not None else earliest
        hi = end if end is not None else latest
    else:
        hi = latest
        lo = latest - _dt.timedelta(days=days - 1)
    window = tuple(p for p in series if lo <= p.date <= hi)
    if not window:
        raise DateOutOfRange(
            f"No {currency} rates between {lo} and {hi}. The history covers {earliest} to {latest} "
            f"for {currency} (latest {MAX_HISTORY_DAYS} daily entries). For older single days use on()."
        )
    notes = []
    if lo < earliest:
        notes.append(f"History for {currency} starts on {earliest}; earlier dates were skipped.")
    if hi > latest:
        notes.append(f"Latest available date is {latest}.")
    return History(currency=currency, points=window, note=" ".join(notes) or None)


def build_conversion(
    entry: Mapping[str, Any],
    amount: Decimal,
    from_: str,
    to: str,
    day: Optional[_dt.date],
    decimals: Optional[int],
) -> Conversion:
    entry_day, effective = _dates(entry, fallback=day)
    the_day = day if day is not None else entry_day
    rates = rates_of(entry)

    def ves_per(code: str) -> Optional[Decimal]:
        return Decimal(1) if code == "VES" else rates.get(code)

    rf, rt = ves_per(from_), ves_per(to)
    if rf is None or rt is None:
        missing = " and ".join(c for c, r in ((from_, rf), (to, rt)) if r is None)
        raise CurrencyNotAvailable(
            f"No BCV rate for {missing} on {the_day} (older entries may lack some currencies). "
            f"Available: {', '.join(rates)}."
        )
    with localcontext() as ctx:
        ctx.prec = 28
        ctx.rounding = ROUND_HALF_UP
        rate = rf / rt
        exact = amount * rf / rt  # multiply first: VES->X stays exact longer
        result = exact if decimals is None else exact.quantize(Decimal(1).scaleb(-decimals))
    rates_used = {c: r for c, r in ((from_, rf), (to, rt)) if c != "VES"}
    note = carry_forward_note(day, effective) if day is not None else None
    return Conversion(
        amount=amount,
        from_=from_,
        to=to,
        result=result,
        result_exact=exact,
        rate=rate,
        rates_used=rates_used,
        date=the_day,
        effective_date=effective,
        carried_forward=note is not None,
        decimals=decimals,
        note=note,
    )


def check_conversion_args(from_: Any, to: Any, decimals: Any) -> Tuple[str, str]:
    src = normalize_currency(from_, allow_ves=True)
    dst = normalize_currency(to, allow_ves=True)
    if src == dst:
        raise InvalidCurrency(f'"from" and "to" are both {src}; choose two different currencies.')
    if decimals is not None and (
        isinstance(decimals, bool) or not isinstance(decimals, int) or not 0 <= decimals <= 12
    ):
        raise InvalidAmount(f"Invalid decimals {decimals!r}: use a whole number from 0 to 12, or None.")
    return src, dst


def build_status(doc: Mapping[str, Any], now: _dt.datetime) -> Status:
    updated = parse_datetime(doc.get("updated_at"))
    age = round((now - updated).total_seconds() / 3600, 1) if updated else None
    status = doc.get("status") if isinstance(doc.get("status"), str) else "unknown"
    stale = age is None or age > STALE_AFTER_HOURS or status != "ok"
    supported = doc.get("supported_currencies")
    currencies = doc.get("currencies")

    def text(key: str) -> Optional[str]:
        value = doc.get(key)
        return value if isinstance(value, str) else None

    return Status(
        status=str(status),
        updated_at=updated,
        generated_at=parse_datetime(doc.get("generated_at")),
        date=_entry_date(doc, "date"),
        effective_date=_entry_date(doc, "effective_date"),
        age_hours=age,
        stale=stale,
        supported_currencies=tuple(str(c) for c in supported) if isinstance(supported, list) else CURRENCIES,
        currencies={str(k): bool(v) for k, v in currencies.items()} if isinstance(currencies, dict) else {},
        timezone=text("timezone"),
        api_version=text("api_version"),
        raw=dict(doc),
    )


# ------------------------------------------------------------------ cache


class TTLCache:
    """Tiny thread-safe in-memory cache of parsed JSON keyed by path."""

    MAX_ENTRIES = 64

    def __init__(self, ttl: float) -> None:
        self.ttl = float(ttl)
        self._data: Dict[str, Tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str, now: float) -> Tuple[bool, Any]:
        if self.ttl <= 0:
            return False, None
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return False, None
            if hit[0] <= now:
                del self._data[key]
                return False, None
            return True, hit[1]

    def set(self, key: str, value: Any, now: float) -> None:
        if self.ttl <= 0:
            return
        with self._lock:
            if len(self._data) >= self.MAX_ENTRIES:
                self._data.clear()
            self._data[key] = (now + self.ttl, value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
