# @nextlyhq/plugin-seo

## 0.0.2-alpha.51

### Patch Changes

- [#495](https://github.com/nextlyhq/nextly/pull/495) [`90dbe11`](https://github.com/nextlyhq/nextly/commit/90dbe11c6eec4b04ea56f4e27df4c62d11c3eff5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a user no longer deletes what they did. Activity-log entries carried a cascading
  foreign key to the account that produced them, so removing a user destroyed their entire audit
  trail. The entries now outlive the account, and the account holder name and email are erased from
  them at deletion time instead, leaving the record of what happened intact and attributed to an
  opaque id. The dashboard activity feed renders those entries as a deleted actor rather than a
  blank one.

- [#520](https://github.com/nextlyhq/nextly/pull/520) [`ab607c3`](https://github.com/nextlyhq/nextly/commit/ab607c333959aed225990143e0660cbe579240f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin panel's stylesheet no longer publishes names into the page that hosts
  it. Its animation names and Tailwind's internal `--tw-*` custom properties were
  resolved for the whole document regardless of the scoping on its selectors, so
  a host defining `spin`, `fade-in` or the same `--tw-*` registrations shared them
  with the admin and the later stylesheet won. Both are namespaced now, and the
  build fails if either escapes again.

  `@nextlyhq/ui`'s Tailwind preset keeps its named-plus-default export shape,
  which the build warns about. That shape is deliberate and now says so at the
  build config as well as beside the code: a preset is consumed as a value, so
  `require()` has to return it, and silencing the warning would change it back.

  The field-UI kit gains `ConditionRow` (@experimental), exported from
  `@nextlyhq/plugin-sdk/admin` alongside `operatorsForType` and
  `operatorTakesValue`. It edits one condition as source / operator / value,
  choosing the operators and the value editor from the source field's type, and a
  source carrying an option list is compared against a dropdown of exactly those
  rather than free text. It owns the row and not the container, so a surface keeps
  its own chrome; pass `operatorsFor` to narrow the offered operators to the ones
  your runtime can evaluate.

  Both first-party condition editors now compose it. The schema builder's gains
  nothing an author will notice beyond the value dropdown; the form builder's
  gains type-aware comparisons, a dropdown for choice fields, and typed number and
  date inputs. Stored shapes are unchanged in both, including the form builder's
  `comparison` key and its seven-comparison vocabulary.

- [#493](https://github.com/nextlyhq/nextly/pull/493) [`d8d5bfe`](https://github.com/nextlyhq/nextly/commit/d8d5bfe868e3c6eb4a26851ceebb9b466e1a33ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the durable first-publication marker on every shape the entry editor uses, and let the
  editor trust it. A published entry that was unpublished and then reloaded no longer offers its
  slug back to the title generator, so republishing lands at the address the links already point
  at. The marker is consulted only for a slug shared by every language, because it records that a
  document was public somewhere rather than in one particular language.

  The marker also survives editing: a document with a pending working draft now reports it on the
  save response and on the draft read, as a date rather than a string, matching an ordinary read.

- [#515](https://github.com/nextlyhq/nextly/pull/515) [`19efb3a`](https://github.com/nextlyhq/nextly/commit/19efb3a7018b7fae2aa695333493dfd137f96bd9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin now reports a save whose follow-up actions failed, instead of showing it as a clean save.

  A post-commit hook (`afterCreate` / `afterUpdate` / `afterDelete`) runs once the row is already
  durable, so a handler failing there cannot un-save it. The server has always answered success and
  carried the failure alongside as `warnings`, but the admin's entry clients returned only `item` and
  discarded that array, so a search index that was not reindexed, a webhook that was not delivered or
  a cache that was not purged looked identical to a clean write.

  Creating, updating or deleting an entry now shows "Entry updated successfully, but 2 follow-up
  actions failed" with the failures behind a disclosure. It stays a success toast, never an error:
  the row IS saved, and reporting a failure would invite the editor to repeat a write that already
  took effect.

  `entryApi.create`, `entryApi.update` and `entryApi.delete` now resolve to `{ item, warnings? }`
  rather than the entry alone. The `onSuccess` callbacks on `useCreateEntry`, `useUpdateEntry` and
  `useDeleteEntry` still receive the entry, so callers of those hooks are unaffected.

- [#504](https://github.com/nextlyhq/nextly/pull/504) [`e7a675f`](https://github.com/nextlyhq/nextly/commit/e7a675f6473d0669f2d52c00edd3a190d370cf30) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder tables keep the text column width they had. Creating a field group or single routed its columns through the shared descriptor, which read a text field with no stated width as bounded where the previous generator read it as unbounded, so on MySQL a new text column held 255 characters instead of 65 535.

  A text field that limits its length now gets a column at exactly that limit, on every path that can build one: a field limited to 400 characters no longer lands in a column that rejects what its own validation accepts. The limit is the field's validation maximum, which is the one the Schema Builder has always sized a bounded column from. Localized companion migrations, Single identity seeding, and columns added to an existing table all recognise the bounded text column, so a freshly generated migration applies, a new Single keeps its seeded title and slug, and a column added at boot is not reported as changed on the next preview.

  A field whose type belongs to a plugin that is not loaded also keeps the unbounded column it was built with, instead of being reported as a narrowing on a table nothing has touched.

  A field group's text field that declares a maximum length keeps the bounded column it was created with. Its width is declared under a different key from a collection's, which the schema comparison did not read, so on PostgreSQL such a field was reported as a type change on a column that had not changed.

- [#509](https://github.com/nextlyhq/nextly/pull/509) [`c686245`](https://github.com/nextlyhq/nextly/commit/c6862456110db02565c3759ec8daf7b32c2fd228) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Behaviour change.** A code-first collection or single that declares a field named `id`,
  `createdAt`, `created_at`, `updatedAt` or `updated_at` is now refused when the config is read,
  instead of failing later during schema application. Any casing that resolves to one of those
  columns is refused too, so `CreatedAt` is caught alongside `createdAt`.

  Such a collection could never have worked: the field is emitted alongside the injected column and
  the database rejects a table that declares the same column twice. The error now names the column
  it collides with, and arrives where the name is chosen.

  `title`, `slug` and `status` are unaffected and remain declarable — the first two step aside for
  an author's own field, and a `status` field is taken up by the draft/publish lifecycle.

- [#507](https://github.com/nextlyhq/nextly/pull/507) [`f348a0f`](https://github.com/nextlyhq/nextly/commit/f348a0f0b65b46fcb5697c2f0fe1c9fcd45d0e11) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Resolve a field name to its database column the same way everywhere. A Schema Builder collection
  created a field whose name began with a capital under an extra leading underscore, while the
  runtime schema and the schema diff addressed it without one — so the table and every read of it
  disagreed, and the diff reported the column missing on every apply.

  Every decision about which column a field occupies now asks the same question of the same
  conversion: which system column an author's field replaces, whether two names collide, which system
  fields a config factory injects, and which columns an ALTER may touch. Two fields whose names reach
  one column (such as `foo_bar` and `FooBar`) are now reported where the names are chosen rather than
  failing during schema application, and editing a many-to-many field's index or flags no longer emits
  statements against a column it never had.

  Field types that store their values in their own tables, such as a component or a many-to-many
  relationship, are consistently treated as occupying no column: they neither collide with each other
  nor suppress a system column that still has to be injected beside them.

  **Two configurations that were previously accepted are now refused at startup, with an error naming
  the fix.** A field may replace the system `title` or `slug` column only under that column's own
  name: `title` still works and is unchanged, while `Title` is refused, because it reaches the same
  column while remaining a separate identity in every payload — a create carrying `Title` gained a
  second generated `title` and the generated value overwrote the author's. And a field whose name
  reaches a column the Draft/Published lifecycle owns is refused while that lifecycle is enabled; such
  a collection could never have been created, since the column was declared twice. With the lifecycle
  off, `status` remains an ordinary field name.

  Emitted SQL is unchanged for every field name the Schema Builder accepts.

- [#496](https://github.com/nextlyhq/nextly/pull/496) [`387061e`](https://github.com/nextlyhq/nextly/commit/387061eb80a94ac758e17ceeb811d1b0026e68b6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reject a field named `id`, `createdAt` or `updatedAt` in a Field Group (component), through both
  the visual builder and `defineFieldGroup`. A component keeps its values in a table of its own
  carrying those columns, so such a field is emitted into the same `CREATE TABLE` as the injected one
  and the database refuses the statement. The name is now refused where it is chosen, with a message
  saying which system column it collides with.

  Field groups that already declare such a field could never have had a working table, since creating
  it fails; they will now be reported at configuration time instead of during schema application.

- [#505](https://github.com/nextlyhq/nextly/pull/505) [`e7316d8`](https://github.com/nextlyhq/nextly/commit/e7316d835c635a06880deaf8e16e5bebadcd4d74) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A core schema change now reaches a database that already holds content. Adding a column to
  one of Nextly own tables, or changing a constraint on one, was silently skipped on SQLite and
  MySQL whenever any content table existed, while nextly migrate still reported success. The
  reconcile now runs a second pass after a degraded one: with nothing left to create, the schema
  differ has no ambiguity to resolve and emits the alterations it previously abandoned.

- [#510](https://github.com/nextlyhq/nextly/pull/510) [`781fa81`](https://github.com/nextlyhq/nextly/commit/781fa816354ad962a919a81396b9fc4123ee196b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Custom CSS in the page builder can no longer end the `<style>` element it is
  rendered into. A value written with a CSS escape, such as
  `content: "\3c /style>"`, contains no markup as authored but was decoded into
  markup when the stylesheet was serialized, and on a server-rendered page the
  browser then parsed whatever followed it as HTML. Those sequences are now
  escaped on the way out, so they still mean the same thing to CSS and nothing to
  the HTML parser.

  Custom CSS also keeps its meaning inside `:not()`, `:is()`, `:where()` and
  `:has()`. Scoping used to rewrite the selectors held by those, so
  `.a:has(> .b)` silently became "has a `.b` anywhere under the page root".

- [#508](https://github.com/nextlyhq/nextly/pull/508) [`444bd26`](https://github.com/nextlyhq/nextly/commit/444bd26fef33fe4c4a7e511bc77359d64fde375d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An error thrown by a Direct API call now chains the failure it actually came from. The public
  result shape drops the driver error and the identifiers the thrower attached, and the boundary
  rebuilt from what survived, so every unexpected failure arrived looking alike. The original is
  carried alongside the envelope and chained as the rebuilt error cause.

- [#490](https://github.com/nextlyhq/nextly/pull/490) [`a2e92ae`](https://github.com/nextlyhq/nextly/commit/a2e92aed1bf1e9133e898274c98a8b5bef208338) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks now receive a render context, so a block that reads content is an
  ordinary async component rather than something the API had no way to express.
  A slot is now something a block draws rather than something it receives already
  drawn: `renderSlot(name, ctx?)` replaces the map of rendered children, so a
  repeater can draw its template once per entry with that entry's values, and a
  block that hides a panel no longer pays to render it.

  A block's `supports` is checked against the catalog while it is being written
  instead of at boot, and a plugin that registers its own support adds it to that
  check by augmenting `BlockSupportKeys` in `@nextlyhq/plugin-sdk/blocks`. A key
  lists the sub-flags it recognises as a union of strings, and declares either
  `never` or `true` when it is all-or-nothing; both are read the same way, and a
  sub-flag the key does not declare is refused where it is written. The
  types a block definition asks for are all reachable from that same subpath, so
  writing a block no longer means importing the engine directly. Renderers now
  describe what they provide once by augmenting `BlockRenderContext`, so `ctx` is
  typed without every block naming a context type of its own.

  Breaking, in an experimental package:
  - `BlockSupportValue` is no longer exported from `@nextlyhq/plugin-sdk/blocks`.
    It is the shape the registry stores from every source, so as authoring
    vocabulary it accepted a sub-flag name the per-key check refuses. Write a
    shared setting for one key as `BlockSupports["spacing"]`, or a whole object
    through `blockSupports()`.
  - `BlockRenderResult` from `@nextlyhq/plugin-sdk/blocks` is now
    `ReactNode | Promise<ReactNode>` rather than the engine's `unknown`, so a
    helper typed with it satisfies a block's `render`.
  - `BlockRenderArgs.slots` is replaced by `BlockRenderArgs.renderSlot`.
  - `BlockDefinition.resolve` is removed. Nothing ever called it, so a data-loading
    function written against it silently never ran; blocks read data through `ctx`.
  - `createRevision`, `pruneRevisions` and `Revision` are removed from
    `@nextlyhq/plugin-page-builder`. They duplicated the content-versioning
    support that already ships in core, and nothing in the package used them.

- [#512](https://github.com/nextlyhq/nextly/pull/512) [`8c36bb6`](https://github.com/nextlyhq/nextly/commit/8c36bb6aad3c5e7df9b2d194a5710a3a957aaa6c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Record the outcome of every event the outbox captures. `success | failure |
unknown` is the vocabulary the audit and observability schemas converge on, and
  the one field NIST SP 800-53 AU-3(e) requires that the envelope did not already
  carry.

  Absence means success, which is what every event recorded so far is: a row is
  written inside the transaction of a change that commits, so a recorded event is
  by construction a completed one — and that is also why the column's default is
  the correct value for existing rows. The field exists so that a refusal, such as
  a denied publish, can be recorded as the distinct thing it is rather than being
  indistinguishable from a change that happened.

  Additive and optional on the webhook envelope, so existing subscribers are
  unaffected.

- [#513](https://github.com/nextlyhq/nextly/pull/513) [`c9ef62a`](https://github.com/nextlyhq/nextly/commit/c9ef62a6d3d77078b5f0a5505e18e8e2931478dd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Record which retention window governs each captured event, and shorten the audit
  window to 90 days.

  The event table has carried a `retention_class` column since the outbox shipped,
  but nothing ever wrote anything but `webhook`, so every row was measured against
  the short outbox-hygiene window. The class now follows from why the row was
  recorded: a row admitted by the audit seam is audit-class and outlives outbox
  hygiene, while one admitted only because an endpoint exists stays webhook-class.
  A row that is both takes the longer window, since evicting it on the delivery
  clock would lose history nothing can reconstruct.

  The audit window default moves from 365 days to 90. The previous value was
  justified as "SOC 2 practice is a one-year floor", which does not hold up:
  neither SOC 2 nor ISO 27001 A.8.15 mandates a period — both require only that
  retention be defined and risk-based — and the twelve-month figure is PCI DSS
  convention that has spread into the wider discourse. 90 days is where comparable
  products land for content activity. A deployment genuinely in PCI scope should
  raise `auditEventsMaxAgeMs`, which is a decision only the operator can make.

  `auditEventsMaxAgeMs` is now raised to `eventsMaxAgeMs` whenever the webhook
  window is the longer of the two, including when it is `false`. A row admitted by
  both the audit seam and an endpoint is labelled `audit` because that is the
  longest retention it needs, so a shorter audit window would have pruned it
  earlier than the webhook setting allows — irreversibly, and in a supported
  configuration.

  Upgrading, by deployment:
  - **`webhooks.audit` off** (the default, and most installs): nothing changes.
    Events are still recorded webhook-class and pruned on `eventsMaxAgeMs` exactly
    as before.
  - **`webhooks.audit` on**: events that used to be recorded webhook-class are now
    audit-class, so they move from `eventsMaxAgeMs` to `auditEventsMaxAgeMs` — at
    the defaults, from 30 days to 90. That is the intended behaviour, since those
    rows are recorded for history rather than delivery, but it retains roughly
    three times as many events and the storage that implies. Set
    `webhooks.retention.auditEventsMaxAgeMs` if a shorter window is wanted.

- [#489](https://github.com/nextlyhq/nextly/pull/489) [`3a75d0e`](https://github.com/nextlyhq/nextly/commit/3a75d0e9ffef4211c330e9b949063b918505f8f5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin now calls field groups "field groups" in the places that used to say "components".

  The field picker, the Schema Builder's field-group editor, the entry form, the entries table badge, the Field Groups list and its empty states, and the dashboard's getting-started panel all carried the old wording, so a page titled "Field Groups" could tell you that you had selected components. Only the words changed: the stored field type, table names and API payloads are untouched, so no data or integration is affected.

- [#465](https://github.com/nextlyhq/nextly/pull/465) [`97bcb2c`](https://github.com/nextlyhq/nextly/commit/97bcb2cc75b917c9899a692e159868c21c5979e1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections and singles with Draft/Published now record when a document first went live, in a new `firstPublishedAt` timestamp.

  Until now a row only said what it IS. Unpublishing sent it back to draft and erased every trace it had ever been public, even though the inbound links, feeds and search results it collected while live were still out there. Anything that needs to ask "was this address ever public" had nothing to read.

  The value is set once, on the first transition into published, and never changes afterwards: it is the date of the first publication, not the most recent one. It survives an unpublish, and it stays empty for an entry that has only ever been a draft. Entries that already existed keep an empty value, because whether they were once published was never recorded and cannot be recovered after the fact.

  Collections and singles without Draft/Published do not get the column: they have no unpublished state, so there is no transition to record.

  For a collection translated into several languages, the value answers whether the document has been public in any language, since every translation shares one address. Publishing a single translation therefore records it.

  The value is set by Nextly alone. A `firstPublishedAt` sent in a create or update request is ignored, so the recorded date is always one that actually happened.

- [#491](https://github.com/nextlyhq/nextly/pull/491) [`c78afca`](https://github.com/nextlyhq/nextly/commit/c78afca553094f6d472d506482587c2fe722bf35) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - When a service raises a typed error, the public result shape drops its `cause` and `logContext` before the boundary rebuilds it, so an operator saw a generic reconstruction with none of the detail the thrower attached. The original is now kept for the request and logged against the same `requestId` the response carries, so the two can be joined.

  An error response can also carry a `_devDiagnostics` field with that detail, so an author sees why a request failed without reading the server log. It requires TWO signals: `NODE_ENV=development` AND `NEXTLY_DEV_DIAGNOSTICS=1`. Set the second in your local env file to switch it on. Neither alone is enough, because Nextly ships pre-built and stays external to your app build, so `NODE_ENV` is read at runtime and a production deployment started with the wrong value must not be able to disclose it. Production responses are unchanged either way.

- [#517](https://github.com/nextlyhq/nextly/pull/517) [`089a758`](https://github.com/nextlyhq/nextly/commit/089a758bd3b27543b5cbb5c7bae94e09f2ace4d2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two corrections to how the page builder's isolation check reads names, both of
  which made it reject stylesheets that were correct.

  A font family is matched without regard to case, so a namespaced family spelled
  in capitals is the same family; a keyframe or a layer name is case-sensitive and
  still is. A comment is whitespace, so a comma inside one no longer splits one
  name into two.

- [#487](https://github.com/nextlyhq/nextly/pull/487) [`41d7c8d`](https://github.com/nextlyhq/nextly/commit/41d7c8d438059e58e65e766d82cdf858d7ca4d2a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Localization migration files now record what transition they are for.

  `nextly migrate:create` writes an extra header line on each `_locales` companion migration naming the transition, the kind of entity it belongs to, and the columns involved. Nothing reads it yet, so applying a migration behaves exactly as before, and files generated by earlier versions keep applying unchanged.

- [#518](https://github.com/nextlyhq/nextly/pull/518) [`1797d27`](https://github.com/nextlyhq/nextly/commit/1797d273a3c7082c2e0c8e6959cb8137c36c7f3f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Record a `login-succeeded` audit event when a session is issued.

  Failed logins have been recorded since the audit log shipped; successes were
  not. A trail of failures alone shows that someone tried and not whether they got
  in, which is the first question asked after a credential leak.

  The event is written where the session is issued, not where the flow began.
  Three handlers issue sessions — password login, second-factor resolution, and
  the forced first-sign-in password change — so recording it in the login handler
  alone would have left every user who completes a second factor absent from the
  success trail, which is the population most worth seeing in it. Recording on an
  HTTP 200 instead would have the opposite fault: the challenge and
  password-change legs answer 200 while issuing no session, so a success would be
  reported for an account that was never reached.

  It is recorded last, after the post-login hooks. A hook that throws sends the
  handler into its failure path, which returns an error and records a failure, so
  the client receives neither the token body nor the cookies — a success recorded
  before that point would leave the trail asserting both outcomes for one attempt.
  Those hooks now run inside the same shared step for that reason: all three
  handlers ran the identical pair, and the order between them decides whether the
  trail can contradict itself.

  Unlike the failure event it is attributed to the account. Naming the account on
  a failure is the account-state leak the unified error response exists to avoid;
  on a success it is the whole value of the record.

  Setup records it too. Creating the first administrator hands out a working
  session without going through the shared login path, so that account — the
  super-admin — was the one login absent from the trail.

  Also fixes an overstated token expiry on the login and setup responses. The
  `expiresAt` they return was derived from a fresh clock reading taken after the
  awaited work that follows signing, so it named a later moment than the token's
  own `exp` claim. `signAccessTokenWithExpiry` now returns the token together with
  the expiry it actually carries, computed once and set explicitly, so a caller
  reports the truth rather than a parallel calculation that drifts by however long
  that work takes — unbounded, since plugin `afterLogin` hooks run there.

- [#477](https://github.com/nextlyhq/nextly/pull/477) [`302264b`](https://github.com/nextlyhq/nextly/commit/302264b9230c24fe4553e7ed98324ca72a284f27) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-level read access on an expanded relationship now applies to each related row before its parent's `afterRead` field hooks run, matching a direct read. Previously a parent hook was handed a nested child with the caller's denied fields still present, so a hook that copied such a field onto an allowed key exposed it under that key even though the child's own field was redacted afterward.

  Behavior change: a field `afterRead` hook can no longer observe a related row's caller-denied field, so it can neither leak nor mask on one. A value that must stay hidden should be protected with an `access.read` rule keyed on the caller rather than a hook that reads another field the caller cannot see. Trusted reads (`overrideAccess`) are unaffected, since field access is skipped for them.

- [#499](https://github.com/nextlyhq/nextly/pull/499) [`1825c8f`](https://github.com/nextlyhq/nextly/commit/1825c8f3e5e442db1218413dec0aec169ccebf4e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Catch every spelling of a Field Group field name that collides with one of its table's system
  columns, not only the two that were listed. `CreatedAt` reaches the same `created_at` column as
  `createdAt` does, and was accepted. Names are now compared as the column they become, so a field
  declared with a plugin-contributed type is checked too — its type registers after the config is
  read, and it was previously skipped.

  A Field Group field that references another Field Group may take any name that a Field Group
  instance does not already use for itself: not `id`, which is the instance's own identity, and not a
  name that converts to `created_at` or `updated_at`, which a read would fill with the row's
  timestamp instead of the referenced data.

- [#516](https://github.com/nextlyhq/nextly/pull/516) [`00fee42`](https://github.com/nextlyhq/nextly/commit/00fee42c6e73d7d75905fa743fee747cc09f290b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Breaking (plugin authors):** `ctx.services.collections.createEntry`, `updateEntry` and
  `deleteEntry` now resolve to `{ message, item, warnings? }` instead of the bare row.

  This is the same envelope the Direct API and the REST API already return, so the same failure is
  equally visible however the write was made. Previously a plugin was the ONLY caller of a write
  that could not see a post-commit hook failure: `afterCreate` / `afterUpdate` / `afterDelete` run
  once the row is durable, so a handler failing there cannot un-save it — the write reports success
  and the failure travels beside it as `warnings`. The plugin facade never opened a collector, so
  those failures were invisible to the plugin that caused them.

  Migration is one property access:

  ```ts
  // Before
  const post = await ctx.services.collections.createEntry(slug, data, {
    as: "system",
  });
  post.id;

  // After
  const { item, warnings } = await ctx.services.collections.createEntry(
    slug,
    data,
    { as: "system" }
  );
  item.id;
  if (warnings)
    ctx.logger.warn("side effects failed", { id: item.id, warnings });
  ```

  `deleteEntry` reports `item` as `{ id }`, since there is no row left to return. Reads
  (`listEntries`, `findEntryById`, `count`) and `createMany` are unchanged.

- [#483](https://github.com/nextlyhq/nextly/pull/483) [`326ac0d`](https://github.com/nextlyhq/nextly/commit/326ac0d5702ca0fce7ebf173627b7fabac56d677) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A hook that throws in a post-commit phase (`afterCreate` / `afterUpdate` / `afterDelete`) now reports the failure to the caller instead of only to the server log. The write still reports success, because the row is durable and a side-effect phase cannot change it, but the result carries a `warnings` array naming the phase, the entity and the error code so an integration can react to a side effect that did not run. The field is present only when something failed, so an ordinary response is unchanged. It appears on the REST mutation and bulk envelopes and on the Direct API's `MutationResult`, `DeleteResult` and `BulkOperationResult`.

  **Breaking (Direct API):** `nextly.updateSingle()` now returns the same `{ message, item }` envelope the collection mutations return, instead of the bare updated document. Singles run the same post-commit phases as collections, so this is what gives their hook failures somewhere to be reported — and it removes the one mutation that did not report its outcome like the others. Read the document from `.item`:

  ```ts
  // before
  const settings = await nextly.updateSingle({ slug: "site-settings", data });
  settings.siteName;

  // after
  const { item } = await nextly.updateSingle({ slug: "site-settings", data });
  item.siteName;
  ```

- [#511](https://github.com/nextlyhq/nextly/pull/511) [`51d2469`](https://github.com/nextlyhq/nextly/commit/51d2469a54d0ef748244976c0c609e8a26c30394) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A failure now chains the error it actually came from onto what the caller receives, through
  every boundary that rebuilds one: REST routes, the Direct API, the singles route, the
  plugin-facing collection facade, the bulk-by-query paths and the version writes. Previously
  only typed failures carried their origin, and only on the Direct API, so a connection drop or
  a constraint rejection arrived with nothing naming what actually went wrong. The status-derived
  rebuilds — a code-less 404, 403, 409 or 500, which is exactly what a raw driver rejection
  produces — dropped it too.

  `NextlyError.notFound`, `.forbidden` and `.conflict` accept a `cause` alongside `logContext`,
  matching `.internal`.

  One place now builds the error response body, so plugin routes answer with what every other
  route answers with. Three consequences for a plugin route:
  - Failures now carry `_devDiagnostics` in development, which this surface never had.
  - A handler that throws a non-`NextlyError` still answers 500, but the thrown error is now
    chained onto it instead of discarded.
  - A 401 or 403 now returns the canonical `{ error: { code, message, requestId } }` body with
    `application/problem+json`, matching the rest of the API. It previously returned the legacy
    `{ data: { ... } }` body with `application/json`, so a single plugin route answered rejected
    requests and failing handlers in two different shapes. A client reading a plugin route's
    auth-failure body needs updating; one reading the status or a handler failure does not.

- [#497](https://github.com/nextlyhq/nextly/pull/497) [`a4d86c1`](https://github.com/nextlyhq/nextly/commit/a4d86c160c6ee0d82a132a3218a3c0bd7bdcde05) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Harden nested field-level read access against `afterRead` hooks that reshape a
  read response. A related row's presentation is its own collection's authority, so
  the response's related rows are now rebuilt from the versions the read sanitized
  rather than inspected for tampering: whatever a source collection's `afterRead`
  hook did to a related row — reintroducing a denied field, cloning or reshaping the
  row, replacing, appending, reordering or removing its nested group/repeater rows,
  or returning a rebuilt document — is discarded. The rebuild runs after every hook
  phase, so one phase cannot hand the next a contaminated related row to copy from.

  Closes a field-hook exfiltration path on related rows. A field hook belongs to one
  field but is handed the whole row, so a hook on an ALLOWED field of a related row
  could read a DENIED field beside it and return it as its own value — and the access
  pass that ran afterwards, judging each field by its own rule, had no reason to remove
  the copy. The target collection's field access now runs BEFORE its field hooks and
  again after, the same order a direct read of that collection uses: a row reached
  through a relationship may be redacted more strictly than the target's own endpoint,
  never more loosely.

  Also fixes a related-row read-access gap for a relationship that declares a single
  target as an ARRAY (`relationTo: ["posts"]`). That form stores and expands as the
  discriminated `{ relationTo, value }` pair, but the nested read decided the pair
  shape from the NUMBER of declared targets and so treated the wrapper as the row
  itself — evaluating the target collection's field `access.read` rules against an
  object holding only `relationTo` and `value`, which matches nothing. A field the
  target collection denies was returned inside the wrapper. The shape is now read
  from how the target was declared, in one place shared by every reader.

  This also removes the previous release's over-stripping: a related row a hook
  merely copied is no longer returned with its access-controlled fields denied, it
  is returned correctly sanitized, and the development-mode warning about reshaped
  rows is gone. A denied source field stays hidden from the source collection's own
  field hooks so it cannot be copied onto a selected field.

  Notes for hook authors. A source collection's `afterRead` hook can no longer change
  how a related row appears in the response, including its readable fields: transform
  the related collection's own fields with that collection's field hooks instead.
  Filtering or reordering a `hasMany` relationship still works, since that shapes the
  source field rather than the related rows. A populated related row a hook invents
  (one the read never expanded, so no collection's read rules were ever applied to it)
  is returned as the bare reference it names rather than as an object.

- [#486](https://github.com/nextlyhq/nextly/pull/486) [`04fb6ab`](https://github.com/nextlyhq/nextly/commit/04fb6ab8274b850807b457b5d9777c6beaabfdf5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Style values are read more carefully in three places. A composite no longer
  builds an unbounded amount of issue text before its allowance is checked, an
  `attr()` fallback is validated as the single value it substitutes rather than as
  an arithmetic expression, and an expression is still judged where it can be even
  when part of it cannot be read.

- [#501](https://github.com/nextlyhq/nextly/pull/501) [`fcdcd2d`](https://github.com/nextlyhq/nextly/commit/fcdcd2d5798dbe4aff493c2d60e3d5dc1678387a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The style compiler now accounts for every shape of persisted data it cannot use.
  A state map, a breakpoint map, a `visibility` envelope or its `devices` map that
  is not an object applies nothing, and each is reported rather than skipped, so a
  document with values and a page with no CSS are always connected by a warning.

  The node walk is bounded by what it READS rather than by what it could use, so
  an array of malformed entries can no longer pass the node cap without tripping
  it.

- [#492](https://github.com/nextlyhq/nextly/pull/492) [`379c16a`](https://github.com/nextlyhq/nextly/commit/379c16a613abd0dff09803f89e7bf1cfe43332d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The engine can now compile a page's stored styles into CSS. `compilePageCss`
  turns a document and its site context into one stylesheet plus the class each
  node should carry, reading only persisted data: styles are never gathered while
  something renders, so a block cannot lose its styling by not being on screen
  when the sheet was built.

  Design tokens compile to the custom properties they read, logical values stay
  logical so one stored style is correct in both reading directions, states
  compile to `:hover`, `:focus-visible` and `:active`, and both breakpoint axes
  compile to media and container queries. The same document always produces the
  same bytes.

  States are emitted inside `:where()` so they add no specificity, and every rule
  is decided by source order instead: a node's own value beats its block type's
  default at every width, and a value set for a state beats a base value set at a
  narrower breakpoint.

  A value the validator refuses is left out of the stylesheet and reported rather
  than written, whether or not the caller validated first. The same holds for
  everything the compiler cannot act on: a block type that is not a namespaced
  slug, a style state it does not recognise, a breakpoint id that resolves to more
  than one definition, two nodes sharing an id, and a malformed envelope are all
  left out and named. `StyleCompileContext` takes the document `limits`, so the
  node walk stops where validation would have.

- [#503](https://github.com/nextlyhq/nextly/pull/503) [`387e593`](https://github.com/nextlyhq/nextly/commit/387e59380729bcc6d00e2d8aef5b3dee6e70e486) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stylesheets compiled by `@nextlyhq/blocks-engine` now sit one specificity notch
  higher, so ordinary site CSS no longer beats a value set in the builder by
  accident. A rule like `.content .card h1` used to win over a block's own colour
  and leave the author with a style that silently did not appear.

  This applies to that engine's output. `@nextlyhq/plugin-page-builder` renders
  through a compiler of its own that does not yet follow these weights, so pages
  rendered through it are unchanged by this release.

  Overriding on purpose still works: an unlayered selector that beats the builder's
  specificity wins, and so does `!important`, because the compiler deliberately
  never writes it. Two things are worth knowing.

  If your CSS lives in a cascade layer, as Tailwind's does, layer order is settled
  before specificity and the builder emits an unlayered stylesheet, so adding
  classes inside an `@layer` will not win. Write the override unlayered, or use
  `!important`.

  If the property you are overriding is mid-transition, the transitioning value
  outranks every author declaration including `!important` until the transition
  ends. Add `transition: none !important` to your rule if that applies.

- [#466](https://github.com/nextlyhq/nextly/pull/466) [`4dc8a46`](https://github.com/nextlyhq/nextly/commit/4dc8a464f0d149a8075e49eb34ed2d10c80eb51a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the style-property catalog to the blocks engine: the set of style properties a block may set, each with its value shape, the CSS it emits, and the design tokens it accepts. Storage keys are logical, so one page renders correctly in both left-to-right and right-to-left languages without a separate copy. Style values are checked for safety and for being the kind of value their property takes, before they reach a stylesheet.

  The built-in block `supports` sub-flags now match the catalog. A block declaring `spacing.blockGap`, `color.background`, or `border.width`/`style`/`color` will fail to register and must use the group's current flags instead; the error names them.

- [#488](https://github.com/nextlyhq/nextly/pull/488) [`a4c6092`](https://github.com/nextlyhq/nextly/commit/a4c6092ea288d7ae67858f5087c821231a9776de) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Document validation can now check design-token names and class ids against the
  site that will render them. Both are optional: validation is given the site or
  it is not, and without it these names are not checked at all. An unresolved name
  is always a warning, never an error, so renaming a token or retiring a class
  never makes a stored document unpublishable — including when a rename leaves
  more unresolved names than one report can carry, which is now said separately
  and does not stop the checks that decide whether a document is valid.

- [#494](https://github.com/nextlyhq/nextly/pull/494) [`9653096`](https://github.com/nextlyhq/nextly/commit/9653096008a39ab4502e55d33bb8dc2379fc5b27) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reject a Schema Builder field named `createdAt` or `updatedAt` when the name is chosen, rather
  than letting it fail later as a database error. Both snake-case onto a system column and land in
  the same `CREATE TABLE` twice, so a collection carrying one could never be created.

  Internally, what a system column is now lives in one declaration per column instead of ten
  hand-written lists across the codebase, so a column added in future reaches the schema, the
  write paths, the response shapes and every validator at once.

- Updated dependencies [[`90dbe11`](https://github.com/nextlyhq/nextly/commit/90dbe11c6eec4b04ea56f4e27df4c62d11c3eff5), [`ab607c3`](https://github.com/nextlyhq/nextly/commit/ab607c333959aed225990143e0660cbe579240f4), [`d8d5bfe`](https://github.com/nextlyhq/nextly/commit/d8d5bfe868e3c6eb4a26851ceebb9b466e1a33ba), [`19efb3a`](https://github.com/nextlyhq/nextly/commit/19efb3a7018b7fae2aa695333493dfd137f96bd9), [`e7a675f`](https://github.com/nextlyhq/nextly/commit/e7a675f6473d0669f2d52c00edd3a190d370cf30), [`c686245`](https://github.com/nextlyhq/nextly/commit/c6862456110db02565c3759ec8daf7b32c2fd228), [`f348a0f`](https://github.com/nextlyhq/nextly/commit/f348a0f0b65b46fcb5697c2f0fe1c9fcd45d0e11), [`387061e`](https://github.com/nextlyhq/nextly/commit/387061eb80a94ac758e17ceeb811d1b0026e68b6), [`e7316d8`](https://github.com/nextlyhq/nextly/commit/e7316d835c635a06880deaf8e16e5bebadcd4d74), [`781fa81`](https://github.com/nextlyhq/nextly/commit/781fa816354ad962a919a81396b9fc4123ee196b), [`444bd26`](https://github.com/nextlyhq/nextly/commit/444bd26fef33fe4c4a7e511bc77359d64fde375d), [`a2e92ae`](https://github.com/nextlyhq/nextly/commit/a2e92aed1bf1e9133e898274c98a8b5bef208338), [`8c36bb6`](https://github.com/nextlyhq/nextly/commit/8c36bb6aad3c5e7df9b2d194a5710a3a957aaa6c), [`c9ef62a`](https://github.com/nextlyhq/nextly/commit/c9ef62a6d3d77078b5f0a5505e18e8e2931478dd), [`3a75d0e`](https://github.com/nextlyhq/nextly/commit/3a75d0e9ffef4211c330e9b949063b918505f8f5), [`97bcb2c`](https://github.com/nextlyhq/nextly/commit/97bcb2cc75b917c9899a692e159868c21c5979e1), [`c78afca`](https://github.com/nextlyhq/nextly/commit/c78afca553094f6d472d506482587c2fe722bf35), [`089a758`](https://github.com/nextlyhq/nextly/commit/089a758bd3b27543b5cbb5c7bae94e09f2ace4d2), [`41d7c8d`](https://github.com/nextlyhq/nextly/commit/41d7c8d438059e58e65e766d82cdf858d7ca4d2a), [`1797d27`](https://github.com/nextlyhq/nextly/commit/1797d273a3c7082c2e0c8e6959cb8137c36c7f3f), [`302264b`](https://github.com/nextlyhq/nextly/commit/302264b9230c24fe4553e7ed98324ca72a284f27), [`1825c8f`](https://github.com/nextlyhq/nextly/commit/1825c8f3e5e442db1218413dec0aec169ccebf4e), [`00fee42`](https://github.com/nextlyhq/nextly/commit/00fee42c6e73d7d75905fa743fee747cc09f290b), [`326ac0d`](https://github.com/nextlyhq/nextly/commit/326ac0d5702ca0fce7ebf173627b7fabac56d677), [`51d2469`](https://github.com/nextlyhq/nextly/commit/51d2469a54d0ef748244976c0c609e8a26c30394), [`a4d86c1`](https://github.com/nextlyhq/nextly/commit/a4d86c160c6ee0d82a132a3218a3c0bd7bdcde05), [`04fb6ab`](https://github.com/nextlyhq/nextly/commit/04fb6ab8274b850807b457b5d9777c6beaabfdf5), [`fcdcd2d`](https://github.com/nextlyhq/nextly/commit/fcdcd2d5798dbe4aff493c2d60e3d5dc1678387a), [`379c16a`](https://github.com/nextlyhq/nextly/commit/379c16a613abd0dff09803f89e7bf1cfe43332d6), [`387e593`](https://github.com/nextlyhq/nextly/commit/387e59380729bcc6d00e2d8aef5b3dee6e70e486), [`4dc8a46`](https://github.com/nextlyhq/nextly/commit/4dc8a464f0d149a8075e49eb34ed2d10c80eb51a), [`a4c6092`](https://github.com/nextlyhq/nextly/commit/a4c6092ea288d7ae67858f5087c821231a9776de), [`9653096`](https://github.com/nextlyhq/nextly/commit/9653096008a39ab4502e55d33bb8dc2379fc5b27)]:
  - nextly@0.0.2-alpha.51
  - @nextlyhq/plugin-sdk@0.0.2-alpha.51

## 0.0.2-alpha.50

### Patch Changes

- [#436](https://github.com/nextlyhq/nextly/pull/436) [`5e64acc`](https://github.com/nextlyhq/nextly/commit/5e64accfe7b86cc7a49717d636db91698f3af8af) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `beforeOperation` hooks are now declared and registered as what they are. They receive the operation's `args` -- the data, id or where clause it is about to use -- rather than a document, so they are typed as `BeforeOperationHandler` and registered through `registerBeforeOperation()` / `registerBeforeOperationHook()`. Previously they were declared as ordinary hook handlers, so a handler written against the documented type read `context.data` and got `undefined`. Handlers for the other eight phases are unaffected.

- [#455](https://github.com/nextlyhq/nextly/pull/455) [`80fdee6`](https://github.com/nextlyhq/nextly/commit/80fdee610bb7b60e85ff179a84f10ed16d30ba30) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block that supplies its own editor component now loads without a hand-written import.

  A block can name a custom inspector or canvas component through `editor.component`. That is a component path like any other admin contribution, so it now goes into the generated admin import map alongside plugin pages, settings and views — the editor bundle picks it up with no host wiring.

  Paths are read from what plugins declare, so generation needs no plugin to boot. A block registered imperatively at runtime contributes no path, the same rule the block manifest follows. An app whose only components come from blocks now gets an import map too, where before none was written.

- [#450](https://github.com/nextlyhq/nextly/pull/450) [`7a36ab6`](https://github.com/nextlyhq/nextly/commit/7a36ab616df206189b5e3f9ca8c19058af480222) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly generate:types` now writes a block manifest listing every block your plugins declare.

  Until now the only way to ask what blocks an app has was to boot it and inspect the registry, which is not available to an editor build, a docs page, or an agent writing a page document. The manifest states it as a file beside your generated types: each block's name, schema version, description, worked example, prop schemas, style capabilities, slots, and the plugin that declared it.

  It is written from what plugins declare rather than from the running registry, so generation stays a pure read of your config: no plugin boots and no database opens. Blocks registered imperatively at runtime are not listed, because they cannot be known without running the plugin. No file is written when nothing declares a block.

- [#476](https://github.com/nextlyhq/nextly/pull/476) [`6cb97df`](https://github.com/nextlyhq/nextly/commit/6cb97df9b31058cfc6bd2a940d20a30afbd590ae) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections and singles created through the Schema Builder now get their system columns from the same definition the runtime schema and the migration diff already use, instead of a separate hand-written copy.

  The copy had drifted. A Builder-created table declared `createdAt` and `updatedAt` as required while the rest of Nextly described them as optional, so `nextly db:sync` proposed a change to those columns on every Builder collection, and applying it rebuilt the table. On SQLite that rebuild also dropped the timestamp defaults. Both now agree, and the sync proposes nothing.

  Newly created Builder tables declare the two timestamp columns as optional. Existing tables are brought in line by one schema sync, which preserves their rows.

  The practical effect is that a system column added to Nextly in future reaches Builder-created tables as well as code-first ones. Previously it reached only code-first tables, and reading a Builder collection or single failed with a missing-column error.

- [#480](https://github.com/nextlyhq/nextly/pull/480) [`3b39129`](https://github.com/nextlyhq/nextly/commit/3b391290b06a5161bedda88a9069c98573ec02ad) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dev-server config reload now applies hook edits only when the reload advanced the runtime in every dimension. Previously a reload that applied part of a config — one collection's schema change refused while others landed, or a field-tree sync that failed for a scope — could still publish the new handlers, leaving them running against tables and serialized field metadata the save had not reached. A hook edit that shares a save with a refused schema change now takes effect on the next save instead; a hook edit on its own changes no table, so it still applies immediately.

- [#441](https://github.com/nextlyhq/nextly/pull/441) [`55d3aa6`](https://github.com/nextlyhq/nextly/commit/55d3aa61153f0713495fdb1b4eca92e22ec47b42) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now add its own blocks to the page builder.

  The page builder exposes its block registry as a service, and a contributing plugin reaches it from `init` with `blockRegistry(ctx).register(myBlocks)`. Registering this way rather than by importing the engine is what makes the timing safe: the block registry is cleared and rebuilt on every boot, so a direct call can land before the rebuild and lose the blocks with no error, while services are recorded before any plugin's `init` runs. Each block is attributed to the plugin that registered it, taken from that plugin's own identity, so a name collision names the packages actually responsible.

  `defineBlock` and the block types come from `@nextlyhq/plugin-sdk/blocks`, keeping the SDK the one stable surface a plugin author imports from while a plugin that has nothing to do with blocks never pulls the engine into its type graph. The registry itself comes from `@nextlyhq/plugin-page-builder/blocks`, since it belongs to that plugin rather than to core. Custom supports are registered through the same service as blocks, so both share the per-boot reset and neither collides on a second boot. Nextly core is unchanged: it carries no blocks contribution key and does not depend on the block engine, because contributing blocks is contributing to the page builder rather than to the framework.

- [#464](https://github.com/nextlyhq/nextly/pull/464) [`a3b1f48`](https://github.com/nextlyhq/nextly/commit/a3b1f4893e14929c959da85d1ef6a8a210160140) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Editing a published entry on a drafts-enabled collection now works as a proper draft and publish flow.

  When a collection has drafts enabled, editing a published entry saves your changes as a pending working draft instead of overwriting what is live. The editor shows a "Changed" status while a draft is pending, a Publish button promotes it to the live document, and a confirmed "Discard draft" action throws the pending edits away and restores the published version. The read API also surfaces the working draft to a trusted editor through `?draft=true`.

- [#428](https://github.com/nextlyhq/nextly/pull/428) [`341890f`](https://github.com/nextlyhq/nextly/commit/341890fa15e1c403a9b4b886221e67b18d17e218) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now edit a published document without changing what visitors see.

  Saving changes to a published document (without choosing Publish) now keeps them as a pending draft: the live version stays exactly as it was until you publish. Clicking Publish brings the whole pending draft live at once, including fields the Publish action itself did not resend, and Unpublish does the same in reverse while returning the document to draft. Trusted editors see their pending edits when they open the document; anonymous and published-only reads always get the live version. This applies to non-localized collections that have draft/published status with drafts-enabled versioning; localized collections are unchanged for now.

- [#451](https://github.com/nextlyhq/nextly/pull/451) [`9586432`](https://github.com/nextlyhq/nextly/commit/9586432d7f5f3fc0798f1fc2696682b48309c9f9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a `draft` read option to fetch a document's pending working draft.

  `nextly.findByID({ collection, id, draft: true })` and the REST `?draft=true` query parameter now return a published document's pending working draft in place of the live version. Access is gated on edit capability: a caller who cannot update the document still receives the published version, so this never exposes a draft to a read-only reader. Only non-localized collections with draft/published status and drafts-enabled versioning have a working draft to return.

- [#434](https://github.com/nextlyhq/nextly/pull/434) [`b8c4941`](https://github.com/nextlyhq/nextly/commit/b8c494143e5ef8c545518e331e4404161947af86) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Groundwork for the field group storage migration. The engine can now plan a complete run in either direction and resume one that was interrupted. A rename also carries the pointers that address the table it moves: a field group nested inside another records its parent by physical table name, so renaming the parent without rewriting those records would leave the nested content in place but unreachable, and reads would return nothing rather than fail.

  Nothing runs it yet. No command invokes the migration and no database is changed by installing this; the entry point ships separately, once the engine is covered end to end against real PostgreSQL, MySQL and SQLite servers.

- [#463](https://github.com/nextlyhq/nextly/pull/463) [`a8f7a78`](https://github.com/nextlyhq/nextly/commit/a8f7a78bac918534acb8ee26892531758d6b05cf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A write refused inside a field group is now reported as the refusal it is. A blank required field returned a generic server error with no per-field detail, because every dialect adapter re-classified anything thrown out of a transaction as a database failure — including an error the application raised deliberately to roll the write back. Collections were affected on create and update; singles already behaved correctly.

- [#459](https://github.com/nextlyhq/nextly/pull/459) [`5d962d2`](https://github.com/nextlyhq/nextly/commit/5d962d20a9438845fbd22a66d90e9517fe1f2e14) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field validators inside a field group now receive the write's request context, so a plugin field type whose rule depends on `req.user` behaves the same nested in a field group as it does at the top level. Previously that rule saw an empty context and accepted every value.

  Adds `nextly generate:manifest`, which emits the block manifest on its own, and `--check`, which writes nothing and fails when the committed manifest no longer matches the config. The manifest also publishes its own schema, and generation now refuses to write a document that schema would reject.

- [#469](https://github.com/nextlyhq/nextly/pull/469) [`13e3578`](https://github.com/nextlyhq/nextly/commit/13e3578fb6a7575c115f41f1d8e8d3eef24eedeb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema applies and the `nextly migrate` / `nextly upgrade --reconcile-core` commands now address the field-group registry and each field group's storage by the names the database actually holds, instead of the names this release would have created. Without this, a database whose field-group storage had been renamed could have an empty second registry created beside the populated one, after which the app would read the empty one and its field groups would appear to be gone.

- [#472](https://github.com/nextlyhq/nextly/pull/472) [`84f8a15`](https://github.com/nextlyhq/nextly/commit/84f8a15b5e27ab8d98a4518524495e306bb5ba83) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group storage migration now re-checks the ledgers it rewrote before it settles, and refuses rather than reporting success when a row still carries the old vocabulary. Without this, content written while the migration was running could be left in the old format and the run would complete silently, with the problem only appearing in a much later release.

- [#454](https://github.com/nextlyhq/nextly/pull/454) [`11f75b5`](https://github.com/nextlyhq/nextly/commit/11f75b5c9191f71f7e5cb4628c7338a69635ce24) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-group storage is now addressed by the name the database actually holds.

  The storage migration renames the field-group registry table and each data table's type discriminator. Every reader resolves those names from the database catalog instead of a constant, so a database that has run the migration and one that has not are both read correctly by the same build. Nothing about stored data changes, and a database that has not migrated behaves exactly as before.

- [#429](https://github.com/nextlyhq/nextly/pull/429) [`151efce`](https://github.com/nextlyhq/nextly/commit/151efce4c877543c9e390954b2c4dad6ee43fc97) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Turning localization off in `nextly.config.ts` now brings your content back onto the main table. Previously only the Schema Builder toggle did this, so setting `localized: false` in configuration left every translation in a table nothing read any more and fell back to whatever the entity held before it was localized. Turning localization on again no longer trusts the stale rows that companion still holds.

  Enabling localization and Draft/Published in the same edit now applies. It used to fail part-way and could never succeed on a retry, because the copy read a `status` column the schema push had not added yet.

  Saving a localized entity is faster, and on PostgreSQL a class of failure is gone. Every localized write used to ask the database whether each translation table existed — once per entity, plus once per field-group type in the payload, before the write and again inside it. That answer is now resolved once and remembered. The read that builds the response used to discover the same thing by running its query and catching the failure, which on PostgreSQL aborts the whole transaction: writes that should have succeeded failed with `current transaction is aborted`, blaming an unrelated statement.

  When a translation write is refused, the message now names the right fix for where you are running. Production is told to run `nextly migrate` instead of `nextly db:sync`, which is a development tool and cannot help there — and `nextly migrate` now creates missing translation tables and repairs installs that enabled localization before Nextly began recording it.

  Turning localization off now brings an entry's publishing state back with its content. Publishing is per language while an entity is localized, so an entry published only under a language that is no longer your default carried that state on its translation row alone — and restoring the content without it could put a draft in front of the public, or make live content disappear.

  Two processes enabling localization for the same entity at once — a `db:sync` alongside a running dev server, say — no longer both do the work. Only one holds the transition; the other stops and says so, instead of racing to seed the same rows or overwriting translations written since the first one finished.

  If you open your own transaction and call `createEntryInTransaction` / `updateEntryInTransaction` / `deleteEntryInTransaction` (or their batch equivalents), call `warmLocalizedReadiness(collectionName)` before you open it. Nothing fails if you do not, which is why it is worth knowing: the write commits, but the version history it records and the webhook event it sends will be missing every translated value from your localized components.

- [#452](https://github.com/nextlyhq/nextly/pull/452) [`6536365`](https://github.com/nextlyhq/nextly/commit/653636534f5389c580a55c8b099b226d87705670) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Turning localization off now brings an entry back with the publishing state it was actually published under. Publishing is per language while an entity is localized, so an entry published only under a language that is not your default carried that state on its translation row alone — and the disable drops that table straight after restoring, so the state was lost for good. A draft could become publicly visible, or live content disappear.

- [#440](https://github.com/nextlyhq/nextly/pull/440) [`ed94b78`](https://github.com/nextlyhq/nextly/commit/ed94b7849555afc7cd86d2dd2e21ff659d886098) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin options on a code-defined user field are no longer refused when two of them share a reference, and a sparse array in them is now rejected rather than silently reshaped.

  The JSON-shape check treated every object it had already visited as a cycle, so one object referenced from two places within a single option was refused even though it serializes correctly at both. It now tracks only the objects on the active path. It also walked arrays with a method that skips holes, so a sparse array passed the check and then had each hole written as `null`, handing the plugin's component different data than was declared.

- [#442](https://github.com/nextlyhq/nextly/pull/442) [`5785ee5`](https://github.com/nextlyhq/nextly/commit/5785ee5e89db3c5683abd175cb9758f5901f44dc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Apply read hooks per collection, and hand them the values a caller sees.

  A read hook that reads a different collection now runs that collection's own
  hooks instead of silently skipping them, so a hook cannot reach rows the other
  collection withholds. A hook reading the collection it is already running for
  still skips them, which is what stops it calling itself without end.

  `afterRead` is now handed decoded JSON values rather than the storage encoding
  SQLite returns, so a hook reads the value the field was configured with instead
  of a string. Field hooks are also declared with the context they are actually
  given, which includes the field's value and name.

- [#468](https://github.com/nextlyhq/nextly/pull/468) [`375d796`](https://github.com/nextlyhq/nextly/commit/375d79683afa6879235e7c8e6ebf2eb0fbb281ed) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On MySQL, the internal description of a collection table's `created_at` and `updated_at` columns said they had no database default, while the tables actually created for them do have one (`CURRENT_TIMESTAMP`). The schema comparison that decides what a migration should contain was reading the description rather than reality, so it could see a difference that was not there. The description now matches what is created.

- [#460](https://github.com/nextlyhq/nextly/pull/460) [`cbaa8d8`](https://github.com/nextlyhq/nextly/commit/cbaa8d8ed96cb0c6fb5a9ad47f35dc73c4c0aa8e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Run collection and single `beforeChange` hooks after validation, not before

  A `beforeChange` handler declared on a collection or single used to be
  registered onto the `beforeCreate`/`beforeUpdate` queue, which fires before the
  schema rules are enforced. The phase documented as the last chance to shape a
  stored value therefore ran on data that had not been validated, and it ran even
  for writes that were about to be rejected. The field-level hook of the same name
  was already in the right place, so the two `beforeChange`s meant different
  moments.

  `beforeChange` is now its own phase, executed immediately after the validation
  gate on every write path: collection create and update, both of their
  transactional forms, the transactional single paths, and the single update
  service.

  Singles gain `beforeValidate`, which they did not have. Moving `beforeChange`
  past the gate would otherwise leave a single with no hook running before
  validation at all, so the phase takes the pre-validation execution point
  `beforeChange` vacated. A single and a collection now agree on both phases.

  This changes when existing handlers run. A `beforeChange` that SUPPLIES a value
  the schema requires now runs too late to satisfy it, because validation has
  already been applied; move that work to `beforeValidate`, which runs before the
  gate on collections and singles alike. This includes the Schema Builder's
  pre-built "Auto-generate Slug" hook when it targets a required field of your
  own. The framework's own `slug`/`title` derivation is unaffected: it does not
  run as a hook.

  What a `beforeChange` handler returns is written without being re-validated.
  That is the point of the phase, and it is now true rather than accidental.

- [#443](https://github.com/nextlyhq/nextly/pull/443) [`bdcde29`](https://github.com/nextlyhq/nextly/commit/bdcde29f9250b8fa9a530504e10f0341bbf63715) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Clear the hook registry when services shut down.

  The registry is process-global and outlives the DI container, but handlers are
  registered from config on every init. Re-initializing in one process therefore
  left the previous instance's handlers in place and appended a fresh copy of
  each, so every hook ran twice per operation and the dead instance's handlers
  ran alongside the new ones.

- [#467](https://github.com/nextlyhq/nextly/pull/467) [`8a4d4a3`](https://github.com/nextlyhq/nextly/commit/8a4d4a3bafd329268175a1c60eefa5bd3eaa7b6f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bind the Direct API for hook contexts at registration

  `req.nextly` is now bound for hook contexts from the moment services are
  registered. It previously resolved through a binding that `getNextly()` created
  as a side effect of its first call, so a process that never called it — which is
  any REST or admin write — handed every hook `undefined`, including the worked
  example in the collections guide.

- [#473](https://github.com/nextlyhq/nextly/pull/473) [`9dfbd80`](https://github.com/nextlyhq/nextly/commit/9dfbd80af303d21c875bf95cd35e4838389e1e3d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Apply hook edits without restarting the dev server

  Editing a hook in `nextly.config.ts` had no effect until the process restarted,
  and deleting one left it firing. A config reload re-read the file but the
  registry kept the function objects registered at boot, so the hook that ran was
  always the one from startup.

  Collection and single hooks are now rebuilt from the reloaded config. Clearing
  them is safe because the registry records who registered each handler: a
  reload replaces only what it can rebuild, and leaves alone both a plugin's hooks
  (the form builder registers directly on `forms`, and plugins do not re-run on a
  config reload) and any registered imperatively through `registerHook()` (nothing
  re-runs those at all). Unregistering is likewise scoped to the caller's own
  registrations, so a plugin removing a handler it shares with the config no
  longer removes the config's instead.

  A save that changes a hook and a schema at once is handled as one unit: the new
  handlers are published only once the schema they were written against has landed,
  so a request served while the reload is still running never sees a hook reaching
  for a column that is not there yet, and a refused schema change leaves the
  previous handlers in place. Replacing them also keeps their position, so a config
  save no longer reorders a chain it is not changing. Switching a plugin to `enabled: false`
  now stops everything it contributed -- the hooks its collections and singles
  declared, and the ones it registered itself, which are suspended rather than
  dropped so re-enabling it in the same session brings them straight back. Deleting
  or renaming a collection stops its hooks too: a removed entity's table is kept until `nextly prune`, so it stayed
  addressable and went on running hooks its config no longer declared.

  Deleting a plugin from the config stops its hooks as well as disabling it does,
  and a plugin that was disabled stays that way when it is later removed.

  Registering straight into the registry that `getHookRegistry()` hands out now
  marks the handler as the app's, matching `registerHook()`. Only the registrars
  that read the config claim ownership a reload may replace, so a handler nothing
  can rebuild is never removed by one.

- [#445](https://github.com/nextlyhq/nextly/pull/445) [`d20e9d3`](https://github.com/nextlyhq/nextly/commit/d20e9d3b1e9f54fe50049e117d0bdc140cf8e5df) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a typed error's status and code across the service boundary.

  A service raising `authRequired`, `rateLimited`, `serviceUnavailable` or any
  other 401 reached a REST caller as a generic 500, because the boundary rebuilt
  errors from their HTTP status and only four statuses had a branch. A 400 was
  rebuilt as a validation failure whatever code it carried, so a caller was told
  its data failed validation when it had not been validated.

  Errors are now rebuilt from the canonical code the envelope already carried,
  with the status mapping kept as the fallback for envelopes that carry no code.

- [#449](https://github.com/nextlyhq/nextly/pull/449) [`3dc6927`](https://github.com/nextlyhq/nextly/commit/3dc6927e426fa1b5c9a0f349babf7407c526e014) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field masked by its collection stays masked when read through a relationship.

  A field's `afterRead` hooks are how it masks itself on the way out, and they ran
  only when the collection was read directly. Reaching the same row through a
  relationship returned the unmasked value. They now run over the assembled
  document, so a nested row gets its own collection's treatment at every depth,
  and a hook that masks based on the row's own relations sees them expanded
  rather than as raw ids.

- [#446](https://github.com/nextlyhq/nextly/pull/446) [`4e5064e`](https://github.com/nextlyhq/nextly/commit/4e5064e42111d327e745ec629c1625442700ffe3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now declare data for another plugin statically, and the page builder registers contributed blocks from it.

  `contributes.declarations` is the static counterpart to `contributes.services`. A service is a factory, so what it provides is knowable only once a plugin has booted — and `nextly generate:types` boots nothing, reading the config alone. A capability offered only through a service is therefore invisible to generation and cannot appear in generated types, an import map, or a manifest.

  A block contributor can now declare its blocks instead of registering them by hand, and the page builder registers them at boot from the same declaration the tooling reads, attributed to the plugin that declared them. Registering imperatively from `init` still works for a plugin whose block list depends on runtime state.

- [#438](https://github.com/nextlyhq/nextly/pull/438) [`7b0dddf`](https://github.com/nextlyhq/nextly/commit/7b0dddf13fef1e17f0919e6add4591b7aa45cafd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now states the core version it actually needs, an empty default is checked against the column it will occupy, and a user field's plugin options are refused when JSON cannot hold them unchanged.

  `@nextlyhq/plugin-page-builder` requires `nextly` 0.0.2-alpha.49 or newer, the release that first exports `pluginField`. Installed against an older core it now fails at install rather than throwing when a `blocks()` field is evaluated.

  A single's default that resolves to an empty value is validated against the field's storage primitive and its type's own rules, instead of being treated as a field the writer left alone; a number-backed default of `""` no longer reaches the insert. Options declared on a code-defined user field are refused when they are values JSON cannot represent — a `Date`, `Set`, `Map`, `BigInt`, function or cycle — which previously either reached the admin component reshaped or failed the whole startup sync.

- [#435](https://github.com/nextlyhq/nextly/pull/435) [`082fa67`](https://github.com/nextlyhq/nextly/commit/082fa67aa50eac4f351a1fecae6f37b543f0a525) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin field types now work on every surface that accepts fields, and a column added to an existing table gets the same storage class the ORM binds.

  A contributed field type can be declared in `contributes.extend` and `defineFieldGroup`, not just in collections and singles, and `pluginField()` keeps the shape it was given so a plugin's own factory stays typed. The page builder exports `isBlocksField` again and reaches core only through `@nextlyhq/plugin-sdk`, which now carries the field contracts a contributed type needs; it also states the core version its `blocks()` factory actually requires, so installing it against an older core fails at install rather than at runtime.

  A contributed default is checked against the type's storage primitive before it reaches the database, disabling a plugin no longer leaves its empty-value callback registered, and `nextly build` and `migrate:check` now refuse a field type no installed plugin offers instead of generating types for a schema production would reject. Field names are validated even when the field's type is deferred to boot, so a duplicate or SQL-reserved name can no longer reach schema generation.

  Plugin options declared on a code-defined user field are persisted and reach the contributed admin component, and a `number` field added to an existing table is created as the integer the ORM binds rather than NUMERIC/DECIMAL/REAL, honouring `dbType: "decimal"` and `format: "float"` for fields that ask for fractions.

- [#456](https://github.com/nextlyhq/nextly/pull/456) [`1bc29b5`](https://github.com/nextlyhq/nextly/commit/1bc29b5b97ab7d7efce8a8aef829b26a9ff58818) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Editing a published entry's title no longer changes its URL. The slug follows the title while an entry is still a draft and stops once the entry has a public address, at which point it changes only if you edit it yourself. Previously a title edit silently retired the published address and every link to it started returning a not-found page.

  An entry counts as publicly addressed in three cases, each of which was a way to lose a URL: it is published wherever its slug is served; it lives in a collection with no draft/published lifecycle, where saving is publishing; or you have published it at least once while the editor has been open, so unpublishing to make an edit does not put the address back up for grabs.

  Where the slug is served depends on the slug field. The slug a collection gets by default is shared across languages, so one address serves all of them and any published language keeps it frozen: editing the title of a German draft no longer rewrites the URL the published English version is being served at. A slug you have explicitly localized is genuinely per language, and follows only that language's status.

  When you do change a public entry's slug, the editor says so before you save: the public URL changes and the old one stops working. That notice now also appears in the quick-edit form opened from a relationship field, and it clears once the change is saved rather than lingering against the URL you already replaced.

- [#439](https://github.com/nextlyhq/nextly/pull/439) [`f2c6e97`](https://github.com/nextlyhq/nextly/commit/f2c6e97130953b7a8e70542bc72cb9619942de32) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read hooks now shape the query they precede. `beforeOperation` receives the caller's own `where` (it was handed an empty one), `beforeRead` receives what `beforeOperation` settled on, and `beforeRead's` return narrows the rows the read returns instead of being discarded. `countEntries` runs the same chain, so a total describes the same rows a list would return rather than counting rows the list withheld.

- [#474](https://github.com/nextlyhq/nextly/pull/474) [`7c3b9f2`](https://github.com/nextlyhq/nextly/commit/7c3b9f299a1528bb172e959dcd4efd9b15971905) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On SQLite, the `createdAt` and `updatedAt` columns of collection and single tables now carry a database default, matching PostgreSQL and MySQL and matching what the Schema Builder has always created.

  Nextly sets both on every write, so content created through the admin panel or the API is unaffected. The difference shows up for rows written another way, such as a direct insert or a data import: on SQLite those stored no timestamp at all, and the value read back as null.

  Existing SQLite tables pick the default up on the next schema sync, which rebuilds the affected tables in place and preserves their rows. Rows that already hold a null timestamp keep it, because a default applies only to inserts that omit the column.

- [#481](https://github.com/nextlyhq/nextly/pull/481) [`e604c52`](https://github.com/nextlyhq/nextly/commit/e604c524d5768c1d8227952b686e0af16d01be8e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `createTestNextly` no longer resolves the Direct API while building its return value. `t.nextly` is now resolved when it is read. Resolving it registers the `nextlyDirectAPI` container binding as a side effect, and that binding is where a hook's `req.nextly` comes from, so the old eager call meant the binding always existed under the harness whatever the code under test did. Property access is unchanged for callers; a test that wants to assert something about `req.nextly` should do so before reading `t.nextly`.

- [#479](https://github.com/nextlyhq/nextly/pull/479) [`f7fb1fb`](https://github.com/nextlyhq/nextly/commit/f7fb1fb1c511543fda08f2f3dbf9b3e64ae9ebb7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` no longer fails outright when a localized project's companion table already exists but holds no rows yet, which is what a dev-server boot leaves behind. A project whose companion was already filled by `db:sync` still needs the follow-up fix to `migrate:create`.

- [#447](https://github.com/nextlyhq/nextly/pull/447) [`ab6795f`](https://github.com/nextlyhq/nextly/commit/ab6795fb64034f4cde61b5e06f7cb18b325876e7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A hook that throws after the write has committed no longer fails the write.

  `afterCreate`, `afterUpdate` and `afterDelete` run once the row is durable, and
  a throw there reported the operation as failed with no entry returned. Callers
  could not learn the id of the row that existed, and a retry wrote it a second
  time. These phases now report their failures instead of raising them: the
  operation succeeds, the error is logged with its phase and collection, and the
  remaining handlers still run. `beforeCreate` and the other pre-write phases are
  unchanged -- refusing a write is what they are for.

- [#475](https://github.com/nextlyhq/nextly/pull/475) [`f75c29f`](https://github.com/nextlyhq/nextly/commit/f75c29f2ad3092ea32f55cc999e31d20eacb7a07) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group storage migration now re-checks the collection, single and field-group registries before it settles, so a definition saved while a run is in flight can no longer leave a database reporting success over storage that is only partly migrated.

- Updated dependencies [[`5e64acc`](https://github.com/nextlyhq/nextly/commit/5e64accfe7b86cc7a49717d636db91698f3af8af), [`80fdee6`](https://github.com/nextlyhq/nextly/commit/80fdee610bb7b60e85ff179a84f10ed16d30ba30), [`7a36ab6`](https://github.com/nextlyhq/nextly/commit/7a36ab616df206189b5e3f9ca8c19058af480222), [`6cb97df`](https://github.com/nextlyhq/nextly/commit/6cb97df9b31058cfc6bd2a940d20a30afbd590ae), [`3b39129`](https://github.com/nextlyhq/nextly/commit/3b391290b06a5161bedda88a9069c98573ec02ad), [`55d3aa6`](https://github.com/nextlyhq/nextly/commit/55d3aa61153f0713495fdb1b4eca92e22ec47b42), [`a3b1f48`](https://github.com/nextlyhq/nextly/commit/a3b1f4893e14929c959da85d1ef6a8a210160140), [`341890f`](https://github.com/nextlyhq/nextly/commit/341890fa15e1c403a9b4b886221e67b18d17e218), [`9586432`](https://github.com/nextlyhq/nextly/commit/9586432d7f5f3fc0798f1fc2696682b48309c9f9), [`b8c4941`](https://github.com/nextlyhq/nextly/commit/b8c494143e5ef8c545518e331e4404161947af86), [`a8f7a78`](https://github.com/nextlyhq/nextly/commit/a8f7a78bac918534acb8ee26892531758d6b05cf), [`5d962d2`](https://github.com/nextlyhq/nextly/commit/5d962d20a9438845fbd22a66d90e9517fe1f2e14), [`13e3578`](https://github.com/nextlyhq/nextly/commit/13e3578fb6a7575c115f41f1d8e8d3eef24eedeb), [`84f8a15`](https://github.com/nextlyhq/nextly/commit/84f8a15b5e27ab8d98a4518524495e306bb5ba83), [`11f75b5`](https://github.com/nextlyhq/nextly/commit/11f75b5c9191f71f7e5cb4628c7338a69635ce24), [`151efce`](https://github.com/nextlyhq/nextly/commit/151efce4c877543c9e390954b2c4dad6ee43fc97), [`6536365`](https://github.com/nextlyhq/nextly/commit/653636534f5389c580a55c8b099b226d87705670), [`ed94b78`](https://github.com/nextlyhq/nextly/commit/ed94b7849555afc7cd86d2dd2e21ff659d886098), [`5785ee5`](https://github.com/nextlyhq/nextly/commit/5785ee5e89db3c5683abd175cb9758f5901f44dc), [`375d796`](https://github.com/nextlyhq/nextly/commit/375d79683afa6879235e7c8e6ebf2eb0fbb281ed), [`cbaa8d8`](https://github.com/nextlyhq/nextly/commit/cbaa8d8ed96cb0c6fb5a9ad47f35dc73c4c0aa8e), [`bdcde29`](https://github.com/nextlyhq/nextly/commit/bdcde29f9250b8fa9a530504e10f0341bbf63715), [`8a4d4a3`](https://github.com/nextlyhq/nextly/commit/8a4d4a3bafd329268175a1c60eefa5bd3eaa7b6f), [`9dfbd80`](https://github.com/nextlyhq/nextly/commit/9dfbd80af303d21c875bf95cd35e4838389e1e3d), [`d20e9d3`](https://github.com/nextlyhq/nextly/commit/d20e9d3b1e9f54fe50049e117d0bdc140cf8e5df), [`3dc6927`](https://github.com/nextlyhq/nextly/commit/3dc6927e426fa1b5c9a0f349babf7407c526e014), [`4e5064e`](https://github.com/nextlyhq/nextly/commit/4e5064e42111d327e745ec629c1625442700ffe3), [`7b0dddf`](https://github.com/nextlyhq/nextly/commit/7b0dddf13fef1e17f0919e6add4591b7aa45cafd), [`082fa67`](https://github.com/nextlyhq/nextly/commit/082fa67aa50eac4f351a1fecae6f37b543f0a525), [`1bc29b5`](https://github.com/nextlyhq/nextly/commit/1bc29b5b97ab7d7efce8a8aef829b26a9ff58818), [`f2c6e97`](https://github.com/nextlyhq/nextly/commit/f2c6e97130953b7a8e70542bc72cb9619942de32), [`7c3b9f2`](https://github.com/nextlyhq/nextly/commit/7c3b9f299a1528bb172e959dcd4efd9b15971905), [`e604c52`](https://github.com/nextlyhq/nextly/commit/e604c524d5768c1d8227952b686e0af16d01be8e), [`f7fb1fb`](https://github.com/nextlyhq/nextly/commit/f7fb1fb1c511543fda08f2f3dbf9b3e64ae9ebb7), [`ab6795f`](https://github.com/nextlyhq/nextly/commit/ab6795fb64034f4cde61b5e06f7cb18b325876e7), [`f75c29f`](https://github.com/nextlyhq/nextly/commit/f75c29f2ad3092ea32f55cc999e31d20eacb7a07)]:
  - nextly@0.0.2-alpha.50
  - @nextlyhq/plugin-sdk@0.0.2-alpha.50

## 0.0.2-alpha.49

### Patch Changes

- [#425](https://github.com/nextlyhq/nextly/pull/425) [`50a9655`](https://github.com/nextlyhq/nextly/commit/50a96556f3bf81ae51458531002befe0ee70f9ff) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The `blocks` field type now comes from `@nextlyhq/plugin-page-builder` instead of core.

  **Breaking, and it needs a one-line change.** `blocks()` and the blocks document types were exported from `nextly/config`. They now come from `@nextlyhq/plugin-page-builder`, and the field only exists when that plugin is installed:

  ```diff
  -import { blocks } from "nextly/config";
  +import { blocks } from "@nextlyhq/plugin-page-builder";
  ```

  Nothing about a stored document changes. Existing columns, values and documents are untouched; only where the field type is declared moves.

  Core shipped this field while being unable to deliver it: a JSON column and a read-only summary, with no editor unless the page-builder plugin was installed, at the cost of a hard dependency on the document engine and a branch in every switch that dispatches on field type. Declared by the plugin, the field arrives with the code that makes it work, and "Blocks" appears in the Schema Builder only when it can actually be used.

  A contributed field type can now be declared from code. `defineCollection` and `defineSingle` refused any token they did not recognise, and a plugin registers its field types when the app boots — after the config bundle has already been evaluated. Every contributed type was therefore unusable code-first, which is why `blocks()` needs this to work at all. An unrecognised token is now deferred to boot, where the registry is populated and the question can actually be answered: a type no installed plugin offers on that surface is refused there instead, with the same error.

  Plugin field types can now declare `emptyValue`: what a field of that type holds when nothing has been written to it. Two paths needed it and had to agree — backfilling a required column added to a table that already has rows, and seeding a required field on a record created without one. Both previously derived that from the storage primitive, so a type storing a structured document got `{}`, which satisfies the column and then fails every read expecting the structure. The value is returned rather than SQL, so core quotes it correctly for each dialect.

- [#420](https://github.com/nextlyhq/nextly/pull/420) [`88d23c9`](https://github.com/nextlyhq/nextly/commit/88d23c9bc763d38be6f5d995b044737a6558ca32) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Run the hooks declared on a code-first collection. `defineCollection({ hooks })` registered nothing at boot, so a declared beforeChange, afterChange, beforeRead or afterRead never ran and the operation reported success regardless.

- [#430](https://github.com/nextlyhq/nextly/pull/430) [`f2c7a5d`](https://github.com/nextlyhq/nextly/commit/f2c7a5de4b9779a1ba9842afe91a7a9473494aca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Groundwork for the field group storage migration: it can now rewrite the vocabulary stored inside rows, not just the tables and columns those rows live in. Stored field definitions, the source path a field group records, the scope a schema event carries, and the type key inside version snapshots and event payloads all move to the field group spelling.

  The two ledgers whose size follows a site history, content versions and the event outbox, are walked in bounded batches that each commit on their own and record how far they got, so an interrupted upgrade resumes near where it stopped instead of starting the table again. Every step then rescans its table rather than trusting that record, so a resume can never report a completeness it did not reach. Nothing calls the migration itself yet.

- [#426](https://github.com/nextlyhq/nextly/pull/426) [`a4f7384`](https://github.com/nextlyhq/nextly/commit/a4f7384e8c8b299ffa6b2ef4f627fa43fc41aae3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a hook's own error type through the hook registry. A hook rejecting input with a validation or permission error had it rebuilt as a generic one; it now passes through with its status, code and field issues intact. Direct API callers receive that error as thrown. REST callers still have some statuses reconstructed at the dispatcher boundary, which is tracked separately.

- [#419](https://github.com/nextlyhq/nextly/pull/419) [`b2bfacb`](https://github.com/nextlyhq/nextly/commit/b2bfacb25df410cbdbeb2bac8d2adcdfea6c4aff) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Enabling localization on a collection, single or field group that already has content no longer hides that content. Previously the code-first path (turning `localized: true` on in `nextly.config.ts`) created an empty translations table, so every localized field read as empty even though the values were still in the database. Turning localization on through the admin Schema Builder always copied the existing values across; now both paths do.

  The existing values are copied into the default language and left in place on the original table as well, so nothing is destroyed if you turn localization back off before running `nextly migrate`.

- [#431](https://github.com/nextlyhq/nextly/pull/431) [`8c52566`](https://github.com/nextlyhq/nextly/commit/8c525663b2420bd0dd470fd46b031c553e179654) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a scaffolded app retry startup after a failed boot. The generated helper marked initialization complete before booting, so when the database or config was unavailable the retry returned early without ever booting.

- [#432](https://github.com/nextlyhq/nextly/pull/432) [`d45ba2b`](https://github.com/nextlyhq/nextly/commit/d45ba2b19972a51cb522ddbb1a022952506be32c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Declare the context a related-row read carries once instead of in each layer that expands a relationship, and type the target table columns such a read uses.

- [#433](https://github.com/nextlyhq/nextly/pull/433) [`d439e64`](https://github.com/nextlyhq/nextly/commit/d439e64b8559da776707e26554248160a75d3bc2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A value returned from an `afterChange` or `afterDelete` hook no longer replaces the row. These phases run after the write has committed, so a later handler and the caller now both see the row that was persisted rather than whatever an earlier handler returned. `beforeChange`, `beforeValidate` and `afterRead` still transform as before.

- Updated dependencies [[`50a9655`](https://github.com/nextlyhq/nextly/commit/50a96556f3bf81ae51458531002befe0ee70f9ff), [`88d23c9`](https://github.com/nextlyhq/nextly/commit/88d23c9bc763d38be6f5d995b044737a6558ca32), [`f2c7a5d`](https://github.com/nextlyhq/nextly/commit/f2c7a5de4b9779a1ba9842afe91a7a9473494aca), [`a4f7384`](https://github.com/nextlyhq/nextly/commit/a4f7384e8c8b299ffa6b2ef4f627fa43fc41aae3), [`b2bfacb`](https://github.com/nextlyhq/nextly/commit/b2bfacb25df410cbdbeb2bac8d2adcdfea6c4aff), [`8c52566`](https://github.com/nextlyhq/nextly/commit/8c525663b2420bd0dd470fd46b031c553e179654), [`d45ba2b`](https://github.com/nextlyhq/nextly/commit/d45ba2b19972a51cb522ddbb1a022952506be32c), [`d439e64`](https://github.com/nextlyhq/nextly/commit/d439e64b8559da776707e26554248160a75d3bc2)]:
  - nextly@0.0.2-alpha.49
  - @nextlyhq/plugin-sdk@0.0.2-alpha.49

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

- Updated dependencies [[`1f81cf3`](https://github.com/nextlyhq/nextly/commit/1f81cf3d2a665a1133be1cd3e43bbbb25eb4992a), [`2f05141`](https://github.com/nextlyhq/nextly/commit/2f0514180faaaf2acde4f0dea3261896afcf302e), [`0538f4f`](https://github.com/nextlyhq/nextly/commit/0538f4f7228493a8f7a28df4e5f7057787f2a80f), [`a4dad07`](https://github.com/nextlyhq/nextly/commit/a4dad074e3acd7cdaccd8291f07e6fdc3f1d72ed), [`83ed5c9`](https://github.com/nextlyhq/nextly/commit/83ed5c9c46a653217d741dae6579bf39b5efcaac), [`0e18a97`](https://github.com/nextlyhq/nextly/commit/0e18a971f7b6ab2a68df575623337fa0c1049a12), [`e1467e8`](https://github.com/nextlyhq/nextly/commit/e1467e858056b48ee61d052a9886a208006739b8), [`21bb5b3`](https://github.com/nextlyhq/nextly/commit/21bb5b3ed9c8c7e731870167a86765f17791eeb4), [`45faba9`](https://github.com/nextlyhq/nextly/commit/45faba9c02f751bd41e4d4e2701ba5de5d286ed5)]:
  - nextly@0.0.2-alpha.48
  - @nextlyhq/plugin-sdk@0.0.2-alpha.48

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

- Updated dependencies [[`f41a985`](https://github.com/nextlyhq/nextly/commit/f41a9857aa3f32000b386aa8ec866e4a5f8d38cc), [`1448488`](https://github.com/nextlyhq/nextly/commit/14484884a1722fb713d9a895749fa65876afe4d7), [`b448e6d`](https://github.com/nextlyhq/nextly/commit/b448e6d0c386492163756bef986ee76b097b8477), [`1e0ef91`](https://github.com/nextlyhq/nextly/commit/1e0ef9171ca53935faa037479e711df37e229913), [`d5568ff`](https://github.com/nextlyhq/nextly/commit/d5568ff456073b5756086fbd6c343b522ada70b9), [`b7e334b`](https://github.com/nextlyhq/nextly/commit/b7e334b47ff56a204454689202bb911a16e4e312), [`77fb550`](https://github.com/nextlyhq/nextly/commit/77fb5500ff93d7679298aae77608ea9c1a0ae460)]:
  - nextly@0.0.2-alpha.47
  - @nextlyhq/plugin-sdk@0.0.2-alpha.47

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

- Updated dependencies [[`4b46b5c`](https://github.com/nextlyhq/nextly/commit/4b46b5c0174f4c8673483e0e2c094f4f14bb808e), [`2685550`](https://github.com/nextlyhq/nextly/commit/268555041b1fc45216cd28649eebb5f4a97482a4), [`b85b799`](https://github.com/nextlyhq/nextly/commit/b85b7992d62c178122b3d794a4082ff333ba5a1f), [`831cf74`](https://github.com/nextlyhq/nextly/commit/831cf74df71a1468bae064d047f28d20ccf9a981), [`5154cc2`](https://github.com/nextlyhq/nextly/commit/5154cc2d2d3083d763cf56977475ef84e33a1b2a), [`d2dabb9`](https://github.com/nextlyhq/nextly/commit/d2dabb962b39ff27b6399e09f6a1ba498c6fdb9b)]:
  - nextly@0.0.2-alpha.46
  - @nextlyhq/plugin-sdk@0.0.2-alpha.46

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

- Updated dependencies [[`0c79043`](https://github.com/nextlyhq/nextly/commit/0c7904333dc20351e7acd631def990de3179802a), [`711e0c5`](https://github.com/nextlyhq/nextly/commit/711e0c542f9b771697a477bf43adc08e2970be52), [`b51f4e8`](https://github.com/nextlyhq/nextly/commit/b51f4e8699dced423aa2cd4c38f12a3a6ddfed10), [`2eeef30`](https://github.com/nextlyhq/nextly/commit/2eeef30a231e6931f90831567baecf8e617117d5), [`768bdc7`](https://github.com/nextlyhq/nextly/commit/768bdc739932e2465f9bf0e59631fcebbd26149e), [`663306a`](https://github.com/nextlyhq/nextly/commit/663306a9518135b3b7f1351758c869a93ec3a63c), [`d135685`](https://github.com/nextlyhq/nextly/commit/d13568500541f9b9154ebaef7293ee17e8ab2236), [`962fd25`](https://github.com/nextlyhq/nextly/commit/962fd25c323b8fd74a59a9d66c2be7a20910c42f)]:
  - nextly@0.0.2-alpha.45
  - @nextlyhq/plugin-sdk@0.0.2-alpha.45

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

- Updated dependencies [[`a44ab69`](https://github.com/nextlyhq/nextly/commit/a44ab6988666317a9596d4019ad5bc1940995141), [`90108db`](https://github.com/nextlyhq/nextly/commit/90108db693079600c7fda5349170711a64d6bb2c), [`655532d`](https://github.com/nextlyhq/nextly/commit/655532d43fbc685466cdb921e046269f5fdf59d1), [`66053c3`](https://github.com/nextlyhq/nextly/commit/66053c30325df31376b06a5dd919754a47648f7d), [`ee20d18`](https://github.com/nextlyhq/nextly/commit/ee20d18c02c71f173354419497d89117e828f8b8), [`22b43f2`](https://github.com/nextlyhq/nextly/commit/22b43f2b8a2c625df1336754df5931fba127a44a), [`f822937`](https://github.com/nextlyhq/nextly/commit/f8229372896cd27f76ba4052e41771bd7a7f912c), [`0febd62`](https://github.com/nextlyhq/nextly/commit/0febd62ec556c1b2529b9fd8aaa26a505cbff066), [`0498e02`](https://github.com/nextlyhq/nextly/commit/0498e02d756072306211bfc6f2a5d02f8cba249e), [`3785345`](https://github.com/nextlyhq/nextly/commit/37853459a306f1323adb04d0c71ddc0a8f6338f9)]:
  - nextly@0.0.2-alpha.44
  - @nextlyhq/plugin-sdk@0.0.2-alpha.44

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

- Updated dependencies [[`648c7f4`](https://github.com/nextlyhq/nextly/commit/648c7f4b5463adb189b31527e7de276e094e00d2), [`7d5a62d`](https://github.com/nextlyhq/nextly/commit/7d5a62dca59fe164dc24eef01df0a4e195430d22), [`6481791`](https://github.com/nextlyhq/nextly/commit/64817910a41ecef468cf551f7b5a7df921bdbb0e), [`ac3afca`](https://github.com/nextlyhq/nextly/commit/ac3afcab430136e8d8c9f5a1176695182fd8417d), [`55bc36e`](https://github.com/nextlyhq/nextly/commit/55bc36e7ac15c074aea049a66ee581d69eba3971), [`732eb44`](https://github.com/nextlyhq/nextly/commit/732eb449f987085cab86130f3231663459d5948e), [`c7a3843`](https://github.com/nextlyhq/nextly/commit/c7a38433d3efdd6bfc21fc69ade2b92040b832e1), [`051f660`](https://github.com/nextlyhq/nextly/commit/051f660b1579c62cdeb9fbb6c729485b6b2733bb), [`0c2c369`](https://github.com/nextlyhq/nextly/commit/0c2c36989bc70ff057d038acd3654702bd4ce625), [`b8bf6d4`](https://github.com/nextlyhq/nextly/commit/b8bf6d4ad9b70105f79a72ee818ea564b055dc63), [`8de5ea3`](https://github.com/nextlyhq/nextly/commit/8de5ea3b67d7bd0454a6522c1c74208f57b9126e), [`521e453`](https://github.com/nextlyhq/nextly/commit/521e453ad2d654da7f137318e1a62a09f3404c6d), [`0da91f5`](https://github.com/nextlyhq/nextly/commit/0da91f5b78494eeb0862fec3f707352f8532efaa)]:
  - nextly@0.0.2-alpha.43
  - @nextlyhq/plugin-sdk@0.0.2-alpha.43

## 0.0.2-alpha.42

### Patch Changes

- [#351](https://github.com/nextlyhq/nextly/pull/351) [`b44b1a3`](https://github.com/nextlyhq/nextly/commit/b44b1a3a8c8264a2e0c3d497bdf0a19d3aab4e84) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - @nextlyhq/plugin-seo now generates a sitemap of your published content and serves it at a public HTTP route under Nextly's dynamic handler (in a scaffolded app, `/admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml`). It lists one URL per published entry across the collections you configure, reflects publishes and edits on the next request, and leaves out drafts and any page marked `noindex`. Configure the site origin with `baseUrl` and per-entry paths with `urlFor`, or disable the route with `sitemap: false`.

- [#356](https://github.com/nextlyhq/nextly/pull/356) [`a24c17e`](https://github.com/nextlyhq/nextly/commit/a24c17ef1d5dfaac61eae93fbe21da273e2565a4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - REST reads now default to published-only. A list, get, or count request to a Draft/Published collection or single with no `?status=` returns only published entries; pass `?status=all` or `?status=draft` to include drafts (subject to your read access rules). Previously these reads defaulted to returning every status, which could expose drafts to any caller.

  An invalid `?status=` value (for example a typo like `?status=pubished`) is now rejected with a 400 instead of being silently treated as "all", so a malformed filter can never widen a read. Trusted server-side Direct API calls are unchanged (they still see every status). The admin panel already requests every status, so editors continue to see their drafts.

- [#353](https://github.com/nextlyhq/nextly/pull/353) [`48f82a8`](https://github.com/nextlyhq/nextly/commit/48f82a83a66eb9777364d5d9b0d8947c2bde767a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - nextly now exports `buildMetadata` from `nextly/runtime`: it maps a content entry's SEO field group (from `@nextlyhq/plugin-seo`) to a Next.js `Metadata` object, so a page's `generateMetadata` becomes a single call instead of a hand-written mapping. It sets the title, description, canonical, OpenGraph, Twitter card, robots (from `noindex`), and hreflang alternates, with per-call fallbacks for blank fields. The `next` dependency is type-only, so importing it never forces `next` at load.

- [#349](https://github.com/nextlyhq/nextly/pull/349) [`9cab18c`](https://github.com/nextlyhq/nextly/commit/9cab18c499e9f42e1a1d9de3abb538f84a555436) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the first-party @nextlyhq/plugin-seo package. Register it in your config to add an SEO field group (title, description, OG image, canonical, noindex) to the collections you name. It is opt-in and framework-agnostic (no Next.js dependency), so it is safe in headless and admin-only projects.

  The plugin SDK now also re-exports the field-authoring factories (`text`, `textarea`, `checkbox`, `upload`, `group`) and the `FieldConfig` type, so plugin authors get the whole authoring surface from `@nextlyhq/plugin-sdk`.

- Updated dependencies [[`80febb5`](https://github.com/nextlyhq/nextly/commit/80febb54de4126cb5f87d9891841dd92b88e7be9), [`a614d3d`](https://github.com/nextlyhq/nextly/commit/a614d3d933a5fa637ce62f9a3591c386263f348b), [`4f39297`](https://github.com/nextlyhq/nextly/commit/4f39297515aef6864bc1d0857c7556316877ab52), [`81204af`](https://github.com/nextlyhq/nextly/commit/81204af2a5e3e3d24bb7e2f7a43cb9dc6cc1c0aa), [`2dec172`](https://github.com/nextlyhq/nextly/commit/2dec17206855a739e80bd35c29bb3530e7257711), [`9ab5f19`](https://github.com/nextlyhq/nextly/commit/9ab5f19c52952db2224e49730c05d1ef3126ded3), [`6f19e60`](https://github.com/nextlyhq/nextly/commit/6f19e6060f21f33e8496fc7dbb30e2ed325e5ec2), [`d0a45d5`](https://github.com/nextlyhq/nextly/commit/d0a45d56d71c49db9d92fb0d20fb02c8fa3bd842), [`b44b1a3`](https://github.com/nextlyhq/nextly/commit/b44b1a3a8c8264a2e0c3d497bdf0a19d3aab4e84), [`c0b3796`](https://github.com/nextlyhq/nextly/commit/c0b3796543e833e0125fbe094e10820835ec8c5d), [`8512d5d`](https://github.com/nextlyhq/nextly/commit/8512d5dfcb9cd517ae2dd70e4357b348267675e5), [`ba3e8f4`](https://github.com/nextlyhq/nextly/commit/ba3e8f4a6099e995f7200491d00dd0b381222e8a), [`a24c17e`](https://github.com/nextlyhq/nextly/commit/a24c17ef1d5dfaac61eae93fbe21da273e2565a4), [`1687ff1`](https://github.com/nextlyhq/nextly/commit/1687ff1af20e02ee201f241dd231775082a44779), [`48f82a8`](https://github.com/nextlyhq/nextly/commit/48f82a83a66eb9777364d5d9b0d8947c2bde767a), [`9cab18c`](https://github.com/nextlyhq/nextly/commit/9cab18c499e9f42e1a1d9de3abb538f84a555436), [`3d48019`](https://github.com/nextlyhq/nextly/commit/3d480190946cb0342ae425dab07093e45d97d169), [`a98cdcf`](https://github.com/nextlyhq/nextly/commit/a98cdcf25e2299ba6a4855656018639e01573e19), [`f0b4fc3`](https://github.com/nextlyhq/nextly/commit/f0b4fc3e33b2d1f407e6c9ebf130d49c2b8efa4b), [`38d50d0`](https://github.com/nextlyhq/nextly/commit/38d50d027bbbe56bf277eddb69dc5abf4edced60)]:
  - nextly@0.0.2-alpha.42
  - @nextlyhq/plugin-sdk@0.0.2-alpha.42
