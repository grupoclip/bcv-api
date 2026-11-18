# frozen_string_literal: true

require "net/http"
require "uri"
require_relative "value"

module BCV
  # What an HTTP client returns: the status code and the raw body String.
  Response = Value.define(:status, :body)

  # Default HTTP client built on Net::HTTP (standard library only). Any callable with the
  # same signature can be passed to BCV::Client.new(http:): (url, headers, timeout) -> BCV::Response.
  # It should return non-2xx statuses rather than raise; any StandardError it raises is
  # reported as BCV::UpstreamError.
  class NetHTTPClient
    def call(url, headers, timeout)
      uri = URI(url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      limit = timeout.positive? ? timeout : nil
      http.open_timeout = limit
      http.read_timeout = limit
      http.write_timeout = limit
      http.ssl_timeout = limit if http.use_ssl?
      # Net::HTTP adds Accept-Encoding: gzip and decompresses the body itself.
      request = Net::HTTP::Get.new(uri, headers)
      response = http.start { |conn| conn.request(request) }
      Response.new(status: response.code.to_i, body: response.body.to_s)
    end
  end

  # @api private
  # Tiny thread-safe in-memory cache of parsed (frozen) JSON keyed by path.
  class MemoryCache
    MAX_ENTRIES = 64

    def initialize
      @data = {}
      @lock = Mutex.new
    end

    # Returns [true, value] on a fresh hit, [false, nil] otherwise.
    def get(key, now)
      @lock.synchronize do
        hit = @data[key]
        return [false, nil] unless hit

        if hit[0] <= now
          @data.delete(key)
          return [false, nil]
        end
        [true, hit[1]]
      end
    end

    def set(key, value, ttl, now)
      @lock.synchronize do
        @data.clear if @data.size >= MAX_ENTRIES && !@data.key?(key)
        @data[key] = [now + ttl, value]
      end
    end

    def clear
      @lock.synchronize { @data.clear }
    end

    def size
      @lock.synchronize { @data.size }
    end
  end
end
