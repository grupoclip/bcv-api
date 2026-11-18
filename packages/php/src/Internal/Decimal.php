<?php

declare(strict_types=1);

namespace BcvToday\Internal;

/**
 * Minimal exact decimal arithmetic on scaled integers held as digit strings
 * (value = sign * coef * 10^exp). Port of packages/js/src/decimal.ts.
 *
 * Exact add/sub/mul, division to a fixed number of significant digits (28,
 * like Python's default decimal context) and ROUND_HALF_UP quantization
 * (half away from zero). Pure PHP: needs neither bcmath nor gmp.
 *
 * @internal
 */
final class Decimal
{
    /** Significant digits kept by div() (same as Python's default decimal context). */
    public const PRECISION = 28;

    private const PATTERN = '/^([+-])?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/';

    /**
     * @param string $coef magnitude: decimal digits without leading zeros ("0" for zero)
     */
    private function __construct(
        public readonly bool $negative,
        public readonly string $coef,
        public readonly int $exp,
    ) {
    }

    private static function make(bool $negative, string $coef, int $exp): self
    {
        $coef = self::trim($coef);
        if ($coef === '0') {
            return new self(false, '0', $exp);
        }

        return new self($negative, $coef, $exp);
    }

    /** Parses a plain or exponent decimal string ("12.5", "-0.1", "1e-7", "1E+21"); null if invalid. */
    public static function parse(string $text): ?self
    {
        if (preg_match(self::PATTERN, $text, $m) !== 1) {
            return null;
        }
        $int = $m[2] ?? '';
        $frac = $m[3] ?? '';
        $e = $m[4] ?? '';
        if ($int === '' && $frac === '') {
            return null;
        }
        $eDigits = ltrim($e, '+-');
        $eDigits = ltrim($eDigits, '0');
        if (strlen($eDigits) > 6) {
            return null;
        }
        $exp = ($e === '' ? 0 : (int) $e) - strlen($frac);
        if (abs($exp) > 10000) {
            return null;
        }

        return self::make(($m[1] ?? '') === '-', $int . $frac, $exp)->normalize();
    }

    public static function fromInt(int $value): self
    {
        $digits = (string) $value;
        if ($value < 0) {
            return self::make(true, substr($digits, 1), 0)->normalize();
        }

        return self::make(false, $digits, 0)->normalize();
    }

    /** Exact decimal of a finite float, via its shortest round-trip decimal string (0.1 is exactly "0.1"). */
    public static function fromFloat(float $value): self
    {
        $parsed = self::parse(self::shortest($value));
        if ($parsed === null) {
            throw new \ValueError('Not a finite number.');
        }

        return $parsed;
    }

    /** Shortest decimal string that reads back as the same float (like JS String(n) / Python repr). */
    public static function shortest(float $value): string
    {
        if (is_nan($value) || is_infinite($value)) {
            return is_nan($value) ? 'NAN' : ($value > 0 ? 'INF' : '-INF');
        }
        if ($value == 0.0) {
            return '0';
        }
        for ($precision = 1; $precision <= 17; $precision++) {
            $text = sprintf('%.' . $precision . 'G', $value);
            if ((float) $text === $value) {
                return $text;
            }
        }

        return sprintf('%.17G', $value);
    }

    /** Strips trailing zeros from the coefficient. */
    public function normalize(): self
    {
        if ($this->coef === '0') {
            return new self(false, '0', 0);
        }
        $trimmed = rtrim($this->coef, '0');

        return new self($this->negative, $trimmed, $this->exp + strlen($this->coef) - strlen($trimmed));
    }

    public function isZero(): bool
    {
        return $this->coef === '0';
    }

    public function isNegative(): bool
    {
        return $this->negative && $this->coef !== '0';
    }

    public function add(self $other): self
    {
        [$a, $b, $exp] = self::align($this, $other);
        if ($this->negative === $other->negative) {
            return self::make($this->negative, self::addMag($a, $b), $exp)->normalize();
        }
        $c = self::cmpMag($a, $b);
        if ($c === 0) {
            return new self(false, '0', 0);
        }
        if ($c > 0) {
            return self::make($this->negative, self::subMag($a, $b), $exp)->normalize();
        }

        return self::make($other->negative, self::subMag($b, $a), $exp)->normalize();
    }

    public function sub(self $other): self
    {
        return $this->add(new self(!$other->negative, $other->coef, $other->exp));
    }

    public function mul(self $other): self
    {
        return self::make($this->negative !== $other->negative, self::mulMag($this->coef, $other->coef), $this->exp + $other->exp)
            ->normalize();
    }

    /** -1, 0 or 1. */
    public function cmp(self $other): int
    {
        $sa = $this->isNegative() ? -1 : ($this->isZero() ? 0 : 1);
        $sb = $other->isNegative() ? -1 : ($other->isZero() ? 0 : 1);
        if ($sa !== $sb) {
            return $sa <=> $sb;
        }
        if ($sa === 0) {
            return 0;
        }
        [$a, $b] = self::align($this, $other);
        $c = self::cmpMag($a, $b);

        return $sa < 0 ? -$c : $c;
    }

    /** Rounds to $precision significant digits (half-up). */
    public function roundSignificant(int $precision = self::PRECISION): self
    {
        $extra = strlen($this->coef) - $precision;
        if ($extra <= 0) {
            return $this;
        }

        return self::make($this->negative, self::shiftRound($this->coef, $extra), $this->exp + $extra)->normalize();
    }

    /** $this / $other rounded half-up to $precision significant digits. */
    public function div(self $other, int $precision = self::PRECISION): self
    {
        if ($other->isZero()) {
            throw new \DivisionByZeroError('Division by zero');
        }
        if ($this->isZero()) {
            return new self(false, '0', 0);
        }
        // Scale the dividend so the integer quotient has at least precision + 2 digits.
        $k = max(0, $precision + 2 + strlen($other->coef) - strlen($this->coef));
        [$q] = self::divMag($this->coef . str_repeat('0', $k), $other->coef);
        $exp = $this->exp - $other->exp - $k;
        $negative = $this->negative !== $other->negative;
        $extra = strlen($q) - $precision;
        if ($extra <= 0) {
            return self::make($negative, $q, $exp)->normalize();
        }

        return self::make($negative, self::shiftRound($q, $extra), $exp + $extra)->normalize();
    }

    /** Rounds to exactly $places decimal places (half-up); the result keeps that scale. */
    public function quantize(int $places): self
    {
        $target = -$places;
        if ($this->exp >= $target) {
            return self::make($this->negative, $this->coef . str_repeat('0', $this->exp - $target), $target);
        }

        return self::make($this->negative, self::shiftRound($this->coef, $target - $this->exp), $target);
    }

    /** Plain (non-exponent) string; $places forces that many decimals (half-up). */
    public function toFixed(?int $places = null): string
    {
        $d = $places === null ? $this : $this->quantize($places);
        $digits = $d->coef;
        if ($d->exp >= 0) {
            $out = $digits . ($digits === '0' ? '' : str_repeat('0', $d->exp));
        } else {
            $scale = -$d->exp;
            if (strlen($digits) <= $scale) {
                $digits = str_repeat('0', $scale - strlen($digits) + 1) . $digits;
            }
            $out = substr($digits, 0, strlen($digits) - $scale) . '.' . substr($digits, strlen($digits) - $scale);
        }

        return $d->negative && preg_match('/[1-9]/', $out) === 1 ? '-' . $out : $out;
    }

    /** Plain string of the exact value without trailing zeros ("91664.77", "0.0125", "3"). */
    public function toPlain(): string
    {
        return $this->normalize()->toFixed();
    }

    /** Display format with thousands separators: group(2) -> "91,664.77". */
    public function group(int $places): string
    {
        $fixed = $this->toFixed($places);
        $negative = str_starts_with($fixed, '-');
        $body = $negative ? substr($fixed, 1) : $fixed;
        $parts = explode('.', $body, 2);
        $int = (string) preg_replace('/\B(?=(\d{3})+(?!\d))/', ',', $parts[0]);

        return ($negative ? '-' : '') . $int . (isset($parts[1]) ? '.' . $parts[1] : '');
    }

    // ------------------------------------------------------------ magnitudes

    private static function trim(string $digits): string
    {
        $trimmed = ltrim($digits, '0');

        return $trimmed === '' ? '0' : $trimmed;
    }

    /** @return array{0: string, 1: string, 2: int} */
    private static function align(self $a, self $b): array
    {
        $exp = min($a->exp, $b->exp);
        $x = $a->coef === '0' ? '0' : $a->coef . str_repeat('0', $a->exp - $exp);
        $y = $b->coef === '0' ? '0' : $b->coef . str_repeat('0', $b->exp - $exp);

        return [$x, $y, $exp];
    }

    private static function cmpMag(string $a, string $b): int
    {
        $la = strlen($a);
        $lb = strlen($b);
        if ($la !== $lb) {
            return $la <=> $lb;
        }

        return strcmp($a, $b) <=> 0;
    }

    private static function addMag(string $a, string $b): string
    {
        $i = strlen($a) - 1;
        $j = strlen($b) - 1;
        $carry = 0;
        $out = '';
        while ($i >= 0 || $j >= 0 || $carry > 0) {
            $sum = $carry + ($i >= 0 ? (int) $a[$i] : 0) + ($j >= 0 ? (int) $b[$j] : 0);
            $out = ($sum % 10) . $out;
            $carry = intdiv($sum, 10);
            $i--;
            $j--;
        }

        return self::trim($out);
    }

    /** $a - $b for $a >= $b. */
    private static function subMag(string $a, string $b): string
    {
        $i = strlen($a) - 1;
        $j = strlen($b) - 1;
        $borrow = 0;
        $out = '';
        while ($i >= 0) {
            $diff = (int) $a[$i] - $borrow - ($j >= 0 ? (int) $b[$j] : 0);
            $borrow = 0;
            if ($diff < 0) {
                $diff += 10;
                $borrow = 1;
            }
            $out = $diff . $out;
            $i--;
            $j--;
        }

        return self::trim($out);
    }

    private static function mulMag(string $a, string $b): string
    {
        if ($a === '0' || $b === '0') {
            return '0';
        }
        $la = strlen($a);
        $lb = strlen($b);
        $acc = array_fill(0, $la + $lb, 0);
        for ($i = $la - 1; $i >= 0; $i--) {
            $da = (int) $a[$i];
            if ($da === 0) {
                continue;
            }
            for ($j = $lb - 1; $j >= 0; $j--) {
                $acc[$i + $j + 1] += $da * (int) $b[$j];
            }
        }
        for ($k = $la + $lb - 1; $k > 0; $k--) {
            if ($acc[$k] >= 10) {
                $acc[$k - 1] += intdiv($acc[$k], 10);
                $acc[$k] %= 10;
            }
        }

        return self::trim(implode('', $acc));
    }

    /**
     * Integer division of magnitudes (truncating).
     *
     * @return array{0: string, 1: string} quotient and remainder
     */
    private static function divMag(string $a, string $b): array
    {
        $quotient = '';
        $rest = '0';
        $len = strlen($a);
        for ($i = 0; $i < $len; $i++) {
            $rest = self::trim($rest . $a[$i]);
            $digit = 0;
            while (self::cmpMag($rest, $b) >= 0) {
                $rest = self::subMag($rest, $b);
                $digit++;
            }
            $quotient .= $digit;
        }

        return [self::trim($quotient), $rest];
    }

    /** $n / 10^$k rounded half away from zero (on the magnitude). */
    private static function shiftRound(string $n, int $k): string
    {
        if ($k <= 0) {
            return $n === '0' ? '0' : $n . str_repeat('0', -$k);
        }
        $len = strlen($n);
        $q = $len > $k ? substr($n, 0, $len - $k) : '0';
        $r = $len > $k ? substr($n, $len - $k) : str_pad($n, $k, '0', STR_PAD_LEFT);
        // Round away from zero when the dropped part is at least one half. Any tail
        // already truncated below these digits cannot change that decision.
        if (strcmp($r, '5' . str_repeat('0', $k - 1)) < 0) {
            return self::trim($q);
        }

        return self::addMag(self::trim($q), '1');
    }
}
