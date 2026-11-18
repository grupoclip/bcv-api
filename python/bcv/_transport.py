"""Default HTTP transport built on :mod:`urllib` (standard library only)."""

from __future__ import annotations

import gzip
import urllib.error
import urllib.request
from typing import Callable, Mapping

from ._core import Response

#: A transport takes ``(url, headers, timeout_seconds)`` and returns a :class:`Response`.
#: It should return non-2xx statuses rather than raise; any exception it raises is
#: reported as :class:`bcv.UpstreamError`.
Transport = Callable[[str, Mapping[str, str], float], Response]


def _read(resp: object, encoding: str | None) -> bytes:
    body: bytes = resp.read()  # type: ignore[attr-defined]
    if (encoding or "").lower() == "gzip":
        body = gzip.decompress(body)
    return body


def urllib_transport(url: str, headers: Mapping[str, str], timeout: float) -> Response:
    """GET ``url`` with urllib, transparently handling gzip."""
    # The client only builds http(s) URLs (BCV validates base_url), so file:/custom schemes cannot occur.
    request = urllib.request.Request(url, headers={**headers, "Accept-Encoding": "gzip"}, method="GET")  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:  # noqa: S310
            return Response(int(resp.status), _read(resp, resp.headers.get("Content-Encoding")))
    except urllib.error.HTTPError as err:
        try:
            body = _read(err, err.headers.get("Content-Encoding") if err.headers else None)
        except Exception:  # noqa: BLE001 - body of an error page is best effort
            body = b""
        return Response(int(err.code), body)
