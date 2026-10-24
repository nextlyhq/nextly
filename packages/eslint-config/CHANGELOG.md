# @nextlyhq/eslint-config

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

- [#2606](https://github.com/nextlyhq/nextly/pull/2606) [`859d13a`](https://github.com/nextlyhq/nextly/commit/859d13aa0b549f88b7b5583d1947799a1a5cd6cc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Projects scaffolded by `create-nextly-app` now ask for React `^19.3.1`, the version Nextly is built and tested with. They already get the newest Next.js at scaffold time. Inside the repository, the playground and the packages build and test on Next.js 16.4.2 and React 19.3.1. What the packages accept from an app is not changed by this release note: `next` is `^15.5.28 || ^16.4.1`, raised separately for the October security advisories, and React is 18 or 19 (`@nextlyhq/blocks-react` and `@nextlyhq/plugin-page-builder` need React 19).

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
