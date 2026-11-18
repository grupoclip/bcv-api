// bcv-today: official JavaScript/TypeScript client for the BCV Today API
// (https://bcv.today/api/): Banco Central de Venezuela exchange rates for USD,
// EUR, CNY, TRY and RUB against the bolivar (VES). Unofficial project, not
// affiliated with Banco Central de Venezuela. Data: CC BY 4.0, BCV Today.

export { DEFAULT_BASE_URL, type FetchLike } from "./api.js";
export {
  type AmountInput,
  BCV,
  type BCVOptions,
  type ConvertOptions,
  type DateInput,
  DEFAULT_USER_AGENT,
  type HistoryOptions,
} from "./client.js";
export {
  BCVError,
  CurrencyNotAvailable,
  DateOutOfRange,
  InvalidAmount,
  InvalidArgument,
  InvalidCurrency,
  InvalidDate,
  NotFound,
  UpstreamError,
} from "./errors.js";
export {
  ANY_CURRENCIES,
  type AnyCurrency,
  CURRENCIES,
  type Currency,
  EARLIEST_SNAPSHOT,
  MAX_HISTORY_DAYS,
  type RateEntry,
  SOURCE,
  type StatusDoc,
  UNIT,
} from "./rules.js";
export type { Conversion, DayRate, History, HistoryPoint, RateMap, Rates, Status } from "./types.js";
export { VERSION } from "./version.js";
