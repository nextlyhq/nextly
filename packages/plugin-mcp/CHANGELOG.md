# @nextlyhq/plugin-mcp

## 0.0.2-alpha.70

### Patch Changes

- [#2728](https://github.com/nextlyhq/nextly/pull/2728) [`7138012`](https://github.com/nextlyhq/nextly/commit/71380124cdbf3b3bf0c2964a0fac3b27902a41ce) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Two refusals that aren't about permission now say why, and stay 403 `FORBIDDEN`.

  A change or delete of a collection, Single or component defined in code, made from anywhere but its code, reads "This collection is defined in code, so it can't be changed here." (or "deleted", or "Single", or "component"). An autosave where the collection or Single doesn't autosave reads "Autosave is turned off for this collection." (or "this Single"). Both used to read "You don't have permission to perform this action.", which sent people looking for a permission that wouldn't help.

  One status changes. The admin's schema routes checked the lock themselves and answered a thing defined in code with a 500 internal error: changing a Single's schema, previewing or applying a schema change to a collection, Single or component, and deleting a Single. They now answer 403 with the same sentence.

  Refusals for want of permission are unchanged: they never say which check refused.

- [#2734](https://github.com/nextlyhq/nextly/pull/2734) [`d5263f6`](https://github.com/nextlyhq/nextly/commit/d5263f6a8a54b8669e18b17d145c1f47600025c8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Creating a user with roles takes the super-admin lock before it writes the account, the same order as every other change to who is a super-admin. Run at the same moment as such a change, a role deletion for instance, it could otherwise deadlock on MySQL and fail with a retryable `409`.

- [#2751](https://github.com/nextlyhq/nextly/pull/2751) [`edceef5`](https://github.com/nextlyhq/nextly/commit/edceef5b8619ba45d221168598d2809d270a5dbe) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Security: an anonymous create, update or delete now needs a rule that allows it.** A
  checked write with no signed-in caller (the Direct API with `overrideAccess: false` and no
  `user`, or a plugin service call made `{ as: "public" }`, as a `public: true` route makes
  one) used to be allowed on a collection or Single whose `access` named no rule for that
  write. It is now refused. Reads keep the public default, publishing still needs a signed-in
  user, and the admin's REST API is unchanged.

  If you take anonymous writes on purpose, say so in the collection's `access`, for example a
  public form-like collection: `access: { create: () => true }`. The form builder's
  submissions already declare `create: true` and keep working.

  A plugin's `deleteEntryInTransaction` made `{ as: "system" }` is now trusted, as its other
  `{ as: "system" }` writes are; it was judged as an anonymous caller.

- [#2743](https://github.com/nextlyhq/nextly/pull/2743) [`dab8664`](https://github.com/nextlyhq/nextly/commit/dab86644383813c1685536bc28e157ebbc33e82b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's built-in emails (welcome, password reset, email verification) and the default layout's footer now meet WCAG AA contrast: the small print under each button is darker on the card, and the footer line and links paragraph are darker on the page. Installs that never edited these templates get the new colours on their next boot; an edited template keeps its own.

- [#2679](https://github.com/nextlyhq/nextly/pull/2679) [`869482c`](https://github.com/nextlyhq/nextly/commit/869482c1e1954ceacc2a3d01e32293c2433f626d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A code access rule now allows only by returning `true`. A rule that returns `null`, `undefined`, a string or any other value refuses, as `false` does, for every caller and at every way in. Before, a visitor was refused only by `false`, so `null` and `undefined` let one through, and a signed-in user was let in by any truthy value. Return `true` to allow.

  `ctx.caller.can` in a plugin route and `nextly.access.check` now return a boolean. Before, a rule's own answer could come back as it was, `null` or a string included.

  For this release, each request refused this way that a rule allowed before is logged once, naming the collection or Single, the action and the kind of caller, so a rule that relied on the old reading can be found and changed.

- [#2757](https://github.com/nextlyhq/nextly/pull/2757) [`6c7904f`](https://github.com/nextlyhq/nextly/commit/6c7904fb69712c1533808bba36b53e47e8e66bde) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A route handler's error now answers as that error on a host whose function bundle lacks part of `next/navigation`. Nextly loads Next's `unstable_rethrow` lazily, which file tracing cannot follow, and on such a bundle (seen on Vercel with Next 16.4.3) loading it failed for every error a handler caught: a signed-out caller's 401, for one, became a 500, so the admin stopped working for anyone signed out. Where it cannot be loaded, Nextly now makes the same check from the errors' digests, so `redirect()` and `notFound()` still pass through and every other error gets its own response.

- [#2750](https://github.com/nextlyhq/nextly/pull/2750) [`0eb828f`](https://github.com/nextlyhq/nextly/commit/0eb828f0536e250c74f90bae15680b414b93ba1a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - nextly's route handler, boot and role and user services no longer load the service registry or every core service just by being imported. They load them when they first register or build services, so a module that needs one service loads far fewer. The services barrel no longer re-exports the dispatcher; the root `nextly` entry exports the same names as before.

- [#2737](https://github.com/nextlyhq/nextly/pull/2737) [`ab13109`](https://github.com/nextlyhq/nextly/commit/ab13109fc0575745678f482dac04dd8c43e73d61) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Asking nextly's DI container for a service no longer loads every service registration. `getService` and `isServicesRegistered` read the container without importing the registry, so code that only looks services up loads far fewer modules. The root `nextly` entry exports the same names as before.

- Updated dependencies [[`7138012`](https://github.com/nextlyhq/nextly/commit/71380124cdbf3b3bf0c2964a0fac3b27902a41ce), [`d5263f6`](https://github.com/nextlyhq/nextly/commit/d5263f6a8a54b8669e18b17d145c1f47600025c8), [`edceef5`](https://github.com/nextlyhq/nextly/commit/edceef5b8619ba45d221168598d2809d270a5dbe), [`dab8664`](https://github.com/nextlyhq/nextly/commit/dab86644383813c1685536bc28e157ebbc33e82b), [`869482c`](https://github.com/nextlyhq/nextly/commit/869482c1e1954ceacc2a3d01e32293c2433f626d), [`6c7904f`](https://github.com/nextlyhq/nextly/commit/6c7904fb69712c1533808bba36b53e47e8e66bde), [`0eb828f`](https://github.com/nextlyhq/nextly/commit/0eb828f0536e250c74f90bae15680b414b93ba1a), [`ab13109`](https://github.com/nextlyhq/nextly/commit/ab13109fc0575745678f482dac04dd8c43e73d61)]:
  - nextly@0.0.2-alpha.70
  - @nextlyhq/plugin-sdk@0.0.2-alpha.70

## 0.0.2-alpha.69

### Patch Changes

- [#2365](https://github.com/nextlyhq/nextly/pull/2365) [`6093742`](https://github.com/nextlyhq/nextly/commit/6093742e0971d0c0f00251cd9c6b47e640946259) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A batch save that cannot record its history now keeps the versions it would have pruned. When the history table is missing (an install not yet migrated), a batch update with `stopOnError: false` no longer commits a held edit or removes older versions with no record of it: the whole batch rolls back.

- [#2581](https://github.com/nextlyhq/nextly/pull/2581) [`a0d926a`](https://github.com/nextlyhq/nextly/commit/a0d926ab9cc9b78b9683492e10f00974e88c72e9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A card's settings sheet keeps a change where the reader is, shows the card beside the form, and reopens on what is stored after Cancel.
  - **Done** while customising holds the change with the dashboard's other unsaved changes and closes the sheet. At rest it saves the change at once: the sheet stays open while saving, closes when the save lands, and says why in place when it does not.
  - **A live preview** draws the card as the form's values would, with the dashboard's own renderer, beside the form on a wide screen and above it on a narrow one. A change that alters what the card asks, such as its number of rows, is asked once for the preview alone after the values settle. The card keeps its own answer until Done.
  - **Cancel** now discards the change. The sheet used to reopen on the value the reader cancelled, although nothing had been saved: the form was given the sheet's own starting values rather than a copy, and wrote into them.
  - **A quick setting** whose new answer the card could not load is announced as saved, with the card still showing its earlier data, rather than not announced at all.

- [#2375](https://github.com/nextlyhq/nextly/pull/2375) [`eb09f42`](https://github.com/nextlyhq/nextly/commit/eb09f42e9e5a1a29933ea355250cbacd16690ede) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An API key is refused while the person who created it is deactivated, and
  works again once they are reactivated. The instance that deactivates the
  person refuses the key at once, and every other instance within ten seconds,
  the bound that already applies to that person's sessions. An administrator
  setting the person's password does not stop their keys.

- [#2660](https://github.com/nextlyhq/nextly/pull/2660) [`792d1d5`](https://github.com/nextlyhq/nextly/commit/792d1d5fcdaf7ad18459e975905e4f027c7a42c3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A declared widget's card is now held to what its display draws for the card's own settings, not only the starting ones, so a query function that writes a different operation for a setting a reader chose fails that card alone rather than drawing an answer it misreads. And the read decisions a declared widget's data function needs, for collections the batch did not name in advance, now take the same bounded turns as the rest of the batch's, instead of starting all at once.

- [#2630](https://github.com/nextlyhq/nextly/pull/2630) [`351231c`](https://github.com/nextlyhq/nextly/commit/351231c3c53a3eee71aacb871f5378fe40c4e6f4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget declared with `defineWidget` and drawn by a core display (`metric`, `list`, `table` and the others) now has its cards answered on the server, as the person asking, and drawn in the admin, in the widget's own words when it has nothing to show. A widget drawn by its own component (`display: { component }`) is checked at startup but not offered yet: the admin does not yet hand a component the props its declaration types, and development says so once per widget.
  - **A card is asked for by its id**, and core builds its data from the widget's declaration: its `data` function run with the card's settings, the person and the batch's one instant, or its query written from the settings. Only a card the reader was handed is answered; every other card gets the one "unavailable" answer. While the dashboard is being customised, a card is asked with the settings it is drawn with.
  - **Reads are the person's.** A data function's `services.count` and `services.find` read as the person asking, through the same check a card's own query passes, and read nothing once the card has given up. Options a plain JavaScript caller passes beside them (`user`, `as`, `overrideAccess`) are never read.
  - **`WidgetDataInput` gains `now`** (`@experimental`): the batch's one instant, so every card asking for the last 30 days asks for the same days. `ResolverOptions` gains the same `now` (`@experimental`).
  - **`WidgetResult` gains `{ op: "data", data }`**, a declared widget's own data for its own component, and a slot may carry `empty: true`, the verdict of the widget's declared empty test. The admin then draws the declared empty message and action, whose link is only ever a path under the admin.
  - **Definitions gain `serverData`, `allowedWidths`, `defaultWidth`, `allowsSeveral`, `sketch` and `empty`.** Core publishes these for a declared widget. `registerWidget` refuses `serverData`, and an empty state's action is withheld from a reader without its permission.
  - **Default dashboards** never place a declared widget; it is offered in the add panel instead.

- [#2349](https://github.com/nextlyhq/nextly/pull/2349) [`e2afec9`](https://github.com/nextlyhq/nextly/commit/e2afec941dd8a984e06d0ab2e52feb070c50b699) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting media no longer removes a file another media item still refers to, however the other item refers to it: as its original, through one of its image sizes, as its thumbnail, or under another spelling of the same path. Two items can share a stored file after an import that copies a record, or on a storage adapter that keys files by their content. A crop keeps such files too, including when its write fails.
  - When the database cannot be read to check this, nothing is removed and the delete or crop still succeeds; the log names the item whose files were left.
  - Failure logs from media cleanup no longer show credential query parameters (`X-Amz-Credential=…`, `token=…`) wherever they appear in a storage error, nor URLs written without a scheme.

- [#2379](https://github.com/nextlyhq/nextly/pull/2379) [`077631c`](https://github.com/nextlyhq/nextly/commit/077631c22da693101a81a003d9b2b2c337ca17e3) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Deleting a staff user now erases every email delivery record that names them, under every address they used, and any record written for them afterwards is written erased. Another person at the same address keeps their records.

- [#2665](https://github.com/nextlyhq/nextly/pull/2665) [`931faf8`](https://github.com/nextlyhq/nextly/commit/931faf87dd200e35a28621d7cbfbcae3621a4daa) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A chart's dismissed tooltip stays dismissed until the pointer moves. Escape hides a hovered tooltip on a dashboard chart, but the bar under a pointer that had not moved could bring a tooltip straight back, because hiding the tooltip uncovered that bar and the browser reported it as entered. Now only a move of the pointer, or of the keyboard's point, shows a tooltip again.

- [#2451](https://github.com/nextlyhq/nextly/pull/2451) [`1462411`](https://github.com/nextlyhq/nextly/commit/1462411ac6e5e7a212f08fadf3916d9571ec952e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An email the provider fails or refuses now says whether sending it again can
  help: `nextly.email` and a plugin's `ctx.services.email` return `failure` with `retryable`, the provider's status where it gave one, and a
  short reason, and list any recipients the provider refused. A send refused before
  any provider is reached (a bad recipient, a provider named but not found, a missing template) still
  throws, as before. Form Builder logs a
  notification that was not sent as failed instead of sent, and no longer writes
  recipient addresses into its logs.

- [#2364](https://github.com/nextlyhq/nextly/pull/2364) [`9b80400`](https://github.com/nextlyhq/nextly/commit/9b80400d8d2c6be833a58321b0c9dceb4b92c942) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Several processes starting Nextly against one fresh database at once, as `next build`'s workers and a fleet of instances do, now seed each default row once without reporting the ones another process wrote first. The process that lost the race used to log the duplicate as a warning or an error with a stack trace (an email template, a role preset, a plugin's role), report the whole permission step as failed and skip the plugin roles that wait for it, or fail its sync of the code-defined user fields. A row another process wrote is now taken as seeded and logged at debug; any other failure is still reported as before. The same holds for a Single's default document, which its first read creates: concurrent first reads, such as a fresh build's pages, used to fail every read but one with a `UNIQUE constraint failed` error logged at error level, and each now gets the one document that was stored. On PostgreSQL and SQLite, a permission another process created at the same moment was also reported as created under an id that was never stored, so a grant made for it could point at no permission: the permission is now read back and reported as found.

- [#2467](https://github.com/nextlyhq/nextly/pull/2467) [`8755798`](https://github.com/nextlyhq/nextly/commit/8755798b874ef429603dd8f3f25f33965b7cb023) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A send can now carry an `idempotencyKey`, and the email then goes out once on
  every provider: on `nextly.email.send` and `sendWithTemplate`, the same two on a
  plugin's `ctx.services.email`. A repeat of a send
  that succeeded returns its result with `repeat: true` and sends nothing; a
  repeat after a failure sends again; the same key with a different message is
  refused. Keys are scoped to their caller, so two plugins never share one, and
  Resend is also handed a key derived from the caller's.

  Nextly stores a keyed digest of each key in a new `email_send_claims` table and
  a new `key_digest` column of `email_deliveries`, never the key or an address,
  and erasing a person clears the digest from every record of their sends.
  `nextly migrate` and boot add both on all three databases, and rewrite no row.
  Sends without a key are unchanged.

- [#2441](https://github.com/nextlyhq/nextly/pull/2441) [`9937cc5`](https://github.com/nextlyhq/nextly/commit/9937cc57ff633689753cfbfbf9158f8528e728e6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A document-lock claim is now judged as an update of that document is. Claiming or renewing a lock asks the same question a REST update of the document asks, so an API key must hold the update grant and pass the collection's or Single's own `update` rule. Releasing a claim still needs the grant alone, since its claim token fences it. Sessions are judged as before.

- [#2458](https://github.com/nextlyhq/nextly/pull/2458) [`253cd89`](https://github.com/nextlyhq/nextly/commit/253cd8963766b2fa023e3ed0445fec966e7f7f19) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A column narrowed to `varchar(N)` is judged by the values it holds, and `nextly migrate` runs in strict mode on MySQL.

  On MySQL, Single and field-group tables made before their tables came from the schema pipeline hold a `text` field as `TEXT`, where the schema declares `VARCHAR(255)`. Every `db:sync` and dev reload asked to narrow them in a terminal, and failed without one.
  - `db:sync`, the dev reload and an admin schema save now count the stored values longer than N before narrowing a string column to `varchar(N)`. When there are none, the change loses nothing and applies without a prompt. When there are some, the apply stops before any DDL and names the table, the column and the number of rows; shorten those values, or give the field a type that holds them, and apply again.
  - `nextly migrate`, `migrate:down`, `migrate:resolve` and plugin migrations run each migration not marked `-- nextly:no-transaction` on MySQL with `STRICT_ALL_TABLES` added to the session's mode, and puts the session's mode back afterwards. A file that would cut a value short — such as the `MODIFY COLUMN … varchar(255)` that `migrate:create` writes after `migrate:baseline` adopts one of these tables — now fails with "Data too long" at that statement, which changes nothing (schema statements before it in the same file stay applied, as MySQL commits them), where a server without strict mode used to truncate the value with only a warning. A hand-written migration that relied on MySQL's non-strict coercion now fails the same way.
  - The MySQL adapter's `transaction()` takes a new `strictSqlMode` option, which does this for any transaction. PostgreSQL and SQLite ignore it.

- [#2371](https://github.com/nextlyhq/nextly/pull/2371) [`d986b28`](https://github.com/nextlyhq/nextly/commit/d986b28b02bb07481ca8bb995cdc3fe268443866) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A past version now reads in the editor's own layout with its changes marked. One comparison bar above it says which version is shown, what it is compared with (the version before it in its language) and how many fields changed, with Previous and Next change. Each changed field is marked with what changed; unchanged fields fold behind "Show N unchanged fields". While a version is shown, Back to current and Restore… replace Save and Publish in the title bar, and on a phone they sit in a bar at the bottom. The banner above a past version is gone.

  The admin's unused localStorage autosave and draft recovery (`useAutoSave`, `useDraftRecovery`, `DraftRecoveryDialog`) are removed. Nothing called them since autosave moved to the server, and none was exported from the package.

- [#2384](https://github.com/nextlyhq/nextly/pull/2384) [`92852f7`](https://github.com/nextlyhq/nextly/commit/92852f70d1a3d4556138f062a158a4341932e3c4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A person's standing is read again as soon as the change that deactivates
  them, or sets their password, commits, however long that change's
  transaction stays open, on every database.

- [#2272](https://github.com/nextlyhq/nextly/pull/2272) [`ab73264`](https://github.com/nextlyhq/nextly/commit/ab73264679dcc9c00017247f7984cec5c605ff97) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A project gets the release of Nextly its create-nextly-app belongs to.
  - A new project declares `nextly` and every `@nextlyhq/*` package at exactly the CLI's version, from any template, so the templates, the agent guide and the skills match what is installed. npm's `latest` tag no longer decides anything, and the registry is not asked.
  - The blog template is downloaded at the CLI's own release tag instead of `main`. If GitHub has no template for that release, the run stops and names `--branch`; if GitHub cannot be reached, it names `--local-template`. A branch name with a `/` now downloads too.
  - Adding Nextly to an existing app installs its packages at exactly that version, recorded exactly, after the packages they require alongside them, so pnpm with strict peers accepts the install. An app that already has a Nextly package at another version stops before anything is written or installed, and is told what to set: one declared as a range or at another version in any dependency field, or one it loads at another version, from its own `node_modules` or a workspace folder above it.
  - `--branch` no longer defaults to `main`: given, it takes the template from that branch, and the packages from the `alpha` tag, as `--local-template` does. `--use-yalc` still links local builds.

  A project made before this release is not changed by it, and keeps the versions it declares. Before adding Nextly to an existing app, set every Nextly package it has to exactly the CLI's version.

- [#2433](https://github.com/nextlyhq/nextly/pull/2433) [`f74d122`](https://github.com/nextlyhq/nextly/commit/f74d12202f34bc09699f02263f0b5dd0a7635962) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A new project created outside a workspace records the pnpm or Yarn version that created it as `packageManager`, so Corepack installs with that version instead of its own default.
  Adding Nextly to an existing app records it too, but only when the app chooses no package manager yet and isn't part of a workspace.

- [#2550](https://github.com/nextlyhq/nextly/pull/2550) [`8c4d300`](https://github.com/nextlyhq/nextly/commit/8c4d300d6c879b31386631d6cc170126d2b97fe0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Publishing or unpublishing every language of a collection entry now clears its cached pages even when the request fails after the change is saved, and is reported saved only once a transaction around it has committed.

- [#2707](https://github.com/nextlyhq/nextly/pull/2707) [`5352b69`](https://github.com/nextlyhq/nextly/commit/5352b69f053346997f73e5002b3059c1b3048199) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A refusal now says what was refused, in the site's own words.

  A refused request's `error.message` names the action and the thing as the site names them: "You can't edit this post.", "You can't create posts.", "You can't edit Site Settings.", "You can't see API keys." The thing is a collection's label (one entry of it where the request names one), a Single's label, or a system resource in words. It never names a permission as stored (`update-posts`), a role, a rule or which check refused, and never repeats a slug the site does not know, so a URL cannot make a refusal echo it. The REST route gate, the Direct API, plugin services and the routes built on them answer this way.

  Which check refused, and on what grant, is logged on the server at `info` (`[nextly] Refused a request`, with the reason and the request id the caller was answered with), and never sent.

  A request that is not signed in, or whose session has expired, or whose API key is not valid, is answered "Authentication required." in every case; the code still tells an expired session (`TOKEN_EXPIRED`) apart, so the admin refreshes it as before.

  One status changes. The standalone route handlers exported from `nextly/api/*` now answer a request presenting an API key while the key service is unavailable with 503 `SERVICE_UNAVAILABLE`, as the main REST handler already did; they answered 403. Every other refusal keeps its status.

  A client that matched the old wording ("You do not have permission to …", "Access denied: …") reads `error.code` instead, which is unchanged.

- [#2285](https://github.com/nextlyhq/nextly/pull/2285) [`6f2d0bd`](https://github.com/nextlyhq/nextly/commit/6f2d0bd90c2b5d2aaee5e1c95375deb28b0350d3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Add a calendar read for releases. `GET /api/releases/calendar` and
  `nextly.releases.calendar()` take a window of days (`from` and `to`, at most
  six weeks) in a named time zone and answer every day of it with the complete
  count of its releases by state and its first three releases in time order, so
  a calendar's "+N more" is always true. Days follow the zone's own clock,
  daylight saving included: a release at 23:30 in New York is on the next day in
  London. The list gains a day filter (`day` and `timezone` over REST,
  `day: { date, timezone }` from the Direct API) that returns one such day in
  full, paged, in the same order. A published release is on the day it went out,
  any other release on the day of its scheduled time. Both are experimental.

  The releases table gains two indexes, on `scheduled_at` and on `published_at`,
  which the calendar and the day filter read by. `nextly migrate` adds them to
  an existing database. Index only, no data change.

- [#2562](https://github.com/nextlyhq/nextly/pull/2562) [`7183036`](https://github.com/nextlyhq/nextly/commit/718303681cf811dbf54044abf46dfb40a172c716) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A renamed collection or Single keeps its history, who may use it and where its webhooks go: its versions, pins, "last looked at" markers, content events, release membership and each release's history of its documents, schema events, activity, archived translations, permissions (with every role's grants of them), live webhook filters, webhook events not yet sent and the webhook recording choice move to the new slug in the same transaction as the rename, instead of staying behind for the next entity under the old slug. A renamed Single's document reads its new slug, and content cached under either slug is refreshed. A rename onto a slug that still holds an earlier entity's records, or onto one longer than 50 characters, is refused, and document locks, preview links and kept permission answers end with the old slug, as do any an earlier entity left under the new one.

- [#2443](https://github.com/nextlyhq/nextly/pull/2443) [`30d4944`](https://github.com/nextlyhq/nextly/commit/30d494491d61cd52fd1c6afe4b0f3755de220ff1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A request now waits a bounded time for a database connection on every dialect, and past the bound fails instead of waiting without end, as "database busy" where the error reaches the request boundary (see "Where it shows" below).
  - **The setting:** `pool.connectionTimeoutMs`, default 15 seconds (20 on Neon, from the PostgreSQL adapter's provider defaults), with the same meaning on PostgreSQL, MySQL and SQLite. `0` waits without limit.
  - **Where it shows:** route handlers, server actions, sign-in and the REST dispatcher answer `DATABASE_BUSY`. Collection and Single entry reads and writes answer `DATABASE_BUSY` too. A few entry paths still answer 500 `INTERNAL_ERROR` when it is busy: publishing every language of a Single, duplicating an entry, and a read whose locale, component or media step is the one that waits.
  - **The error:** `DATABASE_BUSY`, status 503, with `data.retryAfterSeconds` of 5 and a `Retry-After: 5` header on REST. The statement or transaction that waited did not run. Anything the request committed before it stays committed, so a request that writes in several steps is safe to repeat only where those steps are. A collection or Single write, or a registration, that committed and then hit a busy database in a later step answers that the change was saved, without a retry hint.
  - **PostgreSQL:** the timing is unchanged; the pool already gave up after 15 seconds. What changes is the answer: it was a 500 `INTERNAL_ERROR`, and is now `DATABASE_BUSY`.
  - **MySQL (behaviour change):** a request that found every connection in use used to wait in mysql2's queue without limit. It now fails after `pool.connectionTimeoutMs`, unless you raise it. The time a new connection gets to open (`connectTimeout`) also moves from 10 to 15 seconds, so it matches PostgreSQL; a connection that cannot open in time is still a connection error, not `DATABASE_BUSY`.
  - **SQLite:** a transaction waits at most `pool.connectionTimeoutMs` for the one connection behind the transactions ahead of it. A write blocked by another process holding the database file past `busyTimeout` (`SQLITE_BUSY`) is now `DATABASE_BUSY` too, where it was a 409 `CONFLICT`. `SQLITE_LOCKED` stays a `CONFLICT`.
  - **Retry-After:** it is now set for any error carrying `data.retryAfterSeconds`, not only `RATE_LIMITED`.
  - **For adapter authors:** the adapters raise the busy error with the code `NEXTLY_POOL_WAIT_TIMEOUT`, exported from `@nextlyhq/adapter-drizzle/types` as `POOL_WAIT_TIMEOUT_CODE`, with `poolWaitTimeoutError()` to raise it.

  See [When the database is busy](https://nextlyhq.com/docs/guides/deployment#when-the-database-is-busy) in the production guide.

- [#2107](https://github.com/nextlyhq/nextly/pull/2107) [`1b96481`](https://github.com/nextlyhq/nextly/commit/1b96481ecaed98c780a26c0134acf515af7d3fe4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Password-reset and email-verification links now act only on the account they
  were issued for, and only while it still holds the address they were sent to.
  Each link records its account (a new `user_id` column on
  `password_reset_tokens` and `email_verification_tokens`, with a foreign key to
  `users`). Changing an account's address revokes its links, so one sent to the
  old address stays dead even after the account moves back. Deleting an account
  removes its links, whatever address they went to. Someone later given an
  address is never reset or verified by a link sent to an earlier holder.

  Issuing a link, following one, changing an address and deleting an account
  each hold the account's row for their transaction, so a link issued or
  followed while the account moves or is deleted is either revoked afterwards
  or refused. Following a link now checks it, applies it and spends it in one
  transaction, so two redemptions of one reset link cannot both set a password.

  `nextly migrate` adds the column and removes every outstanding password reset
  link: a reset link may have been given any lifetime, and its stored times
  cannot show reliably when it was issued. It ties each outstanding email
  verification link to the account holding its address when that account was
  created and last changed before the link was issued, so those links keep
  working. A verification link whose account was created or changed at or after the
  time it was issued (on MySQL and SQLite, which store whole seconds, also in the
  same second) is removed, since it may have been sent to an
  earlier holder of the address, and so are expired links and links to an
  address no account holds. Their owners request a new link.

- [#2403](https://github.com/nextlyhq/nextly/pull/2403) [`2f498a6`](https://github.com/nextlyhq/nextly/commit/2f498a64fd2efab509ebb433e566fe8ff4e881dd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Editing a role (its name, its permissions or its child roles) works on SQLite. The edit ran in a transaction the SQLite driver refuses for asynchronous work, so it failed there with a server error before changing anything, while PostgreSQL and MySQL were unaffected.

- [#2496](https://github.com/nextlyhq/nextly/pull/2496) [`837c7b1`](https://github.com/nextlyhq/nextly/commit/837c7b149a3eb0c50db1a451521b1ec54293d54f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A collection or Single write, or a registration, that saved and then failed answers that the change was saved, without a retry hint, and the admin retries a failed write only when the server refused it before running it, so a saved change is no longer made twice.

- [#2594](https://github.com/nextlyhq/nextly/pull/2594) [`1ebd31b`](https://github.com/nextlyhq/nextly/commit/1ebd31b8ae3f25cbd15ca53d160699ccbd6646b4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Looking up a collection's schema no longer writes to the console. Every query against a collection resolved its schema through a lookup that logged three lines, one of them the name of every registered collection, so a busy app wrote thousands of identical lines to its server log per burst of requests. A lookup that has to build the schema, or finds none, still logs as before.

- [#2288](https://github.com/nextlyhq/nextly/pull/2288) [`934cef1`](https://github.com/nextlyhq/nextly/commit/934cef1fe8534e89c6222e1b0734d21ccd1147af) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Unsaved work gets a recovery point after a slow save. A save slower than the
  autosave debounce let the edit's recording fire while recording was off, where
  it was refused, and nothing asked again; when recording comes back on and the
  editor still holds unsaved changes, a recording is now asked for again.

- [#2359](https://github.com/nextlyhq/nextly/pull/2359) [`ea23a3b`](https://github.com/nextlyhq/nextly/commit/ea23a3b46f007185ffdbc23d04df772a173876f9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A value a unique custom user field already holds for another user is now refused with a conflict (`DUPLICATE`), when creating or updating a user, and a refused update changes nothing: the account's other fields, its roles and its custom fields are written together or not at all. Before, creating such a user took the refusal for a missing table: it created the user without any custom fields and stopped writing custom fields for the rest of the process, and an update logged it and carried on. On MySQL, a unique field of a plugin type stored as text with no `maxLength` is now a `VARCHAR(255)` column carrying its unique index, as a built-in text field is, rather than a TEXT column (which MySQL cannot index without a key length) that stopped `nextly migrate`. A value longer than such a column holds is refused, naming the field, before it is written: before, it failed at the database and was taken for a missing table. An install where that column is already TEXT keeps it, with every value whole: `nextly migrate` stops, naming the field, until the column is changed to `VARCHAR(255)` or `unique` is removed. A plugin type stored as long text or JSON cannot be unique: the config is refused at the field, as a textarea's is, including when the plugin declaring the type is in the same config.

- [#2681](https://github.com/nextlyhq/nextly/pull/2681) [`b26f715`](https://github.com/nextlyhq/nextly/commit/b26f715539d18e513c28923d53771c4a12f43034) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A user's roles and permissions are now read once and kept in memory until a role or permission changes, in place of the separate per-answer caches. Every change that affects access retires what was kept, in every instance sharing the database, so the next request reads afresh: editing a role's permissions, assigning or removing a role, changing role inheritance, deleting a role, deactivating or deleting a user, and a role assignment expiring. A request that asks about a user again reads only the role version, and a request that asks several permissions reads the user's roles once.

  Permission answers are no longer stored in the `user_permission_cache` table, and the `userPermissionCache` schema export is deprecated; the table is removed in a later release. `PERMISSION_CACHE_ENABLED`, `PERMISSION_CACHE_TTL_SECONDS` and `PERMISSION_CACHE_MEMORY_SIZE` no longer change how access is cached, and a warning says so when one is set. `PERMISSION_CACHE_ENABLED=false` still tells Nextly that no instance reads the stored answers, so they are not emptied when access changes.

- [#2429](https://github.com/nextlyhq/nextly/pull/2429) [`7afab03`](https://github.com/nextlyhq/nextly/commit/7afab0353cf4d198f9c439904118904fa57f6ba4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Direct API call made as a user (`overrideAccess: false`), a plugin service call made `as: "user"`, and a page render now each look up the caller's roles and permissions once, however many rows, field rules and permission checks they read. That covers every Direct API method and namespace method, and both collection and Single routes, including the reads their `render` and `buildMetadata` make. A 50-entry list read through the Direct API or a plugin service costs the same access queries as a 1-entry list. A call made inside a request shares that request's lookups.

- [#2420](https://github.com/nextlyhq/nextly/pull/2420) [`fa80fb9`](https://github.com/nextlyhq/nextly/commit/fa80fb930a1663ddd6ba6b109a30351f85fea39f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A request now looks up its caller's roles, permissions and super-admin authority once, however many gates, rules and rows ask about them. A list read whose collection has field-level read rules no longer repeats those lookups for every row it returns; a 50-entry list costs the same access queries as a 1-entry list. Any role or permission change the request makes is seen by its later checks. Work outside a request, such as a job, looks the caller up as before.

- [#2471](https://github.com/nextlyhq/nextly/pull/2471) [`6b5d7e1`](https://github.com/nextlyhq/nextly/commit/6b5d7e14c10499002a7fe6fab1c72a86b3efa668) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every access rule may be `true`, `false` or a function: a collection's `create`, `read`, `update`, `delete`, `publish` and `unpublish`; a Single's `read`, `update`, `publish` and `unpublish`; and a field's `create`, `read` and `update`, in a collection, a Single or a field group. On a collection's or a Single's own fields, a field rule written as `false` now withholds the field from every checked read, and keeps it from being written by a checked write, like a function returning `false`. A checked call is one made with `overrideAccess: false`, as every REST and admin request is. Trusted server code, the Direct API's default `overrideAccess: true`, skips field rules, whether they are written as booleans or as functions.

  **Breaking at startup:** an `access` key that its kind doesn't have now stops an app from starting when the collection, Single or field group is defined with `defineCollection`, `defineSingle` or `defineFieldGroup`, and fails `nextly build`. Entities written as plain objects, and those the Schema Builder stores, are not checked. Before, such a key was accepted in silence and governed nothing: the operation it meant to rule fell back to stored permissions.

  The keys each kind accepts:
  - A collection: `create`, `read`, `update`, `delete`, `publish`, `unpublish`.
  - A Single: `read`, `update`, `publish`, `unpublish`. A Single has no `create` or `delete`, so a Single carrying either now fails.
  - A field, in a collection, a Single or a field group: `create`, `read`, `update`.

  Any other key, such as a misspelt `reed` or a Single's `delete`, is refused when the collection, Single or field group is defined, with `ACCESS_KEY_UNKNOWN` naming the key, where it sits, and the keys that kind accepts. To fix it, remove the key, or correct its spelling if it was meant to be one of the keys above. A field's `access` must also be an object whose rules are functions or booleans; any other value is refused at definition in the same way.

- [#2456](https://github.com/nextlyhq/nextly/pull/2456) [`73498e1`](https://github.com/nextlyhq/nextly/commit/73498e184a7b8511c2d8176b86367d29d0a7bd4f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every access rule is told the languages it judges.

  A collection's, a Single's and a field's rule now get `locale`, the one
  language the operation is in, and `locales`, every language it involves:
  - a read or a write in one language gets that language; a read with an
    unknown or missing `?locale=` is judged as the default it resolves to, and
    a write naming an unknown language is judged as the default and then
    refused with 400; a read's
    `locales` also lists each language a missing value falls back to, in the
    order it tries them; a bulk or transactional create or update writes the
    default language, and gets it; a duplicate gets the default language and
    each it falls back to, since it copies what a read of the source shows;
  - a read that also reads each language's translation state
    (`?translation-status=1`, or a `_translated` filter) gets every configured
    language, keeping its own as `locale`, and so does an autosave, or a
    working-draft discard, naming a language the site does not configure; a
    bulk update by query, whose filter may choose rows by any language, gets
    every configured language too;
  - a read of every translation (`locale=all`), a write to every language
    (`locale=*`), and an operation on the whole entry (a delete, a bulk
    delete, publishing or unpublishing every language, a release)
    get every configured language, with no single `locale`;
  - content a collection or Single stores the same in every language (it is
    not localized and has no localized field group) gets every configured
    language, with no single `locale`, whatever `?locale=` names;
  - a site with no languages gets none.

  So a rule can answer by language, such as
  `update: ({ locales }) => !locales.includes("fr")`, and a rule that limits
  someone to some languages refuses an operation that reaches beyond them.
  Write language rules as restrictions like that one, not as admissions by
  inclusion (`locales.includes("fr")`): where the languages an operation
  involves can't be known exactly, such as an operation that names none or a
  collection built in the admin, the rule is told every configured language,
  which a restriction refuses and an admission would allow. Restrict with
  `locales`, not `locale`: `locale` is absent for an operation on every
  language, and leaves out the languages a read falls back to.

  The REST route gate is told the same languages as the service gate, from the
  request's `?locale=` for an operation on one language's content (a history
  list filtered to one language among them), the default for a bulk write, and
  every language for any other. It reads them from the parameters the request
  is dispatched with, so a language named twice is judged as dispatched.

  A collection preview link names no language, so minting or opening one asks
  the read rule in every language: a collection whose read rule closes any
  language can't mint entry previews until the preview path binds the link's
  language.

  A rule that does not read `locale` or `locales` answers as before. Code that
  builds a rule's context by hand, such as a unit test of a rule, now gives
  `locales` too: `[]` where the site has no languages.

- [#2169](https://github.com/nextlyhq/nextly/pull/2169) [`121d24d`](https://github.com/nextlyhq/nextly/commit/121d24d41d4259cf4f34d603b41163c2bde7e3d0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The PostgreSQL and MySQL adapters can now tell a test harness when a statement
  escapes an open transaction: a query or connection taken from the pool while
  the same flow's transaction already holds its own connection, which runs
  outside that transaction and is kept when it rolls back. Nextly's own
  integration suites fail on such a statement. Nothing changes in a running
  application; with no harness listening, the check is a single property read.

- [#2053](https://github.com/nextlyhq/nextly/pull/2053) [`be9b841`](https://github.com/nextlyhq/nextly/commit/be9b841a592e5c3af967939d1365628648ecdfaf) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The admin's build-mode comment names what its `NODE_ENV` fold decides — the
  error screens' technical-details box, the caught error's message and stack
  trace, stays out of what production users are served — and leaves whether the
  development reload stream opens to the running server's answer. The
  route-table comment keeps the rule and the runtime answers without the record
  of what an older published bundle did. The settings-sync component's
  explanation of its sibling shape is stated once, on the component, where the
  layout points at it, and the component's file is named after what it exports.

- [#2667](https://github.com/nextlyhq/nextly/pull/2667) [`8081dde`](https://github.com/nextlyhq/nextly/commit/8081ddeae66019d3a78d08285983a106d044295e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin` builds its declarations with oxc, from the type annotations in its own source. Its published types and JavaScript are unchanged.

- [#2651](https://github.com/nextlyhq/nextly/pull/2651) [`0ab320c`](https://github.com/nextlyhq/nextly/commit/0ab320ca3ec011a1e1a7496fc24de27ba845738c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin`'s feature components declare their own types: each export states what it returns and accepts, so its published declarations no longer depend on inference. What the components render and accept is unchanged.

- [#2688](https://github.com/nextlyhq/nextly/pull/2688) [`57c99aa`](https://github.com/nextlyhq/nextly/commit/57c99aaa176af1313475751d16fdea448c5dbf9f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard a new reader is given is now the agreed one: Needs attention, Create, Recently edited, Recent activity, Content, Upcoming releases and Team, in that order, each at its agreed width and offered only within its agreed widths.
  - **Each card only when it has something to show.** Create needs a collection the reader may create in; Needs attention needs something it counts that the reader may read; Upcoming releases needs a release the reader may read; Content needs a collection or a Single the reader may see. Four new widget conditions say so: `create:available`, `attention:readable`, `releases:present` and `content:present`. Each condition's reads happen at most once per request.
  - **One Content card, `core/content`,** lists both collections (with their entries and drafts) and Singles. It replaces the Collections and Singles cards. A saved Collections, Singles or per-Single card becomes Content, at the first one's place, and the per-Single cards are no longer offered.
  - **`system:content` answers Singles too,** after the collections, each row saying its `kind`.
  - **Saved dashboards convert** through one retirement map, which now also covers ids minted per Single (`single/<slug>-status`).
  - **New, `@experimental`:** `ReleasesService.anyReadable`, whether a release exists that a caller may read, one row read through the list's own rules.

- [#2486](https://github.com/nextlyhq/nextly/pull/2486) [`19a3503`](https://github.com/nextlyhq/nextly/commit/19a350331b7187a4d7e54b44ff62165ddee96803) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An access check whose role or permission read fails now refuses, instead of judging the caller as holding no roles or permissions.
  - **Code-defined access rules** (collection and Single `access`, and field-level `access`) are handed the caller's roles and permissions. When those could not be read, a rule was handed empty lists. It is now not run: the request is refused with `DATABASE_BUSY` (503, retryable) when the read waited out `pool.connectionTimeoutMs`, and an internal error otherwise. A field rule whose caller's grants cannot be read is denied.
  - **`listRoleSlugsForUser` and `listEffectiveGrants`** throw a `NextlyError` when the read fails, where they returned an empty list. A caller with no roles or permissions still gets an empty list.

- [#2729](https://github.com/nextlyhq/nextly/pull/2729) [`15256dc`](https://github.com/nextlyhq/nextly/commit/15256dcd74685c63da46dfca52968726ce2bed4e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A request with an API key on a server that has just started no longer answers 503; it waits for Nextly to start, as a signed-in request does.

- [#2425](https://github.com/nextlyhq/nextly/pull/2425) [`39d7239`](https://github.com/nextlyhq/nextly/commit/39d72393bc3e2d6f36359c6f6b4c5aab24c1138d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Saving an entry or a Single in the admin keeps a related item or upload inside a field group or a dynamic zone that the editor may not read, or that no longer exists. The editor sees it as a "Restricted or missing item" with its id, which can be removed but not opened, as at the top level; before, a save removed such links. A read at `depth=0` now returns a to-many relationship inside a field group as an array of ids, as for every other field, rather than as its stored JSON text when the field's name is camelCase.

- [#2389](https://github.com/nextlyhq/nextly/pull/2389) [`608e1f0`](https://github.com/nextlyhq/nextly/commit/608e1f003a8661b28de2582aa3f3132890744824) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Saving an entry or a Single in the admin keeps a related item or upload the editor may not read, or one that no longer exists. The edit page shows it as a "Restricted or missing item" with its id, which can be removed but not opened; before, a save removed such links. Populated reads are unchanged.

- [#2556](https://github.com/nextlyhq/nextly/pull/2556) [`ebec922`](https://github.com/nextlyhq/nextly/commit/ebec922f4d318ea887d4127812874b81fc817419) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Code and plugins can now queue an email (`@experimental`):
  `nextly.email.queue` and `queueWithTemplate`, and the same two on a plugin's
  `ctx.services.email`, take every option `send` and `sendWithTemplate` take.
  A queued email is stored, sent right away, and retried through the job queue
  when the provider fails temporarily, with backoff for up to about three hours
  (15 attempts); a failure that is not temporary fails it at once. Every attempt
  sends with the caller's `idempotencyKey`, or with a key of the queued email's
  own, so a retry after a lost response is not delivered twice where the provider
  takes a key. A template is rendered at each attempt.

  A plugin can pass its transaction as `tx`: the email is then stored in that
  transaction, exists only if it commits, and is attempted once it has. An email
  stored but never attempted, because the process stopped, is sent the next time
  the jobs trigger (`/api/jobs/run`) runs, and the server log warns at startup
  and on each queued send when a queued email is more than 15 minutes past due
  because the trigger isn't running.

  The message is held in a new `email_queue` table, sealed under `NEXTLY_SECRET`;
  the job carries only its id. `nextly migrate` and boot add the table on all
  three databases. Sends that are not queued are unchanged.

- [#2102](https://github.com/nextlyhq/nextly/pull/2102) [`4ab4263`](https://github.com/nextlyhq/nextly/commit/4ab4263de5def601bd949f75f11f04451b44bd88) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An email sent to several `to` addresses now reaches every one of them, through
  `nextly.email` and a plugin's `ctx.services.email`;
  before, only the first address received it. `from` and a new `replyTo` take
  effect on every way of sending.

- [#2353](https://github.com/nextlyhq/nextly/pull/2353) [`c271a3f`](https://github.com/nextlyhq/nextly/commit/c271a3f91ebde9ea9df03aa35abc8cae8bb28141) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Sign-in and the other auth routes, for a client whose address cannot be resolved, now count a request body larger than the limiter reads among the bodies being read until its handler has finished with it. The limiter stops reading such a body early and the handler reads the rest, which the client could hold open, so these bodies escaped the bound on how many are read at once. A request the limit refuses still gives its place back at once.

- [#2355](https://github.com/nextlyhq/nextly/pull/2355) [`4a357ed`](https://github.com/nextlyhq/nextly/commit/4a357ed62671a9b04cf2702d54ff8be5664df45f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly plugins install` and `nextly plugins uninstall` wait for the event
  handlers a plugin's `onInstall` or `onUninstall` set off, and now for the
  follow-up events those handlers emit in turn, before shutting the runtime
  down. A producer a plugin started in `init()` is not waited for, so it never
  holds the command open.

  When that work is still running after 30 seconds, the command now stops
  instead of carrying on. An uninstall stops before any DOWN migration drops the
  plugin's tables, which that work may still be reading, and the plugin stays
  `uninstalling`, so running the command again finishes it. Before, it warned
  and dropped the tables anyway.

- [#2338](https://github.com/nextlyhq/nextly/pull/2338) [`07211e7`](https://github.com/nextlyhq/nextly/commit/07211e7ffc16cdf79c8c9025b65ea8deac803de7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly plugins install` and `nextly plugins uninstall` now let the event
  handlers a plugin's `onInstall` or `onUninstall` set off finish before they
  shut the runtime down. Emitting an event doesn't wait for its handlers, so
  another plugin's handler (removing what it kept about each account an
  uninstall reports deleted, for instance) could be stopped part way. The
  uninstall's DOWN migrations then dropped the tables that handler was still
  working through, leaving its cleanup unfinished.

- [#2636](https://github.com/nextlyhq/nextly/pull/2636) [`3c65a6f`](https://github.com/nextlyhq/nextly/commit/3c65a6f17409dd4689a696e66fa34b4aa9bd642c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/blocks-engine` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2638](https://github.com/nextlyhq/nextly/pull/2638) [`c56257a`](https://github.com/nextlyhq/nextly/commit/c56257a0d8c05b0e0c6e9230c605b40b40e66d4b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/blocks-react` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2662](https://github.com/nextlyhq/nextly/pull/2662) [`71aadd1`](https://github.com/nextlyhq/nextly/commit/71aadd171b1e8da7c0675a792250545355127ac1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A tenant's brand colours no longer make a dashboard chart unreadable. Where branding sets the chart colours, the admin checks each against the card, a bar's track and the tooltip, in light and in dark, and moves the lightness of one below 3:1 until it reads, keeping the brand's hue and never refusing it. The chart colours are now written per mode. `@nextlyhq/ui/color` gains `readableOn` (`@experimental`), the adjustment itself, with the target ratio as a parameter.

- [#2676](https://github.com/nextlyhq/nextly/pull/2676) [`9b73b41`](https://github.com/nextlyhq/nextly/commit/9b73b41f19751dce06a4c35475b5e9479f8d3ca7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The adjusted brand chart colours now reach the chart. The server-rendered branding stylesheet sits later on the page and wrote the unadjusted colours at the same specificity, so it won; the admin's per-mode chart rules now outrank it. The content status widget draws its Published segment and dot in the brand's chart slot, held to 3:1 on the card, rather than in the brand's primary as given.

- [#2604](https://github.com/nextlyhq/nextly/pull/2604) [`f7652e0`](https://github.com/nextlyhq/nextly/commit/f7652e025ea2e6d15ec48ccf11e6411a2de063f1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin`, `@nextlyhq/ui` and `@nextlyhq/builder` build with tsdown, which completes the move from tsup. What they publish is unchanged: the same entry points, exports conditions and declarations. The plugin template that `create-nextly-app` scaffolds now builds with tsdown too, through a `tsdown.config.ts` in place of the tsup config. A plugin project now declares `engines.node` as `^22.18.0 || ^24.11.0 || >=26.0.0`, where both tsdown and Vitest run, and `create-nextly-app --template plugin` refuses to scaffold on an older Node, with a message naming the floor.

- [#2627](https://github.com/nextlyhq/nextly/pull/2627) [`f0e0e52`](https://github.com/nextlyhq/nextly/commit/f0e0e52c56f12f1a77171246be490151b7082cae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/builder` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2334](https://github.com/nextlyhq/nextly/pull/2334) [`85a2094`](https://github.com/nextlyhq/nextly/commit/85a20949d94cebddfd83978a574e18963a0e3b3f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A translated field named with capitals in a Schema Builder collection (`subTitle`) takes writes in every language straight after the collection is created or the field is added. The Builder stores field names lowercased, and the database's columns are named from the stored name, but the tables the running process reads and writes through were built from the name as typed, so every write in a language other than the default one failed with an unknown column until a restart. They are now built from the stored names, as a restart builds them. Nothing stored was wrong, so existing installs need no change.

- [#2564](https://github.com/nextlyhq/nextly/pull/2564) [`a477920`](https://github.com/nextlyhq/nextly/commit/a47792062aa683cbe6ed7fdf0578fca38b011804) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Reading an entry or a page of entries now makes fewer round trips to the database. A read looked up its collection's registry row several times, each a query of its own. The row is now read once and reused for up to a second, so a read of one entry sends 4 statements instead of 11, and a page of entries 5 instead of 13. That is a few milliseconds off every read on PostgreSQL and MySQL.

  Reads return exactly what they did before. A change to a collection made in this process is seen at once. Changes to a collection made elsewhere (another instance, `nextly migrate`, a direct database write) reach every instance within a second. A read inside a transaction always goes to the database.

- [#2626](https://github.com/nextlyhq/nextly/pull/2626) [`f87bbaf`](https://github.com/nextlyhq/nextly/commit/f87bbaffbac9d73be96daccf32d1ea4cf2d60ac2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Nextly does not support Next.js Cache Components yet, so it keeps it off. `create-next-app` 16.4 turns Cache Components on by default (`cacheComponents: true` with `partialPrefetching: true`).
  - A project `create-nextly-app` creates sets `cacheComponents: false` in its `next.config`, with a comment saying why.
  - When `create-nextly-app` adds Nextly to an existing app, it turns Cache Components off in that app's config and removes `partialPrefetching`, which Next.js accepts only with Cache Components on. Its report says what it changed and why. A setting it cannot read safely is left as it was, with what to change by hand.
  - `withNextly()` and Nextly's start print a warning when Cache Components is on, with how to turn it off. They don't refuse: an app with it on is untested with Nextly, not known to be broken. The start check reads the setting from the app's `instrumentation.ts`, which now passes `cacheComponents: process.env.__NEXT_CACHE_COMPONENTS` to `createRegister`; `createRegister` takes it as an optional second argument.

  Why, and the plan to support Cache Components before Next.js 17: https://nextlyhq.com/docs/getting-started/installation#cache-components

- [#2545](https://github.com/nextlyhq/nextly/pull/2545) [`6fe78db`](https://github.com/nextlyhq/nextly/commit/6fe78db7cd987c0a0a068869f4e65b8819b9b259) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin route's `ctx.caller.can()`, the held permission that decides a dashboard widget's `requiredPermission` and a document lock's release, and the schema builder's collection list now ask the one access decision. Every answer they give is unchanged: where one still answers differently from the decision, it keeps its answer through a named difference, so a later change can remove each one on its own.

  The schema builder's collection list now reads the caller's access once for the whole list, rather than once for each collection.

- [#2483](https://github.com/nextlyhq/nextly/pull/2483) [`3e60c59`](https://github.com/nextlyhq/nextly/commit/3e60c595b6878e6762a014952c73b6e959b8b258) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A card's quick setting (a `select` or `checkbox` its widget marks `quick`) is drawn in its header and offered in a new card menu at rest, and a change there is saved at once for the reader. Only that card is asked again, and the change is announced once the card shows it. Settings saved outside customise mode are now kept for a reader who has never arranged their dashboard, who goes on following the default. Changing one card's settings no longer reloads every card on the dashboard.

- [#2434](https://github.com/nextlyhq/nextly/pull/2434) [`17ac818`](https://github.com/nextlyhq/nextly/commit/17ac8187d0f3b71ec5d74a45239f86ab69636dc6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card's settings sheet can now draw Collection, Filter, Sort and Group by settings, offering only the collections and fields the reader may read, for widgets whose card query is built from them. Registered widgets cannot declare these settings yet: a registered widget's query applies only `limit`, so registration refuses them, as before. A stored choice the reader can no longer make opens at its default, with a line saying so, and "Reset to defaults" leaves a card's Collection as it is. A widget may mark one setting as quick; the mark is validated now, and the card header that shows it comes later. The workspace payload gains `widgetSources`, and widget source fields gain an optional `groupable: false` mark. New experimental type exports on `nextly/config`: `AnyWidgetSetting`, `ContentSetting` and `PublishedContentSource`.

- [#2478](https://github.com/nextlyhq/nextly/pull/2478) [`04fd52f`](https://github.com/nextlyhq/nextly/commit/04fd52f8e04aa4df65307e937931569623dee2bf) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard chart is reachable by keyboard and pointer. It takes one tab stop; the arrow keys move through its bars or intervals, a polite live region reads the current point, and a tooltip shows it. Escape dismisses the tooltip wherever focus is, and a tooltip stays while the pointer is over it.

- [#2455](https://github.com/nextlyhq/nextly/pull/2455) [`0bae677`](https://github.com/nextlyhq/nextly/commit/0bae677b51ca396cfe844c89cbd351191e0e425d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The collection access gate now asks the one access decision, keeping every answer it gives today. Where today's gate still differs from that decision, a named deviation keeps today's answer, so nothing a caller is allowed or refused changes.

- [#2656](https://github.com/nextlyhq/nextly/pull/2656) [`2347689`](https://github.com/nextlyhq/nextly/commit/234768906066d12310820cb128960771a6fd8ad3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-commerce` and `@nextlyhq/plugin-accounts` build their declarations with oxc under `isolatedDeclarations`, from the type annotations in their own source. Their published types and JavaScript are unchanged. `nextly migrate:create --plugin` now writes the migrations index with its type stated (`PluginMigration[]`), so a plugin built the same way can publish it.

- [#2405](https://github.com/nextlyhq/nextly/pull/2405) [`5f9ee97`](https://github.com/nextlyhq/nextly/commit/5f9ee9760dbf9af6180fb6bb492b74f5ca606df0) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A component's many-to-many now reads back as the list of ids it was saved with on every dialect. Before, PostgreSQL returned the list as a string, SQLite returned it as an undecoded JSON string, and MySQL refused a save of more than one id. The column is now the JSON list column a `hasMany` relationship uses (`jsonb` on PostgreSQL, `json` on MySQL, `text` on SQLite), on every route that creates a component table. A single stored id reads as a one-item list.

  Existing installs: a PostgreSQL component table holding the many-to-many as `uuid` or `text`, or a MySQL one holding it as `varchar(36)`, is offered a one-time conversion to the JSON list column on its next schema apply, and `migrate:create` writes the same conversion into a migration file. Every stored id is kept: a bare id becomes a one-item list, a PostgreSQL array literal becomes the list it holds, and a JSON list stays as it is. On PostgreSQL a value that cannot be read (a malformed array literal) refuses the conversion before anything changes. A generated DOWN reads each list back as its id, and refuses a row holding more than one id rather than drop any. Until the conversion is accepted, saves to such a column may be refused. SQLite needs no conversion.

- [#2166](https://github.com/nextlyhq/nextly/pull/2166) [`314a592`](https://github.com/nextlyhq/nextly/commit/314a592648b8f60f53c6ae5ce58e3ba7b5023803) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A component's many-to-many column is text on PostgreSQL on every creation route, so the schema planner proposes no type change between them.

  Compatibility: a Postgres component table already created with uuid gets a one-time uuid-to-text change on its next preview. Converting existing data is a follow-up for Mobeen; this release does not convert it.

- [#2506](https://github.com/nextlyhq/nextly/pull/2506) [`65ecd20`](https://github.com/nextlyhq/nextly/commit/65ecd204302f6ee6a68ccc3345b5edf8d20bccc1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component held in a group or repeater of another component is now validated against its own fields on every write, its own `validate` included; until now nothing judged it, so existing content that fails it is refused on its next save or publish.
  A component placed directly in another component's fields is not stored where the outer component is stored on its own (at the top level of a collection or Single, or under rows, tabs, collapsibles or an unnamed group), and since alpha.67 a value for it there was dropped without a word. Where the outer component is held in a named group or a repeater, its whole value, the directly placed component included, is stored there and validated. Where it is not stored, now:
  - the admin no longer shows such a field in its forms;
  - a write that carries a value for one is refused with `NOT_STORED` (only an empty value, `null`, `{}` or `[]`, passes);
  - `defineConfig` warns about each such field;
  - the Schema Builder no longer offers one there, and names any an existing field group holds.
    Put such a component in a group or repeater instead, where it's stored and validated.

- [#2388](https://github.com/nextlyhq/nextly/pull/2388) [`cc30a93`](https://github.com/nextlyhq/nextly/commit/cc30a93e2fe4b39c90ce81434804ee269600e29e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test, more of what Nextly writes to the console is masked of email addresses: post-commit hook failures and rejected forgot-password redirects (now written through `consoleLogger`, so with its `[WARN]`/`[ERROR]` prefix), failed user searches, and the default auth and database loggers. Addresses written with combining marks (Devanagari, for example) and punycode labels in upper case are masked too.

- [#2669](https://github.com/nextlyhq/nextly/pull/2669) [`2ed4941`](https://github.com/nextlyhq/nextly/commit/2ed49414abf78ce3d1d3edb54fd9b69cafc9350f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Content card counts only the collections it shows, and shows every collection it counts.
  - `system:content` takes the page of collections first, in slug order, and counts only that page, so an install with many collections no longer counts every one of them on each dashboard load to show fifty.
  - The card draws every collection in the answer: those the navigation lists in its order, then any it does not. Past a hundred collections the two lists cover different collections, and a counted one used to be dropped.

- [#2713](https://github.com/nextlyhq/nextly/pull/2713) [`8266c7e`](https://github.com/nextlyhq/nextly/commit/8266c7ed1aee084b253171d21759783f92baea0b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Count card in the add panel, and content widgets that ask only what they draw.
  - **The add panel's Content group is shown.** It lists Count once for each collection the reader may read, and its rows carry the widget's category, so a search by category finds them.
  - **A card set to a collection names it** in its title ("Count: Posts"), and Count names it in its number's accessible name, so two cards for different collections can be told apart.
  - **Count's Retry** asks a failed card again.
  - **A custom card's cells:**
    - A cell may declare `drawnFrom`, the narrowest tier that draws it. The admin asks only the cells a card's tier draws, and asks the rest when the card widens.
    - A cell's `when` is judged by the collection that cell reads once the settings apply.
    - Each cell is keyed by its declared query, so changing one card's settings asks that card again alone.
    - The settings preview asks the cells under the sheet's values.
  - **A component's settings are the ones its query was asked with.** A stored Filter, Sort or Group by that the query set aside is not handed on. `effectiveWidgetSettings` gives that reading, and `KnobField` is exported beside `KnobContext`.
  - **Registration refuses:**
    - a custom card declaring both a query and cells;
    - a widget offered per collection with no Collection setting;
    - an `offered` value outside its closed list (`"per-collection"`, `"on-request"`);
    - a content setting that no cell's source lets a knob drive.
  - **A timeseries with `until`** draws its intervals up to that boundary, where its rows end.
  - **Whether a caller has a release to read** is asked once per batch, not once per collection.

  All of it is `@experimental` while the content widgets are built.

- [#2722](https://github.com/nextlyhq/nextly/pull/2722) [`fecf9b4`](https://github.com/nextlyhq/nextly/commit/fecf9b407955a200c25f19a451c8d2e55e371519) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A contributed widget's text setting is now held to its `maxLength` when the dashboard layout is saved. Before, only widgets in the registry were checked, so a direct layout write could store text of any length on a widget a plugin contributed through its manifest. The settings sheet already refused it. The bound now comes from either channel, and where a registration and a contribution share an id it follows the admin's rule: the registration's settings wherever it states any, else the contribution's.

- [#2378](https://github.com/nextlyhq/nextly/pull/2378) [`6daef10`](https://github.com/nextlyhq/nextly/commit/6daef102908020fce0a160a98ecc6ede37128f7c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Core's welcome, password-reset and email-verification emails now name the staff user on their delivery records, so deleting the user can erase them under any address. `person` on `nextly.email.send`, `sendWithTemplate` and a plugin's `ctx.services.email` accepts a staff user as `{ kind: "staff", id }` (experimental).

- [#2358](https://github.com/nextlyhq/nextly/pull/2358) [`a167d97`](https://github.com/nextlyhq/nextly/commit/a167d97d3f2bab21e920818c36ea903372d44c15) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's own rate limits now count in the limit store the site selected with
  `rateLimit.store`: the sign-in limit, the limits plugin routes ask for, the REST
  API limit and each API key's limit. On `"database"`, every instance of the site
  counts one budget, where each used to count its own.
  - **Keys are stored only as keyed hashes in the selected store.** Client
    addresses, account ids and API key ids no longer reach the memory store, the
    database store or an app's `LimitStore` as given. An app's store of the
    earlier `RateLimitStore` contract still receives them as before.
  - **Counts roll in 32 buckets per window.** An attempt counts for one window
    from when it was made, and can be forgotten up to 1/32 of the window early.
    The sign-in limit used to slide exactly, and the REST limit reset its whole
    window at once.
  - **An app's store of the earlier `RateLimitStore` contract keeps serving
    core's own limits**, as before.

  **A store outage after a good start now refuses core's sign-in requests**
  (`503`, "Please try again shortly."), on core's `/auth/*` endpoints and on plugin
  routes with `rateLimit: "auth"`, while the REST API, API key and other plugin
  route limits let requests through. A store call that takes more than 2 seconds
  counts as an outage, and a call that never settles stops holding a place after
  20 seconds, so once the store answers again its limits count again without a
  restart. Each outage is logged once when it begins and once when the store
  answers again. Before, a store failure failed the request. With an
  app's own store, an outage stops staff sign-in until the store answers, so
  monitor that store.

  **Existing installs see one new production warning**, until they select the
  database store (`rateLimit.store: "database"`) or say they run one instance
  (`rateLimit.singleInstance: true`). With only a store of the earlier contract,
  the warning says that plugin limits count in memory.

  The memory store holds at most 100,000 live entries (`rateLimit.maxEntries`).
  When it is full and nothing has expired, a new key is answered as
  unavailable, so a sign-in from a new address is refused and an API request is
  let through.

- [#2692](https://github.com/nextlyhq/nextly/pull/2692) [`2a41378`](https://github.com/nextlyhq/nextly/commit/2a41378438ea02d32f85072d0c65fb418df4875b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Count card, and the content settings that let one widget read the collection each card is set to.
  - **Count** (`core/count`) states how many entries a collection holds. From medium width it adds the published and draft split, and what scheduled releases will publish; at large width, the last 30 days against the 30 before. Each part links to the list that holds exactly it.
  - **Offered per collection:** a widget may declare `offered: "per-collection"`. It is then never placed on the default dashboard, and any number of its cards may be placed, each starting with its collection.
  - **Its query may name no source** when a Collection setting supplies one. A custom card may declare several keyed reads (`cells`), each answered on its own, and handed to its component as `cells`.
  - **Content settings reach the card's query:** Filter (joined with any condition the widget declares), Sort, Group by and a Date range (`since`), each on a collection source. A stored Filter, Sort or Group by naming a field the reader may no longer use is asked with its default instead.
  - **Widget queries** take `since` and `until` (spans from a closed list, measured in whole UTC days or months from the batch's one instant). On a collection source, they take the entry list's workflow conditions `_pendingChange` and `_inRelease` at the top level. A release condition is answered "not available" for a reader with no release to read.

  All of it is `@experimental` while the content widgets are built.

- [#2640](https://github.com/nextlyhq/nextly/pull/2640) [`faa31d0`](https://github.com/nextlyhq/nextly/commit/faa31d0ed53ccd22363a8fe2485efa8b413fad79) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `create-nextly-app` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2438](https://github.com/nextlyhq/nextly/pull/2438) [`aa707be`](https://github.com/nextlyhq/nextly/commit/aa707be11d4809934155d0268a1856a1f1dde0f4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Add widget now opens a panel beside the dashboard. It lists every widget you may add in core's groups (Overview, Team, Plugins), with the cards you removed first so they can be put back where they were. You can search it by name, description, category, group or plugin (a removed card by its name or by its Removed section's text), and add several cards in one visit: each new card goes to the end of the dashboard and is ringed so you can see where it landed. A one-card widget already placed shows as on the dashboard. At the card limit, adding is turned off and putting a removed card back still works. The panel announces search counts and each card it adds. When it closes, focus goes to the last card added, or back to Add widget.

  The layout read now gives each widget the panel offers a `rank`, its place in that order, so the panel can list a placed widget where it would be offered.

- [#2528](https://github.com/nextlyhq/nextly/pull/2528) [`e0f9d63`](https://github.com/nextlyhq/nextly/commit/e0f9d630aa4fb3c9f7c225e308299eadc1801117) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard cards now arrive one at a time. A card whose data is slow, or fails, no longer holds back the cards that read other sources.
  - `POST /api/dashboard/query` streams its answer when the request sends `Accept: application/x-ndjson`: one `{"index", "slot"}` line per card, written as each settles. Cards one source answers with a single shared call arrive together, as that call ends. Each line is the slot exactly as the JSON answer holds it, with its dates formatted the same way. A request without that header gets the same JSON answer as before. Both responses now send `Vary: Accept`. Anything that fails the whole batch (authentication, the body, the caller) still answers with the usual error before the stream starts. If the reader leaves mid-stream, the cards still running are told to stop through their signal.
  - The admin dashboard asks for the stream and draws each card as its slot arrives. A refresh keeps each card's numbers until its new answer lands, and only the cards still waiting show as loading.
  - The "is there content" check behind the `content:empty` condition and the onboarding "first entry" step now counts at most 8 collections at once and stops at the first one with an entry. It has a 5-second budget. When the budget runs out it answers "unknown", which is never read as empty: the empty-install cards are not offered, and the first-entry step stays open. Counts already running when it stops cannot be cancelled; they finish and are ignored.

- [#2301](https://github.com/nextlyhq/nextly/pull/2301) [`eba8f00`](https://github.com/nextlyhq/nextly/commit/eba8f009d577d652c8abe44861405b9eed5c77f7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card lays itself out by its own width, small, medium or large, never by the
  window's. A card below 340 px is small and from 700 px large, and the dashboard predicts each
  card's tier from its own width and the card's span before the first query, so each card asks
  only for what its tier draws.
  - A list or table card draws three rows, titles only, when small; its number of items with a
    line of detail when medium; and a table with a heading per column when large. When its answer
    holds more rows than it draws, it says "More exist", and for a list from one collection that
    is a link to the collection's list view with the card's filter and sort.
  - A breakdown draws its 3, 5 or 8 largest groups and says how many more there are, or that more
    exist when the answer itself was cut short.
  - An over-time card shows the latest value and the total over its range when small, dates its
    line's two ends when medium, and adds dates between them when large.
  - The Create card offers 2, 3 or 6 shortcuts and the rest in a More menu; the Team card shows
    the number of people alone when small; the Collections and Singles tiles take as many columns
    as the card fits.
  - A card whose width grows into a tier that draws more asks again on its own; a card that
    shrinks asks nothing. Nothing in a card is clipped and nothing scrolls inside it.
  - The entry list honours a `sort` in its address for a column its sort menu can order by.

- [#2367](https://github.com/nextlyhq/nextly/pull/2367) [`e7887fc`](https://github.com/nextlyhq/nextly/commit/e7887fcfa433361bc2b16f2545c8458defbdc5c3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard charts show their values and colour their groups. A chart over time labels its value axis at zero and its highest value on medium and large cards, circles its latest point at every size and labels its value from medium up, and names several series in a legend. A chart of groups orders its groups by count, ties by label in the admin's locale, before a card's size cuts them, and colours each bar by its group's value, so a status is the same colour on every card. Each chart's text alternative states its range, total, latest and highest values, or its groups, total and the group with the most, saying when counts are lower bounds. The light theme's third chart colour is a step darker, so every chart colour holds 3:1 on a bar's track and on a tooltip as well as on the card.

- [#2696](https://github.com/nextlyhq/nextly/pull/2696) [`e586815`](https://github.com/nextlyhq/nextly/commit/e586815a6bbc701e25ee7b41d5f0fbb696fb9558) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Needs attention and Create cards are offered exactly when they would have something to show, and the Content card's rows always say what they are.
  - **Needs attention** is offered on content it could count: a collection or Single with a published source, or releases. A reader whose only collection is mid-migration, and who may not read releases, is no longer given a card that can only say "not available".
  - **Create** is offered only when it would offer a collection: one the reader may create in that does not turn creating off (`admin.disableCreate`, as form submissions do). A site whose only writable collection is form submissions no longer gets an empty Create card.
  - **`system:content`** keeps each row's `kind` whatever a query selects, so a collection and a Single that share a slug always stay apart.

- [#2508](https://github.com/nextlyhq/nextly/pull/2508) [`f3dd57c`](https://github.com/nextlyhq/nextly/commit/f3dd57c8d5ec8ccf160f9541c26a1d4546d3924b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On the dashboard, a keyboard drag cut short when the dashboard narrows to one column now leaves focus on that card's menu, where the move goes on, instead of on the page. Resetting the dashboard to its default also clears the outline on the card placed last, so a card the default reuses no longer looks freshly placed.

- [#2480](https://github.com/nextlyhq/nextly/pull/2480) [`ddc8279`](https://github.com/nextlyhq/nextly/commit/ddc82790509b6a9f6ce98d9f9f1a7e0562204e9e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard cards are now dragged by their handle with a drop line, and the dashboard can be customized on phones. While a card is held, the other cards stay where they are, the held card dims, and a line shows where it will land: beside the card it will follow, or across the dashboard where it will start a row. The order changes once, on release. The keyboard works the same way: Space or Enter picks a card up, the arrow keys move it one place at a time, Space or Enter puts it down, and Escape cancels. Each step is announced, and so is the move with both positions. A moved, resized, added or restored card is outlined until the next change, and without animation for anyone who asks for reduced motion. Customize is now offered at every width. Where the dashboard shows one column, the handles are hidden and the card menu moves, resizes and removes cards, and the bar fits a phone. A drag in progress when the dashboard narrows to one column is cancelled, and says so.

  In the add panel, a removed card is found by its widget's description, category, group and plugin, as the widget's own row is, and each visit to the panel starts with nothing announced from the last one.

- [#2700](https://github.com/nextlyhq/nextly/pull/2700) [`0962243`](https://github.com/nextlyhq/nextly/commit/09622434a9c0acae1c672b50f1261af9688eb4b2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A reader can put a Note on their dashboard: Markdown of their own, private to their layout, drawn read-only with no HTML and links held to http, https and mailto. Widget settings gain an experimental `textarea` type with a `maxLength` counted in characters (code points) by one counter, `textLength` on `nextly/config`, used by the settings sheet and the layout write alike. `offered` gains an experimental `"on-request"`: a card added from the add panel only, never placed by default. A dashboard over its size limit is told "This dashboard is full: remove a card or shorten a Note".

- [#2472](https://github.com/nextlyhq/nextly/pull/2472) [`ee72728`](https://github.com/nextlyhq/nextly/commit/ee72728b45efb2d250095ff295891fc741d59b23) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The "database busy" code core reads is now held in core, so the error module reached from every client-safe entry no longer imports the database adapter, and the admin's browser bundle no longer reaches a database package. The code is unchanged, and a test holds it equal to the adapters'.

- [#2598](https://github.com/nextlyhq/nextly/pull/2598) [`bc33333`](https://github.com/nextlyhq/nextly/commit/bc333335bd1cccf149305ee89e8bda2775db82db) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Filtering by a date works on SQLite. A filter on `createdAt`, `updatedAt` or a date field of the collection itself with an ISO 8601 value used to answer 500 on SQLite, the admin's Created and Updated filters on every list among them. It now narrows the list and its count, as it does on PostgreSQL and MySQL. A bound with a fraction of a second is compared exactly on SQLite, which used to floor it to the second. On PostgreSQL, an instant written with an offset other than `Z` is compared as the instant it names, where its offset used to be dropped.

  A date is compared with an instant with its offset (`2026-09-01T09:00:00Z`) or a calendar date (`2026-09-01`, the start of that day in UTC), read the same way on every database. Any other value, including a time with no offset, is now refused with a 400 validation error (`FILTER_INVALID_OPERAND` in its field errors) on every database, where PostgreSQL and MySQL used to pass it to the database to interpret.

- [#2536](https://github.com/nextlyhq/nextly/pull/2536) [`4735e39`](https://github.com/nextlyhq/nextly/commit/4735e39396103dc3ffd3b909db160764cd4b404a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Experimental: a workflow definition can now be declared in code and attached to collections and Singles. This release only declares, validates, registers and types a definition. Nothing enforces it yet: content is not tracked through stages, no step can be taken, and publishing works exactly as before.

  `defineWorkflow`, from `nextly/config` or `nextly`, declares:
  - stages, one or more of them allowing publishing, but never the first, nor one the system moves content to without an approval;
  - steps between stages, of kind `submit`, `approve`, `request-changes` or `move`;
  - settings kept for later use: what an edit to approved content does, where the next draft starts, where removed stages go and whether approvals stand.

  `reviewWorkflow()` is a ready-made Drafting → In review → Approved definition. Each definition is checked when declared. An error names its place and the known names, for example ``steps[1].to: `aproved` is not a stage. Known stages: drafting, inReview, approved.``. A misspelt stage in a step fails to compile.

  The `workflow` option on a collection or Single attaches a definition. It needs `status: true` and drafts enabled. An attachment that cannot keep a draft beside the live version is refused at boot, before anything is written, on hot reload, and in `nextly build` and `generate:types`. The refusal says which condition is missing.

  Each attached workflow is registered with:
  - a definition hash: sha256 of its structure, which labels and attachments don't change;
  - the path of its `nextly.config.ts`.

  `generate:types` and `nextly build` add a `<Name>WorkflowStage` and `<Name>WorkflowStep` union for each attached collection and Single, and a `workflows` entry in `Config`.

  An internal, never-exported `defineWorkflow` for content states in `lib/content-states` is renamed `defineContentStates`.

- [#2300](https://github.com/nextlyhq/nextly/pull/2300) [`f5b1fff`](https://github.com/nextlyhq/nextly/commit/f5b1fff7a6bd2cf91b134580dfc869c0c6ae6ff2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting a media item now removes every file stored for it: the original, the thumbnail made at upload, and every image size, on local disk, S3, Vercel Blob and UploadThing.

  **Privacy note.** Until this release, deleting a media item left its upload-time thumbnail stored, on local disk under `public/uploads` and on S3 and Vercel Blob, where it stayed publicly reachable at its old URL. (UploadThing was not affected.) To find those thumbnails, run `npx nextly media orphans`: it lists them by stored path and changes nothing, and you remove them by hand from the folder, bucket or dashboard they are in. Run it again with `--apply` to have it remove the ones whose place shows they are media's: it asks about each batch of files just before removing it, keeps any an item has come to refer to, and stops if it cannot check. On S3 it matches keys as written, so `/media/...` or `media//...` keys are never taken for `media/...` ones. Run it from the project's own directory to remove files: with `--cwd` naming another project, `--apply` refuses, since the database settings were read before it. It lists a file as left behind only under a `prefix` the media collection has to itself, one no other collection on any storage shares, contains, sits inside or begins. Without one, as by default, another collection or upload can store a file of the same form in the same place, so it lists what it finds there as files nothing shows are media's, and names any collection that shares media's place: check those with more care. The command looks only under media's prefix as it is now set, so run it before you give media a prefix: the thumbnails earlier deletes left stay where they were, outside it. It looks only at the storage the media collection uses now. If your site used another adapter, bucket or folder before, point the media storage at that one and run the command there too. The command leaves out thumbnails stored in the last hour, which may belong to an upload still in progress: if you deleted, before upgrading, an item uploaded less than an hour before you run it, run it again an hour later. On UploadThing, whose apps can hold other uploaders' files, it lists what it finds by file key and uploaded name: remove the ones that are yours from the UploadThing dashboard. Run it again after a delete whose log names a file it could not remove, or whose process stopped before it finished.
  - Deleting a folder with its contents removes every file of every item in it and in its subfolders, once their records are gone. It removed none before.
  - A file the storage refuses to remove is logged with its path and the media item, so it can be found.
  - `@nextlyhq/storage-uploadthing`: a delete UploadThing refuses (an outage, a refused token, a rate limit) now fails, so it is retried and logged like any other, rather than read as done while the file stays stored. A file already gone is still not an error.
  - A crop inside a plugin's `ctx.db.transaction` on SQLite removes the sizes it replaced once that transaction commits. They were kept before, stored indefinitely.
  - A crop or rotation whose new sizes include `thumbnail` removes the thumbnail made at upload, which nothing refers to any more.
  - A crop on SQLite saves its regenerated sizes. It failed before, because the sizes were written as an object the driver cannot store.
  - A delete and a crop of the same item at once leave no file of the item behind, and two crops at once leave no file behind that nothing refers to.
  - Storage adapters can now list their files (`list()`, optional). `@nextlyhq/storage-s3`, `@nextlyhq/storage-vercel-blob` and `@nextlyhq/storage-uploadthing` implement it; an adapter without it is reported as one that cannot be searched.

- [#2381](https://github.com/nextlyhq/nextly/pull/2381) [`95253ee`](https://github.com/nextlyhq/nextly/commit/95253eef08315de3dcf1f5d4082937035250c7a6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A read at `depth=0` returns stored ids for a Single's upload fields and for many-to-many fields kept in a junction table, as it already did for every other relationship. A Single's uploads were populated at every depth, and a junction field had no value at `depth=0`. Populated reads are unchanged.

- [#2435](https://github.com/nextlyhq/nextly/pull/2435) [`1204813`](https://github.com/nextlyhq/nextly/commit/12048134ef5ce6d583104fff959f47a700750cfa) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Who may read, change and revoke API keys follows the permission, not the key's owner, in the admin, the REST routes and the Direct API alike.
  - Anyone who may read keys (`read-api-keys`, or `update-api-keys`) sees every key, not only their own. A key still shows only its prefix after it is created, so none can be copied.
  - A key's owner (name and email) is shown only to someone who may also read users. A person always sees themselves on their own keys, and the admin's key list says "Hidden" for an owner it may not show.
  - `update-api-keys` renames any key, and `delete-api-keys` (or `update-api-keys`) revokes any key. Creating a key is still only for yourself.
  - The dashboard's key count covers every key, as the list does.

  The Direct API's `apiKeys` namespace now honours `overrideAccess: false`, set on the call or on the instance, and judges its `user` by these same rules. It is now on `await getNextly()`'s instance too, as on the module-level `nextly`.
  - Making or changing keys as an API key is refused.
  - A checked call that names no `user` is refused with `AUTH_REQUIRED`.
  - A call that names a different `user` is judged as that person, not by the instance's API key.

  Compatibility: over REST, a person holding `read-api-keys` but not super-admin now lists every key where they listed only their own. A holder of `update-api-keys` or `delete-api-keys` can now change or revoke keys they do not own, where before they got 404. Through the Direct API, only calls that ask to be checked change; trusted calls, the default, behave as before.

- [#2453](https://github.com/nextlyhq/nextly/pull/2453) [`12cf1d5`](https://github.com/nextlyhq/nextly/commit/12cf1d5cce974443a71f10d8ba09bda7442d1cc9) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API's role, permission and field-group writes honour `overrideAccess: false`, set on the call or on the instance, as the REST routes do. `nextly.roles.create`, `update`, `delete` and `setPermissions`, `nextly.permissions.create` and `delete`, and `nextly.fieldGroups.create`, `update` and `delete` ask the permission the matching route asks:
  - roles: `create-roles`, `update-roles` (also for `setPermissions`) or `delete-roles`;
  - permissions: their own action, or `manage-permissions`;
  - field groups: their own action on `settings`, or `manage-settings`.

  A super-admin passes. An API key is judged by its own grants. A checked call that names no `user` is refused with `AUTH_REQUIRED`.

  Compatibility: only calls that ask to be checked change. Trusted calls, the default, behave as before.

- [#2531](https://github.com/nextlyhq/nextly/pull/2531) [`7a9bede`](https://github.com/nextlyhq/nextly/commit/7a9bedee5552e908c144d2a6b274312bc7eeac7c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API's user and role writes (`users.create`, `users.update`, `users.delete`, and `roles.create`, `roles.update`, `roles.delete`) now honour `overrideAccess: false`, set on the call or on the instance. Each is checked as the named caller against the same permission the matching REST route asks for, and refused with `FORBIDDEN` when the caller lacks it, before anything is written. A checked call that names no user is refused with `AUTH_REQUIRED`. A role change made this way follows the same super-admin rule as REST: only a super-admin may give anyone a role that is, or inherits, super-admin. An API key is judged by its own grants. Trusted calls, the default, are unchanged.

- [#2417](https://github.com/nextlyhq/nextly/pull/2417) [`a9f0549`](https://github.com/nextlyhq/nextly/commit/a9f0549fee970670432f3230a5a6ac38604dca91) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Mod+S now runs the editor's Save action, so the shortcut always saves the way
  the Save button does. Two cases change. On a Single with Draft/Published, Mod+S
  used to save without naming a status; it now saves a draft, or stores changes
  to a published Single the way Save changes does. Creating an entry, Mod+S now
  saves a draft, as the Save draft button does, instead of saving with no status.

  Submitting the full-page entry or Single form with Enter now saves the way Mod+S
  does: a draft, or the change to a published document. It never publishes,
  even where Publish is the leading button; before, it saved without naming a
  status. Whether Enter submits in a given field is unchanged.

  `useDocumentStatus()` now reports the document's status inside the full-page
  entry editor, including from a plugin's document view. It returned `null`
  there before; the quick-edit modal and the Single editor already reported it.

  The header's save indicator now reports the document's save; recovery points move into its tooltip. A new entry shows 'Unsaved changes' once edited.

  After a save, an entry or Single shows what the server stored, such as a trimmed title or a rewritten page layout, rather than what was sent. Anything typed while the save was in flight stays on screen, still unsaved. A save that sent a link the editor cannot see keeps showing the form as sent, so the link is not dropped from the next save.

  The Page Builder's screen now offers the document's Save and Publish (or Save draft) in its own top bar, the same actions the editor's header offers. And a passage still being typed in the builder is finished before any save, whether it was started from the keyboard, a button or a menu; before, only Mod+S finished it. Once its page is saved, the builder shows it as saved, and leaving no longer warns, until it is edited again. Its Save and Publish wait for a change the page depends on that is still being written, as the header's do, instead of ignoring the press.

  A failed save's Retry belongs to the document and language it failed in: switching language, or to another document, clears it, so it can never store or publish a different translation. The Discard draft confirmation can no longer be dismissed while the discard runs. Confirming it twice before the dialog updates discards once. After a save, the editor stops offering a recovery point from before it. A save waits for every change the page depends on, including one started while it waits, and says so if changes keep arriving. A change that failed to save names itself and where to make it again, rather than offering a Retry that would fail the same way. For plugins, `useDocumentActions().run("delete")` now resolves once the delete is answered, with what it came to, and `useDocumentActions()` reports `storedAt`, when the document was last stored in this session.

- [#2400](https://github.com/nextlyhq/nextly/pull/2400) [`335a798`](https://github.com/nextlyhq/nextly/commit/335a798226437d449f6ca027895162a052c1f488) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test, the log lines written by Nextly's collection, relationship, media, auth, schema and other domain services are masked of email addresses: they now go through the service's logger, or `consoleLogger`, rather than straight to the console, with errors and values as fields. A line `consoleLogger` writes without fields no longer carries an empty trailing argument.

- [#2374](https://github.com/nextlyhq/nextly/pull/2374) [`90d0ac7`](https://github.com/nextlyhq/nextly/commit/90d0ac7130ba37624d0d13f4375f8be86ee3c2e1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test (an unset `NODE_ENV` included), email addresses that Nextly logs through its loggers, `consoleLogger` and a `logger` the app passes it included, are masked to their first character and domain (`j***@example.com`), and the log transport leaves message bodies out. Search production logs by domain and first character instead of the full address.

- [#2474](https://github.com/nextlyhq/nextly/pull/2474) [`26f098e`](https://github.com/nextlyhq/nextly/commit/26f098e10c3837e5e7ac4227166ff202d40a13a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Emails can carry the site's brand without editing HTML. Brand settings (a logo and its width, an accent colour, the background and content colours, a font from an email-safe list, and footer text and links) are stored by core and read by `GET` and `PATCH /api/email-templates/brand`, which take the permissions to read and to update email templates. Core's default layout is now written in them, the buttons of core's built-in emails take the accent, and every layout and template can read them as the `brand` variable (`brand.html` holds the logo, footer and link markup they make). A background or content colour a site chooses is kept in dark mode too, where the default layout used to swap in fixed dark colours.

  Nothing changes for an existing site until someone changes a setting: each setting starts from what the default layout showed, which renders every email byte for byte as before. On upgrade, the default layout and built-in emails still as core shipped them move to the new versions; ones a site edited stay as they are, as do the site's own layouts. `GET /api/email-templates/brand` says which emails the settings reach and why the others are not reached. In a layout's data, `brand` is always the settings: a send's own `brand` value still reaches the template body, but no longer a layout, and a template whose send supplies no `brand` reads the settings. The settings are also always available as `nextly_brand`, which core's built-in emails read, so a send carrying a `brand` of its own changes nothing in them; a send's own `nextly_brand` value is ignored. A template kept on the engine before Liquid now writes HTML marked as trusted unescaped, as Liquid does.

- [#2566](https://github.com/nextlyhq/nextly/pull/2566) [`bf8f378`](https://github.com/nextlyhq/nextly/commit/bf8f378f76fc91e077b835cab89df74fa7bdc789) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The email brand settings table is named `email_brand`, like the other email tables.

- [#2568](https://github.com/nextlyhq/nextly/pull/2568) [`029919b`](https://github.com/nextlyhq/nextly/commit/029919b1f708a2211552f8ef350a9bf4edfc5af8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every part of an email that holds Liquid is now edited in a code editor that reads it: the subject, preview text, From, Reply-To, and the HTML and plain-text bodies.
  - **Completion:** typing inside `{{ }}` or `{% %}` offers the email's variables, their properties from the sample data, and the Liquid tags and filters an email can use. Tags and filters an email can't use aren't offered.
  - **Problems as you type:** an unclosed tag or an unknown filter is named at its line, with the parser the server renders with, so a template that would fail to send says so before you save. The body lists its problems under the editor; each envelope field shows its own.
  - **Inserting a variable** from the chips goes in at the cursor of the body you're editing.
  - **Sample data** in the Data panel is edited in the same code editor, which checks the JSON.

  The editor loads when a workbench first shows it, so the rest of the admin doesn't load it.

- [#2552](https://github.com/nextlyhq/nextly/pull/2552) [`c385099`](https://github.com/nextlyhq/nextly/commit/c385099ca7d12c1ab346a0078df2a06516eb3938) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template editor lists the value its save handler reads as that handler's dependency, so admin lint passes again. No change in behaviour: a save still returns to Design for layouts and partials, and to Messages otherwise.

- [#2534](https://github.com/nextlyhq/nextly/pull/2534) [`9d3f54b`](https://github.com/nextlyhq/nextly/commit/9d3f54bc82d800730d8d258ca61275ed9766ebd5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Email has one hub in the admin, entered from the main navigation, with Messages, Design and Sending as tabs across the top. The email pages under Settings redirect to their place in it, so bookmarks and links keep working. Messages lists every email grouped by owner, with what sends it and its state (default, customised, update available, off, or kept as before), with search, owner and state filters, a create dialog, and cards at phone width. Design lists the layouts, and Sending holds the providers. Each tab shows to anyone who may read what it shows, and each change only with the permission the server checks for it, so a reader who may only look sees the lists without actions. A form's notification links to its email in the hub. The templates list now reports `keptOnOldEngine` for each template.

- [#2570](https://github.com/nextlyhq/nextly/pull/2570) [`f1cfb4c`](https://github.com/nextlyhq/nextly/commit/f1cfb4c68dbbd96dd197268f3681e460f066ecab) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Sending an email no longer reads the template engine state or the brand settings from the database each time: each instance keeps both in memory, loaded at boot and updated at once by its own changes, and reads them again at most every 30 seconds outside a transaction. On a site with several instances, a template confirmed as Liquid or a brand change made on one instance can take up to 30 seconds to reach the others; until then they send as before. A send inside a transaction never reads either on another connection.

- [#2567](https://github.com/nextlyhq/nextly/pull/2567) [`de47354`](https://github.com/nextlyhq/nextly/commit/de47354d0e00feaae67b283b9f13add525d2179b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - **Breaking:** `POST /admin/api/email/send` and
  `POST /admin/api/email/send-with-template` are removed, with their package
  exports `nextly/api/email-send` and `nextly/api/email-send-template`. Any
  signed-in user or API key could call them and choose the recipient, so anyone
  with access could send email as the site.

  To send email, call `nextly.email.send()` or `nextly.email.sendWithTemplate()`
  from server code. To send from a browser or another service, add a route of your
  own that checks who may send, and to whom, before it calls them.

  The admin's **Send test** on an email template keeps working. It now sends the
  saved template only to the signed-in user's own address, and it has no recipient
  field. It needs the `update-email-templates` permission and refuses API keys.

- [#2473](https://github.com/nextlyhq/nextly/pull/2473) [`e773453`](https://github.com/nextlyhq/nextly/commit/e773453f843ea536854c420a2051657b5921ed26) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin can say which engine each email template it contributes was written for, with `engine: "liquid" | "legacy"` on `contributes.emailTemplates` (experimental). A `"legacy"` template renders exactly as the `{{variable}}` engine did before Liquid, whatever Liquid-like text it holds, so an older template carrying `{% … %}` or a `|` as literal text keeps sending what it always sent. A `"liquid"` template, or one that declares nothing, renders as Liquid; an undeclared template Liquid can't read still renders as before. A template that names any other engine, or is declared `"liquid"` with text Liquid can't read, is not registered at startup, and an error naming the plugin and the template is logged.

  Each startup also checks the engine of every template that follows its owner's version, including one a plugin has just taken over. A change of declaration takes effect at the next start, and so does a template whose switch to Liquid did not finish after its owner's update (a database error between the two writes).

- [#2106](https://github.com/nextlyhq/nextly/pull/2106) [`f64216c`](https://github.com/nextlyhq/nextly/commit/f64216c7fc6f90d09e11d1468bf4d7154b47c9a0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every email template now has an owner: Nextly for its built-in templates and
  layouts, a plugin for the templates it contributes, or the site for the ones it
  makes. Records from the Direct API and REST carry `owner`, `overridden`,
  `ownerChanged`, `setInCode` and `description`.

  An owner's template follows the owner. Plugin and core templates used to be
  inserted once and never touched again, so a plugin could not ship a fix to its
  own email. Now each boot stores the owner's current version, unless the site
  has overridden the template. An override keeps the site's version and a copy of
  the owner's version it started from; when the owner later changes, the
  template reports `ownerChanged`, and `compare` lists each change on its own,
  with the site's lines beside it and a `review` token. `applyUpdate` takes that
  token and a choice per change (keep the site's lines, use the owner's, or use
  edited text) and applies them together, refusing once anything it compared
  has moved, returning what it replaced so `undoUpdate` can put it back. `reset`
  returns the template to its owner's version. Changing an owned template's
  subject, preheader, HTML, plain text, description or declared variables
  through `update` overrides it, so an
  edit is never overwritten at the next boot. New REST routes:
  `PATCH /api/email-templates/:id/override`, `/reset`, `/apply-update` and
  `/undo-update`, and `GET /api/email-templates/:id/compare`.

  A send now uses the site's override first, then the site's code version from
  `email.templates` in `defineConfig()`, then the owner's version. Before this,
  a stored template always won, so a configured `email.templates` function was
  never used on a new installation. Whichever version sends, the stored
  template's provider, From, Reply-To and attachments apply.

  Nothing an existing site sends changes on upgrade. A stored core or plugin
  template that differs from its owner's version is kept as an override. A site
  that configures `email.templates` keeps sending the stored template it sends
  today, as its override, until it is reset. One exception: a site that sends its
  `email.templates` version because it deactivated the stored template now sends
  it with that stored template's provider, From, Reply-To and attachments, where
  it had set them. Templates of a plugin that is no
  longer installed are kept and can be deleted. Core's templates and an installed
  plugin's can no longer be deleted (the delete used to be undone at the next
  boot); reset them instead. A template's name and whether a layout wraps it are
  the site's and are kept. Declared variables and descriptions are taken from
  the owner at the upgrade: they never change what is sent (a missing required
  variable only logs a warning), and stored declarations are mostly an earlier
  release's.

  `contributes.emailTemplates` entries accept an optional `description`.

  `EmailTemplateRecord` gains required fields (`owner`, `overridden`,
  `ownerChanged`, `setInCode`, `description`). Code that builds one itself, such
  as a test fixture or a mock of the template service, needs to set them.

- [#2373](https://github.com/nextlyhq/nextly/pull/2373) [`ef95bb2`](https://github.com/nextlyhq/nextly/commit/ef95bb2d78ea44b94c5e2fc08a7c3268d1090b5f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Email templates now render with Liquid (LiquidJS), so a template can loop over
  a list, branch on a value, and format text, numbers and dates with filters.
  Today's `{{variable}}` and `{{a.b}}` are Liquid, and every existing template
  renders as before, but for line breaks in a subject (below).

  Escaping is not up to the template author. Every value written into HTML is
  escaped as before; no filter that skips escaping is available, and the tags
  that would write a value unescaped (`echo`, `liquid`, `cycle`) or load a file
  (`include`, `render`, `layout`, `block`) are refused. HTML is written as it is
  only when code marks it with `markHtml()`, exported from `nextly` with
  `TrustedHtml` and `EmailTemplateData` (experimental). Only code marks HTML,
  and only markup it built itself: never a value from a request, a form, a
  stored row or another plugin. Nothing parsed from JSON or a stored row can
  carry the mark. A render is limited in
  template size, time and memory, and stops with an error naming the limit. A
  Liquid template's subject has its line breaks removed, so a subject value
  holding a newline sends as one line; a template kept on the previous engine
  renders its subject as before.

  A stored template that holds text the previous engine sent as written, and
  Liquid would read differently (a `{% … %}`, a filter, `{{0}}`, or text Liquid
  cannot parse), keeps the previous rendering. It is recorded at the first boot
  on this version and stays that way, through edits to its other fields, until
  its flagged text is changed and it is confirmed as Liquid.

  Saving a template Liquid cannot read is refused, naming the field and the line.
  A send whose stored template cannot be rendered fails before any provider is
  called, and is not retryable.

  The Direct API's `sendWithTemplate` variables and `preview` data accept any
  value, lists and objects included, where they were typed as strings.

- [#2475](https://github.com/nextlyhq/nextly/pull/2475) [`ba637bb`](https://github.com/nextlyhq/nextly/commit/ba637bb0ba63aa0099ddf76a26426ae0d3464bd7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An email template's Reply-To and the display name of its From can now follow
  the send's variables: a Reply-To of `{{ customer.email }}` answers the person
  an order is about, and a From of `{{ shopName }} <orders@shop.example>` names
  the shop. The From address stays fixed: a variable in it is refused on save. A
  send whose rendered Reply-To is not an address fails before any provider is
  asked, as not retryable, naming the Reply-To; one that renders empty sets no
  Reply-To. The send's own `from` and `replyTo` still win over the
  template's, and a From or Reply-To that uses no variables is sent exactly as
  before.

  Templates can copy fixed addresses on every send: `cc` and `bcc` on a
  template are added after the send's own copies, leaving out any address the
  send already reaches. Only fixed addresses are accepted, never variables. They
  can be set through the REST routes, the standalone `nextly/api/email-templates`
  handlers and the Direct API, and a change to them is recorded in the activity
  log by field name only.

  A template's owner can mark it as carrying a secret (`carriesSecret` on
  records). Such a template refuses `cc` and `bcc` on save, and sends none
  even when they are stored on it some other way. Core marks its password reset,
  email verification and welcome emails; the accounts plugin marks its
  verification, reset and address-change emails. The mark is the owner's and
  cannot be changed from the admin or the API.

  Core's templates and layout, and the accounts plugin's templates, now say
  when each is sent (`description`).

  `contributes.emailTemplates` entries accept an optional `carriesSecret` and
  `replyTo` (both `@experimental`). A plugin should mark every template that
  carries a sign-in, reset or verification link or code.

  `EmailTemplateRecord` gains required fields (`cc`, `bcc`,
  `carriesSecret`). Code that builds one itself, such as a test fixture or a
  mock of the template service, needs to set them. `email_templates` gains the
  nullable columns `cc`, `bcc` and `carries_secret`, added in place on every
  dialect. Nothing an existing site sends changes on upgrade.

- [#2554](https://github.com/nextlyhq/nextly/pull/2554) [`487ae9e`](https://github.com/nextlyhq/nextly/commit/487ae9e7a0ad9991401e5c762993061dd79c2ac2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The email workbench is laid out beside its preview at every width:
  - **Desktop:** the content column and the preview share the width, and you can drag between them to resize. Data and Details open in a side sheet that makes room beside the preview rather than covering it.
  - **Tablet:** the two panes are equal, and an open sheet takes the content's place.
  - **Phone:** Edit, Preview, Data and Details are tabs, with Save and Send test in a bar at the bottom.

  An inbox strip above the fields shows the email as an inbox lists it.

  An owner's email (Nextly's, or an installed plugin's) shows its subject, preview text and body read-only until you override it. Its settings stay yours to change. From the workbench you can:
  - override an email;
  - reset it to its owner's version, and undo the reset;
  - review an owner's update change by change, keeping your lines or using theirs, and undo the review.

  Details now also holds the email's description and its Cc and Bcc. An email that carries a secret never has Cc or Bcc.

- [#2559](https://github.com/nextlyhq/nextly/pull/2559) [`46c5b1b`](https://github.com/nextlyhq/nextly/commit/46c5b1bcc45d09ad8e4126424bd300895ea7fd29) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Reading a collection or a Single through `canReadEntity` is decided by the one access decision. No answer changes: a key is judged on its own scope, a declared read rule still decides alone for a signed-in user, and without the access-control service a signed-in user is still refused.

- [#2488](https://github.com/nextlyhq/nextly/pull/2488) [`365e525`](https://github.com/nextlyhq/nextly/commit/365e525a92ca6388ccb7a7f448c3d7c057bead1f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A request that waits out `pool.connectionTimeoutMs` now answers `DATABASE_BUSY` (503, with `Retry-After`) on the auth routes and on collection and Single entry reads and writes too, where it answered a 500 or a 503 without the retry hint.

- [#2440](https://github.com/nextlyhq/nextly/pull/2440) [`a338bed`](https://github.com/nextlyhq/nextly/commit/a338bed44ab42779dc9f29f4bbe3b69870734220) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every access rule is handed one context, and a permission is spelled one way.

  A collection's, a Single's and a field's rule now receive the same
  `AccessRuleContext` (`AccessControlContext` is the same type, and a field's
  `AccessFunction` takes it too). It holds everything each kind of rule read
  before: `user`, `roles`, `permissions`, `principal`, `operation` and
  `collection`, as a collection rule read them, and `req`, `id` and `data`, as a
  field rule read them. A collection rule now also gets `req`, a field rule now
  also gets `user`, `operation` and `collection`, and every rule gets `target`,
  `{ kind, slug }`: a `"collection"`, a `"single"`, or, for a field rule, the
  `"component"` the field belongs to. A rule written against either earlier shape
  reads what it read.

  `permissions` is now spelled as the Roles screen, the database and a route's
  `requiredPermission` spell it: `update-posts`. A rule that checks that spelling
  allows; until now it was handed `posts:update` and refused. A permission whose
  stored slug is custom, such as `manage-api-keys`, is handed as stored.

  The earlier spelling, `posts:update`, is still in the list for this release,
  after the new one, so a rule that looks a permission up keeps its answer. A
  rule that reads the list's order, its length or its first entry sees the new
  entries, which come first, and each permission twice. A rule that checks it
  with `includes`, `indexOf` or `lastIndexOf` is warned once, naming the spelling
  to write instead. It stops being accepted in a later release: change
  ``permissions.includes(`${collection}:${operation}`)`` to
  ``permissions.includes(`${operation}-${collection}`)``.

  Code that builds a context by hand, such as a unit test of a rule, now has to
  give `req` and `target` as well. The Form Builder's default rules and the blog
  template's `hasPermission` check the new spelling.

- [#2360](https://github.com/nextlyhq/nextly/pull/2360) [`d9de03a`](https://github.com/nextlyhq/nextly/commit/d9de03a872b39862a400088250733f7fd9e1f5fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A failed save in the entry editor, full-page or quick-edit, no longer wipes what you typed. The save writes your changes into its cache before the request and puts the stored entry back when the request fails, and the form reset itself to that stored entry, so every unsaved edit was lost. When the same entry arrives again, the form now takes its values only in the fields you have not changed, and keeps what you typed, the errors shown and the form's submitted state: after a failure, your edits stay on screen, still unsaved, with the error the server reported, ready to save again. A colleague's newer working draft shows in the fields you left alone. Another entry, another language, a new version saved elsewhere, or a working draft appearing or going still replaces the form, as before.

- [#2590](https://github.com/nextlyhq/nextly/pull/2590) [`8594515`](https://github.com/nextlyhq/nextly/commit/8594515396ddb95cd261719cd94206f82d09af0c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field group's settings save that removes a translated field while it adds a nested field group is now refused before anything changes, as the collection and Single settings saves already refuse it (`TRANSLATED_FIELD_REMOVED_BESIDE_ADDED`). A nested field group stores its rows in its own table, so the save's own check saw no column added beside the removed one and let it through, and the removed field's translations column was dropped with every language's value. Rename or remove one translated field and save, then add the others.

- [#2520](https://github.com/nextlyhq/nextly/pull/2520) [`267dc3a`](https://github.com/nextlyhq/nextly/commit/267dc3ac89866d51d82384c1965fc6a11a2e5808) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A field group's field rules now decide its fields on every live read: a list, a read by id, a Single read, a populated related row and a create's or update's response withhold a field inside a field group that the reader may not read, in every shape a field group is stored (single, repeatable, a dynamic zone, inside a group field), as they withhold the collection's or Single's own fields and as history reads already did. Trusted server code (`overrideAccess`) still reads every field.

- [#2572](https://github.com/nextlyhq/nextly/pull/2572) [`4ae14b6`](https://github.com/nextlyhq/nextly/commit/4ae14b6dbf5e4a784bc439b67e5cb61f33c1aa96) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A field group's field rules now decide its fields on every write, as the collection's or Single's own field rules decide theirs: a create, an update (over REST, the Direct API, inside a caller's transaction and in a bulk create), a Single update, the publish of a held draft and the restore of a version. On create a field the writer may not set is not stored. On update it keeps its stored value: an instance sent with its id is judged as an update and keeps what it held, and one sent without an id is a new instance, judged as a create. A field group inside a group or repeater keeps its stored values the same way. A publish whose pending change edits a field-group field the publisher may not write is refused, naming the field, as one editing the entry's own field is. Trusted server code (`overrideAccess`) still writes every field.

  A field rule that refuses an update to a collection's or Single's own field nested in a group keeps that field's stored value, as a refused top-level field does.

  A scoped API key's limits now apply to a Single's own field rules on update, as they already did to a collection's: the key is judged by its own grants, not by its owner's.

- [#2351](https://github.com/nextlyhq/nextly/pull/2351) [`edc1bcc`](https://github.com/nextlyhq/nextly/commit/edc1bcc5934236801d6e75f589eb47ed146c07aa) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **In production, creating the first administrator needs a one-time setup token.**
  Until an install has an administrator, whoever reached `/admin/setup` first
  could create one. Now, in production, setup asks for a token:
  - **Generated:** a production start on an install with no administrator prints
    one line beginning `[nextly] SETUP TOKEN`, with the token and the setup
    address. It is valid for 24 hours and for one setup, and only its digest is
    stored.
  - **Your own:** set `NEXTLY_SETUP_TOKEN` (at least 43 characters, 16 of them
    distinct). `nextly setup-token --generate` prints a suitable value. A weaker
    value keeps setup closed, and the start says so.
  - **Replace it:** `nextly setup-token`, run against the install's database,
    replaces the generated token and prints the new one.

  The admin's setup form asks for the token when it is needed. A valid token
  completes setup whatever the sign-in rate limit holds, and wrong ones count
  against it. Setups racing with the token create exactly one administrator.
  Development is unchanged.

  Upgrading: an empty production install needs the token on its next start (the
  log line and the setup form say where it is). Automation that creates the first
  administrator over HTTP in production sets `NEXTLY_SETUP_TOKEN`. Installs that
  already have an administrator see no change. No migration is needed.

  A new command, `nextly users:create-admin`, creates an install's first
  administrator from the command line, in the database its environment names,
  with no setup token: whoever can run it already holds the database
  credentials. It takes `--email` and `--name`, or asks for them at a terminal,
  and the password from `NEXTLY_ADMIN_PASSWORD` or a prompt that does not echo
  it, never from an argument; the password meets setup's strength rules. It
  refuses, creating nothing, once the install has an administrator or when an
  account already uses the email given, and still
  creates one over an install whose only accounts are role-less self-registered
  ones.

- [#2697](https://github.com/nextlyhq/nextly/pull/2697) [`059c534`](https://github.com/nextlyhq/nextly/commit/059c534e64c09482192f1acd52f31aa5d294890a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's setup checklist and its sample-content offer are now one Get started card, first and full width, drawn while a step this reader could take is waiting.
  - **One card.** It offers, in order, Create a collection, Add your first entry, Fill in each Single (the first five, then a control for the rest) and Invite a teammate, each only to someone who could finish it, with "x of y done". Create a collection is offered only where the schema builder is on, so a production site, where the builder is off by default, is never shown a step it cannot complete. Single and invite steps can be skipped and restored. The sample-content offer is made inside the first-entry step.
  - **Its steps travel in the layout read.** `GET /api/dashboard/layout` answers `getStarted: { drawn, answer }`, from the same computation that decides whether the card is drawn. `?getStarted=1` also answers them for a removed card, as the admin asks while restoring one.
  - **Per person, on the server.** Skips and whether the reader acted on the card are kept in the card's settings. A dismissed card is listed under Removed and comes back with its progress and skips. Once every step is done or skipped, the card says "You're all set" to a reader who acted on it, and leaves anyone else's dashboard quietly.
  - **Not known is its own answer.** When setup cannot be checked, the card says so and offers Retry, and never shows a step as waiting on that basis. A step whose own check failed or ran out of time is no longer offered as "not known": nobody knows whether the reader could finish it, so the whole answer is not known instead. The step work also stops at the deadline rather than running on.
  - **Saved dashboards convert.** A saved "Set up your project" card and sample-content card become one Get started card, with the first one's id and place, removed if either was. The retirement map gains a `removed: "any"` rule for this; every other retirement keeps "removed only if all were".
  - **Deprecated, kept for one release:** `GET /api/dashboard/onboarding`, `ONBOARDING_STEPS` (unchanged) and the admin's `OnboardingChecklist` export, which the dashboard no longer draws.
  - **New, `@experimental`, from `nextly/config`:** `GET_STARTED_WIDGET_ID`, `GET_STARTED_STEP_KINDS`, `GET_STARTED_SKIPPABLE_KINDS` and the `GetStartedAnswer`, `GetStartedStep`, `GetStartedStepKind` and `GetStartedStepStatus` types.
  - **A known limit:** on MySQL and SQLite, a Single first saved in the same second it was created is known to be filled in only from the activity trail, so once retention prunes that row (90 days by default) its step reads as waiting again. It never reads as done when it was not.

- [#2541](https://github.com/nextlyhq/nextly/pull/2541) [`b49cf66`](https://github.com/nextlyhq/nextly/commit/b49cf665972622e5b3f8200a8bf5fc5c0866428b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Setup that can't be checked no longer reads as an empty install. The dashboard's setup steps are now one server-side answer, on which the setup checklist and its condition are both based.
  - When the collections registry can't be read, the "is there content" check now answers "unknown" rather than "no content". So `content:empty` no longer holds on a registry failure, and an established site is no longer offered the empty-install cards.
  - `onboarding:incomplete` now holds while setup can't be checked, and when its own check fails, so the setup card stays visible to say so instead of disappearing as if setup were finished.
  - The setup steps are decided in one place: create a collection, add a first entry, fill in each Single the reader may edit, and invite a teammate. Each is offered only to someone who could finish it.
    - A Single counts as filled in once the activity trail has recorded a save of it since the Single was registered, so a Single deleted and made again under its slug isn't ticked by the earlier one's saves. For a Single saved before the trail recorded saves, a stored document changed after it was created counts.
    - Inviting counts once the site has a second account, which includes a pending invitation.
    - The whole answer is held to the content check's 5-second budget. A step not answered by then reads as not known, never as done.
    - The existing checklist and `GET /api/dashboard/onboarding` read their steps from this answer.
  - `GET /api/dashboard/onboarding` also returns `unknown: true` when setup can't be checked, and the existing checklist then says its progress is unavailable instead of drawing every row ticked. The field is additive: `steps` is unchanged, and a client that ignores `unknown` behaves as before.

- [#2498](https://github.com/nextlyhq/nextly/pull/2498) [`7fac9e1`](https://github.com/nextlyhq/nextly/commit/7fac9e19d0dec109bc0662492c5a276ae16b6ff7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard batch that asks one widget source several queries now isolates each of them.
  - An SEO issues card whose filter the source refuses only as it reads the answer, such as `contains` on the issue, now fails that card alone. Before, it failed every SEO card in the same batch.
  - A plugin widget source whose `resolveMany` is written with method syntax, delegating to `this.resolve`, now keeps its receiver. Before, it failed every grouped batch.
  - The `widget-source-asked-several` log line now says whether the source's many-query resolver actually answered, as decided when the batch runs.

- [#2447](https://github.com/nextlyhq/nextly/pull/2447) [`6d665de`](https://github.com/nextlyhq/nextly/commit/6d665de80ca512ae3eeb946bcf027400680dd39d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component field's own `validate` now runs on every write for a component at the top level, inside a group or repeater, inside a component held in one, or inside a group or repeater of another component; until now it never ran, so existing content that fails it is refused on its next save or publish.
  A held edit to a published Single or collection entry is validated when saved, as its publish would be; publishing a held Single shows component validators the value without its internal type tag; a Single whose localized component is only virtual keeps its drafts; and held drafts record nested components' types for restore.

- [#2329](https://github.com/nextlyhq/nextly/pull/2329) [`b792cd5`](https://github.com/nextlyhq/nextly/commit/b792cd5d5b833e2b79211e02cd2b6f8bfcc05460) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - History opens beside the document, in the document panel's place, so the editor stays as it was, unsaved words included. On a narrow window it opens as a page of its own. The panel and the version chosen in it are kept in the page's address, so a reload or a shared link opens the same version, and Back closes the panel.

  Showing a version marks it seen for the signed-in person, which is where a comparison since they last looked starts. The compare dialog is gone: a comparison opens on its own page from the version being shown, against the version before it or against the current one.

- [#2493](https://github.com/nextlyhq/nextly/pull/2493) [`9a6c604`](https://github.com/nextlyhq/nextly/commit/9a6c604f19eb3071494321538bd4c1f102542666) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In the admin's version history, a publish that shipped several languages is now pinned as the current publish in each of those languages' views (as that publish, with no version to open, in a language whose own version it did not record), and an older save of one of them is no longer pinned as its current draft. Changing the language view returns the document to its current state when the version being previewed is no longer shown.

- [#2442](https://github.com/nextlyhq/nextly/pull/2442) [`a605100`](https://github.com/nextlyhq/nextly/commit/a605100b4865d92c079a3472b7a5a952281dcd3d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A document's version history and content events now ask its read rules and hooks about each language they return. A read naming a language the reader may not read the document in answers not found. A read naming none returns only the languages they may read, plus versions and events about the whole document, and an event that involved several languages lists only the readable ones. Version history also no longer refuses a valid read when an `afterRead` hook leaves `id` out of its output.

- [#2500](https://github.com/nextlyhq/nextly/pull/2500) [`dfb4e5c`](https://github.com/nextlyhq/nextly/commit/dfb4e5c8acef8f0fa2bb17eb1c9bba5fb96f619e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A comparison of two versions now marks each change inline by default, removed text struck through and added text underlined, each in colour, with side by side as a choice each person keeps. The comparison page says how many fields changed, folds the unchanged ones behind "Show N unchanged fields", and moves between changes with Previous and Next, by keyboard as well. Fields are named with their place ("SEO › Meta title"), a setting reads Off or On, a moved block reads "Moved from 2 to 4", a removed field says it is no longer in the content type, system fields wait behind "Show system fields", and an image shows its alt text. A held draft of a document without languages now compares with its earlier saves.

- [#2462](https://github.com/nextlyhq/nextly/pull/2462) [`8459ee8`](https://github.com/nextlyhq/nextly/commit/8459ee8c2c513f4dcfd34c207edd3abd57f6e992) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's version history now tells what happened to a document. It shows a timeline under day headings: each save, publish and restore, with named versions labelled, and each unpublish and discarded draft, with who did each, and a marker where retention removed versions. Saves fold under the publish that included them. For a document with drafts, the current draft and the currently published version are pinned at the top. For a localized document, the list opens on the language being edited and its shared fields, and can switch to all languages. Filters show everything, publishes, named versions or events. Each of the newest twelve versions in the list, and each save folded under them, names the content fields it changed from the version before it. For a collection entry, a publish or unpublish now records the version it produced, and publishing a held draft records its move from draft.

- [#2502](https://github.com/nextlyhq/nextly/pull/2502) [`6d7bfee`](https://github.com/nextlyhq/nextly/commit/6d7bfeeb030ab532170875d6ee8da9dcb635dad4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - History shows each language its own versions. When one save publishes several languages, the other languages' views show that publish as an event rather than as a version you can open, and pin it as what is currently published there, with no version to open, unless that language has published again since. Previewing, comparing or restoring from a language's view no longer offers another language's versions.

- [#2331](https://github.com/nextlyhq/nextly/pull/2331) [`affdf1b`](https://github.com/nextlyhq/nextly/commit/affdf1b1001804dc0c13aad51f10a7ec4fc605ce) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A user field declared hidden (`admin.hidden`) is hidden on the user screen again. The previous release moved the hidden check from the field's wrapper into the entry form's renderer, and the user screen draws the wrapper itself, so its hidden fields showed and could be edited.

- [#2428](https://github.com/nextlyhq/nextly/pull/2428) [`ee4dfaf`](https://github.com/nextlyhq/nextly/commit/ee4dfaf7265537af7ac281efc4a6d8adbd63994c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The API key form says plainly when its viewer can no longer create keys, as when that permission is taken away while the form is open, instead of saying the chosen role allows too much.

  Compatibility: a role-based key whose role allows more than its creator may do is now refused with the code `API_KEY_ROLE_ABOVE_CREATOR`, by `POST /admin/api/api-keys` and by the experimental `GET /admin/api/api-keys/abilities`. It was `FORBIDDEN`. The status (403) and the message are unchanged. A caller who may not create keys at all still receives `FORBIDDEN`. A client that matched `FORBIDDEN` to detect the role case should match the new code.

- [#2704](https://github.com/nextlyhq/nextly/pull/2704) [`c4bbfca`](https://github.com/nextlyhq/nextly/commit/c4bbfca1277ded326bd931bc6498ddce88671af5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On MySQL, two changes to the site's language list made at the same moment on a site with no list stored yet both apply: the one that lost the race is run again from what the other stored, as on PostgreSQL and SQLite, instead of failing with a database deadlock.

- [#2622](https://github.com/nextlyhq/nextly/pull/2622) [`a8676af`](https://github.com/nextlyhq/nextly/commit/a8676aff9fa5bce30d6a99a7ff37808a7e6e5898) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The last active super-admin is kept on every route. Removing the inheritance they depend on, replacing a role's `childRoleIds`, or deleting a role is refused when it would leave no active super-admin, as deleting, deactivating or taking the role from them already is. Every active super-admin counts, whether they hold the role itself or one that inherits it, as long as their assignment has no expiry.

  Only a super-admin can take super-admin authority away from someone, by any role change: replacing their roles, unassigning a role, removing a role's inheritance, replacing its `childRoleIds`, or deleting the role. Anyone else is refused with `403`, including an API key made by a super-admin. Server code with no request caller is unaffected.

  Creating a user with roles takes the same locks in the same order as deleting a role, so the two no longer deadlock when they run at once, which aborted one of them with a retryable `409`.

- [#2644](https://github.com/nextlyhq/nextly/pull/2644) [`bb006c8`](https://github.com/nextlyhq/nextly/commit/bb006c84c8cd2778a5cfdcaa040c258a3286cb8d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The storage adapters, the database adapters, `@nextlyhq/telemetry`, `@nextlyhq/plugin-mcp` and `@nextlyhq/plugin-seo` build their declarations with oxc under `isolatedDeclarations`. Their JavaScript and published types are unchanged; the database adapters' declarations now keep the `override` modifier on overridden members.

- [#2538](https://github.com/nextlyhq/nextly/pull/2538) [`e9482a8`](https://github.com/nextlyhq/nextly/commit/e9482a85d77fa0f93a5178be27aee20a9f7c877d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A collection's list can now be filtered to the entries waiting to publish, through two reserved conditions in `where` (experimental):
  - `_pendingChange: true` keeps entries whose draft holds changes not yet published.
  - `_inRelease: { scheduledBefore }` keeps entries a scheduled release will publish after now and no later than that instant. `_inRelease: true` drops the upper bound.

  An entry is kept once, however many of its languages or releases hold it. Only the languages the read is judged for count: a read in one language, with its fallbacks, is not answered from a draft or release member in a language it was not judged for. A trusted read considers every language. A release's unpublish members are not counted. Neither is a release past its time, or one not scheduled.

  Each condition works in the JSON and the bracket form of `?where=`, beside any other condition at the top level of the filter. It is refused inside `and` or `or` (`FILTER_MISPLACED_KEY`), and for any value but those above (`FILTER_INVALID_OPERAND`). `_inRelease` also needs the right to read content releases. A caller without it is refused exactly as for a condition that does not exist, so the filter reveals nothing about what releases hold. The same refusal applies to a bulk update or delete selected by `_inRelease`, before any entry is written. The list's total and the count endpoint count the same entries the list returns.

  The admin's entry list keeps these conditions, and the language filter, at the top level of a filter it receives in its address, when its own status and date filters are added.

- [#2342](https://github.com/nextlyhq/nextly/pull/2342) [`7ae13a2`](https://github.com/nextlyhq/nextly/commit/7ae13a2f136a0af465cdb23eae30384ae9d05e1c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The blocks engine can now answer, before an edit, the lock questions a save
  answers after it. `lockBreaksIn` lists every lock break in a document, naming
  the block, the slot, the lock and what changed. `lockRefusal` names the break
  an edit would add that the document did not already have. A layout stored
  before locks were enforced still opens and can be edited, while a new break is
  refused, including any further change to the blocks of a slot already broken.

  `planRepair` plans the repair of a document that breaks a lock, as steps a
  preview can show and the document confirming them would store. A block a
  locked slot may not hold moves to just after the outermost block whose lock
  applies, missing starting blocks are added, and a block's design inside a
  `contentOnly` slot is put back as it started. No authored block is lost, and
  each keeps its id. The planner runs as a list of rules, so a later rule extends
  the repair rather than replacing it. A break the lock rule cannot repair, such
  as a block its nesting rule allows nowhere else, is left as it is and named in
  the plan's `remaining`. All three are `@experimental` until the editor that
  uses them ships.

  A lock fault from `compositionFaults` now carries `lock`: the block whose slot
  is locked, the slot, the lock and what changed. An editor can then word a break
  a placement reaches inside a component, and tell a break an edit adds from one
  the page already had. Other faults are unchanged.

- [#2470](https://github.com/nextlyhq/nextly/pull/2470) [`e884620`](https://github.com/nextlyhq/nextly/commit/e884620a69128c40f0d40e80af7f5a414337da8b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `markHtml`, `TrustedHtml` and `EmailTemplateData` are re-exported from `@nextlyhq/plugin-sdk`, experimental, so a plugin can mark HTML its own code built through the package it builds against. Only code marks HTML, never text it didn't build.

- [#2513](https://github.com/nextlyhq/nextly/pull/2513) [`897065d`](https://github.com/nextlyhq/nextly/commit/897065d021fa09b2e4bb48e10f612d44c237cf95) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Reading media and users through `canReadSystemResource` is decided by the one access decision. No answer changes: a key is judged on its own scope, a super-admin passes, and without the access-control service a signed-in user is still refused.

- [#2391](https://github.com/nextlyhq/nextly/pull/2391) [`7377561`](https://github.com/nextlyhq/nextly/commit/7377561052980129cdd1d5743d8e288fddf901c3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly media orphans --apply` stops before a batch of removals when any media item has come to have a thumbnail whose stored location cannot be worked out from its record, as the listing does, so a file such an item refers to under a renamed URL is never removed. On Vercel Blob, thumbnails under a prefix written with its trailing slash (`media/`) are found again.

- [#2320](https://github.com/nextlyhq/nextly/pull/2320) [`2b51910`](https://github.com/nextlyhq/nextly/commit/2b51910ee545052c28a5ecba42d4542d131205eb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Media stored on local disk now shows on any host and port. Reads return a medium's URL, its variants' URLs and media reached through a relationship or a Single as the storage wrote them: the local adapter's `baseUrl` followed by the file's path, `/uploads/...` by default. They used to be rewritten onto `NEXT_PUBLIC_APP_URL`, which a new project sets to `http://localhost:3000`, so images broke on any other port, a LAN or tunnel address, and preview deployments. To serve uploads from another origin, give `localStorage()` an absolute `baseUrl`. S3, Vercel Blob and UploadThing URLs are unchanged.
  - **If your code relied on an absolute local URL** (an email, a feed, JSON-LD, an app on another origin reading the API), make it absolute with the new, experimental `toPublicMediaUrl(url, { baseUrl })` from `nextly`. It resolves against the `baseUrl` you pass, else `NEXT_PUBLIC_APP_URL`. With neither set, development warns and returns the path, and production logs an error and returns `null`: it never guesses a host. Or set `localStorage({ baseUrl })` to an absolute URL.
  - Open Graph and Twitter images from `buildMetadata` stay relative and resolve against your root layout's `metadataBase`, as canonical links already do. A block page's derived Open Graph image (`@nextlyhq/blocks-react/next`) resolves the same way.
  - The blog template's JSON-LD makes its article image absolute on the site's own URL.

- [#2361](https://github.com/nextlyhq/nextly/pull/2361) [`2dcc39a`](https://github.com/nextlyhq/nextly/commit/2dcc39a2a6b033958a984f02ae9ef154c9c77874) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A local storage `baseUrl` written without its leading slash (`uploads`) serves media again: its stored URLs (`uploads/...`) are read from the site's root, as they were before media URLs began following the storage's own base, so an image in the admin resolves to `/uploads/...` rather than a path under the page it is on. In the media library, **Copy URL** copies an absolute URL again: a local file's path is made absolute on the admin's own origin, and a cloud storage URL is copied as it is.

- [#2461](https://github.com/nextlyhq/nextly/pull/2461) [`b62f245`](https://github.com/nextlyhq/nextly/commit/b62f24516976aecb0b75d8e8b1ea47334131365d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Media writes are checked when the caller asks to be checked.

  A Direct API `media` write (`upload`, `update`, `delete`, `bulkDelete`, `folders.create`) made by an instance or a call with `overrideAccess: false` now needs `create-media`, `update-media` or `delete-media`, the permission the REST media routes ask, and a checked call that names no user is refused as unauthenticated. Inside a request authenticated with an API key, a checked call that names a user but no key is refused as ambiguous: pass the key's scope, or call trusted. Trusted writes are unchanged, except that a write now records an instance-level `user` as a folder's creator and a file's uploader. A trusted `media.folders.create` that names no user still fails, as before, because a folder's creator must be a user.

  `ctx.services.media` writes take `ServiceOpts` where they took a `RequestContext`, as `ctx.services.collections` does. A write made as a person (`{ user }` or `{ as: "user", user }`) is judged as REST judges that person, `{ as: "public" }` is refused as unauthenticated, and no options or `{ as: "system" }` stays trusted. A checked write records its caller as the actor and refuses an `actor` naming someone else.

  Passing a `RequestContext` to a `ctx.services.media` write is deprecated. It is still accepted and read as `ServiceOpts`: its `user` is now checked as that user, whatever its `overrideAccess` says, and its `role` and `permissions` are ignored, because a person's roles are read from their account. A context with no `user` stays trusted, and a key scope it carries (`authenticatedScope`) is still used, as on `ctx.services.collections`.

  On the plugin services that take `ServiceOpts` (`ctx.services.collections` and `ctx.services.media`), `{ as: "system", user }` stays trusted and now keeps the user, so the write is attributed to them: a folder records them as its creator, and collection hooks are handed them. The user is for attribution only: no role lookup runs for it, so hooks on such a call see the user with no roles.

- [#2319](https://github.com/nextlyhq/nextly/pull/2319) [`aefa10b`](https://github.com/nextlyhq/nextly/commit/aefa10b422b36e409425c14516ac00ad137ae824) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly migrate` now creates the table a project's user fields are stored in (`user_ext`), with a column for each field defined in the config or in the admin, and adds the column for a field defined since. A database set up by `migrate` alone, as production databases are, had no such table until something ran `next dev` against it, so every read of a user field failed with "no such table". On SQLite the table was never created at all, at boot either: the statements that create it were sent through a call SQLite's driver doesn't have, and the failure was taken for "already exists". An existing database gains the table on its next `nextly migrate`. A user field declared `unique` now gets its unique index (on MySQL, a unique text field without `maxLength` is stored as `varchar(255)` so it can be indexed). `migrate` fails, naming the statement, when it cannot create the table, a column or an index for a reason other than its already existing; on MySQL, a unique text field created as TEXT before this release now fails that way, and changing the column to `varchar(255)` lets its index be made. With no config file found, `migrate` leaves the user fields alone rather than deleting the definitions of the fields the config declares.

- [#2634](https://github.com/nextlyhq/nextly/pull/2634) [`070c448`](https://github.com/nextlyhq/nextly/commit/070c4485ad03d350b22e7ed20c5863cfe6de4d73) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard has a Needs attention card, in place of Unpublished changes. It shows what is waiting for the reader, each as a link to exactly what it counts:
  - entries with unpublished changes, per collection, and each Single with them;
  - entries a scheduled release will publish in the next 7 days, per collection;
  - overdue releases, linking to the Releases list's overdue filter.

  Only kinds with something waiting are shown, and "All clear" when there are none. A kind the reader may not read is left out entirely, and a reader who may read none of them sees the card as not available. Counts stop at 99 per collection, and at 20 collections per kind, and then read "99+" or "N+". A small card shows the total and a short link per kind, a medium one a row per kind, and a large one each kind per collection.

  A saved dashboard's Unpublished changes card becomes the Needs attention card, keeping its place, or merges into a Needs attention card the dashboard already holds.

  Compatibility:
  - `CoreWidgetId` no longer includes `"core/pending-edits"`. A plugin naming it in `instead` or `alternatives` should name `"core/needs-attention"`.
  - A grouped widget result's buckets may carry `atLeast: true`, saying that bucket's count is a floor. Additive: a reader that ignores it reads every bucket as before.
  - New, experimental: the `system:attention` widget source, and `nextly/attention-keys`, the kinds and bucket keys its answer uses.

- [#2666](https://github.com/nextlyhq/nextly/pull/2666) [`6c95bd8`](https://github.com/nextlyhq/nextly/commit/6c95bd8c4d93d5a54e5e37fb01df024361c48815) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Needs attention card links to exactly what it counted. A grouped widget answer may carry `asOf`, the instant it was computed at, and the card measures its "publishing this week" link from that instant and the source's own window (`ATTENTION_DUE_WINDOW_MS`, from `nextly/attention-keys`) rather than the browser's clock. A Single's part key may carry the language its pending change was counted in, and its link opens that language.

  A kind whose lists were only partly read, with nothing found in those that were, now reads "Not all checked" rather than being left off the card, so the card never says all clear about lists it did not read. The source caps its per-collection parts at the widget limit and marks the answer `truncated` when more exist, and the small card links a spread kind's two largest lists before saying how many more there are.

- [#2537](https://github.com/nextlyhq/nextly/pull/2537) [`eee467e`](https://github.com/nextlyhq/nextly/commit/eee467e3400d6f10a475fdafb84f213cde9d1e7e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component placed directly in another component is shown in the admin again where the outer component is held in a named group or a repeater. There its value is stored, so it can be edited, and a required one can be filled. It's still left out, and not required, where the outer component is stored on its own (at the top level, or under rows, tabs, collapsibles or an unnamed group), and a value for it there is refused with `NOT_STORED`.

- [#2490](https://github.com/nextlyhq/nextly/pull/2490) [`a3da6e2`](https://github.com/nextlyhq/nextly/commit/a3da6e23260c77aa8ee382e0abe1e38546ede400) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component held inside a group or repeater, or inside a component held in one, is now validated against its own fields on every write, its own `validate` included; until now nothing judged it, so existing content that fails it is refused on its next save or publish. A component held in a group or repeater of another component is validated the same way; one placed directly in another component's fields is stored and validated where the outer component is held in a named group or a repeater, and elsewhere isn't stored, and a write that carries a value for it is refused with `NOT_STORED`.
  A held Single's first draft records the type of every component it holds, including those it didn't change, so a restore after a retarget stays correct.

- [#2345](https://github.com/nextlyhq/nextly/pull/2345) [`d4e1357`](https://github.com/nextlyhq/nextly/commit/d4e1357bfc120ff945c4a8e9f1726781c0a9cbf0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - New projects get the skills for coding agents again. `create-nextly-app` writes its bundled skills into a project only when they name the project's exact `nextly` release, and 0.0.2-alpha.68 shipped skills still naming 0.0.2-alpha.67, so a project made with it got none and was told so. Each release now stamps the skills with its own version when it is cut, and refuses to publish skills that name another release.

- [#2617](https://github.com/nextlyhq/nextly/pull/2617) [`2495e84`](https://github.com/nextlyhq/nextly/commit/2495e84503d2a31f96370e0d235e90837f7636b3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Move to Next.js 16.4.1 or later and sharp 0.35.5 or later. Next.js releases before 16.4.1 (and before 15.5.28 on the 15 line) carry two critical advisories that allow unauthenticated remote code execution, and sharp before 0.35.5 carries the librsvg vulnerability one of them depends on:
  - [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) (critical): remote code execution in `use cache` functions returning typed arrays, Next.js 16.0.0 to 16.4.0, fixed in 16.4.1.
  - [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) (critical): remote code execution in Image Optimization when SVG files are used, fixed in Next.js 15.5.28 and 16.4.1, and by sharp 0.35.5 or later.
  - [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) (high): the librsvg vulnerability in sharp before 0.35.5.
  - [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) (high): denial of service in the App Router through Server Actions, fixed in Next.js 15.5.28 and 16.4.1.

  Every package that declares a peer on `next` now asks for `^15.5.28 || ^16.4.1`, and `nextly`'s optional peer on `sharp` asks for `^0.35.5`, so a project on an affected version sees a peer warning when it installs. Next.js 14 is no longer supported: no 14.x release fixes GHSA-2464-fhr4-w9xw. To upgrade, run `pnpm add next@latest sharp@latest` (or your package manager's equivalent).

- [#2606](https://github.com/nextlyhq/nextly/pull/2606) [`859d13a`](https://github.com/nextlyhq/nextly/commit/859d13aa0b549f88b7b5583d1947799a1a5cd6cc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Projects scaffolded by `create-nextly-app` now ask for React `^19.3.1`, the version Nextly is built and tested with. They already get the newest Next.js at scaffold time. Inside the repository, the playground and the packages build and test on Next.js 16.4.2 and React 19.3.1. What the packages accept from an app is not changed by this release note: `next` is `^15.5.28 || ^16.4.1`, raised separately for the October security advisories, and React is 18 or 19 (`@nextlyhq/blocks-react`, `@nextlyhq/builder` and `@nextlyhq/plugin-page-builder` need React 19).

- [#2672](https://github.com/nextlyhq/nextly/pull/2672) [`b248448`](https://github.com/nextlyhq/nextly/commit/b24844852dce69d88a4305ca2f709591139c865b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly`'s published declarations are now written by the TypeScript compiler's own command line and then bundled by tsdown, instead of through tsdown's TypeScript plugin. What `nextly` publishes is unchanged: the same entry points, the same JavaScript, and declarations of the same meaning (one union is printed with its members in a different order). For contributors, `pnpm dev` still keeps `nextly`'s declarations current while it watches, now through the same two steps as `pnpm build`.

- [#2416](https://github.com/nextlyhq/nextly/pull/2416) [`bf1a301`](https://github.com/nextlyhq/nextly/commit/bf1a301660d5937bc9e2c842313467fa1db17741) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Nextly no longer writes `payload-types.ts`. Since 0.0.2-alpha.67 the generated types go to `nextly-types.ts`, and for those releases a project still holding a generated `payload-types.ts` had it turned into a one-line re-export of the new file. That bridge is gone: when the types path is left at its default, the generator writes only `nextly-types.ts` and leaves any `payload-types.ts` as it is, saying what to do.
  - **The re-export alpha.67 or alpha.68 wrote** keeps compiling. Change imports of `payload-types` to `nextly-types`, then delete it.
  - **A `payload-types.ts` an earlier version generated**, from a project that skipped those releases, is no longer turned into a re-export. Unless it was generated with `--no-declare`, it declares `module "nextly"` as `nextly-types.ts` does, so the two clash and TypeScript may use the old types. Delete it and change imports of `payload-types` to `nextly-types`.

  To keep the old name, set `typescript.outputFile` to it.

- [#2603](https://github.com/nextlyhq/nextly/pull/2603) [`28db6e8`](https://github.com/nextlyhq/nextly/commit/28db6e859aad30b5e031087f123f761b4affcdd7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Node 20 is no longer supported. Every package now requires Node `^22.12.0` or `>=24.0.0`, and Node 24 LTS is the recommended version. Node 20 reached end of life in April 2026, and the test and build tools Nextly moves to next need 22.12 or later, so installing on Node 20 now warns about the engine range. Upgrade Node before you upgrade Nextly; nothing else in your project has to change. Configs compiled by the CLI now target Node 22, and apps and plugins created with `create-nextly-app` declare `@types/node` `^22`.

- [#2386](https://github.com/nextlyhq/nextly/pull/2386) [`a478b9d`](https://github.com/nextlyhq/nextly/commit/a478b9d46541130398709db1d9d2fd65ae031e0f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal: adds the building blocks of a single access decision — one caller shape, a decision that judges a caller, an action and a collection or Single the same way for every kind of caller, and a per-request memo of whole-target decisions. Nothing calls them yet, so no access answer changes.

- [#2620](https://github.com/nextlyhq/nextly/pull/2620) [`6190765`](https://github.com/nextlyhq/nextly/commit/6190765c9dec57f6dee058f6b43c523360aba879) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's data function is typed to receive the batch's `scope`, and a card's data and a widget's `example` are held to one rule.
  - **`WidgetDataInput` gains `scope`** (`@experimental`): the same per-batch scope core's own sources share work through, so two cards needing one scan can ask for it under one key and run it once. An addition to what a data function is handed; nothing a widget declares changes.
  - **One rule for a card's data:** a value must reach the browser as itself and, for one of core's displays, have the shape that display draws, checked in that order. Startup's check of a declaration's `example` now asks this rule. No startup verdict changes: an example holding NaN, an infinity or an `undefined` array item was refused before, in the same words.

- [#2445](https://github.com/nextlyhq/nextly/pull/2445) [`ac210a9`](https://github.com/nextlyhq/nextly/commit/ac210a99bde5ae2bdda09147c7c31053e8c7a9f2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The shared permission cache now works on MySQL: its writes used syntax only PostgreSQL and SQLite accept, so every write failed silently and each permission check recomputed. A stored grant now reads back as one on every dialect, and a role or role assignment taken away is seen by the next request on MySQL too, where a retirement made late in a second could keep the old answer until the next one.

- [#2641](https://github.com/nextlyhq/nextly/pull/2641) [`e7ff551`](https://github.com/nextlyhq/nextly/commit/e7ff551d2ba66c418849ab7170b9c59a93c3e8c9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-form-builder` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2469](https://github.com/nextlyhq/nextly/pull/2469) [`a4cc703`](https://github.com/nextlyhq/nextly/commit/a4cc703f008b15eb038bd67941a397f60acc8378) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin's history writes are checked when it says who it acts for.

  `ctx.services.versions`' `setLabel`, `deleteWorkingDraft` and `autosave` take a new, optional trailing `ServiceOpts`. Existing calls, which pass none, are unchanged and stay trusted, as does `{ as: "system" }`. A write made as a person (`{ user }` or `{ as: "user", user }`) is judged as the REST history routes judge that person: it needs `update-<collection>` (or the Single's), then the document must be one they can read, refused as not found when it is not, and one they may update. An autosave also needs the entity's autosave to be on. `{ as: "public" }` and a plugin-defined person are refused as unauthenticated.

  On a checked write the person is the author, as on REST. Naming a version with no `by` records them as the one who named it, and an autosave with no `createdBy` is filed under them. A `by` or `createdBy` naming anyone else is refused, and nothing is written. The name recorded is the caller's own, never one the plugin passes. A label set for an API key records no namer, because a plugin does not know the key's own id, and naming the key's owner would put a person against a change they did not make. A page's history has no REST write to be judged as, so a checked write to it is refused. A checked label is refused, as not found, when the caller may not read the version's own language, as on REST. A checked label hands back its version as the caller may read it, with fields their read rules withhold left out. A checked discard goes through the same discard as REST, which holds the document while it removes the draft and records the discard in its history; one made with an API key is refused, because a plugin cannot name the key that would be recorded. A checked autosave made with an API key is refused for the same reason: filed under the key's owner, it would overwrite that person's own unsaved work.

  Every plugin autosave, checked or trusted, is now stored the way REST's autosave stores one, a list of rows included: without password values, and refused when the fields that say which values are passwords cannot be read. The snapshot the plugin passes is not changed.

  `CollectionsHandler`, its entry service and `SingleEntryService` gain `discardWorkingDraftCounted`, which discards as `discardWorkingDraft` does and answers how many drafts it removed. `discardWorkingDraft` keeps its signature on each.

- [#2463](https://github.com/nextlyhq/nextly/pull/2463) [`e2081f0`](https://github.com/nextlyhq/nextly/commit/e2081f0053ee966c2c8381e166ae7ffbf5a3aa97) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `nextly migrate` now checks every plugin's migration history before it changes
  anything, the core tables included, and refuses — naming the plugin and the
  migration — when:
  - a plugin lists its migrations in an order other than the order of their
    names, which is the order they run in (also refused wherever the
    configuration loads, so such a list stops the app from starting, not only
    `nextly migrate`);
  - a migration the database records as applied has been edited, removed or
    renamed;
  - a migration that has not run is ordered before one that has.

  Lists written by `nextly migrate:create --plugin` are already in name order,
  so only a list edited by hand is affected: list the migrations in name order,
  restore the applied migration, or give a new migration a name that sorts after
  the applied ones. A migration rolled back by hand from the middle of a plugin's
  history is refused the same way until the migrations after it are rolled back
  with `nextly migrate:down --plugin`; then run `nextly migrate`.
  `nextly migrate:resolve --applied` does not take plugin migrations.

  A plugin migration whose run was stopped after its statements committed — on
  MySQL, which commits schema statements as they run, or one marked to run
  outside a transaction — is now recorded as applied on the next run when its
  statements are exactly the schema change `nextly migrate:create --plugin`
  writes for it and the database stands at its result.
  Before, it was refused until `nextly migrate:resolve --failed-cleanup`. A
  migration that also changes rows, whose result is its starting point, or
  whose statements were written or edited by hand, is still refused, with the
  same advice.

  A drift refusal now names the column, check or foreign key it found different,
  where it used to say only the kind of change.

- [#2653](https://github.com/nextlyhq/nextly/pull/2653) [`9c111af`](https://github.com/nextlyhq/nextly/commit/9c111af9b554bea634e0f51f0f1ac38be777dbf4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-page-builder` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2599](https://github.com/nextlyhq/nextly/pull/2599) [`e03de7d`](https://github.com/nextlyhq/nextly/commit/e03de7de38e053129a4158f53d72d024f9e26e89) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A new plugin from `create-nextly-app` gets Vitest 5 (`vitest ^5.0.5`) instead of Vitest 4, with `vite` declared beside it (Yarn installs no peers, so `yarn test` could not load Vite without it).

  Vitest 5 needs Node 22.12 or later, so the plugin's `package.json` now says so in `engines` (`^22.12.0 || ^24.0.0 || >=26.0.0`).

  In a test written for Vitest 4, check for these:
  - `expect(promise).resolves` or `.rejects` that isn't awaited now fails the test.
  - Mock call history is cleared before every test (`clearMocks` is on by default).
  - `vi.mock` and `vi.hoisted` inside a function or block now throw.

  The full list is in Vitest's migration guide: https://vitest.dev/guide/migration

- [#2647](https://github.com/nextlyhq/nextly/pull/2647) [`0295a2e`](https://github.com/nextlyhq/nextly/commit/0295a2e6f8b78393db17121bf90a69016293cb6e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-sdk`'s declarations are written by oxc from its own annotations, and are the same as before. `Secret` still redacts itself under `util.inspect` and `console.log`. Plugin migrations generated by `nextly migrate:create --plugin` now end `satisfies PluginMigration as PluginMigration`, so a module's declaration is its type; what a migration contains, and its checksum, are unchanged.

- [#2419](https://github.com/nextlyhq/nextly/pull/2419) [`d9b2d6a`](https://github.com/nextlyhq/nextly/commit/d9b2d6a0f0ee5fe64683c1a73b97795e2319b2f8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `nextly plugins uninstall` now refuses to run its DOWN migrations when the
  plugin's `onUninstall` replaced one of the tables they drop by renaming it
  away and creating another under its name. Before, only
  the name was checked, so the approved drop took the replacement, and the
  original table and its rows survived under the other name while the plugin
  was recorded uninstalled. Each table is now identified by what the database
  keeps for it (its oid on PostgreSQL, its creation time on MySQL, its root page
  on SQLite), read before the hook's boot and again after the hook. On MySQL the
  creation time has one-second resolution and changes on any `ALTER TABLE`, so a
  hook that alters one of those tables is refused, and a replacement created
  within the same second as its original is not detected. On SQLite, where a root page can
  be given to a new table, a hook that changes the schema at all is refused
  too. The refusal comes after `onUninstall` has run but before any DOWN
  migration, so no table is dropped and every module is still recorded as
  applied. A table whose identity can't be read is refused before the hook
  runs.

  A disabled plugin's transform that moves a field into another group or tab
  keeps that field's access rule even when the collection has an index with the
  same name as the field. Only fields are now matched by name.

- [#2340](https://github.com/nextlyhq/nextly/pull/2340) [`b9790cd`](https://github.com/nextlyhq/nextly/commit/b9790cdad91ba9020909df6ac9d1a556557912a8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly plugins install --all` installs every enabled plugin in your config, in
  dependency order, and stops at the first that fails. A disabled plugin is
  skipped and named. It is what a fresh database needs before its first
  production boot, which refuses a configured plugin no install has recorded.
  `nextly plugins install <name>` is unchanged.

  A production boot no longer requires a disabled plugin (`enabled: false`) to be installed. Before, a config that disabled a plugin could never boot in production, because the install refuses a disabled plugin. A disabled plugin's tables still exist, since its schema still applies, but its `onInstall` runs only once it is enabled and installed; the boot then requires that install like any other. A disabled plugin that was uninstalled, or whose uninstall stopped part way, is still refused.

- [#2565](https://github.com/nextlyhq/nextly/pull/2565) [`64bac79`](https://github.com/nextlyhq/nextly/commit/64bac79797c136cf2f4c0d152a3b1bb6811883f6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - What a read that populates relationships shows its caller is decided by the one access decision. No answer changes: a key is judged on its own stored scope, a declared read rule still decides alone for a signed-in user, a visitor keeps the public default and media, and a row the caller could not read by name is still withheld.

- [#2390](https://github.com/nextlyhq/nextly/pull/2390) [`1dcec94`](https://github.com/nextlyhq/nextly/commit/1dcec943fdd6845ef54744dd50b3c5eba487ac0a) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Preview links are now recorded one by one. A document's live links can be listed, with who made each, when it ends and how many times it was opened, and any one of them can be revoked, which ends it on its next opening and in any session it already opened. All of one entry's or Single's links can also be revoked at once. Sharing, listing and revoking a document's links all need the same permission: being able to share a preview of that document. The list, revoke-one and per-document revoke-all endpoints are `@experimental`. Run `nextly migrate` after upgrading to create the `nextly_preview_links` table; until then, sharing a new link is refused with that remedy. Links made before the upgrade keep working until they expire, and both revoke-alls still end them.

- [#2540](https://github.com/nextlyhq/nextly/pull/2540) [`0058669`](https://github.com/nextlyhq/nextly/commit/0058669a5083274e200d81aba9c881e7bb7e4a10) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A preview link's sharer is judged in the language the link is to. When an entry's link names a language, the sharer's read and edit of the entry are asked in that language when the link is made and every time it is opened, so a read rule that closes another language no longer stops the link from being minted; a link naming no language is asked in every language, as before. A Single's link now asks its sharer in its language at every open too, not only when it is made. An entry link for one language no longer answers for another translation of the entry. A preview link is still honoured only by the preview render: REST, the admin, the Direct API and plugin routes judge a request that carries one as its sender.

- [#2726](https://github.com/nextlyhq/nextly/pull/2726) [`4205cec`](https://github.com/nextlyhq/nextly/commit/4205cec2836c02fd4b9419aab0fcaeff0a23c35a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A collection publish whose pending change edits a field the publisher may not write, inside a group the publisher sends with the publish, is refused again and the pending change is kept. The field gate keeps that protected value at what the live row holds, so the publish had read the change as no change at all, published, and deleted the draft with the edit in it. A protected value the pending change adds inside such a group is refused the same way. A publish that sends a group with a protected child at its live value, where the pending change left that child alone, now publishes rather than being refused.

- [#2512](https://github.com/nextlyhq/nextly/pull/2512) [`4beae2b`](https://github.com/nextlyhq/nextly/commit/4beae2b80b9a5bcee4d4f7448ea9909dda378725) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Publishing a language's pending change no longer puts back a shared value that someone else published after the change began. A pending change records the version it began from when the document's last 25 versions still hold one with the live shared values. One without such a base, which includes every pending change begun before this release, is refused while any shared field it holds differs from the live value, its own edits included. Taking the live values replaces those edits in the fields the caller may write; a field the caller may not write, or a shared part of a translated component, keeps its edit to be copied by hand, and the change stays unpublishable until it is. When a shared field's live value has moved on since, the publish is refused with a 409 that names the field (fields the caller can't read are counted, not named), and nothing changes. Taking the live values for the pending change brings it up to date, and the next publish goes through. The refusal's data is `{ reason, fields, hiddenCount? }`, exported as `SharedFieldsConflictPublicData` from `nextly/errors`; `reason` is `shared-fields-out-of-date` here. When every language of a Single is published together, the later edit's value is kept for a shared field two languages both changed. When version history can no longer show which edit was later, that publish is refused instead, with the reason `shared-edits-unordered`, and publishing one language at a time settles it.

  Publishing a language's pending change no longer puts back a shared component or a shared many-to-many relation that someone else published after the change began. These are now checked against the change's base like the shared columns: an out-of-date one is named in the 409, and taking the live values brings it up to date. Components are compared by content, so a publish that only rewrote a component's rows doesn't refuse anyone. A component whose values are kept per language is judged by its shared parts: its instances and the sub-fields it marks shared. Publishing every language refuses with the reason `shared-edits-unmergeable` when more than one language is pending and any of them changed such a component's shared parts, since each language's copy would write over the others'; publishing one language at a time settles it. Taking the live values is also available over REST, at `POST …/versions/working-draft/take-live?locale=` for a collection entry and a Single, and in the admin: a publish refused over out-of-date shared fields offers "Take the live values" on the refusal itself, keeping the editor's own edits.

- [#2372](https://github.com/nextlyhq/nextly/pull/2372) [`9bb7abe`](https://github.com/nextlyhq/nextly/commit/9bb7abea38f8c33eb4c5c9ea770b768d3216a590) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A subject's content events can now be read: a document's, or a release's, filtered by kind and part, newest first, page by page. All `@experimental`.
  - REST: `GET /collections/{slug}/entries/{id}/events`, `GET /singles/{slug}/events`, and `GET /content-events?subject=collection|single|release&slug=&id=` for releases and deleted documents. Each takes `?kind=`, `?part=`, `?limit=` (1 to 100) and `?before=` (the last item's id).
  - Direct API: `nextly.contentEvents.list({ subject, kinds, parts, limit, before })`.
  - Plugins: `ctx.services.versions.listEvents(subject, query, opts)`.

  A caller reads a document's events when it may read the document, through the same check as its version history. A deleted document's events are read by whoever may read its collection or Single. Where its read rule is a function, only a super-admin signed in reads them; where read hooks may narrow its reads, only trusted server code does, since neither can be asked about a row that is gone. A release's events are read with release read authority. A refusal answers not found. Each read shows one life of a document id: a document deleted and made again under the same id does not mix its two histories.

- [#2619](https://github.com/nextlyhq/nextly/pull/2619) [`276d4ab`](https://github.com/nextlyhq/nextly/commit/276d4aba2d48771abde2bc5524fe40c613358fff) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Recent activity card is now an ordinary framed card, answered by a new `system:activity` widget source through the dashboard's batch request, the same way the other cards are.
  - `system:activity` makes the same read as `GET /api/dashboard/activity`, through the same service call: the same per-row read check, the same grouping of repeated saves, the same row limit. The card and the endpoint show a reader the same rows. The source refuses any query field it doesn't answer (a filter, a sort, a status).
  - The card has a "Number of items" setting (1 to 25, 5 by default) and draws the rows its size allows. When there are more, it says "More exist", like the other list cards. With nothing to show, it uses the standard empty state.
  - A custom widget can ask to be sized like core's lists, with `sizedQuery: true` (experimental) on a widget whose query is a list: the dashboard then asks it the rows its size draws and one more, so it can say more exist. The Recent activity card does this. A custom widget that doesn't is asked exactly its declared query, as before.
  - `WidgetComponentProps` gains an optional `query` (experimental), the query the card asked with its reader's settings applied, and an optional `onRetry` (experimental), the Retry a framed card's error offers, which a custom card can now offer on its own error.
  - Recent activity now leaves out collections kept off the dashboard (internal, or hidden from the admin's navigation, such as the page builder's patterns and layouts), for every reader, super-admins included. This is the rule the dashboard's other cards and its 24-hour activity count already apply. If the collections registry can't be read, the feed shows no rows rather than risk showing a hidden collection's, as the count shows none.
  - The activity read applies one row limit for every caller: 5 by default, at most 50.
    - `GET /api/dashboard/activity` already clamped to 1–50 with 5 by default, so it's unchanged, `?limit=0` and a non-number still answering the default.
    - A direct caller of the activity service that passes no limit now gets 5 rows instead of 10.
  - `RecentActivity` (the section reading the endpoint) and `useRecentActivity` stay exported, deprecated; the dashboard no longer uses them.

- [#2597](https://github.com/nextlyhq/nextly/pull/2597) [`365a5e7`](https://github.com/nextlyhq/nextly/commit/365a5e70b3e40cc7bec459eda24d9f594b47619a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recent activity shows one person's repeated saves of one document as one row with a count: "updated Site style · 12 times", at the latest save's time. The activity trail still keeps every save as its own row; only the feed groups them.
  - A save joins the row before it when it is the same person's update of the same entry or Single, made within 10 minutes of the next later save in the row. A long editing session stays one row.
  - A row someone can't see doesn't split a group for them, so the grouping never hints that something happened in between.
  - Creates, deletes, settings changes, and any save that published or unpublished stay rows of their own, even a save that also edited fields.
  - A page of the feed always ends after a whole group. The activity service's result carries `next`, a position strictly after the oldest save of the last row shown, and `getRecentActivity` takes it back as `before`. `offset` still counts rows of the trail, not of the feed.
  - Each feed row carries `count`, `countAtLeast` (true when the read stopped inside the group, drawn as "N+") and `firstCreatedAt`. These are additive response fields. The "changes in the last 24 hours" figure still counts every save.
  - Until a Single's saves record which fields they changed, publishing a Single isn't told apart from saving it, so it can join that Single's group.

- [#2501](https://github.com/nextlyhq/nextly/pull/2501) [`2fc555e`](https://github.com/nextlyhq/nextly/commit/2fc555ecc72b84a602e13c4886046902ea8bbb52) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's "Changes (24h)" figure now counts only the changes the reader may see. It is counted by the same check as Recent activity, so a change to a document the reader may not open is no longer counted, for collections and Singles alike. On a busy install the count stops after reading the latest 1,000 changes, and the figure reads what it found with a `+`; `/stats` says so with a new `recentChanges24hAtLeast: true`.

- [#2733](https://github.com/nextlyhq/nextly/pull/2733) [`acc0b50`](https://github.com/nextlyhq/nextly/commit/acc0b5083301c6011fa7ab9251c6b6805b65fde0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recent entries and Over time, two content widgets offered from a collection's group of the add panel.
  - **Recent entries** (`core/recent-entries`) lists a collection's entries changed most recently, every row a link to its entry, with a "View all" link to the collection's list under the card's Filter and Sort. Small lists titles; medium adds each row's status and when it was updated; large is a table. Its Collection setting declares `rows: "titled"`: the card asks each row's title field, its status where the collection has a lifecycle, and `updatedAt`, and a collection naming no title is not offered it.
  - **Over time** (`core/over-time`) draws how many entries a collection gained in each interval of its Date range, its quick setting: 7 or 30 days by day, 90 days by ISO week, 12 months by month. Every interval the range overlaps is drawn, the first counting only what falls inside the range. Chart style draws it as a line or as bars.
  - **Widget queries** take `range` on a timeseries (`"7d"`, `"30d"`, `"90d"`, `"12m"`): the server derives the interval, the intervals drawn and the range's first instant. A query sending `range` with `since`, `until` or `interval` is refused.
  - **Published collection sources** carry `titleField` where the reader is offered that field, and the knobs' context offers `sourceOf`.
  - **Cells cards:** a setting only a cell source's filters would apply is refused at registration, as is a contributed custom card declaring both a query and cells; a card first drawn below every cell's tier asks for its cells once it widens.

  All of it is `@experimental` while the content widgets are built.

- [#2693](https://github.com/nextlyhq/nextly/pull/2693) [`18e57b7`](https://github.com/nextlyhq/nextly/commit/18e57b7ed6e2f08ae40f72bde7d6f9b74f8e33da) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recently edited draws each row as a link to its document: titled "Untitled" when it has none, and from medium up its collection, who saved it, when and its status. An empty card names the span the trail keeps ("No edits in the last 90 days"), from an optional, experimental `window` on a list answer; a span under a day is not stated. A publish of pending edits takes the row from the person who made them only when its own request changed something they had not.

- [#2678](https://github.com/nextlyhq/nextly/pull/2678) [`a4f8978`](https://github.com/nextlyhq/nextly/commit/a4f89781a2513c179dedcc2049726b85e1154f1a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recently edited now lists the entries and Singles most recently saved, newest first, one row per document at its latest save the reader may see, across every collection they may read. It reads the activity trail, the same one Recent activity reads, through a new source, `system:recent-edits`, and each row carries the document's status now and whether it has changes not yet published. A publish or an unpublish on its own is not a save, and a promotion of pending edits keeps the editor's row.
  - **The trail says when a write published.** Every path that can publish an entry or a Single marks its row `published: true`, so a promotion of pending edits, which leaves the status published, is no longer read as a save, and Recent activity keeps it out of a run of saves.
  - **A Single's save names the fields it changed**, compared by value as an entry's are, on every install.
  - **No id where a title belongs.** A save of an untitled entry stores no title, instead of the entry's id.
  - **`WidgetSource` gains `filters`** (`@experimental`): the card settings a source narrows by rather than being replaced by. `system:recent-edits` takes `collection` and `onlyMine` as top-level `where` keys, and query validation admits exactly those.

- [#2686](https://github.com/nextlyhq/nextly/pull/2686) [`3241734`](https://github.com/nextlyhq/nextly/commit/3241734af409a5ae641b9faeddf495d5beb6e4ce) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every refusal is answered in the error body every other error already uses.

  A request the REST route gate, the media routes, the admin's workspace and sidebar routes, an API key's budget, the REST rate limit, the sign-in rate limit or the exported `auth/guards` helpers refuse is now answered as `{ "error": { "code", "message", "requestId" } }`, with `Content-Type: application/problem+json` and the request id also in `x-request-id`, as every other error is. The status, and the message, are unchanged. Headers such as `Retry-After` and `X-RateLimit-*` stay headers; a limit's retry hint is also in `error.data.retryAfterSeconds`.

  **Upgrading:**
  - A client that read a refusal's `data.error`, `data.message` or `data.code` reads `error.message` and `error.code`.
  - The REST rate limit's and the sign-in rate limit's code is now `RATE_LIMITED`, the code every other limit answers with; it was `RATE_LIMIT_EXCEEDED`. `error.retryAfter` is now `error.data.retryAfterSeconds`.
  - `createJsonErrorResponse` from `auth/guards` returns the same body, so a route built on `requirePermission` or `requireApiKey` answers as the rest of the API does. Pass the request as its second argument to answer with the request's own id; without it a new id is made.
  - A public media URL that serves no file answers its 404 with the same body rather than an empty one.

- [#2276](https://github.com/nextlyhq/nextly/pull/2276) [`b273c12`](https://github.com/nextlyhq/nextly/commit/b273c12f05826b65e4eda55cdbf822a3c3f19f2e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard widget whose component the admin can't load no longer draws an empty card: in development the generated
  component map is rewritten, and in production the admin refuses, naming the widget and the command to run.
  Apps opt in by calling `checkAdminComponents` (from `nextly/runtime`, experimental) in their admin layout; see the admin UI docs.

- [#2099](https://github.com/nextlyhq/nextly/pull/2099) [`a1ecead`](https://github.com/nextlyhq/nextly/commit/a1ecead9094a3fbe9633324ba7d3a7f24076bf5e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - App tables can no longer be named `accounts` or `sessions`. Those are retired auth table names, and `db.schema.extend` now refuses them with a message naming the reserved name.

- [#2171](https://github.com/nextlyhq/nextly/pull/2171) [`33ab4ae`](https://github.com/nextlyhq/nextly/commit/33ab4ae8caf02ebf30da1120314fcb9526ba2ab7) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A migration can no longer change another owner's table, column, index or constraint in a form the guard cannot read. A column or constraint the same migration adds to a table may be changed later in that migration, and is no longer refused as the other owner's. An ALTER TABLE that names an index, and MariaDB's ALTER KEY on another owner's index, are refused.

- [#2304](https://github.com/nextlyhq/nextly/pull/2304) [`0a95cd3`](https://github.com/nextlyhq/nextly/commit/0a95cd31a189372fca42cb1c3ffea686b593f2bd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Self-registration is now off by default.** The registration route refuses
  every sign-up, creating no account and sending no email, unless the app turns
  it on with `auth.allowRegistration: true` in its Nextly config.

  Upgrading: an app whose users sign themselves up must add
  `auth: { allowRegistration: true }`, or registration answers 403 "Registration
  is not open." An account already registered and awaiting verification can
  still complete it by its link. No migration is needed.

  **A registered account never becomes the install's first administrator.**
  Until now, whoever created the first account on an empty install, through
  registration included, was made Super Admin. Now a registered account never
  is. An account the app provisions itself (its admin or its own server code)
  becomes the administrator only when it is the install's very first account;
  once any account exists, a sign-up included, an account the app creates is
  never promoted. Setup creates the administrator whenever nobody holds the
  Super Admin role, so a role-less account registered first never blocks it. Two
  accounts provisioned at once on an empty install leave exactly one
  administrator, on every database; before, both could become Super Admin.

  **Setup stays open until someone holds the Super Admin role**, rather than
  closing at the first account, so the owner can still create the administrator
  after a stranger has registered. An install that has accounts but where nobody
  holds Super Admin now reports setup as open: give one of its accounts the role
  before upgrading. An administrator whose authority comes through a role that
  inherits Super Admin counts as one. Setup never takes over an existing account:
  an address that already has one, such as a sign-up, is refused.

  Setups racing on an empty install make exactly one administrator: the others
  are answered that setup is complete, and create no account.

  **For code that builds the auth router's dependencies itself** (`AuthRouterDeps`
  from `nextly/auth`): `getUserCount` is replaced by `hasAdministrator`, which
  answers whether anyone holds Super Admin; `allowRegistration` is added; and
  `createSuperAdmin` may resolve to `null` when another setup made the
  administrator first. Apps that use Nextly's own route handlers need no change.

  Creating the Super Admin role from two requests at once no longer fails on
  MySQL with a duplicate. On MySQL, creating it next to an existing role that
  already has the name "Super Admin" no longer turns that role into the
  administrator role; it is refused, as on PostgreSQL and SQLite.

- [#2518](https://github.com/nextlyhq/nextly/pull/2518) [`54b2069`](https://github.com/nextlyhq/nextly/commit/54b2069484280349e8b2ad5748452bf8fba8d5cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Releases calendar's day counts, today's date and the day list's Today label are now drawn in colours that stay readable under any brand colour.

  A release's readiness report now counts a link to a deleted document under every field it is linked from, so each field's total is right.

- [#2510](https://github.com/nextlyhq/nextly/pull/2510) [`8eaa797`](https://github.com/nextlyhq/nextly/commit/8eaa797fe5c4fc2ed1e342ae36a67c4185353245) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Releases calendar now shows every day's complete count, with a "+N more" that opens the day's full list, and puts a release on the day it actually went out; it marks today, offers a time-zone choice that decides which day a release falls on, and works by keyboard alone. The Releases list's Scheduled badge is now drawn in the neutral colour, so it stays readable under any brand colour.

- [#2394](https://github.com/nextlyhq/nextly/pull/2394) [`0d773a3`](https://github.com/nextlyhq/nextly/commit/0d773a3769e48a6963cb42f536c312a6968d358f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A scheduled release is now stopped as soon as a hard problem appears, not at its time, so no reader is shown the effect of a release that cannot run. Saving or deleting one of its documents, changing a user's roles or a role's grants or slug, deactivating a user or changing their email or name, changing a collection's or Single's schema, and a registered check source's signal each check the scheduled releases holding what they changed, including one whose time has passed and which no job pass has run yet. A soft problem never stops a release. What these events do not report (a role expiring at a set time, a user deleted, a collection changed through the collection dispatcher's metadata path, changes made outside Nextly's writes, access rules changed in code) is still stopped by the job pass at the release's time.

  Whichever way a release stops, its owner is given one `releases.stopped` notice, recorded with the stop: once per stop, and again if it is rescheduled and stops again. A hard check source outside core must now declare a `signal`, which replaces the unread `stopsEarly` field.

- [#2495](https://github.com/nextlyhq/nextly/pull/2495) [`05b07bd`](https://github.com/nextlyhq/nextly/commit/05b07bd764147af3b7bfb5603fb7482a1c951c31) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now keeps its own history in the record of content events. Each release operation records an event, with the release as its subject, in the same transaction as the change: created, documents added, removed or switched between going live and coming down, scheduled, rescheduled, Publish now, started, published, stopped, cancelled, renamed, description changed and deleted. Each names who acted: the person, an API key by its own id and name (never the person who owns the key), or the system for the run and its stops. Read it with `GET /api/content-events?subject=release&id=<id>` or `nextly.contentEvents.list({ subject: { kind: "release", id } })`.

  A cancelled release that was scheduled can now be deleted when its history shows it never began publishing: one scheduled and cancelled before its moment goes, while one that started publishing (stopped part-way, or cancelled mid-run) is still kept with `was-scheduled`. A release created before this version has no recorded history and keeps the earlier rule. **Compatibility:** a Direct API call to a release write that forwards an API key's `authenticatedScope` must now pass the key's `apiKeyId` with it, so the change can name the key; one without it is refused with `INVALID_INPUT` before anything is written. REST requests carry the key's id already. All of this is experimental until the releases redesign is complete.

- [#2503](https://github.com/nextlyhq/nextly/pull/2503) [`63f1af9`](https://github.com/nextlyhq/nextly/commit/63f1af9797855ad8fb7f970d232929b8b7a32c4d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release's history lists only the documents the reader may read, as the release's document list does: an event about a document the reader may not read is left out, while events about the release itself stay whole. A page of it scans a bounded stretch of history and answers where it stopped in a new optional `meta.nextBefore`, the `before` to pass for the next page, so it can come back short or empty while more remains. A run's write of a release document takes the release's lock and is refused when the document is no longer in the release, so a document whose release was deleted, or which was taken out of its release, while the run was writing it is left as it was. A person's name in a release's history is read under their account's lock, so a deleted account's name is erased from it like the rest of their events.

  Publish now on a release already due now records its `release-publish-now` event, and refuses an API key's scope passed without its `apiKeyId` before running anything, as Publish now on any other release does. The `committed` delete refusal now says that a cancelled release that never began publishing can then be deleted. All of this is experimental until the releases redesign is complete.

- [#2509](https://github.com/nextlyhq/nextly/pull/2509) [`d11cf5f`](https://github.com/nextlyhq/nextly/commit/d11cf5f7f854c9fd9b6174155a8283d9656e3906) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release reader who may not read a linked document now gets a count, never a
  classification, for links to it: the same one hidden count whether the linked
  document is live, a draft, coming down or no longer there. This is decided
  before anything else is said of the link. A link to a document that no longer
  exists is now reported as deleted only to a trusted caller.

- [#2393](https://github.com/nextlyhq/nextly/pull/2393) [`4ec73b9`](https://github.com/nextlyhq/nextly/commit/4ec73b9768f16fc58fcca5e562177b8b8e2f40fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release pass that the host ends part-way, at a serverless function's time limit for
  example, now makes progress on the next pass. Each document's write records, in the same
  transaction, that its release member was applied for the release as it stands, so the next
  pass writes only the documents still to go and settles their releases, and hooks and outbox
  events no longer run twice for the documents already written. Rescheduling, cancelling or
  otherwise changing a release voids those records, so its documents are written again.

  Whether a refused write counted is now decided by that record rather than by reading the
  document back: a release whose author may no longer publish a document is no longer marked
  published because the document already read as live, and a read hook that rewrites `status`
  changes nothing. `nextly migrate` and boot add one nullable column, `applied_revision`, to
  `nextly_release_members` on every dialect; no row is rewritten. It is internal: release
  members returned by the Direct API and REST do not include it.

  Compatibility: `applyDueReleases`, exported from the package root, is experimental, and its
  dependency ports change. A custom `repository` passed to it must now provide
  `isMemberApplied(memberId, revision)`, return `appliedRevision` on the rows from
  `listMembersOf`, and replace `markReleasePublished(id, at)` with
  `markReleasesPublished(entries, at)`, which settles a whole component of releases, each fenced on
  its planned `{ revision, scheduledAt }`, or none of them; custom `mutations` no longer provide
  `applied`, and their `publish` and `unpublish` receive a `receipt`. The built-in drain job (`createReleasesDrainJob`) needs no
  change.

- [#2459](https://github.com/nextlyhq/nextly/pull/2459) [`8462f9e`](https://github.com/nextlyhq/nextly/commit/8462f9e899f9318b0e7a46eade35199ebc4d7ca1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now shows each reader only the documents they may read. Its members, its problems, what blocks it, a scheduling refusal and the search for the releases holding a document name only documents the reader could open in that collection's own list. The rest are counted by collection, as in "2 documents you can't view · posts", with no title, id or field. The counts and the readiness still describe the whole release, so a release blocked by a document the reader cannot see still reads as blocked, and the admin's schedule dialog says why instead of offering a schedule the server would refuse.

  New, experimental: `nextly.releases.membersOf` and `nextly.releases.blockersOf` return the readable documents with the rest counted in `hidden`; `readiness` and `readinessOf` answers carry `hidden`; REST list answers for a release's members and blockers carry `meta.hidden`, omitted when nothing is hidden.

  Compatibility, for plugin authors: `nextly.releases.listMembers` and `blockingReasons`, called acting for a user (`overrideAccess: false`), now return only the documents that user may read, and `find({ containing })` answers as if a document the user may not read were in no release. Trusted calls (the default `overrideAccess: true`) see every document as before. Code that needs the full count for a user should read `membersOf` or `blockersOf` and add `hidden`; code that must act on every document should call as a trusted caller.

- [#2460](https://github.com/nextlyhq/nextly/pull/2460) [`19b8619`](https://github.com/nextlyhq/nextly/commit/19b86192976409e9fa030444770b6139079dcc25) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now notes, for each document going live, the documents it links
  to through its relationship and upload fields (field groups and blocks
  included) that will not be live at the release's moment: drafts nothing
  publishes by then, documents a release takes down by then (another release, or this one), and
  documents that no longer exist (named as deleted only to a trusted caller). It is a soft problem, `UNPUBLISHED_LINK`, in
  the release's readiness, and never stops scheduling, Publish now or the run.
  Adding a document to a release answers with the same links as
  `unpublishedLinks` (experimental), so a client can offer to add them too. A
  link from a document the caller may not read is only counted, and so is every
  link to a document the caller may not read, whatever that document is (live, a
  draft, coming down or deleted); one in a field the caller may not view names
  neither the field nor the document.
  Files in the media library are never reported, and links inside rich text
  are not checked yet.

  `nextly.releases.addMember` now returns the member with `unpublishedLinks`
  beside it; the member's own fields are unchanged.

- [#2418](https://github.com/nextlyhq/nextly/pull/2418) [`1ddc8b2`](https://github.com/nextlyhq/nextly/commit/1ddc8b28d9e593b501d619593d78d9602291d6cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Releases list is now a table with four tabs, Upcoming, Needs attention, Drafts and Done, each showing how many releases it holds; every release is in exactly one of them. The list pages like the other admin tables ("Showing 1–25 of N", page buttons and rows per page), and its search looks at titles and descriptions across every page, not only the rows on screen. The tab is kept in the address, so `?tab=attention&reason=overdue` opens Needs attention narrowed to overdue releases.

  Each row shows when the release runs, with how far away that is ("in 3 days"); how many documents it holds and what it does with them ("5 go live, 1 comes down"); how many are ready, with a bar and a count of those that need a fix; its state, with an icon and a word, so a stopped or overdue release is never told apart by colour alone; its owner; and a menu of the actions the reader may take (schedule or reschedule, publish now, cancel, delete). A release holding a single document is marked as one, and a switch hides them. Each tab says what it holds when it is empty, and with no release at all the list explains what a release is.

  Times are shown in the reader's own time zone. Where a release was scheduled in a zone whose clock reads differently, the time there is shown too, labelled as scheduled: "Fri, Oct 16, 2026 10:00 PM your time · Sat, Oct 17, 2026 7:00 AM Asia/Karachi (as scheduled)".

  The releases API gains two reads for a page of releases at once, both experimental. Each release on the REST list now carries `memberCounts` (`total`, `goLive`, `comeDown`), read for the whole page in one query; from the Direct API, `nextly.releases.memberCounts({ releaseIds })`. `GET /api/releases/readiness?ids=…` and `nextly.releases.readinessOf({ releaseIds })` answer up to 50 releases' readiness in one request, each exactly as the single read answers it and under the same permission; a release holding more documents than the limit comes back unchecked, and more than 50 ids are refused with a 400. The admin list uses them, so a page's rows cost two requests in all, rather than two per row.

  Each release on the REST list also carries `owner` (experimental): an id and a name, nothing else, read for the whole page in one query and named by the same rule as version authors. An owner whose account was deleted is `null`, and the admin table reads "Owner unavailable" for them.

- [#2437](https://github.com/nextlyhq/nextly/pull/2437) [`f7cc26c`](https://github.com/nextlyhq/nextly/commit/f7cc26c02e832bd9fb25e4464bac2e7332cb08f1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test, Nextly no longer writes to the console directly anywhere but its command-line output: boot, service registration, the REST dispatchers and route handlers, runtime, storage, middleware, the event and filter registries and the seeders now log through `consoleLogger` or the logger in hand, so their lines are masked of email addresses and carry its `[INFO]`/`[WARN]`/`[ERROR]`/`[DEBUG]` prefix.

- [#2370](https://github.com/nextlyhq/nextly/pull/2370) [`1e156b6`](https://github.com/nextlyhq/nextly/commit/1e156b6e55c8eafb2a467cc7f6791b606c9deaa8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A translated field renamed in the Schema Builder keeps every language's value, for a collection, a Single or a field group.
  - Renamed while it stays translated, its values move with it when it is the only field removed and the only field added in the save, with a compatible type: the translations table renames its column, where it used to drop the old column and add an empty one.
  - Renamed and made shared in the same change, the default language's value becomes the shared value and the other languages are written to the localization archive under the new name, restorable with `nextly i18n:restore`.
  - The schema dialog lists the rename as one, on the translations table, and keeps the values when it is chosen.
  - A rename that also changes how the field is stored (its length, its precision, or its type to a compatible one) is refused before anything runs, naming the two saves that work: rename it and save, then change its storage. A change to an incompatible type is not a rename, and neither are several translated fields renamed in one save or a rename saved with another field added: a save that removes a translated field while it adds another is refused before anything changes, naming the two saves that work: rename or remove one translated field and save, then add or change the others. A schema dialog answer that chose to drop and add still drops the old column, with every language's value.
  - A translated field renamed in the same change that turns translation off is refused before anything runs: rename it and save, then turn translation off.
  - Renamed and made shared, the field is judged under its new name before anything runs: a Required or Unique setting is refused, and an archive that cannot take the other languages stops the change with nothing altered.
  - A save that stopped after renaming the column finishes when it is saved again, rather than failing on the column it already renamed, whether the field stays translated or becomes shared, and so does a save that moved a field to shared and stopped before it was recorded.
  - The schema dialog's answer is checked against the rename the server offered, before anything changes: a change that offers a rename but does not say whether the field was renamed or replaced is refused, naming the field, rather than read as a replacement that deletes its translations. An answer for a rename the server did not offer is ignored.
  - A translated field renamed in code is not carried over yet; its old column keeps its values rather than being dropped.

- [#2602](https://github.com/nextlyhq/nextly/pull/2602) [`d7036b3`](https://github.com/nextlyhq/nextly/commit/d7036b3a1549b8ab5e5984e72f3b59e1f99389cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The repository lints with oxlint and its type-aware rules (oxlint-tsgolint) instead of ESLint. Nothing published changes: the packages lose their own `lint` scripts and ESLint dev dependencies, and two release-readiness checks in the core package derive the collection's status with a type guard rather than a cast. `@nextlyhq/eslint-plugin` stays an ESLint plugin, and projects scaffolded by `create-nextly-app` keep their ESLint setup.

- [#2533](https://github.com/nextlyhq/nextly/pull/2533) [`b77393f`](https://github.com/nextlyhq/nextly/commit/b77393f764cb7f6ba4a9b8f8ba60125f87d45154) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component placed directly in another component, when marked required, no longer stops the outer component from being created or saved. Such a field is never stored or shown in the admin, so it is no longer validated as required. A value for such a field that holds only an `id` is now refused like any other value.

- [#2643](https://github.com/nextlyhq/nextly/pull/2643) [`b753cdf`](https://github.com/nextlyhq/nextly/commit/b753cdf257672b32d0cd55ca8d992d154765663f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Team, Content, Create and Upcoming releases cards each do what their name says, answered as the person reading them.
  - **Team** is offered only to someone who may read people and may add or change them, and it now links to Users.
    - A new `system:team` source answers the number of people, and the number of roles for a reader who may see roles. Without that grant there is no roles figure at all, rather than a zero.
    - The source asks the same rule the card is offered on, so a reader the card isn't for is answered as if the source didn't exist.
  - **Widget permission gates** take a third form, `{ allOf: [...] }` (experimental), beside a slug and an any-of array. Every entry must hold, and each entry is a slug or an any-of array. One level only; an empty `allOf`, an empty entry or anything else is refused when the widget is defined. A slug and an array mean exactly what they meant before.
  - **Content** shows each collection's entries and its drafts, counted as the reader, through a new `system:content` source. The dashboard's draft/published summary is now the sum of those same rows.
  - **Create** no longer offers a shortcut for a collection only a machine creates in (`admin.disableCreate`, as form submissions declare).
  - **Upcoming releases** links to Releases, and shows the reader's releases that need attention above the upcoming ones, at every size: "1 stopped · 2 overdue", each part linking to the Releases list filtered to that reason.
    - `system:releases` sends those counts as rows of their own (`kind: "attention"`) only to a query whose `select` names `reason`. Any other query, including one with no `select`, is answered exactly as before.
  - The exported `ContentStatsGrid` no longer draws invented trend lines, sparklines or "this week" figures beside its real numbers.

- [#2719](https://github.com/nextlyhq/nextly/pull/2719) [`ca39fa1`](https://github.com/nextlyhq/nextly/commit/ca39fa15db5d1305851d28d64dfa9e21b3cb5080) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal groundwork for the roles screen's per-collection access levels, with no change to what anyone may do. The admin gains the mapping between the levels the roles screen will offer (No access, Can view, Can edit, Can publish) and permissions; nothing uses it yet. In `nextly`, the rule for which built-in resources' legacy `manage` permission still counts as read, create, update and delete moves into a module of its own, unchanged.

- [#2612](https://github.com/nextlyhq/nextly/pull/2612) [`69f8bff`](https://github.com/nextlyhq/nextly/commit/69f8bff0e40a639945887073684edeffe9368ba1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `hasRole`, `hasAnyRole`, `hasAllRoles`, `requireRole`, `requireAnyRole`, `requireAllRoles`, `checkCollectionAccess`, `checkPermission`, `authenticateApiKey` and the `AuthContext` type exported from `nextly/auth` are deprecated, and are removed in the next release. Each warns once, the first time it is called.

  The role checks compare a user's role ids with role names, so they never match a role by its name. Check a permission instead with `nextly.access.check({ userId, resource, operation })`, which asks the same access decision every route uses, or use `isSuperAdmin(userId)`. In place of `checkPermission` and `checkCollectionAccess`, use `nextly.access.check` for a signed-in user. For an API key, check the key's own permissions, which `nextly.access.checkApiKey({ rawKey })` returns: `nextly.access.check` judges the user who made the key, not the key's narrower scope. If you passed `checkCollectionAccess` an `evaluateCodeAccess`, keep running that collection rule too: like `checkCollectionAccess`, `checkApiKey` runs no rule of its own. In place of `authenticateApiKey`, use `nextly.access.checkApiKey({ rawKey })`, which authenticates the key and returns its permissions and roles; like `authenticateApiKey`, it applies no rate limit of its own.

  The instance `getNextly()` returns now declares `access.checkApiKey`, which it already had at runtime, so the advice above compiles.

- [#2720](https://github.com/nextlyhq/nextly/pull/2720) [`73271b2`](https://github.com/nextlyhq/nextly/commit/73271b216227f92a023a4ecd99c165cc84ad7a99) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A new admin endpoint, `GET /api/roles/screen`, tells the roles screen what to show for each collection and Single: its label, the plugin that contributes it (or none), and the access operations whose code-defined `access` declares a rule. It lists exactly the registered collections and Singles, and is refused without the `read-roles` permission, as the role list is. The roles screen uses it to set one access level per entity in a later release.

- [#2523](https://github.com/nextlyhq/nextly/pull/2523) [`2f904e5`](https://github.com/nextlyhq/nextly/commit/2f904e581f116ea95eb1c21421492eb82f67032f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The REST route gates (`requirePermission`, `requireCollectionAccess` and a plugin route's `requiredPermission`, and `requireAnyPermission`) now ask the one access decision. Every answer they give is unchanged: where a gate still answers differently from the decision, it keeps its answer through a named difference, so a later change can remove each one on its own.

- [#2357](https://github.com/nextlyhq/nextly/pull/2357) [`59f29f4`](https://github.com/nextlyhq/nextly/commit/59f29f445d1b2a26e34fe7e844165c6d07b9dc7d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Save draft, Publish and the document's menu stay inside the editor when the preview pane narrows it. With the divider near its narrowest on a desktop screen, they ran past the editor's left edge, where Save draft sat behind the navigation; they now wrap within the editor, as the header's other controls do.

- [#2702](https://github.com/nextlyhq/nextly/pull/2702) [`08bf5b7`](https://github.com/nextlyhq/nextly/commit/08bf5b77b8c7c172bf7c3bf98b8dcfd885f55f38) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Saved count and health cards are now Count cards. A dashboard that holds a collection's count card, its health card, or both shows one Count card set to that collection, at the first card's place and the widest width Count allows. A Count card already set to that collection takes them in.

  This happens as each layout is read, for that reader, and rewrites no stored row. A card whose collection the reader may not read stays as it was, withheld, and converts once they may read it. A card for a deleted collection is kept and shows as not available.

  Three dashboard conditions are also corrected:
  - Create is no longer offered while it cannot be told which collections turn creating off. The collection definitions it needs come from the read every dashboard request already makes, rather than a second read of every definition.
  - The onboarding step and the Create card now share one create decision per collection.
  - Needs attention is offered on a readable Single whether or not it has a widget source.

- [#2368](https://github.com/nextlyhq/nextly/pull/2368) [`599eb46`](https://github.com/nextlyhq/nextly/commit/599eb465889e254f2d3fceabd70a264844ebbf71) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Turning translation on for an existing collection, Single or field group through its schema dialog works again, keeping every entry's values as the default language's. The schema apply moved the values into the companion before dropping the main columns, and the enable's own step then tried to add the same columns and failed, after the main columns were gone and with the entity still recorded as untranslated. The enable now takes the columns the apply moved, and the ones already on the companion, as done, so the values move once. Saving again finishes an entity an earlier attempt left in that state.

- [#2404](https://github.com/nextlyhq/nextly/pull/2404) [`6d93a0e`](https://github.com/nextlyhq/nextly/commit/6d93a0eeada2f79611ddfea76201cd1624741281) Thanks [@aqib-rx](https://github.com/aqib-rx)! - The schema guard that stops a migration changing another owner's tables now also refuses: on PostgreSQL, an `ALTER TABLE` or `TRUNCATE` without `ONLY`, or a `DROP TABLE`, that would reach a table inheriting from the one named (or a partition of it) that another owner holds, read from the database's catalog; `ALTER TYPE ... CASCADE`; a name looked up again after an earlier statement in the same migration dropped or renamed what it named; and, on MySQL and MariaDB, the `WAIT n` / `NOWAIT` and `IF EXISTS` spellings, `CONVERT TABLE ... TO PARTITION`, `CREATE OR REPLACE INDEX`, and a clause it cannot read (such as `CONVERT TO CHARACTER SET`) on a table another owner has a column, index or constraint on. A full plugin uninstall on PostgreSQL whose DOWN migrations hold an `INSERT`, `UPDATE` or `DELETE` is refused before anything runs, since a trigger may change tables. A column added earlier in the same migration is credited for a later change only when written `ADD COLUMN` or with a quoted name, outside any routine body.

- [#2466](https://github.com/nextlyhq/nextly/pull/2466) [`5157ca4`](https://github.com/nextlyhq/nextly/commit/5157ca47d804174e6d87271f4de922e72255d0b3) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The schema builder's collection list (`GET /admin/api/collections/schema`) pages through the collections its caller may see. Each page but the last is full, and `total`, `totalPages` and `hasNext` count every collection the caller may see.

  Changed answer: before, the list was paged first and then narrowed to what the caller may see. A page could come back short, and `total` counted only that page, so `hasNext` was always `false`. Which collections a caller is shown is unchanged.

- [#2369](https://github.com/nextlyhq/nextly/pull/2369) [`6a9a974`](https://github.com/nextlyhq/nextly/commit/6a9a974de6072bcfa15adca3e4e7eeff6225b387) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Seeding a role on a first start now takes only a name or slug conflict as another process having created it, and logs that at debug only, including the warning the role service used to print first. Any other failure is reported, even when the role exists afterwards, so a role saved without its permissions is no longer counted as seeded. A code-defined user-field sync that lost a race on a duplicate now runs once more from the stored rows, so the rest of its changes, a new maxLength say, are written rather than rolled back with the losing insert.

- [#2563](https://github.com/nextlyhq/nextly/pull/2563) [`2acbb54`](https://github.com/nextlyhq/nextly/commit/2acbb5402d3a5768ff56157979bff0f14844b205) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template "send test" route now raises a typed internal error when the email service is not set up, like the other email routes. No change in behaviour: the caller still gets the same generic internal error.

- [#2589](https://github.com/nextlyhq/nextly/pull/2589) [`5e7f557`](https://github.com/nextlyhq/nextly/commit/5e7f557b15a77fdce12f6ff195698b636a002b6b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly`, the database adapters, the storage adapters, the plugins, the plugin SDK, `@nextlyhq/blocks-engine`, `@nextlyhq/blocks-react` and `create-nextly-app` are now built with tsdown instead of tsup. Every entry point exports the same names, and its types describe the same API.

  What a reader of `dist` sees change:
  - `nextly`'s type declarations are `.d.mts` files beside the `.mjs` files they describe, rather than `.d.ts`. Imports resolve through the `exports` map as before, so no import changes.
  - The declarations of `nextly/route-path`, `nextly/field-catalog`, `nextly/widget-gate`, `nextly/widget-result`, `nextly/document-lock` and `nextly/translation-filter-states` sit beside their modules (for example `dist/runtime/routing/slug-param.d.mts`), and the `exports` map points there.
  - Shared code is split into chunks with different names, and file-level comments at the top of a source file are no longer copied into the declarations. Comments on each declaration are kept, so editor hovers read the same.

- [#2426](https://github.com/nextlyhq/nextly/pull/2426) [`61a82a6`](https://github.com/nextlyhq/nextly/commit/61a82a67a8a6caba3c3c37aaf0b66136fa9162d9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Setup now ends the client's upload of a body it stops reading, too large or too slow, instead of leaving the connection open after it has answered.

- [#2423](https://github.com/nextlyhq/nextly/pull/2423) [`54f4ad9`](https://github.com/nextlyhq/nextly/commit/54f4ad9ebc091c0b25702ff29ca1735e7d772dcd) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin's preview control now opens a share popover. Choose how long a link works (1 hour, 1 day, 3 days or 7 days), then create and copy it in one step. The popover lists the page's live links, with who made each, when it ends and how many times it was opened, and lets you revoke any one of them, or all of them after a confirmation. Links made before this version show as one row that can only be revoked together. On a phone, the popover opens from the document's menu.

  A preview shows related items and uploads as the person who shared it would see them, as it already did for the draft's own fields.

- [#2330](https://github.com/nextlyhq/nextly/pull/2330) [`f4808ec`](https://github.com/nextlyhq/nextly/commit/f4808ecd358ad0e7b36431e93f84f5112242589d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A shared field that becomes translated keeps its value, as the default language's translation, for a collection, a Single or a field group.
  - The Schema Builder's settings save lost the value: a Single's dropped it with the shared column, and a collection's left that column behind, so a Required field refused every later entry. The value now moves to the default language's row before the shared column is removed.
  - The schema dialogs asked to confirm the shared column's removal as a loss, and lost the value when it was confirmed, and so did code-first sync (`next dev`, a config reload, `db:sync`) once the drop was confirmed at the prompt. The schema apply now moves the value itself, after its questions are answered and before the drop, so a cancelled apply changes nothing and a repeated one finishes the change.
  - `nextly migrate:create` planned the change as the whole entity becoming translated, and the migration failed on the existing translations table. It now writes one file that adds the translated column, copies each value and removes the shared column; `nextly migrate:down` makes the field shared again with the default language's value, archives the other languages, and makes a Required field required again once its values are back.
  - A field whose type, length or precision changes in the same change is refused, naming the two saves that work, since its value would be copied into a column of the new shape.

- [#2336](https://github.com/nextlyhq/nextly/pull/2336) [`a24683d`](https://github.com/nextlyhq/nextly/commit/a24683d1e12c836a5d8fcf13d569924e90d5b6ae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Sign-in and the other auth routes, for a client whose address cannot be resolved, now read at most as many request bodies at once as the shared ceiling admits. A body was read before the request counted against anything, so a client could hold any number of slow bodies open below the ceiling. A request past that number is refused with a 429 before any of its body is read, and the refusal spends no budget and no ceiling place.

- [#2615](https://github.com/nextlyhq/nextly/pull/2615) [`8a5c589`](https://github.com/nextlyhq/nextly/commit/8a5c58971e3ad87e55363075bafe4724d010b549) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Single call made while serving a request that arrived on an API key, which names no key scope of its own, is now judged as that key, as a collection call already was. Before, it was judged as the person who made the key, so a call such as a hook's Direct API read or update of a Single could do what the key's owner may rather than what the key may. A call that names its own key scope is judged by it, as before.

- [#2519](https://github.com/nextlyhq/nextly/pull/2519) [`754ecd9`](https://github.com/nextlyhq/nextly/commit/754ecd9b218d161d36f67031c74108791d9329be) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Single access gate now asks the one access decision, as the collection gate does, keeping every answer it gives today. The code rules apps declare are also kept where that decision can read them with or without the access-control service. Nothing a caller is allowed or refused changes.

- [#2382](https://github.com/nextlyhq/nextly/pull/2382) [`ece8953`](https://github.com/nextlyhq/nextly/commit/ece8953da2db8f1bc5071dfb0a8ab78317ecb8b1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Single's preview link now also re-checks, on each render, that the person who shared it may still read the Single, as it already re-checked that they may still edit it. A sharer whose read access is withdrawn by a custom rule no longer has their link serve the draft.

- [#2337](https://github.com/nextlyhq/nextly/pull/2337) [`c3e5354`](https://github.com/nextlyhq/nextly/commit/c3e5354368b77ea1789d6926c498301901715cb4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Single's schema save applies whole or fails whole on PostgreSQL and SQLite, and says why on every database, as a collection's save does.
  - A change the value the Single holds cannot take (a text field narrowed below it, a field made unique over a repeated value) is refused before any statement runs, naming the field. PostgreSQL used to cut a longer value to fit.
  - The migration runs in one transaction on PostgreSQL and SQLite. A statement the database refuses fails the save with the reason and the Single keeps the fields it had, where it used to be recorded as a failed migration beside the new fields. On MySQL, which commits each schema statement, the refusal says how many statements ran, and saving again finishes the change.

- [#2476](https://github.com/nextlyhq/nextly/pull/2476) [`25688d9`](https://github.com/nextlyhq/nextly/commit/25688d9443e9287612171256bffce534ed756256) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Each save of a Single by a person or an API key is now recorded in the activity trail, in the same transaction as the save and whether or not webhooks or audit are on: a save, a held draft edit, a publish or unpublish (one row, however many languages it moves) and publishing every language each record one update, and an autosave records nothing. Recent activity heads a Single's row by its label and shows it only to someone who may read that Single. Hidden and internal Singles are left out of Recent activity and the 24-hour figure, judged by what each row is about, so a hidden Single no longer removes the rows of a collection with the same slug. Each entry in the dashboard's activity response now carries `subjectKind`: `collection`, `single` or `settings`, or `null` for an older row.

- [#2356](https://github.com/nextlyhq/nextly/pull/2356) [`308bdd9`](https://github.com/nextlyhq/nextly/commit/308bdd9bb4a370cfa7bd1f48de0f03399a9c4768) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Turning Unique off for a Single field in the same Schema Builder save that renames it now drops its unique index on MySQL when the save is repeated after a refusal. MySQL commits each schema statement, so a rename can land before a later statement is refused, and the field's unique index keeps the name it was created under. The repeated save looked for the index under the field's new name, found none, and left it enforcing uniqueness the field no longer declared. The save now asks the table which unique index covers the column.

- [#2561](https://github.com/nextlyhq/nextly/pull/2561) [`96d7fd2`](https://github.com/nextlyhq/nextly/commit/96d7fd2b8b667ebf42cb62573149bf1cf8ff8b37) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A site's content languages can now be stored and changed through the API when the configuration does not declare them; the admin has no screen for them yet. `GET /api/languages` lists them in the list envelope (`{ items, meta }`, with `meta.lockedByConfig` saying whether the configuration locks them), and `POST /api/languages` adds, renames, reorders or removes one, or makes another the default. Reading needs the settings read or manage permission; changing needs update or manage.
  - Codes are stored in canonical BCP 47 form and must be unique whatever their letter case. `all`, `none` and `*` are refused, since they select languages rather than name one. Labels are stored without surrounding spaces, and a label that is only spaces is refused.
  - A removed language is kept, inactive: its content stays, other languages' fallback lists skip it, and adding it back restores it. The default language cannot be removed; make another the default first.
  - Making another language the default shows first how many translations each language holds (`?defaultPreview=<code>`), must be confirmed, moves no data, and is refused while the current default has pending changes.
  - Fallback lists that loop through other languages are now refused, in the configuration as well as through the API. **A configuration with such a loop no longer boots.** The error names the loop, for example: `localization fallback lists loop: fr → es → fr. A language may fall back through others, but never back to itself.` To fix it, remove one of the codes the error names from the `fallbackLocale` list that leads back. In the example, take `fr` out of `es`'s list, or `es` out of `fr`'s. A language left without a list falls back to the default language.
  - A `localization` block in the configuration still declares and locks the list. The API shows it and refuses every change.
  - A site that never adds a language is unchanged: nothing is stored, and the admin shows no language controls while a site has one language.
  - A language added on one server reaches the others within a second. Each request keeps one list from start to end, and so does each Direct API call, form submission, field-group change and plugin service call, so a worker or script that serves no requests also sees a language added elsewhere. A call made inside another keeps the enclosing call's list.
  - The stored list is read at boot before any plugin's `init` runs, so plugin code writing content at startup sees the site's languages.
  - Two changes to the list made at the same moment run one after the other, so neither is lost to other servers and the site never ends up with two default languages. A default change checks for pending changes again just before it is written.

- [#2406](https://github.com/nextlyhq/nextly/pull/2406) [`18c16c8`](https://github.com/nextlyhq/nextly/commit/18c16c8ddf28a1c0170258a981a7057cfeda6649) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Staff passwords are judged by length and a common-passwords list, not character classes: at least 8 characters (configurable up to 15 via `auth.minPasswordLength`), refused when on the shipped list of 3,000 common passwords, counting characters rather than code units so short astral strings are refused too. A password longer than the serving digester reads whole — 72 UTF-8 bytes for the default bcrypt — is refused instead of silently truncated, at registration, reset, change, invite acceptance, the forced first-sign-in change, and administrator-set passwords alike. Stored passwords are re-judged by nobody: an account whose password predates the rule still signs in with it. An app supplying its own `PasswordHasher` must declare its reach contract (`reach: number | "unbounded"` or a `validate` function) or the server refuses to start, naming the digester.

- [#2449](https://github.com/nextlyhq/nextly/pull/2449) [`a44f6e4`](https://github.com/nextlyhq/nextly/commit/a44f6e4a23a8dde2393abcba9ac31e935702b6f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The standalone email-template handlers (`nextly/api/email-templates` and `nextly/api/email-templates-detail`) now accept a template's `description` on create and update (`null` clears it on update), and return it on every read, as the catch-all REST routes and the Direct API already do. A description that is neither text nor `null` is refused with a validation error.

- [#2421](https://github.com/nextlyhq/nextly/pull/2421) [`a24cdb0`](https://github.com/nextlyhq/nextly/commit/a24cdb057f935ee33c7a270a6e4e4ece4883f732) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A person's standing is read again as soon as the change that deactivates
  them, or sets their password, commits, even when Nextly's services are
  registered again (a configuration change, a reload in development) while
  that change's transaction is open.

- [#2709](https://github.com/nextlyhq/nextly/pull/2709) [`73c32ec`](https://github.com/nextlyhq/nextly/commit/73c32ece3ae36139aff7a40c2a35679d5fde412f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Only a super-admin can delete or deactivate the account of a super-admin while another super-admin remains. An admin who may delete or change users but is not a super-admin, and every API key, is refused with `403`, as removing the role already is. Server code with no request caller is unaffected, and the last active super-admin stays protected from everyone.

  A change to an account or a role is judged by the ids as stored.

- [#2450](https://github.com/nextlyhq/nextly/pull/2450) [`0a5c11b`](https://github.com/nextlyhq/nextly/commit/0a5c11b1ed565aa2e2a71e787320f5c3cfe1480e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The super-admin assignment rule now applies to every role change requested through Nextly's REST routes. There, only a super-admin can assign the super-admin role or a role that inherits it, create or update a user with such a role, or make a role inherit one, whether by adding inheritance or through `childRoleIds` when a role is created or updated, and an API key cannot, whoever made it. Server code such as a seed or the CLI is unaffected.

  A role created through `POST /api/roles` can no longer be marked `isSystem: true`. That request now answers 400. System roles are the ones Nextly seeds itself.

  Assigning a role through `POST /api/users/:id/roles` now answers with what happened: `404` for a user or role that doesn't exist, `409` for a role already held, and `400` for an `expiresAt` that isn't an ISO date and time. A user created with roles is created with all of them or not at all.

- [#2571](https://github.com/nextlyhq/nextly/pull/2571) [`f95635e`](https://github.com/nextlyhq/nextly/commit/f95635eae3884a39c0d814c7a65ea10b9425179f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API's reads of users, roles and permissions, media and field groups are checked when the call asks to be.

  With `overrideAccess: false`, on the instance or on the call, each read asks the grant REST's route asks for the same read, before it reads anything:
  - `users.find`, `users.findOne` and `users.findByID`: `read-users`.
  - `roles.find` and `roles.findByID`: `read-roles`; `roles.getPermissions`: `read-roles` or `read-permissions`.
  - `permissions.find`: `read-roles`, which the role form needs; `permissions.findByID`: `read-roles` or `read-permissions`.
  - `media.find`, `media.findByID` and `media.folders.list`: `read-media`, as the admin's media routes ask.
  - `fieldGroups.find` and `fieldGroups.findBySlug`: a named user and no grant, as REST serves field groups to any signed-in caller.

  A checked call that names no user is refused as unauthenticated, and a key's scope (`actor`) is judged on its own grants. Inside a request made with an API key, a checked media read that names a person and no key is refused, as a media write is. A read that is refused throws, `disableErrors` included. Trusted calls, the default, are unchanged.

- [#2448](https://github.com/nextlyhq/nextly/pull/2448) [`c90ea6d`](https://github.com/nextlyhq/nextly/commit/c90ea6d2e1fa05cc2171f568efde16eb4417cf89) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The types the template ownership methods take and return are now exported from
  `nextly`, so code calling `nextly.emailTemplates.override`, `reset`, `compare`,
  `applyUpdate` and `undoUpdate` can name them: `OverrideEmailTemplateArgs`,
  `ResetEmailTemplateArgs`, `CompareEmailTemplateArgs`,
  `ApplyEmailTemplateUpdateArgs`, `UndoEmailTemplateUpdateArgs`,
  `EmailTemplateComparison` and `OwnerUpdateUndo`, with the types their fields
  are built from, `EmailTemplateVersion`, `OwnerChange` and `OwnerChangeChoice`.
  They are `@experimental`, as the methods are.

- [#2526](https://github.com/nextlyhq/nextly/pull/2526) [`2e4f252`](https://github.com/nextlyhq/nextly/commit/2e4f252151fe8e14a3f437e610074d0bf67fba10) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An email template whose Reply-To uses variables now sends it only when it renders to exactly one address, display name allowed. One that renders to several addresses fails before any provider is asked, as one that renders to something that is not an address already did. A Reply-To without variables, and a send's own `replyTo`, are unchanged.

- [#2377](https://github.com/nextlyhq/nextly/pull/2377) [`69e42b4`](https://github.com/nextlyhq/nextly/commit/69e42b4d7ed85350d049ef366b5c0a168c3bcf01) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Testing: `createTestNextly` instances booted one after another in the same test file now each answer REST requests such as `GET /api/users` from their own database. Before, every instance after the first was served by the first one's closed database connection and answered 500.

- [#2465](https://github.com/nextlyhq/nextly/pull/2465) [`a1adee6`](https://github.com/nextlyhq/nextly/commit/a1adee6f1cc5e676947259b6123c40af51f6794b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A REST request's authenticated caller now travels in request context instead of in route params, and every REST handler builds the user its access rules are judged on in one place. That user now carries the token's verified claims on every route: a rule that decides on a claim, such as a tenant, now sees it on version history, Single writes and collection writes too, as it already did on collection and Single reads and through the Direct API. Reserved identity names sent in a query string are still dropped before dispatch.

- [#2601](https://github.com/nextlyhq/nextly/pull/2601) [`208049c`](https://github.com/nextlyhq/nextly/commit/208049c9012248b939e1a489d4dfd4157194202e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Customising the dashboard no longer makes React warn that an effect's dependency list "changed size between renders" when the dashboard narrows to one column or widens again. The drag context now keeps the same sensors at every width; a drag still cannot start at one column, where no card draws a handle and each card's drag is turned off.

- [#2397](https://github.com/nextlyhq/nextly/pull/2397) [`c843077`](https://github.com/nextlyhq/nextly/commit/c8430771063aa13110c9fda92eed16181544a249) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard no longer jumps while it loads. It draws no card until it knows
  which cards this person has, rather than drawing the declared set and
  redrawing theirs over it, and each loading card holds the place of the body
  that will replace it: the same lines, laid out as the card will draw them at
  its width, with its freshness line held. An empty or short list closes up once.

- [#2387](https://github.com/nextlyhq/nextly/pull/2387) [`d5b2cef`](https://github.com/nextlyhq/nextly/commit/d5b2cefbc75eb13de43bcaacbcdd74314d095a24) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The API key form describes each type in plain words, including that a
  read-only or full-access key follows its creator's permissions as they
  change, and shows what the key will be able to do before it is created, as
  the server answers it for the chosen type or role. The key list shows each
  key's owner beside its expiry and last use, and a key's last use now
  advances when a request uses it.

  New, and experimental while the form settles: `GET
/admin/api/api-keys/abilities?tokenType=…&roleId=…` answers that summary,
  session-only and behind the permission to create keys. Each key's metadata
  gains an `owner` field, which an API key sees only if it may read users.

- [#2624](https://github.com/nextlyhq/nextly/pull/2624) [`cc045e7`](https://github.com/nextlyhq/nextly/commit/cc045e75799e2136326031951a4d6f3c0aff8aae) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin can now ask the server what you may do. An experimental `GET /me/capabilities` answers, for every collection and Single, which of read, create, update, delete, publish and unpublish you are allowed — decided by the same gate a REST request meets, so a collection's code access rule is reflected as well as the permissions your roles hold. A publish or unpublish is allowed only where you may also update, as a publish is sent as an update. It is answered for the signed-in person, or for the API key when a key makes the request, is never stored, says when it stops holding, and takes a `?locale=` to judge a rule that answers by language. `GET /me/permissions` is unchanged.

- [#2399](https://github.com/nextlyhq/nextly/pull/2399) [`9c5f185`](https://github.com/nextlyhq/nextly/commit/9c5f18518ab09c3413af925f8deea6689bac20be) Thanks [@aqib-rx](https://github.com/aqib-rx)! - An entity transform judges a plugin named `code` like any other plugin: another plugin transforming its entities needs `code` in `dependsOn`, and may not remove or change the storage of its fields. A plugin named `code` can also no longer contribute an entity under the slug of an app entity of another kind. A transform that restates the owner's table settings in an equivalent form is now accepted: an explicit `status: false` or `localized: false` where the owner left it unset, or a `dbName` that names the default table the entity is already stored in (`dc_orders` for `orders`). A setting that changes the table, or turns a status column or localization on or off, is still refused.

- [#2529](https://github.com/nextlyhq/nextly/pull/2529) [`095e254`](https://github.com/nextlyhq/nextly/commit/095e25438ab0cdb3b406025dc1539cf8989decba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Schema Builder save that removes a translated field while it adds another field, with no rename decided for them, is now refused before anything changes. Two renames in one save, a rename beside a new field, and a rename to another type were each read as a removal and an addition, which dropped the removed field's translations column and every language's value with it, and no step of the save asked about it. The refusal (`TRANSLATED_FIELD_REMOVED_BESIDE_ADDED`) names each such field and the two saves that work: rename or remove one translated field and save, then add or change the others. A schema dialog's explicit "drop and add" answer still goes through, as the admin chose it.

  The settings save that turns translation on is refused the same way for a field that becomes translated, a rename included: turning translation on keeps a field's value only under the name it already has, so the removed field's value was deleted from the main table and its replacement started empty. Turn translation on with the fields as they are, then rename or add. The schema dialogs already ask for that drop to be confirmed, and still apply it once it is.

- [#2650](https://github.com/nextlyhq/nextly/pull/2650) [`7b0ea38`](https://github.com/nextlyhq/nextly/commit/7b0ea3899ef6c74eb4c8504de26e1a3c51301529) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The packages' TypeScript configs now state the settings whose defaults change in TypeScript 7: `types` in each package, `rootDir` in admin, and `noUncheckedSideEffectImports` and `libReplacement: false` in the shared base. They type-check the same way on 5.9 and 7. The published JavaScript is unchanged, and so are the published types; a few of nextly's and admin's declaration unions list their members in another order.

- [#2623](https://github.com/nextlyhq/nextly/pull/2623) [`09e77c9`](https://github.com/nextlyhq/nextly/commit/09e77c98206e32abed563cbb3f3c0bc20c2d13fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/ui` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2616](https://github.com/nextlyhq/nextly/pull/2616) [`5984c90`](https://github.com/nextlyhq/nextly/commit/5984c90bdea3cb2b1b5d061f0cc584c91ceb22cd) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal clean-up of the access-permission helpers: two functions no code called are removed. Nothing a user can import or observe changes.

- [#2402](https://github.com/nextlyhq/nextly/pull/2402) [`807076d`](https://github.com/nextlyhq/nextly/commit/807076ddaeba266bfd7922cf609927365a59c871) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every version in a document's history now names who wrote it, records its status truthfully, and survives a concurrent write taking its number.
  - **Who wrote it.** A version is named from the record of content events: a person by name, an API key by its own name (not its owner's), and a seed, a plugin acting as the system or any other system write as "System". A history entry's `author` gains a `kind` (`person`, `apiKey`, `principal`, `system`, `agent`). For the system its `id` is null. Versions recorded before content events fall back to the stored user id, as before.
  - **Its status.** Without the Draft/Published lifecycle, a document's own `status` is recorded as it is (an "archived" document's version says "archived"), never as "published". A document with no status still records "published". A select or radio `status` field may not have an option longer than 32 characters (refused when the collection or Single is defined). A longer free-text status records its first 31 characters and "…", keeps the whole value in the version's snapshot, and is logged once per collection.
  - **Its number.** When two writes to one document capture a version at the same moment, the later one now takes the next number instead of failing. Only the version insert repeats, never the write or its hooks: in a savepoint on PostgreSQL and SQLite, and with a locking re-read on MySQL.

- [#2485](https://github.com/nextlyhq/nextly/pull/2485) [`343e49b`](https://github.com/nextlyhq/nextly/commit/343e49b16cf8d2370c90ce775b6eb3bc0bc24c71) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard batch does a source's shared work once. A widget source may answer several of its queries in one call (`resolveMany`, one answer or one error per query, by position) and share work across its queries in one batch through `opts.scope`, kept per source, per batch and per caller. A grouped result can say its counts are floors (`atLeast`), drawn as "N+". The SEO plugin answers its card's five cells from one scan and can group its issues by kind. Both additions are `@experimental`.

- [#2673](https://github.com/nextlyhq/nextly/pull/2673) [`c91bdc9`](https://github.com/nextlyhq/nextly/commit/c91bdc904bbad97816bfba5808b669cebf221c1b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A registered widget may declare a Collection setting, and its card reads the collection the reader chooses. The collection becomes the card's query source in place of the one the widget declares, and the reader's access to it is judged as for any source a query names.

  Registration still refuses a Filter, Sort or Group by setting on a registered widget (`WIDGET_CONTENT_SETTING_NOT_DRAWN`), since nothing yet carries those into its query.

- [#2350](https://github.com/nextlyhq/nextly/pull/2350) [`e3e14dd`](https://github.com/nextlyhq/nextly/commit/e3e14dd6fd523d710c88cdfb107a39f1211d9fd8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A declared widget's widths now use core's words (`quarter`, `third`, `half`, `twoThirds`, `full`). Its Collection, Filter, Sort and Group by settings follow core's setting rules, and a list or table query must name the fields it shows.
  `defineWidget()` also refuses a component path read from a `string` variable and data keyed by a symbol, which would otherwise reach the admin wrong.

- [#2511](https://github.com/nextlyhq/nextly/pull/2511) [`2aab43a`](https://github.com/nextlyhq/nextly/commit/2aab43a3456a89e1d223955b779e714937771c73) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A site's generated admin component map now checks, at compile time, that each widget component it registers takes its own widget's props, with nothing annotated by the plugin or the site. A component registered under another widget's path fails the site's build.

  To make that possible, `definePlugin` and `defineConfig` keep their widgets' types. Both are now generic, and nothing changes at run time:
  - **`definePlugin`** infers the widgets of `contributes.dashboard`, and `rename()` keeps them. A plugin with no dashboard, or with untyped widgets, has today's type.
  - **`PluginDefinition` and `PluginContributions`** take an optional type parameter, defaulting to today's type. Every existing use means what it did, and a typed plugin still goes wherever a `PluginDefinition` does.
  - **`defineConfig`** keeps each plugin's type, and its return type records the widgets they declare. An untyped (plain JavaScript) plugin compiles as before, and does not turn the check off for the typed plugins beside it.
  - **New types:** `DeclaredComponentMap` and `WidgetsOf`, exported from `nextly`, which the generated map uses.

  **One deliberate change:** in a plugin whose widgets are typed, `contributes.dashboard.suggest` and the keys of `alternatives` are now checked against the plugin's own widget ids when it compiles. A misspelt id, or a `string[]` variable, that compiled before now fails to compile. Startup already refused a misspelt id. To migrate, write the ids as literals, or type the array as `(typeof widgets)[number]["id"][]`.

  A plugin whose factory annotates its return type as `PluginDefinition` keeps today's unchecked type, until it returns `PluginDefinition<typeof widgets[number]>` instead.

- [#2344](https://github.com/nextlyhq/nextly/pull/2344) [`a6c613d`](https://github.com/nextlyhq/nextly/commit/a6c613d8639d35c58e80e445df648e1278ed1528) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Upgrading requires running `nextly migrate` before content can be saved:
  every save now records its history, and until the record's table exists a
  save is refused with "The database needs updating before content can be
  saved. Run `nextly migrate`." rather than written without its history.

  A document's writes now record its history in the record of content events,
  each in the write's own transaction and with who made it, for collections and
  Singles alike: its creation, each save that recorded a version, a restore
  (naming the version it came from), each publish and unpublish, a version
  being named, its working draft being discarded, its deletion, and a
  retention pass that removed older versions. A publish or unpublish is one
  event per kind naming the languages it moved, and publishing every language
  is one event. A person is recorded by the name the request carried, an API
  key by its own name, and the system (a Single created on its first read, or
  retention) by none. A save that changed nothing records no event. Events are
  written whatever a collection's webhook settings.

  `versions.setLabel` takes an optional fourth argument, who named the version,
  which records the name in the document's history in the same transaction.

- Updated dependencies [[`6093742`](https://github.com/nextlyhq/nextly/commit/6093742e0971d0c0f00251cd9c6b47e640946259), [`a0d926a`](https://github.com/nextlyhq/nextly/commit/a0d926ab9cc9b78b9683492e10f00974e88c72e9), [`eb09f42`](https://github.com/nextlyhq/nextly/commit/eb09f42e9e5a1a29933ea355250cbacd16690ede), [`792d1d5`](https://github.com/nextlyhq/nextly/commit/792d1d5fcdaf7ad18459e975905e4f027c7a42c3), [`351231c`](https://github.com/nextlyhq/nextly/commit/351231c3c53a3eee71aacb871f5378fe40c4e6f4), [`e2afec9`](https://github.com/nextlyhq/nextly/commit/e2afec941dd8a984e06d0ab2e52feb070c50b699), [`077631c`](https://github.com/nextlyhq/nextly/commit/077631c22da693101a81a003d9b2b2c337ca17e3), [`931faf8`](https://github.com/nextlyhq/nextly/commit/931faf87dd200e35a28621d7cbfbcae3621a4daa), [`1462411`](https://github.com/nextlyhq/nextly/commit/1462411ac6e5e7a212f08fadf3916d9571ec952e), [`9b80400`](https://github.com/nextlyhq/nextly/commit/9b80400d8d2c6be833a58321b0c9dceb4b92c942), [`8755798`](https://github.com/nextlyhq/nextly/commit/8755798b874ef429603dd8f3f25f33965b7cb023), [`9937cc5`](https://github.com/nextlyhq/nextly/commit/9937cc57ff633689753cfbfbf9158f8528e728e6), [`253cd89`](https://github.com/nextlyhq/nextly/commit/253cd8963766b2fa023e3ed0445fec966e7f7f19), [`d986b28`](https://github.com/nextlyhq/nextly/commit/d986b28b02bb07481ca8bb995cdc3fe268443866), [`92852f7`](https://github.com/nextlyhq/nextly/commit/92852f70d1a3d4556138f062a158a4341932e3c4), [`ab73264`](https://github.com/nextlyhq/nextly/commit/ab73264679dcc9c00017247f7984cec5c605ff97), [`f74d122`](https://github.com/nextlyhq/nextly/commit/f74d12202f34bc09699f02263f0b5dd0a7635962), [`8c4d300`](https://github.com/nextlyhq/nextly/commit/8c4d300d6c879b31386631d6cc170126d2b97fe0), [`5352b69`](https://github.com/nextlyhq/nextly/commit/5352b69f053346997f73e5002b3059c1b3048199), [`6f2d0bd`](https://github.com/nextlyhq/nextly/commit/6f2d0bd90c2b5d2aaee5e1c95375deb28b0350d3), [`7183036`](https://github.com/nextlyhq/nextly/commit/718303681cf811dbf54044abf46dfb40a172c716), [`30d4944`](https://github.com/nextlyhq/nextly/commit/30d494491d61cd52fd1c6afe4b0f3755de220ff1), [`1b96481`](https://github.com/nextlyhq/nextly/commit/1b96481ecaed98c780a26c0134acf515af7d3fe4), [`2f498a6`](https://github.com/nextlyhq/nextly/commit/2f498a64fd2efab509ebb433e566fe8ff4e881dd), [`837c7b1`](https://github.com/nextlyhq/nextly/commit/837c7b149a3eb0c50db1a451521b1ec54293d54f), [`1ebd31b`](https://github.com/nextlyhq/nextly/commit/1ebd31b8ae3f25cbd15ca53d160699ccbd6646b4), [`934cef1`](https://github.com/nextlyhq/nextly/commit/934cef1fe8534e89c6222e1b0734d21ccd1147af), [`ea23a3b`](https://github.com/nextlyhq/nextly/commit/ea23a3b46f007185ffdbc23d04df772a173876f9), [`b26f715`](https://github.com/nextlyhq/nextly/commit/b26f715539d18e513c28923d53771c4a12f43034), [`7afab03`](https://github.com/nextlyhq/nextly/commit/7afab0353cf4d198f9c439904118904fa57f6ba4), [`fa80fb9`](https://github.com/nextlyhq/nextly/commit/fa80fb930a1663ddd6ba6b109a30351f85fea39f), [`6b5d7e1`](https://github.com/nextlyhq/nextly/commit/6b5d7e14c10499002a7fe6fab1c72a86b3efa668), [`73498e1`](https://github.com/nextlyhq/nextly/commit/73498e184a7b8511c2d8176b86367d29d0a7bd4f), [`121d24d`](https://github.com/nextlyhq/nextly/commit/121d24d41d4259cf4f34d603b41163c2bde7e3d0), [`be9b841`](https://github.com/nextlyhq/nextly/commit/be9b841a592e5c3af967939d1365628648ecdfaf), [`8081dde`](https://github.com/nextlyhq/nextly/commit/8081ddeae66019d3a78d08285983a106d044295e), [`0ab320c`](https://github.com/nextlyhq/nextly/commit/0ab320ca3ec011a1e1a7496fc24de27ba845738c), [`57c99aa`](https://github.com/nextlyhq/nextly/commit/57c99aaa176af1313475751d16fdea448c5dbf9f), [`19a3503`](https://github.com/nextlyhq/nextly/commit/19a350331b7187a4d7e54b44ff62165ddee96803), [`15256dc`](https://github.com/nextlyhq/nextly/commit/15256dcd74685c63da46dfca52968726ce2bed4e), [`39d7239`](https://github.com/nextlyhq/nextly/commit/39d72393bc3e2d6f36359c6f6b4c5aab24c1138d), [`608e1f0`](https://github.com/nextlyhq/nextly/commit/608e1f003a8661b28de2582aa3f3132890744824), [`ebec922`](https://github.com/nextlyhq/nextly/commit/ebec922f4d318ea887d4127812874b81fc817419), [`4ab4263`](https://github.com/nextlyhq/nextly/commit/4ab4263de5def601bd949f75f11f04451b44bd88), [`c271a3f`](https://github.com/nextlyhq/nextly/commit/c271a3f91ebde9ea9df03aa35abc8cae8bb28141), [`4a357ed`](https://github.com/nextlyhq/nextly/commit/4a357ed62671a9b04cf2702d54ff8be5664df45f), [`07211e7`](https://github.com/nextlyhq/nextly/commit/07211e7ffc16cdf79c8c9025b65ea8deac803de7), [`3c65a6f`](https://github.com/nextlyhq/nextly/commit/3c65a6f17409dd4689a696e66fa34b4aa9bd642c), [`c56257a`](https://github.com/nextlyhq/nextly/commit/c56257a0d8c05b0e0c6e9230c605b40b40e66d4b), [`71aadd1`](https://github.com/nextlyhq/nextly/commit/71aadd171b1e8da7c0675a792250545355127ac1), [`9b73b41`](https://github.com/nextlyhq/nextly/commit/9b73b41f19751dce06a4c35475b5e9479f8d3ca7), [`f7652e0`](https://github.com/nextlyhq/nextly/commit/f7652e025ea2e6d15ec48ccf11e6411a2de063f1), [`f0e0e52`](https://github.com/nextlyhq/nextly/commit/f0e0e52c56f12f1a77171246be490151b7082cae), [`85a2094`](https://github.com/nextlyhq/nextly/commit/85a20949d94cebddfd83978a574e18963a0e3b3f), [`a477920`](https://github.com/nextlyhq/nextly/commit/a47792062aa683cbe6ed7fdf0578fca38b011804), [`f87bbaf`](https://github.com/nextlyhq/nextly/commit/f87bbaffbac9d73be96daccf32d1ea4cf2d60ac2), [`6fe78db`](https://github.com/nextlyhq/nextly/commit/6fe78db7cd987c0a0a068869f4e65b8819b9b259), [`3e60c59`](https://github.com/nextlyhq/nextly/commit/3e60c595b6878e6762a014952c73b6e959b8b258), [`17ac818`](https://github.com/nextlyhq/nextly/commit/17ac8187d0f3b71ec5d74a45239f86ab69636dc6), [`04fd52f`](https://github.com/nextlyhq/nextly/commit/04fd52f8e04aa4df65307e937931569623dee2bf), [`0bae677`](https://github.com/nextlyhq/nextly/commit/0bae677b51ca396cfe844c89cbd351191e0e425d), [`2347689`](https://github.com/nextlyhq/nextly/commit/234768906066d12310820cb128960771a6fd8ad3), [`5f9ee97`](https://github.com/nextlyhq/nextly/commit/5f9ee9760dbf9af6180fb6bb492b74f5ca606df0), [`314a592`](https://github.com/nextlyhq/nextly/commit/314a592648b8f60f53c6ae5ce58e3ba7b5023803), [`65ecd20`](https://github.com/nextlyhq/nextly/commit/65ecd204302f6ee6a68ccc3345b5edf8d20bccc1), [`cc30a93`](https://github.com/nextlyhq/nextly/commit/cc30a93e2fe4b39c90ce81434804ee269600e29e), [`2ed4941`](https://github.com/nextlyhq/nextly/commit/2ed49414abf78ce3d1d3edb54fd9b69cafc9350f), [`8266c7e`](https://github.com/nextlyhq/nextly/commit/8266c7ed1aee084b253171d21759783f92baea0b), [`fecf9b4`](https://github.com/nextlyhq/nextly/commit/fecf9b407955a200c25f19a451c8d2e55e371519), [`6daef10`](https://github.com/nextlyhq/nextly/commit/6daef102908020fce0a160a98ecc6ede37128f7c), [`a167d97`](https://github.com/nextlyhq/nextly/commit/a167d97d3f2bab21e920818c36ea903372d44c15), [`2a41378`](https://github.com/nextlyhq/nextly/commit/2a41378438ea02d32f85072d0c65fb418df4875b), [`faa31d0`](https://github.com/nextlyhq/nextly/commit/faa31d0ed53ccd22363a8fe2485efa8b413fad79), [`aa707be`](https://github.com/nextlyhq/nextly/commit/aa707be11d4809934155d0268a1856a1f1dde0f4), [`e0f9d63`](https://github.com/nextlyhq/nextly/commit/e0f9d630aa4fb3c9f7c225e308299eadc1801117), [`eba8f00`](https://github.com/nextlyhq/nextly/commit/eba8f009d577d652c8abe44861405b9eed5c77f7), [`e7887fc`](https://github.com/nextlyhq/nextly/commit/e7887fcfa433361bc2b16f2545c8458defbdc5c3), [`e586815`](https://github.com/nextlyhq/nextly/commit/e586815a6bbc701e25ee7b41d5f0fbb696fb9558), [`f3dd57c`](https://github.com/nextlyhq/nextly/commit/f3dd57c8d5ec8ccf160f9541c26a1d4546d3924b), [`ddc8279`](https://github.com/nextlyhq/nextly/commit/ddc82790509b6a9f6ce98d9f9f1a7e0562204e9e), [`0962243`](https://github.com/nextlyhq/nextly/commit/09622434a9c0acae1c672b50f1261af9688eb4b2), [`ee72728`](https://github.com/nextlyhq/nextly/commit/ee72728b45efb2d250095ff295891fc741d59b23), [`bc33333`](https://github.com/nextlyhq/nextly/commit/bc333335bd1cccf149305ee89e8bda2775db82db), [`4735e39`](https://github.com/nextlyhq/nextly/commit/4735e39396103dc3ffd3b909db160764cd4b404a), [`f5b1fff`](https://github.com/nextlyhq/nextly/commit/f5b1fff7a6bd2cf91b134580dfc869c0c6ae6ff2), [`95253ee`](https://github.com/nextlyhq/nextly/commit/95253eef08315de3dcf1f5d4082937035250c7a6), [`1204813`](https://github.com/nextlyhq/nextly/commit/12048134ef5ce6d583104fff959f47a700750cfa), [`12cf1d5`](https://github.com/nextlyhq/nextly/commit/12cf1d5cce974443a71f10d8ba09bda7442d1cc9), [`7a9bede`](https://github.com/nextlyhq/nextly/commit/7a9bedee5552e908c144d2a6b274312bc7eeac7c), [`a9f0549`](https://github.com/nextlyhq/nextly/commit/a9f0549fee970670432f3230a5a6ac38604dca91), [`335a798`](https://github.com/nextlyhq/nextly/commit/335a798226437d449f6ca027895162a052c1f488), [`90d0ac7`](https://github.com/nextlyhq/nextly/commit/90d0ac7130ba37624d0d13f4375f8be86ee3c2e1), [`26f098e`](https://github.com/nextlyhq/nextly/commit/26f098e10c3837e5e7ac4227166ff202d40a13a4), [`bf8f378`](https://github.com/nextlyhq/nextly/commit/bf8f378f76fc91e077b835cab89df74fa7bdc789), [`029919b`](https://github.com/nextlyhq/nextly/commit/029919b1f708a2211552f8ef350a9bf4edfc5af8), [`c385099`](https://github.com/nextlyhq/nextly/commit/c385099ca7d12c1ab346a0078df2a06516eb3938), [`9d3f54b`](https://github.com/nextlyhq/nextly/commit/9d3f54bc82d800730d8d258ca61275ed9766ebd5), [`f1cfb4c`](https://github.com/nextlyhq/nextly/commit/f1cfb4c68dbbd96dd197268f3681e460f066ecab), [`de47354`](https://github.com/nextlyhq/nextly/commit/de47354d0e00feaae67b283b9f13add525d2179b), [`e773453`](https://github.com/nextlyhq/nextly/commit/e773453f843ea536854c420a2051657b5921ed26), [`f64216c`](https://github.com/nextlyhq/nextly/commit/f64216c7fc6f90d09e11d1468bf4d7154b47c9a0), [`ef95bb2`](https://github.com/nextlyhq/nextly/commit/ef95bb2d78ea44b94c5e2fc08a7c3268d1090b5f), [`ba637bb`](https://github.com/nextlyhq/nextly/commit/ba637bb0ba63aa0099ddf76a26426ae0d3464bd7), [`487ae9e`](https://github.com/nextlyhq/nextly/commit/487ae9e7a0ad9991401e5c762993061dd79c2ac2), [`46c5b1b`](https://github.com/nextlyhq/nextly/commit/46c5b1bcc45d09ad8e4126424bd300895ea7fd29), [`365e525`](https://github.com/nextlyhq/nextly/commit/365e525a92ca6388ccb7a7f448c3d7c057bead1f), [`a338bed`](https://github.com/nextlyhq/nextly/commit/a338bed44ab42779dc9f29f4bbe3b69870734220), [`d9de03a`](https://github.com/nextlyhq/nextly/commit/d9de03a872b39862a400088250733f7fd9e1f5fb), [`8594515`](https://github.com/nextlyhq/nextly/commit/8594515396ddb95cd261719cd94206f82d09af0c), [`267dc3a`](https://github.com/nextlyhq/nextly/commit/267dc3ac89866d51d82384c1965fc6a11a2e5808), [`4ae14b6`](https://github.com/nextlyhq/nextly/commit/4ae14b6dbf5e4a784bc439b67e5cb61f33c1aa96), [`edc1bcc`](https://github.com/nextlyhq/nextly/commit/edc1bcc5934236801d6e75f589eb47ed146c07aa), [`059c534`](https://github.com/nextlyhq/nextly/commit/059c534e64c09482192f1acd52f31aa5d294890a), [`b49cf66`](https://github.com/nextlyhq/nextly/commit/b49cf665972622e5b3f8200a8bf5fc5c0866428b), [`7fac9e1`](https://github.com/nextlyhq/nextly/commit/7fac9e19d0dec109bc0662492c5a276ae16b6ff7), [`6d665de`](https://github.com/nextlyhq/nextly/commit/6d665de80ca512ae3eeb946bcf027400680dd39d), [`b792cd5`](https://github.com/nextlyhq/nextly/commit/b792cd5d5b833e2b79211e02cd2b6f8bfcc05460), [`9a6c604`](https://github.com/nextlyhq/nextly/commit/9a6c604f19eb3071494321538bd4c1f102542666), [`a605100`](https://github.com/nextlyhq/nextly/commit/a605100b4865d92c079a3472b7a5a952281dcd3d), [`dfb4e5c`](https://github.com/nextlyhq/nextly/commit/dfb4e5c8acef8f0fa2bb17eb1c9bba5fb96f619e), [`8459ee8`](https://github.com/nextlyhq/nextly/commit/8459ee8c2c513f4dcfd34c207edd3abd57f6e992), [`6d7bfee`](https://github.com/nextlyhq/nextly/commit/6d7bfeeb030ab532170875d6ee8da9dcb635dad4), [`affdf1b`](https://github.com/nextlyhq/nextly/commit/affdf1b1001804dc0c13aad51f10a7ec4fc605ce), [`ee4dfaf`](https://github.com/nextlyhq/nextly/commit/ee4dfaf7265537af7ac281efc4a6d8adbd63994c), [`c4bbfca`](https://github.com/nextlyhq/nextly/commit/c4bbfca1277ded326bd931bc6498ddce88671af5), [`a8676af`](https://github.com/nextlyhq/nextly/commit/a8676aff9fa5bce30d6a99a7ff37808a7e6e5898), [`bb006c8`](https://github.com/nextlyhq/nextly/commit/bb006c84c8cd2778a5cfdcaa040c258a3286cb8d), [`e9482a8`](https://github.com/nextlyhq/nextly/commit/e9482a85d77fa0f93a5178be27aee20a9f7c877d), [`7ae13a2`](https://github.com/nextlyhq/nextly/commit/7ae13a2f136a0af465cdb23eae30384ae9d05e1c), [`e884620`](https://github.com/nextlyhq/nextly/commit/e884620a69128c40f0d40e80af7f5a414337da8b), [`897065d`](https://github.com/nextlyhq/nextly/commit/897065d021fa09b2e4bb48e10f612d44c237cf95), [`7377561`](https://github.com/nextlyhq/nextly/commit/7377561052980129cdd1d5743d8e288fddf901c3), [`2b51910`](https://github.com/nextlyhq/nextly/commit/2b51910ee545052c28a5ecba42d4542d131205eb), [`2dcc39a`](https://github.com/nextlyhq/nextly/commit/2dcc39a2a6b033958a984f02ae9ef154c9c77874), [`b62f245`](https://github.com/nextlyhq/nextly/commit/b62f24516976aecb0b75d8e8b1ea47334131365d), [`aefa10b`](https://github.com/nextlyhq/nextly/commit/aefa10b422b36e409425c14516ac00ad137ae824), [`070c448`](https://github.com/nextlyhq/nextly/commit/070c4485ad03d350b22e7ed20c5863cfe6de4d73), [`6c95bd8`](https://github.com/nextlyhq/nextly/commit/6c95bd8c4d93d5a54e5e37fb01df024361c48815), [`eee467e`](https://github.com/nextlyhq/nextly/commit/eee467e3400d6f10a475fdafb84f213cde9d1e7e), [`a3da6e2`](https://github.com/nextlyhq/nextly/commit/a3da6e23260c77aa8ee382e0abe1e38546ede400), [`d4e1357`](https://github.com/nextlyhq/nextly/commit/d4e1357bfc120ff945c4a8e9f1726781c0a9cbf0), [`2495e84`](https://github.com/nextlyhq/nextly/commit/2495e84503d2a31f96370e0d235e90837f7636b3), [`859d13a`](https://github.com/nextlyhq/nextly/commit/859d13aa0b549f88b7b5583d1947799a1a5cd6cc), [`b248448`](https://github.com/nextlyhq/nextly/commit/b24844852dce69d88a4305ca2f709591139c865b), [`bf1a301`](https://github.com/nextlyhq/nextly/commit/bf1a301660d5937bc9e2c842313467fa1db17741), [`28db6e8`](https://github.com/nextlyhq/nextly/commit/28db6e859aad30b5e031087f123f761b4affcdd7), [`a478b9d`](https://github.com/nextlyhq/nextly/commit/a478b9d46541130398709db1d9d2fd65ae031e0f), [`6190765`](https://github.com/nextlyhq/nextly/commit/6190765c9dec57f6dee058f6b43c523360aba879), [`ac210a9`](https://github.com/nextlyhq/nextly/commit/ac210a99bde5ae2bdda09147c7c31053e8c7a9f2), [`e7ff551`](https://github.com/nextlyhq/nextly/commit/e7ff551d2ba66c418849ab7170b9c59a93c3e8c9), [`a4cc703`](https://github.com/nextlyhq/nextly/commit/a4cc703f008b15eb038bd67941a397f60acc8378), [`e2081f0`](https://github.com/nextlyhq/nextly/commit/e2081f0053ee966c2c8381e166ae7ffbf5a3aa97), [`9c111af`](https://github.com/nextlyhq/nextly/commit/9c111af9b554bea634e0f51f0f1ac38be777dbf4), [`e03de7d`](https://github.com/nextlyhq/nextly/commit/e03de7de38e053129a4158f53d72d024f9e26e89), [`0295a2e`](https://github.com/nextlyhq/nextly/commit/0295a2e6f8b78393db17121bf90a69016293cb6e), [`d9b2d6a`](https://github.com/nextlyhq/nextly/commit/d9b2d6a0f0ee5fe64683c1a73b97795e2319b2f8), [`b9790cd`](https://github.com/nextlyhq/nextly/commit/b9790cdad91ba9020909df6ac9d1a556557912a8), [`64bac79`](https://github.com/nextlyhq/nextly/commit/64bac79797c136cf2f4c0d152a3b1bb6811883f6), [`1dcec94`](https://github.com/nextlyhq/nextly/commit/1dcec943fdd6845ef54744dd50b3c5eba487ac0a), [`0058669`](https://github.com/nextlyhq/nextly/commit/0058669a5083274e200d81aba9c881e7bb7e4a10), [`4205cec`](https://github.com/nextlyhq/nextly/commit/4205cec2836c02fd4b9419aab0fcaeff0a23c35a), [`4beae2b`](https://github.com/nextlyhq/nextly/commit/4beae2b80b9a5bcee4d4f7448ea9909dda378725), [`9bb7abe`](https://github.com/nextlyhq/nextly/commit/9bb7abea38f8c33eb4c5c9ea770b768d3216a590), [`276d4ab`](https://github.com/nextlyhq/nextly/commit/276d4aba2d48771abde2bc5524fe40c613358fff), [`365a5e7`](https://github.com/nextlyhq/nextly/commit/365a5e70b3e40cc7bec459eda24d9f594b47619a), [`2fc555e`](https://github.com/nextlyhq/nextly/commit/2fc555ecc72b84a602e13c4886046902ea8bbb52), [`acc0b50`](https://github.com/nextlyhq/nextly/commit/acc0b5083301c6011fa7ab9251c6b6805b65fde0), [`18e57b7`](https://github.com/nextlyhq/nextly/commit/18e57b7ed6e2f08ae40f72bde7d6f9b74f8e33da), [`a4f8978`](https://github.com/nextlyhq/nextly/commit/a4f89781a2513c179dedcc2049726b85e1154f1a), [`3241734`](https://github.com/nextlyhq/nextly/commit/3241734af409a5ae641b9faeddf495d5beb6e4ce), [`b273c12`](https://github.com/nextlyhq/nextly/commit/b273c12f05826b65e4eda55cdbf822a3c3f19f2e), [`a1ecead`](https://github.com/nextlyhq/nextly/commit/a1ecead9094a3fbe9633324ba7d3a7f24076bf5e), [`33ab4ae`](https://github.com/nextlyhq/nextly/commit/33ab4ae8caf02ebf30da1120314fcb9526ba2ab7), [`0a95cd3`](https://github.com/nextlyhq/nextly/commit/0a95cd31a189372fca42cb1c3ffea686b593f2bd), [`54b2069`](https://github.com/nextlyhq/nextly/commit/54b2069484280349e8b2ad5748452bf8fba8d5cd), [`8eaa797`](https://github.com/nextlyhq/nextly/commit/8eaa797fe5c4fc2ed1e342ae36a67c4185353245), [`0d773a3`](https://github.com/nextlyhq/nextly/commit/0d773a3769e48a6963cb42f536c312a6968d358f), [`05b07bd`](https://github.com/nextlyhq/nextly/commit/05b07bd764147af3b7bfb5603fb7482a1c951c31), [`63f1af9`](https://github.com/nextlyhq/nextly/commit/63f1af9797855ad8fb7f970d232929b8b7a32c4d), [`d11cf5f`](https://github.com/nextlyhq/nextly/commit/d11cf5f7f854c9fd9b6174155a8283d9656e3906), [`4ec73b9`](https://github.com/nextlyhq/nextly/commit/4ec73b9768f16fc58fcca5e562177b8b8e2f40fb), [`8462f9e`](https://github.com/nextlyhq/nextly/commit/8462f9e899f9318b0e7a46eade35199ebc4d7ca1), [`19b8619`](https://github.com/nextlyhq/nextly/commit/19b86192976409e9fa030444770b6139079dcc25), [`1ddc8b2`](https://github.com/nextlyhq/nextly/commit/1ddc8b28d9e593b501d619593d78d9602291d6cd), [`f7cc26c`](https://github.com/nextlyhq/nextly/commit/f7cc26c02e832bd9fb25e4464bac2e7332cb08f1), [`1e156b6`](https://github.com/nextlyhq/nextly/commit/1e156b6e55c8eafb2a467cc7f6791b606c9deaa8), [`d7036b3`](https://github.com/nextlyhq/nextly/commit/d7036b3a1549b8ab5e5984e72f3b59e1f99389cd), [`b77393f`](https://github.com/nextlyhq/nextly/commit/b77393f764cb7f6ba4a9b8f8ba60125f87d45154), [`b753cdf`](https://github.com/nextlyhq/nextly/commit/b753cdf257672b32d0cd55ca8d992d154765663f), [`ca39fa1`](https://github.com/nextlyhq/nextly/commit/ca39fa15db5d1305851d28d64dfa9e21b3cb5080), [`69f8bff`](https://github.com/nextlyhq/nextly/commit/69f8bff0e40a639945887073684edeffe9368ba1), [`73271b2`](https://github.com/nextlyhq/nextly/commit/73271b216227f92a023a4ecd99c165cc84ad7a99), [`2f904e5`](https://github.com/nextlyhq/nextly/commit/2f904e581f116ea95eb1c21421492eb82f67032f), [`59f29f4`](https://github.com/nextlyhq/nextly/commit/59f29f445d1b2a26e34fe7e844165c6d07b9dc7d), [`08bf5b7`](https://github.com/nextlyhq/nextly/commit/08bf5b77b8c7c172bf7c3bf98b8dcfd885f55f38), [`599eb46`](https://github.com/nextlyhq/nextly/commit/599eb465889e254f2d3fceabd70a264844ebbf71), [`6d93a0e`](https://github.com/nextlyhq/nextly/commit/6d93a0eeada2f79611ddfea76201cd1624741281), [`5157ca4`](https://github.com/nextlyhq/nextly/commit/5157ca47d804174e6d87271f4de922e72255d0b3), [`6a9a974`](https://github.com/nextlyhq/nextly/commit/6a9a974de6072bcfa15adca3e4e7eeff6225b387), [`2acbb54`](https://github.com/nextlyhq/nextly/commit/2acbb5402d3a5768ff56157979bff0f14844b205), [`5e7f557`](https://github.com/nextlyhq/nextly/commit/5e7f557b15a77fdce12f6ff195698b636a002b6b), [`61a82a6`](https://github.com/nextlyhq/nextly/commit/61a82a67a8a6caba3c3c37aaf0b66136fa9162d9), [`54f4ad9`](https://github.com/nextlyhq/nextly/commit/54f4ad9ebc091c0b25702ff29ca1735e7d772dcd), [`f4808ec`](https://github.com/nextlyhq/nextly/commit/f4808ecd358ad0e7b36431e93f84f5112242589d), [`a24683d`](https://github.com/nextlyhq/nextly/commit/a24683d1e12c836a5d8fcf13d569924e90d5b6ae), [`8a5c589`](https://github.com/nextlyhq/nextly/commit/8a5c58971e3ad87e55363075bafe4724d010b549), [`754ecd9`](https://github.com/nextlyhq/nextly/commit/754ecd9b218d161d36f67031c74108791d9329be), [`ece8953`](https://github.com/nextlyhq/nextly/commit/ece8953da2db8f1bc5071dfb0a8ab78317ecb8b1), [`c3e5354`](https://github.com/nextlyhq/nextly/commit/c3e5354368b77ea1789d6926c498301901715cb4), [`25688d9`](https://github.com/nextlyhq/nextly/commit/25688d9443e9287612171256bffce534ed756256), [`308bdd9`](https://github.com/nextlyhq/nextly/commit/308bdd9bb4a370cfa7bd1f48de0f03399a9c4768), [`96d7fd2`](https://github.com/nextlyhq/nextly/commit/96d7fd2b8b667ebf42cb62573149bf1cf8ff8b37), [`18c16c8`](https://github.com/nextlyhq/nextly/commit/18c16c8ddf28a1c0170258a981a7057cfeda6649), [`a44f6e4`](https://github.com/nextlyhq/nextly/commit/a44f6e4a23a8dde2393abcba9ac31e935702b6f4), [`a24cdb0`](https://github.com/nextlyhq/nextly/commit/a24cdb057f935ee33c7a270a6e4e4ece4883f732), [`73c32ec`](https://github.com/nextlyhq/nextly/commit/73c32ece3ae36139aff7a40c2a35679d5fde412f), [`0a5c11b`](https://github.com/nextlyhq/nextly/commit/0a5c11b1ed565aa2e2a71e787320f5c3cfe1480e), [`f95635e`](https://github.com/nextlyhq/nextly/commit/f95635eae3884a39c0d814c7a65ea10b9425179f), [`c90ea6d`](https://github.com/nextlyhq/nextly/commit/c90ea6d2e1fa05cc2171f568efde16eb4417cf89), [`2e4f252`](https://github.com/nextlyhq/nextly/commit/2e4f252151fe8e14a3f437e610074d0bf67fba10), [`69e42b4`](https://github.com/nextlyhq/nextly/commit/69e42b4d7ed85350d049ef366b5c0a168c3bcf01), [`a1adee6`](https://github.com/nextlyhq/nextly/commit/a1adee6f1cc5e676947259b6123c40af51f6794b), [`208049c`](https://github.com/nextlyhq/nextly/commit/208049c9012248b939e1a489d4dfd4157194202e), [`c843077`](https://github.com/nextlyhq/nextly/commit/c8430771063aa13110c9fda92eed16181544a249), [`d5b2cef`](https://github.com/nextlyhq/nextly/commit/d5b2cefbc75eb13de43bcaacbcdd74314d095a24), [`cc045e7`](https://github.com/nextlyhq/nextly/commit/cc045e75799e2136326031951a4d6f3c0aff8aae), [`9c5f185`](https://github.com/nextlyhq/nextly/commit/9c5f18518ab09c3413af925f8deea6689bac20be), [`095e254`](https://github.com/nextlyhq/nextly/commit/095e25438ab0cdb3b406025dc1539cf8989decba), [`7b0ea38`](https://github.com/nextlyhq/nextly/commit/7b0ea3899ef6c74eb4c8504de26e1a3c51301529), [`09e77c9`](https://github.com/nextlyhq/nextly/commit/09e77c98206e32abed563cbb3f3c0bc20c2d13fb), [`5984c90`](https://github.com/nextlyhq/nextly/commit/5984c90bdea3cb2b1b5d061f0cc584c91ceb22cd), [`807076d`](https://github.com/nextlyhq/nextly/commit/807076ddaeba266bfd7922cf609927365a59c871), [`343e49b`](https://github.com/nextlyhq/nextly/commit/343e49b16cf8d2370c90ce775b6eb3bc0bc24c71), [`c91bdc9`](https://github.com/nextlyhq/nextly/commit/c91bdc904bbad97816bfba5808b669cebf221c1b), [`e3e14dd`](https://github.com/nextlyhq/nextly/commit/e3e14dd6fd523d710c88cdfb107a39f1211d9fd8), [`2aab43a`](https://github.com/nextlyhq/nextly/commit/2aab43a3456a89e1d223955b779e714937771c73), [`a6c613d`](https://github.com/nextlyhq/nextly/commit/a6c613d8639d35c58e80e445df648e1278ed1528)]:
  - @nextlyhq/plugin-sdk@0.0.2-alpha.69
  - nextly@0.0.2-alpha.69

## 0.0.2-alpha.68

### Patch Changes

- [#2327](https://github.com/nextlyhq/nextly/pull/2327) [`cd5f971`](https://github.com/nextlyhq/nextly/commit/cd5f971a7cc84923e9f3c024117902bdcaeadff4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A core record written inside a plugin's PostgreSQL transaction (an email
  delivery or an audit row naming a plugin-defined person) runs under a
  savepoint of its own, and a failure rolls back only to it. The savepoint could
  open while plugin work started earlier was still running: a deletion report of
  several steps, or a query not yet sent. A rollback to it then undid that work
  while the transaction still committed. The savepoint now opens only once
  nothing the plugin started is in flight. A plugin read made meanwhile no
  longer fails the transaction, since a rollback cannot undo a read.

- [#2308](https://github.com/nextlyhq/nextly/pull/2308) [`0f38a7e`](https://github.com/nextlyhq/nextly/commit/0f38a7eee75d2da2d77223e730cb1089e4345810) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On PostgreSQL, a transaction that a failed statement had aborted was reported
  as committed. PostgreSQL does not refuse a COMMIT sent after a failure: it
  rolls the transaction back and answers with the ROLLBACK command tag, raising
  no error. So a callback that caught a failed statement and returned saw
  `transaction()` resolve while none of its writes were kept.

  **The PostgreSQL adapter's `transaction()`, and so `ctx.db.transaction`, now
  rejects in that case**, with a `DatabaseError` (`code` `25P02`): an error now
  replaces a silent rollback. `ctx.db.raw.transaction` is Drizzle's own
  transaction and is unchanged. Code
  that catches a failed statement inside a PostgreSQL transaction and carries on
  will see the transaction fail where it used to appear to succeed. Nothing it
  wrote was ever kept, so no data changes; only the report does. A bulk create
  or update without `stopOnError`, in which one item's statement failed, now
  reports every item failed, which is what was kept, where it used to count the
  items before the failure as saved. A statement
  that may fail, and that the rest of the work should not depend on, belongs
  outside the transaction.

  One core path did exactly that. A plugin that reports a person deleted inside
  `ctx.db.transaction`, and then sends the person an email naming them, has the
  email's record written inside that same transaction. The recorder never fails
  a send, so when that insert failed (a provider removed between the send and
  its record, a lock timeout), it caught the failure and carried on. On
  PostgreSQL the commit then rolled back the plugin's deletion, the audit
  erasure and the deleted-person record, while the plugin was told all three had
  committed. The person was never erased.

  A core record written inside a plugin's transaction (an email delivery or an
  audit row naming a plugin-defined person) now runs under a savepoint of its
  own on PostgreSQL. Its failure is rolled back to the savepoint and the
  plugin's transaction stays usable, so the deletion commits. If rolling back
  would also undo a write the plugin started while the record was being written,
  the transaction is failed instead, so no write the plugin was told about is
  lost unseen. MySQL keeps a transaction usable after a failed statement and has
  no savepoints in this adapter, so nothing changes there.

- [#2252](https://github.com/nextlyhq/nextly/pull/2252) [`2c7cd46`](https://github.com/nextlyhq/nextly/commit/2c7cd464de9084fe5b4394115aaa27f38ab11b42) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Nextly gains a record of content events, ready for the features that write
  to it: what happened to a document or a release, who or what did it (a
  person, an API key, a plugin-defined person, a release or the system, with
  the name they had then), when, and optionally the state before and after, a
  note, the version, a small kind-specific payload and a definition hash. The
  languages and shared fields an event involved are kept as parts, so history
  can be filtered and paged by language. Event kinds are registered by the core
  features that write them, and an event is written in the same transaction as
  the change it records. Nothing writes events yet. A subject's events are kept
  while it exists, and removed once the activity log's retention window has
  passed since its deletion, by the write paths' retention pass and the
  scheduled drain alike. Deleting a staff account removes its name from the
  events it performed and keeps its id as an opaque reference, as the audit
  trail does; a plugin reporting one of its people deleted removes their name
  and replaces their id with the keyed digest the audit trail names them by.
  Two new core tables, `nextly_content_events` and
  `nextly_content_event_parts`, are created by `nextly migrate`.

- [#2267](https://github.com/nextlyhq/nextly/pull/2267) [`13af656`](https://github.com/nextlyhq/nextly/commit/13af656be3cd9a1a3fda6c474384d7c3c4463ca3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now holds at most 200 documents (`RELEASE_MEMBER_LIMIT`, exported
  from `nextly/schemas`), down from 1,000: a full release on its own publishes
  within one pass of the job runner on every supported database. The limit is
  per release; releases due together that share a document are settled as one
  piece and take as long as all of their documents. Adding to a full release
  is refused with a conflict that says no more fit, and `can.addMember` is false
  for it. A release made before the limit and holding more keeps running as
  scheduled and can lose documents, but takes no new one.

- [#2289](https://github.com/nextlyhq/nextly/pull/2289) [`8b3589b`](https://github.com/nextlyhq/nextly/commit/8b3589b6160de9757ee7a3ba94e9b05a091896d3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A save no longer leaves an autosave behind it. An edit schedules a recovery
  point on a debounce, and a save made before that debounce ran used to be
  followed by the recording anyway, writing a copy of what the save had just
  stored. A recording waiting for an edit is now dropped once the editor is
  clean again (the edit was saved, or undone), and the recording checks at the
  moment it would run that there is still unsaved work to protect.

- [#2282](https://github.com/nextlyhq/nextly/pull/2282) [`f86547c`](https://github.com/nextlyhq/nextly/commit/f86547c4d381439a7062ada81ca3d0461085f105) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A save that changes nothing records no version, on every path, not only on
  a working draft: an unpublished document, a collection with history and no
  status, a Single, and each language of a translated document. The
  comparison is the one a working
  draft's save already used, so framework fields such as timestamps don't
  count as a change, and now neither do a component's own row timestamps,
  which made an unchanged save of a document with a component look changed
  whenever it landed in a later second (for a working draft too). A save
  that changes only a password records none either: a version never holds a
  secret, so it would show nothing. A save that changes the status still records one, and so
  do a create, a restore, a named version, and publishing or unpublishing
  every language. A save is compared with the document's newest version, and
  only when that version is in the save's own language; an unchanged save in
  another language still records one, since its own newest version can
  predate a change to the shared fields. This takes one extra read of the
  document's newest version per save of a document with history.

- [#2257](https://github.com/nextlyhq/nextly/pull/2257) [`1a8f237`](https://github.com/nextlyhq/nextly/commit/1a8f23772e629a49b401e745f91013234c7e28a7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The localization archive records which kind of entity each value came from, so a field group that shares its slug with a collection or a Single keeps its archived translations to itself.

  A field group's slug can equal a collection's or a Single's. Until now the archive kept only the slug, so restoring one entity read the other's archived values as well (the restore failed part-way when it tried to write them into the wrong table), and deleting one entity removed the other's archived values too. Each row now records `collection`, `single` or `fieldGroup` in a new `entity_kind` column, and restore and delete act only on rows of their own kind.
  - `nextly migrate`, and boot, add the column to an existing archive, and a Schema Builder save that archives brings an older archive up to date on its own. Rows written before the column existed are matched to their entity when exactly one holds their slug, counting only rows archived since that entity was created. The rest are kept, never deleted, and a restore of their slug reports them; `--kind` claims them.
  - `nextly i18n:restore` takes `--kind collection`, `--kind single` or `--kind field-group`. It is needed only when the slug names more than one kind; without it, such a restore is refused and the kinds are named.

- [#2281](https://github.com/nextlyhq/nextly/pull/2281) [`3991d77`](https://github.com/nextlyhq/nextly/commit/3991d771452d9d362f08406b12ac3682162b2987) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A boot on a database that lacks one of Nextly's core tables now says so. A
  release can add core tables, and an existing database gets them only through
  `nextly migrate`; a production boot never creates them. The boot used to
  start in silence, and the first write that needed a missing table failed far
  from the cause (deleting a document, for one, rolls back). It now logs one
  warning naming every missing core table and the command that creates them,
  beside the existing warning for missing columns, and keeps booting.

- [#2298](https://github.com/nextlyhq/nextly/pull/2298) [`b6051d7`](https://github.com/nextlyhq/nextly/commit/b6051d7bc85e1e42b4fcf8a7f22baa378994f354) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The record of content events writes an event by a plugin-defined person already reported deleted as their erasure left their earlier events: named by the keyed digest, with no name. Writing an event for such a person now requires the deleted-people check, read on the event's own transaction. Retention deletes each batch of events and their parts in one transaction, so a failed batch never leaves events without their parts.

- [#2277](https://github.com/nextlyhq/nextly/pull/2277) [`8124b14`](https://github.com/nextlyhq/nextly/commit/8124b14b84e359c7ecc6b80e71a8a8d5f3d741b5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard summary (`GET /api/dashboard/stats`) now gives each installation-wide count only to a caller who may read that resource: users to `read-users`, roles and permissions to `read-roles`, media to `read-media`, field groups to a settings read, and active API keys to the API-key read policy. For anyone else the field is left out of the response rather than sent as zero, so the answer no longer reveals how many users, roles, keys or media items exist. An API key is judged on its own grant. The admin's Team card and stats grids draw nothing for a missing count instead of 0, and the Team card shows its unavailable state when neither count is given.

- [#2306](https://github.com/nextlyhq/nextly/pull/2306) [`84719c5`](https://github.com/nextlyhq/nextly/commit/84719c51566ed1bd34dcd02487a5b19fa95d9653) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A field-type document view, such as the Page Builder's screen, now opens only for a field the edit form would let the author edit. Opened at its address for a field that is read-only, disabled, hidden, or hidden by its condition (its own, or an unnamed group's around it), the admin says why and offers the way back to the document, instead of drawing an editor that could save into the field.

  Where a document has several such fields and the address names none, the admin offers only the ones the author may edit, and opens the only one directly.

  The form also no longer draws a field marked `admin.hidden` that has its own editor (`admin.component`). Before, only fields drawn through the standard wrapper were hidden.

  The Page Builder's screen also starts afresh when its address moves to another blocks field of the same document. Before, it kept showing the first field's page and could save it into the second.

- [#2307](https://github.com/nextlyhq/nextly/pull/2307) [`d7577cc`](https://github.com/nextlyhq/nextly/commit/d7577cccdd3d97efe33400f2fa883d7c48043494) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In development, a page opened at `localhost`, `127.0.0.1` or `[::1]` can now sign in, set up the first admin and submit the other auth forms when the app's own address names another of those, as long as the request is sent to exactly the address the page is on. Before, opening `127.0.0.1` for an app at `localhost` was refused with "Invalid request origin". Another loopback name of the same port, any other host, and everything in production are refused exactly as before.

- [#2247](https://github.com/nextlyhq/nextly/pull/2247) [`ad96b66`](https://github.com/nextlyhq/nextly/commit/ad96b6660502524e84b1cf8111263f5520cf4915) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On MySQL, removing a field in the Schema Builder now drops its column.

  The Builder's ALTER generator wrote `ALTER TABLE … DROP COLUMN IF EXISTS`, a form MySQL does not accept (MariaDB does). On MySQL the drop failed, the column stayed, and a Required field's column, NOT NULL, refused every later entry, both for collections and for Singles. The same statement went into the migration file, where `nextly migrate` failed on it. PostgreSQL keeps `IF EXISTS`; MySQL and SQLite get the plain `DROP COLUMN`.

  Columns that an existing MySQL install kept from fields removed before this fix are not dropped by it: a save drops only the columns of the fields it removes. They stay, with their data, until removed on purpose.

  A collection save in the Schema Builder now applies whole or fails whole, and says why.
  - Before anything runs, the save checks the entries: a field made Unique over repeated values, a new Unique field whose backfill would repeat, and a text field narrowed below a value an entry holds are refused, naming the field. A refusal never shows a stored value.
  - The migration runs before the file and the registry are written. On PostgreSQL and SQLite it runs in one transaction, so a refusal changes nothing. On MySQL, which commits each schema statement, the refusal says which statement stopped it. Saving again finishes the change for what such a refusal most often leaves behind: a column already added or already removed, Draft/Published already turned on or off, a plain or unique index already created or dropped, and a translated field's companion column already added.
  - Turning Unique on or off for an existing field now creates or drops its unique index. Before, only the registry changed, so a field could be recorded unique while the table accepted repeats.
  - A new field whose name matches a column of another type already on the table is refused, naming the column, instead of being recorded over it.

- [#2290](https://github.com/nextlyhq/nextly/pull/2290) [`ea579d6`](https://github.com/nextlyhq/nextly/commit/ea579d64d259655b7666b372b199a7c0041edf8f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **On MySQL, turning localization off now brings the content back.** On MySQL,
  `nextly_meta`'s compare-and-set, and every statement guarded on one of its
  rows, never matched a stored value: the column is native JSON and the stored
  text was compared encoded twice. Postgres and SQLite were not affected.

  What a MySQL install saw, in every release since localization transitions were
  recorded (2026-07-31):
  - **Turning localization off on an entity copied nothing back onto its main
    table**, during `db:sync`, dev reloads and `nextly migrate`'s companion
    pass. The site went back to the values the entity had before it was
    localized, and edits made while it was localized looked lost. They were not:
    they are intact in the entity's translation table (`dc_<slug>_locales` for a
    collection), which is left in place.
  - Re-enabling localization after a disable did not refresh the translation
    table, so edits made while it was off stayed hidden.
  - A first enable copied its content, but every later pass reported that the
    transition was held by another process. Writing translations was not blocked.

  **Before you start the upgraded version, save any edit made directly to an
  affected entity's main table since you turned its localization off.** The first
  `nextly db:sync`, dev-server start or `nextly migrate` after upgrading restores
  the translation table's values onto the main table, replacing those edits. To
  list the rows where the two differ, run this for each entity whose localization
  you turned off, with its slug, its default locale and one comparison per
  translated field:

  ```sql
  SELECT m.id, m.updated_at, m.title AS on_main, l.title AS in_translations
  FROM dc_<slug> AS m
  JOIN dc_<slug>_locales AS l ON l._parent = m.id AND l._locale = '<default locale>'
  WHERE NOT (CAST(m.title AS BINARY) <=> CAST(l.title AS BINARY));
  ```

  The binary cast on both sides makes the comparison exact and keeps it null-safe:
  under MySQL's default collation, `<=>` alone takes `Foo` and `foo` for the
  same value, so an edit that changed only letter case or accents would not be
  listed. For an entity defined with `timestamps: false`, leave out
  `m.updated_at`: it has no such column.

  A row whose `updated_at` is later than the disable was edited on the main
  table since, and the upgrade replaces it with `in_translations`. Every other
  listed row is an edit made while the entity was localized, which the upgrade
  brings back. `updated_at` moves only with saves made through Nextly: a row
  changed outside it (from a SQL client or a script) can keep an older
  `updated_at`, so if anything wrote to the main table that way, judge its rows
  by their values, not by the date.

  Recovery, after upgrading: run `nextly db:sync` (or start the dev server, or
  run `nextly migrate`). For an entity whose localization was turned off, the
  earlier pass never recorded the restore as done, so this pass restores the
  default language's values from the translation table onto the main table. A
  stuck first enable settles on the same pass.

  A migration file that turns localization off was never affected: its own
  statements restore and archive before the translation table is dropped.

- [#2313](https://github.com/nextlyhq/nextly/pull/2313) [`fed7bf6`](https://github.com/nextlyhq/nextly/commit/fed7bf671e598439eefe5fa36e2d421ed4e2dd84) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin route declared with `rateLimit: "auth"` can no longer be closed to everyone by one visitor when no client address can be read (the default, without `security.trustProxy`). Before, every such client shared one bucket per route, so one visitor spending the auth budget refused the route to all. Now each request counts against the identity the route's new, optional `limitKey` names, at the auth budget, under a ceiling of 100 times that budget that only the plugin's own auth routes share. A route without a `limitKey` is bounded by that ceiling alone, and the server names it at startup. Core's sign-in and other plugins keep their own ceilings. Auth routes are no longer listed in the startup warning about routes sharing one limit.

- [#2325](https://github.com/nextlyhq/nextly/pull/2325) [`fee1a1f`](https://github.com/nextlyhq/nextly/commit/fee1a1f9a98c9860a45c380a33348469bbb3dd54) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Requests from clients whose address cannot be read are now charged to the identity they name at the time they are admitted, with the shared ceiling still spent when they arrive. On a plugin's `rateLimit: "auth"` route, the body was read after the ceiling but charged at the time the request began, so a caller holding several bodies open longer than the window could make each charge land at a time already expired, and spend an identity's budget more than once. The route now spends the plugin's ceiling on arrival, before its body is read, so the ceiling also bounds how many requests a caller can hold open, and charges the identity once the body is in. Without a shared store, the ceiling place a request spent moves with its charge, so the two still expire together; core's token routes and strategy-keyed sign-ins are charged the same way.

  The once-per-process warning about proxy client-address headers that could not be used also now says how a plugin's auth route counts such requests: by the identity its `limitKey` names, or against one budget its requests naming no identity share, under that plugin's own ceiling, or by the ceiling alone without a `limitKey`.

- [#2309](https://github.com/nextlyhq/nextly/pull/2309) [`516a049`](https://github.com/nextlyhq/nextly/commit/516a0497a5c86a3f18664c8dd8bcb8a2e47068e6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A sign-in challenge (a second step, such as a one-time code) whose answer the server refuses because the page is open at an address the app does not accept now shows the same notice as the sign-in form: both addresses, and where to go. Before, the challenge view showed only a short message.

- [#2284](https://github.com/nextlyhq/nextly/pull/2284) [`e961c97`](https://github.com/nextlyhq/nextly/commit/e961c97a428d668abecc6131507ad2305b2408b0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A sign-in, first-run setup or other signed-out form whose submission is refused now says so in the form. When the page is open at an address the app does not accept, for example `127.0.0.1` for an app at `localhost`, it names both addresses and links to the same page at the app's own. Before, the form looked unchanged. The auth routes' 403 `CSRF_FAILED` answer now carries `data.reason` (`"origin"` or `"token"`) and, for an origin, `data.appOrigin`; what they accept is unchanged.

- [#2255](https://github.com/nextlyhq/nextly/pull/2255) [`98711ba`](https://github.com/nextlyhq/nextly/commit/98711baea778f41644f18ac777380788367d9e48) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release's documents are checked before the moment, and a hard problem stops
  scheduling. `GET /api/releases/:id/readiness` and `nextly.releases.readiness()`
  report each document's hard problems (no author, an author who is gone or may
  no longer publish or unpublish it, a document that is gone, a collection or
  Single without a draft/published lifecycle or whose translations lack a
  per-language status, unreleased work held in another language, a document going live that fails validation or edits
  a field its author may no longer write) and soft ones (another scheduled release holds it,
  and which one wins). Every document is checked, however many the release holds.
  Scheduling, Publish now and adding a document to a scheduled release are refused
  while a hard problem stands, as a `409 CONFLICT` naming each problem in
  `data.problems`, alike over REST and the Direct API. A document coming down is
  never validated. `PATCH /api/releases/:id/members/:memberId` and
  `nextly.releases.changeMemberAction()` switch a document between going live and
  coming down, checking the new action as the document's author in a scheduled
  release. The blocking reasons are now derived from the same checks. All of this
  is experimental. Publish now judges each member by its author, as the scheduled
  run does.

- [#2312](https://github.com/nextlyhq/nextly/pull/2312) [`6863300`](https://github.com/nextlyhq/nextly/commit/68633003a37eaa49d1dc1c2fd5eb90837083100b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly.releases.find()` and `nextly.releases.count()` take their query as optional again, which restores the alpha.67 signature: a call with no argument compiles and lists or counts every release the caller can see.

  A release's readiness check now judges each document's own write before the moment. A status the author's field rules would not let them set is reported as `FIELD_NOT_PERMITTED` rather than refused when the release runs, and a document taken down with a pending change is judged on that change, as the takedown folds it in. The checks also read each collection's stored documents and translations once per batch.

- [#2328](https://github.com/nextlyhq/nextly/pull/2328) [`475c76e`](https://github.com/nextlyhq/nextly/commit/475c76eb3dc88a219822a4ca4fd6912bf0131387) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release's readiness check no longer blocks a release whose run would succeed over a protected field the pending change left alone.
  - A many-to-many relationship (a Schema Builder collection's) is compared using every id the document stores, as the release's write reads it. A related document unpublished or removed since no longer makes an unchanged relationship read as edited, and a failed read of the stored ids fails the check instead of reading as an empty relationship.
  - For a localized collection, the live document the pending change is compared with now carries the default language's stored translations, as the write's does. An unchanged protected translation no longer reads as edited.

- [#2291](https://github.com/nextlyhq/nextly/pull/2291) [`f8d3eee`](https://github.com/nextlyhq/nextly/commit/f8d3eeeeb53a9f29bada6b2e22c47b26f2f0bd5d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A content release can now be renamed and deleted, under two new permissions. `update-content-releases` lets a person change a release's title and description in any state, through `PATCH /api/releases/:id` or `nextly.releases.update()`. `delete-content-releases` lets a person delete a release that never ran, with its documents, through `DELETE /api/releases/:id` or `nextly.releases.delete()`: a draft, or a release cancelled before it was ever scheduled. Every other release is refused with a conflict whose `data.reason` says why: a scheduled or stopped release (`committed`) can be cancelled to call it off, and is then kept; a published one (`published`) stays as the record of what went live; and a cancelled release that was ever scheduled (`was-scheduled`) is kept as a record too, because nothing stored says whether it began to run before it was called off. The delete answers with the release as it was. Each rename and deletion is recorded in the activity log, and the capabilities sent with every release gain `update` and `delete`, so the admin can offer only what the caller may do. All of this is experimental until the releases redesign is complete.

  An existing installation receives both permissions the first time it boots, granted so that nobody gains or loses anything: super-admins hold both, every role holding `create-content-releases` gains `update-content-releases`, and every role holding `publish-content-releases` gains `delete-content-releases`. The grants are made once, when the permissions are created, so a permission an administrator later takes from a role is not given back on the next restart.

- [#2323](https://github.com/nextlyhq/nextly/pull/2323) [`39d3273`](https://github.com/nextlyhq/nextly/commit/39d3273f8b4dcdf6b3be0ef1a1cb1fa3f798e50f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A REST request's per-address budget is no longer split by a collection name
  the caller chooses. The collection was read from anywhere in the URL, query
  included, and every name opened a counter of its own, so one address could
  rotate a query value or an invented collection slug and never meet its
  budget, and invalid API keys could be looked up past their bound the same
  way. The collection now comes from the path alone, and only a collection with
  limits of its own in `rateLimit.collections` keeps a separate budget; every
  other request counts against the address's one budget.

- [#2310](https://github.com/nextlyhq/nextly/pull/2310) [`b5aefd4`](https://github.com/nextlyhq/nextly/commit/b5aefd4e468a92351a4c1264bcc0e1927812d49f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The REST rate limit now applies to every request, the admin API included, and
  counts each one by who is asking. A signed-in session spends a budget of its
  own, five times the per-address budgets by default (`rateLimit.sessions`), so
  the admin's parallel page loads no longer need an exemption. An API key that
  resolves spends its own `apiKeys.rateLimit` budget, counted once per request,
  and a plugin's signed-in people each spend a budget the size of a session's.
  Requests carrying neither from an address the server cannot resolve share a
  ceiling of ten times the per-address budgets (`rateLimit.unresolvedCeiling`),
  which never refuses a session, a key or a sign-in. Invalid API keys and
  unresolvable plugin people are bounded before the next lookup. An app that
  relied on the old exemption can pass the deprecated `defaultSkipAdminApi` as
  `rateLimit.skip`; a later release removes it.

  The limit's defaults now have one source, 100 reads and 30 writes a minute
  per address, which is what every app configured through `defineConfig` already
  ran on. A limiter built with no values used a second copy of 600 and 120; it
  now uses the same 100 and 30. That narrows only code that reaches the limiter
  without a sanitized config: `createRateLimiter()` called without `readLimit`
  or `writeLimit`, and `createDynamicHandlers()` created without a config. Pass
  the limits explicitly to keep the old numbers.

- [#2286](https://github.com/nextlyhq/nextly/pull/2286) [`9425e32`](https://github.com/nextlyhq/nextly/commit/9425e3216eecd2dca266b5e1b88d87e2a5c7ff38) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Schema Builder's change dialog says what happens to a field's translations when it stops being translated.
  - Before you save, the dialog lists each field leaving translation, how many translated values move to the archive and in which languages, and that the default language's value stays as the shared one. A field badge reads "no longer localized".
  - A change that can't be made in one save is refused with the steps to take: a Required field can't stop being translated in the same change, so the dialog says to turn off Required and save, turn off Localized and save, then turn Required back on.
  - The command that restores the archived values (`nextly i18n:restore`) is shown on one line, with a copy button.
  - The dialog's Save button now uses the primary style rather than the destructive red, which it used for every change.

- [#2292](https://github.com/nextlyhq/nextly/pull/2292) [`7ddcc0e`](https://github.com/nextlyhq/nextly/commit/7ddcc0e7a73179fb5750b9aeb453df38abf9b8b0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An auth strategy can now name the account a sign-in targets, with an optional
  `limitKey` (`@experimental`, exported from `@nextlyhq/plugin-sdk` with its
  `AuthLimitAnswer` type). When the client's address cannot be read, the sign-in
  rate limit then keys that strategy's sign-ins on what it reads, such as a
  username or an OAuth code, so rotating the `email` in the body no longer buys
  a fresh budget. A strategy without `limitKey` keeps sign-ins keyed on the
  `email` they carry, as before, and the server names it at startup while the
  limit is on.

- [#2287](https://github.com/nextlyhq/nextly/pull/2287) [`ec02ef1`](https://github.com/nextlyhq/nextly/commit/ec02ef1a2a701a54d0078dc846595e1012be78bb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The editor header is rearranged. The top row holds the way back to the
  collection's list at the left and every action at the right, with History
  first. The title has a line of its own below at full width, so it is no
  longer cut to a few words wherever the actions take the width, and the save
  state moves to a status line under it. Save draft, Unpublish and the other
  secondary document verbs keep their words at every width: they draw no icon,
  so at narrow widths they used to leave an empty bordered button. On a
  phone, History and the preview move into the document's menu and the panel
  toggle goes, so the actions keep to one row. What each control does is
  unchanged.

- [#2294](https://github.com/nextlyhq/nextly/pull/2294) [`5242780`](https://github.com/nextlyhq/nextly/commit/5242780983629942f8a7cf78493927a0d853d869) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Page Builder opens as a screen of its own, at the page's own address:
  `/admin/collections/<slug>/<id>/builder`, or `/admin/singles/<slug>/builder`
  for a Single. Before, it opened over the entry form. A reload keeps the author
  in the builder, a link to it can be shared, and Exit editor goes back to the
  page's form. The admin holds the page's soft lock, the offer to restore unsaved
  work, and the question before leaving with unsaved changes. Saving a pattern no
  longer saves the page as well. If a colleague takes the page over, the author's
  unsaved edits stay in their form until they take it back.

  A page that has never been saved has no address yet, so its Page Builder card
  asks the author to save it first. The Page Builder edits the default language:
  opened from another language's edit screen, it opens the default one, and the
  card says so.

  **Compatibility.** The Page Builder now opens only for a blocks field at the top
  level of a collection or a Single, including one inside an unnamed group.
  - **Who is affected:** a site that declares a blocks field inside a named group
    or a repeater. That field's card still shows the page, but offers no way into
    the builder, and startup logs a warning naming the collection and the field.
    The warning covers fields declared in code; for a collection made in the
    Schema Builder, the card is what says it.
  - **What to do:** move the field to the top level of its collection or Single
    to edit it visually, or keep it where it is until nested fields are
    supported.

  The builder is a document view at the `builder` address on every document
  with a top-level blocks field, so another plugin declaring a document view at
  `builder` is refused at startup, naming both plugins.

- [#2302](https://github.com/nextlyhq/nextly/pull/2302) [`35ec0e6`](https://github.com/nextlyhq/nextly/commit/35ec0e67e5514362011a9c9e23996b79fa1d8c2e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Two follow-ups to recent schema-save and localization-archive fixes.
  - A collection save that makes a field unique and shortens it at once checks both: a value longer than the new length is refused, naming the field, rather than truncated by PostgreSQL's cast while the save succeeds.
  - On MySQL, an archive row from before the archive recorded its entity's kind is matched to an entity only when it was archived more than 42 hours after the entity's recorded creation (14 on PostgreSQL). On MySQL the creation time, the archive time and the reading of it are all in the session's time zone, which may differ each time, so a narrower margin could give an older entity's translations to a newer one with the same slug. Rows inside the window stay unresolved: kept, reported by a restore and restored by naming their kind.

- Updated dependencies [[`cd5f971`](https://github.com/nextlyhq/nextly/commit/cd5f971a7cc84923e9f3c024117902bdcaeadff4), [`0f38a7e`](https://github.com/nextlyhq/nextly/commit/0f38a7eee75d2da2d77223e730cb1089e4345810), [`2c7cd46`](https://github.com/nextlyhq/nextly/commit/2c7cd464de9084fe5b4394115aaa27f38ab11b42), [`13af656`](https://github.com/nextlyhq/nextly/commit/13af656be3cd9a1a3fda6c474384d7c3c4463ca3), [`8b3589b`](https://github.com/nextlyhq/nextly/commit/8b3589b6160de9757ee7a3ba94e9b05a091896d3), [`f86547c`](https://github.com/nextlyhq/nextly/commit/f86547c4d381439a7062ada81ca3d0461085f105), [`1a8f237`](https://github.com/nextlyhq/nextly/commit/1a8f23772e629a49b401e745f91013234c7e28a7), [`3991d77`](https://github.com/nextlyhq/nextly/commit/3991d771452d9d362f08406b12ac3682162b2987), [`b6051d7`](https://github.com/nextlyhq/nextly/commit/b6051d7bc85e1e42b4fcf8a7f22baa378994f354), [`8124b14`](https://github.com/nextlyhq/nextly/commit/8124b14b84e359c7ecc6b80e71a8a8d5f3d741b5), [`84719c5`](https://github.com/nextlyhq/nextly/commit/84719c51566ed1bd34dcd02487a5b19fa95d9653), [`d7577cc`](https://github.com/nextlyhq/nextly/commit/d7577cccdd3d97efe33400f2fa883d7c48043494), [`ad96b66`](https://github.com/nextlyhq/nextly/commit/ad96b6660502524e84b1cf8111263f5520cf4915), [`ea579d6`](https://github.com/nextlyhq/nextly/commit/ea579d64d259655b7666b372b199a7c0041edf8f), [`fed7bf6`](https://github.com/nextlyhq/nextly/commit/fed7bf671e598439eefe5fa36e2d421ed4e2dd84), [`fee1a1f`](https://github.com/nextlyhq/nextly/commit/fee1a1f9a98c9860a45c380a33348469bbb3dd54), [`516a049`](https://github.com/nextlyhq/nextly/commit/516a0497a5c86a3f18664c8dd8bcb8a2e47068e6), [`e961c97`](https://github.com/nextlyhq/nextly/commit/e961c97a428d668abecc6131507ad2305b2408b0), [`98711ba`](https://github.com/nextlyhq/nextly/commit/98711baea778f41644f18ac777380788367d9e48), [`6863300`](https://github.com/nextlyhq/nextly/commit/68633003a37eaa49d1dc1c2fd5eb90837083100b), [`475c76e`](https://github.com/nextlyhq/nextly/commit/475c76eb3dc88a219822a4ca4fd6912bf0131387), [`f8d3eee`](https://github.com/nextlyhq/nextly/commit/f8d3eeeeb53a9f29bada6b2e22c47b26f2f0bd5d), [`39d3273`](https://github.com/nextlyhq/nextly/commit/39d3273f8b4dcdf6b3be0ef1a1cb1fa3f798e50f), [`b5aefd4`](https://github.com/nextlyhq/nextly/commit/b5aefd4e468a92351a4c1264bcc0e1927812d49f), [`9425e32`](https://github.com/nextlyhq/nextly/commit/9425e3216eecd2dca266b5e1b88d87e2a5c7ff38), [`7ddcc0e`](https://github.com/nextlyhq/nextly/commit/7ddcc0e7a73179fb5750b9aeb453df38abf9b8b0), [`ec02ef1`](https://github.com/nextlyhq/nextly/commit/ec02ef1a2a701a54d0078dc846595e1012be78bb), [`5242780`](https://github.com/nextlyhq/nextly/commit/5242780983629942f8a7cf78493927a0d853d869), [`35ec0e6`](https://github.com/nextlyhq/nextly/commit/35ec0e67e5514362011a9c9e23996b79fa1d8c2e)]:
  - nextly@0.0.2-alpha.68
  - @nextlyhq/plugin-sdk@0.0.2-alpha.68

## 0.0.2-alpha.67

### Patch Changes

- [#2075](https://github.com/nextlyhq/nextly/pull/2075) [`57bcb18`](https://github.com/nextlyhq/nextly/commit/57bcb188b3c33ac3c543aa491368a9c65f51166a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An update or delete by `where` under access rules now refuses a `where` on a
  field the caller may not read in the collection bulk service itself, before
  any row is found or written. The Direct API already refused it; the REST bulk
  routes, which reach the service without the Direct API in front, did not, so
  a caller allowed to write but not to read a field could guess its value and
  learn from which rows changed whether it matched. Callers with
  `overrideAccess: true` are unaffected.

- [#1874](https://github.com/nextlyhq/nextly/pull/1874) [`ce962c7`](https://github.com/nextlyhq/nextly/commit/ce962c7c0eda26659674261f544ea545e48afa2e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A class whose id was `__proto__` could not be renamed again after a refused
  save. The class manager records which rename of each class is the live one, and
  it kept that record on a plain object keyed by class id, where `__proto__` reads
  back an inherited object and a write to it stores nothing. The refused rename
  never released its pending name, so retrying the same name was taken as no
  change at all.

  The record is now a `Map`, and the pending names are read as the record's own
  entries in both the editor and the class manager panel, so a class behaves the
  same whatever id it carries.

- [#2032](https://github.com/nextlyhq/nextly/pull/2032) [`f6b972f`](https://github.com/nextlyhq/nextly/commit/f6b972f47252e9238a3f6dfef3fb1083a8aad8c1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin cleared by `clearServices()` now reaches every service it was started with during its teardown, including those its context looks up through the container itself, such as `ctx.services.jobs` and `ctx.audit`. Those found the container empty, so a `destroy` that queued final work or wrote an audit entry failed, or its entry was dropped. A second `clearServices()` before the next registration, or one that arrives while that teardown is still running, no longer takes away the services it needs.

- [#2012](https://github.com/nextlyhq/nextly/pull/2012) [`357cd7f`](https://github.com/nextlyhq/nextly/commit/357cd7f02360dee17759cbb5fb0d44b2aa74453a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin cleared by `clearServices()` is torn down when services register
  again, and its `destroy` can now still reach the services it was started with.
  `clearServices()` used to empty the container they lived in at once, so a
  teardown that opened a transaction, as `ctx.db.transaction` does through the
  adapter on SQLite, failed half-way and the new registration went on with the
  old plugin's cleanup unfinished. The plugin docs no longer say `destroy` runs
  on a hot reload in the author guide's example or the contributing checklist.

- [#2054](https://github.com/nextlyhq/nextly/pull/2054) [`4c13e6d`](https://github.com/nextlyhq/nextly/commit/4c13e6dbbfb1fc0f5720108231e2a20b16f10162) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A plugin route that sets `csrf: true` now checks the origin of a POST, PUT,
  PATCH or DELETE that no session authenticates, before its handler runs. Before,
  such a request was not checked at all, so a guest-facing route, such as a cart
  that keeps its own cookie, accepted a cross-site form post. The request must
  name your site or an origin in `NEXTLY_ALLOWED_ORIGINS`, as a signed-in write
  must; one naming another origin, or none, is refused with `CSRF_FAILED`. It
  is not asked for a CSRF token. A session cookie that is expired or malformed
  authenticates nobody, so its caller is checked the same way, and is no longer
  asked for a token it could not hold.

  Only an `Authorization: Bearer` token, with the scheme in any case, now exempts
  a request no session authenticates from the check, whether or not the token is
  a valid key. A request a session authenticates is checked as the session's,
  whatever header it also carries. Any other
  scheme, such as the Basic, Digest, Negotiate or NTLM credentials a browser
  attaches on its own, no longer does.

  The plugin route documentation now lists which callers each `csrf` setting
  checks.

  **Compatibility:** a client that writes to a public route with `csrf: true`
  without a session or a `Bearer` token, such as a server job, must now send
  `Origin` with your site's origin or an allowed one, or it is refused. A route
  meant for webhooks or other server callers should leave `csrf` unset, which
  still checks no anonymous write. No first-party plugin route sets `csrf: true`.

- [#2214](https://github.com/nextlyhq/nextly/pull/2214) [`27b47fe`](https://github.com/nextlyhq/nextly/commit/27b47feeaaa8a1610a9794c46c33c1e2b1e7977c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Retention never removes a version a feature has pinned. A feature registers
  itself as a pin holder once, then points named slots at versions of a document
  (`versionPins.holder(name).pin(tx, { ref, slot, versionNo })`); moving a slot
  frees the version it left, and a version stays while any slot of any feature
  points at it. `registerVersionPinHolder`, `versionPins` and their types are
  exported from `nextly` as experimental, and the versions docs describe them.
  Pins are kept in a new core table, `nextly_version_pins`, which `nextly
migrate` creates on an existing database, and they go with their document or
  Single when either is deleted. A pin takes the document's write lock, so it
  cannot slip past a save's retention pass.

- [#2163](https://github.com/nextlyhq/nextly/pull/2163) [`b7948bb`](https://github.com/nextlyhq/nextly/commit/b7948bb87d4b4958a6a5b662076dd87501f1e0fa) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Whether a caller may filter, sort, group or search on a field now follows
  whether the field's `read` rule lets that caller read it. Before, any field
  with a `read` rule was refused for every caller, the ones the rule allows
  included.

  The rule is asked for the caller with no entry, since a query has none yet:
  - **A rule that allows the caller outright** (by role, permission or
    identity, such as `({ req }) => req.user?.role === "admin"`) now lets that
    caller filter, sort and group on the field, and a collection's search
    matches on it for them.
  - **A rule that refuses the caller** is refused as before, with a `400`
    naming the field as written: `FIELD_NOT_FILTERABLE`, `FIELD_NOT_SORTABLE`
    or `FIELD_NOT_GROUPABLE`. A collection's search leaves the field out.
  - **A rule that needs the entry to decide**, such as
    `({ req, data }) => data?.owner === req.user?.id`, cannot allow without one,
    so the field cannot be queried by anyone, its owner included, and search
    leaves it out. A filter or an ordering on it would reveal its value on the
    entries where it is hidden. To query by ownership, filter on the owner field
    itself.

  A widget data source still offers a group key only when no `read` rule
  guards the field, since one source serves every caller.

- [#2140](https://github.com/nextlyhq/nextly/pull/2140) [`1db672e`](https://github.com/nextlyhq/nextly/commit/1db672eafeeff8ea745d5eee893378ebeac7a001) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A filter that is not well formed is now refused instead of being run without
  its bad part. Before, each form below was dropped on the way to the database,
  so the read matched more entries than the filter stated, and a filter that
  narrowed by owner or team could quietly return every entry. Through REST each
  answers `400` with a `VALIDATION_ERROR` naming the problem at `where.<path>`;
  through the Direct API, `find`, `count`, grouping, timelines and the
  bulk-by-query writes throw the same typed `NextlyError`.

  Newly refused, and what to write instead:
  - **An unknown operator** (`{ title: { equal: "a" } }`, or `startsWith`) —
    `FILTER_UNKNOWN_OPERATOR`. Use one of `equals`, `not_equals`,
    `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`,
    `like`, `contains`, `search`, `in`, `not_in`, `exists`, `near`, `within`.
  - **An unknown field**, or one with no column on the collection's table, such
    as a many-to-many relationship (`FILTER_UNKNOWN_FIELD`). Check the field's
    name; for a many-to-many relationship, read the related ids first and filter
    on `id`.
  - **A dot path that is not into a component** (`{ "author.name": … }`,
    `{ "meta.key": … }`) — `FILTER_UNFILTERABLE_PATH`. It used to compare the
    whole `author` or `meta` column with the value. Look the related entry's id
    up first and filter on the relationship field: `{ author: { equals: id } }`.
  - **`undefined`**, as a field's value or an operator's —
    `FILTER_UNDEFINED_VALUE`. Leave the condition out.
  - **An empty `in`** (`{ id: { in: [] } }`) — `FILTER_EMPTY_IN`. It matches no
    entry, so skip the query, or leave the condition out if you meant "any".
    An empty `not_in` still excludes nothing.
  - **An `and` or `or` that is not a list of filters**, or a list with a gap or
    a non-object in it — `FILTER_INVALID_LOGICAL` / `FILTER_NOT_AN_OBJECT`.
    Write `and: [{ … }, { … }]`.
  - **An operand of the wrong type** — `FILTER_INVALID_OPERAND`: an object or
    list given to `equals` (use `in` for several values), a value that is not a
    list given to `in` or `not_in` (write `["value"]`), `null` given to any
    operator or as a field's value (write `{ exists: false }`, or
    `{ exists: true }` for `not_equals: null`), a list given as a field's value
    (write `{ in: [...] }`), `exists` with anything but `true` or `false`, and a
    `near` or `within` that does not parse. A geo operand now parses only in its
    documented form: an unknown unit (it used to mean metres), parts beyond the
    last one the format names (they used to be ignored), or a number with
    trailing text (`5abc` used to read as 5) is refused.
  - **An empty condition** (`{ title: {} }`) — `FILTER_NO_OPERATOR`. Name an
    operator or leave the field out.
  - **A malformed language filter** (`_translated` without a `locale` string
    and a known `state`, or anywhere but the top level) —
    `FILTER_INVALID_OPERAND` / `FILTER_MISPLACED_KEY`.
  - **A component field or a geo operator inside `or`** — `FILTER_NOT_IN_OR`.
    Both are applied as a condition every entry must meet, so inside `or` they
    turned the alternative into a requirement. Move them to the top level or
    into `and`.
  - **A REST `where` that is not valid JSON, or not an object** —
    `FILTER_INVALID_JSON` / `FILTER_NOT_AN_OBJECT`. It used to read as no
    filter at all.
  - **A REST request carrying both `where=` JSON and `where[…]` parameters** —
    `FILTER_GIVEN_TWICE`. The bracket conditions used to be ignored. Send one
    form.
  - **A REST bracket key that is not bracketed segments**
    (`where[title]equals=a`), that names `__proto__`, whose list index is 50 or
    more (the most conditions a filter may have), that nests under a value
    another parameter gave, that mixes list indexes and named keys at one level,
    whose index has leading zeros, or that repeats a condition already given —
    `FILTER_INVALID_KEY`. A `__proto__` field key in a JSON `where` is refused
    as an unknown field. Fields named `constructor` or `prototype` filter as any
    other field does.
  - **A REST filter on the owner column** (`created_by`, `createdBy`, any
    spelling that resolves to it such as `CreatedBy`, or a dotted form) — `FIELD_NOT_FILTERABLE`. It used to be removed silently, so
    `or: [{ createdBy: … }]` matched every entry. The column is never returned,
    so it cannot choose rows either.

  Two meanings are corrected rather than refused: an empty `or` now matches no
  entry (it matched every entry), and an `or` holding an empty member such as
  `{}` now matches every entry, as a condition that is always true does.

  The REST bracket form also works again. `where[title][equals]=alpha` was read
  into a field named `title]equals`, which matched no column and was dropped, so
  every bracket filter returned all entries. A comma now splits values only for
  `in` and `not_in`, where a single value becomes a one-item list:
  `equals=Hello, world` compares with that text, and a `near` point reaches the
  geo filter intact.

- [#2059](https://github.com/nextlyhq/nextly/pull/2059) [`2a41096`](https://github.com/nextlyhq/nextly/commit/2a410960b019a4c5c73ae0980ed871579efe9ac1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Database adapters can tell whether the calling async flow is inside a transaction that has not finished yet, with `transactionOpenInFlow()` (`@experimental`). Each flow gets its own answer, never the connection's: on SQLite, another request's open transaction does not make it true. It is true inside transactions that core's services open through Drizzle on PostgreSQL and MySQL, as well as inside the adapter's own `transaction()`.

- [#2004](https://github.com/nextlyhq/nextly/pull/2004) [`755d99c`](https://github.com/nextlyhq/nextly/commit/755d99c195aacea8337ad45d6ba976719cd2d0d8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A fresh install no longer starts without the foreign keys a plugin's or the
  app's table declares to a collection's, Single's or field group's table. If
  one cannot be created, the first boot stops and names the table, the key and
  its target. The first boot also no longer prints a warning for each of those
  keys before creating them.

- [#2076](https://github.com/nextlyhq/nextly/pull/2076) [`6846b88`](https://github.com/nextlyhq/nextly/commit/6846b88b977c68583bdd4be4097384af634816da) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On SQLite, an effect held until an enclosing transaction commits (an after
  hook, an event, a cache flush) now runs in the async context of the write
  that registered it. It used to run in the context of the code that ran the
  outer transaction, so the caller pinned around the write was gone. In
  particular a scoped API key's scope was lost: a hook's nested gated call was
  judged by the key's owner, a super-admin among them, instead of the key. The
  effect still runs outside the finished transaction. PostgreSQL and MySQL
  were not affected; they run such effects at once.

- [#2127](https://github.com/nextlyhq/nextly/pull/2127) [`43f7c5e`](https://github.com/nextlyhq/nextly/commit/43f7c5efaa0e1c30f56e4dc19be77eb519031d77) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard with more cards than one save may carry can be saved again

  When a person regains access to many cards at once, their arrangement can hold more than one save may carry, in number of cards or in size. Saving now leaves out cards they have removed, latest first, until it fits. Cards still on their dashboard are never left out.

  `nextly/config` now also exports `layoutSizeProblem` and `MAX_LAYOUT_BYTES`, the layout endpoint's own check of whether a submission fits.

  Retired dashboard widgets now merge only into the same card of their successor, as the widgets specification describes, and a widget retired twice reaches the widget that exists now. This release retires no widget, so no dashboard changes yet.

- [#1972](https://github.com/nextlyhq/nextly/pull/1972) [`c753694`](https://github.com/nextlyhq/nextly/commit/c7536940991ac40a815df4b08202ce135b508881) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A large backlog of due releases settled more slowly than it had to. Each drain
  pass decided which due releases it could mark published by looking every one
  of them up in the list of all due releases, so the decision grew with the
  square of the backlog: about two to four seconds at twenty thousand due
  releases, an imported schedule's size, taken out of a pass bounded to twenty or
  twenty-five.

  The pass now looks them up in a set built once, so the decision grows with the
  backlog. Which releases may settle, and in what order, is unchanged; a pass
  only reaches further into a large backlog before its deadline.

- [#1876](https://github.com/nextlyhq/nextly/pull/1876) [`14f98f7`](https://github.com/nextlyhq/nextly/commit/14f98f7c1d0444330509289895c22140b82a2425) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A link saved in a pattern now points at the element the page actually shows.
  When a selection held a visible renamed element and a hidden copy with the
  same id (hidden by a visibility condition), a link from an unrelated block could
  keep the old id, which nothing renders once the hidden copy is left off the
  page. The visible element now decides where such a link points. A hidden
  element decides only when nothing visible carries that id, so a link and its
  target stay together when the condition later shows it. Hidden elements still
  get their own ids put back.

- [#2234](https://github.com/nextlyhq/nextly/pull/2234) [`841a74e`](https://github.com/nextlyhq/nextly/commit/841a74eec75b7cff3218a4ed39bca03a5ce1f24e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an app reached through a symbolic link (the project folder itself is a link) writes every file again. `nextly.config.ts`, directly in the project, was taken for a file written through a link and skipped, while the routes that import it were written. The project folder is now left out of that check for every file alike, and the folders below it are still checked.

- [#2280](https://github.com/nextlyhq/nextly/pull/2280) [`b2cf477`](https://github.com/nextlyhq/nextly/commit/b2cf477bd443e889748c9530e691aac5814b8c47) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A localized single can be read in production. At a production boot, a code-first single was registered without its `localized` setting, so reads looked for its translated fields on its own table, where a migrated database does not keep them, and every read of a localized single (pages, the REST and Direct API, dashboard widgets) failed with "no such column". The dev server registered it correctly, which hid it. Singles are now registered as collections are.

- [#2015](https://github.com/nextlyhq/nextly/pull/2015) [`3bf9a8e`](https://github.com/nextlyhq/nextly/commit/3bf9a8edef4f72d93bdc7c5289f647b8ddb53c1e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A boot now refuses to start whenever a plugin's or the app's table that holds no
  rows yet lacks its foreign key to a collection's, Single's or field group's
  table, not only on the boot that created the tables, so a restart after a
  partly applied first boot no longer serves the table without its key. A table
  that holds rows is left to `nextly db:sync` and migrations. The first boot again
  attempts, and reports, a key to any other table that does not exist yet.

- [#2152](https://github.com/nextlyhq/nextly/pull/2152) [`810cc77`](https://github.com/nextlyhq/nextly/commit/810cc778909cf9a67734e704b8d913aa50b4d1a1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an app inside a monorepo now installs with the workspace's package manager, and approves its build scripts at the workspace's root. The workspace is the nearest one above the app, up to its repository's root, whose `pnpm-workspace.yaml` `packages` or `package.json` `workspaces` lists the app; its lockfile names the manager, or pnpm when its `pnpm-workspace.yaml` lists the app before the first install. An app inside a pnpm workspace no longer gets `npm install` from an `npx` launch, and an app no workspace lists keeps the manager that launched the generator, whatever lockfile sits above it. A new project keeps the manager that launched it. When the app already approves a specific esbuild version in pnpm's settings, that rule is kept, and the generator's note, which a failed install now repeats, says to approve the version pnpm names if the install then stops on another one.

- [#2146](https://github.com/nextlyhq/nextly/pull/2146) [`c3d368c`](https://github.com/nextlyhq/nextly/commit/c3d368cdafc07d84db578bd08f993d8ce018a22e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A new project starts Nextly when its server starts, so `/api/health` answers healthy on a freshly started server without waiting for other traffic, and code that reads through the `nextly` proxy finds it running. The blank and blog templates ship an `instrumentation.ts` that does it, and adding Nextly to an existing app writes one, or, when the app already has one, leaves it alone and prints the lines to add. Before Nextly has started, `/api/health` answers 503 with the generic error and logs, once, how to start it.

- [#2153](https://github.com/nextlyhq/nextly/pull/2153) [`028c4a0`](https://github.com/nextlyhq/nextly/commit/028c4a0c1c10876b983f86016eb204c58505f028) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every admin user now has a personal list of notices: things that happened to
  their work that they should know about. A notice is for one person only, is
  stored once per occurrence, keeps a snapshot of what it is about so it still
  reads after that is deleted, and records when it was read. Read them with
  `GET /api/notices`, count them with `GET /api/notices/count`, and mark them
  read with `POST /api/notices/read`, all for the signed-in person (API keys are
  refused); or from server code with `nextly.notices.find()`, `count()` and
  `markRead()`. Notices are kept as long as the activity log keeps its records,
  and are deleted with their person. Core features add their own kinds of notice
  through one registered, typed kind; plugins cannot add kinds yet. All of this
  is experimental.

  **Run `nextly migrate`** to create the `nextly_notices` table on an existing
  installation. Until then lists are empty, nothing is recorded, and one warning
  names the table and the command.

- [#2112](https://github.com/nextlyhq/nextly/pull/2112) [`07bf1f9`](https://github.com/nextlyhq/nextly/commit/07bf1f9b9d2f1cf073ca0eda870d45b2a62220a4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can contribute a full-screen view of a document, at its own address
  under the document's: `/admin/collections/<slug>/<id>/<path>`, or
  `/admin/singles/<slug>/<path>` for a Single. The admin keeps the document's
  loading, soft lock, recovered-work offer, leave guard and save shortcut around
  the view, so the plugin implements none of them. Declare a view for one
  collection under `contributes.admin.views[slug].documentViews`, or for every
  collection and Single with a top-level field of a type the plugin contributes
  under `contributes.admin.documentViews` with `fieldType`. `navigateTo` in
  `@nextlyhq/plugin-sdk/admin` moves to another admin page and refuses any other
  address. `PluginDocumentView`, `PluginFieldTypeDocumentView`,
  `DocumentViewProps` and `navigateTo` are experimental. Startup is refused when a
  view's path is malformed, reserved (`versions`, `api`), claimed twice on one
  document, or offered on a field type its plugin does not contribute.

  `nextly generate:types` now writes the plugin component import map, or removes a
  stale one, in an app that defines no schema in code. Such an app, whose schema
  is made in the Schema Builder, rendered empty plugin pages and settings
  components in a bundled admin, because the map was skipped with the types.

- [#2000](https://github.com/nextlyhq/nextly/pull/2000) [`3b7c77f`](https://github.com/nextlyhq/nextly/commit/3b7c77f0f16124f9632e8b953e5f7b43cf63c40f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can no longer declare a hook point under a prefix core's own seams use
  (`email.`, `admin.` and `collections.`): boot now fails with
  `hook-point-reserved`, naming the plugin and the point. A plugin whose slug is
  `admin` could otherwise declare `admin.nav` as a decision, and core's own
  admin navigation filter would then be refused on every request.

- [#2039](https://github.com/nextlyhq/nextly/pull/2039) [`e78ff48`](https://github.com/nextlyhq/nextly/commit/e78ff48a364bd92431c4e9398b5607c00edb82b2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can no longer turn an account into the kind core makes for a person another
  system has verified: active, verified and without a password. Through
  `ctx.services.users`, an update that would leave an account that way is refused with
  `FORBIDDEN` and changes nothing: verifying an active account that has no password,
  activating a verified one that has none, both at once, or reactivating one core made for
  a verified person. Core makes those accounts only when one of the app's login plugins
  hands it a sign-in. Such an account still takes a plugin's other edits, and a plugin may
  deactivate it or give it a password, but may not move it to another address unless the
  same write gives it a password. An active account with no password that is not
  verified stays allowed.

- [#2085](https://github.com/nextlyhq/nextly/pull/2085) [`b2e486d`](https://github.com/nextlyhq/nextly/commit/b2e486dfa1f513fdc9e797909c3e27dd30aa65d4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin's email to one of its signed-in people can now name them:
  `ctx.services.email.send` and `sendWithTemplate` take `person`, by kind and
  id. The delivery record of the message keeps the person's kind and id, on the
  row of the `to` address, in new `principal_kind` and `principal_id` columns of
  `email_deliveries`. A `person` that cannot name one, or names a kind no
  running plugin registers, is refused before anything is sent.

  `ctx.principals.reportDeleted` now also erases, in the same transaction, the
  address digest on every delivery record naming the person, and names them
  there by the keyed digest of kind and id in place of the id. Every record
  written for the person afterwards, the email telling them their account is
  gone included, is written without an address digest, even when it is sent
  inside the report's transaction. Records of anyone else at the same address,
  a staff user's among them, stay as they were.

  Every delivery record is written through one insert, which takes the lock a
  deletion report waits on; a test holds any new writer to it. `nextly migrate`
  and boot add the columns and their index on all three databases, and rewrite
  no row.

- [#2073](https://github.com/nextlyhq/nextly/pull/2073) [`54292bd`](https://github.com/nextlyhq/nextly/commit/54292bdc543bb65baffcbd87538889307f136f54) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can limit attempts on keys it chooses, before the work they guard runs (`@experimental`). It declares named rules in `contributes.limits`: rolling windows, or a growing wait after attempts in a row. The app refuses to start on a rule outside the documented bounds. The plugin then reserves through `ctx.limits` on 1 to 16 entries, each a rule and a key. A reservation is decided and counted atomically in the selected limit store, so instances sharing it admit no more than the rules allow. Each entry chooses whether it can refuse (`enforce`) and when it counts (`count`), and gets its own verdict back. `release`, `reset`, `check` and `clientKey` are there too. A store that can't answer gives `unavailable`, never an admission. Keys are stored only as keyed hashes, namespaced to the plugin. The types are exported from `@nextlyhq/plugin-sdk`.

- [#2003](https://github.com/nextlyhq/nextly/pull/2003) [`736748a`](https://github.com/nextlyhq/nextly/commit/736748a29d04e26f089b21b5ac7a45eb6916aafa) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `ctx.auth.completeLogin` now refuses a plugin's strategy name that is only its
  slug and a colon (`acme-google-auth:`), with no name for the method after it.
  Such a login was recorded on the audit trail as the plugin alone, so a plugin
  with more than one way in could not be told apart on the rows. Name the method
  after the colon (`acme-google-auth:google`); plugins that already do are
  unaffected.

- [#2067](https://github.com/nextlyhq/nextly/pull/2067) [`07a3cf1`](https://github.com/nextlyhq/nextly/commit/07a3cf1d62a77b274e4434ab4b7bd7b3852d4643) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin-defined signed-in person can now read and write collections, under
  access rules and nothing else. Collection and field rules receive the person as
  `principal`, beside a `user` that is `null`, and collection hooks receive them
  too. A person is admitted only by a code-defined rule that names them, or one
  set to `true`: a collection with no rule for the operation refuses them,
  database permissions and the super-admin bypass never apply, and a person can
  never publish. Every other caller's rule receives `principal: null`.

  Collection and Single operations on the Direct API, and a plugin's
  `ctx.services` collection calls, take a `principal` option to run as a person.
  The call is refused before it runs if it also asks to skip access rules or
  the filterable-field check (`frameworkFilter`), names a staff user or an API
  key, or names a person core did not make; any other operation refuses the
  option, and it cannot be a Direct API instance default. `findSingles` made
  as a person lists, and counts, only the Singles the person may read. A document created as a person has no owner.
  `nextly.principals.byId` and `ctx.principals.byId` find a person through the
  kind's `lookup`, checked as a resolver's answer is.

  An update or delete by `where` made under access rules (a person's, or any
  call with `overrideAccess: false`) now refuses a `where` on a field the
  caller may not read before it writes anything, as a read already did; the
  rows it touched used to answer whether a guessed value matched.

  A dev reload now installs the kinds of signed-in person it reads only once it
  commits, and a kind's attributes may no longer be optional.

  `AccessControlContext` and a field rule's arguments gain a required
  `principal`, so code that builds either by hand adds `principal: null`.

- [#2078](https://github.com/nextlyhq/nextly/pull/2078) [`b9493fe`](https://github.com/nextlyhq/nextly/commit/b9493fe3ec23ceb82c763a406271e82e24a31305) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can now name a person it signs in on an audit row, and erase them when
  it deletes them. `ctx.audit.write` takes `actorPrincipal` and `targetPrincipal`,
  by kind and id, kept in new columns of their own. Such a row keeps its network
  address, browser and metadata. A person's id in `actorUserId` or `targetUserId`
  is still stored as an erased account's, as before.

  `ctx.principals.reportDeleted(person, { tx })` erases a person from the audit
  trail in one transaction, the plugin's own when it passes `tx`. Core clears the
  address and browser on every row the person acted on, and the plugin metadata
  on every plugin row naming them. It names the person on those rows by a keyed
  digest of kind and id, in place of the id, and keeps only that digest and when,
  in the new `nextly_deleted_principals` table. Every row written about the
  person afterwards is written already erased. A report made inside an open
  transaction without passing it is refused.

  The digest's key is made once and kept sealed under `NEXTLY_SECRET`. After a
  rotation, keep the old secret in `NEXTLY_SECRET_PREVIOUS` until the app has
  started once with both, as for plugin settings.

  Every audit row now records which kind of caller acted, in `actor_kind`:
  `staff`, `apiKey`, `core`, `anonymous`, or the person's kind. Rows written
  before this release keep `NULL` there and read as before. `nextly migrate` and
  boot add the new columns, indexes and table on all three databases, and
  rewrite no row.

  `RequestActor` gains the `principal` type for a write made as a person. It
  carries the person's kind and id and no `id`, so the activity log, which
  records staff only, records no row for it. Webhook deliveries still report such
  a write as `system`, as they did before.

- [#2083](https://github.com/nextlyhq/nextly/pull/2083) [`d5fee41`](https://github.com/nextlyhq/nextly/commit/d5fee4133cdec199bc09c7c897ba258123a82018) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin's audit event naming a person of a kind no running plugin registers,
  a misspelled kind for instance, is now dropped with a warning, as one naming
  nobody is. No deletion report could reach such a row, so the network address,
  browser and metadata it kept would have outlived the person.

  The app now also refuses to start on a kind of signed-in person whose full
  name, `<plugin slug>:<name>`, is longer than the 191 characters an audit row
  stores it in. On PostgreSQL and MySQL every audit write naming such a person
  failed at the column, and the row was lost with only a log line.

- [#2087](https://github.com/nextlyhq/nextly/pull/2087) [`a8f3251`](https://github.com/nextlyhq/nextly/commit/a8f325173ce525b7649e8eb5b907f323239d20d6) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A plugin settings request made with an API key now counts once against the
  key's rate limit. The settings route authenticated the key, then authenticated
  it again to check its permission, so each read or change of a plugin's
  settings spent two of the key's requests, and a key with one request left was
  refused with a 429. The permission is now judged on the caller the route
  already authenticated.

- [#2060](https://github.com/nextlyhq/nextly/pull/2060) [`e4e5088`](https://github.com/nextlyhq/nextly/commit/e4e508876d3b6ca2f64b87088ad915b32114f3da) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can now sign in people who are not staff, such as a shop's customers
  or a site's members, without them ever reaching the admin. It registers its
  own kind of signed-in person in `contributes.principals`: a name, the
  attributes the kind exposes with their types, and a resolver that says who is
  signed in from the plugin's own session. Core names the kind
  `<plugin>:<name>`, and the app refuses to start on a kind whose name,
  attributes or resolver cannot be used, or whose name another plugin's kind
  already holds.

  Core calls a kind's resolver only where an entry point asks for that kind, and
  at most once per request. A plugin route asks with `principal: { kind }`. Its
  handler gets the person as `ctx.principal` and never staff: the route reads
  neither the staff session nor an API key, and `ctx.auth.currentUser` answers
  no user there. A route that requires the kind refuses a request with nobody of
  it with the same 401 any route gives an unauthenticated caller. A person's
  writes take the route's cross-site check as a staff session cookie's do,
  unless the request carries a `Bearer` token. `principal` cannot be combined
  with `public` or `requiredPermission`. Server code asks with
  `ctx.principals.fromRequest` or `nextly.principals.fromRequest`, which answer
  nobody to a write from another site. `nextly plugins info` lists each plugin's
  kinds.

  The surface is `@experimental` until the feature is complete.

- [#2049](https://github.com/nextlyhq/nextly/pull/2049) [`9064005`](https://github.com/nextlyhq/nextly/commit/9064005f83b13d6e1d678f8bc7c1d182513b5758) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin's update to an account core made for an externally verified person no
  longer fails when it carries the account's own address or verification date
  unchanged, as a full-object update does. Before, the unchanged address was
  judged as a move to another address and refused with `FORBIDDEN`, and the
  unchanged date was judged as a fresh verification, refused for the same reason
  and, on other accounts, restamped as vouched for by the plugin.

  An update that carries an account's address unchanged no longer writes it, so a
  stale update cannot put back an address another request has since moved the
  account from. An address stored in mixed case before addresses were lowercased
  is still rewritten in lowercase, so sign-in can find it. When an address moves,
  a verification date carried with it is recorded as the updater's vouching, not
  kept as whoever verified the old address.

  The update schema now takes a verification date as a `Date` or an ISO 8601
  date-time string, and refuses any other string with `VALIDATION_ERROR`. A string
  failed every update before, and `"0"` would have parsed as the year 2000.

  When a plugin's update is judged, a stored password counts as one when it is a
  hash core made, or, where the app passes its own `passwordHasher` to
  `getNextly`, whatever that hasher stored.

  The plugin services documentation now says that `ctx.services.users.create`
  refuses a missing password with `VALIDATION_ERROR` once an account exists, and
  with `FORBIDDEN` on an empty install.

- [#2005](https://github.com/nextlyhq/nextly/pull/2005) [`24f9dfd`](https://github.com/nextlyhq/nextly/commit/24f9dfd1d58eaea7c7d4a699737d73d71f10e71c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A write another site posts to a public plugin route with the session cookie is
  now recorded as a `csrf-failed` audit event naming the plugin and the route
  when the handler asks `ctx.auth.currentUser` who is signed in. The handler
  already got no user for such a write; the operator can now see the attempt,
  as they can when an authenticated route refuses one.

- [#2042](https://github.com/nextlyhq/nextly/pull/2042) [`b2e4ce0`](https://github.com/nextlyhq/nextly/commit/b2e4ce038c3eb91005ae55cc36ef6bfcc96b823d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - When an app runs without the access-control service, a populated relationship now answers
  a signed-in person as a direct read does, from the person's permission grants, instead of
  returning every related row. Whether the caller may read related users is now asked once
  per read, however many relationships point at users, rather than once per field.

  An anonymous visitor no longer receives a populated user through a relationship: no
  visitor can read a user directly, and a user row carries the person's address. Visitors
  keep populated media, which public pages embed. A page your server renders with the
  Direct API reads as the system by default and still shows authors.

- [#2020](https://github.com/nextlyhq/nextly/pull/2020) [`5ba07e9`](https://github.com/nextlyhq/nextly/commit/5ba07e9db2dab60180e66489df4db4da04cbdc09) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A relation a plugin's or the app's table declares is now checked when the app
  starts, once every table is registered. A relation to a Builder-made collection
  still resolves; one naming a table or column that does not exist stops the boot
  with `NEXTLY_SCHEMA_RELATION_UNRESOLVED`, naming each such relation, instead of
  failing the first relational query with an internal error. In development it is
  reported once the boot's schema apply has run, without stopping the dev server.

- [#2186](https://github.com/nextlyhq/nextly/pull/2186) [`d1fe962`](https://github.com/nextlyhq/nextly/commit/d1fe9629968d560383f410529d1e48d9b4055cec) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now has a kind: `release`, the default, or `single`, a document
  scheduled on its own. Pass `kind` to `nextly.releases.create()` or
  `POST /api/releases`, and read it on every release. A single-document release
  holds exactly one document. The database refuses a second one, even when two
  requests add documents to it at once, with a conflict that says to use an
  ordinary release instead.

  `find()`, `count()` and `GET /api/releases` take a `kind` filter: `release` leaves
  out single-document releases and `single` lists only them. It filters on the
  stored kind, never on how many documents a release holds.

  `nextly migrate` adds the `kind` column (existing releases read as `release`) and
  a `single_slot` column on release documents with its unique index. No row is
  rewritten. `kind` is experimental.

- [#2185](https://github.com/nextlyhq/nextly/pull/2185) [`bd15d17`](https://github.com/nextlyhq/nextly/commit/bd15d178b211c7938b480837b12691a2be622267) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release can be published now: `POST /api/releases/:id/publish` and
  `nextly.releases.publishNow({ id })` run a draft or scheduled release at once,
  with the same checks as scheduling, by moving it to the current time (unless
  it is already due) and starting the job runner's releases run straight away,
  and answer the release as it then stands. When a releases run is already in progress, the release goes
  out with it (or with the next one) and the answer says it is still scheduled.
  Each release in a list also says whether the reader may publish it now
  (`can.publishNow`). Both are experimental. The capabilities type,
  `ReleaseCapabilities`, is now exported from `nextly/schemas`, and the admin
  reads its release controls from it.

  **Behaviour change:** a cancelled release is now final, like a published one.
  It can no longer be scheduled again, and documents can no longer be added to or
  removed from it; create a new release instead. A stopped release can still be
  fixed and scheduled again.

- [#2178](https://github.com/nextlyhq/nextly/pull/2178) [`c02c9f9`](https://github.com/nextlyhq/nextly/commit/c02c9f98b2b17670a3742138d667de586ca83acb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding a Single to a release no longer creates its row. The check that the
  document exists read the Single the ordinary way, which creates a Single's row
  the first time it is read, so a Single that was never saved was accepted, and a
  blank row was left behind even when the add was then refused. A Single that was
  never saved is now refused as not found, and nothing is written.

  The check also always reads as the caller: a Direct API instance's default API
  key can no longer stand in for a caller who brought no key of its own.

- [#2145](https://github.com/nextlyhq/nextly/pull/2145) [`a118daf`](https://github.com/nextlyhq/nextly/commit/a118dafe8ef277ffb272bcbf039cb273e5eabd07) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now checks a document the same way whichever way it is added. The
  Direct API's `addMember` used to skip what the REST route checked, so a server
  caller could add a document that does not exist, one in a collection without
  drafts, or a Single by an id that is not its own. Those are now refused from
  every caller, with the same errors as over REST, and a Single is recorded by its
  own stored row. A trusted call (`overrideAccess`, the default) skips only the
  read permission.

  Finding the releases that are due is now one query on the release's state and
  time, instead of reading every scheduled release and filtering in memory, so a
  long list of future releases no longer slows each pass of the drain.

- [#2195](https://github.com/nextlyhq/nextly/pull/2195) [`ba18126`](https://github.com/nextlyhq/nextly/commit/ba181269bb1708918795d269ed33d900c1eabc26) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Single created in the admin can be added to a release from any server
  process. The release target check looked for the Single's row without first
  registering its table in the process handling the request, so a worker that
  booted before the Single existed refused a valid add with an error. It now
  resolves the Single the way every Single read does.

- [#2209](https://github.com/nextlyhq/nextly/pull/2209) [`c75ce69`](https://github.com/nextlyhq/nextly/commit/c75ce6960d703fba9dc19baff4ba0eccbd7ec756) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release moves only from the state it was judged in. Every change to a
  release (scheduling, cancelling, stopping, publishing, and adding or removing a
  document) now advances its revision, and scheduling compares against the one it
  read: a document removed while a release is being scheduled makes the schedule
  refuse, rather than leaving a single-document release scheduled with nothing.
  A release's capabilities now say what a single-document release allows: no
  scheduling while it is empty, no second document, and no removing its document
  once scheduled.

  For code calling `ReleasesRepository` directly: `scheduleRelease`'s
  `expectedRevision` (added as optional with Publish now) is now required, and
  `from` no longer has a default. A schedule fenced only on state cannot tell
  that a release changed under it, so every scheduling move must name the
  revision it read: read the release, then pass its `revision`.

- [#2215](https://github.com/nextlyhq/nextly/pull/2215) [`96686eb`](https://github.com/nextlyhq/nextly/commit/96686eb372973de731ccfb66c65fef364306a4c9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing app no longer writes a media or health route where a route handler the app already has answers that URL through a dynamic segment, such as `app/api/[...rest]/route.ts` or `app/api/[name]/route.ts`: the new, more specific route would have taken those requests from it. The route is reported, with its content to add, instead. Pages reached through a dynamic segment, such as a site's catch-all page, still leave the routes free to be written.

- [#2269](https://github.com/nextlyhq/nextly/pull/2269) [`0fdc420`](https://github.com/nextlyhq/nextly/commit/0fdc42019dfb41006f17a37ed63d44d304ee3388) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A project from `create-nextly-app` whose config registers a plugin, such as the blog with its newsletter form, now installs that plugin in its `build` script, after `nextly migrate` and before `next build`. A production boot refuses a configured plugin that was never installed on its database, so a fresh blog project built for production answered every request with a 500 until `nextly plugins install` had been run there by hand. Installing again on each build is safe; each run adds one row to `nextly_schema_events`.

- [#2057](https://github.com/nextlyhq/nextly/pull/2057) [`9781341`](https://github.com/nextlyhq/nextly/commit/97813419118b0b16cc223b3cb8ffdd97b3c05ac9) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A plugin's entity transform can no longer change what isn't its to change.

  A transform hands back a whole new definition of a collection, Single or
  component, so nothing stopped it from setting an option the entity's own
  definition is refused for, such as a collection's `db.idType` of `"serial"`,
  or from dropping another plugin's column. Each transformed entity is now
  validated as its definition would be, and a refusal names the plugin.

  A plugin transforming another plugin's entity must now list that plugin in
  `dependsOn`, so the owner can't be uninstalled from under the change. It can't
  move the entity to another table, and it can't remove a field, or change how
  one is stored, unless it declared that field. An access rule, hook, validator
  or admin setting a third plugin contributed stays unless the transforming
  plugin depends on that plugin too. A plugin that transformed another's
  collection without declaring the dependency stops at boot until it does.

- [#2077](https://github.com/nextlyhq/nextly/pull/2077) [`209b10c`](https://github.com/nextlyhq/nextly/commit/209b10c0806f9a92b94c35229df5d66cd1aa84ce) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A two-factor challenge is answered once on every instance. The first correct answer now marks its sign-in answered in the database, in a new table `nextly_spent_challenges`, by one write only one caller can win, committed before the session is issued. Any later answer to the same pending token is refused, on whichever instance it reaches, before the challenge's `resolve` runs, and two correct answers at once mint one session. This holds whatever `rateLimit.store` is set to. The one-shot mark used to live in the rate-limit store, so with the default memory store an answered challenge could be answered again on another instance. A challenge pending across the upgrade is answered against the new mark.

  The attempt budget is counted in the limit store `rateLimit.store` selects, so with `"database"` wrong answers on every instance spend one budget. An app's own store of the earlier `RateLimitStore` contract keeps serving it. Its keys, which name an account, are stored only as keyed hashes, so a budget pending across the upgrade starts again. When the store can't be reached, or doesn't answer in time, a two-factor answer is refused with "Please try again shortly." (`503`) and no session is minted. The boot warning about a per-instance budget no longer appears when the database store is selected or `rateLimit.singleInstance` is set. Expired marks are removed as new ones are written, an hour after their token's end, so an answer let through before the end always meets them.

  `AuthRouterDeps` gains two optional members, `spentChallenges` and `limitStore`, so deps assembled by hand keep working: without `spentChallenges`, the mark stays in the rate-limit store as before. While an app's own store of the earlier contract is configured, the earlier release's mark is also kept there, so during a rolling upgrade instances of either release refuse a challenge the other settled. `nextly/auth` exports `databaseSpentChallenges` and `SpentChallenges` for such a caller to opt into the database's marks.

- [#2188](https://github.com/nextlyhq/nextly/pull/2188) [`c731d75`](https://github.com/nextlyhq/nextly/commit/c731d75f8a8eb6a803169de3067675fbf969c7f2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Two public types now match what Nextly accepts and returns. Code that calls them compiles as before. A hand-written stand-in for the `Nextly` interface, such as a test double, must now return `token` and `exp` from `login`, as the real one always has.
  - A job defined with a typed input, `defineJob<{ cursor: string }>(...)`, now goes into the config's `jobs` list, or a plugin's `contributes.jobs`, without a cast. Both lists now take any job, whatever input its handler takes. A value that is not a job is still refused, and a handler is still typed for its own input only, so it can't be called with another job's input.
  - `login()` on the `Nextly` instance from `getNextly()` is now typed as `LoginResult`, the user with the session `token` and its expiry `exp`, which is what it already returned. The documented `result.token` now type-checks.

- [#2197](https://github.com/nextlyhq/nextly/pull/2197) [`abe6ace`](https://github.com/nextlyhq/nextly/commit/abe6ace9622af4582016db060dcf3a2c9d18a49c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A comparison no longer offers a withdrawn version as what is published. The
  `published` baseline, and the comparison that opens on the current draft
  against what is published, now apply only while the language (or the part of
  the document with no language) is actually served: after an unpublish, or
  while a translation has never been published, `published` is refused with
  `NO_BASELINE` and the default opens on the version before. Whether a
  language is live is now decided in one place for every path, from the main
  row's status and the translation's own, and a translation's own status is
  read through one shared reader.

- [#2086](https://github.com/nextlyhq/nextly/pull/2086) [`39cd056`](https://github.com/nextlyhq/nextly/commit/39cd056b4f380394417191385c43097c5547f285) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The accounts plugin names the account on every email it sends, so core erases the email's delivery record with the account when the account is reported deleted.

- [#2079](https://github.com/nextlyhq/nextly/pull/2079) [`bd8a2e9`](https://github.com/nextlyhq/nextly/commit/bd8a2e9bd2a831f83797697a241a5c1bf269abc6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The accounts plugin runs on core's own helpers: its password, one-purpose secret, opaque secret and limiter types come from the plugin SDK, and it declares its limit rules to core, which checks each when the site starts. It now refuses to start on a core that does not lend every helper it is built on, and, in production, on limit counts each instance keeps apart.

- [#2068](https://github.com/nextlyhq/nextly/pull/2068) [`6d1883d`](https://github.com/nextlyhq/nextly/commit/6d1883d31e4eed6fa963a01cdd8363a87fa69e46) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Add `@nextlyhq/plugin-accounts`, site accounts for people who are not staff: sign-up with address verification, sign-in with per-address and per-client waits and known browsers, password reset, the holder's password and address changes, account deletion, the account kind of signed-in person, and REST endpoints for each, built on the account helpers core lends plugins.

- [#2084](https://github.com/nextlyhq/nextly/pull/2084) [`1c5fcee`](https://github.com/nextlyhq/nextly/commit/1c5fcee140dc76b622d388c7885dd8ad6d0e078d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The accounts plugin reports each account it deletes to core, in the transaction that deletes it, so core erases the account from the audit trail with the deletion. Staff actions name the account as the audit row's target person rather than in its metadata, and the plugin refuses to start on a core that does not lend it a way to report deletions.

- [#2082](https://github.com/nextlyhq/nextly/pull/2082) [`b2393fe`](https://github.com/nextlyhq/nextly/commit/b2393fe27b24bd7761ad6d7c0de1fd58d67e98e8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The accounts plugin's stand-in limiter gives a count back in the run the caller's reservation names for it, as core does, so a copy carrying stale runs gives nothing back.

- [#2081](https://github.com/nextlyhq/nextly/pull/2081) [`a18fade`](https://github.com/nextlyhq/nextly/commit/a18fade4d310d38ff8f88dac09350770932006d2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The accounts plugin's testing stand-ins keep core's contract: the limiter gives a count back only to the run it was counted in and refuses a malformed release before it reports a store outage, and one-purpose secrets never mint a code that repeats the live one it replaces.

- [#2134](https://github.com/nextlyhq/nextly/pull/2134) [`594d727`](https://github.com/nextlyhq/nextly/commit/594d7275a2a59d271916d239e3b2099602a8f613) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing Next.js app now installs everything it needs and finishes, on npm, pnpm, Yarn and Bun. The app gets `esbuild` as its own dev dependency, so `nextly.config.ts` can be read and code-first collections load; before, npm left it nested under another package where Nextly could not find it. The install uses the package manager the app's lockfile names rather than the one that launched the generator, so `npx create-nextly-app` in a pnpm app no longer runs npm over pnpm's install.

  On pnpm and Bun, the install scripts of the native packages Nextly brings (the SQLite driver, esbuild and sharp) are approved before the install, in the one place the app's own version reads them and at its workspace root in a monorepo: `permissions` when `pnpm-workspace.yaml` has that section (pnpm 12.11+), `allowBuilds` (pnpm 10.26+), `onlyBuiltDependencies` (pnpm 10.6 to 10.25), `pnpm.onlyBuiltDependencies` in `package.json` (pnpm 10.0 to 10.5), and Bun's `trustedDependencies` when the app keeps that list. pnpm refused the install until then and the generator stopped with no config or routes written; Bun skipped the SQLite driver's install script and the app answered 500. Only Nextly's packages change: any approval or denial the app already wrote, version-scoped ones included, is kept, pnpm's own placeholder is replaced, and each change is printed. An `esbuild` the app already declares is left as it is. A project set up this way with an earlier version can add `esbuild` as a dev dependency and approve these packages the same way, then install again.

  When an install fails, the generator now names the exact command to run to see why.

- [#2189](https://github.com/nextlyhq/nextly/pull/2189) [`5eaabac`](https://github.com/nextlyhq/nextly/commit/5eaabac7756e765c17376e8b3eec4a3d8a35bb12) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An admin page left open while the app's root layout is edited during `next dev` no longer fills the console with "Cannot read properties of null (reading 'removeChild')". The admin used to remove the host app's favicon links, which React owns, to show its own; it now switches them off and back without removing them, so React can keep updating `<head>`.

- [#2173](https://github.com/nextlyhq/nextly/pull/2173) [`fe36198`](https://github.com/nextlyhq/nextly/commit/fe361983d76fd2ff7426ba7a84fad28b304a2a87) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin no longer writes its theme onto the host app's `<html>`, so an app whose root layout is the one `create-next-app` writes no longer logs a hydration mismatch on every admin page. The theme, light, dark or system, is applied to the admin's own containers, its dialogs and menus included, before the first paint, so a dark admin no longer flashes light on load. Native controls such as scrollbars and inputs follow the admin's theme.

  `ThemeProvider` and `useTheme` from `@nextlyhq/admin` keep their names and the `nextly-theme` storage key, and a `ThemeProvider` inside another still defers to the outer one. `ThemeProvider` now accepts `defaultTheme`, `storageKey`, `enableSystem`, `forcedTheme` and `nonce`; next-themes' other props, such as `attribute` and `disableTransitionOnChange`, are no longer accepted, since the admin no longer depends on next-themes. `useTheme` returns `theme`, `setTheme`, `resolvedTheme`, `systemTheme`, `themes` and `forcedTheme` as before.

  A site with a nonce-based Content Security Policy passes its nonce to `RootLayout` (`<RootLayout nonce={nonce} />`) or to `ThemeProvider`, so the admin's small pre-paint script is allowed to run.

- [#2181](https://github.com/nextlyhq/nextly/pull/2181) [`6eec099`](https://github.com/nextlyhq/nextly/commit/6eec099d96bffc7649485ff716bbb2eeaf00631b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin` exports `ThemePaintScript` and the `ThemeProviderProps` and `UseThemeProps` types. A host that puts `ThemeProvider` around admin content of its own renders `<ThemePaintScript />` first inside its `.nextly-admin` element, so a saved dark theme shows from the first paint. With `enableSystem={false}` and no `defaultTheme`, the admin now defaults to light rather than following the system setting.

- [#2182](https://github.com/nextlyhq/nextly/pull/2182) [`9c76108`](https://github.com/nextlyhq/nextly/commit/9c761085b0e68a2e7fe5e6f9598b239fd0f9f047) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's create-user and edit-user forms now accept exactly the passwords the server accepts. Any symbol counts, not only `@$!%*?&#.`, and a password over 128 characters is refused before it is sent. Every rule a password misses is listed, not only the first. Choosing "Set a password now" for a new user now says that they choose a new password the first time they sign in, which the server already requires.

  Setting a user's password through an update (the admin's edit form, the REST route or the Direct API's `users.update`) now stores the password exactly as given. It used to trim spaces from its ends before hashing, while account creation and sign-in did not, so a password whose symbol was a leading or trailing space could not be used to sign in. The admin's edit form no longer trims it either. A value of only whitespace still leaves the password unchanged. Existing password hashes are unaffected: only passwords written from now on change.

- [#2201](https://github.com/nextlyhq/nextly/pull/2201) [`40ce55b`](https://github.com/nextlyhq/nextly/commit/40ce55b9446bbff25ff3157209614c34e5164e78) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly/config` now exports the dashboard's widths (`WIDGET_WIDTHS`, `isWidgetWidth`,
  `widthFromSize` and the `WidgetWidth` type), and the admin reads them instead of keeping its own copy.

- [#2041](https://github.com/nextlyhq/nextly/pull/2041) [`8d6a0cb`](https://github.com/nextlyhq/nextly/commit/8d6a0cbd14b739c3e42476f7a972d2bf2f1200e7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The `afterDrizzle` escape hatch's refusals now point at what to use instead,
  and the documentation lists every construct it refuses.

  A check constraint or a foreign key returned by the hook is refused with a
  pointer to `checks` or `foreignKeys` on `defineTable`, an expression index to
  `indexes`, and an enum column to `col.enum()`. A partial index's refusal no
  longer promises a later release: partial indexes are refused on every dialect,
  because MySQL cannot build one.

- [#2100](https://github.com/nextlyhq/nextly/pull/2100) [`ca866a0`](https://github.com/nextlyhq/nextly/commit/ca866a0fc2029df5eb5c4c7b9b74e437036e5239) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The AGENTS.md a new project or plugin receives names only exports that exist: `definePlugin` comes from `@nextlyhq/plugin-sdk`, not its `/admin` entry, and every sample imports the functions it uses. The generated-types stub no longer mentions a `nextly dev` command.

- [#2259](https://github.com/nextlyhq/nextly/pull/2259) [`2cfea22`](https://github.com/nextlyhq/nextly/commit/2cfea22947d17790e605679b03465a33078c4103) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In an existing `.env.example`, a credential is flagged when its first word only begins like a placeholder word (`enterprise-…`), and when the database URL carries it in a query parameter whose name is percent-encoded (`?p%61ssword=…`).

- [#2238](https://github.com/nextlyhq/nextly/pull/2238) [`fc8c902`](https://github.com/nextlyhq/nextly/commit/fc8c902808b85f21651854f0e45c49305eb2739b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The `nextly.config.ts` written when Nextly is added to an existing app keeps its placeholder comments where they apply: `// Add your collections here` directly above `collections`, and `// Add your singles (globals) here` directly above `singles`, inside the exported config. Both used to run together on one line above `export default`.

- [#2225](https://github.com/nextlyhq/nextly/pull/2225) [`224e51a`](https://github.com/nextlyhq/nextly/commit/224e51a1657558916fe0990d25134b90a0ca3e48) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing app no longer writes through a folder on a file's path that is a symbolic link. When the app's `app/admin`, `types/generated` or another folder Nextly writes into is a link to a directory elsewhere, nothing is written there, which could have been outside the project. The file is reported as left alone, with the folder that is a link and, for the admin's files, the content Nextly needs, as the media routes already did.

- [#2151](https://github.com/nextlyhq/nextly/pull/2151) [`7dfb74b`](https://github.com/nextlyhq/nextly/commit/7dfb74bdf4c7e9bb74c8afb6c635d42189e110a9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing Next.js app now writes the admin's media route under `/admin`, the same file a new project gets, so uploads, edits and deletes in the admin's media library work. Every request to it is checked against the signed-in caller's media permissions; the public media route stays read-only. The routes import the Nextly config by a path relative to themselves, so no import alias is needed. A media or health route the app already has is left exactly as it was and reported, and for the admin's route the report includes the content to add. A route is not written where a Pages Router page answers its URL (in `pages/` or `src/pages/`), since Next.js refuses to build a page and an app route at one URL; that is reported in the same way.

- [#2216](https://github.com/nextlyhq/nextly/pull/2216) [`b766e82`](https://github.com/nextlyhq/nextly/commit/b766e8239c7d86ccd9ad1ed82b983675ed2e2573) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing app no longer replaces or refuses over files the app already has, and the run ends with one report of everything it did. Before, a `nextly.config.ts`, admin API route or admin page already there stopped the whole run with an error, and the admin's `layout.tsx` was written over whatever the app had.

  Now every file is created only where nothing is (exclusively, so a link or a file that appears meanwhile is never replaced). One already there is left byte for byte, and the report says so, with why and, for the admin's routes, page and layout, the content Nextly needs there. The report lists each file written, each extended with what was added (the Next config's packages included), and each left alone, across every step, the env files and their warnings included, in one place after the spinner, by path, key and package name only: no env value, the generated secret included, is ever printed.

- [#2019](https://github.com/nextlyhq/nextly/pull/2019) [`8561690`](https://github.com/nextlyhq/nextly/commit/8561690befe9d08634e9c7bc9d7de2d22fe6ece8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A role given with an expiry date now stops granting anything once that date
  passes. Until now the expiry was ignored almost everywhere: an expired role
  kept its permissions in every check, an expired super-admin assignment kept
  super-admin authority, and login and session refresh still put the role in
  the session's claims. Cached permission answers, super-admin answers and API
  key grants now also end no later than the expiry of a role they came from, and
  a session's access token ends no later than the first of its roles to lapse, so
  the client refreshes into claims without it.

  Assigning a role whose earlier assignment has expired now gives it again,
  instead of answering that it is already assigned. Listing a user's roles shows
  only the roles in force. If a user's roles cannot be read at login or refresh,
  the session is refused rather than issued with no roles.

  Permission answers cached in the database before this release are no longer
  read: they could have come from a role that has since expired. They expire and
  are cleared as usual, and the first check of each permission after the upgrade
  is worked out afresh.

  Breaking, for code that builds its own `AuthRouterDeps` for
  `routeAuthRequest` (`nextly/auth`, experimental): the `fetchRoleIds(userId)`
  dependency is replaced by `fetchSessionRoles(userId)`, which returns
  `{ roleIds, validUntil }` (the `SessionRoles` type, now exported):
  the role ids in force, and the soonest expiry among them in epoch milliseconds,
  or `undefined` when none expires. Read only assignments whose `expires_at` is
  empty or later than now. The access token is bounded by `validUntil`.

- [#2105](https://github.com/nextlyhq/nextly/pull/2105) [`fdff3a8`](https://github.com/nextlyhq/nextly/commit/fdff3a8da69228989eec2ab7e7fdda6a87722f5a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Moving a block into a component instance with Alt+ArrowRight no longer makes it
  vanish. A component instance is not a registered block, so the keyboard move
  could not read its slots and filed the block under the engine's default slot,
  which an instance draws only when its component exposes it. The move now reads
  the slots the instance's component exposes and places the block in one of them,
  and offers no move when the component exposes several and none is the default.

- [#2095](https://github.com/nextlyhq/nextly/pull/2095) [`d69c112`](https://github.com/nextlyhq/nextly/commit/d69c112db7b48dadfa075e3e901492562920f986) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Moving a block into the container above it with Alt+ArrowRight no longer makes
  it vanish. The keyboard move filed the block under a slot name of its own that
  no core container renders, so the block stayed in the page's data, selected in
  the inspector and listed in the breadcrumb, while the canvas showed nothing.
  It now lands in the default slot every core container declares and renders.

  Each row of the Layers panel also names the block it stands for in a
  `data-nx-layer` attribute, as the canvas already does with `data-nx-node`. Row
  labels repeat (every paragraph is "Text"), so a test or an integration had no
  stable way to find one block's row.

- [#2203](https://github.com/nextlyhq/nextly/pull/2203) [`59a1e9a`](https://github.com/nextlyhq/nextly/commit/59a1e9adc0d2510a8e6f45c1649bd71e159bddc5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A job written inline in the config's `jobs` list or a plugin's `contributes.jobs`, as an object rather than through `defineJob`, keeps `JobInput` as the type of its handler's input, alongside jobs defined with a typed input, which fit those lists without a cast.

- [#2264](https://github.com/nextlyhq/nextly/pull/2264) [`43f48ed`](https://github.com/nextlyhq/nextly/commit/43f48ed581b4fdccb604088b6b4f9f29635c4978) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Back and Forward with unsaved changes now ask before leaving in a real browser. In Chromium the editor's guard heard the history move only after the app's router had already drawn the next page, so pressing Back on a dashboard in customise mode, an entry or a single with unsaved changes left without asking and lost the changes. The guard now listens from the moment the admin loads, ahead of any router.

- [#2156](https://github.com/nextlyhq/nextly/pull/2156) [`d03cde4`](https://github.com/nextlyhq/nextly/commit/d03cde4efc6340656dc4e8ecaf27a06c4bc8477a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In a new blog project, clearing the search box and typing a new query no longer shows the old query's results while the new search loads, and "No results" waits until the search has answered.

- [#2030](https://github.com/nextlyhq/nextly/pull/2030) [`523adc3`](https://github.com/nextlyhq/nextly/commit/523adc317e21cab0b029cd08706d08578666b4b1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In development, a boot that cannot apply its schema, and the check that every
  declared relation resolves before plugins initialise, now log the error with
  its code, its cause chain and its log context, through the same description
  every other operator log uses. Before, they printed the message alone, so a
  refused relation's report left out the code and the relations it named.

- [#2017](https://github.com/nextlyhq/nextly/pull/2017) [`774d4c5`](https://github.com/nextlyhq/nextly/commit/774d4c54329ae3e9061d168fc4ee0c5a07718977) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Schema Builder relationship's foreign key works for a camelCase field, a long
  name, and a relationship an older save stored.

  On SQLite, a relationship named in camelCase (`leadAuthor`, stored in
  `lead_author`) gave the table drizzle-kit rebuilds a key over a missing
  column. A long collection and field name made a key name MySQL refuses past
  64 characters; it is now shortened with a hash past 63, as other derived names
  are. And a required relationship that nulls on delete, stored by an older
  save, no longer refuses every later save of its collection.

- [#1991](https://github.com/nextlyhq/nextly/pull/1991) [`285b88b`](https://github.com/nextlyhq/nextly/commit/285b88bde0f5ac2690eb98041d70910ca33f5fba) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Admin: a schema-builder page is no longer shown before the server has said the builder is on. Opening a builder address where the builder is off now goes to the dashboard without the editor appearing first, and a failed request shows a message instead of the builder.

- [#2033](https://github.com/nextlyhq/nextly/pull/2033) [`436b3bd`](https://github.com/nextlyhq/nextly/commit/436b3bddaf0d97a295c0bf20a78b1632bcb712d2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Schema Builder one-to-one relationship stays unique when a save changes its
  table, and a SQLite save no longer drops a table's triggers.

  Adding a relationship to a Builder collection, or changing a field's type on
  SQLite, rebuilt or altered the table in a way that dropped the UNIQUE the
  Builder gives a one-to-one relationship's column, on SQLite and PostgreSQL, so
  the column then accepted duplicates. While a table held such a column, a
  SQLite save of another collection could also be refused. Both now keep the
  constraint. A SQLite save that would rebuild a table with triggers on it is
  refused, naming the table, instead of dropping the triggers; make that change
  with a migration that recreates them.

- [#2014](https://github.com/nextlyhq/nextly/pull/2014) [`6e12fe5`](https://github.com/nextlyhq/nextly/commit/6e12fe518fda967b429f579f9d33f3166b250cb6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Schema Builder collection keeps its foreign keys, and gets the key of a
  relationship added to it.

  The Builder creates a collection's table with each relationship's key, but
  every later save went through the schema push, which described no keys. So a
  relationship added to an existing collection got no key on any database. On
  SQLite, where a key lives only in the table's definition, a save that changed
  a field's type rebuilt the table without its key, and a save that rebuilt a
  collection other collections point at failed outright. A save now adds the key
  of a relationship it adds, and keeps every key a table already holds through a
  rebuild, with no delete action running during it. A relationship that was
  added before this and has no key is left as it is.

- [#2040](https://github.com/nextlyhq/nextly/pull/2040) [`4e27dce`](https://github.com/nextlyhq/nextly/commit/4e27dce8fcdffa28f5283652f03b9fcb017fd343) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A repeater or group on a table the Schema Builder creates is now stored in the
  database's JSON type (`jsonb` on PostgreSQL, `json` on MySQL), as on every
  code-first table. That covers Builder collections and singles, and the singles
  `nextly db:sync` creates itself. They were created as `text`, while the schema
  `db:sync` compares against names the JSON type, so each such table was offered
  a conversion its author never asked for. Tables created from now on match.

  Existing tables keep their `text` columns: this changes no stored data, and
  `db:sync` still offers to convert them. That conversion succeeds when every
  stored value is valid JSON. It refuses the whole apply when one is not (an
  empty string, for example), leaving the column as it was. SQLite is unchanged:
  it stores JSON as text either way.

- [#2051](https://github.com/nextlyhq/nextly/pull/2051) [`7076ae4`](https://github.com/nextlyhq/nextly/commit/7076ae4811bdacaf730dca6556afad0644dbbf60) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - New command: `nextly users:clear-plaintext-passwords`. Earlier releases stored some
  passwords as typed instead of hashing them (32 characters or more containing a colon,
  given when an account was created, or any value sent to `PATCH /api/users/:id/password`).
  Such a value never let anyone sign in, but it is readable in the database and its backups.

  Run the command once the upgraded version serves every instance, since an old instance
  can still store a password as typed. Without flags it only counts the affected accounts;
  with `--apply --confirm-default-hasher` it clears each stored value and ends that account's
  sessions, printing only a count: none can be renewed, and an access token already issued
  lasts until it expires, within fifteen minutes by default. `--apply` alone changes nothing: the second flag is your
  statement that no stored password was written by a custom `passwordHasher`, now or earlier,
  since the command cannot see one and would take its hashes for plain text. Values in a format other
  hashers write (an argon2, scrypt or pbkdf2 string in the modular-crypt form their libraries
  write, or a hex salt and digest joined by a colon) are never counted or cleared; a value that
  only starts with `$` is. `nextly migrate` now prints the same count and names the command, and changes
  nothing itself. People whose password was cleared are refused at sign-in exactly as
  before, and set a new password with Forgot password, or an administrator sets one.

- [#2096](https://github.com/nextlyhq/nextly/pull/2096) [`12d1c70`](https://github.com/nextlyhq/nextly/commit/12d1c70c355742645c4c5276d2aa38f0b81bd4fd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly/config` no longer pulls `node:crypto` into a browser bundle. It
  published three dashboard layout limits from a module that also builds a hash
  with `node:crypto`; the limits now come from a module with no imports, and keep
  their values.

  Every entry listed as safe for a browser is now checked: a test walks each
  one's runtime imports and fails, naming the entry and the path, if any reaches
  a Node built-in, a database package or a module marked with `server-only`. The
  database-operator re-exports, the table DSL and the stored-bytes helper reach
  server-only code by design and are imported only from server code, so they are
  listed as server entries; this changes no build output.

- [#2029](https://github.com/nextlyhq/nextly/pull/2029) [`918f7f0`](https://github.com/nextlyhq/nextly/commit/918f7f0505669b9fede1fc832ae202d77118f459) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A collection's `db` options are now checked where the collection is defined.
  Before, an `idType` the write path did not recognise gave UUIDv4 ids in
  silence, and an `allowIdOnCreate` that was not `true` discarded every id a
  caller supplied, and any other name in `db` was not read at all. Now an
  `idType` other than `uuid` or `uuidv7`, an `allowIdOnCreate` that is not a
  boolean, a name that is not an option (a misspelling such as `idTyp`), and
  `db` options that are not an object are refused, naming the option.

  `serial`, which a config carried over from Payload may hold, is refused with
  its own message: a collection's id is text, which every relation and API path
  reads. A sequential number, such as an order number, goes on a table keyed by
  `col.serial()`.

- [#2064](https://github.com/nextlyhq/nextly/pull/2064) [`92317b6`](https://github.com/nextlyhq/nextly/commit/92317b6b85e63e42e44c1b2b55b9060e387e6676) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-commerce`'s checkout, still `@experimental` and unpublished,
  refuses a line past what its item now allows and an order whose jobs went
  stale while the catalogue was read, retries a payment's start only with the
  provider it began with, holds catalogue names and SKUs to 255 characters, and
  keeps provider references that differ only in case apart on every database.

- [#2052](https://github.com/nextlyhq/nextly/pull/2052) [`1b957e9`](https://github.com/nextlyhq/nextly/commit/1b957e9de798dfa2bfcd9d6dc9dc7b69d666f38d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-commerce` gains the plugin itself, `commerce()`, still
  `@experimental` and unpublished: its own tables and migrations, a built-in
  products collection to sell from or a catalogue source of the site's own, and a
  cart kept on the server behind an HTTP-only cookie, with REST routes and typed
  server functions for a storefront. Catalogue sources can report items sold to
  order, which hold no stock and are capped per line.

- [#2056](https://github.com/nextlyhq/nextly/pull/2056) [`8c6956f`](https://github.com/nextlyhq/nextly/commit/8c6956fb5eed9a8ba7663523955fd0d5d0ff9eca) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-commerce` gains checkout, still `@experimental` and
  unpublished: a cart is quoted from the catalogue's own prices and completed into
  one numbered order, with its stock held while it is unpaid and its payment
  started through the store's payment provider, never twice, even when a request
  is repeated or the provider is down. Checkout takes no orders until commerce's
  jobs have run, which is a launch step. Stock and order records keep catalogue
  references apart exactly, letter case included, on every database.

- [#2249](https://github.com/nextlyhq/nextly/pull/2249) [`e1e391b`](https://github.com/nextlyhq/nextly/commit/e1e391b3e5e90243220389ec1885061d6bb22419) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A comparison can start from the version you last looked at. A client marks
  a version as seen with `PUT …/versions/{n}/seen` (people only); the admin
  doesn't send it yet. API keys and the system are refused, and no read
  records anything. Marks count by visit: a mark more than 30 minutes after a
  marker's last one starts a new visit, and "last looked at" is the furthest
  version of the previous visit, kept per person, document and language. The
  `last-viewed` baseline compares from it, falling back to the nearest older
  version when retention removed it and naming the one removed, and the
  history list marks the row where you last looked. Markers live in a new core
  table, `nextly_version_views`, which `nextly migrate` creates, and go with
  their document, collection, Single or person.

- [#2125](https://github.com/nextlyhq/nextly/pull/2125) [`e356b75`](https://github.com/nextlyhq/nextly/commit/e356b753086c530949efa44e7c64dae9d986d8ee) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A version comparison now names fields the way the editor does. Each field
  carries the label it declares (`declaredLabel`, or `null` when it declares
  none, so a reader applies its own naming rule instead of showing the field's
  key) and its place among containers (`path`), including groups with no name,
  whose heading was lost before. A field the reader may not read is reported in
  its place as `hidden`, with nothing of its values, instead of disappearing.
  Keys with no field are marked `system` (a framework column such as when the
  document was first published) or `removed`, and removed fields are listed
  last. A comparison with withheld fields is marked `incomplete`, so "no
  changes" then means only that nothing the reader may read changed; a
  changes-only comparison never lists a hidden field. The new response fields
  are experimental.

  Compatibility: `FieldDiff` gains the `hidden` member. Code that switches over
  `kind` exhaustively needs a `hidden` case (or a default) after upgrading; the
  admin draws it as "Hidden: you don't have access to this field".

- [#2148](https://github.com/nextlyhq/nextly/pull/2148) [`4358d85`](https://github.com/nextlyhq/nextly/commit/4358d8586a085bc650f3ab5c398ac7b3500c96a3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A version comparison can start from a baseline the server works out, instead
  of two version numbers: `?to=6&baseline=previous` compares version 6 with the
  version before it in the same language, `published` with that language's
  latest published version, and `draft` with its current draft. With neither a
  `from` nor a `baseline`, a comparison opens on the current draft against what
  is published when both exist, and otherwise on a version against the one
  before it. A language's first version is refused with `NO_BASELINE`, and the
  response names the baseline it used. Core features can register their own
  baselines. Comparing two named versions works as before. Baselines are
  experimental.

- [#2128](https://github.com/nextlyhq/nextly/pull/2128) [`2011f67`](https://github.com/nextlyhq/nextly/commit/2011f67edc438869e7f5740f46b35b4b8bb1fe29) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A many-to-many relation inside a component was stored as a column on the component's row, but the schema planner did not expect that column. A push over such a component could plan to drop the column that stores the link. The planner now expects the same column the component table is created with, so a push, migration, or introspection finds no difference.

- [#2094](https://github.com/nextlyhq/nextly/pull/2094) [`b24afb3`](https://github.com/nextlyhq/nextly/commit/b24afb3369d40b1a4bab1a9e7c7855f667b763a0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A page builder document is now judged as a reader receives it, on every write
  path — the editor, the API, a batch, and an import that skips hooks:
  - a component save that would make the component contain itself is refused,
    naming the chain;
  - a document whose components put a block where the nesting rules forbid, or
    nest deeper than the depth limit counted from the top of the document, is
    refused, naming the placement;
  - a component change that would break a page, Layout or component placing it
    is refused, saying how many documents it would break and which rule. The
    documents themselves are named only in the server log, since they were found
    and read as the system. Documents the usage index cannot vouch for are
    reported in the server log as unjudged.

  Plugin field types gain an experimental `write` argument on `validate`: which
  entry the write is for, and `readStored`, a read of stored values of the
  validator's own type on the write's own connection — so a batch's own rows are
  seen. The page builder's former cycle-guard `beforeChange` hook is removed;
  bulk component writes with hooks running are no longer refused for being in a
  transaction.

- [#2263](https://github.com/nextlyhq/nextly/pull/2263) [`e4bab4c`](https://github.com/nextlyhq/nextly/commit/e4bab4ca033d1c214742bf6c48457b0176e2896b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Under `next dev`, a saved config that imports a file in a folder that does not exist yet now applies once that folder and file are created. Before, the import was seen only on the next save of the config.

- [#1948](https://github.com/nextlyhq/nextly/pull/1948) [`b83f351`](https://github.com/nextlyhq/nextly/commit/b83f351fd17906ef81da570bebe9972a4c602675) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Core authentication hardening, and the runtime surface a stateful plugin needs.

  ## Upgrading

  **Run `nextly migrate` before deploying this release.** It adds the nullable
  `users.deactivated_at` and `users.email_verified_via` columns and the
  `nextly_plugin_settings` table, and marks every address already verified as
  verified by `legacy`. Boot applies the schema, and the same marking, on its own
  in two cases: with `NODE_ENV=production` when
  `db.runMigrationsOnBoot` is on, and with `NODE_ENV=development` unless
  `NEXTLY_DISABLE_BOOT_APPLY=1` is set or the app has no migrations directory.
  Otherwise boot only warns about a schema that is behind, and password login
  and token refresh read whole `users` rows, so on an unmigrated database every
  login and refresh fails until the migration runs.

  ## Breaking changes

  Each is described in its section below; listed here so none is missed.
  - **Plugin routes check the request origin by default** for unsafe methods
    from a session-cookie caller, and answer `403 CSRF_FAILED` when it is not
    this site or an allowed origin. API-key and webhook callers are never
    checked and need no opt-out; a webhook route is `public: true`.
    `csrf: false` makes a route refuse every unsafe request the session cookie
    authenticates, and cannot be combined with `public: true`: boot refuses
    such a route, naming the plugin and the route.
  - **A `customizeClaims` hook can only add claims.** Every claim core built —
    identity, `roleIds` and the token claims — is restored as core built it, a
    claim named after a configured user field can be neither added nor changed,
    and the reserved token claims cannot be added. Add your own claim beside a core one instead of changing it.
  - **An `afterAuthenticate` hook that returns another account fails the
    login.** Change the user's details, never its id.
  - **A `determineUser` hook must name a usable account.** `GET /auth/session`
    reads the account the hook returns and does not answer it as a session when
    that account is unknown, deactivated or unverified; the request then goes on
    to the session cookie. A hook returning a synthetic identity, such as one
    for an API key, no longer gets a session.
  - **Challenge views no longer post the answer.** They receive
    `resolve(response)` and call it; `pendingToken` is deprecated.
  - **A wrong code at `POST /auth/challenge/resolve` answers in the canonical
    error envelope.** The 401 was a top-level
    `{ status, challengeType, pendingToken, error: "Invalid code." }`; it is now
    `{ error: { code: "AUTH_INVALID_CREDENTIALS", message, requestId, data } }`,
    where `data` is `{ status, challengeType, pendingToken }`, with no
    `pendingToken` when the pending token came from the cookie, which the
    re-issued one replaces. A view that still posts its own answer reads the
    next token from `error.data.pendingToken`.
  - **`routeAuthRequest` and `AuthRouterDeps`, exported from `nextly/auth`, are
    marked `@experimental`, and `AuthRouterDeps` changed.** It requires
    `fetchAccountState` and `withSessionRowTransaction`, and `findUserByEmail`
    returns a `CredentialUserRow`, which adds `deactivatedAt` and
    `passwordUpdatedAt` and makes `passwordHash` nullable. Code that builds the
    deps itself supplies both and handles a row with no password;
    `CredentialUserRow`, `AccountState`, `SessionRowTransaction` and
    `WithSessionRowTransaction` are exported from `nextly/auth` to name them.
    `AccountState.passwordUpdatedAt` is required (`Date | null`), so
    `fetchAccountState` and `withSessionRowTransaction` return the column as
    stored, and `setInitialPassword` returns `{ userId, passwordUpdatedAt }`.
  - **`createLocalUser` defaults to an unverified address** for a caller that
    says nothing. `nextly.users.create` and `ctx.services.users.create` still
    default to `admin-vouched`, because they are the host's own server code;
    pass `emailVerification: "pending"` there for a self-supplied address.
  - **Self-registered accounts stay unverified until their link is followed.**
    Registration used to mark the address verified at once, and password sign-in
    requires a verified address, so an app with registration on now needs a
    working email provider. An administrator activating such an account no
    longer lets it sign in by itself: the person follows the link, or the
    administrator also sets `emailVerified`.
  - **A correct password for an unverified account answers 403
    `EMAIL_NOT_VERIFIED`** at `POST /auth/login`, where it answered 401
    `AUTH_INVALID_CREDENTIALS`, and `nextly.login()` answers the same way. A
    wrong password, and a locked or administrator-deactivated account, still
    answer `AUTH_INVALID_CREDENTIALS`.
  - **`PATCH /api/users/:id/password` clears `mustChangePassword` and ends the
    account's sessions.** It used to set only the hash; it now also stamps
    `passwordUpdatedAt` and deletes the account's refresh tokens, so a flow that
    creates a user who must change their password and then sets it this way no
    longer leaves the change pending.
  - **A refresh token is spent once.** Two refreshes presenting one token no
    longer both succeed: the second answers 401 `REFRESH_SUPERSEDED` and leaves
    the cookies alone. A client other than the admin retries once with the
    cookies it now holds.
  - **The refresh cookie is scoped to `Path=/admin/api/auth`**, where it was
    `/admin/api/auth/refresh`, so sign-out receives it and deletes the session's
    refresh row; before, that row stayed valid for its whole lifetime after the
    user signed out. A cookie left at the old path is cleared by the next
    sign-in, refresh or sign-out. Only core's refresh and sign-out handlers read
    it: auth hooks (`determineUser`, `beforeLogin`), auth strategies and plugin
    route handlers receive the request without `nextly_refresh`, with every
    other cookie, header and the body unchanged.
  - **`nextly.login()` applies the login endpoint's account checks.** It
    refuses a locked, deactivated or unverified account, and one that must
    replace an admin-set password, and a wrong password counts toward the
    lockout. Bring the account into a usable state first, or sign the person in
    through the login page.
  - **`runStrategyChain` returns `{ outcome, strategyName }`.** Read `.outcome`.
  - **`ctx.db` without `capabilities.db.rawSql` is a restricted handle** with
    `select`, `insert`, `update`, `delete` and `transaction` only: `execute`,
    `run`, `selectDistinct`, `$count`, `with`/`$with` and `batch` are gone, as is
    the relational `query` namespace. Declare `rawSql` for the live instance.
  - **A plugin's events must be named under its slug.** `ctx.events`, a stable
    surface in `STABILITY.md`, now takes from a plugin only names beginning
    `<slug>.`, where the slug is `pluginAdminSlug(name)`: `@acme/billing` emits
    `acme-billing.charged`. `ctx.events.emit` throws `FORBIDDEN` for any other
    name, core's (`plugin.`, `collection.`, `auth.`, `document.`, `media.`,
    `user.`) included, and a plugin declaring an event in `contributes.events`
    under a core prefix (`plugin-event-name-reserved`) or outside its slug
    (`plugin-event-outside-namespace`) fails boot. Rename your events under your
    slug.
  - **`ctx.services.users` cannot decide who administers the site.** It refuses,
    with `FORBIDDEN`, to create an install's first account, to give a role that
    reaches `super-admin` (directly or by inheritance) on create or update, and
    to change the password, email, activation, email verification or roles of
    an account that reaches `super-admin`, or to delete one. `ctx.services` is
    stable in `STABILITY.md`. Core's own paths (the admin, the Direct API,
    setup) are unchanged.
  - **The account-link endpoints and their service methods are removed.**
  - **`accounts` and `sessions` are no longer exported from `nextly/schemas`.**
    Code that imports them stops compiling; declare the table yourself with only
    the columns you read. Fresh installs no longer create the tables.
  - **Deleting a user no longer erases their rows from a retired `accounts` or
    `sessions` table unless you name it.** Set
    `NEXTLY_ERASE_RETIRED_AUTH_TABLES` to the tables that are Nextly's
    (`accounts`, `sessions`, or `accounts,sessions`). Nextly keeps no record that
    it created them, and the Auth.js adapters' tables share the name and shape.

  ## Authentication

  Locked, unverified and deactivated accounts could still receive a session.
  Only the password strategy checked account state, and `issueSession` trusted
  whichever caller reached it, so any other strategy minted a session for an
  account the password path would have refused. Three handlers re-checked
  `isActive` on their own, and a path that forgot simply issued the session.

  One gate now decides whether an account may hold a session, and every path that
  ends in one asks it: password login, challenge resolution, the forced
  first-sign-in password change, refresh, the plugin path that follows, and the
  Direct API's `nextly.login()`. That last one signs a 30-day token from a
  password, so it now checks credentials through the login endpoint's own
  check: a wrong password counts toward the lockout, and a locked, deactivated
  or unverified account is refused as the endpoint refuses it. An account that
  must replace an admin-set password is refused too, since the forced change
  is a step only the login page can complete. It runs no plugin login hooks
  and no second-factor challenge, so it is for trusted server code rather than
  for signing a person in. Each refusal carries the same public error, so the gate cannot be used to tell a
  locked account from an unknown one.

  The one refusal that is named is an unverified address, and only after the
  password has been proven correct: login answers `EMAIL_NOT_VERIFIED` (403),
  so the login page can show its "Resend verification email" action instead of
  a dead-end "Invalid email or password". Whoever receives it already holds the
  password; a wrong password, and every other refusal, still answer
  `AUTH_INVALID_CREDENTIALS`, and a locked account answers generically even to a
  correct password, as does one an administrator deactivated, since no
  verification link is sent to it. The Direct API's `nextly.login()` answers the
  same way.

  Resending a verification email now does nothing for an address that is
  already verified, answering the same as for an unknown one; previously it
  mailed a fresh link to any account. The resend endpoint is also held to the
  same per-IP budget as `forgot-password`, since both send an email on request,
  and so is `verify-email`, which consumes a single-use token as
  `reset-password` does.

  An administrator's deactivation now outlasts the account's own links. The
  `users` table gains a nullable `deactivated_at` column, added in place by the
  core schema sync with no row rewritten. Setting `isActive: false` records it,
  even on an account that was already inactive, such as a sign-up still waiting
  on its link; setting `isActive: true` clears it. While it is set, a
  verification link verifies the address but no longer activates the account, no
  new verification link is sent, and an invite link is refused without setting a
  password. Previously any of these switched the account back on. Minting a new
  invite for such an account answers `CONFLICT` with a message to activate it
  first, rather than handing out a link that could never be accepted. Accounts
  deactivated before this release carry no record, so deactivating them again is
  what protects them.

  A refresh whose account is no longer usable now deletes the refresh row and
  clears the cookies rather than answering 401 and leaving both alive.
  Deactivating an account, or setting its password — by an administrator
  (`updateUser` or `PATCH /api/users/:id/password`), by the user changing their
  own, by a reset, by accepting an invite or by setting an initial password —
  deletes its refresh tokens in the same transaction, so a reactivation does not
  bring old sessions back. Every one of these password writes also clears
  `mustChangePassword` and stamps `passwordUpdatedAt`; `PATCH
/api/users/:id/password` used to set only the hash. A user's own password
  change through `userService.changePassword` is refused for a deactivated
  account, as `changePassword` already was, and the Direct API's `changePassword`
  and `resetPassword` end the account's other sessions too, as the REST endpoints
  did. An administrator who sets their own password on the user edit page is
  signed out and sent to sign in again, as is one who deactivates their own
  account there. A refresh token is spent once: a rotation hands out its new
  token only if it removed the presented row, so two requests presenting one
  token get one rotation, and the one that loses the race answers 401
  `REFRESH_SUPERSEDED` and leaves the cookies alone. The admin retries with the
  cookies it now holds; any other client should retry once with its current
  cookies. A token whose row is already gone — one a second tab rotated a round
  trip earlier, a spent token replayed later, a revoked session's, or a value
  never issued — answers 401 `REFRESH_FAILED` without clearing the cookies:
  nothing is revoked there, and clearing would only wipe the fresh cookies the
  tab that won the rotation has just set in the same browser. Each such refusal
  logs a `refresh-token-not-found` warning, without the token. A sign-in or a
  rotation in flight when the account is deactivated or its password set does not
  leave a session behind: each writes its refresh row in one transaction that
  locks the account's row (`FOR SHARE` on PostgreSQL, `FOR UPDATE` on MySQL) and
  checks the account again. A password sign-in, including one paused for a second
  factor, is refused if the password changed after it was proven, and so is the
  session the forced first-sign-in change issues if the password is set again
  before it is written. An access token already issued stays valid until it
  expires, within fifteen minutes; a token from the Direct API's `nextly.login()`
  lasts 30 days and is not ended early. The password attempt lockout applies to
  password logins only: a refresh is not a password attempt, and someone else
  guessing a password must not end a session that is already established.

  On MySQL the session-row write locks the account with `FOR UPDATE`, which
  every MySQL-compatible server accepts; it only makes concurrent sign-ins of
  one account take turns. The audit and activity writes that check the account
  they name still exists take `FOR SHARE` on MySQL 8, Aurora and Vitess, and
  `FOR UPDATE` on MariaDB and TiDB, which reject `FOR SHARE` as a syntax error,
  so every attributed audit or activity write failed there before. The MySQL
  adapter reports which it can take as `getCapabilities().sharedRowLock`
  (experimental), known once it has connected; `checkDialectVersion` returns
  the variant it detected, and `acceptsForShare` is exported from
  `@nextlyhq/adapter-drizzle/version-check`.

  Any HS256 token signed with `NEXTLY_SECRET` that carried a `sub` was accepted
  as a session. The session verifier refused only the one token kind it had been
  told about, and the account-state endpoint did not check even that, so a token
  minted for a different job — a mid-challenge pending token, or anything a
  future flow signs with the same secret — could be presented as a sign-in.

  Session tokens and second-factor pending tokens now carry a JWS `typ` header
  naming what each is for, and a token is verified for one purpose: a header
  naming another purpose is refused. Preview tokens are kept apart by their own
  derived key and audience. The
  signing algorithm is pinned explicitly at the same time, so a token declaring
  `alg: "none"` cannot talk the verifier out of checking the signature.

  This release still accepts a session token with no `typ` header, so tokens
  already in circulation keep working; 0.1.0 will require it, which will stop
  Direct API tokens minted before this change. Browser sessions are
  unaffected either way, because access tokens rotate every fifteen minutes.

  A custom user field named `typ` can no longer reach the claims, where it would
  have been read as a token kind.

  A `customizeClaims` hook can add claims but no longer change any claim core
  built. `sub`, `email`, `name`, `image`, `roleIds`, and the token's own `iat`,
  `exp` and `jti` are restored as core built them after every hook has run,
  whether a hook replaced, changed in place or deleted them; the reserved `nbf`,
  `aud`, `iss` and `typ` cannot be added. A claim named after a configured user
  field can be neither added nor changed by a hook, and one whose value could
  not be read is left out rather than set to null. A hook that returned a different `sub` or `roleIds` signed a
  session for another account, or with other roles, that the account-state gate
  never saw. A plugin that renamed a core claim now adds its own spelling beside
  it instead.

  An `afterAuthenticate` hook can change the user's details or pause the login
  with a challenge, but only for the account that authenticated. A hook that
  returns a user with a different id, a challenge for a different `userId`, or
  no user at all now fails the login with an internal error, because what it
  returns is what the session or pending token is issued for.

  A `determineUser` hook can answer `GET /auth/session` from a credential of its
  own, such as an API key, but only for an account that may hold a session. The
  endpoint reads the account the hook names, and an unknown, deactivated or
  unverified one is not answered as a session: the request goes on to the
  session cookie as if the hook had returned nothing. A password lockout does
  not disqualify it, as it does not disqualify a refresh. Before, the hook's
  user was answered as returned.

  The forced first-sign-in password change checks the account before changing
  the password, not only at the session afterwards, so an account deactivated or
  unverified since its pending token was issued cannot set its credentials.

  A self-registered account was marked as having a verified email address the
  moment it was created. Creating a user with a password set `emailVerified`
  straight away, and registration supplies a password, so the verification email
  sent afterwards changed nothing: `requireEmailVerification` blocked nobody, and
  anything that trusts the verified flag was trusting an address the account
  holder had merely typed.

  Creating a user now says explicitly whether anything established the address.
  An operator who types someone's password vouches for it, as before, and that
  path is unchanged. Registration does not, so the account stays unverified until
  its verification link is followed. Callers that say nothing get the unverified
  account, because a caller that forgets to say is the one whose claim should not
  be believed.

  Operators upgrading should know that accounts self-registered before this
  change carry a verified flag nothing proved. They are not rewritten
  automatically — that would sign out anyone relying on it. To review them, look
  for users with a password, not created by an admin, whose `emailVerified` is
  within a second of `createdAt`.

  Login audit rows now record which strategy authenticated the attempt, on both
  the success and the failure row, and the failure row still names no account.
  Previously the trail could say that a login succeeded or failed but not by what
  method, which is the first thing worth knowing when a sign-in provider turns
  out to be compromised.

  The strategy survives a second factor: it is signed into the short-lived
  pending token, so the session minted when the challenge is answered records the
  method that actually authenticated the person rather than the one that answered
  the challenge.

  `runStrategyChain` now returns `{ outcome, strategyName }` instead of the
  outcome alone. It is exported from `nextly/auth/pipeline`, so an application
  calling it directly needs to read `.outcome`.

  A plugin that has authenticated someone elsewhere — an OAuth callback, say —
  can now finish the login through the core session path with
  `ctx.auth.completeLogin`. It must declare `capabilities.auth.login`, and its
  strategy names must begin with its own slug (`acme-google-auth:google`), so the
  manifest shows the plugin can sign people in and every audit row names it. It applies the same account-state rules, the same
  hooks and the same audit trail as a password login, so a plugin cannot grant a
  session core would have refused, and every plugin fails the same safe way.

  Preconditions run before any hook that could act, so an account that may not
  hold a session never triggers a second-factor code being sent to it. The
  password-attempt lockout does not apply, because an external login is not a
  password attempt and otherwise anyone knowing an address could lock its owner
  out of their provider.

  A login interrupted by a second factor now resumes without a token ever
  appearing in a URL. The pending token travels in an HttpOnly cookie and the
  login page asks `GET /auth/pending` which challenge is outstanding, and that
  endpoint never returns the token itself. (A password login still returns its
  challenge token in the response body, as before.) A correct answer whose
  session is refused after it settled the flow clears the pending cookie, and
  `GET /auth/pending` answers 204 for a flow whose attempt budget is spent, so the
  login page stops offering a challenge nothing can finish.
  `RateLimiter.peek(key, windowMs)` is new: it reads a key's count without
  spending an attempt.

  `ctx.auth.currentUser(request)` reports the signed-in user for a plugin route
  that behaves differently when someone is already signed in. A POST, PUT, PATCH
  or DELETE whose `Origin` (or, without one, `Referer`) is neither this site nor
  an allowed origin, or that names no origin at all, gets no user (`null`), so a
  public route acting on the user it reads cannot be driven by another site
  through the session cookie.

  Breaking, for plugins that contribute a challenge view: the host now posts the
  answer, and the component receives `resolve(response)` instead of posting the
  `pendingToken` itself. A resumed login has no token in the browser to hand it.
  `pendingToken` stays in the props for one minor, deprecated, and is undefined
  in resume mode. When an answer finishes the login, the host navigates to the
  login's destination itself; `onResolved` chooses where to land only for a view
  that still posts its own answer with `pendingToken`. Such a view gets a
  console notice in the admin, once per challenge type, saying the prop is
  deprecated.

  `ctx.services.users` is the user service as a plugin receives it, and a
  plugin may not decide who administers the site through it. It refuses, with
  `NextlyError` code `FORBIDDEN`, to create an install's first account (core
  makes that one super-admin), to give a role that reaches `super-admin`,
  directly or by inheritance, on create or update, and to change the password,
  email, activation, email verification or roles of an account that reaches
  `super-admin`, or to delete one. The admin, the Direct API and setup keep the
  unrestricted service.

  `users.email_verified_via` records how an address came to be verified: `link`
  (a verification link), `invite` (an accepted invite), `admin` (an
  administrator, the app's own server code, setup or a seeder), `plugin`
  (through `ctx.services.users`) or `external` (a login provider). It is written
  in the same statement as `email_verified` and cleared with it. `nextly migrate`
  adds the nullable column and marks an address verified before it existed, or
  written outside Nextly, as `legacy`, on every run, so a later decision keyed on
  how an address was verified can tell an unknown origin from a known one.

  ## The plugin runtime

  Plugins can now declare what they may do, and the runtime holds them to it.
  None of this is a sandbox — Nextly runs plugins as trusted code — but a
  manifest makes a plugin's reach legible before it is installed, and the
  surfaces below exist only for a plugin that asked for them.

  **Capabilities, and what a plugin provides or requires.** The manifest's shape
  is checked before anything reads it, and boot fails with the plugin named for:
  an unknown key anywhere inside `capabilities`, a value of the wrong type, an
  outbound entry that is not a hostname (IP literals included), an empty or
  unparseable `requires` range, secrets without a settings schema, a duplicate,
  unknown or group-naming secret path, a secret path to a value that cannot
  be a string (a number or a boolean, say), a challenge id core reserves or
  another enabled plugin also declares, a settings key or plugin name too long
  for storage, and a `schemaVersion` that is not a positive integer.
  `nextly plugins info <name>` prints the manifest: outbound hosts, raw SQL,
  whether it finishes logins, secret paths, what it provides and requires, and
  its `schemaVersion` ("not declared" when it has none). Capability names are
  global; prefix them with your vendor (`acme/auth-provider`).

  **`onReady`**, which runs after every plugin has initialised and routes are
  registered — the first moment the assembled system is readable. There are no
  install or uninstall hooks yet: they arrive with the install command.

  **`ctx.settings`**: one store per plugin, validated by the plugin's own zod
  schema, with the paths named in `capabilities.secrets` encrypted at rest.
  Secrets are sealed with AES-256-GCM under a key derived with HKDF once per
  `NEXTLY_SECRET` generation, with the plugin and path authenticated as
  associated data, and labelled with the generation that sealed them. A value
  sealed under `NEXTLY_SECRET_PREVIOUS` is re-sealed under the current secret
  when read; one no configured secret can open shows as
  `{ set: true, readable: false }` and can be overwritten; `get()` logs why
  such a value could not be opened: a malformed envelope, a key the install no
  longer configures, or a failed authentication. A value stored
  encrypted stays encrypted, and redacted in the admin, even after a plugin
  update stops declaring its path. `set` is a JSON merge patch, so `null`
  removes a key at any depth, and an unknown key is refused at any depth. One
  key's stored value, after encryption, holds at most 256 KiB on every dialect
  (MySQL stores it as `mediumtext`). Settings a newer plugin version no longer
  accepts still render in the admin with the problems listed, and `get()` throws
  an internal error whose log names them. A secret is never returned to the
  browser: the admin sees `{ set }`. An operator's change is recorded in the
  activity log by key name, and every change is announced in-process as
  `plugin.settings.changed`.

  **`ctx.fetch`**, limited to declared hosts. A hostname allowlist alone does not
  prevent server-side request forgery, so names are resolved here, every answer
  is vetted, and the request is sent to the address that was vetted — closing the
  window in which a name resolves differently for the check than for the request.
  Private, loopback, link-local, metadata, documentation (TEST-NET) and other
  reserved addresses are refused, including the IPv6 ways of writing them, and
  every redirect is re-checked. A redirect
  that would send the request body to a different origin is refused: a body can
  carry a credential — an OAuth `client_secret`, say — as surely as a header,
  and the headers are already dropped at that boundary. A request body over
  10 MB is refused, whatever its type. The `CONNECT`, `TRACE` and `TRACK`
  methods and caller-set `Upgrade`, `Keep-Alive` and `Expect` headers are
  refused, as is a `Connection` header other than `close` or `keep-alive`; those
  two are dropped, because the transport manages its own connection. An answer
  that switches protocols (`101`) is refused rather than left pending.

  **`ctx.audit`**, which writes only the kinds a plugin declared — `<slug>.`
  followed by lowercase letters, digits, `.`, `_` and `-` — with metadata keys
  allowlisted per kind and values with a known credential shape dropped.
  Deleting a user clears the metadata of every plugin row naming them, as actor
  or target. A `targetUserId` must name an existing user: a row naming one that
  does not exist is stored without its metadata, and a warning is logged.

  **Route options** — `rateLimit`, `rawBody`, `csrf` and `noStore` — the
  protections core's own routes have.

  `rateLimit` takes `"auth"`, `"general"`, or `{ max, windowMs }`, and counts
  each route path separately, with IPv6 clients counted by their /64. Without
  `security.trustProxy` no client address is read, so every client shares one
  limit, and boot names each rate-limited route when that is the case.

  CSRF applies only to callers the session cookie admitted, because a browser
  cannot attach an API key cross-site. By default an unsafe-method request must
  come from this site or an allowed origin, which a same-origin write does
  without a token; `csrf: true` also requires the double-submit token, and
  `csrf: false` refuses every unsafe-method request the session cookie
  authenticates, so the route takes writes only from callers with another
  credential. A refusal answers `403 CSRF_FAILED` and records a `csrf-failed`
  audit event. A public route skips the default check; a public handler that
  resolves the session user through `ctx.auth.currentUser` gets no user for a
  cross-site write, and `csrf: true` adds the token. `csrf: false` cannot be
  combined with `public: true`: boot refuses such a route, naming the plugin and
  the route.

  The admin's `usePluginRouteMutation` now sends `x-csrf-token` on every write,
  read from the `nextly_csrf` cookie or fetched once from `/auth/csrf`, so a
  route the plugin's admin page writes to through it may leave `csrf` unset or
  declare `csrf: true`. A page that writes with its own `fetch` either leaves
  `csrf` unset, or fetches `/admin/api/auth/csrf` and sends the token as
  `x-csrf-token` (or as `csrfToken` in a JSON body). The admin's fetcher also
  merges a caller's `headers` onto its defaults, where they used to replace them
  and drop the JSON content type.

  **Declared hook points**, collision-checked and owned by prefix, plus
  `ctx.filters.decide` for seams where handlers veto rather than transform.
  Decisions fail closed: a handler that throws denies, and a handler may only
  keep or downgrade a verdict, so load order cannot decide access.
  `HookPointPayloads` (experimental) maps a hook point's name to what it
  carries, so `ctx.filters` and `ctx.actions` type a listed point's handlers and
  calls; a plugin lists its own points by augmenting it from
  `@nextlyhq/plugin-sdk`, and a name with no entry is typed as before.

  **`user.created` and `user.deleted` events**, so a plugin can clean up what it
  stored against a user, with `UserEvents` and their payload types. The webhook
  outbox row is durable but reaches nothing inside the process.

  **SDK additions**: `sanitizeAdminPath`, `DEFAULT_ADMIN_PATH`,
  `ctx.auth.verifyCsrf`, `collectDeclarations`, the runtime types
  (`PluginSettingsApi`, `PluginAuditApi`, `PluginAuthApi`,
  `CompleteLoginOptions`, `Decision`, `PluginCapabilities`,
  `PluginAuditDeclaration`, `PluginHookPointDeclaration`, `PluginDatabase`,
  `PluginRouteRateLimit`), `ChallengeViewProps` and `ChallengeResolveResult` from
  `@nextlyhq/plugin-sdk/admin`, and `@nextlyhq/plugin-sdk/db` — Drizzle's query
  operators re-exported through core, so a plugin uses the Drizzle version core
  runs. All are experimental. `ctx.auth.verifyCsrf`
  reads the token from the `x-csrf-token` header or a JSON body's `csrfToken`,
  through the same bounded reader as the route option: it reads at most 64 KB of
  a body looking for it and refuses a larger one with `reason: "body-too-large"`,
  so a large request carries the token in the header.

  **Breaking.** The account-link endpoints are removed:
  `GET /api/users/{id}/accounts` and
  `DELETE /api/users/{id}/accounts/{provider}/{providerAccountId}`, along with
  the `getAccounts`, `deleteUserAccount` and `unlinkAccountForUser` service
  methods behind them. They read an `accounts` table nothing has written since
  the auth rewrite, so they could only ever answer with an empty list or a
  not-found, and a route that cannot return data invites clients to build
  against it. External sign-in is not affected: nothing in this release reads or
  writes the `accounts` table.

  The relational `query` namespace is also gone from the plugin-facing database
  type. It named a handful of core tables, so it could never answer about a
  plugin's own tables; reads go through the fluent Drizzle API or the typed
  services.

  `ctx.db` for a plugin that does not declare `capabilities.db.rawSql` is a
  restricted handle with `select`, `insert`, `update`, `delete` and
  `transaction`, and no `execute` or `run`; with `rawSql` it is the live Drizzle
  instance. The capability is a declaration a reviewer can read, not a sandbox:
  plugins run as trusted code. `transaction(async tx => ...)` works on every
  dialect, `rawSql` or not; inside it, write through `tx` — another Nextly
  service or `ctx.settings` called there runs on its own connection on
  PostgreSQL and MySQL, outside the transaction, and commits on its own. With
  `rawSql`, `tx` is the live handle, and its `transaction` nests as a savepoint
  on every dialect.

  The SQLite adapter runs a `transaction()` called from inside another
  transaction's work as a savepoint of it, including one made later from a
  savepoint that has since released, which runs inside the innermost transaction
  or savepoint still open on the connection, and rolls back with it if that one
  does. It used to queue behind the transaction waiting for it, which hung both
  and every later transaction on the instance. Core services' own transactions on
  SQLite go through the adapter too, so one called inside a plugin's
  `ctx.db.transaction` nests as a savepoint, and its rows roll back with it,
  instead of failing with "cannot start a transaction within a transaction".

  What it does after its own write — collection `afterCreate`, `afterUpdate` and
  `afterDelete` hooks, field `afterChange` hooks, events such as `user.created`,
  `media.uploaded` or `plugin.settings.changed`, cache revalidation and webhook
  delivery — waits until the plugin's transaction commits, runs once before
  `ctx.db.transaction` resolves, and never runs if it rolls back. Inside such a
  transaction an after-hook's error is logged rather than failing the call, and a
  value a field `afterChange` hook or a Single's `afterUpdate` hook returns does
  not reshape the service's response. `DrizzleAdapter.afterCommit()` is new and
  experimental: it runs an effect once the current write is durable, now on
  PostgreSQL and MySQL, and on SQLite after the outermost transaction commits.
  Sign-out, the refresh-token theft response, failed-attempt and lockout writes,
  role assignment and removal, API-key revocation and audit entries made by other
  requests queue behind a plugin's transaction on SQLite, instead of running
  inside it and being undone by its rollback. An effect belongs to the
  savepoint whose write registered it, so a nested write that rolls back
  announces nothing even when sibling writes in a `Promise.all` succeed.
  `updateUser` writes an account's core fields and replaces its roles in one
  transaction, and a plugin's change to any account-controlling field, roles
  included, re-checks the super-admin rule inside it.

  A core media delete (`media.delete` or `media.bulkDelete`) called inside the
  transaction is refused with `409 CONFLICT`, so stored files are never removed
  for a delete that rolls back: delete media after the transaction. A focal-point
  change made inside it keeps the superseded image variants rather than deleting
  them. `DrizzleAdapter.inTransaction()` is new: it tells a caller whether a
  `transaction()` made from there would join an open transaction as a savepoint,
  and is false on PostgreSQL and MySQL, where each transaction has its own
  connection. On SQLite a plugin's transaction holds the database's only
  connection until it ends: other requests' statements wait for it or run inside
  it, so keep it short and never await network I/O (`ctx.fetch`) inside it.
  Nested transactions on SQLite run one at a time, in the order they are started.
  A nested transaction must never wait for one started after it in the same
  transaction, for example through a memoised or cached promise that a later
  sibling created: neither settles, and the connection stays inside the open
  transaction, so every later transaction waits and other requests' writes land
  in it without ever committing, and a restart loses them. Start shared work
  before the transactions that wait on it, or outside the transaction. An error
  the plugin throws inside `ctx.db.transaction`, `rawSql` or not, reaches it as
  thrown, as on PostgreSQL and MySQL, rather than as a generic database error.

  **Breaking for fresh installs.** Nextly no longer creates the `accounts` and
  `sessions` tables. They came from an authentication model it no longer uses:
  sessions are stateless JWTs with their own refresh-token table, and nothing in
  this release reads or writes either table.

  An existing database keeps both. Dropping a table that may hold rows is the
  operator's decision rather than an upgrade's, so Nextly warns once at startup,
  naming each table still present and how many rows it holds, and changes
  nothing. `nextly migrate` with `NEXTLY_DROP_RETIRED_AUTH_TABLES=1` drops them
  and records the drop in the schema ledger; one that still holds rows
  additionally needs `NEXTLY_DROP_NONEMPTY_RETIRED=1`, and is otherwise kept with
  a warning while the empty one is dropped and the rest of the run goes ahead.
  Only the value `1` turns either flag on.

  A table counts as one of these only when its columns match the shape Nextly
  created (`accounts`: `user_id`, `provider`, `provider_account_id`;
  `sessions`: `session_token`, `user_id`, `expires`), so a host application's
  own table that merely shares the name is not reported, dropped or erased from.
  A host table built on the same Auth.js model does match it: it is reported at
  boot and the flags would drop it. If one shares the database, rename it.

  Deleting a user erases their rows from a retired table only when
  `NEXTLY_ERASE_RETIRED_AUTH_TABLES` names it (`accounts`, `sessions`, or
  `accounts,sessions`), and only while it still has that shape. Nextly keeps no
  record that it created either table, and the Auth.js adapters' tables share
  the name and shape, so without the name the rows stay, and the startup warning
  says so and names the setting. Name a table only when it is Nextly's.

  Both names stay reserved, so a collection cannot take a name that an existing
  database still has a table under.

  The `accounts` and `sessions` Drizzle tables are no longer exported from
  `nextly/schemas` either, and their definitions are gone from every dialect: a
  table Nextly neither creates nor writes has no schema object to offer. Code
  that still reads one of them on an existing database declares the table
  itself, with Drizzle's `pgTable`, `mysqlTable` or `sqliteTable` and only the
  columns it reads.

  A login provider button can now carry an `href`, and the login page renders it
  as a link. Previously a provider that did not ship its own React component
  rendered a button with no handler behind it: it looked like a way to sign in
  and did nothing, so only providers shipping a component could start a flow.

  The path is validated where it is served: exactly one leading slash and a
  second character that cannot begin an authority, which rejects absolute URLs,
  protocol-relative paths and the backslash forms. A login button is the most
  valuable place on a site to plant an open redirect. It is deliberately not
  required to sit under `/admin/api`, because that base path is configurable and
  a plugin may mount its routes at the root.

  Plugin-contributed login slots also render where their names say. Everything
  was previously rendered below the form, which made `beforeForm` describe
  nothing and put provider buttons underneath the password field they are an
  alternative to.

  The login page lands a resumed second-factor login on its `next` rather than
  the dashboard, keeps the challenge through a network failure, a rate limit or
  a server error, and says so when the attempt has ended. A provider link shows
  its declared icon and starts one sign-in however often it is clicked, and the
  `?error` parameter is removed once read. `?resume` stays, so a reload in the
  middle of a second factor finds the flow again.

  The CLI resolves the plugin list a `setup` transformer leaves exactly as the
  boot does, so `nextly migrate`, `build`, `db:sync` and the dev reload refuse a
  transformer-added plugin the app would refuse, and see its collections and
  field types.

- [#1997](https://github.com/nextlyhq/nextly/pull/1997) [`c399249`](https://github.com/nextlyhq/nextly/commit/c3992494bcf8c99c9a43f322f0cee9ce66a0030e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `ctx.db` is typed and owner-checked, raw SQL needs the app's consent, and
  plugin code no longer reaches core's live handles through `ctx.config`,
  `ctx.services` or a `setup` transformer.

  ## Breaking changes
  - **`ctx.db` is no longer a Drizzle handle.** It is the owner-checked surface
    over the tables a plugin declared and its dependencies' tables, the same on
    every dialect. The four verbs it shares with
    Drizzle take different arguments: `ctx.db.select(myTable)` where you wrote
    `ctx.db.select().from(myTable)`. A call written against the old shape is
    refused by name, saying what changed and where the old handle went.
  - **The old handle is `ctx.db.raw`, and it is the restricted builder.** It has
    Drizzle's `select`, `insert`, `update` and `delete` plus `transaction`, with
    no owner check, and no `execute`, `run` or relational `query`. Inside its
    `transaction`, `tx` is the same builder without a nested `transaction`. The
    smallest migration is one property deeper:

    ```ts
    // before
    await ctx.db.select().from(rows).where(eq(rows.id, id));
    // after: the restricted builder
    await ctx.db.raw.select().from(rows).where(eq(rows.id, id));
    // or owner-checked and portable across all three dialects
    await ctx.db
      .select(rows)
      .where(eq(ctx.db.table(rows).id, id))
      .first();
    ```

  - **Raw SQL needs the app to list the plugin.** `ctx.db.raw` is the live
    Drizzle instance, `execute` and `run` included, only for a plugin that
    declares `capabilities.db.rawSql` AND that the app lists in
    `nextly.config.ts`:

    ```ts
    db: {
      rawSqlPlugins: ["@acme/nextly-reports"];
    }
    ```

    Declaring `rawSql` used to be enough, and the live instance was `ctx.db`
    itself. An enabled plugin that declares it without being listed now stops
    the boot and every CLI command that loads plugins with
    `PLUGIN_RESOLUTION_ERROR` (`logContext.reason` is `capability-not-listed`);
    the message names the line to add. The list is read from the config as the
    app wrote it, before any plugin's `setup` runs, so a plugin cannot add
    itself. A listed name that matches no configured plugin logs a warning at
    boot.

  - **The raw-SQL grant is judged on the plugins as the app configured them.**
    - The plugins are recorded before any `setup` transformer runs, and the
      transformed list is judged against that record.
    - A plugin that holds `capabilities.db.rawSql` only because a transformer
      gave it (adding the plugin, renaming a plugin onto a name no configured
      plugin declaring it held, or setting the flag on a plugin whose manifest
      does not declare it) refuses the boot with `PLUGIN_RESOLUTION_ERROR`
      (`capability-added-by-setup`).
    - A plugin that declares `rawSql` under a configured name whose lifecycle
      functions or `contributes` a transformer replaced (including dropping the
      configured plugin and renaming another onto its name) refuses with
      `plugin-code-replaced-by-setup`, naming the plugin and the changed path.
    - The grant is decided once, when the boot resolves the plugin list. Every
      plugin context, the auth router's included, reads that decision, so
      turning `capabilities.db.rawSql` on after the boot grants nothing. The
      exported `createPluginContext` takes the grants as a fourth argument and
      grants nothing without them.
  - **A `setup` transformer receives copies of settings, not live handles.** It
    receives copies of the plugin definitions and of the plain settings, with
    `db.rawSqlPlugins` frozen. The copies keep symbol-keyed properties, so a
    field declaration's brand survives a transformer that returns them.
    `adapter`, `logger`, `hookRegistry`, `passwordHasher`, `rateLimit`, `storagePlugins` (the CLI's `storage`),
    `imageProcessor` and `pluginConsent` are absent from its input, and a value
    it returns under those keys, or under any other key it was not handed, is
    ignored: the app's own value is kept. Editing a definition in place no
    longer changes the app's own plugin objects. `PluginDefinition.setup`'s
    type is unchanged, so typed transformers still compile; the withheld keys
    are simply absent at runtime.
  - **`ctx.config` is a frozen copy of plain configuration.** Its type is the
    new `PluginConfig`, in place of `Readonly<NextlyServiceConfig>`.
    - Every plain object and array in it is a copy frozen all the way down, so
      writing a nested value throws in strict-mode code rather than reaching
      the configuration core reads. Functions and class instances are kept by
      reference.
    - Removed: `adapter`, `db`, `pluginConsent`, `storagePlugins`,
      `imageProcessor`, `logger` (use `ctx.logger`), `hookRegistry` (use
      `ctx.hooks`), `passwordHasher`, `rateLimit`, and `email.providerConfig`
      (the provider's credentials).
    - `ctx.config.plugins` lists `PluginSummary` entries (`name`, `version`,
      `enabled`, `capabilities`, `contributes.declarations`), not definitions.
    - `PluginConfig` is typed readonly all the way down (`FrozenCopy`), as the
      value is frozen, and so is `PluginSummary.capabilities`. Code passing
      part of it to a parameter typed mutable, such as `ctx.config.collections`
      to one wanting `CollectionConfig[]`, stops compiling; type the parameter
      from it instead (`PluginConfig["collections"]`). Spreading the array is
      not enough, since its entries stay frozen.
  - **`ctx.services` hands out facades.**
    - `users`, `media`, `email`, `versions` and `collections` are frozen
      facades of the methods meant for plugins. A service's `adapter`, Drizzle
      handle, sub-services and logger are no longer reachable, and
      `collections.registerDynamicSchemas` and `invalidateSchemaForSlug` are
      gone.
    - `collections.withTransaction` hands its work an opaque
      `PluginCollectionTransaction` token, which the `*InTransaction` methods
      accept, instead of the adapter's transaction context; any other value is
      rejected with `VALIDATION_ERROR` (`plugin-transaction-token-unknown`).
      This changes the `@public` `PluginCollectionService` type.
    - The `*InTransaction` methods take `ServiceOpts` as their last argument,
      as `createEntry`, `updateEntry` and `deleteEntry` do, not the service's
      request context. A context naming `overrideAccess`, or a `user` carrying
      its own roles, was handed to the access check as written; now a `user`
      is judged with the roles the other methods resolve for it, and an
      `overrideAccess` key is not read. `{ user: ctx.user }` and `{}` keep
      their meaning (that caller, and `system`). `deleteEntryInTransaction`
      no longer takes an `actor`.
  - **`ctx.db.transaction` does not nest.** `tx` is the typed surface bound to
    the transaction's connection, and its type has no `transaction`. Called
    anyway, it rejects with `INVALID_INPUT` (`nested-plugin-transaction`)
    instead of opening a second transaction on another connection. With
    `rawSql` listed, `ctx.db.raw.transaction`'s `tx` is the live handle and its
    `transaction` nests as a savepoint.
  - **A transaction ends with its callback.** The `tx` of `ctx.db.transaction`
    and `ctx.db.raw.transaction`, and the token `withTransaction` hands its
    work, kept and used after the callback settles, are refused with
    `VALIDATION_ERROR` (`plugin-transaction-finished`) instead of running
    outside the transaction. In `ctx.db.transaction` and `withTransaction`, a
    write the callback started without awaiting is finished before the commit,
    and if it fails the transaction rolls back and rejects with that failure
    (or with the callback's own error, if it threw). In
    `ctx.db.raw.transaction`, awaiting each Drizzle statement, and every
    builder made from `tx`, before the callback returns stays the callback's
    job.
  - **`ctx.db` checks table access when a query runs.** A `ctx.db.query.<table>`
    entry or a `select`, `update` or `delete` builder kept across a schema
    reload is refused a table the plugin may no longer reach, not only when it
    is built. `ctx.db.select()` builders are immutable: `where`, `orderBy`,
    `limit` and `offset` return a new builder, and `first()` leaves its builder
    unchanged.

  This corrects the earlier release note that said a plugin declaring `rawSql`
  gets the live Drizzle instance at `ctx.db`: the live instance is at
  `ctx.db.raw`, and only once the app lists the plugin in `db.rawSqlPlugins`.

  ## Added
  - `ctx.dialect` (`@experimental`) says which database the installation runs
    on, for the cases a plugin cannot be dialect-blind, such as reading a
    driver's error.
  - `ctx.db.transaction` runs through the adapter's transaction on every
    dialect; what the work throws reaches the plugin as thrown, and on SQLite a
    core service called inside joins it as a savepoint whose after-commit
    effects wait for the commit.
  - `ctx.db.query.<table>.findMany({ with })` runs relational queries over the
    tables `ctx.db` may reach.
  - `ctx.db.insert` and `insertReturning` take `PluginInsert<T>`: the table's
    `InferInsert` with its `col.id()` key optional, because `ctx.db` fills a
    UUIDv7 when the caller leaves it out. `InferInsert` still requires the key
    for code writing a plugin table through its own Drizzle table.
  - `TransactionContext.drizzleWithRelations(relations)` in
    `@nextlyhq/adapter-drizzle`: a relations-enabled Drizzle instance on the
    transaction's own connection, memoized per relations object, so
    `ctx.db.query` inside `ctx.db.transaction` sees the transaction's
    uncommitted writes. The three bundled adapters implement it; an adapter
    maintained outside this repository adds it to its transaction context.
  - New experimental types, from `nextly` and `@nextlyhq/plugin-sdk`:
    `PluginConfig`, `PluginSummary`, `PluginEmailSettings`, `PluginUserService`,
    `PluginMediaService`, `PluginEmailService`, `PluginVersionsService`,
    `PluginCollectionTransaction`, `PluginInsert`, and `FrozenCopy` and
    `FrozenValue`, which type `ctx.config`, so a plugin's declaration files can
    name them.
  - `createTestNextly` takes a `pluginConsent` option (`@experimental`), the
    test's counterpart of `db.rawSqlPlugins`, and its refusal of a plugin that
    declares `rawSql` names the option and the value to pass.

  Full details: `docs/plugins/services.mdx` and `docs/plugins/security.mdx`.

- [#2180](https://github.com/nextlyhq/nextly/pull/2180) [`5e42de7`](https://github.com/nextlyhq/nextly/commit/5e42de7fce3a95c81501e26eaa31cc5fba0e2f8b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Customising the dashboard opens a bar that stays at the top of the page while
  you scroll, with Add widget, Reset, Cancel and Save, a note when you have
  unsaved changes, and the reason inside it when a save does not go through, with
  Try again or Reload. Focus moves to the bar when you start and back to Customize
  when you finish, and each step is announced to screen readers. While you
  customise, the cards' own links and buttons are dimmed and out of reach, so a
  click or Tab goes to the card controls instead.

  Leaving the dashboard with unsaved changes asks first, with Save Changes,
  Discard Changes and Keep Editing. Saving from there leaves only once the save
  has gone through; if it fails, or the dashboard changed elsewhere, you stay with
  your changes kept. The entry and Single editors keep their own prompt.

  Confirming that you want to leave after pressing Back now actually leaves.
  This applies everywhere that asks before you leave with unsaved changes: the
  entry and Single editors, document views and the dashboard. Before, confirming
  discarded your changes and kept you on the page. Back and Forward now also hold
  the page until you answer, and Forward goes where you were headed instead of
  one page further.

- [#2103](https://github.com/nextlyhq/nextly/pull/2103) [`a3d2ed7`](https://github.com/nextlyhq/nextly/commit/a3d2ed715cb51ff86779e32f47ef4ff291918982) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget can be declared once with `defineWidget()` and contributed by a
  plugin under `contributes.dashboard`. Both are exported from `nextly` as
  experimental, with the setting builders as `widgetSettings` and the types
  a widget's component is written against.

  Startup checks every declared widget as it receives it, a plain
  JavaScript plugin's included, and stops on any fault, all of them listed
  in one message naming the plugin, the widget and what to change. Once the
  site's content is synced, it also checks each widget's starting query:
  startup stops over a field missing from a collection the code defines,
  and warns, without stopping, over content the database alone holds.

  Declared widgets are not yet offered on the dashboard: they are checked
  and kept on the server, and appear once core can draw them. Widgets
  contributed in today's shape keep working as before; two plugins sharing
  an id now log a warning, and an id shared with a declared widget stops
  startup.

- [#2001](https://github.com/nextlyhq/nextly/pull/2001) [`612e8b3`](https://github.com/nextlyhq/nextly/commit/612e8b33d9e2959c8d6746359b3fd05c632e2dba) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The compound indexes a collection declares (`indexes` in `defineCollection`)
  now reach development push, not only `migrate:create`.

  A hot reload, `nextly db:sync` and the boot that creates a missing collection
  table all built the collection without its declared indexes. So a dev push
  never created one, a declared unique index enforced nothing, and on a database
  where a migration had created the index the next push planned to drop it; on
  SQLite a table rebuild lost it outright. The boot drift warning and the schema
  preview read the collection the same way, so they reported a migration-created
  index as a change. Each of them now carries the declared indexes, and an edit
  that only adds or removes one is applied by the next reload.

  The schema preview (the admin's confirm step and the boot drift warning) now
  builds the schema it compares from the same function as the apply, with the
  tables plugins and the app declare and what schema hooks add to entity tables.
  It used to leave those out, so it showed a hook-contributed column as one to
  drop and a declared table as nothing to create, neither of which the apply
  does.

- [#2024](https://github.com/nextlyhq/nextly/pull/2024) [`684bf04`](https://github.com/nextlyhq/nextly/commit/684bf046fbca51c4cecf09bc62846ae5501658d4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin can write and read a `json` column of its own table through `ctx.db`
  on SQLite.

  The column was built as plain text, so the value reached the SQLite driver as
  an object, which it refuses, and a value stored another way read back as a
  string. It now reads and writes the value itself, as on PostgreSQL and MySQL.
  The column in the database is unchanged.

- [#2236](https://github.com/nextlyhq/nextly/pull/2236) [`9a94294`](https://github.com/nextlyhq/nextly/commit/9a94294831de5d3ee20be0faab0c4ac104b28790) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting a collection or a Single deletes its registry row before it sweeps
  the entity's autosaves and version pins, on every deletion path. A pin locks
  that row first, so the two now take the same lock in the same order: a pin
  under way when its entity is deleted no longer outlives it, and a pin moving
  a slot no longer deadlocks with the deletion.

- [#2110](https://github.com/nextlyhq/nextly/pull/2110) [`47c601c`](https://github.com/nextlyhq/nextly/commit/47c601c62078d8068c881dd4e8633aa199d292d5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The npm pages of create-nextly-app and @nextlyhq/plugin-mcp describe what ships today: the CLI's usage data is collected under a random ID, and the MCP plugin is experimental, off by default and read-only, with one tool.

- [#2048](https://github.com/nextlyhq/nextly/pull/2048) [`6da6a14`](https://github.com/nextlyhq/nextly/commit/6da6a1475dc4133bf6fa36493934dfad7e9e5a23) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Direct API's collection gate now gives a signed-in caller the same answer as
  the REST route and a relationship in a setup that registers no access-control
  service: the caller's own database grants decide. Before, that gate admitted
  the caller outright, so a row refused through REST or a relationship was served
  by the Direct API. An app booted through `getNextly` always registers the
  service, so it is unaffected.

  A read now judges each related collection once for the whole read, its
  components included. Before, every component instance relating to one target
  asked again, so a read with many instances repeated the same permission lookup.
  Which rows a caller receives does not change.

- [#2149](https://github.com/nextlyhq/nextly/pull/2149) [`e19c50c`](https://github.com/nextlyhq/nextly/commit/e19c50c22c343d26c775f45dcb2b0c61bbf17032) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Document views keep unsaved work in three more cases.
  - Moving from a document with unsaved changes to a field-type view it has no
    top-level field for now asks before leaving. That address shows "not found",
    which unmounts the form, and the work was lost without a prompt.
  - Leaving a view for its document no longer switches the leave guard off for a
    moment, so a click straight after the exit still asks about unsaved changes.
  - Restoring recovered work mounts the view again, so a view that keeps its own
    copy of the document, as the Page Builder does, shows and saves the restored
    work rather than what it held.

  Startup also refuses a document view whose `label` is not text, which would
  otherwise fail every admin metadata response rather than the one view.

- [#2144](https://github.com/nextlyhq/nextly/pull/2144) [`5abf993`](https://github.com/nextlyhq/nextly/commit/5abf993d28f9fb788c7994ea0278cfc27284a73e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A duplicate key raised by a query that runs through Drizzle is now classified
  as a unique violation on MySQL and PostgreSQL, as it already was on SQLite.
  Drizzle wraps the driver's error, and the classifier read only the wrapper,
  so the error's `kind` was `unknown` and code that recovers from a duplicate
  key did not recognise it.

- [#2089](https://github.com/nextlyhq/nextly/pull/2089) [`54fc42e`](https://github.com/nextlyhq/nextly/commit/54fc42e73ef618679d2bcbcb239c73df13a3d1c3) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Deactivating an account, or an administrator setting its password, now ends
  the access tokens it already holds within ten seconds, wherever a session is
  read: `getSession` and `requireAuth`, `GET /auth/session`, `/api/auth/state`,
  a plugin's `ctx.auth.currentUser`, and the admin API. That includes the
  thirty-day token from the Direct API's `nextly.login()`. Before, a token
  stayed valid until it expired. A person changing or resetting their own
  password ends their other sessions the same way.

  Each access token carries the account's session epoch, a new nullable
  `users.session_epoch` column that the write ending the account's sessions
  raises. Each read checks the token against the row, which is cached for five
  seconds per account per process. A token for an account that no longer
  exists, or is not active, is refused too. Run `nextly migrate` to add the
  column to an existing database; no row is rewritten. Tokens issued before
  the upgrade keep working until the account's next change.

  Because a session read now checks the database, `getSession` and
  `requireAuth` from `nextly/auth` need Nextly initialised in the process. In
  your own route, call `await getNextly({ config })` before reading the
  session, or initialise Nextly in `instrumentation.ts` with
  `createRegister(config)`. Nextly's own routes start it themselves. A session
  read in a process where Nextly has not been initialised fails with an
  internal error, and the server log names this fix. The blog template's seed
  routes do this now.

  `buildClaims` takes an optional `sessionEpoch`. Left out, it is zero, so a
  token built that way works until the account's sessions are first ended.
  `AccountState` now carries the account's `email`, `name`, `image` and
  `sessionEpoch`. If you assemble `AuthRouterDeps` yourself, your
  `fetchAccountState` and the session-row `lockAccountState` must return those
  fields from the user row, and `setInitialPassword` must return the
  `sessionEpoch` its write left beside `passwordUpdatedAt`. Until they do, no
  session is issued from them, and the log names what is missing. A
  `findUserByEmail` that does not return `sessionEpoch` keeps working: the
  sign-in then judges against the epoch its own account read finds.

  A session's `email`, `name` and `image` claims now come from the account the
  sign-in checked, not from the user an `afterAuthenticate` hook returned.

- [#2250](https://github.com/nextlyhq/nextly/pull/2250) [`1e66080`](https://github.com/nextlyhq/nextly/commit/1e66080378a44e6fa5b0970d75f7242ce4a1dcd5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an app reads and writes its env files the way Next.js does.
  - A `$` in a database URL you type is written as `\$`, so Next.js keeps it instead of expanding it away.
  - References such as `$NAME` and `${NAME:-default}` are expanded by dotenv-expand 10.0.0, the version Next.js 16.3 bundles, so a value is read as the app gets it: single-quoted values are expanded too, a default wins over the file's own value, and `${NAME-text}` is left as Next.js leaves it. The app's values never reach the process environment the CLI's own commands inherit.
  - A lone carriage return ends a line, and a quote right after a backslash stays inside the value, as dotenv reads them.
  - A `DB_DIALECT` read from another variable is treated as unknown, since the environment the app runs in can set that variable differently; no database URL is added beside it. An empty `DB_DIALECT` counts as unset, as the runtime treats it, so the chosen database URL is added.
  - `.env`, `.env.example` and `.gitignore` are created exclusively. A file that appears while the generator runs is merged into, and it is checked again first, so a link that appeared is left alone. Only "absent" counts as absent: any other failure to look at a file stops the run.
  - In `.env.example`, a credential is flagged even when it contains a placeholder word, when it is the fallback in `${NAME:-value}`, or when it is a `?password=` in the database URL.
  - `.env` counts as ignored by git only through a `.gitignore` in its folder or a folder above it inside the repository, not through an excludes file that happens to be named `.gitignore`.

- [#2150](https://github.com/nextlyhq/nextly/pull/2150) [`332464a`](https://github.com/nextlyhq/nextly/commit/332464ab7cba67b7db197ecd528678c229f94dcd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The env files `create-nextly-app` writes no longer leak the secret, and no longer replace what an app already has.
  - `.env.example`, which a template project commits, now carries an empty `NEXTLY_SECRET` and the database's generic example URL. It used to carry the same secret as `.env`, and a database URL typed during setup, password included. An empty secret is refused in production, so a copied example cannot run a deployment. The base template's own example file had a 34-character placeholder, long enough to pass that check, and an unfilled `{{storageEnvVars}}` line; both are gone.
  - An existing `.env` or `.env.example` is never replaced. Every line stays, and only the keys Nextly needs that the file lacks are added, under a marked block. An existing `.env` that had `DATABASE_URL` used to get nothing at all, so production answered 500 for the missing secret. Which keys a file has is read line by line, so `export KEY=`, quoted values, a key named only in a comment and a similarly named variable are told apart.
  - `DB_DIALECT` and `DATABASE_URL` are one setting. A file that already has its `DATABASE_URL` gets no `DB_DIALECT`, since Nextly reads the database from the URL, and the run asks to check it is the chosen database's. A file whose `DB_DIALECT` names another database, or a spelling Nextly refuses, gets no URL beside it, and the run says so. Scaffolding over a folder that has files keeps its `.env.example`, which the env step then extends.
  - Values are read as Next.js reads them: `$NAME` references expand, and a value that refers to a variable set only where the app runs is not judged. A `DATABASE_URL` that is not a URL is reported.
  - The generated secret and a typed database password go into `.env` only once it is known to stay out of git, settled before anything is written. When only this machine's excludes ignore it, or the project re-includes it, `.env` is added to `.gitignore`. When `.gitignore` is a link (left as it is, with the line to add), when git tracks `.env`, or when git cannot say whether it does, the secrets are withheld and the run says what to do; development runs without the secret. A linked `.env` or `.env.example` is left as it is, with the keys to add listed.
  - A value the app already had and Nextly cannot use, or a real-looking secret or database password in an example file, is left as it is and reported, naming the file and key and never printing the value. The run now lists what it wrote and what it added.

  A project made with an earlier version should check whether its `.env.example` was committed holding a real `NEXTLY_SECRET` or database password. If it was, empty them there, and replace the secret and password themselves.

- [#2118](https://github.com/nextlyhq/nextly/pull/2118) [`9e59e71`](https://github.com/nextlyhq/nextly/commit/9e59e714ed73a037c210cf9cb2b15ba2d180b15f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every dashboard card now wears one frame, with the same five states and one number format.

  The frame draws each card's title as one `h2`, an optional description line, the body, at most
  one footer link and when its data last arrived. While data has never arrived it shows a skeleton
  shaped like the card's body; while it refreshes it keeps the last value and marks the card busy;
  an empty card says what will appear there; a card whose source is not available to the reader
  says so in one fixed wording; and a card whose data failed keeps its title and offers Retry,
  which asks that card's question again on its own. In customise mode the card's content stays
  visible but out of reach, and the title appears once.

  Collections, Singles and Team now draw inside the frame too, rather than as sections with their
  own headings, loading and error states.

  `@nextlyhq/ui/format` is a new server-safe, `@experimental` entry point: `formatCount` and
  `formatChange`, the one formatter every figure on a card goes through, in the admin's locale.
  Values from 1,000 compact ("1.2k") only in a card's small size tier, a floor reads "N+", the
  accessible name is always the full value, and a change carries an arrow and a sign.

  A failed widget slot may carry `code: "unavailable"`, which the admin shows as the
  "not available" state instead of an error.

- [#2038](https://github.com/nextlyhq/nextly/pull/2038) [`2569fb4`](https://github.com/nextlyhq/nextly/commit/2569fb468234701e974e1e6e467b238a09da2c11) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every raw password is now stored hashed, whatever it looks like. Creating an account
  decided from a password's shape whether it was already a hash, and stored one of 32
  characters or more containing a colon as given, in plain text. Self-registration, the
  admin, the Direct API, plugins and setup all reached it.

  A password given to create an account is always hashed. A value that is already a hash
  is taken only by the write meant for one (`PATCH /api/users/:id/password`), which now
  refuses anything that is not a hash. Sign-in refuses a stored value that is not a hash,
  without comparing it; no such value ever matched a password, so no working sign-in is
  lost. A ready-made hash given to account creation is hashed again, as it already was.

- [#2142](https://github.com/nextlyhq/nextly/pull/2142) [`a64a46d`](https://github.com/nextlyhq/nextly/commit/a64a46dc94b86a9b58e9457dc8519da73a5e73ce) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every save of a working draft is now kept in the history. Saving a published
  document held the edit in one working draft that each save overwrote, credited
  to whoever saved last, so earlier saves and their authors were lost. Each save
  now also records a draft version, credited to the person who saved it, within
  the same `versions.maxPerDoc` limit. A save that changes nothing records no
  version, and autosaves still never appear in the history. Restoring one of
  these versions puts its content back as the working draft and never publishes
  or unpublishes the document.

- [#2192](https://github.com/nextlyhq/nextly/pull/2192) [`12c7d4d`](https://github.com/nextlyhq/nextly/commit/12c7d4ddde46c01d253a153e96ae57d1ca406f09) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every case-insensitive text search now ignores case on PostgreSQL, MySQL and SQLite,
  even under a case-sensitive collation, and matches what was typed literally: a collection's
  `contains` and `search` filters, its search box, and the admin's search of collections, Singles
  and field groups. On MySQL these followed the column's collation, so under `utf8mb4_bin` they
  were case-sensitive; on SQLite a typed `%` or `_` never matched; and the admin's search read a
  typed `%` or `_` as a wildcard. They now all use one rule, published as
  `caseInsensitiveContains` from `@nextlyhq/adapter-drizzle/text-match` (experimental).

- [#2262](https://github.com/nextlyhq/nextly/pull/2262) [`75c0bab`](https://github.com/nextlyhq/nextly/commit/75c0babb41e062dec1cf6819ebb71819ea3935fc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing app reads every route template it writes from before installing or writing anything, so a missing or incomplete `--local-template` stops the run with the app untouched and names the file. A media route is left unwritten, with the reason and the content to add, beside any child route that Next.js would refuse or would match first: another catch-all, a single dynamic segment, or a concrete path, which could take requests Nextly serves. An app that sets `pageExtensions` is told the name to create each of Nextly's routes and admin files under, rather than getting files Next.js never serves. In the Pages Router check, a single dynamic page counts only at the URL's last part, and only an `index` page answers a folder's URL.

- [#1890](https://github.com/nextlyhq/nextly/pull/1890) [`9225d83`](https://github.com/nextlyhq/nextly/commit/9225d83bcf412df81cda8b841fceb3725e13c6d6) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Three field-editor fixes:

  The form builder's field list was keyed by the field's name, and the Field
  Name input rewrites that name on every keystroke — so each character
  unmounted the card being edited and focus fell out of the input, forcing the
  author to click back in before every next character. Card keys are now minted
  by the list and follow the field through a rename, so renaming a field keeps
  its card, and the input's focus, in place.

  The Schema Builder translated a Label into its auto-derived Name one
  character at a time: every space, apostrophe, period or colon became its own
  underscore, so a label of "phone no." named the field `phone_no_`. The
  derivation now follows the formatting rule the builder's other name and slug
  derivations already apply — a run of anything that is not a letter or a digit
  collapses to one underscore, and nothing dangles at either end. The rule is
  for labels only: a stored name the server already accepts passes through
  every save untouched (its legal underscore runs and trailing underscore are
  identity, not noise), a name minted under the previous rule still follows its
  label, and renaming a form field keeps the card open through the empty
  intermediate value of a clear-and-retype.

  A Code field's content could overflow its box: field rows lay fields on
  proportional grid tracks, and a bare `Nfr` track honors an item's
  min-content — which a Code field makes as wide as its longest unwrapped
  line, since CodeMirror draws its document with `white-space: pre`. Each row
  item's automatic minimum is now zeroed, so tracks keep their proportional
  width and a long line scrolls inside CodeMirror's own scroller instead of
  widening the page.

- [#2198](https://github.com/nextlyhq/nextly/pull/2198) [`5a401d3`](https://github.com/nextlyhq/nextly/commit/5a401d3b812480b7fe23f40ea224b90d365f53f4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A `contains` or `search` filter on a field group's field, such as
  `seo.metaTitle`, now matches the text as typed, ignoring case on every
  database, as every other case-insensitive search does. It had kept its own
  matching, where a typed `_` or `%` read as a wildcard, so `a_b` also found
  `axb`.

- [#2035](https://github.com/nextlyhq/nextly/pull/2035) [`f6b92ff`](https://github.com/nextlyhq/nextly/commit/f6b92ff3208d6d291284310f6cd306ed24615b21) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A field group's generated names are now held to 63 bytes once encoded as
  UTF-8, as PostgreSQL counts them, rather than 63 characters. A field name with
  letters outside ASCII could produce an index name within 63 characters and past
  63 bytes, which PostgreSQL would cut short and store under a name nothing else
  uses. Such a create is now refused before any statement runs, naming the
  identifier and its length in bytes. Names of plain ASCII are bounded exactly as
  before. The limit is the one every other derived schema name uses.

- [#2207](https://github.com/nextlyhq/nextly/pull/2207) [`2b43000`](https://github.com/nextlyhq/nextly/commit/2b43000b04e55ba09ec1d6691ba2e9a83a4f0245) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A translated field made shared in code now keeps its content through
  `nextly migrate:create`. Until now the migration only added the shared
  column, empty, and left every language in a translated column that nothing
  dropped or read again. `migrate:create` now writes two more files around
  the main migration. The first writes the other languages to the
  localization archive before anything changes. The second copies the
  default language's value into the new shared column and removes the
  translated column. Rolling back with `nextly migrate:down` puts the
  translated field back, every language included, and every file is safe to
  run again.

  The same rule as the Schema Builder refuses, at `migrate:create`, a field
  that stops being translated while it is `required`, `unique` or covered by
  a unique index, or while it also changes type, and names the steps that
  work. The type it is stored in now is read from the migration history,
  which records each translated column; a field no migration file describes
  is reported instead.

  `nextly migrate --dry-run` now prints the SQL each pending file would run,
  as `migrate:down --dry-run` already does for a rollback.

  On MySQL, a failed file of this kind is refused rather than run again, as
  before, and the refusal now names the file and columns and says how to tell
  whether the drop landed.

- [#2139](https://github.com/nextlyhq/nextly/pull/2139) [`3ec673e`](https://github.com/nextlyhq/nextly/commit/3ec673e41723675a4f4c7c025cc8fbac41458a87) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Breaking (`@nextlyhq/plugin-form-builder`):** the plugin no longer has webhook senders of its own. Nothing called them; a submission reaches other systems through Nextly's `form.submission.created` webhook.

  Removed exports: `triggerWebhooks`, `fireWebhooks`, `isValidWebhookUrl`, `getSupportedWebhookEvents`, and the types `WebhookPayload`, `TriggerWebhooksOptions`, `WebhookDeliveryResult`, `TriggerWebhooksResult`, `WebhookConfig` and `WebhookEvent`.

  Removed option: `notifications.webhooks` on a form config, and `webhooks` on `FormDocument`. The plugin never read it, so it sent nothing. A config that still sets it now logs a warning naming the replacement, from `createFormConfig`, `applyFormDefaults` and `validateFormConfig`. Stored forms are not changed.

  To be told about new submissions, subscribe an endpoint to the core event instead. There is no replacement for `submission.updated` or `submission.deleted`: the submissions collection sends no events when a submission is edited or deleted, because they would carry its answers.

  ```ts
  // Before: accepted, and never sent
  createFormConfig("contact", fields, {
    notifications: {
      enabled: true,
      recipients: [{ email: "team@example.com" }],
      webhooks: [
        { url: "https://crm.example.com/hook", events: ["submission.created"] },
      ],
    },
  });

  // After: an endpoint on Nextly's webhooks (admin, Settings → Webhooks), subscribed to
  // `form.submission.created`. Its payload names the submission (`resource.id`); read the
  // answers over REST: GET /api/collections/form-submissions/entries/{id}
  ```

- [#2133](https://github.com/nextlyhq/nextly/pull/2133) [`a6dffe0`](https://github.com/nextlyhq/nextly/commit/a6dffe0764584d237f14a3f615d6debe9160bb69) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly generate:types` now writes files that compile in the app it writes them
  into, whichever package manager installed it.
  - Generated Zod schemas import `z` from `nextly/zod`, a new entry that
    re-exports the Zod Nextly itself depends on, instead of from `zod`. An app
    depends on `nextly` but need not depend on `zod`, and under pnpm or Yarn
    Plug'n'Play a bare `zod` import did not resolve there, so the schemas failed
    to compile ("Cannot find module 'zod'"). To combine generated schemas with
    your own Zod code, import `z` from `nextly/zod` as well, so both use one Zod
    instance. `nextly/zod` is a stable entry.
  - The generated types file imports `nextly` itself (type-only, erased from every
    build) before augmenting it. An app that imported only subpaths such as
    `nextly/config` got "Invalid module name in augmentation, module 'nextly'
    cannot be found" (TS2664).
  - In an app without a `src/` folder, the types file and the schemas go to
    `types/generated/` and `db/schemas/collections/zod/` rather than into a new
    `src/` folder, while `typescript.outputFile` and `db.schemasDir` are left at
    their defaults. A path you set is used as written.
  - A relationship or upload field pointing at a built-in collection is typed
    with a type the file has: `users` as the generated `User`, and `media` as
    `MediaFile`, imported from `nextly` (the type `nextly.media.findByID`
    returns). They were typed as `Users` and `Media`, which nothing declared, so
    any app with such a field failed to compile once its types were generated. A
    collection you define with one of those slugs keeps its own interface.
  - The blog template's featured-image alt text check reads the image through
    `nextly.media.findByID`, and refuses the save when the image cannot be read
    or no longer exists, rather than letting the post through unchecked.
  - `create-nextly-app`, adding Nextly to an existing app without `src/`, now
    writes `typescript.outputFile` as `./types/generated/nextly-types.ts` instead
    of a `./src/...` path, so the types land beside the rest of the app.

  An app made with an earlier release: run `nextly generate:types` again. In an
  app without `src/`, the files previously written under `src/` can be deleted.

- [#2206](https://github.com/nextlyhq/nextly/pull/2206) [`b7a1ddc`](https://github.com/nextlyhq/nextly/commit/b7a1ddc13a9ade0e7430a4b8a2aabfc10c0fb09c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The generated types file Nextly writes when `typescript.outputFile` is not set is now `src/types/generated/nextly-types.ts`, named for Nextly, instead of `payload-types.ts`. The CLI help names it.

  If your config doesn't set `typescript.outputFile` and still has the `payload-types.ts` an earlier version generated, `nextly generate:types`, `nextly build` and `nextly db:sync --types` write `nextly-types.ts` and turn `payload-types.ts` into a one-line re-export of it. Existing imports keep compiling, and only one file declares the generated types, which TypeScript needs. The command tells you when it does this. Change imports of `payload-types` to `nextly-types`, then delete the old file; a later release stops keeping it. A `payload-types.ts` that Nextly did not generate is left as it is, with a warning. To keep the old name, set `typescript.outputFile` to it.

- [#2179](https://github.com/nextlyhq/nextly/pull/2179) [`fb869f8`](https://github.com/nextlyhq/nextly/commit/fb869f8ce38113ca85f490faf3d79e2b72db7c5b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Generated types compile in more of the apps they are written into, and Nextly's own setup paths follow the app's layout.
  - A relationship or upload field pointing at a built-in collection is typed with a type the file has: `users` as the generated `User`, and `media` as `MediaFile`, imported from `nextly` (the type `nextly.media.findByID` returns). It was typed as `Users` or `Media`, which nothing declared, so an app with such a field stopped compiling once its types were generated. A collection you define with one of those slugs keeps its own interface, and when your config declares its own `MediaFile`, the built-in one is imported as `NextlyMediaFile`.
  - `nextly init` in an app without `src/` writes its folders, its `nextly.config.ts` paths and `lib/nextly.ts` at the root, where generation writes too, instead of creating a `src/` tree beside the root `app/`.
  - A project made from the blog template declares `@nextlyhq/plugin-sdk`, the form builder's peer. Yarn installs no missing peer, so under Plug'n'Play the form builder could not load it and the config failed to load.
  - The blog template's featured-image alt text check reads the image through `nextly.media.findByID`, and refuses the save when the image cannot be read or no longer exists, rather than letting the post through unchecked.

- [#2212](https://github.com/nextlyhq/nextly/pull/2212) [`de3b862`](https://github.com/nextlyhq/nextly/commit/de3b8625f3420ffeae51ab634faa002d902af1e6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - History applies every field read rule. A version read, a comparison and a
  restore now judge the field-level `access.read` rules declared on a
  component's own fields, on each instance the version holds and at any depth,
  alongside the entity's own rules. An API key is judged on its own grants
  rather than its owner's.

  A version read lists what it held back in a new `withheld` field (a field
  name, or a dotted path such as `banner.secret`), and a comparison shows such
  a field as `hidden` in its place, inside components too. History fails
  closed: if the rules cannot be evaluated, a version read withholds every
  field that carries one and names it, and a restore is refused (`FORBIDDEN`)
  instead of being applied unfiltered.

- [#2132](https://github.com/nextlyhq/nextly/pull/2132) [`7c95265`](https://github.com/nextlyhq/nextly/commit/7c95265fbb709eac6a3b11954cea15b927af3644) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Three fixes in the admin's version history:
  - A version with no recorded author reads "Author not recorded", and one whose
    recorded author can no longer be named reads "Author unavailable", instead of
    "Unknown author" for both, in the history panel and on the comparison page.
  - A comparison page honours the language its address names: it lists that
    language's versions (and the shared ones), for Singles as for entries.
  - The editors record recovery points at the interval a collection or Single
    configures (`versions.drafts.autosave.intervalMs`), instead of a fixed two
    seconds. An interval longer than a browser timer can hold keeps the default.

- [#2270](https://github.com/nextlyhq/nextly/pull/2270) [`9bc8e7e`](https://github.com/nextlyhq/nextly/commit/9bc8e7e336e985f17bc93fe2d6d1dd479d00eb96) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A history page now finds where each language was last looked at in one
  read, however many languages the document has, rather than one read per
  language. A history list or comparison refused at the route gate is marked
  `private, no-store` and varies on the caller's credentials, as its answer
  already was, so a shared cache cannot replay one person's refusal to
  another.

- [#2229](https://github.com/nextlyhq/nextly/pull/2229) [`73838d3`](https://github.com/nextlyhq/nextly/commit/73838d3bc9f326f271ab8fbc4b03b49cfe25ea36) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A version comparison marks itself incomplete when any withheld field is
  nested, in a group, a repeater row or a component, not only at the top level,
  including in a changes-only comparison. And the history read rules walk a
  layout container whose fields reach itself once, rather than looping until
  the read fails.

- [#2223](https://github.com/nextlyhq/nextly/pull/2223) [`d6a1ff8`](https://github.com/nextlyhq/nextly/commit/d6a1ff843aa48ca2f790d4db293393462005c74d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an app that sets `pageExtensions` now names the server-start
  hook it asks you to create after one of those extensions, such as
  `src/instrumentation.page.tsx`. It used to name `src/instrumentation.ts`, a
  file Next.js does not load in such an app. When the extensions are not
  written out as a list in the config, the advice says to use one of them rather
  than naming a file.

- [#2244](https://github.com/nextlyhq/nextly/pull/2244) [`fa7b3f3`](https://github.com/nextlyhq/nextly/commit/fa7b3f3f94a0f8b86b046cfc90bd75a964bb74d1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an app that sets `pageExtensions` now looks for the app's
  server-start hook only under the names Next.js loads in such an app, so a
  default-named `instrumentation.ts` beside `instrumentation.page.tsx` is no
  longer taken for the hook. It also no longer asks for a `.cjs` hook, which
  cannot hold the ES module the hook is. When none of the app's page
  extensions can hold the hook, it says to add a JavaScript or TypeScript one
  first, rather than naming a file Next.js would not load.

- [#2022](https://github.com/nextlyhq/nextly/pull/2022) [`f48d96e`](https://github.com/nextlyhq/nextly/commit/f48d96e2e7a1c42b69808f3e7877d2b3a5fbda4d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A name a plugin's or the app's table declares (a table, a column, an explicit
  index or foreign key) is now held to 63 bytes of UTF-8 rather than 63
  characters, and derived index, key and check names are shortened at the same
  bound. PostgreSQL's limit is in bytes, so a name with letters outside ASCII
  passed the old check and was cut short on PostgreSQL, under a name nothing
  declared. Names of plain ASCII are unchanged.

- [#2026](https://github.com/nextlyhq/nextly/pull/2026) [`8ce9f7e`](https://github.com/nextlyhq/nextly/commit/8ce9f7eabe101bf5687e86f47a04abd0ecd89419) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `ctx.db.insertReturning` now works on a table whose key the database assigns
  (`col.serial()`). It returns the inserted row with the key the database chose,
  read from the insert's own result on every dialect, so inserts that overlap each
  get their own row back. Before, it refused such a table.

- [#2063](https://github.com/nextlyhq/nextly/pull/2063) [`bdfd1ce`](https://github.com/nextlyhq/nextly/commit/bdfd1ce5f1e5c74cdde960e96f46625fec27b3a6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A limit store that every instance can share, selected by `rateLimit.store: "memory" | "database"`, for limits built on the new limit store contract. Core's own sign-in and API limits keep counting as before for now. Memory stays the default, and `rateLimit.singleInstance: true` says a site runs one instance. Each store holds a bounded number of live entries (`rateLimit.maxEntries`). It warns as it fills, and never drops a live count to make room. An app can supply its own store through the `@experimental` `LimitStore` contract, and check it against `limitStoreContract` from `nextly/testing`. An app's store of the earlier `RateLimitStore` contract keeps serving core's own limits. The database store adds the `nextly_limit_store` table, which reaches existing databases through `nextly migrate`.

- [#2080](https://github.com/nextlyhq/nextly/pull/2080) [`8a5bf08`](https://github.com/nextlyhq/nextly/commit/8a5bf084b4f5d79142afd41152b3c3e4a217091c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The limit store and the plugin limiter tighten what they promise.
  - A plugin limiter reservation now carries `epochs`, which run of each entry counted it, and `release` gives back only to that run. So a count made before a `reset`, even in the same millisecond, has nothing to give back. An entry remembers the releases it gave, and when it must let the oldest go to stay within its size, it refuses anything counted that early rather than give it back twice: at worst a client waits out a count it might have had back. (`AdmittedReservation` is `@experimental`; one built by hand needs `epochs` now.)
  - A key holding a lone surrogate is refused by every limit store and by `ctx.limits`, since it would encode, and count, as another key.
  - An empty `NEXTLY_SECRET` names a database limit store generation of its own, apart from no secret, as the install's other secret-derived values judge it.
  - The "filling" warning is judged on what a store holds: the memory store after any sweep, and the database store only once an update has committed.
  - The exported `limitStoreContract` runs a store with `shared: false`, given each instance's own, through its cross-instance cases on one handle (each case is now marked `acrossInstances`). Its sweep case also requires a second sweep to find nothing left.

- [#2191](https://github.com/nextlyhq/nextly/pull/2191) [`aefdad6`](https://github.com/nextlyhq/nextly/commit/aefdad6eef616bc8d2014dc685e496eff8c4d4c0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Locked slots mean what WordPress's `templateLock` means, and every writer is
  held to them: the editor, the API, an import or an agent. A slot's lock is
  measured against the blocks the slot starts with (its `defaultBlock`):
  - `insert`: blocks cannot be added or removed, but can be reordered;
  - `all`: blocks cannot be added, removed or moved, but their content and
    design stay editable;
  - `contentOnly`: only content can change. A block declares its content props
    with `role: "content"` (WordPress's spelling); its other props, its styles,
    classes, CSS id, HTML attributes, visibility, custom CSS and lock stay as the
    block started;
  - `false`: no lock.

  A slot that declares no lock inherits its parent's, `false` stops that, and
  nothing beneath `contentOnly` can loosen it. A save that breaks a lock is
  refused with the slot and the rule named, and so is a page whose component
  placement reaches past a lock inside the component, through an exposed value
  or through content it supplies to an exposed slot.

  Registration refuses a lock value outside the four, and a prop `role` other
  than `"content"`, naming the block. A block that declares no content props has
  nothing editable inside a `contentOnly` slot: declare `role: "content"` on the
  props an author should be able to change there. The core blocks declare theirs:
  a heading's text and link, a paragraph's and a rich text's text, an image's
  picture, alt text and caption, a button's label and link, a quote, a list's
  items, an embed's address and title, an accordion item's title and a form's
  submit label.

  Inside a `contentOnly` slot a save may keep any value the page already stores in
  the same place, or put it back as the block now starts; only a third value is
  refused. So changing a block's `defaultProps` doesn't lock existing pages out,
  and a page placing a component keeps what the component itself holds. A page
  saved for the first time, a single, and a localized blocks field are measured
  against the starting blocks alone. Whether a block renders is held too: a version ahead of its
  definition's, or `migrationFailed`, can't be newly set there.

  `nextly generate` refuses a slot `lock` outside the four and a prop `role`
  other than `"content"`, as registration does, so a block manifest is never
  written for blocks the app would refuse at boot.

- [#2261](https://github.com/nextlyhq/nextly/pull/2261) [`952c89a`](https://github.com/nextlyhq/nextly/commit/952c89a19d5558ec2d984fd1f603411c334d6490) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Saving a component now checks the pages that place one of its variants when
  the variant is given a new value for a field a `contentOnly` lock holds. Such a
  change alters what every page picking the variant draws without changing its
  roots, depth, exposed fields or slots, so those pages were not checked and the
  save could leave them breaking the lock.

- [#2011](https://github.com/nextlyhq/nextly/pull/2011) [`5af99e6`](https://github.com/nextlyhq/nextly/commit/5af99e6080f17f13886591faac95817fa7a41676) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On MySQL, a declared string default holding a parenthesis (`"a)b"`) no longer
  shows as a pending change on every development push.

  The schema diff reads MySQL's report of such a default, `(_utf8mb4\'a)b\')`,
  as the literal it denotes, matching it before it weighs parentheses as
  syntax; the parenthesis inside the value had kept the wrapper on.

- [#2006](https://github.com/nextlyhq/nextly/pull/2006) [`61d8b4a`](https://github.com/nextlyhq/nextly/commit/61d8b4a0d93894a40ed4a352e65a893666e408e1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On MySQL, a string column default that a plugin or the app declares
  (`col.text({ default: "none" })`) no longer shows as a pending change on every
  development push.

  drizzle-kit writes such a default in parentheses, which MySQL stores as an
  expression and reports back as `_utf8mb4\'none\'`. The schema diff now reads
  that as the literal it denotes, so a declared table reads back with no
  difference from its declaration. A value holding a backslash or a quote is
  left as reported, because what its escapes mean depends on the server's
  `sql_mode`.

- [#2193](https://github.com/nextlyhq/nextly/pull/2193) [`a714165`](https://github.com/nextlyhq/nextly/commit/a7141651aaeabe204a267366b6ef703a42033d00) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The MySQL adapter's upsert reads a table's columns through drizzle v1's
  `getColumns` in place of the deprecated `getTableColumns`. Behaviour is
  unchanged.

- [#2200](https://github.com/nextlyhq/nextly/pull/2200) [`da70ca3`](https://github.com/nextlyhq/nextly/commit/da70ca34135160744cc5265df49f947362fa414d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - New projects made with `create-nextly-app` now come with Nextly's skills for coding agents, in `.agents/skills/` for Codex, Cursor and others and as real copies in `.claude/skills/` for Claude Code. They are the skills released with this version, bundled into the CLI. The CLI asks before adding them (`-y` adds them, `--no-skills` leaves them out), and running it in an existing Next.js app offers them too. A skill folder the project already has is left as it is and reported, with the command that updates it. Plugins get none. The project's `AGENTS.md` and a new docs page, Coding agents, say how to add or update the skills. The skills are written only into a project whose `nextly` is the release they were checked against, which each skill declares in its `metadata.nextly-version`; otherwise the run names both versions and adds none.

- [#2138](https://github.com/nextlyhq/nextly/pull/2138) [`7745c53`](https://github.com/nextlyhq/nextly/commit/7745c536ede4ed877455622cae190a320114187a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - New projects get a `lint` script that runs on Next.js 16 (`eslint`, as create-next-app writes it), and `npm run lint` passes in a fresh project from every template: the theme toggle and the blog's search no longer set state inside an effect.

- [#2213](https://github.com/nextlyhq/nextly/pull/2213) [`690aed6`](https://github.com/nextlyhq/nextly/commit/690aed61277cea2406af2227a9bf6d0eb726bffb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to a Next.js 14 app now gives one `experimental` object for its
  config, holding both `instrumentationHook: true` and Nextly's
  `serverComponentsExternalPackages`. Two separate `experimental` objects were
  printed before, one per step, and pasting both as given kept only the second:
  either the hook that starts Nextly never ran, or Nextly's packages were
  bundled. An app with no Next.js config is given the whole file to create. The
  same holds when the installed Next.js version cannot be read, in the advice
  given for Next.js 14.

- [#2160](https://github.com/nextlyhq/nextly/pull/2160) [`01f2f00`](https://github.com/nextlyhq/nextly/commit/01f2f00276358d2ef616dda7c5fed802efdf3de3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - create-nextly-app leaves a Next config untouched, and prints what to add, when the file changes the config or its export anywhere other than where it is declared: a nested property set later, the config handed to a function or another name, or `module["exports"]`.

- [#2137](https://github.com/nextlyhq/nextly/pull/2137) [`2956ea2`](https://github.com/nextlyhq/nextly/commit/2956ea206c2c517185d1c2f7eb051a39bb919758) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - create-nextly-app adds Nextly's packages to a Next config that already lists `serverExternalPackages`, keeping the app's own entries, and says what it changed. A config it cannot change safely is left as it was, with exactly what to add and where.

- [#2199](https://github.com/nextlyhq/nextly/pull/2199) [`dbcd8e6`](https://github.com/nextlyhq/nextly/commit/dbcd8e64961a7ab860085455229bec064d77845d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Sign-in can no longer be locked for everyone by one visitor. Without
  `security.trustProxy`, the default, no client address can be read from a
  request, and every auth request counted in one shared bucket: thirty requests
  an hour from anyone answered every user's next sign-in, staff included, with 429.

  A request whose address cannot be resolved now counts against the account it
  names, spelled as the account lookup spells it, at the configured budget (30 an
  hour by default), whether or not that account exists. A reset, an email
  verification, an invite or a pending sign-in counts against the account its
  token belongs to; a token that belongs to nobody, or a body that names no
  address, counts in one account-less budget that no account's requests touch.
  All of them together are held to a ceiling of a hundred times the budget (3,000
  an hour by default), so inventing addresses buys no extra capacity. Someone who
  knows an address can still spend that one account's budget, and a stream at the
  ceiling's rate can still hold unresolvable sign-in shut while it runs.

  Requests whose address resolves through a trusted proxy keep their per-address
  bucket, unchanged, and a budget of 0 still turns the limiter off. The 429
  responses keep their shape and `Retry-After`.

  The password-reset and email-verification token tables gain an index on the
  token hash, which is how those tokens are looked up; until now each lookup
  read the whole table. Run `nextly migrate` to add the indexes to an existing
  database. No row is changed. A plain boot does not add them.

- [#2184](https://github.com/nextlyhq/nextly/pull/2184) [`dae7727`](https://github.com/nextlyhq/nextly/commit/dae7727dfd610ffbffd24ed98f50de42959bcef6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing Next.js 14 app with no Next config now names one file, `next.config.mjs`, both for the `instrumentationHook` opt-in and for Nextly's packages, so following the setup's advice makes one config rather than two.

- [#2228](https://github.com/nextlyhq/nextly/pull/2228) [`3afbf72`](https://github.com/nextlyhq/nextly/commit/3afbf72175575a2191474892de2b81d9b50894ff) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Password reset, email verification and invite acceptance now read their token
  through the same lookup the auth rate limit uses to tell which account a token
  belongs to, so the two cannot come to disagree about which tokens are still
  live. Nothing changes in how tokens are accepted or refused.

- [#2031](https://github.com/nextlyhq/nextly/pull/2031) [`55cbb55`](https://github.com/nextlyhq/nextly/commit/55cbb55c7c7e5500cc7bfd3d62188e76ee48cca1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Close three ways a plugin's typed `ctx.db` could reach past its checks.
  - `ctx.db.query` no longer hands out Drizzle's raw query entry through reflection, such as `Object.getOwnPropertyDescriptor(ctx.db.query, "users").value`, and an assignment to it no longer replaces an entry in the namespace core queries through. Only a table the plugin may reach is described, and only by its checked entry.
  - A method taken off the handle `ctx.db.raw.transaction` passes, such as `const insert = tx.insert`, is refused when it is called after the transaction has finished, as a property read already was.
  - The plugins a plugin may reach through `ctx.db` are read from the config in force, so a development reload that removes a dependency from `dependsOn` or `optionalDependsOn` takes away its tables without a restart.

- [#2129](https://github.com/nextlyhq/nextly/pull/2129) [`590c7bb`](https://github.com/nextlyhq/nextly/commit/590c7bb0008a50458dacb07adbda59c37f95ea28) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Every plugin now has a recorded install state, a production boot refuses a
  configured plugin that was never installed, and an uninstall that stopped
  part way is finished by running it again.

  ## Compatibility

  Upgrading a production deployment needs one step first: run
  `nextly plugins install <name>` once for each configured plugin on that
  database, before the new version boots. Until then a production boot refuses
  the plugin.

  ## Changes in behaviour
  - **A production boot refuses a configured plugin until `nextly plugins
install` has run for it on that database** (`PLUGIN_NOT_INSTALLED`),
    whether or not migrations run at boot. `nextly migrate` applies a plugin's
    modules but never runs its `onInstall`, so it does not install the
    plugin. Development warns instead. **Existing databases have no install
    record yet: before upgrading a production deployment, run
    `nextly plugins install <name>` once for each configured plugin.**
  - **After an uninstall, with or without `--keep-data`, the boot refuses the
    plugin while it is still configured, in every environment**
    (`PLUGIN_SCHEMA_UNINSTALLED`). An uninstall with `--keep-data` used to let
    the plugin boot over the tables it left.

  ## Fixes
  - **Installing a plugin is refused while a dependency was never installed
    by the install command, was uninstalled, or has an uninstall that did not
    finish** (`PLUGIN_DEPENDENCY_NOT_INSTALLED`), including a dependency that
    owns no schema. Such a dependency used to count as installed.
  - **`nextly plugins install` and `uninstall` record the plugin's state** as a
    `plugin_lifecycle` event in the migration ledger, so a plugin that owns no
    table has one too. No schema change: the ledger already holds any event
    type.
  - **An uninstall records that it has begun before its first change.** If it
    stops part way, the boot refuses the plugin (`PLUGIN_UNINSTALL_UNFINISHED`)
    until the uninstall is run again the same way, which plans over what is
    left and finishes. Run the other way, with or without `--keep-data`, it is
    refused.
  - **The install-state refusals come before boot migrations**, so a refused
    plugin's modules, or a half-uninstalled one's rolled-back modules, are not
    applied first.
  - **On MySQL, the migrate lock is held on one connection for the whole
    migration.** The lock and its release used to run on whichever pooled
    connection was free, so a release on another connection left the lock held
    until that connection closed.

- [#2027](https://github.com/nextlyhq/nextly/pull/2027) [`bad1fdd`](https://github.com/nextlyhq/nextly/commit/bad1fdd9ecb93911045276f0e485f05f4fec0660) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Plugin uninstall, entity transforms and `ctx.db.contributed` keep what they
  promise in more cases.

  ## Fixes
  - **`nextly plugins uninstall` refuses while a disabled plugin requires the
    one being uninstalled** (`PLUGIN_HAS_DEPENDENTS`). A disabled plugin still
    takes part in schema ordering, so the uninstall could not have been
    finished: removing the plugin from the config would fail the boot.
  - **An uninstall whose DOWN leaves one of the plugin's tables in place is not
    recorded as finished.** It stops with `PLUGIN_UNINSTALL_IRREVERSIBLE`
    (`tables-left-by-down`) and names the table, instead of marking the plugin
    uninstalled over it.
  - **`nextly plugins install` and `uninstall` refuse a database `nextly
migrate` has not set up yet**, naming the command to run, instead of
    failing on a missing table part way through; the connection is released
    either way. Install's summary counts the tables it recorded, not owner
    rows.
  - **The uninstall confirmation lists only elements on tables the plugin
    owns**, not other contributors' elements on a table it added an index to.
  - **A transform receives copies of `Date`, `Map` and `Set` values**, so
    mutating one no longer changes the app's own configuration.
  - **A disabled plugin's transform keeps keys named `access` in ordinary
    data**, such as a JSON default. Only entity and field access rules are put
    back.
  - **`ctx.db.contributed` returns a column authored as `__proto__`** as an own
    property instead of dropping it.

- [#2168](https://github.com/nextlyhq/nextly/pull/2168) [`e4232b0`](https://github.com/nextlyhq/nextly/commit/e4232b0b0afcf198a390f51707e80277b509fd54) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A lifecycle command's boot initialises only the plugin it is installing or
  uninstalling, and a disabled plugin is refused by install and uninstall.

  ## Changes in behaviour
  - **A lifecycle command's boot initialises only its target.** An install or an
    uninstall no longer starts the other configured plugins against a schema the
    command is changing.
  - **Install and uninstall refuse a disabled plugin** (`PLUGIN_DISABLED`). Its
    hooks do not run while it is disabled, so no installed or uninstalled record
    is written for them.

  ## Compatibility

  The schema-event type exported by `nextly/schemas` gains a `plugin_lifecycle`
  value, which records a plugin's install state in the migration ledger. Code
  that switches exhaustively over `eventType` must handle it.

- [#2071](https://github.com/nextlyhq/nextly/pull/2071) [`77ad05e`](https://github.com/nextlyhq/nextly/commit/77ad05ed4d8e79961471d4ce15b88f7edc89a315) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Plugins can make opaque secrets and one-purpose secrets with core's helpers, `ctx.security.opaque` and `ctx.security.secrets` (experimental, from `@nextlyhq/plugin-sdk`), for the people a plugin signs in itself.

  `ctx.security.opaque` makes random secrets a plugin stores only as a hash, such as its own session tokens: 32 random bytes by default and at most 1024, base64url, with a SHA-256 hash that stays the same across restarts and when the install's secret rotates, and a comparison whose time depends only on the two lengths.

  `ctx.security.secrets` mints and spends a long token for a link (1 minute to 30 days) or a short code a person types (6 to 8 digits, 1 to 60 minutes, 1 to 10 wrong tries), each for one purpose and one subject, kept within the plugin that minted it. Secrets are stored only as an HMAC under a key derived from the install's secret, and one minted under the previous secret still works while that secret is configured for reading. Spending is one conditional write in the database, so exactly one of two spends succeeds on every instance, and a code's wrong tries are counted the same way. A new code voids the earlier one. Mints, spends and voids run in the plugin's own transaction when passed `{ tx }`, and otherwise in one of their own, refused when the calling flow already has a transaction open; `consumeCode` never joins a transaction, so a rollback cannot give a wrong try back.

  The secrets live in a new core table, `nextly_one_time_secrets`, which `nextly migrate` adds to an existing database as it reconciles core's schema. A secret is removed a day after it expires, by the retention pass that writes offer and by the scheduled drain, so an install that only mints secrets still sweeps them. A subject's secrets are compared exactly on every database, case and spaces included. A subject must be well-formed Unicode, `data` must be a plain object, and `peekToken` reads through the plugin's transaction when given `{ tx }`.

  `PluginSecurityApi` gains the members `opaque` and `secrets`. A plugin receives its context from core and needs no change; a `security` member built by hand, such as in a test double, adds them.

- [#2061](https://github.com/nextlyhq/nextly/pull/2061) [`07578df`](https://github.com/nextlyhq/nextly/commit/07578dff92ee3f75793c79476d5a0c753a997f5b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Plugins can hash, verify and check passwords with core's helper, `ctx.security.passwords` (experimental, from `@nextlyhq/plugin-sdk`), for the people a plugin signs in itself.

  The helper hashes every character of a password, NFC-normalised, with scrypt from `node:crypto` (N = 2^15, r = 8, p = 3: 32 MiB a hash), and writes a string of at most 255 ASCII characters that names its algorithm and setting, so `needsRehash` can move a stored hash to a later setting at the next sign-in. A password longer than 256 code points is refused with `PasswordTooLongError`, never cut. `verify` answers false without throwing for a hash it did not write, a staff bcrypt hash among them, and spends a real verification's time when given no hash at all.

  `check` goes by length (a minimum of 8 to 64, default 8; a maximum of 64 to 256, default 128) and a shipped list of the 3,000 most common passwords, never by kinds of characters. With `breached: true` it also asks the site's breached-password source, set as `security.breachedPasswords` in `nextly.config.ts` (default: Have I Been Pwned's range service). Only a 20-bit prefix of the password's SHA-1 leaves the process, a range service is reached only over `https` and asked for padded answers, and a source that fails or is slow leaves the password unchecked. A non-https source is sent nothing, and boot warns about it. `SecurityConfigSchema` (`nextly/schemas`) accepts `breachedPasswords` too, so a configuration validated with it keeps its source.

  The helper never uses an app's `passwordHasher`, and no staff path's hashing changes. A password that is not well-formed Unicode (a lone surrogate, as JSON can carry) is refused by `hash` and `check` and never verifies.

  `PluginContext` gains a required member, `security`. A plugin receives its context from core and needs no change. Code that builds a `PluginContext` by hand, such as a test double, adds `security`; a context from `createTestNextly` (`@nextlyhq/plugin-sdk/testing`) already has it.

- [#2013](https://github.com/nextlyhq/nextly/pull/2013) [`024ab80`](https://github.com/nextlyhq/nextly/commit/024ab80657b838e91eeba77381e0cd00a9194680) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Plugin settings:
  - A value stored in plain text at a path a plugin's manifest newly marks secret
    is encrypted at boot, before any plugin's `init` runs. That includes a path
    inside a value that already held an encrypted secret, which a read or a write
    used to leave in plain text. If it cannot be encrypted, the boot fails and
    names the plugin.
  - A plugin can name one of its own permissions in
    `contributes.settingsPermission` (experimental): a settings write then takes
    that permission in place of `manage-settings`, and holding it also lets the
    operator read the settings. A name the plugin does not declare fails boot.

- [#2023](https://github.com/nextlyhq/nextly/pull/2023) [`3cc3205`](https://github.com/nextlyhq/nextly/commit/3cc3205d864d77f8a44390d1f9aed5da1b26b938) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin's own `settingsPermission` now governs its settings everywhere: on the first request after a cold start, on the admin's settings page, and in CLI commands. It must be a permission the plugin owns, and a collection's publish permission no longer qualifies. After a `NEXTLY_SECRET` rotation, the boot re-seals every plugin's stored secrets under the new secret, including those of a disabled plugin and of one that no longer declares secrets or settings, so the previous secret can then be removed.

- [#2062](https://github.com/nextlyhq/nextly/pull/2062) [`9b52955`](https://github.com/nextlyhq/nextly/commit/9b529559f61d19c170cf150fe2aa1ebd8bccae58) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Internal: core code a plugin hands the transaction handle from `ctx.db.transaction` can now write inside that transaction, committing or rolling back with the plugin's own work. A handle whose transaction has finished, or anything that is not such a handle, is refused rather than written through. No plugin-facing API changes here; the helpers that take `{ tx }` build on it.

- [#2036](https://github.com/nextlyhq/nextly/pull/2036) [`dbc00a1`](https://github.com/nextlyhq/nextly/commit/dbc00a1f5315f03b49e6aefc64c5d946ceb17c64) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin's `ctx.db.transaction` reads the plugin's dependencies from the config in force for as long as the transaction runs, as `ctx.db` does, so a development reload that removes a dependency while the transaction is open takes its tables away from the rest of that transaction too.

- [#2055](https://github.com/nextlyhq/nextly/pull/2055) [`4b2a44a`](https://github.com/nextlyhq/nextly/commit/4b2a44a485b779793b262cf56e8dc5a7b903f9fd) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A plugin uninstall whose DOWNs would leave a table is refused before
  anything runs, and a disabled plugin's transform keeps access rules at
  every level of an entity's schema.

  ## Fixes
  - **`nextly plugins uninstall` reads the DOWN statements before running
    any**, in the order they will run, and refuses a full uninstall that
    would leave one of the plugin's tables in place
    (`PLUGIN_UNINSTALL_IRREVERSIBLE`, `down-leaves-tables`), naming the table.
    Each table is followed through renames: one a SQLite rebuild drops and
    renames back, one renamed away and kept, or one whose name another table
    takes after its drop, counts as left. Only the statements a generated DOWN
    is made of are read; a DOWN holding anything else (a savepoint, a
    procedural block, a view, a temporary table, a schema-qualified name) is
    refused, as is an uninstall whose `onUninstall` dropped or renamed one of
    the tables the DOWNs were to drop. Every module stays recorded
    as applied, so the ledger still says what the plugin's schema is. Before,
    this was found only after the DOWNs had run and recorded each module
    rolled back, and the next uninstall stopped on `no-applied-module`.
  - **A table still there after the DOWNs ran** keeps the plugin from being
    recorded uninstalled (`tables-left-by-down`), as before; dropping the
    table and running the uninstall again now finishes it, and the message
    says so.
  - **A disabled plugin's transform keeps access rules wherever they sit in
    an entity's schema**, not only on the entity and on items of `fields` and
    `blocks` lists. A key named `access` under a free-form value — a field's
    `defaultValue`, `custom`, `pluginOptions`, `jsonSchema`, `filterOptions`,
    `sortOptions` or `admin.style`, or any option of a plugin's own field type
    — is data, and merges like any other key. A field the transform moves to
    another group or tab keeps its access rule.

- [#2002](https://github.com/nextlyhq/nextly/pull/2002) [`e736c38`](https://github.com/nextlyhq/nextly/commit/e736c3840892962f13cbeda016f015808136e804) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Registering services again after `clearServices()` now runs `destroy` for every
  plugin the cleared registration started, in reverse init order, before any
  plugin initialises again. The plugins used to keep running beside the second
  copy `registerServices` started, with their timers and subscriptions live.

  The plugin lifecycle docs no longer say `destroy` runs on a hot reload: a
  config hot reload re-runs neither `init` nor `destroy`.

- [#2008](https://github.com/nextlyhq/nextly/pull/2008) [`9bd3e88`](https://github.com/nextlyhq/nextly/commit/9bd3e88f32e856cd39f6fd95b2cd04fdb1042656) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Plugins can install and uninstall their schema, change other plugins'
  entities, and reach the columns they contributed.

  ## Breaking changes

  None for an existing app or plugin: everything here is new. Two behaviours to
  know before using it:
  - **A fully uninstalled plugin still listed in the config stops the boot**,
    in every environment, with `PLUGIN_SCHEMA_UNINSTALLED`. Run
    `nextly plugins install <name>` to reinstate it, or remove it from the
    config.
  - **`onInstall` and `onUninstall` are called by the CLI, never at boot.**
    `nextly plugins install` calls `onInstall` after the plugin's migrations,
    and `nextly plugins uninstall` calls `onUninstall` before its DOWN
    migrations, with `{ keepData }`. Make both idempotent: an install can be
    retried after a failure part-way through.

  ## Added
  - **`ctx.db.contributed(table, columns)`** (`@experimental`) reads and writes
    the columns a plugin contributed to a table it does not own, by row id, and
    names only those columns: `get`, `getMany` and `set`, with no insert, delete
    or free-form `where`. The app gets the same rule for the columns it
    contributed. A column on a core table arrives with the app's migrations;
    until it has, the call is refused with an error naming the column and the
    table.
  - **`contributes.transforms`** (`@experimental`) lets a plugin change
    entities another plugin or the app declared, not only add fields to them.
    `setup(config)` runs before plugin schema contributions are merged and never
    sees them; transforms run after, in dependency order, each handed a frozen
    copy. A disabled plugin's transforms keep their storage changes and drop
    their behaviour.
  - **`nextly plugins install` and `nextly plugins uninstall`** manage a
    plugin's schema, with the `onInstall` and `onUninstall` hooks
    (`@experimental`). Install applies the plugin's pending migration modules
    and refuses while a dependency is not installed
    (`PLUGIN_DEPENDENCY_NOT_INSTALLED`). Uninstall refuses while another
    enabled plugin depends on it (`PLUGIN_HAS_DEPENDENTS`) and when a migration
    cannot be undone (`PLUGIN_UNINSTALL_IRREVERSIBLE`), keeps the tables with
    `--keep-data`, and asks for `--yes` before dropping a table or running a
    DOWN that drops a column (`PLUGIN_UNINSTALL_UNCONFIRMED` without it). Each
    module's DOWN is read, judged and run the way `migrate:down --plugin` runs
    it. A development database whose plugin tables were pushed rather than
    migrated is refused, because there is no DOWN to run. To call `onInstall`
    or `onUninstall` the commands boot from the config as the app wrote it
    (`loadConfig` now also returns it, as `appConfig`), so a `setup`
    transformer that adds a plugin or a collection runs once and does not add
    it twice.

  Full details: `docs/plugins/schema.mdx`, `docs/plugins/lifecycle.mdx`,
  `docs/database/extending-the-schema.mdx` and
  `docs/guides/production-migrations.mdx`.

- [#2217](https://github.com/nextlyhq/nextly/pull/2217) [`3c81164`](https://github.com/nextlyhq/nextly/commit/3c81164927d177d9fb41113e4c2acbca4522e9eb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An app whose auth rate limit cannot read client addresses now says so. Starting
  on Vercel with `security.trustProxy` unset logs a warning that names the
  setting: Vercel's edge overwrites `x-forwarded-for` with the client's own
  address, so `security.trustProxy: true` makes client addresses resolvable there,
  and without it sign-in is limited per named account under a shared ceiling
  rather than per client.

  The first auth request that arrives with proxy client-address headers but
  still resolves no address, because `security.trustProxy` is unset or every hop
  it names is a trusted proxy, logs one warning for the process, naming
  `security.trustProxy` and `TRUSTED_PROXY_IPS`. A request whose address
  resolves, one that carries no proxy header, and any request while the limiter
  is off (a budget of 0) log nothing.

- [#2116](https://github.com/nextlyhq/nextly/pull/2116) [`e5f7271`](https://github.com/nextlyhq/nextly/commit/e5f727192c7cec8ee04dda41a71ea227d01ea05c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Publishing now validates the document as it goes live. Before, a status-only
  publish that promoted no pending draft (a first publication, a republish after
  an unpublish, a collection or Single without drafts, or publishing every
  language at once) validated only the patch, `{ status }`, so the stored document
  went live judged only as it had been when saved as a draft. Now the stored
  document, with the patch on top, is validated as published. This holds for
  collection entries and Singles, through the Direct API, REST, bulk updates,
  `updateMany` and `publishAllLocales`, which judges each language it puts live.
  A Single's promotion of a pending draft is judged with the status it publishes.
  For the page builder, a page whose components are deeper once published than
  in their drafts is now refused at publish, on its field.

  Compatibility: this applies to every collection and Single with a
  draft/publish lifecycle. A stored value that no longer passes a rule tightened
  since it was saved now stops a status-only publish, with a validation error on
  that field. Fix the field, then publish. Sending `published` again to a document
  that is already live is not re-validated. For a collection entry, publishing
  validates the stored row's own fields and translations, as publishing a draft
  already did: a required field-group (component) value or relationship missing
  from storage is not re-checked at publish.

  The page builder's composition check also refuses a new loop in a document
  that already holds one, re-judges the documents placing a component when an
  exposure is removed or a slot is re-aimed at another node, and counts every
  composition a save performs against that save's one work limit.

- [#1891](https://github.com/nextlyhq/nextly/pull/1891) [`04ac714`](https://github.com/nextlyhq/nextly/commit/04ac7145684096ed3887fe6c2faf0dffb740f5b0) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - QA round: builder layout and editor fixes.

  The schema builder's Advanced tab offered the Localized switch on component
  references, where it could only save a flag storage cannot honour — the
  reference holds no value of its own, so toggling it read as Apply being
  broken. The switch is now disabled there and names where component
  localization actually lives: the fields inside the component.

  The builder pages render standalone, and the breadcrumb above the entity
  name was plain text — on a phone there was no way back to the list after
  saving. It is now a link home. The field editor sheet no longer pushes its
  left edge off narrow screens, select popups clamp to a scrollable height
  even where the positioning variable is absent, the list-view card title and
  value cells can shrink so long text truncates inside the card instead of
  painting over it, and plugin route URLs wrap within their card instead of
  overflowing past it.

- [#2130](https://github.com/nextlyhq/nextly/pull/2130) [`3789b82`](https://github.com/nextlyhq/nextly/commit/3789b82c0aed30018a1af81f27b6fc5ed2c9b375) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A migration can no longer change another owner's table, column, index or constraint in place. The guard already refused dropping or renaming one; it now also refuses a type, nullability, default or redefinition change, an index or constraint change such as a deferral or validation, and a table's storage change, such as a tablespace, access method or MySQL engine. The app can still change a column it owns, and the one override the schema spec allows for a generated column's storage.

- [#2025](https://github.com/nextlyhq/nextly/pull/2025) [`1e1697a`](https://github.com/nextlyhq/nextly/commit/1e1697acb9652f5addde81f12738ce15ac680bb0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Populating a relationship now withholds a related row from a caller who could not read that row directly.
  - A scoped API key needs `read-<collection>` in its own scope to see rows of a related collection, whatever that collection's read rule says. Before, a key granted only the parent collection was shown related rows whenever the related collection declared no read rule or its rule admitted.
  - A signed-in user reading a related collection that declares no `access.read` rule now needs a read permission on it, the same one a direct read of that collection asks for. Before, any signed-in user who could read the parent was shown those rows. Collections that do declare `access.read` still let that rule decide, with no per-collection permission required.
  - A populated user (a relationship to `users`) and an upload's media row now need `read-users` and `read-media` for signed-in users and API keys. Before, both were shown to every reader of the parent.

  Visitors are unaffected, as are reads made with `overrideAccess` (the Direct API's default) and the collections a content route trusts. A withheld row comes back as a reference to a missing row would, and the rest of the response is served.

  **Upgrading:** to keep showing these rows on purpose:
  - for an API key, add `read-<collection>` (or `read-users`, `read-media`) to its own grants; a read rule alone cannot restore it;
  - for a signed-in user, grant `read-<collection>` (or `read-users`, `read-media`) to their role, or declare an `access.read` rule on the collection that admits them.

- [#2117](https://github.com/nextlyhq/nextly/pull/2117) [`fd9d7bc`](https://github.com/nextlyhq/nextly/commit/fd9d7bc7e6876d0b5594ed451d70c7d451aa9ca6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Version retention no longer removes another language's published version. It
  kept one published version per document, so a run of saves in one language
  could delete the only published snapshot of another. It now keeps, whatever
  `versions.maxPerDoc` says, the latest published version of each language and
  the latest one with no language, every named version (including the "Before
  restore" version a restore records), and every restore with the version it was
  made from. Nothing that was kept before is removed; documents keep a few more
  versions. A version named while a save is trimming history is no longer
  removed by that save, and a restore whose source version was trimmed away
  while it ran now fails with a conflict instead of recording a source that no
  longer exists.

- [#2088](https://github.com/nextlyhq/nextly/pull/2088) [`60c2857`](https://github.com/nextlyhq/nextly/commit/60c2857b5e2f810f1a9b5b9a80e4549836a4baae) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `nextly` and `nextly/schemas` no longer export `DeleteUserAccountSchema`,
  `UnlinkAccountSchema` or `UnlinkAccountResponseSchema`, or the types inferred
  from them (`DeleteUserAccount`, `UnlinkAccount`, `UnlinkAccountResponse`).
  They validated requests to the endpoints that listed and unlinked a user's
  linked accounts, which are already retired, so nothing accepts or sends what
  they describe. Code that imports one of them should delete the import and the
  validation that used it; there is no replacement.

- [#2136](https://github.com/nextlyhq/nextly/pull/2136) [`14bf617`](https://github.com/nextlyhq/nextly/commit/14bf6178497f37afe592e736f8b9d973cb89ca0d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Retry on a dashboard card asks only that card's question, and the frame keeps its promises for
  every card.
  - Pressing Retry on one card no longer asks again for the cards retried before it, and a card
    whose retry has answered keeps that answer until the whole dashboard refreshes. Its freshness
    line gives the time of that answer rather than the dashboard's.
  - Retry is offered only on a card whose question was asked; a card refused before that has
    nothing to ask again.
  - A widget's `description` is drawn under its title.
  - An actions card with no shortcut the reader may use shows the frame's empty state.

- [#2043](https://github.com/nextlyhq/nextly/pull/2043) [`69b1033`](https://github.com/nextlyhq/nextly/commit/69b1033e3d7a80e21f5982c550bdfddd810cecb0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A built-in role can no longer be left without its permissions. Replacing a
  role's permissions deleted all of them and then inserted the new set as a
  second write, outside a transaction, and every boot did it for every preset
  role. A serverless instance frozen between the two writes, or an insert that
  failed, left the role empty until another instance started. The permissions
  are now changed by difference, in one transaction under a lock on the role, and
  a role whose permissions are already right is only read, so concurrent cold
  starts no longer rewrite them.

  The boot started by `getNextly()`, as in `instrumentation.ts`, now finishes
  permission and role seeding before it resolves, as the request-path boot
  already did. Plugin-declared roles are seeded on both boot paths. Seeding keeps
  quiet only about a table that does not exist yet, and logs any other failure
  as an error naming the step. A production build (`next build`) seeds nothing:
  the first runtime boot does it before it serves.

- [#2047](https://github.com/nextlyhq/nextly/pull/2047) [`1ba417e`](https://github.com/nextlyhq/nextly/commit/1ba417ed4cf2ab49d8359dabb622e3589f0baabe) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - When one boot finds the services already registered by the other, as when
  `instrumentation.ts` and a first request boot at the same time, it now waits for
  that boot's permission and role seeding rather than serving before the roles are
  written. The registering boot holds that wait from before its services read as
  registered, so the steps it runs before seeding are covered too, and so is a
  development boot that registers the services again after a `localization`
  change. Both boots share one seeding run per process.

  A plugin-declared role is created only once a boot has seeded every
  permission. A plugin role is never revisited after it exists, so one created
  after a permission step that failed part-way kept, for good, only the grants
  that step managed to write. A permission seeding counts as failed when any
  permission could not be written, or when the collection or Single registry
  could not be read for a reason other than its table not existing yet; it is
  logged as an error naming how many.

  On MySQL, whose `role_permissions` table has no foreign key, an assignment
  whose permission no longer exists is left out of a role's permission list and
  removed by the next replacement, rather than failing the read. A replacement
  that adds an id naming no permission is refused on every dialect, MySQL
  included, and leaves the role as it was. Replacing a role's permissions removes
  and inserts in statements within the adapter's parameter limit, however many
  assignments change.

- [#2274](https://github.com/nextlyhq/nextly/pull/2274) [`bcbc487`](https://github.com/nextlyhq/nextly/commit/bcbc4876f0dfe7a2d73c351d319c7a4b041dd9b5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Saving a component now refuses a change that breaks a second locked slot the
  same way an existing break does. Two slots of one block type broken the same
  way read alike, so the pages placing the component counted them as one, and a
  save breaking the second could pass. Breaks are now counted, so the second is
  judged as the new break it is.

- [#2135](https://github.com/nextlyhq/nextly/pull/2135) [`a19118b`](https://github.com/nextlyhq/nextly/commit/a19118bc5a78b31ca1e5e7b6f5d8dc882a686514) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin says when a page is out of reach instead of moving you to the
  dashboard without a word.

  Opening a collection, a Single or another page your account may not open now
  shows "You don't have access to this collection" (or "this Single", or "this
  page") at the address you opened, with Go back and Go to dashboard. Go back
  stays inside the admin: where the page before is not an admin page (the
  site itself, another site, or nothing), it goes to the dashboard. The not-found page shares the same card.

- [#2240](https://github.com/nextlyhq/nextly/pull/2240) [`3fa821e`](https://github.com/nextlyhq/nextly/commit/3fa821e485c97243f41209c2308d51c5bbd5dc07) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Saving `nextly.config.ts` during `next dev` applies the new schema again, without a restart, under Turbopack and webpack and on any port. The dev reload used to wait for a message on Next.js's HMR socket, which Next.js 16.3 and later serve at a different path, so no edit was applied until the server restarted. Nextly now watches the config and every file it imports, by directory so an editor's rename-on-save is seen, and only under `next dev`.

  When a saved config can't be read, the dev log now says why: the syntax error and where it is, an import that can't be found, or `esbuild` missing. The previous config stays in place either way. `NEXTLY_HMR_URL_OVERRIDE` no longer does anything, because there is no socket to point; `NEXTLY_DISABLE_HMR=1` still turns the dev reload off.

- [#2046](https://github.com/nextlyhq/nextly/pull/2046) [`d694cf8`](https://github.com/nextlyhq/nextly/commit/d694cf826c9d5eee4555c5bb1af755d167970bba) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A schema hook that declares the same schema with its properties in another
  order is no longer refused as changing between builds.

  The comparison of the two builds now sorts an object's keys at every depth,
  so only a difference in what was declared counts. The documentation also says
  what two builds a moment apart cannot catch: a value that changes only
  between boots, such as today's date.

- [#2034](https://github.com/nextlyhq/nextly/pull/2034) [`b6cd7d8`](https://github.com/nextlyhq/nextly/commit/b6cd7d853a7890a097c6e545dccc22e19923ae6c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A schema hook whose output changes between builds is refused, naming it, and
  an error a hook throws names the hook.

  A hook that puts the clock, a counter or a random value into a declaration
  produced a different schema on every build, so every development push
  planned the same change again. The schema Nextly pushes, and the one
  `migrate:create` writes, are now built twice, and a hook whose output differs
  is refused with its owner and its position. A `NextlyError` thrown inside a
  hook, including the schema's own refusals, now carries the hook's owner and
  position as well, as any other error from a hook already did.

- [#2162](https://github.com/nextlyhq/nextly/pull/2162) [`a592671`](https://github.com/nextlyhq/nextly/commit/a59267178be33fbc6f9e06af07613a98c9c3f365) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Form Builder and the blog template now decide access by the permissions a role holds on the Roles screen, never by a role's name.

  **Behaviour changes.** Form Builder's default rules used to let any signed-in user read every submission and edit every form, and only users with a role named `admin` delete either. Each now needs the matching permission: `read-form-submissions`, `update-forms`, `delete-form-submissions`, and so on. A visitor can still read a form and submit one. Give your staff roles the permissions they need on the Roles screen; super-admins are unaffected.

  The blog template's rules used to admit roles named `admin`, `editor` or `author`, so a custom role or an API key holding `update-posts` was refused. They now check the permission instead, and the seeded **author** role no longer holds `delete-posts` or `publish-posts`: an author can no longer delete or publish posts, their own or anyone else's, and an editor publishes. This applies to newly seeded sites; an existing site keeps the roles it has.

  The documentation now gives one rule for code access: check the permission, then narrow it, and don't check role names.

- [#2176](https://github.com/nextlyhq/nextly/pull/2176) [`dfa77b9`](https://github.com/nextlyhq/nextly/commit/dfa77b92273ef729b9ef70cfc00a804d286d9542) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An edit to a published Single's component fields, saved without publishing,
  is no longer lost. The working draft never held component values, so the
  edit was dropped at the save and the next publish kept the old values. The
  draft now holds them, in the same shape a collection's draft does (built on
  the live components, a save's changes merged sub-field by sub-field, a list
  replaced whole), the save's version records them, and publishing writes
  them. A publish that sends its own component values still wins over the
  draft's, sub-field by sub-field.

  The same draft, and every version a held save records, now holds the Single
  as a read returns it. Groups, repeaters and JSON fields are held as values
  rather than the text their column stores, so such a version restores
  instead of being refused by validation. A localized Single's draft holds
  every stored translation of its language, not only the fields the save
  named, so a version restores without dropping the others.

  A Single that is not localized but embeds a localized component no longer
  holds a working draft: its draft would be keyed with no language while the
  component keeps a value per language, so it saves live, as it did before. Its
  schema reports `draftsEnabled: false` with the new reason
  `localized-component`. `DraftSplitDisabledReason` gains that member; code that
  switches over the reasons should handle it (or a default). Collections are not
  affected.

- [#2235](https://github.com/nextlyhq/nextly/pull/2235) [`6983c80`](https://github.com/nextlyhq/nextly/commit/6983c80a44441497019f21f680d62ede4dba8581) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The skills bundled with `create-nextly-app` are checked against this release. The install skill no longer asks for steps the CLI now does itself: approving pnpm's native builds, adding `esbuild`, the admin's media route, the health check and `instrumentation.ts`. It also says that a file the app already has is kept and reported, and that `.env` gets only the keys it lacks. The collections skill says the generated Zod schemas import `z` from `nextly/zod`, so a project needs no `zod` dependency of its own.

- [#2232](https://github.com/nextlyhq/nextly/pull/2232) [`d7fe37a`](https://github.com/nextlyhq/nextly/commit/d7fe37a0ffd5f9c6ef6aa3e049b26911fc6227bb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - When `create-nextly-app` leaves alone a skill folder the project already has, the command it gives for replacing the skill now names this CLI's own release, whose tag publishes the bundled skills, rather than the release the skills were checked against, whose tag may carry no user skills. Skill files keep their permission bits when written, so a helper script a skill runs stays executable. The agent guide a new project gets gives the same command with this release's version filled in, and says that releases up to 0.0.2-alpha.66 publish no skills for building apps, so an older version must not be used in its place.

- [#2044](https://github.com/nextlyhq/nextly/pull/2044) [`9418bd6`](https://github.com/nextlyhq/nextly/commit/9418bd64ca6353fceaae7c5af1eea4768170db08) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A service registered again after `clearServices()` with the same factory function is no longer removed when the cleared registration's teardown ends.

- [#2124](https://github.com/nextlyhq/nextly/pull/2124) [`9fe35d4`](https://github.com/nextlyhq/nextly/commit/9fe35d4650c645d8c3f2d237c418ba721c9f55a4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The adapter's where clauses gain `ICONTAINS`: a substring match that ignores
  case on PostgreSQL, MySQL and SQLite even under a case-sensitive collation, with
  `%` and `_` in the value matched as characters. `ILIKE` now runs on MySQL and
  SQLite, where it failed with a syntax error (searching the admin's registries
  on those databases hit it), and on MySQL it no longer turns case-sensitive
  under a case-sensitive collation such as `utf8mb4_bin`.

- [#2164](https://github.com/nextlyhq/nextly/pull/2164) [`c05dd86`](https://github.com/nextlyhq/nextly/commit/c05dd8628414f9a4b179ddf4ceabbc737aa27127) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The help for `nextly add`, `nextly plugins` and `nextly prune` no longer ends in an internal reference such as "(D70)".

- [#2104](https://github.com/nextlyhq/nextly/pull/2104) [`bd48aff`](https://github.com/nextlyhq/nextly/commit/bd48aff453bf5eb9c26362cba4255e3ad209548e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard is one ordered list of cards, each at a width

  Cards now sit in one ordered list on the dashboard, filling rows left to right and wrapping, and each card is a quarter, a third, a half, two thirds or the whole row. The page-wide column count is gone. In customise mode each card has one menu to move it to the start, earlier, later or to the end, to change its width, to open its settings and to remove it; a removed card can be brought back with Undo. Reset asks first, and is saved only when you save.

  Arrangements saved by an earlier release are converted when they are read: every card keeps its settings, a hidden card becomes a removed one, and the order runs across the tops of the old columns, then the next row down. Each card takes the width its saved size stood for, so a converted dashboard looks different from the columns view, with wider cards where a widget asked for them. The converted arrangement is stored in the new format the next time you save it, and going back to an older release after that save loses the widths.

  If a saved arrangement cannot be read, the dashboard shows the default and says so, and saving over it asks first.

  `COLUMN_COUNTS`, `DEFAULT_COLUMN_COUNT` and `ColumnCount` from `nextly/config` are deprecated: nothing reads them any more, and a later release removes them.

- [#2091](https://github.com/nextlyhq/nextly/pull/2091) [`70b4390`](https://github.com/nextlyhq/nextly/commit/70b4390224837d5ea9aea81965c9cea8ad9ec2f8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard keeps its main heading, and offers sample content only to someone who can load it

  The dashboard now has exactly one level-one heading in every state. It no longer
  disappears while the sample-content offer is open, or while the signed-in user is
  still loading, so jumping by heading always lands on the page title. If the
  dashboard fails to load, its error screen's title ("The dashboard couldn't load")
  is that heading.

  The sample-content offer now appears only when the sample-content route lets the
  signed-in person load it. A refusal (401 or 403), any other failure, or no answer
  now means no offer, instead of a button that can only fail.

- [#2194](https://github.com/nextlyhq/nextly/pull/2194) [`be4015b`](https://github.com/nextlyhq/nextly/commit/be4015bcdf4e8a3fc4b325be271742f9e0069c3c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's edit-user page now builds its update request in one tested function, which sends a new password exactly as typed. There is no change in behaviour.

- [#2010](https://github.com/nextlyhq/nextly/pull/2010) [`9bb4f19`](https://github.com/nextlyhq/nextly/commit/9bb4f198966c47d97fe6f4fff7a3b8a8d7a4403c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The audit row for the first administrator's session, written by the setup
  route, now records how that session began (strategy `setup`), as every other
  login row records its strategy. It was the one login row with no strategy, so
  a trail filtered by strategy could not account for it.

- [#2243](https://github.com/nextlyhq/nextly/pull/2243) [`5345c56`](https://github.com/nextlyhq/nextly/commit/5345c563b843741628e33fcb05e02bc1b0ab1ce6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The agent guide a new project gets now offers the command that restores its Nextly skills only when the project's nextly-install skill declares, as `metadata.nextly-version`, the release the skills at that command's tag were written for, and `nextly --version` prints that same release. A project created over a folder that kept skills from an earlier install could otherwise be told to restore skills written for a different release.

- [#2174](https://github.com/nextlyhq/nextly/pull/2174) [`0658c58`](https://github.com/nextlyhq/nextly/commit/0658c58a1d2f7a06b32e3c08068bfb5f3a50e7d2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `/api/health` waits for a start that is still in progress before answering, and a start that failed is logged with its own error rather than advice to add a start-up hook. Adding Nextly to an existing app reads the installed Next.js version, not the package.json range, before saying whether Next.js 14's `instrumentationHook` opt-in is needed, and an app with no Next.js config is given a whole one to create.

- [#2090](https://github.com/nextlyhq/nextly/pull/2090) [`c0cf3cc`](https://github.com/nextlyhq/nextly/commit/c0cf3cc41e314a97150438233ac11b76f7f96c1c) Thanks [@aqib-rx](https://github.com/aqib-rx)! - The last active super-admin can no longer be deleted, deactivated or have the
  role taken away. Only removing the role was refused before, and only through
  one REST route; a delete or a deactivation from the admin, the REST API or the
  Direct API went through and left an install nobody could administer, with the
  database edited by hand the only way back. Each of those removals, and the
  role's removal through any path, is now refused with `409 CONFLICT`: make
  another user super-admin first.

  The refusal is decided inside the removal's own transaction, under a lock
  every removal takes, so two requests sent at once to remove the last two
  super-admins leave one: the admin's bulk delete sends exactly such requests.
  What is kept is an active account holding the `super-admin` role itself. A
  role built on `super-admin` grants the same authority, but its inheritance can
  be edited away and the role deleted, so an account that is a super-admin only
  through it does not count; nor does a deactivated account.

  The refusal of a role removal changes shape: it was `400` with a bare
  `{ "error": "..." }` body, and is now `409` in the standard error envelope.
  `DELETE /api/users/:id/roles/:roleId` answers this refusal with the same
  `409`.

- [#2111](https://github.com/nextlyhq/nextly/pull/2111) [`6067d2c`](https://github.com/nextlyhq/nextly/commit/6067d2c6c16c221d696a11ca0d5f37b8ef97fcb6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The `nextly` README installs what adding Nextly to an existing app needs: `@nextlyhq/ui`, `@tanstack/react-query` and `lucide-react` beside `nextly` and `@nextlyhq/admin`, and `esbuild` as a dev dependency, matching the installation guide.

- [#2092](https://github.com/nextlyhq/nextly/pull/2092) [`13191f2`](https://github.com/nextlyhq/nextly/commit/13191f2fde3b7970bd8b82f0a01ffe7e5ba6d4d9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The page builder's editor is split into parts, with no change to what it
  does. Mounting the editor, the canvas's render inputs, the panels and the
  commit to the entry form each live in a module of their own, so a change to
  one no longer has to work through all of them.

- [#2058](https://github.com/nextlyhq/nextly/pull/2058) [`b337a8b`](https://github.com/nextlyhq/nextly/commit/b337a8b2aec14c273cff9929b651e57765c3666b) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `create-nextly-app --template plugin` now scaffolds a plugin that installs, tests
  and runs as created. The flag accepts every template the interactive prompt
  offers, and a plugin scaffold no longer stops at "App Router not detected": its
  Next.js app lives in `dev/`, so only the package manager is detected.

  The plugin is copied from the template bundled with the CLI, and its Nextly
  packages are pinned to that CLI's release, so the two always match; `--local-template`, `--use-yalc` or a
  `--branch` other than main still resolve the template live, for `blank` too.
  Run from inside a Next.js app, `--template plugin` creates the package in its
  own directory instead of installing into the app.

  The scaffold now boots on the first `pnpm dev`: `dev/.env` is written from
  `dev/.env.example`, the admin page provides the query client its hooks need,
  and the dev user named by `admin.devAutoLogin` is created under `next dev`,
  so `/admin` opens signed in. The generated test uses the current Direct API,
  peer dependencies are always semver ranges (pnpm rejects a dist-tag there),
  and `--use-yalc` links `@nextlyhq/plugin-sdk` with the other local packages.

- [#2120](https://github.com/nextlyhq/nextly/pull/2120) [`048cc0e`](https://github.com/nextlyhq/nextly/commit/048cc0e2b37a527ad54b92576b854ce4d86ee69b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The release list now pages on the server, with a true total. `GET /api/releases`
  and `nextly.releases.find()` take a `tab` (`upcoming`, `attention`, `drafts`,
  `done`), a `search` over the title and description, and a `page`; a new
  `nextly.releases.count()` counts a tab without reading it. A release counts as
  overdue, and moves to `attention`, once it is still scheduled 10 minutes after
  its time; `reason: "overdue"` or `"stopped"` reads one part of that tab.
  Tabs, `reason`, search, paging and `count()` are experimental.

  **Breaking:** `nextly.releases.find()` now returns `{ items, meta }`, like every
  other Direct API list, instead of an array, and it is paged: without a `limit`
  it returns the first 50 releases, where it used to return every match. Read
  `result.items` where you read the array and `result.meta.total` for the number
  of matching releases; to process every release, ask for each page in turn
  (`page: 1, 2, …` up to `result.meta.totalPages`, at most 200 per page).
  `limit` must now be at least 1: a `limit: 0` call used to answer an empty list,
  and a caller that only wanted the number of releases asks `count()` instead.

  Scheduled releases listed without an `order` now come soonest first rather than
  furthest out first. A release's documents come back in the order they were
  added, and asking for the documents or blocking reasons of a release that does
  not exist answers not found instead of an empty list.

  New releases and release documents get time-ordered (version 7) UUIDs instead
  of random (version 4) ones, so ties in the list keep the order they were made
  in. They are still standard UUID strings in the same columns; only code that
  checks the version digit would notice. Existing ids are unchanged.

- [#1995](https://github.com/nextlyhq/nextly/pull/1995) [`222afe2`](https://github.com/nextlyhq/nextly/commit/222afe231fac3a2d186c02b59ec8f97578f30090) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Plugins and apps can declare their own tables, and plugins ship the
  migrations that carry them to production. The signed-in admin loads again.

  ## Upgrading

  **Run `nextly migrate` before deploying this release**, and edit any pending
  migration file the run refuses (see below). Applied files are never re-read.

  ## Breaking changes
  - **Pending migrations run before plugins initialise.** They used to run after
    plugin `init`, so a plugin queried a database whose migrations had not been
    applied. A plugin that relied on running first, for example to prepare
    something a migration reads, now runs after the migrations.
  - **Plugin routes and widget sources are checked before migrating.** A route
    with a method outside `GET`, `POST`, `PATCH`, `PUT` and `DELETE` (such as a
    JavaScript plugin's lowercase `"post"`), or a reserved widget source id,
    stops the boot before the database is migrated. A route with such a method
    used to be registered where no request could reach it.
  - **Each migration file runs whole.** Every app migration file, plugin
    migration module and DOWN runs in one transaction on one connection, split
    into statements by a dialect-aware scanner that keeps `DO $$`, trigger and
    routine bodies whole. A file is refused before anything runs when it holds a
    statement that would end or hand off that transaction (`ROLLBACK`, `ABORT`,
    `XA …`, prepared transactions), a PostgreSQL session setting that would
    outlive it on a pooled connection (`SET` other than `SET LOCAL`,
    `SET CONSTRAINTS` and `SET TRANSACTION`, `RESET`, `DISCARD`), or a statement
    the database cannot run inside a transaction (`VACUUM`, `CONCURRENTLY` index
    builds, PostgreSQL's `CLUSTER` naming no table, MySQL `LOCK TABLES`, SQLite
    `ATTACH`). In a file that runs in a
    transaction, its own `BEGIN`, `START TRANSACTION`, `COMMIT` and `END` are
    left out, and `SAVEPOINT`, `ROLLBACK TO` (also spelled `ROLLBACK WORK TO` or
    `ROLLBACK TRANSACTION TO`) and `RELEASE` run as written. **A pending file
    that uses a refused statement must be edited before it applies.** A file
    whose first line is `-- nextly:no-transaction`, or a plugin migration module
    with `transaction: false` (experimental), runs outside a transaction,
    statement by statement, so it can hold `VACUUM`, PostgreSQL's `CONCURRENTLY`
    index builds and the other statements a transaction refuses. Statements that
    leave state on the connection stay refused either way: a session `SET`, a
    bare `ROLLBACK`, MySQL `LOCK TABLES` and SQLite `ATTACH`. A unit marked to
    run outside a transaction is also refused, before anything runs, when it
    holds what needs one: its own `BEGIN`, `START TRANSACTION`, `COMMIT` or
    `END`, a savepoint, or PostgreSQL's `SET LOCAL`, `SET CONSTRAINTS` or
    `SET TRANSACTION` (refusal code `NEEDS_TRANSACTION_IN_MIGRATION`); on SQLite
    it may not write `PRAGMA foreign_keys` or `PRAGMA defer_foreign_keys`. Such
    a file has no all-or-nothing guarantee: if a statement fails, the ones
    before it stay applied and the run fails with
    `NEXTLY_MIGRATION_PARTIALLY_APPLIED`, whose message gives the statement
    count and the recovery (the database's own error is in its cause). While
    that failed attempt is the unit's newest, or one that never finished because
    the process running it stopped, `nextly migrate` refuses to record
    the unit as applied without running it, even when the database already
    stands at its result: finish it by hand and mark it with
    `nextly migrate:resolve --applied <file>` (a file with no snapshot is
    recorded without comparing the live schema, and needs no `--skip-verify`,
    when it is marked, or on MySQL after a failed attempt; for a plugin module,
    `--failed-cleanup` and then `nextly migrate`), or reverse what ran, clear
    the attempt with `nextly migrate:resolve --failed-cleanup <file>` and
    migrate again. It is not run again over what stayed either, even when the
    database still stands at its start. `nextly migrate`, `migrate:down` and `migrate:status` name
    each unit that runs outside a transaction. A refusal's message names the
    marker, `migrate --dry-run` lists refusals, and `migrate:check` warns about
    them (`REFUSED_STATEMENT`). `nextly migrate:create --blank --no-transaction`
    writes a file whose first line is the marker, and
    `migrate:create --plugin <entry> --no-transaction` (or `--blank`) writes a
    module sealed with `migrationChecksum` when it loads, so its SQL can be
    edited. Existing plugin modules keep their checksums. On MySQL each schema
    statement still commits as it runs.
  - **On SQLite a migration that leaves a dangling reference is refused.** Each
    unit runs with `foreign_keys` off, a `foreign_key_check` after its last
    statement and the setting restored afterwards, so a table rebuild keeps
    child rows. A unit that leaves a new dangling reference fails with
    `NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION`: a unit run in a transaction is
    rolled back; one marked to run outside a transaction keeps its statements
    and is recorded as failed, to be repaired and then marked applied.
  - **A large body handed on without the refresh cookie is refused.**
    Before an auth hook, a strategy or a plugin route sees a request that
    carries the refresh cookie (any `/admin/api/auth/*` request from a signed-in
    browser), the cookie is removed from a copy of the request, and that copy
    now reads at most 64 KiB of a body nothing has read yet, the same cap as the
    `csrf` route option's reader. A larger body is refused with a `400`
    `VALIDATION_ERROR` response (`too_large`) instead of being buffered whole. A
    body the handler has already read, as core login reads its own, is not
    read again, and the copy carries none.
  - **Collection `indexes` now reach the database.** They were validated and
    then discarded, so an app that declared a compound index has been running
    without one. The next dev push or `migrate:create` adds it, and a unique
    index over columns that already hold duplicate rows fails to build until the
    duplicates are resolved:

    ```sql
    SELECT country, city, COUNT(*)
    FROM dc_places
    GROUP BY country, city
    HAVING COUNT(*) > 1;
    ```

  - **What the schema model cannot carry is refused rather than lost**: partial
    (`where`) indexes on every dialect, because MySQL has none; expression index
    keys carrying an ordering, collation or operator class; check constraints,
    foreign keys and enums where the diff cannot see them; and anything an app's
    `db.schema.afterDrizzle` hook returns that would not survive the round trip.
  - **`db.postgres.schema` accepts only `"public"`.** Any other value stops the
    boot and every CLI command, because the schema push cannot yet create tables
    outside `public`. MySQL and SQLite warn and ignore it.
  - **A plugin's migrations are checked at boot and by `nextly migrate`.** A
    production boot refuses a plugin whose `schemaVersion` is ahead of the
    modules the database has applied (`PLUGIN_SCHEMA_BEHIND`): run
    `nextly migrate`. `nextly migrate` refuses a plugin that declares tables or
    contributed columns but ships no migration modules
    (`PLUGIN_MIGRATIONS_UNAVAILABLE`). A disabled plugin's migrations still run,
    and its tables stay.
  - **`nextly migrate:create --plugin` never drops what the plugin created.** It
    cannot tell a renamed table or column from a drop and an add, so a generated
    drop of anything the plugin's earlier modules created is refused with
    `PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA`, naming each, and the command fails; write the
    rename, or the deliberate drop, by hand. With no schema changes it writes
    nothing and exits with code 2, whatever `schemaVersion` says, so a CI step
    that asks whether shipped modules are current must treat 2 as "up to date".
  - **A column contributed to a table you do not own now arrives.**
    `extendTable({ columns })` on a collection, Single or extendable core table
    (`users`, `media`, `nextly_jobs`, `audit_log`, `activity_log`) used to be
    validated and then dropped. It is now created by the app's migrations, so
    the next `migrate:create` adds it, and it is stripped from every entry the
    API returns.
  - **An app migration that drops or renames a core table is refused.** Core
    tables (`users`, `media`, …) are core's. An app migration may still drop or
    rename any column of a core table that no plugin's records name as its own,
    since a column the app contributed cannot be told apart from core's.
  - **A plugin's migration modules must have unique names**, including names
    that differ only in case, since a module's name is its key in the
    migration ledger. A module name may not contain `/`, and each module's
    `schemaVersion` must be a positive integer, whether or not the plugin
    declares one. When the plugin declares a `schemaVersion`, no module's may be
    lower than the one before it in name order, and the last must equal it.
    Each is refused when the configuration loads, before any migration runs.
    Modules run in name order compared character by character after
    lowercasing, without the host's locale, so a plugin's modules run in the
    same order on every machine (`10_more` before `1_init`: zero-pad numbered
    names).
  - **On MySQL, a failed migration attempt is never adopted.** MySQL commits
    each schema statement as it runs, even inside a transaction, so a
    migration whose data statement failed after its schema statements could be
    recorded as applied on retry with that data change skipped. While a
    migration's newest attempt is a failed one, `nextly migrate` on MySQL
    refuses it with `NEXTLY_MIGRATION_PARTIALLY_APPLIED` and names the
    recovery. PostgreSQL and SQLite run it again as before.
  - **On MySQL, a failed migration attempt is never run again either.** MySQL
    also commits what ran before a schema statement, so a migration whose
    schema statement failed after a data statement left the data change applied
    while the schema still matches its start, and a retry repeated it. While
    its newest attempt is a failed one, `nextly migrate` refuses to run it with
    `NEXTLY_MIGRATION_PARTIALLY_APPLIED`, with or without a snapshot, as it does
    on every dialect for a unit marked to run outside a transaction. After
    fixing a failed MySQL migration, clear the attempt with
    `nextly migrate:resolve --failed-cleanup <file>` before running it again.
  - **An explicit collection index `name` must start with `idx_` or `uq_`.**
    Those are the only names schema changes drop, so an index named otherwise
    would be created and never removed once its declaration was. A collection
    declaring `{ fields: ["slug", "locale"], unique: true, name: "slug_locale_unique" }`
    is refused by `defineCollection` with the rename to make; use
    `name: "uq_slug_locale"`, or leave `name` out to have one derived. No
    database carries an index under the old name, because collection indexes
    were not created before this release.
  - **Virtual fields are not validated on write.** A virtual field's value is
    dropped before the write, so `required` and `validate` on it no longer
    refuse a create or update that omits it or sends a value.
  - **`defineTable` refuses a decimal scale above 30** (MySQL's maximum) and a
    foreign key over no columns, `col.varchar(n)` refuses a width above 16,383
    characters (the widest MySQL declares under utf8mb4), and two relations of
    one name on a table are refused. When the schema compiles, a table whose
    columns do not fit MySQL's 65,535-byte row is refused on every dialect, and
    so are two foreign keys that resolve to one name across the tables plugins
    and the app declare, since MySQL requires a foreign key's name to be unique
    per database, two different indexes that do, since PostgreSQL and SQLite
    require an index's name to be unique per schema (the same index contributed
    to one table twice is one index), one name given to two indexes a table
    declares, alike or not, since each is its own `CREATE INDEX`, a foreign
    key referencing a column its target does not have (`references.columns`
    are SQL names), and a key column whose type cannot reference its target's
    on every dialect (an integer or a `uuid` on text, integers or floats of
    different widths, decimals of a different precision or scale, or a long
    text, JSON or bytes column). `defineTable` refuses a numeric default that is
    not a finite number, and a decimal default with more digits before the point
    than its precision leaves room for. An index name an `afterDrizzle` hook gives is
    held to the same uniqueness rule as a declared one.
  - **A declared collection index is checked on every dialect** when the
    schema is built from the config (development push, `db:sync`,
    `migrate:create`). A JSON field or an unbounded text field (a textarea, say)
    cannot be part of one; its whole key may not exceed MySQL's 3,072 bytes,
    where a text field counts 4 bytes for each character of its width (1,020 at
    the default 255), so an index over four text fields is refused; and an
    explicit `name` may be at most 63 characters, the longest PostgreSQL keeps.
  - **A declared name the DDL cannot quote is refused before any DDL is
    generated.** A table, column or explicit index, foreign key or check name,
    and a foreign key's referenced table and columns, may not be empty or hold
    `"`, a backtick or NUL, on every dialect, when the table is declared or the
    schema compiles; before, such a name failed while the migration was being
    generated.

  ## Schema

  A plugin declares tables in `contributes.schema` with a dialect-neutral DSL
  (`defineTable`, `col.*`), or through hooks that run in dependency order and
  see every table already declared. `col.enum()` enforces its values with a
  check constraint on every dialect, and `col.serial()` declares a
  database-assigned key, which must be the table's primary key. A collection can
  choose `db.idType` between random and time-ordered UUIDs, and accept a
  client-supplied id with `db.allowIdOnCreate`.

  Ownership is recorded per table and per element, and a migration is refused
  before it runs (`DROP_OF_FOREIGN_TABLE`) if it drops or renames a table, a
  column, an index, a foreign key or a check another owner holds; an index
  dropped by its name alone is judged by the table the database has it on. A table with no owner record (every collection,
  Single and component table, and tables your own migrations created) is the
  app's to drop and never a plugin's: a plugin migration may drop only tables
  its records name, or a table the same module creates that did not exist
  before the module ran, created and dropped under one unqualified, lower-case
  name (`CREATE TABLE t`, not `scratch.t` or `"T"`; SQLite's `temp.t` counts).
  A `CREATE` of a table that already exists earns nothing, and a module that
  runs a PostgreSQL `SET`, `RESET`, `DISCARD`, `set_config()`, `CREATE SCHEMA`
  or `ALTER SCHEMA`, or a MySQL `USE`, earns nothing for any table it creates.
  MariaDB's `CREATE OR REPLACE TABLE t` is read as a drop of `t`, unless no
  table `t` existed before the module ran, and then as its creation. On
  PostgreSQL, a `CREATE FUNCTION` or `CREATE PROCEDURE` whose body is a quoted
  string rather than `$$`-quoted is refused, as a `DO` with one is, and so is
  `CASCADE` on a `DROP` of anything but a table (a type, domain, extension,
  function, view, sequence or index), or on an `ALTER TABLE`'s drop of a column
  or constraint, which also drops whatever depends on it, such as another
  table's foreign key: drop the dependents first, then the object without
  `CASCADE`. On SQLite, a
  table rebuild that removes a column (how a column carrying a check, such as an
  enum, is removed) is judged as that column's drop, so the app may remove an
  enum it added to `users`. Dev push never drops a table no record claims. A
  plugin whose table, or column, index, foreign key or check, is recorded as
  another owner's is refused (`CONFLICT`) rather than taking it over; delete the
  old owner's rows from `nextly_schema_owners` if it is meant to pass to it.
  Schema pushes never run a `DROP SCHEMA`.

  `nextly migrate:create --plugin <name>` generates a plugin's migration
  modules for all three dialects. `nextly migrate` applies them with the app's
  own files and counts both in its summary.

  The DSL and the types a generated migration module imports are exported from
  the new `@nextlyhq/plugin-sdk/schema` subpath (`@experimental`): `col`,
  `defineTable`, `migrationChecksum`, `PluginMigration` and the schema hook and
  table types.

  A collection, Single or component field can be `virtual`: it gets no column,
  a value sent for it on create or update is dropped before the write, and its
  value is computed in an `afterRead` hook.

  ## Fixes

  The admin loads again for a signed-in user. Removing the refresh cookie from
  the request handed to auth hooks, strategies and plugin routes copied the
  request with the global `Request` constructor, which cannot read the instance
  Next.js passes in, so every session check from a browser holding the refresh
  cookie failed with a server error. The copy is now built from the request's
  URL, method, headers and body.

  `nextly db:sync` (and `--watch`) now creates the tables plugins declare and
  the columns and indexes plugins or the app contribute to entity tables, and
  no longer plans to drop a contributed column it finds in the database.
  `nextly migrate` counts the plugin migrations it applied in its summary,
  applies a plugin's migrations on a database the app already migrated, and
  adopts a multi-module history that development push already created. In that
  adoption, and wherever the database already holds a module's result, a module
  that only changes data, such as a seed or a backfill, runs rather than being
  recorded unrun, and so does a module whose schema snapshot does not change,
  whatever its SQL; one that changes the schema and data both, a table created
  from a query (`CREATE TABLE ... AS SELECT`), or rows put into a new table
  renamed into place, among them, is refused with its recovery, since it can be
  neither, and a data module that fails against the later tables it runs on is
  refused with its recovery too. A module whose attempt stopped part-way and was
  finished by hand and cleared (`migrate:resolve --failed-cleanup`) is still
  recorded where the database stands past its start.
  `migrate:create --plugin` accepts a plugin exported by name, and reports no
  changes (exit 2) when the plugin's schema matches its last migration.
  `migrate:create --plugin --blank` now writes a blank module; before, `--blank`
  was ignored with `--plugin`. `migrate:create --plugin` never overwrites a
  module file that already exists: it fails with `CONFLICT` and leaves the
  module and the barrel as they were. `nextly migrate --step N` counts a plugin's
  modules toward N together with the app's files, the plugin's first, and a
  module recorded because the database already stood at its result counts as
  one. `migrate:status` lists a migration whose last attempt recorded no
  outcome as `unfinished` (and counts it in `summary.unfinished` with `--json`)
  rather than as pending. `migrate:resolve --failed-cleanup` clears every
  failed or unfinished attempt since the file's last other event, and `--applied` supersedes
  them all, so a file that failed twice in a row needs one cleanup rather than
  two. A cleared attempt keeps its own start time and its error, and a failed
  one its end time; before, the cleanup overwrote that end time with the time
  of the cleanup. `migrate:resolve --applied plugin:…` now refuses,
  naming `--failed-cleanup` and then `nextly migrate`, instead of reporting the
  module's file missing.

  A development boot applies plugins' migration modules before the app's
  pending migration files, as `nextly migrate` and the production boot do, then
  brings the collection registry into agreement with the tables as `nextly
migrate` does, and counts both streams in what it logs. A disabled plugin declaring a route
  option boot would refuse no longer fails the admin's plugins page; its routes
  are left out of what the page advertises.

  In development, a plugin's existing tables gain the columns, indexes and
  constraints its upgraded declaration added before its `init` runs, so an
  `init` reading a new column no longer fails the boot. Changes that need a
  decision (drops, type or nullability changes, renames, a NOT NULL column
  without a default) stay with the development push and its prompts.

  `nextly migrate` records a plugin's table ownership again when its last
  migration is applied but the owner rows were never written, for example
  after a run that stopped between the two. A production boot no longer
  refuses a plugin whose migrations only change data: its applied schema
  version is read from the migration ledger. `migrate:status --plugin <name>`
  lists the modules the plugin ships, so one that has not run yet shows as
  pending. `migrate:down` rolls back migrations recorded in the same
  millisecond in reverse run order.

  A hidden contributed column cannot be a group key and is ignored as a sort
  key, so a grouped read cannot publish its values as bucket labels. A `where`
  naming one, in either spelling and at any depth, is refused with
  `FIELD_NOT_FILTERABLE` for every caller, so a filter cannot probe its values;
  that includes a column contributed to a component's table, named under the
  component field (`seo.searchVector`). When
  startup fails while several requests wait for it, only one retries. The
  PostgreSQL adapter no longer runs `CREATE SCHEMA` for a schema that already
  exists, so a role without database-level CREATE can connect with
  `schema: "public"`.

  Full details: `docs/database/extending-the-schema.mdx`,
  `docs/plugins/schema.mdx` and `docs/guides/production-migrations.mdx`.

- [#1966](https://github.com/nextlyhq/nextly/pull/1966) [`7b578bf`](https://github.com/nextlyhq/nextly/commit/7b578bfefda0e48bcff3d1cccce2d6fbb15097aa) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The sign-in screen loads much faster: the setup and session checks used to
  run one after the other — two full API round-trips of blank screen — and are
  now one parallel wave, while signed-out screens stop requesting settings
  their session could only fail against. The development-only reload stream
  follows the running server's answer (active under `next dev`, never dialed in
  production), and the schema builder's editor routes survive every build
  flavor.

- [#1893](https://github.com/nextlyhq/nextly/pull/1893) [`95a3318`](https://github.com/nextlyhq/nextly/commit/95a3318f5278a49fb82a5fa4ccd3093ef8f75ae8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The development toolchain moves to Node 24.21.0 and pnpm 12.5.1. Nothing
  about the published packages changes: `engines.node` still reads
  `^20.19.0 || ^22.12.0 || >=24.0.0`, so Node 20 and 22 remain supported, and the
  version legs `package-smoke` derives from that range still test their floors.
  What moved is what contributors and CI run.

  The pnpm upgrade is the part with teeth, because modern pnpm reads its settings
  from one place and silently ignores the others. The `pnpm.overrides` block in
  `package.json` and `link-workspace-packages` in `.npmrc` were both being read
  by pnpm 9 and would both have been dropped without a word — the overrides are
  security floors, so losing them would have been quiet rather than loud. They now
  live in `pnpm-workspace.yaml` as `overrides` and `linkWorkspacePackages`,
  entry for entry, alongside an `allowBuilds` allowlist that replaces the
  `onlyBuiltDependencies` spelling pnpm deprecated.

  Two dependencies the root had been getting by accident are now declared. pnpm 9
  linked `@nextlyhq/eslint-config` and `@nextlyhq/prettier-config` into the
  workspace root even though nothing asked for them; pnpm 10 stopped, and the root
  `eslint.config.mjs` — which imports the first — could no longer be loaded, so
  every package without its own config failed to lint. `typescript-eslint` was
  reaching the plugin template the same way. A dependency that resolves because of
  a hoisting accident is a dependency that disappears without its manifest ever
  changing, which is what happened here.

- [#2122](https://github.com/nextlyhq/nextly/pull/2122) [`afd9eb5`](https://github.com/nextlyhq/nextly/commit/afd9eb5a77eeb8a01b9dc27980dc99ebfa6d93dc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A transaction no longer hands its connection back to the pool in a state that
  can harm the next request. On PostgreSQL and MySQL, a connection whose
  ROLLBACK cannot be confirmed is now closed instead of reused, since it may
  still be inside the abandoned transaction. This now holds for transactions
  opened through `getDrizzle().transaction()` too, as core services open them:
  those also return their connection when BEGIN fails, instead of leaking it,
  and report the work's own error rather than a failed ROLLBACK's. On MySQL, a
  transaction run with `timeoutMs` now puts the session's own lock wait timeout
  back when it ends, instead of leaving its timeout on the connection for every
  later query.

- [#2190](https://github.com/nextlyhq/nextly/pull/2190) [`b11dab5`](https://github.com/nextlyhq/nextly/commit/b11dab5381073b25230c57ff19c390e34e55df40) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A translated field that is made shared now keeps its content. Its default
  language's value becomes the shared value, and every other language's value is
  written to the localization archive before the translated column is removed;
  before, every language was dropped with the column. This holds for collections,
  Singles and field groups, through the Schema Builder's save and its schema
  dialog.

  The change is refused before anything is altered when the archive cannot be
  written, when the field is Required or Unique, which its new shared column
  cannot satisfy until the values are copied into it, and when the same edit
  changes how the field is stored (its type, length or precision); the message names the order that works.

  `nextly i18n:restore --field <name>` brings one field's archived values back
  once it is translated again, by the field's name or its column name; a value
  archived more than once comes back from its newest row.

- [#2155](https://github.com/nextlyhq/nextly/pull/2155) [`88106e4`](https://github.com/nextlyhq/nextly/commit/88106e4a10ccf20360f5fdf092da12e577c8d6aa) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The database adapter's `upsert` refuses the same malformed calls on every
  dialect: a conflict column named twice, and keeping an existing row (nothing to
  update) by a conflict column left for the database to fill, which the row could
  not be read back by.

  On MySQL, `upsert` also refuses a table without a primary key, since it reads
  every row it returns back by that key. An auto-increment id passed as
  `undefined` or `null` no longer hides the one MySQL generated. A row whose
  primary key an update trigger changed is still found and returned.

- [#2123](https://github.com/nextlyhq/nextly/pull/2123) [`f8ac3d9`](https://github.com/nextlyhq/nextly/commit/f8ac3d96b23a3fe1235c0f9e8f1365d92d9d5664) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The database adapter's `upsert` now works on MySQL. It used to call a conflict
  clause MySQL does not have, so every upsert there failed. MySQL cannot hold a
  duplicate to one key, so on MySQL `upsert` accepts a table only when its
  conflict columns are its one unique key besides the primary key, and refuses any
  other table before writing, naming the other unique keys. On a table it accepts,
  it means what it does on PostgreSQL and SQLite:
  - the row is inserted first, or the row holding that key is updated, found by a
    locking read that sees rows other transactions have committed, all in the
    caller's transaction or in one of its own;
  - keeping an existing row runs no update triggers;
  - the row returned is the one stored, read by its primary key, even when a
    trigger changed its key;
  - a primary-key collision is refused as a unique violation.

  The conflict columns must be given values.

  An upsert that names no column to update now keeps the existing row and returns
  it on every dialect, without failing, so it can write a row once inside a
  transaction.

- [#1888](https://github.com/nextlyhq/nextly/pull/1888) [`109ff0a`](https://github.com/nextlyhq/nextly/commit/109ff0ac4fe2f3b238c7afcf7e47068eb892f3bd) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - User emails are lowercased when an account is created, so an address typed
  with any capital letter is now findable at sign-in instead of permanently
  failing with "Invalid email or password". Creating an account whose email
  matches an existing one is now rejected as a duplicate — including
  repeating an address an earlier version stored with uppercase letters — and
  findByEmail keeps finding those legacy accounts by their stored spelling.

- [#2224](https://github.com/nextlyhq/nextly/pull/2224) [`d12d85a`](https://github.com/nextlyhq/nextly/commit/d12d85a1fb42ac991d4c939b06bd323778ff59d4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Version pins hold under every race, and their handles belong to the feature
  that registered them. Retention and a pin read the pins with a locking read,
  so on MySQL a pin committed after a save's first read is still seen and its
  version kept. A pin locks its collection's or Single's registry row, so a pin
  racing that entity's deletion is refused rather than left behind.
  `registerVersionPinHolder` now returns the holder's handle, and
  `versionPins.holder(name)` is gone, so no code can reach another feature's
  slots by name; Workflows registers itself when it ships rather than being
  registered in advance. Orphaned collections removed by a sync, and orphaned
  Singles removed by the dev build, take their pins and autosaves with them.

- [#2254](https://github.com/nextlyhq/nextly/pull/2254) [`9b2fef1`](https://github.com/nextlyhq/nextly/commit/9b2fef199c0e234cd11066e0ea138b9b0484d40b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's "changed in the last 24 hours" figure fails closed: when the registry read that
  names the collections kept off the dashboard fails, the figure is 0 and no activity is counted,
  rather than counting the activity of the collections it promises to leave out.

  `WidgetFieldChoice`, the type of a widget source field's value labels (`WidgetSourceField.choices`),
  is exported beside `WidgetSourceField` from `nextly`, `nextly/config` and `@nextlyhq/plugin-sdk`.

- [#2114](https://github.com/nextlyhq/nextly/pull/2114) [`58a3b4b`](https://github.com/nextlyhq/nextly/commit/58a3b4b4d66cd598e84a612d9d4cd4c49ef99068) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Startup's check of declared widgets' starting queries no longer refuses a
  fresh install: a collection or Single the code defines that has not reached
  the database yet is checked at a later start, so `/setup` can run. With no
  declared widgets the check reads nothing. A query operation or an example
  that cannot be written out is now reported with the other faults, instead
  of stopping startup with a raw error.

- [#2170](https://github.com/nextlyhq/nextly/pull/2170) [`e5c5d16`](https://github.com/nextlyhq/nextly/commit/e5c5d16668eeda6631ed6c4f37432f8fcfffd812) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The generated admin component import map now imports the component each
  widget declared under `contributes.dashboard` draws with, and exports the
  list of component paths it registers as `registeredComponentPaths`, so what
  a map holds can be read without running it.

  A plugin widget in today's shape that declares `minSize` and `maxSize` is now
  offered only the widths between them; before, every width was offered.

  A `list` or `table` example, or answer, whose `fields` are not columns
  (`name`, and optionally `label` and `type`) is refused, as its rows already
  were.

  Startup now stops, with a message to start again, when the collections or
  Singles registry cannot be read on a database that is set up, rather than
  admitting declared widgets it has not checked. A fresh database still starts
  so `/setup` can run.

- [#2172](https://github.com/nextlyhq/nextly/pull/2172) [`f47aa01`](https://github.com/nextlyhq/nextly/commit/f47aa01a61876dfb1d53a5cedaeb9f4b05ae1c06) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard widget sources leave out content kept off the dashboard, answer an unavailable source
  with a typed code, and name system fields and choice values the way people read them.
  - A collection or Single marked `internal`, or hidden from the admin's navigation
    (`admin.hidden`), gets no widget source, no generated card, no place in the Content figures and
    no pending-edit count, for every caller including a super-admin. A widget query naming one is
    refused exactly as an unknown name is. Content a plugin hides because it has screens of its own
    stays reachable there.
  - A widget slot refused with the shared "unavailable source or unsupported op" sentence now
    carries `code: "unavailable"`, so a card can show its "not available" state without matching
    the sentence. An unknown collection or Single name now takes a read decision as a forbidden one
    does, rather than being refused before any, so a batch no longer skips that step for the names
    that are not real.
  - System columns carry labels (ID, Created, Updated, Status, First published). Status, select and
    radio fields carry their value labels as `choices` on widget sources and on list result fields,
    and a `groupBy` result now describes its grouped field.
  - A widget source whose declared value labels a card could not draw (choices that are not a
    list, a value that is not a string, an empty label, or one value named twice) is refused when
    it registers. A select or radio field whose stored options name one value twice keeps the
    first, as the entry form shows it.
  - The dashboard's "changed in the last 24 hours" figure leaves out content kept off the
    dashboard, and the Singles card points to the full list, rather than saying there are none,
    when the first Singles it reads are all kept off the dashboard and more follow.

- Updated dependencies [[`57bcb18`](https://github.com/nextlyhq/nextly/commit/57bcb188b3c33ac3c543aa491368a9c65f51166a), [`ce962c7`](https://github.com/nextlyhq/nextly/commit/ce962c7c0eda26659674261f544ea545e48afa2e), [`f6b972f`](https://github.com/nextlyhq/nextly/commit/f6b972f47252e9238a3f6dfef3fb1083a8aad8c1), [`357cd7f`](https://github.com/nextlyhq/nextly/commit/357cd7f02360dee17759cbb5fb0d44b2aa74453a), [`4c13e6d`](https://github.com/nextlyhq/nextly/commit/4c13e6dbbfb1fc0f5720108231e2a20b16f10162), [`27b47fe`](https://github.com/nextlyhq/nextly/commit/27b47feeaaa8a1610a9794c46c33c1e2b1e7977c), [`b7948bb`](https://github.com/nextlyhq/nextly/commit/b7948bb87d4b4958a6a5b662076dd87501f1e0fa), [`1db672e`](https://github.com/nextlyhq/nextly/commit/1db672eafeeff8ea745d5eee893378ebeac7a001), [`2a41096`](https://github.com/nextlyhq/nextly/commit/2a410960b019a4c5c73ae0980ed871579efe9ac1), [`755d99c`](https://github.com/nextlyhq/nextly/commit/755d99c195aacea8337ad45d6ba976719cd2d0d8), [`6846b88`](https://github.com/nextlyhq/nextly/commit/6846b88b977c68583bdd4be4097384af634816da), [`43f7c5e`](https://github.com/nextlyhq/nextly/commit/43f7c5efaa0e1c30f56e4dc19be77eb519031d77), [`c753694`](https://github.com/nextlyhq/nextly/commit/c7536940991ac40a815df4b08202ce135b508881), [`14f98f7`](https://github.com/nextlyhq/nextly/commit/14f98f7c1d0444330509289895c22140b82a2425), [`841a74e`](https://github.com/nextlyhq/nextly/commit/841a74eec75b7cff3218a4ed39bca03a5ce1f24e), [`b2cf477`](https://github.com/nextlyhq/nextly/commit/b2cf477bd443e889748c9530e691aac5814b8c47), [`3bf9a8e`](https://github.com/nextlyhq/nextly/commit/3bf9a8edef4f72d93bdc7c5289f647b8ddb53c1e), [`810cc77`](https://github.com/nextlyhq/nextly/commit/810cc778909cf9a67734e704b8d913aa50b4d1a1), [`c3d368c`](https://github.com/nextlyhq/nextly/commit/c3d368cdafc07d84db578bd08f993d8ce018a22e), [`028c4a0`](https://github.com/nextlyhq/nextly/commit/028c4a0c1c10876b983f86016eb204c58505f028), [`07bf1f9`](https://github.com/nextlyhq/nextly/commit/07bf1f9b9d2f1cf073ca0eda870d45b2a62220a4), [`3b7c77f`](https://github.com/nextlyhq/nextly/commit/3b7c77f0f16124f9632e8b953e5f7b43cf63c40f), [`e78ff48`](https://github.com/nextlyhq/nextly/commit/e78ff48a364bd92431c4e9398b5607c00edb82b2), [`b2e486d`](https://github.com/nextlyhq/nextly/commit/b2e486dfa1f513fdc9e797909c3e27dd30aa65d4), [`54292bd`](https://github.com/nextlyhq/nextly/commit/54292bdc543bb65baffcbd87538889307f136f54), [`736748a`](https://github.com/nextlyhq/nextly/commit/736748a29d04e26f089b21b5ac7a45eb6916aafa), [`07a3cf1`](https://github.com/nextlyhq/nextly/commit/07a3cf1d62a77b274e4434ab4b7bd7b3852d4643), [`b9493fe`](https://github.com/nextlyhq/nextly/commit/b9493fe3ec23ceb82c763a406271e82e24a31305), [`d5fee41`](https://github.com/nextlyhq/nextly/commit/d5fee4133cdec199bc09c7c897ba258123a82018), [`a8f3251`](https://github.com/nextlyhq/nextly/commit/a8f325173ce525b7649e8eb5b907f323239d20d6), [`e4e5088`](https://github.com/nextlyhq/nextly/commit/e4e508876d3b6ca2f64b87088ad915b32114f3da), [`9064005`](https://github.com/nextlyhq/nextly/commit/9064005f83b13d6e1d678f8bc7c1d182513b5758), [`24f9dfd`](https://github.com/nextlyhq/nextly/commit/24f9dfd1d58eaea7c7d4a699737d73d71f10e71c), [`b2e4ce0`](https://github.com/nextlyhq/nextly/commit/b2e4ce038c3eb91005ae55cc36ef6bfcc96b823d), [`5ba07e9`](https://github.com/nextlyhq/nextly/commit/5ba07e9db2dab60180e66489df4db4da04cbdc09), [`d1fe962`](https://github.com/nextlyhq/nextly/commit/d1fe9629968d560383f410529d1e48d9b4055cec), [`bd15d17`](https://github.com/nextlyhq/nextly/commit/bd15d178b211c7938b480837b12691a2be622267), [`c02c9f9`](https://github.com/nextlyhq/nextly/commit/c02c9f98b2b17670a3742138d667de586ca83acb), [`a118daf`](https://github.com/nextlyhq/nextly/commit/a118dafe8ef277ffb272bcbf039cb273e5eabd07), [`ba18126`](https://github.com/nextlyhq/nextly/commit/ba181269bb1708918795d269ed33d900c1eabc26), [`c75ce69`](https://github.com/nextlyhq/nextly/commit/c75ce6960d703fba9dc19baff4ba0eccbd7ec756), [`96686eb`](https://github.com/nextlyhq/nextly/commit/96686eb372973de731ccfb66c65fef364306a4c9), [`0fdc420`](https://github.com/nextlyhq/nextly/commit/0fdc42019dfb41006f17a37ed63d44d304ee3388), [`9781341`](https://github.com/nextlyhq/nextly/commit/97813419118b0b16cc223b3cb8ffdd97b3c05ac9), [`209b10c`](https://github.com/nextlyhq/nextly/commit/209b10c0806f9a92b94c35229df5d66cd1aa84ce), [`c731d75`](https://github.com/nextlyhq/nextly/commit/c731d75f8a8eb6a803169de3067675fbf969c7f2), [`abe6ace`](https://github.com/nextlyhq/nextly/commit/abe6ace9622af4582016db060dcf3a2c9d18a49c), [`39cd056`](https://github.com/nextlyhq/nextly/commit/39cd056b4f380394417191385c43097c5547f285), [`bd8a2e9`](https://github.com/nextlyhq/nextly/commit/bd8a2e9bd2a831f83797697a241a5c1bf269abc6), [`6d1883d`](https://github.com/nextlyhq/nextly/commit/6d1883d31e4eed6fa963a01cdd8363a87fa69e46), [`1c5fcee`](https://github.com/nextlyhq/nextly/commit/1c5fcee140dc76b622d388c7885dd8ad6d0e078d), [`b2393fe`](https://github.com/nextlyhq/nextly/commit/b2393fe27b24bd7761ad6d7c0de1fd58d67e98e8), [`a18fade`](https://github.com/nextlyhq/nextly/commit/a18fade4d310d38ff8f88dac09350770932006d2), [`594d727`](https://github.com/nextlyhq/nextly/commit/594d7275a2a59d271916d239e3b2099602a8f613), [`5eaabac`](https://github.com/nextlyhq/nextly/commit/5eaabac7756e765c17376e8b3eec4a3d8a35bb12), [`fe36198`](https://github.com/nextlyhq/nextly/commit/fe361983d76fd2ff7426ba7a84fad28b304a2a87), [`6eec099`](https://github.com/nextlyhq/nextly/commit/6eec099d96bffc7649485ff716bbb2eeaf00631b), [`9c76108`](https://github.com/nextlyhq/nextly/commit/9c761085b0e68a2e7fe5e6f9598b239fd0f9f047), [`40ce55b`](https://github.com/nextlyhq/nextly/commit/40ce55b9446bbff25ff3157209614c34e5164e78), [`8d6a0cb`](https://github.com/nextlyhq/nextly/commit/8d6a0cbd14b739c3e42476f7a972d2bf2f1200e7), [`ca866a0`](https://github.com/nextlyhq/nextly/commit/ca866a0fc2029df5eb5c4c7b9b74e437036e5239), [`2cfea22`](https://github.com/nextlyhq/nextly/commit/2cfea22947d17790e605679b03465a33078c4103), [`fc8c902`](https://github.com/nextlyhq/nextly/commit/fc8c902808b85f21651854f0e45c49305eb2739b), [`224e51a`](https://github.com/nextlyhq/nextly/commit/224e51a1657558916fe0990d25134b90a0ca3e48), [`7dfb74b`](https://github.com/nextlyhq/nextly/commit/7dfb74bdf4c7e9bb74c8afb6c635d42189e110a9), [`b766e82`](https://github.com/nextlyhq/nextly/commit/b766e8239c7d86ccd9ad1ed82b983675ed2e2573), [`8561690`](https://github.com/nextlyhq/nextly/commit/8561690befe9d08634e9c7bc9d7de2d22fe6ece8), [`fdff3a8`](https://github.com/nextlyhq/nextly/commit/fdff3a8da69228989eec2ab7e7fdda6a87722f5a), [`d69c112`](https://github.com/nextlyhq/nextly/commit/d69c112db7b48dadfa075e3e901492562920f986), [`59a1e9a`](https://github.com/nextlyhq/nextly/commit/59a1e9adc0d2510a8e6f45c1649bd71e159bddc5), [`43f48ed`](https://github.com/nextlyhq/nextly/commit/43f48ed581b4fdccb604088b6b4f9f29635c4978), [`d03cde4`](https://github.com/nextlyhq/nextly/commit/d03cde4efc6340656dc4e8ecaf27a06c4bc8477a), [`523adc3`](https://github.com/nextlyhq/nextly/commit/523adc317e21cab0b029cd08706d08578666b4b1), [`774d4c5`](https://github.com/nextlyhq/nextly/commit/774d4c54329ae3e9061d168fc4ee0c5a07718977), [`285b88b`](https://github.com/nextlyhq/nextly/commit/285b88bde0f5ac2690eb98041d70910ca33f5fba), [`436b3bd`](https://github.com/nextlyhq/nextly/commit/436b3bddaf0d97a295c0bf20a78b1632bcb712d2), [`6e12fe5`](https://github.com/nextlyhq/nextly/commit/6e12fe518fda967b429f579f9d33f3166b250cb6), [`4e27dce`](https://github.com/nextlyhq/nextly/commit/4e27dce8fcdffa28f5283652f03b9fcb017fd343), [`7076ae4`](https://github.com/nextlyhq/nextly/commit/7076ae4811bdacaf730dca6556afad0644dbbf60), [`12d1c70`](https://github.com/nextlyhq/nextly/commit/12d1c70c355742645c4c5276d2aa38f0b81bd4fd), [`918f7f0`](https://github.com/nextlyhq/nextly/commit/918f7f0505669b9fede1fc832ae202d77118f459), [`92317b6`](https://github.com/nextlyhq/nextly/commit/92317b6b85e63e42e44c1b2b55b9060e387e6676), [`1b957e9`](https://github.com/nextlyhq/nextly/commit/1b957e9de798dfa2bfcd9d6dc9dc7b69d666f38d), [`8c6956f`](https://github.com/nextlyhq/nextly/commit/8c6956fb5eed9a8ba7663523955fd0d5d0ff9eca), [`e1e391b`](https://github.com/nextlyhq/nextly/commit/e1e391b3e5e90243220389ec1885061d6bb22419), [`e356b75`](https://github.com/nextlyhq/nextly/commit/e356b753086c530949efa44e7c64dae9d986d8ee), [`4358d85`](https://github.com/nextlyhq/nextly/commit/4358d8586a085bc650f3ab5c398ac7b3500c96a3), [`2011f67`](https://github.com/nextlyhq/nextly/commit/2011f67edc438869e7f5740f46b35b4b8bb1fe29), [`b24afb3`](https://github.com/nextlyhq/nextly/commit/b24afb3369d40b1a4bab1a9e7c7855f667b763a0), [`e4bab4c`](https://github.com/nextlyhq/nextly/commit/e4bab4ca033d1c214742bf6c48457b0176e2896b), [`b83f351`](https://github.com/nextlyhq/nextly/commit/b83f351fd17906ef81da570bebe9972a4c602675), [`c399249`](https://github.com/nextlyhq/nextly/commit/c3992494bcf8c99c9a43f322f0cee9ce66a0030e), [`5e42de7`](https://github.com/nextlyhq/nextly/commit/5e42de7fce3a95c81501e26eaa31cc5fba0e2f8b), [`a3d2ed7`](https://github.com/nextlyhq/nextly/commit/a3d2ed715cb51ff86779e32f47ef4ff291918982), [`612e8b3`](https://github.com/nextlyhq/nextly/commit/612e8b33d9e2959c8d6746359b3fd05c632e2dba), [`684bf04`](https://github.com/nextlyhq/nextly/commit/684bf046fbca51c4cecf09bc62846ae5501658d4), [`9a94294`](https://github.com/nextlyhq/nextly/commit/9a94294831de5d3ee20be0faab0c4ac104b28790), [`47c601c`](https://github.com/nextlyhq/nextly/commit/47c601c62078d8068c881dd4e8633aa199d292d5), [`6da6a14`](https://github.com/nextlyhq/nextly/commit/6da6a1475dc4133bf6fa36493934dfad7e9e5a23), [`e19c50c`](https://github.com/nextlyhq/nextly/commit/e19c50c22c343d26c775f45dcb2b0c61bbf17032), [`5abf993`](https://github.com/nextlyhq/nextly/commit/5abf993d28f9fb788c7994ea0278cfc27284a73e), [`54fc42e`](https://github.com/nextlyhq/nextly/commit/54fc42e73ef618679d2bcbcb239c73df13a3d1c3), [`1e66080`](https://github.com/nextlyhq/nextly/commit/1e66080378a44e6fa5b0970d75f7242ce4a1dcd5), [`332464a`](https://github.com/nextlyhq/nextly/commit/332464ab7cba67b7db197ecd528678c229f94dcd), [`9e59e71`](https://github.com/nextlyhq/nextly/commit/9e59e714ed73a037c210cf9cb2b15ba2d180b15f), [`2569fb4`](https://github.com/nextlyhq/nextly/commit/2569fb468234701e974e1e6e467b238a09da2c11), [`a64a46d`](https://github.com/nextlyhq/nextly/commit/a64a46dc94b86a9b58e9457dc8519da73a5e73ce), [`12c7d4d`](https://github.com/nextlyhq/nextly/commit/12c7d4ddde46c01d253a153e96ae57d1ca406f09), [`75c0bab`](https://github.com/nextlyhq/nextly/commit/75c0babb41e062dec1cf6819ebb71819ea3935fc), [`9225d83`](https://github.com/nextlyhq/nextly/commit/9225d83bcf412df81cda8b841fceb3725e13c6d6), [`5a401d3`](https://github.com/nextlyhq/nextly/commit/5a401d3b812480b7fe23f40ea224b90d365f53f4), [`f6b92ff`](https://github.com/nextlyhq/nextly/commit/f6b92ff3208d6d291284310f6cd306ed24615b21), [`2b43000`](https://github.com/nextlyhq/nextly/commit/2b43000b04e55ba09ec1d6691ba2e9a83a4f0245), [`3ec673e`](https://github.com/nextlyhq/nextly/commit/3ec673e41723675a4f4c7c025cc8fbac41458a87), [`a6dffe0`](https://github.com/nextlyhq/nextly/commit/a6dffe0764584d237f14a3f615d6debe9160bb69), [`b7a1ddc`](https://github.com/nextlyhq/nextly/commit/b7a1ddc13a9ade0e7430a4b8a2aabfc10c0fb09c), [`fb869f8`](https://github.com/nextlyhq/nextly/commit/fb869f8ce38113ca85f490faf3d79e2b72db7c5b), [`de3b862`](https://github.com/nextlyhq/nextly/commit/de3b8625f3420ffeae51ab634faa002d902af1e6), [`7c95265`](https://github.com/nextlyhq/nextly/commit/7c95265fbb709eac6a3b11954cea15b927af3644), [`9bc8e7e`](https://github.com/nextlyhq/nextly/commit/9bc8e7e336e985f17bc93fe2d6d1dd479d00eb96), [`73838d3`](https://github.com/nextlyhq/nextly/commit/73838d3bc9f326f271ab8fbc4b03b49cfe25ea36), [`d6a1ff8`](https://github.com/nextlyhq/nextly/commit/d6a1ff843aa48ca2f790d4db293393462005c74d), [`fa7b3f3`](https://github.com/nextlyhq/nextly/commit/fa7b3f3f94a0f8b86b046cfc90bd75a964bb74d1), [`f48d96e`](https://github.com/nextlyhq/nextly/commit/f48d96e2e7a1c42b69808f3e7877d2b3a5fbda4d), [`8ce9f7e`](https://github.com/nextlyhq/nextly/commit/8ce9f7eabe101bf5687e86f47a04abd0ecd89419), [`bdfd1ce`](https://github.com/nextlyhq/nextly/commit/bdfd1ce5f1e5c74cdde960e96f46625fec27b3a6), [`8a5bf08`](https://github.com/nextlyhq/nextly/commit/8a5bf084b4f5d79142afd41152b3c3e4a217091c), [`aefdad6`](https://github.com/nextlyhq/nextly/commit/aefdad6eef616bc8d2014dc685e496eff8c4d4c0), [`952c89a`](https://github.com/nextlyhq/nextly/commit/952c89a19d5558ec2d984fd1f603411c334d6490), [`5af99e6`](https://github.com/nextlyhq/nextly/commit/5af99e6080f17f13886591faac95817fa7a41676), [`61d8b4a`](https://github.com/nextlyhq/nextly/commit/61d8b4a0d93894a40ed4a352e65a893666e408e1), [`a714165`](https://github.com/nextlyhq/nextly/commit/a7141651aaeabe204a267366b6ef703a42033d00), [`da70ca3`](https://github.com/nextlyhq/nextly/commit/da70ca34135160744cc5265df49f947362fa414d), [`7745c53`](https://github.com/nextlyhq/nextly/commit/7745c536ede4ed877455622cae190a320114187a), [`690aed6`](https://github.com/nextlyhq/nextly/commit/690aed61277cea2406af2227a9bf6d0eb726bffb), [`01f2f00`](https://github.com/nextlyhq/nextly/commit/01f2f00276358d2ef616dda7c5fed802efdf3de3), [`2956ea2`](https://github.com/nextlyhq/nextly/commit/2956ea206c2c517185d1c2f7eb051a39bb919758), [`dbcd8e6`](https://github.com/nextlyhq/nextly/commit/dbcd8e64961a7ab860085455229bec064d77845d), [`dae7727`](https://github.com/nextlyhq/nextly/commit/dae7727dfd610ffbffd24ed98f50de42959bcef6), [`3afbf72`](https://github.com/nextlyhq/nextly/commit/3afbf72175575a2191474892de2b81d9b50894ff), [`55cbb55`](https://github.com/nextlyhq/nextly/commit/55cbb55c7c7e5500cc7bfd3d62188e76ee48cca1), [`590c7bb`](https://github.com/nextlyhq/nextly/commit/590c7bb0008a50458dacb07adbda59c37f95ea28), [`bad1fdd`](https://github.com/nextlyhq/nextly/commit/bad1fdd9ecb93911045276f0e485f05f4fec0660), [`e4232b0`](https://github.com/nextlyhq/nextly/commit/e4232b0b0afcf198a390f51707e80277b509fd54), [`77ad05e`](https://github.com/nextlyhq/nextly/commit/77ad05ed4d8e79961471d4ce15b88f7edc89a315), [`07578df`](https://github.com/nextlyhq/nextly/commit/07578dff92ee3f75793c79476d5a0c753a997f5b), [`024ab80`](https://github.com/nextlyhq/nextly/commit/024ab80657b838e91eeba77381e0cd00a9194680), [`3cc3205`](https://github.com/nextlyhq/nextly/commit/3cc3205d864d77f8a44390d1f9aed5da1b26b938), [`9b52955`](https://github.com/nextlyhq/nextly/commit/9b529559f61d19c170cf150fe2aa1ebd8bccae58), [`dbc00a1`](https://github.com/nextlyhq/nextly/commit/dbc00a1f5315f03b49e6aefc64c5d946ceb17c64), [`4b2a44a`](https://github.com/nextlyhq/nextly/commit/4b2a44a485b779793b262cf56e8dc5a7b903f9fd), [`e736c38`](https://github.com/nextlyhq/nextly/commit/e736c3840892962f13cbeda016f015808136e804), [`9bd3e88`](https://github.com/nextlyhq/nextly/commit/9bd3e88f32e856cd39f6fd95b2cd04fdb1042656), [`3c81164`](https://github.com/nextlyhq/nextly/commit/3c81164927d177d9fb41113e4c2acbca4522e9eb), [`e5f7271`](https://github.com/nextlyhq/nextly/commit/e5f727192c7cec8ee04dda41a71ea227d01ea05c), [`04ac714`](https://github.com/nextlyhq/nextly/commit/04ac7145684096ed3887fe6c2faf0dffb740f5b0), [`3789b82`](https://github.com/nextlyhq/nextly/commit/3789b82c0aed30018a1af81f27b6fc5ed2c9b375), [`1e1697a`](https://github.com/nextlyhq/nextly/commit/1e1697acb9652f5addde81f12738ce15ac680bb0), [`fd9d7bc`](https://github.com/nextlyhq/nextly/commit/fd9d7bc7e6876d0b5594ed451d70c7d451aa9ca6), [`60c2857`](https://github.com/nextlyhq/nextly/commit/60c2857b5e2f810f1a9b5b9a80e4549836a4baae), [`14bf617`](https://github.com/nextlyhq/nextly/commit/14bf6178497f37afe592e736f8b9d973cb89ca0d), [`69b1033`](https://github.com/nextlyhq/nextly/commit/69b1033e3d7a80e21f5982c550bdfddd810cecb0), [`1ba417e`](https://github.com/nextlyhq/nextly/commit/1ba417ed4cf2ab49d8359dabb622e3589f0baabe), [`bcbc487`](https://github.com/nextlyhq/nextly/commit/bcbc4876f0dfe7a2d73c351d319c7a4b041dd9b5), [`a19118b`](https://github.com/nextlyhq/nextly/commit/a19118bc5a78b31ca1e5e7b6f5d8dc882a686514), [`3fa821e`](https://github.com/nextlyhq/nextly/commit/3fa821e485c97243f41209c2308d51c5bbd5dc07), [`d694cf8`](https://github.com/nextlyhq/nextly/commit/d694cf826c9d5eee4555c5bb1af755d167970bba), [`b6cd7d8`](https://github.com/nextlyhq/nextly/commit/b6cd7d853a7890a097c6e545dccc22e19923ae6c), [`a592671`](https://github.com/nextlyhq/nextly/commit/a59267178be33fbc6f9e06af07613a98c9c3f365), [`dfa77b9`](https://github.com/nextlyhq/nextly/commit/dfa77b92273ef729b9ef70cfc00a804d286d9542), [`6983c80`](https://github.com/nextlyhq/nextly/commit/6983c80a44441497019f21f680d62ede4dba8581), [`d7fe37a`](https://github.com/nextlyhq/nextly/commit/d7fe37a0ffd5f9c6ef6aa3e049b26911fc6227bb), [`9418bd6`](https://github.com/nextlyhq/nextly/commit/9418bd64ca6353fceaae7c5af1eea4768170db08), [`9fe35d4`](https://github.com/nextlyhq/nextly/commit/9fe35d4650c645d8c3f2d237c418ba721c9f55a4), [`c05dd86`](https://github.com/nextlyhq/nextly/commit/c05dd8628414f9a4b179ddf4ceabbc737aa27127), [`bd48aff`](https://github.com/nextlyhq/nextly/commit/bd48aff453bf5eb9c26362cba4255e3ad209548e), [`70b4390`](https://github.com/nextlyhq/nextly/commit/70b4390224837d5ea9aea81965c9cea8ad9ec2f8), [`be4015b`](https://github.com/nextlyhq/nextly/commit/be4015bcdf4e8a3fc4b325be271742f9e0069c3c), [`9bb4f19`](https://github.com/nextlyhq/nextly/commit/9bb4f198966c47d97fe6f4fff7a3b8a8d7a4403c), [`5345c56`](https://github.com/nextlyhq/nextly/commit/5345c563b843741628e33fcb05e02bc1b0ab1ce6), [`0658c58`](https://github.com/nextlyhq/nextly/commit/0658c58a1d2f7a06b32e3c08068bfb5f3a50e7d2), [`c0cf3cc`](https://github.com/nextlyhq/nextly/commit/c0cf3cc41e314a97150438233ac11b76f7f96c1c), [`6067d2c`](https://github.com/nextlyhq/nextly/commit/6067d2c6c16c221d696a11ca0d5f37b8ef97fcb6), [`13191f2`](https://github.com/nextlyhq/nextly/commit/13191f2fde3b7970bd8b82f0a01ffe7e5ba6d4d9), [`b337a8b`](https://github.com/nextlyhq/nextly/commit/b337a8b2aec14c273cff9929b651e57765c3666b), [`048cc0e`](https://github.com/nextlyhq/nextly/commit/048cc0e2b37a527ad54b92576b854ce4d86ee69b), [`222afe2`](https://github.com/nextlyhq/nextly/commit/222afe231fac3a2d186c02b59ec8f97578f30090), [`7b578bf`](https://github.com/nextlyhq/nextly/commit/7b578bfefda0e48bcff3d1cccce2d6fbb15097aa), [`95a3318`](https://github.com/nextlyhq/nextly/commit/95a3318f5278a49fb82a5fa4ccd3093ef8f75ae8), [`afd9eb5`](https://github.com/nextlyhq/nextly/commit/afd9eb5a77eeb8a01b9dc27980dc99ebfa6d93dc), [`b11dab5`](https://github.com/nextlyhq/nextly/commit/b11dab5381073b25230c57ff19c390e34e55df40), [`88106e4`](https://github.com/nextlyhq/nextly/commit/88106e4a10ccf20360f5fdf092da12e577c8d6aa), [`f8ac3d9`](https://github.com/nextlyhq/nextly/commit/f8ac3d96b23a3fe1235c0f9e8f1365d92d9d5664), [`109ff0a`](https://github.com/nextlyhq/nextly/commit/109ff0ac4fe2f3b238c7afcf7e47068eb892f3bd), [`d12d85a`](https://github.com/nextlyhq/nextly/commit/d12d85a1fb42ac991d4c939b06bd323778ff59d4), [`9b2fef1`](https://github.com/nextlyhq/nextly/commit/9b2fef199c0e234cd11066e0ea138b9b0484d40b), [`58a3b4b`](https://github.com/nextlyhq/nextly/commit/58a3b4b4d66cd598e84a612d9d4cd4c49ef99068), [`e5c5d16`](https://github.com/nextlyhq/nextly/commit/e5c5d16668eeda6631ed6c4f37432f8fcfffd812), [`f47aa01`](https://github.com/nextlyhq/nextly/commit/f47aa01a61876dfb1d53a5cedaeb9f4b05ae1c06)]:
  - nextly@0.0.2-alpha.67
  - @nextlyhq/plugin-sdk@0.0.2-alpha.67

## 0.0.2-alpha.66

### Patch Changes

- [#1792](https://github.com/nextlyhq/nextly/pull/1792) [`da323d5`](https://github.com/nextlyhq/nextly/commit/da323d58366d362dfaadb7a1ab9593dbf98d18b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The schema builder's drag announcements name every field, and its row ids are
  only the ones the list mints.

  A field just added to the canvas has no label and no name until its author
  fills them in, and it drags in that state: it was announced as nothing at all
  ("Picked up , row 2") and, beside a named field, as "and Title". It is now
  called "an unnamed field", on the announcement and on the nested drag handle
  alike. A row id that is not `row-` followed by a canonical nonnegative integer
  no longer names a row, so a drop the reorder would refuse is no longer
  announced as a move.

- [#1697](https://github.com/nextlyhq/nextly/pull/1697) [`b87f0d3`](https://github.com/nextlyhq/nextly/commit/b87f0d3d0d6468c17bb9728738a1729b07c74230) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard card asserted a meaning its own data did not have. The status
  breakdown was generated for any collection carrying a field NAMED `status`, and
  the schema permits an ordinary field of that name with the publishing lifecycle
  switched off — so such a collection got a card titled "by status", describing
  the split "between draft and published", over a column holding whatever that
  author's field holds. It is now gated on the lifecycle capability itself, which
  is what the health card beside it already read.

  A chart's placeholder rows were told apart by styling alone. A bucket holding no
  value and one holding the literal text `(empty)` were drawn in different colours
  and announced identically, so the readers who most needed the distinction were
  the ones without it. A placeholder now says what it is — "no value stored" —
  rather than relying on italics. Exact separation is not achievable, because no
  string can be reserved from a column of arbitrary text; what is fixed is that
  the placeholder describes itself instead of depending on something a screen
  reader never sees.

- [#1756](https://github.com/nextlyhq/nextly/pull/1756) [`705926b`](https://github.com/nextlyhq/nextly/commit/705926b091c1e6ab17fd4065d89dfc2d29c094b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The collections and singles cards no longer decide for themselves whether they
  have anything to show.

  A fresh dashboard made the same "get started" pitch three times: the setup
  checklist, the demo-content offer, and a third panel the collections card drew
  on its own when it had no counts. The singles card went the other way and
  returned nothing at all when the install had no singles -- and a card that
  renders nothing still holds its place in the grid, so the layout reserved an
  empty slot on every install that never used them.

  Both cards now declare a condition, and the host offers them only while it
  holds. Two names join the closed set a conditional widget may use:
  `collections:present` and `singles:present`, each true while this reader may
  read at least one. They are about what exists rather than what is in it, so a
  collection with no entries yet still counts as present -- it is still something
  to list -- which is what separates them from `content:empty`. The
  `GetStartedEmptyState` panel is removed; the checklist and the demo offer, which
  the host withdraws on their own, are the two pitches a new reader meets.

- [#1723](https://github.com/nextlyhq/nextly/pull/1723) [`4c03302`](https://github.com/nextlyhq/nextly/commit/4c03302fd9a8532e033c2cfb16a878a25408b9d0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard's setup checklist is answered by the server now, and shown only
  while there is something left to do.

  It used to derive its own steps in the browser from dashboard statistics, and
  decide for itself whether to appear by reading a dismissal out of
  `localStorage`. Both were wrong in the same direction. The steps were computed
  in two places from the same four counts, so they could drift; and dismissal was
  per BROWSER, which answers a question about a person — the same admin on a
  second machine met a checklist they had already finished, and a colleague met
  one reporting someone else's progress.

  The host answers both. It reports which steps this reader has finished, and the
  widget condition deciding whether the card is offered is DERIVED from that same
  answer — so a card showing every row ticked, and a card that will not go away,
  are both unreachable.

  Steps are detected rather than self-reported: nothing is ticked by hand, the
  install is asked. Only what can be answered about the reader is included, so an
  editor is never held short of finishing by content they are not allowed to see.
  The first step is complete for everyone, and truthfully so — reaching the card
  means an account exists and they made it. A checklist that opens above zero is
  finished far more often than one that opens empty, and that head start is worth
  having only if it is true.

  A transient card can now name SEVERAL conditions, and is offered only while
  every one of them holds.

  The get-started card needed two, and neither answers alone: is there nothing to
  look at, and is the offer of demo content still open. Declining that offer
  creates no content, so the card kept its slot on the strength of the install
  still being empty — visible, drawing nothing, for a reader who had already said
  no. The two conditions are scoped differently on purpose: whether there is
  content to see is about the reader, while whether a project took the demo data
  is recorded once for the project, so a second admin is not offered it again
  after the first declined.

  The dashboard's last browser-stored dismissal is gone with it. A hook that
  derived onboarding steps in the browser and remembered dismissal in
  `localStorage` had no consumer left once the host started answering, and the
  types beside it described a checklist that no longer exists — including a step
  vocabulary listing five names none of which are detected any more.

- [#1770](https://github.com/nextlyhq/nextly/pull/1770) [`732da46`](https://github.com/nextlyhq/nextly/commit/732da46718b4e1342ad517d05a276bcfaf45ef8b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An exposure row reports itself cleared when the winning clear erases its
  target — at its own path or an ancestor's, by any exposure — never when the
  clear is below it, and a cleared row's value is always absent rather than the
  clear sentinel.

- [#1773](https://github.com/nextlyhq/nextly/pull/1773) [`716adbd`](https://github.com/nextlyhq/nextly/commit/716adbd7b710559b33d9d568f187b310206e6bd5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The insert panel offers the site's components beside its blocks and patterns,
  and placing one writes a single instance node that keeps pointing at the
  definition — nothing is copied into the page. Component definitions now reach
  the editor through a route of their own, `GET …/library/components`, gated by
  the components collection's read permission and answering the canonical
  `{ items, meta }` envelope. It lists every lifecycle state the caller may read,
  so a never-published component can be placed on a draft page, and reads each
  definition by id AS THE USER so an author who may edit a component sees its
  working draft while one who may only read it sees the live definition. The
  canvas and the entry form's resting miniature both resolve instances against
  them, so a placed component renders in the builder — and stays rendered after
  Done — rather than as a could-not-be-loaded placeholder; both wait for the read
  and say when it failed, with a way to try again. A definition whose own root is
  another component is judged for placement by what that component draws, under
  the site's own document caps, and the panel says when a tier of the library was
  too large to load whole or could not be read.

  The component tier is read in the language the surrounding document is being
  edited in, as the public page reads it, so a localized component draws on the
  canvas as it will on the page; and a row without a title — a custom collection
  with none, or one field-level access redacts — is offered labelled by its id
  rather than left out.

  The Direct API's `findByID` now forwards `status`, so an untrusted by-id read
  can reach a row that was never published — a caller passing it before was
  silently ignored. A plugin route's caller gains `identity()`, which resolves
  once per request the identity an access rule is evaluated against — the user
  with their roles, and an API key's scope — so a route reading through the
  Direct API on the caller's behalf reads as the caller its own gate admitted;
  `PluginRouteIdentity` names its answer in the SDK.

- [#1827](https://github.com/nextlyhq/nextly/pull/1827) [`a6ea554`](https://github.com/nextlyhq/nextly/commit/a6ea554476000f65d384a2b169802c637154c96f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A component can no longer be saved into a shape where the library references
  itself.

  Components may place other components, so the library is a directed graph. A
  loop in it is not a crash — the renderer detects one and draws what it reached —
  but it leaves a gap where the loop closes, on every page placing anything on the
  loop, and nothing said how it got there. The editor already withheld the tiles
  that would close one, but that is a snapshot: an author saving against a library
  read that had since gone stale closed a loop anyway.

  The write now refuses, naming the chain to break — `Hero → Banner → Hero` —
  rather than leaving the author to find which placement did it. The check reads
  each referenced component as it currently stands, and refuses rather than
  guessing when it cannot read them all. A component the saving author cannot read
  is named only as `…`, so a refusal does not hand out identifiers.

  What it does NOT close is a chain that mixes lifecycle states. The published
  walk reads every state, so a component that has never been published can join a
  chain the public renderer cannot draw — it could not load that row — and a save
  is then refused for a loop no reader sees. Reading only public states is not
  available to a plugin: naming the state matches nothing on a site whose workflow
  calls its public state something else, and dropping the system-level read would
  hide a component the author cannot see, which is a MISSED loop rather than a
  false one. So it over-refuses, which is the recoverable direction.

  What it does NOT close is a loop that only an EXISTING placement of the saved
  component completes. A page or component already placing it may carry an override
  keyed for an exposure it does not yet declare, which is inert; declaring that
  exposure activates the override and can point a nested node back at the placer.
  Measured on the renderer: the same library composes cleanly before the exposure is
  declared and reports a cycle after, while the saved component judged on its own
  composes cleanly either way. Seeing it means asking which components place this
  one — the reverse direction, which neither the walk nor the composition of a
  single subject can supply.

  What it does NOT close is two authors closing a loop between them at the SAME
  moment. The check runs before its own write commits and takes no lock the other
  write contends for, and a plugin hook has no transaction to enlist in — so two
  saves that each read the other's document before either commits are both
  approved. Closing that needs a boundary the two writes share.

  A component's VARIANTS and its PLACEMENTS count as references. A variant may
  preset an exposed `componentId`, and a placement may override one on the
  component it places — so a definition whose stored ids look harmless can still
  resolve back to itself. Both the insert panel and the write judge a definition by
  what it can reach that way, so the editor does not offer a component whose insert
  the save would refuse.

  What decides a refusal is the RENDERER, not that scan. Overrides flow down
  through nesting, so a placement can re-point a node two levels below it: the
  scan is short by a level wherever that happens, and long by a stored edge
  wherever an override points one away from the loop. Both directions are real, so
  a save is judged by composing it with the same function that draws the page —
  the only answer guaranteed to match what a reader would see. The scan still runs
  first, because it is what can name the chain to break; it no longer has a vote.

  That is asked once per variant the component offers, and once for a placement
  naming none. Only one variant resolves at a time, so a loop that exists under
  one selection is real, and a scan that unions them all would refuse a component
  whose every selection is fine.

  A component that names ITSELF is refused from the submitted document alone,
  without reading the library at all — nothing in it can reopen an edge the
  document has already closed, and the reads it skips each run the site's hooks.

  A limit the composition reaches is not a report that there is no loop. Where a
  chain runs deeper than components may nest, the renderer stops before the loop
  closes and has seen nothing past that point — so the save is refused on the
  scan's own chain rather than approved on the renderer's silence. The same holds
  for a library it could not finish reading.

  Clearing a component's content is not the same as leaving it alone. A publish
  that also empties the field stores nothing, so it can close no loop, and it is
  allowed — where previously the accumulated draft was judged instead and the save
  was refused for a chain that very write removes.

  It judges the lifecycle form the write actually changes. An ordinary editor save
  is stored as a working draft and leaves the published row alone, so it is checked
  against what a preview would show; publishing checks the live library as well.
  Publishing an accumulated draft is checked too, even when the request carries
  nothing but the new status — that is the write that brings the draft's content
  live.

  It is deliberately a refusal rather than a warning: the author who closes a loop
  is not the person who sees the gap, so a notice would go to someone who has no
  reason to act on it.

- [#1786](https://github.com/nextlyhq/nextly/pull/1786) [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A component the editor offers, and one the canvas draws, are now judged
  against the same forest and read from the same row.

  A saved pattern keeps the instance nodes it held, so a pattern that places a
  component is a second way to copy that component into itself; editing a
  component now withholds those patterns by the same graph the component tier is
  filtered by. A pattern's nested instances are judged by what they DRAW rather
  than by the reserved instance type, which a parent rule read as unrestricted
  and a slot's admissions list refused outright — so a component drawing exactly
  what a slot asks for could not be placed in it, and one whose root belongs
  elsewhere could.

  The roots query follows a nested instance's own overrides, so a component whose
  only root that instance hides is no longer offered as placing something; and it
  survives a definition whose fields throw rather than taking the insert panel
  down with it.

  The library is paged from the last row seen rather than from an offset, so a
  component inserted or deleted by another author while the editor loads it can
  no longer be skipped and reported as a complete library. A completed component
  must be the row the listing named and must have been read whole: a row
  answering under a different id, or one whose document field an access rule
  removed, is left out and the tier reported cut rather than served under another
  component's name. Its keywords travel, so the palette can find it by them, and
  a store the plugin was told about is gated by the slug it actually reads.

  The entry form's resting miniature reads the component library only when its
  page places a component, instead of on every mount of every blocks field.

  An exposed visibility control now reflects a gate the component itself carries,
  rather than reporting a node as shown on a page the renderer withholds it from.

- [#1683](https://github.com/nextlyhq/nextly/pull/1683) [`fda49c2`](https://github.com/nextlyhq/nextly/commit/fda49c2876a4842ed47d4aa142b5bd6ec7f1eaab) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard could count and group entries but had no way to show either as a
  picture. Every chart meant writing a React component, which is how a dashboard
  stops looking like one product.

  Two archetypes now draw from a query the way `metric` and `table` already do,
  so an author declares a chart instead of shipping code: `bars` compares the
  buckets of a `groupBy`, and `timeseries` plots the points of a window.

  They are drawn here rather than by a charting dependency. The popular one pulls
  eleven packages — a state-management stack in every install's admin bundle for
  two shapes — and renders `role="application"`, which puts a screen reader into
  forms mode over a graphic that has no keyboard interface. Owning the markup is
  what makes the right pattern reachable: each chart is a labelled graphic with a
  text alternative naming what it shows, beside the same numbers as a real table.

  The bars run horizontally because their labels are whatever the grouped column
  holds — author names, tags, statuses — and a column chart has only its own
  width for those, which forces rotation or truncation. A capped bucket set says
  so rather than presenting a partial comparison as the whole one, and a
  timeseries labels each point in UTC, the zone its buckets were computed in, so
  the axis cannot name a different day than the server did.

  Every collection that can answer them now generates the two cards, beside the
  count, list and table it already generated — so the charts are something an
  install has rather than something a plugin author could build. A timeline is
  withheld from a collection whose only dates the read cannot bucket, and a
  status breakdown from one with no status column, because offering a card whose
  query is then refused is a card that draws an error on every load.

- [#1821](https://github.com/nextlyhq/nextly/pull/1821) [`2fa4696`](https://github.com/nextlyhq/nextly/commit/2fa4696c3e5becc4fc5fc954cb8d429a7ffe34ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A function default cannot read a field the caller may not write. A `defaultValue` written as a function receives the data built so far, and that data still held every value the caller sent, including one a field rule denies them, so a default could read the forbidden value and carry it into a field the caller IS allowed to write: the denied field was stripped and its value persisted anyway, one column across. The rules are now applied to a COPY, and the copy is what the functions read. The record itself is left alone until the pass that decides what is stored, because a rule may depend on a sibling the caller omitted precisely BECAUSE it has a default, and judging that rule before the defaults exist would deny it and lose the value for good.

  That copy is now defaulted and judged a second time before the record reads it. A field the caller may not write still takes its own declared default, and the pass that runs before the defaults has no key to judge because nothing supplied one; left in the copy, a later function default read it and carried it into a field the caller CAN write, so the rule was defeated one column across by the field's own default rather than by the caller's input.

  A config reload installs the live config's field functions, replacing them wholesale at the point the reload commits. Replacing rather than adding, so an entity the new config no longer declares stops deciding anything: a collection dropped from the config keeps its registry row and its table so an orphan sweep can find them, so it stays addressable. At the commit point rather than when the config is read, so a reload whose DDL succeeds and whose later sync fails does not leave a rule from a config the process refused deciding writes. The field-level registry holds every field's `access` rules, hooks, `validate` and function `defaultValue`, none of which survive being stored, and a reload never went back through service registration: an edit to any of them kept running the version from process start until the dev server was restarted. That is wrong in the direction that matters most for an access rule, since a rule tightened in the config was not the one being enforced. Applied on the same optimistic terms as the field-type registry, and restored by the same undo when a reload is abandoned.

  An access rule declared inside an unnamed container is captured. The registry keyed only named entries, so every rule, hook and validator inside an unnamed presentational group was dropped. `defineCollection` refuses a field with no name, but a plugin contributing raw config is checked on its field TYPES and not their names, so the shape reaches the live config.

  A Single's first read no longer invents an incomplete group. Filling a group for the sake of one defaulted child, while a required sibling has no default and no value, stored a document the next create or update would refuse; that insert runs no validation pass of its own. The group is left absent instead.

  The documentation no longer claims a field group's children take their defaults before the entry's hooks. They are written in their own pass afterwards, so the parent's hooks see such a child as absent.

  A `defaultValue` written as a function now works on a reusable field group's children. A field group's fields are read from its stored definition on every write, and a function does not survive being stored, so only constants applied there: a function default on a field-group child was silently dropped on every write. Field groups now get the same live-config capture collections and Singles have, so the function form resolves from the config at boot, and it is re-read when the dev server reloads the config. It resolves against the instance being built, so a child may compute from a sibling defaulted before it.

  Only the default is wired. The same capture holds a field's `access` rules, hooks and `validate`, and nothing reads those for a field group, so registering them changes nothing about whether they are enforced.

  The promote gate judges the draft the write actually commits.

  The gate that re-judges a Single's pending change before it is published ran before the write transaction, where it could only judge a copy of the world as it was. It now runs inside that transaction, on the draft the transaction has locked, which closes what a pre-flight check could not: a draft saved by another writer between the check and the commit is now the draft that is judged; a `beforeChange` hook that turns a status-less edit into a publish no longer slips past a check that ran before the hooks; and `publishAllLocales`, which applies every language's snapshot to one row, now judges the combined result rather than each language against its own shared values. Resolving the caller's grants is the one thing that cannot happen inside a transaction, since it queries the pooled connection that transaction holds, so it is resolved beforehand and handed in.

  A field rule on a child of a group or a repeater row is enforced. The check copied the snapshot shallowly, so the rules deleted a denied nested value from the copy and the original alike and the comparison then saw an unchanged container. A denied child is now found at its own depth and named at its own path.

  A publish is no longer refused over a field nobody touched. The comparison read the live document through a read that expands an upload or a relationship into the document behind it, while the snapshot holds the identifier, so an untouched field of either kind looked like an edit. Both sides now go through one conversion.

  A draft older than a newly required field is refused rather than published. The check judged the promoted document as a patch, which skips absent properties by design, so a snapshot written before a field became required reported nothing and published a document that violates the contract.

  An API key is judged on the grants stamped on the key, not on the database roles of whoever owns it.

- [#1768](https://github.com/nextlyhq/nextly/pull/1768) [`2bcccdd`](https://github.com/nextlyhq/nextly/commit/2bcccddfbb83b9d9e5a57a555cedb321ed4a85c1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every sortable table in the admin can be reordered from the keyboard, and a
  screen reader is told what is being moved.

  Two tables -- the collection fields list and the user fields page -- accepted
  only a pointer, so a keyboard user could not reorder them at all. They now use
  the same sensors as every other drag surface: Space or Enter picks a row up,
  the arrow keys move it, Space drops it, Escape puts it back.

  What a drag says has changed on every surface. The defaults read the
  draggable's id aloud -- "Picked up draggable item 3f9a…" -- and every id here
  is a field name or a uuid. A drag now names the thing and where it sits:
  "Picked up Title, position 1 of 4", "Title is over Body, position 3 of 4",
  "Title moved to position 3 of 4". On the dashboard the same sentences name the
  card and its column, matching what the Move buttons already say, so a card
  moved by keyboard and one moved by button sound the same. Each drag handle is
  also named after its row, so tabbing through them no longer reads as a list of
  identical buttons.

- [#1831](https://github.com/nextlyhq/nextly/pull/1831) [`b25490b`](https://github.com/nextlyhq/nextly/commit/b25490bc4af5bad91bc67a5333ec28295199e211) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field hook now runs for the fields a write touched, and reads the whole row
  either way.

  A localized update assembles the complete translation onto the row it returns,
  because the version snapshot and the outgoing events describe a translation
  rather than the one field of it that moved. Field hooks were selected by what
  was present in that row, so an `afterChange` handler on a sibling nobody
  edited started firing for an unchanged value — sending mail, re-indexing and
  calling out for a field the write never named.

  Which handlers run and what each handler can see are now separate questions.
  The set of touched fields decides the first; the row stays whole, so a hook
  that derives a search document from an unchanged neighbour can still read it.

- [#1677](https://github.com/nextlyhq/nextly/pull/1677) [`793c9c1`](https://github.com/nextlyhq/nextly/commit/793c9c120dbd3525c6b3be4fcc4cb53059a8891d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The engine's three whole-document measurements — `countNodes`, `treeDepth` and `documentBytes` — now refuse a forest they cannot afford to walk instead of grinding through it or raising a native error.

  They walk ENTRIES, not objects, and deliberately so: one node object placed in two slots is two elements of the document, and counting it once would report half a real size and pass a cap the document exceeds. That makes the walk exponential in depth for a forest whose branches share a node object — 21 shared objects reach 2,097,151 entries, and every further object doubles it.

  `documentBytes` was the sharp edge. `JSON.stringify` expands each shared node into a copy per path that reaches it, so it allocated 132 MB for 21 objects and raised `RangeError: Invalid string length` at 23 — from a document a few kilobytes in memory, in the one function that decides whether a document may be stored.

  All three now throw `ForestTooLargeError`, against the ceiling that fits what each one actually spends:
  - `countNodes` and `treeDepth` refuse past `MAX_VALUE_PARTS` (4,194,304) — the ceiling the op layer's preflight **already** refused values at, now shared rather than duplicated.
  - `documentBytes` refuses past `MAX_SERIALIZED_VALUES`, which is derived from the byte cap it protects: every serialized value contributes at least one byte, so a document that has emitted more values than the cap has bytes cannot come in under it.

  Sharing the first number is the point: a second, lower ceiling for the structural readers would let a dry run accept a document the apply then refuses, and would sit below `maxNodes` on a site that legitimately raised it. The serializer keeps its own because it bounds a different resource — a structural walk reads, while serialization BUILDS as it goes, so one numeral buys different amounts of work in each. Both are exported from the package root, and `@nextlyhq/blocks-engine/format` exports the error with `MAX_SERIALIZED_VALUES`, the only one bounding anything that entry exposes.

  The messages name the routes to the ceiling without claiming which one a caller hit, because no reader compares object identity and so none can tell. Inside `applyOp` the refusal arrives as an `OpError` like every other, so the `...Refusal` helpers still return a reason rather than throwing at their caller. Composition and the builder's deletion metadata degrade rather than propagate it: an unmeasurable subtree refunds nothing and reports no descendant count, so a page still renders and a block can still be deleted.

  Nothing a site can store is affected. `JSON.parse` produces fresh objects and cannot express sharing, so a stored document is never such a forest; the bound is reachable only by a forest built in memory by code.

- [#1706](https://github.com/nextlyhq/nextly/pull/1706) [`1bfc12e`](https://github.com/nextlyhq/nextly/commit/1bfc12eb4c3122d6e4984d69195f45061d281e5b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A spacing handle stopped following the pointer when a drag took a margin past zero.

  A margin dragged below zero is drawn on the other side of the block's edge, and
  its two sides swap roles when that happens. The handle kept the side it was given
  when the drag began, so once the value crossed zero it sat on the edge that no
  longer moves and the block stopped responding — the drag had to be released and
  started again to carry on.

  The handle now takes the side the band is drawn with as it is drawn, so a stroke
  that runs a margin from positive to negative keeps moving the block the whole way.

- [#1863](https://github.com/nextlyhq/nextly/pull/1863) [`6e22e58`](https://github.com/nextlyhq/nextly/commit/6e22e58f389affa7f922afb65cc4db8f3db5d63c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Fonts panel no longer warns that a font stack will be dropped when a `var()` names its custom property with a CSS hex escape. `var(--\62 rand)` is `var(--brand)` to a browser, and is now read as the same working substitution.

- [#1667](https://github.com/nextlyhq/nextly/pull/1667) [`48967c8`](https://github.com/nextlyhq/nextly/commit/48967c89417abfe6ad1e474eb7ea476b473274e0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A hook could not tell whether the write it was running on came from a browser
  or from a seed script, so a rule that only makes sense for a visitor, a rate
  limit or a honeypot, could not be written at the write seam at all. It had to
  live in one route, and a collection that grants public create has more than one
  door into it.

  Collection operations now accept the HTTP request that produced them, and the
  core resolves it into the facts hooks read as `ctx.req`: the headers, and a
  client address judged against this deployment's `security.trustProxy` and
  `TRUSTED_PROXY_IPS` rather than read raw off `x-forwarded-for`, which is
  whatever the sender chose to claim. `ctx.req.http` is absent when no request
  produced the write, and that absence is what tells a request-scoped rule to
  stand down instead of judging a server-side import as a visitor.

  Both HTTP doors pass it down, and `ctx.services.collections` takes it too, so a
  plugin serving its own route can hand over the request it was given. The form
  route's audit column now records the resolved address instead of the leftmost
  forwarded hop.

- [#1733](https://github.com/nextlyhq/nextly/pull/1733) [`cadd25b`](https://github.com/nextlyhq/nextly/commit/cadd25b48744ccc5a2658678b4164776e8c22d69) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A job handler is told which job it is running.

  Delivery is at-least-once, so one queued job can reach a handler more than
  once, and the documentation says to write handlers that survive that. It did
  not say how. The context carried the identity, the clock, a content API and the
  tick deadline, and nothing that identified the queued row, so a handler had
  nothing stable to key an external side effect on.

  It now receives `jobId`, the same on every attempt, which is the key to hand a
  payment provider's idempotency header or the unique column an upsert targets.
  It also receives `attempt`, counting from 1, which is written to the row before
  the handler starts, so a handler that dies part-way still leaves the count
  advanced. It is not the deduplication signal: `attempt > 1` says an earlier run
  began, not what it finished.

  The same page told operators to size `leaseMs` to the work. Nobody could:
  the built-in route passes only a batch size and a duration, and the public
  configuration takes job definitions alone. It was also the wrong advice, since
  the lease is renewed while a handler is alive and so already covers work that
  merely takes a long time. The page now documents the fixed lease as a stall
  tolerance and points at the key a handler can actually use.

- [#1814](https://github.com/nextlyhq/nextly/pull/1814) [`83a2e49`](https://github.com/nextlyhq/nextly/commit/83a2e4925aa0c1de40011bbcce25018ee7b9db72) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A many-to-many field's junction table is now followed by the table itself, not
  by the field that names it. A junction name reused for a field pointing at
  another collection is dropped and created again — before, `CREATE TABLE IF NOT
EXISTS` kept the old table and its old link column. Changing a field's
  `junctionTable` renames its table with the links in it, and pointing a field at
  another collection gives it a new table instead of none. Two many-to-many fields
  cannot store their links in one table, whether the name is the author's or the
  generated one, and a save that would move a junction off a table another field
  still uses, or onto one that already exists, is refused by name.

- [#1676](https://github.com/nextlyhq/nextly/pull/1676) [`419d5f2`](https://github.com/nextlyhq/nextly/commit/419d5f2b7666b42e3c2b02639835b44257401ff3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key is judged on its own grants at every access gate, not only the
  first one. Transaction writes, field-level access rules and the coarse
  collection gate all resolved the permissions of the key's OWNER when the key's
  own scope did not reach them, so a key issued to read could act with the
  authority of whoever created it.

  A permission now reaches a code-defined `access` rule in the spelling those
  rules are documented to receive (`posts:read`), so a rule written as
  `({ permissions }) => permissions.includes("posts:read")` decides the same way
  for an API key as it does for a session.

  The scope a plugin route handler receives is its own copy. Narrowing it in place
  now affects only that request, where before it edited the key's real grants for
  every request for the next five minutes.

- [#1656](https://github.com/nextlyhq/nextly/pull/1656) [`9893b11`](https://github.com/nextlyhq/nextly/commit/9893b119dbdd3fbc1f171b4ed9cf6146388d94bf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin route received the caller's account and nothing else. For a request
  authenticated with an API key that account is the key's OWNER, so the access
  check resolved the owner's roles and a key scoped to read was authorized to
  write whatever its owner could — reaching, for a key minted by a super-admin,
  the unconditional super-admin allow.

  `AuthenticatedScope` already existed for exactly this and is honoured by the
  collection access services; the plugin route path was the one surface it was
  never wired into. The key's own grants now travel with the account, from the
  dispatcher through `ServiceOpts` and `RequestContext` to the collection facade.

  A session caller is unaffected: it carries no key scope and resolves the same
  way it always has, super-admin bypass included.

- [#1695](https://github.com/nextlyhq/nextly/pull/1695) [`89f515b`](https://github.com/nextlyhq/nextly/commit/89f515b0d6a9e12a669a4a02ef173264b439a1e9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key is judged on the scope the request is CURRENTLY under, for
  the whole of an operation rather than at the one call that names it.

  A route that narrowed its own scope before a transactional write had the
  narrowing discarded: the transaction methods sit outside the plugin facade's
  wrapper, so the scope reached the argument and never a gate, and the write was
  judged on the grant the route had given up. The transaction params carry it now,
  including the delete path, where the owner predicate was resolved without it —
  so a key owned by a super-admin took a bypass that belongs to a session.

  A release operation resolves its target before it acts, and that lookup ran
  with no scope at all, so it read on the key OWNER's grants. The scope is pinned
  for the operation instead of handed to half of it.

  `narrowScope` accepts a caller that has none. A signed-in person reaches the
  same routes an API key does, and requiring each call site to guard that is how
  a `!` reached the documentation — where it was a crash for every session
  caller.

  The API-key scope built by the Single detail route named `actorType` and
  `permissions` only, so a documented `permissions.includes("site:publish")` was
  handed the stored slugs and denied a key that held the grant.

  Hand-writing that scope is refused rather than corrected again, and the refusal
  runs in two places because one is not enough. A lint selector rejects the
  literal — in either key order, shorthand, with a nested object between the keys,
  and with a spread standing in for the second half. The one shape it cannot see
  is a spread of an existing scope that replaces only `permissions`, which keeps
  every original row and so keeps naming a grant the caller has just given up;
  nothing in the syntax separates that from an ordinary config overlay, so
  `ruleFacingPermissions` refuses it where the disagreement decides the answer.

- [#1663](https://github.com/nextlyhq/nextly/pull/1663) [`5aae8fc`](https://github.com/nextlyhq/nextly/commit/5aae8fcf9386e47a94de8974c92a76b5727e0e21) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a component that a Layout still uses is now refused, and the message
  names the Layouts to go and edit. A Layout wraps every page assigned to it, so
  removing a component it uses would leave a gap on all of them at once — unlike
  an ordinary page, where the renderer draws one visible, recoverable
  placeholder.

  Draft Layouts count. A component named only by an unpublished Layout is on no
  page yet, and deleting it would break that Layout the moment someone publishes,
  by which time the cause is a deletion nobody remembers.

  The database could not have caught this: a Layout's areas are stored as one
  JSON column, so the reference to the component emits no foreign key.

- [#1772](https://github.com/nextlyhq/nextly/pull/1772) [`c80d0da`](https://github.com/nextlyhq/nextly/commit/c80d0dafd69f9825b75e1a33b97aeb7891575c2e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The collections and singles listings show exactly what the reader may open.

  Both lists scoped themselves by the stored `{slug}:read` grants alone, while
  every other read -- opening a document, the dashboard's own scope, a version
  read -- also consults the entity's code-defined `access.read`. The two
  disagreed in both directions: a collection or Single authorised entirely in
  code has no grant row, so it was left out of the list a reader could open it
  from, and on the dashboard the singles card was offered for it and then drew
  nothing; a grant the code rule refuses was listed anyway.

  Both listings now take the same read decision as everything else. One
  consequence for API keys: a key owned by a super admin no longer lists every
  collection and Single. It is judged on its own stamped scope, which is the rule
  every other read path already applied to it.

- [#1707](https://github.com/nextlyhq/nextly/pull/1707) [`9c8d64d`](https://github.com/nextlyhq/nextly/commit/9c8d64d5e41a85d7cf5c76d4e5b7fc66b3134f7c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An author who opened a document somebody else was already editing had exactly
  one thing they could do about it: take the document over, displacing a colleague
  mid-sentence. The polite option was to close the tab and hope.

  The lock strip now offers "Request edit access" beside "Take over", and the
  holder is told — passively, in the same strip — that someone is waiting. Nothing
  else changes: the request moves no claim, asks the holder for no answer, cannot
  be refused, and the lease expiring stays the only thing that transfers a
  document. Every action the holder had, they keep, including the Save they are
  being given time to reach.

  The ask is a standing one rather than a single message. The editor that is
  locked out is already polling for the document on every beat, so the request
  rides that poll and is re-stated for as long as the person is still there and
  still waiting. Close the tab and it lapses, so a holder is never nudged on
  behalf of a colleague who has gone.

  Pressing the button is answered. The strip replaces it with "We have let Bob
  know you are waiting" — text, not a disabled button, because a control that
  stays on screen having stopped doing anything is what a broken one looks like.
  The confirmation is shown only when the SERVER has the ask on record, so a
  request that landed nowhere cannot be reported as delivered.

  The holder's notice is a `status` region and not a dialog. There is no APG basis
  for one here — that pattern is for urgent interruptions a person must answer —
  and it is spoken once when it appears rather than on every heartbeat.

- [#1856](https://github.com/nextlyhq/nextly/pull/1856) [`f6ddafa`](https://github.com/nextlyhq/nextly/commit/f6ddafa0c3ed698309cd9c1f42449955955718d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field added to a collection now becomes the same column it would have become
  when the table was created.

  Three implementations answered "what column is this field?", and the one the
  product READS through — the canonical descriptor, used by the runtime Drizzle
  table and by the schema diff — was not the one the Schema Builder wrote with.
  So the table a user got was not the table the rest of the system believed it
  had, and the failure surfaced far from its cause: a diff proposing the same
  change on every run, or a write rejected by a column whose type nobody
  declared.

  Both paths that CREATE a column now read the descriptor. The path that alters
  an existing column deliberately does not, and that boundary is the whole safety
  argument: restating a live column under a mapping it was not built with is a
  narrowing `MODIFY` on MySQL that truncates stored values for an edit that
  touched nothing but a flag. No existing table is altered by this change.

  Two of the fixed disagreements were losing data outright on a column added to a
  table that already existed:
  - A number field set to `float` was added as a whole-number column on all three
    databases, silently discarding every fraction written to it. It is now
    `float8` / `double` / `real`, which is what the same field gets when its table
    is created.
  - A text field declared short was added unbounded on PostgreSQL and MySQL,
    losing the width the field asked for.

  Both happened because the ADD COLUMN path rendered a column from the field's
  type and length alone and never saw its options or validation.

  One family of disagreements is deliberately NOT converged here. The descriptor
  stores a field holding many values (`hasMany` numbers, uploads, relationships)
  and a repeater or group as a JSON array where these generators emit a scalar.
  That changes the column's storage class rather than its spelling, and the type
  is not the only thing that would have to move with it: indexability is decided
  from the old rendering, a relationship attaches a scalar foreign key, validation
  bounds are emitted as a comparison against the column, and a required column's
  backfill derives a scalar default from the declared type. Taking the
  descriptor's type alone would emit `CREATE INDEX` on a JSON column, a foreign
  key from an array to a scalar id, and `json NOT NULL DEFAULT 0`. Those stay
  recorded as known disagreements until the consumers move in one change.

  A MySQL `MODIFY` issued only to change a column's nullability now restates the
  column's LIVE type, read from the catalog, rather than a rendered one. MySQL
  restates the whole definition on every `MODIFY`, so such an edit has to name a
  type — and once new columns come from the descriptor, no renderer is right for
  both: rendering the old mapping narrows a float created as `double` to
  `decimal(10,2)`, and rendering the descriptor narrows a `select` created as
  unbounded `text` to `varchar(255)`. Both truncate, for an edit that asked for
  nothing but a required flag. The database knows which it is, so it is asked. A
  caller that does not read the live table keeps the previous behaviour.

  Some column types are spelled differently as a result — `int4` for `integer`
  and `bool` for `boolean` on PostgreSQL, `tinyint(1)` for `boolean` on MySQL.
  These are the same types under the names the descriptor and the database's own
  catalog use, not storage changes.

  One consequence worth stating plainly: on MySQL a `select` or `radio` column
  created from now on is `varchar(255)` where it used to be unbounded `text`,
  because that is what the descriptor says. Nothing existing is affected and
  nothing can be truncated, since only columns that do not yet exist are rendered
  this way. Whether the descriptor should instead move to `text` for these types
  is a separate open question.

  The conformance matrix that pins these three implementations against each other
  lost 23 accepted disagreements, all of them on the collection generator's
  create and add-column paths. Its ratchet is checked in both directions, so an
  entry describing a disagreement that no longer happens fails the suite — the
  list could not have been left stale.

- [#1817](https://github.com/nextlyhq/nextly/pull/1817) [`1ca2733`](https://github.com/nextlyhq/nextly/commit/1ca273325ff393fc3dead74febc678985014e16a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A new package, `@nextlyhq/plugin-mcp`, for exposing an install to AI agents over
  the Model Context Protocol. Experimental, read-only when it arrives, and inert
  in this release: it contributes no route, no field and no permission, so
  installing it today changes nothing. It is published now so that the protocol
  surface lands as additions to a package that already exists rather than as one
  drop, and so its release path is proven before anything depends on it.

  `enabled` defaults to `false` and stays that way while the surface is
  experimental. What the endpoint will expose is an install’s schema and content
  to any client that can reach it, so a version bump must never be what starts
  serving it.

- [#1882](https://github.com/nextlyhq/nextly/pull/1882) [`dbebaf7`](https://github.com/nextlyhq/nextly/commit/dbebaf7fb786e7a14c1998267662d12b6245c014) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a published page no longer puts the edit live. Pages now keep a working
  draft, as components and Layouts already do: Save stores the draft while the
  site keeps serving what was published, and Publish changes puts the draft live.
  A new page offers Save draft and Publish.

  Existing sites see this on their published pages from the first save after
  upgrading, with no migration. Pages also gain autosave recovery points while an
  author works in the page editor.

- [#1860](https://github.com/nextlyhq/nextly/pull/1860) [`ab3791d`](https://github.com/nextlyhq/nextly/commit/ab3791d667180008cb83be4ef0acb514b3d2f130) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An edit made to a collection that has been saved but not yet deployed no longer
  narrows the column its own creation migration is about to write.

  Such a collection has a registry record and no table, and the two artefacts
  replay in order: the create runs first, then the edit. Everything the edit
  believes about that table is therefore a prediction, and the indexes and
  foreign keys were already predicted for exactly this reason. The column TYPES
  were not — they were reported as unknown, which sent MySQL's `MODIFY` to the
  legacy renderer.

  The two renderers now disagree by design, so that fallback had a consequence: a
  float field is created as `double`, and a follow-up requiredness edit in the
  same window emitted `MODIFY COLUMN ... decimal(10,2)`. Both artefacts are
  correct read alone, and applying them in order narrows and rounds a column the
  deployment had just built.

  The planned types are predicted by the same class that emits the CREATE, beside
  the planned indexes and keys, so a prediction and the statement it predicts
  cannot describe different columns.

- [#1823](https://github.com/nextlyhq/nextly/pull/1823) [`5992aab`](https://github.com/nextlyhq/nextly/commit/5992aabbae4e25b1a3a672e883c231f1c79336d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can contribute a dashboard-widget DATA SOURCE. `contributes.widgetSources`
  takes a source and the server-side function that answers it, together: the
  source declares its queryable fields and supported ops the way every other
  source does, and the resolver is handed the query, the caller, and its own
  plugin context to read through.

  What the validation bounds is the SHAPE of the question -- field names,
  operators and operand shapes, all against the source's own declaration. It does
  not constrain operand VALUES, so a resolver must treat every value in a query
  as caller-controlled and must not use one as an outbound URL, a path, or a
  table or column name without checking it against a closed set of its own.

  Both halves travel in one value, so a source that nothing can answer is not a
  state a plugin can reach. A contributed id must sit in the `plugin:` namespace;
  `collection:`, `single:` and `system:` are refused at boot, as is a duplicate id
  or a missing resolver, each naming the plugin that declared it. A disabled
  plugin contributes nothing, and a boot starts from an empty store, so a source
  never outlives the plugin that published it.

  The dashboard query endpoint now bounds each slot. The batch answers with
  `Promise.all`, so it was only ever as fast as its slowest query: one that never
  settled held every other card behind it and the reader saw nothing at all. A
  slot that exceeds its budget now fails on its own and its siblings still answer.

  `WidgetSourceResolver`, `PluginWidgetSource` and `ReadCaller` are published from
  `@nextlyhq/plugin-sdk`, so a resolver can be written as a named function rather
  than only inline. They are `@experimental` on the same ladder as the rest of the
  widget contract.

  A contributed resolver is handed its plugin's own context, so it can read data
  to answer with. A plugin's services are reachable through nothing else, so the
  first shape of this contract could return constants and little more.

  The resolver type a plugin author writes against is published as
  `PluginSourceResolver`. The existing `WidgetSourceResolver` is core's own
  two-argument shape and rejects the context parameter a contributed resolver
  needs, so typing one with it made the contract reachable only inline.

  A plugin's managed read keeps the claims the caller's token proved. The
  identity was rebuilt from id, name, email and roles alone, so a collection's
  code-defined access rule reading a tenant, plan or entitlement was judged on a
  different caller than the request authenticated -- denying a positive check,
  and granting an absence-tolerant one.

- [#1684](https://github.com/nextlyhq/nextly/pull/1684) [`a2cd0f3`](https://github.com/nextlyhq/nextly/commit/a2cd0f30c363c10409d6872d799f832422f567ce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now serve a route at a top-level path instead of under
  `/plugins/<plugin-name>`, by declaring `mount: "root"`. That is what lets a
  plugin take over an endpoint the core stops shipping without every caller
  having to change the URL they already use.

  It cannot take a path the core serves. Root routes are matched only after the
  built-in router has declined, so the core's answer always comes first: a plugin
  declaring `/collections` gets the collections API like anyone else, not control
  of it. The ordering is the guard rather than a list of reserved prefixes, which
  would have to be updated every time the core gained a route and would fail
  silently when it was not.

  Two plugins still cannot claim one address: rooting a route keeps the collision
  check that the namespace used to make unnecessary. That check asks within a
  mount, because the two are matched in separate passes and a root route that
  merely resembles a namespaced one never competes with it for a request.

  A route is also refused at boot when it is rooted somewhere the request never
  arrives, rather than registering and silently answering nothing. That covers
  `/auth`, `/plugins`, `/admin-meta` and the development endpoints, all of which
  are answered before the point a root route is consulted. A `mount` outside
  `"plugin" | "root"` is refused for the same reason: only an untyped caller can
  produce one, and it would register under one name and be looked up under
  another.

  `PluginRouteMount` is exported from `nextly` and `@nextlyhq/plugin-sdk` beside
  `PluginRoute`, so a plugin author writing a reusable route builder can name it.

  A request that could reach a plugin route always waits for initialisation to
  finish, not merely for the routes to appear. The route registry fills partway
  through startup, so a second request arriving in that window could previously
  run a handler before permissions were seeded and migrations had settled.

  Nothing changes for a route that does not ask. The default is unchanged, so
  every existing plugin route stays where it is.

- [#1819](https://github.com/nextlyhq/nextly/pull/1819) [`39c96f3`](https://github.com/nextlyhq/nextly/commit/39c96f3f1248cb5a56bddf8f4d0ae76d9972d577) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can update many entries in one call. `ctx.services.collections` ended at `createMany`: plugin code could write many rows in one call and then had no way to change them in one, elevated or not, so the only batch update available to it was a loop of `updateEntry` calls, each with its own transaction, its own access pass and its own cache flush. `updateMany(slug, entries, opts?)` takes one `{ id, data }` per row, so a single call can apply a different patch to each row, and returns the same `BatchOperationResult` `createMany` returns: partial success, with `errors[].index` indexing the array the caller passed. There is deliberately no by-filter form; `listEntries` and this method compose to the same thing with the rows named, and a filter that matches more than its author meant is the failure a batch write cannot take back. A `locale` is refused by name, as on `createMany`, because the bulk pipeline writes in one pass and cannot store a translation. `@experimental` on the plugin surface until a first-party plugin exercises it.

- [#1769](https://github.com/nextlyhq/nextly/pull/1769) [`4de79a2`](https://github.com/nextlyhq/nextly/commit/4de79a2137618d5541d45ee0bec95fe4d7e791a2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now name the locale it reads or writes in. `ServiceOpts` — the
  options every `ctx.services.collections` call takes — gains `locale` and
  `fallbackLocale`, spelled as the request context and the REST API already
  spell them, and both are carried through to the collection services. Until
  now the request context could hold the pair and every read accepted it, but
  nothing on the plugin path could say it and the facade's forwarding seam
  dropped it even when a context did: every plugin read and write on a localized
  site was in the default language, silently. A code that is not a configured
  locale resolves to the default on a read, as it does on the wire, and is
  refused on a write, so a typo cannot overwrite the default language's
  content. `createMany` refuses any locale by name rather than filing the rows
  under the default language silently; its bulk pipeline cannot store a
  translation yet. `deleteEntry` refuses one likewise: a delete removes every
  translation with the document, and a locale on it would read as removing one.
  The selectors `*` and `all` are refused outright, from one classifier now
  exported as `isLocaleSelector` from `@nextlyhq/plugin-sdk`: a value forwarded from a query string
  must never be able to publish every translation of a document. The same
  spellings are reserved at localization configuration, together with `none`,
  the wire's spelling of no fallback — a site can no longer name a language
  `all` or `none`, neither of which could ever be read, written or chosen as
  one. An empty locale reads as none named.

  The form builder uses it for the one place a visitor could see the gap. A
  form that redirects to a picked page read that page with no locale, so a page
  whose slug is `thanks` in English and `merci` in French sent every visitor to
  `/thanks`. `submitForm` takes `locale`, and the built-in
  `POST /api/forms/:slug/submit` reads it from `?locale=` — the same place
  core's own routes take a locale — so a French submission is answered with the
  French URL, and one that names no language is answered as before. The target
  is read as the visitor rather than as the system, so a translation still in
  draft is never the URL a visitor is sent to; the published default answers
  until it is published. The read wildcards (`all`, `*`) are not a language and
  read as none.

- [#1673](https://github.com/nextlyhq/nextly/pull/1673) [`69b9aa5`](https://github.com/nextlyhq/nextly/commit/69b9aa535d9073c5ab693fdb0a86d09f743276ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin route can now ask what its caller may do, not only who they are.

  `ctx.caller` carries `authMethod`, the authenticating `apiKeyId`, the token's
  verified `claims`, and `can(action, resource)` — answered through the same
  machinery that decides a route's own `requiredPermission`: a scoped API key on
  its own stamped grants and the code-defined rule evaluated against them, and a
  session through the RBAC service with its super-admin bypass. A super admin does
  not bypass an API key's scope.

  This is additive and changes no existing behaviour. It exists because
  `ctx.authenticatedScope` answers only for API keys — a session caller's grants
  are resolved on demand and it holds no stamped scope — so a route could not ask
  "may this signed-in author create in collection X", which is the question an
  admin panel needs in order to gate a create action before showing it.

  Deliberately not a permission array: a session's is empty by design, so a route
  reading one would refuse every signed-in user while appearing to check
  something. The write remains the enforcement point; this is a UX and routing
  aid.

- [#1679](https://github.com/nextlyhq/nextly/pull/1679) [`113f82c`](https://github.com/nextlyhq/nextly/commit/113f82c827874ebace3f8cb4e2a120d6c695883a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin-contributed route reached the collections through the managed facade
  without carrying the request it was serving, so a hook underneath one read a
  browser's write as background work. Every route written before that field
  existed names no request, which is all of them: the page-builder's save route
  and the form-builder's export routes among them. A request-scoped rule, a rate
  limit or an audit, stood down for exactly the traffic it exists to judge.

  The route dispatcher pins the request once, beside the caller scope it already
  pins, so a contributed route inherits it without naming it.

- [#1807](https://github.com/nextlyhq/nextly/pull/1807) [`348ceb9`](https://github.com/nextlyhq/nextly/commit/348ceb93a51cf8fca0ae55ee5dcbb132baeaa015) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A database error from the adapters now says which operation failed on which
  table on every dialect. The context was attached only when the message did not
  already contain the operation's name, and on PostgreSQL and MySQL the driver's
  message quotes the failed statement — which Drizzle spells in lower case — so
  an `update`, `insert` or `delete` there, or any table or column whose name
  contains the word, arrived without it. The error still carries the table as
  before; only the message changes, and only where the context was missing.

- [#1854](https://github.com/nextlyhq/nextly/pull/1854) [`e700886`](https://github.com/nextlyhq/nextly/commit/e7008868e8b631c7e2ba4bc74b6e166b72d6eb41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A reader can send a first-run card away from the card itself, and dismissing one no longer stops later widgets from reaching them.

  A widget declaring `dismissible` draws a control on the card, outside edit mode: a card that addresses somebody who has just arrived should not require discovering the dashboard editor first. Framed cards carry it in their header; unframed cards float it in the free corner. It is offered only from the width at which editing -- the one route to bringing a card back -- is available, and `dismissible` must be a boolean on both declaration channels.

  Dismissing hides the placement rather than deleting it. The write has its own channel, so its failures never reach the editor's chrome, it locks every other layout write while it is in flight, it confirms against the refreshed dashboard before announcing, and focus moves into the widgets region when the card holding it goes.

  A layout row now records whether its reader ARRANGED it. A row written only by dismissals still follows the live registry -- a widget declared later is placed, and positions track the declared order -- with the reader's dismissals applied. The editor's save takes charge of the arrangement, and a row once arranged stays arranged whatever a later write says. Every row written before this reads as arranged, so existing dashboards are unchanged; the flag lives in the stored JSON, so nothing migrates on any dialect.

  `toggleHidden` and `remove` now announce through the grid's live region, where both used to change the dashboard in silence.

- [#1840](https://github.com/nextlyhq/nextly/pull/1840) [`16efd9c`](https://github.com/nextlyhq/nextly/commit/16efd9cf7383708209c5b8306f73efbac7b246fb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A function default cannot read a denied sibling from inside a group or a repeater row either.

  The create path judges the field rules on a copy of the request and hands that copy to the function defaults, so a default cannot read a value its writer was not allowed to send. When the rules removed a whole container, the copy had no counterpart for it, and the walk read that as no copy having been given at all: it fell back to the caller's own row, which is exactly the unfiltered data the copy exists to replace. A nested default could then carry a denied sibling into a child the caller may write, while the pass that decides what is stored removed only the field it came from. A container missing from the copy is now read as a container the rules emptied, which is the only way one goes missing.

  A Single's first read judges a required nested child by the rule the write validator will apply. `required: true` on the field and `validation: { required: true }` beside its other rules are both supported spellings, and this read tested only the first, so a group invented for one defaulted child was stored with a required sibling empty and the next write refused the document. The validator's own predicate is shared now rather than restated.

- [#1753](https://github.com/nextlyhq/nextly/pull/1753) [`08bce33`](https://github.com/nextlyhq/nextly/commit/08bce33d147922909894f2b00e245aae0e54e9f2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A class rename the host refuses with an empty or whitespace-only reason is now
  reported in the same words a rename that threw already used, rather than as
  an alert with nothing written in it. The refusal's shape is the documented one
  and the host did refuse, so silence would report a failed rename as a success;
  what was missing was only the words, and those are supplied.

- [#1752](https://github.com/nextlyhq/nextly/pull/1752) [`cde0bd0`](https://github.com/nextlyhq/nextly/commit/cde0bd0b8bf2425c2afe753c4c058060fcfefd9d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A class rename refused by a host is shown to the author only when the refusal
  carries the reason the panel is about to print. The guard that recognised an
  outcome read one field of it — whether `ok` was a boolean — and then narrowed
  to a type promising `reason: string`, so any unrelated failure-shaped result a
  host handed back was accepted as a refusal. `{ ok: false, error }`, which is
  what an ordinary mutation helper answers with, reported `undefined`.

  The notice renders on the reported reason not being `null`, and `undefined` is
  not `null`, so the author got an error box with nothing written in it and a
  screen reader announced an alert carrying no text — a rename declared failed
  with no way to learn why. A result this cannot vouch for is silence again, as
  it always was for a host that answers with nothing.

- [#1757](https://github.com/nextlyhq/nextly/pull/1757) [`9ca0cfd`](https://github.com/nextlyhq/nextly/commit/9ca0cfda21f4c3ddb57e970570b3aead8e36af90) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `DropRegion.at` is now `DropRegion.target`. The module spelled two ideas with
  one word: on a region, `at` was the placement a block would be nested into,
  while on a `DropTarget`, `at` was a position and `target` was that placement.
  A host reading both had to remember which `at` it held. The region now names
  the placement as the target does, and `at` means a position everywhere in the
  module. A value still spelling `at` on a region is a type error rather than a
  silent fall-through; the package is `@experimental` throughout, so no alias
  is kept.

- [#1834](https://github.com/nextlyhq/nextly/pull/1834) [`c52aa59`](https://github.com/nextlyhq/nextly/commit/c52aa5970405a62f3bbd13df67722afa444a9d77) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An edit to what a relationship does when the row it points at is deleted now
  reaches the database.

  A foreign key carried the actions the statement that CREATED it wrote, and
  nothing else ever changed them. Moving \`posts.author\` from cascade to restrict
  saved successfully and recorded restrict, while the database went on cascading
  — so deleting an author still destroyed their posts. The same held for a
  many-to-many, whose junction kept the actions it was built with.

  Both are emitted now, through one implementation. PostgreSQL and MySQL drop
  the constraint and declare it again under its own name, as two statements:
  MySQL rejects a drop and an add of one name in a single \`ALTER TABLE\`, and on
  PostgreSQL a single statement would depend on the order the server applies its
  subcommands in. A junction has both of its foreign keys rebuilt, and the table
  itself is left alone — rebuilding it would destroy every link it holds for a
  change that never needed to touch one.

  SQLite refuses the edit by name rather than performing it. It cannot alter a
  constraint at all, and the table rebuild that would be required has caused
  real data loss in three independent tools that automated it; refusing is what
  this dialect already does for a foreign-key drop and for a unique constraint
  it cannot enforce.

  Three things the statements meet on the way to the database are handled with
  them, because emitting the right SQL is only half of arriving:
  - They are emitted one statement per chunk. The runner splits a migration on
    its breakpoint markers and never on semicolons, and the MySQL driver is
    configured to refuse a query carrying more than one statement — so a
    semicolon-joined pair was rejected whole, and this edit did nothing at all
    on MySQL.
  - Turning a link optional now relaxes its column as well as its key, in that
    order, and turning one required replaces the key before tightening the
    column. A relationship's requiredness never moved its column before: the
    descriptor calls the column nullable whichever way `required` is set, so an
    optional link kept a NOT NULL column while its key moved to `SET NULL` —
    which MySQL rejects outright, and PostgreSQL accepts and then fails on the
    first delete, in production.
  - The key that is dropped is the one the table actually carries, read from it
    rather than derived from a naming convention. A column whose key was
    installed under another name, or that carries none because it was edited
    from a scalar into a relationship, no longer aborts the migration.

  The edit is also paired the way the rest of the save pairs, rather than by
  name alone: a relationship renamed in the same save carries its action edit
  (it previously emitted the rename and left the old action enforced), and a
  field whose storage moved leaves its key to the path that creates it rather
  than declaring the same constraint twice. Many-to-many junctions are paired
  once for both their table move and their action edit, so a save that did both
  can no longer fall between the two.

  Two referential actions are now refused rather than emitted for a server to
  reject halfway. `onUpdate: "set null"` on a required relationship is the pair
  `onDelete` has always refused, reached through the other half. And `set null`
  on a many-to-many cannot hold at all: both link columns are `NOT NULL`,
  because a link naming nothing on one side is not a link.

  One behaviour changed on SQLite. A junction action edit was refused by name
  when the junction kept its table and silently ignored when the same save also
  renamed it — so whether the edit was refused or lost depended on whether you
  happened to rename. It is refused in both cases now. SQLite still cannot
  change a junction's referential actions; renaming one on its own is
  unaffected.

  Two further things the column's METADATA cannot answer are now asked of the
  column itself:
  - Installing `SET NULL` states that the column accepts nulls rather than
    inferring it from requiredness. A database migrated before a requiredness
    toggle relaxed anything still carries whatever `CREATE TABLE` gave the
    column, so a relationship both definitions call optional can be sitting on
    a `NOT NULL` column right now — and the statement is idempotent, so this
    also repairs the ones the old behaviour left behind.
  - Making a field required is refused, before any statement is written, when
    entries still leave that column empty. The server rejects the tightening,
    and by then the statements ahead of it have run — auto-committed on MySQL,
    including the foreign-key replacement a relationship's tightening is
    ordered behind, which would leave the table carrying no key at all while
    the save was recorded as made. The check reads the live rows; a caller that
    does not supply them keeps the behaviour it had.

  A definition already stored is read rather than judged. The previous creation
  path accepted a required relationship declaring `onUpdate: "set null"`, and
  refusing to READ that combination would have frozen the collection holding it:
  the repair is itself an edit, and every save visits every relationship the
  collection keeps, so one legacy field would have blocked unrelated changes to
  its neighbours. What a save ASKS FOR is still refused — including a save that
  flips requiredness onto a declaration that was legal before.

  What a field was is now answered in ONE place for every pass in a save. The
  action pass carried a renamed field's edit while the column pass, keyed on the
  new name, skipped the same field — so a link renamed and turned optional in
  one save had its key moved to `SET NULL` and its column left `NOT NULL`.

  The SQLite refusal in the schema templates is a `NextlyError` rather than a
  bare `Error` subclass, so it reaches a caller as the typed envelope every
  other refusal in the package uses. The class and its message are unchanged;
  callers and tests identify it by type.

  Two things about the check above, both found before it shipped:
  - It asks only about columns that are ON this table. A localized collection
    keeps its translatable columns in a companion, so probing the main table for
    one asked for a column it does not have — and that error arrives before any
    migration is generated, which would have failed every save on a localized
    collection with an optional translatable field.
  - Relaxing a column for a `SET NULL` key keeps the default it carries. MySQL
    restates the entire column definition on `MODIFY`, so a narrower rendering
    silently removed the relationship's configured default for future inserts.
    Both callers now render that statement through one function.

  A column the live table does not have YET is its own answer, not a clean one.
  Its `ADD` is queued, so it holds no nulls today — and reading that as "no
  nulls" let a save make the field required, after which the deployment creates
  the column holding NULL in every existing row and fails on the next statement.
  Absence is reported separately now and refused only where the table already
  has entries, with its own message: deploy the change that adds the field
  first, fill the entries in, then make it required.

  Which columns exist is read from the database rather than predicted from the
  field definitions. Predicting it was wrong twice — a localized collection
  keeps its translatable columns in a companion table, and a deployment holding
  an unapplied migration has a field whose column is not there yet — and each
  repair only covered the reason someone had just met. The reader now narrows to
  the columns the catalog reports before it probes anything, so it cannot be
  asked about a column that is not there whatever the caller believed. The
  caller's list is a query-reduction narrowing and says so.

  The requiredness precondition uses the save's own rename pair, like every
  other pass in a save. A field renamed and made required in one go read as
  newly added, skipped the refusal, and had the tightening emitted anyway; the
  nulls are recorded against the column the live table still has, so that is the
  name the check reads.

  The live column read is resolved to the catalog's own spelling of the table.
  MySQL under `lower_case_table_names=1` answers a query for a mixed-case table
  by reporting the name it folded, so the map came back keyed as `dc_posts` for a
  table asked about as `Dc_Posts` and an exact lookup missed the very table it had
  just described. That miss reported no nulls and no absent columns, which is
  indistinguishable from a clean table, so the refusal above withdrew itself on
  exactly the server whose DDL auto-commits. The folding rule is given rather than
  queried, for the reason the apply pipeline already records: the only name being
  matched is the one this read just asked the server to describe, so a
  case-insensitive match cannot select a different object. PostgreSQL is left
  case-sensitive, where the two spellings are two different tables.

  Singles ask the same question of their own table. The precondition is keyed
  entirely on facts the caller supplies, so a caller that reads none does not get
  a weaker check — it gets no check: the refusal returns at its first guard. The
  singles path read whether the table had rows and which columns carried keys and
  indexes, and never read the null state, so a single that tightened a field over
  an entry leaving it empty, or over a column an undeployed migration has not
  added yet, still had the nullability statement written for PostgreSQL and MySQL
  to reject. It reads both now, through the same reader the collection path uses,
  narrowed to the columns this pass will actually diff — a localized single keeps
  its translatable columns in a companion table and they are not this pass's to
  ask about.

- [#1796](https://github.com/nextlyhq/nextly/pull/1796) [`10ef8d9`](https://github.com/nextlyhq/nextly/commit/10ef8d95573eebad5bfdd8bd2daebdfb7193f141) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A many-to-many field's junction table now follows the field through its life in the migrations the builder writes.

  Adding a many-to-many relationship field has always created its junction table; nothing removed it. A removed field left the table standing with every link in it — unread, and inherited by any field added later under the same name, because the creation runs `CREATE TABLE IF NOT EXISTS`. A renamed field was worse: the rename detector only pairs fields that have a column, so a many-to-many rename fell to the add/drop loops, which created a fresh, empty junction for the new name and left the old one, links and all, orphaned. Dropping a collection dropped its table and its `_locales` companion and left its junctions behind.

  Now:
  - **Removing** a many-to-many field emits `DROP TABLE IF EXISTS <junction>`, the table resolved by the same rule the creation uses (the author's `junctionTable` name when set, the generated name otherwise). Moving the field to a storage class that has a column does the same, then adds the column.
  - **Renaming** a many-to-many field — one removed and one added that point at the same target under the same relation kind — emits `ALTER TABLE <old> RENAME TO <new>`, spelled the same on PostgreSQL, MySQL and SQLite, so the links travel with the name, and then renames every index and constraint whose generated name embedded the old table name (PostgreSQL renames them; MySQL renames the indexes and re-declares the foreign keys under their new names; SQLite rebuilds the indexes and needs nothing for its per-table constraints). Without that, a later field reusing the old field name would find its index and constraint names already taken. A junction the author named keeps its name and emits nothing. More than one such pairing in a single save is refused by name (`MANY_TO_MANY_RENAME_AMBIGUOUS`), as two field-group renames already are: a wrong pairing would hand one field the other's links. Removals and additions that pair with nothing are plain drops and creates.
  - The junction lifecycle is decided on the **full** field lists, so a `localized: true` many-to-many — which the column diff of a localized collection never sees — is created, renamed and dropped like any other; and a save that renames a many-to-many and a field group together carries both.
  - **Dropping** a collection drops the junctions its own fields own before the companion and the main table. A junction that another collection's field points at this table through is that field's, and stays with it; what should happen to such a field when its target collection is dropped is a separate question, filed for a decision.

  `generateDropTableMigration` takes the collection's fields (defaulting to none) so it can name those junctions; the collections delete path passes them.

- [#1868](https://github.com/nextlyhq/nextly/pull/1868) [`c5f8fe8`](https://github.com/nextlyhq/nextly/commit/c5f8fe82e43e86e29760a434129b68b524670192) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving part of a page as a pattern no longer gives a block an id it never had.
  When a pattern is inserted beside an element that already uses one of its ids,
  the insert renames the copy (`pricing` becomes `pricing-4985ccb3`) and records the
  rename, so a later save can store the pattern under its own name again. That
  record said what an id became but not which block it belonged to, so a block
  added afterwards and given the renamed id was also saved as `pricing`.

  An insert now also records which blocks it renamed, as `renamedNodes` beside
  `renamed` on the inserted root's `origin`. A save restores an id only on a block
  listed there that still exists once on the page and still carries the renamed
  id. A block that was deleted, whose id was changed, or that was added later
  keeps the id it has. Hiding a block behind a visibility condition does not
  change this.

  Existing pages behave as they do today. A pattern inserted before this release
  has no such list, and saving from it restores by id exactly as before, including
  the case above. Inserting the pattern again writes the list, and saving over a
  pattern keeps whichever form its record already has. `patternRenameRecord` reads
  a stored record's renames and its list together, in one pass.

- [#1857](https://github.com/nextlyhq/nextly/pull/1857) [`9bac152`](https://github.com/nextlyhq/nextly/commit/9bac152475a676d84d360bef7a6f999cbc9986f1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A rename of a site class survives the panel it was started from.

  The class manager lives in a rail that unmounts it on every switch, and that
  switch is exactly what makes two renames of one class overlap: the author
  renames, moves away, comes back, renames again, and the first write is still on
  the network. Two things were decided from state that the unmount destroyed or
  that the wrong attempt cleared.

  The name a class is HEADING FOR is now released only by the rename that is still
  the live one. An earlier attempt finishing under a later one used to release it
  for both — and the panel then judges the next edit against the name on screen
  rather than the one being written, so typing the original back reads as "nothing
  changed" and is silently dropped while the later rename goes on to persist a
  different name.

  And whether an answer still describes the rename being attempted is now decided
  from an identity the HOST owns. Kept inside the field, it was destroyed by the
  unmount and started again from zero, so the first answer to arrive after a switch
  passed as the current one: a refusal for a rename the author had already replaced
  was raised from the shell, naming an edit that no longer existed.

  Both decisions now read the same identity, because they are the same question
  asked twice.

- [#1692](https://github.com/nextlyhq/nextly/pull/1692) [`dc38f47`](https://github.com/nextlyhq/nextly/commit/dc38f4758422964a2ff34fe5556020d552e4b3dc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin route can compute the permission it requires.

  `requiredPermission` took a fixed slug, and a permission slug spells a
  collection — which the host can rename. A route gating on one of its own
  plugin's collections therefore had to choose between demanding a grant nobody
  was seeded on the installs that renamed it, or declaring no permission at all.
  The page builder's save-pattern route chose the second, so a write was reachable
  by any authenticated caller.

  It now also accepts a function of the plugin's own resolved names:

  ```ts
  requiredPermission: ({ collection }) => collection("patterns", "create"),
  ```

  The scope composes the slug through the same helper core seeds with, so a route
  never spells one itself, and the demanded grant follows a rename. A resolver
  that throws refuses the request rather than falling through to the ungated path.

- [#1699](https://github.com/nextlyhq/nextly/pull/1699) [`c293917`](https://github.com/nextlyhq/nextly/commit/c293917acd1e74d5d8722696589c31ba69d90bc2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard chart's table draws its row separators at full strength.

  At half alpha they measured 1.11:1 against the page surface, where WCAG asks
  3:1. A separator in a data table is structural rather than decorative — it is
  what tells a reader which number belongs to which row — so it carries the
  contrast a reader needs, and it now matches the shared table primitive every
  other table already uses.

  The plugin-route documentation's scope-narrowing example is a complete route
  rather than a fragment. It referenced `ctx`, `id` and `data` with nothing
  declaring them, so a reader copying it got three errors and could not see where
  those values come from. It now shows the handler they arrive in.

- [#1875](https://github.com/nextlyhq/nextly/pull/1875) [`3d60b11`](https://github.com/nextlyhq/nextly/commit/3d60b11362c0faf2b55685ae08a6b3513fb871d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a component could do far more work than its bound said. Before a save,
  each of the component's variants is composed to check that the component does
  not end up referencing itself, and that work was charged only for the
  component's own nodes. A small component placing a large one composed the large
  one again under every variant, and a large component naming itself was not
  checked at all on a save made without the Direct API.

  Each composition is now charged, by the composer itself, for every entry it
  examines, including expansions it abandons and nodes an override hides, against
  one allowance per save. A save that spends it is refused, and the message says
  what the author can change. `resolveComponentInstances` takes that allowance as
  the `work` option, and reports `loopsClosed`, every component a reference loop
  closed on, so a loop found just before the allowance ran out is still named as a
  loop rather than as spent work.

- [#1803](https://github.com/nextlyhq/nextly/pull/1803) [`4e25eb2`](https://github.com/nextlyhq/nextly/commit/4e25eb229a30824e620457bdf24ffe527ad716be) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A `single:<slug>` widget source is executable.

  `WIDGET_SOURCE_KINDS` named the kind and nothing published or ran it: a widget
  query over a single was refused as "not executable yet". Every single the
  install has is now published as a source beside the collections, from the
  singles registry at request time, and a `list` query over it reads the one
  document through the same access-controlled read as the API -- the single's
  own rules, code-defined ones included, decide the answer -- and returns it as
  a list of one row projected to the selection. A single answers a fixed
  question, so `list` is the one op it supports: a `where`, a `sort`, a `count`
  or a bucketing over it is refused by name rather than answered.

  The dashboard offers one status card per single a reader may read -- whether
  it is published, and when it last changed, linking to the single -- the way it
  offers cards per collection: never placed, only offered. The `singles:present`
  and `collections:present` conditions now answer from the registries' own
  readable listing -- what the management cards they gate list -- so a
  collection or single whose migration is still pending keeps its card on the
  dashboard instead of disappearing exactly when it needs attention. A single
  whose DDL a reload refused is withheld from the widget sources the way a
  collection's is, from one shared store of deferred entities.

  A Single's not-found answer now says which Single it is about: the error's
  `data` carries `{ single: <slug> }`, the slug the caller named. A draft-only
  Single and a nonexistent one still answer identically.

  A single's widget query projects OWN properties, so a field the read removed
  for a caller -- one named `toString` or `constructor`, which a single may
  legally declare -- stays removed instead of answering with the value
  `Object.prototype` carries.

  A collection or single whose metadata sync could not store its new field list
  is withheld from the widget sources for the rest of the process, beside the
  ones whose DDL a reload refused: in both cases the registry's description and
  the table are known to disagree, and a card drawn from one queries a shape the
  database does not have.

  A single the boot cannot register -- because a collection already holds its
  slug, say -- now fails the boot naming it, as a collection in the same state
  already did, instead of leaving the app running without a single its config
  declares.

  A collection, single or field group can no longer take a slug another kind
  already holds. Slugs are one namespace across kinds -- as
  `defineConfig` already enforced for an app's own config -- and before, such a
  boot succeeded while the registry silently refused one of the two at sync, so
  an app's single could vanish behind a plugin's collection of the same slug.
  The boot now fails with `NEXTLY_SCHEMA_SLUG_COLLISION`, naming both owners in
  the log. The same rule is applied to the entities the Schema Builder owns,
  once the registry is readable -- at the runtime boot and on the CLI -- so a
  Builder single and a plugin collection under one slug are refused up front
  rather than at registration, where one of the two was rejected by a message
  naming neither the other kind nor its owner.

  Under `next dev`, a single whose fields you edit keeps its source and its
  status card: the reload re-marks an edited single's migration as applied from
  the sync's own report, as it already did for an edited collection, instead of
  leaving the row `pending` for the rest of the session.

  A widget query asking for `draft` or `published` from a source that has no
  publish lifecycle is now refused, instead of being accepted and answered as if
  no state had been named. Nothing downstream could apply such a selector, so
  the two mutually exclusive questions came back with one answer and the card
  said nothing about having been ignored. `status: "all"` is unaffected: it
  claims no lifecycle, and it is what the generated count, recent and timeline
  cards send.

  A single whose metadata a `next dev` reload could not store now keeps its
  widget sources withheld even when the rest of its kind synced cleanly. The
  singles sync reports a per-single refusal without failing the scope, so a
  reload that refused one single had been clearing the whole deferral set and
  republishing that single's stale field list.

  A `next dev` reload whose metadata sync fails now withholds that kind's widget
  sources rather than publishing them over tables the apply has already moved,
  and a single the sync refused no longer has its migration recorded as applied
  -- a label that persists, so the old field list came back against the new
  table on the next restart. A boot also starts with nothing withheld: the
  refusals one boot recorded are its own, and a slug held over from a previous
  boot kept its source and cards hidden for the life of the process.

  A collection or single whose registry row was written and whose permission
  seeding then failed keeps its widget source and has its migration marked
  applied. Both registries report such an entity in `errors` as well as in
  `created`, and reading the error alone withheld a source whose stored metadata
  was in fact current -- permanently, since every later pass read the same report
  the same way.

- [#1826](https://github.com/nextlyhq/nextly/pull/1826) [`ebd0b24`](https://github.com/nextlyhq/nextly/commit/ebd0b243cd812d63d5cd5f90aa054f6648e671e8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing a Single now re-judges the pending change it is about to promote, against the schema and the permissions as they stand at that moment.

  A Single's publish folds its held draft into the live row. Both gates ran when the caller's payload arrived, and for a publish that payload is just the new status, so the draft's own content reached the live row having been judged only when it was SAVED. Two things could have changed since. The publisher may not be the author, and a field rule can deny them a value the author was allowed to write. And the schema can have tightened under a value that was legal when it was held.

  BEHAVIOUR CHANGE, and it is visible. A draft written under an older, looser schema is now REFUSED at the moment someone hits Publish, having raised no complaint when it was saved. The refusal names each field and carries the rule's own message, so the author can see what to fix. Publishing content that violates the current contract is the worse outcome.

  A pending change that edits a field the PUBLISHER may not write is refused too, rather than being quietly dropped from the write. A successful publish consumes the pending change, so dropping the value would have published everything else, deleted the draft, and destroyed the author's edit with it. Refusing keeps the draft intact for someone who can write that field. Only a field whose promoted value actually differs from the live row counts: a draft snapshot is a full copy of the document, so a denied field appears in every one of them.

  Both gates run over the snapshot being promoted and never over the live document, so a schema change cannot block someone from fixing and republishing unrelated content. They run over that snapshot in its logical shape, so a Single that merely HAS a group, repeater or JSON field is not refused for holding one.

  Both publish paths are covered by one gate: the ordinary publish and `publishAllLocales`, which promotes every language's pending change in its own loop and had no such check at all.

- [#1800](https://github.com/nextlyhq/nextly/pull/1800) [`e8e8d78`](https://github.com/nextlyhq/nextly/commit/e8e8d7855ca06ce444c9dfaba4ed23b45a64ceb4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single read now applies field-level `access.read` rules before its field-level `afterRead` hooks, and again after them, the way a collection read always has. Before, a denied field's own hook ran and saw the value, and a hook on an allowed sibling could read the denied value; the response was redacted, but app code had already seen it. Access decides on what is stored; hooks shape what is returned.

- [#1687](https://github.com/nextlyhq/nextly/pull/1687) [`adfafa3`](https://github.com/nextlyhq/nextly/commit/adfafa36762a24745b69ca1e14367f310940fbce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A spacing drag handle sat on the wrong edge for most margins, and dragged
  backwards there.

  Which edge of a band moves when its value grows is a property of the layout
  rather than of the box. Measured in Chromium, growing `margin-top` drives the
  block's border edge down while its outer edge stays pinned by whatever precedes
  it; `margin-left` does the same against the container, and so does `margin-right`
  on a block whose width is auto — while `margin-bottom`, and `margin-right` on a
  fixed width, do the opposite. The editor now asks the element on every side, for
  margins as it already did for paddings, so the handle sits on the edge that
  responds and the drag follows the pointer.

  It asks each time it draws, so the handle follows whatever the block is doing
  whenever anything prompts a fresh look: an edit that settles a height, a
  breakpoint that swaps the width model, a container query answering to a sibling,
  a state being previewed. None of those has to be anticipated for the handle to
  be right. A margin that changes only under a real `:hover` is still described at
  rest, which is what the editor has always done, because nothing reports that.

  The measurement also leaves the page alone properly now. It works by pushing a
  value onto the block and putting it back, and on a block with no inline style of
  its own the attribute was left behind empty — invisible on screen, and visible to
  everything in the editor that watches the page for edits. Nothing is left behind.

  Two smaller corrections come with it. A handle on a negative margin now grows
  the value in the direction the edge actually travels, instead of committing a
  larger negative number and running the block away from the pointer. And a
  transformed block is measured against the scale its margins are laid out in
  rather than the one it renders at, which had inverted the handle on any block
  carrying a transform of its own.

- [#1859](https://github.com/nextlyhq/nextly/pull/1859) [`812f167`](https://github.com/nextlyhq/nextly/commit/812f16767fec5aecb0acf41711ddc1d7047c8e26) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A publish that also edits a group, repeater or JSON field no longer fails validation.

  When a pending change existed, publishing it together with an edit to any group, repeater or JSON field was refused as "must be an object", with no field rules involved at all. The ordinary write encodes those fields to their column strings before the publish is judged, and the check on the document being published then read a group as text. Both checks now read the document in its logical shape, through the same conversion that reads the live row, and the write encodes it once.

  A field declared inside a group or a repeater is judged as content, however it is named.

  The publish gate skips the store's own bookkeeping columns, such as `id` and `updatedAt`, and defers to the field names the schema declares so that a real field with one of those names is still judged. Those names were collected in a way that stopped at the first named container, so a declared field nested inside a group or repeater was still skipped, and a Single's publish was not given the names at all. The names are collected at every depth now, for collections and Singles alike.

- [#1832](https://github.com/nextlyhq/nextly/pull/1832) [`9ad1744`](https://github.com/nextlyhq/nextly/commit/9ad17448d2176b786041efae68a86d73678bf3b4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard's onboarding checklist now offers "create your first collection" to
  every reader who could finish it, and to no reader who could not.

  An administrator who is not a super admin was never shown the step. Creating a
  collection seeds its permissions to the super-admin role, but the built-in role
  presets are re-resolved against the live permission list on every boot, and the
  `admin` preset covers a content collection — so an admin does reach what they
  created, from the next start. The checklist asked only about the immediate seed
  and hid a step that was theirs to take.

  An API key was offered it on any grant beginning `read-`. The read decision
  admits a key on an exact `read-<slug>` match, so a key stamped `read-settings`
  could only finish the step by creating a collection called `settings` — a
  reserved name. It is now offered the step only where its grant names a
  collection that could actually be created.

  Both answers are computed from the declarations that produce them — the seeder's
  role and the preset predicates, and the collection slug rules themselves — rather
  than restated beside them, so a preset or a reserved name that changes carries
  the checklist with it.

  A widget source contributed by a plugin is now keyed from the record the registry
  published rather than by reading the plugin's object a second time. A JavaScript
  `id` may be an accessor or a proxy, and a second read that answered differently
  filed the resolver under an id no source claimed, leaving the published source
  failing every query as unanswerable.

  A widget source's resolver now receives the host's `ResolverOptions` — a
  cancellation signal today — beside the question it is answering. The dashboard's
  per-slot budget already stopped waiting for a resolver that hung, but a promise
  has no cancellation, so the work went on running and further requests started
  more of it. The signal is aborted when that budget expires, so a resolver that
  passes it to whatever it calls (`fetch` takes one directly) stops rather than
  merely stops being awaited.

  The parameter is optional and arrives in an options object, so every resolver
  written before it keeps working unchanged, and anything the host offers later
  becomes a field there rather than another positional argument. `ResolverOptions`
  is published through `nextly` and `@nextlyhq/plugin-sdk` alongside the resolver
  types.

- [#1830](https://github.com/nextlyhq/nextly/pull/1830) [`1532b2e`](https://github.com/nextlyhq/nextly/commit/1532b2e28b095a859c02501c4a4b785b2ac01146) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The setup checklist offers "create your first collection" only to a reader who
  would be able to READ what they create. A new collection's permissions are
  seeded to the super-admin role alone, so a caller holding the definition grant
  and nothing else created the collection, gained no read on it, and found the
  step outstanding permanently -- with the card pinned to their dashboard.

  An API key stamped with a read grant is offered the step it can finish: a key
  never gains a permission, but a pre-seeded `read-<slug>` lets it create that
  collection and read it afterwards.

- [#1783](https://github.com/nextlyhq/nextly/pull/1783) [`cd95546`](https://github.com/nextlyhq/nextly/commit/cd9554690379d1620eded8b7d58107ea43f6a669) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An API key created by a Super Admin copies the permission catalogue rather
  than the role's rows. A Super Admin's power is a bypass, and the role only
  holds the permissions that existed when the install was set up, so a key of
  theirs held a stale subset at best and, where the first user came before the
  grant, nothing: every request refused, starting with the first key an operator
  minted to try an integration with. A `read-only` key of theirs now reads every
  collection the install declares, including one added later, and still cannot
  write; a `full-access` key holds every permission. A permission a package
  stopped declaring is not inherited. Whether the creator is a Super Admin is
  asked of the same resolver as the session bypass, so a role built on top of
  Super Admin counts here exactly as it does everywhere else.

  A plugin calling `ctx.services` as a user now sees that user's roles. The
  caller was built with an empty role, so a code-defined rule such as
  `req.user?.role === "editor"` refused every caller on the plugin path while
  the same caller's own request passed it, and a negative rule granted what it
  was written to refuse. The roles are resolved and the caller is built by the
  one constructor every other authenticated path uses.

  Changing a permission row now retires the cached answers derived from it, and
  retiring them is no longer a separate step a writer has to remember: every
  write goes through one place that does both. None of the methods writing those
  rows invalidated anything, and neither of the existing invalidations can
  express the change, because a permission row belongs to no user and no role. So
  a role-based key kept a renamed slug, and a Super Admin's key kept a deleted
  grant and missed a new one, until their entries aged out.

  A cached answer resolved before an invalidation is no longer written after it.
  Every cache here is filled from an asynchronous read, so a lookup that began
  before a role changed could complete afterwards and put the old answer back into
  a cache that had just been cleared.

  A call whose caller's roles could not be read is refused rather than run as a
  caller with none, with a typed error rather than the driver's own. The resolver
  behind it degraded a failed query to an empty set, which is safe for a rule that
  grants on a role and wrong for one that withholds on it: `user.role !==
"suspended"` admitted a caller the database declined to answer for.

  This covers an API KEY's roles as well as a plugin call's. A read-only or
  full-access key resolves its owner's roles, and those populate the scope every
  later role rule reads directly, so a failed lookup arriving as an empty set was
  indistinguishable there from an owner who holds no roles. Both paths now ask one
  resolver that refuses, rather than each deciding for itself what an unanswerable
  question means.

  Losing the Super Admin role now takes effect at once. The cached answer to
  "is this user a super admin" was not cleared when roles changed, so a demoted
  user kept the session bypass until the entry aged out, and an API key's grants
  resolved through that answer could be cached for five minutes of their own on
  top of it. Role and permission invalidation clears it, and an API key's cached
  grants are retired with it: they are derived from the same rows, and nothing
  retired them when a ROLE changed, so revoking a role's inherited Super Admin
  left a key holding the whole catalogue and changing a role's permissions left a
  role-based key holding the old set.

  A caller that arrived on an API key is judged on the KEY's roles, not its
  owner's, the way the REST path already judges one. A stored role rule reads
  the caller's roles directly, so the owner's roles let a viewer-scoped key
  minted by an administrator satisfy an administrators-only rule, and refused a
  key holding the very role a rule names because its owner did not hold it.

  Stored permission answers now expire after five minutes rather than a day.
  `PERMISSION_CACHE_TTL_SECONDS` still sets it. The stored tier is shared between
  instances and the signal that retires it is held in memory, so an instance that
  did not handle a role change goes on serving what it stored until the entry
  expires; the default was a day, which is not a bound worth having on a revoked
  grant. Installs running a single instance see slightly more cache misses and no
  change in behaviour.

  A batch of permission writes no longer defers an unrelated revocation. Seeding
  retires the caches once at the end rather than per row, and the batch is now
  scoped to the operation that opened it, so a revocation raised while a seeder
  happens to be running takes effect immediately instead of waiting for the
  seeder to finish.

  A permission answer computed while the caches are being cleared is no longer
  stored. Clearing the shared tier is itself a write, and a check that both began
  and finished during it could read a row the clearing had not yet reached and
  promote it, which put a retired answer back into a faster tier that outlives
  the clearing.

- [#1747](https://github.com/nextlyhq/nextly/pull/1747) [`d29c54d`](https://github.com/nextlyhq/nextly/commit/d29c54daca0076cd0c41192946d2056046c66ac4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Renaming a class in the page builder could be refused without the author being
  told. A host that answers immediately — because the site style is locked, or the
  name is one it already knows is taken — had its refusal discarded, so the row
  cleared and the rename looked like it had worked until the next read. A host that
  answered a moment later was always shown correctly; only the immediate answer was
  lost.

- [#1782](https://github.com/nextlyhq/nextly/pull/1782) [`e1605f8`](https://github.com/nextlyhq/nextly/commit/e1605f8b03c0c4111716d426fe0a125e3f174b2c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A `text` widget declares its prose and the dashboard draws it.

  The archetype existed in the contract with nothing to carry the prose and no
  renderer behind it: a plugin declaring one got a card reading "not rendered
  yet". A text widget now declares `content` as markdown -- headings, paragraphs,
  lists, emphasis, inline code, block quotes and links -- and the host draws it
  through the same rich-text stack the editor uses, read-only, loaded only when a
  text card is on the dashboard.

  Three things the markdown cannot do, by design. Raw HTML is shown as the text it
  is. A link may point at `http`, `https`, `mailto`, `tel`, or a path on this site
  written as `/...`, `./...` or `#...`; one to anything else is left on screen as
  the markdown it was written in, so the author can see it was refused. And the
  content is bounded at registration, and refused over the bound rather than cut:
  it travels inside every dashboard load for every reader offered the card. An
  external link opens in a new tab.

  `content` is required for `text` and refused on every other archetype, on both
  the registry and the plugin channel through one rule.

  The admin workspace payload now carries only the widget declarations its reader
  may see, and only the parts of them. A declaration is its whole content -- a
  `text` widget's prose, an `actions` widget's shortcuts -- so the gate a widget
  declares through `requiredPermission`, and the gate each of its actions
  declares, is applied on the server before the declaration ships, from the
  plugin channel and the registry alike, by the same decision the dashboard
  layout endpoint places cards with. Where two plugins contribute the same widget
  id, only the first declaration ships, which is the one the dashboard draws.
  Previously every authenticated caller received every declaration whole and the
  browser hid the gated cards and shortcuts.
  A registered widget the payload cannot carry -- one JSON drops or rewrites --
  no longer wins a collision with a contributed one; the contribution stands, as
  itself, with the gate it declared. And a numeric character reference outside
  Unicode's range (`&#1114112;` and up) in a text widget's markdown now draws as
  the replacement character, as it would on a web page, instead of blanking the
  card.

  The dashboard layout's `scope` token now also covers which shortcuts inside
  the visible cards the reader may see, so the admin re-reads its workspace when
  a reader gains or loses a shortcut's permission and not only when a card
  appears or disappears.

- [#1867](https://github.com/nextlyhq/nextly/pull/1867) [`0d5f838`](https://github.com/nextlyhq/nextly/commit/0d5f838701b6ef77b390fa79eaf985f50b449dca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Importing a design-token file reports what the reader passed over from the reader itself, rather than from a second walk of the file. Two of the format's own fields now say what was lost: `$extends` (the group it would inherit from is not followed, so those tokens are not imported) and `$deprecated`. A token the importer refuses no longer also claims its value was read from `$value`.

- [#1885](https://github.com/nextlyhq/nextly/pull/1885) [`0708ec6`](https://github.com/nextlyhq/nextly/commit/0708ec68cd6785776f073f8e4453ffd95d8ccaca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A design-token import no longer calls an `$extends` that points through a `$`-prefixed key an inheritance, and a token refused for its name or identity still says when its `$type` was ignored.

- [#1788](https://github.com/nextlyhq/nextly/pull/1788) [`9e59229`](https://github.com/nextlyhq/nextly/commit/9e59229d43ae0a57b2d14bf8c30c651f45bbab52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A bulk create (`createMany`) and a create or update made inside a caller's transaction now write a `fieldGroup` field's value to its component table, as the ordinary create and update do. Before, a bulk create of any collection that embeds a field group failed every row with `no column named <field>`, and a transactional update reported success while leaving the component's old value in place. A transactional update held as a working draft now carries the field group in the draft.

- [#1801](https://github.com/nextlyhq/nextly/pull/1801) [`0121364`](https://github.com/nextlyhq/nextly/commit/0121364ce39b6f2780b3500b1a35aff700769af5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `updateEntries` on the collection entry service now takes `overrideAccess`, as `createEntries` already did: the collection gate, the publish-transition pre-resolve and every per-entry write skip access when it is set. Before, a trusted batch update had no trusted path and was judged as an anonymous caller, so every row was refused on a collection whose update rule wants a user.

- [#1728](https://github.com/nextlyhq/nextly/pull/1728) [`06f192f`](https://github.com/nextlyhq/nextly/commit/06f192f9b0546085ca3bd700cff0b97fe94206e1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly --version` reports the version that shipped.

  The constant behind it was typed by hand under a comment saying it "should
  match package.json version". It did not: the CLI answered `0.1.0` while the
  package shipped `0.0.2-alpha.65`, so anyone asking the tool which Nextly they
  were working against got a confident wrong answer — and telemetry attributed
  every CLI event to a version that has never been published.

  It is asked of the same resolver the plugin system already uses to validate a
  plugin's `nextly` compatibility range, so a reported version and a
  compatibility answer can no longer disagree. A test holds the two together.

  The scaffolded agent guide now says how to find that version and where the
  authoritative documentation is, including the two machine-readable indexes at
  `/llms.txt` and `/llms-full.txt`. An agent working in a Nextly project would
  otherwise answer from whatever it remembers of some other version.

- [#1702](https://github.com/nextlyhq/nextly/pull/1702) [`2a6f497`](https://github.com/nextlyhq/nextly/commit/2a6f497fe51cb6bc2403bf77b1e929ceeb45b4a0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard card that only matters sometimes had to hide itself. The
  get-started card was placed in the grid, given an order, and then rendered
  nothing once seeding was done — so the arrangement reserved a slot for a card
  drawing nothing, and the reason lived in a component rather than in the
  declaration.

  A widget can now declare that it is transient: it names the condition it shows
  under, and the host stops offering the card once that condition lapses.
  Pinning and reader dismissal are not part of this release — a card cannot yet
  ask to sit above the ordinary order, and a reader cannot yet end one early —
  a reader who declines the get-started offer keeps its slot until the install
  has content.

  The condition is a NAME from a closed set the host owns, never a predicate or
  callback a widget supplies, so an onboarding surface cannot become the kind of
  unconstrained notice channel that other admin ecosystems have never managed to
  contain. A name this release cannot answer is refused when the widget is
  registered, where the author can still be told.

  The first condition asks whether THIS reader can see any content, and is
  deliberately about the reader rather than the install: answering across
  everything would report on rows the reader is not allowed to know exist. A
  draft counts as content — someone who has written one post and not published it
  is not looking at an empty install.

- [#1735](https://github.com/nextlyhq/nextly/pull/1735) [`8653c19`](https://github.com/nextlyhq/nextly/commit/8653c19201992cd0243b2927ad017efe1da9a288) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An API key's write appears in the activity trail.

  It recorded nothing before — not mislabelled, absent. The recorder refused any
  actor that was not a signed-in person, because a row's identity column is
  joined to the accounts table and a key's own id would find no account and be
  filed as an already-erased person. So every write made with an API key was
  invisible, and nothing about it is recoverable after the fact.

  The row now carries the KIND of caller its identity column refers to, and the
  admin's Recent Activity names the key rather than showing a blank actor.
  `user_id` is unchanged and still required: it is already documented as the
  actor's opaque reference, so one nullable `actor_type` is the whole schema
  change and no dialect needs a nullability rebuild.

  A NULL kind means a row written before this existed. Those are all user writes,
  because no other kind was recordable.

  Writes with NO initiating actor — seeds, migrations, imports and jobs — are
  still not recorded, and the reason has changed rather than gone away. They run
  while the schema is being created, and a failure to write the trail fails the
  surrounding write: a trail insert against a table that does not exist yet would
  fail the seed that was creating it. That needs its own answer.

- [#1837](https://github.com/nextlyhq/nextly/pull/1837) [`9c071ae`](https://github.com/nextlyhq/nextly/commit/9c071ae85e64e59942653408215b4ef0f06277ed) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-mcp` now serves a Model Context Protocol endpoint. It exposes
  nothing through it: no tool, resource or prompt is registered yet, so a client
  that connects finds a server with no capabilities. What this release adds is the
  address, and the checks that decide who may reach it.

  The endpoint is a Nextly route rather than a file you mount yourself, so it
  inherits the authentication every other route gets: a signed-in session, or
  `Authorization: Bearer` with an API key. A key is judged on the grants stamped
  on the key itself rather than on what the person who minted it can reach, so an
  agent is bounded by the key you give it. A scaffolded project serves the
  endpoint at `/admin/api/mcp`.

  It stays off unless you turn it on. While `enabled` is `false`, which is the
  default, the plugin contributes no route at all.

  A request addressed to a hostname you have not published is refused with `403`.
  That is what the transport specification requires a server to do, and what makes
  a name an attacker controls useless even when it has been made to resolve to
  your server: the protocol library ships both the `Origin` and `Host` checks and
  applies neither, so a handler wired straight to a route answers a forged `Host`
  with `200`. By default the endpoint answers on the hostname of
  `NEXT_PUBLIC_APP_URL`, and on localhost if that is unset; `allowedHosts` names
  them yourself, and replaces that default rather than adding to it.

  Clients speaking the 2025 revisions are served statelessly, which is every
  shipping client today. `GET` and `DELETE` answer `405`: they were the session
  operations, and the `2026-07-28` revision removed them.

- [#1665](https://github.com/nextlyhq/nextly/pull/1665) [`fe5206e`](https://github.com/nextlyhq/nextly/commit/fe5206ea8f57a9466d20ee4cb28827fcb1011138) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly.group` and `nextly.timeseries` now work on the documented instance.
  `getNextly({ config })` builds its object by binding one method at a time and
  forwarded neither, so both were `undefined` on the path the docs recommend
  while working through the lazy singleton — `group` since it shipped. A test now
  compares the instance against the Direct API's own surface, so the next
  omission fails rather than reaching a consumer.

  A yearly timeseries no longer reports zeros. The documented maximum of 366
  intervals starts in 1661, and MySQL renders that bound with `FROM_UNIXTIME`,
  which answers NULL outside its range — so the predicate meant to bound the scan
  matched nothing. A bound outside what the column can store is now omitted,
  which excludes no row that could exist.

  A timeline refuses earlier and more clearly. A malformed date field is named
  rather than surfacing as a server fault; an unsupported interval is judged after
  collection authorization, so an untrusted caller gets the access refusal rather
  than a response that confirms the collection exists; and the window and the
  release visibility now resolve against one clock.

  A collection source describes what its timeline can actually do. It advertises
  `timeseries` only when it exposes a date the read would accept, and marks a date
  the read would refuse so a dashboard cannot register a card that fails on every
  load.

- [#1694](https://github.com/nextlyhq/nextly/pull/1694) [`ea942ba`](https://github.com/nextlyhq/nextly/commit/ea942bacdafeb46e228b88c932ad04a476122c83) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An editor can tell which rendered elements belong to a component instance.

  A component is inlined at render, so the instance node is replaced by the tree
  its definition describes and every element inside one carries a node id the
  page's own document does not contain. An editor hit-testing on the node address
  alone therefore resolved a click inside a component to an address it could not
  select, edit or delete.

  `INSTANCE_ATTRIBUTE` names the instance an element's node belongs to — the one
  the author actually placed on the page, even where components nest. It is
  written only for nodes the definition supplied, which is the half that makes it
  useful: an instance's slot content is nested inside the same inlined tree but
  belongs to the page, so it stays unmarked and directly selectable. That content
  is exactly what a marketer opened the editor to change.

  It rides the editor's node address the way its siblings do, so a published page
  carries none of it.

  A node that arrives already claiming `instanceOf` loses the claim. That field
  means "the resolver inlined this from a definition", and only the resolving pass
  may say so — but documents arrive from places that never ran it, and unknown
  node keys are preserved through storage deliberately. Left standing, an editor
  would send a click, an edit or a delete to a component the author never placed,
  while the node they were pointing at is one of their own.

  The composition-free fast path now walks a document carrying such a claim. That
  path was previously a pure optimisation; it is not one any more, because the
  document where a false claim survives is precisely the one with no components in
  it.

  The marker is the renderer's to write, and the renderer takes that back from
  the two other parties who could reach it.

  A BLOCK builds the element the marker lands on, so it can return a root that
  already carries one — hardcoded, or spread from a stored attribute bag. The
  marker is now ASSIGNED in both directions rather than merely added, so a root
  whose node carries no resolver provenance has the attribute removed rather than
  left as the block wrote it. The stored document's route into the same namespace
  was already closed; this is the same rule for the route a block controls.

  A block is also handed the node object itself, and everything read back after
  it runs is whatever it left behind. The editor's address — both the instance
  and the node id — is now snapshotted at the boundary before any of a block's
  code runs, including `rendersNothing` and the `slots` read, and carried down
  the synchronous and awaited paths. The awaited one matters most: "after the
  render" is a window there rather than an instant, and the same node object
  re-enters the output check on the far side of it.

  Placeholders carry the markers too. A placeholder is drawn INSTEAD of the
  block, so it never reached the marking step — which left the one element an
  author can see and click, when a block inside a component fails, addressing
  nothing. Definition node ids are re-minted during composition, so for those the
  host instance is the only thing an editor can act on.

- [#1662](https://github.com/nextlyhq/nextly/pull/1662) [`fe645f1`](https://github.com/nextlyhq/nextly/commit/fe645f17a0492ccc22cb57e0acc11cffaca1ae04) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The block renderer now asks the engine which HTML `id` a block emits instead of deciding again. `renderedDomId` was already the one rule for that question — validation, the planners, the copier, the resolver, the tree walker and the builder all derive from it — and the renderer, the thing that rule models, was the last place keeping its own copy.

  One rendered-output change comes with it: a block whose id is set to an EMPTY STRING no longer emits `id=""`. It emits no `id` attribute at all. Nothing addressable is lost — the DOM Standard unsets an element's ID when the attribute is the empty string, so `getElementById("")` never matched it and no `aria-labelledby`, `for` or `#` selector could reach it, while the HTML Standard requires an id to hold at least one character. What shipped before was invalid markup that addressed nothing.

  An empty id still SHADOWS an `id` in the block's attributes, which is the part authors can observe, and the inspector still offers to remove it. Its note now says the block renders no id at all and that the attribute id is ignored, rather than describing the `id=""` that no longer appears.

- [#1848](https://github.com/nextlyhq/nextly/pull/1848) [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-mcp` corrections, and two package summaries that said the
  opposite of what the package does.

  The npm description and the root package catalogue still described the package
  as a placeholder serving no endpoint, which is what a reader discovering it
  through the registry or through an indexed README was told. Both now say what it
  is.

  The route matcher's grammar is published. `routePathIsLiteral` answers whether a
  path names exactly one address or a family of them, and `@nextlyhq/plugin-sdk`
  re-exports it, so a plugin taking a path from an operator can refuse a pattern
  while the config is being written without restating the rule beside the matcher
  that will actually route. A restatement stricter than the matcher refuses paths
  that would have worked, which is what happened here: a check that refused every
  `:` rejected `/mcp:v1`, a literal addressing exactly one URL.

  `path` refuses a value that cannot address a single endpoint (a missing leading
  slash, a trailing one, a `:param` pattern, or the mount itself) at the moment it
  is written rather than as a 404 to explain later. Its documentation also now
  says what it cannot promise: a path Nextly itself serves will not reach the
  endpoint, because core answers first, and that precedence is deliberate.

  Authentication runs before the endpoint's address check, so a request carrying
  no credential is answered `401` whatever address it used. That is written down
  now, in the package and in its README, rather than left for a reader to discover
  from a status they did not expect.

- [#1763](https://github.com/nextlyhq/nextly/pull/1763) [`0afa12a`](https://github.com/nextlyhq/nextly/commit/0afa12a3300679a97939f463e82702a721d1b505) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The instance exposure view no longer reports an ancestor as cleared when only a
  descendant path was cleared, no longer counts an override on a path the resolver
  refuses to write as in force, and finds each row's winning write among its own
  node's writes rather than scanning every write per row.

- [#1746](https://github.com/nextlyhq/nextly/pull/1746) [`c284753`](https://github.com/nextlyhq/nextly/commit/c28475395a77f334aa45acc75e8f85c439d8e455) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An editor can ask what one component instance currently shows for each property
  its definition exposes, through `instanceExposure`.

  It answers with the value in force and WHICH layer supplied it — the definition
  itself, a variant preset, or the instance's own override — because those need
  different offers: resetting a value the author never set is not a reset. The
  answer separates a deliberately cleared property from one the definition simply
  leaves empty, which render identically and are not the same edit, and it reports
  overrides whose exposed property has since been removed rather than dropping
  them silently.

  Derived from the precedence the resolver already applies rather than computed
  beside it, so a renderer and an editor cannot disagree about what is in force.

- [#1798](https://github.com/nextlyhq/nextly/pull/1798) [`aa21dbb`](https://github.com/nextlyhq/nextly/commit/aa21dbbb107406f7b6068add48495780c539da10) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The instance inspector now edits two more of a component's exposed properties.
  A link is edited as the address its property holds, keyed for an address, and
  clears the property when emptied rather than pointing it at an empty string. A
  visibility property is a checkbox: checked serves the component's node on this
  page, unchecked hides it, and an inherited row reads as shown because that is
  the component's own rule until the definition gates the node itself. Rich text
  and image rows still show their value and source without a control: a passage
  is edited on the canvas, and an image needs a picker the builder cannot reach
  yet.

- [#1786](https://github.com/nextlyhq/nextly/pull/1786) [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Selecting a component instance in the builder now opens its own inspector in
  place of the block tabs: the component's title (and how many pages use it, once
  the library carries that count), then one row per exposed property showing the
  value in force, where it came from (inherited,
  from a variant, overridden, or cleared), and a visible Reset on every override the instance itself holds.
  Text and choice properties are edited in place; rich text, image, link and
  visibility rows show their value and say they are not editable here yet. An
  emptied text field clears the property rather than writing an empty string, a
  row another exposure shadows names the one the page shows, and values stored
  for properties the component no longer exposes are listed with a Discard rather
  than dropped. The block inspector's name and lock fields now come from one
  shared module, as does the draft-follows-the-document behaviour of every text
  field.

  The blocks engine now publishes `readableDefinition`, the rule the resolver
  applies to a supplied component definition before inlining it, so the inspector
  refuses exactly what the canvas refuses: a definition in another format, or one
  whose nodes are not a list, draws no editable row.

- [#1743](https://github.com/nextlyhq/nextly/pull/1743) [`9563aa3`](https://github.com/nextlyhq/nextly/commit/9563aa3ec7fe14b189797ab3227cdb3bd41666f0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A missing dashboard service no longer fails a content write.

  The audit recorder asks the container for that service, and a container reports
  an absent registration two ways: by throwing, and by answering `undefined`. Only
  the throw was handled, so the second walked past the catch that exists to keep an
  audit failure from failing the write, and died on a property access instead. "No
  dashboard service registered" became a FAILED CONTENT WRITE.

  The activity feed also names a system actor as "System" instead of rendering a
  blank author. Nothing writes those rows yet, and this release does not start:
  a write that names no initiating user is still not recorded, because a plugin's
  `init()` hook runs before pending migrations do, and an insert against a table
  that has not been migrated yet would take the boot down with it. The column can
  already hold the value, so the reader handles it rather than showing an empty
  author for every import and job the moment something does.

- [#1731](https://github.com/nextlyhq/nextly/pull/1731) [`110d2bc`](https://github.com/nextlyhq/nextly/commit/110d2bcdcfe19e9a846ea6e40abcc52af5611600) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The guidance for anonymous content reads described a limitation that no longer
  holds, in the direction that matters: it said inline `defineCollection({ access })`
  code rules are not applied without a user, and told readers to gate such content
  behind an authenticated read.

  Those rules ARE applied now. A code rule reads what it is handed, and an
  anonymous caller is something it can be handed, so it receives `user: null` and
  no roles and decides on that. A rule written `read: ({ user }) => !!user` hides
  the content exactly as its author intended.

  What an anonymous read still cannot apply is a row-level CONSTRAINT rule,
  owner-only or a custom rule returning a query predicate. Those compare a row
  against somebody and there is nobody to compare it to, so the guidance to use an
  authenticated read stands for them and now says so specifically.

  Both copies are corrected, in `resolveContent`'s own contract and in the routing
  guide. Two tests hold the claim at the point that decides it, including a
  control that no inline rule still means the stored rules decide.

- [#1870](https://github.com/nextlyhq/nextly/pull/1870) [`d95e4d6`](https://github.com/nextlyhq/nextly/commit/d95e4d695fd2678071a8b93c016b8e80199b7229) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key reaching a collection or single through a permission-gated route, including plugin routes that declare `requiredPermission`, is now held to that entity's code-defined `access` rule. Previously holding the grant was enough on these routes, while the collection routes already applied the rule. A key the rule refuses now receives 403 where it was admitted.

- [#1720](https://github.com/nextlyhq/nextly/pull/1720) [`da86960`](https://github.com/nextlyhq/nextly/commit/da869606c5d326aac1b75a50a2324c6e47d39bad) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The usage index is backfilled, so "used on N pages" can be exact on a site that
  existed before it.

  The write hooks maintain the index going FORWARD. Nothing filled it for
  documents already stored when the plugin was installed, or when a version added
  an index, so every component on such a site had no rows at all — and no rows is
  indistinguishable from a component nothing uses, which is the answer a delete
  decision acts on. Until now `complete` was false unconditionally for that
  reason.

  A sweep does the filling, because nobody is in a position to enqueue it: the
  work is owed from the moment the plugin meets existing content, and the events
  that make it owed are not things any handler sees.

  Each pass walks one (collection, field, locale, variant) — the smallest unit a
  rebuild can finish, so the largest one certain to make progress — stops at the
  runner's deadline, and defers the rest to a durable queue. A scope is recorded
  only after its walk resolves AND brings every row it touched into agreement, so
  a partial rebuild is retried rather than marked done and never revisited.

  A document too large to read whole is the one exception, and it is recorded
  rather than retried. Exceeding a bound is deterministic — the same document
  exceeds it on every pass — so refusing would leave the scope outstanding for
  ever and make every drain rescan the collection. Such a document leaves an
  `unreadable` marker instead, written before the scope is recorded, and that
  marker keeps health from calling any count exact until a later save or a change
  of traversal limits makes the document readable again.

  It pages by KEYSET rather than by offset. Deleting a document the walk has
  already passed shifts everything behind it back, so an offset walk skips the row
  that crosses the boundary — survivable for a repair, where the missed document
  keeps the rows it had, and not for a first fill, where it has none and nothing
  notices. Resuming after the last id seen removes the shift entirely.

  Collections come from the live REGISTRY, not from configuration. The Schema
  Builder creates collections at runtime, and those exist only there; enumerating
  the configured set would walk a narrower population than the hooks maintain
  while judging readiness against that same short list.

  Completion is recomputed against the scopes that exist NOW and against the
  bounds the index is derived under. Adding a collection, a locale or drafts
  returns the count to a floor until the new work is done, and changing
  `pageBuilder({ limits })` starts a new generation rather than inheriting
  progress made under bounds the renderer no longer applies.

- [#1816](https://github.com/nextlyhq/nextly/pull/1816) [`075870a`](https://github.com/nextlyhq/nextly/commit/075870acd262c00fa048c63ab9e85568dcede8e7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A bulk write now reaches a localized collection. `createMany` failed every row
  on a collection with `localized: true` — the shared create implementation wrote
  the translatable values to the main table, which has no columns for them, so
  the driver's own message ("no column named …") came back per row. It performs
  the same split as a single create and writes the companion row for the write's
  locale, inside the same transaction; the shared update implementation, which
  had the identical gap, upserts that row. Both refuse a named locale as before:
  these paths write the default language.

- [#1712](https://github.com/nextlyhq/nextly/pull/1712) [`1f4941c`](https://github.com/nextlyhq/nextly/commit/1f4941cb6c84487ee4fc1d554e3fdbda3812dad6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two slots of the chart palette were not legible in light mode. Measured against
  the surface a widget draws on, the cyan and amber slots reached 2.21:1 and
  2.15:1 — below the 3:1 minimum that applies to a graphical object someone has to
  read to read the chart. The draft segment of the content lifecycle card is drawn
  in the amber one.

  Both move down their ramp in light mode only: cyan-600 and amber-700, measured
  at 3.68:1 and 5.02:1. Dark mode is untouched, where the lighter steps sit at
  9.0:1 and 9.3:1 against the same surface — the two modes need different steps of
  one ramp rather than a single shared value, which is what they had.

  The palette is now asserted rather than exempt. Every slot is held to the
  minimum against the card surface, in both modes, so a slot that fails is caught
  when the colour changes rather than when someone first draws a chart with it.
  The bar fill a widget paints over its track is asserted the same way.

  The lifecycle ring drew its two arcs touching, with nothing between them but
  their own colours — 2.15:1 apart in dark mode, where one arc is white. A
  separator in the surface colour is now carved under each segment, so where one
  arc ends is visible whatever the two colours are. No palette choice could have
  fixed that boundary: one of the two segments is the primary, and a colour far
  enough from both white and a near-black card would have dictated the amber for
  every other chart to settle one ring.

  The builder's style inspector paints its provenance dots in the same two slots,
  on a surface that aliases the muted container rather than the card. Those two
  pairings are asserted as well.

- [#1862](https://github.com/nextlyhq/nextly/pull/1862) [`6556810`](https://github.com/nextlyhq/nextly/commit/65568108bc06b44df60efa450bdcc3021b39af6d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The class manager now describes a class the way the page compiles it: a declaration the site's remote-host policy drops is no longer listed, and styles held under a site-defined breakpoint are counted in the "more elsewhere" note.

- [#1642](https://github.com/nextlyhq/nextly/pull/1642) [`c7b8348`](https://github.com/nextlyhq/nextly/commit/c7b834843e3d3b2aae652cbc6d2f07c104289f4e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Collection reads: give the list, count and by-id paths one implementation per concern, and apply the stored read rule's query constraint on all three.

  A read by ID resolved its row predicate from the owner-only rule alone, while listing and counting resolved it from the access-control service's query channel. The two agree for an `owner-only` rule and nowhere else, so a `custom` read rule returning a query constraint filtered every listing and left a read by ID unfiltered — a row withheld from the list was reachable by its ID. All three paths now ask the same question, translate the answer through the same where-builder, and refuse a constraint they cannot fully express.

- [#1809](https://github.com/nextlyhq/nextly/pull/1809) [`f3ab090`](https://github.com/nextlyhq/nextly/commit/f3ab09095686af3c7ddf831767d90bfce43276c9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field defaults now reach every write that applies them, at every depth. A `defaultValue` declared as a function is applied on an ordinary REST or Direct API collection create; before, a collection's fields reached that write from their stored definition, where a function does not survive, so the field was left empty. A new field-group instance fills the defaults its own fields declare before it is validated, so a required child with a default no longer refuses an instance the caller could not have completed. A Single's first read fills the defaults declared inside its groups and repeater rows, and refuses a password default at any depth, as it already did at the top level. In a LOCALIZED field group, a repeatable or dynamic-zone instance is now prepared before its write is split between the main row and the companion row, so the defaults it takes, the relationships it normalizes and the passwords it hashes reach the rows that are stored rather than being left on a payload the split had already copied.

- [#1871](https://github.com/nextlyhq/nextly/pull/1871) [`44fec3d`](https://github.com/nextlyhq/nextly/commit/44fec3d8d7503652c8faef483587b9af7d5c99cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving part of a page as a pattern now puts each renamed id back on the right
  block, even when blocks in the selection came from different patterns.

  Before, a save had one answer per id for the whole selection. When two blocks
  or two links disagreed about what an id used to be called, nothing was put back
  and the pattern kept a page-specific id such as `pricing-4985ccb3`. Now each
  block that carries an id is decided on its own, and a link follows the element
  it points at: if that element is saved too, the link takes whatever id the
  element ends up with, and otherwise the link goes back to the name its own
  pattern gave it.

  Existing pages and patterns need no change. Saves that already put ids back
  store the same result as before; the difference is only in selections that mix
  blocks from different patterns or components, which now keep correct ids where
  they used to keep page-specific ones. `reidForestWithMap` accepts a new
  `restoreEach` policy for callers that need this per-node decision.

- [#1776](https://github.com/nextlyhq/nextly/pull/1776) [`5702cdc`](https://github.com/nextlyhq/nextly/commit/5702cdc54ef8f97ed319721503ec59a75494818a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every drag surface in the admin now names what it is moving, and a drop back
  onto the same row is reported as unchanged.

  The select-field option list, the hooks editor, the repeater and component
  rows, and the schema builder canvas still announced dnd-kit's generated ids
  during a drag. They now say the option's label, the hook's name, "Gallery item
  2", or the labels of the fields in a builder row -- "Picked up First name and
  Last name, row 1 of 3". The option and hook drag handles are named after their
  item; the hook handle had no accessible name at all.

  Dropping an item where it was picked up -- Space twice, or a pointer released
  over the original row -- used to announce that it had "moved to" its own
  position. It now says it was dropped where it was and nothing moved, which is
  what happened.

  The schema builder canvas packed its rows two different ways: the list left
  hidden fields out and gave a repeater or group its own full row, while the
  reorder that consumed the list's row numbers did neither. With a hidden field
  above, or a half-width repeater, dragging a row moved a different row. Both
  now read one packing, so the row you drag is the row that moves.

- [#1750](https://github.com/nextlyhq/nextly/pull/1750) [`1bd2187`](https://github.com/nextlyhq/nextly/commit/1bd218792cda7ebb04ef271f1daa1da93041f92b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `getCachedNextly` is exported from `@nextlyhq/plugin-sdk`. Plugin server work
  that runs outside a route has no `ctx.services` to reach through and no config
  in scope, so it needs the already-booted instance; until now the only import
  path was core's root, which is not the surface a plugin's compatibility is
  governed on. It is `@experimental` there, per the stability ladder.

  `@nextlyhq/plugin-page-builder` reads its site-style single through that import
  now instead of core's root.

  Its docblock also described the wrong boundary. It said publishing the accessor
  from `nextly/runtime` would force a `next` peer dependency on plugin consumers.
  It would not: `next` is the one peer this package does not mark optional, so a
  consumer resolves it whichever subpath they import. What the root actually
  avoids is `next/*` entering a module graph that has no request lifecycle to run
  inside, which matters to a plugin bundled for the browser and to the CLI.

- [#1835](https://github.com/nextlyhq/nextly/pull/1835) [`9c2e0e7`](https://github.com/nextlyhq/nextly/commit/9c2e0e7c10dc483b1d29a2675d91c7a9cdbb83a8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The onboarding checklist now judges an API key's read grant by the rules a
  collection create actually runs, rather than by the code-first config validator.

  The checklist links its step to the Schema Builder, whose create posts to
  `POST /collections` and validates the name with `collectionNameSchema`. That
  schema's verdict is therefore whether the step can be finished, and the
  code-first validator disagreed with it in both directions: it reserves `admin`
  and `dashboard`, which the Builder creates happily, and it allows hyphens, which
  the Builder does not. So a key stamped `read-admin` was refused a step it could
  finish, and one stamped `read-team-updates` was offered a step it could not.

  The predicate now asks `collectionNameSchema` itself rather than restating any
  rule, so a reserved name or a length limit added there reaches the checklist with
  nobody editing a second file. That also brings in two refusals no restatement
  had: SQL keywords such as `select`, and the Builder's own reserved names such as
  `accounts`.

  An app that cold boots only through `createDynamicHandlers` now seeds its preset
  roles as well as its permissions. That path re-seeded permissions on the first
  request but never re-resolved the presets, so an administrator who was not a
  super admin never received a new collection's grants there, however many times
  the app restarted. The two are now one boot operation that both paths call,
  which is the same fix this module already carries for plugin-declared
  permissions.

- [#1736](https://github.com/nextlyhq/nextly/pull/1736) [`e9adb7b`](https://github.com/nextlyhq/nextly/commit/e9adb7b44f0d23c7ef3b288d4a56009da2a54826) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate:fresh` empties the database and rebuilds it. On PostgreSQL it
  asked for the list of tables to drop from a schema called `public`, but the
  `DROP` it then issues names no schema at all, so it goes wherever the
  connection's `search_path` points.

  On an installation that keeps Nextly in its own schema those two disagreed, in
  both directions at once: Nextly's own tables were never listed, so they survived
  the reset — and whatever else happened to be in `public` was listed, and dropped.

  Discovery now asks which tables the drop will actually reach, rather than naming
  a schema at all. Nothing changes for a database that uses `public`, which is the
  default.

- [#1709](https://github.com/nextlyhq/nextly/pull/1709) [`0c9ec43`](https://github.com/nextlyhq/nextly/commit/0c9ec43d265b3e468c31ce0c87deb3b3d84edee6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An editor holding a document confirms its claim every fifteen seconds, and those
  confirmations can overlap: a slow one and the next one are both in flight, and
  their answers can come back in the wrong order. The lease already knew this and
  only ever moves forward. What the same reply says about a colleague waiting for
  the document did not, so a confirmation that left BEFORE anybody asked could land
  after one that already reported the request, and quietly take the notice away
  again until some later beat happened to restore it.

  Only the newest confirmation may now change that notice, on the same rule and for
  the same reason the lease uses.

- [#1737](https://github.com/nextlyhq/nextly/pull/1737) [`81bf0d1`](https://github.com/nextlyhq/nextly/commit/81bf0d16305ebc5f9f7fdd873c65d92b17f739f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Four repairs to the dashboard's onboarding card, and one performance fix behind
  it.

  Declining the offer of demo content now drops the card from the open dashboard.
  Skipping used to change nothing the server could see, so only a successful seed
  refreshed the arrangement; the card's condition reads the decline now, which
  left the one gesture that could strand a placement the server had stopped
  offering — visible in edit mode, and refused on save.

  A step this build cannot name no longer reads as a finished checklist. Dropping
  an unreadable row keeps the card from breaking, and on its own it introduced
  something worse: a newer server reporting an outstanding step under a name this
  build does not know would leave every remaining row complete, so the card
  announced itself finished and asked to be taken down while the server went on
  offering it.

  The checklist follows a schema change. Two of its steps are answered from the
  collection registry, so creating a collection in another tab moved the answer
  without moving the card, which went on asking for a collection that existed.

  One layout read now resolves the reader's collections once. Two conditions ask
  overlapping questions of the same rows, and each was resolving them
  independently — three authorization traversals and two counted reads per
  collection for a single dashboard load.

- [#1742](https://github.com/nextlyhq/nextly/pull/1742) [`73b7cb6`](https://github.com/nextlyhq/nextly/commit/73b7cb60667b1d542e567e180db316ece98da085) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The setup checklist no longer shows a finished list to a reader who still has
  work to do.

  Its answer was held as fresh for five minutes and the card is unmounted whenever
  it is not offered, so the two combined: a reader who completed onboarding and
  then deleted their last collection was offered the card again, and it drew every
  row ticked from the answer the previous visit had left behind. It reads what is
  true now, and will not report completion from anything it did not just fetch.

  Applying schema changes refreshes it too. Two of its steps are answered from the
  collections a schema change moves, and the card's own listener is not mounted at
  the moment that matters — the answer changes precisely while the card is absent.

- [#1751](https://github.com/nextlyhq/nextly/pull/1751) [`dd4027c`](https://github.com/nextlyhq/nextly/commit/dd4027ce091e4fff416763e6adf4bd6cd0679767) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The setup checklist no longer vanishes from a reader who still has a step to do.

  Whether the card was allowed to drop itself was settled by comparing when its
  answer arrived against when it mounted, and a wall clock cannot make that
  comparison. `Date.now()` is deliberately coarsened by browser
  anti-fingerprinting -- to 100ms buckets under Firefox's resistFingerprinting --
  so both readings can land on the same value; and it steps backwards under a
  clock correction, which can place the mount before an answer that genuinely
  predates it. Either one let the card act on the previous visit's completed
  answer and drop itself while a step was still outstanding.

  It now asks the query observer how many answers have arrived since it
  subscribed, a count that can neither collide nor run backwards, and requires
  that answer to have succeeded: a refetch that fails leaves the earlier
  completed answer in place, and a failure to refresh is no longer read as
  progress.

- [#1659](https://github.com/nextlyhq/nextly/pull/1659) [`80db282`](https://github.com/nextlyhq/nextly/commit/80db2825804616d8a01ffef09ddd5b685c9eca92) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Access is decided by one mechanism. The stored per-operation rules are gone.

  Two independent systems answered "may this caller do this", and only one of them
  was configurable. The code-defined `access` on a collection's or Single's own
  config is reached from every transport. The stored rules were a second engine —
  five rule types evaluated against a JSON column — with no way to author them:
  collections had no code, UI or REST surface for the column at all, and a Single
  had only an undocumented REST field. Two evaluators for one question is a
  divergence waiting to be found by whoever hits the gap between them, and the
  half nobody could configure is the half nobody was checking.

  So the second engine is removed rather than reconciled. `AccessControlService`
  and its five evaluators, the `StoredAccessRule` / `CollectionAccessRules` /
  `SingleAccessRules` types, the operation constants that only served them, and
  the `access_rules` column on `dynamic_collections` and `dynamic_singles` all go.
  `AccessOperation` and `ACCESS_OPERATIONS` stay: the RBAC gate is keyed on them.

  Three behaviours change. Two narrow; one WIDENS, and it is the one to read
  before upgrading.

  **Stored rules are no longer enforced.** Any value still in `access_rules` is
  ignored from this release on. For most installations that changes nothing,
  because nothing could write the column: collections had no surface for it at
  all. It DOES change behaviour for an installation that set a Single's rules
  through the undocumented REST field, or wrote the column directly — and the
  widest case is an `owner-only` read. That filter was produced by the stored
  evaluator alone, so a list, count or by-id read that used to return only the
  caller's own rows now returns every row the coarse gate admits for the
  collection. Before upgrading, express any rule you still need as code-defined
  `access` on the collection's or Single's config; that is the only place a rule
  is read now. An installation whose database still holds rules is told so at
  startup, with the tables and row counts, so the case is named rather than
  silently widened.

  An anonymous publish or unpublish is refused outright. It previously fell
  through to a rule-less public default unless an explicit stored `publish` rule
  denied it, so a collection with no rules — which was every collection — let an
  unauthenticated caller move a document into the published state.

  Populating a relationship judges the TARGET COLLECTION for the caller, once per
  expansion rather than once per row, by evaluating that collection's own
  code-defined `access.read` with the same context a direct read of it builds. A
  session caller's rule sees their real roles and effective permissions; a
  scoped API key's rule sees the key's own grants and roles, in the spelling a
  rule reads (`posts:read`) on every path — the translation-worklist read had
  built that caller by hand with the stored spelling. An anonymous reader is
  judged by the target's rule too, as a direct anonymous read of it is, and so
  is an anonymous read of a Single. So a related row is admitted or refused
  with every other row of that target, and a row the caller can read directly
  does not vanish from a relationship pointing at it. What expansion mirrors is
  the target's code-defined rule, and only that: it does not require the
  target's database `read-<target>` grant, for the reason it never did
  (requiring a grant naming a collection the caller never asked for by name
  would empty the relationship for every caller whose grants do not list it).
  So a target that declares no read rule is populated for a caller the direct
  read would refuse on the grant alone; a target whose rule refuses the caller
  is withheld — and decided before any of its rows are queried.

  A new database never gets the `access_rules` column. One that already has it
  keeps it, and every schema entry point reports it rather than dropping it:
  `nextly migrate` refuses and names it (`drops column
'dynamic_collections.access_rules'`), the dev-server reconcile blocks the drop
  and says so, and `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` is how an operator removes
  it. Dropping a column that holds configured rules is their decision, not a
  side effect of upgrading.

  One upgrade is NOT supported and is called out rather than papered over. A
  database old enough to be missing core columns added since — a 0.45-era
  install — reconciles a drop and several adds on one table, which drizzle-kit
  pairs to ask whether the drop is a rename. `pushSchema` builds that resolver
  internally with no way to supply a hints handler, so it throws, the boot
  degrades to its additive-tables-only baseline, and no column alteration lands.
  Such a database should run `nextly migrate` before taking this release.
  `upgrade-sim-045.integration.test.ts` is skipped for that reason, with the fix
  that restores it named in its header.

- [#1713](https://github.com/nextlyhq/nextly/pull/1713) [`91e66a4`](https://github.com/nextlyhq/nextly/commit/91e66a469537bd835408209354fe6da6043b946d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The check for a part name is now available to code outside the engine.

  A block states styles against named parts, and whether a given name is one the
  engine will accept was a question only the engine could answer — the check sat
  inside the package with no way out. Anything else that had to know, a store
  validating a class library on save for instance, had to keep its own copy of the
  rule, and a second copy drifts from the first without anyone noticing: the copy
  accepts a name the compiler then refuses, and the styles simply do not appear.

  There is one answer to that question again, and it is the engine's.

- [#1716](https://github.com/nextlyhq/nextly/pull/1716) [`1862d9e`](https://github.com/nextlyhq/nextly/commit/1862d9eb29737dfbc41175e7d0da4b87bb53821f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Choosing how many versions a collection keeps, and then editing that collection
  in the Builder, silently discarded the retention setting from `ui-schema.json`.
  The create path wrote it and the edit path did not, and the file is updated by
  replacing the whole entity — so the next edit replaced an entity that had the
  setting with one that did not.

  Six places each built that file's entry by hand, and each had forgotten a
  different setting. They now share one projection, and which settings the file
  carries is declared in a single list that the compiler checks: adding a Builder
  setting no longer compiles until somebody has said whether the file carries it.

  Which settings a _component_ may carry is part of that list, because the manifest
  refuses version history, retention, cache revalidation and webhook recording on
  one — a component has no entries of its own, so those belong to whatever embeds
  it. It refuses the key rather than the value, so a shared projection had to leave
  them out rather than send `false`.

  A description is also trimmed in one place now — the settings form both writes
  read from — so the record in the database and the entry in the file can no longer
  disagree about one with spaces around it. Clearing a description still sends the
  value that clears it, which is not the same as saying nothing about the field. And saving a field group's fields before its settings have
  loaded no longer replaces its entry with a nameless one.

- [#1829](https://github.com/nextlyhq/nextly/pull/1829) [`c211fb3`](https://github.com/nextlyhq/nextly/commit/c211fb3b7e0faea435ab1c33137b4ed7211be671) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The signal that retires a cached authorization answer is now stored in the
  database, so every instance sees it. It was a counter held in memory, which
  moved only in the process that handled the change: a second instance neither
  saw the move nor had one of its own, and went on serving what it had cached
  until the entry aged out. On the shared tier that meant a revoked grant could
  outlive its revocation by the whole cache lifetime.

  Cross-instance revocation now takes effect within about a second. Each instance
  reads the shared counter at most once per second rather than once per check, so
  the cost is one small indexed read per second per instance and not one per
  request. The instance that MADE the change applies it immediately.

  Two behaviour changes worth knowing about.

  An invalidation naming one user now retires every in-memory answer rather than
  that user's alone. The counter other instances read carries a number and not a
  user id, so a change they can see cannot be narrower than "something in RBAC
  moved", and keeping the scope locally would mean only the instance that made the
  change applied it narrowly. Refilling is a couple of indexed queries and role
  changes are rare; a stale answer costs a grant the install revoked.

  A batch of permission writes no longer holds back the in-memory tiers. It never
  existed to: what it saves is the unfiltered rewrite of every stored row, and
  that is still deferred to the end of the batch.

  Installations upgraded from an earlier version keep working before they
  reconcile their core tables. The new table arrives through `nextly db:sync`, and
  until it does, every read and write of the counter degrades to the previous
  in-memory behaviour rather than failing the authorization check that asked. The
  degraded state is reported once so an operator can see why cross-instance
  invalidation is not yet in effect.

- [#1844](https://github.com/nextlyhq/nextly/pull/1844) [`4eabbbf`](https://github.com/nextlyhq/nextly/commit/4eabbbf22a1e2df58b6bbb7baebd7561096789b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing a collection entry no longer discards an edit it is not allowed to publish.

  A publish folds the held working draft into the live row and then deletes that draft. The field rules ran when the caller's payload arrived, and for a publish that payload is just the status, so the draft's content reached the row having been judged only when it was saved. Where the publisher was not the author and a rule denied them one of the draft's values, that value was stripped: the rest was published, the pending change was consumed, and the author's edit was gone with no error and nothing left to recover it from.

  The promotion is refused instead, naming each field at its own path, including a field nested inside a group, and the pending change is kept for someone who can write it. Stripping stays the right answer on an ordinary write, where the value is the caller's own input and dropping it costs them nothing they did not already have. Only a value the write would CHANGE refuses it, so a denied field sitting at the value it already holds publishes as it always did.

  The same question is now answered in one place for every publish path. A Single's publish, `publishAllLocales` and a collection's publish each assemble the document they are about to write in their own way, since a collection's also carries components and many-to-many rows, and then hand it to one shared judge.

  A collection field rule is judged on the caller's own authority. An API key carries the grants stamped on the key, and the write paths did not pass them to the field rules, so a rule reading `permissions` was answered from the database roles of whoever owns the key. A correctly scoped key could not write a field it holds the grant for: the value was dropped in silence and the call still reported success.

  The caller's permissions are resolved before the publish transaction opens. The promotion gate runs under the row lock, because a check that runs before the write can disagree with the write, and a permission lookup first issued from in there waits on the pooled connection the transaction is holding: against a small pool the publish hung rather than failed.

  Only the pending change's own values are refused. A value the caller sends with the publish is stripped as it is on any other write, because it is their own input and dropping it costs them nothing they did not already have. The two are told apart because a rule reads its siblings: a caller's value can be allowed when their payload is judged alone and denied once the pending change is folded in, and refusing there would block a publish over the caller's own edit.

  An untouched field is not read as an edit because of how it was stored. A pending change is JSON, so a timestamp reaches the comparison as the ISO string it was serialised to while the live row comes back from the driver as a `Date`; compared as they arrive, every date-bearing field the publisher may not write refused a publish that changed nothing.

  Ownership is decided value by value, not by the container a refusal is reported at. The rules delete a denied component or group whole, so the removal names the container, and its contents can have two authors: a caller who patched one field of it, and the pending change that supplied the rest. Treating the whole subtree as the caller's because they supplied part of it dropped the pending change's siblings and deleted the draft, which is the loss this check exists to prevent one level down.

- [#1853](https://github.com/nextlyhq/nextly/pull/1853) [`1654240`](https://github.com/nextlyhq/nextly/commit/16542400fca8a7dcd0f88f776ce69d16df28f63b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing no longer clears a protected value nobody touched.

  The gate that judges a promotion applied the field rules and then handed their output to the write. The rules DELETE a value the caller may not write, which is the right answer for the caller's own input on an ordinary write and the wrong thing to persist here: a group is one JSON column, so a denied child removed from it was serialised over the whole column and the live value went with it. Measured on a group whose `runbook` only an owner may write, with someone else publishing an edit to an unrelated field: the column came back empty.

  A denied field keeps its LIVE value now. That is what an update means, the caller may not write the field so the field does not change, and it is the answer Payload gives to the same question. One call decides the refusal and returns the document to write, so the document that was judged is the document that lands, and there is no second interpretation of the rules' output to get wrong.

  The rules are asked of the live row as well as of the promoted document. A rule is only ever asked about a key that is present, so a field a pending change removes outright was judged nowhere: absent from the promoted document, and so never in its denied set to begin with.

  Refusal is decided value by value over both sides, and a value the store keeps for itself is not content. A denied component or repeater row carries its own identity and timestamps beside the author's values, and a snapshot's timestamps never match the row's, so counted as content a denied component would refuse every publish.

  A Single's publish keeps refusing a denied value the caller sent, where a collection's now drops it back to live. The difference is deliberate and is about what each write can apply: a collection persists exactly what the gate returns, while a Single's promotion writes from the stored snapshot in another representation, so a correction made in the gate would never reach the row and the forbidden value would go live. Refusing is what that path already did, and it is safe, since nothing denied is allowed to change and the snapshot's own copy therefore already equals live.

  The schema has the final word on what is content. The store's own columns share their names with plausible field names, so a collection that declares a field called `id` or `updatedAt` inside a group means it, and a name list consulted alone would skip an edit to it and let a publisher the rules deny put it live. The declared field names are handed in and the name list is now consulted only for a name the schema does not claim.

- [#1729](https://github.com/nextlyhq/nextly/pull/1729) [`3b4b269`](https://github.com/nextlyhq/nextly/commit/3b4b269ac4953c7cdfa38223d6759cdb45d0bb52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two names each meant two different things depending on which entry point you
  imported from, and nothing at the call site said which had arrived.

  `isFieldGroupType` was a one-argument boolean test on `nextly` and a
  two-argument type guard on `nextly/field-group-type`. The guard keeps the name,
  because it is the one application code writes when rendering a dynamic zone:
  `isFieldGroupType(block, "hero")`. The token test is `isFieldGroupFieldType`,
  which is not a new coinage: `nextly/field-group-type` was already re-exporting
  it under exactly that alias, with a comment explaining that the two predicates
  had to be kept apart. The alias is the real name now, so no entry publishes the
  spelling it was working around.

  `createAdapter` was the database factory on `nextly` and `nextly/database`, and
  the CLI's own on `nextly/cli/utils`. They return different types. The factory
  keeps the name, since it builds the `DrizzleAdapter` an application runs on; the
  CLI's is `createCliAdapter`, returning the small `CLIDatabaseAdapter` that is
  connect, disconnect and a dialect.

  Neither name appears in the docs or any template, so nothing published changes
  for a reader.

  The list of known clashes in the export-contract test is now EMPTY, which is the
  part that lasts. It held these two, recorded rather than fixed because each
  needed the decision `getNextly` needed. With both made, nothing is exempt and
  the next such name fails on the day it appears instead of joining a list.

- [#1708](https://github.com/nextlyhq/nextly/pull/1708) [`aaa8c8c`](https://github.com/nextlyhq/nextly/commit/aaa8c8ce271634b7d0404048cb93b34e096ca3d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Update and delete cannot disagree about who owns a row.

  Both write paths fall back to comparing a fetched row's owner against the
  caller when the SQL owner predicate is absent, and each decided that inline.
  Update knew that a scoped API key is judged on its own stamped grants and so
  does not inherit its owner's super-admin bypass; delete did not. A key owned by
  a super-admin could therefore delete a row it does not own, while the same key
  could not update one.

  The fallback is reachable rather than theoretical: the owner constraint answers
  `null` when a metadata read fails, which leaves the predicate off the fetch and
  this check standing alone.

  `ownerSafetyNetApplies` is the single answer now and both paths ask it. It
  takes the caller's scope rather than a boolean each site derives, so what
  counts as a scoped key is decided once.

- [#1847](https://github.com/nextlyhq/nextly/pull/1847) [`4e91f14`](https://github.com/nextlyhq/nextly/commit/4e91f147a8540ce68cdab064c5717b3263b77f69) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Three corrections to the shared RBAC epoch, all of them a cache that went on
  answering after the answer stopped being true.

  A batch of permission writes defers its shared announcement until the batch
  ends, and the local retirement that goes with it empties the caches the
  permission module holds. An API key's copied grants are not one of those, so a
  key went on answering with revoked grants for the batch's whole length. Every
  cache now asks one predicate about whether a cached answer is still current, and
  a batch holds that predicate closed for its length, so the caches living
  elsewhere are covered by the same act rather than by being remembered.

  A write that reached the shared row but whose read-back failed left the instance
  holding the value from before the write while believing it owed nothing, so
  answers filed under the old value read as current again. An epoch counts as
  trustworthy now only once its value has actually been read back.

  An installation whose epoch row does not exist yet answered with a value every
  such installation shares, so failing over to a different database, or restoring
  a backup taken before the first role change, left cached answers looking
  current. The row is created with an identity of its own on first read instead.

- [#1686](https://github.com/nextlyhq/nextly/pull/1686) [`2b278e7`](https://github.com/nextlyhq/nextly/commit/2b278e7ea0d4453e09b82feab8700ebda9e6ca2a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A `group` or `timeseries` read given a `null` key answered with an unclassified
  500 instead of naming the problem. The validator treated `null` as "no key
  given" while every read that consumes it decides absence with `=== undefined`,
  so the value it excused was still a key by the time it reached the column
  lookup, and the crash arrived through the one input the guard had waved past.
  Both API arguments are required strings, so nothing can mean "absent" by
  writing `null`; it is now refused by name.

  A localized date is refused by ONE rule rather than two. The read path and the
  widget validator each decided separately that a localized field cannot be
  grouped, and the day localized aggregation becomes supported they would have
  disagreed — the read accepting a key the validator still refused, leaving a
  path no author could reach. Both now ask the same leaf, which imports nothing
  so the validator can reach it.

  A widget source declaring a `bucketable` flag that is not a boolean is refused
  when it registers. Query validation rejects only the literal `false`, so the
  string `"false"` — legal in untyped JavaScript and in JSON — advertised a date
  the read then refused, and the widget failed on every load with nothing naming
  the cause.

- [#1793](https://github.com/nextlyhq/nextly/pull/1793) [`985a438`](https://github.com/nextlyhq/nextly/commit/985a43864958499c8c4216458d2ca41d864663bc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `createEntryInTransaction`, `updateEntryInTransaction` and `deleteEntryInTransaction` on the collection service share one tail: collect what the write left for `withTransaction`, then convert a failed envelope. A failed transactional create now carries the collection in its log context and a failed transactional delete now logs a warning, as the update already did. Nothing on the wire changes.

- [#1722](https://github.com/nextlyhq/nextly/pull/1722) [`52c6f1f`](https://github.com/nextlyhq/nextly/commit/52c6f1f9088c107ef2f2126ffd9b29e8e6a05d64) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `reidSubtreeWithMap` is no longer exported. Use `reidForestWithMap([node])`.

  It re-identified a single subtree, and it was a thinner version of the function
  beside it: the forest form takes a policy saying what should happen to DOM ids,
  and the single-root form never accepted one. Anything needing that behaviour had
  to use the forest form anyway, and nothing in the product ever called this.

  The forest form does the same work for one root as for many, so a caller passes
  a list of one and gets the answer it already wanted, with the option this one
  could not offer.

- [#1784](https://github.com/nextlyhq/nextly/pull/1784) [`4a34f1e`](https://github.com/nextlyhq/nextly/commit/4a34f1e5a3ecd6327452a342d194fca6f676820e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - zod is 4.6 now, from 4.1. The MCP server library needs 4.2 or newer, and a
  second copy of zod beside the first would make every schema a stranger to the
  other's `instanceof`; one version everywhere is what lets the coming MCP plugin
  describe its tools in the same language the rest of Nextly describes content.

  One behaviour moved with it. zod's JSON Schema converter now refuses a schema
  whose registrations collide on an `id` rather than emitting a shorter schema,
  which is the corruption the block document emitter already refused; the
  emitter turns that refusal into its own, so a caller still sees one error for
  one reason, and a document checked against a derivation that cannot be made is
  answered rather than thrown at.

- [#1721](https://github.com/nextlyhq/nextly/pull/1721) [`928b982`](https://github.com/nextlyhq/nextly/commit/928b9829b79c0a96e75d97e7f115eb6aa293e51f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On PostgreSQL, Nextly reads a database's current shape to work out what a
  migration should change. Those reads looked in a schema called `public`, while
  every statement Nextly writes is unqualified and lands wherever the connection's
  `search_path` points. On a deployment that uses its own schema — one per tenant,
  or just a house convention — the two disagreed.

  The reads now resolve a table the same way the writes do, quoting the name first
  so one whose spelling carries capitals — which a custom table name may — resolves
  to itself rather than to nothing. Nothing changes for a database that uses
  `public`, which is the default.

  What it fixes on the others: columns that exist read as absent, so a migration
  offered to add what was already there; and where a table of the same name existed
  in `public`, its shape answered for the real one — comparing against a table
  nothing writes to.

- [#1710](https://github.com/nextlyhq/nextly/pull/1710) [`29bc0da`](https://github.com/nextlyhq/nextly/commit/29bc0dafc4bf0f2ef6e82b5462beb0a1aa7147e2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deciding which of two overlapping heartbeats answered most recently was done by
  comparing the time each was sent. That reads the wall clock, and a wall clock can
  go backwards — an NTP correction, a virtual machine resuming, somebody setting the
  time by hand. After a correction, a later heartbeat carries a SMALLER number than
  an earlier one, so the editor holding the document would ignore every subsequent
  answer about a colleague waiting until the clock caught up, which for a large
  correction is minutes or never.

  Which reply is newer is a question about order, not about elapsed time, so it is
  now decided by counting the heartbeats rather than by timing them. How much lease
  is left is still measured with the clock, because that is a duration and only a
  clock can answer it.

- [#1802](https://github.com/nextlyhq/nextly/pull/1802) [`4fbf860`](https://github.com/nextlyhq/nextly/commit/4fbf8608d8ca740783b4c6c2b3348c32ddfa2c3e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection read, a single read and an embedded component read now resolve a
  translatable field through one language chain rather than three private copies
  of the same rule.

  Nothing published changes for a reader: the three copies agreed, and the
  per-request `fallbackLocale` contract — `false` or `"none"` for the requested
  language alone, a named locale to fall back through that locale's own chain,
  otherwise the configured chain under the global `fallback` switch — is exactly
  what each path answered before. What changes is that a future difference in
  how a single and a collection fall back is no longer possible by omission:
  there is one place to change, and the drift the three copies invited is closed.

- [#1685](https://github.com/nextlyhq/nextly/pull/1685) [`f9079d0`](https://github.com/nextlyhq/nextly/commit/f9079d066cf7b14c1bfc539d4618f43f841845d9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The plugin scaffold's own test could time out on a first run.

  `plugin.test.ts` boots a real Nextly instance in `beforeEach`, building a DI
  container, registering the plugin's schema and running auto-sync against a real
  SQLite database. Its vitest config stated no budget, so it inherited the
  defaults: 5 seconds for the case and 10 for the hook, both sized for a unit test
  that touches none of that.

  A boot is about a second and a half on a warm machine, and the first run of a
  freshly scaffolded project is the least warm moment there is: a cold install, no
  build cache, whatever else the laptop or CI container is doing. It is also the
  first command a new plugin author runs, so a timeout there reads as a broken
  scaffold rather than a tight budget.

  Both budgets are now 30 seconds, matching what this repository's own integration
  lane gives a suite that boots.

- [#1724](https://github.com/nextlyhq/nextly/pull/1724) [`c0c8c52`](https://github.com/nextlyhq/nextly/commit/c0c8c520d2af2f538fd0b423c983b95c15c37ea1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Clicking inside a component selects the instance the author placed.

  A component is inlined at render: the instance node is replaced by the tree its
  definition describes, and every element of that tree carries an id re-minted
  during composition — one the page's stored document does not contain. The canvas
  resolved a click to that id and handed it to selection, which could not act on
  it; the drag path happened to bail instead, because its lookup could not find
  the node either.

  The hit-test now asks the ELEMENT whether it is definition-owned, and answers
  with the host instance when it is.

  Asking the element rather than its ancestors is the whole design. An instance's
  SLOT CONTENT belongs to the page and is deliberately unmarked, but it renders
  nested inside the definition's marked box — so walking up finds that box and
  returns the component for a node the author can and should select directly,
  which is exactly the content someone opened the editor to change. The marker is
  per-node rather than a wrapper element so this can be decided without walking.

  The inverse reader answers the same addresses. An instance id names a node that
  renders no element of its own, so chrome measuring the selection is pointed at
  the first element the definition contributed — the outermost one, in document
  order.

- [#1715](https://github.com/nextlyhq/nextly/pull/1715) [`001ad57`](https://github.com/nextlyhq/nextly/commit/001ad576aba2869b8e7157538918ee55351d1c9a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `slugToStaticParam` turns a stored slug into the path segments a route serves.
  Anything that emits a URL for an entry has to agree with the route about that —
  a sitemap, a canonical, a link between entries — so the SEO plugin and the blocks
  renderer both call it rather than re-deriving the rule.

  It was defined inside the content route's module, so an application build that
  bundles rather than externalises `nextly` acquired that whole module graph to get
  one pure string function: the Direct API, the error type, the not-found trigger
  and the content resolver. Measured with esbuild against the source, importing the
  function pulled **1042 modules and 18.4 MB**; from its own module it pulls **2
  modules and 1.4 KB**.

  It now lives in a leaf module that imports only the reserved-path check, and is
  published as its own entry point, `nextly/route-path`. Both halves were needed: a
  leaf module alone changed nothing a consumer could reach, because every published
  spelling still resolved to the built route bundle, which had already inlined the
  function beside its Direct API imports. `@nextlyhq/plugin-sdk/routing` — which is
  how the SEO plugin reaches it — now pulls **5 modules and 1.4 KB in place of 2,471
  and 21.1 MB**.

  Every published spelling still exports the same function, and tests assert they
  are one function rather than several that agree today.

  Its published documentation was also wrong: the generated types carried a
  paragraph about Direct API access defaults, left behind by an unrelated change,
  in place of any description of what the function does.

- [#1703](https://github.com/nextlyhq/nextly/pull/1703) [`7176d47`](https://github.com/nextlyhq/nextly/commit/7176d477c907edce488bd815b0d9c4141318c6fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A second author who opens a document somebody else is editing gets a read-only
  editor and no way to say anything about it. The only thing they can do is take
  the document over, which displaces a colleague mid-sentence — so the polite
  option was to close the tab and hope.

  The lock row can now carry a standing request to edit, and the holder is told
  about it on the heartbeat they were already making. It is a COURTESY and not a
  consent gate: it moves no claim, asks the holder for no answer, and cannot be
  refused. The lease expiring stays the only thing that transfers a document.

  The request is held on a lease of its own, the same length as a claim and
  refreshed on the same beat, because the useful fact is "somebody is waiting
  right now" rather than "somebody once asked". An editor that closed the tab
  stops refreshing it and the mark lapses, so a holder is never nudged on behalf
  of a colleague who has already gone. A claim changing hands clears it outright,
  since a request is about the claim it was made against.

  It rides the claim rather than travelling on a route of its own. The editor that
  is locked out is already asking for the document on every beat — that poll is
  how it learns the holder has left — so the standing "still waiting" is carried
  by a request that was going to be sent anyway, rather than doubling the traffic
  of a read-only tab. Winning the document records nothing, because a caller that
  holds a document is not waiting for one.

- [#1657](https://github.com/nextlyhq/nextly/pull/1657) [`167147a`](https://github.com/nextlyhq/nextly/commit/167147acb291c536f9a3008a076798926a2e2add) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The spacing bands on the canvas could only be read. Every change to a margin or
  a padding had to be made in the Style panel, with the author's attention in one
  place and the space they were judging in another.

  Each band now carries a handle on the edge that moves. Dragging it previews the
  value live and writes the document once, on release, so a gesture of fifty
  pointer moves costs one entry in the history rather than fifty. Shift moves
  every side of the box and Alt moves the pair across from it, each side stepping
  from its own starting value so a deliberate asymmetry survives the gesture.

  The handles are focusable and take the arrow keys, with Page Up and Page Down
  for a coarser step, so everything a drag can do has a keyboard route to the same
  value — the Style panel's fields remain the third. Which side a handle writes is
  resolved from the element's own writing mode and direction, so dragging the left
  edge of a right-to-left block edits the inline END, as the page renders it.

  A side whose value is a token, `auto`, a percentage or any other unit a pixel
  drag cannot preserve refuses to be dragged and says so, rather than silently
  replacing it with the pixels it happens to resolve to today.

- [#1681](https://github.com/nextlyhq/nextly/pull/1681) [`1f254ff`](https://github.com/nextlyhq/nextly/commit/1f254ffc4af6fe8cc04c31ef815005c3348ee08b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Honeypot and rate limiting ran in the form route. The submissions collection
  grants public create on purpose, so a visitor can submit without an account,
  which makes the generic collection create a second public door and the Direct
  API a third. Submissions arriving that way were stored with no rule having
  looked at them.

  Both now run at the write seam every door passes through, and only when a
  request produced the write: a seed, an import or a scheduled job is not
  rate-limited by its own importer. A honeypot hit is still stored flagged rather
  than dropped, so a false positive stays reviewable. A submission over the limit
  is refused, and the form route still answers its own visitor with a success so
  a bot learns nothing from the difference.

  The rate-limit window moved out of a `Map` private to this package and into the
  deployment's own store, the one the REST and auth limiters already share.
  Configure `rateLimit.store` once and all three count together. A private Map
  counts per process: across several, the effective limit becomes the configured
  number times the number of instances, and it fails open under load.

  `cleanupRateLimitStore`, `getRateLimitStoreSize`, `clearRateLimitStore` and
  `isRateLimited` are no longer exported. They existed to manage that Map.

- [#1658](https://github.com/nextlyhq/nextly/pull/1658) [`49dc8e8`](https://github.com/nextlyhq/nextly/commit/49dc8e8034a6dd68ae29d0d658ba8374add9451f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now records which documents embed which components, in a
  `nx_pb_component_usage` collection maintained automatically as pages are saved
  and deleted. Nothing surfaces it yet; it is what will let the library say a
  component is used on N pages, and let deleting one tell you what still embeds
  it instead of quietly breaking those pages.

  It is maintained by the same write-path pass that already keeps the class usage
  index, so a save reads each document once and both indexes derive from that
  read rather than the document being read twice.

  A page too large to read whole records that fact rather than recording nothing,
  because "embeds no components" is the answer that would make deleting one look
  safe.

  Repairing the indexes is now one call, `rebuildPageBuilderUsageIndexes`, which
  takes the document store and both index stores and repairs every index the
  plugin maintains — it names the set itself, so an index added in a later
  version is repaired without a caller having to know it exists.
  `rebuildClassUsageIndex` still works and still repairs the class index alone;
  it is deprecated for one release because that narrowness is exactly the trap —
  a site that upgraded and ran it would have left its component index empty, and
  an empty index reports every component as used nowhere.

- [#1820](https://github.com/nextlyhq/nextly/pull/1820) [`d550908`](https://github.com/nextlyhq/nextly/commit/d55090872d3cb319fcb29bbb4e79ab356ecff963) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The setup checklist offers a reader only the steps they could actually finish.
  A step is withheld where the install has observed that this reader cannot take
  it -- they may read a collection but hold `create-<slug>` on none, or they
  cannot create a collection at all -- and the "is onboarding done" question is
  answered over the steps that remain. Before, both were derived from what the
  reader may READ: an editor without a create grant had the first-entry step
  outstanding permanently, its link landing on a surface that refused them, and
  the card pinned to their dashboard for the life of their account.

  A finished step stays on the list whoever the reader is. It records what the
  install has done rather than offering them work, so withholding it would only
  make their progress look smaller than it is.

  The step is decided by the same authorization a write performs, so a scoped API
  key whose collection refuses its `access.create` rule is not offered a step that
  write would refuse. The grant that authorizes creating a collection is declared
  once and read by the two routes that enforce it as well as by the checklist.

- [#1805](https://github.com/nextlyhq/nextly/pull/1805) [`f7d0b6a`](https://github.com/nextlyhq/nextly/commit/f7d0b6afe5fb9b8ebc4ee9c8491b6356732319c3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard is arranged from the `md` breakpoint up.

  Below it every card is already full width in one column, so an arrangement is
  a stacked list with little to reorder, and touch drag is where accessibility
  regressions hide. The Edit dashboard control is no longer offered there -- the
  arrangement made on a wider screen applies at every width -- and an edit
  already under way keeps its Save, Cancel and Reset whatever the window is
  narrowed to, so a mid-edit resize never traps the reader. An emptied dashboard
  tells a narrow-screen reader that the way back is a larger screen.

- [#1848](https://github.com/nextlyhq/nextly/pull/1848) [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Model Context Protocol endpoint knows which caller it is serving.

  A plugin route handler is called with the request AND the route context, and the
  endpoint declared only the first. The services facade and the authenticated user
  were therefore discarded before the protocol layer saw them, which cost nothing
  while the endpoint exposed no tools and would have cost a great deal the moment
  one arrived: a tool would have read and written with no user attached.

  The context now travels as itself, scoped to the request. A key's own grants are
  untouched by this, because they already are ambient: the plugin dispatcher runs
  every handler inside the caller scope, so a service call made anywhere in the
  request is judged on the grants stamped on the key rather than on the roles of
  whoever minted it. Repeating that here would have answered one question twice.

  A request whose caller cannot be established is now refused at construction
  rather than served a server built for nobody.

  The endpoint also gains its auth proof matrix, driven through the real
  dispatcher with a real API key: an unauthenticated caller is refused, an
  unverifiable credential is refused, a real key is served, and the address guard
  is shown refusing that same key on a foreign Host and a foreign Origin while
  serving it on the configured site's own. That last pair is the first time the
  guard has been observable at all, because an unauthenticated probe never reaches
  it.

- [#1855](https://github.com/nextlyhq/nextly/pull/1855) [`1b66317`](https://github.com/nextlyhq/nextly/commit/1b66317a4dcbcf830a282c6a1dc8795a59921293) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `get_initial_context`: the first thing an agent should ask a Nextly install.

  An agent arriving at an unfamiliar CMS knows the protocol and nothing about the
  install, and without this it discovers the shape by trial, spending a request
  per guess. One call now answers what it can work with and how this CMS expects
  to be asked. The tool name follows the convention other CMS servers have settled
  on, so a client looking for it finds it where it looks.

  The answer is scoped to the caller. It lists the collections and singles that
  caller may read, taken from core's own access decision rather than from the
  registry, so a key scoped to one corner of an install does not learn the shape
  of the rest. It also reports whether the list is the WHOLE answer: describing an
  install is a positive claim, and a registry that could not be enumerated would
  otherwise be reported as an install with no content.

  The instructions and the data do not mix, and that is a security property rather
  than a style. A tool result is text the model reads, and a model cannot reliably
  tell an instruction the server wrote from one that arrived inside a value. The
  instructions are a constant, and the schema travels beside them as structured
  content, so a collection an attacker can name cannot reach the sentence that
  tells the agent how to behave.

  The package's own descriptions say what it now does. The npm description, the
  root catalogue entry, the README and the admin panel all stated that the plugin
  exposed no tools, which is what somebody evaluating the release would have been
  told about a release that exposes one.

  `readableContent` is published from core and re-exported by
  `@nextlyhq/plugin-sdk`, because a plugin that describes an install needs the
  coarse readable set and composing it from the registry, the caller conversion
  and the per-entity decision is exactly where the dashboard's own version once
  went wrong: it derived the set by filtering permission slugs, which disclosed a
  refused collection on one surface while hiding a code-authorized one on another.

- [#1704](https://github.com/nextlyhq/nextly/pull/1704) [`03bf79b`](https://github.com/nextlyhq/nextly/commit/03bf79be79d6918f55011e5fbe1bcb35d3e95aa9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form builder now serves its own public endpoints. `GET /api/forms`,
  `GET /api/forms/{slug}` and `POST /api/forms/{slug}/submit` answer at exactly
  those addresses, so no caller changes anything, but the plugin that owns the
  collections is the one reading them.

  The core used to serve those three, and named the `forms` and `form-submissions`
  tables in four places while declaring neither. That meant they failed on any
  install that renamed a collection through the plugin's own overrides, and they
  were never reachable at all without the plugin installed, because the tables did
  not exist. Nothing that worked before stops working.

  Spam is now decided before a submission is validated on that route. A bot that
  trips the honeypot while also omitting a required field used to receive a
  validation error, which tells it which of the two it got wrong and stored no
  evidence; it now receives what an accepted submission receives, and the flagged
  row is kept for review. A submission the rate limiter refuses is answered the
  same way rather than as a 429.

  Three response helpers are exported for plugins serving their own HTTP routes:
  `respondList`, `respondDoc` and `respondAction`, joining `respondMutation`. A
  plugin taking over an endpoint has to answer in the body the endpoint already
  answered in, and a hand-built one both drifts from the canonical shape and drops
  the post-commit warnings these carry.

  `trustedClientIp` is exported beside `getTrustedClientIp`, which needed
  settings a plugin cannot read. Exported alone, the resolver was reachable and
  unusable, leaving a plugin to read `x-forwarded-for` itself.

  A plugin route can now say who it acts as and how its timestamps are presented,
  which is what owning a top-level endpoint actually requires. `ServiceOpts` gains
  `as: "public"`, a caller with no session whose collection access rules are still
  enforced; a public route previously had to elevate to `system` to read at all,
  silently overriding a host that had restricted a collection. `PluginRoute` gains
  `formatTimestamps`, so a route answering with collection documents presents
  stored times in the installation's timezone the way the built-in read does.

  The response envelopes and `trustedClientIp` are re-exported through
  `@nextlyhq/plugin-sdk`, which is the surface a plugin author is promised.

  A collection's code-defined `access` rule is now evaluated for a caller with no
  session. The coarse gate resolved roles and permissions from a user id and so
  returned early without one, which meant `access: { create: false }` and
  `read: ({ user }) => !!user` were accepted at boot, recorded, and never asked
  about the one caller they most clearly describe. Only the stored rules ran,
  which live elsewhere and are usually empty, so the declaration was inert while
  looking deliberate. The DB permission check still needs a user and still does
  not run without one.

- [#1755](https://github.com/nextlyhq/nextly/pull/1755) [`8f63701`](https://github.com/nextlyhq/nextly/commit/8f637018bb5db985efb0e19ae220faf1211e83d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The insert panel's placement sentence — "Adds inside …", announced to a
  screen-reader author as the answer to where the next block will land — now
  names the container the way every other surface does. It read the container's
  declared label directly and said "the selected block" when there was none, so
  a container the palette, the layers and the inspector all call "Box" was the
  one place it went unnamed, and a label declared as an empty string produced a
  sentence with nothing after "inside". The name is derived from the same rule
  the palette reads, so the container is called what the author just clicked.

- [#1836](https://github.com/nextlyhq/nextly/pull/1836) [`9cbd6bf`](https://github.com/nextlyhq/nextly/commit/9cbd6bf92c25bfa189edc7c900b75a4b75495567) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The publish gate resolves the caller's permissions before it opens the write transaction, reads the language it is judging, and judges the state the write actually commits.

  Three corrections to the gate that re-judges a Single's pending change at publish. The permission lookup was constructed before the transaction but not performed until the gate asked for it, which was inside the transaction: on a one-connection pool that query waits for the connection the transaction is holding and the publish hangs. It is performed up front now, and the gate is handed the answer.

  A localized Single's live values are on the companion row of the language being published, and the comparison read only the main row, so a translated field the publisher may not write, resubmitted unchanged by a full form, compared against nothing and read as a forbidden edit. The publish was refused although it changed nothing anyone objected to. Both publish paths now overlay the companion values of the language they are judging.

  Publishing every language applies each snapshot to the same main row, so a shared value that a later language overwrites is not the value that lands. The gate judged each language with its own snapshot laid over the combined state, which put those superseded values back and could refuse a publish whose committed document is valid. Only the language's own translations are laid over the final shared state now.

  Both halves of the gate now judge one document: the live row for the language being published, with the pending change and the caller's payload over it. That is the row the write produces, and judging anything else answers for a document that is not being written.

  A field rule reads its siblings, so shown the snapshot alone it can allow a value the committed row must deny: a protected field saved while `kind` was `public` could be published in the same request that sets `kind` to `private`. It cuts the other way too. A shared value one language's pending change edits and a later language's overwrites never reaches the row, and judged snapshot by snapshot that superseded edit refused a publish the write would have committed cleanly.

  Building on the live row also stops a partial translated draft being refused for its own untouched siblings. A save carries only the fields it was given, so a snapshot for a localized Single has no property for the translations it did not touch; judged as a whole document those read as missing, and publishing a one-field fix was refused for a required sibling sitting valid on the companion row.

  The permission lookup is performed only for a Single that can hold a pending change at all. Whether a given write publishes one is not known until its hooks have run and the draft has been read under the row lock, but a Single with no published state or no drafts can never reach the gate, and every authenticated update was paying for the roles and permissions queries to answer a question it would never ask.

- [#1678](https://github.com/nextlyhq/nextly/pull/1678) [`6d0e94f`](https://github.com/nextlyhq/nextly/commit/6d0e94f1f152c4ba4e62b9724ff5f85c961fbe31) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Save as pattern verb now asks whether the author may create a pattern, and
  says so when they may not.

  A role that can update pages but lacks the separately seeded `create` grant on
  the patterns collection was offered the verb on the toolbar, the context menu
  and the command palette. The author filled in the form and the save was refused
  — legibly, and after the work.

  Only the server can answer this. The grant is held against the RESOLVED
  collection, a site may have renamed it, and the browser knows the declared name
  alone; gating on that would refuse an author who holds the grant, hiding a
  feature that works. So the plugin contributes a small authenticated route that
  asks the framework's own `ctx.caller.can`, and the editor reads it once on
  mount, before any of the three surfaces draws.

  The verb is DISABLED WITH A REASON rather than hidden, matching every other
  refusal on that toolbar, and it stays offered while the answer is in flight: a
  wrong "yes" costs the late refusal that already happened, while a wrong "no"
  hides a feature the author holds and nothing on the canvas would explain it.

  Not a security boundary. The write authorizes itself, exactly as before.

- [#1839](https://github.com/nextlyhq/nextly/pull/1839) [`cf1c679`](https://github.com/nextlyhq/nextly/commit/cf1c679d93250c372ccfbc04140616466986c0f6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-seo` now publishes a dashboard data source, `plugin:seo/issues`,
  counting the SEO gaps in the collections it was configured to extend — documents
  missing a meta title, canonical URL, meta description or social image, and
  documents hidden from search engines by `noindex`.

  It is the first plugin to use `contributes.widgetSources`, and it is built
  entirely from `@nextlyhq/plugin-sdk`: nothing it imports is unavailable to a
  third-party plugin, which is what makes it a reference rather than a
  demonstration.

  Every read is scoped to the caller through `callerReadOptions`, so the number
  describes what that reader can see; a collection they cannot read contributes
  zero rather than failing the card. The scan is bounded, and past the bound the
  answer reports a floor rather than a figure that is quietly too small — the
  fields live in a JSON column that a database-side `count` cannot filter on, so
  the rows are read and inspected. It also honours the resolver cancellation
  signal, stopping between pages once the dashboard has given up waiting.

  The checks follow the fields a project actually configured: `seoPlugin({ fields })`
  replaces the default group, so a project storing a `focusKeyword` and nothing else
  is not told every document is missing four things it never asked to store.

  A card can also ask for one kind of issue by name — `where: { issue: { equals:
"Missing meta title" } }` — which gives a per-issue number without needing a
  chart. An operator the source cannot honour is refused rather than answered with
  the unfiltered total.

  A collection the reader may not see contributes zero; anything else that fails —
  a database outage, a failing hook — reaches the card as an error rather than
  being folded into a count that is quietly too small.

  It also draws the card. `@nextlyhq/plugin-seo` contributes an "SEO issues" stats
  widget to the dashboard — one labelled number per issue, so a reader sees that
  eleven pages have no title rather than that the site has twenty-three problems.
  The card is declarative: it names an archetype and a query per cell, the host
  draws it, and none of the plugin's code enters the admin bundle.

  Its cells are computed from the same checks the source counts by, so a project
  that replaced the default fields gets numbers only for what it installed, and one
  whose override leaves nothing to check gets no card rather than an empty frame.

- [#1787](https://github.com/nextlyhq/nextly/pull/1787) [`2a8263a`](https://github.com/nextlyhq/nextly/commit/2a8263a3fa218fb47cc9ba43f1ef5c61ff9f521f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A transaction's `update` is built by the adapter, the way its `insert` already was, so it writes the columns the physical table has rather than the ones the runtime model declares.

  The main UPDATE of every collection entry was a hand-built SQL string in the mutation service, because the typed `tx.update` went through the Drizzle query builder and the builder drops any key naming a column the runtime model does not declare — without a word. One write depends on exactly such a column: the localization transition window, where `localized` has been flipped on a collection, the runtime model has moved its translatable columns to a companion table that does not exist yet, and the default locale must keep writing the physical main table until it does. The transactional INSERT already reached that column because every adapter builds it itself. This is the UPDATE half of the same rule, so the mutation service now makes the same `tx.update` call every other update makes, and the raw statement is gone from product code.

  What changes for a caller of `tx.update`:
  - A column the model declares binds exactly as before — through that column's own encoder, so dates, JSON documents and booleans reach the driver as the bytes the query builder sent. Existing callers see no difference on the wire.
  - A column the model does not declare is written to the physical table, bound the way that adapter's transactional insert binds every value.
  - A key naming no column on the table is a SQL error from the database, where the query builder silently dropped it. This surfaced one: the transaction and batch update path passed `updatedAt` for a dynamic table whose column is `updated_at`, so those writes never bumped the timestamp; they do now.
  - A key whose value is `undefined` is not written — JSON's meaning of an absent key, and what the query builder already did. For the collection entry update this is a change: the raw path bound `undefined` as SQL NULL, so an own `undefined` from a server caller or a hook cleared the column. `null` still clears it.
  - An update that names nothing to write is refused by name (`No values to set`), as the query builder refused it.
  - The pooled `update` is unchanged.

- [#1880](https://github.com/nextlyhq/nextly/pull/1880) [`32d89c2`](https://github.com/nextlyhq/nextly/commit/32d89c2dbbae9e6c9724879a8ff74d5d0622ce4a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly/translation-filter-states` publishes the translation states the translations API accepts (`TRANSLATION_FILTER_STATES` and `TranslationFilterState`) from a module with no server dependencies, so a client can import the list instead of restating it. The admin translation worklist now derives its filter tabs and the state it sends from that list, so a state the server stops accepting can no longer stay on offer and answer with an empty worklist.

- [#1812](https://github.com/nextlyhq/nextly/pull/1812) [`d58455c`](https://github.com/nextlyhq/nextly/commit/d58455c6e7d90cd8c4aac0fd58839632c01c204a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A text widget's markdown and the dashboard's workspace payload close four gaps.

  A link written as a path that a browser would read as another site --
  `/\example.com`, `https:example.com` -- is left on screen as the markdown it
  was written in, instead of becoming a link that leaves the admin in the same
  tab. A numeric character reference past Unicode's range now draws as the
  replacement character however it is escaped (`&\#1114112;`,
  `&#1114112\;`), and a card whose markdown the editor cannot convert for any
  other reason is drawn as the text it was written in rather than left blank.

  The admin reads its workspace payload again whenever the dashboard layout
  reports a different widget audience from the one the payload was built for,
  including on the first dashboard visit after a permission change, where a
  payload cached beforehand used to be kept. The layout read reports the token
  as `audience` and the workspace payload as `widgetAudience`: one token for
  one reader. The workspace payload also ships exactly the generated card
  definitions its permission decision was taken on, even when a concurrent
  request refreshes them in between.

- [#1690](https://github.com/nextlyhq/nextly/pull/1690) [`23d36f3`](https://github.com/nextlyhq/nextly/commit/23d36f3f9c9eb92262bcb08e14e68be515f096d8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can answer "used on N pages" for a component.

  `componentUsageCount` reads the usage index through a grouped query and counts
  DISTINCT documents. That distinction is the feature rather than an
  implementation detail: the index files a row per field, per locale and per
  stored variant, so a page using one component in two languages while holding a
  pending draft contributes several rows — and a count of rows would report that
  page as several, then climb every time somebody added a translation.

  The answer carries whether it is complete, and it can be short for two
  reasons. A grouped read is capped, so a component used on more pages than the
  cap comes back at the cap. And a document too large to walk whole is recorded
  as a single marker with its references discarded, so it is missing from every
  component's count rather than wrong in one of them — a component embedded only
  there would otherwise read as used by nothing at all. Either way
  `complete: false` says the number is a floor, and the surface decides how to
  say so.

  One reason it is a floor today is worth stating plainly, because it applies to
  every site: the write hooks maintain the index going FORWARD, and nothing yet
  fills it for documents that already existed. So `complete` is false until a
  backfill exists, and a surface shows "at least N" rather than a total. That is
  the honest reading — a component with no rows is indistinguishable from one
  nothing uses, and the flag exists precisely so that difference is not papered
  over. The backfill itself is a separate change.

  `usageCountReader` binds the count to the Direct API. It reads as the system
  because the index denies every access rule it declares, and an untrusted read
  answers an empty set — indistinguishable from a component nothing uses. It
  takes the index collection's slug, so `COMPONENT_USAGE_INDEX_SLUG` is exported
  beside it: the plugin resolves that name from its own context, which
  application code cannot reach, and without the export the only way to call the
  reader would be to spell the collection name as a literal.

  `readUsageIndexHealth` is exported for the same reason. The count REQUIRES the
  health, so publishing one without the other would leave a consumer able to get
  a trustworthy answer only by reproducing private queries or hard-coding the
  object — which is the confident `complete: true` the flag exists to prevent,
  written by hand.

- Updated dependencies [[`da323d5`](https://github.com/nextlyhq/nextly/commit/da323d58366d362dfaadb7a1ab9593dbf98d18b2), [`b87f0d3`](https://github.com/nextlyhq/nextly/commit/b87f0d3d0d6468c17bb9728738a1729b07c74230), [`705926b`](https://github.com/nextlyhq/nextly/commit/705926b091c1e6ab17fd4065d89dfc2d29c094b2), [`4c03302`](https://github.com/nextlyhq/nextly/commit/4c03302fd9a8532e033c2cfb16a878a25408b9d0), [`732da46`](https://github.com/nextlyhq/nextly/commit/732da46718b4e1342ad517d05a276bcfaf45ef8b), [`716adbd`](https://github.com/nextlyhq/nextly/commit/716adbd7b710559b33d9d568f187b310206e6bd5), [`a6ea554`](https://github.com/nextlyhq/nextly/commit/a6ea554476000f65d384a2b169802c637154c96f), [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c), [`fda49c2`](https://github.com/nextlyhq/nextly/commit/fda49c2876a4842ed47d4aa142b5bd6ec7f1eaab), [`2fa4696`](https://github.com/nextlyhq/nextly/commit/2fa4696c3e5becc4fc5fc954cb8d429a7ffe34ba), [`2bcccdd`](https://github.com/nextlyhq/nextly/commit/2bcccddfbb83b9d9e5a57a555cedb321ed4a85c1), [`b25490b`](https://github.com/nextlyhq/nextly/commit/b25490bc4af5bad91bc67a5333ec28295199e211), [`793c9c1`](https://github.com/nextlyhq/nextly/commit/793c9c120dbd3525c6b3be4fcc4cb53059a8891d), [`1bfc12e`](https://github.com/nextlyhq/nextly/commit/1bfc12eb4c3122d6e4984d69195f45061d281e5b), [`6e22e58`](https://github.com/nextlyhq/nextly/commit/6e22e58f389affa7f922afb65cc4db8f3db5d63c), [`48967c8`](https://github.com/nextlyhq/nextly/commit/48967c89417abfe6ad1e474eb7ea476b473274e0), [`cadd25b`](https://github.com/nextlyhq/nextly/commit/cadd25b48744ccc5a2658678b4164776e8c22d69), [`83a2e49`](https://github.com/nextlyhq/nextly/commit/83a2e4925aa0c1de40011bbcce25018ee7b9db72), [`419d5f2`](https://github.com/nextlyhq/nextly/commit/419d5f2b7666b42e3c2b02639835b44257401ff3), [`9893b11`](https://github.com/nextlyhq/nextly/commit/9893b119dbdd3fbc1f171b4ed9cf6146388d94bf), [`89f515b`](https://github.com/nextlyhq/nextly/commit/89f515b0d6a9e12a669a4a02ef173264b439a1e9), [`5aae8fc`](https://github.com/nextlyhq/nextly/commit/5aae8fcf9386e47a94de8974c92a76b5727e0e21), [`c80d0da`](https://github.com/nextlyhq/nextly/commit/c80d0dafd69f9825b75e1a33b97aeb7891575c2e), [`9c8d64d`](https://github.com/nextlyhq/nextly/commit/9c8d64d5e41a85d7cf5c76d4e5b7fc66b3134f7c), [`f6ddafa`](https://github.com/nextlyhq/nextly/commit/f6ddafa0c3ed698309cd9c1f42449955955718d4), [`1ca2733`](https://github.com/nextlyhq/nextly/commit/1ca273325ff393fc3dead74febc678985014e16a), [`dbebaf7`](https://github.com/nextlyhq/nextly/commit/dbebaf7fb786e7a14c1998267662d12b6245c014), [`ab3791d`](https://github.com/nextlyhq/nextly/commit/ab3791d667180008cb83be4ef0acb514b3d2f130), [`5992aab`](https://github.com/nextlyhq/nextly/commit/5992aabbae4e25b1a3a672e883c231f1c79336d7), [`a2cd0f3`](https://github.com/nextlyhq/nextly/commit/a2cd0f30c363c10409d6872d799f832422f567ce), [`39c96f3`](https://github.com/nextlyhq/nextly/commit/39c96f3f1248cb5a56bddf8f4d0ae76d9972d577), [`4de79a2`](https://github.com/nextlyhq/nextly/commit/4de79a2137618d5541d45ee0bec95fe4d7e791a2), [`69b9aa5`](https://github.com/nextlyhq/nextly/commit/69b9aa535d9073c5ab693fdb0a86d09f743276ac), [`113f82c`](https://github.com/nextlyhq/nextly/commit/113f82c827874ebace3f8cb4e2a120d6c695883a), [`348ceb9`](https://github.com/nextlyhq/nextly/commit/348ceb93a51cf8fca0ae55ee5dcbb132baeaa015), [`e700886`](https://github.com/nextlyhq/nextly/commit/e7008868e8b631c7e2ba4bc74b6e166b72d6eb41), [`16efd9c`](https://github.com/nextlyhq/nextly/commit/16efd9cf7383708209c5b8306f73efbac7b246fb), [`08bce33`](https://github.com/nextlyhq/nextly/commit/08bce33d147922909894f2b00e245aae0e54e9f2), [`cde0bd0`](https://github.com/nextlyhq/nextly/commit/cde0bd0b8bf2425c2afe753c4c058060fcfefd9d), [`9ca0cfd`](https://github.com/nextlyhq/nextly/commit/9ca0cfda21f4c3ddb57e970570b3aead8e36af90), [`c52aa59`](https://github.com/nextlyhq/nextly/commit/c52aa5970405a62f3bbd13df67722afa444a9d77), [`10ef8d9`](https://github.com/nextlyhq/nextly/commit/10ef8d95573eebad5bfdd8bd2daebdfb7193f141), [`c5f8fe8`](https://github.com/nextlyhq/nextly/commit/c5f8fe82e43e86e29760a434129b68b524670192), [`9bac152`](https://github.com/nextlyhq/nextly/commit/9bac152475a676d84d360bef7a6f999cbc9986f1), [`dc38f47`](https://github.com/nextlyhq/nextly/commit/dc38f4758422964a2ff34fe5556020d552e4b3dc), [`c293917`](https://github.com/nextlyhq/nextly/commit/c293917acd1e74d5d8722696589c31ba69d90bc2), [`3d60b11`](https://github.com/nextlyhq/nextly/commit/3d60b11362c0faf2b55685ae08a6b3513fb871d7), [`4e25eb2`](https://github.com/nextlyhq/nextly/commit/4e25eb229a30824e620457bdf24ffe527ad716be), [`ebd0b24`](https://github.com/nextlyhq/nextly/commit/ebd0b243cd812d63d5cd5f90aa054f6648e671e8), [`e8e8d78`](https://github.com/nextlyhq/nextly/commit/e8e8d7855ca06ce444c9dfaba4ed23b45a64ceb4), [`adfafa3`](https://github.com/nextlyhq/nextly/commit/adfafa36762a24745b69ca1e14367f310940fbce), [`812f167`](https://github.com/nextlyhq/nextly/commit/812f16767fec5aecb0acf41711ddc1d7047c8e26), [`9ad1744`](https://github.com/nextlyhq/nextly/commit/9ad17448d2176b786041efae68a86d73678bf3b4), [`1532b2e`](https://github.com/nextlyhq/nextly/commit/1532b2e28b095a859c02501c4a4b785b2ac01146), [`cd95546`](https://github.com/nextlyhq/nextly/commit/cd9554690379d1620eded8b7d58107ea43f6a669), [`d29c54d`](https://github.com/nextlyhq/nextly/commit/d29c54daca0076cd0c41192946d2056046c66ac4), [`e1605f8`](https://github.com/nextlyhq/nextly/commit/e1605f8b03c0c4111716d426fe0a125e3f174b2c), [`0d5f838`](https://github.com/nextlyhq/nextly/commit/0d5f838701b6ef77b390fa79eaf985f50b449dca), [`0708ec6`](https://github.com/nextlyhq/nextly/commit/0708ec68cd6785776f073f8e4453ffd95d8ccaca), [`9e59229`](https://github.com/nextlyhq/nextly/commit/9e59229d43ae0a57b2d14bf8c30c651f45bbab52), [`0121364`](https://github.com/nextlyhq/nextly/commit/0121364ce39b6f2780b3500b1a35aff700769af5), [`06f192f`](https://github.com/nextlyhq/nextly/commit/06f192f9b0546085ca3bd700cff0b97fe94206e1), [`2a6f497`](https://github.com/nextlyhq/nextly/commit/2a6f497fe51cb6bc2403bf77b1e929ceeb45b4a0), [`8653c19`](https://github.com/nextlyhq/nextly/commit/8653c19201992cd0243b2927ad017efe1da9a288), [`9c071ae`](https://github.com/nextlyhq/nextly/commit/9c071ae85e64e59942653408215b4ef0f06277ed), [`fe5206e`](https://github.com/nextlyhq/nextly/commit/fe5206ea8f57a9466d20ee4cb28827fcb1011138), [`ea942ba`](https://github.com/nextlyhq/nextly/commit/ea942bacdafeb46e228b88c932ad04a476122c83), [`fe645f1`](https://github.com/nextlyhq/nextly/commit/fe645f17a0492ccc22cb57e0acc11cffaca1ae04), [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c), [`0afa12a`](https://github.com/nextlyhq/nextly/commit/0afa12a3300679a97939f463e82702a721d1b505), [`c284753`](https://github.com/nextlyhq/nextly/commit/c28475395a77f334aa45acc75e8f85c439d8e455), [`aa21dbb`](https://github.com/nextlyhq/nextly/commit/aa21dbbb107406f7b6068add48495780c539da10), [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c), [`9563aa3`](https://github.com/nextlyhq/nextly/commit/9563aa3ec7fe14b189797ab3227cdb3bd41666f0), [`110d2bc`](https://github.com/nextlyhq/nextly/commit/110d2bcdcfe19e9a846ea6e40abcc52af5611600), [`d95e4d6`](https://github.com/nextlyhq/nextly/commit/d95e4d695fd2678071a8b93c016b8e80199b7229), [`da86960`](https://github.com/nextlyhq/nextly/commit/da869606c5d326aac1b75a50a2324c6e47d39bad), [`075870a`](https://github.com/nextlyhq/nextly/commit/075870acd262c00fa048c63ab9e85568dcede8e7), [`1f4941c`](https://github.com/nextlyhq/nextly/commit/1f4941cb6c84487ee4fc1d554e3fdbda3812dad6), [`6556810`](https://github.com/nextlyhq/nextly/commit/65568108bc06b44df60efa450bdcc3021b39af6d), [`c7b8348`](https://github.com/nextlyhq/nextly/commit/c7b834843e3d3b2aae652cbc6d2f07c104289f4e), [`f3ab090`](https://github.com/nextlyhq/nextly/commit/f3ab09095686af3c7ddf831767d90bfce43276c9), [`44fec3d`](https://github.com/nextlyhq/nextly/commit/44fec3d8d7503652c8faef483587b9af7d5c99cd), [`5702cdc`](https://github.com/nextlyhq/nextly/commit/5702cdc54ef8f97ed319721503ec59a75494818a), [`1bd2187`](https://github.com/nextlyhq/nextly/commit/1bd218792cda7ebb04ef271f1daa1da93041f92b), [`9c2e0e7`](https://github.com/nextlyhq/nextly/commit/9c2e0e7c10dc483b1d29a2675d91c7a9cdbb83a8), [`e9adb7b`](https://github.com/nextlyhq/nextly/commit/e9adb7b44f0d23c7ef3b288d4a56009da2a54826), [`0c9ec43`](https://github.com/nextlyhq/nextly/commit/0c9ec43d265b3e468c31ce0c87deb3b3d84edee6), [`81bf0d1`](https://github.com/nextlyhq/nextly/commit/81bf0d16305ebc5f9f7fdd873c65d92b17f739f4), [`73b7cb6`](https://github.com/nextlyhq/nextly/commit/73b7cb60667b1d542e567e180db316ece98da085), [`dd4027c`](https://github.com/nextlyhq/nextly/commit/dd4027ce091e4fff416763e6adf4bd6cd0679767), [`80db282`](https://github.com/nextlyhq/nextly/commit/80db2825804616d8a01ffef09ddd5b685c9eca92), [`91e66a4`](https://github.com/nextlyhq/nextly/commit/91e66a469537bd835408209354fe6da6043b946d), [`1862d9e`](https://github.com/nextlyhq/nextly/commit/1862d9eb29737dfbc41175e7d0da4b87bb53821f), [`c211fb3`](https://github.com/nextlyhq/nextly/commit/c211fb3b7e0faea435ab1c33137b4ed7211be671), [`4eabbbf`](https://github.com/nextlyhq/nextly/commit/4eabbbf22a1e2df58b6bbb7baebd7561096789b2), [`1654240`](https://github.com/nextlyhq/nextly/commit/16542400fca8a7dcd0f88f776ce69d16df28f63b), [`3b4b269`](https://github.com/nextlyhq/nextly/commit/3b4b269ac4953c7cdfa38223d6759cdb45d0bb52), [`aaa8c8c`](https://github.com/nextlyhq/nextly/commit/aaa8c8ce271634b7d0404048cb93b34e096ca3d5), [`4e91f14`](https://github.com/nextlyhq/nextly/commit/4e91f147a8540ce68cdab064c5717b3263b77f69), [`2b278e7`](https://github.com/nextlyhq/nextly/commit/2b278e7ea0d4453e09b82feab8700ebda9e6ca2a), [`985a438`](https://github.com/nextlyhq/nextly/commit/985a43864958499c8c4216458d2ca41d864663bc), [`52c6f1f`](https://github.com/nextlyhq/nextly/commit/52c6f1f9088c107ef2f2126ffd9b29e8e6a05d64), [`4a34f1e`](https://github.com/nextlyhq/nextly/commit/4a34f1e5a3ecd6327452a342d194fca6f676820e), [`928b982`](https://github.com/nextlyhq/nextly/commit/928b9829b79c0a96e75d97e7f115eb6aa293e51f), [`29bc0da`](https://github.com/nextlyhq/nextly/commit/29bc0dafc4bf0f2ef6e82b5462beb0a1aa7147e2), [`4fbf860`](https://github.com/nextlyhq/nextly/commit/4fbf8608d8ca740783b4c6c2b3348c32ddfa2c3e), [`f9079d0`](https://github.com/nextlyhq/nextly/commit/f9079d066cf7b14c1bfc539d4618f43f841845d9), [`c0c8c52`](https://github.com/nextlyhq/nextly/commit/c0c8c520d2af2f538fd0b423c983b95c15c37ea1), [`001ad57`](https://github.com/nextlyhq/nextly/commit/001ad576aba2869b8e7157538918ee55351d1c9a), [`7176d47`](https://github.com/nextlyhq/nextly/commit/7176d477c907edce488bd815b0d9c4141318c6fa), [`167147a`](https://github.com/nextlyhq/nextly/commit/167147acb291c536f9a3008a076798926a2e2add), [`1f254ff`](https://github.com/nextlyhq/nextly/commit/1f254ffc4af6fe8cc04c31ef815005c3348ee08b), [`49dc8e8`](https://github.com/nextlyhq/nextly/commit/49dc8e8034a6dd68ae29d0d658ba8374add9451f), [`d550908`](https://github.com/nextlyhq/nextly/commit/d55090872d3cb319fcb29bbb4e79ab356ecff963), [`f7d0b6a`](https://github.com/nextlyhq/nextly/commit/f7d0b6afe5fb9b8ebc4ee9c8491b6356732319c3), [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c), [`1b66317`](https://github.com/nextlyhq/nextly/commit/1b66317a4dcbcf830a282c6a1dc8795a59921293), [`03bf79b`](https://github.com/nextlyhq/nextly/commit/03bf79be79d6918f55011e5fbe1bcb35d3e95aa9), [`8f63701`](https://github.com/nextlyhq/nextly/commit/8f637018bb5db985efb0e19ae220faf1211e83d4), [`9cbd6bf`](https://github.com/nextlyhq/nextly/commit/9cbd6bf92c25bfa189edc7c900b75a4b75495567), [`6d0e94f`](https://github.com/nextlyhq/nextly/commit/6d0e94f1f152c4ba4e62b9724ff5f85c961fbe31), [`cf1c679`](https://github.com/nextlyhq/nextly/commit/cf1c679d93250c372ccfbc04140616466986c0f6), [`2a8263a`](https://github.com/nextlyhq/nextly/commit/2a8263a3fa218fb47cc9ba43f1ef5c61ff9f521f), [`32d89c2`](https://github.com/nextlyhq/nextly/commit/32d89c2dbbae9e6c9724879a8ff74d5d0622ce4a), [`d58455c`](https://github.com/nextlyhq/nextly/commit/d58455c6e7d90cd8c4aac0fd58839632c01c204a), [`23d36f3`](https://github.com/nextlyhq/nextly/commit/23d36f3f9c9eb92262bcb08e14e68be515f096d8)]:
  - nextly@0.0.2-alpha.66
  - @nextlyhq/plugin-sdk@0.0.2-alpha.66
