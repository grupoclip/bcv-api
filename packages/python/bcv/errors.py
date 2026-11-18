"""Exception hierarchy.

Every error raised on purpose by this library derives from :class:`BCVError`::

    BCVError
    ├── InvalidArgument (also a ValueError)
    │   ├── InvalidDate          bad date string / not a real calendar day
    │   ├── InvalidCurrency      unknown currency code, or from == to
    │   └── InvalidAmount        negative, non-finite or too large amount
    ├── DateOutOfRange           before 2021-08-02, in the future, not published yet,
    │                            or outside the range covered by history.json
    ├── CurrencyNotAvailable     valid code, but no rate for it that day
    ├── NotFound                 the API answered HTTP 404
    ├── UpstreamError            network failure, HTTP error or invalid JSON
    └── MissingDependency        optional extra not installed (also an ImportError)
"""

from __future__ import annotations

from typing import Optional

__all__ = [
    "BCVError",
    "CurrencyNotAvailable",
    "DateOutOfRange",
    "InvalidAmount",
    "InvalidArgument",
    "InvalidCurrency",
    "InvalidDate",
    "MissingDependency",
    "NotFound",
    "UpstreamError",
]


class BCVError(Exception):
    """Base class for every error raised by the ``bcv`` library."""


class InvalidArgument(BCVError, ValueError):
    """An argument passed by the caller is invalid."""


class InvalidDate(InvalidArgument):
    """A date is malformed or not a real calendar day (expected ``YYYY-MM-DD``)."""


class InvalidCurrency(InvalidArgument):
    """A currency code is not one of VES, USD, EUR, CNY, TRY or RUB (or is misused)."""


class InvalidAmount(InvalidArgument):
    """An amount to convert is negative, not finite, too large or not a number."""


class DateOutOfRange(BCVError):
    """The date is valid but no BCV data exists for it (too old, future or not published)."""


class CurrencyNotAvailable(BCVError):
    """The currency is supported, but the BCV data has no rate for it on that day."""


class NotFound(BCVError):
    """The BCV Today API answered HTTP 404 for a path."""


class UpstreamError(BCVError):
    """The BCV Today API could not be reached or returned an unusable response."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        #: HTTP status code, when the error came from an HTTP response.
        self.status = status


class MissingDependency(BCVError, ImportError):
    """An optional dependency (``bcv[pandas]`` or ``bcv[async]``) is not installed."""
