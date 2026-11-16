<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('mail_aliases', function (Blueprint $table): void {
            $table->id();
            $table->string('address', 320)->unique();
            $table->foreignId('mailbox_id')->constrained('mailboxes')->restrictOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });

        Schema::create('mail_sender_rules', function (Blueprint $table): void {
            $table->id();
            $table->string('type', 12); // address, domain
            $table->string('value', 320);
            $table->string('action', 12); // allow, block
            $table->timestampsTz();
            $table->unique(['type', 'value']);
        });

        Schema::create('mail_sender_feedback', function (Blueprint $table): void {
            $table->id();
            $table->string('address', 320)->unique();
            $table->unsignedInteger('spam_count')->default(0);
            $table->unsignedInteger('ham_count')->default(0);
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_sender_feedback');
        Schema::dropIfExists('mail_sender_rules');
        Schema::dropIfExists('mail_aliases');
    }
};
