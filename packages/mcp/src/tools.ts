// Protocol layer of the BCV Today tools for the Worker: zod argument schemas.
//
// The tool implementations themselves (latestRates, rateByDate, history,
// convert, status) live in the npm package source, js/src/tools.ts, and are
// re-exported here. The MCP server (server.ts) and the A2A agent (a2a/agent.ts)
// run that same code, so every
// protocol returns the same numbers, notes and validation messages.
import * as z from "zod";
import { ARGS } from "./meta.js";
import { CURRENCIES } from "../../js/src/rules.js";
import { MAX_HISTORY_DAYS } from "../../js/src/tools.js";

export {
  MAX_HISTORY_DAYS,
  SOURCE,
  type ToolOutcome,
  UNIT,
  convert,
  fmt,
  history,
  latestRates,
  rateByDate,
  round,
  status,
} from "../../js/src/tools.js";

// ---------------------------------------------------------------- schemas

export const currencyEnum = z.enum(CURRENCIES);
export const anyCurrencyEnum = z.enum(["VES", ...CURRENCIES] as const);
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, ARGS.dateFormat);

export const rateByDateInput = {
  date: isoDate.describe(ARGS.get_rate_by_date.date),
  currency: currencyEnum.optional().describe(ARGS.get_rate_by_date.currency),
};

export const historyInput = {
  currency: currencyEnum.describe(ARGS.get_history.currency),
  days: z
    .number()
    .int()
    .min(1)
    .max(MAX_HISTORY_DAYS)
    .optional()
    .describe(ARGS.get_history.days),
  from: isoDate.optional().describe(ARGS.get_history.from),
  to: isoDate.optional().describe(ARGS.get_history.to),
};

export const convertInput = {
  amount: z.number().finite().nonnegative().max(1e15).describe(ARGS.convert.amount),
  from: anyCurrencyEnum.describe(ARGS.convert.from),
  to: anyCurrencyEnum.describe(ARGS.convert.to),
  date: isoDate.optional().describe(ARGS.convert.date),
};

const rateByDateArgs = z.object(rateByDateInput);
const historyArgs = z.object(historyInput);
const convertArgs = z.object(convertInput);
export type RateByDateArgs = z.infer<typeof rateByDateArgs>;
export type HistoryArgs = z.infer<typeof historyArgs>;
export type ConvertArgs = z.infer<typeof convertArgs>;
export const argSchemas = { rateByDate: rateByDateArgs, history: historyArgs, convert: convertArgs };
