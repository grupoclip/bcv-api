# frozen_string_literal: true

require "test_helper"

# Live checks against https://bcv.today. Opt-in: BCV_LIVE=1 bundle exec rake test (or rake live).
class LiveTest < Minitest::Test
  def setup
    skip "live API test; set BCV_LIVE=1 to run" unless ENV["BCV_LIVE"] == "1"
    @bcv = BCV::Client.new(timeout: 20)
  end

  def test_latest
    r = @bcv.latest
    assert_operator Float(r.rate("USD")), :>, 0
    assert_operator r.effective_date, :>=, Date.new(2026, 1, 1)
  end

  def test_weekend_carry_forward
    d = @bcv.on("2026-01-04", "USD")
    assert_equal Date.new(2026, 1, 3), d.effective_date
    assert_predicate d, :carried_forward?
    assert_equal "304.6796", d.rate
  end

  def test_first_snapshot
    assert_operator Float(@bcv.on("2021-08-02", "USD").rate), :>, 0
    assert_raises(BCV::DateOutOfRange) { @bcv.on("2021-08-01") }
  end

  def test_convert_and_history
    c = @bcv.convert(100, "USD", "VES")
    assert_operator Float(c.result), :>, 0
    assert_equal @bcv.latest.rate("USD"), c.rates_used["USD"]
    h = @bcv.history("USD", days: 7)
    assert_includes 1..7, h.size
  end

  def test_status
    s = @bcv.status
    assert_equal "ok", s.status
    assert_includes s.supported_currencies, "USD"
  end
end
