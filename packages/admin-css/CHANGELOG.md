# @nextlyhq/admin-css

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

- [#289](https://github.com/nextlyhq/nextly/pull/289) [`d7327c4`](https://github.com/nextlyhq/nextly/commit/d7327c47190158a0ba7087bba1b4a6db8ac4de0a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin hides publish controls a user is not permitted to use.

  The Publish and Unpublish buttons on the entry editor, and the bulk Publish /
  Unpublish actions in the entry list, now appear only when the current user holds
  the matching permission. An author who may edit but not publish sees Save Draft
  and no Publish button, mirroring what the server allows.

- [#315](https://github.com/nextlyhq/nextly/pull/315) [`10aa0bf`](https://github.com/nextlyhq/nextly/commit/10aa0bf45dd5cc0e410156245a2c3ce1af60c263) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a webhook delivery log to the admin panel. Each endpoint now has a
  Deliveries view listing its past delivery attempts with status, event type,
  response code, and latency, filterable by status and event type. A dedicated
  detail page shows a delivery's full attempt timeline, the last response
  snippet, and a Redeliver action, and the list offers a "Process queue now"
  action to drain pending deliveries on demand.

- [#313](https://github.com/nextlyhq/nextly/pull/313) [`6ef1056`](https://github.com/nextlyhq/nextly/commit/6ef1056a1697beaef56d2cf0be2042a657879a18) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Manage webhook endpoints from the admin panel, under Settings → Webhooks.

  Create an endpoint by naming it, giving it an HTTPS URL, choosing the events it
  receives (any of the content, media, user, and form events, or "all events"),
  and optionally adding static headers. The signing secret is shown once on
  creation and is never included in a normal read or list, but it can be
  retrieved later through the endpoint's privileged "Reveal signing secret"
  action. Endpoints can be edited, enabled or
  disabled, and deleted; deleting one stops its deliveries and clears its secret
  while keeping its delivery history.

  A "Send test event" action posts a signed ping to the endpoint and reports
  whether it was reachable and accepted, so a receiver can be verified before it
  is relied on. Header values are never displayed after they are set (they read
  back hidden), so the form keeps them untouched unless you deliberately re-enter
  the full set.

- [#325](https://github.com/nextlyhq/nextly/pull/325) [`823950b`](https://github.com/nextlyhq/nextly/commit/823950baac1c7302a53b9ca799b6ff517a36b9d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` can now upgrade page documents when a block's schema changes. Blocks that were saved against an older version are automatically brought up to date, one version step at a time, so old pages keep working after a block is improved. If a step is missing or fails, that block keeps its last-good content and is marked so the page shows a placeholder for it instead of breaking, and the failure is reported to the caller.

- [#320](https://github.com/nextlyhq/nextly/pull/320) [`17819aa`](https://github.com/nextlyhq/nextly/commit/17819aaf1642b63c2bc7042e451eef9219275063) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New package `@nextlyhq/blocks-engine`: the foundation of the rebuilt page builder. It ships the stored document format (pages as a plain list of blocks with typed styles, data bindings, visibility rules, and locale-overlay support) plus the pure tree operations editors and tools build on. It is dependency-free and works in any JavaScript runtime, so page documents can be created and edited outside the admin too.

- [#324](https://github.com/nextlyhq/nextly/pull/324) [`a4c38ec`](https://github.com/nextlyhq/nextly/commit/a4c38ec6475299e1a6d2d6c39cb24326706f5474) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` now validates page documents and reports problems in a machine-readable form. Each issue carries a precise location in the document, a stable code, and a suggested fix, so tools and AI agents can pinpoint and repair exactly what is wrong. Validation runs in a strict mode (used when publishing, where unknown blocks or missing breakpoints are errors) or a forgiving mode (used when rendering, where those become warnings so a page still displays what it can).

- [#314](https://github.com/nextlyhq/nextly/pull/314) [`0c69c65`](https://github.com/nextlyhq/nextly/commit/0c69c65228c1b36022278b2c0f4e3c027ce64cba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the cache-revalidation tag scheme and a `revalidate` config option.

  Collections and singles now accept a typed `revalidate?: { tags?, disable? }`
  option (replacing the untyped `custom.revalidateTags` convention), and the core
  computes the `nextly:*` cache tags a content change invalidates (collection, id,
  id+locale, and slug, busting the previous slug too on a rename). Tags are the
  framework-neutral foundation for on-publish revalidation; the write-path wiring
  and the Next cache adapter that flushes them follow.

- [#316](https://github.com/nextlyhq/nextly/pull/316) [`fbe4f7d`](https://github.com/nextlyhq/nextly/commit/fbe4f7dab2acd5ddc52308919cb22e8806beb293) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bust cache tags on every content write.

  Each collection create, update, publish/unpublish, and delete — and each single
  write — now computes the cache tags it invalidates and flushes them after the
  transaction commits, through a registered cache revalidator (a no-op until a Next
  cache adapter is present). A rename busts both the old and new slug tags, a delete
  busts the collection and entry-id tags, and a write that records nothing (a
  rejected or no-op write) busts nothing. Bulk operations aggregate their items'
  tags and flush them once. This wires the tag scheme added previously to the write
  path; the read-side helpers and the Next cache adapter that turns the tags into
  `revalidateTag` calls follow.

- [#312](https://github.com/nextlyhq/nextly/pull/312) [`5d09cbd`](https://github.com/nextlyhq/nextly/commit/5d09cbdea55e4f7ef2a04b61147486f79e584632) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bind localized companion schema loading to the caller's transaction.

  Deleting or updating a row in a localized collection assembles its document
  from the companion `<table>_locales` table, which loads that companion's
  runtime schema. That metadata read previously went back to the connection pool
  even when the write ran inside a caller-owned transaction, so on a small or
  exhausted pool it could stall the write while the transaction held the only
  connection. The companion schema load now runs on the transaction's own
  connection, completing the transaction-bound write path for localized content.

- [#253](https://github.com/nextlyhq/nextly/pull/253) [`fc1cc41`](https://github.com/nextlyhq/nextly/commit/fc1cc41709f8d3a3ed6e413da851b5d31a99a7be) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix entry-saving and migration table-naming issues.
  - Optional fields (email, length-limited text, multi-select, and similar) no longer block saving an entry when left blank — their validators now run only on a typed value.
  - Multi-value (`hasMany`) select fields now render as a real multi-select and can be saved from the admin, instead of being rejected as "expected array, received string".
  - `nextly migrate:create` and `migrate:check` now name plugin collection tables with the same `dc_` prefix the runtime uses (for example `dc_forms`), so generated migrations match the live database.
  - Number fields inside a component now use the same column type as number fields in collections — integer by default, an exact decimal for `dbType: "decimal"` — instead of always being stored as a floating-point column.
  - On SQLite, changing a column between numeric types (for example real to integer) no longer reports a false "data loss" warning; values are preserved, and cross-type changes such as text to integer still warn.
  - An optional field left blank is now saved as an empty (`NULL`) value rather than an empty string, so an optional unique field no longer rejects the second entry that leaves it blank. Password fields are exempt: a blank password still means "keep the current one".
  - A multi-value select declared with an array default (`defaultValue: ["web", "retail"]`) now starts with those options selected, instead of rendering one unusable entry and failing validation. Multi-value selects on singles now start empty rather than invalid.
  - Saving a collection in the Schema Builder no longer alters tables defined in `nextly.config.ts` or contributed by a plugin. Those tables are owned by your config and are reconciled from it, so a visual edit can only change the entity you are editing — on SQLite and MySQL as well as PostgreSQL.
  - Float number fields in a component now use the same PostgreSQL column type (`double precision`) as the runtime and generated schema, instead of `real`, which left the table permanently out of sync with the desired schema.
  - Changing a component number field's storage (`dbType`, `precision` or `scale`) now alters the column instead of being treated as no change and leaving the old type in place.
  - A component declaring a custom `dbName` is no longer queued for a redundant table sync on every startup.

- [#303](https://github.com/nextlyhq/nextly/pull/303) [`7e35933`](https://github.com/nextlyhq/nextly/commit/7e35933e51d0d0a8ec2b0834443efc2ea896db13) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Enabling localization while adding a translatable field in the same save no longer fails.

  When a field is added and localized in one save, it is (correctly) kept off the main table and lives only in the companion `_locales` table. The companion enable migration seeded the new companion from the main table with `SELECT <all localized columns> FROM <main>` and then dropped those columns, but a field added in the same save was never on the main table, so the seed failed with `column "..." does not exist` and, on singles and components, the whole apply returned 500.

  The enable migration now seeds and drops only the localized columns that already exist on the main table (fields present before this save). A field localized on creation still gets its companion column; it simply has no existing data to copy and nothing to drop.

  Listing entries no longer fails after localization is toggled on for an existing collection. Enabling localization moves translatable columns off the main table, and the entry list reads its columns from the file manager's schema cache. The metadata update path refreshed only the adapter's CRUD schema, leaving that read cache holding the pre-toggle table, so the list query selected a column the table no longer had. The metadata path now refreshes the read cache as well, matching the schema-apply path.

- [#322](https://github.com/nextlyhq/nextly/pull/322) [`6877938`](https://github.com/nextlyhq/nextly/commit/6877938aee3a75ccb1795fee023c636ad12a979e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Cache revalidation now covers every localized URL.

  For a localized collection whose `slug` differs per language, publishing all locales or deleting an entry now busts every locale's page, not just the default one.

- [#318](https://github.com/nextlyhq/nextly/pull/318) [`81c5c1e`](https://github.com/nextlyhq/nextly/commit/81c5c1ed4bf716cc3752dd414c0d4a0ab80474e4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix three content-integrity edge cases.
  - Media focal-point crop regeneration no longer deletes an image's old size
    variants before the row commits. New variants are written to fresh keys, the
    row is committed pointing at them, and the superseded old files are deleted
    only afterwards — so a failed or lost-race write can no longer leave a media
    item referencing files that were already deleted.
  - A localized single's translatable field defaults (including a localized
    title/slug) are now seeded onto its default-locale companion row when the
    single is auto-created, instead of resolving to null until first written.
  - Turning on Draft/Published for an already-localized entity now back-fills the
    default-locale companion status from the main row, so a later publish of the
    default locale is recognized as a real transition (and fires its webhook)
    rather than a no-op against a status that was wrongly reset to draft.

- [#309](https://github.com/nextlyhq/nextly/pull/309) [`c3bd115`](https://github.com/nextlyhq/nextly/commit/c3bd115d10529a80b3bb625823c16063f52a786c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Harden the publish/unpublish permission gate for two edge cases.

  A write that carries an explicit `status: undefined` (something a Direct API
  call, a Server Action, or a hook can produce, though JSON REST cannot) no longer
  silently unpublishes a published entry or single. That value means "no status
  change", so it is dropped before the write instead of being sanitized to a
  database `NULL` that moved the row out of published without the publish gate.

  Writes performed inside a caller-owned transaction (the transactional bulk and
  single-entry create/update paths) now run every read on that transaction's own
  database connection. Previously the publish/unpublish permission check, the
  collection metadata and owner-constraint reads, and the built-in sanitization
  hook's field-metadata read all went back to the connection pool from inside the
  transaction, which could stall the write against a small or exhausted pool while
  the transaction held the only connection.

- [#290](https://github.com/nextlyhq/nextly/pull/290) [`877f8f8`](https://github.com/nextlyhq/nextly/commit/877f8f871b0c5997e58dbddfa7c589e66299fc62) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing and unpublishing content are now first-class permissions, enforced
  concurrency-safely across every write surface for both collections and singles.

  Moving a document into or out of `published` requires `publish-<slug>` /
  `unpublish-<slug>` on top of the write permission, so editing and publishing are
  separate capabilities. The transition is classified against the status read
  under the write's row lock (not a read taken before the transaction), closing
  the race where a concurrent writer could move a row into or out of published and
  slip a transition past the gate; this holds for single, batch, transactional,
  and by-query writes, and for a localized document's per-locale companion status.
  A scoped API key is judged on its own stamped grants rather than the key owner's
  permissions on every write path (create, update, publish/unpublish, duplicate,
  delete, bulk, and version-label edits), and a document-dependent (owner-only or
  custom) transition rule is re-evaluated against the row-locked document. An
  unauthenticated caller can no longer publish a publicly-writable collection or
  single unless an explicit rule allows it.

- [#286](https://github.com/nextlyhq/nextly/pull/286) [`07662f3`](https://github.com/nextlyhq/nextly/commit/07662f3e8413c9162f896d133185a6f4401b5954) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection and single slugs that collide with a system resource are refused.

  Permission identity is `action-resource`, so a content type named after a system resource is granted the same permission rows that resource's routes check. A `webhooks` type reaches the endpoint routes and their signing secrets; a `settings` type reaches the user-fields and component admin surfaces (gated on `{action, "settings"}`, not only `manage`); a `media` type reaches the media routes. Every system resource has such a route, so any system-resource name — `users`, `roles`, `permissions`, `media`, `settings`, `email-providers`, `email-templates`, `api-keys`, `webhooks` — is now rejected as a collection or single slug.

  The check is enforced at every slug-assignment path: code-first validation, the shared collection/single registry guard (create and rename), the Schema Builder's collection registry, and the migration-snapshot boot path (which skips a reserved name rather than replaying it). Components are not restricted, because a component definition does not seed a permission under its own slug.

  An installation that already has a collection or single named one of these must rename it before upgrading.

- [#300](https://github.com/nextlyhq/nextly/pull/300) [`1866e2b`](https://github.com/nextlyhq/nextly/commit/1866e2bd179dd6621d6f79c2102b2d3f01f28c51) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deliver webhooks immediately after a content write instead of waiting for the
  next scheduled drain.

  After a write records an event, Nextly now schedules a bounded delivery pass via
  Next.js `after()`, so the first attempt runs as soon as the response is sent —
  without adding any latency to the write. It degrades gracefully: it does nothing
  when there are no enabled endpoints, when the runtime has no `after()` (Next 14,
  or a non-Next context like the CLI), or on any failure — the scheduled
  `/webhooks/drain` trigger remains the backstop and owns retries and the backlog.

- [#288](https://github.com/nextlyhq/nextly/pull/288) [`0473b28`](https://github.com/nextlyhq/nextly/commit/0473b286cc01b5381a77ea12a2a38556932232ab) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a webhook endpoint keeps its delivery history.

  Deleting an endpoint used to remove its delivery log with it, because the delivery table's foreign key cascaded. The record of what was sent to an integration is often wanted right after it is torn down, which is exactly when it used to disappear.

  Deleting now retires the endpoint instead of removing it: the row is kept and stamped as deleted, so it vanishes from every read and stops receiving deliveries, but the delivery ledger keeps a real endpoint on the other end of its link. Disabling is still the way to pause an endpoint you mean to bring back; deleting is for one you are finished with but whose record still matters. A retired endpoint is never resurrected, and its outstanding deliveries are ended the same way disabling ends them.

- [#295](https://github.com/nextlyhq/nextly/pull/295) [`d5a2776`](https://github.com/nextlyhq/nextly/commit/d5a277682a00119cc09aed4f6af093a6f5526e7f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read a webhook endpoint's delivery log over the REST API.

  Two new read-only routes back the admin delivery viewer:
  - `GET /api/webhooks/:id/deliveries` — a paged, newest-first list of an
    endpoint's deliveries (joined to their event for type and resource), with
    optional `status` and `eventType` filters.
  - `GET /api/webhooks/:id/deliveries/:deliveryId` — one delivery with its full
    attempt history and last response snippet.

  Both require `read-webhooks`. Deliveries are scoped by endpoint id and remain
  readable after an endpoint is retired, so its history is not lost. The delivery
  record stores only retry state, status/latency/error, a response snippet, and a
  per-attempt log — never the request headers sent — so this surface cannot leak a
  receiver credential.

- [#296](https://github.com/nextlyhq/nextly/pull/296) [`b1faff4`](https://github.com/nextlyhq/nextly/commit/b1faff4ec73cc8e8d8802df995edaad14d47b501) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fire due webhook deliveries with a drain trigger.

  Adds a `webhooks/drain` route (GET or POST): one request fans out due events
  into deliveries and attempts them, so a scheduler (e.g. Vercel Cron, which
  triggers with a GET) can drive delivery and retries. Until now the delivery
  engine had no production trigger and the event outbox accumulated rows nothing
  sent. The route resolves under wherever you mount the Nextly catch-all handler;
  in the generated app templates that is `/admin/api`, so the scheduler should hit
  `/admin/api/webhooks/drain`. Each invocation does a bounded slice of work and the
  next tick continues, so it stays within a serverless execution limit.

  The route is authorized by a shared secret presented as a bearer token
  (constant-time compare) — either `NEXTLY_DRAIN_SECRET` or Vercel's `CRON_SECRET`
  — OR by an authenticated admin/API-key caller with `update-webhooks`. The
  endpoint registry is now a shared singleton, so a change made through the webhook
  admin API invalidates the same cache a running drain reads instead of waiting for
  a per-drain cache to expire.

- [#298](https://github.com/nextlyhq/nextly/pull/298) [`285cd1e`](https://github.com/nextlyhq/nextly/commit/285cd1ef1073f0135dfba8bfde9bd2218bacf0c5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit an `entry.deleted` webhook event when a collection entry is deleted.

  Deleting an entry now records a durable outbox event carrying the removed
  document in the same read shape the `entry.created`/`entry.updated` events use —
  component subtrees, many-to-many ids, and localized companion values populated,
  password and hidden fields stripped — so a subscriber sees a consistent payload
  for every lifecycle event, including on localized collections. The delete and
  its event run in one transaction (the event never fires for a deletion that
  rolled back), and the row is locked and re-read inside that transaction so two
  concurrent deletes cannot both emit — only the delete that actually removed the
  row records the event. The event is attributed to the acting identity (user or
  API key), for single and bulk deletes alike.

- [#307](https://github.com/nextlyhq/nextly/pull/307) [`6841fb7`](https://github.com/nextlyhq/nextly/commit/6841fb7266a6126516a025a59c48c23064695f61) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit webhook events when media changes.

  Uploading, editing, or deleting a media item now records a `media.uploaded`,
  `media.updated`, or `media.deleted` event in the outbox, attributed to the
  acting user or API key, so webhook subscribers are notified of media changes.
  The event is written in the same transaction as the media row, and physical
  file storage is touched outside that transaction (and, for deletes, only after
  it commits) so a failed event never leaves the database and the stored file out
  of sync.

- [#319](https://github.com/nextlyhq/nextly/pull/319) [`0fea8ba`](https://github.com/nextlyhq/nextly/commit/0fea8baecba81254bebb4fc2f5c51ae718e3286c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix the webhook endpoint edit page crashing with "Cannot read properties of
  undefined (reading 'some')" when the endpoint summary arrives without the
  `secrets` lifecycle field (for example an admin bundle newer than the backend it
  is talking to). The signing-secrets panel now degrades to an empty state instead
  of throwing.

- [#317](https://github.com/nextlyhq/nextly/pull/317) [`0cabdc4`](https://github.com/nextlyhq/nextly/commit/0cabdc44fec22cd871a0b2d4ea9839fab51f1f99) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add webhook signing-secret rotation with a configurable overlap window. An
  endpoint's secret can now be rotated from the admin: a fresh secret becomes the
  primary and the previous one keeps signing for a chosen window (immediately,
  24h, 48h — the default, 7d, or 30d) so a receiver can switch over without
  dropping a delivery. Deliveries in the window carry a signature for both
  secrets, and the old one can be expired early. The endpoint edit page shows each
  active secret's lifecycle.

- [#301](https://github.com/nextlyhq/nextly/pull/301) [`affb839`](https://github.com/nextlyhq/nextly/commit/affb839de05482b96b966f2874187dd514c73e27) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit webhook events when a Single changes.

  Updating a Single now records a `single.updated` event carrying the written
  document and its prior state, and a status change additionally records
  `single.published` or `single.unpublished` — so a publish delivers both
  `single.updated` and `single.published`, and a consumer can subscribe to
  whichever it needs. Events fire whether or not the Single has versioning
  enabled, name the locale for a per-language write, and never carry secret
  field values.

- [#310](https://github.com/nextlyhq/nextly/pull/310) [`93cb39f`](https://github.com/nextlyhq/nextly/commit/93cb39ff9dac131a62b6bfee561e1148c9282651) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Test a webhook endpoint and re-send a past delivery over the REST API.

  `POST /api/webhooks/:id/test` sends a signed synthetic ping to the endpoint and
  reports whether it was reachable and accepted (status, latency, response
  snippet), so a receiver can be verified — before or after it is enabled —
  without producing a real event: the test writes nothing to the outbox or the
  delivery log.

  `POST /api/webhooks/:id/deliveries/:deliveryId/redeliver` re-attempts a specific
  past delivery from its stored event payload. The existing delivery row is
  re-armed for another attempt (its retry budget reset, its attempt history kept)
  under a row lock so a delivery that is still being sent is reported as a conflict
  rather than sent twice, and the drain is nudged so it goes out promptly; the
  outcome then shows in the delivery log. An unknown delivery or endpoint id is a
  not-found, while a delivery on a disabled or deleted endpoint is a conflict. Both
  actions require the webhook update permission and an interactive session.

- [#294](https://github.com/nextlyhq/nextly/pull/294) [`53bc7e2`](https://github.com/nextlyhq/nextly/commit/53bc7e2de89b6078b31a771cca2398cbf4a96aa0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook endpoints can subscribe to all events with a wildcard.

  An endpoint's `eventTypes` now accepts `"*"`, meaning it receives every event
  type, including event types added in future versions, without a config edit. The
  wildcard must be used on its own; combining it with specific types is rejected,
  since it already covers them. Fan-out treats a wildcard subscription as matching
  any event type while still honoring the endpoint's enabled state and filter.

## 0.0.2-alpha.39

### Patch Changes

- [#269](https://github.com/nextlyhq/nextly/pull/269) [`091ec3a`](https://github.com/nextlyhq/nextly/commit/091ec3a39f3c01621c8a01dfea61b05a7ae689f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` now works on PostgreSQL.

  Nextly compares the database it finds against the schema it expects, and refuses to continue if the difference looks like it could destroy data. One comparison was wrong: a column holding a list of values, such as the tags on a media item, was described as a plain value on one side and as a list on the other. Nextly read that as someone having changed the column's type, treated it as destructive, and stopped.

  Because the check runs before anything else, this blocked the whole command on every PostgreSQL project, including a database Nextly itself had just created. The only documented way past it was a flag that permits destructive changes, which in this case would have rewritten the column and lost the values in it.

- [#270](https://github.com/nextlyhq/nextly/pull/270) [`6126db4`](https://github.com/nextlyhq/nextly/commit/6126db4a7ef4afd9ba07146e604168d28d8d22e9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Security events are recorded again.

  The audit log stores failed sign-in attempts, rejected requests, and account changes such as a password being changed or a role being assigned. Events that carry extra detail, such as a rejected request or a failed sign-in, were being dropped on SQLite: the detail is stored as text there but as a structured value on PostgreSQL and MySQL, and the wrong one was being sent. The write failed, and because a failed audit write is deliberately not allowed to interrupt whatever the user was doing, nothing surfaced.

  The effect was a log that looked healthy while missing exactly the entries worth reading. Routine events carry no detail and were saved normally; failed sign-ins and rejected requests carry detail and were not. Anyone reviewing that log after a suspicious event would have seen ordinary account activity and no sign of the attempt.

- [#266](https://github.com/nextlyhq/nextly/pull/266) [`fe6734f`](https://github.com/nextlyhq/nextly/commit/fe6734fec8772d8cf012598f8abce839dbc29945) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - CLI commands now explain why they failed.

  Errors carry two messages: a safe one for the browser and a detailed one for whoever is running the code. The CLI was printing the safe one, so a failed `nextly db:sync` said only "An unexpected error occurred." with no table, no query and no cause. The same command now reports the failing query and the database's own explanation, for example `no such column: "localized"`, which is usually the whole answer. Full stack traces remain behind `DEBUG=1`.

  A crash inside Nextly is also no longer reported as a validation error. Creating or updating a collection returned HTTP 400 "Validation failed" when the real cause was a defect in Nextly itself, sending people to search their own payload for a problem that was never there. Those now return 500, so the two cases can be told apart.

- [#277](https://github.com/nextlyhq/nextly/pull/277) [`37c221f`](https://github.com/nextlyhq/nextly/commit/37c221f9159745d9fd70f7e004c54011d561bbe6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema reconcile now converges, and SQLite no longer loses indexes when a table changes.

  Four faults compounded into one. Comparing a primary key's nullability produced a change no `ALTER` can make on SQLite, so it was proposed forever. Comparing a string default compared `'pending'` against `pending`, so every string-defaulted column looked changed, on every dialect. Both kept the reconcile from ever seeing a clean database, and each unnecessary change rebuilt the table — which on SQLite drops its indexes, because the rebuild creates a new table from a schema that never declared them. `nextly_i18n_archive` completed the set: it was declared in the schema the diff reads but missing from the map the apply pushes, so it was proposed on every run and created by none.

  On a real database this took a reconcile from 45 proposed operations to 1, and from 23 to 9 on an older one, where the remainder is the genuine upgrade. Indexes declared for a collection are now re-asserted in the same transaction as the change, so a table cannot commit without them.

- [#267](https://github.com/nextlyhq/nextly/pull/267) [`7811af8`](https://github.com/nextlyhq/nextly/commit/7811af8c1a031b982d728aa1e895c089c14852fd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly db:sync` no longer proposes deleting collections, singles, or components you built in the Schema Builder.

  Content types reach the database two ways: written in `nextly.config.ts`, or created through the Schema Builder, which stores them in the database only. `db:sync` worked out the intended schema from the config file alone, so anything built in the Schema Builder was invisible to it. On SQLite and MySQL the comparison covers the whole database, so those tables were treated as leftovers and lined up to be dropped. The dev server already merged them back in; both now share one implementation of that rule, so they cannot disagree again. If the registry cannot be read, the sync continues with what the config describes and says plainly that Schema Builder content may be flagged.

- [#287](https://github.com/nextlyhq/nextly/pull/287) [`72b0fdf`](https://github.com/nextlyhq/nextly/commit/72b0fdff56e56189390fd82326df2c601d4f7c6a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The access layer now understands publish and unpublish as operations.

  A collection or single may carry an access rule for `publish` and `unpublish`
  the same way it does for `create` or `update`, and the RBAC check accepts them.
  Nothing enforces them on a write yet; this makes the checks expressible so the
  next release can gate publishing on them.

- [#285](https://github.com/nextlyhq/nextly/pull/285) [`32a0475`](https://github.com/nextlyhq/nextly/commit/32a04754d3e017052643abc3084431574106ee0e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing is now its own permission, separate from editing.

  Every collection and single now seeds `publish` and `unpublish` permissions
  alongside its CRUD ones, and the built-in roles use them: an Editor may publish,
  an Author may write but not publish or take content down, and a Viewer may do
  neither. Nothing is enforced by them yet — this release only creates the
  permissions and assigns them, so existing setups behave exactly as before.

- [#271](https://github.com/nextlyhq/nextly/pull/271) [`89649f8`](https://github.com/nextlyhq/nextly/commit/89649f87de815ce7aa69453c0a6e88534fa3d871) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Nextly now tells you when your database is behind the code.

  Nextly's own tables are created the first time it connects to a database and are not changed after that. When a new version expects a column those tables do not have, nothing added it, and nothing said so: the mismatch surfaced later as an unrelated-looking failure, or as a feature that quietly stopped working, because some of them catch their own errors and carry on.

  Startup now compares the tables it finds against the ones this version expects and, if anything is missing, prints which tables and which columns, along with the command to fix it. It does not change your database; upgrades stay something you run deliberately. A database that is already up to date prints nothing and the check costs a few milliseconds.

- [#273](https://github.com/nextlyhq/nextly/pull/273) [`ec7eeb1`](https://github.com/nextlyhq/nextly/commit/ec7eeb1e68d055a8c88904ab824e7335603fe48b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` no longer refuses on SQLite.

  SQLite reports a text primary key as accepting empty values, because only integer primary keys are automatically required. Nextly's own schema treats every primary key as required, so the two descriptions disagreed on every table, and Nextly read that as someone about to make an existing column required. That change can fail on rows already stored, so it is treated as unsafe and the whole command stops.

  The result was that upgrading a SQLite database was blocked by the very columns Nextly created itself, and `nextly migrate` is the documented way to bring a database up to date, so the only route forward was closed.

- [#261](https://github.com/nextlyhq/nextly/pull/261) [`37495ce`](https://github.com/nextlyhq/nextly/commit/37495ce22a197862e3d57d2762bf3b7815111550) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a stylesheet for using the UI components inside an existing application.

  `@nextlyhq/ui` previously shipped one compiled stylesheet, and it styles the whole page: it includes Tailwind's preflight, which resets headings, lists, form controls and spacing document-wide. That is what a new app wants, and it is why the kit could not be dropped into an app that already has its own design — importing it restyled everything around the components.

  `@nextlyhq/ui/styles.scoped.css` confines every rule to a `.nextly-ui` wrapper, so the components still get the normalised baseline they are built against while the rest of the page keeps its own styling. Put the class on any element and everything inside it is styled; dark mode goes on the same element.

  Selectors are not the only way a stylesheet reaches outside itself, so the scoped sheet also namespaces the three things CSS resolves globally: animation names, so it cannot displace a `spin`, `pulse` or `fade-in` the host defines; Tailwind's internal `--tw-*` property registrations, which would otherwise change the meaning of those names across the whole host document; and the ancestor classes that `dark:` and `group-*:` variants look for, so a `dark` class higher up the host page no longer flips the components into dark utilities while their tokens stay light.

  Overlay components (Dialog, Select, DropdownMenu, Popover, Tooltip, Command) portal to `document.body`, which sits outside that wrapper, so the scoped sheet needs a `PortalProvider` pointing back inside it. The README shows the setup, and `PortalProvider` and `usePortalContainer` are now part of the stable surface because the scoped stylesheet cannot be used correctly without them.

  The plugin styling guide now also explains why a plugin compiles its own CSS ahead of time rather than relying on the host to scan it, and the README documents which of the three stylesheets to reach for.

- [#282](https://github.com/nextlyhq/nextly/pull/282) [`deb3806`](https://github.com/nextlyhq/nextly/commit/deb38068116dcb1fc586e2f95d889b448fc73ae1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Renaming a version now respects the document own access rules.

  A collection or Single can restrict who may edit a particular document, for
  example by allowing only its owner. Someone who could not edit the document
  itself was still able to rename entries in its history, because that check was
  never run on this path. It now is, for both collections and Singles.

- [#280](https://github.com/nextlyhq/nextly/pull/280) [`55c1eb6`](https://github.com/nextlyhq/nextly/commit/55c1eb63d4eae9318b2b43e268c8afe521740158) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Restoring a version now handles components embedded inside other components,
  and inside groups, repeaters and dynamic zones.

  A version records which component each of its values came from, so that
  restoring an old version after a field was pointed at a different component
  reports the mismatch instead of writing the old values into the new component.
  That record stopped at the top level: a component nested inside another one
  kept no such record, so the same restore could quietly put the wrong values in
  the wrong place.

  A nested component is now checked against the components its field allows, the
  same way a top-level one already was, so a restore reports the mismatch instead
  of writing the old values into the new component. The record itself is removed
  before the restore is written, so it stays part of the version history and
  never appears in the document.

- [#263](https://github.com/nextlyhq/nextly/pull/263) [`d398b16`](https://github.com/nextlyhq/nextly/commit/d398b163b7df0007db753c4beaedcfc99220f030) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now put a document back to an earlier version.

  Opening version history and previewing a version now offers a Restore action, behind a confirm that says what will happen. Restoring writes the document immediately and records the result as a new version, so nothing is lost and a restore made in error is undone by restoring again.

  Restore reuses the ordinary edit permission — anyone who can edit the document can restore it, and every restore records who did it and which version it came from. History rows now show that lineage, along with the language a version was captured in.

  Two limits are reported rather than hidden: values a version never stored, such as passwords, are left as they are; and if the schema has since dropped a field the version held, the restore says which fields it could not bring back.

- [#283](https://github.com/nextlyhq/nextly/pull/283) [`7e74c6e`](https://github.com/nextlyhq/nextly/commit/7e74c6efab9847c93a72b3aa7c21662642a038ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook endpoints can now be registered, changed, disabled, removed and managed over the REST API.

  The delivery engine, fan-out and signing were all built before anything could create an endpoint for them to act on — the only rows that ever reached the table were test fixtures. This adds the management layer they were waiting for and the routes that expose it: an endpoint carries a name, a target URL, the event types it subscribes to, and optional static headers, and it receives its own signing secret at creation.

  A URL is resolved and checked before it is stored, not only before it is called. Delivery already refuses private, loopback and cloud-metadata addresses, but that happens long after whoever typed the URL has moved on, so a mistake shows up as a silent, repeating delivery failure. Checking at registration turns it into an error that can still be corrected.

  Registering or changing an endpoint requires an interactive session and cannot be done with an API key. An endpoint names a URL the server will call and send content to, so it is both a request-forgery and an exfiltration primitive.

  Static header values are not returned when an endpoint is read. Delivery sends those headers verbatim, so they routinely carry a credential for the receiver, and handing that back to anyone allowed to view the configuration would leak it. The header names are still shown, and a write that echoes the placeholder back is rejected rather than stored.

  Reading a signing secret is a separate request that asks for the update permission rather than read. The secret is what proves a request came from this install, so a read-only role that could see it could forge traffic every receiver would trust.

  Disabling an endpoint is kept separate from deleting it. Only one of those is reversible, and an endpoint id tends to end up in someone else's configuration. Disabling also stops deliveries that were already queued: previously it only removed the endpoint from future fan-out, so a retry scheduled by an earlier failure, or an event that fanned out moments before, would keep being POSTed until it succeeded or ran out of attempts. Those deliveries are now ended rather than held, so re-enabling an endpoint does not release a burst of events its receiver has long since stopped expecting.

  Deleting an endpoint also discards its delivery history, because the delivery table's webhook foreign key cascades. Disabling is the option to reach for when the record of what was sent still matters.

  Static headers are checked when they are saved. A header name that is not a valid HTTP token, or a value containing a line break, can never be sent: the delivery path could not tell that apart from a network fault, so it treated it as temporary and retried an endpoint that could never succeed.

  `webhooks` is now a reserved collection slug. Permission identity is action plus resource, so a collection with that slug would have shared the exact permission rows the endpoint routes check, and a role granted the collection's `read-webhooks` could have read endpoint configuration while `update-webhooks` revealed signing secrets. An installation that already has a collection with this slug needs to rename it.

  Deliveries still need a trigger. Nothing runs the drain yet, so a registered endpoint will not receive anything until that lands.

- [#262](https://github.com/nextlyhq/nextly/pull/262) [`79ae48a`](https://github.com/nextlyhq/nextly/commit/79ae48a46c68827a152ca86033adf0c125de22cc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Recorded webhook events are now cleaned up automatically.

  Every content change records an event, including in projects that have not set up any webhooks, so that table would otherwise grow for as long as the project is edited. Events are now removed once they are old enough and nothing is still waiting to deliver them, and delivery attempts are removed sooner than the events they belong to. Cleanup runs when webhooks are processed and, for projects that never process any, alongside ordinary content saves, so it does not depend on a scheduled job. It is bounded, so no single save waits on a large cleanup, and a cleanup that fails can never fail the save it followed.

  How long to keep everything is configurable under `webhooks.retention`, in milliseconds, with `false` anywhere meaning keep forever. Events are kept 30 days by default and delivery attempts 7 days. Events also carry a retention class, so the ones a future audit log depends on can be kept for a year while the rest are cleaned up in days.

- [#281](https://github.com/nextlyhq/nextly/pull/281) [`d13ec0e`](https://github.com/nextlyhq/nextly/commit/d13ec0e60249b8e511beabf7612bacf995c60dc9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook signing secrets can now be generated and stored encrypted.

  Delivery signs each request with the endpoint's secret, but nothing could produce one: there was no generator, and the decrypt step the delivery engine depends on had no implementation outside a test stub. This adds that boundary — a `whsec_` secret in the format Standard Webhooks receivers expect, encrypted under `NEXTLY_SECRET` with the same scheme that already protects email provider credentials.

  Storing a signing secret requires `NEXTLY_SECRET` to be set. Unlike provider configuration, which degrades to plaintext when no key is present, a webhook secret is the signing key itself: stored readable, anyone with database access could sign requests your receivers would trust. It fails instead, and says so.

## 0.0.2-alpha.38

### Patch Changes

- [#250](https://github.com/nextlyhq/nextly/pull/250) [`a302fec`](https://github.com/nextlyhq/nextly/commit/a302fec09fdd22f59763ce91cfbbfcca0f5fc3c7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix admin links ignoring modifier clicks, and route the admin's remaining framework-specific navigation through its own router.

  Links in the admin panel now behave like normal links: Cmd/Ctrl-click and middle-click open them in a new tab, `target="_blank"` is honored, and links that point outside the admin (such as the Help entry in the account menu, which goes to the documentation site) open properly instead of being rewritten into a dead admin route. Previously every one of these was captured and turned into an in-app navigation.

  Internally, the few remaining places that reached for the host framework's navigation directly — the command palette, the entry list's reading of the URL query string, and one entry page's links — now go through the admin's own navigation, link, and a new query-string hook. The entry list also no longer issues an unfiltered request before its URL filter is applied.

- [#258](https://github.com/nextlyhq/nextly/pull/258) [`1104b2f`](https://github.com/nextlyhq/nextly/commit/1104b2fe83ab6a7d940ec38f83bc6c40f6d1817c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal groundwork for viewing a document's history: field values can now be rendered read-only.

  Nothing in the admin reaches this yet, so there is no visible change in this release. It is the display layer the version history drawer will use to show what a document looked like at an earlier point, with a renderer for every built-in field type including the container types the entry list only ever summarised as a count.

- [#260](https://github.com/nextlyhq/nextly/pull/260) [`1f0a3e6`](https://github.com/nextlyhq/nextly/commit/1f0a3e6da323d4a3c5d31e8e7fc8fc9f0c97daca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now see a document's version history from the editor.

  A History control in the entry header opens a panel listing every saved version of the document, newest first, with who saved it and when. Selecting one shows what the document held at that point, field by field, clearly marked as a past state rather than the live one. Long histories page on demand rather than loading at once.

  Available for both collection entries and singles, on any document with versioning enabled. Restoring a version is not part of this change.

- [#254](https://github.com/nextlyhq/nextly/pull/254) [`7a46bd2`](https://github.com/nextlyhq/nextly/commit/7a46bd2757900bc0b7676ecc0171f7a0f74d7f30) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix custom admin branding colors, which made branded surfaces transparent instead of applying the configured color.

  Setting `admin.branding.colors` did not tint the admin — it broke it. Buttons, the active navigation item, focus rings and the first chart series lost their background entirely and rendered transparent. Removing the setting was the only way back to a working admin, so the feature was effectively unusable.

  The admin's design tokens hold complete colors and are read directly, but branding was still resolving colors to the bare `H S% L%` form an older token scheme expected. That produced an invalid value, which browsers discard. The server-rendered stylesheet that exists to prevent a flash of unbranded color had drifted further still, targeting a CSS class the admin no longer renders and writing token names nothing reads, so it had no effect at all.

  Branding now resolves to complete colors on both paths, and the server-rendered rule targets the class the admin actually uses, so configured colors appear immediately on load without a flash.

- [#244](https://github.com/nextlyhq/nextly/pull/244) [`40fc723`](https://github.com/nextlyhq/nextly/commit/40fc723578f49759310804536a3cacfc51353935) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix plugin admin pages 404ing on a direct link or page refresh.

  A page contributed by a plugin (via `contributes.admin.pages`) showed the admin's "Page Not Found" screen when opened by its URL directly — a deep link, a bookmark, or a hard refresh — even though reaching it by clicking within the admin worked. Plugin page routes register just after the admin loads its plugin metadata, which is later than the router's one-time initial route resolution, so that first resolution ran before the routes existed and never re-ran. The admin now re-resolves the current route once plugin pages are registered, so a directly-loaded plugin page renders instead of 404ing.

- [#255](https://github.com/nextlyhq/nextly/pull/255) [`93a432c`](https://github.com/nextlyhq/nextly/commit/93a432cfff275f423f545ccc8d21324b55c1f3cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make `@nextlyhq/ui` usable as a published package: components now work in a Next.js app, and plugins stay on one shared copy.

  Importing a component from `@nextlyhq/ui` into a server-rendered page failed, because the published bundle lost the `"use client"` marker that tells React these components run in the browser. The marker now ships with the package, and the build fails if it ever goes missing again.

  `@nextlyhq/ui` also becomes a peer dependency of `@nextlyhq/admin` rather than a bundled one. This is what the plugin documentation already described: the admin and every plugin share a single copy, so components cannot end up talking to a second, isolated instance of the design system. Projects created by `create-nextly-app` already install it, so no change is needed there; a project that added `@nextlyhq/admin` by hand should add `@nextlyhq/ui` alongside it.

  Plugins now depend on a compatible _range_ of `@nextlyhq/ui` instead of one exact version, so a plugin keeps working across releases instead of breaking on every one.

  Also: the documented `@nextlyhq/ui/tailwind-preset` entry point now exists (previously the import failed), the package declares which files have side effects so bundlers can drop unused components, and the plugin styling guide no longer names a CSS class and design tokens that do not exist — following it produced styles that silently did nothing.

- [#256](https://github.com/nextlyhq/nextly/pull/256) [`7c93a64`](https://github.com/nextlyhq/nextly/commit/7c93a642495f0b5d04fc2b7a71a755cacfda8ec6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content version history is now available from the main API, at
  `/collections/{slug}/entries/{id}/versions` and `/singles/{slug}/versions` (add
  `/{versionNo}` for one version). Reading a document's history requires the same
  permission as reading the document itself, and a version's stored content is
  filtered the same way a normal read would filter it.

- [#257](https://github.com/nextlyhq/nextly/pull/257) [`c092cb0`](https://github.com/nextlyhq/nextly/commit/c092cb0a92023b62e88d9db5f057b368b28329ee) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Version history now says who made each change.

  Reading a document's version history previously returned only the raw user id of whoever wrote each version, so a history view had nothing to show but an identifier. Each version now carries the display name of its author, resolved in a single batched lookup.

  The projection is a name only, deliberately not an email address, so reading history does not require permission to read users. Attribution never fails a history read: a deleted user, or an unavailable lookup, leaves the version unattributed rather than erroring.

- [#252](https://github.com/nextlyhq/nextly/pull/252) [`cac7062`](https://github.com/nextlyhq/nextly/commit/cac706295f4e0ac42f8f77ee854cdcc645e9e4a1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content version history can now be read, and it no longer grows forever.

  Two new endpoints list a document's versions and fetch a single one, and the same
  surface is available to plugin code. Listing returns metadata only, so opening a
  long history never transfers the stored content.

  Version history is also bounded now. A collection or single keeps the number of
  versions you configured instead of accumulating one for every save ever made; the
  limit was previously accepted in configuration but never applied. The newest
  version and the version matching your currently published content are always
  kept, and trimming happens as part of the same save, so history can never be left
  in a half-trimmed state.

- [#243](https://github.com/nextlyhq/nextly/pull/243) [`b5ecec8`](https://github.com/nextlyhq/nextly/commit/b5ecec8b14844dc8f7a2d643ae2e693df03d49cc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook deliveries are now sent, signed, and retried.

  The delivery engine claims each due webhook delivery, signs the request with Standard Webhooks HMAC headers, sends it over the SSRF-safe transport, and records the outcome. A 2xx marks the delivery sent; a 429 or 5xx is retried with exponential backoff and full jitter up to an attempt cap; any other response fails permanently. A claimed delivery is leased so a concurrent drain cannot double-send, and the network request never holds a database transaction open. A drain orchestrator runs fan-out and delivery together until nothing is currently due. The scheduled trigger that starts a drain is a later change.

- [#251](https://github.com/nextlyhq/nextly/pull/251) [`aa5a663`](https://github.com/nextlyhq/nextly/commit/aa5a6637d70fb1697be7925e7b8dea510984349a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating or updating an entry now records a webhook event.

  Entry creates and updates are written to the webhook event outbox inside the same database transaction as the change itself, so an event is never recorded for a write that rolls back and never missed for one that commits. The event carries the document with password and hidden fields removed, and reports which fields changed by comparing against the document as it stood before the write. On a localized collection the translations and per-locale status for the locale being written are included on both sides of that comparison, so a translation nobody touched is not reported as changed and a per-locale publish is reported with the status it actually committed, and the event names the locale it describes so writes to different translations of the same entry can be told apart. Fields are removed by their position in the document rather than by name alone, so a hidden field inside a component no longer removes an unrelated field that happens to share its name. Every event is attributed to whoever performed it: an API key is recorded as the key itself rather than as the user that owns it, a server-side write is attributed to the user it acts for, and an uninitiated write is recorded as the system. Batch writes are not covered yet: entries created through `createMany`, and entries written through the transaction helpers, commit without recording an event. Deletes, status changes, singles, media, users, and form submissions are later changes.

## 0.0.2-alpha.36

### Patch Changes

- [#240](https://github.com/nextlyhq/nextly/pull/240) [`d349b9e`](https://github.com/nextlyhq/nextly/commit/d349b9e913ae6f958e4201b6481dfe83cc5cfa5a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Third-party plugins can now style their admin UI.

  The admin stylesheet is precompiled and isolated, so utility classes that live only in an npm-installed plugin were silently dropped. This adds three layers, in order of preference: new `Stack`/`Grid`/`Stat` layout primitives alongside `Card` in the plugin UI kit; a curated, token-driven utility safelist that is always available with no build step; and, for anything beyond that, a per-plugin `admin.styles` stylesheet compiled with the new `nextly-build-admin-css` CLI (`@nextlyhq/admin-css`) and declared via `contributes.admin.styles`. Plugin styling stays scoped under `.nextly-admin` and token-driven (light and dark) by construction — the CLI refuses to emit a stylesheet that would leak into the host page or hardcode a color.
