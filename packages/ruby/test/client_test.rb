# frozen_string_literal: true

require "test_helper"

# Same scenarios and expected values as packages/python/tests/test_client.py,
# packages/js/test/unit/client.test.mjs and packages/php/tests/BcvTest.php, on the shared fixtures.
class ClientTest < Minitest::Test
  include Helpers

  def setup
    @http = FakeHttp.new
    @bcv = FakeHttp.client(@http)
  end

  # ------------------------------------------------------------ latest

  def test_latest_parses_exact_rates_and_dates
    r = @bcv.latest
    assert_equal({ "USD" => "916.6477", "EUR" => "1007.38665582", "CNY" => "137.52328442",
                   "TRY" => "18.21021713", "RUB" => "11.17192733" }, r.rates)
    assert_equal "916.6477", r.rate("USD")
    assert_equal "18.21021713", r.rate("try")
    assert_equal "137.52328442", r[:cny]
    assert_equal d("2026-11-18"), r.date
    assert_equal d("2026-11-18"), r.effective_date
    assert_equal Time.utc(2026, 11, 18, 2, 1, 3.699523r), r.updated_at
    assert_predicate r.updated_at, :utc?
    assert_includes r.source, "bcv.today"
    assert_equal BCV::UNIT, r.unit
    assert_in_delta 916.6477, r.raw["USD"]
    assert r.summary.start_with?(
      "Official BCV rates (effective 2026-11-18, Bs. per unit): USD 916.6477, EUR 1,007.3867"
    )
    assert_equal r.summary, r.to_s
    assert_raises_message(BCV::InvalidCurrency, /\AUnsupported currency "XYZ"/) { r.rate("XYZ") }
  end

  def test_results_are_immutable
    r = @bcv.latest
    assert_predicate r, :frozen?
    assert_predicate r.rates, :frozen?
    assert_predicate r.raw, :frozen?
    assert_raises(FrozenError) { r.rates["USD"] = "1" }
    refute_respond_to r, :rates=
  end

  def test_missing_currency_in_latest_is_nil
    r = rate_json('{"USD": 1, "date": "2026-01-02"}').latest
    assert_equal({ "USD" => "1" }, r.rates)
    assert_nil r.rate("EUR")
    assert_nil r.updated_at
  end

  def test_user_agent_accept_and_timeout
    @bcv.latest
    assert_equal ["#{FakeHttp::PREFIX}rate.json"], @http.calls
    assert_equal "bcv-ruby/#{BCV::VERSION} (+https://bcv.today)", @http.headers[0]["User-Agent"]
    assert_equal "application/json", @http.headers[0]["Accept"]
    assert_in_delta 10.0, @http.timeouts[0]
  end

  def test_custom_base_url_user_agent_and_timeout
    seen = []
    http = lambda do |url, headers, timeout|
      seen << [url, headers["User-Agent"], timeout]
      BCV::Response.new(status: 200, body: '{"USD": 1, "date": "2026-01-02"}')
    end
    bcv = BCV::Client.new(base_url: "https://example.test/", timeout: 3, user_agent: "me/1", http: http)
    assert_equal "1", bcv.latest.rate("USD")
    assert_equal [["https://example.test/api/v1/rate.json", "me/1", 3.0]], seen
  end

  def test_http_may_return_a_status_body_pair
    bcv = BCV::Client.new(http: ->(*) { [200, '{"USD": 2.5, "date": "2026-01-02"}'] })
    assert_equal "2.5", bcv.latest.rate("USD")
  end

  def test_parse_timestamp_variants
    parse = ->(v) { BCV::Internal::Rules.parse_timestamp(v) }
    assert_equal Time.utc(2026, 1, 5, 21), parse.call("2026-01-05T21:00:00Z")
    assert_equal Time.utc(2026, 1, 5, 21, 0, 0.1r), parse.call("2026-01-05T21:00:00.1+00:00")
    assert_equal Time.utc(2026, 1, 5, 21, 0, 0.123456789r), parse.call("2026-01-05T21:00:00.123456789Z")
    assert_equal Time.utc(2026, 1, 5, 21), parse.call("2026-01-05T17:00:00-04:00")
    assert_equal Time.utc(2026, 1, 5, 21), parse.call("2026-01-05T21:00:00")
    assert_nil parse.call("garbage")
    assert_nil parse.call(nil)
  end

  # ------------------------------------------------------------ on() / carry-forward

  def test_on_business_day_is_not_carried
    r = @bcv.on("2026-01-06")
    assert_equal d("2026-01-06"), r.date
    assert_equal d("2026-01-06"), r.effective_date
    refute_predicate r, :carried_forward?
    assert_nil r.note
    assert_equal %w[USD EUR], r.rates.keys
    assert_nil r.rate
    assert_equal "#{FakeHttp::PREFIX}history/2026-01-06.json", @http.calls[0]
  end

  def test_on_sunday_carries_forward_saturday
    r = @bcv.on("2026-01-04", "usd")
    assert_equal d("2026-01-04"), r.date
    assert_equal d("2026-01-03"), r.effective_date
    assert_predicate r, :carried_forward?
    assert_equal "304.6796", r.rate
    assert_equal "304.6796", r.rate("USD")
    assert_equal({ "USD" => "304.6796" }, r.rates)
    assert_equal SUNDAY_NOTE, r.note
    assert_equal "BCV rate in effect on 2026-01-04 (Bs. per unit): USD 304.6796. #{SUNDAY_NOTE}", r.summary
  end

  def test_on_accepts_date_time_and_symbol
    assert_equal d("2026-01-06"), @bcv.on(Date.new(2026, 1, 6)).date
    assert_equal d("2026-01-06"), @bcv.on(Time.new(2026, 1, 6, 23, 59, 0, "-04:00")).date
    assert_equal d("2026-01-06"), @bcv.on(DateTime.new(2026, 1, 6, 12)).date
    assert_equal "304.6796", @bcv.on(" 2026-01-04 ", :usd).rate
  end

  def test_on_currency_missing_on_old_day
    assert_raises_message(
      BCV::CurrencyNotAvailable,
      "No EUR rate in the BCV data for 2021-08-02 (older entries may lack some currencies). Available that day: USD."
    ) { @bcv.on("2021-08-02", "EUR") }
  end

  def test_on_invalid_date_makes_no_request
    ["2026-02-30", "2026-1-4", "04/01/2026", "", "2026-01-04T00:00", "nope", "２０２６-01-04"].each do |bad|
      assert_raises_message(
        BCV::InvalidDate, %(Invalid date "#{bad}": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.)
      ) { @bcv.on(bad) }
    end
    assert_raises_message(BCV::InvalidDate, "Invalid date 20260104: expected a Date, Time or YYYY-MM-DD string.") do
      @bcv.on(20_260_104)
    end
    assert_empty @http.calls
  end

  def test_on_before_first_snapshot
    assert_raises_message(BCV::DateOutOfRange, "No BCV data for 2021-08-01: daily snapshots start on 2021-08-02.") do
      @bcv.on("2021-08-01")
    end
  end

  def test_on_future_date
    assert_raises_message(
      BCV::DateOutOfRange,
      "2026-11-20 is in the future (today in Caracas is 2026-11-18); " \
      "BCV rates are only known up to the next business day."
    ) { @bcv.on("2026-11-20") }
  end

  def test_on_tomorrow_allowed_but_not_published
    error = assert_raises_message(
      BCV::DateOutOfRange,
      "No BCV rate published yet for 2026-11-19. Daily snapshots are available from 2021-08-02 to 2026-11-18. " \
      "Use latest() for the rate currently in effect."
    ) { @bcv.on("2026-11-19") }
    assert_nil error.cause
    assert_equal "#{FakeHttp::PREFIX}rate.json", @http.calls.last
  end

  def test_snapshot404_with_latest_failure_uses_generic_message
    http = FakeHttp.new("#{FakeHttp::PREFIX}rate.json" => BCV::Response.new(status: 500, body: "x"))
    assert_raises_message(BCV::DateOutOfRange, /to the latest business day\. Use latest\(\)/) do
      FakeHttp.client(http).on("2026-11-19")
    end
  end

  def test_caracas_today_is_utc_minus4
    # 02:00 UTC on the 19th is still the 18th in Caracas: the 20th is "future".
    bcv = FakeHttp.client(now: Time.utc(2026, 11, 19, 2))
    assert_raises_message(BCV::DateOutOfRange, /today in Caracas is 2026-11-18/) { bcv.on("2026-11-20") }
    # A clock may also return epoch seconds.
    epoch = BCV::Client.new(http: FakeHttp.new, clock: -> { Time.utc(2026, 11, 19, 2).to_i })
    assert_raises_message(BCV::DateOutOfRange, /today in Caracas is 2026-11-18/) { epoch.on("2026-11-20") }
  end

  def test_invalid_currency
    assert_raises_message(BCV::InvalidCurrency, %(Unsupported currency "GBP": use one of USD, EUR, CNY, TRY, RUB.)) do
      @bcv.on("2026-01-06", "GBP")
    end
  end

  # ------------------------------------------------------------ history

  def test_history_last_n_days
    h = @bcv.history("USD", days: 7)
    assert_equal 7, h.size
    assert_equal d("2026-11-12"), h.start
    assert_equal d("2026-11-18"), h.end
    dates = h.map(&:date)
    assert_equal dates.sort, dates
    assert_same h.points[0], h.first
    assert_nil h.note
    assert_match(/\A-?\d+(\.\d+)?\z/, h.change)
    assert_match(/\A-?\d+\.\d{4}\z/, h.change_pct)
    assert h.summary.start_with?("USD/VES from 2026-11-12 to 2026-11-18 (7 days): ")
    assert_equal 30, @bcv.history("USD").size
  end

  def test_history_range_carry_flags_and_stats
    h = @bcv.history("eur", start: "2026-01-01", end: Date.new(2026, 1, 6))
    assert_equal(%w[2026-01-01 2026-01-02 2026-01-03 2026-01-04 2026-01-05 2026-01-06], h.map { |p| p.date.to_s })
    assert_equal [false, true, false, true, true, false], h.points.map(&:carried_forward?)
    assert_equal "354.4935", h.first.rate
    assert_equal "360.5039", h.last.rate
    assert_equal d("2026-01-01"), h.min.date
    assert_equal d("2026-01-06"), h.max.date
    assert_equal "6.0104", h.change
    # 6.0104 / 354.4935 * 100 = 1.69549...
    assert_equal "1.6955", h.change_pct
    assert_equal d("2026-01-01"), h.points[1].effective_date
    assert_equal "EUR/VES from 2026-01-01 to 2026-01-06 (6 days): 354.4935 -> 360.5039 (+1.70%). " \
                 "Min 354.4935 on 2026-01-01, max 360.5039 on 2026-01-06.", h.summary
    assert_predicate h.points, :frozen?
  end

  def test_history_min_max_earliest_on_ties
    h = @bcv.history("USD", start: "2026-01-03", end: "2026-01-05")
    assert_equal d("2026-01-03"), h.min.date
    assert_equal d("2026-01-03"), h.max.date
    assert_equal "0", h.change
    assert_equal "0.0000", h.change_pct
  end

  def test_history_skips_entries_without_currency_and_notes_clipping
    h = @bcv.history("EUR", start: "2025-12-01", end: "2026-01-02")
    assert_equal d("2026-01-01"), h.start
    assert_equal "History for EUR starts on 2026-01-01; earlier dates were skipped.", h.note
    assert h.summary.end_with?(" History for EUR starts on 2026-01-01; earlier dates were skipped.")
  end

  def test_history_end_after_latest_note
    h = @bcv.history("USD", start: "2026-11-17", end: "2026-12-31")
    assert_equal "Latest available date is 2026-11-18.", h.note
    assert_equal d("2026-11-17"), @bcv.history("USD", start: "2026-11-17").start
  end

  def test_history_empty_window
    assert_raises_message(
      BCV::DateOutOfRange,
      "No USD rates between 2024-01-01 and 2024-01-31. The history covers 2021-11-15 to 2026-11-18 for USD " \
      "(latest 1830 daily entries). For older single days use on()."
    ) { @bcv.history("USD", start: "2024-01-01", end: "2024-01-31") }
  end

  def test_history_bad_arguments
    assert_raises_message(BCV::InvalidDate, %("start" (2026-01-06) must be on or before "end" (2026-01-01).)) do
      @bcv.history("USD", start: "2026-01-06", end: "2026-01-01")
    end
    assert_raises_message(BCV::InvalidDate, "Invalid days 0: use a whole number from 1 to 1830.") do
      @bcv.history("USD", days: 0)
    end
    assert_raises_message(BCV::InvalidDate, /from 1 to 1830/) { @bcv.history("USD", days: 1831) }
    assert_raises_message(BCV::InvalidDate, /from 1 to 1830/) { @bcv.history("USD", days: 7.0) }
    assert_raises_message(BCV::InvalidDate, /\AInvalid start "2026-13-01"/) { @bcv.history("USD", start: "2026-13-01") }
    assert_raises_message(BCV::InvalidDate, /\AInvalid end "x"/) { @bcv.history("USD", end: "x") }
    assert_raises_message(BCV::InvalidCurrency, /use one of USD, EUR, CNY, TRY, RUB\./) { @bcv.history("VES") }
    assert_empty @http.calls
  end

  # ------------------------------------------------------------ convert

  def test_convert_usd_to_ves_at_latest_rate
    c = @bcv.convert(100, "USD", "VES")
    assert_equal "91664.77", c.result
    assert_equal "91664.77", c.result_exact
    assert_equal "100", c.amount
    assert_equal "USD", c.from
    assert_equal "VES", c.to
    assert_equal "916.6477", c.rate
    assert_equal({ "USD" => "916.6477" }, c.rates_used)
    assert_equal d("2026-11-18"), c.date
    assert_equal d("2026-11-18"), c.effective_date
    refute_predicate c, :carried_forward?
    assert_nil c.note
    assert_equal 2, c.decimals
    assert_equal "100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; " \
                 "1 USD = 916.647700 VES).", c.summary
  end

  def test_convert_ves_to_usd_rounds_half_up_and_keeps_trailing_zero
    c = @bcv.convert("1000", "ves", "usd")
    assert_equal "1.09", c.result
    assert_equal "1.090931663276960166921271935", c.result_exact # = Python Decimal (prec 28, ROUND_HALF_UP)
    assert_equal({ "USD" => "916.6477" }, c.rates_used)
    assert_equal "1.10", @bcv.convert("1008.3125", "VES", "USD").result
  end

  def test_convert_cross_rates_through_ves
    c = @bcv.convert("50", "EUR", "USD", decimals: nil)
    assert_equal "1.098989999996727205010169119", c.rate
    assert_equal "54.94949999983636025050845597", c.result_exact
    assert_equal c.result_exact, c.result
    assert_nil c.decimals
    assert_equal %w[EUR USD], c.rates_used.keys
    assert_equal "0.7325207946193407238579097339", @bcv.convert(0.1, "EUR", "CNY").result_exact
    e = @bcv.convert("123456.789", "CNY", "RUB", decimals: 4)
    assert_equal "1519718.362438267612684158052", e.result_exact
    assert_equal "1519718.3624", e.result
  end

  def test_convert_ves_and_eur_both_ways
    to_ves = @bcv.convert("100", "EUR", "VES")
    assert_equal "100738.67", to_ves.result
    assert_equal "100738.665582", to_ves.result_exact
    assert_equal({ "EUR" => "1007.38665582" }, to_ves.rates_used)
    assert_equal "100", @bcv.convert("100738.665582", "VES", "EUR", decimals: nil).result_exact
    # Expected digits computed with Python's decimal module (prec 28, ROUND_HALF_UP).
    assert_equal "0.0009926675067836913567585160114", @bcv.convert(1, "VES", "EUR", decimals: nil).rate
    k = @bcv.convert("1000", "VES", "EUR")
    assert_equal "0.9926675067836913567585160114", k.result_exact
    assert_equal "0.99", k.result
    assert_equal({ "EUR" => "1007.38665582" }, k.rates_used)
  end

  def test_convert_rounding_half_up_on_exact_ties
    bcv = rate_json('{"USD": 2.5, "date": "2026-11-18"}')
    assert_equal "0.00", bcv.convert("0.001", "USD", "VES").result # 0.0025 -> 0.00
    assert_equal "0.01", bcv.convert("0.003", "USD", "VES").result # 0.0075 -> 0.01
    t = bcv.convert("0.005", "USD", "VES")
    assert_equal "0.0125", t.result_exact
    assert_equal "0.01", t.result
    assert_equal "0.003", bcv.convert("0.001", "USD", "VES", decimals: 3).result # 0.0025 -> 0.003
    assert_equal "3", bcv.convert(1, "USD", "VES", decimals: 0).result # 2.5 -> 3
    assert_equal "0.1", bcv.convert("0.3", "VES", "USD", decimals: 1).result # 0.12 -> 0.1
    assert_equal "0.15", bcv.convert("0.375", "VES", "USD").result # 0.15 exactly
    assert_equal "0.005", bcv.convert("0.0125", "VES", "USD", decimals: 3).result
  end

  def test_convert_has_no_binary_floating_point_noise
    bcv = rate_json('{"USD": 0.1, "EUR": 0.3, "date": "2026-11-18"}')
    a = bcv.convert(0.1, "USD", "VES", decimals: nil)
    assert_equal "0.1", a.amount
    assert_equal "0.01", a.result_exact # 0.1 * 0.1 is 0.010000000000000002 in floats
    b = bcv.convert(3, "USD", "EUR", decimals: nil)
    assert_equal "1", b.result_exact # 3 * 0.1 / 0.3
    assert_equal "0.3333333333333333333333333333", b.rate
    assert_equal "9999999999999999.90", bcv.convert("999999999999999.99", "VES", "USD", decimals: 2).result
    assert_equal "0.10", bcv.convert(1, "USD", "VES").result
    assert_equal "100.00", bcv.convert("1_000", "USD", "VES").result
    assert_equal "100.00", bcv.convert("1e3", "USD", "VES").result
    assert_equal "0.00", bcv.convert(0, "USD", "VES").result
  end

  def test_convert_accepts_big_decimal_when_loaded
    skip "bigdecimal is not installed" unless big_decimal?
    assert_equal "91664.77", @bcv.convert(BigDecimal("100"), "USD", "VES").result
    assert_equal "0.1", rate_json('{"USD": 1, "date": "2026-11-18"}').convert(BigDecimal("0.1"), "USD", "VES",
                                                                              decimals: nil).amount
  end

  def test_convert_on_date_carries_forward
    c = @bcv.convert(10, "USD", "VES", date: "2026-01-04")
    assert_equal "3046.80", c.result
    assert_equal d("2026-01-04"), c.date
    assert_equal d("2026-01-03"), c.effective_date
    assert_predicate c, :carried_forward?
    assert_equal SUNDAY_NOTE, c.note
  end

  def test_convert_currency_missing_that_day
    assert_raises_message(
      BCV::CurrencyNotAvailable,
      "No BCV rate for EUR on 2021-08-02 (older entries may lack some currencies). Available: USD."
    ) { @bcv.convert(1, "USD", "EUR", date: "2021-08-02") }
  end

  INVALID_CONVERSIONS = [
    [1, "USD", "USD", BCV::InvalidCurrency, '"from" and "to" are both USD; choose two different currencies.'],
    [1, "USD", "GBP", BCV::InvalidCurrency, 'Unsupported currency "GBP": use one of VES, USD, EUR, CNY, TRY, RUB.'],
    [-1, "USD", "VES", BCV::InvalidAmount, "Invalid amount -1: it must be zero or positive."],
    ["-0.5", "USD", "VES", BCV::InvalidAmount, /zero or positive/],
    ["abc", "USD", "VES", BCV::InvalidAmount, 'Invalid amount "abc": expected a number.'],
    ["", "USD", "VES", BCV::InvalidAmount, /expected a number/],
    [nil, "USD", "VES", BCV::InvalidAmount, "Invalid amount nil: expected a number."],
    [true, "USD", "VES", BCV::InvalidAmount, /expected a number/],
    [Float::INFINITY, "USD", "VES", BCV::InvalidAmount, /it must be a finite number/],
    [Float::NAN, "USD", "VES", BCV::InvalidAmount, /finite/],
    ["Infinity", "USD", "VES", BCV::InvalidAmount, /finite/],
    ["1e16", "USD", "VES", BCV::InvalidAmount, 'Invalid amount "1e16": it must not exceed 1e15.']
  ].freeze

  def test_convert_invalid_arguments_make_no_request
    INVALID_CONVERSIONS.each do |amount, from, to, klass, message|
      assert_raises_message(klass, message) { @bcv.convert(amount, from, to) }
    end
    assert_raises_message(BCV::InvalidDate, /\AInvalid date "2026-02-30"/) do
      @bcv.convert(1, "USD", "VES", date: "2026-02-30")
    end
    assert_empty @http.calls
  end

  def test_max_amount_and_vef_alias
    c = @bcv.convert(1e15, "vef", "USD")
    assert_equal "VES", c.from
    assert_equal "1000000000000000", c.amount
  end

  def test_bad_decimals
    [-1, 13, 2.0].each do |decimals|
      assert_raises_message(
        BCV::InvalidAmount, "Invalid decimals #{decimals.inspect}: use a whole number from 0 to 12, or nil."
      ) { @bcv.convert(1, "USD", "VES", decimals: decimals) }
    end
  end

  # ------------------------------------------------------------ status

  def test_status
    s = @bcv.status
    assert_equal "ok", s.status
    assert_predicate s, :ok?
    refute_predicate s, :stale?
    assert_in_delta 13.0, s.age_hours # 02:01 UTC -> 15:00 UTC
    assert_equal %w[USD EUR CNY TRY RUB], s.supported_currencies
    assert_equal d("2026-11-18"), s.date
    assert_equal d("2026-11-18"), s.effective_date
    assert_equal "America/Caracas", s.timezone
    assert_equal "v1", s.api_version
    assert s.currencies["USD"]
    refute_nil s.generated_at
    assert_equal "Status ok: last capture 2026-11-18T02:01:03.699523+00:00 (13 h ago), effective date 2026-11-18.",
                 s.summary
  end

  def test_status_is_stale_after96_hours
    s = FakeHttp.client(now: Time.utc(2026, 11, 22, 3)).status
    assert_in_delta 97.0, s.age_hours
    assert_predicate s, :stale?
    assert_includes s.summary, "STALE"
  end

  def test_status_with_missing_fields
    bcv = FakeHttp.client(FakeHttp.new("#{FakeHttp::PREFIX}status.json" => BCV::Response.new(status: 200, body: "{}")))
    s = bcv.status
    assert_equal "unknown", s.status
    assert_nil s.age_hours
    assert_predicate s, :stale?
    assert_equal BCV::CURRENCIES, s.supported_currencies
    assert_equal({}, s.currencies)
    assert_equal "Status unknown (STALE): last capture unknown, effective date unknown.", s.summary
  end

  # ------------------------------------------------------------ upstream errors

  def test_http_error_is_upstream
    bcv = FakeHttp.client(FakeHttp.new("#{FakeHttp::PREFIX}rate.json" => BCV::Response.new(status: 503, body: "down")))
    e = assert_raises_message(
      BCV::UpstreamError, "The BCV Today data API answered HTTP 503 for /api/v1/rate.json. Try again in a moment."
    ) { bcv.latest }
    assert_equal 503, e.status
  end

  def test_invalid_json_is_upstream
    assert_raises_message(BCV::UpstreamError, "The BCV Today data API returned invalid JSON for /api/v1/rate.json.") do
      rate_json("<html>").latest
    end
  end

  def test_wrong_shapes_are_upstream
    bcv = FakeHttp.client(FakeHttp.new(
                            "#{FakeHttp::PREFIX}history.json" => BCV::Response.new(status: 200, body: "{}"),
                            "#{FakeHttp::PREFIX}rate.json" => BCV::Response.new(status: 200, body: "[]")
                          ))
    assert_raises_message(BCV::UpstreamError, "Unexpected history.json shape (expected an array).") do
      bcv.history("USD")
    end
    assert_raises_message(BCV::UpstreamError, "Unexpected /api/v1/rate.json shape (expected an object).") do
      bcv.latest
    end
    assert_raises_message(BCV::UpstreamError, /no valid 'date'/) { rate_json('{"USD": 1}').latest }
  end

  def test_network_failure_is_upstream
    boom = ->(*) { raise Errno::ECONNREFUSED, "connect(2)" }
    e = assert_raises(BCV::UpstreamError) { BCV::Client.new(http: boom).latest }
    assert_equal "Could not reach the BCV Today data API (Connection refused - connect(2)). Try again in a moment.",
                 e.message
    assert_nil e.status
    assert_kind_of Errno::ECONNREFUSED, e.cause
  end

  def test_http_client_must_return_a_response
    bcv = BCV::Client.new(http: ->(*) { "nope" })
    assert_raises_message(BCV::UpstreamError, "The HTTP client returned String instead of BCV::Response.") do
      bcv.latest
    end
  end

  def test404_on_a_plain_path_is_not_found
    bcv = FakeHttp.client(FakeHttp.new("#{FakeHttp::PREFIX}status.json" => BCV::Response.new(status: 404, body: "")))
    assert_raises_message(BCV::NotFound, "Not found: /api/v1/status.json") { bcv.status }
  end

  def test_hierarchy
    [BCV::InvalidDate, BCV::InvalidCurrency, BCV::InvalidAmount].each { |k| assert_operator k, :<, BCV::InvalidArgument }
    [BCV::InvalidArgument, BCV::DateOutOfRange, BCV::CurrencyNotAvailable, BCV::UpstreamError,
     BCV::NotFound].each do |k|
      assert_operator k, :<, BCV::Error
    end
    assert_operator BCV::Error, :<, StandardError
  end

  def test_constructor_validation
    assert_raises_message(BCV::InvalidArgument,
                          'Invalid base_url "file:///etc": it must start with https:// or http://.') do
      BCV::Client.new(base_url: "file:///etc")
    end
    assert_raises_message(BCV::InvalidArgument, "Invalid timeout -1: use a number of seconds >= 0.") do
      BCV::Client.new(timeout: -1)
    end
    assert_raises_message(BCV::InvalidArgument, /\AInvalid cache_ttl "5"/) { BCV::Client.new(cache_ttl: "5") }
    assert_raises_message(BCV::InvalidArgument, /\AInvalid http: expected a callable/) { BCV::Client.new(http: 1) }
    assert_raises_message(BCV::InvalidArgument, /\AInvalid clock/) { BCV::Client.new(clock: "now") }
    assert_raises_message(BCV::InvalidArgument, /Rails\.cache/) { BCV::Client.new(cache: Object.new) }
  end

  # ------------------------------------------------------------ cache

  def test_cache_ttl
    now = Time.utc(2026, 11, 18, 15)
    http = FakeHttp.new
    bcv = BCV::Client.new(cache_ttl: 300, http: http, clock: -> { now })
    bcv.latest
    bcv.latest
    bcv.convert(1, "USD", "VES")
    assert_equal 1, http.calls.size
    now += 299
    bcv.latest
    assert_equal 1, http.calls.size
    now += 2
    bcv.latest
    assert_equal 2, http.calls.size
    bcv.clear_cache
    bcv.latest
    assert_equal 3, http.calls.size
  end

  def test_cache_disabled
    http = FakeHttp.new
    bcv = FakeHttp.client(http, cache_ttl: 0)
    bcv.latest
    bcv.latest
    assert_equal 2, http.calls.size
  end

  def test_errors_are_not_cached
    http = FakeHttp.new("#{FakeHttp::PREFIX}rate.json" => BCV::Response.new(status: 500, body: ""))
    bcv = FakeHttp.client(http)
    2.times { assert_raises(BCV::UpstreamError) { bcv.latest } }
    assert_equal 2, http.calls.size
  end

  def test_cache_is_thread_safe
    http = FakeHttp.new
    bcv = FakeHttp.client(http)
    threads = Array.new(8) { Thread.new { 20.times { bcv.latest && bcv.history("USD", days: 3) } } }
    threads.each(&:join)
    assert_operator http.calls.size, :<=, 16
  end

  def test_memory_cache_evicts_at_capacity
    cache = BCV::MemoryCache.new
    BCV::MemoryCache::MAX_ENTRIES.times { |i| cache.set("k#{i}", i, 10, 0) }
    assert_equal [true, 0], cache.get("k0", 0)
    cache.set("overflow", "x", 10, 0)
    assert_equal [false, nil], cache.get("k0", 0)
    assert_equal [true, "x"], cache.get("overflow", 0)
    assert_equal [false, nil], cache.get("overflow", 10)
  end

  # Rails.cache-style store shared by two clients.
  class Store
    attr_reader :items, :ttls

    def initialize
      @items = {}
      @ttls = []
    end

    def read(key) = @items[key]

    def write(key, value, expires_in: nil)
      @items[key] = value
      @ttls << expires_in
      value
    end
  end

  def test_external_rails_cache_style_store_is_shared_across_clients
    store = Store.new
    http = FakeHttp.new
    one = BCV::Client.new(cache_ttl: 120, cache: store, http: http)
    two = BCV::Client.new(cache_ttl: 120, cache: store, http: http)
    assert_equal "916.6477", one.latest.rate("USD")
    assert_equal "916.6477", two.latest.rate("USD")
    assert_equal 1, http.calls.size
    assert_equal [120.0], store.ttls
    assert_equal ["bcv-ruby/https://bcv.today/api/v1/rate.json"], store.items.keys
    assert_kind_of String, store.items.values.first
  end

  # ------------------------------------------------------------ module-level shortcuts

  def test_module_level_shortcuts_use_the_default_client
    previous = BCV.client
    BCV.client = FakeHttp.client
    assert_equal "916.6477", BCV.latest.rate("USD")
    assert_equal "304.6796", BCV.on("2026-01-04", "USD").rate
    assert_equal 7, BCV.history("USD", days: 7).size
    assert_equal "3046.80", BCV.convert(10, "USD", "VES", date: "2026-01-04").result
    assert_equal "ok", BCV.status.status
    assert_raises(BCV::InvalidArgument) { BCV.client = Object.new }
  ensure
    BCV.client = previous
  end

  private

  def big_decimal?
    require "bigdecimal"
    true
  rescue LoadError
    false
  end
end
