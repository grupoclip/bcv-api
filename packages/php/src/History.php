<?php

declare(strict_types=1);

namespace BcvToday;

use BcvToday\Internal\Rules;

/**
 * A daily rate series for one currency, oldest first (never empty).
 *
 * @implements \IteratorAggregate<int, HistoryPoint>
 */
final class History implements \Countable, \IteratorAggregate
{
    /**
     * @param list<HistoryPoint> $points
     * @param string $start first date of the series
     * @param string $end last date of the series
     * @param HistoryPoint $min lowest rate (earliest day on ties)
     * @param HistoryPoint $max highest rate (earliest day on ties)
     * @param string $change last rate minus first rate, exact decimal string
     * @param string $changePct percentage change from first to last, rounded half-up to 4 decimals
     * @param string|null $note explanation when the requested range was clipped to the available data
     */
    public function __construct(
        public readonly string $currency,
        public readonly array $points,
        public readonly string $start,
        public readonly string $end,
        public readonly HistoryPoint $first,
        public readonly HistoryPoint $last,
        public readonly HistoryPoint $min,
        public readonly HistoryPoint $max,
        public readonly string $change,
        public readonly string $changePct,
        public readonly ?string $note,
        public readonly string $summary,
        public readonly string $unit = Rules::UNIT,
        public readonly string $source = Rules::SOURCE,
    ) {
    }

    public function count(): int
    {
        return count($this->points);
    }

    /** @return \ArrayIterator<int, HistoryPoint> */
    public function getIterator(): \ArrayIterator
    {
        return new \ArrayIterator($this->points);
    }
}
