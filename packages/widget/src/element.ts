// The <bcv-rate> custom element. Markup is built with DOM APIs (no HTML parsing), so the widget also
// works on pages that enforce Trusted Types.
import { DEFAULT_API, type Store, subscribe } from "./data.ts";
import { formatDate, formatNumber, type Lang, parseAmount, STRINGS, toCurrency, toLang } from "./format.ts";
import css from "./style.css?text";

type Kid = Node | string | false | undefined;
type Strings = (typeof STRINGS)[Lang];

const SITE = "https://bcv.today";

function h(tag: string, attrs?: Record<string, string> | null, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag);
  for (const k in attrs) el.setAttribute(k, attrs[k] as string);
  return put(el, ...kids);
}

/** Append the truthy children (absent optional parts are `false` or `undefined`). */
function put<E extends Element>(el: E, ...kids: Kid[]): E {
  el.append(...(kids.filter((k) => k !== false && k !== undefined) as (Node | string)[]));
  return el;
}

function svg(tag: string, attrs: Record<string, string | number>, ...kids: Node[]): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  el.append(...kids);
  return el;
}

/** The bcv.today logo as a tiny decorative mark; its gold follows --bcv-accent. */
function mark(): SVGElement {
  return svg(
    "svg",
    { viewBox: "0 0 64 64", "aria-hidden": "true", part: "mark" },
    svg("rect", { width: 64, height: 64, fill: "#17402b" }),
    svg("path", { fill: "#2e7d4f", d: "M0 50c10-3 16-9 24-11s10-4 14-9l5-11 6 9 6-13 9 8v41H0z" }),
    svg("path", {
      class: "gold",
      fill: "none",
      "stroke-width": 5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      d: "M0 50c10-3 16-9 24-11s10-4 14-9l5-11 6 9 6-13",
    }),
    svg("circle", { class: "gold", cx: 55, cy: 15, r: 6 }),
  );
}

// globalThis.HTMLElement is missing during server-side rendering and in Node: importing the module there
// must not throw (the element is simply not defined).
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

/** One constructable stylesheet shared by every instance (not subject to CSP style-src); built lazily. */
let sheet: CSSStyleSheet | undefined;

/**
 * `<bcv-rate>`: the official Banco Central de Venezuela exchange rate from https://bcv.today.
 *
 * Attributes: `currency` (USD, EUR, CNY, TRY, RUB), `variant` (card, line, converter), `lang` (es, en),
 * `theme` (auto, light, dark), `amount` (converter), `hide-source`, `api` (data origin).
 */
export class BcvRate extends Base {
  static observedAttributes = ["currency", "variant", "lang", "amount", "hide-source", "api"];

  #root: ShadowRoot;
  /** Fallback <style> for browsers without constructable stylesheets. */
  #style: Node[] = [];
  #store?: Store;
  #unsubscribe?: () => void;
  /** What the user typed in the converter (survives re-renders). */
  #typed?: string;
  #input?: HTMLInputElement;
  #output?: HTMLElement;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
      }
      this.#root.adoptedStyleSheets = [sheet];
    } catch {
      sheet = undefined;
      this.#style = [h("style", null, css)];
    }
  }

  connectedCallback(): void {
    this.#connect();
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (old === value) return;
    if (name === "amount") this.#typed = undefined;
    if (name === "api" && this.#unsubscribe) {
      this.disconnectedCallback();
      this.#store = undefined;
      this.#connect();
    } else if (this.isConnected) {
      this.#render();
    }
  }

  #connect(): void {
    this.#unsubscribe ??= subscribe((this.getAttribute("api") || DEFAULT_API).replace(/\/+$/, ""), (store) => {
      this.#store = store;
      this.#render();
    });
    if (!this.#store) this.#render();
  }

  #render(): void {
    const lang = toLang(this.closest("[lang]")?.getAttribute("lang"));
    const t = STRINGS[lang];
    const currency = toCurrency(this.getAttribute("currency"));
    const variant = this.getAttribute("variant");
    const line = variant === "line";
    const converter = variant === "converter";
    const name = `${t.names[currency]} (${currency})`;
    const view = this.#store?.view;
    const rate = view?.rates[currency];
    const hadFocus = !!this.#input && this.#root.activeElement === this.#input;
    const selection = hadFocus ? [this.#input?.selectionStart ?? 0, this.#input?.selectionEnd ?? 0] : undefined;
    this.#input = this.#output = undefined;

    const box = h(line ? "span" : "div", {
      class: line ? "box line" : "box",
      part: "container",
      role: "group",
      lang,
      "aria-label": converter ? `${t.converter}: ${name} ${t.toVes}` : `${t.rate}: ${name}`,
    });

    if (typeof rate !== "number" || !view) {
      const failed = !!view || !!this.#store?.error;
      box.setAttribute("aria-busy", String(!failed));
      put(
        box,
        mark(),
        line ? " " : "",
        h("span", { class: failed ? "err" : "", part: "status" }, failed ? t.error : t.loading),
      );
      this.#root.replaceChildren(...this.#style, box);
      return;
    }

    const { rates, previous, cached } = view;
    const prev = previous?.[currency];
    const value = formatNumber(rate, lang, 4);
    const date = formatDate(rates.effective_date, lang);
    const stamp = h(
      "span",
      { class: "stamp", part: "date" },
      line ? h("span", { class: "sr" }, `${t.effective} `) : `${t.effective} `,
      h("b", null, date),
    );
    const change = typeof prev === "number" && prev > 0 && changeNode(rate, prev, lang, t, line);
    const source = !this.hasAttribute("hide-source") && sourceLink(t, line);
    const note = cached && h("span", { class: "note", part: "note" }, line ? `(${t.cached})` : t.cached);

    if (line) {
      // Spaces between the pieces keep the text readable when copied or read by a screen reader.
      const kids = [
        mark(),
        h("span", null, currency),
        h("span", { class: "num", part: "value" }, value),
        h("span", { class: "unit" }, "Bs."),
        change,
        stamp,
        note,
        source,
      ];
      box.append(...kids.flatMap((k) => (k ? [k, " "] : [])).slice(0, -1));
    } else if (converter) {
      const input = h("input", {
        id: "amount",
        part: "input",
        inputmode: "decimal",
        autocomplete: "off",
        spellcheck: "false",
      }) as HTMLInputElement;
      const attr = this.getAttribute("amount");
      input.value = this.#typed ?? (attr ? (lang === "es" ? attr.replace(".", ",") : attr) : "1");
      const output = h("output", { for: "amount", part: "result", "aria-live": "polite" });
      this.#input = input;
      this.#output = output;
      input.addEventListener("input", () => {
        this.#typed = input.value;
        this.#convert(rate, lang, t);
      });
      put(
        box,
        h("div", { class: "head", part: "label" }, mark(), `${t.names[currency]} · ${currency} → Bs.`),
        h("label", { for: "amount" }, `${t.amount} ${currency}`),
        h("div", { class: "row" }, input, h("span", { class: "unit" }, currency)),
        output,
        h(
          "div",
          { class: "foot" },
          h("span", { class: "num", part: "value" }, `1 ${currency} = ${value} Bs.`),
          stamp,
          change,
        ),
        note,
        source,
      );
      this.#convert(rate, lang, t);
    } else {
      put(
        box,
        h("div", { class: "head", part: "label" }, mark(), `${t.names[currency]} · ${currency}`),
        h(
          "p",
          { class: "value", part: "value" },
          h("span", { class: "num" }, value),
          " ",
          h("span", { class: "unit" }, "Bs."),
        ),
        h("div", { class: "foot" }, change, stamp),
        note,
        source,
      );
    }

    this.#root.replaceChildren(...this.#style, box);
    if (hadFocus && this.#input && selection) {
      this.#input.focus();
      this.#input.setSelectionRange(selection[0] as number, selection[1] as number);
    }
  }

  #convert(rate: number, lang: Lang, t: Strings): void {
    const input = this.#input;
    const output = this.#output;
    if (!input || !output) return;
    const raw = input.value.trim();
    const amount = parseAmount(raw, lang);
    const bad = raw !== "" && !Number.isFinite(amount);
    input.setAttribute("aria-invalid", String(bad));
    output.className = bad ? "err" : "";
    output.textContent = bad ? t.invalid : raw ? `${formatNumber(amount * rate, lang, 2)} Bs.` : "–";
  }
}

function changeNode(rate: number, prev: number, lang: Lang, t: Strings, short: boolean): HTMLElement {
  const diff = rate - prev;
  const pct = `${formatNumber((diff / prev) * 100, lang, 2, true)}${lang === "es" ? "\u00a0%" : "%"}`;
  return h(
    "span",
    { class: `chg ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`, part: "change" },
    h("span", { class: "sr" }, `${t.change} `),
    h("span", { "aria-hidden": "true" }, diff > 0 ? "▲\u00a0" : diff < 0 ? "▼\u00a0" : "=\u00a0"),
    short ? pct : `${formatNumber(diff, lang, 4, true)} (${pct})`,
  );
}

function sourceLink(t: Strings, short: boolean): HTMLElement {
  const link = h(
    "a",
    { class: short ? "src" : "", href: SITE, target: "_blank", rel: "noopener", part: "source" },
    "BCV Today",
  );
  return short ? link : h("span", { class: "src" }, `${t.source} `, link);
}
