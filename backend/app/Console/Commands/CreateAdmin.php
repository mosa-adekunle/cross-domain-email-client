<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class CreateAdmin extends Command
{
    protected $signature = 'admin:create {email}';
    protected $description = 'Create the first administrator interactively (one account only)';

    public function handle(): int
    {
        if (User::query()->exists()) {
            $this->error('An administrator already exists. No user was changed.');
            return self::FAILURE;
        }

        $email = Str::lower(trim((string) $this->argument('email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 320) {
            $this->error('Supply a valid email address.');
            return self::FAILURE;
        }

        $name = trim((string) $this->ask('Administrator display name', 'Administrator'));
        if ($name === '' || mb_strlen($name) > 150) {
            $this->error('A display name of at most 150 characters is required.');
            return self::FAILURE;
        }

        $password = $this->secret('Password (minimum 14 characters)');
        $confirm = $this->secret('Confirm password');
        if (! is_string($password) || strlen($password) < 14 || $password !== $confirm) {
            $this->error('Passwords must match and have at least 14 characters.');
            return self::FAILURE;
        }

        User::query()->create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'is_admin' => true,
            'is_active' => true,
        ]);

        $this->info('Administrator created. Credentials were not written to logs.');
        return self::SUCCESS;
    }
}
