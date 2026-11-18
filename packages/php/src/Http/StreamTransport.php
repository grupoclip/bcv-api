<?php

declare(strict_types=1);

namespace BcvToday\Http;

/**
 * HTTP GET with PHP streams (file_get_contents + stream context): no extension
 * needed beyond openssl for https. Returns non-2xx responses instead of failing;
 * throws \RuntimeException when the server cannot be reached.
 */
final class StreamTransport
{
    /**
     * @param array<string, string> $headers
     */
    public function __invoke(string $url, array $headers, float $timeout): Response
    {
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => implode("\r\n", $lines),
                'timeout' => $timeout > 0 ? $timeout : (float) ini_get('default_socket_timeout'),
                'ignore_errors' => true, // give us the body and status of 4xx/5xx responses
                'follow_location' => 1,
                'max_redirects' => 5,
                'protocol_version' => 1.1,
            ],
        ]);
        $error = null;
        set_error_handler(static function (int $severity, string $message) use (&$error): bool {
            $error = $message;

            return true;
        });
        try {
            $body = file_get_contents($url, false, $context);
            $responseHeaders = function_exists('http_get_last_response_headers')
                ? http_get_last_response_headers()
                : (get_defined_vars()['http_response_header'] ?? null); // PHP < 8.4: magic local variable
        } finally {
            restore_error_handler();
        }
        if ($body === false || !is_array($responseHeaders) || $responseHeaders === []) {
            $reason = is_string($error) ? preg_replace('/^file_get_contents\([^)]*\): /', '', $error) : 'request failed';
            throw new \RuntimeException((string) $reason);
        }

        return new Response(self::statusOf($responseHeaders), $body);
    }

    /**
     * Status code of the last response (after redirects).
     *
     * @param array<mixed> $headers
     */
    private static function statusOf(array $headers): int
    {
        $status = 0;
        foreach ($headers as $line) {
            if (is_string($line) && preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $status = (int) $m[1];
            }
        }

        return $status;
    }
}
