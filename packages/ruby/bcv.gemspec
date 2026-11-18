# frozen_string_literal: true

require_relative "lib/bcv/version"

Gem::Specification.new do |spec|
  spec.name = "bcv"
  spec.version = BCV::VERSION
  spec.authors = ["Grupo Clip"]
  spec.summary = "Official Ruby client for the BCV Today API: Banco Central de Venezuela (BCV) exchange rates."
  spec.description = <<~TEXT.tr("\n", " ").strip
    Official Banco Central de Venezuela (BCV) exchange rates for USD, EUR, CNY, TRY and RUB against the
    bolivar (VES) from the free BCV Today API (https://bcv.today): latest rates, any day since 2021-08-02
    with weekend and holiday carry-forward, history and exact decimal conversions, plus a `bcv` command.
    Zero runtime dependencies. Unofficial, not affiliated with the bank.
  TEXT
  spec.homepage = "https://bcv.today"
  spec.license = "Apache-2.0"
  spec.required_ruby_version = ">= 3.1"

  spec.metadata = {
    "homepage_uri" => "https://bcv.today",
    "source_code_uri" => "https://github.com/grupoclip/bcv-api/tree/main/packages/ruby",
    "changelog_uri" => "https://github.com/grupoclip/bcv-api/blob/main/packages/ruby/CHANGELOG.md",
    "documentation_uri" => "https://bcv.today/en/api/",
    "bug_tracker_uri" => "https://github.com/grupoclip/bcv-api/issues",
    "rubygems_mfa_required" => "true"
  }

  spec.files = Dir["lib/**/*.rb", "exe/*"] + %w[README.md CHANGELOG.md LICENSE]
  spec.bindir = "exe"
  spec.executables = ["bcv"]
  spec.require_paths = ["lib"]
end
