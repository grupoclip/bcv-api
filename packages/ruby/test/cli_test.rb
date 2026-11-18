# frozen_string_literal: true

require "test_helper"
require "json"
require "open3"
require "rbconfig"
require "stringio"

# Same cases as packages/python/tests/test_cli.py and packages/js/test/unit/cli.test.mjs.
class CLITest < Minitest::Test
  include Helpers

  def run_cli(*argv, http: FakeHttp.new)
    out = StringIO.new
    err = StringIO.new
    code = BCV::CLI.run(argv, out: out, err: err, client: FakeHttp.client(http))
    [code, out.string, err.string]
  end

  def test_latest_table
    code, out, err = run_cli("latest")
    assert_equal [BCV::CLI::EXIT_OK, ""], [code, err]
    lines = out.lines(chomp: true)
    assert_equal "Official BCV rates, effective 2026-11-18 (Bs. per unit)", lines[0]
    assert_includes out, "USD         916.6477"
    assert_includes out, "EUR       1,007.3867"
    # Rate column is right-aligned: every data row has the same width.
    rows = lines.select { |l| BCV::CURRENCIES.include?(l[0, 3]) }
    assert_equal 5, rows.size
    assert_equal 1, rows.map(&:length).uniq.size
    assert_includes out, "Updated 2026-11-18 02:01 UTC. Source: Banco Central de Venezuela via BCV Today"
    assert_includes out, "Unofficial"
  end

  def test_latest_json
    code, out, = run_cli("latest", "--json")
    assert_equal 0, code
    data = JSON.parse(out)
    assert_in_delta 916.6477, data["rates"]["USD"]
    assert_equal "2026-11-18", data["effective_date"]
    assert_equal "2026-11-18T02:01:03.699523+00:00", data["updated_at"]
    assert_equal BCV::SOURCE, data["source"]
  end

  def test_json_flag_before_command
    code, out, = run_cli("--json", "status")
    assert_equal 0, code
    data = JSON.parse(out)
    assert_equal "ok", data["status"]
    assert_in_delta 13.0, data["age_hours"]
    refute data["stale"]
  end

  def test_status_table
    code, out, = run_cli("status")
    assert_equal 0, code
    assert_equal ["Status          ok", "Updated         2026-11-18T02:01:03.699523+00:00", "Age             13 h",
                  "Effective date  2026-11-18", "Currencies      USD, EUR, CNY, TRY, RUB"], out.lines(chomp: true)
  end

  def test_on_with_currency
    code, out, = run_cli("on", "2026-01-04", "--currency", "USD")
    assert_equal 0, code
    assert_includes out, "effective date 2026-01-03"
    assert_includes out, "USD         304.6796"
    assert_includes out, "Note: #{SUNDAY_NOTE}"
  end

  def test_on_json
    code, out, = run_cli("on", "2026-01-04", "-c", "eur", "--json")
    data = JSON.parse(out)
    assert_equal 0, code
    assert data["carried_forward"]
    assert_equal({ "EUR" => 357.8858 }, data["rates"])
    assert_equal SUNDAY_NOTE, data["note"]
  end

  def test_convert
    code, out, = run_cli("convert", "100", "USD", "VES")
    assert_equal 0, code
    assert_equal ["Amount     100.00 USD", "Result     91,664.77 VES", "Rate       1 USD = 916.647700 VES",
                  "BCV USD    916.6477 VES", "Effective  2026-11-18", "",
                  BCV::CLI::ATTRIBUTION], out.lines(chomp: true)
  end

  def test_convert_json_with_date
    code, out, = run_cli("convert", "10", "usd", "ves", "--date", "2026-01-04", "--json")
    data = JSON.parse(out)
    assert_equal 0, code
    assert_in_delta 3046.8, data["result"]
    assert_equal "3046.80", data["result_text"]
    assert_equal "2026-01-03", data["effective_date"]
    assert_equal SUNDAY_NOTE, data["note"]
  end

  def test_convert_decimals_option
    code, out, = run_cli("convert", "1000", "VES", "EUR", "--decimals=4", "--json")
    assert_equal 0, code
    assert_equal "0.9927", JSON.parse(out)["result_text"]
  end

  def test_history
    code, out, = run_cli("history", "USD", "--days", "7")
    assert_equal 0, code
    assert_equal "USD/VES official BCV rate, 2026-11-12 to 2026-11-18 (7 days)", out.lines(chomp: true)[0]
    assert_includes out, "2026-11-18"
    assert_includes out, "Min "
    assert_includes out, "Change "
  end

  def test_history_range_marks_carry_forward
    code, out, = run_cli("history", "EUR", "--start", "2026-01-01", "--end", "2026-01-06")
    assert_equal 0, code
    assert_includes out, "2026-01-04  2026-01-03 *"
    assert_includes out, "First 354.4935  Last 360.5039  Change +6.0104 (+1.70%)"
    assert_includes out, "Min 354.4935 on 2026-01-01  Max 360.5039 on 2026-01-06"
    assert_includes out, "* rate carried forward from the effective date (weekend/holiday)."
  end

  def test_history_json
    code, out, = run_cli("history", "USD", "-n", "3", "--json")
    data = JSON.parse(out)
    assert_equal 0, code
    assert_equal 3, data["points"]
    assert_equal 3, data["series"].size
    assert_equal %w[date effective_date rate], data["series"][0].keys
  end

  ERROR_CASES = [
    [%w[on 2026-13-01], BCV::CLI::EXIT_USAGE, "Invalid date"],
    [%w[convert 100 USD GBP], BCV::CLI::EXIT_USAGE, "Unsupported currency"],
    [%w[convert -5 USD VES], BCV::CLI::EXIT_USAGE, "zero or positive"],
    [%w[history USD --days 0], BCV::CLI::EXIT_USAGE, "Invalid days 0"],
    [%w[on 2020-01-01], BCV::CLI::EXIT_NO_DATA, "snapshots start on 2021-08-02"],
    [%w[on 2030-01-01], BCV::CLI::EXIT_NO_DATA, "in the future"],
    [%w[on 2021-08-02 --currency EUR], BCV::CLI::EXIT_NO_DATA, "No EUR rate"]
  ].freeze

  def test_error_exit_codes
    ERROR_CASES.each do |argv, expected, fragment|
      code, out, err = run_cli(*argv)
      assert_equal expected, code, argv.join(" ")
      assert err.start_with?("bcv: error: "), err
      assert_includes err, fragment
      assert_equal "", out
    end
  end

  def test_upstream_exit_code_and_json_error
    http = FakeHttp.new("#{FakeHttp::PREFIX}rate.json" => BCV::Response.new(status: 502, body: ""))
    code, out, err = run_cli("latest", "--json", http: http)
    assert_equal BCV::CLI::EXIT_UPSTREAM, code
    assert_equal "UpstreamError", JSON.parse(out)["error"]["type"]
    assert_includes err, "HTTP 502"
  end

  USAGE_CASES = [
    [[], "missing command"],
    [%w[frobnicate], 'unknown command "frobnicate" (choose from latest, on, convert, history, status)'],
    [%w[on], '"on" expects <date>'],
    [%w[latest extra], '"latest" expects no arguments'],
    [%w[latest --currency USD], 'option --currency is not valid for "latest"'],
    [%w[latest --nope], "unknown option '--nope'"],
    [%w[history USD --days], "option --days needs a value"],
    [%w[history USD --days x], "argument --days: invalid int value: 'x'"],
    [%w[convert 1 USD VES --decimals 1.5], "argument --decimals: invalid int value: '1.5'"],
    [%w[latest --timeout soon], "argument --timeout: invalid float value: 'soon'"],
    [%w[latest --json=yes], "option --json does not take a value"]
  ].freeze

  def test_usage_errors_exit2
    USAGE_CASES.each do |argv, message|
      out = StringIO.new
      err = StringIO.new
      code = BCV::CLI.run(argv, out: out, err: err)
      assert_equal BCV::CLI::EXIT_USAGE, code, argv.join(" ")
      assert_includes err.string, "bcv: error: #{message}\n"
      assert_equal "", out.string
    end
  end

  def test_bad_base_url_is_a_usage_error
    err = StringIO.new
    assert_equal 2, BCV::CLI.run(%w[latest --base-url ftp://x], out: StringIO.new, err: err)
    assert_includes err.string, "Invalid base_url"
  end

  def test_version_and_help
    out = StringIO.new
    assert_equal 0, BCV::CLI.run(["--version"], out: out)
    assert_equal "bcv #{BCV::VERSION}\n", out.string
    out = StringIO.new
    assert_equal 0, BCV::CLI.run(["-h"], out: out)
    assert_includes out.string, "not affiliated with the bank"
    assert_includes out.string, "Exit codes: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network/API error."
  end

  def test_executable_help
    exe = File.expand_path("../exe/bcv", __dir__)
    lib = File.expand_path("../lib", __dir__)
    out, status = Open3.capture2(RbConfig.ruby, "-I", lib, exe, "--help")
    assert_predicate status, :success?
    assert_includes out, "not affiliated"
    _, err, status = Open3.capture3(RbConfig.ruby, "-I", lib, exe, "on", "nope")
    assert_equal 2, status.exitstatus
    assert_includes err, 'bcv: error: Invalid date "nope"'
  end
end
