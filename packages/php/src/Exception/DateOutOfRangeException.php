<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/** The date is valid but no BCV data exists for it (too old, in the future, not published yet or outside history.json). */
class DateOutOfRangeException extends BcvException
{
}
