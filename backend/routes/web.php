<?php

use App\Http\Controllers\MessageDetailController;
use Illuminate\Support\Facades\Route;

// The email preview is a real document navigation, not a srcdoc iframe.
// It needs an independent CSP to display legitimate email styles safely.
Route::middleware('auth:web')->get('/message-html/{id}', [MessageDetailController::class, 'htmlPreview'])
    ->whereNumber('id');
