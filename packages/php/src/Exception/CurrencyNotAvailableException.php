<?php

declare(strict_types=1);

namespace BcvToday\Exception;

/** The currency is supported, but the BCV data has no rate for it on that day. */
class CurrencyNotAvailableException extends BcvException
{
}
