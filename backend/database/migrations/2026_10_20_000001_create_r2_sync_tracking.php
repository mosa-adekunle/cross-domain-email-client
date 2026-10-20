<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A durable high-water mark for timestamp-ordered incoming/v2 objects.
        Schema::create('r2_sync_checkpoints', function (Blueprint $table): void {
            $table->string('name', 80)->primary();
            $table->text('last_object_key')->nullable();
            $table->timestampTz('last_poll_at')->nullable();
            $table->timestampTz('last_reconcile_at')->nullable();
            $table->timestampsTz();
        });

        // Failed downloads/parses retain an R2 key even after advancing the cursor.
        Schema::create('r2_import_retries', function (Blueprint $table): void {
            $table->char('object_identity_sha256', 64)->primary();
            $table->string('r2_bucket', 255);
            $table->text('r2_object_key');
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->unsignedInteger('attempt_count')->default(0);
            $table->string('last_error_type', 200)->nullable();
            $table->timestampTz('next_attempt_at');
            $table->timestampsTz();
            $table->index('next_attempt_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('r2_import_retries');
        Schema::dropIfExists('r2_sync_checkpoints');
    }
};
