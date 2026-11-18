<?php

declare(strict_types=1);

namespace BcvToday;

/** Freshness of the published data (/api/v1/status.json). */
final class Status
{
    /**
     * @param float|null $ageHours hours since $updatedAt (one decimal), when known
     * @param bool $stale true when status is not "ok" or the last capture is older than 96 hours
     * @param list<string> $supportedCurrencies
     * @param array<string, bool> $currencies
     * @param array<string, mixed> $raw the document as published by the API
     */
    public function __construct(
        public readonly string $status,
        public readonly ?\DateTimeImmutable $updatedAt,
        public readonly ?\DateTimeImmutable $generatedAt,
        public readonly ?string $date,
        public readonly ?string $effectiveDate,
        public readonly ?float $ageHours,
        public readonly bool $stale,
        public readonly array $supportedCurrencies,
        public readonly array $currencies,
        public readonly ?string $timezone,
        public readonly ?string $apiVersion,
        public readonly string $summary,
        public readonly array $raw,
    ) {
    }
}
