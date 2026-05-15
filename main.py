import glob
import json
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings()

API_DIR = "api"
API_V1_DIR = os.path.join(API_DIR, "v1")
DATA_DIR = "_data"
HISTORY_DIR = os.path.join(API_V1_DIR, "history")
HISTORY_INDEX = os.path.join(API_V1_DIR, "history.json")
STATUS_PATH = os.path.join(API_V1_DIR, "status.json")
DATA_RATE = os.path.join(DATA_DIR, "rate.json")
DATA_RECENT_USD = os.path.join(DATA_DIR, "recent_usd.json")
HISTORY_INDEX_LIMIT = 1830
RECENT_USD_LIMIT = 7
VENEZUELA_TZ = ZoneInfo("America/Caracas")

CURRENCIES = {
    "USD": "dolar",
    "EUR": "euro",
    "CNY": "yuan",
    "TRY": "lira",
    "RUB": "rublo",
}


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def same_rate_payload(a, b):
    if not isinstance(a, dict) or not isinstance(b, dict):
        return False
    keys = list(CURRENCIES.keys()) + ["date", "effective_date"]
    return all(a.get(key) == b.get(key) for key in keys)


def stable_rate_payload(new_rate, previous_rate):
    if isinstance(previous_rate, dict) and same_rate_payload(new_rate, previous_rate) and previous_rate.get(
            "updated_at"):
        out = {**new_rate}
        out["updated_at"] = previous_rate["updated_at"]
        return out
    return new_rate


def parse_rate(html, element_id):
    container = html.find('div', {'id': element_id})
    text = container.find('strong').text.strip()
    return float(text.replace('.', '').replace(',', '.'))


def parse_effective_date(html):
    """Reads BCV's published 'Fecha Valor' span and returns ISO date (YYYY-MM-DD)."""
    span = html.find('span', class_='date-display-single')
    if not span:
        return None
    content = span.get('content')
    if content:
        return content.split('T', 1)[0]
    return None


def get_rates():
    url = "https://www.bcv.org.ve/"
    req = requests.get(url, verify=False, timeout=30)
    req.raise_for_status()

    html = BeautifulSoup(req.text, "html.parser")
    now = datetime.now(timezone.utc)
    result = {code: parse_rate(html, element_id) for code, element_id in CURRENCIES.items()}
    result["updated_at"] = now.isoformat()
    effective = parse_effective_date(html)
    today = now.astimezone(VENEZUELA_TZ).date().isoformat()
    # The canonical history file is named by the effective date — the day this
    # rate becomes officially in effect (per BCV "Fecha Valor"). Both `date` and
    # `effective_date` are set to that value for the canonical entry; calendar
    # filler days written by rebuild_calendar_history will diverge.
    if effective:
        result["effective_date"] = effective
        result["date"] = effective
    else:
        result["date"] = today
    return result


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def normalize_rate_payload(data):
    out = {**data}
    for code in CURRENCIES.keys():
        if code in out and not isinstance(out[code], (int, float)):
            del out[code]
    return out


def rebuild_calendar_history():
    """Ensure every calendar day from the earliest snapshot to today has a
    history file. For canonical days (where effective_date matches) the rate
    captured by BCV is used. For weekends, holidays, or any day BCV didn't
    publish, the file is filled with the most recent rate where
    `effective_date <= that day` — i.e., the rate that was officially in effect
    that day (Friday's effective rate covers Saturday and Sunday)."""
    files = sorted(glob.glob(os.path.join(HISTORY_DIR, "*.json")))

    rates_by_eff = {}
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        eff_str = data.get("effective_date") or data.get("date")
        if not eff_str:
            continue
        try:
            eff = date.fromisoformat(eff_str)
        except (ValueError, TypeError):
            continue
        rates_by_eff[eff] = normalize_rate_payload(data)

    if not rates_by_eff:
        return

    sorted_effs = sorted(rates_by_eff.keys())
    today = datetime.now(VENEZUELA_TZ).date()

    cur = sorted_effs[0]
    while cur <= today:
        # Latest effective_date that is ≤ cur (the rate officially in effect on cur)
        eff = None
        for e in sorted_effs:
            if e > cur:
                break
            eff = e
        if eff is None:
            cur += timedelta(days=1)
            continue

        out_data = {**rates_by_eff[eff]}
        out_data["date"] = cur.isoformat()
        out_data["effective_date"] = eff.isoformat()

        target = os.path.join(HISTORY_DIR, f"{cur.isoformat()}.json")
        existing = None
        if os.path.exists(target):
            try:
                with open(target, encoding="utf-8") as fh:
                    existing = json.load(fh)
            except (OSError, json.JSONDecodeError):
                pass

        if existing != out_data:
            with open(target, "w", encoding="utf-8") as fh:
                json.dump(out_data, fh, indent=2, ensure_ascii=False)
                fh.write("\n")

        cur += timedelta(days=1)


def rebuild_history_index():
    paths = sorted(glob.glob(os.path.join(HISTORY_DIR, "*.json")))
    paths = paths[-HISTORY_INDEX_LIMIT:]
    history = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            history.append(normalize_rate_payload(json.load(f)))
    with open(HISTORY_INDEX, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")


def rebuild_recent_usd_data():
    paths = sorted(glob.glob(os.path.join(HISTORY_DIR, "*.json")))
    history = []
    previous_usd = None
    for path in paths:
        with open(path, encoding="utf-8") as f:
            data = normalize_rate_payload(json.load(f))
        usd = data.get("USD")
        if not isinstance(usd, (int, float)):
            continue
        change_pct = None
        if isinstance(previous_usd, (int, float)) and previous_usd != 0:
            change_pct = ((usd - previous_usd) / previous_usd) * 100
        history.append({
            "date": data.get("date"),
            "USD": usd,
            "change_pct": change_pct,
        })
        previous_usd = usd
    write_json(DATA_RECENT_USD, history[-RECENT_USD_LIMIT:])


def build_current_rate():
    """Return the rate to advertise as 'today's current rate':
    today's calendar entry, with any missing currencies (e.g. early backfills
    that only cover USD/EUR) filled from the latest available source."""
    today_iso = datetime.now(VENEZUELA_TZ).date().isoformat()
    today_path = os.path.join(HISTORY_DIR, f"{today_iso}.json")

    if os.path.exists(today_path):
        with open(today_path, encoding="utf-8") as f:
            current = json.load(f)
    else:
        current = {}

    # Fill any missing currency from the most recent file that has it.
    files = sorted(
        glob.glob(os.path.join(HISTORY_DIR, "*.json")), reverse=True
    )
    for code in CURRENCIES.keys():
        if isinstance(current.get(code), (int, float)):
            continue
        for path in files:
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data.get(code), (int, float)):
                current[code] = data[code]
                break

    return current


def build_status(current_rate):
    previous_status = read_json(STATUS_PATH)
    now = datetime.now(timezone.utc)
    currency_status = {
        code: isinstance(current_rate.get(code), (int, float))
        for code in CURRENCIES.keys()
    }
    generated_at = now.isoformat()
    if (
            isinstance(previous_status, dict)
            and previous_status.get("updated_at") == current_rate.get("updated_at")
            and previous_status.get("date") == current_rate.get("date")
            and previous_status.get("effective_date") == current_rate.get("effective_date")
            and previous_status.get("currencies") == currency_status
    ):
        generated_at = previous_status.get("generated_at", generated_at)
    return {
        "status": "ok" if all(currency_status.values()) else "partial",
        "updated_at": current_rate.get("updated_at"),
        "generated_at": generated_at,
        "date": current_rate.get("date"),
        "effective_date": current_rate.get("effective_date"),
        "timezone": "America/Caracas",
        "source": "https://www.bcv.org.ve/",
        "supported_currencies": list(CURRENCIES.keys()),
        "api_version": "v1",
        "currencies": currency_status,
        "endpoints": {
            "latest": "/api/v1/rate.json",
            "history": "/api/v1/history.json",
            "status": "/api/v1/status.json",
        },
    }


if __name__ == "__main__":
    rates = get_rates()
    # Persist the canonical snapshot for the captured effective date.
    canonical_path = os.path.join(HISTORY_DIR, f"{rates['date']}.json")
    rates = stable_rate_payload(rates, read_json(canonical_path))
    write_json(canonical_path, rates)
    # Fill calendar days (weekends/holidays inherit the previous business day's rate).
    rebuild_calendar_history()
    # api/v1/rate.json reflects *today's* rate, with all currencies present.
    current_rate = build_current_rate()
    current_rate = stable_rate_payload(current_rate, read_json(DATA_RATE))
    write_json(os.path.join(API_V1_DIR, "rate.json"), current_rate)
    write_json(STATUS_PATH, build_status(current_rate))
    # Jekyll reads _data/rate.json at build time, so the latest rates are also
    # present in crawlable HTML, not only in client-rendered JSON.
    write_json(DATA_RATE, current_rate)
    rebuild_history_index()
    rebuild_recent_usd_data()
    print(json.dumps(rates, indent=2))
