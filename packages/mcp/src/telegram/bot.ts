// Telegram bot @BCVTodayBot and the daily post on the @bcvtoday channel.
//
// Runs in the same Worker as the MCP server and the A2A agent and reuses their
// logic: the shared tools (js/src via ../tools.js) for numbers and the A2A text
// parser for free-form questions ("100 dólares en bolívares", "tasa del 2 de
// enero"). Telegram talks to us through a webhook (POST /telegram, verified with
// the secret token header); the daily notice runs from the Worker's cron trigger.
//
// Storage (Workers KV, binding TELEGRAM_KV):
//   sub:<chat_id>  -> {"lang":"es"|"en","since":"<ISO date>"}   daily subscribers
//   announced      -> "<YYYY-MM-DD>"                           last effective date posted
// Only the chat id and language are stored, and /cancelar deletes them.
import { parseText, respond, type Intent, type Lang } from "../a2a/agent.js";
import { CURRENCIES, type Currency, DataClient, NotFoundError, type RateEntry, addDays, rateOf, todayCaracas } from "../data.js";
import { convert, history } from "../tools.js";

export interface Telegram {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
}

export interface BotDeps {
  data: DataClient;
  telegram: Telegram;
  kv: KVNamespace;
  channel: string;
  site: string;
}

// ---------------------------------------------------------------- formatting

const NAMES: Record<Currency, { es: string; en: string; es_page: string; en_page: string }> = {
  USD: { es: "Dólar", en: "US dollar", es_page: "/dolar-bcv/", en_page: "/en/bcv-dollar/" },
  EUR: { es: "Euro", en: "Euro", es_page: "/euro-bcv/", en_page: "/en/bcv-euro/" },
  CNY: { es: "Yuan", en: "Yuan", es_page: "/yuan-bcv/", en_page: "/en/bcv-yuan/" },
  TRY: { es: "Lira turca", en: "Turkish lira", es_page: "/lira-bcv/", en_page: "/en/bcv-lira/" },
  RUB: { es: "Rublo", en: "Ruble", es_page: "/rublo-bcv/", en_page: "/en/bcv-ruble/" },
};
const WEEKDAYS = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function num(lang: Lang, v: number, digits = 4, min = 2): string {
  return v.toLocaleString(lang === "es" ? "es-VE" : "en-US", { maximumFractionDigits: digits, minimumFractionDigits: min });
}

export function pct(lang: Lang, cur: number, prev: number): string {
  const p = ((cur - prev) / prev) * 100;
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return `${sign}${num(lang, Math.abs(p), 2, 2)} %`;
}

export function day(lang: Lang, iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = WEEKDAYS[lang][d.getUTCDay()];
  const [y, m, dd] = iso.split("-");
  return lang === "es" ? `${wd} ${dd}/${m}/${y}` : `${wd}, ${iso}`;
}

function money(lang: Lang, v: number, cur: string): string {
  return cur === "VES" ? `${num(lang, v, 2)} Bs.` : `${num(lang, v, 2)} ${cur}`;
}

const eff = (e: RateEntry) => e.effective_date ?? e.date;

// ---------------------------------------------------------------- data

export interface Snapshot {
  current: RateEntry;
  previous?: RateEntry;
  /** Rate already published by the BCV for a later effective date (afternoon publication). */
  next?: RateEntry;
}

async function dayOrUndefined(data: DataClient, date: string): Promise<RateEntry | undefined> {
  try {
    return await data.day(date);
  } catch (err) {
    if (err instanceof NotFoundError) return undefined;
    throw err;
  }
}

/** Current rate, the one before it and, when already published, the next one. Uses small day files only. */
export async function snapshot(data: DataClient, now = Date.now()): Promise<Snapshot> {
  const current = await data.latest();
  const ce = eff(current);
  const today = todayCaracas(now);
  let next: RateEntry | undefined;
  for (let k = 1; k <= 4 && !next; k++) {
    const e = await dayOrUndefined(data, addDays(today, k));
    if (e && eff(e) > ce) next = e;
  }
  let previous: RateEntry | undefined;
  for (let k = 1; k <= 6 && !previous; k++) {
    const e = await dayOrUndefined(data, addDays(ce, -k));
    if (e && eff(e) < ce) previous = e;
  }
  return { current, ...(previous ? { previous } : {}), ...(next ? { next } : {}) };
}

// ---------------------------------------------------------------- replies

export function helpText(lang: Lang): string {
  if (lang === "en") {
    return [
      "<b>BCV Today</b> · official Banco Central de Venezuela rates",
      "",
      "/dollar · /euro · /yuan · /lira · /ruble  today's rate",
      "/rates  all five currencies",
      "/convert 100 usd  ·  /convert 50000 bs eur",
      "/history usd 7  the last days",
      "/subscribe  a message every business day when the BCV publishes the dollar rate",
      "/unsubscribe  stop the daily message",
      "",
      "You can also just write: <i>100 dollars in bolivars</i>, <i>rate on 2026-01-02</i>.",
      "In any chat: <code>@BCVTodayBot 100 usd</code>",
      "Daily channel: @bcvtoday",
      "",
      "Source: bcv.today · Unofficial project, not affiliated with the BCV.",
    ].join("\n");
  }
  return [
    "<b>BCV Today</b> · tasas oficiales del Banco Central de Venezuela",
    "",
    "/dolar · /euro · /yuan · /lira · /rublo  la tasa de hoy",
    "/tasas  las cinco monedas",
    "/convertir 100 usd  ·  /convertir 50000 bs eur",
    "/historial usd 7  los últimos días",
    "/suscribir  un mensaje cada día hábil cuando el BCV publique la tasa del dólar",
    "/cancelar  dejar de recibir el mensaje",
    "",
    "También puedes escribir como hablas: <i>100 dólares en bolívares</i>, <i>tasa del 2 de enero</i>.",
    "En cualquier chat: <code>@BCVTodayBot 100 usd</code>",
    "Canal con la tasa diaria: @bcvtoday",
    "",
    "Fuente: bcv.today · Proyecto no oficial, sin relación con el BCV.",
  ].join("\n");
}

export function rateText(lang: Lang, c: Currency, s: Snapshot, site: string): string {
  const v = rateOf(s.current, c);
  const name = NAMES[c][lang];
  if (v === undefined) return lang === "es" ? `No hay tasa publicada para ${c}.` : `There is no published rate for ${c}.`;
  const lines = [`<b>${name} BCV</b>`, `<b>${num(lang, v)} Bs.</b>`];
  lines.push(lang === "es" ? `Fecha valor: ${day(lang, eff(s.current))}` : `Effective: ${day(lang, eff(s.current))}`);
  const pv = s.previous ? rateOf(s.previous, c) : undefined;
  if (pv) lines.push(lang === "es" ? `Variación: ${pct(lang, v, pv)} frente a la tasa anterior` : `Change: ${pct(lang, v, pv)} from the previous rate`);
  const nv = s.next ? rateOf(s.next, c) : undefined;
  if (s.next && nv) {
    lines.push(
      "",
      lang === "es"
        ? `Próxima tasa, ya publicada (fecha valor ${day(lang, eff(s.next))}): <b>${num(lang, nv)} Bs.</b> (${pct(lang, nv, v)})`
        : `Next rate, already published (effective ${day(lang, eff(s.next))}): <b>${num(lang, nv)} Bs.</b> (${pct(lang, nv, v)})`,
    );
  }
  lines.push("", `${site.replace(/^https?:\/\//, "")}${lang === "es" ? NAMES[c].es_page : NAMES[c].en_page}`);
  return lines.join("\n");
}

export function allRatesText(lang: Lang, s: Snapshot, site: string): string {
  const head = lang === "es" ? `<b>Tasas oficiales BCV</b> · fecha valor ${day(lang, eff(s.current))}` : `<b>Official BCV rates</b> · effective ${day(lang, eff(s.current))}`;
  const rows = CURRENCIES.map((c) => {
    const v = rateOf(s.current, c);
    if (v === undefined) return undefined;
    const pv = s.previous ? rateOf(s.previous, c) : undefined;
    return `${c}  <b>${num(lang, v)}</b> Bs.${pv ? `  ${pct(lang, v, pv)}` : ""}`;
  }).filter(Boolean);
  const out = [head, "", ...(rows as string[])];
  if (s.next) {
    out.push("", lang === "es" ? `Ya hay tasa publicada para el ${day(lang, eff(s.next))}: /dolar la muestra.` : `A rate for ${day(lang, eff(s.next))} is already published: /dollar shows it.`);
  }
  out.push("", site.replace(/^https?:\/\//, ""));
  return out.join("\n");
}

export function announcementText(lang: Lang, next: RateEntry, previous: RateEntry | undefined, site: string): string {
  const v = rateOf(next, "USD")!;
  const pv = previous ? rateOf(previous, "USD") : undefined;
  const change = pv ? ` (${pct(lang, v, pv)})` : "";
  return lang === "es"
    ? [`<b>Nueva tasa BCV</b>`, `Dólar: <b>${num(lang, v)} Bs.</b>${change}`, `Fecha valor: ${day(lang, eff(next))}`, "", `${site.replace(/^https?:\/\//, "")}/dolar-bcv/`].join("\n")
    : [`<b>New BCV rate</b>`, `Dollar: <b>${num(lang, v)} Bs.</b>${change}`, `Effective: ${day(lang, eff(next))}`, "", `${site.replace(/^https?:\/\//, "")}/en/bcv-dollar/`].join("\n");
}

function convertUsage(lang: Lang): string {
  return lang === "es"
    ? "Escribe el monto y las monedas, por ejemplo:\n/convertir 100 usd\n/convertir 50000 bs eur\n/convertir 20 eur usd"
    : "Write the amount and currencies, for example:\n/convert 100 usd\n/convert 50000 bs eur\n/convert 20 eur usd";
}

async function convertText(deps: BotDeps, lang: Lang, args: { amount: number; from: string; to: string; date?: string }): Promise<string> {
  if (args.from === args.to) return lang === "es" ? "Indica dos monedas distintas, por ejemplo: /convertir 100 usd eur" : "Name two different currencies, for example: /convert 100 usd eur";
  const r = await convert(deps.data, args as never);
  if (!r.ok) return lang === "es" ? `No pude convertir: ${esc(r.message)}` : `I couldn't convert: ${esc(r.message)}`;
  const d = r.data as Record<string, any>;
  const lines = [
    `${money(lang, d.amount, d.from)} = <b>${money(lang, d.result, d.to)}</b>`,
    lang === "es"
      ? `Tasa BCV: 1 ${d.from === "VES" ? "Bs." : d.from} = ${num(lang, d.rate, 6, 2)} ${d.to === "VES" ? "Bs." : d.to} · fecha valor ${day(lang, d.effective_date)}`
      : `BCV rate: 1 ${d.from === "VES" ? "Bs." : d.from} = ${num(lang, d.rate, 6, 2)} ${d.to === "VES" ? "Bs." : d.to} · effective ${day(lang, d.effective_date)}`,
  ];
  if (d.note) lines.push(lang === "es" ? `Para el ${day(lang, d.date)} rige la última tasa publicada.` : `On ${day(lang, d.date)} the last published rate applies.`);
  return lines.join("\n");
}

const CMD_CURRENCY: Record<string, Currency> = {
  dolar: "USD", dollar: "USD", usd: "USD",
  euro: "EUR", eur: "EUR",
  yuan: "CNY", cny: "CNY",
  lira: "TRY", try: "TRY",
  rublo: "RUB", ruble: "RUB", rub: "RUB",
};
const TOKEN_CURRENCY: Record<string, Currency> = { ...CMD_CURRENCY, dolares: "USD", dólar: "USD", dólares: "USD", dollars: "USD", euros: "EUR", yuanes: "CNY", liras: "TRY", rublos: "RUB", rubles: "RUB" };

async function historyText(deps: BotDeps, lang: Lang, rest: string): Promise<string> {
  let currency: Currency = "USD";
  let days = 7;
  for (const tok of rest.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (TOKEN_CURRENCY[tok]) currency = TOKEN_CURRENCY[tok]!;
    else if (/^\d{1,3}$/.test(tok)) days = Math.min(Math.max(Number(tok), 2), 31);
  }
  const r = await history(deps.data, { currency, days });
  if (!r.ok) return lang === "es" ? `No pude leer el historial: ${esc(r.message)}` : `I couldn't read the history: ${esc(r.message)}`;
  const d = r.data as Record<string, any>;
  const series = d.series as { date: string; rate: number }[];
  const rows = series
    .slice()
    .reverse()
    .map((p, i, arr) => {
      const prev = arr[i + 1];
      const [, m, dd] = p.date.split("-");
      const ch = prev ? pct(lang, p.rate, prev.rate) : "";
      return `${lang === "es" ? `${dd}/${m}` : `${m}/${dd}`}  ${num(lang, p.rate).padStart(12)}  ${ch}`;
    });
  const head = lang === "es" ? `<b>${NAMES[currency].es} BCV</b> · últimos ${series.length} días (${pct(lang, d.last.rate, d.first.rate)})` : `<b>${NAMES[currency].en} BCV</b> · last ${series.length} days (${pct(lang, d.last.rate, d.first.rate)})`;
  return `${head}\n<pre>${rows.join("\n")}</pre>`;
}

/** Reply text for a private message. Exported for tests. */
export async function replyTo(deps: BotDeps, text: string, lang: Lang, chatId: number): Promise<string> {
  const t = text.trim();
  if (t.startsWith("/")) {
    const [rawCmd = "", ...restParts] = t.split(/\s+/);
    const cmd = rawCmd.slice(1).replace(/@.*$/, "").toLowerCase();
    const rest = restParts.join(" ");
    if (cmd === "start" || cmd === "ayuda" || cmd === "help") return helpText(lang);
    if (CMD_CURRENCY[cmd]) return rateText(lang, CMD_CURRENCY[cmd]!, await snapshot(deps.data), deps.site);
    if (cmd === "tasas" || cmd === "rates" || cmd === "todas") return allRatesText(lang, await snapshot(deps.data), deps.site);
    if (cmd === "convertir" || cmd === "convert") {
      if (!rest) return convertUsage(lang);
      const intent = parseText(`${lang === "es" ? "convertir" : "convert"} ${rest}`, lang);
      if (!intent || intent.skill !== "convert") return convertUsage(lang);
      return convertText(deps, lang, intent.args);
    }
    if (cmd === "historial" || cmd === "history") return historyText(deps, lang, rest);
    if (cmd === "suscribir" || cmd === "subscribe") {
      await deps.kv.put(`sub:${chatId}`, JSON.stringify({ lang, since: new Date().toISOString().slice(0, 10) }));
      return lang === "es"
        ? "Listo. Te escribo cada día hábil cuando el BCV publique la nueva tasa del dólar (normalmente entre las 4:30 y las 6:00 p. m.).\nSolo guardo el número de este chat. Para dejar de recibirla: /cancelar"
        : "Done. I'll message you every business day when the BCV publishes the new dollar rate (usually 4:30–6:00 p.m. Caracas time).\nI only store this chat's id. To stop: /unsubscribe";
    }
    if (cmd === "cancelar" || cmd === "unsubscribe" || cmd === "stop") {
      await deps.kv.delete(`sub:${chatId}`);
      return lang === "es" ? "Listo, ya no recibirás el mensaje diario. Puedes volver con /suscribir." : "Done, you won't get the daily message any more. Come back with /subscribe.";
    }
    if (cmd === "canal" || cmd === "channel") return lang === "es" ? `La tasa del dólar cada día hábil: ${deps.channel}` : `The dollar rate every business day: ${deps.channel}`;
    return (lang === "es" ? "No conozco ese comando.\n\n" : "I don't know that command.\n\n") + helpText(lang);
  }
  // Free text: the A2A agent understands Spanish and English questions.
  const intent = parseText(t, lang);
  if (intent?.skill === "convert") return convertText(deps, lang, intent.args);
  if (intent?.skill === "latest-rates") {
    const s = await snapshot(deps.data);
    return intent.args.currency ? rateText(lang, intent.args.currency, s, deps.site) : allRatesText(lang, s, deps.site);
  }
  const reply = await respond(deps.data, { text: t, data: [], langHint: lang });
  if (reply.data?.type === "help") return (lang === "es" ? "No entendí la pregunta.\n\n" : "I didn't understand the question.\n\n") + helpText(lang);
  return esc(reply.text);
}

// ---------------------------------------------------------------- inline mode

interface InlineResult {
  type: "article";
  id: string;
  title: string;
  description: string;
  input_message_content: { message_text: string; parse_mode: "HTML"; link_preview_options: { is_disabled: true } };
}

const article = (id: string, title: string, description: string, html: string): InlineResult => ({
  type: "article",
  id,
  title,
  description,
  input_message_content: { message_text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } },
});

const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export async function inlineResults(deps: BotDeps, query: string, lang: Lang): Promise<InlineResult[]> {
  const q = query.trim();
  const intent: Intent | undefined = q ? parseText(/^\d/.test(q) ? `${lang === "es" ? "convertir" : "convert"} ${q}` : q, lang) : undefined;
  if (intent?.skill === "convert") {
    const html = await convertText(deps, lang, intent.args);
    const [first, second] = plain(html).split("\n");
    return [article(`c:${q}`.slice(0, 64), first ?? q, second ?? "", `${html}\n${deps.site.replace(/^https?:\/\//, "")}`)];
  }
  const s = await snapshot(deps.data);
  const focus = intent?.skill === "latest-rates" ? intent.args.currency : undefined;
  const list: Currency[] = focus ? [focus] : ["USD", "EUR"];
  const out = list.map((c) => {
    const v = rateOf(s.current, c) ?? 0;
    return article(`r:${c}:${eff(s.current)}`, `${NAMES[c][lang]} BCV: ${num(lang, v)} Bs.`, lang === "es" ? `Fecha valor ${day(lang, eff(s.current))}` : `Effective ${day(lang, eff(s.current))}`, rateText(lang, c, s, deps.site));
  });
  if (!focus) out.push(article(`all:${eff(s.current)}`, lang === "es" ? "Las cinco tasas BCV" : "All five BCV rates", "USD · EUR · CNY · TRY · RUB", allRatesText(lang, s, deps.site)));
  return out;
}

// ---------------------------------------------------------------- webhook

export interface Update {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: { language_code?: string } };
  inline_query?: { id: string; query: string; from?: { language_code?: string } };
  my_chat_member?: { chat: { id: number; type: string }; new_chat_member: { status: string } };
}

export const langOf = (code?: string): Lang => (code?.toLowerCase().startsWith("en") ? "en" : "es");

export async function handleUpdate(deps: BotDeps, u: Update): Promise<void> {
  if (u.message?.text && u.message.chat.type === "private") {
    const lang = langOf(u.message.from?.language_code);
    let text: string;
    try {
      text = await replyTo(deps, u.message.text, lang, u.message.chat.id);
    } catch (err) {
      console.error("telegram reply failed", err);
      text = lang === "es" ? "No pude consultar las tasas en este momento. Inténtalo de nuevo en unos minutos." : "I couldn't read the rates right now. Please try again in a few minutes.";
    }
    await deps.telegram.call("sendMessage", { chat_id: u.message.chat.id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return;
  }
  if (u.inline_query) {
    const lang = langOf(u.inline_query.from?.language_code);
    let results: InlineResult[] = [];
    try {
      results = await inlineResults(deps, u.inline_query.query, lang);
    } catch (err) {
      console.error("telegram inline failed", err);
    }
    await deps.telegram.call("answerInlineQuery", { inline_query_id: u.inline_query.id, results, cache_time: 300 });
    return;
  }
  // The user blocked the bot: forget the subscription.
  if (u.my_chat_member && u.my_chat_member.chat.type === "private" && u.my_chat_member.new_chat_member.status === "kicked") {
    await deps.kv.delete(`sub:${u.my_chat_member.chat.id}`);
  }
}

// ---------------------------------------------------------------- daily notice

export interface AnnounceResult {
  status: "initialized" | "unchanged" | "posted";
  effective_date?: string;
  subscribers?: number;
}

/** Posts a newly published dollar rate to the channel and to subscribers, once per effective date. */
export async function announce(deps: BotDeps, now = Date.now()): Promise<AnnounceResult> {
  const today = todayCaracas(now);
  let newest: RateEntry | undefined;
  for (let k = 0; k <= 4; k++) {
    const e = await dayOrUndefined(deps.data, addDays(today, k));
    if (e && (!newest || eff(e) > eff(newest))) newest = e;
  }
  if (!newest) return { status: "unchanged" };
  const ne = eff(newest);
  const stored = await deps.kv.get("announced");
  if (!stored) {
    // First run: remember the current rate without posting anything.
    await deps.kv.put("announced", ne);
    return { status: "initialized", effective_date: ne };
  }
  if (ne <= stored || rateOf(newest, "USD") === undefined) return { status: "unchanged", effective_date: stored };

  let previous: RateEntry | undefined;
  for (let k = 1; k <= 6 && !previous; k++) {
    const e = await dayOrUndefined(deps.data, addDays(ne, -k));
    if (e && eff(e) < ne) previous = e;
  }
  await deps.kv.put("announced", ne);
  await deps.telegram.call("sendMessage", { chat_id: deps.channel, text: announcementText("es", newest, previous, deps.site), parse_mode: "HTML", link_preview_options: { is_disabled: true } });

  let sent = 0;
  let cursor: string | undefined;
  do {
    const page = await deps.kv.list({ prefix: "sub:", ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const chatId = key.name.slice(4);
      const sub = (await deps.kv.get<{ lang?: Lang }>(key.name, "json")) ?? {};
      try {
        await deps.telegram.call("sendMessage", { chat_id: chatId, text: announcementText(sub.lang === "en" ? "en" : "es", newest, previous, deps.site), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
        sent++;
      } catch (err) {
        // 403: the user blocked the bot or deleted the chat.
        if (String(err).includes("403")) await deps.kv.delete(key.name);
        else console.error("telegram notice failed", chatId, err);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { status: "posted", effective_date: ne, subscribers: sent };
}

// ---------------------------------------------------------------- Telegram HTTP client

export function telegramClient(token: string): Telegram {
  return {
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
      if (!body.ok) throw new Error(`Telegram ${method} ${body.error_code ?? res.status}: ${body.description ?? "error"}`);
      return body.result as T;
    },
  };
}
