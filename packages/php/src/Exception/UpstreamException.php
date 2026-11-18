<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/** The BCV Today API could not be reached or returned an unusable response. */
class UpstreamException extends BcvException
{
    /**
     * @param int|null $status HTTP status code, when the error came from an HTTP response
     */
    public function __construct(
        string $message,
        public readonly ?int $status = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $status ?? 0, $previous);
    }
}
