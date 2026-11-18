<?php

// Minimal declarations of the Laravel APIs used by src/Laravel, for static
// analysis only (PHPStan scanFiles). Never loaded at runtime.

namespace Illuminate\Contracts\Config {
    interface Repository
    {
        public function get(string $key, mixed $default = null): mixed;
    }
}

namespace Illuminate\Contracts\Cache {
    interface Repository
    {
        public function get(string $key, mixed $default = null): mixed;

        public function set(string $key, mixed $value, int|\DateInterval|null $ttl = null): bool;
    }

    interface Factory
    {
        public function store(?string $name = null): Repository;
    }
}

namespace Illuminate\Contracts\Container {
    interface Container
    {
        public function bound(string $abstract): bool;

        public function make(string $abstract): mixed;

        public function singleton(string $abstract, \Closure|string|null $concrete = null): void;

        public function alias(string $abstract, string $alias): void;
    }
}

namespace Illuminate\Contracts\Foundation {
    interface Application extends \Illuminate\Contracts\Container\Container
    {
        public function runningInConsole(): bool;

        public function configPath(string $path = ''): string;
    }
}

namespace Illuminate\Support {
    abstract class ServiceProvider
    {
        /** @var \Illuminate\Contracts\Foundation\Application */
        protected $app;

        public function __construct(\Illuminate\Contracts\Foundation\Application $app)
        {
            $this->app = $app;
        }

        protected function mergeConfigFrom(string $path, string $key): void
        {
        }

        /** @param array<string, string> $paths */
        protected function publishes(array $paths, mixed $groups = null): void
        {
        }
    }
}

namespace Illuminate\Support\Facades {
    abstract class Facade
    {
        protected static function getFacadeAccessor(): string
        {
            return '';
        }
    }
}

namespace {
    function env(string $key, mixed $default = null): mixed
    {
        return $default;
    }
}
