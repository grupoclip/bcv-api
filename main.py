import glob
import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings()

API_DIR = "api"
HISTORY_DIR = os.path.join(API_DIR, "history")
HISTORY_INDEX = os.path.join(API_DIR, "history.json")
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


def get_rates():
    url = "https://www.bcv.org.ve/"
    req = requests.get(url, verify=False, timeout=30)
    req.raise_for_status()

    html = BeautifulSoup(req.text, "html.parser")
    now = datetime.now(timezone.utc)
    result = {code: parse_rate(html, element_id) for code, element_id in CURRENCIES.items()}
    result["updated_at"] = now.isoformat()
    result["date"] = now.astimezone(VENEZUELA_TZ).date().isoformat()
    return result


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def rebuild_history_index():
    history = []
    for path in sorted(glob.glob(os.path.join(HISTORY_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            history.append(json.load(f))
    with open(HISTORY_INDEX, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    rates = get_rates()
    write_json(os.path.join(API_DIR, "rate.json"), rates)
    write_json(os.path.join(HISTORY_DIR, f"{rates['date']}.json"), rates)
    rebuild_history_index()
    print(json.dumps(rates, indent=2))
