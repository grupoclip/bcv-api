<?php

declare(strict_types=1);

namespace BcvToday\Http;

/**
 * HTTP GET with ext-curl (used by default when the extension is loaded; it adds
 * gzip and finer timeouts). Returns non-2xx responses instead of failing; throws
 * \RuntimeException when the server cannot be reached.
 */
final class CurlTransport
{
    public static function isAvailable(): bool
    {
        return function_exists('curl_init');
    }

    /**
     * @param array<string, string> $headers
     */
    public function __invoke(string $url, array $headers, float $timeout): Response
    {
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        if ($url === '') {
            throw new \RuntimeException('empty URL');
        }
        $handle = curl_init();
        if ($handle === false) {
            throw new \RuntimeException('could not initialise curl');
        }
        $ms = (int) round($timeout * 1000);
        curl_setopt_array($handle, [
            CURLOPT_URL => $url,
            CURLOPT_HTTPGET => true,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_ENCODING => '', // accept and decode gzip/deflate/br
            CURLOPT_CONNECTTIMEOUT_MS => $ms,
            CURLOPT_TIMEOUT_MS => $ms,
            CURLOPT_NOSIGNAL => true,
        ]);
        $body = curl_exec($handle);
        if (!is_string($body)) {
            $errno = curl_errno($handle);
            $message = $errno === CURLE_OPERATION_TIMEDOUT
                ? sprintf('timed out after %s s', rtrim(rtrim(sprintf('%.3f', $timeout), '0'), '.'))
                : curl_error($handle);
            throw new \RuntimeException($message !== '' ? $message : 'request failed');
        }

        return new Response((int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE), $body);
    }
}
