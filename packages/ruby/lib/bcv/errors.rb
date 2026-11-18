# frozen_string_literal: true

module BCV
  # Base class of every error raised on purpose by this library.
  #
  #   BCV::Error
  #   ├── BCV::InvalidArgument        an argument passed by the caller is invalid
  #   │   ├── BCV::InvalidDate        bad date, not a real calendar day, bad range or days
  #   │   ├── BCV::InvalidCurrency    unknown currency code, or from == to
  #   │   └── BCV::InvalidAmount      negative, non-finite or > 1e15 amount; bad decimals
  #   ├── BCV::DateOutOfRange         before 2021-08-02, in the future, not published yet,
  #   │                               or outside the range covered by history.json
  #   ├── BCV::CurrencyNotAvailable   valid code, but no rate for it that day
  #   ├── BCV::NotFound               the API answered HTTP 404
  #   └── BCV::UpstreamError          network failure, timeout, HTTP error or invalid JSON
  #
  # Mirrors the Python (bcv/errors.py), JavaScript and PHP clients.
  class Error < StandardError; end

  # An argument passed by the caller is invalid. Raised before any request is made.
  class InvalidArgument < Error; end

  # A date is malformed or not a real calendar day (expected YYYY-MM-DD), or a range/days is invalid.
  class InvalidDate < InvalidArgument; end

  # A currency code is not one of VES, USD, EUR, CNY, TRY or RUB (or is misused).
  class InvalidCurrency < InvalidArgument; end

  # An amount is negative, not finite, too large or not a number (or +decimals+ is invalid).
  class InvalidAmount < InvalidArgument; end

  # The date is valid but no BCV data exists for it (too old, future or not published).
  class DateOutOfRange < Error; end

  # The currency is supported, but the BCV data has no rate for it on that day.
  class CurrencyNotAvailable < Error; end

  # The BCV Today API answered HTTP 404 for a path.
  class NotFound < Error; end

  # The BCV Today API could not be reached or returned an unusable response.
  class UpstreamError < Error
    # HTTP status code, when the error came from an HTTP response (otherwise nil).
    attr_reader :status

    def initialize(message = nil, status: nil)
      super(message)
      @status = status
    end
  end
end
