"""Official Python client for the BCV Today API (https://bcv.today).

Exchange rates published by Banco Central de Venezuela (BCV): bolivars (VES) per
unit of USD, EUR, CNY, TRY and RUB.

**Unofficial**: BCV Today is not affiliated with Banco Central de Venezuela.
Code: Apache-2.0. Data: CC BY 4.0, attribution "BCV Today (https://bcv.today)".

Quickstart::

    from bcv import BCV

    client = BCV()
    print(client.latest()["USD"])            # Decimal bolivars per dollar
    print(client.on("2026-01-04", "USD"))    # Sunday -> carried forward from Saturday
    print(client.convert(100, "USD", "VES"))
"""

from ._core import EARLIEST_SNAPSHOT, MAX_HISTORY_DAYS, Response
from ._version import __version__
from .aio import AsyncBCV
from .client import BCV, DEFAULT_USER_AGENT
from .errors import (
    BCVError,
    CurrencyNotAvailable,
    DateOutOfRange,
    InvalidAmount,
    InvalidArgument,
    InvalidCurrency,
    InvalidDate,
    MissingDependency,
    NotFound,
    UpstreamError,
)
from .models import CURRENCIES, SOURCE, UNIT, Conversion, DayRate, History, HistoryPoint, Rates, Status

__all__ = [
    "BCV",
    "CURRENCIES",
    "DEFAULT_USER_AGENT",
    "EARLIEST_SNAPSHOT",
    "MAX_HISTORY_DAYS",
    "SOURCE",
    "UNIT",
    "AsyncBCV",
    "BCVError",
    "Conversion",
    "CurrencyNotAvailable",
    "DateOutOfRange",
    "DayRate",
    "History",
    "HistoryPoint",
    "InvalidAmount",
    "InvalidArgument",
    "InvalidCurrency",
    "InvalidDate",
    "MissingDependency",
    "NotFound",
    "Rates",
    "Response",
    "Status",
    "UpstreamError",
    "__version__",
]
