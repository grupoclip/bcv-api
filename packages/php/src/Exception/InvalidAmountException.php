<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/** An amount is negative, not finite, too large or not a number (or decimals is invalid). */
class InvalidAmountException extends InvalidArgumentException
{
}
