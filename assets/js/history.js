(function () {
  const FOREIGN_CODES = Object.keys(CURRENCY_NAMES).filter((c) => c !== "VES");
  const PAGE_SIZE = 25;
  const DEFAULT_RANGE = 30;
  let tablePage = 1;
  let activeRange = DEFAULT_RANGE;
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

  const fmtAxisRate = (n) =>
    new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: n >= 100 ? 0 : 2,
      maximumFractionDigits: n >= 100 ? 0 : 2,
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

  function readQueryRange() {
    const params = new URLSearchParams(location.search);
    const days = parseInt(params.get("range"), 10);
    return [7, 30, 90, 365, 730, 1095, 1460, 1825].indexOf(days) >= 0
      ? days
      : DEFAULT_RANGE;
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
    const padL = 48;
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
          fmtAxisRate(v) +
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

  function updateShareLink(code, range) {
    const share = document.getElementById("history-share");
    if (!share) return;
    const url = new URL(location.href);
    url.searchParams.set("c", code);
    url.searchParams.set("range", range);
    if ("href" in share) share.href = url.pathname + url.search + url.hash;
    share.dataset.shareUrl = url.href;
  }

  function syncRangeButtons(range) {
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.range) === range);
      button.setAttribute(
        "aria-pressed",
        Number(button.dataset.range) === range ? "true" : "false"
      );
    });
  }

  function render(history, current, code, range) {
    const message = document.getElementById("history-message");
    const stats = document.getElementById("history-stats");
    const chartCard = document.getElementById("chart-card");
    const table = document.getElementById("history-table");
    const rows = document.getElementById("history-rows");
    const pagination = document.getElementById("history-pagination");
    const prevBtn = document.getElementById("history-prev");
    const nextBtn = document.getElementById("history-next");
    const pageLabel = document.getElementById("history-page-label");

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
      pagination.hidden = true;
      return;
    }
    message.hidden = true;

    const last = series[series.length - 1];
    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const recent = series.slice(-range);
    const rFirst = recent[0];
    const change1d = prev ? ((last.value - prev.value) / prev.value) * 100 : null;
    const changeN =
      recent.length >= 2
        ? ((last.value - rFirst.value) / rFirst.value) * 100
        : null;

    // The "current" stat reflects what the home dashboard shows (api/v1/rate.json),
    // not the last entry in the history series.
    const currentValue =
      current && typeof current[code] === "number" ? current[code] : last.value;
    document.getElementById("stat-current").textContent =
      fmtRate(currentValue) + " Bs.";

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
    syncRangeButtons(range);
    updateShareLink(code, range);

    const reversed = series.slice().reverse();
    const totalPages = Math.max(1, Math.ceil(reversed.length / PAGE_SIZE));
    tablePage = Math.min(Math.max(1, tablePage), totalPages);

    function renderTablePage() {
      const start = (tablePage - 1) * PAGE_SIZE;
      const pageRows = reversed.slice(start, start + PAGE_SIZE);
      rows.innerHTML = "";
      for (let i = 0; i < pageRows.length; i++) {
        const d = pageRows[i];
        const next = reversed[start + i + 1];
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

      prevBtn.disabled = tablePage <= 1;
      nextBtn.disabled = tablePage >= totalPages;
      pageLabel.textContent = STRINGS.page_label
        .replace("%{page}", tablePage)
        .replace("%{pages}", totalPages);
    }

    prevBtn.onclick = () => {
      if (tablePage <= 1) return;
      tablePage -= 1;
      renderTablePage();
    };
    nextBtn.onclick = () => {
      if (tablePage >= totalPages) return;
      tablePage += 1;
      renderTablePage();
    };

    renderTablePage();
    table.hidden = false;
    pagination.hidden = reversed.length <= PAGE_SIZE;
  }

  async function load() {
    const select = document.getElementById("history-currency");
    fillSelect(select, readQueryCurrency());
    activeRange = readQueryRange();

    let history = [];
    let current = null;
    try {
      const [historyData, rateData] = await Promise.all([
        fetch(bust(HISTORY_URL), { cache: "no-store" }).then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        }),
        fetch(bust(RATE_URL), { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      history = historyData;
      current = rateData;
    } catch (err) {
      const msg = document.getElementById("history-message");
      msg.textContent = STRINGS.error + " " + err.message;
      msg.hidden = false;
      return;
    }

    render(history, current, select.value, activeRange);

    select.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("c", select.value);
      url.searchParams.set("range", activeRange);
      window.history.replaceState({}, "", url);
      tablePage = 1;
      render(history, current, select.value, activeRange);
    });

    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        activeRange = Number(button.dataset.range);
        const url = new URL(location.href);
        url.searchParams.set("c", select.value);
        url.searchParams.set("range", activeRange);
        window.history.replaceState({}, "", url);
        tablePage = 1;
        render(history, current, select.value, activeRange);
      });
    });
  }

  load();
})();
