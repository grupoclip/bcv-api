<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/** A currency code is not one of VES, USD, EUR, CNY, TRY or RUB (or "from" and "to" are the same). */
class InvalidCurrencyException extends InvalidArgumentException
{
}
