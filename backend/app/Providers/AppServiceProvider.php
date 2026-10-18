<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Register application bindings here as integrations are implemented.
    }

    public function boot(): void
    {
    }
}
