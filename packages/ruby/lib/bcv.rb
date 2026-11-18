# frozen_string_literal: true

# Official Ruby client for the BCV Today API (https://bcv.today): the exchange rates
# published by Banco Central de Venezuela (BCV), bolivars (VES) per unit of USD, EUR,
# CNY, TRY and RUB.
#
# Unofficial: BCV Today is not affiliated with Banco Central de Venezuela.
# Code: Apache-2.0. Data: CC BY 4.0, attribution "BCV Today (https://bcv.today)".
#
#   require "bcv"
#
#   BCV.latest.rate("USD")                  # => "916.6477"
#   BCV.on("2026-01-04", "USD").note        # Sunday -> Saturday's rate carried forward
#   BCV.convert("100", "USD", "VES").result # => "91664.77"

require_relative "bcv/version"
require_relative "bcv/constants"
require_relative "bcv/errors"
require_relative "bcv/models"
require_relative "bcv/http"
require_relative "bcv/client"

# Namespace of the bcv gem. The module-level methods use a shared default BCV::Client.
module BCV
  @client_lock = Mutex.new
  @client = nil

  class << self
    # The default client used by the module-level shortcuts (created on first use).
    def client
      @client_lock.synchronize { @client ||= Client.new }
    end

    # Replaces the default client, e.g. BCV.client = BCV::Client.new(cache: Rails.cache).
    def client=(value)
      raise InvalidArgument, "BCV.client= expects a BCV::Client." unless value.nil? || value.is_a?(Client)

      @client_lock.synchronize { @client = value }
    end

    # See BCV::Client#latest.
    def latest = client.latest

    # See BCV::Client#on.
    def on(date, currency = nil) = client.on(date, currency)

    # See BCV::Client#history.
    def history(currency, **options) = client.history(currency, **options)

    # See BCV::Client#convert.
    def convert(amount, from, to, **options) = client.convert(amount, from, to, **options)

    # See BCV::Client#status.
    def status = client.status
  end
end
