# @nextlyhq/plugin-mcp

## 0.0.2-alpha.66

### Patch Changes

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

- [#1819](https://github.com/nextlyhq/nextly/pull/1819) [`39c96f3`](https://github.com/nextlyhq/nextly/commit/39c96f3f1248cb5a56bddf8f4d0ae76d9972d577) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can update many entries in one call. `ctx.services.collections` ended at `createMany`: plugin code could write many rows in one call and then had no way to change them in one, elevated or not, so the only batch update available to it was a loop of `updateEntry` calls, each with its own transaction, its own access pass and its own cache flush. `updateMany(slug, entries, opts?)` takes one `{ id, data }` per row, so a single call can apply a different patch to each row, and returns the same `BatchOperationResult` `createMany` returns: partial success, with `errors[].index` indexing the array the caller passed. There is deliberately no by-filter form; `listEntries` and this method compose to the same thing with the rows named, and a filter that matches more than its author meant is the failure a batch write cannot take back. A `locale` is refused by name, as on `createMany`, because the bulk pipeline writes in one pass and cannot store a translation. `@experimental` on the plugin surface until a first-party plugin exercises it.

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

- Updated dependencies [[`da323d5`](https://github.com/nextlyhq/nextly/commit/da323d58366d362dfaadb7a1ab9593dbf98d18b2), [`b87f0d3`](https://github.com/nextlyhq/nextly/commit/b87f0d3d0d6468c17bb9728738a1729b07c74230), [`705926b`](https://github.com/nextlyhq/nextly/commit/705926b091c1e6ab17fd4065d89dfc2d29c094b2), [`4c03302`](https://github.com/nextlyhq/nextly/commit/4c03302fd9a8532e033c2cfb16a878a25408b9d0), [`732da46`](https://github.com/nextlyhq/nextly/commit/732da46718b4e1342ad517d05a276bcfaf45ef8b), [`716adbd`](https://github.com/nextlyhq/nextly/commit/716adbd7b710559b33d9d568f187b310206e6bd5), [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c), [`fda49c2`](https://github.com/nextlyhq/nextly/commit/fda49c2876a4842ed47d4aa142b5bd6ec7f1eaab), [`2bcccdd`](https://github.com/nextlyhq/nextly/commit/2bcccddfbb83b9d9e5a57a555cedb321ed4a85c1), [`793c9c1`](https://github.com/nextlyhq/nextly/commit/793c9c120dbd3525c6b3be4fcc4cb53059a8891d), [`1bfc12e`](https://github.com/nextlyhq/nextly/commit/1bfc12eb4c3122d6e4984d69195f45061d281e5b), [`48967c8`](https://github.com/nextlyhq/nextly/commit/48967c89417abfe6ad1e474eb7ea476b473274e0), [`cadd25b`](https://github.com/nextlyhq/nextly/commit/cadd25b48744ccc5a2658678b4164776e8c22d69), [`83a2e49`](https://github.com/nextlyhq/nextly/commit/83a2e4925aa0c1de40011bbcce25018ee7b9db72), [`419d5f2`](https://github.com/nextlyhq/nextly/commit/419d5f2b7666b42e3c2b02639835b44257401ff3), [`9893b11`](https://github.com/nextlyhq/nextly/commit/9893b119dbdd3fbc1f171b4ed9cf6146388d94bf), [`89f515b`](https://github.com/nextlyhq/nextly/commit/89f515b0d6a9e12a669a4a02ef173264b439a1e9), [`5aae8fc`](https://github.com/nextlyhq/nextly/commit/5aae8fcf9386e47a94de8974c92a76b5727e0e21), [`c80d0da`](https://github.com/nextlyhq/nextly/commit/c80d0dafd69f9825b75e1a33b97aeb7891575c2e), [`9c8d64d`](https://github.com/nextlyhq/nextly/commit/9c8d64d5e41a85d7cf5c76d4e5b7fc66b3134f7c), [`1ca2733`](https://github.com/nextlyhq/nextly/commit/1ca273325ff393fc3dead74febc678985014e16a), [`5992aab`](https://github.com/nextlyhq/nextly/commit/5992aabbae4e25b1a3a672e883c231f1c79336d7), [`a2cd0f3`](https://github.com/nextlyhq/nextly/commit/a2cd0f30c363c10409d6872d799f832422f567ce), [`39c96f3`](https://github.com/nextlyhq/nextly/commit/39c96f3f1248cb5a56bddf8f4d0ae76d9972d577), [`4de79a2`](https://github.com/nextlyhq/nextly/commit/4de79a2137618d5541d45ee0bec95fe4d7e791a2), [`69b9aa5`](https://github.com/nextlyhq/nextly/commit/69b9aa535d9073c5ab693fdb0a86d09f743276ac), [`113f82c`](https://github.com/nextlyhq/nextly/commit/113f82c827874ebace3f8cb4e2a120d6c695883a), [`348ceb9`](https://github.com/nextlyhq/nextly/commit/348ceb93a51cf8fca0ae55ee5dcbb132baeaa015), [`08bce33`](https://github.com/nextlyhq/nextly/commit/08bce33d147922909894f2b00e245aae0e54e9f2), [`cde0bd0`](https://github.com/nextlyhq/nextly/commit/cde0bd0b8bf2425c2afe753c4c058060fcfefd9d), [`9ca0cfd`](https://github.com/nextlyhq/nextly/commit/9ca0cfda21f4c3ddb57e970570b3aead8e36af90), [`10ef8d9`](https://github.com/nextlyhq/nextly/commit/10ef8d95573eebad5bfdd8bd2daebdfb7193f141), [`dc38f47`](https://github.com/nextlyhq/nextly/commit/dc38f4758422964a2ff34fe5556020d552e4b3dc), [`c293917`](https://github.com/nextlyhq/nextly/commit/c293917acd1e74d5d8722696589c31ba69d90bc2), [`4e25eb2`](https://github.com/nextlyhq/nextly/commit/4e25eb229a30824e620457bdf24ffe527ad716be), [`ebd0b24`](https://github.com/nextlyhq/nextly/commit/ebd0b243cd812d63d5cd5f90aa054f6648e671e8), [`e8e8d78`](https://github.com/nextlyhq/nextly/commit/e8e8d7855ca06ce444c9dfaba4ed23b45a64ceb4), [`adfafa3`](https://github.com/nextlyhq/nextly/commit/adfafa36762a24745b69ca1e14367f310940fbce), [`1532b2e`](https://github.com/nextlyhq/nextly/commit/1532b2e28b095a859c02501c4a4b785b2ac01146), [`cd95546`](https://github.com/nextlyhq/nextly/commit/cd9554690379d1620eded8b7d58107ea43f6a669), [`d29c54d`](https://github.com/nextlyhq/nextly/commit/d29c54daca0076cd0c41192946d2056046c66ac4), [`e1605f8`](https://github.com/nextlyhq/nextly/commit/e1605f8b03c0c4111716d426fe0a125e3f174b2c), [`9e59229`](https://github.com/nextlyhq/nextly/commit/9e59229d43ae0a57b2d14bf8c30c651f45bbab52), [`0121364`](https://github.com/nextlyhq/nextly/commit/0121364ce39b6f2780b3500b1a35aff700769af5), [`06f192f`](https://github.com/nextlyhq/nextly/commit/06f192f9b0546085ca3bd700cff0b97fe94206e1), [`2a6f497`](https://github.com/nextlyhq/nextly/commit/2a6f497fe51cb6bc2403bf77b1e929ceeb45b4a0), [`8653c19`](https://github.com/nextlyhq/nextly/commit/8653c19201992cd0243b2927ad017efe1da9a288), [`fe5206e`](https://github.com/nextlyhq/nextly/commit/fe5206ea8f57a9466d20ee4cb28827fcb1011138), [`ea942ba`](https://github.com/nextlyhq/nextly/commit/ea942bacdafeb46e228b88c932ad04a476122c83), [`fe645f1`](https://github.com/nextlyhq/nextly/commit/fe645f17a0492ccc22cb57e0acc11cffaca1ae04), [`0afa12a`](https://github.com/nextlyhq/nextly/commit/0afa12a3300679a97939f463e82702a721d1b505), [`c284753`](https://github.com/nextlyhq/nextly/commit/c28475395a77f334aa45acc75e8f85c439d8e455), [`aa21dbb`](https://github.com/nextlyhq/nextly/commit/aa21dbbb107406f7b6068add48495780c539da10), [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c), [`9563aa3`](https://github.com/nextlyhq/nextly/commit/9563aa3ec7fe14b189797ab3227cdb3bd41666f0), [`110d2bc`](https://github.com/nextlyhq/nextly/commit/110d2bcdcfe19e9a846ea6e40abcc52af5611600), [`075870a`](https://github.com/nextlyhq/nextly/commit/075870acd262c00fa048c63ab9e85568dcede8e7), [`1f4941c`](https://github.com/nextlyhq/nextly/commit/1f4941cb6c84487ee4fc1d554e3fdbda3812dad6), [`c7b8348`](https://github.com/nextlyhq/nextly/commit/c7b834843e3d3b2aae652cbc6d2f07c104289f4e), [`f3ab090`](https://github.com/nextlyhq/nextly/commit/f3ab09095686af3c7ddf831767d90bfce43276c9), [`5702cdc`](https://github.com/nextlyhq/nextly/commit/5702cdc54ef8f97ed319721503ec59a75494818a), [`1bd2187`](https://github.com/nextlyhq/nextly/commit/1bd218792cda7ebb04ef271f1daa1da93041f92b), [`e9adb7b`](https://github.com/nextlyhq/nextly/commit/e9adb7b44f0d23c7ef3b288d4a56009da2a54826), [`0c9ec43`](https://github.com/nextlyhq/nextly/commit/0c9ec43d265b3e468c31ce0c87deb3b3d84edee6), [`81bf0d1`](https://github.com/nextlyhq/nextly/commit/81bf0d16305ebc5f9f7fdd873c65d92b17f739f4), [`73b7cb6`](https://github.com/nextlyhq/nextly/commit/73b7cb60667b1d542e567e180db316ece98da085), [`dd4027c`](https://github.com/nextlyhq/nextly/commit/dd4027ce091e4fff416763e6adf4bd6cd0679767), [`80db282`](https://github.com/nextlyhq/nextly/commit/80db2825804616d8a01ffef09ddd5b685c9eca92), [`91e66a4`](https://github.com/nextlyhq/nextly/commit/91e66a469537bd835408209354fe6da6043b946d), [`1862d9e`](https://github.com/nextlyhq/nextly/commit/1862d9eb29737dfbc41175e7d0da4b87bb53821f), [`3b4b269`](https://github.com/nextlyhq/nextly/commit/3b4b269ac4953c7cdfa38223d6759cdb45d0bb52), [`aaa8c8c`](https://github.com/nextlyhq/nextly/commit/aaa8c8ce271634b7d0404048cb93b34e096ca3d5), [`2b278e7`](https://github.com/nextlyhq/nextly/commit/2b278e7ea0d4453e09b82feab8700ebda9e6ca2a), [`985a438`](https://github.com/nextlyhq/nextly/commit/985a43864958499c8c4216458d2ca41d864663bc), [`52c6f1f`](https://github.com/nextlyhq/nextly/commit/52c6f1f9088c107ef2f2126ffd9b29e8e6a05d64), [`4a34f1e`](https://github.com/nextlyhq/nextly/commit/4a34f1e5a3ecd6327452a342d194fca6f676820e), [`928b982`](https://github.com/nextlyhq/nextly/commit/928b9829b79c0a96e75d97e7f115eb6aa293e51f), [`29bc0da`](https://github.com/nextlyhq/nextly/commit/29bc0dafc4bf0f2ef6e82b5462beb0a1aa7147e2), [`4fbf860`](https://github.com/nextlyhq/nextly/commit/4fbf8608d8ca740783b4c6c2b3348c32ddfa2c3e), [`f9079d0`](https://github.com/nextlyhq/nextly/commit/f9079d066cf7b14c1bfc539d4618f43f841845d9), [`c0c8c52`](https://github.com/nextlyhq/nextly/commit/c0c8c520d2af2f538fd0b423c983b95c15c37ea1), [`001ad57`](https://github.com/nextlyhq/nextly/commit/001ad576aba2869b8e7157538918ee55351d1c9a), [`7176d47`](https://github.com/nextlyhq/nextly/commit/7176d477c907edce488bd815b0d9c4141318c6fa), [`167147a`](https://github.com/nextlyhq/nextly/commit/167147acb291c536f9a3008a076798926a2e2add), [`1f254ff`](https://github.com/nextlyhq/nextly/commit/1f254ffc4af6fe8cc04c31ef815005c3348ee08b), [`49dc8e8`](https://github.com/nextlyhq/nextly/commit/49dc8e8034a6dd68ae29d0d658ba8374add9451f), [`d550908`](https://github.com/nextlyhq/nextly/commit/d55090872d3cb319fcb29bbb4e79ab356ecff963), [`f7d0b6a`](https://github.com/nextlyhq/nextly/commit/f7d0b6afe5fb9b8ebc4ee9c8491b6356732319c3), [`03bf79b`](https://github.com/nextlyhq/nextly/commit/03bf79be79d6918f55011e5fbe1bcb35d3e95aa9), [`8f63701`](https://github.com/nextlyhq/nextly/commit/8f637018bb5db985efb0e19ae220faf1211e83d4), [`6d0e94f`](https://github.com/nextlyhq/nextly/commit/6d0e94f1f152c4ba4e62b9724ff5f85c961fbe31), [`2a8263a`](https://github.com/nextlyhq/nextly/commit/2a8263a3fa218fb47cc9ba43f1ef5c61ff9f521f), [`d58455c`](https://github.com/nextlyhq/nextly/commit/d58455c6e7d90cd8c4aac0fd58839632c01c204a), [`23d36f3`](https://github.com/nextlyhq/nextly/commit/23d36f3f9c9eb92262bcb08e14e68be515f096d8)]:
  - nextly@0.0.2-alpha.66
  - @nextlyhq/plugin-sdk@0.0.2-alpha.66
