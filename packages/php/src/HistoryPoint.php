<?php

declare(strict_types=1);

namespace BcvToday;

/** One daily entry of a History series. */
final class HistoryPoint
{
    /**
     * @param string $rate bolivars per unit of the series currency (exact decimal string)
     */
    public function __construct(
        public readonly string $date,
        public readonly string $effectiveDate,
        public readonly string $rate,
        public readonly bool $carriedForward,
    ) {
    }
}
