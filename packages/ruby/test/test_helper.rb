# frozen_string_literal: true

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))

require "bcv"
require "bcv/cli"
require "minitest/autorun"

# Offline HTTP client serving the recorded API samples shared with the Python, JavaScript
# and PHP clients (packages/python/tests/fixtures, read in place); records every call.
class FakeHttp
  FIXTURES = File.expand_path("../../python/tests/fixtures", __dir__)
  PREFIX = "https://bcv.today/api/v1/"
  # Frozen "now": 2026-11-18 11:00 in Caracas (the fixtures were recorded that day).
  NOW = Time.utc(2026, 11, 18, 15, 0, 0)

  attr_reader :calls, :headers, :timeouts

  def initialize(overrides = {})
    @overrides = overrides
    @calls = []
    @headers = []
    @timeouts = []
  end

  def call(url, headers, timeout)
    @calls << url
    @headers << headers
    @timeouts << timeout
    override = @overrides[url]
    return override.respond_to?(:call) ? override.call(url) : override if override
    raise "unexpected URL #{url}" unless url.start_with?(PREFIX)

    path = File.join(FIXTURES, url.delete_prefix(PREFIX))
    return BCV::Response.new(status: 404, body: "<html>404</html>") unless File.file?(path)

    BCV::Response.new(status: 200, body: File.binread(path))
  end

  # A client on the fake transport with the frozen clock.
  def self.client(http = nil, cache_ttl: 300, now: NOW)
    BCV::Client.new(cache_ttl: cache_ttl, http: http || new, clock: -> { now })
  end
end

module Helpers
  SUNDAY_NOTE = "2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV " \
                "rate stays in effect until the next publication (weekends and holidays carry it forward)."

  def d(text) = Date.iso8601(text)

  def assert_raises_message(klass, pattern, &)
    error = assert_raises(klass, &)
    if pattern.is_a?(Regexp)
      assert_match pattern, error.message
    else
      assert_equal pattern, error.message
    end
    error
  end

  def rate_json(json)
    FakeHttp.client(FakeHttp.new("#{FakeHttp::PREFIX}rate.json" => BCV::Response.new(status: 200, body: json)))
  end
end
