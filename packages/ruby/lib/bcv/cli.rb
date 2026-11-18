# frozen_string_literal: true

require "json"
require_relative "../bcv"

module BCV
  # Command-line interface: bcv latest | on | convert | history | status
  #
  # Same subcommands, flags, output and exit codes as the Python `bcv` and JavaScript
  # `bcv-today` commands: 0 success, 1 no data for the request (date out of range,
  # currency not available), 2 invalid arguments, 3 upstream/network error.
  class CLI
    EXIT_OK = 0
    EXIT_NO_DATA = 1
    EXIT_USAGE = 2
    EXIT_UPSTREAM = 3

    PROG = "bcv"
    ATTRIBUTION = "Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial."
    USAGE = "Usage: #{PROG} [options] <command> [args]   (#{PROG} --help for details)".freeze

    HELP = <<~TEXT.freeze
      Usage: #{PROG} [options] <command> [args]

      Official Banco Central de Venezuela exchange rates from the BCV Today API
      (https://bcv.today). Unofficial client, not affiliated with the bank.

      Commands:
        latest                              rates currently in effect
        on <date> [-c CUR]                  rate in effect on a date (YYYY-MM-DD)
        convert <amount> <from> <to>        convert an amount, e.g. "#{PROG} convert 100 USD VES"
                [-d DATE] [--decimals N]
        history <currency> [-n DAYS]        daily series (last N days, default 30, max #{MAX_HISTORY_DAYS})
                [--start DATE] [--end DATE]
        status                              data freshness

      Options:
        --json             machine-readable JSON output
        --base-url URL     API origin (default https://bcv.today)
        --timeout SECONDS  request timeout (default 10)
        -h, --help         show this help
        -v, --version      show the version

      Exit codes: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network/API error.
    TEXT

    # Option name => takes a value?
    OPTIONS = {
      "json" => false, "base-url" => true, "timeout" => true, "help" => false, "version" => false,
      "currency" => true, "date" => true, "decimals" => true, "days" => true, "start" => true, "end" => true
    }.freeze
    SHORT = { "h" => "help", "v" => "version", "c" => "currency", "d" => "date", "n" => "days" }.freeze
    COMMON = %w[json base-url timeout help version].freeze
    COMMANDS = {
      "latest" => [[], []],
      "on" => [%w[date], %w[currency]],
      "convert" => [%w[amount from to], %w[date decimals]],
      "history" => [%w[currency], %w[days start end]],
      "status" => [[], []]
    }.freeze
    NEGATIVE = /\A-\d+(?:\.\d*)?\z/

    # Raised for command-line syntax errors (exit code 2).
    class UsageError < StandardError; end

    # Runs the command line and returns the exit code. +client+ is a testing hook.
    def self.run(argv = ARGV, out: $stdout, err: $stderr, client: nil)
      new(out: out, err: err, client: client).run(argv)
    end

    def initialize(out: $stdout, err: $stderr, client: nil)
      @out = out
      @err = err
      @client = client
    end

    def run(argv)
      parsed = parse(argv.map(&:to_s))
      return show(HELP.chomp) if parsed == :help
      return show("#{PROG} #{VERSION}") if parsed == :version

      execute(*parsed)
    rescue UsageError => e
      @err.puts(USAGE)
      @err.puts("#{PROG}: error: #{e.message}")
      EXIT_USAGE
    end

    private

    def show(text)
      @out.puts(text)
      EXIT_OK
    end

    def execute(command, args, values)
      as_json = values["json"] == true
      begin
        result = call(command, args, values)
        @out.puts(as_json ? JSON.pretty_generate(result.as_json) : render(command, result))
        EXIT_OK
      rescue UsageError => e
        @err.puts("#{PROG}: error: #{e.message}")
        EXIT_USAGE
      rescue Error => e
        if as_json
          @out.puts(JSON.generate({ "error" => { "type" => e.class.name.split("::").last,
                                                 "message" => e.message } }))
        end
        @err.puts("#{PROG}: error: #{e.message}")
        exit_code(e)
      end
    end

    def exit_code(error)
      case error
      when InvalidArgument then EXIT_USAGE
      when UpstreamError then EXIT_UPSTREAM
      else EXIT_NO_DATA
      end
    end

    def call(command, args, values)
      bcv = @client || build_client(values)
      case command
      when "latest" then bcv.latest
      when "on" then bcv.on(args[0], values["currency"])
      when "convert"
        decimals = int(values["decimals"], "decimals")
        options = {}
        options[:date] = values["date"] if values.key?("date")
        options[:decimals] = decimals unless decimals.nil?
        bcv.convert(args[0], args[1], args[2], **options)
      when "history"
        days = int(values["days"], "days")
        options = { start: values["start"], end: values["end"] }
        options[:days] = days unless days.nil?
        bcv.history(args[0], **options)
      else bcv.status
      end
    end

    def build_client(values)
      timeout = 10.0
      if values.key?("timeout")
        timeout = Float(values["timeout"], exception: false)
        unless timeout&.finite? && timeout >= 0
          raise UsageError, "argument --timeout: invalid float value: '#{values['timeout']}'"
        end
      end
      Client.new(base_url: values.fetch("base-url", DEFAULT_BASE_URL), timeout: timeout)
    end

    def int(value, label)
      return nil if value.nil?
      raise UsageError, "argument --#{label}: invalid int value: '#{value}'" unless value.strip.match?(/\A-?\d+\z/)

      Integer(value.strip, 10)
    end

    # ------------------------------------------------------------ parsing

    def parse(argv)
      positionals, values = tokenize(argv)
      return :version if values["version"]
      return :help if values["help"]

      command, *args = positionals
      raise UsageError, "missing command" if command.nil?

      spec = COMMANDS[command]
      raise UsageError, %(unknown command "#{command}" (choose from #{COMMANDS.keys.join(', ')})) unless spec

      validate(command, spec, args, values)
      [command, args, values]
    end

    def validate(command, spec, args, values)
      wanted, allowed = spec
      if args.size != wanted.size
        want = wanted.empty? ? "no arguments" : wanted.map { |a| "<#{a}>" }.join(" ")
        raise UsageError, %("#{command}" expects #{want})
      end
      values.each_key do |key|
        next if COMMON.include?(key) || allowed.include?(key)

        raise UsageError, %(option --#{key} is not valid for "#{command}")
      end
    end

    def tokenize(argv)
      positionals = []
      values = {}
      queue = argv.dup
      until queue.empty?
        arg = queue.shift
        if arg == "--"
          positionals.concat(queue)
          break
        elsif !arg.start_with?("-") || arg == "-" || NEGATIVE.match?(arg)
          # Like argparse, negative numbers ("-5") are positionals, so `convert -5 USD VES`
          # reports an invalid amount.
          positionals << arg
        else
          name, inline = option(arg)
          values[name] = value_for(name, inline, queue)
        end
      end
      [positionals, values]
    end

    def option(arg)
      if arg.start_with?("--")
        name, inline = arg[2..].split("=", 2)
      else
        name = SHORT[arg[1]]
        inline = arg.length > 2 ? arg[2..].delete_prefix("=") : nil
      end
      raise UsageError, "unknown option '#{arg}'" unless name && OPTIONS.key?(name)

      [name, inline]
    end

    def value_for(name, inline, queue)
      unless OPTIONS[name]
        raise UsageError, "option --#{name} does not take a value" unless inline.nil?

        return true
      end
      return inline unless inline.nil?
      raise UsageError, "option --#{name} needs a value" if queue.empty?

      queue.shift
    end

    # ------------------------------------------------------------ rendering

    def render(command, result)
      case command
      when "latest" then render_rates(result)
      when "on" then render_day(result)
      when "convert" then render_conversion(result)
      when "history" then render_history(result)
      else render_status(result)
      end
    end

    def num(text, places = 4)
      Format.num(text, places)
    end

    def table(headers, rows, align)
      widths = headers.each_index.map { |i| [headers[i].length, *rows.map { |r| r[i].to_s.length }].max }
      line = lambda do |cells|
        cells.each_with_index.map { |c, i| align[i] == "r" ? c.rjust(widths[i]) : c.ljust(widths[i]) }
             .join("  ").rstrip
      end
      [line.call(headers), widths.map { |w| "-" * w }.join("  "), *rows.map(&line)].join("\n")
    end

    def bare(rows)
      table(["", ""], rows, "ll").split("\n").drop(2).join("\n")
    end

    def render_rates(rates)
      rows = rates.rates.map { |code, v| [code, num(v)] }
      updated = rates.updated_at ? rates.updated_at.utc.strftime("%Y-%m-%d %H:%M UTC") : "unknown"
      [
        "Official BCV rates, effective #{rates.effective_date} (Bs. per unit)",
        "",
        table(["Currency", "Rate (VES)"], rows, "lr"),
        "",
        "Updated #{updated}. #{ATTRIBUTION}"
      ].join("\n")
    end

    def render_day(day)
      rows = day.rates.map { |code, v| [code, num(v)] }
      out = [
        "BCV rate in effect on #{day.date} (effective date #{day.effective_date}, Bs. per unit)",
        "",
        table(["Currency", "Rate (VES)"], rows, "lr")
      ]
      out.push("", "Note: #{day.note}") if day.note
      [*out, "", ATTRIBUTION].join("\n")
    end

    def render_conversion(conv)
      places = conv.decimals.nil? ? 8 : conv.decimals
      rows = [
        ["Amount", "#{num(conv.amount, 2)} #{conv.from}"],
        ["Result", "#{num(conv.result, places)} #{conv.to}"],
        ["Rate", "1 #{conv.from} = #{num(conv.rate, 6)} #{conv.to}"],
        *conv.rates_used.map { |code, v| ["BCV #{code}", "#{num(v)} VES"] },
        ["Effective", conv.effective_date.to_s]
      ]
      out = [bare(rows)]
      out.push("", "Note: #{conv.note}") if conv.note
      [*out, "", ATTRIBUTION].join("\n")
    end

    def render_history(hist)
      rows = hist.points.map do |p|
        [p.date.to_s, p.effective_date.to_s + (p.carried_forward? ? " *" : ""), num(p.rate)]
      end
      out = [
        "#{hist.currency}/VES official BCV rate, #{hist.start} to #{hist.end} (#{hist.size} days)",
        "",
        table(["Date", "Effective", "Rate (VES)"], rows, "llr"),
        "",
        *history_stats(hist)
      ]
      out << "* rate carried forward from the effective date (weekend/holiday)." if hist.any?(&:carried_forward?)
      out << "Note: #{hist.note}" if hist.note
      [*out, ATTRIBUTION].join("\n")
    end

    def history_stats(hist)
      sign = Format.dec(hist.change).negative? ? "" : "+"
      pct = Format.dec(hist.change_pct).to_fixed(2)
      [
        "First #{num(hist.first.rate)}  Last #{num(hist.last.rate)}  " \
        "Change #{sign}#{num(hist.change)} (#{sign}#{pct}%)",
        "Min #{num(hist.min.rate)} on #{hist.min.date}  Max #{num(hist.max.rate)} on #{hist.max.date}"
      ]
    end

    def render_status(status)
      raw_updated = status.raw["updated_at"]
      bare([
             ["Status", status.status + (status.stale? ? " (STALE)" : "")],
             ["Updated", status.updated_at && raw_updated.is_a?(String) ? raw_updated : "unknown"],
             ["Age", status.age_hours.nil? ? "unknown" : "#{status.age_text} h"],
             ["Effective date", status.effective_date ? status.effective_date.to_s : "unknown"],
             ["Currencies", status.supported_currencies.join(", ")]
           ])
    end
  end
end
