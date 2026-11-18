"""Command-line interface: ``bcv latest | on | convert | history | status``.

Exit codes: 0 success, 1 no data for the request (date out of range, currency not
available), 2 invalid arguments, 3 upstream/network error.
"""

from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, TextIO

from ._core import MAX_HISTORY_DAYS
from ._version import __version__
from .client import BCV
from .errors import BCVError, InvalidArgument, UpstreamError
from .models import SOURCE, Conversion, DayRate, History, Rates, Status

EXIT_OK = 0
EXIT_NO_DATA = 1
EXIT_USAGE = 2
EXIT_UPSTREAM = 3

ATTRIBUTION = "Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial."


def _num(value: Decimal, places: int = 4) -> str:
    return f"{value:,.{places}f}"


def _table(headers: Sequence[str], rows: Sequence[Sequence[str]], align: str) -> str:
    """Render an aligned plain-text table; ``align`` holds 'l'/'r' per column."""
    widths = [max(len(h), *(len(r[i]) for r in rows)) if rows else len(h) for i, h in enumerate(headers)]

    def line(cells: Sequence[str]) -> str:
        parts = [c.ljust(w) if a == "l" else c.rjust(w) for c, w, a in zip(cells, widths, align)]
        return "  ".join(parts).rstrip()

    sep = "  ".join("-" * w for w in widths)
    return "\n".join([line(headers), sep, *(line(r) for r in rows)])


def _render_rates(r: Rates) -> str:
    rows = [[c, _num(v)] for c, v in r.rates.items()]
    updated = r.updated_at.strftime("%Y-%m-%d %H:%M UTC") if r.updated_at else "unknown"
    return "\n".join(
        [
            f"Official BCV rates, effective {r.effective_date} (Bs. per unit)",
            "",
            _table(["Currency", "Rate (VES)"], rows, "lr"),
            "",
            f"Updated {updated}. {ATTRIBUTION}",
        ]
    )


def _render_day(d: DayRate) -> str:
    rows = [[c, _num(v)] for c, v in d.rates.items()]
    out = [
        f"BCV rate in effect on {d.date} (effective date {d.effective_date}, Bs. per unit)",
        "",
        _table(["Currency", "Rate (VES)"], rows, "lr"),
    ]
    if d.note:
        out += ["", f"Note: {d.note}"]
    return "\n".join([*out, "", ATTRIBUTION])


def _render_conversion(c: Conversion) -> str:
    places = c.decimals if c.decimals is not None else 8
    rows: List[List[str]] = [
        ["Amount", f"{_num(c.amount, 2)} {c.from_}"],
        ["Result", f"{_num(c.result, places)} {c.to}"],
        ["Rate", f"1 {c.from_} = {_num(c.rate, 6)} {c.to}"],
    ]
    rows += [[f"BCV {code}", f"{_num(v)} VES"] for code, v in c.rates_used.items()]
    rows += [["Effective", str(c.effective_date)]]
    out = [_table(["", ""], rows, "ll").split("\n", 2)[2]]
    if c.note:
        out += ["", f"Note: {c.note}"]
    return "\n".join([*out, "", ATTRIBUTION])


def _render_history(h: History) -> str:
    rows = [[str(p.date), str(p.effective_date) + (" *" if p.carried_forward else ""), _num(p.rate)] for p in h.points]
    sign = "+" if h.change >= 0 else ""
    out = [
        f"{h.currency}/VES official BCV rate, {h.start} to {h.end} ({len(h)} days)",
        "",
        _table(["Date", "Effective", "Rate (VES)"], rows, "llr"),
        "",
        f"First {_num(h.first.rate)}  Last {_num(h.last.rate)}  "
        f"Change {sign}{_num(h.change)} ({sign}{h.change_pct:.2f}%)",
        f"Min {_num(h.min.rate)} on {h.min.date}  Max {_num(h.max.rate)} on {h.max.date}",
    ]
    if any(p.carried_forward for p in h.points):
        out.append("* rate carried forward from the effective date (weekend/holiday).")
    if h.note:
        out.append(f"Note: {h.note}")
    return "\n".join([*out, ATTRIBUTION])


def _render_status(s: Status) -> str:
    rows = [
        ["Status", s.status + (" (STALE)" if s.stale else "")],
        ["Updated", s.updated_at.isoformat() if s.updated_at else "unknown"],
        ["Age", f"{s.age_hours} h" if s.age_hours is not None else "unknown"],
        ["Effective date", str(s.effective_date) if s.effective_date else "unknown"],
        ["Currencies", ", ".join(s.supported_currencies)],
    ]
    return _table(["", ""], rows, "ll").split("\n", 2)[2]


def _build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="machine-readable JSON output")
    common.add_argument("--base-url", default=argparse.SUPPRESS, help="API origin (default https://bcv.today)")
    common.add_argument("--timeout", type=float, default=argparse.SUPPRESS, help="request timeout in seconds")

    parser = argparse.ArgumentParser(
        prog="bcv",
        description="Official Banco Central de Venezuela exchange rates from the BCV Today API "
        "(https://bcv.today). Unofficial client, not affiliated with the bank.",
        parents=[common],
        epilog="Exit codes: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network/API error.",
    )
    parser.add_argument("--version", action="version", version=f"bcv {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")
    sub.required = True

    sub.add_parser("latest", parents=[common], help="rates currently in effect")

    p_on = sub.add_parser("on", parents=[common], help="rate in effect on a date (YYYY-MM-DD)")
    p_on.add_argument("date", help="calendar day, YYYY-MM-DD")
    p_on.add_argument("--currency", "-c", help="only this currency (USD, EUR, CNY, TRY, RUB)")

    p_cv = sub.add_parser("convert", parents=[common], help="convert an amount, e.g. 'bcv convert 100 USD VES'")
    p_cv.add_argument("amount", help="amount to convert, e.g. 100 or 12.50")
    p_cv.add_argument("from_", metavar="FROM", help="source currency (VES, USD, EUR, CNY, TRY, RUB)")
    p_cv.add_argument("to", metavar="TO", help="target currency")
    p_cv.add_argument("--date", "-d", help="use the rate in effect on this day (YYYY-MM-DD)")
    p_cv.add_argument("--decimals", type=int, default=2, help="decimal places of the result (default 2)")

    p_h = sub.add_parser("history", parents=[common], help="daily series for one currency")
    p_h.add_argument("currency", help="USD, EUR, CNY, TRY or RUB")
    p_h.add_argument(
        "--days", "-n", type=int, default=30, help=f"last N calendar days (default 30, max {MAX_HISTORY_DAYS})"
    )
    p_h.add_argument("--start", help="range start, YYYY-MM-DD (overrides --days)")
    p_h.add_argument("--end", help="range end, YYYY-MM-DD (overrides --days)")

    sub.add_parser("status", parents=[common], help="data freshness")
    return parser


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def _run(args: argparse.Namespace, client: BCV) -> Dict[str, Any] | str:
    as_json = getattr(args, "json", False)
    cmd = args.command
    if cmd == "latest":
        r = client.latest()
        return r.to_dict() if as_json else _render_rates(r)
    if cmd == "on":
        d = client.on(args.date, args.currency)
        return d.to_dict() if as_json else _render_day(d)
    if cmd == "convert":
        c = client.convert(args.amount, args.from_, args.to, args.date, decimals=args.decimals)
        return c.to_dict() if as_json else _render_conversion(c)
    if cmd == "history":
        h = client.history(args.currency, args.days, start=args.start, end=args.end)
        return h.to_dict() if as_json else _render_history(h)
    s = client.status()
    return s.to_dict() if as_json else _render_status(s)


def main(argv: Optional[Sequence[str]] = None, client: Optional[BCV] = None) -> int:
    """Entry point of the ``bcv`` console script; returns the exit code."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    as_json = getattr(args, "json", False)
    out: TextIO = sys.stdout
    if client is None:
        client = BCV(
            base_url=getattr(args, "base_url", "https://bcv.today"),
            timeout=getattr(args, "timeout", 10.0),
        )
    try:
        result = _run(args, client)
    except BCVError as err:
        if isinstance(err, InvalidArgument):
            code = EXIT_USAGE
        elif isinstance(err, UpstreamError):
            code = EXIT_UPSTREAM
        else:
            code = EXIT_NO_DATA
        if as_json:
            print(json.dumps({"error": {"type": type(err).__name__, "message": str(err)}}), file=out)
        print(f"bcv: error: {err}", file=sys.stderr)
        return code
    if isinstance(result, str):
        print(result, file=out)
    else:
        result.setdefault("source", SOURCE)
        print(json.dumps(result, indent=2, ensure_ascii=False, default=_jsonable), file=out)
    return EXIT_OK


def run() -> None:  # pragma: no cover - console_scripts shim
    sys.exit(main())


if __name__ == "__main__":  # pragma: no cover
    run()
