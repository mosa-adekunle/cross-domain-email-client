<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_domains', function (Blueprint $table): void {
            $table->id();
            $table->string('domain_name', 253)->unique(); // Lowercase ASCII / IDNA.
            $table->string('verification_status', 32)->default('pending');
            $table->string('cloudflare_zone_id')->nullable();
            $table->timestampTz('verified_at')->nullable();
            $table->boolean('is_active')->default(false);
            $table->jsonb('settings')->nullable();
            $table->timestampsTz();
        });

        Schema::create('mailboxes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mail_domain_id')->constrained('mail_domains')->restrictOnDelete();
            $table->string('local_part', 64); // Canonicalized; preserve original in metadata if needed.
            $table->string('address', 320)->unique(); // Lowercase normalized address.
            $table->string('display_name', 150)->nullable();
            $table->boolean('is_active')->default(true);
            $table->jsonb('settings')->nullable();
            $table->timestampsTz();
            $table->unique(['mail_domain_id', 'local_part']);
        });

        Schema::create('sending_identities', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mailbox_id')->constrained('mailboxes')->restrictOnDelete();
            $table->string('address', 320);
            $table->string('display_name', 150)->nullable();
            $table->string('provider_key', 60)->nullable(); // Provider name, never API secrets.
            $table->timestampTz('verified_at')->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(false);
            $table->timestampsTz();
            $table->unique(['mailbox_id', 'address']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sending_identities');
        Schema::dropIfExists('mailboxes');
        Schema::dropIfExists('mail_domains');
    }
};
