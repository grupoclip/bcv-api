<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/** A date is malformed or not a real calendar day (expected YYYY-MM-DD), a range is reversed or days is invalid. */
class InvalidDateException extends InvalidArgumentException
{
}
