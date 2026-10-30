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

The dashboard's setup card is now "Set up your project" (`core/setup`): one compact row of step tiles at full width, offered to super-admins only, that collapses, dismisses and goes away once setup is done.

- **The steps**, decided on the server from the site's data, each offered only to a reader who could finish it: start with sample content (where the project's sample-content route lets the reader load it, while nobody has answered and the site holds no entry), create a collection, add a first entry (which opens a new entry of the first collection the reader may create in), fill in your Singles (one step for all of them, "N of M filled in", opening a short list of the Singles) and invite a teammate. Skip is offered on the Singles and Invite steps only, and a skipped step counts as done.
- **Not known is not open.** When a registry cannot be listed, or a check fails or runs out of time, the card says it could not check setup and offers Retry, and shows no step as open.
- **Per reader, on the server.** Collapsing, dismissing and skipping are kept in the dashboard preferences (`nextly_dashboard_preferences`), so they follow the reader across devices, and never in the layout, so a reader following the default dashboard keeps following it. `GET` and `PUT /api/dashboard/setup` read and change them for the signed-in super-admin (internal to the admin). Until `nextly migrate` creates the preferences table the card is drawn expanded and its changes are not kept.
- **Collapsed is one line.** A collapsed setup card is one grid row tall: "Set up your project · N of M done", with Expand and Dismiss. The card frame gains this for any body that collapses itself (`useCardCollapsed`, internal to the admin): the cell spans one row, and the frame keeps the card's title for assistive technology only, with no gap or footer, at rest and never in customise mode. Expanded, the card fits its 12 × 2 size: "N of M done" in the header beside the title (a card body may now report a short phrase there, as well as a count), a thin progress bar and one row of compact tiles. It grows in place only while the reader has the Singles' list open, or where its tiles wrap below 640 px.
- **Resume setup.** While a dismissed card has not yet said "You're all set", the dashboard header ends its summary line with "Resume setup", for super-admins; pressing it brings the card back.
- **Declining sample content** draws its tile done at once, and the card asks for its steps again once the decline is recorded.
- **"You're all set" once.** When every step is done or skipped, the card says so once; from the next load it is gone, with no way to resume it.

Removed, with no alias or conversion (the old card's shapes are used by no site):

- the `core/get-started` widget, its `core#GetStartedCard` component and the layout read's `getStarted` field and `?getStarted=1` read. A saved layout that still names `core/get-started` no longer draws it.
- `GET /api/dashboard/onboarding`.
- From `nextly` and `nextly/config`: `GET_STARTED_WIDGET_ID`, `GET_STARTED_STEP_KINDS`, `GET_STARTED_SKIPPABLE_KINDS`, `GetStartedAnswer`, `GetStartedStep`, `GetStartedStepKind`, `GetStartedStepStatus`, `ONBOARDING_STEPS`, `isOnboardingStepId`, `OnboardingStepId` and `OnboardingStep`. In their place `nextly/config` exports the setup vocabulary (`SETUP_STEP_KINDS`, `SETUP_SKIPPABLE_KINDS`, `SetupStep`, `SetupAnswer`, `SetupCardData` and their helpers), `@experimental`.
- From `@nextlyhq/admin`: `OnboardingChecklist` and `OnboardingChecklistSkeleton`.
