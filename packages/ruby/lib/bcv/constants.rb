# frozen_string_literal: true

require "date"

module BCV
  # Foreign currencies published by BCV, in display order.
  CURRENCIES = %w[USD EUR CNY TRY RUB].freeze
  # Currencies accepted by conversions: the bolivar plus the published ones.
  ANY_CURRENCIES = (["VES"] + CURRENCIES).freeze
  # Attribution attached to every result.
  SOURCE = "Banco Central de Venezuela (BCV), via https://bcv.today"
  # Unit of every rate value.
  UNIT = "VES (bolivars) per 1 unit of the currency"
  # First calendar day with a /api/v1/history/{date}.json snapshot.
  EARLIEST_SNAPSHOT = Date.new(2021, 8, 2).freeze
  # history.json keeps (at most) this many daily entries.
  MAX_HISTORY_DAYS = 1830
  # Hours without a capture after which the data is considered stale (weekend + holiday).
  STALE_AFTER_HOURS = 96
  # Default API origin.
  DEFAULT_BASE_URL = "https://bcv.today"
end
