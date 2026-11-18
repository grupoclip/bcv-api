# frozen_string_literal: true

require_relative "version"
require_relative "constants"
require_relative "errors"
require_relative "models"
require_relative "http"
require_relative "internal/rules"

module BCV
  # Client for the free, read-only BCV Today API (https://bcv.today/api/).
  #
  # Rates are bolivars (VES) per one unit of USD, EUR, CNY, TRY or RUB, as published by
  # Banco Central de Venezuela. Unofficial project, not affiliated with the bank.
  #
  #   bcv = BCV::Client.new
  #   bcv.latest.rate("USD")                    # => "916.6477"
  #   bcv.on("2026-01-04", "USD").carried_forward? # => true (Sunday uses Saturday's rate)
  #   bcv.convert("100", "USD", "VES").result   # => "91664.77"
  #
  # Instances are thread-safe: the only mutable state is the cache, guarded by a Mutex.
  class Client
    DEFAULT_USER_AGENT = "bcv-ruby/#{VERSION} (+https://bcv.today)".freeze
    Rules = Internal::Rules
    private_constant :Rules

    attr_reader :base_url, :timeout, :cache_ttl, :user_agent

    # [base_url]   API origin (default https://bcv.today).
    # [timeout]    Per-request timeout in seconds (default 10; 0 disables it).
    # [cache_ttl]  Seconds to keep responses cached (default 300; 0 disables the cache).
    # [user_agent] User-Agent header (default "bcv-ruby/<version> (+https://bcv.today)").
    # [http]       Callable (url, headers, timeout) -> BCV::Response; defaults to Net::HTTP.
    # [clock]      Callable returning the current Time (or epoch seconds); used for "today in
    #              Caracas", the data age and the cache (testing hook). Default: the system clock.
    # [cache]      Optional shared store with read(key) and write(key, value, expires_in:), e.g.
    #              Rails.cache. Raw JSON bodies are stored. Default: a per-client in-memory cache.
    def initialize(base_url: DEFAULT_BASE_URL, timeout: 10, cache_ttl: 300, user_agent: nil,
                   http: nil, clock: nil, cache: nil)
      check_options(base_url, timeout, cache_ttl, http, clock, cache)
      @base_url = base_url.sub(%r{/+\z}, "")
      @timeout = timeout.to_f
      @cache_ttl = cache_ttl.to_f
      @user_agent = user_agent || DEFAULT_USER_AGENT
      @http = http || NetHTTPClient.new
      @clock = clock
      @store = cache
      @memory = MemoryCache.new
    end

    def inspect
      "#<BCV::Client base_url=#{base_url.inspect} timeout=#{timeout} cache_ttl=#{cache_ttl}>"
    end

    # Forgets every response held by the built-in in-memory cache.
    def clear_cache
      @memory.clear
      nil
    end

    # Official rates currently in effect (/api/v1/rate.json). Returns BCV::Rates.
    def latest
      Rules.build_rates(latest_entry)
    end

    # Rate(s) in effect on a calendar day (Date, Time or "YYYY-MM-DD"). Returns BCV::DayRate.
    #
    # BCV does not publish on weekends and holidays: the last published rate stays in effect,
    # so effective_date may be earlier than date and carried_forward? is then true, with an
    # English note. Data starts on 2021-08-02; dates after tomorrow (Caracas time) raise
    # BCV::DateOutOfRange. With +currency+, the result is restricted to it (raises
    # BCV::CurrencyNotAvailable if it was not published that day).
    def on(date, currency = nil)
      day = Rules.parse_date(date)
      code = currency.nil? ? nil : Rules.normalize_currency(currency)
      Rules.build_day_rate(day_entry(day), day, code)
    end

    # Daily series for one currency, oldest first. Returns BCV::History.
    #
    # Either the last +days+ calendar days ending on the latest published date (default 30,
    # max 1830), or an inclusive start:/end: range (+days+ is then ignored). Uses
    # /api/v1/history.json, which keeps the latest 1830 daily entries; ranges are clipped to
    # what it covers and History#note says so.
    def history(currency, days: 30, start: nil, end: nil)
      finish = binding.local_variable_get(:end)
      code = Rules.normalize_currency(currency)
      lo = start.nil? ? nil : Rules.parse_date(start, "start")
      hi = finish.nil? ? nil : Rules.parse_date(finish, "end")
      n = Rules.check_days(days)
      raise InvalidDate, %("start" (#{lo}) must be on or before "end" (#{hi}).) if lo && hi && lo > hi

      entries = Rules.expect_list(get_json(Rules::HISTORY_PATH))
      Rules.build_history(entries, code, n, lo, hi)
    end

    # Converts +amount+ between VES, USD, EUR, CNY, TRY and RUB at the BCV rate. Returns BCV::Conversion.
    #
    # Cross rates go through the bolivar: amount * VES_per_from / VES_per_to. The math is exact
    # decimal on Integers (divisions keep 28 significant digits, half-up), then +result+ is
    # rounded half-up to +decimals+ places (default 2, 0 to 12; nil keeps full precision).
    # Amounts may be Integer, String ("1234.56", "1_000", "1e3"), Float (read via its shortest
    # form, so 0.1 is exactly 0.1) or BigDecimal; at most 1e15.
    def convert(amount, from, to, date: nil, decimals: 2)
      value = Rules.parse_amount(amount)
      src = Rules.normalize_currency(from, allow_ves: true)
      dst = Rules.normalize_currency(to, allow_ves: true)
      raise InvalidCurrency, %("from" and "to" are both #{src}; choose two different currencies.) if src == dst

      places = Rules.check_decimals(decimals)
      day = date.nil? ? nil : Rules.parse_date(date)
      entry = day ? day_entry(day) : latest_entry
      Rules.build_conversion(entry, value, src, dst, day, places)
    end

    # Freshness of the published data (/api/v1/status.json). Returns BCV::Status.
    def status
      doc = Rules.expect_object(get_json(Rules::STATUS_PATH), Rules::STATUS_PATH)
      Rules.build_status(doc, now)
    end

    private

    def check_options(base_url, timeout, cache_ttl, http, clock, cache)
      unless base_url.is_a?(String) && base_url.match?(%r{\Ahttps?://})
        raise InvalidArgument, "Invalid base_url #{base_url.inspect}: it must start with https:// or http://."
      end

      { "timeout" => timeout, "cache_ttl" => cache_ttl }.each do |label, value|
        next if value.is_a?(Numeric) && value.real? && value.finite? && value >= 0

        raise InvalidArgument, "Invalid #{label} #{value.inspect}: use a number of seconds >= 0."
      end
      check_callable(http, "http", "(url, headers, timeout) -> BCV::Response")
      check_callable(clock, "clock", "() -> Time")
      return if cache.nil? || (cache.respond_to?(:read) && cache.respond_to?(:write))

      raise InvalidArgument, "Invalid cache: expected an object with read(key) and write(key, value, expires_in:), " \
                             "such as Rails.cache."
    end

    def check_callable(value, label, signature)
      return if value.nil? || value.respond_to?(:call)

      raise InvalidArgument, "Invalid #{label}: expected a callable #{signature}."
    end

    def now
      return Time.now.utc unless @clock

      value = @clock.call
      value.is_a?(Numeric) ? Time.at(value).utc : value.to_time.utc
    end

    def cache_now
      @clock ? now.to_f : Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def today
      Rules.today_caracas(now)
    end

    def latest_entry
      Rules.expect_object(get_json(Rules::LATEST_PATH), Rules::LATEST_PATH)
    end

    def day_entry(day)
      Rules.check_date(day, today)
      begin
        Rules.expect_object(get_json(Rules.day_path(day)), "day snapshot")
      rescue NotFound
        latest_day = begin
          latest.date
        rescue Error
          nil
        end
        raise Rules.not_published(day, latest_day), cause: nil
      end
    end

    def store_key(path)
      "bcv-ruby/#{@base_url}#{path}"
    end

    def get_json(path)
      if @cache_ttl.positive?
        if @store
          body = @store.read(store_key(path))
          return Rules.decode_json(body, path) if body.is_a?(String)
        else
          found, value = @memory.get(path, cache_now)
          return value if found
        end
      end
      body = fetch(path)
      value = Rules.decode_json(body, path)
      remember(path, body, value)
      value
    end

    def remember(path, body, value)
      return unless @cache_ttl.positive?

      if @store
        @store.write(store_key(path), body, expires_in: @cache_ttl)
      else
        @memory.set(path, value, @cache_ttl, cache_now)
      end
    end

    def fetch(path)
      headers = { "Accept" => "application/json", "User-Agent" => @user_agent }
      begin
        response = @http.call(@base_url + path, headers, @timeout)
      rescue Error
        raise
      rescue StandardError => e
        raise UpstreamError, "Could not reach the BCV Today data API (#{e.message}). Try again in a moment."
      end
      status, body = unpack(response)
      raise NotFound, "Not found: #{path}" if status == 404
      unless (200..299).cover?(status)
        raise UpstreamError.new(
          "The BCV Today data API answered HTTP #{status} for #{path}. Try again in a moment.", status: status
        )
      end
      body
    end

    def unpack(response)
      if response.respond_to?(:status) && response.respond_to?(:body)
        status = response.status
        body = response.body
      elsif response.is_a?(Array) && response.size == 2
        status, body = response
      end
      return [status, body.to_s] if status.is_a?(Integer)

      raise UpstreamError, "The HTTP client returned #{response.class} instead of BCV::Response."
    end
  end
end
