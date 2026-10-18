<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class ResetAdminPassword extends Command
{
    protected $signature = 'admin:reset-password {email}';
    protected $description = 'Reset the sole administrator password from the server console';

    public function handle(): int
    {
        $email = Str::lower(trim((string) $this->argument('email')));
        $user = User::query()->where('email', $email)->where('is_admin', true)->first();
        if (! $user) {
            $this->error('Administrator not found.');
            return self::FAILURE;
        }

        $password = $this->secret('New password (minimum 14 characters)');
        $confirm = $this->secret('Confirm new password');
        if (! is_string($password) || strlen($password) < 14 || $password !== $confirm) {
            $this->error('Passwords must match and have at least 14 characters.');
            return self::FAILURE;
        }

        $user->password = Hash::make($password);
        $user->save();

        // Invalidate authenticated sessions after changing credentials.
        \Illuminate\Support\Facades\DB::table('sessions')->where('user_id', $user->id)->delete();
        $this->info('Administrator password changed and active sessions removed.');
        return self::SUCCESS;
    }
}
