"""Immutable result objects returned by :class:`bcv.BCV` and :class:`bcv.AsyncBCV`.

Money values are :class:`decimal.Decimal`, parsed straight from the JSON text
(never through ``float``), so ``rates["USD"]`` is exactly what BCV published.
``to_dict()`` returns JSON-ready primitives (ISO strings and floats).
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Dict, Iterator, List, Mapping, Optional, Tuple

from .errors import MissingDependency

if TYPE_CHECKING:  # pragma: no cover
    import pandas as pd

__all__ = [
    "CURRENCIES",
    "SOURCE",
    "UNIT",
    "Conversion",
    "DayRate",
    "History",
    "HistoryPoint",
    "Rates",
    "Status",
]

#: Foreign currencies published by BCV, in display order.
CURRENCIES: Tuple[str, ...] = ("USD", "EUR", "CNY", "TRY", "RUB")
#: Attribution string attached to every result.
SOURCE = "Banco Central de Venezuela (BCV), via https://bcv.today"
#: Unit of every rate value.
UNIT = "VES (bolivars) per 1 unit of the currency"


def _fmt(value: Decimal, places: int = 4) -> str:
    """Human formatting with thousands separators (display only, never for math)."""
    return f"{value:,.{places}f}"


def _iso(value: Optional[_dt.date]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _floats(rates: Mapping[str, Decimal]) -> Dict[str, float]:
    return {code: float(v) for code, v in rates.items()}


class _RateLookup:
    """Mapping-like access to a ``rates`` dict keyed by currency code."""

    rates: Mapping[str, Decimal]

    def __getitem__(self, code: str) -> Decimal:
        return self.rates[code.upper()]

    def __contains__(self, code: object) -> bool:
        return isinstance(code, str) and code.upper() in self.rates

    def get(self, code: str, default: Optional[Decimal] = None) -> Optional[Decimal]:
        """Rate for ``code`` (VES per unit), or ``default`` when it is absent."""
        return self.rates.get(code.upper(), default)

    @property
    def usd(self) -> Optional[Decimal]:
        """Bolivars per US dollar, if published."""
        return self.rates.get("USD")

    @property
    def eur(self) -> Optional[Decimal]:
        """Bolivars per euro, if published."""
        return self.rates.get("EUR")

    @property
    def cny(self) -> Optional[Decimal]:
        """Bolivars per Chinese yuan, if published."""
        return self.rates.get("CNY")

    @property
    def try_(self) -> Optional[Decimal]:
        """Bolivars per Turkish lira, if published (``try`` is a Python keyword)."""
        return self.rates.get("TRY")

    @property
    def rub(self) -> Optional[Decimal]:
        """Bolivars per Russian ruble, if published."""
        return self.rates.get("RUB")

    def _rates_line(self) -> str:
        return ", ".join(f"{c} {_fmt(v)}" for c, v in self.rates.items())


@dataclass(frozen=True)
class Rates(_RateLookup):
    """The official BCV rates currently in effect (``/api/v1/rate.json``)."""

    #: Bolivars per unit, keyed by currency code (only the currencies published).
    rates: Mapping[str, Decimal]
    #: Calendar date of the snapshot.
    date: _dt.date
    #: Official BCV validity date ("fecha valor").
    effective_date: _dt.date
    #: UTC capture time of the rate, when known.
    updated_at: Optional[_dt.datetime]
    source: str = SOURCE
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rates": _floats(self.rates),
            "date": self.date.isoformat(),
            "effective_date": self.effective_date.isoformat(),
            "updated_at": _iso(self.updated_at),
            "unit": UNIT,
            "source": self.source,
        }

    def __str__(self) -> str:
        return f"Official BCV rates (effective {self.effective_date}, Bs. per unit): {self._rates_line()}"


@dataclass(frozen=True)
class DayRate(_RateLookup):
    """The BCV rate(s) in effect on one calendar day (``/api/v1/history/{date}.json``)."""

    #: The calendar day that was requested.
    date: _dt.date
    #: Date of the BCV publication in effect that day (earlier on weekends/holidays).
    effective_date: _dt.date
    #: True when ``effective_date`` differs from ``date`` (rate carried forward).
    carried_forward: bool
    #: Bolivars per unit (restricted to one currency when one was requested).
    rates: Mapping[str, Decimal]
    updated_at: Optional[_dt.datetime]
    #: Human explanation of the carry-forward, when it applies.
    note: Optional[str] = None
    source: str = SOURCE
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def rate(self) -> Decimal:
        """The single rate, when exactly one currency is present (e.g. ``on(d, "USD")``)."""
        if len(self.rates) != 1:
            raise ValueError("rate is only defined when exactly one currency was requested")
        return next(iter(self.rates.values()))

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "date": self.date.isoformat(),
            "effective_date": self.effective_date.isoformat(),
            "carried_forward": self.carried_forward,
            "rates": _floats(self.rates),
            "updated_at": _iso(self.updated_at),
            "unit": UNIT,
            "source": self.source,
        }
        if self.note:
            out["note"] = self.note
        return out

    def __str__(self) -> str:
        text = f"BCV rate in effect on {self.date} (Bs. per unit): {self._rates_line()}."
        return f"{text} {self.note}" if self.note else text


@dataclass(frozen=True)
class HistoryPoint:
    """One daily entry of a :class:`History` series."""

    date: _dt.date
    effective_date: _dt.date
    #: Bolivars per unit of the series currency.
    rate: Decimal

    @property
    def carried_forward(self) -> bool:
        return self.effective_date != self.date

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "effective_date": self.effective_date.isoformat(),
            "rate": float(self.rate),
        }


@dataclass(frozen=True)
class History:
    """A daily rate series for one currency, oldest first (never empty)."""

    currency: str
    points: Tuple[HistoryPoint, ...]
    #: Explanation when the requested range was clipped to the available data.
    note: Optional[str] = None
    source: str = SOURCE

    def __post_init__(self) -> None:
        if not self.points:
            raise ValueError("History needs at least one point")

    def __len__(self) -> int:
        return len(self.points)

    def __iter__(self) -> Iterator[HistoryPoint]:
        return iter(self.points)

    @property
    def start(self) -> _dt.date:
        return self.points[0].date

    @property
    def end(self) -> _dt.date:
        return self.points[-1].date

    @property
    def first(self) -> HistoryPoint:
        return self.points[0]

    @property
    def last(self) -> HistoryPoint:
        return self.points[-1]

    @property
    def min(self) -> HistoryPoint:
        """Lowest rate (earliest day on ties)."""
        return min(self.points, key=lambda p: p.rate)

    @property
    def max(self) -> HistoryPoint:
        """Highest rate (earliest day on ties)."""
        return max(self.points, key=lambda p: p.rate)

    @property
    def change(self) -> Decimal:
        """``last.rate - first.rate`` (exact)."""
        return self.last.rate - self.first.rate

    @property
    def change_pct(self) -> Decimal:
        """Percentage change from first to last, rounded to 4 decimals (half-up)."""
        from ._core import pct_change  # local import keeps models free of cycles

        return pct_change(self.first.rate, self.last.rate)

    def to_list(self) -> List[Dict[str, Any]]:
        """Points as dicts: ``{"date": date, "effective_date": date, "rate": Decimal}``."""
        return [{"date": p.date, "effective_date": p.effective_date, "rate": p.rate} for p in self.points]

    def to_pandas(self) -> pd.DataFrame:
        """Series as a :class:`pandas.DataFrame` indexed by date (requires ``bcv[pandas]``).

        Columns: ``rate`` (float64) and ``effective_date`` (datetime64). The index is
        a ``DatetimeIndex`` named ``date``; ``df.attrs`` carries currency and source.
        """
        try:
            import pandas as pd
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise MissingDependency(
                "History.to_pandas() needs pandas. Install it with: pip install 'bcv[pandas]'"
            ) from exc
        df: pd.DataFrame = pd.DataFrame(
            {
                "rate": [float(p.rate) for p in self.points],
                "effective_date": pd.to_datetime([p.effective_date for p in self.points]),
            },
            index=pd.DatetimeIndex(pd.to_datetime([p.date for p in self.points]), name="date"),
        )
        df.attrs["currency"] = self.currency
        df.attrs["unit"] = UNIT
        df.attrs["source"] = self.source
        return df

    def to_dict(self) -> Dict[str, Any]:
        def point(p: HistoryPoint) -> Dict[str, Any]:
            return {"date": p.date.isoformat(), "rate": float(p.rate)}

        out: Dict[str, Any] = {
            "currency": self.currency,
            "from": self.start.isoformat(),
            "to": self.end.isoformat(),
            "points": len(self.points),
            "first": point(self.first),
            "last": point(self.last),
            "min": point(self.min),
            "max": point(self.max),
            "change": float(self.change),
            "change_pct": float(self.change_pct),
            "series": [p.to_dict() for p in self.points],
            "unit": UNIT,
            "source": self.source,
        }
        if self.note:
            out["note"] = self.note
        return out

    def __str__(self) -> str:
        sign = "+" if self.change >= 0 else ""
        text = (
            f"{self.currency}/VES from {self.start} to {self.end} ({len(self)} days): "
            f"{_fmt(self.first.rate)} -> {_fmt(self.last.rate)} ({sign}{self.change_pct:.2f}%). "
            f"Min {_fmt(self.min.rate)} on {self.min.date}, max {_fmt(self.max.rate)} on {self.max.date}."
        )
        return f"{text} {self.note}" if self.note else text


@dataclass(frozen=True)
class Conversion:
    """Result of :meth:`bcv.BCV.convert`.

    ``result`` is ``amount * rates_used[from] / rates_used[to]`` (VES counts as 1),
    computed with 28 significant digits and then rounded to ``decimals`` places
    with ROUND_HALF_UP. ``result_exact`` keeps the unrounded value.
    """

    amount: Decimal
    from_: str
    to: str
    #: Rounded result (see class docstring).
    result: Decimal
    #: Unrounded result (28 significant digits).
    result_exact: Decimal
    #: Units of ``to`` per 1 unit of ``from_`` (28 significant digits).
    rate: Decimal
    #: Bolivars per unit for the non-VES side(s) of the conversion.
    rates_used: Mapping[str, Decimal]
    #: Requested date, or the date of the latest snapshot.
    date: _dt.date
    effective_date: _dt.date
    carried_forward: bool
    #: Decimal places of ``result`` (``None`` = not rounded).
    decimals: Optional[int] = 2
    note: Optional[str] = None
    source: str = SOURCE

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "amount": float(self.amount),
            "from": self.from_,
            "to": self.to,
            "result": float(self.result),
            "rate": float(self.rate),
            "rates_used": _floats(self.rates_used),
            "date": self.date.isoformat(),
            "effective_date": self.effective_date.isoformat(),
            "carried_forward": self.carried_forward,
            "source": self.source,
        }
        if self.note:
            out["note"] = self.note
        return out

    def __str__(self) -> str:
        places = self.decimals if self.decimals is not None else 8
        text = (
            f"{_fmt(self.amount, 2)} {self.from_} = {_fmt(self.result, places)} {self.to} "
            f"at the official BCV rate (effective {self.effective_date}; "
            f"1 {self.from_} = {_fmt(self.rate, 6)} {self.to})."
        )
        return f"{text} {self.note}" if self.note else text


@dataclass(frozen=True)
class Status:
    """Freshness of the published data (``/api/v1/status.json``)."""

    status: str
    updated_at: Optional[_dt.datetime]
    generated_at: Optional[_dt.datetime]
    date: Optional[_dt.date]
    effective_date: Optional[_dt.date]
    #: Hours since ``updated_at`` (one decimal), when known.
    age_hours: Optional[float]
    #: True when status is not "ok" or the last capture is older than 96 hours.
    stale: bool
    supported_currencies: Tuple[str, ...]
    currencies: Mapping[str, bool]
    timezone: Optional[str] = None
    api_version: Optional[str] = None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "updated_at": _iso(self.updated_at),
            "generated_at": _iso(self.generated_at),
            "date": _iso(self.date),
            "effective_date": _iso(self.effective_date),
            "age_hours": self.age_hours,
            "stale": self.stale,
            "supported_currencies": list(self.supported_currencies),
            "currencies": dict(self.currencies),
            "timezone": self.timezone,
            "api_version": self.api_version,
        }

    def __str__(self) -> str:
        age = f" ({self.age_hours} h ago)" if self.age_hours is not None else ""
        return (
            f"Status {self.status}{' (STALE)' if self.stale else ''}: last capture "
            f"{_iso(self.updated_at) or 'unknown'}{age}, effective date {_iso(self.effective_date) or 'unknown'}."
        )
