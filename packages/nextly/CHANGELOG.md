# nextly

## 0.0.2-alpha.35

### Patch Changes

- [#203](https://github.com/nextlyhq/nextly/pull/203) [`cfd0d83`](https://github.com/nextlyhq/nextly/commit/cfd0d83bafd79efeee715f0c4e396bafc6d43acf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - First-party plugin admin UIs now render exactly as designed.

  The admin stylesheet build now scans the form-builder and page-builder admin sources, so utility classes used only by a plugin are no longer silently dropped from the compiled CSS. Most visibly: the form preview's desktop/mobile toggle now genuinely resizes the simulated pane (mobile was rendering full-width), and over a dozen other spacing, sizing, and border details across the builder, notifications, and submissions screens now apply as intended.

- [#162](https://github.com/nextlyhq/nextly/pull/162) [`2b3b072`](https://github.com/nextlyhq/nextly/commit/2b3b0729ee4e5aa2501356bc1bf0640f5cd8697b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the schema builder out of production, isolate the admin design system from the host site, and fix admin surface consistency.

  **The schema builder is now off in production, and its endpoints enforce it.** `admin.branding.showBuilder` already hid the builder's navigation, but the schema endpoints behind it stayed open — a deployed site would still accept requests to create, alter, or drop collections, singles, and components over HTTP, straight against the live database with no migration to review and no rollback. Those endpoints now refuse with `403 BUILDER_DISABLED` wherever the builder is disabled, the builder's pages send you back to the dashboard instead of loading, and the schema-changes bell is hidden. The builder is disabled in production by default; set `admin.branding.showBuilder: true` to opt back in.

  Reading schemas, entry CRUD, and code-first schema sync are all unaffected — a deployed site still lists its collections and manages its content exactly as before. **If you script schema changes against a production deployment over HTTP, that now returns 403** and is the one thing to check before upgrading.

  The admin's design tokens are now namespaced (`--primary` is now `--nx-primary`, `--background` is now `--nx-background`, and so on) and the admin's scoping wrapper is now `.nextly-admin` (was `.adminapp`). Utility classes are unchanged: `bg-primary`, `text-muted-foreground` and friends keep working exactly as before. This means a site's own `--primary`/`--background` tokens can no longer collide with the admin's, and the admin can no longer restyle the site around it.

  Also fixed: the admin's CSS reset (`html`/`:host` font and line-height, file-input and form-element rules) leaked onto the host page instead of staying inside the admin; `dark:` utility variants were silently corrupted during CSS scoping and now work; a stray selector gave focused inputs the browser-autofill treatment; and the dark-mode sidebar now shares one flat surface with the content instead of appearing as a lighter panel.

  If you wrote custom CSS targeting admin internals, reference the `--nx-*` token names and the `.nextly-admin` wrapper.

  Removed the unused `ResponsiveTable` (and its `Column` type), `BulkSelectCheckbox`, and `RoleAssignDialog` exports. Every admin list already renders through the unified `DataTable`, and none of these were used; if you were importing `ResponsiveTable`, use `DataTable`/`DataTableView` instead.

  There is now one pagination component. The admin had grown three — the shared `Pagination`, an entries-only copy, and a `TablePagination` in `@nextlyhq/ui` that no table used — which is why pagination sat flush against the table on some pages and floated with a stray border on others. The surviving `Pagination` gained the better parts of the others (a `<nav>` landmark, arrow/Home/End keys, a configurable item noun) and its buttons now use the interactive border tier instead of the faint divider tier. `TablePagination` is removed from `@nextlyhq/ui`; use `DataTable`, or `Pagination` from `@nextlyhq/admin`.

  Menu items in dropdowns now show a pointer cursor and a readable hover, and the highlight follows keyboard navigation as well as the mouse.

  Table column choices now survive a refresh, and "Reset to default" restores the collection's real default columns. Both were the same fault: the admin saved a placeholder set of columns over your stored choice before the collection had finished loading.

  Profile changes now show in the header straight away instead of after a reload, and save buttons are text-only — dropping the floppy icon also fixed their spacing on the settings pages.

- [#182](https://github.com/nextlyhq/nextly/pull/182) [`b4e6294`](https://github.com/nextlyhq/nextly/commit/b4e6294d9c8c37dbb646c26b8e3fe701860ae00c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Plugins page now tells you what each plugin actually does to your app, and every plugin has a real page of its own.

  **The plugins list reports honest state.** The "coming soon" banner is gone, and so are the selection checkboxes and the bulk-delete button that only ever said "not available". In their place: an Enabled/Disabled status on every row, an author and description under each name, a category badge, and status filter chips (All / Enabled / Disabled). Plugins are installed and updated with your package manager and wired in your config, so the page reports state instead of pretending to mutate it — there are no fake install, update, or uninstall buttons.

  **Every plugin has a detail page.** Clicking a row opens `/admin/plugins/{plugin}` with the plugin's identity (version, author, license, category, links to its homepage and repository) and a **"What this plugin adds"** section computed from the plugin's real registrations — the collections, navigation items, admin pages, dashboard widgets, field types, permissions, and API routes it actually contributes. A disabled plugin says plainly that its data is retained but its behavior does not load.

  **Plugin settings get a whole page instead of a box.** A plugin that ships a settings UI is linked from its detail page ("Open settings") and renders full-page at `/admin/plugins/{plugin}/settings`. A disabled plugin's settings UI does not load, because a form that pretends to configure inactive behavior would be lying.

  **Plugin authors can now declare identity metadata.** `definePlugin` accepts `author`, `homepage`, `repository`, `docsUrl`, `license`, `category` (a controlled vocabulary the list filters by), and `tags` — mirror your package.json values and the admin does the rest. Both first-party plugins declare theirs.

  Also: the sidebar's "Installed Plugins" item now goes to the plugins overview instead of whichever plugin happened to be first.

- [#164](https://github.com/nextlyhq/nextly/pull/164) [`1ed808c`](https://github.com/nextlyhq/nextly/commit/1ed808c6a8b9c2eeffe7ae3a2c675f7d911cbb88) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix dates reading back empty on SQLite, correct the total reported beside a list, highlight code everywhere it appears, and rebuild the API Playground around the request you are actually sending.

  **Dates on collection entries read back `null` on SQLite, and now don't.** `createdAt`, `updatedAt` and every date field you defined came back empty from the API and rendered as `–` in the admin's Created and Updated columns. Entries are saved inside a transaction, and on that path a date was written as text into a column the reader treats as a number, so nothing failed on save and everything failed on read. Sorting or filtering by a date silently did the wrong thing rather than nothing, because the two encodings do not compare. **Postgres and MySQL were never affected, and neither were Singles or media.** Existing databases are repaired once, automatically, on the next start — you do not need to run anything, and the entries whose dates came back empty will have their real dates again. If you have been working around this by not trusting `createdAt` on SQLite, you can stop.

  **The total beside a list disagreed with the list.** A collection of 5 entries reported `total: 4` when one was a draft, and asking for drafts returned rows with a total of `0`. The count was answering as an anonymous reader while the rows were fetched as you, so it left out everything you could see and a public visitor could not. `totalPages` is derived from that total, so anything paging on it could not reach the last page of its own results — a table could hide entries that were plainly there. Counts now match the rows beside them.

  **Code is highlighted wherever it appears, in both themes.** Code blocks in the rich-text editor were never highlighted at all, the email template editor's dark mode had never worked, and both code editors stayed light when the admin was dark on a dark OS. The frontend rendered code with no highlighting and a colour baked into the markup that your stylesheet could not override. Highlighting now comes from the design tokens, so it follows the active theme, and the HTML sent to your site describes what each token _is_ and leaves the colour to your CSS. The same applies to highlighted (marked) text: it no longer carries a fixed yellow that a dark page could neither restyle nor read.

  **The API Playground now builds a request instead of asking you to remember one.** The method, URL, and Send sit on one pinned line (`⌘↵` to send, `Esc` to cancel), so a long list of parameters no longer pushes them off-screen. Sort is a field picker with a direction toggle rather than free text you had to prefix with `-`; the fields you can return are checkboxes rather than hand-written JSON; depth, limit and page are number inputs carrying the bounds the server enforces. A Code tab shows the same request as cURL, `fetch`, or Nextly SDK — the SDK one runs on a server with no HTTP round trip. The response pane reports size and headers alongside status and latency, and the body downloads exactly as it arrived. Every parameter's explanation now sits under the field it explains instead of behind a hover, where a keyboard or screen reader could not reach it at all.

  **Tooltips appear where you point.** Any tooltip inside the admin's main content could land hundreds of pixels away — under the sidebar — because the positioner and the browser disagreed about what a CSS container is. This affected the collapsed sidebar, the rich-text toolbar, table row actions, and every field help icon.

  **Status colours are now one vocabulary.** Success, warning and destructive each derive their whole range from a single token, so retheming one moves every shade with it and they cannot drift apart. Two different greens meant "success" and two different reds meant "destructive" before this. Along the way a document icon was rendered in the red used for destructive actions, "Advanced Fields" was marked with the same red, and category dots were coloured by hashing the category name — a colour that meant nothing and changed if you renamed it. Those are now neutral, and the design guard rejects raw palette classes so they cannot come back.

  Also: the email template editor gained line numbers and code folding, the request body field is a JSON editor rather than a plain textarea, and `nextly` no longer ships seven editor packages it never loaded.

- [#165](https://github.com/nextlyhq/nextly/pull/165) [`a704e1a`](https://github.com/nextlyhq/nextly/commit/a704e1a4b824d5b6cfb06ff1519f0f24921a8c0f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix role inheritance granting the wrong permissions, show every permission the matrix can grant, and ship Admin, Editor, Author and Viewer roles.

  **Role inheritance resolved in both directions, so a base role collected the permissions of every role built on top of it.** A role holds the permissions of the roles it inherits from, and those are recorded as its children — but the check walked parents too, which made the edge symmetric. Give someone Viewer, and if any role named Viewer as its base, that role's permissions came with it. This is the live check: `hasPermission` resolves through it, and collection, single and middleware access all fall through to `hasPermission`, so every one of them read the same wrong answer. **If you use role inheritance, re-check what your roles actually grant after upgrading** — permissions that leaked in this way will stop being granted, which is the point, and anyone relying on the leak will lose access they should never have had. `role_inherits` is empty on most installs, in which case nothing changes.

  **The permissions matrix showed four columns and your database has seven actions.** `publish` and `export` had nowhere to go, so they were dropped — while "Select All" granted them anyway, off the raw list. The editor granted permissions it could not draw, and the only way to revoke one was Clear All and start again. Columns are now derived from the actions that exist: `publish` appears on the content types that have it, `manage` is its own column instead of being filed under one labelled "Update" (ticking Update on Settings granted `manage-settings`), `delete-api-keys` is no longer hidden by an unexplained special case, and `submissions` has left Collection Types — it is a plugin's resource, not a collection, and it now sits under a **Plugins** tab with an Export column instead of rendering as a row of four dashes.

  **Nextly seeded one role. It now seeds four**: Admin (everything except granting access to others), Editor (content and media, including publish), Author (the same reach without delete or publish), and Viewer (read only). They are predicates rather than fixed lists, re-resolved every boot, so adding a collection does not leave them quietly not covering it. They are system roles and are never assigned to anyone — build your own role on top of one rather than editing it.

  **A role now starts from another role.** "Start from" offers the seeded roles, and the page says what the answer means in a sentence: "This role can do everything Author can, plus 2 permissions ticked below." One base role, not several.

  The role form's **Status field is gone**. It had no column on the roles table, so nothing it collected was ever stored; reads were hardcoded to "Active" and every role's created date rendered as today. Worse, choosing Inactive or Deprecated silently converted the role into a system role, permanently locking its name and slug. The roles list loses its Status and Created columns with it — the API returns neither, and both were invented in the client.

  **Three fixes for permissions that were unreachable or wrong.** `manage-api-keys` carried the action `update`, so nothing could reach it by the name every caller derives — the nav item, two registry entries and the sidebar's settings check all asked for `update-api-keys`, which did not exist, and only super admins (who bypass the check) could not notice. It is now named after its action, and existing databases are corrected on boot without losing grants. `nextly permissions:cleanup` deleted plugin-declared permissions and their grants — it judged a permission orphaned when its resource was not a collection, which a plugin's resource never is — and now consults provenance instead. And permissions whose package stopped declaring them are marked rather than left claiming an owner that no longer wants them; they drop off the menu, keep their grants, and are retired only by an explicit cleanup.

  **Plugins can now say what their permissions are.** `PluginPermission.group` was documented, set by the canonical example, and read by nothing; it now files a permission under a heading within its own plugin's section. New `danger` marks a permission that hands out access or takes data off the site, and the admin warns before granting it.

  **Creating a user who could never sign in now fails instead of succeeding.** Ticking "Require email verification" on a site with no email provider created the account, failed to send the mail, swallowed the failure, and answered "User created." — leaving someone who saw "invalid credentials" every time they tried, because unverified users cannot sign in. The check now runs before the account exists.

  Also fixed: rejecting a role for a real reason said "An unexpected error occurred" instead of the reason, and a duplicated rule in the request handler made a role built purely from base roles impossible to create; checkbox outlines failed contrast in both light and dark modes (1.35:1 and 1.14:1 against a 3:1 requirement) because callers overrode the control's own styling with the divider colour; checkbox hit targets were 16px against a 24px minimum; and form help text was hidden behind an info-icon tooltip instead of sitting under the field it describes.

- [#181](https://github.com/nextlyhq/nextly/pull/181) [`8cc095b`](https://github.com/nextlyhq/nextly/commit/8cc095b7554bd0b0c6d8dc583666a318e0438b16) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Aligned dependency versions across the workspace so every package shares one version of each shared dependency. The form-builder plugin now uses the same major versions of zod (4), @dnd-kit, and react-hook-form as the rest of Nextly, removing duplicate copies from an installed app, and a dependency it never used was dropped. No runtime behavior changes.

- [#185](https://github.com/nextlyhq/nextly/pull/185) [`5241bb2`](https://github.com/nextlyhq/nextly/commit/5241bb289c81f45e80169d56de5607a56f6f8577) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every field type is now described in one place, and the admin's pickers read from it.

  **New: `nextly/field-catalog`.** A browser-safe, pure-data module describing all 18 built-in field types — key, label, picker category, one-line hint, and icon name — plus `narrowFieldTypeCatalog()` for taking a surface's typed subset. The schema builder's field picker and the user-field type picker both render from it now, so the same field type can no longer be described differently on different screens (the user-field picker's labels and hints updated to the shared wording, e.g. "Textarea" is now "Long text" everywhere).

  **Removed: a drifted duplicate field model inside the admin.** An older, unused set of per-type field editors and their separate field-type definitions had fallen out of sync with the live schema builder and was reachable by nothing. It is deleted rather than left to mislead.

  `@nextlyhq/admin` now declares `nextly` as a peer dependency. Every real admin install already runs inside a Nextly app, so this formalizes what was always true rather than adding a new requirement.

- [#186](https://github.com/nextlyhq/nextly/pull/186) [`eb6751a`](https://github.com/nextlyhq/nextly/commit/eb6751a156b940108f6df1b109d58ac252e1abaa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugins can now build field-editing UI from the same components the admin uses.

  **New in `@nextlyhq/plugin-sdk/admin` (experimental): the field-UI kit.** Three controlled, form-library-agnostic components, following the same author surface as the shared DataTable:
  - **`FieldTypePicker`** — a grid of type cards rendered from `nextly/field-catalog`, narrowed to your surface's allowed types, with the same label, hint, and icon for a type everywhere it appears.
  - **`FieldOptionsEditor`** — the schema builder's options editor: label/value rows with drag reorder, values auto-generated from labels until edited, CSV/JSON import, and select/radio display knobs.
  - **`FieldDefaultValueInput`** — a type-aware default control: checkbox defaults are a true/false choice, select/radio defaults choose among the field's own options, number and date get typed inputs.

  **The options editor now reports every duplicate value at once.** Previously a batch of colliding option values surfaced one collision at a time — fix one, resubmit, discover the next. All duplicated values are now named together in a single warning.

- [#183](https://github.com/nextlyhq/nextly/pull/183) [`4aa9a61`](https://github.com/nextlyhq/nextly/commit/4aa9a61dce555b30da7d1b13608184d9fe4a8e86) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Force a first-sign-in password change when an admin sets a user's password.

  When an admin creates a user by typing a password for them (rather than sending a set-password link), that password is now temporary: the person must replace it the first time they sign in, and the admin-set password stops working once they do. This is the standard treatment for an admin-chosen credential (ASVS 6.4.1) — it keeps the temporary password from becoming the account's long-term one.

  How it works: signing in with such an account issues **no session**. Instead the login response asks for a new password, and the admin gets there through a "Set a new password" step shown right in the sign-in flow. Only after the new password is set is a real session issued — so the temporary password can never be used to do anything except set the replacement. A single-use, short-lived token carries the step; it authorizes nothing else.

  The forced change is cleared automatically whenever the person sets their own password — by completing this step, by changing their password later, or by using a reset link — so it never fires twice. Accounts created by self-registration, by the initial setup flow, or through an invite link are unaffected: those passwords are the person's own choice.

  Additive schema change: a nullable `must_change_password` column on `users`, applied cleanly by your next `nextly db:sync` (no default on existing rows, so nothing is rewritten).

- [#190](https://github.com/nextlyhq/nextly/pull/190) [`2fb740f`](https://github.com/nextlyhq/nextly/commit/2fb740fd609049f2dc90f6439a772e73367d5c1b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form-builder plugin no longer ships a second, unused field-builder UI.

  The package contained a complete parallel implementation of the field builder (a field-type registry, eight per-type editor components, an options editor, and the AddFieldButton/FormFieldList/SortableFieldRow/FieldEditorPanel components) that no screen ever rendered — the live builder uses its own components. These were still exported from the package, so they showed up in editor autocomplete and typed API surface as if they were supported. They are now removed.

  If you imported any of these directly from `@nextlyhq/plugin-form-builder/admin` (FormFieldList, SortableFieldRow, AddFieldButton, FieldEditorPanel, or the per-type field editors), those exports are gone; the supported builder components (FieldLibrary, FormCanvas, FieldEditor, FormPreview, ConditionalLogicEditor) are unchanged.

- [#192](https://github.com/nextlyhq/nextly/pull/192) [`3213d3f`](https://github.com/nextlyhq/nextly/commit/3213d3fcfebeb61c1e37987efab19725fb274275) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form builder's field editing is rebuilt as a card list on Nextly's shared field system.

  **One card per field, edited inline.** The three-pane layout (field palette, canvas, properties sidebar) is gone. Fields are collapsible cards: the header shows the type (from the shared field-type catalog, so icons and names match every other field picker in the admin), the label, the generated name, and a required badge; expanding a card edits its properties right there. "Add field" opens the same catalog-driven type picker used by the rest of the admin.

  **Reordering works three ways**: drag handles, Move up / Move down in each card's menu, and fully keyboard-driven (focus the handle, Space to lift, arrow keys to move, Space to drop).

  **Deleting a referenced field is blocked, with the reason.** A field used by another field's conditional logic or by a notification's recipient shows a disabled Delete listing what references it, instead of letting the deletion silently break those.

  **Select and radio options** now use the shared options editor: drag to reorder options, values auto-generate from labels, CSV/JSON import, and duplicate-value warnings — the old inline editor could only add and remove.

  Also: new fields get readable names (`email`, then `email_2`) instead of timestamp suffixes; the plugin's field enable/disable option now actually filters the type picker (served to the builder via a new permission-gated `/builder-config` plugin route); saving no longer writes a `title` key the forms collection never declared; and the removed `FieldLibrary`/`FormCanvas` exports are superseded by `FieldCards`/`AddFieldDialog`.

- [#197](https://github.com/nextlyhq/nextly/pull/197) [`9e60f5c`](https://github.com/nextlyhq/nextly/commit/9e60f5c070d0b82c25808afbf8e726e17ab6d743) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form notifications are rebuilt: one honest name, new powers, and a send path that respects every setting.

  **It's called Notifications everywhere now.** The tab, the cards, the buttons, and the collection field all say "Notifications" — the "Email Integrations" naming inside the tab is gone.

  **Reply-To from the visitor.** A rule can set its Reply-To to one of the form's email fields, so hitting Reply in your inbox answers the person who submitted the form. A custom fixed address works too.

  **Send conditions.** A rule can carry one condition evaluated against the submitted data ("only send the sales alert when budget equals enterprise"). Unmet conditions skip the rule quietly for that submission.

  **The send path honors what you configure.** The per-rule sender email — previously collected and silently ignored — is now used, falling back to the plugin's `notifications.defaultFrom` option and then the template/provider default. New forms are seeded with one "Admin notification" rule that consumes `notifications.defaultToEmail`, and the `notifications.enabled` option now really turns form emails off. `sendWithTemplate` accepts per-send `from`/`replyTo` overrides.

  **A proper editor.** Rules are cards (with an enable switch, recipient summary, and a "Conditional" badge) edited in an accessible side sheet — replacing a hand-rolled modal that had no dialog semantics, no focus trap, and no Escape handling. Duplicating a rule starts the copy disabled so it never doubles live email. Deleting a form field that a rule's recipient, reply-to, or condition references is blocked with the reason.

  **Fixes**: submission data stored as text (e.g. on SQLite) no longer breaks `{{field}}` recipient resolution in notifications, and email layouts no longer appear as selectable notification templates.

- [#191](https://github.com/nextlyhq/nextly/pull/191) [`f9fc1af`](https://github.com/nextlyhq/nextly/commit/f9fc1aff1a808bca3727cb7eecd6292aef05b391) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The shared field-type catalog now describes the form surface, and plugin field types can declare where they belong.

  `nextly/field-catalog` gains `FORM_FIELD_TYPE_CATALOG`: the form builder's thirteen field types described once in the same catalog the schema builder and user-profile pickers already read, including five form-surface types (url, phone, time, file, hidden) that are deliberately not part of the canonical collection field union — form fields live in a form's JSON, so these can never reach the schema pipeline. The url and phone descriptions are shared with the user-profile surface, so a "URL" field looks and reads the same everywhere.

  Plugin-contributed field types can now declare `surfaces` (entries, users, forms) on their registration. A type only appears in a surface's field picker when the surface admits it, the type declares it, and the host has not excluded it — each level can only remove types, never force one in. Omitting `surfaces` keeps today's behavior (the type appears on the entry editing surface only).

- [#202](https://github.com/nextlyhq/nextly/pull/202) [`23f4897`](https://github.com/nextlyhq/nextly/commit/23f489760a0cea9b23f442e357e998a78c897e41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form preview is now an interactive simulation instead of a static mock.

  Type into real inputs and conditional logic reacts live (the same evaluator the runtime uses), hit the form's actual submit button and the configured confirmation plays out — the success message, or an honest "the visitor would now be redirected to …". A desktop/mobile width toggle, a reset button, required markers, help text, and a note about invisible hidden fields complete it. The preview is explicit about what it is: a simulation inside the admin — nothing submits anywhere.

- [#201](https://github.com/nextlyhq/nextly/pull/201) [`f8e3270`](https://github.com/nextlyhq/nextly/commit/f8e32704b155aa5af9dbad157854d79bc81d4c9a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form settings are one honest shape, and every setting shown now does something.

  **One canonical shape.** The builder previously saved settings keys the collection schema never declared, while the schema declared keys the builder never wrote. Now there is one `FormSettings` (the message-vs-redirect confirmation radio included), one reader (`normalizeFormSettings`) that every consumer goes through, and migration-on-read for legacy keys (`confirmationMessage` becomes the success message; the old nested `captcha` object becomes the flat fields) — saved forms lose nothing.

  **Settings that do things.** "Allow multiple submissions" is now real: turn it off and the same visitor (by IP) can submit once, with an honest "You have already submitted this form." on repeats. The per-form honeypot and reCAPTCHA toggles are now real overrides of the plugin's global spam config — tri-state selects where "Inherit" shows what the plugin default actually is, and the form wins where set.

  **Settings that did nothing are gone.** `showResetButton`, `resetButtonText`, `storeSubmissions`, and `submissionLimit` had no consumer anywhere; they no longer appear in the UI or the shape.

- [#198](https://github.com/nextlyhq/nextly/pull/198) [`edcb2d8`](https://github.com/nextlyhq/nextly/commit/edcb2d8ee4fa5e25c4c23cd3f6fcd2eefa6f0336) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form submissions get an honest server: spam is stored and flagged instead of silently deleted, exports can be real CSV, and submission counts stop lying.

  **Spam is never silently dropped anymore.** Honeypot and reCAPTCHA hits are stored with `status: "spam"` and the detection reason, so a false positive stays reviewable and recoverable — the bot still sees the same fake success, no notification emails fire for flagged rows, and rate-limit hits are still rejected without storage. This also fixes a bug where honeypot detection could never fire at all: the spam check ran on schema-transformed data, which had already stripped the undeclared honeypot fields (and a form's real `website` field can no longer trip the trap either).

  **CSV export is real.** `GET …/submissions/export?format=csv&form=<id>` streams a CSV with columns from the form's fields plus metadata, named after the form and date. Exports page through everything, respect form/status filters, and exclude spam unless you ask for it. The JSON format remains the default.

  **`submissionCount` on forms is now a real number** (spam excluded) instead of a hardcoded 0.

  **Admin edits of submitted data leave a trace**: new `editedAt`/`editedBy` stamps are set whenever the submission `data` changes, and a new `spamReason` field records what flagged a submission.

  **Removed**: the never-mounted `SubmissionList`/`SubmissionDetail` components and the `@nextlyhq/plugin-form-builder/components` subpath that existed only to export them. The builder-config endpoint now also returns the resolved forms/submissions collection slugs so admin components work under slug overrides.

- [#199](https://github.com/nextlyhq/nextly/pull/199) [`e836d9a`](https://github.com/nextlyhq/nextly/commit/e836d9a6348a1ba23879115d90d14c1a24599142) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The submissions list finally shows what people submitted.

  **Per-field columns.** Pick a form and the table's columns become that form's fields — Name, Email, Message — with the standard hide/show column selector. Across all forms you get Form, a data summary, Status, and Submitted. (Submission data is stored keyed by field name, which is what makes real columns possible.)

  **Drawer detail with prev/next.** Click a row for the full submission: values in field order, keys no longer on the form shown honestly, metadata (IP, agent, ID), status and internal notes inline, and prev/next to walk the filtered set without losing your place.

  **Editing behind the update permission.** Admins with update rights can correct submitted values with inputs typed per field; every edit is stamped ("Edited … — the values above are not necessarily what the visitor sent"). There is deliberately no "New Submission" button — submissions are machine-created, and collections can now declare `admin.disableCreate` to say so.

  **Spam is a tab, not a black hole.** The Spam tab lists flagged submissions with the detection reason and a "Not spam" recovery (row action or the drawer's status control). Spam stays out of the other tabs and out of exports by default.

  **Export from the toolbar.** CSV (columns from the selected form's fields) and JSON, respecting the active form and status filter.

  The old `SubmissionsFilter` widget — with its hardcoded slugs that broke under slug overrides — is deleted along with its page registration and the now-empty styles export; host apps no longer import any form-builder CSS.

- [#200](https://github.com/nextlyhq/nextly/pull/200) [`fb14ec8`](https://github.com/nextlyhq/nextly/commit/fb14ec87c308b8122ebd4405cf65d044ea82ab7b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Forms moves into the main sidebar rail.

  The form builder now declares standalone placement: Forms gets its own icon right after Media, and clicking it opens a sub-sidebar with Forms and Submissions. "Forms" appears exactly once — the duplicate entries in the Plugins section and the Collections group are gone, and the redundant second builder that rendered at the plugin "settings" URL is removed (the Forms collection's edit view is the one and only builder). Hosts that prefer Forms under the Plugins section can override the placement in one config line.

- [#171](https://github.com/nextlyhq/nextly/pull/171) [`adcaa08`](https://github.com/nextlyhq/nextly/commit/adcaa08697846fd647e6bec5b22372ab9d2604d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the ability to invite a user by a set-password link.

  Nextly can now mint a single-use link that lets a new person set their own password and sign in, and accept that link in one step. `AuthService.generateInviteToken(userId)` returns a 256-bit token (only its SHA-256 hash is stored, and only one is active per account at a time); `AuthService.acceptInvite(token, password)` validates it, sets the password, marks the email verified, activates the account and consumes the token, all in one transaction. The link lasts seven days.

  A new endpoint, **`POST /auth/accept-invite`**, accepts the link over HTTP: it takes `{ token, newPassword }`, is CSRF-protected like the other auth routes, and answers with one generic message for any unusable token (unknown, used, expired) so a guessed token learns nothing about which invites are live — while a weak-password error is passed through, since that is the one thing the person can fix.

  The mechanism is complete and tested at both the service and HTTP layers. What is not here yet: creating a user through the admin does not mint one of these links automatically — that wiring, and the form that shows the copyable link, come next.

  `users.password_hash` is now **nullable on Postgres**, matching SQLite and MySQL, so an invited account can exist before it has a password. This is a schema change your next `nextly db:sync` will apply; loosening a NOT NULL constraint is not data-losing, so it applies cleanly.

- [#178](https://github.com/nextlyhq/nextly/pull/178) [`dacef90`](https://github.com/nextlyhq/nextly/commit/dacef90f0b3bdb944d1bf8aca68b59da4dccfeb8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Invite a user by a set-password link when creating them in the admin.

  Creating a user now asks one question up front — **how should this person sign in?** Choose **Send a set-password link** (the default) and the account is created without a password; the admin gets back a copyable link that lets the new person set their own password and sign in. Choose **Set a password now** and the admin sets it directly, as before. The old "Require email verification" checkbox is gone: whether an account can sign in no longer depends on email being configured or a message being delivered.

  Under the hood, `createLocalUser` with no password creates the account and mints its invite link in the same transaction, so an admin can never be handed a user with no way in. The link is the artifact — it is returned to the admin to deliver however they choose (email, chat, in person); nothing about creating a user depends on a mail provider. Accepting the link sets the password, verifies the email and activates the account in one step, at the new **`/admin/accept-invite`** page.

  Because the account is verified by the act of accepting an invite that reached its address, the create flow no longer pre-checks whether a verification email could be sent — that check, a stopgap that refused to create a user when no mail provider was configured, is removed. Installs with no email set up can now invite users normally.

- [#180](https://github.com/nextlyhq/nextly/pull/180) [`f5426ed`](https://github.com/nextlyhq/nextly/commit/f5426ed147f901daea37df14417fb71a65637d06) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Require authentication and permissions to write media.

  Media writes are no longer open. Previously anyone on the internet could upload, edit, move, or delete a site's media by calling `/api/media` with no login and no key — the endpoint had no auth at all. Now the write operations (upload, update, move, delete, and their folder equivalents) live at a gated **`/admin/api/media`**, where each is checked against a media permission (`create`/`read`/`update`/`delete-media`) and the acting user is taken from the authenticated session or API key, never from a request field like `uploadedBy` (which could name anyone). Reading media stays public at `/api/media` — files are served to anonymous visitors — but that path now serves **reads only**; its write verbs are gone.

  This is why media permissions could not previously gate anything: the admin's session cookie is scoped to `/admin`, so it never reached `/api/media`, and the whole `manage`/`create`/`read`/`delete-media` set was decorative. Moving the management surface under `/admin` is what lets the session authenticate, so the permission checks finally take effect.

  Also adds a real **`update-media`** permission (media had create/read/delete but no update), so editing metadata and moving files gates on `update-media` consistently with every other resource. The built-in Admin, Editor, and Author roles pick it up automatically; Viewer does not.

  **Consumer action:** if your app re-exports the media handlers, mount the gated instance for the admin — `createMediaHandlers({ config, requireAuth: true })` at `app/admin/api/media/[[...path]]/route.ts` — and keep the public read-only instance (`createMediaHandlers({ config })`, exporting `GET` only) at `app/api/media/[[...path]]/route.ts`. Media file URLs in API responses are unchanged and remain public (no `/admin` prefix).

- [#189](https://github.com/nextlyhq/nextly/pull/189) [`89a5e8a`](https://github.com/nextlyhq/nextly/commit/89a5e8aca0fc3dc9d402241f222b72f71d619338) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Media folder navigation no longer moves around, and the library remembers how you like it.

  **One folder model.** Previously, hiding the folder sidebar relocated folders to a different UI above the grid, and showing it moved them back to the left: two different folder UIs behind one confusing toggle. Now the folder tree in the sidebar is simply shown or hidden by a single toggle button, while inline folder navigation on the page (breadcrumbs plus the current level's folder cards, with the same rename/delete/new-subfolder menus) is always there. Nothing relocates; the tree is an overview, the cards are the drill-down.

  **The media library now defaults to the table view** (the grid stays one click away), and your choices stick: view mode, folder-tree visibility, and hidden table columns all persist per browser.

  **The media page gains the sort control** the media picker already had (newest/oldest, name, size).

  Also: the media dropzone's status colors, the upload preview, the media card, and the focal-point marker now use only design-system tokens (no raw color scales or ad-hoc shadows), and an unused media detail dialog was removed.

- [#188](https://github.com/nextlyhq/nextly/pull/188) [`cc3903b`](https://github.com/nextlyhq/nextly/commit/cc3903ba6f0749306219d1fd483847179eedf70a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Media bulk uploads now report every file honestly, and one bad file no longer sabotages the batch.

  **Dropping more than 10 files no longer rejects the whole batch.** Previously a drop of 11 valid files uploaded nothing and labeled every file "Too many files". Now the first 10 upload and the rest are listed as skipped, each saying so.

  **A batch with an oversized file now reads as what it is: a partial success.** Previously 9 valid files uploaded silently behind a full-width red "Invalid file type or size" panel, and the 9 success rows vanished after 2 seconds while the error stayed. Now every file gets its own row in one upload queue: per-file progress while uploading, a green check per success, and a persistent human-readable reason per failure ("File is too large (max 10 MB)" instead of "File is larger than 5242880 bytes"). The summary line reports "9 uploaded, 1 failed" and the queue stays until dismissed whenever anything failed; all-success queues dismiss themselves.

  **The upload drop target now closes itself when an upload starts** — no more hunting for the close icon — while the queue stays visible. Files that fail on the server get a one-click Retry.

  Also: the client-side size limit default now matches the server's 10MB default (it was 5MB, so files between 5 and 10MB were refused by the client that the server would have accepted), the dropzone no longer nests interactive buttons (invalid markup), and its status colors now use the design system's semantic tokens.

- [#166](https://github.com/nextlyhq/nextly/pull/166) [`55d8eb8`](https://github.com/nextlyhq/nextly/commit/55d8eb8cf5f9c8d9d47d51ed5665334a00fe9431) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop a custom user field from displacing a built-in one, and fix a field's name and type once it exists.

  **A custom user field named `email` replaced the real email address, and one named `id` replaced the identity used to create the session.** Custom fields live in their own table, but they are assigned onto the user object _after_ the built-ins, so the custom value wins. The same order applies to validation: a custom text field named `email` turned the built-in `z.string().email()` into a plain optional string, so a user could be created with an invalid address or none at all. Password checking was never affected — the hash is read by a separate query that custom fields cannot reach — but anything reading `user.id` from the object returned after sign-in was.

  `defineConfig()` has always refused these names. Nothing else did: the admin, `POST /api/user-fields` and `PATCH /api/user-fields/:id` all reach the same service, and it checked only that the field was not code-defined. The one check on that path ran in the browser and was skipped when editing. **Creating or renaming a field to any built-in name is now refused wherever the request comes from**, and the message says which name and why. `defineConfig()` and the API now share one implementation, so the two lists cannot drift apart.

  **If your database already has such a field, it stops being applied on the next boot** and Nextly logs which field it dropped. The row is left alone so you can rename it by hand. This is a behaviour change: a field named `email`, `id`, `name`, `isActive`, `passwordHash`, `roles` or any other built-in name will disappear from your users' data until it is renamed — it was displacing a built-in rather than sitting beside it.

  **A field's name and type can no longer change after it is created.** Both name the database column, and Nextly's schema reconciler only adds columns — so renaming left the old column and everything in it stranded under the old name, and changing the type left the column at its original type. The admin now says so under each field rather than only greying the input out, and label, description, placeholder, default, required and active all stay editable. Sending a name or type back unchanged is still accepted, so existing clients that submit a whole field keep working. Directus locks field keys for the same reason; Strapi renames and loses the data.

  Also in this release: **Nextly now has browser tests**, run in CI against a real server and a real database. They cover what unit tests structurally cannot — rendered layout, contrast, and whether the admin boots at all — and they caught nothing new, which is the point: they are there so that the column-width and contrast regressions fixed in the previous release cannot come back unnoticed. Contributors can run them with `pnpm --filter @nextlyhq/e2e test:e2e`; see `e2e/README.md`. This changes nothing about how you use Nextly.

- [#187](https://github.com/nextlyhq/nextly/pull/187) [`1a2214b`](https://github.com/nextlyhq/nextly/commit/1a2214be62e50cd747cd831c909fc2e108bbab65) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - User custom fields gained real validation, two new types, multi-value selects, and a rebuilt creation page.

  **A field's validation bounds finally do something.** `minLength`/`maxLength` (text-like fields) and `min`/`max` (number) used to be documented on the public field types and read by the checker — but no storage existed for them, so a code-declared `maxLength: 200` silently did nothing. They are now persisted (new nullable columns on `user_field_definitions`, all three databases), synced from `defineConfig()`, editable in the admin's new Validation section, and enforced: an out-of-range value is rejected with a per-field message naming the limit. A `maxLength` also sizes newly created text columns as `varchar(n)`. Existing rows are untouched; constraints apply to new writes on fields that declare them.

  **New field types: URL and Phone.** Both validated text, both available to `defineConfig()` and the admin alike. They are user-profile types only — collections cannot declare them, so they never touch the schema pipeline.

  **Selects can store multiple values.** The backend always supported `hasMany`; the admin now offers "Allow multiple selections" when creating a select field. Like name and type, it is fixed at creation because it decides the backing column's type.

  **The Create/Edit User Field page was rebuilt** on the shared field-UI kit: a single-column form whose reading order matches its causal order — the type picker (all 10 types, rendered from the shared catalog) sits at the top and everything it governs follows. The 400px side rail, the duplicated header, and the stale "Field Rules & Default" heading are gone; the selected type card's highlight is token-driven (the inline style that defeated it is deleted); duplicate option values are reported all at once.

- [#175](https://github.com/nextlyhq/nextly/pull/175) [`f4c95c1`](https://github.com/nextlyhq/nextly/commit/f4c95c144f01c7007f126e554e9226cc7e8655f1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Dependency-manifest consistency pass across the workspace: package.json dependency keys are now consistently ordered and the playground's Next.js lint preset is aligned with its Next.js version. No runtime behavior changes for any package.

- Updated dependencies [[`cfd0d83`](https://github.com/nextlyhq/nextly/commit/cfd0d83bafd79efeee715f0c4e396bafc6d43acf), [`2b3b072`](https://github.com/nextlyhq/nextly/commit/2b3b0729ee4e5aa2501356bc1bf0640f5cd8697b), [`b4e6294`](https://github.com/nextlyhq/nextly/commit/b4e6294d9c8c37dbb646c26b8e3fe701860ae00c), [`1ed808c`](https://github.com/nextlyhq/nextly/commit/1ed808c6a8b9c2eeffe7ae3a2c675f7d911cbb88), [`a704e1a`](https://github.com/nextlyhq/nextly/commit/a704e1a4b824d5b6cfb06ff1519f0f24921a8c0f), [`8cc095b`](https://github.com/nextlyhq/nextly/commit/8cc095b7554bd0b0c6d8dc583666a318e0438b16), [`5241bb2`](https://github.com/nextlyhq/nextly/commit/5241bb289c81f45e80169d56de5607a56f6f8577), [`eb6751a`](https://github.com/nextlyhq/nextly/commit/eb6751a156b940108f6df1b109d58ac252e1abaa), [`4aa9a61`](https://github.com/nextlyhq/nextly/commit/4aa9a61dce555b30da7d1b13608184d9fe4a8e86), [`2fb740f`](https://github.com/nextlyhq/nextly/commit/2fb740fd609049f2dc90f6439a772e73367d5c1b), [`3213d3f`](https://github.com/nextlyhq/nextly/commit/3213d3fcfebeb61c1e37987efab19725fb274275), [`9e60f5c`](https://github.com/nextlyhq/nextly/commit/9e60f5c070d0b82c25808afbf8e726e17ab6d743), [`f9fc1af`](https://github.com/nextlyhq/nextly/commit/f9fc1aff1a808bca3727cb7eecd6292aef05b391), [`23f4897`](https://github.com/nextlyhq/nextly/commit/23f489760a0cea9b23f442e357e998a78c897e41), [`f8e3270`](https://github.com/nextlyhq/nextly/commit/f8e32704b155aa5af9dbad157854d79bc81d4c9a), [`edcb2d8`](https://github.com/nextlyhq/nextly/commit/edcb2d8ee4fa5e25c4c23cd3f6fcd2eefa6f0336), [`e836d9a`](https://github.com/nextlyhq/nextly/commit/e836d9a6348a1ba23879115d90d14c1a24599142), [`fb14ec8`](https://github.com/nextlyhq/nextly/commit/fb14ec87c308b8122ebd4405cf65d044ea82ab7b), [`adcaa08`](https://github.com/nextlyhq/nextly/commit/adcaa08697846fd647e6bec5b22372ab9d2604d5), [`dacef90`](https://github.com/nextlyhq/nextly/commit/dacef90f0b3bdb944d1bf8aca68b59da4dccfeb8), [`f5426ed`](https://github.com/nextlyhq/nextly/commit/f5426ed147f901daea37df14417fb71a65637d06), [`89a5e8a`](https://github.com/nextlyhq/nextly/commit/89a5e8aca0fc3dc9d402241f222b72f71d619338), [`cc3903b`](https://github.com/nextlyhq/nextly/commit/cc3903ba6f0749306219d1fd483847179eedf70a), [`55d8eb8`](https://github.com/nextlyhq/nextly/commit/55d8eb8cf5f9c8d9d47d51ed5665334a00fe9431), [`1a2214b`](https://github.com/nextlyhq/nextly/commit/1a2214be62e50cd747cd831c909fc2e108bbab65), [`f4c95c1`](https://github.com/nextlyhq/nextly/commit/f4c95c144f01c7007f126e554e9226cc7e8655f1)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.35
  - @nextlyhq/adapter-mysql@0.0.2-alpha.35
  - @nextlyhq/adapter-postgres@0.0.2-alpha.35
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.35

## 0.0.2-alpha.34

### Patch Changes

- [#156](https://github.com/nextlyhq/nextly/pull/156) [`fd0aa70`](https://github.com/nextlyhq/nextly/commit/fd0aa706eb1ae4ed485e0337919b020d49181ccb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A comprehensive visual refresh of the Nextly admin.
  - **Consistent lists everywhere.** Every admin list — collections, entries, users, roles, media, API keys, singles, components, plugins, and form-builder submissions — now uses one unified data table with full-row navigation, and plugins can extend any list through new registries exported from the admin package.
  - **Design-token theming.** Hardcoded colors were replaced with design tokens across light and dark mode: dark-mode surfaces and text, a three-tier border scale that fixes the pervasive faint borders, clearer sidebar active states, readable link/breadcrumb contrast, and more legible badges, checkboxes, and radios. The admin is on Tailwind CSS 4.3 with the shadcn setup aligned to Tailwind v4's `@theme inline` model.
  - **Responsiveness.** The sidebar collapses to the mobile drawer across the full tablet range, wide tables keep readable columns and scroll horizontally, and the form builder's two-pane layout and tab strip adapt to narrow widths.
  - **Auth and API-key pages.** API keys open a full edit page on the shared settings layout, the registration form places one field per row, and the auth pages have corrected borders and width.
  - **Code-first schemas.** Collections, singles, and components defined in code now open in a read-only builder view instead of appearing broken.
  - **Email subsystem.** A redesigned full-width template workbench with a fixed HTML/plain-text editor-and-preview toggle; emails send as `multipart/alternative` with a plain-text alternative; every send emits a consistent log record; providers gain an Active toggle and dark-mode-legible logos; providers and templates render in the unified table; templates and layouts are unified into one kind-tagged model; and a Send test action is available while editing a template.
  - **Form builder.** The builder UI now matches the Nextly admin design system (monochrome theming), reports its version from `package.json`, and every package entry exposes a `default` export condition.

- [#158](https://github.com/nextlyhq/nextly/pull/158) [`f90fd3d`](https://github.com/nextlyhq/nextly/commit/f90fd3dd75b06e0d5818ffacfe79d0bd7db21575) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Nextly design system now lives in `@nextlyhq/ui` and is self-contained. You can style plugins and custom admin UIs two ways: import `@nextlyhq/ui/styles.css` for fully-styled, token-driven, dark-mode-aware components with zero Tailwind setup, or import `@nextlyhq/ui/theme.css` to build your own utilities against the token contract (tokens on `:root`/`.dark`, the `@theme` mappings, and the dark variant). Add the `dark` class to switch themes.

  Control heights (Button, Input, Select) are now driven by a `--control-height` token scale, so control density can be tuned from one place; default sizes are unchanged. The admin renders identically to before — it now sources its tokens from `@nextlyhq/ui` with no visual change and no token leakage into the host page.

  The form-builder and page-builder plugins now consume the design tokens directly (`var(--token)` / `color-mix`), so their admin UIs are fully token-driven and render correctly in both light and dark mode — the page-builder's canvas selection and drop indicators now follow the admin theme instead of a fixed accent. A new [plugin UI authoring guide](https://github.com/nextlyhq/nextly/blob/main/packages/ui/docs/plugin-ui-authoring.md) documents the token contract, and a `lint:design` check (wired into CI) keeps admin and plugin styles token-driven.

  The theme switcher (light / dark / system) now lives in the admin top bar for one-click access and applies instantly, instead of being tucked inside Settings behind a save.

- [#157](https://github.com/nextlyhq/nextly/pull/157) [`2b725ea`](https://github.com/nextlyhq/nextly/commit/2b725eab34613b4b49be6975ad2fb3add81ee29d) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Expand the page builder toward Elementor/Gutenberg parity: a much larger block set, deep per-block options, entrance motion, global design tokens, and platform helpers — all built on the plugin's existing extension seams with no Nextly-core changes.
  - **`supports` capability model.** A block declares which style capabilities it exposes (`supports: { typography, color, background, border, shadow, dimensions, position, opacity, filters, motion, visibility, interactions, customCss, customAttributes }`) and the inspector's Style/Advanced controls plus the compiled CSS are derived from that single declaration. `styleControls` remains as an escape hatch.
  - **Expanded styling.** The typed `StyleValues` now covers full typography (family/weight/appearance/letter-case/decoration/line-height/letter- & word-spacing), structured borders, box-shadow (with presets), background image + linear gradient, sizing (min-height/object-fit/overflow/aspect-ratio), opacity, CSS filters, transforms, absolute/fixed/sticky position + z-index, Gutenberg-style width alignment (wide/full), and descendant link colors (default/hover). All values pass css-tree validation before emission.
  - **Per-block custom CSS + attributes.** Authors can write per-block CSS using the Elementor-style `selector` keyword (sanitized and scoped at render), set a CSS ID and custom HTML attributes (allowlisted), and hide a block per breakpoint. New composite inspector controls: border, background, gradient, position, slider, box-shadow, unit-aware dimension, repeater, and icon picker; the typography selects now carry real option lists.
  - **~40 new/upgraded blocks.** Structure (Columns, Spacer, Divider, Anchor, Row/Stack); Basic (List, Icon List, Badge, Icon, Button Group, Rich Text, Table, Social Icons, Progress Bar, Counter, Rating, Countdown) plus inline formatting (bold/italic/link/highlight/strikethrough/sub/superscript) on Paragraph/Heading/List; Media (Cover, Gallery, Image/Logo Carousel, Slides, Content Carousel, Hotspot, Lottie) plus Image (caption/link/aspect/rounded) and Video (self-hosted, autoplay/mute/loop/controls, privacy host, poster) upgrades; Content cards (Icon Box, Image Box, CTA Card, Flip Box, Pricing Table, Price List, Form, Testimonial + Carousel, Reviews, Logo Cloud); Interactive (Tabs, Accordion, Toggle, Off Canvas — all server-rendered with no client JS via CSS scroll-snap / native `<details>` / the checkbox-hack); Utility (HTML/Embed, Map, reusable `core/ref`).
  - **Entrance motion.** A `motion` option compiles fade/slide/zoom entrance animations to CSS wrapped in `prefers-reduced-motion: no-preference`, with keyframes emitted once per page.
  - **Platform helpers.** Global design tokens surfaced as inspector color swatches, cycle-guarded reusable blocks (`core/ref`), template composition (`composeTemplate`), revision snapshot/prune helpers, and editor copy/paste + copy-style/paste-style with a navigator flatten utility.
  - **Packaging fix.** `sideEffects` now covers the source admin and block-registration entries so the plugin's components and blocks register from a plain side-effect import even under source-mode/monorepo bundling (previously tree-shaken, leaving the editor empty).

  All additions are additive and optional, so existing pages need no migration.

- Updated dependencies [[`fd0aa70`](https://github.com/nextlyhq/nextly/commit/fd0aa706eb1ae4ed485e0337919b020d49181ccb), [`f90fd3d`](https://github.com/nextlyhq/nextly/commit/f90fd3dd75b06e0d5818ffacfe79d0bd7db21575), [`2b725ea`](https://github.com/nextlyhq/nextly/commit/2b725eab34613b4b49be6975ad2fb3add81ee29d)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.34
  - @nextlyhq/adapter-mysql@0.0.2-alpha.34
  - @nextlyhq/adapter-postgres@0.0.2-alpha.34
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.34

## 0.0.2-alpha.33

### Patch Changes

- [#154](https://github.com/nextlyhq/nextly/pull/154) [`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Add editable page-level custom CSS with live preview in the page builder editor

- Updated dependencies [[`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.33
  - @nextlyhq/adapter-mysql@0.0.2-alpha.33
  - @nextlyhq/adapter-postgres@0.0.2-alpha.33
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.33

## 0.0.2-alpha.32

### Patch Changes

- Fix installation of the plugin in fresh apps: internal `@nextlyhq/*` peer dependencies now use the `workspace:*` protocol, so each published version's peers are rewritten to the versions released alongside it instead of a hard-coded (and stale) pin. Previously `npm install @nextlyhq/plugin-page-builder` / `nextly add` failed with `ERESOLVE` because the published peers demanded an older core version than the one installed.

- Updated dependencies []:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.32
  - @nextlyhq/adapter-mysql@0.0.2-alpha.32
  - @nextlyhq/adapter-postgres@0.0.2-alpha.32
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.32

## 0.0.2-alpha.31

### Patch Changes

- [#150](https://github.com/nextlyhq/nextly/pull/150) [`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Per-entry editor choice + the generic, plugin-agnostic platform hooks that power it. A collection or single can offer a per-entry **Default / Page Builder** toggle, and turning it on shows a visual canvas instead of the normal fields — delivered entirely through reusable extension points, with no page-builder-specific code in core or admin.
  - **Plugin field types round-trip to production.** `ui-schema.json` (the committable schema manifest) now accepts plugin-contributed field types, and the CLI registers `contributes.fieldTypes` before generating migrations — so a plugin field type resolves to its declared storage column and survives to production. Previously a UI-created plugin field was downgraded to `json` in the manifest, so the real type was lost outside dev.
  - **`layout: "takeover"` field-type flag.** A plugin field type can declare that, when a field of that type is active, the entry/single form collapses to just that field plus the field that controls its `admin.condition` — hiding the rest. Generic: it keys off field-type metadata (`branding.plugins[].fieldTypes[].layout`) and the existing condition evaluator, so any plugin field type can opt in.
  - **`contributes.admin.schemaBuilderSlot`.** Plugins can render a control above the field list in the collection/single schema builders, receiving `{ fields, setFields, disabled, context }` to add builder-time behavior (e.g. an editor-choice toggle) without core knowing the plugin.
  - **`contributes.admin.entryFormToolbarSlot`.** Plugins can render a control in the entry/single form header toolbar, reading and writing form state via react-hook-form — for form-level controls like a mode toggle.
  - **Managed (hidden) fields.** A field marked `admin.hidden` is kept out of the schema-builder "Your fields" list and out of the entry-form body while its value still lives in the form state — used for plugin plumbing that's driven by a toolbar control rather than shown as a field.

  `@nextlyhq/plugin-page-builder` is the first consumer of all of the above and is published through the same release: it registers a `page-builder` field type with `layout: "takeover"`, contributes the "Use Page Builder" schema-builder toggle and the per-entry Default / Page Builder form-toolbar toggle, ships the visual block editor (drag-and-drop canvas, inspector, responsive preview, query loop), and works for both code-first (`withPageBuilder()`) and UI-created collections and singles. Packaging: declares `sideEffects` so its admin components register from a plain side-effect import, with pinned peer versions for clean installs.

- Updated dependencies [[`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.31
  - @nextlyhq/adapter-mysql@0.0.2-alpha.31
  - @nextlyhq/adapter-postgres@0.0.2-alpha.31
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.31

## 0.0.2-alpha.30

### Patch Changes

- [#145](https://github.com/nextlyhq/nextly/pull/145) [`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The API reference was not correctly specified in the `useEffect` dependency array. It was set as `[api]`, whereas it should have been `[api.public]`.

- Updated dependencies [[`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.30
  - @nextlyhq/adapter-mysql@0.0.2-alpha.30
  - @nextlyhq/adapter-postgres@0.0.2-alpha.30
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.30

## 0.0.2-alpha.29

### Patch Changes

- [#143](https://github.com/nextlyhq/nextly/pull/143) [`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Extensible plugin platform — plugins are first-class, semver-protected extensions of a Nextly app, wired through a single `plugins` array in `defineConfig`.
  - **Plugin contract + SDK**: `definePlugin()` and the `plugins` array, with `@nextlyhq/plugin-sdk` as the stable, semver-protected authoring boundary (the packages stay `0.x` alpha; the SDK surface is held to the stability ladder). Boot-time dependency ordering via `dependsOn` / `optionalDependsOn`, version-range checks, and an `enabled` gate.
  - **Schema contributions**: plugins can contribute their own collections, singles, and components; `contributes.extend` adds fields to existing collections — both code-first AND UI-Builder–created ones — and cross-plugin relations resolve at boot. Plugin-owned fields carry provenance (`source`/`owner`/`locked`) and render locked + labelled in the Schema Builder so they can't be edited away.
  - **Permissions**: `contributes.permissions` registers custom permissions and role bundles that flow through the existing access-control checks.
  - **HTTP routes**: namespaced, secure-by-default plugin routes mounted under `/api/plugins/<name>/…`, with the same auth/CSRF guarantees as core routes.
  - **Admin UI contributions**: menu items, full pages, settings panels, custom views, and header/toolbar slots (show/hide defaults + inject components). Plugin admin component modules are auto-registered.
  - **Lifecycle events + filters**: an event bus plugins publish to and subscribe from, plus context filters they can transform — the basis for cache invalidation, side effects, and cross-plugin reactions.
  - **Custom field types, email providers/templates, and auth extensibility** (strategies + hooks) are all pluggable through the same contract.
  - **First-party + tooling**: ships `@nextlyhq/plugin-form-builder`, the `nextly add <package>` install-and-wire CLI command, and `create-nextly-app` plugin scaffolding.

- Updated dependencies [[`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.29
  - @nextlyhq/adapter-mysql@0.0.2-alpha.29
  - @nextlyhq/adapter-postgres@0.0.2-alpha.29
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.29

## 0.0.2-alpha.28

### Patch Changes

- [#134](https://github.com/nextlyhq/nextly/pull/134) [`0363799`](https://github.com/nextlyhq/nextly/commit/0363799c3842692ddc64d1d2ed1b548aa1958838) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Remove the hardcoded default super-admin credentials from `seedSuperAdmin()`. The seeder no longer falls back to a built-in email/password pair: callers (the `/admin/setup` wizard and the dev seed) must pass an explicit `email` and `password`, and the function throws a `VALIDATION_ERROR` if either is missing. `seedAll()` likewise fails closed when super-admin seeding is enabled but no credentials are supplied, instead of creating a known-weak default account. This removes a well-known default credential from shipped framework source.

  Also hides the placeholder address the admin user menu previously showed when a user had no email (the line is now omitted when empty), and standardizes example email placeholders across the admin and form-builder UIs onto the `nextly.local` domain.

- Updated dependencies []:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.28
  - @nextlyhq/adapter-postgres@0.0.2-alpha.28
  - @nextlyhq/adapter-mysql@0.0.2-alpha.28
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.28

## 0.0.2-alpha.27

### Patch Changes

- [#131](https://github.com/nextlyhq/nextly/pull/131) [`4f86e82`](https://github.com/nextlyhq/nextly/commit/4f86e82cfea10911fef89ecde14a8a42ec4f0397) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Stop collections from generating orphan Drizzle `.ts` schema files.

  Creating or updating a collection (via the admin UI or `nextly db:sync`) used to write a Drizzle `.ts` schema into `src/db/schemas/dynamic/` and maintain an `index.ts` barrel. Nothing imported these files: the runtime resolves each table's Drizzle schema from the `dynamic_collections` metadata via `generateRuntimeSchema`, exactly as singles and components already do (those never generated `.ts` files). The only consumer was the raw `drizzle-kit` binary via `merge-schemas` / `drizzle-kit-entry`, which requires a `drizzle.config.ts` that the framework's own commands never invoke. The generated files therefore drifted from the database and read as dead code.

  Collections now behave like singles and components: the data table is created, the field definitions are stored in `dynamic_collections`, an in-memory runtime schema is registered, and the SQL migration is still written to `src/db/migrations/dynamic/` (it remains the durable DDL applied by `nextly migrate`). No `.ts` schema file is written.

  Changes:
  - `CollectionFileManager`: replaced `saveArtifacts`/`saveUpdateArtifacts` with a migration-only `saveMigration`; removed `updateSchemaIndex`, `removeFromSchemaIndex`, and the disk-based `reloadSchema` hot-reload.
  - `CollectionMetadataService`: create/update/delete now persist only the SQL migration. The update path relies on the existing `registerRuntimeSchema` call to refresh the in-memory table, so no on-disk reload is needed.
  - Removed the now-unused `generateSchemaCode` Drizzle code generator from `DynamicCollectionSchemaService` and the `schemaCode`/`schemaFileName` fields from `CollectionArtifacts`.
  - `nextly db:sync --schemas` no longer writes Drizzle `.ts` files; the flag now only generates Zod validation schemas.

  Also removed the unused `NEXTLY_SKIP_SCHEMA_FILES` environment toggle (it was set nowhere and only gated the now-removed file writes).

- [#126](https://github.com/nextlyhq/nextly/pull/126) [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - parseMediaRoute had no case for the 'bulk' segment, so DELETE /api/media/bulk fell through to the single-item path and treated 'bulk' as a mediaId, causing a 404 from the database.

- Updated dependencies [[`4f86e82`](https://github.com/nextlyhq/nextly/commit/4f86e82cfea10911fef89ecde14a8a42ec4f0397), [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.27
  - @nextlyhq/adapter-mysql@0.0.2-alpha.27
  - @nextlyhq/adapter-postgres@0.0.2-alpha.27
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.27

## 0.0.2-alpha.26

### Patch Changes

- [#123](https://github.com/nextlyhq/nextly/pull/123) [`6964718`](https://github.com/nextlyhq/nextly/commit/6964718c5d36dba4a337fbce1bf70a55c5554b1f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Single edit forms no longer ask for a title and slug. A Single is a one-instance document whose identity is fixed by its config (`label` + `slug`), but the admin previously rendered title and slug as editable, required inputs — forcing redundant input for values already determined by the definition.

  The single edit form now shows the title (from the single's `label`) and slug (from the configured `slug`) as read-only, non-editable fields, and submitting never errors on them. `EntrySystemHeader` and `EntryMetaStrip` gain opt-in `lockIdentity`/`lockSlug` flags (default off, so collection entry forms are unchanged); for singles the title/slug are seeded from config, the client validation for those two fields is relaxed, and slug auto-generation is disabled.

- Updated dependencies [[`6964718`](https://github.com/nextlyhq/nextly/commit/6964718c5d36dba4a337fbce1bf70a55c5554b1f)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.26
  - @nextlyhq/adapter-mysql@0.0.2-alpha.26
  - @nextlyhq/adapter-postgres@0.0.2-alpha.26
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.26

## 0.0.2-alpha.25

### Patch Changes

- [#121](https://github.com/nextlyhq/nextly/pull/121) [`8cc3a1c`](https://github.com/nextlyhq/nextly/commit/8cc3a1cccfce7bd0064d16f683022420b99f3fe8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fresh projects scaffolded with `pnpm create nextly-app` no longer fail to install under pnpm 11. pnpm 11 stopped reading the `pnpm` field from `package.json`, so the `pnpm.onlyBuiltDependencies` allowlist the scaffolder emitted was ignored: `pnpm install` aborted with `ERR_PNPM_IGNORED_BUILDS`, and past that `better-sqlite3` never compiled its native binding (SQLite scaffolds crashed at boot) while `sharp`, `esbuild`, and `unrs-resolver` were silently blocked.

  The scaffolder now writes the build-script allowlist to `pnpm-workspace.yaml` instead, emitting both `allowBuilds` (read by pnpm 11+) and `onlyBuiltDependencies` (read by pnpm 10.6+), and drops the now-dead `pnpm` field from the generated `package.json`. `better-sqlite3` is always allow-listed so the `--use-yalc` dev flow — which installs every adapter — builds it too. npm, yarn, and pnpm 9 run dependency build scripts by default and ignore the file, so it is harmless under those package managers.

- Updated dependencies [[`8cc3a1c`](https://github.com/nextlyhq/nextly/commit/8cc3a1cccfce7bd0064d16f683022420b99f3fe8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.25
  - @nextlyhq/adapter-mysql@0.0.2-alpha.25
  - @nextlyhq/adapter-postgres@0.0.2-alpha.25
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.25

## 0.0.2-alpha.24

### Patch Changes

- [#103](https://github.com/nextlyhq/nextly/pull/103) [`01f3f7a`](https://github.com/nextlyhq/nextly/commit/01f3f7a22eb2e85fb6987b43264c07e993872fa7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Forward `cc`/`bcc` consistently across every email send path.

  `nextly.email.send` and `nextly.email.sendWithTemplate` (Direct API) now accept and forward `cc`/`bcc` — they are added to `SendEmailArgs` and `SendTemplateEmailArgs`. Previously the Direct API namespace silently dropped both fields, so only the REST route (`/api/email/send-with-template`) honored them. `EmailService.sendWithTemplate` also dropped `cc`/`bcc` on its code-first template fallback branch while the DB-template branch already forwarded them; both branches now forward them. Empty `cc`/`bcc` arrays are not forwarded, so they don't override the "no options" path.

- Updated dependencies [[`01f3f7a`](https://github.com/nextlyhq/nextly/commit/01f3f7a22eb2e85fb6987b43264c07e993872fa7)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.24
  - @nextlyhq/adapter-mysql@0.0.2-alpha.24
  - @nextlyhq/adapter-postgres@0.0.2-alpha.24
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.24

## 0.0.2-alpha.23

### Patch Changes

- [#101](https://github.com/nextlyhq/nextly/pull/101) [`7f7845b`](https://github.com/nextlyhq/nextly/commit/7f7845b5feeec3b30ed86ae459ef3d2347734cca) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix component CRUD breaking with a 500 after a dev-server config hot-reload.

  `reloadNextlyConfig` rebuilt the runtime Drizzle descriptors for `comp_*` data tables with the collection/single `generateRuntimeSchema`, which prepends `id`/`title`/`slug` base columns and omits the `_parent_id`/`_parent_table`/`_parent_field`/`_order` link columns that components use to reference their parent document. This overwrote the correct boot-time registration.

  After a hot-reload the bad descriptor no longer matched the physical table, so component reads (which filter by `_parent_id`) failed and were swallowed as "no rows", and component writes (which insert the `_parent_*` columns) were rejected by the database. Saving any Single or Collection document that embeds a component returned a 500.

  The reload path now builds `comp_*` descriptors with `ComponentSchemaService.generateRuntimeSchema`, matching the boot path and the physical `comp_*` table. Adds a regression test asserting the refreshed descriptor exposes the `_parent_*` link columns and not `title`/`slug`.

- Updated dependencies [[`7f7845b`](https://github.com/nextlyhq/nextly/commit/7f7845b5feeec3b30ed86ae459ef3d2347734cca)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.23
  - @nextlyhq/adapter-mysql@0.0.2-alpha.23
  - @nextlyhq/adapter-postgres@0.0.2-alpha.23
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.23

## 0.0.2-alpha.22

### Patch Changes

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`bdece5c`](https://github.com/nextlyhq/nextly/commit/bdece5c41872f0f9cb71b4fc43dca034fabdbfe5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix code-first / HMR schema applies wrongly dropping managed tables on SQLite & MySQL.

  On SQLite and MySQL, drizzle-kit's `pushSchema` ignores `tablesFilter` and introspects the whole database, so any managed table missing from the desired schema was flagged as a data-losing "orphan" DROP — failing the apply and offering the table as a spurious rename source. Three cases are fixed:
  - **Schema-events ledger (`nextly_schema_events`)** is now a first-class managed core table (declared in `getCoreSchema` / `getDialectTables` / `CORE_TABLE_NAMES`), so no schema path — apply, HMR, `migrate`, or `db:sync` — ever treats it as an orphan drop or offers it as a spurious rename target. To make it round-trip cleanly, the SQLite primary key gains an explicit `NOT NULL` (SQLite, unlike PG/MySQL, treats a bare `TEXT PRIMARY KEY` as nullable) and the SQLite partial unique index is dropped — drizzle-kit 0.31.10 cannot round-trip a SQLite partial index ([drizzle-team/drizzle-orm#4688](https://github.com/drizzle-team/drizzle-orm/issues/4688)), and keeping it churned `DROP/CREATE INDEX` on every push. Postgres keeps its partial unique index. The "one applied row per file" guarantee is now enforced in code on all dialects: an atomic conditional `markApplied` (sets `applied` only when no other applied row exists for the filename) plus the existing cross-process migrate lock.
  - **UI-created collections, singles, and components** are now preserved during a code-first HMR apply: every DB-registered resource is included in the desired schema (code-config entries take precedence), so adding a collection in code no longer drops resources created via the admin UI.
  - **Migration status**: a collection added in code after the initial DB setup is now marked `applied` once its table is created, instead of showing `pending` forever in the builder listing (mirrors the existing singles behaviour).

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`faf14cd`](https://github.com/nextlyhq/nextly/commit/faf14cdfe644e3c0ecdb84c691289d01e6c80010) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix fresh-database first-run aborting on MySQL.

  Now that `nextly_schema_events` is a core table, `freshPushSchema` creates it (and its indexes) during first-run setup. The setup then also replayed the out-of-band `getSchemaEventsDdl` unconditionally, and the MySQL raw DDL's `CREATE INDEX` has no `IF NOT EXISTS`, so it failed with a duplicate-index error and first-run reported failure on a fresh MySQL database. The out-of-band bootstrap is now guarded by a `tableExists` check (matching `nextly migrate`'s `ensureLedger`), so it only runs as a fallback when the ledger is genuinely missing.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`17f0353`](https://github.com/nextlyhq/nextly/commit/17f0353fb0d21086171278a6f9cbf0470e9775f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `nextly migrate:create` generating the wrong schema for components.

  The migration snapshot generator built component tables with the **collection** table-builder, so they came out with `slug`/`title` and were missing the component embedding columns (`_parent_id`, `_parent_table`, `_parent_field`, `_order`, `_component_type`). The generated snapshot then diverged from the real component table the apply pipeline creates, which made `nextly migrate:resolve --applied` fail its schema-match verification for any project with a component. Components now use `buildDesiredTableFromComponentFields`, matching the apply path.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`7f465db`](https://github.com/nextlyhq/nextly/commit/7f465db7721381a10c458fca6cc182164c0651a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `nextly migrate:create` omitting the component parent index, which broke `migrate:resolve --applied`.

  The apply pipeline always creates a composite index (`idx_<table>_parent` on `_parent_id`, `_parent_table`, `_parent_field`) for component tables, but the migration-snapshot builder did not emit it. So the live index looked like an unmanaged extra and `nextly migrate:resolve --applied` failed verification ("Live schema does not match the target snapshot") for any project with a component. The snapshot builder now emits the parent index, matching the apply pipeline.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`7cae340`](https://github.com/nextlyhq/nextly/commit/7cae34051c5739bfd9afa78bf9c901a6d934b8d4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix two `nextly_schema_events` ledger edge cases on the code-first schema path.
  - **Postgres index/default churn:** the ledger's raw bootstrap DDL declared `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, but the Drizzle def supplies the value app-side (`$defaultFn`) with no SQL default. Now that the ledger is a core table flowing through drizzle-kit's Postgres diff, that mismatch made every push/migrate emit `ALTER COLUMN started_at DROP DEFAULT`. The raw DDL now omits the redundant default (matching the MySQL/SQLite ledger DDL and the `id` column), so the ledger round-trips cleanly with no churn. Added a Postgres round-trip integration test alongside the existing SQLite one.
  - **`markApplied` race no-op:** when the "one applied row per file" guard blocked a concurrent second apply, the losing row was left dangling at `in_progress` and the caller still logged a success. `markApplied` now resolves the blocked row to `superseded` and returns whether it applied, and `nextly migrate` reports the file as already-applied-by-a-concurrent-run instead of a false success.

- Updated dependencies [[`bdece5c`](https://github.com/nextlyhq/nextly/commit/bdece5c41872f0f9cb71b4fc43dca034fabdbfe5), [`faf14cd`](https://github.com/nextlyhq/nextly/commit/faf14cdfe644e3c0ecdb84c691289d01e6c80010), [`17f0353`](https://github.com/nextlyhq/nextly/commit/17f0353fb0d21086171278a6f9cbf0470e9775f4), [`7f465db`](https://github.com/nextlyhq/nextly/commit/7f465db7721381a10c458fca6cc182164c0651a4), [`7cae340`](https://github.com/nextlyhq/nextly/commit/7cae34051c5739bfd9afa78bf9c901a6d934b8d4)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.22
  - @nextlyhq/adapter-mysql@0.0.2-alpha.22
  - @nextlyhq/adapter-postgres@0.0.2-alpha.22
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.22

## 0.0.2-alpha.21

### Patch Changes

- [#84](https://github.com/nextlyhq/nextly/pull/84) [`0e17fc6`](https://github.com/nextlyhq/nextly/commit/0e17fc6c3b4863552380729d61f938049e15ca1e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Unified schema-migration pipeline with `ui-schema.json` dual-write.
  - **Migration CLI**: `migrate:create` / `migrate` / `migrate:check` / `migrate:status`, plus `migrate:down` for forward-resolved rollbacks (DOWN SQL generated at create time, renames preserved). A pooler-safe TTL migration lock replaces the session advisory lock that leaked through Neon's PgBouncer, and production deployments can run pending migrations on boot (`db.runMigrationsOnBoot` + `db.migrateLockTtlSeconds`).
  - **`ui-schema.json` dual-write**: the admin Schema Builder always applies changes to the dev database AND writes a committable `ui-schema.json` (the file-only mode is retired). The manifest is now a lossless record of every field option the builder/code-first can set — full validation (min/max length, pattern, etc.), per-field admin (width, description, placeholder…), `unique`, `index`, labels, the Draft/Published `status` flag (persisted from both the field-change and settings-only save paths), and polymorphic `relationTo` arrays (previously truncated to the first target). The `toggle` field type round-trips correctly.
  - **Correct column types**: `migrate:create` no longer flattens fields before diffing, so hasMany and polymorphic relationships emit `json` columns instead of a single `text` id column.
  - **Diffable index/unique migrations** (Postgres/MySQL/SQLite): field `unique`/`index`, single-relationship auto-indexes, and the system slug/created_at indexes are now diffed and emitted (`CREATE`/`DROP INDEX`) with live-DB introspection, down-migration support, and a backward-compat sentinel so pre-existing tables don't churn.
  - **Cleanup**: removed the unused `verification_tokens` table (a leftover from the retired Auth.js integration; custom auth uses `email_verification_tokens` and `password_reset_tokens`). `dev:reset` auto-detects the dialect from `DATABASE_URL`, and the ui-schema field-type set was widened to the full canonical list.

- Updated dependencies [[`0e17fc6`](https://github.com/nextlyhq/nextly/commit/0e17fc6c3b4863552380729d61f938049e15ca1e)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.21
  - @nextlyhq/adapter-mysql@0.0.2-alpha.21
  - @nextlyhq/adapter-postgres@0.0.2-alpha.21
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.21

## 0.0.2-alpha.20

### Patch Changes

- [#63](https://github.com/nextlyhq/nextly/pull/63) [`f721539`](https://github.com/nextlyhq/nextly/commit/f721539a8ee9cccfcd179e1bc96de0863a160345) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Singles builder popup now auto-derives the slug as kebab-case to match the web convention used by public routes and the entry-form slug validator. Typing `About Page` as the singular name now fills the slug as `about-page` instead of `about_page`. Collections and components keep their existing snake_case defaults so their backend validators continue to accept the auto-generated value unchanged. The shared `BuilderSettingsModal` forwards the per-kind identifier to `BasicsTab`, where the slug-case helper is selected; a new `toKebabName` helper lives alongside `toSnakeName` in `@admin/lib/builder` for downstream consumers that need URL-friendly identifiers.

  `create-nextly-app` now resolves the published `@nextlyhq/ui` and `@nextlyhq/plugin-form-builder` versions from the npm registry alongside the other `@nextlyhq/*` packages it scaffolds. Generated `package.json` files pin both via their published semver range instead of falling back to `"latest"`, so fresh projects install the same versions the CLI was tested against.

- Updated dependencies [[`f721539`](https://github.com/nextlyhq/nextly/commit/f721539a8ee9cccfcd179e1bc96de0863a160345)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.20
  - @nextlyhq/adapter-mysql@0.0.2-alpha.20
  - @nextlyhq/adapter-postgres@0.0.2-alpha.20
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.20

## 0.0.2-alpha.19

### Patch Changes

- [#61](https://github.com/nextlyhq/nextly/pull/61) [`e2b4131`](https://github.com/nextlyhq/nextly/commit/e2b4131f63f4de10587772717d707a0a61ce62f9) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - Admin UI polish across the Entries forms, Schema Builder, sidebar, and global loaders.

  Field width is now respected end-to-end. `packFieldsIntoRows` no longer treats `group` as a block-only field, so groups participate in the same row-packing as regular fields and honour `admin.width` on both the builder canvas and the entry form. `FieldRow` adds a synthetic spacer column when a row's declared widths sum to less than 100% so partial-width fields keep their authored size instead of stretching to fill, and uses `items-start` so adjacent fields of different heights align cleanly. `NestedFieldGroup` in the schema builder uses the shared `packIntoRows` / `parseWidth` helpers to render nested children in the same row layout as the top-level canvas; `repeater` and `group` containers are forced to full width to stay readable. `ComponentRow` and `GroupInput` now delegate to `FieldRow` + `packFieldsIntoRows` instead of mapping each child through `FieldRenderer` directly, so nested component and group fields lay out consistently with the surrounding form. `pack-fields-into-rows` also guards against `undefined` / non-array `fields` input.

  Entries table no longer shows the `id` column by default. `getDefaultVisibleColumns` keeps `id` available in the column toggler but excludes it from the initial visible set, matching the rest of the admin's "title first" presentation.

  Schema Builder toolbar is now sticky. `BuilderToolbar` sticks to the top of the builder viewport (`sticky top-0 z-30`) with a solid background so it stays visible while scrolling long field lists; the collection / single / component builder pages were restructured to render the toolbar outside `PageContainer` so the sticky positioning has the correct scroll parent, and the container drops its bottom padding to remove the gap underneath.

  Sidebar no longer flashes the empty / unauthorised state during hydration. `DualSidebar` now treats `!isHydrated` as part of `hasPermissionDataPending` (alongside the existing permissions-loading / error checks), so menu groups render their loading skeletons until the router and permissions are both ready instead of briefly showing nothing.

  `PermissionGuard` loading state is replaced with a branded loader: a glassmorphic card with an ambient glow, the shared `Spinner`, and the Nextly brand mark animated via two new global keyframes (`brand-orbit`, `brand-pulse`) added to `globals.css`. A `?debug_loading=true` query param force-enables the loading view to make iteration on the loader easier. Auth setup / reset-password / user-management / email-provider secret-field inputs get small consistency tweaks alongside the same loader treatment.

- Updated dependencies [[`e2b4131`](https://github.com/nextlyhq/nextly/commit/e2b4131f63f4de10587772717d707a0a61ce62f9)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.19
  - @nextlyhq/adapter-mysql@0.0.2-alpha.19
  - @nextlyhq/adapter-postgres@0.0.2-alpha.19
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.19

## 0.0.2-alpha.18

### Patch Changes

- [#55](https://github.com/nextlyhq/nextly/pull/55) [`de3ec7e`](https://github.com/nextlyhq/nextly/commit/de3ec7e941eb3c7fc33df9dc403e0c5a5135c0b0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Three related singles / API consistency fixes.

  REST responses for collections previously included both snake_case (`created_at`, `updated_at`) and camelCase (`createdAt`, `updatedAt`) variants of the system timestamp fields. The conversion helper added the camelCase aliases but never removed the snake_case originals, so list and detail endpoints surfaced duplicate keys per row. The snake-to-camel conversion now lives in a single helper, `convertTimestampsToCamelCase`, exported from `shared/lib/case-conversion.ts` next to the existing `keysToCamelCase` / `keysToSnakeCase` utilities. Both `collection-query-service` and the singles `deserializeJsonFields` path call it directly. The previous `withTimestampAliases` wrapper and its re-export from `domains/collections/index.ts` are removed. Collections responses now match singles / media / users / api-keys / uploads, which already emitted the camelCase form only.

  The admin sidebar's singles list now renders every single in the project rather than capping at the `useSingles()` default page size of 10. `DynamicSingleNav` drives a `useInfiniteQuery` against the singles endpoint and walks subsequent pages while `meta.hasNext` is true. Each request is bounded to 100 rows so per-request DB load stays small. Secondary consumers that derive visibility or grouping data from the singles list (`DualSidebar`, `DynamicCustomGroupNav`, `SinglesLandingRedirect`) now pass an explicit `pageSize: 100` to `useSingles`, matching the pattern already used by the collections sidebar fetch. This stops the same truncation symptom from hiding section headers or misrouting the `/admin/singles` landing redirect when the project has more than 10 singles.

  The `GET /admin/api/singles` handler now accepts a 1-based `page` query parameter as an alternative to `offset`. The admin UI's shared `buildQuery` helper emits `page` for every paginated route; previously the singles endpoint read only `offset`, so a page change in the Singles builder table left the offset at 0 and the same first page was returned for every navigation. When both `offset` and `page` are supplied `offset` wins, preserving the existing external API contract.

- Updated dependencies [[`de3ec7e`](https://github.com/nextlyhq/nextly/commit/de3ec7e941eb3c7fc33df9dc403e0c5a5135c0b0)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.18
  - @nextlyhq/adapter-mysql@0.0.2-alpha.18
  - @nextlyhq/adapter-postgres@0.0.2-alpha.18
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.18

## 0.0.2-alpha.17

### Patch Changes

- [#56](https://github.com/nextlyhq/nextly/pull/56) [`4d7b4f7`](https://github.com/nextlyhq/nextly/commit/4d7b4f76a4a697fd98b7f98e784179a3fe100c8f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix the schema-apply pipeline silently skipping column type changes on Postgres, leaving the live DB permanently drifted while the journal still recorded the apply as successful.

  **The bug, end-to-end.** When a Builder field was reclassified from a text-like type (`text`, `richText`, `textarea`) to a JSON-backed type (`group`, `repeater`, `blocks`, `json`, `chips`, `point`), the diff engine produced a `change_column_type` operation (`text` → `jsonb` on Postgres). That op type was not in the fast in-memory DDL emitter's allow-list, so the pipeline fell back to `drizzle-kit`'s `pushSchema`. `pushSchema` considers `text` → `jsonb` a non-implicit cast and, in programmatic (non-TTY) mode, omits the `ALTER COLUMN … SET DATA TYPE` statement from `statementsToExecute`, returning the omission only in `warnings`. The pipeline ran the (now-empty or partial) statement list, hit no error, and the migration journal recorded `status='success'`. The next preview compared the live `text` column to the desired `jsonb` token from `field-column-descriptor` and re-detected the same drift — forever. A site running on Neon (rext-site-v2 / `dc_case_studies`) ended up with 10 columns stuck on `text` after three "successful" UI applies on 2026-05-20.

  **The fix.** Four complementary changes in `domains/schema/pipeline/`:
  1. The fast in-memory DDL emitter now owns `change_column_type`, `change_column_nullable`, and `change_column_default` on Postgres. `change_column_type` emits `ALTER TABLE … ALTER COLUMN … SET DATA TYPE <toType> USING "<col>"::<toType>` — the explicit `USING` cast covers the cross-family transitions that Postgres refuses to do implicitly (including the `text` → `jsonb` case), and Postgres errors loudly at execution when no registered cast exists between the source and target types. `change_column_nullable` emits `SET NOT NULL` / `DROP NOT NULL` per the `toNullable` value. `change_column_default` emits `SET DEFAULT <expr>` (raw expression, owned by `build-from-fields`) or `DROP DEFAULT` when `toDefault === undefined`. The three op types are added to `FAST_PATH_OP_TYPES` so they never reach drizzle-kit on Postgres again.
  2. The code-first SQL template at `sql-templates/postgres.ts` (consumed by `nextly migrate:create`) now emits the same `USING "<col>"::<toType>` clause for `change_column_type`. Without this, code-first projects on Postgres would have produced a `.sql` file in the repo whose `ALTER COLUMN … TYPE jsonb` failed at `nextly migrate` apply time in CI — the same drift loop as the Builder UI path, just deferred to migration-apply time. Both consumer surfaces (the apply pipeline and the migration-file generator) now share the same `USING` contract.
  3. Empty op lists on Postgres now also take the fast path (which emits nothing) instead of falling through to drizzle-kit. Letting drizzle-kit handle a "no ops" apply meant it ran its own catalog re-introspection and rename heuristics against the full live DB, and emitted destructive DDL that the diff engine had explicitly decided was not needed. The textarea→richText regression on rext-site-v2 / `test_verify_fix` surfaced this: both field types map to a `text` column on Postgres, so the diff produced zero column-level ops, but the slow path then attempted `DROP INDEX "single_pricings_pkey"` for an unrelated managed table, which Postgres rejects because a primary-key index cannot be dropped directly. Trusting our own diff for "no DDL is needed" closes that surface entirely.
  4. A safety net for the slow path (MySQL / SQLite, where the in-memory emitter does not apply, or any future op type that hasn't yet been added to the fast path). After `kit.pushSchema(...)` returns, the pipeline now inspects `pushResult.warnings`; when drizzle-kit declined any statement the apply throws a `PushSchemaError` carrying the warning text, so the journal correctly records a failed apply rather than a false success. Operators see the precise drizzle-kit message instead of an invisible silent skip, and the next apply will not re-detect the same phantom drift.

  Affected sites running on a published `0.0.2-alpha.0` … `0.0.2-alpha.16` still need a one-time `ALTER TABLE … ALTER COLUMN … SET DATA TYPE jsonb USING …` to relabel columns that were created as `text` during the silent-skip window; the fix prevents NEW drift but does not retroactively repair existing tables (running an Apply through the Builder after upgrading does the relabel automatically). Unit tests cover the three new emitter cases (including identifier-quoting through the `USING` clause), the routing-eligibility decisions for each (including the empty-ops case), and the safety-net throw path with a representative drizzle-kit warning payload.

- Updated dependencies [[`4d7b4f7`](https://github.com/nextlyhq/nextly/commit/4d7b4f76a4a697fd98b7f98e784179a3fe100c8f)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.17
  - @nextlyhq/adapter-mysql@0.0.2-alpha.17
  - @nextlyhq/adapter-postgres@0.0.2-alpha.17
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.17

## 0.0.2-alpha.16

### Patch Changes

- [#52](https://github.com/nextlyhq/nextly/pull/52) [`9bc10b6`](https://github.com/nextlyhq/nextly/commit/9bc10b6b548974a1e4c49ed4c9ec1e0902536f37) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix `update operation failed on table '<table>': value.toISOString is not a function` when saving a Single document or a component instance that includes a date field. JSON request bodies deliver date values as ISO strings (e.g. `"2026-05-20T12:22:29.417Z"`), but Drizzle binds `timestamp` columns by calling `.toISOString()` on the bound value -- so an unmodified string travelling through the adapter blows up at the driver layer. `CollectionMutationService` already coerced date strings into `Date` objects inline at every write site, but the equivalent step was missing from `SingleMutationService.update` and from `ComponentMutationService.serializeComponentRow` (which feeds every insert / update path in the component service via `buildInsertRow` and direct calls).

  A new `coerceDateFieldsToDate(data, fields)` helper in `shared/lib/field-transform.ts` mutates the row in place, converting string values for `field.type === "date"` columns into `Date` objects. Existing `Date`, `null`, and `undefined` values pass through untouched, so the function is idempotent and safe to call on rows that were coerced upstream. The signature accepts a structural `ReadonlyArray<{ name?: string; type?: string }>` so the same helper covers both `FieldConfig[]` (singles, components) and the runtime `FieldDefinition[]` (collections). The helper is wired into `single-mutation-service.update` before snake-casing the row and into `component-mutation-service.serializeComponentRow` before column mapping. The six inline copies of the same coercion block in `collection-mutation-service.ts` were collapsed onto the shared helper as part of the same change so there is one implementation across all three domains. Result: PATCH `/admin/api/singles/<slug>` with a `date` field, inserts / updates on components with date fields, and the existing collection flows that already worked all succeed against Postgres, MySQL, and SQLite. Unit tests cover the helper's coercion, idempotency, null / undefined pass-through, and no-touch behaviour for non-date fields.

- Updated dependencies [[`9bc10b6`](https://github.com/nextlyhq/nextly/commit/9bc10b6b548974a1e4c49ed4c9ec1e0902536f37)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.16
  - @nextlyhq/adapter-mysql@0.0.2-alpha.16
  - @nextlyhq/adapter-postgres@0.0.2-alpha.16
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.16

## 0.0.2-alpha.15

### Patch Changes

- [#51](https://github.com/nextlyhq/nextly/pull/51) [`ab23486`](https://github.com/nextlyhq/nextly/commit/ab234866888691751f6baa7738a854624f86dbbd) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix users created through the admin "Create user" page being unable to sign in, and clear up the misleading checkbox that caused the silent failure in the first place.

  The form's submit handler in `packages/admin/src/pages/dashboard/users/create.tsx` collected the "Active Account" checkbox value into `values.active` but never forwarded it to the API, so the backend always saw `isActive` as `undefined` and fell back to its default of `false`. `verify-credentials.ts` rejects inactive accounts at every login leg, so the newly-created user could authenticate with the right password and still see a generic "invalid credentials" error. The submit handler now sends `isActive: values.active ?? true`, matching the checkbox's documented "Default: Yes" UX. The backend default of `false` is intentionally preserved -- it is load-bearing for self-registration via `/auth/register`, where `auth-service.verifyEmail` is what flips `isActive` to `true` and gates login on proof of email ownership.

  The companion checkbox was also reworked. It was labeled "Send Welcome Email" with help text "Send an email with login credentials after account creation", but it actually sets `emailVerified: null` and dispatches a _verification_ email -- the user could not sign in until they clicked the link. Combined with the form's "Active: Yes" default, that meant the out-of-the-box "create user" flow promised immediate login but silently delivered the opposite. The form field is now named `requireEmailVerification`, the label is "Require Email Verification", the help text is honest about the verification gate, the default is unchecked (so the form's "Active + immediate login" promise holds end-to-end), the checkbox is disabled when the account is inactive (verification is meaningless for a disabled account), and an inline note surfaces when both flags are on so the admin understands login is still gated until the verification link is clicked. The wire shape is unchanged -- `requireEmailVerification` maps onto the historical `sendWelcomeEmail` field at submit time so existing API consumers keep working.

- Updated dependencies [[`ab23486`](https://github.com/nextlyhq/nextly/commit/ab234866888691751f6baa7738a854624f86dbbd)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.15
  - @nextlyhq/adapter-mysql@0.0.2-alpha.15
  - @nextlyhq/adapter-postgres@0.0.2-alpha.15
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.15

## 0.0.2-alpha.14

### Patch Changes

- [#49](https://github.com/nextlyhq/nextly/pull/49) [`ea7fbe5`](https://github.com/nextlyhq/nextly/commit/ea7fbe5d2b0071304db50a8da835a91dd90a94ed) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix two related admin-auth failures that surface on hosted databases (Neon, Supabase, PlanetScale, etc.) during transient DB hiccups.

  **Login/setup fluctuation.** The `getUserCount` dependency in the auth handler bridge used to swallow any DB error and return `0`, which made `GET /auth/setup-status` reply `{ isSetup: false }` whenever a pool cold-start, brief disconnect, or failover landed on this endpoint — the admin route guards then redirected the user to `/admin/setup`, the next call returned `{ isSetup: true }` once the DB recovered, and the guards redirected back to `/admin/login`, oscillating until the next hiccup or full page reload. The user count is the bootstrap-gate for two security-relevant decisions (setup-status reporting and the first-admin pre-check), and treating an unknown count as zero also opened a window where a transient DB failure during `POST /auth/setup` could allow a second super-admin to be created while the real first user was briefly invisible to the query. `getUserCount` now propagates errors; `handleSetupStatus` and `handleSetup` catch them, emit a canonical `503 SERVICE_UNAVAILABLE` envelope through the shared `buildAuthErrorResponse` helper (`application/problem+json` + `x-request-id`), and log a structured operator event (`setup-status-failed` / `setup-precheck-failed`). The admin's `PrivateRoute` and `PublicRoute` now consume a shared `lib/auth/setup-status.ts` module that fail-safes to "setup complete" on any failure (network error, 5xx, invalid response shape) — staying on the dashboard or login screen is recoverable on the next request, whereas dragging an authenticated user into the setup wizard is destructive. `useCurrentUserPermissions` is gated by `routeType === "private"` so its `refetchOnWindowFocus` cannot fire `/me/permissions` during a brief Suspense window on a public route.

  **Intermittent logout around the access-token TTL boundary.** The same swallow-and-return-null pattern lived in `findUserById`, which the refresh handler called after deleting the old refresh token. A momentary DB hiccup at the 15-minute boundary returned `null` from the lookup, the handler interpreted that as "user is gone" and ran `clearAndDeny` — clearing both auth cookies and revoking the still-valid session. `findUserById` now propagates errors; `handleRefresh` was reordered so all read-only lookups (`findUserById`, `fetchRoleIds`, `fetchCustomFields`) run BEFORE the destructive `deleteRefreshToken`, and is wrapped in a try/catch that returns `503 SERVICE_UNAVAILABLE` on any DB failure with cookies and tokens intact — the client retries on the next request and the session survives. The admin's `refreshAccessToken` was a boolean primitive that treated every non-200 response (5xx, network errors, our new 503) as "session invalid" and redirected to login; it now returns a tri-state (`ok` / `auth_failed` / `transient`) so `authFetch` only redirects on a genuine 401 from `/auth/refresh` and surfaces transient server errors to the caller without logging the user out.

  Internal: consolidated four identical `build{Login,Register,Forgot,Setup}ErrorResponse` helpers into a single `buildAuthErrorResponse` in `handler-utils.ts`, fixed a long-standing `change-password` test mock missing `auditLog`/`trustProxy`/`trustedProxyIps`, and added regression tests covering the 503 path on both setup endpoints, the refresh-handler 503 path (asserting no cookie clearing and no token deletion), and the "no super-admin is created when the pre-check throws" security invariant.

- Updated dependencies [[`ea7fbe5`](https://github.com/nextlyhq/nextly/commit/ea7fbe5d2b0071304db50a8da835a91dd90a94ed)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.14
  - @nextlyhq/adapter-mysql@0.0.2-alpha.14
  - @nextlyhq/adapter-postgres@0.0.2-alpha.14
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.14

## 0.0.2-alpha.13

### Patch Changes

- [#46](https://github.com/nextlyhq/nextly/pull/46) [`f943cb3`](https://github.com/nextlyhq/nextly/commit/f943cb32b94dffedf98a7e922f3c44338c042782) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Unified upload validation across both upload paths. `/api/media` now applies the same filename hygiene, extension blocklist, MIME allowlist, magic-byte sniff, and SVG sanitization that `/admin/api/collections/[slug]/uploads` already had — previously the global Media endpoint accepted any MIME type and any byte content up to 10MB with no sanitization. Validation logic is extracted into `services/upload-validation/`, both `UploadService` and `MediaService` call its `validateAndSanitizeUpload` entrypoint, and every validation failure now throws `NextlyError.validation` with a stable machine code (`FILENAME_INVALID`, `EXTENSION_BLOCKED`, `MIME_BLOCKED`, `MIME_NOT_ALLOWED`, `SIZE_EXCEEDED`, `MAGIC_BYTE_MISMATCH`, `SVG_SANITIZATION_FAILED`, `UNSUPPORTED_FOR_BACKEND`). The SVG sanitizer is tightened from `USE_PROFILES: { svg, svgFilters }` alone to explicit `FORBID_TAGS` (`foreignObject`, `animate*`, `image`, `iframe`, `object`, `embed`, `audio`, `video`, `source`, `track`, `style`) plus `FORBID_ATTR` (event handlers, `formaction`, `xlink:show`/`actuate`) and an `uponSanitizeAttribute` hook that strips any `href`/`xlink:href` whose value isn't fragment-only (`#id`). DOCTYPE declarations are stripped before sanitization to defang XML billion-laughs entity expansion, and a 2MB SVG-specific size cap is enforced separately from the general per-file limit. The magic-byte check closes a real polyglot bypass: claiming `image/svg+xml` with non-SVG bytes (or claiming a non-SVG type with XML bytes) is now rejected before the sanitizer runs.

  Breaking: `UploadService.upload()` now throws `NextlyError.validation` on validation failures instead of returning `{ success: false, errors, … }` — storage-layer 5xx failures still return the result-shape. `/api/media` rejects files outside the default MIME allowlist (override via `security.uploads.allowedMimeTypes` or `additionalMimeTypes`). SVG uploads with `<foreignObject>`, external `href`, animations, `<style>` blocks, or `data:` URIs will have those elements stripped — sanitized output may differ from input. `@nextlyhq/storage-vercel-blob` now supports SVG uploads (previously refused). The adapter returns Vercel Blob's `downloadUrl` (the file URL with `?download=1` appended) when the upload requests `contentDisposition: "attachment"`, so direct top-level navigation forces an attachment download while `<img src>` rendering remains unaffected. HTML uploads continue to be rejected with `NextlyError.validation` (code `UNSUPPORTED_FOR_BACKEND`, HTTP 415) — they're unsafe to host on a shared blob CDN regardless of disposition. `storage-local` cannot set per-file headers via Next.js static serving; sanitization still runs so stored bytes are safe, but self-hosters who want strict response headers should serve through a CDN with a response-header policy.

  A new structured event `nextly.upload.rejected` is emitted on every validation failure with `{ code, route, mimeType, filename, size }` so operators can alert on attack-pattern spikes (sudden bursts of `MAGIC_BYTE_MISMATCH` or `EXTENSION_BLOCKED` indicate polyglot probing).

  Build/dependency: the `pnpm.overrides` block now bumps `undici` to `^7` to fix a pre-existing latent runtime bug — `jsdom@28` (a transitive dep of `isomorphic-dompurify`) requires `undici@7+`'s `lib/handler/wrap-handler.js`, but the workspace was resolving `undici@6.25.0`. Any SVG upload through the existing pipeline would have crashed in production; no test exercised that path so it was undetected.

- Updated dependencies [[`f943cb3`](https://github.com/nextlyhq/nextly/commit/f943cb32b94dffedf98a7e922f3c44338c042782)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.13
  - @nextlyhq/adapter-mysql@0.0.2-alpha.13
  - @nextlyhq/adapter-postgres@0.0.2-alpha.13
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.13

## 0.0.2-alpha.12

### Patch Changes

- [#43](https://github.com/nextlyhq/nextly/pull/43) [`bbecc0d`](https://github.com/nextlyhq/nextly/commit/bbecc0d6eb91d751d49e5a4f892300d6928be015) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fresh projects scaffolded with `pnpm create nextly-app` no longer crash at boot under pnpm 10+. pnpm 10 blocks dependency install scripts by default, and without an allowlist `better-sqlite3` never built its native binding, so SQLite scaffolds threw `Could not locate the bindings file` on the first admin request. `sharp`, `esbuild`, and `unrs-resolver` were silently blocked too, producing a slow JS image fallback, drizzle-kit slowness, and an eslint resolver warning respectively. The scaffolder now emits `pnpm.onlyBuiltDependencies` in the generated `package.json`: `sharp`, `esbuild`, and `unrs-resolver` always, plus `better-sqlite3` when the SQLite adapter is selected. npm, yarn, and bun ignore the `pnpm`-namespaced field, so it is harmless under those package managers.

- Updated dependencies [[`bbecc0d`](https://github.com/nextlyhq/nextly/commit/bbecc0d6eb91d751d49e5a4f892300d6928be015)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.12
  - @nextlyhq/adapter-mysql@0.0.2-alpha.12
  - @nextlyhq/adapter-postgres@0.0.2-alpha.12
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.12

## 0.0.2-alpha.11

### Patch Changes

- [#41](https://github.com/nextlyhq/nextly/pull/41) [`50151bc`](https://github.com/nextlyhq/nextly/commit/50151bc2f056ab474010ebf1e8d62b5973b0554a) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix drizzle-kit rename TUI ("Is `dc_posts` table created or renamed from another table?") firing on SQLite and MySQL after the schema-apply scope-reduction landed. The scope-reduction filter iterated by managed-table names and stripped the static system tables that `buildDrizzleSchema` injects so drizzle-kit's diff recognises them. On SQLite/MySQL drizzle-kit ignores `tablesFilter`, so the missing system tables looked like drops, paired with the managed adds, and produced the rename TUI on every fresh-install boot — crashing Next.js's non-TTY server thread. The scope-reduction filter now preserves non-managed entries via `!isManagedTable(name)`, restoring the injection's intended effect on every dialect.

- Updated dependencies [[`50151bc`](https://github.com/nextlyhq/nextly/commit/50151bc2f056ab474010ebf1e8d62b5973b0554a)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.11
  - @nextlyhq/adapter-mysql@0.0.2-alpha.11
  - @nextlyhq/adapter-postgres@0.0.2-alpha.11
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.11

## 0.0.2-alpha.10

### Patch Changes

- [#38](https://github.com/nextlyhq/nextly/pull/38) [`04da3a7`](https://github.com/nextlyhq/nextly/commit/04da3a7fdcc7ec197f05bdd49c853ee92e39a4b5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix: variant URLs in populated `media.sizes[*].url` are now absolutized too. The initial absolutization pass only rewrote the top-level `url` and `thumbnailUrl` fields, so on SQLite — which stores `media.sizes` as TEXT and returns the column as an unparsed JSON string — clients consuming `getMediaVariant(media, "card")` on populated entries still received relative `/uploads/...` paths. `absolutizeMediaUrls` now normalises string-encoded sizes into an object before rewriting variant URLs, so populated media on entry responses returns reachable variant URLs across every dialect. Unparseable JSON resolves to `null` rather than leaking the raw string to the API consumer.

  Also: `toAbsoluteMediaUrl` and `absolutizeMediaUrls` resolve `baseUrl` lazily — the env-backed default fires only when a relative URL actually needs prefixing. Pass-through cases (absolute URLs, null/undefined/empty) no longer touch the env proxy, so the "absolute URLs unchanged" contract holds in contexts that have not booted env validation (isolated tests, bundler-time analysis).

- Updated dependencies [[`04da3a7`](https://github.com/nextlyhq/nextly/commit/04da3a7fdcc7ec197f05bdd49c853ee92e39a4b5)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.10
  - @nextlyhq/adapter-mysql@0.0.2-alpha.10
  - @nextlyhq/adapter-postgres@0.0.2-alpha.10
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.10

## 0.0.2-alpha.9

### Patch Changes

- [#36](https://github.com/nextlyhq/nextly/pull/36) [`10479d0`](https://github.com/nextlyhq/nextly/commit/10479d0a617759504c1f805170e4dae9dd65bced) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Media URLs returned from the API are now absolute. Previously, the local storage adapter wrote `/uploads/...` paths and surfaced them verbatim in API responses — mobile clients, edge workers, and any consumer without the deployment's origin baked in could not resolve the URL. Now, `MediaService` responses, populated `media` relations on entry responses, and the collection upload handlers (`POST` / `GET /admin/api/collections/<slug>/uploads`) prefix relative URLs with `NEXT_PUBLIC_APP_URL` (priority: `emailConfig.baseUrl` override > `NEXT_PUBLIC_APP_URL` > `http://localhost:3000` in dev). Cloud-adapter URLs (S3, Vercel Blob, R2) are already absolute and pass through unchanged. Consumers that previously concatenated the base URL themselves should drop the prefix — double-prefix detection is in place, but the new behaviour means the prefix is no longer needed. The env schema already requires `NEXT_PUBLIC_APP_URL` in production, so the localhost fallback is only reachable in development.

  Internal: extracted a shared `getBaseUrl(override?)` helper at `src/shared/lib/get-base-url.ts` so the email service and the new media-absolutization path resolve through one priority chain. `EmailService.getBaseUrl` and the new `getMediaBaseUrl` both delegate to it.

- Updated dependencies [[`10479d0`](https://github.com/nextlyhq/nextly/commit/10479d0a617759504c1f805170e4dae9dd65bced)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.9
  - @nextlyhq/adapter-mysql@0.0.2-alpha.9
  - @nextlyhq/adapter-postgres@0.0.2-alpha.9
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.9

## 0.0.2-alpha.8

### Patch Changes

- [#34](https://github.com/nextlyhq/nextly/pull/34) [`a5d2af6`](https://github.com/nextlyhq/nextly/commit/a5d2af6f065f8ba03da0e05a69e1b328339fa698) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix severe Builder slowness and connection-pool exhaustion when running Nextly against Neon Postgres, and complete the code-first column-delete workflow. Adapter now wires the provider's declared `statementTimeoutMs` into `pg.Pool` (Neon's 30s default was previously ignored, letting stuck queries pin pool slots forever) and bumps Node 20+'s 250 ms Happy Eyeballs per-address timeout floor to 5 s on first connect so transcontinental Neon endpoints stop surfacing `ETIMEDOUT` after exhausting every resolved address. `DB_POOL_MAX`/`MIN`/`IDLE_TIMEOUT`/`QUERY_TIMEOUT` env vars were always documented but never plumbed into the factory — they now flow through with per-field `??` fallback so each value can fall back to the adapter's dialect-specific defaults (notably the PG adapter's `min: 0` for Neon auto-suspend recovery). Boot/HMR drift-check now uses bounded concurrency (3 workers) instead of unbounded `Promise.all` that saturated a Neon pool of 5 with 10+ collections. HMR `serverComponentChanges` events get a 300 ms trailing debounce so editor burst-saves stop firing a full pipeline per save. A short-lived live-snapshot cache deduplicates the two `introspectLiveSnapshot` calls that previously fired during a single Builder apply, and a missing `instrumentation.ts` warning surfaces in dev to nudge users toward the single-worker warmup pattern. A new fast in-memory DDL emitter on PostgreSQL bypasses drizzle-kit's ~10 s catalog re-introspection for the common Builder op set (`add_column`, `add_table`), and even on the slow-path fallback the pushSchema call is now scoped to only the table(s) actually touched by the resolved ops rather than every managed table. `filterUnsafeStatements` also blocks orphan `DROP SEQUENCE` / `DROP INDEX` whose inferred owner table is not in the desired schema. A new diff-time default normaliser collapses Postgres's redundant `::<type>` cast suffix (e.g. `'draft'::character varying`) and lowercases `now()` so the diff stops emitting phantom `change_column_default` ops for every system column on every apply; a long-standing descriptor drift between `runtime-schema-generator` and `field-column-descriptor` (status `text` vs `varchar`, missing `now()` defaults on `created_at`/`updated_at`) is also fixed so the new fast path actually triggers in the real Builder flow. End-to-end on a real Neon instance: Builder Save HTTP timing drops from ~11 s to ~5 s and the in-pipeline schema apply drops from ~10 s to ~1.4 s. Code-first column deletes now flow through a new `destructive_drop` `ClassifierEvent` that the `ClackTerminalPromptDispatcher` renders as a `Drop "<column>" from "<table>"?` confirm in the dev terminal — removing a field from `nextly.config.ts` and saving prompts you to confirm before destroying data, matching Drizzle Kit's `push` UX; `NEXTLY_ALLOW_CODE_FIRST_DROPS=1` auto-confirms every drop without prompting for CI/non-interactive workflows. Finally, the API Playground response viewer no longer crashes with "Unrecognized extension value" — the admin bundle was loading two copies of `@codemirror/state` (6.5.3 + 6.6.0) which broke `instanceof Extension`; a `pnpm.overrides` pin forces a single resolution.

- Updated dependencies [[`a5d2af6`](https://github.com/nextlyhq/nextly/commit/a5d2af6f065f8ba03da0e05a69e1b328339fa698)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.8
  - @nextlyhq/adapter-mysql@0.0.2-alpha.8
  - @nextlyhq/adapter-postgres@0.0.2-alpha.8
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.8

## 0.0.2-alpha.7

### Patch Changes

- [#32](https://github.com/nextlyhq/nextly/pull/32) [`e41725d`](https://github.com/nextlyhq/nextly/commit/e41725d63a11255392bd5534f3b1f6d89d8276b4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal refactor: consolidate the `packages/nextly/src/services/auth/` shim layer. The shim was a directory of one-line `export *` re-exports left over from an earlier reorganisation; the canonical code already lived in `packages/nextly/src/domains/auth/services/`. The shim directory has been removed and 29 internal call sites have been pointed at the canonical location. A duplicate test suite of 13 files (mechanical-path-only drift, no logic divergence) has been deleted in favour of the existing copies under `domains/auth/__tests__/`. A new `@nextly/domains/*` TypeScript path alias is added to match the existing `@nextly/services/*` / `@nextly/auth/*` pattern. No public exports, runtime behaviour, or wire-format changes; this is shipped as a patch because every package version moves together in the alpha train.

- [#30](https://github.com/nextlyhq/nextly/pull/30) [`bd92f1b`](https://github.com/nextlyhq/nextly/commit/bd92f1b31df5efcc36da9458af4787fe2ed0f348) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `create-nextly-app` now prompts for a folder name when none is given on the command line. Previously, running `npx create-nextly-app` with no positional argument was silently treated as "install in the current directory" and then aborted with a `Directory not empty` error once the user finished the template and database prompts. The CLI now asks `What should your project be called?` with `my-nextly-app` pre-filled. You can accept the default with Enter, type any folder name, or type `.` (or `./`) to install in the current directory, matching the way the positional argument already worked. When the chosen target directory is non-empty the CLI now offers a three-option recovery prompt (cancel, remove existing files and continue, or ignore files and continue) instead of aborting outright. The `remove` option preserves any `.git` directory so existing history is kept.

  Note for scripted or CI use: the no-argument form is no longer equivalent to `npx create-nextly-app .`; it now opens an interactive prompt. If you were relying on the previous behavior in a non-interactive environment, pass `.` (or any folder name) explicitly.

- Updated dependencies [[`e41725d`](https://github.com/nextlyhq/nextly/commit/e41725d63a11255392bd5534f3b1f6d89d8276b4), [`bd92f1b`](https://github.com/nextlyhq/nextly/commit/bd92f1b31df5efcc36da9458af4787fe2ed0f348)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.7
  - @nextlyhq/adapter-mysql@0.0.2-alpha.7
  - @nextlyhq/adapter-postgres@0.0.2-alpha.7
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.7

## 0.0.2-alpha.6

### Patch Changes

- [#28](https://github.com/nextlyhq/nextly/pull/28) [`338b668`](https://github.com/nextlyhq/nextly/commit/338b6685d462fadca2030c27075452b3ecefc12e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `Cannot find package '@nextlyhq/plugin-form-builder'` on `pnpm dev` for blank scaffolds. The base admin page (`templates/base/src/app/admin/[[...params]]/page.tsx`) and the existing-project admin generator both hard-coded three side-effect imports for `@nextlyhq/plugin-form-builder`, but the package was only added to `package.json` on the fresh-scaffold npm path. Blank scaffolds and existing-project installs got the imports without the dep, so `next dev` failed at module resolution. The plugin is now opt-in per template: blank ships a plugin-less admin page; the blog template overlays a blog-specific admin page that re-adds the imports (mirroring how `formBuilderPlugin` is registered only in the blog config). `generatePackageJson` and the yalc paths in `installDependencies` accept a `projectType` and only include `@nextlyhq/plugin-form-builder` when the selected template uses it.

- Updated dependencies [[`338b668`](https://github.com/nextlyhq/nextly/commit/338b6685d462fadca2030c27075452b3ecefc12e)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.6
  - @nextlyhq/adapter-mysql@0.0.2-alpha.6
  - @nextlyhq/adapter-postgres@0.0.2-alpha.6
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.6

## 0.0.2-alpha.5

### Patch Changes

- [#26](https://github.com/nextlyhq/nextly/pull/26) [`fc88dc2`](https://github.com/nextlyhq/nextly/commit/fc88dc28206b212ffa20bbfac95e36bebaeabeb6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection mutation paths now resolve the physical table through `collection.tableName`, honoring `dbName` overrides instead of always deriving the name from the slug. The code-first boot sync detects when a collection's resolved `tableName` differs from the row in `dynamic_collections`, renames the physical table (Postgres/SQLite/MySQL quoted `ALTER TABLE ... RENAME TO`), writes the new name back, and invalidates the cached Drizzle schema in `CollectionFileManager` so the next request rebuilds against the renamed table — previously a `dbName` change left CRUD pointing at the stale table until a server restart. When both the old and new physical tables exist, the rename is skipped with a warn so the user can resolve the conflict manually. Component runtime-schema refresh after a UI-driven create/update/apply now flows through the DI `SchemaRegistry` (with a typed fallback to the adapter's `tableResolver` for non-DI paths) and surfaces failures as warnings instead of swallowing them in a silent try/catch — the prior behavior left `comp_*` queries selecting pre-rename column names until restart. Generated timestamp columns (`createdAt`, `updatedAt`) now emit `withTimezone: false` / plain `TIMESTAMP` for Postgres, aligning behavior across SQLite, MySQL, and Postgres.

- Updated dependencies [[`fc88dc2`](https://github.com/nextlyhq/nextly/commit/fc88dc28206b212ffa20bbfac95e36bebaeabeb6)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.5
  - @nextlyhq/adapter-mysql@0.0.2-alpha.5
  - @nextlyhq/adapter-postgres@0.0.2-alpha.5
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.5

## 0.0.2-alpha.4

### Patch Changes

- [#23](https://github.com/nextlyhq/nextly/pull/23) [`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix Single document fields appearing empty after a component-field rename. Schema-apply and external-schema-update handlers invalidated `["collections"]`, `["entries"]`, `["singles"]`, and `["components"]` — but Single document data lives under a separate `["single-documents"]` namespace (used by `useSingleDocument`), which was never invalidated. After a rename, `useSingleSchema` refetched with the new field name while `useSingleDocument` kept serving cached data keyed by the old name, so the form rendered `data[newName]` as `undefined` and the field appeared blank until a hard refresh. Collections were unaffected because `useEntry` lives under `["entries"]`, which was already in the invalidation list. The `["single-documents"]` key is now invalidated alongside the others. Also propagate the Draft/Published `status` flag through `buildFullDesiredSchema` for both collections and singles, mirroring the earlier preview-pipeline fix so the full-schema build path doesn't drop the column either.

- Updated dependencies [[`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.4
  - @nextlyhq/adapter-mysql@0.0.2-alpha.4
  - @nextlyhq/adapter-postgres@0.0.2-alpha.4
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.4

## 0.0.2-alpha.3

### Patch Changes

- [#19](https://github.com/nextlyhq/nextly/pull/19) [`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc) Thanks [@aqib-rx](https://github.com/aqib-rx)! - HTTP read endpoints now return entries/documents regardless of status by default. Previously, `GET /api/collections/<slug>/entries`, `GET /api/collections/<slug>/entries/<id>`, `GET /api/collections/<slug>/entries/count`, and `GET /api/singles/<slug>` defaulted to "published-only" and required `?status=all` to see drafts — confusing for the admin API Playground, which returned 404 for any status-enabled single or collection whose only document was still in draft. The new default is to return all records; pass `?status=published` (or `?status=draft`) to filter explicitly. The routes still require authentication, so this only affects callers that already have read permission.

- Updated dependencies [[`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.3
  - @nextlyhq/adapter-mysql@0.0.2-alpha.3
  - @nextlyhq/adapter-postgres@0.0.2-alpha.3
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.3

## 0.0.2-alpha.2

### Patch Changes

- [#17](https://github.com/nextlyhq/nextly/pull/17) [`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix UI Schema Builder silently dropping the Draft/Published `status` column when editing a collection or single. Saving a field change on a `status: true` entity used to surface a "Rename status → \<new field\>" option (selected by default) because `previewDesiredSchema` did not propagate the Draft/Published flag into the desired snapshot — confirming the dialog DROPped the column and every subsequent entry POST with `status: "published"` failed with `table dc_<slug> has no column named status`. The flag now flows through the preview/apply pipeline for both collections and singles, so the column survives edits.

- Updated dependencies [[`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.2
  - @nextlyhq/adapter-mysql@0.0.2-alpha.2
  - @nextlyhq/adapter-postgres@0.0.2-alpha.2
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.2

## 0.0.2-alpha.1

### Patch Changes

- [#13](https://github.com/nextlyhq/nextly/pull/13) [`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Iterative alpha bump: clean stale @nextly/ in adapter descriptions; contributor bootstrap fix; first OIDC-published release.

- Updated dependencies [[`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.1
  - @nextlyhq/adapter-mysql@0.0.2-alpha.1
  - @nextlyhq/adapter-postgres@0.0.2-alpha.1
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.1

## 0.0.2-alpha.0

### Patch Changes

- [#4](https://github.com/nextlyhq/nextly/pull/4) [`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Initial alpha release of Nextly — a TypeScript-first, Next.js-native CMS and app framework.

  All 12 packages publish at `0.0.2-alpha.0` in lockstep under the `alpha` dist-tag.

  **Highlights:**
  - **Core (`nextly`)** — REST + Direct API, RBAC, hooks, and the runtime engine. API key prefix is `nx_live_`.
  - **Admin (`@nextlyhq/admin`)** — Full-featured admin dashboard.
  - **UI (`@nextlyhq/ui`)** — Headless component primitives shared across packages and plugins.
  - **CLI (`create-nextly-app`)** — Project scaffolder with blog and blank templates, multi-DB picker, telemetry opt-out.
  - **Database adapters** — `@nextlyhq/adapter-postgres`, `@nextlyhq/adapter-mysql`, `@nextlyhq/adapter-sqlite`, plus the shared `@nextlyhq/adapter-drizzle` base.
  - **Storage adapters** — `@nextlyhq/storage-s3` (also R2 / MinIO / B2 / Wasabi), `@nextlyhq/storage-vercel-blob`, `@nextlyhq/storage-uploadthing`.
  - **Plugins (preview)** — `@nextlyhq/plugin-form-builder` for early exploration; public plugin APIs stabilize at the beta release.

  **Alpha caveats:** APIs may change before `1.0`. Pin exact versions in production.

  **Install:**

  ```bash
  pnpm create nextly-app@alpha my-app
  # or
  npx create-nextly-app@alpha my-app
  ```

- Updated dependencies [[`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.0
  - @nextlyhq/adapter-postgres@0.0.2-alpha.0
  - @nextlyhq/adapter-mysql@0.0.2-alpha.0
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.0
