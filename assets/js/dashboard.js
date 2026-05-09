(function () {
  const FOREIGN_CODES = Object.keys(CURRENCY_NAMES).filter((c) => c !== "VES");
  const SPARK_WINDOW = 20;
  const CURRENCY_SYMBOLS = {
    USD: "$",
    EUR: "€",
    CNY: "¥",
    TRY: "₺",
    RUB: "₽",
    VES: "Bs",
  };
  const symbolFor = (c) => CURRENCY_SYMBOLS[c] || c;

  const fmtRate = (n) =>
    new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 8,
    }).format(n);

  const fmtPct = (n) =>
    new Intl.NumberFormat(LOCALE, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: "exceptZero",
    }).format(n / 100);

  // Plain numeric string for <input type="number"> (no locale separators).
  const numForInput = (n) => (isFinite(n) ? String(Number(n.toFixed(6))) : "");

  const fmtDateTime = (iso) =>
    new Intl.DateTimeFormat(LOCALE, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Caracas",
    }).format(new Date(iso));

  const fmtDate = (iso) =>
    new Intl.DateTimeFormat(LOCALE, { dateStyle: "long" }).format(
      new Date(iso + "T12:00:00")
    );

  const bust = (url) =>
    url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();

  function sparklineSvg(values) {
    if (!values || values.length < 2) return "";
    const w = 100;
    const h = 28;
    const pad = 2;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const dx = (w - pad * 2) / (values.length - 1);
    const points = values
      .map((v, i) => {
        const x = pad + i * dx;
        const y = pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2);
        return x.toFixed(2) + "," + y.toFixed(2);
      })
      .join(" ");
    return (
      '<svg class="spark" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' +
      points +
      '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      "</svg>"
    );
  }

  function lastValuesFor(history, code, n) {
    const out = [];
    for (const entry of history) {
      if (typeof entry[code] === "number") out.push(entry[code]);
    }
    return out.slice(-n);
  }

  function renderCards(data, history) {
    const grid = document.getElementById("grid");
    grid.innerHTML = "";
    for (const code of FOREIGN_CODES) {
      if (typeof data[code] !== "number") continue;
      const series = lastValuesFor(history, code, SPARK_WINDOW);
      let footHtml = '<span class="muted">' + STRINGS.no_history + "</span>";
      if (series.length >= 2) {
        const first = series[0];
        const last = series[series.length - 1];
        const change = ((last - first) / first) * 100;
        const dir = change >= 0 ? "up" : "down";
        footHtml =
          sparklineSvg(series) +
          '<span class="change ' +
          dir +
          '" title="' +
          STRINGS.variation +
          " (" +
          series.length +
          'd)">' +
          fmtPct(change) +
          "</span>";
      }
      const href = HISTORY_PAGE_URL + "?c=" + code;
      const card = document.createElement("a");
      card.className = "card";
      card.href = href;
      card.setAttribute("aria-label", STRINGS.view_history + " " + code);
      card.innerHTML =
        '<div class="card-head">' +
        '<div class="curr-icon" data-code="' +
        code +
        '">' +
        symbolFor(code) +
        "</div>" +
        '<div class="card-title">' +
        '<div class="code">' +
        code +
        "</div>" +
        '<div class="name">' +
        CURRENCY_NAMES[code] +
        "</div>" +
        "</div>" +
        "</div>" +
        '<div class="value">' +
        fmtRate(data[code]) +
        '<span class="unit">Bs.</span></div>' +
        '<div class="card-foot">' +
        footHtml +
        "</div>";
      grid.appendChild(card);
    }
  }

  function setupCalculator(data) {
    const el = document.getElementById("calculator");
    if (!el) return;
    const amountFrom = document.getElementById("calc-amount-from");
    const amountTo = document.getElementById("calc-amount-to");
    const currFrom = document.getElementById("calc-currency-from");
    const currTo = document.getElementById("calc-currency-to");
    const swap = document.getElementById("calc-swap");

    const options = ["VES"].concat(FOREIGN_CODES);
    function fillSelect(sel, selected) {
      sel.innerHTML = "";
      for (const c of options) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = symbolFor(c) + "  " + c + " — " + CURRENCY_NAMES[c];
        if (c === selected) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    fillSelect(currFrom, "USD");
    fillSelect(currTo, "VES");
    amountFrom.value = "1";

    const toBs = (amt, c) => (c === "VES" ? amt : amt * data[c]);
    const fromBs = (bs, c) => (c === "VES" ? bs : bs / data[c]);

    function update(source) {
      if (source === "from") {
        const a = parseFloat(amountFrom.value);
        if (Number.isNaN(a)) {
          amountTo.value = "";
          return;
        }
        amountTo.value = numForInput(
          fromBs(toBs(a, currFrom.value), currTo.value)
        );
      } else {
        const a = parseFloat(amountTo.value);
        if (Number.isNaN(a)) {
          amountFrom.value = "";
          return;
        }
        amountFrom.value = numForInput(
          fromBs(toBs(a, currTo.value), currFrom.value)
        );
      }
    }

    amountFrom.addEventListener("input", () => update("from"));
    currFrom.addEventListener("change", () => update("from"));
    amountTo.addEventListener("input", () => update("to"));
    currTo.addEventListener("change", () => update("to"));
    swap.addEventListener("click", () => {
      const fromCurr = currFrom.value;
      const fromAmt = amountFrom.value;
      currFrom.value = currTo.value;
      currTo.value = fromCurr;
      amountFrom.value = amountTo.value;
      amountTo.value = fromAmt;
      update("from");
    });

    update("from");
    el.hidden = false;
  }

  async function fetchJson(url) {
    const res = await fetch(bust(url), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function load() {
    const grid = document.getElementById("grid");
    const meta = document.getElementById("meta");
    try {
      const [rate, history] = await Promise.all([
        fetchJson(RATE_URL),
        fetchJson(HISTORY_URL).catch(() => []),
      ]);
      meta.innerHTML =
        "<span>" +
        STRINGS.date +
        ": <strong>" +
        fmtDate(rate.date) +
        "</strong></span>" +
        "<span>" +
        STRINGS.updated +
        ": <strong>" +
        fmtDateTime(rate.updated_at) +
        "</strong> " +
        STRINGS.zone +
        "</span>";

      renderCards(rate, history);
      setupCalculator(rate);
    } catch (err) {
      grid.innerHTML =
        '<div class="error">' + STRINGS.error + " " + err.message + "</div>";
    }
  }

  load();
})();
