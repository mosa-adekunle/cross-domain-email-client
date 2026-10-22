<?php

// Domain-wide delivery is intentionally limited to these five user-owned zones.
// Unexpected local parts are stored in catchall@<domain> without replacing
// the original incoming envelope recipient in message records.
return [
    'receiptboss.ca',
    'santasbag.ca',
    'madenorth.dev',
    'madekunle.com',
    'delishearsentertainment.com',
];
