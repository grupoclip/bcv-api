// Minimal exact decimal arithmetic on scaled BigInts (value = coef * 10^exp).
//
// Enough for currency conversion without binary floating-point drift:
// exact add/sub/mul, division to a fixed number of significant digits
// (28, like Python's decimal default context) and ROUND_HALF_UP quantization.
// Rounding is half away from zero, as in Python's ROUND_HALF_UP.

export interface Dec {
  readonly coef: bigint;
  readonly exp: number;
}

/** Significant digits kept by `div` (same as Python's default decimal context). */
export const PRECISION = 28;

const TEN = BigInt(10);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

const DECIMAL_RE = /^([+-])?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function pow10(n: number): bigint {
  return TEN ** BigInt(n);
}

function abs(n: bigint): bigint {
  return n < ZERO ? -n : n;
}

function digits(n: bigint): number {
  return n === ZERO ? 1 : abs(n).toString().length;
}

/** Parses a plain or exponent decimal string ("12.5", "-0.1", "1e-7", "1E+21"). */
export function parseDecimal(text: string): Dec | undefined {
  const m = DECIMAL_RE.exec(text);
  if (!m) return undefined;
  const [, sign, int = "", frac = "", e = "0"] = m;
  if (int === "" && frac === "") return undefined;
  const exp = Number(e) - frac.length;
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 10_000) return undefined;
  const coef = BigInt(`${int}${frac}` || "0");
  return normalize({ coef: sign === "-" ? -coef : coef, exp });
}

/** Exact decimal of a finite JS number, via its shortest round-trip string. */
export function fromNumber(n: number): Dec {
  const d = parseDecimal(String(n));
  if (!d) throw new RangeError(`Not a finite number: ${n}`);
  return d;
}

/** Strips trailing zeros from the coefficient. */
export function normalize(d: Dec): Dec {
  if (d.coef === ZERO) return { coef: ZERO, exp: 0 };
  let { coef, exp } = d;
  while (coef % TEN === ZERO) {
    coef /= TEN;
    exp += 1;
  }
  return { coef, exp };
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const exp = Math.min(a.exp, b.exp);
  return [a.coef * pow10(a.exp - exp), b.coef * pow10(b.exp - exp), exp];
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, exp] = align(a, b);
  return normalize({ coef: x + y, exp });
}

export function sub(a: Dec, b: Dec): Dec {
  const [x, y, exp] = align(a, b);
  return normalize({ coef: x - y, exp });
}

export function mul(a: Dec, b: Dec): Dec {
  return normalize({ coef: a.coef * b.coef, exp: a.exp + b.exp });
}

export function cmp(a: Dec, b: Dec): number {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(a: Dec): boolean {
  return a.coef === ZERO;
}

/** `n / 10^k` rounded half away from zero (ROUND_HALF_UP). */
function shiftRound(n: bigint, k: number): bigint {
  if (k <= 0) return n * pow10(-k);
  const p = pow10(k);
  const q = n / p; // truncates toward zero
  const r = abs(n % p);
  // Round away from zero when the dropped part is at least one half. Any tail
  // already truncated below these digits cannot change that decision.
  if (r * TWO < p) return q;
  return n < ZERO ? q - ONE : q + ONE;
}

/** Rounds to `prec` significant digits (half-up). */
export function roundSignificant(a: Dec, prec = PRECISION): Dec {
  const extra = digits(a.coef) - prec;
  if (extra <= 0) return a;
  return normalize({ coef: shiftRound(a.coef, extra), exp: a.exp + extra });
}

/** `a / b` rounded half-up to `prec` significant digits. Throws on division by zero. */
export function div(a: Dec, b: Dec, prec = PRECISION): Dec {
  if (b.coef === ZERO) throw new RangeError("Division by zero");
  if (a.coef === ZERO) return { coef: ZERO, exp: 0 };
  // Scale the dividend so the integer quotient has at least prec + 2 digits.
  const k = Math.max(0, prec + 2 + digits(b.coef) - digits(a.coef));
  const num = a.coef * pow10(k);
  const q = num / b.coef;
  const exp = a.exp - b.exp - k;
  const extra = digits(q) - prec;
  if (extra <= 0) return normalize({ coef: q, exp });
  return normalize({ coef: shiftRound(q, extra), exp: exp + extra });
}

/** Rounds to exactly `places` decimal places (half-up); the result keeps that scale. */
export function quantize(a: Dec, places: number): Dec {
  const target = -places;
  if (a.exp >= target) return { coef: a.coef * pow10(a.exp - target), exp: target };
  return { coef: shiftRound(a.coef, target - a.exp), exp: target };
}

/** Plain (non-exponent) string; `places` forces that many decimals (half-up). */
export function toFixed(a: Dec, places?: number): string {
  const d = places === undefined ? a : quantize(a, places);
  const neg = d.coef < ZERO;
  let s = abs(d.coef).toString();
  let out: string;
  if (d.exp >= 0) {
    out = s + "0".repeat(d.exp);
  } else {
    const scale = -d.exp;
    if (s.length <= scale) s = "0".repeat(scale - s.length + 1) + s;
    out = `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`;
  }
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/** Plain string of the exact value without trailing zeros ("91664.77", "0.0125", "3"). */
export function toPlain(a: Dec): string {
  return toFixed(normalize(a));
}

export function toNumber(a: Dec): number {
  return Number(toPlain(a));
}

/** Display format with thousands separators: `group(d, 2)` -> "91,664.77". */
export function group(a: Dec, places: number): string {
  const fixed = toFixed(a, places);
  const neg = fixed.startsWith("-");
  const body = neg ? fixed.slice(1) : fixed;
  const [int = "0", frac] = body.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}
