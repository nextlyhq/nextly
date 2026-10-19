# @nextlyhq/plugin-accounts

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
  - @nextlyhq/admin@0.0.2-alpha.68
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

- [#2100](https://github.com/nextlyhq/nextly/pull/2100) [`ca866a0`](https://github.com/nextlyhq/nextly/commit/ca866a0fc2029df5eb5c4c7b9b74e437036e5239) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The AGENTS.md a new project or plugin receives names only exports that exist: `definePlugin` comes from `@nextlyhq/plugin-sdk`, not its `/admin` entry, and every sample imports the functions it uses. The generated-types stub no longer mentions a `nextly dev` command.

- [#2259](https://github.com/nextlyhq/nextly/pull/2259) [`2cfea22`](https://github.com/nextlyhq/nextly/commit/2cfea22947d17790e605679b03465a33078c4103) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In an existing `.env.example`, a credential is flagged when its first word only begins like a placeholder word (`enterprise-…`), and when the database URL carries it in a query parameter whose name is percent-encoded (`?p%61ssword=…`).

- [#2238](https://github.com/nextlyhq/nextly/pull/2238) [`fc8c902`](https://github.com/nextlyhq/nextly/commit/fc8c902808b85f21651854f0e45c49305eb2739b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The `nextly.config.ts` written when Nextly is added to an existing app keeps its placeholder comments where they apply: `// Add your collections here` directly above `collections`, and `// Add your singles (globals) here` directly above `singles`, inside the exported config. Both used to run together on one line above `export default`.

- [#2225](https://github.com/nextlyhq/nextly/pull/2225) [`224e51a`](https://github.com/nextlyhq/nextly/commit/224e51a1657558916fe0990d25134b90a0ca3e48) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing app no longer writes through a folder on a file's path that is a symbolic link. When the app's `app/admin`, `types/generated` or another folder Nextly writes into is a link to a directory elsewhere, nothing is written there, which could have been outside the project. The file is reported as left alone, with the folder that is a link and, for the admin's files, the content Nextly needs, as the media routes already did.

- [#2151](https://github.com/nextlyhq/nextly/pull/2151) [`7dfb74b`](https://github.com/nextlyhq/nextly/commit/7dfb74bdf4c7e9bb74c8afb6c635d42189e110a9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing Next.js app now writes the admin's media route under `/admin`, the same file a new project gets, so uploads, edits and deletes in the admin's media library work. Every request to it is checked against the signed-in caller's media permissions; the public media route stays read-only. The routes import the Nextly config by a path relative to themselves, so no import alias is needed. A media or health route the app already has is left exactly as it was and reported, and for the admin's route the report includes the content to add. A route is not written where a Pages Router page answers its URL (in `pages/` or `src/pages/`), since Next.js refuses to build a page and an app route at one URL; that is reported in the same way.

- [#2216](https://github.com/nextlyhq/nextly/pull/2216) [`b766e82`](https://github.com/nextlyhq/nextly/commit/b766e8239c7d86ccd9ad1ed82b983675ed2e2573) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding Nextly to an existing app no longer replaces or refuses over files the app already has, and the run ends with one report of everything it did. Before, a `nextly.config.ts`, admin API route or admin page already there stopped the whole run with an error, and the admin's `layout.tsx` was written over whatever the app had.

  Now every file is created only where nothing is (exclusively, so a link or a file that appears meanwhile is never replaced). One already there is left byte for byte, and the report says so, with why and, for the admin's routes, page and layout, the content Nextly needs there. The report lists each file written, each extended with what was added (the Next config's packages included), and each left alone, across every step, the env files and their warnings included, in one place after the spinner, by path, key and package name only: no env value, the generated secret included, is ever printed.

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

- [#2236](https://github.com/nextlyhq/nextly/pull/2236) [`9a94294`](https://github.com/nextlyhq/nextly/commit/9a94294831de5d3ee20be0faab0c4ac104b28790) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting a collection or a Single deletes its registry row before it sweeps
  the entity's autosaves and version pins, on every deletion path. A pin locks
  that row first, so the two now take the same lock in the same order: a pin
  under way when its entity is deleted no longer outlives it, and a pin moving
  a slot no longer deadlocks with the deletion.

- [#2110](https://github.com/nextlyhq/nextly/pull/2110) [`47c601c`](https://github.com/nextlyhq/nextly/commit/47c601c62078d8068c881dd4e8633aa199d292d5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The npm pages of create-nextly-app and @nextlyhq/plugin-mcp describe what ships today: the CLI's usage data is collected under a random ID, and the MCP plugin is experimental, off by default and read-only, with one tool.

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

- [#2062](https://github.com/nextlyhq/nextly/pull/2062) [`9b52955`](https://github.com/nextlyhq/nextly/commit/9b529559f61d19c170cf150fe2aa1ebd8bccae58) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Internal: core code a plugin hands the transaction handle from `ctx.db.transaction` can now write inside that transaction, committing or rolling back with the plugin's own work. A handle whose transaction has finished, or anything that is not such a handle, is refused rather than written through. No plugin-facing API changes here; the helpers that take `{ tx }` build on it.

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
  - @nextlyhq/admin@0.0.2-alpha.67
  - @nextlyhq/plugin-sdk@0.0.2-alpha.67
