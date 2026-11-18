<?php

declare(strict_types=1);

// Configuration of the BCV Today client (grupoclip/bcv-today) for Laravel.
// Publish it with: php artisan vendor:publish --tag=bcv-config

return [
    // Origin of the BCV Today API.
    'base_url' => env('BCV_BASE_URL', 'https://bcv.today'),

    // Per-request timeout, in seconds.
    'timeout' => env('BCV_TIMEOUT', 10),

    // Seconds to keep API responses cached; 0 disables caching. BCV publishes a
    // few times per business day, so a few minutes is plenty fresh.
    'cache_ttl' => env('BCV_CACHE_TTL', 300),

    // Laravel cache store used to share responses across requests: null uses the
    // default store (config/cache.php), a name such as "redis" uses that store,
    // and false keeps an in-memory cache for the current request only.
    'cache_store' => env('BCV_CACHE_STORE'),
];
