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
    const SVG_NS = "http://www.w3.org/2000/svg";

    // Build markup with DOM APIs, never by parsing HTML strings.
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

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

    // Plain numeric string for <input type="number">: 2 decimals max, no locale separators.
    const numForInput = (n) => (isFinite(n) ? n.toFixed(2) : "");

    const fmtDateTime = (iso) =>
        new Intl.DateTimeFormat(LOCALE, {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "America/Caracas",
        }).format(new Date(iso));

    const fmtDate = (iso) =>
        new Intl.DateTimeFormat(LOCALE, {dateStyle: "long"}).format(
            new Date(iso + "T12:00:00")
        );

    const bust = (url) =>
        url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();

    function sparklineSvg(values) {
        if (!values || values.length < 2) return null;
        const w = 100;
        const h = 28;
        const pad = 2;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const dx = (w - pad * 2) / (values.length - 1);
        const points = values
            .map((v, i) => {
                const x = pad + i * dx;
                const y = pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2);
                return x.toFixed(2) + "," + y.toFixed(2);
            })
            .join(" ");
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "spark");
        svg.setAttribute("viewBox", "0 0 " + w + " " + h);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("aria-hidden", "true");
        const line = document.createElementNS(SVG_NS, "polyline");
        const attrs = {
            points,
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1.5",
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
        };
        for (const name in attrs) line.setAttribute(name, attrs[name]);
        svg.append(line);
        return svg;
    }

    function todayCaracas() {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Caracas",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
    }

    function lastValuesFor(history, code, n) {
        const today = todayCaracas();
        const out = [];
        for (const entry of history) {
            if (entry.date && entry.date > today) continue;
            if (typeof entry[code] === "number") out.push(entry[code]);
        }
        return out.slice(-n);
    }

    function renderCards(data, history) {
        const grid = document.getElementById("grid");
        grid.textContent = "";
        for (const code of FOREIGN_CODES) {
            if (typeof data[code] !== "number") continue;
            const series = lastValuesFor(history, code, SPARK_WINDOW);
            const foot = el("div", "card-foot");
            if (series.length >= 2) {
                const first = series[0];
                const last = series[series.length - 1];
                const change = ((last - first) / first) * 100;
                const changeEl = el("span", "change " + (change >= 0 ? "up" : "down"), fmtPct(change));
                changeEl.title = STRINGS.variation + " (" + series.length + "d)";
                foot.append(sparklineSvg(series), changeEl);
            } else {
                foot.append(el("span", "muted", STRINGS.no_history));
            }
            const href =
                (window.CURRENCY_PAGE_URLS && window.CURRENCY_PAGE_URLS[code]) ||
                HISTORY_PAGE_URL;
            const card = el("a", "card");
            card.href = href;

            const icon = el("div", "curr-icon", symbolFor(code));
            icon.dataset.code = code;
            const title = el("div", "card-title");
            title.append(el("div", "code", code), el("div", "name", CURRENCY_NAMES[code]));
            const head = el("div", "card-head");
            head.append(icon, title);

            const value = el("div", "value", fmtRate(data[code]));
            value.append(el("span", "unit", "Bs."));

            card.append(head, value, foot);
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
            sel.textContent = "";
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
        const res = await fetch(bust(url), {cache: "no-store"});
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    }

    function scheduleBackground(fn) {
        const run = () => {
            if ("requestIdleCallback" in window) {
                window.requestIdleCallback(fn, {timeout: 2000});
            } else {
                window.setTimeout(fn, 0);
            }
        };
        if (document.readyState === "complete") {
            run();
        } else {
            window.addEventListener("load", run, {once: true});
        }
    }

    function renderMetaAndStatus(rate) {
        const effective = rate.effective_date || rate.date;
        const status = document.getElementById("api-status");
        if (status) {
            const complete = FOREIGN_CODES.every((code) => typeof rate[code] === "number");
            const labelled = (label, valueText) => {
                const span = el("span", null, label + " ");
                span.append(el("strong", null, valueText));
                return span;
            };
            const link = el("a", null, STRINGS.apiLabel);
            link.href = API_PAGE_URL;
            status.replaceChildren(
                el("span", "status-pill " + (complete ? "ok" : "partial"),
                    complete ? STRINGS.statusOk : STRINGS.statusPartial),
                labelled(STRINGS.effective, fmtDate(effective)),
                labelled(STRINGS.scraped, fmtDateTime(rate.updated_at)),
                link
            );
        }
    }

    function showError(err) {
        const grid = document.getElementById("grid");
        grid.textContent = "";
        const error = document.createElement("div");
        error.className = "error";
        error.textContent = STRINGS.error + " " + err.message;
        grid.appendChild(error);
    }

    async function refreshDashboard(showErrors) {
        try {
            const rate = await fetchJson(RATE_URL);
            renderMetaAndStatus(rate);
            const history = await fetchJson(HISTORY_URL).catch(() => []);
            renderCards(rate, history);
            return rate;
        } catch (err) {
            if (showErrors) showError(err);
            return null;
        }
    }

    function load() {
        const initialRate =
            typeof INITIAL_RATE === "object" && INITIAL_RATE ? INITIAL_RATE : null;
        if (initialRate) {
            setupCalculator(initialRate);
            scheduleBackground(() => refreshDashboard(false));
            return;
        }
        refreshDashboard(true).then((rate) => {
            if (rate) setupCalculator(rate);
        });
    }

    load();
})();
