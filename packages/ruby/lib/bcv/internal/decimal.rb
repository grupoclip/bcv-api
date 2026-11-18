# frozen_string_literal: true

module BCV
  module Internal
    # @api private
    # Minimal exact decimal arithmetic on Integer coefficients (value = coef * 10**exp).
    #
    # Enough for currency conversion without binary floating-point drift and without
    # the bigdecimal gem: exact add/sub/mul, division to a fixed number of significant
    # digits (28, like Python's decimal default context) and ROUND_HALF_UP quantization
    # (half away from zero). A port of packages/js/src/decimal.ts.
    class Decimal
      include Comparable

      # Significant digits kept by #div (same as Python's default decimal context).
      PRECISION = 28
      PATTERN = /\A([+-])?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?\z/
      MAX_EXPONENT = 10_000

      attr_reader :coef, :exp

      # Parses a plain or exponent decimal string ("12.5", "-0.1", "1e-7", "1.0e+20"); nil if invalid.
      def self.parse(text)
        m = PATTERN.match(text.to_s)
        return nil unless m

        int = m[2].to_s
        frac = m[3].to_s
        return nil if int.empty? && frac.empty?

        exp = m[4].to_s.to_i - frac.length
        return nil if exp.abs > MAX_EXPONENT

        coef = "#{int}#{frac}".to_i
        new(m[1] == "-" ? -coef : coef, exp).normalize
      end

      # Exact decimal of a finite Float, via its shortest round-trip representation (0.1 -> "0.1").
      def self.from_float(value)
        raise ArgumentError, "not a finite number: #{value}" unless value.finite?

        parse(value.to_s)
      end

      def self.from_integer(value)
        new(value, 0).normalize
      end

      def initialize(coef, exp)
        @coef = coef
        @exp = exp
        freeze
      end

      # Strips trailing zeros from the coefficient.
      def normalize
        return Decimal.new(0, 0) if coef.zero?

        c = coef
        e = exp
        while (c % 10).zero?
          c /= 10
          e += 1
        end
        Decimal.new(c, e)
      end

      def +(other)
        x, y, e = align(other)
        Decimal.new(x + y, e).normalize
      end

      def -(other)
        x, y, e = align(other)
        Decimal.new(x - y, e).normalize
      end

      def *(other)
        Decimal.new(coef * other.coef, exp + other.exp).normalize
      end

      def <=>(other)
        return nil unless other.is_a?(Decimal)

        x, y, = align(other)
        x <=> y
      end

      def zero?
        coef.zero?
      end

      def negative?
        coef.negative?
      end

      # Rounds to +prec+ significant digits (half-up).
      def round_significant(prec = PRECISION)
        extra = Decimal.digits(coef) - prec
        return self if extra <= 0

        Decimal.new(Decimal.shift_round(coef, extra), exp + extra).normalize
      end

      # self / other rounded half-up to +prec+ significant digits.
      def div(other, prec = PRECISION)
        raise ZeroDivisionError, "division by zero" if other.zero?
        return Decimal.new(0, 0) if zero?

        # Scale the dividend so the integer quotient has at least prec + 2 digits.
        k = [0, prec + 2 + Decimal.digits(other.coef) - Decimal.digits(coef)].max
        num = coef * (10**k)
        q = Decimal.truncate_div(num, other.coef)
        e = exp - other.exp - k
        extra = Decimal.digits(q) - prec
        return Decimal.new(q, e).normalize if extra <= 0

        Decimal.new(Decimal.shift_round(q, extra), e + extra).normalize
      end

      # Rounds to exactly +places+ decimal places (half-up); the result keeps that scale.
      def quantize(places)
        target = -places
        return Decimal.new(coef * (10**(exp - target)), target) if exp >= target

        Decimal.new(Decimal.shift_round(coef, target - exp), target)
      end

      # Plain (non-exponent) string; +places+ forces that many decimals (half-up).
      def to_fixed(places = nil)
        d = places.nil? ? self : quantize(places)
        s = d.coef.abs.to_s
        out =
          if d.exp >= 0
            s + ("0" * d.exp)
          else
            scale = -d.exp
            s = ("0" * (scale - s.length + 1)) + s if s.length <= scale
            "#{s[0...(s.length - scale)]}.#{s[(s.length - scale)..]}"
          end
        d.coef.negative? && out.match?(/[1-9]/) ? "-#{out}" : out
      end

      # Plain string of the exact value without trailing zeros ("91664.77", "0.0125", "3").
      def to_s
        normalize.to_fixed
      end

      def inspect
        "#<BCV::Internal::Decimal #{self}>"
      end

      # Display format with thousands separators: group(2) -> "91,664.77".
      def group(places)
        fixed = to_fixed(places)
        neg = fixed.start_with?("-")
        body = neg ? fixed[1..] : fixed
        int, frac = body.split(".", 2)
        grouped = int.reverse.scan(/\d{1,3}/).join(",").reverse
        "#{'-' if neg}#{grouped}#{".#{frac}" if frac}"
      end

      def self.digits(int)
        int.zero? ? 1 : int.abs.to_s.length
      end

      # Integer division truncating toward zero (Ruby's / floors).
      def self.truncate_div(dividend, divisor)
        q = dividend.abs / divisor.abs
        dividend.negative? ^ divisor.negative? ? -q : q
      end

      # int / 10**places rounded half away from zero (ROUND_HALF_UP).
      def self.shift_round(int, places)
        return int * (10**-places) if places <= 0

        p = 10**places
        q, r = int.abs.divmod(p)
        q += 1 if r * 2 >= p
        int.negative? ? -q : q
      end

      private

      def align(other)
        e = [exp, other.exp].min
        [coef * (10**(exp - e)), other.coef * (10**(other.exp - e)), e]
      end
    end
  end
end
