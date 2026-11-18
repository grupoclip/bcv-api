# frozen_string_literal: true

require "test_helper"
require "socket"
require "zlib"
require "stringio"

# The default Net::HTTP client against a tiny local HTTP/1.1 server (plain TCPServer,
# no WEBrick) that serves the shared fixtures, gzip-compressed when the client asks for it.
class NetHTTPTest < Minitest::Test
  def setup
    @server = TCPServer.new("127.0.0.1", 0)
    @port = @server.addr[1]
    @requests = Queue.new
    @thread = Thread.new { serve }
  end

  def teardown
    @server.close
    @thread.kill
    @thread.join
  end

  def serve
    loop do
      socket = @server.accept
      handle(socket)
    rescue IOError, Errno::EBADF
      break
    end
  end

  def handle(socket)
    request_line = socket.gets.to_s
    headers = {}
    while (line = socket.gets) && line != "\r\n"
      key, value = line.split(":", 2)
      headers[key.downcase] = value.strip
    end
    @requests << [request_line, headers]
    path = request_line.split[1].to_s
    file = File.join(FakeHttp::FIXTURES, path.delete_prefix("/api/v1/"))
    if path.start_with?("/api/v1/") && File.file?(file)
      reply(socket, 200, File.binread(file), gzip: headers["accept-encoding"].to_s.include?("gzip"))
    else
      reply(socket, 404, "not found")
    end
  ensure
    socket.close
  end

  def reply(socket, status, body, gzip: false)
    extra = ""
    if gzip
      io = StringIO.new
      writer = Zlib::GzipWriter.new(io)
      writer.write(body)
      writer.close
      body = io.string
      extra = "Content-Encoding: gzip\r\n"
    end
    socket.write("HTTP/1.1 #{status} X\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\n" \
                 "#{extra}Connection: close\r\n\r\n#{body}")
  end

  def test_default_client_over_http_with_gzip
    bcv = BCV::Client.new(base_url: "http://127.0.0.1:#{@port}", timeout: 5, clock: -> { FakeHttp::NOW })
    assert_equal "91664.77", bcv.convert("100", "USD", "VES").result
    day = bcv.on("2026-01-04", "USD")
    assert_predicate day, :carried_forward?
    assert_equal "304.6796", day.rate
    request_line, headers = @requests.pop
    assert_equal "GET /api/v1/rate.json HTTP/1.1\r\n", request_line
    assert_equal "bcv-ruby/#{BCV::VERSION} (+https://bcv.today)", headers["user-agent"]
    assert_equal "application/json", headers["accept"]
    assert_includes headers["accept-encoding"], "gzip"
    assert_raises(BCV::DateOutOfRange) { bcv.on("2026-11-19") }
  end

  def test_connection_refused_is_upstream
    closed = TCPServer.new("127.0.0.1", 0)
    port = closed.addr[1]
    closed.close
    bcv = BCV::Client.new(base_url: "http://127.0.0.1:#{port}", timeout: 2)
    error = assert_raises(BCV::UpstreamError) { bcv.latest }
    assert_match(/\ACould not reach the BCV Today data API \(.+\)\. Try again in a moment\.\z/, error.message)
    assert_nil error.status
  end
end
