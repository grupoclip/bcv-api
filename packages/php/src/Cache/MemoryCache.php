<?php

declare(strict_types=1);

namespace BcvToday\Cache;

/**
 * Tiny in-memory cache with a per-entry deadline, cleared when it grows past 64
 * keys. Same get/set/clear signatures as PSR-16 (without depending on psr/simple-cache).
 * Lives as long as the PHP process (one request under PHP-FPM); pass a shared
 * PSR-16 cache to Bcv for cross-request caching.
 */
final class MemoryCache
{
    public const MAX_ENTRIES = 64;

    /** @var array<string, array{0: float, 1: mixed}> */
    private array $data = [];

    /** @var \Closure(): float */
    private readonly \Closure $clock;

    /**
     * @param (callable(): float)|null $clock Unix time in seconds (testing hook)
     */
    public function __construct(?callable $clock = null)
    {
        $this->clock = $clock !== null ? \Closure::fromCallable($clock) : static fn (): float => microtime(true);
    }

    public function get(string $key, mixed $default = null): mixed
    {
        $hit = $this->data[$key] ?? null;
        if ($hit === null) {
            return $default;
        }
        if ($hit[0] <= ($this->clock)()) {
            unset($this->data[$key]);

            return $default;
        }

        return $hit[1];
    }

    /** @param int|\DateInterval|null $ttl seconds; null keeps the entry for an hour, <= 0 deletes it */
    public function set(string $key, mixed $value, int|\DateInterval|null $ttl = null): bool
    {
        if ($ttl instanceof \DateInterval) {
            $now = new \DateTimeImmutable('@0');
            $ttl = $now->add($ttl)->getTimestamp();
        }
        $ttl ??= 3600;
        if ($ttl <= 0) {
            unset($this->data[$key]);

            return true;
        }
        if (count($this->data) >= self::MAX_ENTRIES) {
            $this->data = [];
        }
        $this->data[$key] = [($this->clock)() + $ttl, $value];

        return true;
    }

    public function delete(string $key): bool
    {
        unset($this->data[$key]);

        return true;
    }

    public function clear(): bool
    {
        $this->data = [];

        return true;
    }
}
