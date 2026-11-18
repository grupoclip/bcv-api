<?php

declare(strict_types=1);

namespace BcvToday;

use BcvToday\Internal\Rules;

/** The BCV rate(s) in effect on one calendar day (/api/v1/history/{date}.json). */
final class DayRate
{
    /**
     * @param string $date the calendar day that was requested
     * @param string $effectiveDate date of the BCV publication in effect that day (earlier on weekends/holidays)
     * @param bool $carriedForward true when $effectiveDate differs from $date
     * @param array<string, string> $rates bolivars per unit (only the requested currency when one was given)
     * @param string|null $rate the single rate when exactly one currency is present (e.g. on($d, 'USD'))
     * @param string|null $note English explanation of the carry-forward, when it applies
     * @param array<string, mixed> $raw the entry as published by the API
     */
    public function __construct(
        public readonly string $date,
        public readonly string $effectiveDate,
        public readonly bool $carriedForward,
        public readonly array $rates,
        public readonly ?string $rate,
        public readonly ?\DateTimeImmutable $updatedAt,
        public readonly ?string $note,
        public readonly string $summary,
        public readonly array $raw,
        public readonly string $unit = Rules::UNIT,
        public readonly string $source = Rules::SOURCE,
    ) {
    }
}
