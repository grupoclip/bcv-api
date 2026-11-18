<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/**
 * Base class of every exception thrown on purpose by this library.
 *
 *     BcvException
 *     ├── InvalidArgumentException       an argument passed by the caller is invalid
 *     │   ├── InvalidDateException       bad date / not a real calendar day / bad range or days
 *     │   ├── InvalidCurrencyException   unknown currency code, or from === to
 *     │   └── InvalidAmountException     negative, non-finite or too large amount, bad decimals
 *     ├── DateOutOfRangeException        before 2021-08-02, in the future, not published yet,
 *     │                                  or outside the range covered by history.json
 *     ├── CurrencyNotAvailableException  valid code, but no rate for it that day
 *     ├── NotFoundException              the API answered HTTP 404
 *     └── UpstreamException              network failure, timeout, HTTP error or invalid JSON
 *
 * Mirrors the Python (bcv.errors) and JavaScript (bcv-today src/errors.ts) hierarchies.
 */
class BcvException extends \RuntimeException
{
}
