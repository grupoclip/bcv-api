# frozen_string_literal: true

module BCV
  # @api private
  # Defines immutable value classes: Data.define on Ruby >= 3.2, a frozen Struct without
  # writers on Ruby 3.1. Both accept keyword (or positional) arguments, require every member
  # and freeze the instance.
  module Value
    module_function

    def define(*members, struct: !defined?(::Data.define), &block)
      return ::Data.define(*members, &block) unless struct

      klass = Struct.new(*members) do
        def initialize(*args, **kwargs)
          super(*Value.arguments(members, args, kwargs))
          freeze
        end
      end
      # Like Data: no writers.
      klass.send(:undef_method, :[]=, *members.map { |m| :"#{m}=" })
      klass.class_eval(&block) if block
      klass
    end

    # Positional arguments for Struct#initialize, validated like Data.new.
    def arguments(members, args, kwargs)
      unless kwargs.empty?
        raise ArgumentError, "use either positional or keyword arguments" unless args.empty?

        check_keywords("missing", members - kwargs.keys)
        check_keywords("unknown", kwargs.keys - members)
        return members.map { |m| kwargs[m] }
      end
      return args if args.size == members.size

      raise ArgumentError, "wrong number of arguments (given #{args.size}, expected #{members.size})"
    end

    def check_keywords(kind, names)
      return if names.empty?

      raise ArgumentError, "#{kind} keyword#{'s' if names.size > 1}: #{names.map(&:inspect).join(', ')}"
    end
  end
end
