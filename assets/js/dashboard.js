(function () {
    const FOREIGN_CODES = Object.keys(CURRENCY_NAMES).filter((c) => c !== "VES");
    const CHANGE_WINDOW = 20;
    const CURRENCY_SYMBOLS = {
        USD: "$",
        EUR: "€",
        CNY: "¥",
        TRY: "₺",
        RUB: "₽",
        VES: "Bs",
    };
    const symbolFor = (c) => CURRENCY_SYMBOLS[c] || c;
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

    // "18 de noviembre de 2026, 22:01" in Caracas time. Composed by hand so it
    // matches the server-rendered string (_includes/date.html) in every browser.
    const fmtDateTime = (iso) => {
        const p = {};
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Caracas",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(iso)).forEach((part) => (p[part.type] = part.value));
        return fmtDate(p.year + "-" + p.month + "-" + p.day) + ", " + p.hour + ":" + p.minute;
    };

    const fmtDate = (iso) =>
        new Intl.DateTimeFormat(LOCALE, {dateStyle: "long"}).format(
            new Date(iso + "T12:00:00")
        );

    const bust = (url) =>
        url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();

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

    // Home backdrop: the last 12 months of USD, drawn faint behind the hero
    // so the glass header has real data to refract. It ends a little short of
    // the right edge in a gold dot, today's value (the logo's idea: the ridge
    // is the rate chart and the dot is today). The box has a fixed size, so
    // drawing it late never shifts the layout; an unchanged series is not
    // redrawn, which would only make liquidGL recapture the page.
    function renderBackdrop(history) {
        const svg = document.getElementById("backdrop-chart");
        if (!svg) return;
        const values = lastValuesFor(history, "USD", 365);
        if (values.length < 2) return;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const top = 60;
        const bottom = 380;
        const end = 980;
        const dx = end / (values.length - 1);
        const pts = values.map((v, i) =>
            (i * dx).toFixed(1) + "," + (bottom - ((v - min) / range) * (bottom - top)).toFixed(1));
        const points = pts.join(" ");
        if (svg.dataset.points === points) return;
        svg.dataset.points = points;
        const ns = "http://www.w3.org/2000/svg";
        const shape = (tag, cls, attr, value) => {
            const node = document.createElementNS(ns, tag);
            node.setAttribute("class", cls);
            node.setAttribute(attr, value);
            return node;
        };
        const today = "M" + pts[pts.length - 1] + "h0";
        svg.replaceChildren(
            shape("polygon", "bd-area", "points", "0,400 " + points + " " + end + ",400"),
            shape("polyline", "bd-line", "points", points),
            shape("path", "bd-halo", "d", today),
            shape("path", "bd-dot", "d", today)
        );
    }

    function renderCards(data, history) {
        const grid = document.getElementById("grid");
        grid.textContent = "";
        for (const code of FOREIGN_CODES) {
            if (typeof data[code] !== "number") continue;
            const series = lastValuesFor(history, code, CHANGE_WINDOW);
            const foot = el("div", "card-foot");
            if (series.length >= 2) {
                const first = series[0];
                const last = series[series.length - 1];
                const change = ((last - first) / first) * 100;
                // A change always says what it compares to.
                foot.append(
                    el("span", "change" + (change > 0 ? " up" : change < 0 ? " down" : ""), fmtPct(change)),
                    el("span", null, STRINGS.changeRef.replace("%{n}", series.length))
                );
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
            const stamp = el("span", "stamp", STRINGS.stampLabel + " ");
            stamp.append(el("b", null, fmtDate(effective)));
            stamp.title = STRINGS.scraped + " " + fmtDateTime(rate.updated_at) + " " + STRINGS.zone;
            // Quiet when all is well; the pill only shows up when rates are missing.
            const parts = complete ? [stamp] : [el("span", "status-pill partial", STRINGS.statusPartial), stamp];
            status.replaceChildren(...parts);
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
            renderBackdrop(history);
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
