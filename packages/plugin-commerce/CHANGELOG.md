# @nextlyhq/plugin-commerce

## 0.0.2-alpha.71

### Patch Changes

- [#2756](https://github.com/nextlyhq/nextly/pull/2756) [`709babb`](https://github.com/nextlyhq/nextly/commit/709babbdce0f78b957e71b974178d4f34b20f657) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A production server (`next build` and `next start`) now serves a file uploaded to Nextly's default local-disk storage as soon as the upload finishes, at the same `/uploads/...` URL `next dev` gives it. Before, Next.js answered 404 for it until the server restarted, because `next start` serves only the files `public/` held when it started. A route at `src/app/uploads/[...path]/route.ts`, built on the new `nextly/api/uploads` export, serves the rest: it streams files, answers `Range` requests for video and audio, sends `ETag` and caching headers, sets `nosniff` and a script-blocking policy on SVGs, and answers 404 for any path outside the storage folder and whenever cloud storage holds media. The local adapter's check that a path stays inside its folder no longer accepts a sibling folder whose name starts with the folder's own, such as `public/uploads-private` beside `public/uploads`.

  **Before you upgrade:** projects don't ship the uploads route yet, so an app keeps the old behaviour until it has one. Add `src/app/uploads/[...path]/route.ts` (or `app/uploads/[...path]/route.ts` without a `src/` folder) exporting `GET` and `HEAD` from `createUploadsHandlers({ config })` in `nextly/api/uploads`, as shown in [Media & Storage](https://nextlyhq.com/docs/guides/media-storage#how-local-uploads-are-served). Until then, a production server logs a warning naming the file the first time an upload would be unreachable.

- [#2765](https://github.com/nextlyhq/nextly/pull/2765) [`ed1b2f1`](https://github.com/nextlyhq/nextly/commit/ed1b2f19f440dc02dcc12e2d2940f74cc44fdaae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Security: zod moves to 4.6.7 and DOMPurify to 3.4.17.
  - zod before 4.6.6 could run out of memory validating a very large array against an array schema without a length limit (GHSA-mrhx-c7xc-m3w5). Every package that validates input with zod gets the fixed version.
  - DOMPurify before 3.4.17 had sanitizer bypasses in its `SAFE_FOR_TEMPLATES`, DOM-output and `IN_PLACE` modes (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr). Nextly's SVG upload sanitizer uses none of those modes, so it was not affected; the floor still rises, so no install can resolve an affected version.

- Updated dependencies [[`709babb`](https://github.com/nextlyhq/nextly/commit/709babbdce0f78b957e71b974178d4f34b20f657), [`ed1b2f1`](https://github.com/nextlyhq/nextly/commit/ed1b2f19f440dc02dcc12e2d2940f74cc44fdaae)]:
  - @nextlyhq/plugin-sdk@0.0.2-alpha.71
  - nextly@0.0.2-alpha.71

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
