"""Shared fixtures: an offline transport serving recorded API samples."""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
from typing import Callable, Dict, List, Mapping, Optional

import pytest

from bcv import BCV, Response

FIXTURES = Path(__file__).parent / "fixtures"
PREFIX = "https://bcv.today/api/v1/"
# Frozen "now": 2026-11-18 11:00 in Caracas (the fixtures were recorded that day).
NOW = dt.datetime(2026, 11, 18, 15, 0, tzinfo=dt.timezone.utc)


class FakeTransport:
    """Serves files under tests/fixtures/ by URL path; records every call."""

    def __init__(self, overrides: Optional[Dict[str, Response]] = None) -> None:
        self.calls: List[str] = []
        self.headers: List[Mapping[str, str]] = []
        self.overrides = overrides or {}

    def __call__(self, url: str, headers: Mapping[str, str], timeout: float) -> Response:
        self.calls.append(url)
        self.headers.append(dict(headers))
        if url in self.overrides:
            return self.overrides[url]
        assert url.startswith(PREFIX), url
        path = FIXTURES / url[len(PREFIX) :]
        if not path.is_file():
            return Response(404, b"<html>404</html>")
        return Response(200, path.read_bytes())


def make_client(transport: Callable[..., Response], **kwargs: object) -> BCV:
    client = BCV(transport=transport, **kwargs)  # type: ignore[arg-type]
    client._now = lambda: NOW
    return client


@pytest.fixture
def transport() -> FakeTransport:
    return FakeTransport()


@pytest.fixture
def client(transport: FakeTransport) -> BCV:
    return make_client(transport)


def pytest_collection_modifyitems(config: pytest.Config, items: List[pytest.Item]) -> None:
    if os.environ.get("BCV_LIVE") == "1":
        return
    skip = pytest.mark.skip(reason="live API test; set BCV_LIVE=1 to run")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)
