<?php

require dirname(__DIR__).'/vendor/autoload.php';

use App\Support\SpamClassifier;

function assertSpam(bool $condition, string $message): void {
    if (! $condition) throw new RuntimeException('Spam classifier: '.$message);
}
[$score, $reasons] = SpamClassifier::contentIndicators('RE: FROM WILSON',
    'A political party member in a parliamentary election. We received US$25 million in contract kickback money. '.
    'Please move the funds overseas and retain 20% of it. We have an investment proposal.');
assertSpam($score >= 60, 'advance-fee scam reaches quarantine threshold');
assertSpam(count($reasons) >= 3, 'multiple independent risk signals');
[$score, $reasons] = SpamClassifier::contentIndicators('Meeting confirmation',
    'Thank you for your email. We will talk about the project next Tuesday at 10.');
assertSpam($score === 0 && $reasons === [], 'ordinary correspondence is not marked');
[$score] = SpamClassifier::contentIndicators('Project proposal',
    'Please review this business proposal for application development.');
assertSpam($score < 60, 'a normal proposal alone must not be quarantined');
echo "Spam content heuristics passed.\n";
