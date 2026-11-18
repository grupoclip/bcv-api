<?php

declare(strict_types=1);

namespace BcvToday;

use BcvToday\Internal\Rules;

/**
 * Result of Bcv::convert().
 *
 * $resultExact is amount * vesPerFrom / vesPerTo (VES counts as 1) computed with
 * exact decimal arithmetic (division to 28 significant digits, half-up); $result
 * is rounded half-up to $decimals places. All numbers are decimal strings.
 */
final class Conversion
{
    /**
     * @param string $amount the amount, exact decimal string
     * @param string $result rounded result with exactly $decimals places ("91664.77", "1.10"); unrounded when $decimals is null
     * @param string $resultExact unrounded result, exact decimal string (28 significant digits for divisions)
     * @param string $rate units of $to per 1 unit of $from (28 significant digits)
     * @param array<string, string> $ratesUsed bolivars per unit for the non-VES side(s) of the conversion
     * @param string $date requested date, or the date of the latest snapshot
     * @param int|null $decimals decimal places of $result (null = not rounded)
     */
    public function __construct(
        public readonly string $amount,
        public readonly string $from,
        public readonly string $to,
        public readonly string $result,
        public readonly string $resultExact,
        public readonly string $rate,
        public readonly array $ratesUsed,
        public readonly string $date,
        public readonly string $effectiveDate,
        public readonly bool $carriedForward,
        public readonly ?int $decimals,
        public readonly ?string $note,
        public readonly string $summary,
        public readonly string $source = Rules::SOURCE,
    ) {
    }
}
