<?php

declare(strict_types=1);

namespace BcvToday;

use BcvToday\Internal\Rules;

/** The official BCV rates currently in effect (/api/v1/rate.json). */
final class Rates
{
    /**
     * @param array<string, string> $rates bolivars per unit as exact decimal strings, in USD, EUR, CNY, TRY, RUB order
     * @param string $date calendar date of the snapshot (YYYY-MM-DD)
     * @param string $effectiveDate official BCV validity date ("fecha valor")
     * @param \DateTimeImmutable|null $updatedAt UTC capture time, when known
     * @param string $summary one-line English description
     * @param array<string, mixed> $raw the entry as published by the API
     */
    public function __construct(
        public readonly array $rates,
        public readonly string $date,
        public readonly string $effectiveDate,
        public readonly ?\DateTimeImmutable $updatedAt,
        public readonly string $summary,
        public readonly array $raw,
        public readonly string $unit = Rules::UNIT,
        public readonly string $source = Rules::SOURCE,
    ) {
    }

    /**
     * Bolivars per unit of $currency ("USD", case-insensitive), or null when it was not published.
     *
     * @throws Exception\InvalidCurrencyException for an unknown currency code
     */
    public function rate(string $currency): ?string
    {
        return $this->rates[Rules::normalizeCurrency($currency)] ?? null;
    }
}
