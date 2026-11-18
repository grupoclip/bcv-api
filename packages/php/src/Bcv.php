<?php

declare(strict_types=1);

namespace BcvToday;

use BcvToday\Cache\MemoryCache;
use BcvToday\Exception\BcvException;
use BcvToday\Exception\DateOutOfRangeException;
use BcvToday\Exception\InvalidArgumentException;
use BcvToday\Exception\InvalidCurrencyException;
use BcvToday\Exception\InvalidDateException;
use BcvToday\Exception\NotFoundException;
use BcvToday\Exception\UpstreamException;
use BcvToday\Http\CurlTransport;
use BcvToday\Http\Response;
use BcvToday\Http\StreamTransport;
use BcvToday\Internal\Decimal;
use BcvToday\Internal\Rules;

/**
 * Client for the free, read-only BCV Today API (https://bcv.today/api/).
 *
 * Rates are bolivars (VES) per one unit of USD, EUR, CNY, TRY or RUB, as published
 * by Banco Central de Venezuela. Unofficial project, not affiliated with the bank.
 * Mirrors the Python (bcv) and JavaScript (bcv-today) clients: same rules, same
 * messages, exact decimal conversions returned as strings.
 *
 *     $bcv = new \BcvToday\Bcv();
 *     $bcv->latest()->rate('USD');                 // "916.6477"
 *     $bcv->convert('100', 'USD', 'VES')->result;  // "91664.77"
 */
final class Bcv
{
    public const DEFAULT_BASE_URL = 'https://bcv.today';
    public const DEFAULT_USER_AGENT = 'bcv-today-php/' . Version::VERSION . ' (+https://bcv.today)';

    public readonly string $baseUrl;
    public readonly float $timeout;
    public readonly int $cacheTtl;
    public readonly string $userAgent;

    /** @var \Closure(string, array<string, string>, float): mixed */
    private readonly \Closure $http;

    /** @var \Closure(): float */
    private readonly \Closure $clock;

    private readonly object $cache;

    /**
     * @param string $baseUrl API origin (https:// or http://)
     * @param float|int $timeout per-request timeout in seconds
     * @param int $cacheTtl seconds to keep responses cached (0 disables caching); the data changes a few times per business day
     * @param object|null $cache any object with get($key) and set($key, $value, $ttl), e.g. a PSR-16 cache
     *                           or Laravel's cache repository; default: an in-memory cache for this process
     * @param callable|null $httpClient fn(string $url, array $headers, float $timeout): Http\Response;
     *                                  default: ext-curl when loaded, else PHP streams
     * @param string|null $userAgent default "bcv-today-php/<version> (+https://bcv.today)"
     * @param callable|null $clock fn(): float|int|\DateTimeInterface, current time (testing hook)
     */
    public function __construct(
        string $baseUrl = self::DEFAULT_BASE_URL,
        float|int $timeout = 10.0,
        int $cacheTtl = 300,
        ?object $cache = null,
        ?callable $httpClient = null,
        ?string $userAgent = null,
        ?callable $clock = null,
    ) {
        if (preg_match('#^https?://#', $baseUrl) !== 1) {
            throw new InvalidArgumentException(
                'Invalid baseUrl ' . Rules::repr($baseUrl) . ': it must start with https:// or http://.',
            );
        }
        if (!is_finite((float) $timeout) || $timeout < 0) {
            throw new InvalidArgumentException('Invalid timeout ' . Rules::repr($timeout) . ': use a number of seconds >= 0.');
        }
        if ($cacheTtl < 0) {
            throw new InvalidArgumentException('Invalid cacheTtl ' . Rules::repr($cacheTtl) . ': use a number of seconds >= 0.');
        }
        if ($cache !== null && (!method_exists($cache, 'get') || !method_exists($cache, 'set'))) {
            throw new InvalidArgumentException('Invalid cache: expected an object with get() and set() methods (PSR-16).');
        }
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeout = (float) $timeout;
        $this->cacheTtl = $cacheTtl;
        $this->userAgent = $userAgent ?? self::DEFAULT_USER_AGENT;
        $this->clock = $clock === null
            ? static fn (): float => microtime(true)
            : static function () use ($clock): float {
                $now = $clock();
                if ($now instanceof \DateTimeInterface) {
                    return (float) $now->format('U.u');
                }

                return is_int($now) || is_float($now) ? (float) $now : microtime(true);
            };
        $this->cache = $cache ?? new MemoryCache($this->clock);
        $transport = $httpClient ?? (CurlTransport::isAvailable() ? new CurlTransport() : new StreamTransport());
        $this->http = \Closure::fromCallable($transport);
    }

    /** Forgets every cached response (only for the built-in in-memory cache). */
    public function clearCache(): void
    {
        if ($this->cache instanceof MemoryCache) {
            $this->cache->clear();
        }
    }

    // ------------------------------------------------------------ public API

    /** Official rates currently in effect (/api/v1/rate.json). */
    public function latest(): Rates
    {
        $entry = $this->latestEntry();
        [$date, $effectiveDate] = Rules::entryDates($entry);
        $rates = Rules::ratesOf($entry);

        return new Rates(
            rates: Rules::plainRates($rates),
            date: $date,
            effectiveDate: $effectiveDate,
            updatedAt: Rules::parseTimestamp($entry['updated_at'] ?? null),
            summary: 'Official BCV rates (effective ' . $effectiveDate . ', Bs. per unit): ' . Rules::ratesLine($rates),
            raw: $entry,
        );
    }

    /**
     * Rate(s) in effect on a calendar day.
     *
     * BCV does not publish on weekends and holidays: the last published rate stays in
     * effect, so $effectiveDate may be earlier than $date and $carriedForward is then
     * true (with an explanatory $note). Data starts on 2021-08-02; dates after tomorrow
     * (Caracas time) throw DateOutOfRangeException.
     *
     * @param string|\DateTimeInterface $date "YYYY-MM-DD" or a date object (its own calendar day)
     * @param string|null $currency restrict the result to one currency (CurrencyNotAvailableException if not published that day)
     */
    public function on(string|\DateTimeInterface $date, ?string $currency = null): DayRate
    {
        $day = Rules::parseDate($date);
        $code = $currency !== null ? Rules::normalizeCurrency($currency) : null;
        $entry = $this->dayEntry($day);
        [, $effectiveDate] = Rules::entryDates($entry, $day);
        $rates = Rules::pickRates($entry, $day, $code);
        $note = Rules::carryForwardNote($day, $effectiveDate);
        $text = 'BCV rate in effect on ' . $day . ' (Bs. per unit): ' . Rules::ratesLine($rates) . '.';
        $plain = Rules::plainRates($rates);

        return new DayRate(
            date: $day,
            effectiveDate: $effectiveDate,
            carriedForward: $note !== null,
            rates: $plain,
            rate: count($plain) === 1 ? (string) reset($plain) : null,
            updatedAt: Rules::parseTimestamp($entry['updated_at'] ?? null),
            note: $note,
            summary: $note !== null ? $text . ' ' . $note : $text,
            raw: $entry,
        );
    }

    /**
     * Daily series for one currency, oldest first: the last $days calendar days ending
     * on the latest published date (default 30, max 1830), or an inclusive $start/$end
     * range ($days is then ignored). Uses /api/v1/history.json, which keeps the latest
     * 1830 daily entries; ranges are clipped to what it covers and $note says so.
     */
    public function history(
        string $currency,
        int $days = 30,
        string|\DateTimeInterface|null $start = null,
        string|\DateTimeInterface|null $end = null,
    ): History {
        $code = Rules::normalizeCurrency($currency);
        $from = $start !== null ? Rules::parseDate($start, 'start') : null;
        $to = $end !== null ? Rules::parseDate($end, 'end') : null;
        Rules::checkDays($days);
        if ($from !== null && $to !== null && $from > $to) {
            throw new InvalidDateException('"start" (' . $from . ') must be on or before "end" (' . $to . ').');
        }
        $window = Rules::historyWindow($this->historyEntries(), $code, $days, $from, $to);

        $points = [];
        $min = null;
        $max = null;
        $minRate = null;
        $maxRate = null;
        foreach ($window['series'] as $p) {
            $point = new HistoryPoint($p['date'], $p['effective_date'], $p['rate']->toPlain(), $p['effective_date'] !== $p['date']);
            $points[] = $point;
            if ($minRate === null || $p['rate']->cmp($minRate) < 0) {
                $min = $point;
                $minRate = $p['rate'];
            }
            if ($maxRate === null || $p['rate']->cmp($maxRate) > 0) {
                $max = $point;
                $maxRate = $p['rate'];
            }
        }
        $first = $points[0];
        $last = $points[count($points) - 1];
        assert($min !== null && $max !== null && $minRate !== null && $maxRate !== null);
        $firstRate = $window['series'][0]['rate'];
        $lastRate = $window['series'][count($points) - 1]['rate'];
        $change = $lastRate->sub($firstRate);
        $pct = $change->div($firstRate)->mul(Decimal::fromInt(100))->quantize(4);
        $note = $window['notes'] !== [] ? implode(' ', $window['notes']) : null;
        $sign = $change->isNegative() ? '' : '+';
        $text = $code . '/VES from ' . $first->date . ' to ' . $last->date . ' (' . count($points) . ' days): '
            . Rules::num($firstRate) . ' -> ' . Rules::num($lastRate) . ' (' . $sign . $pct->toFixed(2) . '%). '
            . 'Min ' . Rules::num($minRate) . ' on ' . $min->date
            . ', max ' . Rules::num($maxRate) . ' on ' . $max->date . '.';

        return new History(
            currency: $code,
            points: $points,
            start: $first->date,
            end: $last->date,
            first: $first,
            last: $last,
            min: $min,
            max: $max,
            change: $change->toPlain(),
            changePct: $pct->toFixed(4),
            note: $note,
            summary: $note !== null ? $text . ' ' . $note : $text,
        );
    }

    /**
     * Converts $amount between VES, USD, EUR, CNY, TRY and RUB at the BCV rate.
     *
     * Cross rates go through the bolivar: amount * vesPerFrom / vesPerTo. The math is
     * exact decimal (no float drift; divisions keep 28 significant digits, half-up),
     * then $result is rounded half-up to $decimals places (default 2, 0 to 12; null
     * keeps full precision). Floats are read via their shortest decimal string (0.1
     * is exactly "0.1"); pass a string such as "1234.56" for exact input.
     *
     * @param int|float|string $amount non-negative amount, at most 1e15 ("1_000" and "1e3" are accepted)
     * @param string|\DateTimeInterface|null $date use the rate in effect that day instead of the latest one
     */
    public function convert(
        int|float|string $amount,
        string $from,
        string $to,
        string|\DateTimeInterface|null $date = null,
        ?int $decimals = 2,
    ): Conversion {
        $value = Rules::parseAmount($amount);
        $src = Rules::normalizeCurrency($from, true);
        $dst = Rules::normalizeCurrency($to, true);
        if ($src === $dst) {
            throw new InvalidCurrencyException('"from" and "to" are both ' . $src . '; choose two different currencies.');
        }
        $decimals = Rules::checkDecimals($decimals);
        $day = $date !== null ? Rules::parseDate($date) : null;
        $entry = $day !== null ? $this->dayEntry($day) : $this->latestEntry();
        [$entryDay, $effectiveDate] = Rules::entryDates($entry, $day);
        $theDay = $day ?? $entryDay;
        [$rf, $rt, $used] = Rules::conversionRates($entry, $src, $dst, $theDay);
        $rate = $rf->div($rt);
        // Multiply first (like the Python library): VES -> X stays exact longer.
        $exact = $value->mul($rf)->roundSignificant()->div($rt);
        $rounded = $decimals === null ? $exact : $exact->quantize($decimals);
        $note = $day !== null ? Rules::carryForwardNote($day, $effectiveDate) : null;
        $text = Rules::num($value, 2) . ' ' . $src . ' = ' . Rules::num($rounded, $decimals ?? 8) . ' ' . $dst
            . ' at the official BCV rate (effective ' . $effectiveDate . '; 1 ' . $src . ' = '
            . Rules::num($rate, 6) . ' ' . $dst . ').';

        return new Conversion(
            amount: $value->toPlain(),
            from: $src,
            to: $dst,
            result: $decimals === null ? $exact->toPlain() : $rounded->toFixed($decimals),
            resultExact: $exact->toPlain(),
            rate: $rate->toPlain(),
            ratesUsed: Rules::plainRates($used),
            date: $theDay,
            effectiveDate: $effectiveDate,
            carriedForward: $note !== null,
            decimals: $decimals,
            note: $note,
            summary: $note !== null ? $text . ' ' . $note : $text,
        );
    }

    /** Freshness of the published data (/api/v1/status.json). */
    public function status(): Status
    {
        $doc = self::expectObject($this->getJson(Rules::STATUS_PATH), Rules::STATUS_PATH);
        $updated = Rules::parseTimestamp($doc['updated_at'] ?? null);
        $ageHours = null;
        if ($updated !== null) {
            $seconds = ($this->clock)() - (float) $updated->format('U.u');
            $ageHours = round($seconds / 3600, 1);
        }
        $status = is_string($doc['status'] ?? null) ? $doc['status'] : 'unknown';
        $stale = $ageHours === null || $ageHours > Rules::STALE_AFTER_HOURS || $status !== 'ok';
        $text = static fn (mixed $v): ?string => is_string($v) ? $v : null;
        $day = static fn (mixed $v): ?string => Rules::isIsoDate($v) ? $v : null;
        $supported = $doc['supported_currencies'] ?? null;
        $currencies = $doc['currencies'] ?? null;
        $flags = [];
        if (is_array($currencies)) {
            foreach ($currencies as $k => $v) {
                $flags[(string) $k] = (bool) $v;
            }
        }
        $age = $ageHours !== null ? ' (' . self::hours($ageHours) . ' h ago)' : '';

        return new Status(
            status: $status,
            updatedAt: $updated,
            generatedAt: Rules::parseTimestamp($doc['generated_at'] ?? null),
            date: $day($doc['date'] ?? null),
            effectiveDate: $day($doc['effective_date'] ?? null),
            ageHours: $ageHours,
            stale: $stale,
            supportedCurrencies: is_array($supported) && array_is_list($supported)
                ? array_map(static fn (mixed $c): string => is_scalar($c) ? (string) $c : '', $supported)
                : Rules::CURRENCIES,
            currencies: $flags,
            timezone: $text($doc['timezone'] ?? null),
            apiVersion: $text($doc['api_version'] ?? null),
            summary: 'Status ' . $status . ($stale ? ' (STALE)' : '') . ': last capture '
                . ($text($doc['updated_at'] ?? null) ?? 'unknown') . $age . ', effective date '
                . ($day($doc['effective_date'] ?? null) ?? 'unknown') . '.',
            raw: $doc,
        );
    }

    // ------------------------------------------------------------ plumbing

    private static function hours(float $hours): string
    {
        return $hours == floor($hours) ? (string) (int) $hours : (string) $hours;
    }

    private function today(): string
    {
        return Rules::todayCaracas(($this->clock)());
    }

    /** @return array<string, mixed> */
    private function latestEntry(): array
    {
        return self::expectObject($this->getJson(Rules::LATEST_PATH), Rules::LATEST_PATH);
    }

    /** @return array<string, mixed> */
    private function dayEntry(string $date): array
    {
        Rules::checkDay($date, $this->today());
        try {
            return self::expectObject($this->getJson(Rules::dayPath($date)), 'day snapshot');
        } catch (NotFoundException) {
            $latest = null;
            try {
                $latest = $this->latest()->date;
            } catch (BcvException) {
                // keep the generic message
            }
            throw new DateOutOfRangeException(Rules::notPublishedMessage($date, $latest));
        }
    }

    /** @return list<array<string, mixed>> */
    private function historyEntries(): array
    {
        $data = $this->getJson(Rules::HISTORY_PATH);
        if (!is_array($data)) {
            throw new UpstreamException('Unexpected history.json shape (expected an array).');
        }
        $entries = [];
        foreach ($data as $item) {
            if ($item instanceof \stdClass) {
                $entries[] = self::toArray($item);
            }
        }

        return $entries;
    }

    /** @return array<string, mixed> */
    private static function expectObject(mixed $value, string $what): array
    {
        if (!$value instanceof \stdClass) {
            throw new UpstreamException('Unexpected ' . $what . ' shape (expected an object).');
        }

        return self::toArray($value);
    }

    /** @return array<string, mixed> */
    private static function toArray(\stdClass $object): array
    {
        $out = [];
        foreach (get_object_vars($object) as $key => $value) {
            $out[(string) $key] = self::plain($value);
        }

        return $out;
    }

    private static function plain(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            return self::toArray($value);
        }
        if (is_array($value)) {
            return array_map(self::plain(...), $value);
        }

        return $value;
    }

    /** Parsed JSON of a path (objects as \stdClass), served from the cache when fresh. Errors are never cached. */
    private function getJson(string $path): mixed
    {
        $key = 'bcv-today.' . sha1($this->baseUrl . $path);
        if ($this->cacheTtl > 0) {
            /** @var mixed $hit */
            $hit = $this->cache->get($key);
            if (is_string($hit)) {
                try {
                    return json_decode($hit, false, 512, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    // corrupted cache entry: fetch again
                }
            }
        }
        $headers = ['Accept' => 'application/json', 'User-Agent' => $this->userAgent];
        try {
            $response = ($this->http)($this->baseUrl . $path, $headers, $this->timeout);
        } catch (BcvException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new UpstreamException(
                'Could not reach the BCV Today data API (' . $e->getMessage() . '). Try again in a moment.',
                null,
                $e,
            );
        }
        if (!$response instanceof Response) {
            throw new UpstreamException('The HTTP client returned ' . get_debug_type($response) . ' instead of ' . Response::class . '.');
        }
        if ($response->status === 404) {
            throw new NotFoundException('Not found: ' . $path);
        }
        if ($response->status < 200 || $response->status >= 300) {
            throw new UpstreamException(
                'The BCV Today data API answered HTTP ' . $response->status . ' for ' . $path . '. Try again in a moment.',
                $response->status,
            );
        }
        try {
            $value = json_decode($response->body, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new UpstreamException('The BCV Today data API returned invalid JSON for ' . $path . '.', null, $e);
        }
        if ($this->cacheTtl > 0) {
            $this->cache->set($key, $response->body, $this->cacheTtl);
        }

        return $value;
    }
}
