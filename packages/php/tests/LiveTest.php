<?php

declare(strict_types=1);

namespace BcvToday\Tests;

use BcvToday\Bcv;
use BcvToday\Exception\DateOutOfRangeException;
use BcvToday\Http\StreamTransport;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Live checks against https://bcv.today. Opt-in:
 *   BCV_LIVE=1 vendor/bin/phpunit --group live
 */
#[Group('live')]
final class LiveTest extends TestCase
{
    private static ?Bcv $bcv = null;

    protected function setUp(): void
    {
        if (getenv('BCV_LIVE') !== '1') {
            self::markTestSkipped('live API test; set BCV_LIVE=1 to run');
        }
        self::$bcv ??= new Bcv(timeout: 20);
    }

    private static function bcv(): Bcv
    {
        self::assertNotNull(self::$bcv);

        return self::$bcv;
    }

    public function testLatest(): void
    {
        $r = self::bcv()->latest();
        self::assertNotNull($r->rate('USD'));
        self::assertGreaterThan(0, (float) $r->rate('USD'));
        self::assertGreaterThanOrEqual('2026-01-01', $r->effectiveDate);
    }

    public function testWeekendCarryForward(): void
    {
        $d = self::bcv()->on('2026-01-04', 'USD');
        self::assertSame('2026-01-03', $d->effectiveDate);
        self::assertTrue($d->carriedForward);
        self::assertSame('304.6796', $d->rate);
    }

    public function testFirstSnapshot(): void
    {
        self::assertGreaterThan(0, (float) self::bcv()->on('2021-08-02', 'USD')->rate);
        $this->expectException(DateOutOfRangeException::class);
        self::bcv()->on('2021-08-01');
    }

    public function testConvertAndHistory(): void
    {
        $c = self::bcv()->convert(100, 'USD', 'VES');
        self::assertGreaterThan(0, (float) $c->result);
        self::assertSame(self::bcv()->latest()->rate('USD'), $c->ratesUsed['USD']);
        $h = self::bcv()->history('USD', days: 7);
        self::assertGreaterThanOrEqual(1, count($h));
        self::assertLessThanOrEqual(7, count($h));
    }

    public function testStatus(): void
    {
        $s = self::bcv()->status();
        self::assertSame('ok', $s->status);
        self::assertContains('USD', $s->supportedCurrencies);
    }

    public function testStreamTransportWithoutCurl(): void
    {
        $bcv = new Bcv(timeout: 20, httpClient: new StreamTransport());
        self::assertNotNull($bcv->latest()->rate('USD'));
        self::assertSame('304.6796', $bcv->on('2026-01-04', 'USD')->rate);
    }
}
