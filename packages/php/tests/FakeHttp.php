<?php

declare(strict_types=1);

namespace BcvToday\Tests;

use BcvToday\Bcv;
use BcvToday\Http\Response;

/**
 * Offline HTTP client serving the recorded API samples shared with the Python and
 * JavaScript clients (packages/python/tests/fixtures); records every call.
 */
final class FakeHttp
{
    public const FIXTURES = __DIR__ . '/../../python/tests/fixtures/';
    public const PREFIX = 'https://bcv.today/api/v1/';
    /** Frozen "now": 2026-11-18 11:00 in Caracas (the fixtures were recorded that day). */
    public const NOW = 1795014000.0; // 2026-11-18T15:00:00Z

    /** @var list<string> */
    public array $calls = [];
    /** @var list<array<string, string>> */
    public array $headers = [];
    /** @var list<float> */
    public array $timeouts = [];

    /**
     * @param array<string, Response|\Closure(string): Response> $overrides by URL
     */
    public function __construct(private readonly array $overrides = [])
    {
    }

    /** @param array<string, string> $headers */
    public function __invoke(string $url, array $headers, float $timeout): Response
    {
        $this->calls[] = $url;
        $this->headers[] = $headers;
        $this->timeouts[] = $timeout;
        $override = $this->overrides[$url] ?? null;
        if ($override instanceof \Closure) {
            return $override($url);
        }
        if ($override !== null) {
            return $override;
        }
        if (!str_starts_with($url, self::PREFIX)) {
            throw new \LogicException('unexpected URL ' . $url);
        }
        $path = self::FIXTURES . substr($url, strlen(self::PREFIX));
        if (!is_file($path)) {
            return new Response(404, '<html>404</html>');
        }

        return new Response(200, (string) file_get_contents($path));
    }

    /** A client on the fake transport with the frozen clock. */
    public static function client(?self $http = null, int $cacheTtl = 300, ?float $now = null): Bcv
    {
        $time = $now ?? self::NOW;

        return new Bcv(cacheTtl: $cacheTtl, httpClient: $http ?? new self(), clock: static fn (): float => $time);
    }
}
