# @nextlyhq/blocks-engine

## 0.0.2-alpha.48

### Patch Changes

- [#417](https://github.com/nextlyhq/nextly/pull/417) [`1f81cf3`](https://github.com/nextlyhq/nextly/commit/1f81cf3d2a665a1133be1cd3e43bbbb25eb4992a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read every related row through one code path, so a capability added to relationship population applies everywhere a relationship is populated instead of at whichever call sites were remembered.

- [#423](https://github.com/nextlyhq/nextly/pull/423) [`2f05141`](https://github.com/nextlyhq/nextly/commit/2f0514180faaaf2acde4f0dea3261896afcf302e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fixes PostgreSQL index introspection reading indexes from the wrong table. Table names are unique per schema rather than per database, so a table with the same name in another schema had its indexes merged into the one being inspected. That could hide an index that needed creating, or report one that was never there.

  Refuses to run a schema sync while a field group storage migration is in flight. Mid-run some tables carry their old names and some their new ones, and the registry rows pointing at them move one step at a time, so a sync during that window could delete storage it could not account for.

  Also further groundwork for that migration: it can now execute its rename steps and check its own work. A table, its localization companion and the registry row pointing at them move as one step, and on PostgreSQL and SQLite they commit together. MySQL applies a schema change as soon as it is issued, so there the halves land in sequence and a resume completes whatever did not; a reader in that window sees a table as missing rather than reading anything wrong. Every step verifies against the database rather than trusting that it ran, and index survival is checked by name, so an index dropped and replaced by another is caught rather than passing on an unchanged count. Nothing calls the migration itself yet.

- [#424](https://github.com/nextlyhq/nextly/pull/424) [`0538f4f`](https://github.com/nextlyhq/nextly/commit/0538f4f7228493a8f7a28df4e5f7057787f2a80f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a form be updated without resending its fields. Changing a form's name or settings failed with "Form must have at least one field" because an absent `fields` in the patch was treated as an empty one.

- [#422](https://github.com/nextlyhq/nextly/pull/422) [`a4dad07`](https://github.com/nextlyhq/nextly/commit/a4dad074e3acd7cdaccd8291f07e6fdc3f1d72ed) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit a `form.submission.created` webhook when a form submission is created. The event type was already subscribable in the admin UI but had no producer, so an operator could subscribe to an event that never fired.

  Form submissions carry visitor-entered answers plus `ipAddress`/`userAgent`, so the submissions collection suppresses the PII-bearing `entry.*` events. It now instead emits a curated, metadata-only `form.submission.created` carrying only which form, when, and the status — never the answers, IP, or user agent. The event is recorded in the same transaction as the submission, so it commits atomically and is never delivered for a rolled-back write.

  This is driven by a new declarative `webhooks.emit` collection option (`{ event, fields }`): any PII-bearing collection can replace its default `entry.*` events with a safe curated one that ships only an allowlisted set of fields (default-deny). The resource kind is derived from the event name.

- [#421](https://github.com/nextlyhq/nextly/pull/421) [`83ed5c9`](https://github.com/nextlyhq/nextly/commit/83ed5c9c46a653217d741dae6579bf39b5efcaac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A string stored in a JSON field no longer fails the write on PostgreSQL and MySQL.

  A field backed by a JSON column accepts any JSON document, a plain string included. A string that is not itself encoded JSON was passed through to the driver as bare text, which PostgreSQL and MySQL reject as invalid JSON, so storing `"hello"` in a `json` field failed the write outright. On SQLite, where the column is plain text, it was stored in a form no read could recover as what was written. Such a value is now encoded, so it round-trips as the string it was.

  A string that already parses as JSON is still passed through untouched, so content a previous write encoded is not wrapped a second time.

- [#415](https://github.com/nextlyhq/nextly/pull/415) [`0e18a97`](https://github.com/nextlyhq/nextly/commit/0e18a971f7b6ab2a68df575623337fa0c1049a12) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Apply a target collection's read rule when it filters on one of that collection's localized fields, so populating a relationship returns the rows the rule permits instead of withholding every one of them.

- [#405](https://github.com/nextlyhq/nextly/pull/405) [`e1467e8`](https://github.com/nextlyhq/nextly/commit/e1467e858056b48ee61d052a9886a208006739b8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed field types are now first-class in generated output, in the manifest, and in the validation a plugin can reuse.

  `nextly build` emitted nothing at all for a custom field type: the generators test membership of the built-in list, so the field was skipped while its value was still stored, leaving apps with no generated type and no schema entry for it. A type now states its own rendering through `PluginFieldType.codegen`, receiving the field as declared so a type whose options narrow what it stores can narrow what it generates.

  A type's options can now be held in a `pluginOptions` container core never reads, so an option may use a name the field schema already declares — `options`, `fields`, `admin`, `label` — which was previously judged against the core meaning and refused. Options written directly on a field are still read, and a type is handed one flat view of both, so where an option was stored is not something a plugin author tracks.

  A user field whose type a plugin contributed can now be declared from code with `pluginUserField()`, which was previously impossible without a cast: `UserFieldConfig` admits only the built-in shapes, and widening it to accept an unknown type token would have made a malformed built-in declaration pass too.

  `validateFieldValues` is now available from the plugin SDK, marked experimental until a first-party plugin depends on it, so a plugin storing structured content of its own applies the same rules a write does rather than reimplementing `required`, the per-type checks, and every plugin field type's `validate`.

  Several correctness fixes ride along, most of them about a value reaching a column its type cannot hold.

  A JSON column stores a JSON document, and `true` or `42` is a document as much as `{}` is; only objects were encoded, so a scalar reached the driver as its own type and could not round-trip through a SQLite text column. The four write paths that each carried their own copy of that encoding now share one.

  A value written to a custom user field was never checked against the column its type stores in, and a failed `user_ext` write is read as the extension table being absent — so the user was created without the value, with extensions disabled for the rest of the process, rather than the write being refused. Such a value is now refused with the field named. A required single field backed by a plugin type was seeded with the wrong kind of value for the same reason, which could stop the single being created at all.

  `nextly build` now generates types for a project made only of singles, field groups or user fields, where it previously wrote nothing or left a stale file, and narrows `PermissionSlug` and `EventName` as `generate:types` does — a deployment build no longer widens types a development run had narrowed. `db:sync --watch` now keeps watching such a project too, instead of exiting its watch loop and never re-syncing.

  A key named `__proto__` was silently dropped when rebuilding an object from data nobody validates, which lost it from a delivered webhook envelope, from a stored version diff, and from the declaration a plugin validator judges. And `db:sync --watch` could classify one config's columns with another config's field types, because a reload replaces the process-wide registry while the previous sync is still running; work now resolves against the config it started from, and a reload whose watcher was replaced mid-flight no longer applies its result or leaves its registrations behind.

- [#418](https://github.com/nextlyhq/nextly/pull/418) [`21bb5b3`](https://github.com/nextlyhq/nextly/commit/21bb5b3ed9c8c7e731870167a86765f17791eeb4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop serving unpublished rows through relationships. A related row is now filtered by Draft/Published exactly as a direct read of it is, so a published document linking to a draft one no longer discloses that draft's contents.

- [#414](https://github.com/nextlyhq/nextly/pull/414) [`45faba9`](https://github.com/nextlyhq/nextly/commit/45faba9c02f751bd41e4d4e2701ba5de5d286ed5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit `user.created` and `user.deleted` webhook events. Both were already advertised as subscribable in the admin UI but had no emit sites, so an operator could subscribe to events that never fired. They now record into the transactional outbox atomically with the account change, through a new Drizzle-transaction recorder (`recordEventInTx`) that lets services running on `BaseService.withTransaction` — like the auth service — participate in the outbox without the adapter's positional transaction context. Each event is attributed to the authenticated caller and, like the content write paths, offers the fast-path drain and a bounded retention prune after commit — including on self-registration — so delivery and outbox pruning do not wait for the scheduled drain. The delete event reads the removed account's identity inside the delete transaction, so a concurrent update cannot make it report a stale address. The payload is PII-safe: identity only (id, email, name), never the password hash, a token, or role assignments.

## 0.0.2-alpha.47

### Patch Changes

- [#404](https://github.com/nextlyhq/nextly/pull/404) [`f41a985`](https://github.com/nextlyhq/nextly/commit/f41a9857aa3f32000b386aa8ec866e4a5f8d38cc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - More groundwork for the upcoming field group storage migration: the rename plan is now derived from the database rather than from configuration, so a table named through `dbName` is found and left alone rather than renamed over. Nothing calls this yet, so there is no change in behaviour in this release.

- [#408](https://github.com/nextlyhq/nextly/pull/408) [`1448488`](https://github.com/nextlyhq/nextly/commit/14484884a1722fb713d9a895749fa65876afe4d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fixed component data teardown resolving table names case-insensitively on every database. On PostgreSQL, and on MySQL with `lower_case_table_names=0`, two names differing only in case are two different tables, so a registered component whose stored name differed in case from a real table could have that other table's rows deleted. Whether two spellings mean one table is now read from the server rather than assumed, including that SQLite folds ASCII case only, so `Ä` and `ä` stay distinct tables there.

  Also more groundwork for the upcoming field group storage migration: the rename plan is now checked against what the database actually contains before anything runs, so a name already in use, a registry row whose storage or companion table is missing, or a half-applied rename that recorded progress cannot account for all refuse up front instead of failing partway through. That part is not called by anything yet.

- [#382](https://github.com/nextlyhq/nextly/pull/382) [`b448e6d`](https://github.com/nextlyhq/nextly/commit/b448e6d0c386492163756bef986ee76b097b8477) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a translation could overwrite the original language. `nextly db:sync` marks a collection as localized in a separate process from the running app, so the app could show the language switcher before its translations table existed — and a translation saved in that window wrote over the original-language values and changed the entry's URL, while reporting success.

  The translations table is now prepared during `db:sync` and during a dev config reload, for collections, singles and field groups alike. If it is still missing, a write in a non-default language is refused with a clear message instead of overwriting anything, and the same refusal now covers singles and embedded field groups rather than only collections.

  Writing the default language before the table exists still goes to the main table as before. The one exception is content that was localized from the start, whose translatable values have never had a main-table column to fall back to: saving that while the translations table is missing used to fail with a database error, and now reports the same clear message as the case above.

  Collections and singles that set a custom `dbName` are handled correctly here too; previously their translations table could be created against a table name that does not exist. And a database that is unreachable or refusing connections is no longer reported as a missing translations table.

- [#401](https://github.com/nextlyhq/nextly/pull/401) [`1e0ef91`](https://github.com/nextlyhq/nextly/commit/1e0ef9171ca53935faa037479e711df37e229913) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop a relationship from populating a row the caller may not read. A related
  row belongs to another collection and carries that collection's own read
  rules, but expansion selected it straight from its table and applied only
  field-level redaction — so a caller refused the collection outright still
  obtained its rows by populating a relationship that pointed at them.

  The target collection's stored read rules are now evaluated for the caller
  before its rows are populated, on single reads, listings and nested hops. A
  refused target reads as an absent relationship rather than an error, so one
  unreadable reference does not refuse the whole parent read.

- [#409](https://github.com/nextlyhq/nextly/pull/409) [`d5568ff`](https://github.com/nextlyhq/nextly/commit/d5568ff456073b5756086fbd6c343b522ada70b9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Consolidate the version-history reference access checks behind a single shared media/users read gate. Internal refactor with no behavior change: the media and users label lookups previously duplicated the scope-then-RBAC check inline, and now share one audited gate so every reference-resolution path stays access-checked.

- [#406](https://github.com/nextlyhq/nextly/pull/406) [`b7e334b`](https://github.com/nextlyhq/nextly/commit/b7e334b47ff56a204454689202bb911a16e4e312) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Show linked entries and media by name in version history.

  Previewing a past version or comparing two versions now shows relationship and upload fields by name: a relationship reads as the linked entry's title, and an upload as its filename with a thumbnail, instead of a bare id. Labels are resolved through the same access checks as a normal read, so a linked document you are not allowed to read stays shown as its id rather than revealing its title, and a many-relationship still shows the links the version actually held rather than the document's current ones.

- [#410](https://github.com/nextlyhq/nextly/pull/410) [`77fb550`](https://github.com/nextlyhq/nextly/commit/77fb5500ff93d7679298aae77608ea9c1a0ae460) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Polish version history for localized and restored content, and give the Schema Builder control over retention:
  - **Filter version history by locale.** The history panel now shows a language badge on each version and a locale filter (defaulting to all locales), so a localized document's history is legible instead of interleaved. The filter is added to both list surfaces (the REST route and the dispatcher) and hides automatically for non-localized documents.
  - **Show restore lineage.** A version created by restoring an earlier one now displays a "Restored from vN" chip on its row and in its preview, so a rollback is visible at a glance.
  - **Set version retention in the Schema Builder.** The versioning toggle's Advanced tab gains a retention control — keep all history, keep the default (50), or keep the last N per document — reaching parity with code-first `versions.maxPerDoc`. The value persists through the builder's create/update endpoints and the committable `ui-schema.json` manifest.

## 0.0.2-alpha.46

### Patch Changes

- [#398](https://github.com/nextlyhq/nextly/pull/398) [`4b46b5c`](https://github.com/nextlyhq/nextly/commit/4b46b5c0174f4c8673483e0e2c094f4f14bb808e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Compare any two versions of a document in the admin history panel.

  From a version's preview in the history panel, you can now compare it against the previous version or the current one. The comparison lays out what changed field by field: edited text reads inline with the added and removed words highlighted, changed values show their before and after, and list items and relationships are marked as added, removed, moved, or edited. A "Changed only" toggle, on by default, hides everything that stayed the same so the real differences stand out.

  Available for both collection entries and singles on any document with versioning enabled. A comparison is always between two versions in the same locale.

- [#403](https://github.com/nextlyhq/nextly/pull/403) [`2685550`](https://github.com/nextlyhq/nextly/commit/268555041b1fc45216cd28649eebb5f4a97482a4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Recover a version history that failed to refresh, without reopening the panel.

  When the history panel cannot refresh its list (for example after the tab regains focus following a save made elsewhere), it keeps the loaded history on screen but holds back the "Compare with current" and "Load more" actions until it can confirm the latest version. It now shows a short notice with a "Try again" button, so a transient failure can be recovered in place rather than by closing and reopening the panel.

- [#402](https://github.com/nextlyhq/nextly/pull/402) [`b85b799`](https://github.com/nextlyhq/nextly/commit/b85b7992d62c178122b3d794a4082ff333ba5a1f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - More groundwork for the upcoming field group storage migration: a migration run now claims a durable lock row for its duration, so a second run refuses instead of starting alongside it, and records a step only after checking the database reached the state that step intended. Nothing calls this yet, so there is no change in behaviour in this release.

- [#399](https://github.com/nextlyhq/nextly/pull/399) [`831cf74`](https://github.com/nextlyhq/nextly/commit/831cf74df71a1468bae064d047f28d20ccf9a981) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal groundwork for the upcoming field group storage migration: durable progress tracking, and a startup guard that refuses to serve a database whose storage state cannot be accounted for. Nothing calls this yet, so there is no change in behaviour in this release.

- [#383](https://github.com/nextlyhq/nextly/pull/383) [`5154cc2`](https://github.com/nextlyhq/nextly/commit/5154cc2d2d3083d763cf56977475ef84e33a1b2a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed field types can now state rules about their own declaration, not just about stored values. `PluginFieldType.validateOptions(field)` runs on every path a declaration reaches storage by — boot, `db:sync` and its watcher, Schema Builder writes, the direct create/update endpoints, `nextly build`, `migrate:create`, and the HMR reload — and returns `true`, a message, or a list of issues naming the options at fault. Each of those sits after the field-type registry is populated; the `define*` calls do not, so a custom type is still refused there as an unknown field type. It reads the declaration as written, which on the Builder path means the submitted payload rather than the parsed copy, since that is what gets persisted.

  Options a plugin field type declares now survive the Schema Builder. The admin rebuilt each field from a fixed list of known properties, so a custom option was dropped on the way in and again on the way out: saving an unrelated setting erased it from a field the user never touched, and a type that requires the option would have refused every save.

  A config edit that arrives while a reload is already running is now read. Reloads still never overlap, but the one in progress may have read the file before the edit landed, so the edit was previously dropped until the next save or a restart. A config load that fails now also leaves the field-type registry as it found it, instead of leaving it empty for whatever keeps running on the previously-loaded config.

  Without it a custom type's options were accepted unread, so a declaration that no value could ever satisfy was only discovered per write, which reports a schema defect to the writer who cannot fix it. A disabled plugin's declaration checks no longer run, matching its `validate`.

  `nextly build` now runs the comprehensive config validators over singles and components, not collections alone. A single or component whose declaration was invalid previously reported a clean build and failed later at runtime.

- [#384](https://github.com/nextlyhq/nextly/pull/384) [`d2dabb9`](https://github.com/nextlyhq/nextly/commit/d2dabb962b39ff27b6399e09f6a1ba498c6fdb9b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Populate relationships that point at several collections. A field declared with
  a list of targets stores its value as a `{ relationTo, value }` pair, and
  expansion treated that pair as if it were a plain id while resolving the table
  from the field's first declared target. The resulting query bound an object
  where the driver expected a string, failed, and the failure was discarded, so
  the field came back as its raw pair at every depth with nothing logged.

  Values are now loaded from the collection each one names, on single reads,
  listings and nested hops alike, and a populated row is redacted by that
  collection's own field rules.

## 0.0.2-alpha.45

### Patch Changes

- [#389](https://github.com/nextlyhq/nextly/pull/389) [`0c79043`](https://github.com/nextlyhq/nextly/commit/0c7904333dc20351e7acd631def990de3179802a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field group REST endpoints moved from `/api/components` to `/api/field-groups`, and the route re-exports from `nextly/api/components` and `nextly/api/components-detail` to `nextly/api/field-groups` and `nextly/api/field-groups-detail`. Apps that re-export these handlers must rename their route files and imports; the old paths are removed rather than aliased.

- [#388](https://github.com/nextlyhq/nextly/pull/388) [`711e0c5`](https://github.com/nextlyhq/nextly/commit/711e0c542f9b771697a477bf43adc08e2970be52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Generated types now use the Field Group vocabulary: `nextly generate:types` emits `<Slug>FieldGroup` interfaces and a `Config.fieldGroups` map, and the Direct API exposes `FieldGroupSlug` and `DataFromFieldGroupSlug` in place of their `Component` equivalents. Re-run `nextly generate:types` after upgrading so the generated file and these types agree.

- [#392](https://github.com/nextlyhq/nextly/pull/392) [`b51f4e8`](https://github.com/nextlyhq/nextly/commit/b51f4e8699dced423aa2cd4c38f12a3a6ddfed10) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin panel now calls reusable field structures Field Groups. They live at `/admin/builder/field-groups` (previously `/admin/builder/components`), and the navigation, dashboard tile, builder and list screens use the new wording. Bookmarks to the old admin URLs will not resolve.

- [#386](https://github.com/nextlyhq/nextly/pull/386) [`2eeef30`](https://github.com/nextlyhq/nextly/commit/2eeef30a231e6931f90831567baecf8e617117d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reusable field structures are now called Field Groups. `defineComponent()` becomes `defineFieldGroup()`, the `component()` field helper becomes `fieldGroup()`, the `components` config key becomes `fieldGroups`, and plugins contribute them via `contributes.fieldGroups`. The old names are removed rather than aliased, so configs must be updated on upgrade.

  Stored data is untouched: tables, columns and the JSON written for existing content keep their current names, so this release moves no data and needs no migration.

  Configs and plugins still using the old key now fail at startup with a message naming the new one, rather than starting up with those definitions silently unregistered.

- [#390](https://github.com/nextlyhq/nextly/pull/390) [`768bdc7`](https://github.com/nextlyhq/nextly/commit/768bdc739932e2465f9bf0e59631fcebbd26149e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Direct API namespace `nextly.components.*` is now `nextly.fieldGroups.*`, and the dashboard, plugin admin metadata, and plugin introspection responses report field groups under a `fieldGroups` key. Reading the old namespace now reports the rename instead of failing as an undefined property.

- [#397](https://github.com/nextlyhq/nextly/pull/397) [`663306a`](https://github.com/nextlyhq/nextly/commit/663306a9518135b3b7f1351758c869a93ec3a63c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal modules and services for reusable field structures now use field-group naming. This renames three container keys reachable through the exported `getService()`: `componentRegistryService`, `componentSchemaService` and `componentDataService` become `fieldGroupRegistryService`, `fieldGroupSchemaService` and `fieldGroupDataService`. The old keys are not aliased, so a call using one no longer resolves. The field group schema service also drops `generateSchemaCode()`, an unused generator that was reachable through that same accessor. Stored data, table names, config keys and HTTP routes are unchanged.

- [#385](https://github.com/nextlyhq/nextly/pull/385) [`d135685`](https://github.com/nextlyhq/nextly/commit/d13568500541f9b9154ebaef7293ee17e8ab2236) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(nextly): make version snapshots complete and safe to restore

  Several version-capture gaps that could lose or corrupt content on restore are fixed:
  - Restoring an old version captured the content it applied but not the content it replaced, so content written while versioning was off (held in no version) was destroyed on restore. The current document is now snapshotted as a "Before restore" version inside the restore transaction, protected by the existing retention logic. This covers both collections and singles.
  - A single's component snapshots stored relationship and upload fields expanded into whole related rows instead of reference ids, so a versioned single with a component relationship could not be restored (the write failed) and could leak the related row's fields past redaction. Component snapshots now store references only.
  - For a localized, status-bearing single restored at a non-default locale, the pre-restore snapshot recorded the main row's status instead of that locale's, so undoing a restore could publish content that was never published. The snapshot now records the restored locale's own status.
  - A localized single's snapshot recorded only the fields a partial edit touched, dropping the write locale's other, still-persisted translations. The snapshot now carries the full set of the write locale's translations.
  - Publishing every locale of a localized entry emitted only a single, document-wide `entry.published`, so a subscriber watching one language never heard its translation go live. Each companion locale that actually transitions to published now emits its own locale-tagged `entry.published`. The publish is also judged against the row read under its transaction lock, so it records nothing when the entry was deleted concurrently.

- [#391](https://github.com/nextlyhq/nextly/pull/391) [`962fd25`](https://github.com/nextlyhq/nextly/commit/962fd25c323b8fd74a59a9d66c2be7a20910c42f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a version comparison (diff) engine and endpoint.

  You can now compare any two saved versions of a collection entry or a single and get a typed, field-by-field diff: word-level text changes, added, removed, moved, and edited items in repeatable and component fields (matched by their stable id, so inserting one row no longer marks every row after it as changed), and added or removed relationship targets. The diff is computed on the server and is access-gated and field-redacted exactly like reading a version, so a field you cannot read never appears in a diff. It is reachable over the dispatcher and as a standalone `nextly/api/versions-diff` route for both collections and singles. The admin comparison UI follows in a later change.

## 0.0.2-alpha.44

### Patch Changes

- [#374](https://github.com/nextlyhq/nextly/pull/374) [`a44ab69`](https://github.com/nextlyhq/nextly/commit/a44ab6988666317a9596d4019ad5bc1940995141) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Component tables are always derived from the component slug, resolved through a single canonical path. A custom `dbName` is no longer accepted on `defineComponent` or `components.create()`: it could name storage the component does not own, and whether two spellings refer to one table depends on database server configuration rather than anything the config can state. Components that relied on it should drop the option and let the table name derive from the slug.

- [#380](https://github.com/nextlyhq/nextly/pull/380) [`90108db`](https://github.com/nextlyhq/nextly/commit/90108db693079600c7fda5349170711a64d6bb2c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Relationships nested one level deeper now expand for collections you defined in code, not only for those created in the Schema Builder.

  `?depth=2` promises to populate a related document's own relationships, and it did so only for Builder-created collections. Resolving a target collection's fields read one of the two shapes those collections are stored in, so a code-first target resolved to nothing, the recursion guard failed, and the second hop was skipped silently at any depth — you got a bare id where a document was promised.

  Two consequences, both now closed. A `depth: 2` read returns what it says it returns. And an access rule reading across two hops — `data.author?.organization?.suspended !== true` — was enforced on a Builder collection while being quietly unenforced on a code-first one, so the same rule over the same data gave different answers depending on how the collection happened to be defined.

  Worth knowing if you use code-first collections with chained relationships: reads at depth 2 or more will now issue the queries that second hop requires, where previously they stopped early. Depth still bounds the walk, and a field's own `maxDepth` still overrides it.

- [#379](https://github.com/nextlyhq/nextly/pull/379) [`655532d`](https://github.com/nextlyhq/nextly/commit/655532d43fbc685466cdb921e046269f5fdf59d1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed field types can now validate what they store. `PluginFieldType.validate(value, { data, req, field, path, mode })` returns `true`, a message, or a list of issues with their own paths. Previously a custom type could be invented but say nothing about what belonged in it.

  Values of a custom type are now also checked against the storage primitive the type declares. A `number`-backed type used to accept the string `"3"` on its way to a numeric column, because the built-in rules only ever matched built-in type names; they now run first, then the type's `validate`, then the field's own. A disabled plugin's field types keep their schema but no longer run their `validate`, matching how every other plugin behavior is skipped.

  `json` fields now reject a value JSON cannot represent — a cycle, a `BigInt`, a bare function — as a validation error naming the field, instead of letting it reach the driver and fail there as a server error. Values JSON merely reshapes, such as an `undefined` member, are still accepted. `contributes.fieldTypes` is documented for the first time.

- [#367](https://github.com/nextlyhq/nextly/pull/367) [`66053c3`](https://github.com/nextlyhq/nextly/commit/66053c30325df31376b06a5dd919754a47648f7d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Honour a Single's declared hooks and field defaults

  Two documented parts of the `defineSingle()` config silently did nothing:
  - **Hooks** — `hooks: { beforeRead, afterRead, beforeChange, afterChange }` were
    never registered, so none of them ran. They now register (via the scaffolded
    init helper, alongside collection hooks) and execute on the single read and
    update paths. `beforeRead` remains side-effect-only, matching collections.
  - **Field defaults** — a `defaultValue` on a Single's field never applied; the
    first read auto-created the row with `null` in every defaulted column, because
    a function `defaultValue` cannot survive serialization to `dynamic_singles`.
    Defaults are now resolved from the live code-first config, so a scalar or
    structured (group/repeater) default lands on the auto-created document.

- [#366](https://github.com/nextlyhq/nextly/pull/366) [`ee20d18`](https://github.com/nextlyhq/nextly/commit/ee20d18c02c71f173354419497d89117e828f8b8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Singles now get their storage table on MySQL, and on any app configured with only a `DATABASE_URL` rather than an explicit `DB_DIALECT`. The DDL for a Single's table was generated from an optional environment variable that defaults to PostgreSQL instead of from the database the statements were about to run against, and a declared `slug` field was emitted as a type MySQL cannot put a unique index on, so the table was never created and the first read reported it missing.

  The plugin test harness can also boot against a real database: `createTestNextly({ dialect: "postgresql" | "mysql" })` creates a dedicated database for that instance and drops it on `destroy()`, and `getConfiguredTestDialects()` reports which dialects the environment is configured for so a suite can cover those and skip the rest. The default is unchanged: in-memory SQLite.

- [#381](https://github.com/nextlyhq/nextly/pull/381) [`22b43f2`](https://github.com/nextlyhq/nextly/commit/22b43f2b8a2c625df1336754df5931fba127a44a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Updating a Single no longer returns related fields the writer is not allowed to read.

  The response expands relationships, and those rows belong to another collection carrying its own field-level `access.read` rules. Read paths have evaluated them since the field-access work landed; this path forwarded no caller, so it returned every related field intact — including ones the same caller's `GET` would withhold. That made the write path a way around the rule: write anything, read the response back.

  A writer supplied a relationship id, not the related row's protected fields, so "they supplied the data" does not cover them. The rule that applies is the target collection's own, and it is now evaluated against the caller that made the write.

  This reaches every hop the response expands, not only the first: a related row's own relationships carry the rules of the collection at the far end, and those are evaluated too.

  Every caller the access gate applies to is judged, including one with no identity — an anonymous write permitted by a public update rule gets the same answer its read would give. Only a trusted write bypasses this, through `overrideAccess` rather than through an absent user.

  One consequence worth knowing if you write `afterUpdate` hooks: they receive the response as the caller will see it, so a related field that caller may not read is already gone. That matches how reads behave — related-row rules are applied while relationships expand, before `afterRead` hooks run — and it is why the two paths now agree. The Single's own fields are still redacted after your hooks, unchanged.

- [#369](https://github.com/nextlyhq/nextly/pull/369) [`f822937`](https://github.com/nextlyhq/nextly/commit/f8229372896cd27f76ba4052e41771bd7a7f912c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A read that cannot assemble the evidence its access rule needs is now refused rather than allowed. This covers relationships nested in a group or repeater, and counts references as well as checking them: a `hasMany` expansion drops the entries it could not fetch, so a list that came back shorter is evidence that went missing, not evidence that nothing is there. A relationship configured `maxDepth: 0` is left alone, since an unexpanded reference is what that asks for, and so is one declared with the legacy `relation` type, which is never populated at all. Localized references are checked too, by recording what the document referred to once translations were overlaid and before anything was expanded — which is the only point a localized reference is visible at all, and makes the count of what came back comparable for those fields as well. Upload references are held to the same bar as relationships. A relationship pointing at several collections is left alone: it is stored and served as a reference rather than populated, so demanding a document there would refuse every read of a Single that has one.

  Translation loading fails the read rather than reading through it. A companion query that errored was previously swallowed, leaving the main row's value in place — which a rule cannot tell apart from a translation that says so.

  A relationship that exists only inside a group or repeater is now expanded on read. The check for whether a Single had any relationships to expand looked at top-level fields only, so a schema that nests all of them was returned with bare ids. Reaching into containers is opt-in, and the write-response path does not opt in: it threads no caller, so the target collection's field rules cannot be evaluated for it and the rows it pulled in could not be redacted. Expansion is best-effort by design — a related table that cannot be read yields the bare id — which is right for a response and wrong for a document about to be judged: a rule written as `data.author?.suspended !== true` reads the missing row as permission. Every stored reference a rule may inspect is checked to have become a row before the rule is asked, and a read whose evidence is incomplete fails instead.

  A Single deleted while it is being read no longer materializes defaults nobody authorized. The rule approved the stored row; if that row disappears before the read fetches it again, what would be created is a default document no rule has seen. It is judged before it is written, rather than persisted — with its localized defaults and first version — and refused afterwards.

  The depth an access rule sees no longer drops below an ordinary read's. A caller asking for `depth: 0` narrows their response, and the authorization view now expands at least as far as an unqualified read would, and further when the caller asked for more.

  Access callbacks can no longer write through a `Map` or `Set` in their argument, including through an object used as a `Map` key. They already received plain objects and arrays as copies; these were passed by reference, so a callback could change the payload it was only asked to judge. Data that refers to itself is copied without recursing forever, and a value reachable by two paths stays one object in the copy.

  A `?depth=0` read still gets the references it asked for. The response deliberately leaves relationships unexpanded at that depth, so holding it to "every reference became a document" would refuse exactly what was requested; the authorization view judges those relationships at the full read depth regardless. Uploads are unaffected, since they populate at any depth.

  The decision made on the document you actually receive is held to the same completeness bar as the earlier one, so expansion that succeeds before your hooks run and fails after cannot leave a rule deciding on a reference where it expects a document. That check runs on the assembled document, before your `afterRead` hooks shape it — a hook is free to drop or replace a relationship, and nothing tells that apart from an expansion that failed.

  A read refused for incomplete evidence reports the canonical internal error rather than the underlying failure's own message, which for a database fault is schema detail. That covers relationship expansion, component population, translation loading and the per-locale overview alike.

  A group or repeater whose stored value cannot be read — malformed JSON, valid JSON of the wrong shape such as a list where the field declares a group, or a repeater row that is not a row — now fails the read rather than being treated as empty, which would have walked past every relationship inside it.

  Translation loading and the per-locale overview both fail the read when it is being judged, rather than leaving the fields off. An ordinary read is still served best-effort; a rule cannot tell "no translations" from "the query failed", so a read about to be judged gets the failure instead.

  Metadata attached to a `Map` or `Set` under a symbol key survives the copy handed to an access callback. Arrays keep their holes and their own properties when handed to an access callback, under the keys they actually have — a decoration like `"01"` no longer overwrites element `1`. Sparse arrays keep their holes, and a `Map` or `Set` carrying its own properties keeps them, so a rule reading either decides on the structure the payload actually has.

  A subclass of `Map` or `Set` reaches an access callback as itself rather than rebuilt as the base collection, which would have discarded its methods and private state.

- [#375](https://github.com/nextlyhq/nextly/pull/375) [`0febd62`](https://github.com/nextlyhq/nextly/commit/0febd62ec556c1b2529b9fd8aaa26a505cbff066) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections and Singles created in the Schema Builder can now opt out of webhook recording from their Advanced tab, so content holding personal data never reaches the outbox or any subscribed endpoint. The setting is stored on the entity, takes effect on the next write, and survives restarts. Existing installs should run `nextly migrate` to add the new registry column; until then the switch has no effect and recording continues as before.

- [#378](https://github.com/nextlyhq/nextly/pull/378) [`0498e02`](https://github.com/nextlyhq/nextly/commit/0498e02d756072306211bfc6f2a5d02f8cba249e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(nextly): capture versions on programmatic entry writes

  The tx-API and batch entry writes (createEntryInTransaction, updateEntryInTransaction, and the createEntries/updateEntries batch internals) now record a durable version snapshot and carry the full relational document (component subtrees and many-to-many relations) on their outbox event, matching the interactive create/update paths. Programmatic writers (importers, plugins, agents) previously left no version history and emitted parent-columns-only events.

- [#377](https://github.com/nextlyhq/nextly/pull/377) [`3785345`](https://github.com/nextlyhq/nextly/commit/37853459a306f1323adb04d0c71ddc0a8f6338f9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Programmatic entry writes now emit webhook events. Writes through the transaction API (`createEntryInTransaction`/`updateEntryInTransaction`), the batch helpers (`createEntries`/`updateEntries`), and `publishAllLocales` previously recorded no webhook events, so importers, agents, and plugins writing through them were invisible to webhook subscribers. These paths now record `entry.created`/`entry.updated` and the corresponding `published`/`unpublished`/`status_changed` lifecycle events inside the write transaction, so an event is delivered for every entry write and is never emitted for a write that rolls back.

## 0.0.2-alpha.43

### Patch Changes

- [#368](https://github.com/nextlyhq/nextly/pull/368) [`648c7f4`](https://github.com/nextlyhq/nextly/commit/648c7f4b5463adb189b31527e7de276e094e00d2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin's design tokens now actually drive its appearance. Setting
  `--radius`, `--font-sans` or a brand colour reaches the components that
  should follow it, so a themed admin looks themed instead of only partly so.
  Radii across inputs, buttons, cards, badges and panels are derived from
  `--radius` rather than fixed per component, and the font family tokens are read
  at their use sites rather than being frozen into the compiled stylesheet.

  Font weights work again. `font-bold`, `font-semibold`, `font-medium` and
  `font-normal` had been compiling to nothing, so headings, buttons and emphasis
  rendered at the body weight throughout the admin; they now render at their
  intended weight.

  Several colour bugs are fixed, mostly in dark mode: sidebar navigation labels no
  longer take a tint from a themed brand colour, the sidebar has a distinct resting
  and active ink step, the email template preview frame no longer paints a white
  box on a dark page, and floating panels, neutral washes and the draft swatch are
  tinted from tokens instead of hardcoded values.

  Borders are lighter. `--nx-border` is now a decorative separator, so tables,
  cards and dividers read as quiet rules rather than hard lines, while form
  controls keep a clearly visible edge: text fields, search fields, selects, the
  tag, code and rich-text editors, colour pickers and the date-picker trigger are
  all drawn with the control-boundary token.

  Radio buttons and avatars are round again, along with switches, spinners and
  status dots, which a non-zero `--radius` had been squaring off.

- [#361](https://github.com/nextlyhq/nextly/pull/361) [`7d5a62d`](https://github.com/nextlyhq/nextly/commit/7d5a62dca59fe164dc24eef01df0a4e195430d22) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` can be run more than once against MySQL and PostgreSQL. The core schema comparison read several dialect spellings of the same value as differences — MySQL booleans, its `now()`/`CURRENT_TIMESTAMP` defaults, and PostgreSQL serial sequence defaults — so a second run reported changes to the schema the first run had just written and refused to proceed. A `nextval()` default over any sequence other than the one its column owns is still reported as a change.

- [#306](https://github.com/nextlyhq/nextly/pull/306) [`6481791`](https://github.com/nextlyhq/nextly/commit/64817910a41ecef468cf551f7b5a7df921bdbb0e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Duplicate entries now report "Resource already exists." instead of the stale-version conflict message, and CLI guidance only suggests commands and flags that exist.

  Creating an entry that violates a unique constraint returned 409 with "The resource has changed since you last loaded it. Please refresh and try again." — the message for an optimistic-concurrency conflict, which wrongly tells the user to refresh. The legacy service envelope now carries the canonical error code, so the REST dispatcher and the Direct API rebuild the precise DUPLICATE error.

  CLI guidance is corrected to real commands: the production auto-sync guard points at `nextly migrate:create` + `nextly migrate` (previously the unregistered `migrate:generate` / `migrate:run`), `nextly add` no longer tells you to run the removed `nextly dev`, and the `db:sync --force` help text states the flag is a deprecated no-op. `nextly upgrade` and `nextly migrate:resolve` now accept `--force-unlock`, so the migrate-lock busy error's advice to re-run with that flag works on every command that takes the lock.

- [#350](https://github.com/nextlyhq/nextly/pull/350) [`ac3afca`](https://github.com/nextlyhq/nextly/commit/ac3afcab430136e8d8c9f5a1176695182fd8417d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field's declared constant `defaultValue` is now applied when a collection entry is created through the REST or Direct API, not only in the admin form, and a required field carrying one can be created without supplying it. Defaults reach nested group and repeater fields too.

  Two limits: a `defaultValue` written as a function is not applied on these paths, because the stored collection definition cannot carry a function, and bulk or caller-managed transactional creates are unchanged.

- [#365](https://github.com/nextlyhq/nextly/pull/365) [`55bc36e`](https://github.com/nextlyhq/nextly/commit/55bc36e7ac15c074aea049a66ee581d69eba3971) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Code-first collections now get their tables created at boot on MySQL. The boot-time schema sync goes through an entry point that was handed a database connection rather than a connection URL, and drizzle-kit needs the MySQL database name as a separate argument, so the apply failed and the first query against the collection reported a missing table. The name now comes from the connection itself, which also fixes the publicly exported `applyDesiredSchema` for MySQL callers.

- [#359](https://github.com/nextlyhq/nextly/pull/359) [`732eb44`](https://github.com/nextlyhq/nextly/commit/732eb449f987085cab86130f3231663459d5948e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A single polymorphic relationship (one whose `relationTo` lists several collections) is now recognised as a JSON-backed field on the write path, matching how upload fields with the same shape are already treated. Its value reached the driver unserialized before, so writing one could fail.

- [#360](https://github.com/nextlyhq/nextly/pull/360) [`c7a3843`](https://github.com/nextlyhq/nextly/commit/c7a38433d3efdd6bfc21fc69ade2b92040b832e1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Retire the insecure `webhook-notification` prebuilt hook

  The `webhook-notification` prebuilt hook (selectable in the Schema Builder's
  Hooks editor) delivered over a bare `fetch` with no SSRF protection, and its
  `secret` produced a base64 of the payload rather than a real HMAC. A signature
  that is not an HMAC gives a false sense of authenticity, so the hook is removed
  rather than left in place.

  Use Nextly's signed webhook system instead: add an endpoint under **Webhooks**
  in the admin. It delivers HMAC-signed, SSRF-guarded requests through the
  delivery engine.

  Migration: any collection that still has a stored `webhook-notification` hook
  degrades to a no-op after upgrade (the write path skips unknown hook ids and the
  admin hides the missing card), so content keeps saving. Re-create the
  notification as a Webhooks endpoint to restore delivery.

- [#304](https://github.com/nextlyhq/nextly/pull/304) [`051f660`](https://github.com/nextlyhq/nextly/commit/051f660b1579c62cdeb9fbb6c729485b6b2733bb) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The rich text editor now follows content-language switches and version restores.

  Lexical reads its initial state once at mount, so when a localized entry or single switched language the form fetched and reset the other language's values, every regular input followed, and the editor kept displaying the first-loaded language. Stored translations were correct in the database, but the editor showed the default language for every locale, and saving from that stale screen overwrote the open locale's translation with the displayed content.

  A sync plugin now loads external form-value changes into the editor: a language switch or version restore replaces the editor content, an untranslated language shows an empty document, and the editor's own keystrokes echoing back through the form are recognized and left alone so the caret never jumps while typing. The undo history is cleared on each external load so undo cannot resurrect the previous language's document into the current one.

- [#354](https://github.com/nextlyhq/nextly/pull/354) [`0c2c369`](https://github.com/nextlyhq/nextly/commit/0c2c36989bc70ff057d038acd3654702bd4ce625) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Custom read rules are now enforced on Singles. A Single you restricted with one was previously readable by anyone who could reach it, because the rule was never consulted.

  The rule is judged against the document you actually receive: translations resolved for the requested language, component data attached, relationships expanded. A rule reading `data` therefore sees the finished document rather than a partial row, which is what makes a rule such as `data.secret !== true` mean what it says.

  That decision is made before your hooks run and before a Single is materialized on first read, so a caller your stored data refuses reaches neither. The document is assembled twice for a restricted Single: once to decide, and once for the response after your `beforeRead` hooks have had their turn.

  The rule is then asked again about the document being returned, because a hook may have changed it. One consequence is worth knowing: if a hook is what creates the denial — it sets the very value the rule refuses — that hook has necessarily already run by the time the rule can see its effect. The earlier decision covers every refusal your stored data supports; it cannot cover one that does not exist until user code produces it.

  Rules that return a **query constraint** are refused on Singles rather than partly applied. A constraint narrows a result set; by the time the read is decided, a Single's document has been assembled from several tables and no longer corresponds to one row for the database to test the predicate against. Return a boolean from a Single's read rule; constraints continue to work on collections, where they are folded into the query.

  A rule that returns no decision at all now denies, on collections as well as Singles. A rule is free to fall through without returning, and such a result was previously read as "allowed, with nothing to filter by" — admitting the caller and narrowing nothing.

  Field-level read access is applied to a Single **after** the read is decided, not before. A field your rule inspects is no longer removed from the document the rule is shown, so a rule guarding a value the caller may not read decides on that value rather than on its absence.

  Ownership is always decided against the stored row, and against the row actually being returned. An `owner-only` Single is not judged on the response object, which an `afterRead` hook or a field read rule is free to strip the owner identifier from — a transformation that could refuse a document to its real owner. It is judged on the row read before your hooks and again on the row read after them, so a hook write or a concurrent owner change cannot hand back a document the caller no longer owns.

  A first read of a Single that has never been written is judged against the defaults it would create, so a rule that refuses those defaults no longer lets the read materialize the document (and its first version) before returning 403.

  Your own claims on a `user` now reach the access rules, on every transport. A `custom` rule reading a tenant, a plan or an entitlement saw `undefined`, because the caller was rebuilt from a fixed list of canonical fields at four separate layers: the Direct API namespaces, the collection access service, the Single access gate, and the REST route-auth boundary. A rule written to refuse a caller therefore admitted it. Custom JWT claims are now carried from the verified session through to the rule, and the Direct API's `UserContext` accepts them explicitly, along with `roles` for rules that decide on more than one. A claim can never displace the authenticated identity: `id` and `roles` come from what the route authenticated, not from what the token says about itself.

  A read rule whose exclusion list comes back empty no longer denies everyone. `{ id: { not_in: [] } }` excludes nothing, so it restricts nothing — but it translated to no SQL condition, and a constraint that narrows nothing is refused rather than allowed to widen a read. Members that cannot narrow anything are now removed before that judgement, so the rest of the rule is what decides, and a rule made up entirely of them permits the read. An empty `in` list is still refused: it should match nothing, and honouring it after translation dropped it would widen the read to every row.

  Relationship depth no longer changes who is allowed to read. `?depth=0` shapes the response, and letting it shape the authorization view too gave a caller a way to blind a rule: the relationship stayed an id, so a rule reading into the related row saw nothing and read that as permission. Authorization uses the full read depth whatever the caller asked for.

  Field-level `access.read` callbacks are handed a detached copy too, and so are field write callbacks. They run after the document-level decision, so a callback that reached into a shared group, repeater or component could change a document that had already been authorized — with nothing to judge it again. The copy is taken before nested fields are redacted, so a rule at the parent level still sees what the document held when the pass began rather than what an earlier-registered field's redaction left behind. Values that cannot be structurally cloned — a JSON prop defining `toJSON()`, for instance — are passed through rather than rejected, so isolating the snapshot never fails a valid write.

  `findSingle` and `findSingles` forward your `fallbackLocale`. It was dropped, so a no-fallback read still fell back to the default language through the Direct API, and a rule keyed on it saw `undefined`.

  An access rule that writes to its `data` argument no longer changes the response. Rules are handed a detached deep copy, so a rule remains a decision rather than a transformation — a shallow one still shared every component, repeater and expanded relation with the response — and password values are stripped after every callback that could reintroduce one.

  A rule that reads an expanded relationship now sees the related row as stored, not as the response will show it. Related rows are redacted against the target collection's own field rules, and doing that before the decision handed the rule the hole rather than the value, so `data.author?.suspended !== true` read `undefined` and admitted a caller the stored data refuses. The response is still redacted; only the decision sees through it.

  A draft Single stays hidden from an untrusted caller even when a stored rule would refuse them. The rule was decided before the draft/published filter, so the answer was 403 rather than the 404 that conceals a draft — which disclosed both that the row exists and what the rule made of the caller.

- [#371](https://github.com/nextlyhq/nextly/pull/371) [`b8bf6d4`](https://github.com/nextlyhq/nextly/commit/b8bf6d4ad9b70105f79a72ee818ea564b055dc63) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Media cards keep their metadata inside the tile, four more surfaces stay within their rounded corners, and the corner-radius guide now matches the components.

  In the media library's grid view, a card's file size could paint outside the card border while its dimensions were squeezed to nothing. At the six-column layout this left the dimensions reading as a stray "1..", and a long label such as "Invalid size" spilled past the tile edge. The size is now always readable inside the card, and the dimensions appear once the card is wide enough to render both values in full, with a tooltip on the row carrying both at any card width.

  Four surfaces painted a full-bleed child square across a rounded parent, which anyone running a nonzero `--radius` could see: the email-template segmented control, the component-row card header, the schema-builder field table header, and the code editor's validation error strip. `CardHeader` also gained the top-corner counterpart of the fix `CardFooter` already carried. All of these are unchanged at the shipped `--radius: 0`.

  The slash command menu in rich text fields declared a stacking order that never took effect, so it could be covered by a dialog. It now sits above one.

  The corner-radius tier tables in the theme and in the plugin authoring guide described a system the components do not implement, pointing plugin authors at the wrong step for alerts, table wrappers, checkboxes, icon buttons, switches and tabs. Both now agree with the code and with each other, they no longer offer `rounded-xl` and `rounded-2xl` as steps of the radius knob (the published Tailwind preset never exported them, and they do not go square at `--radius: 0`), and they state what `--radius: 0` actually resolves to for each step. A new test pins the contract so the documents and the components cannot drift apart unnoticed.

- [#363](https://github.com/nextlyhq/nextly/pull/363) [`8de5ea3`](https://github.com/nextlyhq/nextly/commit/8de5ea3b67d7bd0454a6522c1c74208f57b9126e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content-route reads now enforce publish state and access, and localized draft translations no longer leak.

  `resolveContent` and `createContentRoute` (from `nextly/runtime`) now default to reading only `status: "published"` through the lifecycle-aware publish filter, so for a localized collection a draft translation under a published main row is no longer returned. They also enforce the collection's read-access rules by default: a rule-less (public) collection still renders, but a collection with a stored member-only or role-based read rule is hidden from an unauthenticated request (it resolves to `notFound()`). Pass a `user` to render member content, or `overrideAccess: true` for a fully trusted read.

  The Direct API `find` gains a `status?: "published" | "draft" | "all"` option that drives the same lifecycle-aware filter (constraining a localized collection's per-locale companion status), replacing the previous `statusField` where-clause on the content-route helpers. Status-less collections are handled automatically — the scope is a no-op there.

- [#355](https://github.com/nextlyhq/nextly/pull/355) [`521e453`](https://github.com/nextlyhq/nextly/commit/521e453ad2d654da7f137318e1a62a09f3404c6d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - nextly now ships content routing and sitemap/robots delivery from `nextly/runtime`: `resolveContent` (F1-cached published-by-slug lookup that rethrows on a transient error), `createContentRoute` (an optional catch-all factory that resolves any path to a published entry, with `generateStaticParams`, `generateMetadata`, and a reserved-path denylist), `isReservedPath`, and `nextlySitemap` / `nextlyRobots` for the canonical `app/sitemap.ts` and `app/robots.ts`. `cachedFind` now runs the read UNCACHED (instead of throwing a framework invariant) when called outside a Next request/build scope, so content reads work in tests, scripts, and other non-request contexts.

- [#362](https://github.com/nextlyhq/nextly/pull/362) [`0da91f5`](https://github.com/nextlyhq/nextly/commit/0da91f5b78494eeb0862fec3f707352f8532efaa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the `nextly webhooks:prune` command

  `nextly webhooks:prune` runs a webhook-queue retention pass on demand (with
  `--dry-run`), so a self-hosted install can reclaim the fanned-out event ledger
  and terminal delivery log from a cron job. It reads the same `webhooks.retention`
  policy as the automatic passes and does nothing when retention is disabled. See
  the new "Webhook queue retention & VACUUM" guide.

## 0.0.2-alpha.42

### Patch Changes

- [#332](https://github.com/nextlyhq/nextly/pull/332) [`80febb5`](https://github.com/nextlyhq/nextly/commit/80febb54de4126cb5f87d9891841dd92b88e7be9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Block props now go through the field system: a block declares its editable props with the same field types a collection uses, and their values are validated by the same server-side pass entries get. Binding a data field to a block prop is derived from the prop type, so every compatible prop offers it without the block opting in.

- [#343](https://github.com/nextlyhq/nextly/pull/343) [`a614d3d`](https://github.com/nextlyhq/nextly/commit/a614d3d933a5fa637ce62f9a3591c386263f348b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections and singles can now hold a page built from blocks. Add a field with `blocks({ name: "content" })`, optionally naming which registered blocks it accepts, and the whole page document is stored in one column and typed for you when you generate types.

- [#346](https://github.com/nextlyhq/nextly/pull/346) [`4f39297`](https://github.com/nextlyhq/nextly/commit/4f39297515aef6864bc1d0857c7556316877ab52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-level read rules now reach related rows inside components. A component's relationship fields copy whole rows out of the collection they point at, and neither the parent entity's field list nor the component's describes that collection's fields, so a field you protected there was returned inside the populated component to any caller that could read the parent. Reading a collection entry or a Single now judges those related rows by the rules of the collection they come from, for the caller making the request.

  This completes the read side of the redaction added for direct relationships. Write-side callers that assemble a payload without a caller are unchanged, so a mutation response still returns what it did before.

- [#347](https://github.com/nextlyhq/nextly/pull/347) [`81204af`](https://github.com/nextlyhq/nextly/commit/81204af2a5e3e3d24bb7e2f7a43cb9dc6cc1c0aa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Outbox event recording is now endpoint-gated. A content write records a webhook event only when the install has at least one enabled webhook endpoint, or when the new `webhooks.audit` option is turned on. Installs with no webhooks configured no longer pay an event-table insert and a full-document serialization on every write.

  Recording resumes immediately when an endpoint is created in the same process, and within about 30 seconds for one created in another process. A few events may still be recorded just after the last endpoint is removed; retention prunes them.

- [#344](https://github.com/nextlyhq/nextly/pull/344) [`2dec172`](https://github.com/nextlyhq/nextly/commit/2dec17206855a739e80bd35c29bb3530e7257711) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The scaffolded blog template now uses tag-based ISR: publishing or editing content in the admin refreshes the affected pages on the next request, with no rebuild and no 60-second timer. Content-template scaffolds (blog) also install `nextly` and `@nextlyhq/*` from the `alpha` dist-tag so they always get the `nextly/runtime` cache helpers the pages use.

- [#339](https://github.com/nextlyhq/nextly/pull/339) [`9ab5f19`](https://github.com/nextlyhq/nextly/commit/9ab5f19c52952db2224e49730c05d1ef3126ded3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content pages can now use tag-based ISR: cache a read with `cachedFind` and tag it with `nextlyTags` from `nextly/runtime`, and every content change (create, update, publish, unpublish, delete, or slug rename) busts exactly those tags so the page regenerates on the next visit — no rebuild, no `force-dynamic`. Revalidation turns on automatically wherever you mount the admin route (`createDynamicHandlers`). A per-operation `disableRevalidate` flag lets a bulk import, seed, or CLI write skip it. See the new "ISR and caching" guide, including the rule for keying a per-user read so it cannot leak across callers.

- [#337](https://github.com/nextlyhq/nextly/pull/337) [`6f19e60`](https://github.com/nextlyhq/nextly/commit/6f19e6060f21f33e8496fc7dbb30e2ed325e5ec2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections and singles created in the Schema Builder now carry their cache-revalidation setting. A new "Cache revalidation" switch on the Advanced tab (on by default) lets you opt a collection or single out of busting cache tags on write, and the setting round-trips through boot, HMR, `db:sync`, and `migrate:create` the same way code-first `revalidate` config does. Existing databases pick up the new registry column when you run `nextly migrate` (boot warns until it is run).

- [#336](https://github.com/nextlyhq/nextly/pull/336) [`d0a45d5`](https://github.com/nextlyhq/nextly/commit/d0a45d56d71c49db9d92fb0d20fb02c8fa3bd842) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections and singles can now opt out of webhook recording with `webhooks: false` (or `{ record: false }`). Form submissions opt out by default, so visitor IP address, user agent, and submission content are no longer recorded to the webhook outbox or delivered to endpoints subscribed to `entry.created` or `*`. Existing installs: submission events recorded before this release remain in the outbox and can be pruned manually; no data is deleted automatically.

- [#351](https://github.com/nextlyhq/nextly/pull/351) [`b44b1a3`](https://github.com/nextlyhq/nextly/commit/b44b1a3a8c8264a2e0c3d497bdf0a19d3aab4e84) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - @nextlyhq/plugin-seo now generates a sitemap of your published content and serves it at a public HTTP route under Nextly's dynamic handler (in a scaffolded app, `/admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml`). It lists one URL per published entry across the collections you configure, reflects publishes and edits on the next request, and leaves out drafts and any page marked `noindex`. Configure the site origin with `baseUrl` and per-entry paths with `urlFor`, or disable the route with `sitemap: false`.

- [#348](https://github.com/nextlyhq/nextly/pull/348) [`c0b3796`](https://github.com/nextlyhq/nextly/commit/c0b3796543e833e0125fbe094e10820835ec8c5d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read rules that narrow by a filter are now applied in full. A stored read rule can return a filter describing which rows the caller may see, and only part of it was being applied: the first field's `equals` value. A rule naming two fields filtered by one of them, a rule using any other operator applied nothing at all, and a rule whose value was legitimately falsy — `0`, `false`, an empty string — also applied nothing. In each of those cases the read returned rows the rule was written to exclude, and the matching count reported them too.

  Filters now go through the same translation your own `where` clauses use, so every field and every supported operator binds. Owner-only rules are unaffected: a single non-empty owner id was the one shape the old path handled correctly, which is why this went unnoticed.

  A filter is applied only if **all** of it can be applied, and access filters are held to a narrower shape than the `where` clauses you write yourself. A filter may name columns on the collection (or its localized fields) and compare them with any supported operator, including the shorthand `{ field: value }` form. Logical `and`/`or` groups, dotted paths like `author.name`, and empty `in`/`not_in` lists are refused rather than approximated, because each of those translates to something narrower than the rule states — or, in the dotted case, to a comparison against a different column.

  A refused filter is reported as forbidden, and the matching count refuses identically. If you need a shape that is currently refused, the read fails closed instead of quietly returning more than the rule allows.

- [#335](https://github.com/nextlyhq/nextly/pull/335) [`8512d5d`](https://github.com/nextlyhq/nextly/commit/8512d5dfcb9cd517ae2dd70e4357b348267675e5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-level read rules now apply to related rows. Populating a relationship copies the whole related row into the parent entry, and a field's `access.read` was only ever evaluated against the collection being read, never against the collection on the other end of the relationship. A field you protected on one collection was therefore returned in full to anyone who reached it through a relationship from another, at any depth. Passwords and system columns were already stripped there; this closes the same gap for the rules you write yourself.

  Each related row is now judged by its own collection's rules, for the caller making the request, so a relationship cannot return more than a direct read of that row would. Trusted server-side reads that pass `overrideAccess` are unaffected, and secrets are still stripped for every caller regardless.

  If you relied on reading a protected field indirectly through a relationship, that field will now be absent: read it as the collection that owns it, with a caller its rule admits.

- [#333](https://github.com/nextlyhq/nextly/pull/333) [`ba3e8f4`](https://github.com/nextlyhq/nextly/commit/ba3e8f4a6099e995f7200491d00dd0b381222e8a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection read rules now apply over the REST API. Listing, fetching and counting entries previously ignored who was asking, so a collection configured with an owner-only or role-based **read** rule still returned every row to any caller who could reach the endpoint — the rule only ever held on writes and inside the Direct API. Reads now evaluate the caller against the collection's stored rules, with owner-only scoping applied in the database query so pagination and totals stay correct, and a count can no longer describe rows the caller is not allowed to see.

  Role-based read rules are evaluated against the caller's resolved roles, and a super-admin keeps the bypass they already have everywhere else. A scoped API key is judged on its own read grant rather than on the permissions of the account that issued it, so a read-only key issued by an administrator is no longer treated as that administrator's full session.

  If you configured a read rule expecting it to be enforced, this closes that gap. If instead something in your app depended on reads returning unfiltered data, it will now see only the rows its rule allows: check any integration that reads with a user session or API key against a collection whose read rule is not `public`.

- [#356](https://github.com/nextlyhq/nextly/pull/356) [`a24c17e`](https://github.com/nextlyhq/nextly/commit/a24c17ef1d5dfaac61eae93fbe21da273e2565a4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - REST reads now default to published-only. A list, get, or count request to a Draft/Published collection or single with no `?status=` returns only published entries; pass `?status=all` or `?status=draft` to include drafts (subject to your read access rules). Previously these reads defaulted to returning every status, which could expose drafts to any caller.

  An invalid `?status=` value (for example a typo like `?status=pubished`) is now rejected with a 400 instead of being silently treated as "all", so a malformed filter can never widen a read. Trusted server-side Direct API calls are unchanged (they still see every status). The admin panel already requests every status, so editors continue to see their drafts.

- [#338](https://github.com/nextlyhq/nextly/pull/338) [`1687ff1`](https://github.com/nextlyhq/nextly/commit/1687ff1af20e02ee201f241dd231775082a44779) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read rules on Singles now apply over the REST API. A Single's stored read rule was enforced on every update and inside the Direct API, but reading the document over HTTP skipped it entirely, so a Single you restricted to a role was still returned in full to any caller who could reach the endpoint. Reads now evaluate the caller against the rule you configured, and a Single's related rows are redacted by the field rules of the collection they come from. Relationships reached through an embedded component are not yet covered.

  A scoped API key is judged on its own read grant rather than on the permissions of the account that issued it, and super-admins keep the bypass they have everywhere else.

  An `owner-only` read is judged against the document itself, since a Single has no list query to fold an ownership filter into.

  **`custom` read rules on Singles are not enforced by this change.** A custom function may return a query constraint, which a list read compiles into SQL; applying that to a single document would mean re-implementing the filter grammar, so it is left as it behaves today rather than partly applied. `public`, `authenticated`, `role-based` and `owner-only` read rules are all enforced. That rule reports "allowed" for any authenticated caller and hands back the predicate a list query would have filtered by, which a Single has no list to apply, so the predicate is checked against the row instead.

  **The standalone `nextly/api/singles-detail` GET route is deliberately public and does not authenticate.** A Single with no read rule stays publicly readable there, exactly as before. A Single you restrict is no longer served by that route at all, including to callers the rule would admit, because the route has no caller to evaluate. Read restricted Singles through the authenticated API instead.

  If you configured a read rule on a Single expecting it to be enforced, this closes that gap. If something in your app read a restricted Single over HTTP and depended on getting it, that call will now be denied: give the caller a role the rule admits, or read it through the Direct API, which is trusted by default.

- [#353](https://github.com/nextlyhq/nextly/pull/353) [`48f82a8`](https://github.com/nextlyhq/nextly/commit/48f82a83a66eb9777364d5d9b0d8947c2bde767a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - nextly now exports `buildMetadata` from `nextly/runtime`: it maps a content entry's SEO field group (from `@nextlyhq/plugin-seo`) to a Next.js `Metadata` object, so a page's `generateMetadata` becomes a single call instead of a hand-written mapping. It sets the title, description, canonical, OpenGraph, Twitter card, robots (from `noindex`), and hreflang alternates, with per-call fallbacks for blank fields. The `next` dependency is type-only, so importing it never forces `next` at load.

- [#349](https://github.com/nextlyhq/nextly/pull/349) [`9cab18c`](https://github.com/nextlyhq/nextly/commit/9cab18c499e9f42e1a1d9de3abb538f84a555436) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the first-party @nextlyhq/plugin-seo package. Register it in your config to add an SEO field group (title, description, OG image, canonical, noindex) to the collections you name. It is opt-in and framework-agnostic (no Next.js dependency), so it is safe in headless and admin-only projects.

  The plugin SDK now also re-exports the field-authoring factories (`text`, `textarea`, `checkbox`, `upload`, `group`) and the `FieldConfig` type, so plugin authors get the whole authoring surface from `@nextlyhq/plugin-sdk`.

- [#340](https://github.com/nextlyhq/nextly/pull/340) [`3d48019`](https://github.com/nextlyhq/nextly/commit/3d480190946cb0342ae425dab07093e45d97d169) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fixed a dev-mode gap where setting a collection or single to `webhooks: false` did not take effect if the same config reload also hit a schema error (for example a transient database blip during introspection, or a change awaiting confirmation). The recording opt-out is now applied up front, so a newly private entity stops recording immediately even when the rest of the reload is deferred; re-enabling recording still waits for a clean schema sync.

- [#341](https://github.com/nextlyhq/nextly/pull/341) [`a98cdcf`](https://github.com/nextlyhq/nextly/commit/a98cdcf25e2299ba6a4855656018639e01573e19) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fixed webhook-outbox retention not running after a Single update that opts out of both recording (`webhooks: false`) and cache revalidation (`revalidate: { disable: true }`) when a post-commit hook then fails. The Single write result now carries an explicit committed-write signal, matching the collection path, so the write-path cleanup runs for every durable write on installs without a scheduled webhook drain.

- [#342](https://github.com/nextlyhq/nextly/pull/342) [`f0b4fc3`](https://github.com/nextlyhq/nextly/commit/f0b4fc3e33b2d1f407e6c9ebf130d49c2b8efa4b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single that opts out of webhook recording (`webhooks: false`) no longer assembles its webhook payload on update. Previously the previous/next event documents were built (reading every component subtree) before the opt-out was checked, so a scalar update to an opted-out Single still performed webhook-only component reads and could fail on a missing or stale component table. The opt-out is now resolved before any payload assembly.

- [#345](https://github.com/nextlyhq/nextly/pull/345) [`38d50d0`](https://github.com/nextlyhq/nextly/commit/38d50d027bbbe56bf277eddb69dc5abf4edced60) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection status webhook events now fire. Publishing an entry delivers `entry.published` (and the generic `entry.status_changed`); unpublishing delivers `entry.unpublished` (and `entry.status_changed`); any other status change delivers `entry.status_changed`. A create-as-published delivers `entry.created` + `entry.published`. Per-locale status changes on a localized collection are tagged with their locale. Every status event carries an explicit `statusChange: { from, to }`. Only Draft/Published collections emit these, and collections that opt out of recording (`webhooks: false`) emit none. Previously these event types were subscribable in the admin UI but never fired.

## 0.0.2-alpha.41

### Patch Changes

- [#328](https://github.com/nextlyhq/nextly/pull/328) [`a4f503d`](https://github.com/nextlyhq/nextly/commit/a4f503d55c253090acc1d6f56323e6be08411549) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` now provides `defineBlock` for declaring a block type — its props, default styles, child slots, style capabilities, and how it renders — plus the registry that collects them when an app boots. Mistakes are caught at startup with a clear message instead of surfacing as broken pages: a duplicate block name names both sources, and bumping a block's version without providing the matching upgrade step is refused outright. Third parties can add new style capabilities through `registerSupport`.

## 0.0.2-alpha.40

### Patch Changes

- [#325](https://github.com/nextlyhq/nextly/pull/325) [`823950b`](https://github.com/nextlyhq/nextly/commit/823950baac1c7302a53b9ca799b6ff517a36b9d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` can now upgrade page documents when a block's schema changes. Blocks that were saved against an older version are automatically brought up to date, one version step at a time, so old pages keep working after a block is improved. If a step is missing or fails, that block keeps its last-good content and is marked so the page shows a placeholder for it instead of breaking, and the failure is reported to the caller.

- [#320](https://github.com/nextlyhq/nextly/pull/320) [`17819aa`](https://github.com/nextlyhq/nextly/commit/17819aaf1642b63c2bc7042e451eef9219275063) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New package `@nextlyhq/blocks-engine`: the foundation of the rebuilt page builder. It ships the stored document format (pages as a plain list of blocks with typed styles, data bindings, visibility rules, and locale-overlay support) plus the pure tree operations editors and tools build on. It is dependency-free and works in any JavaScript runtime, so page documents can be created and edited outside the admin too.

- [#324](https://github.com/nextlyhq/nextly/pull/324) [`a4c38ec`](https://github.com/nextlyhq/nextly/commit/a4c38ec6475299e1a6d2d6c39cb24326706f5474) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` now validates page documents and reports problems in a machine-readable form. Each issue carries a precise location in the document, a stable code, and a suggested fix, so tools and AI agents can pinpoint and repair exactly what is wrong. Validation runs in a strict mode (used when publishing, where unknown blocks or missing breakpoints are errors) or a forgiving mode (used when rendering, where those become warnings so a page still displays what it can).
