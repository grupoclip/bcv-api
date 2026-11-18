<?php

declare(strict_types=1);

namespace BcvToday\Laravel\Facades;

use Illuminate\Support\Facades\Facade;

/**
 * Laravel facade for BcvToday\Bcv (alias "Bcv" via package auto-discovery).
 *
 * @method static \BcvToday\Rates latest()
 * @method static \BcvToday\DayRate on(string|\DateTimeInterface $date, ?string $currency = null)
 * @method static \BcvToday\History history(string $currency, int $days = 30, string|\DateTimeInterface|null $start = null, string|\DateTimeInterface|null $end = null)
 * @method static \BcvToday\Conversion convert(int|float|string $amount, string $from, string $to, string|\DateTimeInterface|null $date = null, ?int $decimals = 2)
 * @method static \BcvToday\Status status()
 * @method static void clearCache()
 *
 * @see \BcvToday\Bcv
 */
final class Bcv extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return \BcvToday\Bcv::class;
    }
}
