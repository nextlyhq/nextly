---
"@revnixhq/admin": patch
---

Dashboard UX cleanup:

- New `GetStartedEmptyState` replaces the previous "No Collections" pill with a multi-CTA card covering the four primary entry points (collection, single, component, user). Brutalist styling matches the OnboardingChecklist + SeedDemoContentCard.
- `WelcomeHeader` copy changed from a returner-only line to a neutral "Manage your content, schemas, and team from one place." Works for both first-time and returning users.
- Mutual exclusivity with the seed card: `WelcomeHeader` and `GetStartedEmptyState` both hide while `SeedDemoContentCard` is the active CTA on /admin. First-visit users see only the seed prompt; once dismissed/completed, the welcome strip and the get-started card surface.
