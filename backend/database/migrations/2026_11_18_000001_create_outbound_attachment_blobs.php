<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Persist draft binaries in PostgreSQL so Docker recreations cannot lose them.
        Schema::create('outbound_attachment_blobs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mail_message_id')->constrained('mail_messages')->cascadeOnDelete();
            $table->string('filename', 180);
            $table->string('content_type', 120);
            $table->unsignedInteger('size_bytes');
            $table->binary('content');
            $table->timestampsTz();
            $table->index('mail_message_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('outbound_attachment_blobs');
    }
};
