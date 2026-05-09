(function () {
  const FOREIGN_CODES = Object.keys(CURRENCY_NAMES).filter((c) => c !== "VES");
  const WINDOW = 20;
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

  const fmtDate = (iso) =>
    new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(
      new Date(iso + "T12:00:00")
    );

  const bust = (url) =>
    url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();

  function readQueryCurrency() {
    const params = new URLSearchParams(location.search);
    const c = (params.get("c") || "").toUpperCase();
    return FOREIGN_CODES.indexOf(c) >= 0 ? c : "USD";
  }

  function fillSelect(sel, selected) {
    sel.innerHTML = "";
    for (const c of FOREIGN_CODES) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = symbolFor(c) + "  " + c + " — " + CURRENCY_NAMES[c];
      if (c === selected) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function chartSvg(series) {
    if (!series.length) return "";
    const w = 720;
    const h = 240;
    const padL = 56;
    const padR = 12;
    const padT = 16;
    const padB = 32;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const values = series.map((d) => d.value);
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const dx = series.length > 1 ? innerW / (series.length - 1) : 0;
    const x = (i) => padL + i * dx;
    const y = (v) => padT + innerH - ((v - min) / range) * innerH;

    const linePts = series
      .map((d, i) => x(i).toFixed(2) + "," + y(d.value).toFixed(2))
      .join(" ");
    const areaPts =
      x(0).toFixed(2) +
      "," +
      (padT + innerH).toFixed(2) +
      " " +
      linePts +
      " " +
      x(series.length - 1).toFixed(2) +
      "," +
      (padT + innerH).toFixed(2);

    const ticks = 4;
    const yTicks = [];
    for (let i = 0; i <= ticks; i++) {
      const v = min + (range * i) / ticks;
      const yy = y(v);
      yTicks.push(
        '<line x1="' +
          padL +
          '" x2="' +
          (w - padR) +
          '" y1="' +
          yy +
          '" y2="' +
          yy +
          '" class="grid"/>' +
          '<text x="' +
          (padL - 8) +
          '" y="' +
          (yy + 4) +
          '" text-anchor="end" class="axis">' +
          fmtRate(v) +
          "</text>"
      );
    }

    const labelFirst =
      '<text x="' +
      x(0) +
      '" y="' +
      (h - padB + 18) +
      '" text-anchor="start" class="axis">' +
      fmtDate(series[0].date) +
      "</text>";
    const labelLast =
      '<text x="' +
      x(series.length - 1) +
      '" y="' +
      (h - padB + 18) +
      '" text-anchor="end" class="axis">' +
      fmtDate(series[series.length - 1].date) +
      "</text>";

    const dots = series
      .map(
        (d, i) =>
          '<circle cx="' +
          x(i) +
          '" cy="' +
          y(d.value) +
          '" r="2.5" class="dot"><title>' +
          fmtDate(d.date) +
          ": " +
          fmtRate(d.value) +
          "</title></circle>"
      )
      .join("");

    return (
      '<svg class="chart" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" preserveAspectRatio="xMidYMid meet" role="img">' +
      yTicks.join("") +
      '<polygon points="' +
      areaPts +
      '" class="area"/>' +
      '<polyline points="' +
      linePts +
      '" class="line" fill="none"/>' +
      dots +
      labelFirst +
      labelLast +
      "</svg>"
    );
  }

  function todayCaracas() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function render(history, code) {
    const message = document.getElementById("history-message");
    const stats = document.getElementById("history-stats");
    const chartCard = document.getElementById("chart-card");
    const table = document.getElementById("history-table");
    const rows = document.getElementById("history-rows");

    const today = todayCaracas();
    // Drop any entries dated in the future (rates already captured but not yet in effect).
    const series = history
      .filter((e) => typeof e[code] === "number" && e.date <= today)
      .map((e) => ({ date: e.date, value: e[code] }));

    if (series.length === 0) {
      message.textContent = STRINGS.no_data;
      message.hidden = false;
      stats.hidden = true;
      chartCard.hidden = true;
      table.hidden = true;
      return;
    }
    message.hidden = true;

    const last = series[series.length - 1];
    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const recent = series.slice(-WINDOW);
    const rFirst = recent[0];
    const change1d = prev ? ((last.value - prev.value) / prev.value) * 100 : null;
    const changeN =
      recent.length >= 2
        ? ((last.value - rFirst.value) / rFirst.value) * 100
        : null;

    document.getElementById("stat-current").textContent =
      fmtRate(last.value) + " Bs.";

    const c1 = document.getElementById("stat-change-1d");
    if (change1d === null) {
      c1.textContent = "—";
      c1.className = "stat-value";
    } else {
      c1.textContent = fmtPct(change1d);
      c1.className =
        "stat-value " + (change1d >= 0 ? "up" : "down");
    }

    document.getElementById("stat-change-n-label").textContent =
      STRINGS.change_n_label.replace("%{n}", recent.length);
    const cn = document.getElementById("stat-change-n");
    if (changeN === null) {
      cn.textContent = "—";
      cn.className = "stat-value";
    } else {
      cn.textContent = fmtPct(changeN);
      cn.className =
        "stat-value " + (changeN >= 0 ? "up" : "down");
    }
    stats.hidden = false;

    document.getElementById("chart").innerHTML = chartSvg(recent);
    chartCard.hidden = false;

    rows.innerHTML = "";
    const reversed = series.slice().reverse();
    for (let i = 0; i < reversed.length; i++) {
      const d = reversed[i];
      const next = reversed[i + 1];
      let changeCell = "—";
      let cls = "";
      if (next) {
        const ch = ((d.value - next.value) / next.value) * 100;
        cls = ch >= 0 ? "up" : "down";
        changeCell = fmtPct(ch);
      }
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        fmtDate(d.date) +
        "</td><td>" +
        fmtRate(d.value) +
        '</td><td class="' +
        cls +
        '">' +
        changeCell +
        "</td>";
      rows.appendChild(tr);
    }
    table.hidden = false;
  }

  async function load() {
    const select = document.getElementById("history-currency");
    fillSelect(select, readQueryCurrency());

    let history = [];
    try {
      const res = await fetch(bust(HISTORY_URL), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      history = await res.json();
    } catch (err) {
      const msg = document.getElementById("history-message");
      msg.textContent = STRINGS.error + " " + err.message;
      msg.hidden = false;
      return;
    }

    render(history, select.value);
    select.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("c", select.value);
      window.history.replaceState({}, "", url);
      render(history, select.value);
    });
  }

  load();
})();
