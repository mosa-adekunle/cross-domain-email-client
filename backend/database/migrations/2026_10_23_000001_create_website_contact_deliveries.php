<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('website_contact_deliveries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('mail_message_id')->nullable()->unique()->constrained('mail_messages')->restrictOnDelete();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('website_contact_deliveries');
    }
};
