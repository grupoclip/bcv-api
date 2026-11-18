<?php

declare(strict_types=1);

namespace BcvToday\Tests;

use BcvToday\Bcv;
use BcvToday\Cache\MemoryCache;
use BcvToday\Exception\BcvException;
use BcvToday\Exception\CurrencyNotAvailableException;
use BcvToday\Exception\DateOutOfRangeException;
use BcvToday\Exception\InvalidAmountException;
use BcvToday\Exception\InvalidArgumentException;
use BcvToday\Exception\InvalidCurrencyException;
use BcvToday\Exception\InvalidDateException;
use BcvToday\Exception\NotFoundException;
use BcvToday\Exception\UpstreamException;
use BcvToday\Http\Response;
use BcvToday\Internal\Rules;
use BcvToday\Version;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Same scenarios and expected values as packages/python/tests/test_client.py and
 * packages/js/test/unit/client.test.mjs, on the shared fixtures.
 */
final class BcvTest extends TestCase
{
    private const SUNDAY_NOTE = '2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV rate '
        . 'stays in effect until the next publication (weekends and holidays carry it forward).';

    private FakeHttp $http;
    private Bcv $bcv;

    protected function setUp(): void
    {
        $this->http = new FakeHttp();
        $this->bcv = FakeHttp::client($this->http);
    }

    /** @param class-string<\Throwable> $class */
    private function assertThrows(string $class, string $pattern, callable $fn): void
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            self::assertInstanceOf($class, $e, $e->getMessage());
            self::assertMatchesRegularExpression($pattern, $e->getMessage());

            return;
        }
        self::fail('Expected ' . $class);
    }

    private static function rateJson(string $json): Bcv
    {
        return FakeHttp::client(new FakeHttp([FakeHttp::PREFIX . 'rate.json' => new Response(200, $json)]));
    }

    // ------------------------------------------------------------ latest

    public function testLatestParsesExactRatesAndDates(): void
    {
        $r = $this->bcv->latest();
        self::assertSame(['USD' => '916.6477', 'EUR' => '1007.38665582', 'CNY' => '137.52328442', 'TRY' => '18.21021713', 'RUB' => '11.17192733'], $r->rates);
        self::assertSame('916.6477', $r->rate('USD'));
        self::assertSame('18.21021713', $r->rate('try'));
        self::assertSame('2026-11-18', $r->date);
        self::assertSame('2026-11-18', $r->effectiveDate);
        self::assertNotNull($r->updatedAt);
        self::assertSame('2026-11-18T02:01:03.699523+00:00', $r->updatedAt->format('Y-m-d\TH:i:s.uP'));
        self::assertStringContainsString('bcv.today', $r->source);
        self::assertSame(Rules::UNIT, $r->unit);
        self::assertSame(916.6477, $r->raw['USD']);
        self::assertStringStartsWith('Official BCV rates (effective 2026-11-18, Bs. per unit): USD 916.6477, EUR 1,007.3867', $r->summary);
        $this->assertThrows(InvalidCurrencyException::class, '/Unsupported currency "XYZ"/', fn () => $r->rate('XYZ'));
    }

    public function testMissingCurrencyInLatestIsNull(): void
    {
        $r = self::rateJson('{"USD": 1, "date": "2026-01-02"}')->latest();
        self::assertSame(['USD' => '1'], $r->rates);
        self::assertNull($r->rate('EUR'));
        self::assertNull($r->updatedAt);
    }

    public function testUserAgentAcceptAndTimeout(): void
    {
        $this->bcv->latest();
        self::assertSame([FakeHttp::PREFIX . 'rate.json'], $this->http->calls);
        self::assertSame('bcv-today-php/' . Version::VERSION . ' (+https://bcv.today)', $this->http->headers[0]['User-Agent']);
        self::assertSame('application/json', $this->http->headers[0]['Accept']);
        self::assertSame(10.0, $this->http->timeouts[0]);
    }

    public function testCustomBaseUrlUserAgentAndTimeout(): void
    {
        $seen = [];
        $http = static function (string $url, array $headers, float $timeout) use (&$seen): Response {
            $seen[] = [$url, $headers['User-Agent'] ?? null, $timeout];

            return new Response(200, '{"USD": 1, "date": "2026-01-02"}');
        };
        $bcv = new Bcv(baseUrl: 'https://example.test/', timeout: 3, userAgent: 'me/1', httpClient: $http);
        self::assertSame('1', $bcv->latest()->rate('USD'));
        self::assertSame([['https://example.test/api/v1/rate.json', 'me/1', 3.0]], $seen);
    }

    public function testParseTimestampVariants(): void
    {
        $fmt = static fn (?\DateTimeImmutable $d): ?string => $d?->format('Y-m-d\TH:i:s.uP');
        self::assertSame('2026-01-05T21:00:00.000000+00:00', $fmt(Rules::parseTimestamp('2026-01-05T21:00:00Z')));
        self::assertSame('2026-01-05T21:00:00.100000+00:00', $fmt(Rules::parseTimestamp('2026-01-05T21:00:00.1+00:00')));
        self::assertSame('2026-01-05T21:00:00.123456+00:00', $fmt(Rules::parseTimestamp('2026-01-05T21:00:00.123456789Z')));
        self::assertSame('2026-01-05T21:00:00.000000+00:00', $fmt(Rules::parseTimestamp('2026-01-05T17:00:00-04:00')));
        self::assertNull(Rules::parseTimestamp('garbage'));
        self::assertNull(Rules::parseTimestamp(null));
    }

    // ------------------------------------------------------------ on() / carry-forward

    public function testOnBusinessDayIsNotCarried(): void
    {
        $d = $this->bcv->on('2026-01-06');
        self::assertSame('2026-01-06', $d->date);
        self::assertSame('2026-01-06', $d->effectiveDate);
        self::assertFalse($d->carriedForward);
        self::assertNull($d->note);
        self::assertSame(['USD', 'EUR'], array_keys($d->rates));
        self::assertNull($d->rate);
        self::assertSame(FakeHttp::PREFIX . 'history/2026-01-06.json', $this->http->calls[0]);
    }

    public function testOnSundayCarriesForwardSaturday(): void
    {
        $d = $this->bcv->on('2026-01-04', 'usd');
        self::assertSame('2026-01-04', $d->date);
        self::assertSame('2026-01-03', $d->effectiveDate);
        self::assertTrue($d->carriedForward);
        self::assertSame('304.6796', $d->rate);
        self::assertSame(['USD' => '304.6796'], $d->rates);
        self::assertSame(self::SUNDAY_NOTE, $d->note);
        self::assertSame('BCV rate in effect on 2026-01-04 (Bs. per unit): USD 304.6796. ' . self::SUNDAY_NOTE, $d->summary);
    }

    public function testOnAcceptsDateTimeObjects(): void
    {
        self::assertSame('2026-01-06', $this->bcv->on(new \DateTimeImmutable('2026-01-06 23:59:00'))->date);
    }

    public function testOnCurrencyMissingOnOldDay(): void
    {
        $this->assertThrows(
            CurrencyNotAvailableException::class,
            '/^No EUR rate in the BCV data for 2021-08-02 \(older entries may lack some currencies\)\. Available that day: USD\.$/',
            fn () => $this->bcv->on('2021-08-02', 'EUR'),
        );
    }

    /** @return iterable<string, array{string}> */
    public static function badDates(): iterable
    {
        foreach (['2026-02-30', '2026-1-4', '04/01/2026', '', '2026-01-04T00:00', 'nope'] as $bad) {
            yield $bad === '' ? 'empty' : $bad => [$bad];
        }
    }

    #[DataProvider('badDates')]
    public function testOnInvalidDateMakesNoRequest(string $bad): void
    {
        $this->assertThrows(
            InvalidDateException::class,
            '/^Invalid date "' . preg_quote($bad, '/') . '": use a real calendar date in YYYY-MM-DD format, e\.g\. 2026-01-02\.$/',
            fn () => $this->bcv->on($bad),
        );
        self::assertSame([], $this->http->calls);
    }

    public function testOnBeforeFirstSnapshot(): void
    {
        $this->assertThrows(
            DateOutOfRangeException::class,
            '/^No BCV data for 2021-08-01: daily snapshots start on 2021-08-02\.$/',
            fn () => $this->bcv->on('2021-08-01'),
        );
    }

    public function testOnFutureDate(): void
    {
        $this->assertThrows(
            DateOutOfRangeException::class,
            '/^2026-11-20 is in the future \(today in Caracas is 2026-11-18\); BCV rates are only known up to the next business day\.$/',
            fn () => $this->bcv->on('2026-11-20'),
        );
    }

    public function testOnTomorrowAllowedButNotPublished(): void
    {
        $this->assertThrows(
            DateOutOfRangeException::class,
            '/^No BCV rate published yet for 2026-11-19\. Daily snapshots are available from 2021-08-02 to 2026-11-18\. Use latest\(\) for the rate currently in effect\.$/',
            fn () => $this->bcv->on('2026-11-19'),
        );
        self::assertSame(FakeHttp::PREFIX . 'rate.json', $this->http->calls[count($this->http->calls) - 1]);
    }

    public function testSnapshot404WithLatestFailureUsesGenericMessage(): void
    {
        $http = new FakeHttp([FakeHttp::PREFIX . 'rate.json' => new Response(500, 'x')]);
        $this->assertThrows(
            DateOutOfRangeException::class,
            '/to the latest business day\. Use latest\(\)/',
            fn () => FakeHttp::client($http)->on('2026-11-19'),
        );
    }

    public function testCaracasTodayIsUtcMinus4(): void
    {
        // 02:00 UTC on the 19th is still the 18th in Caracas: the 20th is "future".
        $bcv = FakeHttp::client(null, 300, (float) gmmktime(2, 0, 0, 11, 19, 2026));
        $this->assertThrows(DateOutOfRangeException::class, '/today in Caracas is 2026-11-18/', fn () => $bcv->on('2026-11-20'));
    }

    public function testInvalidCurrency(): void
    {
        $this->assertThrows(
            InvalidCurrencyException::class,
            '/^Unsupported currency "GBP": use one of USD, EUR, CNY, TRY, RUB\.$/',
            fn () => $this->bcv->on('2026-01-06', 'GBP'),
        );
    }

    // ------------------------------------------------------------ history

    public function testHistoryLastNDays(): void
    {
        $h = $this->bcv->history('USD', days: 7);
        self::assertCount(7, $h);
        self::assertSame('2026-11-12', $h->start);
        self::assertSame('2026-11-18', $h->end);
        $dates = array_map(static fn ($p) => $p->date, $h->points);
        $sorted = $dates;
        sort($sorted);
        self::assertSame($sorted, $dates);
        self::assertSame($h->points[0], $h->first);
        self::assertNull($h->note);
        // change and changePct are exact decimals, the same digits as Python's Decimal.
        self::assertMatchesRegularExpression('/^-?\d+(\.\d+)?$/', $h->change);
        self::assertMatchesRegularExpression('/^-?\d+\.\d{4}$/', $h->changePct);
        self::assertStringStartsWith('USD/VES from 2026-11-12 to 2026-11-18 (7 days): ', $h->summary);
    }

    public function testHistoryRangeCarryFlagsAndStats(): void
    {
        $h = $this->bcv->history('eur', start: '2026-01-01', end: new \DateTimeImmutable('2026-01-06'));
        self::assertSame(
            ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'],
            array_map(static fn ($p) => $p->date, iterator_to_array($h)),
        );
        self::assertSame([false, true, false, true, true, false], array_map(static fn ($p) => $p->carriedForward, $h->points));
        self::assertSame('354.4935', $h->first->rate);
        self::assertSame('360.5039', $h->last->rate);
        self::assertSame('2026-01-01', $h->min->date);
        self::assertSame('2026-01-06', $h->max->date);
        self::assertSame('6.0104', $h->change);
        // 6.0104 / 354.4935 * 100 = 1.69549...
        self::assertSame('1.6955', $h->changePct);
        self::assertSame('2026-01-01', $h->points[1]->effectiveDate);
        self::assertSame(
            'EUR/VES from 2026-01-01 to 2026-01-06 (6 days): 354.4935 -> 360.5039 (+1.70%). Min 354.4935 on 2026-01-01, max 360.5039 on 2026-01-06.',
            $h->summary,
        );
    }

    public function testHistoryMinMaxEarliestOnTies(): void
    {
        $h = $this->bcv->history('USD', start: '2026-01-03', end: '2026-01-05');
        self::assertSame('2026-01-03', $h->min->date);
        self::assertSame('2026-01-03', $h->max->date);
        self::assertSame('0', $h->change);
        self::assertSame('0.0000', $h->changePct);
    }

    public function testHistorySkipsEntriesWithoutCurrencyAndNotesClipping(): void
    {
        $h = $this->bcv->history('EUR', start: '2025-12-01', end: '2026-01-02');
        self::assertSame('2026-01-01', $h->start);
        self::assertSame('History for EUR starts on 2026-01-01; earlier dates were skipped.', $h->note);
        self::assertStringEndsWith(' History for EUR starts on 2026-01-01; earlier dates were skipped.', $h->summary);
    }

    public function testHistoryEndAfterLatestNote(): void
    {
        $h = $this->bcv->history('USD', start: '2026-11-17', end: '2026-12-31');
        self::assertSame('Latest available date is 2026-11-18.', $h->note);
    }

    public function testHistoryEmptyWindow(): void
    {
        $this->assertThrows(
            DateOutOfRangeException::class,
            '/^No USD rates between 2024-01-01 and 2024-01-31\. The history covers 2021-11-15 to 2026-11-18 for USD \(latest 1830 daily entries\)\. For older single days use on\(\)\.$/',
            fn () => $this->bcv->history('USD', start: '2024-01-01', end: '2024-01-31'),
        );
    }

    public function testHistoryBadArguments(): void
    {
        $this->assertThrows(
            InvalidDateException::class,
            '/^"start" \(2026-01-06\) must be on or before "end" \(2026-01-01\)\.$/',
            fn () => $this->bcv->history('USD', start: '2026-01-06', end: '2026-01-01'),
        );
        $this->assertThrows(InvalidDateException::class, '/^Invalid days 0: use a whole number from 1 to 1830\.$/', fn () => $this->bcv->history('USD', days: 0));
        $this->assertThrows(InvalidDateException::class, '/from 1 to 1830/', fn () => $this->bcv->history('USD', days: 1831));
        $this->assertThrows(InvalidDateException::class, '/^Invalid start "2026-13-01"/', fn () => $this->bcv->history('USD', start: '2026-13-01'));
        $this->assertThrows(InvalidCurrencyException::class, '/use one of USD, EUR, CNY, TRY, RUB\./', fn () => $this->bcv->history('VES'));
        self::assertSame([], $this->http->calls);
    }

    // ------------------------------------------------------------ convert

    public function testConvertUsdToVesAtLatestRate(): void
    {
        $c = $this->bcv->convert(100, 'USD', 'VES');
        self::assertSame('91664.77', $c->result);
        self::assertSame('91664.77', $c->resultExact);
        self::assertSame('100', $c->amount);
        self::assertSame('916.6477', $c->rate);
        self::assertSame(['USD' => '916.6477'], $c->ratesUsed);
        self::assertSame('2026-11-18', $c->date);
        self::assertSame('2026-11-18', $c->effectiveDate);
        self::assertFalse($c->carriedForward);
        self::assertNull($c->note);
        self::assertSame(2, $c->decimals);
        self::assertStringStartsWith('100.00 USD = 91,664.77 VES at the official BCV rate', $c->summary);
        self::assertSame(
            '100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; 1 USD = 916.647700 VES).',
            $c->summary,
        );
    }

    public function testConvertVesToUsdRoundsHalfUpAndKeepsTrailingZero(): void
    {
        $c = $this->bcv->convert('1000', 'ves', 'usd');
        self::assertSame('1.09', $c->result);
        self::assertSame('1.090931663276960166921271935', $c->resultExact); // = Python Decimal (prec 28, ROUND_HALF_UP)
        self::assertSame(['USD' => '916.6477'], $c->ratesUsed);
        self::assertSame('1.10', $this->bcv->convert('1008.3125', 'VES', 'USD')->result);
    }

    public function testConvertCrossRatesThroughVes(): void
    {
        $c = $this->bcv->convert('50', 'EUR', 'USD', decimals: null);
        self::assertSame('1.098989999996727205010169119', $c->rate);
        self::assertSame('54.94949999983636025050845597', $c->resultExact);
        self::assertSame($c->resultExact, $c->result);
        self::assertNull($c->decimals);
        self::assertSame(['EUR', 'USD'], array_keys($c->ratesUsed));
        self::assertSame('0.7325207946193407238579097339', $this->bcv->convert(0.1, 'EUR', 'CNY')->resultExact);
        $e = $this->bcv->convert('123456.789', 'CNY', 'RUB', decimals: 4);
        self::assertSame('1519718.362438267612684158052', $e->resultExact);
        self::assertSame('1519718.3624', $e->result);
    }

    public function testConvertVesAndEurBothWays(): void
    {
        $toVes = $this->bcv->convert('100', 'EUR', 'VES');
        self::assertSame('100738.67', $toVes->result);
        self::assertSame('100738.665582', $toVes->resultExact);
        self::assertSame(['EUR' => '1007.38665582'], $toVes->ratesUsed);
        $toEur = $this->bcv->convert('100738.665582', 'VES', 'EUR', decimals: null);
        self::assertSame('100', $toEur->resultExact);
        // Expected digits computed with Python's decimal module (prec 28, ROUND_HALF_UP).
        self::assertSame('0.0009926675067836913567585160114', $this->bcv->convert(1, 'VES', 'EUR', decimals: null)->rate);
        $k = $this->bcv->convert('1000', 'VES', 'EUR');
        self::assertSame('0.9926675067836913567585160114', $k->resultExact);
        self::assertSame('0.99', $k->result);
        self::assertSame(['EUR' => '1007.38665582'], $k->ratesUsed);
    }

    public function testConvertRoundingHalfUpOnExactTies(): void
    {
        $bcv = self::rateJson('{"USD": 2.5, "date": "2026-11-18"}');
        self::assertSame('0.00', $bcv->convert('0.001', 'USD', 'VES')->result); // 0.0025 -> 0.00
        self::assertSame('0.01', $bcv->convert('0.003', 'USD', 'VES')->result); // 0.0075 -> 0.01
        $t = $bcv->convert('0.005', 'USD', 'VES');
        self::assertSame('0.0125', $t->resultExact);
        self::assertSame('0.01', $t->result);
        self::assertSame('0.003', $bcv->convert('0.001', 'USD', 'VES', decimals: 3)->result); // 0.0025 -> 0.003
        self::assertSame('3', $bcv->convert(1, 'USD', 'VES', decimals: 0)->result); // 2.5 -> 3
        self::assertSame('0.1', $bcv->convert('0.3', 'VES', 'USD', decimals: 1)->result); // 0.12 -> 0.1
        self::assertSame('0.15', $bcv->convert('0.375', 'VES', 'USD')->result); // 0.15 exactly
        self::assertSame('0.005', $bcv->convert('0.0125', 'VES', 'USD', decimals: 3)->result);
    }

    public function testConvertHasNoBinaryFloatingPointNoise(): void
    {
        $bcv = self::rateJson('{"USD": 0.1, "EUR": 0.3, "date": "2026-11-18"}');
        $a = $bcv->convert(0.1, 'USD', 'VES', decimals: null);
        self::assertSame('0.1', $a->amount);
        self::assertSame('0.01', $a->resultExact); // 0.1 * 0.1 is 0.010000000000000002 in floats
        $b = $bcv->convert(3, 'USD', 'EUR', decimals: null);
        self::assertSame('1', $b->resultExact); // 3 * 0.1 / 0.3
        self::assertSame('0.3333333333333333333333333333', $b->rate);
        self::assertSame('9999999999999999.90', $bcv->convert('999999999999999.99', 'VES', 'USD', decimals: 2)->result);
        self::assertSame('0.10', $bcv->convert(1, 'USD', 'VES')->result);
        self::assertSame('100.00', $bcv->convert('1_000', 'USD', 'VES')->result);
        self::assertSame('100.00', $bcv->convert('1e3', 'USD', 'VES')->result);
        self::assertSame('0.00', $bcv->convert(0, 'USD', 'VES')->result);
    }

    public function testConvertOnDateCarriesForward(): void
    {
        $c = $this->bcv->convert(10, 'USD', 'VES', date: '2026-01-04');
        self::assertSame('3046.80', $c->result);
        self::assertSame('2026-01-04', $c->date);
        self::assertSame('2026-01-03', $c->effectiveDate);
        self::assertTrue($c->carriedForward);
        self::assertSame(self::SUNDAY_NOTE, $c->note);
    }

    public function testConvertCurrencyMissingThatDay(): void
    {
        $this->assertThrows(
            CurrencyNotAvailableException::class,
            '/^No BCV rate for EUR on 2021-08-02 \(older entries may lack some currencies\)\. Available: USD\.$/',
            fn () => $this->bcv->convert(1, 'USD', 'EUR', date: '2021-08-02'),
        );
    }

    /** @return iterable<string, array{int|float|string, string, string, class-string<\Throwable>, string}> */
    public static function invalidConversions(): iterable
    {
        yield 'same currency' => [1, 'USD', 'USD', InvalidCurrencyException::class, '/^"from" and "to" are both USD; choose two different currencies\.$/'];
        yield 'unknown currency' => [1, 'USD', 'GBP', InvalidCurrencyException::class, '/^Unsupported currency "GBP": use one of VES, USD, EUR, CNY, TRY, RUB\.$/'];
        yield 'negative' => [-1, 'USD', 'VES', InvalidAmountException::class, '/^Invalid amount -1: it must be zero or positive\.$/'];
        yield 'negative string' => ['-0.5', 'USD', 'VES', InvalidAmountException::class, '/zero or positive/'];
        yield 'not a number' => ['abc', 'USD', 'VES', InvalidAmountException::class, '/^Invalid amount "abc": expected a number\.$/'];
        yield 'empty' => ['', 'USD', 'VES', InvalidAmountException::class, '/expected a number/'];
        yield 'infinite' => [INF, 'USD', 'VES', InvalidAmountException::class, '/it must be a finite number/'];
        yield 'nan' => [NAN, 'USD', 'VES', InvalidAmountException::class, '/finite/'];
        yield 'Infinity string' => ['Infinity', 'USD', 'VES', InvalidAmountException::class, '/finite/'];
        yield 'too large' => ['1e16', 'USD', 'VES', InvalidAmountException::class, '/^Invalid amount "1e16": it must not exceed 1e15\.$/'];
    }

    /** @param class-string<\Throwable> $class */
    #[DataProvider('invalidConversions')]
    public function testConvertInvalidArgumentsMakeNoRequest(int|float|string $amount, string $from, string $to, string $class, string $pattern): void
    {
        $this->assertThrows($class, $pattern, fn () => $this->bcv->convert($amount, $from, $to));
        self::assertSame([], $this->http->calls);
    }

    public function testMaxAmountAndVefAlias(): void
    {
        $c = $this->bcv->convert(1e15, 'vef', 'USD');
        self::assertSame('VES', $c->from);
        self::assertSame('1000000000000000', $c->amount);
    }

    public function testBadDecimals(): void
    {
        foreach ([-1, 13] as $decimals) {
            $this->assertThrows(
                InvalidAmountException::class,
                '/^Invalid decimals ' . $decimals . ': use a whole number from 0 to 12, or null\.$/',
                fn () => $this->bcv->convert(1, 'USD', 'VES', decimals: $decimals),
            );
        }
    }

    // ------------------------------------------------------------ status

    public function testStatus(): void
    {
        $s = $this->bcv->status();
        self::assertSame('ok', $s->status);
        self::assertFalse($s->stale);
        self::assertSame(13.0, $s->ageHours); // 02:01 UTC -> 15:00 UTC
        self::assertSame(['USD', 'EUR', 'CNY', 'TRY', 'RUB'], $s->supportedCurrencies);
        self::assertSame('2026-11-18', $s->date);
        self::assertSame('2026-11-18', $s->effectiveDate);
        self::assertSame('America/Caracas', $s->timezone);
        self::assertSame('v1', $s->apiVersion);
        self::assertTrue($s->currencies['USD']);
        self::assertNotNull($s->generatedAt);
        self::assertSame(
            'Status ok: last capture 2026-11-18T02:01:03.699523+00:00 (13 h ago), effective date 2026-11-18.',
            $s->summary,
        );
    }

    public function testStatusIsStaleAfter96Hours(): void
    {
        $s = FakeHttp::client(null, 300, (float) gmmktime(3, 0, 0, 11, 22, 2026))->status();
        self::assertSame(97.0, $s->ageHours);
        self::assertTrue($s->stale);
        self::assertStringContainsString('STALE', $s->summary);
    }

    // ------------------------------------------------------------ upstream errors

    public function testHttpErrorIsUpstream(): void
    {
        $bcv = FakeHttp::client(new FakeHttp([FakeHttp::PREFIX . 'rate.json' => new Response(503, 'down')]));
        try {
            $bcv->latest();
            self::fail('expected UpstreamException');
        } catch (UpstreamException $e) {
            self::assertSame('The BCV Today data API answered HTTP 503 for /api/v1/rate.json. Try again in a moment.', $e->getMessage());
            self::assertSame(503, $e->status);
        }
    }

    public function testInvalidJsonIsUpstream(): void
    {
        $this->assertThrows(UpstreamException::class, '/^The BCV Today data API returned invalid JSON for \/api\/v1\/rate\.json\.$/', fn () => self::rateJson('<html>')->latest());
    }

    public function testWrongShapesAreUpstream(): void
    {
        $bcv = FakeHttp::client(new FakeHttp([
            FakeHttp::PREFIX . 'history.json' => new Response(200, '{}'),
            FakeHttp::PREFIX . 'rate.json' => new Response(200, '[]'),
        ]));
        $this->assertThrows(UpstreamException::class, '/^Unexpected history\.json shape \(expected an array\)\.$/', fn () => $bcv->history('USD'));
        $this->assertThrows(UpstreamException::class, '/^Unexpected \/api\/v1\/rate\.json shape \(expected an object\)\.$/', fn () => $bcv->latest());
        $this->assertThrows(UpstreamException::class, "/no valid 'date'/", fn () => self::rateJson('{"USD": 1}')->latest());
    }

    public function testNetworkFailureIsUpstream(): void
    {
        $boom = static function (): Response {
            throw new \RuntimeException('connection refused');
        };
        try {
            (new Bcv(httpClient: $boom))->latest();
            self::fail('expected UpstreamException');
        } catch (UpstreamException $e) {
            self::assertSame('Could not reach the BCV Today data API (connection refused). Try again in a moment.', $e->getMessage());
            self::assertNull($e->status);
            self::assertInstanceOf(\RuntimeException::class, $e->getPrevious());
        }
    }

    public function testHttpClientMustReturnAResponse(): void
    {
        $bcv = new Bcv(httpClient: static fn (): string => 'nope');
        $this->assertThrows(UpstreamException::class, '/returned string instead of BcvToday\\\\Http\\\\Response/', fn () => $bcv->latest());
    }

    public function test404OnAPlainPathIsNotFound(): void
    {
        $bcv = FakeHttp::client(new FakeHttp([FakeHttp::PREFIX . 'status.json' => new Response(404, '')]));
        $this->assertThrows(NotFoundException::class, '/^Not found: \/api\/v1\/status\.json$/', fn () => $bcv->status());
    }

    public function testHierarchy(): void
    {
        foreach (
            [
                InvalidDateException::class, InvalidCurrencyException::class, InvalidAmountException::class,
                DateOutOfRangeException::class, CurrencyNotAvailableException::class, UpstreamException::class,
                NotFoundException::class, InvalidArgumentException::class,
            ] as $class
        ) {
            self::assertTrue((new \ReflectionClass($class))->isSubclassOf(BcvException::class), $class);
        }
        self::assertTrue((new \ReflectionClass(InvalidDateException::class))->isSubclassOf(InvalidArgumentException::class));
        self::assertTrue((new \ReflectionClass(BcvException::class))->isSubclassOf(\RuntimeException::class));
    }

    public function testConstructorValidation(): void
    {
        $this->assertThrows(InvalidArgumentException::class, '/^Invalid baseUrl "file:\/\/\/etc": it must start with https:\/\/ or http:\/\/\.$/', fn () => new Bcv(baseUrl: 'file:///etc'));
        $this->assertThrows(InvalidArgumentException::class, '/timeout/', fn () => new Bcv(timeout: -1));
        $this->assertThrows(InvalidArgumentException::class, '/cacheTtl/', fn () => new Bcv(cacheTtl: -1));
        $this->assertThrows(InvalidArgumentException::class, '/PSR-16/', fn () => new Bcv(cache: new \stdClass()));
    }

    // ------------------------------------------------------------ cache

    public function testCacheTtl(): void
    {
        $now = 1000.0;
        $http = new FakeHttp();
        $bcv = new Bcv(cacheTtl: 300, httpClient: $http, clock: static function () use (&$now): float {
            return $now;
        });
        $bcv->latest();
        $bcv->latest();
        $bcv->convert(1, 'USD', 'VES');
        self::assertCount(1, $http->calls);
        $now += 299;
        $bcv->latest();
        self::assertCount(1, $http->calls);
        $now += 2;
        $bcv->latest();
        self::assertCount(2, $http->calls);
        $bcv->clearCache();
        $bcv->latest();
        self::assertCount(3, $http->calls);
    }

    public function testCacheDisabled(): void
    {
        $http = new FakeHttp();
        $bcv = FakeHttp::client($http, 0);
        $bcv->latest();
        $bcv->latest();
        self::assertCount(2, $http->calls);
    }

    public function testErrorsAreNotCached(): void
    {
        $http = new FakeHttp([FakeHttp::PREFIX . 'rate.json' => new Response(500, '')]);
        $bcv = FakeHttp::client($http);
        for ($i = 0; $i < 2; $i++) {
            try {
                $bcv->latest();
            } catch (UpstreamException) {
            }
        }
        self::assertCount(2, $http->calls);
    }

    public function testExternalPsr16StyleCacheIsSharedAcrossClients(): void
    {
        $store = new class () {
            /** @var array<string, mixed> */
            public array $items = [];
            /** @var list<int|null> */
            public array $ttls = [];

            public function get(string $key, mixed $default = null): mixed
            {
                return $this->items[$key] ?? $default;
            }

            public function set(string $key, mixed $value, ?int $ttl = null): bool
            {
                $this->items[$key] = $value;
                $this->ttls[] = $ttl;

                return true;
            }
        };
        $http = new FakeHttp();
        $one = new Bcv(cacheTtl: 120, cache: $store, httpClient: $http);
        $two = new Bcv(cacheTtl: 120, cache: $store, httpClient: $http);
        self::assertSame('916.6477', $one->latest()->rate('USD'));
        self::assertSame('916.6477', $two->latest()->rate('USD'));
        self::assertCount(1, $http->calls);
        self::assertSame([120], $store->ttls);
        $key = array_key_first($store->items);
        self::assertIsString($key);
        // PSR-16 keys must not contain {}()/\@:
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_.\-]+$/', $key);
        self::assertIsString($store->items[$key]);
    }

    public function testMemoryCacheEvictsAtCapacity(): void
    {
        $cache = new MemoryCache(static fn (): float => 0.0);
        for ($i = 0; $i < MemoryCache::MAX_ENTRIES; $i++) {
            $cache->set('k' . $i, $i, 10);
        }
        self::assertSame(0, $cache->get('k0'));
        $cache->set('overflow', 'x', 10);
        self::assertNull($cache->get('k0'));
        self::assertSame('x', $cache->get('overflow'));
        $cache->set('zero', 'x', 0);
        self::assertSame('d', $cache->get('zero', 'd'));
    }
}
