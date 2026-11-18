<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Symfony\Component\Mime\Email;

class OutboundDraftMail extends Mailable
{
    public function __construct(
        public string $htmlBody,
        public string $textBody,
        public array $draftAttachments,
        public string $internetId,
        public ?string $replyId
    ) {}

    public function build(): static
    {
        $this->html($this->htmlBody !== '' ? $this->htmlBody : nl2br(htmlspecialchars($this->textBody, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')));
        return $this->withSymfonyMessage(function (Email $email): void {
            $email->text($this->textBody);
            $headers = $email->getHeaders();
            $headers->addIdHeader('Message-ID', trim($this->internetId, '<>'));
            if ($this->replyId) $headers->addIdHeader('In-Reply-To', trim($this->replyId, '<>'));
            foreach ($this->draftAttachments as $file) {
                $bytes = base64_decode((string) $file->encoded_content, true);
                if ($bytes === false) throw new \RuntimeException('Unable to load an outgoing attachment.');
                $email->attach($bytes, $file->filename, $file->content_type ?: 'application/octet-stream');
            }
        });
    }
}
