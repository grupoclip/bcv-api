<?php

declare(strict_types=1);

namespace BcvToday\Laravel;

use BcvToday\Bcv;
use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Config\Repository as ConfigRepository;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\ServiceProvider;

/**
 * Registers BcvToday\Bcv as a singleton (also bound as "bcv") and publishes
 * config/bcv.php. Auto-discovered through composer.json "extra.laravel".
 *
 * Only Laravel loads this class; the rest of the package does not need Laravel.
 */
final class BcvServiceProvider extends ServiceProvider
{
    private const CONFIG = __DIR__ . '/../../config/bcv.php';

    public function register(): void
    {
        $this->mergeConfigFrom(self::CONFIG, 'bcv');

        $this->app->singleton(Bcv::class, static function (Container $app): Bcv {
            $repository = $app->make('config');
            $config = $repository instanceof ConfigRepository ? $repository->get('bcv', []) : [];
            $config = is_array($config) ? $config : [];
            $store = $config['cache_store'] ?? null;
            $cache = null;
            if ($store !== false && $store !== 'false' && $app->bound('cache')) {
                $factory = $app->make('cache');
                if ($factory instanceof CacheFactory) {
                    $cache = $factory->store(is_string($store) && $store !== '' ? $store : null);
                }
            }
            $timeout = $config['timeout'] ?? null;
            $ttl = $config['cache_ttl'] ?? null;

            return new Bcv(
                baseUrl: is_string($config['base_url'] ?? null) && $config['base_url'] !== '' ? $config['base_url'] : Bcv::DEFAULT_BASE_URL,
                timeout: is_numeric($timeout) ? (float) $timeout : 10.0,
                cacheTtl: is_numeric($ttl) ? (int) $ttl : 300,
                cache: $cache,
            );
        });
        $this->app->alias(Bcv::class, 'bcv');
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->publishes([self::CONFIG => $this->app->configPath('bcv.php')], 'bcv-config');
        }
    }
}
