---
"@revnixhq/create-nextly-app": patch
---

Blank template now ships a Nextly-branded landing page at `/` instead of the inherited Next.js placeholder. Conditionally labels the admin button "Set up admin →" or "Open admin →" based on whether a super-admin exists. Loads Bricolage Grotesque + JetBrains Mono via `next/font/google` (no extra deps).
