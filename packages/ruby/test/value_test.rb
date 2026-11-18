# frozen_string_literal: true

require "test_helper"

# BCV::Value uses Data.define on Ruby >= 3.2 and a frozen Struct on Ruby 3.1; both behave alike.
class ValueTest < Minitest::Test
  def classes
    [true, false].map do |struct|
      BCV::Value.define(:a, :b, struct: struct) { define_method(:sum) { a + b } }
    end
  end

  def test_both_flavours_are_immutable_value_objects
    classes.each do |klass|
      v = klass.new(a: 1, b: 2)
      assert_equal 3, v.sum
      assert_equal 1, klass.new(1, 2).a
      assert_predicate v, :frozen?
      assert_equal v, klass.new(a: 1, b: 2)
      assert_equal({ a: 1, b: 2 }, v.to_h)
      refute_respond_to v, :a=
      assert_raises(ArgumentError) { klass.new(a: 1) }
      assert_raises(ArgumentError) { klass.new(a: 1, b: 2, c: 3) }
      assert_raises(ArgumentError) { klass.new(1) }
    end
  end

  def test_struct_flavour_cannot_be_mutated
    v = classes.first.new(a: 1, b: 2)
    assert_raises(NoMethodError) { v[:a] = 5 }
    assert_raises(FrozenError) { v.instance_variable_set(:@x, 1) }
  end

  def test_results_use_data_when_available
    skip "Data.define needs Ruby >= 3.2" unless defined?(Data.define)

    assert_operator BCV::Rates, :<, Data
  end
end
