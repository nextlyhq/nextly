# @nextlyhq/builder

## 0.0.2-alpha.56

### Patch Changes

- [#633](https://github.com/nextlyhq/nextly/pull/633) [`175ed53`](https://github.com/nextlyhq/nextly/commit/175ed53cc50e162ae65e47fc73c139c254b89ab8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - admin: render the email provider form from the server's provider descriptors

  The provider form no longer knows any provider by name. It fetches the
  registered types and their field metadata from the server and builds the
  picker, the controls and the client-side validation from that, so a provider
  contributed by a plugin is configurable in Settings without editing the admin.

  Dotted field names are treated as paths, so a provider declaring `auth.pass`
  stores `{ auth: { pass } }`, and a credential the user did not touch is
  omitted from the update rather than overwritten with the mask that stood in for
  it. A provider whose plugin has been removed renders read-only with its type
  named instead of as a blank form.

  Also fixes the Active toggle on the edit page, which was rendered and then left
  out of the update payload, so pausing a provider silently did nothing.

  nextly: record who created, changed, promoted or deleted an email provider

  `email_providers` holds the credentials that send password-reset and
  verification mail, so an actor who can edit a provider can point every
  authentication email at a relay they control. That action previously left no
  record. Create, update, delete and promote-to-default now write an activity
  entry naming the actor, the provider and which fields changed.

  Names, never values: an entry carries no part of the configuration, and a
  configuration change is recorded as the single field name `configuration`
  rather than by its inner paths. An update that moved nothing writes no entry
  at all.

  The provider screens also tell a catalog that could not be loaded apart from
  one that merely could not be refreshed. A failed refresh keeps the descriptors
  already fetched, so the type filter, the row labels and the form all still work
  from them; the pages now say so instead of reporting the catalog unavailable,
  and the edit page's Update button follows the form into read-only when the
  cached catalog no longer lists the stored type.

  Promoting a provider to default is one transaction. The demotion of the previous
  default and the write that promotes previously committed separately, so a
  promotion that matched nothing — a row deleted between the read and the write, an
  insert the database refused — left the installation with no default provider at
  all and nothing in the trail to say why.

  Inside that transaction the demotion runs first. PostgreSQL carries a partial
  unique index over `is_default = true` and checks it as each statement runs, so a
  row taking the default while the incumbent still holds it is rejected outright.
  A promotion that then matches no row — because the provider was deleted in the
  meantime — throws rather than commits, which takes its own demotion back with
  it.

  A masked value is no longer written back over what it stood for. The read masks
  a configuration path the provider does not describe — a credential left behind
  by an upgrade, say — while the write stripped masks only from paths declared
  secret, so a client echoing the configuration it was given replaced the real
  stored value with eight bullet characters during an unrelated edit. Masking and
  unmasking now ask one question.

  Only a handover opens a transaction. Wrapping every provider write in one cost
  correctness on SQLite, where the transaction is `BEGIN IMMEDIATE` on a single
  shared connection: a second ordinary write arriving while the first was open
  could not begin at all.

  An edit form left open reconciles a newer version of the record it is showing.
  The detail query refetches on focus, so a change made elsewhere used to be held
  and written back on the next save, reverting it from an edit that never touched
  those fields. Fields the operator has touched keep what they typed. If the
  record's TYPE changed, the configuration is rebuilt from the new provider rather
  than carried across — otherwise one provider's credential is submitted as
  another's wherever both declare the same field name.

  A stored value that predates a tightened constraint no longer blocks unrelated
  edits. A provider upgrade that lowers `maxLength`, or narrows a numeric range,
  made every provider holding an older value unrenameable and undeactivatable. The
  provider's own parser stays the authority on what it accepts; the descriptor
  governs replacements.

  Provider metadata that no descriptor can publish is refused at registration
  rather than at the first request for the catalog: `options` that is not an array
  of `{ value, label }` on any field kind, two select options sharing a value, and
  `capabilities` given as an array. One malformed provider previously took the
  whole catalog endpoint down, and with it every provider's form.

- [#691](https://github.com/nextlyhq/nextly/pull/691) [`8f5d785`](https://github.com/nextlyhq/nextly/commit/8f5d785e2f1bf9614f5242e2c60ee76752d6983c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Type-check `blocks-engine`'s test files, and stop Node globals reaching `src`.

  Turning the check on surfaced a real defect in the published types:
  `AnyBlockDefinition` widened every prop-consuming member except `seo`, so
  `registerBlocks` rejected every definition built by `defineBlock<P>()` for any
  interface `P` without an index signature — whether or not it contributed SEO.
  `seo` is now widened like its siblings, so typed blocks register.

- [#662](https://github.com/nextlyhq/nextly/pull/662) [`18b529b`](https://github.com/nextlyhq/nextly/commit/18b529b3509206a6b231fd004811a1fa0169f058) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-react` now emits a prepared document's slots in the order the
  block DEFINITION declares them, not the order they happen to be stored in.

  The renderer asks for its slots by calling `renderSlot` once per declaration,
  so declaration order is the order the page presents. This tree is documented as
  the render-equivalent one, so carrying stored order left its own key order
  describing a page nobody is served, and made two documents that render
  identically compare as different.

  A slot the definition declares but the document never stored stays ABSENT rather
  than being added as an empty array: an empty slot renders nothing either way,
  and adding it would rewrite every document that omits an optional slot.

- [#687](https://github.com/nextlyhq/nextly/pull/687) [`e1d573e`](https://github.com/nextlyhq/nextly/commit/e1d573e2333fcd7f59eb96d688fe55c23aed9e49) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page renderer and the shared read pipeline no longer keep separate copies of the passes a stored document goes through before it is read. Nothing changes for a reader; the two could previously drift, and a reader that skipped the gating pass would publish content the page deliberately withheld.

- [#646](https://github.com/nextlyhq/nextly/pull/646) [`743772f`](https://github.com/nextlyhq/nextly/commit/743772f0e3515d2a2cc8cadc700fe45688f56d65) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the @nextlyhq/builder package, which will hold the visual page-builder editor. It ships no features yet, so there is nothing to install it for: it exists now so the editor arrives under a name that is already reserved and already versioned in lockstep with the rest. It requires React 19, matching the renderer it draws with (@nextlyhq/blocks-react).

- [#670](https://github.com/nextlyhq/nextly/pull/670) [`3b88fff`](https://github.com/nextlyhq/nextly/commit/3b88fffbd0ad44664a700c70310759abadde4ca9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key is now judged on its own grants for every Direct API collection and single operation, not just some of them. Previously a key holding only update access could read through operations that forwarded the caller identity without the key scope, because the service fell back to the permissions of the user who issued the key.

- [#661](https://github.com/nextlyhq/nextly/pull/661) [`edf2b04`](https://github.com/nextlyhq/nextly/commit/edf2b04eab4eb04aa0b4cb8505aa14baaa5d6c20) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop publishing the rules of a block that draws nothing.

  A block can declare that its props make it draw nothing, and `core/image` with no source and `core/embed` with no `src` both do. The stylesheet did not consult that declaration, so every rule compiled for the markup such a node WOULD have drawn was still published — matching no element, and naming whatever it referenced. An image block waiting for its picture announced the URL of a background it never painted.

  The declaration now reaches the style compiler, which holds those rules per node rather than emitting them into the main sheet, exactly as it already does for a condition-gated node. A page compiled since carries an entry for each drawless node, and the reader appends only the ones that draw.

  What made this worth doing carefully is the direction it must NOT go. Dropping a node from the style input marks the document repaired, and a repaired document with nothing to recompile from has its whole stylesheet withheld. Blanking every rule on a page because one image is waiting for its picture is a far larger regression than the unused bytes it saves, and an unfilled image is an ordinary authoring state rather than the exceptional one the other prune cases describe. So a stored sheet that predates this keeps its node and ships whole; republishing the page compiles the entries and the drop starts working, with nothing to invalidate by hand.

  `declaresNoMarkup` in `@nextlyhq/blocks-engine` is now the single implementation of the question. SEO derivation had its own copy and now shares this one, so the compiler, the renderer and the derived metadata cannot answer differently about the same node. It fails in the opposite direction to `isConditionGated`, and deliberately: an unreadable visibility condition must count as gated or hidden content leaks, while a block that throws or answers with a non-boolean must count as drawing or a node that is on the page loses everything derived about it.

  Block-type default rules stay in the main sheet, because they come from the block package rather than from the document and a sibling of the same type that does draw still needs them.

- [#645](https://github.com/nextlyhq/nextly/pull/645) [`249649e`](https://github.com/nextlyhq/nextly/commit/249649eb921b10f6d87d7a7049c04d355a3e5f93) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - nextly: record what email was sent, and what failed

  A failed password-reset previously left no durable trace — the adapter threw,
  the service returned `{ success: false }`, one line went to the process log,
  and the operator learned from the user. Sends are now recorded in
  `email_deliveries`.

  The table stores a **hash** of the recipient rather than the address, and a
  template slug rather than a rendered subject, so it answers "did this send" and
  "how many failed" without answering "to whom". Provider failure messages have
  address-shaped text removed before storage, because an SMTP rejection quotes
  the recipient back at you.

  This is a log, not a queue: nothing drains it, and the retry columns it carries
  are reserved and inert so that adding a drain later is not a migration on a
  table already holding history.

  The recipient column is a KEYED hash rather than a bare digest. An email address
  carries too little entropy for a plain SHA-256 to resist an offline dictionary,
  so anyone holding the table could confirm whether a given person was written to.
  Keying it with the install secret leaves the support lookup working unchanged
  while making the column unreadable without that secret. The schema no longer
  claims the table sits outside identity-erasure obligations, because a keyed hash
  of an address is pseudonymised data rather than anonymised data.

  A send whose bookkeeping fails after the provider accepted the message is no
  longer reported as a provider failure. Acceptance is recorded the instant the
  provider answers, so deriving the response cannot turn a delivered message into
  a full set of failed rows, an after-send action told the send failed, and an
  auth flow withholding a token.

  Provider containment now covers the stages that run with parsed configuration:
  building an adapter and probing a connection. A parser that derives a credential
  left both quoting the derived value into a diagnostic that reached the failure
  log, because the needles were computed from the stored form alone. A parser that
  renames one is refused outright, for the same reason a parser that shortens one
  already was.

  The provider's own verdict survives a failure in the bookkeeping that follows
  it. Recording only that the provider answered, and defaulting to success, turned
  a refusal into a delivery and had an auth flow withhold its undelivered-token
  fallback for a message that was never sent.

  The notice written when a row is kept without its provider reference can no
  longer change what happened. An installed logger that threw was caught by the
  recovery's own handler and reported as a retry that failed, for a row sitting in
  the table.

- [#694](https://github.com/nextlyhq/nextly/pull/694) [`e0e7714`](https://github.com/nextlyhq/nextly/commit/e0e77147aa55d93d1bedfe5f3d7e67b4df2a8db4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(nextly): take the HTTP status from the error code, and record template changes

  Eight throw sites restated a status the canonical map already answers, so the
  number lived in two places and only one would be found by someone changing it.
  The status now comes from the code alone.

  Deleting an email provider nulls the reference on its delivery rows rather than
  removing them, so the log stays evidence of what was sent. That behaviour now
  has per-dialect coverage on PostgreSQL and SQLite, where it was previously
  untested. MySQL still has no such constraint: adding one requires nulling
  pre-existing dangling references first, which nothing in the schema pipeline
  does yet.

  Email template mutations now reach the activity log. A template decides what a
  password-reset message says and who it appears to come from, and that change was
  previously invisible after the fact. Entries carry field NAMES only.

- [#690](https://github.com/nextlyhq/nextly/pull/690) [`968b7ce`](https://github.com/nextlyhq/nextly/commit/968b7ce98ce0a898e3e4e03f3370011249145f5f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): replace one part of the email provider form without resetting the rest

  Changing a provider type, or a plugin returning while the form is open, replaced
  the configuration through a whole-form reset. That makes every current value the
  form's new baseline, so fields it never meant to touch stop differing from it —
  and reconciling a refetch keeps only what still differs. A rename typed before
  either of those happened was silently overwritten by the record's own value.

  Each of those now writes only the fields it means to, and a provider type chosen
  in the picker is kept as the operator's until they save. A descriptor that gains
  a configuration field while a form is open now initialises it, so a switch no
  longer draws a position the form does not hold, and a field being edited is left
  alone.

- [#663](https://github.com/nextlyhq/nextly/pull/663) [`8b136ed`](https://github.com/nextlyhq/nextly/commit/8b136edce2f7bfd2c1cfeaaa56fe964a7569d5d9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder no longer renders a second `main` element. A page has one primary landmark, and the editor was adding another inside the admin’s own, which is invalid markup and gives screen readers two competing landmarks to choose between. The canvas pane is now a labelled region, so it is still announced and still reachable by landmark navigation.

- [#686](https://github.com/nextlyhq/nextly/pull/686) [`68145f1`](https://github.com/nextlyhq/nextly/commit/68145f1ab90b2a188918a2e463302de66275c914) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now names itself in the admin. Its entry in the plugins list and on the dashboard showed the raw package specifier where other plugins show a readable name.

- [#601](https://github.com/nextlyhq/nextly/pull/601) [`264bda2`](https://github.com/nextlyhq/nextly/commit/264bda2eb787413b1c1f3de67361f882556aa6bf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Minting a preview link now authorizes the entry it names, not just the collection: a caller bounded by a row-level rule can no longer mint a working link for a document they cannot read themselves.

- [#678](https://github.com/nextlyhq/nextly/pull/678) [`ed5e26e`](https://github.com/nextlyhq/nextly/commit/ed5e26ecb8efbe990b9619d37a3d4296bfa46e49) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - stop the sidebar content panel from emitting a second main landmark

- [#685](https://github.com/nextlyhq/nextly/pull/685) [`038935d`](https://github.com/nextlyhq/nextly/commit/038935d4e78aa74dc346f8c6b3d0aab16899dcd4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single's schema change now applies its table change and writes its registry row in one place, and the row records the outcome the apply actually reached. Saving a Single that only toggles Internationalization or Draft/Published now records that its companion table was provisioned, and re-saving a Single whose table failed to create can rebuild it and report success instead of staying stuck on "failed" however many times it is retried.

- [#693](https://github.com/nextlyhq/nextly/pull/693) [`c4de051`](https://github.com/nextlyhq/nextly/commit/c4de0513f8d75dcf8a2fec5afe8168e48795165d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Serving a page through the new `preparePageForRead` no longer publishes stylesheet rules for a block that is missing from the site, so an uninstalled plugin stops leaving its block defaults and named classes behind in the page CSS.

- [#672](https://github.com/nextlyhq/nextly/pull/672) [`bb4ebd0`](https://github.com/nextlyhq/nextly/commit/bb4ebd06da5f31d2f41eb7ba233a5745a2e1ac00) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder: a unique column that a database cannot index is no longer described two different ways. The rule deciding whether uniqueness is a named index or an inline constraint now lives in one place and is asked by the create path, the add-column path and the desired schema alike, so a reconcile no longer proposes a unique index the server refuses.

- Updated dependencies [[`175ed53`](https://github.com/nextlyhq/nextly/commit/175ed53cc50e162ae65e47fc73c139c254b89ab8), [`3709979`](https://github.com/nextlyhq/nextly/commit/3709979d10c1301b7882ab0132af4b2347de47d6), [`80ca19e`](https://github.com/nextlyhq/nextly/commit/80ca19e69f5e875f809291863d4c31d33e815554), [`07cd50f`](https://github.com/nextlyhq/nextly/commit/07cd50f4d9ed38ad5d8fbfa644358c17ec4a885b), [`b4e032b`](https://github.com/nextlyhq/nextly/commit/b4e032b862a85d9605360f1c0e3b65b4999cc882), [`19f35d9`](https://github.com/nextlyhq/nextly/commit/19f35d993da7242b084568c74765d75871b3c266), [`8f5d785`](https://github.com/nextlyhq/nextly/commit/8f5d785e2f1bf9614f5242e2c60ee76752d6983c), [`18b529b`](https://github.com/nextlyhq/nextly/commit/18b529b3509206a6b231fd004811a1fa0169f058), [`e1d573e`](https://github.com/nextlyhq/nextly/commit/e1d573e2333fcd7f59eb96d688fe55c23aed9e49), [`f054383`](https://github.com/nextlyhq/nextly/commit/f0543837d0a198d27dee073d078127d95d06f25f), [`743772f`](https://github.com/nextlyhq/nextly/commit/743772f0e3515d2a2cc8cadc700fe45688f56d65), [`ba3a72c`](https://github.com/nextlyhq/nextly/commit/ba3a72c8f664183587552cf88d50f1a13b8bc504), [`a2f2080`](https://github.com/nextlyhq/nextly/commit/a2f2080260f422a37dfc46d42a440c1976e6ae2f), [`5d6f049`](https://github.com/nextlyhq/nextly/commit/5d6f04923abc2459d78a0d7bba0a8f4c73b08fe1), [`d23b9d7`](https://github.com/nextlyhq/nextly/commit/d23b9d7b657b8ade24794e25e8e3f9de7635c96f), [`3b88fff`](https://github.com/nextlyhq/nextly/commit/3b88fffbd0ad44664a700c70310759abadde4ca9), [`edf2b04`](https://github.com/nextlyhq/nextly/commit/edf2b04eab4eb04aa0b4cb8505aa14baaa5d6c20), [`249649e`](https://github.com/nextlyhq/nextly/commit/249649eb921b10f6d87d7a7049c04d355a3e5f93), [`e0e7714`](https://github.com/nextlyhq/nextly/commit/e0e77147aa55d93d1bedfe5f3d7e67b4df2a8db4), [`fe694de`](https://github.com/nextlyhq/nextly/commit/fe694de18295a7a0266fda55a4bf770e7e4db341), [`968b7ce`](https://github.com/nextlyhq/nextly/commit/968b7ce98ce0a898e3e4e03f3370011249145f5f), [`4b2c025`](https://github.com/nextlyhq/nextly/commit/4b2c0250d9f3c82ea4f3764069750c4407883221), [`1ddda0f`](https://github.com/nextlyhq/nextly/commit/1ddda0ff4b976ea7f4f0e9f5a0d67d6d342d00c3), [`38135e8`](https://github.com/nextlyhq/nextly/commit/38135e8cf95b0ba2d444a296fd5b1c85b4d45647), [`6823b57`](https://github.com/nextlyhq/nextly/commit/6823b57db4fd20fc329d853dc4bc7e7737e56d24), [`8b136ed`](https://github.com/nextlyhq/nextly/commit/8b136edce2f7bfd2c1cfeaaa56fe964a7569d5d9), [`68145f1`](https://github.com/nextlyhq/nextly/commit/68145f1ab90b2a188918a2e463302de66275c914), [`80723ec`](https://github.com/nextlyhq/nextly/commit/80723ecd758237170f67cde756385572eb7c8b52), [`264bda2`](https://github.com/nextlyhq/nextly/commit/264bda2eb787413b1c1f3de67361f882556aa6bf), [`db83c18`](https://github.com/nextlyhq/nextly/commit/db83c18c935f53d773ffa2001045a3697778800b), [`0585842`](https://github.com/nextlyhq/nextly/commit/0585842547da6da9b8e62c9599b52ea4dbac6e43), [`a3e1849`](https://github.com/nextlyhq/nextly/commit/a3e1849eb52d8e71c9f549960e63e635a4d9d4dd), [`ed5e26e`](https://github.com/nextlyhq/nextly/commit/ed5e26ecb8efbe990b9619d37a3d4296bfa46e49), [`038935d`](https://github.com/nextlyhq/nextly/commit/038935d4e78aa74dc346f8c6b3d0aab16899dcd4), [`9c12a68`](https://github.com/nextlyhq/nextly/commit/9c12a68e18de3637b14403ed66f0d7658cc0875e), [`c4de051`](https://github.com/nextlyhq/nextly/commit/c4de0513f8d75dcf8a2fec5afe8168e48795165d), [`3278f13`](https://github.com/nextlyhq/nextly/commit/3278f139eeba5022edfc5ec6563a0ab4061921f3), [`bb4ebd0`](https://github.com/nextlyhq/nextly/commit/bb4ebd06da5f31d2f41eb7ba233a5745a2e1ac00), [`532ed04`](https://github.com/nextlyhq/nextly/commit/532ed04aea8e990e23998f8853037eb48927e5d5), [`891ec3b`](https://github.com/nextlyhq/nextly/commit/891ec3b0eb968913727e78558a2cc2fdb4c9eb7c)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.56
  - @nextlyhq/blocks-react@0.0.2-alpha.56
  - @nextlyhq/ui@0.0.2-alpha.56
  - @nextlyhq/plugin-sdk@0.0.2-alpha.56
