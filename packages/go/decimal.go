package bcv

// Minimal exact decimal arithmetic on scaled big integers (value = coef * 10^exp).
//
// A port of packages/js/src/decimal.ts (and packages/php/src/Internal/Decimal.php):
// exact add/sub/mul, division to a fixed number of significant digits (28, like
// Python's default decimal context) and ROUND_HALF_UP quantization. Rounding is
// half away from zero, as in Python's ROUND_HALF_UP.

import (
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// precision is the number of significant digits kept by div (Python's default context).
const precision = 28

type dec struct {
	coef *big.Int // never mutated after construction
	exp  int
}

var (
	bigZero = big.NewInt(0)
	bigOne  = big.NewInt(1)
	bigTwo  = big.NewInt(2)
	bigTen  = big.NewInt(10)
)

var decimalRE = regexp.MustCompile(`^([+-])?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$`)

func pow10(n int) *big.Int {
	return new(big.Int).Exp(bigTen, big.NewInt(int64(n)), nil)
}

func digits(n *big.Int) int {
	if n.Sign() == 0 {
		return 1
	}
	return len(new(big.Int).Abs(n).Text(10))
}

func decFromInt(n int64) dec { return dec{coef: big.NewInt(n), exp: 0} }

// parseDecimal parses a plain or exponent decimal string ("12.5", "-0.1", "1e-7", "1E+21").
func parseDecimal(text string) (dec, bool) {
	m := decimalRE.FindStringSubmatch(text)
	if m == nil {
		return dec{}, false
	}
	sign, intPart, frac, e := m[1], m[2], m[3], m[4]
	if intPart == "" && frac == "" {
		return dec{}, false
	}
	ev := 0
	if e != "" {
		v, err := strconv.Atoi(e)
		if err != nil {
			return dec{}, false
		}
		ev = v
	}
	exp := ev - len(frac)
	if exp > 10000 || exp < -10000 {
		return dec{}, false
	}
	coef, ok := new(big.Int).SetString(intPart+frac, 10)
	if !ok {
		return dec{}, false
	}
	if sign == "-" {
		coef.Neg(coef)
	}
	return normalize(dec{coef: coef, exp: exp}), true
}

// normalize strips trailing zeros from the coefficient.
func normalize(d dec) dec {
	if d.coef.Sign() == 0 {
		return dec{coef: bigZero, exp: 0}
	}
	coef := new(big.Int).Set(d.coef)
	exp := d.exp
	q, r := new(big.Int), new(big.Int)
	for {
		q.QuoRem(coef, bigTen, r)
		if r.Sign() != 0 {
			break
		}
		coef.Set(q)
		exp++
	}
	return dec{coef: coef, exp: exp}
}

func align(a, b dec) (*big.Int, *big.Int, int) {
	exp := min(a.exp, b.exp)
	x := new(big.Int).Mul(a.coef, pow10(a.exp-exp))
	y := new(big.Int).Mul(b.coef, pow10(b.exp-exp))
	return x, y, exp
}

func (a dec) sub(b dec) dec {
	x, y, exp := align(a, b)
	return normalize(dec{coef: x.Sub(x, y), exp: exp})
}

func (a dec) mul(b dec) dec {
	return normalize(dec{coef: new(big.Int).Mul(a.coef, b.coef), exp: a.exp + b.exp})
}

func (a dec) cmp(b dec) int {
	x, y, _ := align(a, b)
	return x.Cmp(y)
}

func (a dec) sign() int { return a.coef.Sign() }

// shiftRound returns n / 10^k rounded half away from zero (ROUND_HALF_UP).
func shiftRound(n *big.Int, k int) *big.Int {
	if k <= 0 {
		return new(big.Int).Mul(n, pow10(-k))
	}
	p := pow10(k)
	q, r := new(big.Int).QuoRem(n, p, new(big.Int)) // truncates toward zero
	r.Abs(r)
	// Round away from zero when the dropped part is at least one half. Any tail
	// already truncated below these digits cannot change that decision.
	if new(big.Int).Mul(r, bigTwo).Cmp(p) < 0 {
		return q
	}
	if n.Sign() < 0 {
		return q.Sub(q, bigOne)
	}
	return q.Add(q, bigOne)
}

// roundSignificant rounds to prec significant digits (half-up).
func (a dec) roundSignificant(prec int) dec {
	extra := digits(a.coef) - prec
	if extra <= 0 {
		return a
	}
	return normalize(dec{coef: shiftRound(a.coef, extra), exp: a.exp + extra})
}

// div returns a / b rounded half-up to prec significant digits. b must not be zero.
func (a dec) div(b dec, prec int) dec {
	if a.coef.Sign() == 0 {
		return dec{coef: bigZero, exp: 0}
	}
	// Scale the dividend so the integer quotient has at least prec + 2 digits.
	k := max(0, prec+2+digits(b.coef)-digits(a.coef))
	num := new(big.Int).Mul(a.coef, pow10(k))
	q := num.Quo(num, b.coef)
	exp := a.exp - b.exp - k
	extra := digits(q) - prec
	if extra <= 0 {
		return normalize(dec{coef: q, exp: exp})
	}
	return normalize(dec{coef: shiftRound(q, extra), exp: exp + extra})
}

// quantize rounds to exactly places decimal places (half-up); the result keeps that scale.
func (a dec) quantize(places int) dec {
	target := -places
	if a.exp >= target {
		return dec{coef: new(big.Int).Mul(a.coef, pow10(a.exp-target)), exp: target}
	}
	return dec{coef: shiftRound(a.coef, target-a.exp), exp: target}
}

// format renders the value with its own scale, never in exponent notation.
func (a dec) format() string {
	neg := a.coef.Sign() < 0
	s := new(big.Int).Abs(a.coef).Text(10)
	var out string
	if a.exp >= 0 {
		out = s + strings.Repeat("0", a.exp)
	} else {
		scale := -a.exp
		if len(s) <= scale {
			s = strings.Repeat("0", scale-len(s)+1) + s
		}
		out = s[:len(s)-scale] + "." + s[len(s)-scale:]
	}
	if neg && strings.ContainsAny(out, "123456789") {
		return "-" + out
	}
	return out
}

// toFixed renders exactly places decimals (half-up).
func (a dec) toFixed(places int) string { return a.quantize(places).format() }

// toPlain renders the exact value without trailing zeros ("91664.77", "0.0125", "3").
func (a dec) toPlain() string { return normalize(a).format() }

// group renders with thousands separators: group(d, 2) -> "91,664.77".
func (a dec) group(places int) string {
	return groupString(a.toFixed(places))
}

// FormatNumber renders a decimal string for display, rounded half-up to places
// decimals with thousands separators: FormatNumber("91664.77", 2) is "91,664.77"
// and FormatNumber("1007.38665582", 4) is "1,007.3867". A value that is not a
// decimal number is returned unchanged.
func FormatNumber(value string, places int) string {
	d, ok := parseDecimal(strings.TrimSpace(value))
	if !ok || places < 0 {
		return value
	}
	return d.group(places)
}

func groupString(fixed string) string {
	neg := strings.HasPrefix(fixed, "-")
	body := strings.TrimPrefix(fixed, "-")
	intPart, frac, hasFrac := strings.Cut(body, ".")
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	for i, ch := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	if hasFrac {
		b.WriteByte('.')
		b.WriteString(frac)
	}
	return b.String()
}
