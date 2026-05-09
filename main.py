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
HISTORY_DIR = os.path.join(API_DIR, "history")
HISTORY_INDEX = os.path.join(API_DIR, "history.json")
HISTORY_INDEX_LIMIT = 365
VENEZUELA_TZ = ZoneInfo("America/Caracas")

CURRENCIES = {
    "USD": "dolar",
    "EUR": "euro",
    "CNY": "yuan",
    "TRY": "lira",
    "RUB": "rublo",
}


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
        rates_by_eff[eff] = data

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
            history.append(json.load(f))
    with open(HISTORY_INDEX, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    rates = get_rates()
    write_json(os.path.join(API_DIR, "rate.json"), rates)
    write_json(os.path.join(HISTORY_DIR, f"{rates['date']}.json"), rates)
    rebuild_calendar_history()
    rebuild_history_index()
    print(json.dumps(rates, indent=2))
