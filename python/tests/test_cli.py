from __future__ import annotations

import json
import subprocess
import sys

import pytest

from bcv import Response
from bcv.cli import EXIT_NO_DATA, EXIT_OK, EXIT_UPSTREAM, EXIT_USAGE, main

from .conftest import PREFIX, FakeTransport, make_client


def run(capsys: pytest.CaptureFixture[str], *argv: str, transport: FakeTransport | None = None) -> tuple:  # type: ignore[type-arg]
    code = main(list(argv), client=make_client(transport or FakeTransport()))
    out, err = capsys.readouterr()
    return code, out, err


def test_latest_table(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = run(capsys, "latest")
    assert code == EXIT_OK and err == ""
    lines = out.splitlines()
    assert lines[0] == "Official BCV rates, effective 2026-11-18 (Bs. per unit)"
    assert "USD         916.6477" in out
    assert "EUR       1,007.3867" in out
    # Rate column is right-aligned: every data row has the same width.
    rows = [line for line in lines if line[:3] in {"USD", "EUR", "CNY", "TRY", "RUB"}]
    assert len(rows) == 5 and len({len(r) for r in rows}) == 1
    assert "Unofficial" in out


def test_latest_json(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "latest", "--json")
    assert code == EXIT_OK
    data = json.loads(out)
    assert data["rates"]["USD"] == 916.6477
    assert data["effective_date"] == "2026-11-18"


def test_json_flag_before_command(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "--json", "status")
    assert code == EXIT_OK and json.loads(out)["status"] == "ok"


def test_on_with_currency(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "on", "2026-01-04", "--currency", "USD")
    assert code == EXIT_OK
    assert "effective date 2026-01-03" in out
    assert "USD         304.6796" in out
    assert "Note: 2026-01-04 (Sunday)" in out


def test_on_json(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "on", "2026-01-04", "-c", "eur", "--json")
    data = json.loads(out)
    assert code == EXIT_OK and data["carried_forward"] is True and data["rates"] == {"EUR": 357.8858}


def test_convert(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "convert", "100", "USD", "VES")
    assert code == EXIT_OK
    assert "91,664.77 VES" in out and "1 USD = 916.647700 VES" in out


def test_convert_json_with_date(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "convert", "10", "usd", "ves", "--date", "2026-01-04", "--json")
    data = json.loads(out)
    assert code == EXIT_OK and data["result"] == 3046.8 and data["effective_date"] == "2026-01-03"


def test_history(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "history", "USD", "--days", "7")
    assert code == EXIT_OK
    assert out.splitlines()[0] == "USD/VES official BCV rate, 2026-11-12 to 2026-11-18 (7 days)"
    assert "2026-11-18" in out and "Min " in out and "Change " in out


def test_history_range_marks_carry_forward(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "history", "EUR", "--start", "2026-01-01", "--end", "2026-01-06")
    assert code == EXIT_OK
    assert "2026-01-04  2026-01-03 *" in out
    assert "carried forward" in out


def test_history_json(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "history", "USD", "-n", "3", "--json")
    assert code == EXIT_OK and json.loads(out)["points"] == 3


@pytest.mark.parametrize(
    ("argv", "expected", "fragment"),
    [
        (("on", "2026-13-01"), EXIT_USAGE, "Invalid date"),
        (("convert", "100", "USD", "GBP"), EXIT_USAGE, "Unsupported currency"),
        (("convert", "-5", "USD", "VES"), EXIT_USAGE, "zero or positive"),
        (("on", "2020-01-01"), EXIT_NO_DATA, "snapshots start on 2021-08-02"),
        (("on", "2030-01-01"), EXIT_NO_DATA, "in the future"),
        (("on", "2021-08-02", "--currency", "EUR"), EXIT_NO_DATA, "No EUR rate"),
    ],
)
def test_error_exit_codes(capsys: pytest.CaptureFixture[str], argv: tuple, expected: int, fragment: str) -> None:  # type: ignore[type-arg]
    code, out, err = run(capsys, *argv)
    assert code == expected
    assert err.startswith("bcv: error: ") and fragment in err
    assert out == ""


def test_upstream_exit_code_and_json_error(capsys: pytest.CaptureFixture[str]) -> None:
    t = FakeTransport({PREFIX + "rate.json": Response(502, b"")})
    code, out, err = run(capsys, "latest", "--json", transport=t)
    assert code == EXIT_UPSTREAM
    assert json.loads(out)["error"]["type"] == "UpstreamError"
    assert "HTTP 502" in err


def test_argparse_usage_error_exits_2(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as info:
        main(["frobnicate"])
    assert info.value.code == 2
    with pytest.raises(SystemExit) as info:
        main([])
    assert info.value.code == 2


def test_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as info:
        main(["--version"])
    assert info.value.code == 0
    assert capsys.readouterr().out.startswith("bcv 1.")


def test_python_dash_m_help() -> None:
    proc = subprocess.run([sys.executable, "-m", "bcv", "--help"], capture_output=True, text=True, check=False)
    assert proc.returncode == 0 and "not affiliated" in proc.stdout
