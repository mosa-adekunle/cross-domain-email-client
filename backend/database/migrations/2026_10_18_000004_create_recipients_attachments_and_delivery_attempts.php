<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_recipients', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mail_message_id')->constrained('mail_messages')->cascadeOnDelete();
            $table->string('type', 8); // to, cc, bcc
            $table->string('address', 320);
            $table->string('display_name', 255)->nullable();
            $table->timestampsTz();
            $table->index(['mail_message_id', 'type']);
        });

        Schema::create('mail_attachments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mail_message_id')->constrained('mail_messages')->restrictOnDelete();
            $table->string('filename', 255)->nullable();
            $table->string('content_type', 255)->nullable();
            $table->string('content_id', 255)->nullable();
            $table->boolean('is_inline')->default(false);
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->char('sha256', 64)->nullable();
            $table->text('r2_object_key')->nullable();
            $table->timestampsTz();
        });

        Schema::create('mail_delivery_attempts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mail_message_id')->constrained('mail_messages')->restrictOnDelete();
            $table->string('provider', 80);
            $table->string('provider_message_id', 255)->nullable();
            $table->string('status', 40);
            $table->unsignedSmallInteger('response_code')->nullable();
            $table->text('error_summary')->nullable();
            $table->timestampTz('attempted_at');
            $table->timestampsTz();
            $table->index(['mail_message_id', 'attempted_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_delivery_attempts');
        Schema::dropIfExists('mail_attachments');
        Schema::dropIfExists('mail_recipients');
    }
};
