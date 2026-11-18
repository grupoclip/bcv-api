// Error hierarchy. Every error thrown on purpose by this library extends BCVError:
//
//   BCVError
//   ├── InvalidArgument          an argument passed by the caller is invalid
//   │   ├── InvalidDate          bad date string / not a real calendar day / bad range
//   │   ├── InvalidCurrency      unknown currency code, or from === to
//   │   └── InvalidAmount        negative, non-finite or too large amount, bad decimals
//   ├── DateOutOfRange           before 2021-08-02, in the future, not published yet,
//   │                            or outside the range covered by history.json
//   ├── CurrencyNotAvailable     valid code, but no rate for it that day
//   ├── NotFound                 the API answered HTTP 404
//   └── UpstreamError            network failure, timeout, HTTP error or invalid JSON
//
// Mirrors the Python library (python/bcv/errors.py).

/** Base class of every error thrown by `bcv-today`. */
export class BCVError extends Error {
  // Explicit names survive bundlers that rename classes.
  override name = "BCVError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", { value: options.cause, writable: true, configurable: true });
    }
  }
}

/** An argument passed by the caller is invalid. */
export class InvalidArgument extends BCVError {
  override name = "InvalidArgument";
}

/** A date is malformed or not a real calendar day (expected `YYYY-MM-DD`). */
export class InvalidDate extends InvalidArgument {
  override name = "InvalidDate";
}

/** A currency code is not one of VES, USD, EUR, CNY, TRY or RUB (or is misused). */
export class InvalidCurrency extends InvalidArgument {
  override name = "InvalidCurrency";
}

/** An amount is negative, not finite, too large or not a number (or `decimals` is invalid). */
export class InvalidAmount extends InvalidArgument {
  override name = "InvalidAmount";
}

/** The date is valid but no BCV data exists for it (too old, future or not published). */
export class DateOutOfRange extends BCVError {
  override name = "DateOutOfRange";
}

/** The currency is supported, but the BCV data has no rate for it on that day. */
export class CurrencyNotAvailable extends BCVError {
  override name = "CurrencyNotAvailable";
}

/** The BCV Today API answered HTTP 404 for a path. */
export class NotFound extends BCVError {
  override name = "NotFound";
}

/** The BCV Today API could not be reached or returned an unusable response. */
export class UpstreamError extends BCVError {
  override name = "UpstreamError";
  /** HTTP status code, when the error came from an HTTP response. */
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}
