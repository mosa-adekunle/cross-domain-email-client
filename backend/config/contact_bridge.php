<?php
return [
    // Separate shared secret deployed only on the two server-side applications.
    // Must be at least 32 random bytes; empty means fail-closed.
    'secret' => env('WEBSITE_CONTACT_BRIDGE_SECRET', ''),
];
