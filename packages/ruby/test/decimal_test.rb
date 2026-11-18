# frozen_string_literal: true

require "test_helper"

# Exact decimal arithmetic (port of packages/js/src/decimal.ts; cases from packages/php/tests/DecimalTest.php).
class DecimalTest < Minitest::Test
  Dec = BCV::Internal::Decimal

  def dec(text) = Dec.parse(text)

  def test_parse_and_plain_string
    { "12.5" => "12.5", "-0.1" => "-0.1", "1e-7" => "0.0000001", "1E+21" => "1000000000000000000000",
      "1.0e+20" => "100000000000000000000", "0012.500" => "12.5", ".5" => "0.5", "5." => "5", "+3" => "3",
      "-0" => "0", "0.000" => "0" }.each do |input, plain|
      assert_equal plain, dec(input).to_s, input
    end
    ["", ".", "e5", "1e", "abc", "1.2.3", "--1", "0x10", "1e10001", " 1", "١"].each do |bad|
      assert_nil dec(bad), bad
    end
  end

  def test_from_float_uses_the_shortest_representation
    assert_equal "0.1", Dec.from_float(0.1).to_s
    assert_equal "916.6477", Dec.from_float(916.6477).to_s
    assert_equal "0.00001", Dec.from_float(1e-05).to_s
    assert_equal "100000000000000000000", Dec.from_float(1e20).to_s
    assert_raises(ArgumentError) { Dec.from_float(Float::NAN) }
  end

  def test_exact_add_sub_mul_and_compare
    assert_equal "0.3", (dec("0.1") + dec("0.2")).to_s
    assert_equal "-0.1", (dec("0.1") - dec("0.2")).to_s
    assert_equal "0.01", (dec("0.1") * dec("0.1")).to_s
    assert_operator dec("1.10"), :==, dec("1.1")
    assert_operator dec("2"), :>, dec("1.99999999999999999999")
    assert_operator dec("-3"), :<, dec("0")
  end

  def test_division_keeps28_significant_digits_half_up
    assert_equal "0.3333333333333333333333333333", dec("1").div(dec("3")).to_s
    assert_equal "0.6666666666666666666666666667", dec("2").div(dec("3")).to_s
    assert_equal "-0.6666666666666666666666666667", dec("-2").div(dec("3")).to_s
    assert_equal "-0.6666666666666666666666666667", dec("2").div(dec("-3")).to_s
    assert_equal "1.090931663276960166921271935", dec("1000").div(dec("916.6477")).to_s
    assert_equal "0", dec("0").div(dec("7")).to_s
    assert_equal "25", dec("100").div(dec("4")).to_s
    assert_raises(ZeroDivisionError) { dec("1").div(dec("0")) }
  end

  def test_quantize_and_fixed_round_half_away_from_zero
    assert_equal "0.13", dec("0.125").to_fixed(2)
    assert_equal "-0.13", dec("-0.125").to_fixed(2)
    assert_equal "0.12", dec("0.1249999").to_fixed(2)
    assert_equal "3", dec("2.5").to_fixed(0)
    assert_equal "1.10", dec("1.1").to_fixed(2)
    assert_equal "0.00", dec("0.001").to_fixed(2)
    assert_equal "0.00", dec("-0.001").to_fixed(2)
    assert_equal "100", dec("1e2").to_fixed
  end

  def test_round_significant
    assert_equal "1.234567890123456789012345679", dec("1.2345678901234567890123456789").round_significant.to_s
    assert_equal "12.5", dec("12.5").round_significant.to_s
  end

  def test_group_with_thousands_separators
    assert_equal "91,664.77", dec("91664.77").group(2)
    assert_equal "1,007.3867", dec("1007.38665582").group(4)
    assert_equal "-1,234,567.000", dec("-1234567").group(3)
    assert_equal "999.00", dec("999").group(2)
    assert_equal "0.0000", dec("0").group(4)
  end
end
