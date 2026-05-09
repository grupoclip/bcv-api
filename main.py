import json
from datetime import datetime, timezone

import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings()


def parse_rate(html, element_id):
    container = html.find('div', {'id': element_id})
    text = container.find('strong').text.strip()
    return float(text.replace('.', '').replace(',', '.'))


def get_rates():
    url = "https://www.bcv.org.ve/"
    req = requests.get(url, verify=False, timeout=30)
    req.raise_for_status()

    html = BeautifulSoup(req.text, "html.parser")
    return {
        "USD": parse_rate(html, "dolar"),
        "EUR": parse_rate(html, "euro"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    rates = get_rates()
    with open("rate.json", "w", encoding="utf-8") as f:
        json.dump(rates, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(json.dumps(rates, indent=2))
