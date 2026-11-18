<?php

declare(strict_types=1);

namespace BcvToday\Http;

/** What an HTTP client callable returns: the status code and the raw body. */
final class Response
{
    public function __construct(
        public readonly int $status,
        public readonly string $body,
    ) {
    }
}
