---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Form notifications are rebuilt: one honest name, new powers, and a send path that respects every setting.

**It's called Notifications everywhere now.** The tab, the cards, the buttons, and the collection field all say "Notifications" — the "Email Integrations" naming inside the tab is gone.

**Reply-To from the visitor.** A rule can set its Reply-To to one of the form's email fields, so hitting Reply in your inbox answers the person who submitted the form. A custom fixed address works too.

**Send conditions.** A rule can carry one condition evaluated against the submitted data ("only send the sales alert when budget equals enterprise"). Unmet conditions skip the rule quietly for that submission.

**The send path honors what you configure.** The per-rule sender email — previously collected and silently ignored — is now used, falling back to the plugin's `notifications.defaultFrom` option and then the template/provider default. New forms are seeded with one "Admin notification" rule that consumes `notifications.defaultToEmail`, and the `notifications.enabled` option now really turns form emails off. `sendWithTemplate` accepts per-send `from`/`replyTo` overrides.

**A proper editor.** Rules are cards (with an enable switch, recipient summary, and a "Conditional" badge) edited in an accessible side sheet — replacing a hand-rolled modal that had no dialog semantics, no focus trap, and no Escape handling. Duplicating a rule starts the copy disabled so it never doubles live email. Deleting a form field that a rule's recipient, reply-to, or condition references is blocked with the reason.

**Fixes**: submission data stored as text (e.g. on SQLite) no longer breaks `{{field}}` recipient resolution in notifications, and email layouts no longer appear as selectable notification templates.
