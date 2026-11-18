# frozen_string_literal: true

require "date"
require "json"
require "time"
require_relative "../constants"
require_relative "../errors"
require_relative "../models"
require_relative "decimal"

module BCV
  module Internal
    # @api private
    # Transport-independent business rules. They mirror packages/python/bcv/_core.py,
    # packages/js/src/rules.ts and packages/php/src/Internal/Rules.php: same date
    # validation, carry-forward semantics, history windowing, cross rates through the
    # bolivar and the same English messages.
    module Rules
      module_function

      LATEST_PATH = "/api/v1/rate.json"
      HISTORY_PATH = "/api/v1/history.json"
      STATUS_PATH = "/api/v1/status.json"

      ISO_DATE = /\A(\d{4})-(\d{2})-(\d{2})\z/
      TIMESTAMP_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})\z/
      NON_FINITE = /\A[+-]?(?:nan|inf|infinity)\z/i
      MAX_AMOUNT = Decimal.new(1, 15)
      HUNDRED = Decimal.new(100, 0)
      CARACAS_OFFSET = -4 * 3600

      def day_path(day)
        "/api/v1/history/#{day.iso8601}.json"
      end

      # ------------------------------------------------------------ parsing

      def iso_date(text)
        m = ISO_DATE.match(text)
        return nil unless m

        y = m[1].to_i
        mo = m[2].to_i
        d = m[3].to_i
        ::Date.valid_date?(y, mo, d) ? ::Date.new(y, mo, d) : nil
      end

      # Coerces a Date, DateTime, Time or "YYYY-MM-DD" string to a Date, or raises BCV::InvalidDate.
      def parse_date(value, label = "date")
        case value
        when ::Time, ::Date
          ::Date.new(value.year, value.month, value.day)
        when ::String
          day = iso_date(value.strip)
          return day if day

          raise InvalidDate,
                %(Invalid #{label} "#{value}": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.)
        else
          raise InvalidDate, "Invalid #{label} #{value.inspect}: expected a Date, Time or YYYY-MM-DD string."
        end
      end

      # ISO 8601 timestamp as a UTC Time (no zone means UTC); nil when missing or invalid.
      def parse_timestamp(value)
        return nil unless value.is_a?(String) && !value.empty?

        text = value.strip
        text += "Z" unless TIMESTAMP_ZONE.match?(text)
        ::Time.iso8601(text).utc
      rescue ArgumentError
        nil
      end

      def entry_date(entry, key)
        value = entry[key]
        value.is_a?(String) ? iso_date(value) : nil
      end

      # A positive, finite JSON number as an exact decimal string, or nil.
      def rate_text(value)
        case value
        when Integer
          value.positive? ? value.to_s : nil
        when Float
          value.finite? && value.positive? ? Decimal.from_float(value).to_s : nil
        end
      end

      # Published rates of an entry, in canonical currency order.
      def rates_of(entry)
        CURRENCIES.each_with_object({}) do |code, out|
          text = rate_text(entry[code])
          out[code] = text if text
        end
      end

      def normalize_currency(code, allow_ves: false)
        valid = allow_ves ? ANY_CURRENCIES : CURRENCIES
        if code.is_a?(String) || code.is_a?(Symbol)
          upper = code.to_s.strip.upcase
          upper = "VES" if upper == "VEF" && allow_ves # pre-2021 name some users still type
          return upper if valid.include?(upper)
        end
        raise InvalidCurrency, "Unsupported currency #{code.inspect}: use one of #{valid.join(', ')}."
      end

      # Validates an amount and returns it as an exact Decimal (floats via their shortest form).
      def parse_amount(amount)
        dec =
          case amount
          when Integer
            Decimal.from_integer(amount)
          when Float
            raise InvalidAmount, "Invalid amount #{amount.inspect}: it must be a finite number." unless amount.finite?

            Decimal.from_float(amount)
          when String
            text = amount.strip.delete("_")
            if NON_FINITE.match?(text)
              raise InvalidAmount,
                    "Invalid amount #{amount.inspect}: it must be a finite number."
            end

            Decimal.parse(text)
          else
            big_decimal(amount)
          end
        raise InvalidAmount, "Invalid amount #{amount.inspect}: expected a number." unless dec
        raise InvalidAmount, "Invalid amount #{amount.inspect}: it must be zero or positive." if dec.negative?
        raise InvalidAmount, "Invalid amount #{amount.inspect}: it must not exceed 1e15." if dec > MAX_AMOUNT

        dec
      end

      # BigDecimal amounts are accepted when the caller already uses the bigdecimal gem.
      def big_decimal(amount)
        return nil unless defined?(::BigDecimal) && amount.is_a?(::BigDecimal)
        raise InvalidAmount, "Invalid amount #{amount.inspect}: it must be a finite number." unless amount.finite?

        Decimal.parse(amount.to_s)
      end

      def check_days(days)
        return days if days.is_a?(Integer) && days.between?(1, MAX_HISTORY_DAYS)

        raise InvalidDate, "Invalid days #{days.inspect}: use a whole number from 1 to #{MAX_HISTORY_DAYS}."
      end

      def check_decimals(decimals)
        return decimals if decimals.nil? || (decimals.is_a?(Integer) && decimals.between?(0, 12))

        raise InvalidAmount, "Invalid decimals #{decimals.inspect}: use a whole number from 0 to 12, or nil."
      end

      # ------------------------------------------------------------ responses

      def decode_json(body, path)
        JSON.parse(body.to_s.dup.force_encoding(Encoding::UTF_8), freeze: true)
      rescue JSON::ParserError, EncodingError
        raise UpstreamError, "The BCV Today data API returned invalid JSON for #{path}."
      end

      def expect_object(value, what)
        raise UpstreamError, "Unexpected #{what} shape (expected an object)." unless value.is_a?(Hash)

        value
      end

      def expect_list(value)
        raise UpstreamError, "Unexpected history.json shape (expected an array)." unless value.is_a?(Array)

        value.grep(Hash)
      end

      # ------------------------------------------------------------ dates

      # Today's date in Caracas (UTC-4, no DST).
      def today_caracas(now)
        t = now.getutc + CARACAS_OFFSET
        ::Date.new(t.year, t.month, t.day)
      end

      def weekday(day)
        ::Date::DAYNAMES[day.wday]
      end

      # Rejects dates before the first snapshot or after tomorrow (Caracas).
      def check_date(day, today)
        if day < EARLIEST_SNAPSHOT
          raise DateOutOfRange, "No BCV data for #{day}: daily snapshots start on #{EARLIEST_SNAPSHOT}."
        end
        # BCV publishes the next business day's rate in the afternoon, so allow tomorrow.
        return unless day > today + 1

        raise DateOutOfRange, "#{day} is in the future (today in Caracas is #{today}); " \
                              "BCV rates are only known up to the next business day."
      end

      def not_published(day, latest)
        upto = latest ? " to #{latest}." : " to the latest business day."
        DateOutOfRange.new(
          "No BCV rate published yet for #{day}. Daily snapshots are available from #{EARLIEST_SNAPSHOT}" \
          "#{upto} Use latest() for the rate currently in effect."
        )
      end

      def carry_forward_note(day, effective)
        return nil if effective == day

        "#{day} (#{weekday(day)}) uses the rate with effective date #{effective} (#{weekday(effective)}): " \
          "a published BCV rate stays in effect until the next publication " \
          "(weekends and holidays carry it forward)."
      end

      # ------------------------------------------------------------ builders

      def dates(entry, fallback = nil)
        day = entry_date(entry, "date") || fallback
        raise UpstreamError, "Unexpected API response: the entry has no valid 'date'." unless day

        [day, entry_date(entry, "effective_date") || day]
      end

      def build_rates(entry)
        day, effective = dates(entry)
        Rates.new(
          rates: rates_of(entry).freeze,
          date: day,
          effective_date: effective,
          updated_at: parse_timestamp(entry["updated_at"]),
          raw: entry
        )
      end

      def build_day_rate(entry, day, currency)
        _, effective = dates(entry, day)
        rates = rates_of(entry)
        if currency
          unless rates.key?(currency)
            avail = rates.empty? ? "none" : rates.keys.join(", ")
            raise CurrencyNotAvailable,
                  "No #{currency} rate in the BCV data for #{day} (older entries may lack some currencies). " \
                  "Available that day: #{avail}."
          end
          rates = { currency => rates[currency] }
        end
        note = carry_forward_note(day, effective)
        DayRate.new(
          date: day,
          effective_date: effective,
          carried_forward: !note.nil?,
          rates: rates.freeze,
          updated_at: parse_timestamp(entry["updated_at"]),
          note: note,
          raw: entry
        )
      end

      def series(entries, currency)
        points = entries.filter_map do |entry|
          rate = rate_text(entry[currency])
          day = entry_date(entry, "date")
          next unless rate && day

          HistoryPoint.new(date: day, effective_date: entry_date(entry, "effective_date") || day, rate: rate)
        end
        # history.json is published oldest first; sort_by with the index keeps that order on ties.
        points.each_with_index.sort_by { |p, i| [p.date, i] }.map(&:first)
      end

      def build_history(entries, currency, days, start, finish)
        all = series(entries, currency)
        raise CurrencyNotAvailable, "No #{currency} data in the BCV history." if all.empty?

        earliest = all.first.date
        latest = all.last.date
        if start || finish
          lo = start || earliest
          hi = finish || latest
        else
          hi = latest
          lo = latest - (days - 1)
        end
        window = all.select { |p| p.date.between?(lo, hi) }
        if window.empty?
          raise DateOutOfRange,
                "No #{currency} rates between #{lo} and #{hi}. The history covers #{earliest} to #{latest} " \
                "for #{currency} (latest #{MAX_HISTORY_DAYS} daily entries). For older single days use on()."
        end
        notes = []
        notes << "History for #{currency} starts on #{earliest}; earlier dates were skipped." if lo < earliest
        notes << "Latest available date is #{latest}." if hi > latest
        History.new(currency: currency, points: window.freeze, note: notes.empty? ? nil : notes.join(" "))
      end

      def build_conversion(entry, amount, from, to, day, decimals)
        entry_day, effective = dates(entry, day)
        the_day = day || entry_day
        rates = rates_of(entry)
        ves_per = ->(code) { code == "VES" ? "1" : rates[code] }
        rf = ves_per.call(from)
        rt = ves_per.call(to)
        unless rf && rt
          missing = [[from, rf], [to, rt]].reject { |_, r| r }.map(&:first).join(" and ")
          raise CurrencyNotAvailable,
                "No BCV rate for #{missing} on #{the_day} (older entries may lack some currencies). " \
                "Available: #{rates.keys.join(', ')}."
        end
        rf_dec = Decimal.parse(rf)
        rt_dec = Decimal.parse(rt)
        rate = rf_dec.div(rt_dec)
        # Multiply first (like the Python library): VES -> X stays exact longer.
        exact = (amount * rf_dec).round_significant.div(rt_dec)
        result = decimals.nil? ? exact.to_s : exact.to_fixed(decimals)
        rates_used = {}
        rates_used[from] = rf unless from == "VES"
        rates_used[to] = rt unless to == "VES"
        note = day ? carry_forward_note(day, effective) : nil
        Conversion.new(
          amount: amount.to_s, from: from, to: to, result: result, result_exact: exact.to_s,
          rate: rate.to_s, rates_used: rates_used.freeze, date: the_day, effective_date: effective,
          carried_forward: !note.nil?, decimals: decimals, note: note
        )
      end

      def truthy?(value)
        !(value.nil? || value == false || value == 0 || value == "") # rubocop:disable Style/NumericPredicate
      end

      def build_status(doc, now)
        updated = parse_timestamp(doc["updated_at"])
        age = updated ? ((now - updated) / 3600.0).round(1) : nil
        status = doc["status"].is_a?(String) ? doc["status"] : "unknown"
        stale = age.nil? || age > STALE_AFTER_HOURS || status != "ok"
        supported = doc["supported_currencies"]
        currencies = doc["currencies"]
        text = ->(key) { doc[key].is_a?(String) ? doc[key] : nil }
        Status.new(
          status: status,
          updated_at: updated,
          generated_at: parse_timestamp(doc["generated_at"]),
          date: entry_date(doc, "date"),
          effective_date: entry_date(doc, "effective_date"),
          age_hours: age,
          stale: stale,
          supported_currencies: supported.is_a?(Array) ? supported.map(&:to_s).freeze : CURRENCIES,
          currencies: currencies.is_a?(Hash) ? currencies.to_h { |k, v| [k.to_s, truthy?(v)] }.freeze : {}.freeze,
          timezone: text.call("timezone"),
          api_version: text.call("api_version"),
          raw: doc
        )
      end
    end
  end
end
