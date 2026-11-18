# frozen_string_literal: true

require_relative "constants"
require_relative "value"
require_relative "internal/decimal"

module BCV
  # @api private
  # Helpers shared by the result objects.
  module Format
    module_function

    def dec(text)
      Internal::Decimal.parse(text)
    end

    # Display formatting with thousands separators (never used for math).
    def num(text, places = 4)
      d = dec(text)
      d ? d.group(places) : text.to_s
    end

    def rates_line(rates)
      rates.map { |code, v| "#{code} #{num(v)}" }.join(", ")
    end

    def iso(value)
      value&.iso8601
    end

    # A decimal string as a JSON number (Integer when it has no fraction, Float otherwise).
    def json_number(text)
      text.match?(/\A-?\d+\z/) ? Integer(text, 10) : Float(text)
    end

    def json_rates(rates)
      rates.transform_values { |v| json_number(v) }
    end

    def stamp(raw, parsed)
      return nil unless parsed

      raw.is_a?(String) ? raw : parsed.utc.iso8601(6)
    end

    def lookup(rates, code)
      upper = code.to_s.strip.upcase
      raise InvalidCurrency, "Unsupported currency #{code.inspect}: use one of #{CURRENCIES.join(', ')}." \
        unless CURRENCIES.include?(upper)

      rates[upper]
    end
  end

  # The official BCV rates currently in effect (/api/v1/rate.json).
  #
  # [rates]          Hash of bolivars per unit as decimal strings, e.g. {"USD" => "916.6477", ...}
  #                  (only the currencies published, in canonical order).
  # [date]           Date of the snapshot.
  # [effective_date] Official BCV validity date ("fecha valor").
  # [updated_at]     UTC Time of the capture, or nil.
  # [raw]            The entry as published (frozen JSON).
  Rates = Value.define(:rates, :date, :effective_date, :updated_at, :raw) do
    # Rate for +code+ (case-insensitive) as a decimal string, or nil when it was not published.
    # Raises BCV::InvalidCurrency for codes other than USD, EUR, CNY, TRY and RUB.
    def rate(code)
      Format.lookup(rates, code)
    end
    alias_method :[], :rate

    def unit = UNIT
    def source = SOURCE

    # One-line English summary.
    def summary
      "Official BCV rates (effective #{effective_date}, Bs. per unit): #{Format.rates_line(rates)}"
    end
    alias_method :to_s, :summary

    # JSON-ready Hash (same shape as the Python and JavaScript CLIs' --json output).
    def as_json(*)
      {
        "rates" => Format.json_rates(rates),
        "date" => date.iso8601,
        "effective_date" => effective_date.iso8601,
        "updated_at" => Format.stamp(raw["updated_at"], updated_at),
        "unit" => UNIT,
        "source" => SOURCE
      }
    end

    def to_json(*args) = as_json.to_json(*args)
  end

  # The BCV rate(s) in effect on one calendar day (/api/v1/history/{date}.json).
  #
  # [date]            The calendar day that was requested.
  # [effective_date]  Date of the BCV publication in effect that day (earlier on weekends/holidays).
  # [carried_forward] true when effective_date differs from date (see #carried_forward?).
  # [rates]           Decimal strings by currency (only the requested one, when one was given).
  # [updated_at]      UTC Time of the capture, or nil.
  # [note]            English explanation of the carry-forward, or nil.
  # [raw]             The snapshot as published.
  DayRate = Value.define(:date, :effective_date, :carried_forward, :rates, :updated_at, :note, :raw) do
    def carried_forward? = carried_forward

    # With a code: that rate (or nil). Without: the single rate when exactly one currency is present, else nil.
    def rate(code = nil)
      return Format.lookup(rates, code) unless code.nil?

      rates.size == 1 ? rates.values.first : nil
    end

    def [](code) = rate(code)
    def unit = UNIT
    def source = SOURCE

    def summary
      text = "BCV rate in effect on #{date} (Bs. per unit): #{Format.rates_line(rates)}."
      note ? "#{text} #{note}" : text
    end
    alias_method :to_s, :summary

    def as_json(*)
      out = {
        "date" => date.iso8601,
        "effective_date" => effective_date.iso8601,
        "carried_forward" => carried_forward,
        "rates" => Format.json_rates(rates),
        "updated_at" => Format.stamp(raw["updated_at"], updated_at),
        "unit" => UNIT,
        "source" => SOURCE
      }
      out["note"] = note if note
      out
    end

    def to_json(*args) = as_json.to_json(*args)
  end

  # One daily entry of a History series. +rate+ is a decimal string.
  HistoryPoint = Value.define(:date, :effective_date, :rate) do
    def carried_forward? = effective_date != date
    alias_method :carried_forward, :carried_forward?

    def as_json(*)
      { "date" => date.iso8601, "effective_date" => effective_date.iso8601, "rate" => Format.json_number(rate) }
    end

    def to_json(*args) = as_json.to_json(*args)
  end

  # A daily rate series for one currency, oldest first (never empty). Enumerable over its points.
  #
  # [currency] "USD", "EUR", ...
  # [points]   Frozen Array of HistoryPoint.
  # [note]     Explanation when the requested range was clipped to the available data, or nil.
  History = Value.define(:currency, :points, :note) do
    include Enumerable

    def each(&) = points.each(&)
    def size = points.size
    alias_method :length, :size

    # First day of the series.
    def start = points.first.date

    # Last day of the series (call it as history.end).
    def end
      points.last.date
    end

    def first = points.first
    def last = points.last

    # Lowest rate (earliest day on ties).
    def min
      points.reduce { |lo, p| Format.dec(p.rate) < Format.dec(lo.rate) ? p : lo }
    end

    # Highest rate (earliest day on ties).
    def max
      points.reduce { |hi, p| Format.dec(p.rate) > Format.dec(hi.rate) ? p : hi }
    end

    # last.rate - first.rate, exact, as a decimal string ("6.0104", "0").
    def change
      (Format.dec(last.rate) - Format.dec(first.rate)).to_s
    end

    # Percentage change from first to last, rounded half-up to 4 decimals ("1.6955").
    def change_pct
      first_dec = Format.dec(first.rate)
      (Format.dec(change).div(first_dec) * Internal::Decimal.new(100, 0)).quantize(4).to_fixed
    end

    def unit = UNIT
    def source = SOURCE

    def summary
      sign = Format.dec(change).negative? ? "" : "+"
      pct = Format.dec(change_pct).to_fixed(2)
      text = "#{currency}/VES from #{start} to #{self.end} (#{size} days): " \
             "#{Format.num(first.rate)} -> #{Format.num(last.rate)} (#{sign}#{pct}%). " \
             "Min #{Format.num(min.rate)} on #{min.date}, max #{Format.num(max.rate)} on #{max.date}."
      note ? "#{text} #{note}" : text
    end
    alias_method :to_s, :summary

    def as_json(*)
      point = ->(p) { { "date" => p.date.iso8601, "rate" => Format.json_number(p.rate) } }
      out = {
        "currency" => currency,
        "from" => start.iso8601,
        "to" => self.end.iso8601,
        "points" => size,
        "first" => point.call(first),
        "last" => point.call(last),
        "min" => point.call(min),
        "max" => point.call(max),
        "change" => Format.json_number(change),
        "change_pct" => Float(change_pct),
        "series" => points.map(&:as_json),
        "unit" => UNIT,
        "source" => SOURCE
      }
      out["note"] = note if note
      out
    end

    def to_json(*args) = as_json.to_json(*args)
  end

  # Result of BCV::Client#convert. Money values are decimal strings.
  #
  # [amount]          The amount, exact ("100", "0.1").
  # [from] / [to]     Currency codes ("USD", "VES", ...).
  # [result]          Rounded half-up to +decimals+ places, with exactly that many ("91664.77", "1.10"),
  #                   or the exact value when decimals is nil.
  # [result_exact]    Unrounded result (divisions keep 28 significant digits).
  # [rate]            Units of +to+ per 1 unit of +from+ (28 significant digits).
  # [rates_used]      Bolivars per unit for the non-VES side(s), e.g. {"USD" => "916.6477"}.
  # [date]            Requested date, or the date of the latest snapshot.
  # [effective_date]  Date of the BCV publication used.
  # [carried_forward] true when a weekend/holiday carry-forward applied (see #carried_forward?).
  # [decimals]        Decimal places of +result+ (nil = not rounded).
  # [note]            English explanation of the carry-forward, or nil.
  Conversion = Value.define(
    :amount, :from, :to, :result, :result_exact, :rate, :rates_used,
    :date, :effective_date, :carried_forward, :decimals, :note
  ) do
    def carried_forward? = carried_forward
    def source = SOURCE

    def summary
      places = decimals.nil? ? 8 : decimals
      text = "#{Format.num(amount, 2)} #{from} = #{Format.num(result, places)} #{to} at the official BCV rate " \
             "(effective #{effective_date}; 1 #{from} = #{Format.num(rate, 6)} #{to})."
      note ? "#{text} #{note}" : text
    end
    alias_method :to_s, :summary

    def as_json(*)
      out = {
        "amount" => Format.json_number(amount),
        "from" => from,
        "to" => to,
        "result" => Format.json_number(result),
        "result_text" => result,
        "result_exact" => result_exact,
        "rate" => Format.json_number(rate),
        "rates_used" => Format.json_rates(rates_used),
        "date" => date.iso8601,
        "effective_date" => effective_date.iso8601,
        "carried_forward" => carried_forward,
        "source" => SOURCE
      }
      out["note"] = note if note
      out
    end

    def to_json(*args) = as_json.to_json(*args)
  end

  # Freshness of the published data (/api/v1/status.json).
  #
  # [status]               "ok" when the last capture succeeded ("unknown" if absent).
  # [updated_at]           UTC Time of the last capture, or nil.
  # [generated_at]         UTC Time the file was generated, or nil.
  # [date] [effective_date] Dates of the latest snapshot, or nil.
  # [age_hours]            Float hours since updated_at (one decimal), or nil.
  # [stale]                true when status is not "ok" or the last capture is older than 96 hours.
  # [supported_currencies] Array of codes.
  # [currencies]           Hash code => true/false.
  # [timezone] [api_version] Strings or nil.
  # [raw]                  The document as published.
  Status = Value.define(
    :status, :updated_at, :generated_at, :date, :effective_date, :age_hours, :stale,
    :supported_currencies, :currencies, :timezone, :api_version, :raw
  ) do
    def stale? = stale
    def ok? = status == "ok"

    # Hours as shown in summaries ("13", "97.5").
    def age_text
      return nil if age_hours.nil?

      age_hours == age_hours.to_i ? age_hours.to_i.to_s : age_hours.to_s
    end

    def summary
      captured = raw["updated_at"].is_a?(String) ? raw["updated_at"] : "unknown"
      age = age_hours.nil? ? "" : " (#{age_text} h ago)"
      "Status #{status}#{' (STALE)' if stale}: last capture #{captured}#{age}, " \
        "effective date #{effective_date || 'unknown'}."
    end
    alias_method :to_s, :summary

    def as_json(*)
      {
        "status" => status,
        "updated_at" => Format.stamp(raw["updated_at"], updated_at),
        "generated_at" => Format.stamp(raw["generated_at"], generated_at),
        "date" => Format.iso(date),
        "effective_date" => Format.iso(effective_date),
        "age_hours" => age_hours,
        "stale" => stale,
        "supported_currencies" => supported_currencies,
        "currencies" => currencies,
        "timezone" => timezone,
        "api_version" => api_version,
        "source" => SOURCE
      }
    end

    def to_json(*args) = as_json.to_json(*args)
  end
end
