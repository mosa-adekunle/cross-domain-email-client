<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController
{
    public function csrf(Request $request): JsonResponse
    {
        return response()->json(['csrf_token' => $request->session()->token()])
            ->header('Cache-Control', 'no-store');
    }

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email', 'max:320'],
            'password' => ['required', 'string'],
        ]);

        $email = Str::lower(trim($credentials['email']));
        $key = 'admin-login:'.hash('sha256', $email.'|'.$request->ip());

        if (RateLimiter::tooManyAttempts($key, 5)) {
            return response()->json(['message' => 'Too many login attempts. Please try again later.'], 429)
                ->header('Retry-After', (string) RateLimiter::availableIn($key))
                ->header('Cache-Control', 'no-store');
        }

        if (! Auth::guard('web')->attempt([
            'email' => $email,
            'password' => $credentials['password'],
            'is_admin' => true,
            'is_active' => true,
        ])) {
            RateLimiter::hit($key, 300);

            throw ValidationException::withMessages([
                'email' => ['The email or password is incorrect.'],
            ]);
        }

        RateLimiter::clear($key);
        $request->session()->regenerate();

        return response()->json(['user' => $this->safeUser($request)])
            ->header('Cache-Control', 'no-store');
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->safeUser($request)])
            ->header('Cache-Control', 'no-store');
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Signed out.'])
            ->header('Cache-Control', 'no-store');
    }

    private function safeUser(Request $request): array
    {
        $user = $request->user('web');

        return ['id' => $user->id, 'name' => $user->name, 'email' => $user->email];
    }
}
