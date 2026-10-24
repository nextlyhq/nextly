---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

The dashboard's setup checklist and its sample-content offer are now one Get started card, first and full width, drawn while a step this reader could take is waiting.

- **One card.** It offers, in order, Create a collection, Add your first entry, Fill in each Single (the first five, then a control for the rest) and Invite a teammate, each only to someone who could finish it, with "x of y done". Single and invite steps can be skipped and restored. The sample-content offer is made inside the first-entry step.
- **Its steps travel in the layout read.** `GET /api/dashboard/layout` answers `getStarted: { drawn, answer }`, from the same computation that decides whether the card is drawn. `?getStarted=1` also answers them for a removed card, as the admin asks while restoring one.
- **Per person, on the server.** Skips and whether the reader acted on the card are kept in the card's settings. A dismissed card is listed under Removed and comes back with its progress and skips. Once every step is done or skipped, the card says "You're all set" to a reader who acted on it, and leaves anyone else's dashboard quietly.
- **Not known is its own answer.** When setup cannot be checked, the card says so and offers Retry, and never shows a step as waiting on that basis. A step whose own check failed or ran out of time is no longer offered as "not known": nobody knows whether the reader could finish it, so the whole answer is not known instead. The step work also stops at the deadline rather than running on.
- **Saved dashboards convert.** A saved "Set up your project" card and sample-content card become one Get started card, with the first one's id and place, removed if either was. The retirement map gains a `removed: "any"` rule for this; every other retirement keeps "removed only if all were".
- **Deprecated, kept for one release:** `GET /api/dashboard/onboarding`, `ONBOARDING_STEPS` (unchanged) and the admin's `OnboardingChecklist` export, which the dashboard no longer draws.
- **New, `@experimental`, from `nextly/config`:** `GET_STARTED_WIDGET_ID`, `GET_STARTED_STEP_KINDS`, `GET_STARTED_SKIPPABLE_KINDS` and the `GetStartedAnswer`, `GetStartedStep`, `GetStartedStepKind` and `GetStartedStepStatus` types.
- **A known limit:** on MySQL and SQLite, a Single first saved in the same second it was created is known to be filled in only from the activity trail, so once retention prunes that row (90 days by default) its step reads as waiting again. It never reads as done when it was not.
