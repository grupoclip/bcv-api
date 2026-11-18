<?php

declare(strict_types=1);

namespace BcvToday\Internal;

use BcvToday\Exception\CurrencyNotAvailableException;
use BcvToday\Exception\DateOutOfRangeException;
use BcvToday\Exception\InvalidAmountException;
use BcvToday\Exception\InvalidCurrencyException;
use BcvToday\Exception\InvalidDateException;
use BcvToday\Exception\UpstreamException;

/**
 * Business rules of BCV Today: date validation, carry-forward semantics, history
 * windowing, cross rates through the bolivar and the user-facing messages.
 * Port of packages/js/src/rules.ts and packages/python/bcv/_core.py; the
 * messages are identical to the JavaScript and Python clients.
 *
 * @internal
 */
final class Rules
{
    /** Foreign currencies published by BCV, in display order. */
    public const CURRENCIES = ['USD', 'EUR', 'CNY', 'TRY', 'RUB'];
    /** Currencies accepted by conversions: the bolivar plus the published ones. */
    public const ANY_CURRENCIES = ['VES', 'USD', 'EUR', 'CNY', 'TRY', 'RUB'];
    public const SOURCE = 'Banco Central de Venezuela (BCV), via https://bcv.today';
    public const UNIT = 'VES (bolivars) per 1 unit of the currency';
    /** First calendar day with a /api/v1/history/{date}.json snapshot. */
    public const EARLIEST_SNAPSHOT = '2021-08-02';
    /** history.json keeps (at most) this many daily entries. */
    public const MAX_HISTORY_DAYS = 1830;
    /** Hours without a capture after which the data is considered stale (weekend + holiday). */
    public const STALE_AFTER_HOURS = 96.0;

    public const LATEST_PATH = '/api/v1/rate.json';
    public const HISTORY_PATH = '/api/v1/history.json';
    public const STATUS_PATH = '/api/v1/status.json';

    private const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    public static function dayPath(string $date): string
    {
        return '/api/v1/history/' . $date . '.json';
    }

    // ------------------------------------------------------------ values

    /** Short, unambiguous rendering of a caller value for error messages (strings are quoted). */
    public static function repr(mixed $value): string
    {
        return match (true) {
            is_string($value) => (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            is_bool($value) => $value ? 'true' : 'false',
            $value === null => 'null',
            is_int($value) => (string) $value,
            is_float($value) => Decimal::shortest($value),
            default => get_debug_type($value),
        };
    }

    /** A positive, finite rate from a JSON number, or null. */
    public static function rateValue(mixed $value): ?Decimal
    {
        if (is_int($value)) {
            return $value > 0 ? Decimal::fromInt($value) : null;
        }
        if (is_float($value) && is_finite($value) && $value > 0) {
            return Decimal::fromFloat($value);
        }

        return null;
    }

    /**
     * Published rates of an entry, in canonical currency order.
     *
     * @param array<string, mixed> $entry
     * @return array<string, Decimal>
     */
    public static function ratesOf(array $entry): array
    {
        $out = [];
        foreach (self::CURRENCIES as $code) {
            $dec = self::rateValue($entry[$code] ?? null);
            if ($dec !== null) {
                $out[$code] = $dec;
            }
        }

        return $out;
    }

    /**
     * @param array<string, Decimal> $rates
     * @return array<string, string>
     */
    public static function plainRates(array $rates): array
    {
        return array_map(static fn (Decimal $d): string => $d->toPlain(), $rates);
    }

    /** Upper-cases and validates a currency code ("usd" -> "USD"; "VEF" -> "VES" when allowed). */
    public static function normalizeCurrency(mixed $code, bool $allowVes = false): string
    {
        $valid = $allowVes ? self::ANY_CURRENCIES : self::CURRENCIES;
        if (is_string($code)) {
            $upper = strtoupper(trim($code));
            if ($upper === 'VEF' && $allowVes) {
                $upper = 'VES'; // pre-2021 name some users still type
            }
            if (in_array($upper, $valid, true)) {
                return $upper;
            }
        }
        throw new InvalidCurrencyException(
            'Unsupported currency ' . self::repr($code) . ': use one of ' . implode(', ', $valid) . '.',
        );
    }

    /** Validates an amount and returns it as an exact decimal. */
    public static function parseAmount(mixed $amount): Decimal
    {
        $dec = null;
        if (is_int($amount)) {
            $dec = Decimal::fromInt($amount);
        } elseif (is_float($amount)) {
            if (!is_finite($amount)) {
                throw new InvalidAmountException('Invalid amount ' . self::repr($amount) . ': it must be a finite number.');
            }
            $dec = Decimal::fromFloat($amount);
        } elseif (is_string($amount)) {
            $text = str_replace('_', '', trim($amount));
            if (preg_match('/^[+-]?(nan|inf|infinity)$/i', $text) === 1) {
                throw new InvalidAmountException('Invalid amount ' . self::repr($amount) . ': it must be a finite number.');
            }
            $dec = Decimal::parse($text);
        }
        if ($dec === null) {
            throw new InvalidAmountException('Invalid amount ' . self::repr($amount) . ': expected a number.');
        }
        if ($dec->isNegative()) {
            throw new InvalidAmountException('Invalid amount ' . self::repr($amount) . ': it must be zero or positive.');
        }
        if ($dec->cmp(Decimal::fromInt(10 ** 15)) > 0) {
            throw new InvalidAmountException('Invalid amount ' . self::repr($amount) . ': it must not exceed 1e15.');
        }

        return $dec;
    }

    public static function checkDecimals(mixed $decimals): ?int
    {
        if ($decimals === null) {
            return null;
        }
        if (!is_int($decimals) || $decimals < 0 || $decimals > 12) {
            throw new InvalidAmountException(
                'Invalid decimals ' . self::repr($decimals) . ': use a whole number from 0 to 12, or null.',
            );
        }

        return $decimals;
    }

    public static function checkDays(mixed $days): int
    {
        if (!is_int($days) || $days < 1 || $days > self::MAX_HISTORY_DAYS) {
            throw new InvalidDateException(
                'Invalid days ' . self::repr($days) . ': use a whole number from 1 to ' . self::MAX_HISTORY_DAYS . '.',
            );
        }

        return $days;
    }

    // ------------------------------------------------------------ dates

    /**
     * True when $s is a real calendar date in YYYY-MM-DD form.
     *
     * @phpstan-assert-if-true string $s
     */
    public static function isIsoDate(mixed $s): bool
    {
        if (!is_string($s) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m) !== 1) {
            return false;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /** Coerces a date argument to "YYYY-MM-DD" or throws InvalidDateException. */
    public static function parseDate(mixed $value, string $label = 'date'): string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }
        if (is_string($value)) {
            $text = trim($value);
            if (self::isIsoDate($text)) {
                return $text;
            }
            throw new InvalidDateException(self::invalidDateMessage($label, $value));
        }
        throw new InvalidDateException(
            'Invalid ' . $label . ' ' . self::repr($value) . ': expected a DateTimeInterface or a YYYY-MM-DD string.',
        );
    }

    /** Today's date in Caracas (UTC-4, no DST) for a Unix timestamp in seconds. */
    public static function todayCaracas(float $now): string
    {
        return gmdate('Y-m-d', (int) floor($now) - 4 * 3600);
    }

    public static function addDays(string $date, int $days): string
    {
        return (new \DateTimeImmutable($date . 'T00:00:00Z'))->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
    }

    /** English weekday name of an ISO date ("Saturday"). */
    public static function weekday(string $date): string
    {
        return self::WEEKDAYS[(int) (new \DateTimeImmutable($date . 'T00:00:00Z'))->format('w')];
    }

    /** Parses an ISO 8601 timestamp as UTC; null when missing or invalid. */
    public static function parseTimestamp(mixed $value): ?\DateTimeImmutable
    {
        if (!is_string($value)) {
            return null;
        }
        $text = trim($value);
        $pattern = '/^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?([Zz]|[+-]\d{2}:?\d{2})?$/';
        if (preg_match($pattern, $text, $m) !== 1 || !checkdate((int) substr($m[1], 5, 2), (int) substr($m[1], 8, 2), (int) substr($m[1], 0, 4))) {
            return null;
        }
        $fraction = ($m[3] ?? '') !== '' ? '.' . substr($m[3] . '000000', 0, 6) : '';
        $zone = $m[4] ?? '';
        if ($zone === '' || strtoupper($zone) === 'Z') {
            $zone = '+00:00';
        }
        try {
            $parsed = new \DateTimeImmutable($m[1] . 'T' . $m[2] . $fraction . $zone);
        } catch (\Exception) {
            return null;
        }

        return $parsed->setTimezone(new \DateTimeZone('UTC'));
    }

    // ------------------------------------------------------------ messages

    public static function invalidDateMessage(string $label, string $value): string
    {
        return 'Invalid ' . $label . ' "' . $value . '": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.';
    }

    public static function notPublishedMessage(string $date, ?string $latest): string
    {
        return 'No BCV rate published yet for ' . $date . '. Daily snapshots are available from ' . self::EARLIEST_SNAPSHOT
            . ($latest !== null ? ' to ' . $latest . '.' : ' to the latest business day.')
            . ' Use latest() for the rate currently in effect.';
    }

    /** Explains a weekend/holiday carry-forward, or null when the rate is that day's own. */
    public static function carryForwardNote(string $date, ?string $effective): ?string
    {
        if ($effective === null || $effective === '' || $effective === $date) {
            return null;
        }

        return $date . ' (' . self::weekday($date) . ') uses the rate with effective date ' . $effective
            . ' (' . self::weekday($effective) . '): a published BCV rate stays in effect until the next publication'
            . ' (weekends and holidays carry it forward).';
    }

    // ------------------------------------------------------------ validation

    /**
     * Checks a requested calendar day: on or after the first snapshot and at most
     * tomorrow in Caracas (BCV publishes the next business day's rate in the afternoon).
     */
    public static function checkDay(string $date, string $today): void
    {
        if ($date < self::EARLIEST_SNAPSHOT) {
            throw new DateOutOfRangeException(
                'No BCV data for ' . $date . ': daily snapshots start on ' . self::EARLIEST_SNAPSHOT . '.',
            );
        }
        if ($date > self::addDays($today, 1)) {
            throw new DateOutOfRangeException(
                $date . ' is in the future (today in Caracas is ' . $today
                . '); BCV rates are only known up to the next business day.',
            );
        }
    }

    /**
     * Calendar date and effective date of an entry, validated.
     *
     * @param array<string, mixed> $entry
     * @return array{0: string, 1: string}
     */
    public static function entryDates(array $entry, ?string $fallback = null): array
    {
        $date = $entry['date'] ?? null;
        $day = self::isIsoDate($date) ? $date : $fallback;
        if ($day === null) {
            throw new UpstreamException("Unexpected API response: the entry has no valid 'date'.");
        }
        $effective = $entry['effective_date'] ?? null;

        return [$day, self::isIsoDate($effective) ? $effective : $day];
    }

    /**
     * Restricts a day's rates to one currency, or explains why it is missing.
     *
     * @param array<string, mixed> $entry
     * @return array<string, Decimal>
     */
    public static function pickRates(array $entry, string $date, ?string $currency = null): array
    {
        $all = self::ratesOf($entry);
        if ($currency === null) {
            return $all;
        }
        if (!isset($all[$currency])) {
            $avail = $all === [] ? 'none' : implode(', ', array_keys($all));
            throw new CurrencyNotAvailableException(
                'No ' . $currency . ' rate in the BCV data for ' . $date
                . ' (older entries may lack some currencies). Available that day: ' . $avail . '.',
            );
        }

        return [$currency => $all[$currency]];
    }

    /**
     * Bolivars per unit of each side of a conversion (VES counts as 1). Cross rates
     * go through the bolivar: result = amount * vesPerFrom / vesPerTo.
     *
     * @param array<string, mixed> $entry
     * @return array{0: Decimal, 1: Decimal, 2: array<string, Decimal>}
     */
    public static function conversionRates(array $entry, string $from, string $to, string $day): array
    {
        $rates = self::ratesOf($entry);
        $vesPer = static fn (string $c): ?Decimal => $c === 'VES' ? Decimal::fromInt(1) : ($rates[$c] ?? null);
        $rf = $vesPer($from);
        $rt = $vesPer($to);
        if ($rf === null || $rt === null) {
            $missing = [];
            if ($rf === null) {
                $missing[] = $from;
            }
            if ($rt === null) {
                $missing[] = $to;
            }
            throw new CurrencyNotAvailableException(
                'No BCV rate for ' . implode(' and ', $missing) . ' on ' . $day
                . ' (older entries may lack some currencies). Available: ' . implode(', ', array_keys($rates)) . '.',
            );
        }
        $used = [];
        if ($from !== 'VES') {
            $used[$from] = $rf;
        }
        if ($to !== 'VES') {
            $used[$to] = $rt;
        }

        return [$rf, $rt, $used];
    }

    /**
     * Selects the window of a history series: the last $days calendar days ending
     * on the latest published date, or an inclusive start/end range clipped to what
     * history.json covers.
     *
     * @param list<array<string, mixed>> $entries
     * @return array{series: list<array{date: string, effective_date: string, rate: Decimal}>, notes: list<string>}
     */
    public static function historyWindow(array $entries, string $currency, int $days, ?string $from, ?string $to): array
    {
        $series = [];
        foreach ($entries as $entry) {
            $rate = self::rateValue($entry[$currency] ?? null);
            $date = $entry['date'] ?? null;
            if ($rate === null || !self::isIsoDate($date)) {
                continue;
            }
            $effective = $entry['effective_date'] ?? null;
            $series[] = [
                'date' => $date,
                'effective_date' => self::isIsoDate($effective) ? $effective : $date,
                'rate' => $rate,
            ];
        }
        // history.json is published oldest first; usort is stable since PHP 8.0.
        usort($series, static fn (array $a, array $b): int => strcmp($a['date'], $b['date']));
        if ($series === []) {
            throw new CurrencyNotAvailableException('No ' . $currency . ' data in the BCV history.');
        }
        $earliest = $series[0]['date'];
        $latest = $series[count($series) - 1]['date'];

        if ($from !== null || $to !== null) {
            $start = $from ?? $earliest;
            $end = $to ?? $latest;
        } else {
            $end = $latest;
            $start = self::addDays($latest, -($days - 1));
        }
        $window = array_values(array_filter(
            $series,
            static fn (array $p): bool => $p['date'] >= $start && $p['date'] <= $end,
        ));
        if ($window === []) {
            throw new DateOutOfRangeException(
                'No ' . $currency . ' rates between ' . $start . ' and ' . $end . '. The history covers ' . $earliest
                . ' to ' . $latest . ' for ' . $currency . ' (latest ' . self::MAX_HISTORY_DAYS
                . ' daily entries). For older single days use on().',
            );
        }
        $notes = [];
        if ($start < $earliest) {
            $notes[] = 'History for ' . $currency . ' starts on ' . $earliest . '; earlier dates were skipped.';
        }
        if ($end > $latest) {
            $notes[] = 'Latest available date is ' . $latest . '.';
        }

        return ['series' => $window, 'notes' => $notes];
    }

    /** Display formatting with thousands separators (never used for math). */
    public static function num(Decimal $value, int $places = 4): string
    {
        return $value->group($places);
    }

    /** @param array<string, Decimal> $rates */
    public static function ratesLine(array $rates): string
    {
        $parts = [];
        foreach ($rates as $code => $value) {
            $parts[] = $code . ' ' . self::num($value);
        }

        return implode(', ', $parts);
    }
}
