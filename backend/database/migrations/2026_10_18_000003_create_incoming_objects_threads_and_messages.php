<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Ingestion object identity is sha256(bucket + NUL + object key).
        // Store raw MIME in private Cloudflare R2, never only on the VM.
        Schema::create('incoming_objects', function (Blueprint $table): void {
            $table->id();
            $table->char('object_identity_sha256', 64)->unique();
            $table->string('r2_bucket', 255);
            $table->text('r2_object_key');
            $table->char('raw_sha256', 64)->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->string('processing_status', 32)->default('pending');
            $table->unsignedInteger('attempt_count')->default(0);
            $table->text('last_error')->nullable();
            $table->timestampTz('received_at')->nullable();
            $table->timestampTz('processed_at')->nullable();
            $table->timestampsTz();
        });

        Schema::create('mail_threads', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mailbox_id')->constrained('mailboxes')->restrictOnDelete();
            $table->string('subject', 998)->nullable();
            $table->string('root_message_id', 998)->nullable();
            $table->timestampTz('last_message_at')->nullable();
            $table->timestampsTz();
            $table->index(['mailbox_id', 'last_message_at']);
        });

        Schema::create('mail_messages', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mailbox_id')->constrained('mailboxes')->restrictOnDelete();
            $table->foreignId('mail_thread_id')->nullable()->constrained('mail_threads')->nullOnDelete();
            $table->foreignId('incoming_object_id')->nullable()->constrained('incoming_objects')->restrictOnDelete();
            $table->string('direction', 16); // incoming, outgoing, draft
            $table->string('folder', 32)->default('inbox');
            $table->string('internet_message_id', 998)->nullable();
            $table->text('in_reply_to')->nullable();
            $table->text('references_header')->nullable();
            $table->string('from_address', 320)->nullable();
            $table->string('from_name', 255)->nullable();
            $table->string('subject', 998)->nullable();
            $table->text('preview_text')->nullable();
            $table->longText('draft_body_text')->nullable();
            $table->longText('draft_body_html')->nullable();
            $table->string('delivery_status', 40)->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('received_at')->nullable();
            $table->boolean('is_read')->default(false);
            $table->boolean('is_starred')->default(false);
            $table->boolean('is_spam')->default(false);
            $table->jsonb('headers_metadata')->nullable();
            $table->softDeletesTz();
            $table->timestampsTz();
            $table->unique(['mailbox_id', 'incoming_object_id']);
            $table->index(['mailbox_id', 'folder', 'received_at']);
            $table->index(['mailbox_id', 'folder', 'sent_at']);
            $table->index(['mail_thread_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_messages');
        Schema::dropIfExists('mail_threads');
        Schema::dropIfExists('incoming_objects');
    }
};
