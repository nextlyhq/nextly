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

Fix role inheritance granting the wrong permissions, show every permission the matrix can grant, and ship Admin, Editor, Author and Viewer roles.

**Role inheritance resolved in both directions, so a base role collected the permissions of every role built on top of it.** A role holds the permissions of the roles it inherits from, and those are recorded as its children — but the check walked parents too, which made the edge symmetric. Give someone Viewer, and if any role named Viewer as its base, that role's permissions came with it. This is the live check: `hasPermission` resolves through it, and collection, single and middleware access all fall through to `hasPermission`, so every one of them read the same wrong answer. **If you use role inheritance, re-check what your roles actually grant after upgrading** — permissions that leaked in this way will stop being granted, which is the point, and anyone relying on the leak will lose access they should never have had. `role_inherits` is empty on most installs, in which case nothing changes.

**The permissions matrix showed four columns and your database has seven actions.** `publish` and `export` had nowhere to go, so they were dropped — while "Select All" granted them anyway, off the raw list. The editor granted permissions it could not draw, and the only way to revoke one was Clear All and start again. Columns are now derived from the actions that exist: `publish` appears on the content types that have it, `manage` is its own column instead of being filed under one labelled "Update" (ticking Update on Settings granted `manage-settings`), `delete-api-keys` is no longer hidden by an unexplained special case, and `submissions` has left Collection Types — it is a plugin's resource, not a collection, and it now sits under a **Plugins** tab with an Export column instead of rendering as a row of four dashes.

**Nextly seeded one role. It now seeds four**: Admin (everything except granting access to others), Editor (content and media, including publish), Author (the same reach without delete or publish), and Viewer (read only). They are predicates rather than fixed lists, re-resolved every boot, so adding a collection does not leave them quietly not covering it. They are system roles and are never assigned to anyone — build your own role on top of one rather than editing it.

**A role now starts from another role.** "Start from" offers the seeded roles, and the page says what the answer means in a sentence: "This role can do everything Author can, plus 2 permissions ticked below." One base role, not several.

The role form's **Status field is gone**. It had no column on the roles table, so nothing it collected was ever stored; reads were hardcoded to "Active" and every role's created date rendered as today. Worse, choosing Inactive or Deprecated silently converted the role into a system role, permanently locking its name and slug. The roles list loses its Status and Created columns with it — the API returns neither, and both were invented in the client.

**Three fixes for permissions that were unreachable or wrong.** `manage-api-keys` carried the action `update`, so nothing could reach it by the name every caller derives — the nav item, two registry entries and the sidebar's settings check all asked for `update-api-keys`, which did not exist, and only super admins (who bypass the check) could not notice. It is now named after its action, and existing databases are corrected on boot without losing grants. `nextly permissions:cleanup` deleted plugin-declared permissions and their grants — it judged a permission orphaned when its resource was not a collection, which a plugin's resource never is — and now consults provenance instead. And permissions whose package stopped declaring them are marked rather than left claiming an owner that no longer wants them; they drop off the menu, keep their grants, and are retired only by an explicit cleanup.

**Plugins can now say what their permissions are.** `PluginPermission.group` was documented, set by the canonical example, and read by nothing; it now files a permission under a heading within its own plugin's section. New `danger` marks a permission that hands out access or takes data off the site, and the admin warns before granting it.

**Creating a user who could never sign in now fails instead of succeeding.** Ticking "Require email verification" on a site with no email provider created the account, failed to send the mail, swallowed the failure, and answered "User created." — leaving someone who saw "invalid credentials" every time they tried, because unverified users cannot sign in. The check now runs before the account exists.

Also fixed: rejecting a role for a real reason said "An unexpected error occurred" instead of the reason, and a duplicated rule in the request handler made a role built purely from base roles impossible to create; checkbox outlines failed contrast in both light and dark modes (1.35:1 and 1.14:1 against a 3:1 requirement) because callers overrode the control's own styling with the divider colour; checkbox hit targets were 16px against a 24px minimum; and form help text was hidden behind an info-icon tooltip instead of sitting under the field it describes.
