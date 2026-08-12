# @nextlyhq/blocks-engine

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

- [#653](https://github.com/nextlyhq/nextly/pull/653) [`3709979`](https://github.com/nextlyhq/nextly/commit/3709979d10c1301b7882ab0132af4b2347de47d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Route the admin panel's keyboard shortcuts through the shared shortcut manager, so one listener owns every key and precedence follows the component tree rather than mount order.

- [#644](https://github.com/nextlyhq/nextly/pull/644) [`80ca19e`](https://github.com/nextlyhq/nextly/commit/80ca19e69f5e875f809291863d4c31d33e815554) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Refuse an unknown URL scheme in a block's attributes instead of naming the dangerous ones.

  The guard every block prop that reaches an `href` or a `src` passes through was a BLOCKLIST: `javascript:`, `vbscript:` and `data:` were named and refused, and everything else was allowed. So `blob:` was allowed — and a `blob:` document runs in the origin that created it, which is the page's own. So were `filesystem:`, `about:`, `view-source:`, and whatever a browser ships next. A blocklist has to predict every dangerous scheme and misses the one nobody had heard of when it was written, which is the same reason the style compiler and the remote-host policy are both allowlists.

  Four schemes are accepted now: `http` and `https` for a destination, `mailto` and `tel` for the two that open an app rather than a page and are the ordinary content of a contact button. A value carrying no scheme is untouched, so `/about`, `a.png`, `#top` and `//cdn.example/a.png` all still work — which hosts may be REACHED is a separate question, asked of the host policy by the blocks that fetch rather than of a list of schemes.

  These are the same four the rich-text sanitizer already allows, and that is deliberate rather than a coincidence: it answers this identical question for stored rich text, and two surfaces of one product disagreeing about which schemes are safe is how a value refused inside a link body becomes acceptable in a button beside it. The admin's link editor keeps accepting a wider set for what an author may TYPE, because that is an input affordance and not the boundary.

  The scheme is read from the value as the browser's parser will read it, and through the ENGINE's normalisation rather than a second copy of the rules — two spellings of one algorithm disagreeing is how a scheme hides from a check while still navigating. Tab, LF and CR are removed wherever they appear because the parser removes them; leading control characters and spaces are trimmed because the parser trims them.

  An interior space is deliberately NOT removed, because the parser does not remove one either — it percent-encodes it. `hero image:1.png` is an ordinary relative path to a file whose name holds a space, and collapsing that to `heroimage:1.png` would invent a scheme nobody wrote and refuse the path. A control character still sitting inside the value after normalisation refuses it outright instead: one never appears in a URL anybody meant, since it has to be percent-encoded to survive, and its only use here is to split a scheme so a reader sees none where a browser may still see one.

  The value returned is still the original trimmed string, so a legitimate URL is never silently rewritten.

- [#643](https://github.com/nextlyhq/nextly/pull/643) [`07cd50f`](https://github.com/nextlyhq/nextly/commit/07cd50f4d9ed38ad5d8fbfa644358c17ec4a885b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Page validation now refuses children stored under a slot on a block that holds none, not just on containers with the wrong slot name. Every block in the catalogue declares its structure where the check can read it without loading the block library.

- [#636](https://github.com/nextlyhq/nextly/pull/636) [`b4e032b`](https://github.com/nextlyhq/nextly/commit/b4e032b862a85d9605360f1c0e3b65b4999cc882) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Page validation now knows what slots a block declares without the block library having to be loaded, so a page saved through the normal server path is checked rather than waved through. Three layout blocks move to the new source in this change; the rest follow.

- [#640](https://github.com/nextlyhq/nextly/pull/640) [`19f35d9`](https://github.com/nextlyhq/nextly/commit/19f35d993da7242b084568c74765d75871b3c266) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every block that can hold children now declares its slots where page validation can read them without loading the block library, so a page saved through the normal server path is checked against all of them rather than a few.

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

- [#651](https://github.com/nextlyhq/nextly/pull/651) [`f054383`](https://github.com/nextlyhq/nextly/commit/f0543837d0a198d27dee073d078127d95d06f25f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-react` now exports the types its public API is written in.

  `StyleCompileContext`, `BlockDocument` and `DocumentLimits` appeared in the built
  declarations in parameter positions while being named in no export statement,
  and `BreakpointSet` — the one field `StyleCompileContext` requires — was absent
  from the surface entirely. A host could see the name it was required to pass and
  had no way to write it down, because those types originate in
  `@nextlyhq/blocks-engine`, which is a dependency of this package rather than a
  peer.

  The root entry now re-exports the engine types the surface is built from, and
  the set is CLOSED: an exported type is only as writable as its parts, so a host
  handed `BlockDefinition` could name it and still not write down the `supports`
  object it must pass or the `seo()` contribution it must return. Everything
  reachable from a re-exported type is re-exported too, so annotating any part of
  the surface needs no second package.

  They live on the root entry rather than `/next`, whose declarations import the
  `next` and `nextly` peers a standalone install does not have.

  A regression test asserts each is named in an EXPORT STATEMENT of the built
  `.d.ts`, not merely present in the file, and derives what is required from the
  declarations themselves — the entries from `package.json`, the obligation from
  the engine's own composition — so the check grows with the API rather than with
  someone remembering to extend a list.

  `nextly`'s own route types are deliberately not re-exported: it is a peer
  dependency, so a host names `ContentEntry`, `RenderContext` and the route shapes
  from `nextly/runtime` where they live.

- [#646](https://github.com/nextlyhq/nextly/pull/646) [`743772f`](https://github.com/nextlyhq/nextly/commit/743772f0e3515d2a2cc8cadc700fe45688f56d65) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the @nextlyhq/builder package, which will hold the visual page-builder editor. It ships no features yet, so there is nothing to install it for: it exists now so the editor arrives under a name that is already reserved and already versioned in lockstep with the rest. It requires React 19, matching the renderer it draws with (@nextlyhq/blocks-react).

- [#660](https://github.com/nextlyhq/nextly/pull/660) [`ba3a72c`](https://github.com/nextlyhq/nextly/commit/ba3a72c8f664183587552cf88d50f1a13b8bc504) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read and write hex colours from the server-safe colour entry point.

- [#641](https://github.com/nextlyhq/nextly/pull/641) [`a2f2080`](https://github.com/nextlyhq/nextly/commit/a2f2080260f422a37dfc46d42a440c1976e6ae2f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A content route no longer offers static generation it cannot perform.

  `createContentRoute` and `createBlocksPage` read access-enforced content, so no
  path they serve can be pre-rendered — and they now return no
  `generateStaticParams` at all. Next classifies a route as static BECAUSE that
  export exists, and every dynamic marking inside a static render is an error, so
  an enforced route that also exported one answered 500 on every path whenever its
  collection was empty at build time. Its runtime behaviour depended on whether
  the database had rows in it when the build ran.

  For public content that should be cached and pre-rendered, call the new
  `createPublicContentRoute` / `createPublicBlocksPage`. They read trusted and do
  return `generateStaticParams`.

  Replaces the `overrideAccess` option on `ContentRouteConfig`, which had no
  consumers: the posture is now stated by which factory you call.

- [#657](https://github.com/nextlyhq/nextly/pull/657) [`5d6f049`](https://github.com/nextlyhq/nextly/commit/5d6f04923abc2459d78a0d7bba0a8f4c73b08fe1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Refresh five transitive dependencies to their patched releases, clearing the six open Dependabot advisories on this repository.

  `brace-expansion` to 5.0.9 (denial of service through unbounded intermediate arrays, bypassing the earlier mitigation), `fast-uri` to 3.1.5 (host confusion via a backslash authority introducer), `js-yaml` to 4.3.1 (quadratic CPU consumption resolving `!!omap`), `undici` to 7.29.0 (five advisories, the highest being cross-user information disclosure and a parse-time crash on degenerate private cache directives) and `dompurify` to 3.4.13.

  The DOMPurify advisory is the one worth an explicit reachability answer, because two published packages sanitize with it. Reaching it needs `IN_PLACE` sanitization together with a hook that removes a containing element, and neither sanitizer is that shape: `sanitize-svg` hooks `uponSanitizeAttribute`, the embed sanitizer hooks `afterSanitizeAttributes`, both are attribute-level, and neither sets `IN_PLACE`. So the bump keeps a dependency on a supported release rather than closing a live hole. Both sanitizer suites pass on 3.4.13.

  Each override floor is raised rather than left to resolve upward on its own, because all five were pinned in the lockfile at exactly the last vulnerable patch, and a floor that still admits a vulnerable version lets the next lockfile refresh land back on one.

  These are `pnpm` overrides, so they govern this workspace's builds, CI and local development and do not travel with the published packages. What a consumer of `nextly` or `@nextlyhq/plugin-page-builder` resolves for these transitive dependencies is still decided by their own tree.

- [#658](https://github.com/nextlyhq/nextly/pull/658) [`d23b9d7`](https://github.com/nextlyhq/nextly/commit/d23b9d7b657b8ade24794e25e8e3f9de7635c96f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report conflicting shortcut-provider options when neither provider attaches a listener.

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

- [#626](https://github.com/nextlyhq/nextly/pull/626) [`fe694de`](https://github.com/nextlyhq/nextly/commit/fe694de18295a7a0266fda55a4bf770e7e4db341) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Email providers are now described by a definition, so a plugin can add one that works everywhere a built-in does.

  A contributed provider could previously be registered but never configured: the REST API and the provider service both validated the type against a fixed list of the three built-ins, and `defineConfig` resolved providers through a hardcoded switch. Registration is now the only thing that decides which types exist.

  A provider definition also declares its configuration fields, which values are secret, and how to validate them. Secrets are redacted because the provider says so rather than because a key name looked sensitive, and an invalid configuration is rejected when it is saved instead of when a send later fails.

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

- [#638](https://github.com/nextlyhq/nextly/pull/638) [`4b2c025`](https://github.com/nextlyhq/nextly/commit/4b2c0250d9f3c82ea4f3764069750c4407883221) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Ask one host list, from both channels a page fetches through.

  `BlockHostPolicy` now carries `remotePatterns`, in the same shape a Nextly app already declares in `next.config` for `next/image`, so copying the entry across just works. A block writes an `<img src>` or an `<iframe src>`; a compiled stylesheet writes `url(...)` into a rule that fires on every page it applies to. Both turn a stored value into a request, and both now ask THIS list rather than each keeping its own, because a policy two surfaces answer differently is not a policy. The style channel asks it through the predicate the engine takes, so the two cannot drift.

  `core/image` and `core/embed` consult it. For the image, the check is applied to whichever URL was SELECTED rather than to the typed one alone: a URL the resolver returned came out of a media record a person filled in, so it names a host on the same terms the typed prop does, and checking one of the pair leaves the other unbounded.

  `core/embed` consults it, and an unlisted host renders nothing at all rather than an empty frame, for the reason the empty source already renders nothing: a frame with no usable source loads the page inside itself in several browsers. A caller who passed their own `mayFetchUrl` keeps it, since that is the more specific answer and deriving one here would silently replace it. Absent means unasked rather than allowed-nothing, so a host that configures no list renders exactly as it did before.

  **Enforcement is per-renderer, and the type says so where someone reading it will find out.** The boundary cannot apply this on a block's behalf: it sees the element a block RETURNED, not the URLs the block chose, and an `<img src>` deep inside returned markup is indistinguishable to it from any other prop. The blocks shipped here consult the list; a block written outside this package is bounded by it only if it asks. A site wanting a hard limit should pair this with a content security policy, which the browser enforces whatever a block does.

  `core/embed`'s `rendersNothing` still answers from its props alone, deliberately. The declaration is read without a render and so has no policy to consult; a URL the policy will refuse is reported there as output and then draws nothing. That direction costs an empty rule in a stylesheet, where the other would claim a drawing block draws nothing.

  A stored stylesheet now records which policy compiled it. The artifact is a CACHE of a compile, and a cache is sound only when it is keyed on every input that compile used; the fetch list is such an input, because the same document compiled under two different lists produces two different sheets, one of which may name a host the other refuses. Without that key a sheet written before a policy existed keeps publishing `url(https://unlisted…)` on a site that has since forbidden it, with the block markup beside it bounded and the stylesheet not.

  So `PageStyles` gains an opaque `fetchPolicyId`, derived from the patterns themselves rather than assigned, so it changes exactly when they do and there is nothing to remember to invalidate. A reader whose policy does not match the stamp treats the sheet the way it already treats one compiled from a larger tree: recompile when the inputs are there, withhold the CSS when they are not. A sheet that WAS compiled under the current policy is still served from the store, which is why this is a stamp rather than recompiling unconditionally: a site with a policy does not pay a compile per render.

  `fetchPolicyLabel` is public because the write path needs it. A writer that could not compute the same label would stamp nothing, every stored sheet would read as stale, and a site with a policy would recompile for ever.

  The type documentation no longer claims every field defaults closed, because two fields now default differently and a host reading the old sentence could omit configuration believing remote fetches were denied. `trustedFrameOrigins` defaults closed, since the grant it controls lets a frame script the page around it. `remotePatterns` defaults OPEN, because it arrived after the renderer shipped and defaulting it closed would stop every existing site loading its own images the day it upgraded.

  `core/image` asks the list BEFORE choosing between its two candidates rather than after. Selecting first and filtering after meant a library image the site will not fetch beat a perfectly good typed URL and then took the whole block down with it: the author was left with nothing because of a setting they cannot see, while the fallback they wrote sat unused. Filtering first makes the block render the first candidate it is actually allowed to load, which is what a fallback is for — and it is what the link-preview path does with the same pair, so the page and the preview can no longer choose different images. A record whose URL is refused is dropped WHOLE, since its alt text and intrinsic size describe the asset that was refused.

  The page-builder's own guidance is corrected in the same change. It told an integrator that `@nextlyhq/blocks-react` had no way to bound fetched hosts and to configure the separate page-builder renderer instead. That is now false, and believing it would leave the published page unbounded while the editor was configured — the editor refusing a host the live page then loads.

- [#648](https://github.com/nextlyhq/nextly/pull/648) [`1ddda0f`](https://github.com/nextlyhq/nextly/commit/1ddda0ff4b976ea7f4f0e9f5a0d67d6d342d00c3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Page editor: a page holding blocks under a slot that no longer exists now says so and offers to clear them. Such blocks are invisible on the canvas (a block only draws the slots it declares), so until now the page simply refused to save with nothing to select and nothing to delete. A bar above the editor names each affected block and where it sits, and removing one is a per-block choice that undo can reverse. Nothing is discarded automatically.

- [#652](https://github.com/nextlyhq/nextly/pull/652) [`38135e8`](https://github.com/nextlyhq/nextly/commit/38135e8cf95b0ba2d444a296fd5b1c85b4d45647) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Render a very long list instead of losing the block that holds it.

  `core/list` mapped its stored `items` with no cap. A document's own limits bound node count and depth but never the length of a prop array, so `items` arrives at whatever length was written — and past the renderer's inspection budget the normalizer refuses the whole output. An accidentally long list therefore cost the reader EVERY item and left a broken-block marker where the list should be, rather than costing only the items past the end.

  The items are clamped, and sliced before they are mapped so an oversized array is never walked in full: the work this bounds is the work of reading it, not only of rendering it. The cap sits far above any list a person writes and far below the budget, so nothing hand-authored reaches it and the block still has room for its wrapper.

- [#634](https://github.com/nextlyhq/nextly/pull/634) [`6823b57`](https://github.com/nextlyhq/nextly/commit/6823b57db4fd20fc329d853dc4bc7e7737e56d24) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Adopt a neutral admin theme. The admin palette is now achromatic in both modes, with every asserted contrast pairing clearing WCAG AA by a margin rather than sitting on the gate. Control boundaries (text inputs, selects, checkboxes, the table search field) move to a visible 3.4:1 edge, active sidebar rows are filled with the surface their ink is declared against, and the dark table header surface no longer carries a hue the rest of the palette dropped.

- [#663](https://github.com/nextlyhq/nextly/pull/663) [`8b136ed`](https://github.com/nextlyhq/nextly/commit/8b136edce2f7bfd2c1cfeaaa56fe964a7569d5d9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder no longer renders a second `main` element. A page has one primary landmark, and the editor was adding another inside the admin’s own, which is invalid markup and gives screen readers two competing landmarks to choose between. The canvas pane is now a labelled region, so it is still announced and still reachable by landmark navigation.

- [#686](https://github.com/nextlyhq/nextly/pull/686) [`68145f1`](https://github.com/nextlyhq/nextly/commit/68145f1ab90b2a188918a2e463302de66275c914) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now names itself in the admin. Its entry in the plugins list and on the dashboard showed the raw package specifier where other plugins show a readable name.

- [#600](https://github.com/nextlyhq/nextly/pull/600) [`80723ec`](https://github.com/nextlyhq/nextly/commit/80723ecd758237170f67cde756385572eb7c8b52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A preview link that names one entry no longer widens access to the rest of its collection: when the granted entry does not live at the requested path, the published-only fall-through now reads with the caller's own access instead of the trust the draft decision forced on.

- [#601](https://github.com/nextlyhq/nextly/pull/601) [`264bda2`](https://github.com/nextlyhq/nextly/commit/264bda2eb787413b1c1f3de67361f882556aa6bf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Minting a preview link now authorizes the entry it names, not just the collection: a caller bounded by a row-level rule can no longer mint a working link for a document they cannot read themselves.

- [#609](https://github.com/nextlyhq/nextly/pull/609) [`db83c18`](https://github.com/nextlyhq/nextly/commit/db83c18c935f53d773ffa2001045a3697778800b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a block render nothing without being reported as broken, and test the core primitives through the boundary that wraps them.

  A block that deliberately renders nothing, such as an image with no usable source, was replaced by a broken-block diagnostic when its node also carried an anchor id. Rendering nothing is a decision rather than a failure, and the two now have different answers.

  **Emptiness is judged only from what this renderer can vouch for**, which is the part worth reading twice. Two things earn the exemption: the block DECLARES that its props draw nothing, through the `rendersNothing` contract, which is computed from data this renderer already holds; or the output is a value this renderer OWNS — a primitive React draws as nothing, or an array `normalizeRenderable` materialised, walked by index exactly as React walks it.

  Nothing else. A wrapper the block returned is never opened to see whether it is empty. Its children, a provider's `value`, an element's `key` and `ref`, a `Set`'s iterator and an array's iterator are all author-controlled, and React reads every one of them AGAIN after this check has returned — so an exemption granted on a reading React need not repeat is an exemption that can be wrong. It was wrong in five separate ways, two of which took the whole page rather than one block: an iterable that answered differently on each call, a `Set` carrying its own iterator, a getter hidden from enumeration, an inherited getter, and a stateful `children` accessor. The list of properties to probe was never going to close, because every one of them belongs to the author.

  The cost is stated plainly: a block returning an empty fragment, an empty `Suspense`, a hidden `Activity` or an empty context provider, on a node that also asks for an anchor id, keeps its diagnostic. That block says `rendersNothing` if it means it, and then the exemption is granted from data rather than from a structure that can change underfoot.

  The contract still covers every value React draws as nothing rather than the nullish pair alone. A plugin block written in the ordinary conditional form `render: () => enabled && <element />` returns `false` when disabled, an empty string arrives from a cleared value, and a map over an empty collection arrives as `[]`. A returned `Set` is materialised before it is read, so it counts too. `0` is deliberately excluded, since React renders it as the character zero: real output with no element to carry the node's fields.

  A candidate URL clears BOTH filters before `core/image` chooses between them, and a media record whose URL either filter refuses is dropped whole. The two refuse different things — the scheme guard refuses a value that could execute, the host list refuses one the site will not fetch from — and this block had been caught twice applying one of them at one position of the resolver/typed-prop pair and not the other. The same pair reaches the link preview, so both run there too, and the preview publishes the URL in the form the guard normalised rather than the form it was handed.

  `SuspenseList` joins the wrapper set the normalizer already accepted as renderable. A type accepted in one list and missing from the other is a wrapper walked to validate its children in one place and reported as output in the other.

  The primitives were only ever tested by calling their render functions directly, which is not the path a page takes: the boundary appends the block type class, clones the node fields onto the root, and normalizes the output first. That gap is why this defect and two others reached main.

- [#650](https://github.com/nextlyhq/nextly/pull/650) [`0585842`](https://github.com/nextlyhq/nextly/commit/0585842547da6da9b8e62c9599b52ea4dbac6e43) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A public content route no longer expands relations by default.

  A trusted read propagates both its trust and a widened lifecycle into
  relationship expansion: a populated target is read with access rules bypassed
  AND `status: "all"`. At the inherited default of `depth: 1`, a page in a public
  collection could therefore embed a draft or access-restricted row from a
  collection appearing nowhere in the route config — and a public route
  pre-renders that into a static artifact.

  `createPublicContentRoute` and `createPublicBlocksPage` now default to
  `depth: 0`. Setting `depth` explicitly restores expansion, and states that the
  populated collections are public too.

- [#654](https://github.com/nextlyhq/nextly/pull/654) [`a3e1849`](https://github.com/nextlyhq/nextly/commit/a3e1849eb52d8e71c9f549960e63e635a4d9d4dd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Re-decide a held shortcut key on every repeat, so a binding whose action changes its own condition stops permitting the browser default.

- [#678](https://github.com/nextlyhq/nextly/pull/678) [`ed5e26e`](https://github.com/nextlyhq/nextly/commit/ed5e26ecb8efbe990b9619d37a3d4296bfa46e49) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - stop the sidebar content panel from emitting a second main landmark

- [#685](https://github.com/nextlyhq/nextly/pull/685) [`038935d`](https://github.com/nextlyhq/nextly/commit/038935d4e78aa74dc346f8c6b3d0aab16899dcd4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single's schema change now applies its table change and writes its registry row in one place, and the row records the outcome the apply actually reached. Saving a Single that only toggles Internationalization or Draft/Published now records that its companion table was provisioned, and re-saving a Single whose table failed to create can rebuild it and report success instead of staying stuck on "failed" however many times it is retried.

- [#635](https://github.com/nextlyhq/nextly/pull/635) [`9c12a68`](https://github.com/nextlyhq/nextly/commit/9c12a68e18de3637b14403ed66f0d7658cc0875e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a site say which hosts its stylesheets may fetch from.

  A stylesheet is a fetching surface. `background-image: url(...)` makes the browser request whatever it names, on every page the rule applies to, and until now the only limit on that was the scheme allowlist. That allowlist answers whether a URL is `http(s)` rather than `javascript:`; it has never had anything to say about WHICH host is reached. A value carrying no scheme at all can still name one, because `//cdn.example/a.png` inherits the page's protocol and nothing else, so a check reading "no scheme, therefore this origin" was wrong about exactly the case that reaches somewhere else. The comment saying so has been corrected, and it is no longer the only thing marking the gap.

  `StyleCompileContext` now takes a `mayFetchUrl` predicate, forwarded to every URL a compile can emit. A PREDICATE rather than a list of patterns, so the engine holds no matching rules of its own and the caller keeps ONE answer for every channel it owns; which hosts a site trusts belongs to the site, not to the document format. Left undefined, nothing is asked and a compile behaves exactly as it did before, which is what every caller outside a configured site gets. The question is put last, to a value already known to be well formed, so a host rule is never the reason given for a value that was going to be refused anyway.

  Coverage is proved rather than asserted. The test walks the catalog for every leaf that can carry a URL, places a refused host at each one and checks none reach the stylesheet, with an allowed host in the SAME position as the control — without it a compiler emitting nothing for that property would pass by writing no CSS at all. Deriving the positions from the catalog is the point: a written list is a snapshot, and the property added next month would not be in it while the suite still reported full coverage.

  Two signatures grew a parameter and are now grouped rather than lengthened. `validateStyleValues` already took six positional arguments and `envelopeRules` ten, which is past where a call reads by position; a further optional would have sat beside one of a different type with nothing but that type to tell them apart, and a policy lost in a mis-slotted call leaves every URL in the document unasked about. `envelopeRules` takes a named object instead, so its arity goes down rather than up.

- [#693](https://github.com/nextlyhq/nextly/pull/693) [`c4de051`](https://github.com/nextlyhq/nextly/commit/c4de0513f8d75dcf8a2fec5afe8168e48795165d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Serving a page through the new `preparePageForRead` no longer publishes stylesheet rules for a block that is missing from the site, so an uninstalled plugin stops leaving its block defaults and named classes behind in the page CSS.

- [#612](https://github.com/nextlyhq/nextly/pull/612) [`3278f13`](https://github.com/nextlyhq/nextly/commit/3278f139eeba5022edfc5ec6563a0ab4061921f3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a keyboard shortcut manager to the UI kit: one listener, with precedence that follows the component tree.

  Shortcuts registered per component could not decide who owned a key. `stopPropagation` does not stop other listeners on the same node, so every global handler ran and the winner was whichever component mounted first. Pressing Escape during a drag could cancel the drag and navigate away from the page at the same time.

  `ShortcutProvider` installs the single listener. A nested `ShortcutScope` outranks the shell around it, and a layer marked `blocking` also swallows the keys it does not bind, so a drag or a modal can hold the keyboard for as long as it is up. `mod` resolves to Command on Apple platforms and Control elsewhere, sequences such as `g d` are supported, and modifier-carrying shortcuts still fire while the user is typing.

- [#672](https://github.com/nextlyhq/nextly/pull/672) [`bb4ebd0`](https://github.com/nextlyhq/nextly/commit/bb4ebd06da5f31d2f41eb7ba233a5745a2e1ac00) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder: a unique column that a database cannot index is no longer described two different ways. The rule deciding whether uniqueness is a named index or an inline constraint now lives in one place and is asked by the create path, the add-column path and the desired schema alike, so a reconcile no longer proposes a unique index the server refuses.

- [#649](https://github.com/nextlyhq/nextly/pull/649) [`532ed04`](https://github.com/nextlyhq/nextly/commit/532ed04aea8e990e23998f8853037eb48927e5d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A column declared unique now gets a named unique index instead of an unnamed constraint written into the table itself.

  An unnamed constraint is one the database names for you, and on SQLite that name is internal and cannot be referred to. Nothing could describe it afterwards, so the schema Nextly compared against never matched the table, and the only way SQLite could reconcile the two was to rebuild the whole table. Nextly refuses a rebuild it did not ask for, so the entire change was refused with it, including the parts that were only adding things. It also made such a column impossible to remove.

- [#637](https://github.com/nextlyhq/nextly/pull/637) [`891ec3b`](https://github.com/nextlyhq/nextly/commit/891ec3b0eb968913727e78558a2cc2fdb4c9eb7c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A repaired legacy column is now checked for JSON contents before it is converted, and the repair refuses without changing anything when the check fails. A field originally declared as text carries the same legacy column shape as a repeater, so the repair could be offered for prose — failing mid-migration on PostgreSQL, and on MySQL leaving the column renamed but unconverted because MySQL commits schema changes as it makes them.

## 0.0.2-alpha.55

### Patch Changes

- [#613](https://github.com/nextlyhq/nextly/pull/613) [`1d0d27d`](https://github.com/nextlyhq/nextly/commit/1d0d27da2ff89c7df6ccf71fa9f85dde69a7e703) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a site operator, rather than a page editor, decide which embeds may keep their own origin.

  `PageRenderer` takes a new `hostPolicy` prop, handed to every block as a separate render argument — `BlockRenderArgs.hostPolicy`, not a field on `PageContext`, which carries no such value. It holds decisions belonging to the developer standing up the site rather than to whoever fills in a page: a block's props are content, and content is untrusted input, so a security posture modelled as a prop is one an editor answers.

  `core/embed`'s `allowSameOrigin` was exactly that — a checkbox any page editor could tick against any URL, granting a frame the one permission that lets it remove its own sandbox. It is replaced by `hostPolicy.trustedFrameOrigins`, an allowlist compared as full origins through the URL parser: scheme, host and port together. A different scheme, a different port, a subdomain, and a suffix lookalike such as `player.example.com.evil.test` are all refused, as is a relative URL, which resolves to the host's own origin and is the one grant that would let a frame reach the page around it.

  The comparison requires an explicit authority, so `https:player.example.com` is refused as well: a URL parser reads that as an absolute URL while a browser resolves it against the document, which would have granted same-origin to a frame loading the host's own origin. The grant does not, and cannot, survive scrutiny of a later navigation: sandbox permissions belong to the frame rather than to one request, so an allowlisted origin is trusted for anything it redirects to, and a site that needs that bounded should pair the allowlist with a `frame-src` content security policy.

  The policy reaches a block as a render ARGUMENT rather than as a field on the context, and the host's own context object is passed through untouched. Deriving a modified copy of it cannot be done faithfully: a spread drops the prototype methods of a context implemented as a class, and even a prototype-preserving clone fails a method that reads a native private field, because the clone is not branded with it. Threading the value instead also settles who may set it, since a block builds the context it hands `renderSlot` — as an argument the boundary supplies, a nested block can neither lose the grant nor award itself one.

  Documents that still carry `allowSameOrigin` are unaffected in the safe direction: the value is ignored and the frame stays sandboxed. An unparseable entry in the allowlist is skipped rather than throwing, so a typo in configuration cannot take down every page holding an embed.

  Every policy field is optional and every default is the closed one, so a host that configures nothing keeps the restrictive behaviour.

- [#621](https://github.com/nextlyhq/nextly/pull/621) [`81d2590`](https://github.com/nextlyhq/nextly/commit/81d2590371146cb9fe36910785ec20bd17c8439e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a block declare that its props guarantee it draws nothing, so its styles stay off the page.

  A block that draws nothing still costs a reader something: a stylesheet carries its rules, and a rule may name a URL, so an empty block can make a request on behalf of markup that never appears. A renderer can already tell that an unregistered or un-upgradable node will not draw, but only a block knows that `core/image` with no source is the same case.

  `BlockDefinition` gains an optional `rendersNothing(props)`, answered from the stored props alone with no context, no data access and no awaiting. `core/image` and `core/embed` implement it. Declaring it on the block rather than listing block names inside a renderer is what keeps the decision generic: the same property belongs to any block whose output depends on a prop being present, including ones written outside this repository.

  **Nothing consumes the answer yet, deliberately.** Dropping such a node from a page's style input marks the document repaired, and on the ordinary published path — a stored stylesheet with no compile context — a repaired document has its whole sheet withheld. That would blank every rule on a page because one image is waiting for its picture, which is an ordinary authoring state rather than the exceptional one the other prune cases describe. Consuming it needs the stored artifact to be able to drop a single node's rules, the way it already can for condition-gated nodes.

- [#605](https://github.com/nextlyhq/nextly/pull/605) [`008cc36`](https://github.com/nextlyhq/nextly/commit/008cc36a3c4100cd8a81f5de14b677bb12b74e81) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `createBlocksPage()` turns a collection of block documents into rendered pages.

  It composes the existing content-route factory with the block renderer: the route resolves a path to an entry and owns `generateStaticParams`, `generateMetadata` and the not-found decisions, and this fills in the render. Media ids and entry references resolve against the CMS, so images and links work without wiring either by hand.

  ```tsx
  const { ContentPage, generateMetadata, generateStaticParams } =
    createBlocksPage({ collections: ["pages"], field: "content" });

  export { generateMetadata, generateStaticParams };
  export default ContentPage;
  ```

  It lives at `@nextlyhq/blocks-react/next`, so importing the renderer itself still pulls in neither Next nor the CMS. `nextly` is an optional peer dependency, and a test asserts the package root reaches no part of it.

  `getNextly` is exported from `nextly/runtime`. It is already the documented default for `ContentRouteConfig.nextly`, and a helper built on a content route needs the same instance the route reads through — on a per-tenant setup a second instance is a second database. Exporting it lets such a helper resolve one the same way, rather than having the route hand a general reader to every callback in order to share one.

  A page's blocks now supply its metadata when the entry's SEO fields are blank.

  `BlockDefinition` gains an optional `seo?(props)` returning a title, description and/or image. A block declares what it offers rather than a deriver guessing from prop names — a guessing deriver works for the core library and goes silent for every contributed block, which is backwards: a page built mostly from third-party blocks is exactly the one with nothing else to fall back on. Core heading, text and image blocks declare theirs.

  `createBlocksPage` gains a `metadata` hook receiving what the document said about itself:

  ```ts
  metadata: (entry, ctx, derived) =>
    buildMetadata(entry, { fallback: derived });
  ```

  Each field is filled from the FIRST block that offers it, independently, so a page opening with an image and heading later takes both. The offer is synchronous by design, so generating metadata never puts a network call between a crawler and the page title; a derived media id is resolved afterward through the same resolver the rendered image uses, so the picture in a link preview and the picture on the page cannot disagree.

  The sitemap needed no change: `nextlySitemap` already takes a generic entries provider, and a blocks-backed collection is an ordinary collection.

  `prepareDocumentForRead` is now exported from `@nextlyhq/blocks-react`. It runs the passes a stored document goes through before anything reads it — the format guard, shape repair against the site's caps, migration, condition gating, address repair and placeholder pruning — and returns the tree the page will actually present, or `null` when the page presents nothing but a placeholder.

  `slugToStaticParam` is now exported from `nextly/runtime`, and it is the route's single answer to "what path does this stored slug render at". Anything emitting a URL for an entry — a canonical, a link between entries — derives it from that function rather than re-deriving the rule, because a second opinion names a path the route does not serve.

  It also now **refuses a slug holding a literal `.` or `..` segment**. URL resolution removes those segments before the request is sent, so a page pre-rendered at `/pages/../admin` is fetched as `/admin` and can never be reached, while occupying a path that belongs to a different and possibly reserved route. Only a segment that is entirely dots is affected — `docs/v1.2/guide` is an ordinary path, and so is a slug whose segment literally contains `%2E`, since stored text reaches a URL already encoded and comes back unchanged.

  `createBlocksPage` now gives every render a finite `QueryBudget`, sized by `maxQueries` and defaulting to `DEFAULT_MAX_QUERIES` (500). `core/collection-loop` claims from that budget before each read and treats an absent one as unlimited, so a routed page nesting loops could multiply a single page view into millions of reads. The budget is created per render, never shared across requests, and `Infinity` opts out.

  A block can declare slots it may decline to render, and the SEO derivation skips them. `core/collection-loop` declares its children: it draws them once per entry, so an empty query draws them none, while the stored document looks identical either way — its template's heading would otherwise title the page with content the page does not contain. The field is internal for now and deliberately absent from `@nextlyhq/plugin-sdk`; the shape a block author should write is a decision for the Block API freeze. It closes the class for the core library, not for a contributed block that renders conditionally and declares nothing.

  `core/collection-loop` now queries in the locale the page is being rendered in, taken from the context. Without it a French page embedded default-locale rows: the surrounding blocks translated and the looped content silently did not.

  `core/image` again distinguishes a MISSING `alt` from an explicitly empty one. An explicit `alt: ""` is the block's documented way to mark an image decorative and is emitted as written; only a placement that says nothing falls back to the media record's alt text.

  `createBlocksPage` also accepts `hostPolicy` and forwards it to the renderer, so a document moved behind the route helper keeps the site-operator decisions the standalone renderer was given — such as which frame origins may keep `allow-same-origin`.

  A derived canonical is now omitted, rather than guessed, when the slug is not addressable — one holding such a segment, a reserved path, or one whose normalized form the lookup would not match (`a//b` is answered by Next with a 308 to `/a/b`, and the lookup then asks for a slug the entry does not have). The key is absent rather than `undefined`, so spreading the derived result over a caller's own metadata cannot erase a canonical they already knew.

  `prepareDocumentForRead` is public because `resolvePageStyles` is. That function is documented against the document that will RENDER, and this is the only thing that produces one, so a caller previously had to reimplement the renderer's passes to satisfy the precondition. Pruning gated nodes alone is not enough: it yields a tree LARGER than the page shows, and styles resolved against it ship rules for nodes the render drops.

- [#604](https://github.com/nextlyhq/nextly/pull/604) [`df93bcd`](https://github.com/nextlyhq/nextly/commit/df93bcda8e59c78a7be5b3cd8c8df99eef44e228) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Export defineBlock and the types a block author needs from the package entry.

  A previous changeset announced that this package exports its own defineBlock. It did not: the symbol existed but the root entry never re-exported it, so every import of it from the package name failed to resolve, and the types needed to hand-roll a definition were unexported too.

  The entry list is now pinned by a test, so a symbol added to a module can no longer silently fail to reach the people the release notes told about it.

- [#606](https://github.com/nextlyhq/nextly/pull/606) [`b978792`](https://github.com/nextlyhq/nextly/commit/b97879221014d6582364d5705f289f63deb87681) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a page styled when one of its blocks is hidden by a condition, and stop publishing a hidden block's styles. A conditioned block and everything inside it now has its rules held separately from the page's stylesheet, so the renderer serves exactly the rules of the blocks it showed instead of rebuilding the whole sheet, dropping it entirely, or leaking the styling of a block nobody was served.

- [#627](https://github.com/nextlyhq/nextly/pull/627) [`6b119f1`](https://github.com/nextlyhq/nextly/commit/6b119f1916e2d3f3dab7cb79ad512fb5db9d84da) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add colour conversions between sRGB, HSV and OKLCH for an editing surface, with no runtime dependency. Colours outside the sRGB gamut are mapped by reducing chroma while holding lightness and hue, so a colour a screen cannot show is approximated by one of the same hue rather than a different one.

- [#623](https://github.com/nextlyhq/nextly/pull/623) [`bc0f4ba`](https://github.com/nextlyhq/nextly/commit/bc0f4ba60b93d0d19cca39e2f13a90cb2cba3fbb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report a failed email delivery to the auth flow that depends on it, and stop returning password-reset and verification tokens in production responses.

  A provider failure was converted into an unsuccessful result rather than an exception, and the auth convenience methods returned nothing, so a failed password-reset send was treated as a delivered one: the user received no email and no token. Those methods now return the send result, and the auth flows check it.

  Password-reset and email-verification tokens are no longer included in the API response when delivery fails in production. Outside production they still are, so a local install works before any email provider is configured.

- [#618](https://github.com/nextlyhq/nextly/pull/618) [`1ca81bc`](https://github.com/nextlyhq/nextly/commit/1ca81bcf0928b53ae00880ac766f7556010664f3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Refuse to save email provider credentials when `NEXTLY_SECRET` is not set, instead of storing them readable.

  A provider's configuration holds SMTP passwords and API keys. Without a secret to encrypt them under, Nextly previously wrote them to the database as plain JSON. Saving a provider in that state now fails with a message naming the variable to set, matching how webhook signing secrets have always behaved.

  Providers stored before this change remain readable, so an existing install can still open, rotate, or delete them.

- [#587](https://github.com/nextlyhq/nextly/pull/587) [`ff522f3`](https://github.com/nextlyhq/nextly/commit/ff522f39fedebbeaec1649079f0d4d05b6d79b46) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A number field declared as an exact decimal now reaches a decimal column in a collection or single, whether the field is created with its table or added to an existing one. It previously became a whole-number column, so any amount with a fractional part lost it. Storage is exact on PostgreSQL and MySQL; on SQLite the column carries NUMERIC affinity, which is the closest that engine offers rather than a guarantee of exactness.

- [#596](https://github.com/nextlyhq/nextly/pull/596) [`ef2ffdc`](https://github.com/nextlyhq/nextly/commit/ef2ffdcecc12e149616c6ee2825f208fb569b3f3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating a field group through `nextly.fieldGroups.create()` or the mounted `POST /api/field-groups` route now creates its table. Both previously answered success while writing only a registry row, leaving a field group whose storage did not exist and every read and write to it failing.

  Those two routes now also refuse a create whose table another field group already owns, which only the admin path checked before. Because a slug is normalised on its way to a table name, two slugs that differ only by hyphens and underscores name one table; such a request used to reach the schema change and rebind the existing field group's storage to the new field list. The mounted route additionally rejects a slug over 50 characters, the bound the rest of the product already validates against, instead of accepting it and provisioning a table under a name the database truncates or refuses.

- [#611](https://github.com/nextlyhq/nextly/pull/611) [`c0dd9fa`](https://github.com/nextlyhq/nextly/commit/c0dd9fa4b7ab0063b04be31fcc7b15fe6d673ac3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop a block that never reaches the page from taking a node id off one that does.

  Node ids are made unique before anything renders, because they are also React's keys. That pass walked the whole stored tree, including the children of a node already known to be replaced by a placeholder. A placeholder replaces its node entirely, so those children were never going to be drawn, but they could still claim an id first and delete the later visible sibling that shared it. The reader lost real content and got a diagnostic for something that was never on the page.

  The descent now stops at a node that will not render its own markup. The node itself keeps its id, because its placeholder does render and still needs a key.

  This is the rule already applied to condition-gated nodes, and the one applied to DOM ids, extended to the one position that had been missed. Reaching it needs a document holding two nodes with the same id, which validation rejects at write time, so it can only arrive from a row edited outside the product.

- [#589](https://github.com/nextlyhq/nextly/pull/589) [`1e13063`](https://github.com/nextlyhq/nextly/commit/1e1306381ecef036ec08a6d6db3a32d8b7fdef3e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Surface the shareable preview link on the entry form.

  Opening a preview and sharing a link are grouped into one control, because an author reaching for one is deciding between them: preview uses the editor’s own session and can carry unsaved changes, while a shareable link goes to someone with no session at all and shows only what was saved.

  The control adapts to what is available rather than showing disabled buttons. With only a preview URL configured it is exactly the button that was there before; with only linking available it is a single button; with both it becomes one button with a menu, so a narrow sidebar already holding Preview, Cancel and Save does not gain a fourth.

  While the form is submitting, both menu entries are disabled individually rather than only the button that opens them. The menu is uncontrolled and stays open across the state change that begins a save, so disabling the trigger alone would leave the actions inside an already-open menu able to run alongside the write.

  When the browser refuses the copy, on an insecure origin or under a permissions policy, the link now stays on screen until it is dismissed and offers the copy again as an action. It previously appeared in a toast that dismissed itself after a few seconds, which is not long enough to select a few hundred characters of signed token by hand. The retry re-copies the link already minted rather than requesting a new one, because every mint issues another live bearer credential.

- [#619](https://github.com/nextlyhq/nextly/pull/619) [`17b20bd`](https://github.com/nextlyhq/nextly/commit/17b20bd0d4fb35348c9026f331a7f37b2b009ae5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a reusable block's styles off a page block that happens to share its id, and stop one page's custom CSS reaching another page's copy of the same reusable block. A page also no longer ships styling for reusable blocks it does not place.

- [#625](https://github.com/nextlyhq/nextly/pull/625) [`a75e3bf`](https://github.com/nextlyhq/nextly/commit/a75e3bffdb95871182c3a7b08834fd28c11d0696) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let one placement of a reusable block be styled differently from the others. Styles set on a placed reusable block were saved and never reached the page, and the Style tab offered no controls to set them; a placement now has its own style options and its look applies on top of the shared block, so customising one placement no longer means editing the block everywhere it appears. Turning a hidden block back on for a single placement works too.

- [#616](https://github.com/nextlyhq/nextly/pull/616) [`34532d1`](https://github.com/nextlyhq/nextly/commit/34532d11b9f2696ec9713170c346f4024558511e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Render the styles saved on a reusable block. A block placed from the reusable library kept whatever colours, spacing and custom CSS were stored on it, and none of it reached the page; a reusable block that happened to share an id with a block on the page silently took that block's appearance instead. Every placement of one reusable block now shares one set of styles, so editing the block updates it everywhere it appears.

- [#593](https://github.com/nextlyhq/nextly/pull/593) [`ec7aa8c`](https://github.com/nextlyhq/nextly/commit/ec7aa8c51e2cdddba123947d1a743dfc8fbda154) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Repairing a repeater or group column left over from an older table now keeps its contents. The only recovery offered before was to drop the column and recreate it empty, because the repair moved the column without converting it.

- [#629](https://github.com/nextlyhq/nextly/pull/629) [`14a3114`](https://github.com/nextlyhq/nextly/commit/14a31145ae3a0a48a81d4037e60f7893aff1adff) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A repaired legacy column that also becomes required, or stops being required, now carries that change on PostgreSQL. The repair converted the column's type and left its nullability as it was, so the applied schema contradicted the one the migration was generated from, and rolling back could not restore the original setting.

- [#624](https://github.com/nextlyhq/nextly/pull/624) [`5a6a25d`](https://github.com/nextlyhq/nextly/commit/5a6a25ded49065dc3dc762ca6b6259f6827a5dd7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Honour `RESEND_BASE_URL` and `RESEND_USER_AGENT` again in the Resend email provider.

  Moving off the Resend SDK dropped the environment overrides it read, so a deployment routing mail through a capture server or an egress proxy silently reached the public Resend API instead. Both variables are respected again, and a blank value falls back to the public host.

- [#622](https://github.com/nextlyhq/nextly/pull/622) [`402a4c4`](https://github.com/nextlyhq/nextly/commit/402a4c4fe17b02fc03b33cf41503e002d9ca5b9c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Send Resend email over the REST API directly, and drop the `resend` SDK dependency.

  Sending an email is one HTTP POST, but the SDK pulled in `svix` and `postal-mime` — webhook signature verification and inbound MIME parsing — which Nextly never called. Every install carried roughly 5 MB of unreachable code to make that request. The adapter now uses `fetch`, matching the SendLayer provider.

  No configuration changes: existing Resend providers keep working exactly as before.

- [#628](https://github.com/nextlyhq/nextly/pull/628) [`3b26e46`](https://github.com/nextlyhq/nextly/commit/3b26e46246c08e0179c7ac53f1b6c83ab08c59c0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Move the remote-host policy into the engine so one matcher can serve both the compiler and the renderer.

  Which hosts a page may fetch from is asked from two places that must not answer differently: the style compiler judging a `url()` in a stored value, and a React block judging an `img` or `iframe` source. Only the first could ask, because the matcher lived beside the page builder's own compiler. A second implementation for the renderer would be a second thing to be wrong, and two that drift apart fail silently, one permitting what the other refuses.

  `isFetchableUrl`, `isAllowedRemoteUrl`, `isRemoteUrl`, `normalizeUrl` and the `RemotePattern` types now live in `@nextlyhq/blocks-engine` and are exported from it. The page builder re-exports them, so every existing import is untouched and no behaviour changes.

  The engine's runtime-free allowlist gains `picomatch`, deliberately and with its reason recorded beside `css-tree`'s: it is the glob grammar `next/image`'s `remotePatterns` is written in, so reading the same patterns a Nextly app already declares means reading that grammar. Re-implementing it inside a security control to avoid a dependency would trade a known matcher for an unknown one. It has no dependencies of its own, imports no Node builtins, and already runs in a browser through the page builder's canvas.

- [#597](https://github.com/nextlyhq/nextly/pull/597) [`c5bc897`](https://github.com/nextlyhq/nextly/commit/c5bc897ebe0df71cc8a0c79a64ec0ac554dfe832) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a Single now removes its storage and its registry entry as one operation, so an interrupted delete can no longer leave tables behind with nothing describing them.

- [#590](https://github.com/nextlyhq/nextly/pull/590) [`6608e42`](https://github.com/nextlyhq/nextly/commit/6608e42dec7d5e6f56b6bda23a038f39d909535d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `Slider` to `@nextlyhq/ui`, under the experimental tier.

  A bounded numeric property — opacity, blur radius, letter spacing, a colour's
  alpha — is the single most repeated control in an editing surface, and every
  plugin building one would otherwise reimplement it privately. `<input
type="range">` is nearly unstyleable and cannot express two thumbs; a hand-rolled
  replacement gets pointer capture, step rounding and the per-thumb ARIA pattern
  wrong quietly. This wraps the Radix primitive, which is already the kit's
  vendor, so it adds no new dependency shape.

  `value` is an array even for a single thumb — that is what makes a range slider
  the same component rather than a second one. Commit expensive writes from
  `onValueCommit`, which fires once the drag settles, rather than `onValueChange`,
  which fires on every frame of it.

- [#630](https://github.com/nextlyhq/nextly/pull/630) [`b19f8fb`](https://github.com/nextlyhq/nextly/commit/b19f8fb3febc5c91da75d82944265b7ec337cd3c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Refuse to save a page whose blocks carry a slot the block never declared, and ignore any such slot already stored. A renamed or removed slot left its children unchecked against the block author's allowlist, and their styles — including any image URL — were still compiled into the page even though nothing rendered them.

## 0.0.2-alpha.54

### Patch Changes

- [#581](https://github.com/nextlyhq/nextly/pull/581) [`8e75d40`](https://github.com/nextlyhq/nextly/commit/8e75d407d157bf21accd86de84e48e2b0bb00218) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Typecheck the block renderer’s own tests, and give block authors a typed defineBlock.

  The package excluded test files from tsc, so its tests had never been typechecked. Adding a tests project surfaced eleven errors, nine of which shared one cause: the engine types a slot’s output as unknown because it carries no React types, so a block author could not place it in their own JSX without annotating every render by hand.

  @nextlyhq/blocks-react now exports its own defineBlock, which names the context and the slot return type. This is the same service the plugin SDK performs for plugin authors, offered to anyone rendering with this package directly.

- [#586](https://github.com/nextlyhq/nextly/pull/586) [`8e81c4f`](https://github.com/nextlyhq/nextly/commit/8e81c4f76e8b760a62575f72abfadd482ee46e3d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field access rules can ask what the caller is granted, and custom CSS is now a privilege.

  A field's `access.create` / `access.read` / `access.update` function now receives
  `permissions` and `roles` alongside `req`, so a field can be gated on a permission
  rather than only on a role. Collection-level access already received these; field
  level did not, so "only these people may write this field" was not expressible.
  The grants are resolved once per operation and only when a rule actually runs, so
  an entity with no field rules makes no extra lookup. A rule that cannot read the
  grants denies rather than opens.

  `permissions` uses the same `resource:action` spelling collection-level access
  uses. Note this differs from the `action-resource` form the database and the
  admin's permission matrix show for the same row.

  The page builder's per-page and per-block custom CSS now requires a new
  `write-builder-custom-css` permission. Without it the CSS already on a page stays
  visible and keeps applying, but cannot be changed — the field is dropped from the
  write rather than the write being rejected, so everything else on the page saves
  normally. Grant it to any role that should keep authoring custom CSS.

- [#578](https://github.com/nextlyhq/nextly/pull/578) [`a363c67`](https://github.com/nextlyhq/nextly/commit/a363c672f3b1e1940c7e099877578b1a930ec6e9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add nine core block primitives.

  Heading, text, list, quote, image, button, spacer, divider and embed join the containers already in the library, which is enough to build a real page. Each is a single element with no wrapper, no default padding and no hardcoded colour: styling belongs to the style system.

  The accessibility contracts are part of the blocks rather than left to the author. A heading renders the level the author chose rather than one derived from nesting, so the page outline does not change when a block moves. A button renders an anchor when it has a destination and a button when it does not. An image always emits alt text, empty when it is decorative. A quote keeps its attribution outside the quotation. An embed is sandboxed, carries a title, and does not leak the page path to the embedded party.

- [#585](https://github.com/nextlyhq/nextly/pull/585) [`c2ca409`](https://github.com/nextlyhq/nextly/commit/c2ca409e194e42fc7e7a298c071b72a73f33e6b7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let each block claim its own DOM id at render, instead of reserving ids in advance.

  Which node ends up writing an id is only knowable once a block has run: one that throws, or returns something with no host root, is replaced by a placeholder that emits no id at all. Reserving ids before rendering therefore meant a block that later failed had already taken the id, and the healthy node that wanted it rendered without one in exchange for nothing.

  Node ids are still made unique before rendering. Those are React keys, and a duplicate makes React reuse one block’s instance for another, which is a wrong page rather than a missing anchor.

- [#394](https://github.com/nextlyhq/nextly/pull/394) [`2892263`](https://github.com/nextlyhq/nextly/commit/28922636e9e764df96b49a9fb0871b7c922d5ad6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix localized entities breaking schema applies and singles reads: SQLite/MySQL schema syncs no longer fail once a `_locales` table exists, singles created in another dev worker resolve without a restart, enabling Internationalization without a `localization` config is rejected with a clear error (and the builder switch explains it), and adding the `localization` block to nextly.config now takes effect without a manual restart in dev.

  Collection and single tables **created on SQLite or MySQL from now on** also get the indexes Postgres and the Schema Builder already created for them, including the unique index on `slug`. Creating an entry with an explicit slug that another entry already uses now fails with a duplicate error on those dialects instead of being accepted silently. Tables created before this release keep the shape they were created with and are not backfilled, so an existing collection continues to allow duplicate slugs until its table is rebuilt.

- [#595](https://github.com/nextlyhq/nextly/pull/595) [`8b7ce78`](https://github.com/nextlyhq/nextly/commit/8b7ce7885aebb8df547fe5a7f48a14811e81dc1e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report the class library slot that was dropped when the same class is listed twice. Only the first of two entries claiming one id or one name is written, and the warning explaining that named the entry rather than the slot — so a library built by reference, with one object in two slots, reported nothing at all and left an editor with no position to repair.

- [#584](https://github.com/nextlyhq/nextly/pull/584) [`f7229c8`](https://github.com/nextlyhq/nextly/commit/f7229c84998ce6aeff627568c1fbcbfdb77eff9f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Refuse a plugin permission that collides with one a collection or single already owns, including for Schema Builder entities the config cannot see and for declarations that differ only in letter case. Honouring such a declaration hands the plugin a permission the role presets grant to editors, so the collection quietly stops being editable by them. An application already running such a plugin can set NEXTLY_ALLOW_PLUGIN_PERMISSION_OVERRIDE=1 to keep booting with a warning while it is fixed.

- [#576](https://github.com/nextlyhq/nextly/pull/576) [`8ff9c59`](https://github.com/nextlyhq/nextly/commit/8ff9c59b3ff567c6d43245224c50717da988e404) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Resolve a scoped preview link by the entry it names.

  A preview grant that names an entry is now read by that id and confirmed to live at the requested path, instead of resolving the path by slug and comparing ids afterwards. A slug is not unique, so the old order could find a different document, reject it, and fall back to published, showing an editor live content at a link they were given for a draft.

  When the named entry is gone or lives at another path, the request holds no draft authorization for that path and resolves published-only, so the widened lifecycle scope cannot surface a row the grant never named.

- [#583](https://github.com/nextlyhq/nextly/pull/583) [`e7e51d9`](https://github.com/nextlyhq/nextly/commit/e7e51d9fce1b5cff52ae90a57b0ce1ee4b7920e3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the admin side of shareable preview links.

  A `previewLinkApi` service and a `usePreviewLink` hook mint a link for one entry and put it on the clipboard. This is distinct from the Preview button beside it: Preview opens the entry using the editor’s own session and can include unsaved changes, while a preview LINK goes to someone with no session at all, so it carries its own signed authorization and shows only what was saved.

  The link is minted per click rather than cached, because it carries an expiry and a cached value would be handed out after it stopped working. When the browser refuses clipboard access, which happens on an insecure origin, the link is shown rather than a copy being claimed that never happened.

- [#580](https://github.com/nextlyhq/nextly/pull/580) [`fdefbe2`](https://github.com/nextlyhq/nextly/commit/fdefbe2aefe43081d8b1520b49d5f15ccc660a56) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add endpoints for minting and revoking preview links.

  `POST /api/nextly/preview-links` mints a link scoped to one entry, gated on `update` for that collection rather than on `publish`: someone who can edit an entry already sees its draft, so sharing a link to it grants nothing new, while requiring `publish` would break the workflow where an editor who cannot publish shows a draft to a reviewer.

  `POST /api/nextly/preview-links/revoke` invalidates every link ever issued, including sessions already in flight. It is gated on `manage settings`, because the generation it moves is site-wide.

  The mint returns a token rather than a URL, since where the preview route is mounted is the application’s decision.

- [#579](https://github.com/nextlyhq/nextly/pull/579) [`5bf444e`](https://github.com/nextlyhq/nextly/commit/5bf444ee0806bb15241cce677eaff774b64f4f77) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop shipping CSS compiled for blocks that render a placeholder.

  A node that resolves to a placeholder emits only a hidden marker, so every rule compiled for the markup it would have rendered matches nothing and ships anyway, carrying whatever those rules referenced. The stylesheet is now compiled from a tree with those nodes removed, while the render keeps them so their placeholders still appear.

- [#594](https://github.com/nextlyhq/nextly/pull/594) [`5a0c8f6`](https://github.com/nextlyhq/nextly/commit/5a0c8f69dc1283e81229ca71bc3ad0a7de4c39e4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the stylesheet a whole site shares, compiled once from its design tokens, self-hosted fonts, named classes and block-type defaults, and named by a hash of the bytes it produced. Every page of a site repeats those rules today; a shared sheet is written once and cached until something in it actually changes. A token stored without any values is now reported and skipped rather than ending the compile, which would otherwise have taken down every page on the site.

- [`a323af5`](https://github.com/nextlyhq/nextly/commit/a323af5349b4d762b52bf2d0ec4160133338be47) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold a conditionally-shown block's own styles out of the page stylesheet, returned separately so a reader can add back only the blocks it kept. A page's CSS is compiled when the document is saved and a condition is decided when the page is read, so one stylesheet otherwise carries rules — and any image URLs inside them — for blocks the reader removes. A page with no conditional blocks compiles exactly as before.

## 0.0.2-alpha.53

### Patch Changes

- [#548](https://github.com/nextlyhq/nextly/pull/548) [`946a367`](https://github.com/nextlyhq/nextly/commit/946a3672c3ada67157130491eef125372f07e9f8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A content change and the activity entry describing it are now one transaction.
  The entry was written from a post-commit hook, in its own transaction, with its
  failure swallowed, so a change could commit and then fail to record — leaving an
  edit nothing described and no way to notice. It is now written at the mutation
  seam, inside the write, and a change whose entry cannot be stored no longer
  survives.

  An update also records WHICH fields it changed, as names. Never values, never
  document bodies.

  Two consequences worth knowing. Writes performed by an API key or by internal
  maintenance no longer produce an entry: the trail attributes to an account, and
  a key's own id is not one. And `registerActivityLogHooks` is gone from
  `nextly/hooks` — the recording it wired up now happens at the write itself.

- [#413](https://github.com/nextlyhq/nextly/pull/413) [`9bd7508`](https://github.com/nextlyhq/nextly/commit/9bd7508dc238cb60803cea9158e072252a0e897a) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The admin panel moves User Management into the Settings section.

  The standalone Users icon in the main icon rail is removed. Users, User Fields,
  and Roles — and any plugin collections placed under the former "users" section —
  now appear under a new "User Management" group at the top of the Settings
  sub-sidebar. Visiting /admin/users or /admin/security/roles now highlights the
  Settings icon and opens its sub-sidebar.

  These routes are now treated as part of Settings throughout: the page
  breadcrumbs on Users and Roles pages nest under a Settings parent crumb
  (Dashboard › Settings › Users › …), matching the other Settings pages.

  A role whose only access is to users or roles still sees the Settings icon, and
  clicking it lands on /admin/users (or Roles) rather than redirecting away from
  the manage-settings-guarded General page.

- [#559](https://github.com/nextlyhq/nextly/pull/559) [`6512e2f`](https://github.com/nextlyhq/nextly/commit/6512e2fa4ff061fb9cdeead340205da8ade47f63) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting an account no longer leaves its identifiers behind in the audit trail.

  `audit_log` rows carry an address and a client, and `actor_user_id` deliberately
  has no foreign key so the trail outlives the account. An attributed write that
  resolved its actor before a deletion but landed after that deletion AND its
  post-commit sweep kept those identifiers permanently: nothing revisits the row,
  and the account it names no longer exists for a later erasure to key on.

  The decision is now made as part of the write, the way the activity trail
  already made it, and both trails share one implementation so they cannot come to
  answer it differently. Unattributed events, which name nobody, are unaffected.

- [#551](https://github.com/nextlyhq/nextly/pull/551) [`c29669c`](https://github.com/nextlyhq/nextly/commit/c29669c92e25cf340218850da01e351ab693c6a2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `migrate:baseline --adopt-unknown` adopts a translation table holding columns your config no longer describes.

  Without the flag, adoption still refuses: such a column has no field stating what it holds, and the logical kind is what decides its column type, so it cannot be rendered from config at all. Adopting anyway would record a table shape the database does not have, and a rebuilt environment would come up missing translations.

  With it, the companion is rebuilt from the database instead of from config, reproducing every column exactly as it stands along with its composite key and its cascading foreign key. The columns simply have no field reading them.

- [#545](https://github.com/nextlyhq/nextly/pull/545) [`488c668`](https://github.com/nextlyhq/nextly/commit/488c6682598ebf8164fe82c324ee606b0246ae9d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Block documents now render. `PageRenderer` turns a stored document into a React tree on the
  server: it upgrades every node to its block's current schema version, resolves the page
  stylesheet and the class each node was assigned, and renders the tree with each block contained on
  its own.

  A block that throws, that rejects, that is no longer registered, that cannot be upgraded, or that
  returns something React cannot render costs its own box and nothing else. Containment happens
  where the block is called rather than in a client error boundary, because a Server Component's
  error never reaches one, so a page of server blocks still ships no JavaScript for the renderer.
  Only blocks that are genuinely asynchronous suspend, so a page of ordinary sections streams as one
  piece instead of one chunk per block.

  Documents render with or without the CMS: block definitions, the page context and the stylesheet
  all arrive through seams that default to the CMS wiring and accept fixtures instead.

- [#563](https://github.com/nextlyhq/nextly/pull/563) [`1c4bd0a`](https://github.com/nextlyhq/nextly/commit/1c4bd0a8141989a4280ae402c8ce07cffd839e9f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - thread the working-draft layer through the content route

  `resolveContent` and `createContentRoute` gain a `draft` option, so a preview
  can show pending unpublished edits instead of live content.

  The draft model is two-layered and they fail differently: `status` covers an
  entry that has never been published, while pending edits on an ALREADY-published
  entry live in a sidecar row that no `status` scope can see. Widening `status`
  alone therefore showed a published page live while the edits being previewed
  stayed invisible. The two are gated differently: pending edits are judged
  per row by an update-capability probe, so asking for them is safe from anywhere,
  while never-published rows are judged by nothing. So `draft` widens `status`
  only on a trusted read (`overrideAccess: true`); an explicit `status` always
  wins.

  On the route the option is a per-request decision, because route config is
  captured once at module scope while whether a visitor is previewing is not:

  ```ts
  export const { ContentPage, generateMetadata, generateStaticParams } =
    createContentRoute({
      collections: ["pages"],
      draft: async ({ collection, slug }) => grantsDraftAt(collection, slug),
      render: page => <Page {...page} />,
    });
  ```

  The decision is handed the collection and slug being resolved, because Next's
  draft mode is one boolean for the whole host: `isEnabled` says a visitor opened
  a valid preview link, never which document it was for. Answering from that alone
  would turn a link scoped to one page into a key to every unpublished page in the
  configured collections.

  Returning `true` is an authorization decision rather than a display preference,
  so that request reads trusted — the route resolves anonymously and the overlay
  is gated on an update-capability probe an anonymous read can never pass. Put the
  authorization in that function, never in a query parameter.

  A draft read is never cached, and `generateStaticParams` ignores the option
  entirely, so a draft is never baked into a pre-rendered path.

- [#574](https://github.com/nextlyhq/nextly/pull/574) [`6cf9fac`](https://github.com/nextlyhq/nextly/commit/6cf9fac8180f8257503dc41432e899ddd47c3e8a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Move the core block library into the renderer package and register it at boot.

  The block definitions now live in `@nextlyhq/blocks-react/blocks` rather than inside the page-builder plugin. A block needs the document model and React and nothing else, while the plugin peers the admin and the CMS runtime, so blocks kept there could only be used by a host that had both. That contradicted the renderer’s own promise that a document renders standalone.

  They are also registered now. They were deliberately withheld from the registry while no renderer could draw them, because registering them would have made validation call the type known while the page still drew the unknown-block placeholder. The renderer has shipped, so the core blocks are registered at boot, before any contributed block, and attributed to the page builder.

  `PageContext` gains `item` (the entry a repeater is currently on) and `queries` (a shared read allowance), which the dynamic block needs and the renderer did not previously carry.

- [#549](https://github.com/nextlyhq/nextly/pull/549) [`1d8d8c1`](https://github.com/nextlyhq/nextly/commit/1d8d8c12f7010b4653014f12831265208dd84432) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Custom CSS can use `@keyframes` and `@font-face` again.

  Both were dropped wholesale because the name each defines is resolved for the
  whole document, however tightly the rules around it are scoped — so two page
  builder documents on a page, or a document and its host, that both define
  `fade` do not get one each. For `@font-face` it went further: family names match
  case-insensitively, so declaring `Inter` from inside a scoped region would have
  replaced the font the host renders its whole site in.

  The names now carry the scope's namespace, and your own references to them are
  rewritten to match, so you write `fade` and `MyFont` and they work. A name your
  CSS does not define is left alone, which means you can still reference an
  animation the page itself provides.

  `@font-face` still may only load a font from this site's own origin, and a rule
  left without a usable `src` is removed rather than left declaring a family that
  resolves to nothing.

  Each rendered document now carries a class of its own alongside `nx-pb-page`,
  and its tokens and custom CSS are anchored to it. Two page builder documents on
  one page no longer share a scope: one document's custom CSS stays inside that
  document, and their `@keyframes` and `@font-face` names no longer resolve to
  whichever `<style>` happened to load last. `nx-pb-page` is unchanged and still
  matches every document, so host CSS written against it keeps working.

  A site can define design tokens and self-hosted fonts, and the styling layer
  emits both.

  Tokens are dot-path names (`color.primary`, `space.4`, `content.width`) written
  under a prefix the site chooses, `--site-` by default. `--nx-` and `--tw-` are
  refused: tokens under either would restyle the admin interface or Tailwind's
  internals as well as the site. Every token may carry a dark value, emitted
  behind a `data-nx-theme="dark"` attribute the host controls, or behind
  `prefers-color-scheme` where the site prefers to follow the operating system.

  `content.width` ships in the default set, so editing one token re-widths every
  centred container.

  Fonts must be self-hosted. A `@font-face` pointing at another server makes every
  visitor's browser announce its IP address to that server before the page can be
  read, so a remote URL is a validation error naming the remedy — upload the file
  and point `src` at a path on this site. A face that fails validation emits
  nothing rather than half a rule, since a family whose file never loads renders
  as the browser default rather than as the next family listed.

  Site tokens import and export in the Design Tokens Community Group format, the
  one Figma, Style Dictionary and Tokens Studio read.

  A dot-path name is a PATH there, not a name — the format reserves the period —
  so `color.primary` exports as the token `primary` inside the group `color`, and
  importing flattens it back. Most DTCG values are objects now: a dimension is
  `{"value": 16, "unit": "px"}` and only `px` or `rem` are allowed, and a colour
  is components with an optional hex fallback rather than a hex string.

  That means a token holding `clamp()`, `1.5em` or a `var()` reference has no
  conformant DTCG value at all. Each export therefore carries both the native
  value and the exact CSS under Nextly's own `$extensions` key, and import prefers
  that key — so a file that leaves Nextly and comes back is unchanged, while a
  file from Figma still imports correctly. A token that cannot be represented is
  reported rather than exported under a shape that would misdescribe it, and
  another tool's extension data is carried through untouched in both directions,
  as the format requires.

  `checkContrast(foreground, background)` reports the WCAG 2 ratio and the level
  it meets, compositing translucent colours against what sits behind them first.
  It returns nothing for a colour it cannot read, rather than a figure somebody
  would act on.

- [#395](https://github.com/nextlyhq/nextly/pull/395) [`e5e9db7`](https://github.com/nextlyhq/nextly/commit/e5e9db70f872993bdd6b80fd9ee55d217d755e84) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix deleting an indexed field (media/upload, relationship, unique, or indexed) failing on SQLite with "Failed query: ALTER TABLE ... DROP COLUMN": the schema pipeline and generated migrations now drop a removed field's index before its column, and down-migrations recreate the column before its index. Also fix media fields on Singles always reading back as null on SQLite ("db.execute is not a function"): upload expansion now uses the dialect-portable query builder, matching collections, and absolutizes local-storage media URLs.

- [#566](https://github.com/nextlyhq/nextly/pull/566) [`41a54ed`](https://github.com/nextlyhq/nextly/commit/41a54eddba8e7dd66739650366fd508088d25bc7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder: creating or updating a Single or a Field Group no longer reports a failed migration when the schema change actually succeeded. Enabling localization on a Single now completes instead of leaving translated values with nowhere to live.

- [#551](https://github.com/nextlyhq/nextly/pull/551) [`c29669c`](https://github.com/nextlyhq/nextly/commit/c29669c92e25cf340218850da01e351ab693c6a2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `nextly migrate:baseline`, the step that adopts a database which already exists. A project developed with `db:sync` has real tables and no migration history, so its first `migrate:create` diffed the config against nothing and emitted CREATE TABLE for the whole schema — a file that could never be applied, because the database matched neither the empty baseline it assumed nor the target it described. Baselining records where the history begins, and the next `migrate:create` emits only what changed.

  It writes a real migration alongside the snapshot rather than only a marker, so a new environment, CI, or `migrate:fresh` can still build the schema from the history alone, and records it as applied in the same command so it never re-runs against the database it was taken from.

  The drift error now recognises this case. A database standing before the history started is not drift, and the three recoveries offered for drift all fail on it, so it names the cause and points at the one command that works.

- [#553](https://github.com/nextlyhq/nextly/pull/553) [`6c1bbbc`](https://github.com/nextlyhq/nextly/commit/6c1bbbc1dbf5b06bb17713090a05c6b16dae2c57) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Declare the primary key in generated `CREATE TABLE` statements. Every table a migration created was key-less: the desired snapshot has carried the marker since the diff needed it to exempt primary keys from the nullability comparison, and the SQL renderer dropped it. Any project whose tables were created by `nextly migrate` has content tables with no primary key, no uniqueness enforcement on `id`, and no primary-key index. Existing migration files are unchanged; new ones declare the key, and a table already created without one needs a corrective migration.

  Live introspection now records the primary key too, so a snapshot taken from a database describes the key it actually has. Statements generated from such a snapshot previously rebuilt the schema without one.

- [#542](https://github.com/nextlyhq/nextly/pull/542) [`6ec956c`](https://github.com/nextlyhq/nextly/commit/6ec956c8532d68d8a6e48a428ecc4c7d7b96306a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add named classes: a set of styles applied to many blocks and changed in one place, compiled between a block's defaults and a block's own values so a class overrides the first and is overridden by the second. Which of two classes wins is the order they are given in the library, not the order a block lists them. A block carrying more class references than a page can use now reads a bounded prefix and reports that it stopped, as the class library already did.

- [#570](https://github.com/nextlyhq/nextly/pull/570) [`8ca85e9`](https://github.com/nextlyhq/nextly/commit/8ca85e91b37c023b48be54621ad4f4651bce734e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Page-builder node classes come from the engine's digest, not a second one.

  The compiler had its own 32-bit hash emitting the same `nx-pb-` prefix the
  engine emits from a wider one, so a node could be named two ways, and the narrow
  digest carried a real chance of two nodes on a large page sharing a class and
  each other's styles. It now uses the engine's 53-bit digest and its collision
  handling: one map is built per document and used by the stylesheet, the rendered
  markup and the editor preview alike, so a collision resolves to two classes
  rather than one node wearing another's styles.

  Every generated node class and per-document scope class therefore changes value.
  They are compiler-generated and recomputed on every render, so nothing stored
  refers to them, but a host that hardcoded one in its own CSS should re-read it.

- [#571](https://github.com/nextlyhq/nextly/pull/571) [`0955295`](https://github.com/nextlyhq/nextly/commit/09552958fecdf658e9ad59565a0ce8e08f7839b5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A reusable block keeps its own node classes.

  A resolved `core/ref` rendered its target using the containing document's class
  map. That map is keyed by node id, and a stored subtree can hold an id the
  document also holds, so a referenced node could take a class belonging to a
  different node and be styled by rules compiled for it. Referenced subtrees are
  outside the walk the map is built from, so they now take their plain class.

  The Query Loop sample preview in the editor renders the same template through the
  production renderer and was naming nodes the other way, so it disagreed with the
  editable template above it wherever a class had been disambiguated.

- [#540](https://github.com/nextlyhq/nextly/pull/540) [`4ce333c`](https://github.com/nextlyhq/nextly/commit/4ce333cae65f8b05519e85cb922a2f2f9b977973) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now generate Content-Security-Policy fetch directives for
  the hosts it is configured to allow, as a backstop to the origin policy already
  enforced when compiling styles and markup.

  `cspDirectives(remotePatterns)` builds `img-src`, `media-src`, `frame-src`,
  `font-src`, `style-src`, `object-src 'none'` and `base-uri 'self'`. Your app
  sends the header from its own middleware or `next.config`.

  `style-src` carries `'unsafe-inline'`, because the renderer emits its scoped CSS
  as inline `<style>` elements and the alternative is a per-request nonce that
  would force dynamic rendering. What it still buys you is the part that matters
  here: the HOST a stylesheet may be loaded from is bounded, so a block rendering
  `<link rel="stylesheet">` cannot pull one from anywhere. `base-uri` is the one
  non-fetch directive, because a cross-origin `<base href>` re-points every
  relative URL on the page and no fetch directive can express that.

  If the response already carries a policy — Nextly's own security headers send
  one — union these into it with `mergeCspDirectives` rather than sending a second
  header. Policies intersect rather than extend, so an existing `img-src 'self'`
  refuses your CDN however many other policies allow it.

  Only patterns that translate EXACTLY produce a source: an absent or `https`
  protocol, a lowercase domain (literal or with one leading wildcard label), an
  absent, empty or non-default port, no `search`, and no path constraint. Anything
  else is refused and named by `unexpressibleHosts`.

  The awkward cases are where the two grammars read the same word differently. A
  CSP `http://` source also matches https — which is why an absent protocol
  translates (it means either scheme on both sides) while an explicit `http` one
  cannot. A default port is refused because the URL parser removes it before the
  matcher compares, so the pattern matches nothing while the source matches the
  canonical form. An IP address is refused because CSP host matching ignores any
  host that is not a domain, so the source could never match. `**.example.com` is
  normalised to `*.example.com`, which accepts the same hostnames on both sides.

  A `pathname` is refused outright, which is worth calling out because it looks
  translatable and is not. CSP enforces a source's path only on the initial
  request, so an allowed URL that redirects elsewhere on the same host still
  passes; and it percent-decodes both sides before comparing, so a path also
  admits its encoded aliases. Both widen, so a path-scoped pattern gets no source
  and is reported instead. The generated policy is therefore never broader than
  the one it backstops; where it cannot express a host, you add that source
  yourself.

  No `script-src` and no `default-src`, which is one decision: a nonce-based
  script policy forces dynamic rendering on every page and would defeat ISR, and
  `default-src` is the fallback for `script-src`, so emitting one would take that
  choice back silently. This is therefore a backstop rather than a complete
  policy — `prefetch` and `prerender` fall back to `default-src` and are not
  covered by it. Nextly's own security headers already send `default-src 'self'`,
  which is the other reason merging into your existing policy is the recommended
  path rather than sending this value alone.

  `unmergeableStylePolicy(existing)` names a style directive carrying a nonce or
  hash. CSP stops honouring `'unsafe-inline'` once one is present, so merging into
  such a policy would look successful and still block every inline style the
  renderer emits.

- [#544](https://github.com/nextlyhq/nextly/pull/544) [`dcad4d5`](https://github.com/nextlyhq/nextly/commit/dcad4d569b8aa7327aa0a5fbe8e7c003223f61e0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Granting a role a permission that did not exist yet is fixed on two counts.

  The created permission's slug was composed as `resource-action` while every
  authorization check reads `action-resource`, so the new permission was one
  nothing could find: the grant showed as assigned in the admin panel and
  authorized nothing. Only the REST route reached this path, because the two
  in-tree callers pass an explicit slug.

  The same path also threw on SQLite. It called Drizzle's transaction directly,
  and better-sqlite3 rejects an async callback, so creating a permission failed
  outright on the default dialect. It now uses the cross-dialect helper the rest
  of the services use.

  Composing a permission slug is now a single shared function rather than a
  string built by hand at each of eleven call sites, which is what let one of
  them drift.

  The SQLite bootstrap DDL was missing columns its own schemas define — `users`
  lacked `must_change_password`, `media` lacked `focal_x`, `focal_y` and `sizes`.
  A database created from it (the fallback used when drizzle-kit's push cannot
  run, for example without a TTY) therefore had tables the ORM could not write
  to: Drizzle names every column in an INSERT, so each write naming one of those
  failed outright. The columns are restored, and a test now compares every table
  in that DDL against the schema that defines it, so the two cannot drift apart
  again in silence.

- [#555](https://github.com/nextlyhq/nextly/pull/555) [`c0cee63`](https://github.com/nextlyhq/nextly/commit/c0cee63f94754a3fb65898a685baeb16c9789b3c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Do not let a plugin take ownership of the publish permission for a collection created in the Schema Builder. Permission reservation decided what an entity was from the config alone, so a Builder collection — which exists only in the database — was invisible to it. The role presets read ownership to decide what Editor is granted, so the permission silently stopped being granted and became eligible for the orphan sweep when the plugin was removed.

- [#557](https://github.com/nextlyhq/nextly/pull/557) [`e78cf4d`](https://github.com/nextlyhq/nextly/commit/e78cf4dedebe4b0f6d3a34b54c291626ca885fff) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Draft previews no longer need an API key. A preview link now opens a draft session for
  exactly one entry: `createPreviewRoute` checks the token, turns on Next's draft mode, and carries
  the token onward in an httpOnly cookie so the rest of the request knows which document that session
  covers.

  The scope has to travel separately because Next's draft mode is a single boolean for the whole
  host — turning it on without it would let a link meant for one unpublished page unlock every
  unpublished page. `readPreviewScope` re-checks the token on every read rather than trusting that
  the route once said yes, so expiry and revocation reach sessions already in flight, and
  `previewGrantsDraft` answers the one question a read path should ask.

  Every refusal looks the same — a 404 with no cookie and no draft mode — so the endpoint cannot be
  used to discover which entries have drafts.

- [#554](https://github.com/nextlyhq/nextly/pull/554) [`2beb151`](https://github.com/nextlyhq/nextly/commit/2beb151171cad362ed914aba92ecd0b7ce00b30d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal groundwork for scoped preview links. Adds the token itself — signed with a key
  derived separately from the session key, scoped to a single entry, short-lived, and revocable in
  bulk — with no route, no export and no caller yet, so nothing a consumer can reach changes in
  this release.

- [#567](https://github.com/nextlyhq/nextly/pull/567) [`c51eb8e`](https://github.com/nextlyhq/nextly/commit/c51eb8e1ca007a15621ae5c36533ff5707480232) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a preview-link revocation generation to site settings.

  Every preview token records the generation it was minted under and is verified against the current one, so incrementing it invalidates every link ever issued, including sessions already in flight, with nothing to store, sweep or replicate per token.

  The counter is incremented by the database rather than read-then-written, so two revocations running at once cannot lose one another. It is excluded from the settings update surface because writing a lower value would re-validate links that a revoke had already invalidated.

- [#568](https://github.com/nextlyhq/nextly/pull/568) [`90d8214`](https://github.com/nextlyhq/nextly/commit/90d821467923edfe6b6eb1254f552dfc8691039b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Harden the block renderer against malformed stored documents and hostile block output.

  The document envelope is now checked before it is read, so a corrupt column holding a non-object renders a placeholder instead of throwing in the page component where no block boundary exists. A stored attribute bag with several case variants of `id` now reserves the value that will actually render, matching the last-write-wins rule the render path uses. A node stored ahead of its block definition no longer reserves a DOM id it will never emit.

  Block output is checked further: a `dangerouslySetInnerHTML.__html` value React cannot convert to a string is refused rather than left to throw during serialization, an object impersonating the `React.lazy` shape is refused, and a promise inside an element rejected for its own shape is now marked handled so a rejection cannot take the process down.

- [#556](https://github.com/nextlyhq/nextly/pull/556) [`ccaa140`](https://github.com/nextlyhq/nextly/commit/ccaa140893fbd1953b9b309da6ab58e7a6f9b6d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating a Single from the Schema Builder now writes its table and its registry row as one
  operation, so an interrupted create leaves a record of what it was doing instead of a table nothing
  knows about.

  On MySQL, retrying any Schema Builder migration that stopped part way now succeeds instead of
  reporting the already-correct schema as a failed migration. MySQL cannot express "create this index
  only if it is missing", so the retry previously failed the same way every time and left no way
  forward.

- [#564](https://github.com/nextlyhq/nextly/pull/564) [`9363bd5`](https://github.com/nextlyhq/nextly/commit/9363bd56eea82ebca880515946ad744fd47a55ee) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Custom CSS and site tokens read a few more names the way a browser does.

  A name written with CSS escapes is now recognised wherever one can appear: a
  custom property spelled `\2d\2d anim`, a unit spelled `1m\73`, an `rgb()`
  whose function name carries an escape. Each of these is ordinary CSS that
  renders, and each was previously read as something else or not read at all.

  Names are also followed into two places they were not. A reference written only
  in a `var()` fallback — the branch that runs exactly when the variable is not
  set — now follows the rename, and so does the `-webkit-` prefixed animation
  shorthand.

  Inside a `font` shorthand each fallback is read against the slot its `var()`
  occupies rather than one verdict for the whole declaration. A fallback in the
  line-height slot is no longer mistaken for a family, and a family fallback that
  follows an earlier function is no longer skipped.

  Several spellings that CSS discards are no longer treated as usable. A bare
  `default` is the keyword rather than an animation name; a `@font-face` family
  descriptor written as a bare CSS-wide keyword is ignored, as the browser
  ignores it; and a `src` entry needs a real argument, so `local()` with nothing
  in it no longer counts as a font this site can load.

  Design-token export refuses two more things it cannot honestly represent: a
  family list holding a bare CSS-wide keyword, or an item that is not an
  identifier run, since neither names a font. Import refuses a colour whose `hex`
  contradicts its own components rather than silently preferring one.

- [#572](https://github.com/nextlyhq/nextly/pull/572) [`3f60a36`](https://github.com/nextlyhq/nextly/commit/3f60a36eea90c1cee2996a9f80daa57c53d77af3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add an opt-in style trace: when a caller asks for it, compiling a page also returns every declaration that was written, in the order it was written, with the tier it came from — the page, a block type default, a named class, or the block itself. Recorded by the emitter from the declarations it emits, so it cannot describe a page the browser is not rendering. Nothing is produced for callers that do not ask, so a visitor page render is unchanged.

- [#575](https://github.com/nextlyhq/nextly/pull/575) [`cccd5b6`](https://github.com/nextlyhq/nextly/commit/cccd5b6f76ff1391e6901d4338375cd2ed8f6fd9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a way to ask which recorded declaration a block is actually showing for one property, at one state and width. Reads the trace the compiler produced, so it reports what the stylesheet does rather than working it out a second time: a rule reaches a block through its own styles, a class it applies, its block type, or the page, and a rule that styles something inside a block also reaches down from an ancestor.

- [#552](https://github.com/nextlyhq/nextly/pull/552) [`13d7d1d`](https://github.com/nextlyhq/nextly/commit/13d7d1dc5e8ffbfcd3dedd4693ef493c400496e6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `TreeView`: a virtualized, keyboard-operable tree for hierarchies too large to render whole, such as an editor's layers panel. Only the visible window is rendered, so the hierarchy is described through `aria-level`, `aria-setsize` and `aria-posinset` rather than nested markup, which cannot exist when an item's children are outside the window.

## 0.0.2-alpha.52

### Patch Changes

- [#532](https://github.com/nextlyhq/nextly/pull/532) [`4902ef4`](https://github.com/nextlyhq/nextly/commit/4902ef42388fc4317d5b8e98ed6729184608c58d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give a column added by an edit the constraints and indexes creating the table would have attached: a one-to-one is unique, a relationship is indexed, and a requested index exists. Adding a required relationship to a collection that already has entries is now refused with the steps that work instead of emitting invalid SQL, and removing a relationship drops its foreign key first on MySQL and is refused on SQLite, which cannot drop one without rebuilding the table.

- [#526](https://github.com/nextlyhq/nextly/pull/526) [`8bdf575`](https://github.com/nextlyhq/nextly/commit/8bdf575b5837387973ffc226f1820f79abb7b2f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Erase a deleted account's request identifiers from the auth log.

  Deleting a user already removed their name and email from the activity log while
  keeping the record itself. The auth log identifies a person a second way — by the
  address they connected from and the client they used — and those survived
  untouched. They are now erased on the same deletion, stamped with when, while the
  event kind, the actor and target references and the timestamp stay: that is the
  security fact a retained trail exists for.

  Erasure is keyed on the actor. A row naming someone as the TARGET carries the
  address of whoever acted on them, so erasing by target would scrub a different
  person's data and leave the subject's own in place. Events recorded without an
  actor — a failed login, a rejected CSRF — are out of reach by design, since they
  are written unattributed precisely so a failure cannot reveal which account was
  reached; nothing links them to a person, so no deletion can find them. This
  table is pruned on `audit.retention.authMaxAgeMs` — 180 days by default — so a
  window is what bounds them. A window is a weaker guarantee than an erasure,
  which is why the metadata projection below is default-deny: what never enters is
  the only thing certain not to persist.

  Whether each table can be erased is now decided per table. A database can carry
  one and not the other, and answering for the pair would let a missing auth log
  suppress the activity erasure, leaving behind the names and emails the deletion
  exists to remove.

  Identifiers are also kept out of the auth log's `metadata` in the first place. A
  `NextlyError`'s `logContext` is written for operator triage, and a failed login
  puts the attempted email address there; the auth handlers copied that context
  into the stored event wholesale. A failure is recorded with no actor precisely
  so it cannot reveal which account was reached, so nothing links such a row to a
  person and the deletion that erases their other rows can never find it — the
  identifier has to not be stored rather than be erased later. Only an allowlisted
  set of diagnostic keys is now copied, default-deny, so a key added for logging
  cannot silently become a field of the audit trail.

  Naming a key is not enough on its own, because none of the values are ours to
  begin with. An `AuthStrategy` is application code and chooses its own failure
  reason; an error's `code` accepts any string, and the two diagnostic codes are
  copied straight from it. Each retained value is now checked against a vocabulary
  this package controls — a reason it produces, or a code the canonical table
  defines — and anything else is dropped. The value still reaches the operator log;
  what it no longer does is enter a trail nothing can associate with a subject.

  The reasons are named in one place that the handlers emitting them now compile
  against, so a new reason is a type error until it is listed rather than being
  discarded without a diagnostic. Three that the initial-password exchange already
  emitted were being discarded that way, leaving `pending-token-wrong-challenge`, a
  stale must-change state, and a missing user indistinguishable from each other in
  the trail. All three are recorded again.

  **Upgrading: rows written before this change are not covered.** The handlers
  previously stored the whole error context, so existing unattributed
  `login-failed` rows can already hold an attempted email address or a user id.
  Deletion is keyed on the actor and those rows have none, so nothing reaches them
  — the projection applies only to failures recorded from now on.

  Accounts deleted BEFORE this change are not covered either, for the opposite
  reason: their attributed rows still hold the address and client they connected
  from, and the erasure added here runs during a deletion — it can never run for
  an account that is already gone. `actor_user_id` carries no foreign key, so
  those rows survive as orphans pointing at nothing.

  Scrub both once, before or after upgrading:

  ```sql
  -- Rows recorded without an actor: the context the handlers used to store
  -- wholesale, which may name an attempted address.
  UPDATE audit_log SET metadata = NULL
  WHERE actor_user_id IS NULL AND metadata IS NOT NULL;

  -- Rows attributed to accounts that no longer exist: their request identifiers,
  -- which the deletion that removed them never erased.
  UPDATE audit_log SET ip_address = NULL, user_agent = NULL
  WHERE actor_user_id IS NOT NULL
    AND actor_user_id NOT IN (SELECT id FROM users);
  ```

  The first discards the diagnostic codes on those rows along with the
  identifiers. The second leaves `actor_user_id` in place — the trail should still
  say that the same someone did these things, only not who they were. The event,
  its outcome and its timestamp are columns, and neither statement touches them:
  that is the security fact the trail exists for.

  **Upgrading, PostgreSQL and MySQL: one required action.** If you hardened
  `audit_log` by revoking UPDATE — the posture this package previously documented —
  grant it back for the three columns an erasure touches, or deleting a user will
  fail and roll back:

  ```sql
  GRANT UPDATE (ip_address, user_agent, identity_erased_at) ON audit_log TO app_role;
  GRANT DELETE ON audit_log TO app_role;
  ```

  Two duties need those grants. Erasing the address and client a deleted account
  connected from is an UPDATE, and it runs inside the deletion's transaction, so a
  blanket revoke blocks account deletion outright. Pruning rows past their window
  is a DELETE, and a role without it fails every pass silently — retention must
  never fail the request that offered it — so the table grows unbounded while the
  setting reads as enforced. Revoke DELETE only together with
  `audit: { retention: { authMaxAgeMs: false } }`, so the configuration says what
  the privileges actually do. Every other column stays immutable. Deployments that
  never restricted these grants, and all SQLite deployments, need no action.

  ***

  Prune the activity and auth trails on a schedule.

  **This deletes data the first time it runs.** Set the windows before you deploy
  if you need longer ones.

  Neither trail has ever actually been pruned. `activity_log` has claimed a 90-day
  policy in its own schema comment since it was introduced, but the cleanup that
  comment named was never called from anywhere — and could not have worked if it
  had been, because it referenced a column that does not resolve and its failure
  would have been swallowed. Installs are therefore carrying every row ever
  written, while the schema said otherwise. `audit_log` never promised anything
  and grew unbounded too.

  Both are pruned now, and the first pass removes everything already past its
  window:
  - `activity_log` — content activity, who changed what — **90 days**
  - `audit_log` — sign-ins, password changes, role grants — **180 days**

  90 for content activity is what the comparable self-hosted CMSes default to, and
  180 for auth events is what GitHub and Atlassian Cloud retain: security
  questions are asked later than editorial ones, because a compromise is usually
  noticed well after the sign-in that caused it.

  To keep more, configure it **before** upgrading:

  ```ts
  export default defineConfig({
    audit: {
      retention: {
        activityMaxAgeMs: 365 * 24 * 60 * 60 * 1000,
        authMaxAgeMs: false, // keep auth history forever
      },
    },
  });
  ```

  Each window is independent, so bounding the high-volume feed while keeping
  security history indefinitely is one setting rather than a compromise.
  `audit: { retention: false }` keeps everything, as today.

  Passes run opportunistically off content writes, at most one per interval,
  batched, and never fail the write that offered them. Batching matters on the
  first run in particular: an install that has never pruned faces every row it has
  ever written, and an unbounded `DELETE` there would take a long lock on the
  largest table at the worst possible moment.

  Scheduling is now shared rather than duplicated. The gate, interval and
  never-throw wrapper that webhook retention already used are a general mechanism,
  so audit retention registers a pass with it instead of introducing a second one.
  Each pass is gated on its own key: a single shared marker would let whichever
  pass ran first consume the interval for the others, and the busier domain would
  starve the rest indefinitely.

- [#539](https://github.com/nextlyhq/nextly/pull/539) [`49d44ae`](https://github.com/nextlyhq/nextly/commit/49d44ae78d13ae0fa52f241fcfbdbf5fd19485a1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): add the React renderer package boundary

  Adds `@nextlyhq/blocks-react`, the React/RSC renderer for Nextly block
  documents. This change lands the package and its layering guarantees; the
  renderer itself follows.

  The root entry imports no `next/*`, no admin code and no CMS runtime, so a
  document can be rendered from a plain React app, a test or a script. Everything
  Next-coupled lives at the `@nextlyhq/blocks-react/next` subpath, so importing
  the renderer never pulls Next into a consumer's module graph. Both rules are
  enforced by an allowlist-based import test rather than by convention.

  `PageContext` and `BlocksDataProvider` are also introduced: the seam through
  which data, media URLs and entry paths reach a block, so blocks never reach for
  a database directly.

- [#536](https://github.com/nextlyhq/nextly/pull/536) [`d53bc9f`](https://github.com/nextlyhq/nextly/commit/d53bc9ffd2b9d28a2b5f33ee5f6f3199f74fecfb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A text column keeps the width the builder that created it gave it.

  A text field that states no width does not have one right answer. Three builders create tables and
  they read a width from different keys and read silence differently: the Schema Builder's collection
  creator bounds on a short variant, its field-group creator bounds on a declared `maxLength` and
  never looks at a variant, and code-first tables were built with a bounded default. Which rule
  applies is a fact about the entity, not about the field.

  Describing a column without that fact meant guessing, and each place that guessed got it wrong for
  at least one builder. On MySQL a field group's short text field was described as unbounded when it
  had been created bounded, so a schema preview reported a type change on a column nobody had
  touched, and applying it would have rewritten the column. The same guess reached the localization
  companion tables, Single identity seeding, and the path that adds a column to a table that already
  exists.

  The builder is now named wherever a column shape becomes DDL, so the width follows the table rather
  than being re-derived from the field. Paths that only look a table up to run a query are unaffected:
  a declared width is enforced by the database, not by the ORM.

- [#514](https://github.com/nextlyhq/nextly/pull/514) [`bffeac4`](https://github.com/nextlyhq/nextly/commit/bffeac4b3e7b8dbf834a8c76bd2b45f65728a9cb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Custom CSS in the page builder can no longer load anything from another origin.
  A `url()` carrying a scheme or a host is refused, and the editor says which
  declaration went and why, with a remedy that works whichever storage adapter the
  media library uses.

  This closes a way of reading data off the page. A selector that matches only on
  a prefix, paired with a URL that fires a request when it matches, spells a value
  out one character at a time — `input[value^="a"] { background: url(...) }`,
  repeated. Custom CSS is the only surface where an author writes both halves, so that is
  where the ban is absolute.

  Banning it in custom CSS alone would not have closed the channel, because the
  two halves need not be written in the same place. A block's background image is
  compiled into the same stylesheet, so a remote image there plus a custom
  selector that suppresses it conditionally still leaks by the request's ABSENCE,
  with no URL in the custom CSS to refuse.

  So a block's images are restricted the same way, and a site declares the hosts
  it loads from. A relative path such as `/media/a.png` needs nothing; anything
  carrying a host needs an entry, INCLUDING an absolute URL on your own domain,
  exactly as `next/image` already requires:

  ```ts
  <PageRenderer
    document={doc}
    remotePatterns={[
      { protocol: "https", hostname: "cdn.example.com", pathname: "/img/**" },
    ]}
  />
  ```

  The policy covers every value a block emits, not the properties someone
  remembered can fetch: `filter: url(…)` is a request too, and so is
  `filter: var(--missing, url(…))`, whose URL lives in a fallback the parser
  leaves as raw text. A protocol-relative `//host/a.png` is refused rather than
  resolved against a guess, since the document's protocol is not knowable when the
  stylesheet is compiled.

  BREAKING, and wider than images: every resource a block loads on its own is now
  refused until its host is declared. On upgrade, add the hosts below to
  `remotePatterns` or the content stops rendering.

  | block                                         | what stops            | host to declare                         |
  | --------------------------------------------- | --------------------- | --------------------------------------- |
  | `core/image`                                  | the image             | wherever your media is served from      |
  | `core/cover`, `core/slides`, flip cards       | the background        | same                                    |
  | `core/gallery`, the carousels, `core/hotspot` | the images            | same                                    |
  | `core/video`                                  | the source and poster | your media host                         |
  | `core/lottie`                                 | the animation         | the animation's CDN                     |
  | `core/embed` (URL mode)                       | the iframe            | e.g. `www.youtube.com`                  |
  | `core/map`                                    | the iframe            | `www.google.com`, or your own tile host |

  This includes absolute URLs pointing at your own site: nothing in the compiler
  knows what your host is, so `https://your-site.com/a.png` needs an entry while
  `/a.png` needs none — the same line `next/image` draws. If your media library
  stores absolute URLs, which the cloud storage adapters do, declare your own host.

  A custom block registered from outside this package applies the policy itself:
  its `render` receives `remotePatterns`, and `mediaUrl` / `cssMediaUrl` are
  exported for it. The renderer cannot inspect the element a block returns, so a
  block that writes a URL into an `src` or an inline background without asking
  reaches whatever host it names. The shape is Next.js's `images.remotePatterns`, so an entry can
  be copied straight across from `next.config`, and the posture matches
  `next/image` — nothing off-origin unless you said so. Matching uses picomatch
  with the same options `next/image` uses, rather than an approximation of it, so
  `hostname` and `pathname` globs mean exactly what they already mean in your
  `next.config`. `search` is honoured too.

  Everything the sanitizer removes is now reported rather than dropped silently,
  including at-rules it does not support. A rule that disappears with nothing on
  screen to explain it reads as a bug in the builder, and the author's own source
  still contains the line that did not survive.

  CSS the sanitizer cannot read through — a rule nested deeper than it follows, or
  a fragment it cannot parse — is still removed, but it is now reported as
  unchecked rather than as a remote URL. It previously named the whole rule as the
  offending address, which sent authors looking for a host their stylesheet never
  mentioned. The depth it follows also rose well past real CSS: the old limit
  refused valid stylesheets at five levels of nesting, which ordinary compiled CSS
  reaches.

  BREAKING, for anyone calling the sanitizer directly: `sanitizeCustomCss` and
  `sanitizeBlockCss` return `{ css, warnings }` rather than a string. They are
  re-exported from the package root, so this is a visible change even though the
  page builder itself is the only expected caller. Read `.css` where you read the
  result before.

  Also on that surface: `CssWarning["code"]` gains `"unchecked"`, which a switch
  over the union has to handle, and CSS that fails to parse outright now reports
  `"unchecked"` where it reported `"unsafe-value"`. `MAX_RULE_NESTING` and
  `MAX_VALUE_NESTING` are exported alongside them.

- [#528](https://github.com/nextlyhq/nextly/pull/528) [`938898d`](https://github.com/nextlyhq/nextly/commit/938898d1daf26e1bad8a84f3e46eec55570f4e41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `create-nextly-app` recognises the development-diagnostics setting however an existing `.env`
  spells it, and no longer mistakes a different variable for it.

  A substring test treated `NEXTLY_DEV_DIAGNOSTICS_BACKUP=1` as the setting already being present,
  so such a project was skipped and never told the real one exists. The check now matches an
  assignment at the start of a line, including the commented form and the `export KEY=value` form
  dotenv accepts so a file can also be sourced by a shell.

  The whitespace in that match is confined to the current line. Allowing it to cross newlines made
  the scan backtrack across the blank lines an `.env` is full of, which is quadratic on the common
  case of a file that does not contain the key at all.

- [#537](https://github.com/nextlyhq/nextly/pull/537) [`a281098`](https://github.com/nextlyhq/nextly/commit/a281098de1cd45a7a089af7a5e8f04a1673e6c4f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Direct API types a row the way the process sees it: a timestamp is the Date the driver decoded, not the formatted string a REST response carries. Codegen records which fields a collection or single stores in a timestamp column, and the wire types are unchanged.

  A write returned an undecoded row on the raw-SQL paths, so a created row carried epoch numbers on SQLite where a fetched one carried Dates. Every raw-SQL row now decodes the way a read does.

  The media services name the error code they mean rather than leaving the boundary to infer one from a status, so a folder-name clash keeps saying "already exists" instead of "reload".

- [#529](https://github.com/nextlyhq/nextly/pull/529) [`17be415`](https://github.com/nextlyhq/nextly/commit/17be4155dcf03bd917cc547293dd5b6ee806256e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `SubmissionDocument.status` now includes `"spam"`, and gains `spamReason`.

  The stored field has always offered `spam`, the admin has a Spam tab and filters its other views
  with `not_equals: "spam"`, the notification hook skips it, and marking something "Not spam" moves
  it back to `new`. Only the TypeScript type disagreed, so it described a shape the database cannot
  produce — narrowing on `status` could not see the case that actually reaches the UI.

  The conversions from a stored row to this plugin's document types now live in one module rather
  than at six call sites. They are still unchecked assertions, which the module says plainly:
  the services layer answers with a loose row and TypeScript has no overlap to verify. Nothing about
  runtime behaviour changes; the unchecked step is now in one place a reviewer can find.

- [#521](https://github.com/nextlyhq/nextly/pull/521) [`d58130a`](https://github.com/nextlyhq/nextly/commit/d58130a0679313f5819de7e71242e3afde130a01) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the Schema Builder's DDL generator, the column descriptor and the write path agreeing on which
  fields are junction-backed. A field carrying `relationType: "manyToMany"` was treated as
  junction-backed by the descriptor whatever its type, while the generator emitted a junction table
  only for a `relationship`. An `upload` declared many-to-many therefore got a parent column that the
  runtime schema and the schema diff did not know about, so the diff proposed dropping it on every
  apply.

  Junction storage is a `relationship` feature, because that is the only shape the read and write
  paths implement, so an `upload` carrying that option keeps its own column and is unaffected: a
  single target is a foreign key, `hasMany` or an array of targets a JSON array of ids. A
  `relationship` many-to-many is unchanged — no parent column, one junction table.

- [#519](https://github.com/nextlyhq/nextly/pull/519) [`3a1b43b`](https://github.com/nextlyhq/nextly/commit/3a1b43b754392c33c58452c945a8eaa537463f04) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **One table now decides what an HTTP status means when a failure names no error code.**

  Three tables used to, and they disagreed. The same code-less 401 reached a Direct API caller as
  `AUTH_REQUIRED` and a REST caller as `INTERNAL_ERROR`; a code-less 429 lost its rate-limit
  identity entirely, and with it the `Retry-After` a client needs to back off correctly. The media
  service kept a third table that read 409 as `DUPLICATE` and 422 as `BUSINESS_RULE_VIOLATION`.

  A code-less failure now resolves through one shared table for 400, 401, 403, 404, 409, 413, 415,
  422, 429, 502 and 503, and anything unrecognised stays an internal error. The producer's own
  status is preserved rather than rounded to the code's canonical one.

  **The table is a fallback, not a translation.** A status is coarser than a code: 409 covers both
  "that name is taken" and "someone else edited this", which need opposite advice. A service that
  knows which one it means sets `code` and is believed. `MediaResponse`, `DeleteMediaResponse`,
  `FolderContentsResponse` and the folder bulk-delete result can carry a code for exactly this
  reason, and creating a folder whose name is taken now says so through `DUPLICATE` rather than
  relying on a boundary to guess.

  **A code-less failure never puts its own message on the wire.** Those envelopes come from legacy
  converters that may store a raw exception's text, so the caller gets the generic sentence for the
  derived code and the detail stays in the operator log. A failure that names a code keeps its own
  message, which the producer authored to be read.

  Behaviour changes worth checking if you read error bodies directly: a code-less 401 answers
  `AUTH_REQUIRED` instead of `INTERNAL_ERROR`; a code-less 429 answers `RATE_LIMITED`; a code-less
  422 answers `INVALID_INPUT`; and through the Direct API a code-less failure's message is now the
  generic sentence rather than the service's raw text.

- [#538](https://github.com/nextlyhq/nextly/pull/538) [`4f009ae`](https://github.com/nextlyhq/nextly/commit/4f009ae2b05799234c4d07442ea61c4f1799dff7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now hand its own configuration to its own admin components.

  A plugin's factory runs on the server, where the host builds its config; its
  admin components run in the browser. Nothing carried a value between the two, so
  a plugin could ship behaviour it had no way to configure. `contributes.admin.clientConfig`
  travels with the rest of the admin metadata, and `usePluginClientConfig` reads it
  back. It is PUBLIC — `/api/admin-meta` needs no authentication, so it reaches
  anonymous callers and must hold nothing secret — and the serializer refuses
  anything that will not survive the trip rather than delivering a mangled copy.

  The page builder uses it for `remotePatterns`. The editor canvas previously
  enforced an empty allowlist while the published page enforced the host's, so it
  hid images the live page shows.

  Pass the SAME value to both `pageBuilder({ remotePatterns })` and
  `PageRenderer`. They are separate assignments: the plugin option configures the
  editor, and `PageRenderer` reads only its own prop. Setting just one is what
  produces a mismatch, in whichever direction you set it — a shared constant in
  the host is the way to keep them equal.

- [#523](https://github.com/nextlyhq/nextly/pull/523) [`f835ca9`](https://github.com/nextlyhq/nextly/commit/f835ca9680c7bd12d5e512092ae23958eb49292f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New apps document the development error-diagnostics opt-in.

  An error response is deliberately generic — a code, a public message and a request id — and
  withholds the log context and the underlying cause so a response cannot disclose driver output,
  table names or internal paths. That is right for a deployed app and unhelpful while building,
  where the withheld part is exactly what you need.

  `NEXTLY_DEV_DIAGNOSTICS=1` adds a `_devDiagnostics` field carrying that detail. It existed
  already, and nothing mentioned it, so an author hitting an error had no reason to suspect a flag
  would have named the cause. `create-nextly-app` now writes it into `.env` and `.env.example`
  **commented out, with an explanation**, and `docs/configuration/environment.mdx` describes it with
  a worked example.

  It is documented rather than enabled: the flag is the second of two independent signals, and the
  second exists because `NODE_ENV` is a runtime value a deployment can carry by mistake. A default
  shipped in `.env` would be true in exactly that case — the one it guards against.

  Installing into an existing project that already has a configured `.env` adds the note too, keyed
  on its own absence rather than on `DATABASE_URL`.

- [#541](https://github.com/nextlyhq/nextly/pull/541) [`72c894b`](https://github.com/nextlyhq/nextly/commit/72c894b89f68667af2e2b16e79a1795bdbca10fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A timestamp is stored the same way whatever the server timezone is. The raw-SQL write paths bound a JS Date directly, so the driver serialized it with the local offset and a column declared without a time zone kept the local wall clock, while every read interpreted that wall clock as UTC. A row written and read back on a server five hours ahead of UTC came back five hours late. Values are now encoded through the column the same way a Drizzle query encodes them, on PostgreSQL and MySQL; SQLite was unaffected, storing unix seconds, which carry no zone.

  Rows written before this on a server that was not on UTC keep the wall clock they were given, so a table can hold both conventions until those rows are corrected. Deployments running UTC, which includes every default container image, are unaffected either way.

- [#543](https://github.com/nextlyhq/nextly/pull/543) [`9ccff93`](https://github.com/nextlyhq/nextly/commit/9ccff938431db8afba3f67bf5f5107ee8448388c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add two editor-shell primitives to the UI kit: a right-click context menu, and resizable panel regions whose split can be dragged or moved from the keyboard. Both are experimental until a first-party plugin uses them.

- [#525](https://github.com/nextlyhq/nextly/pull/525) [`6c77f8f`](https://github.com/nextlyhq/nextly/commit/6c77f8f196acd65848dd4348a277ebec6b07f710) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/ui`'s release tags now reach the published types. Every export in the
  barrel carried `@public` or `@experimental`, and none of it survived the build:
  the declaration bundler flattens each re-export into one `export { … }` clause
  and drops the doc comment attached to the export statement, so an editor
  hovering `badgeVariants` was told nothing about its stability. The tags live on
  the declarations now, where the bundler keeps them, and 229 of them reach
  `dist/index.d.ts` where there were none.

  `toast` and `ToasterProps` are re-exported from `sonner`, so their declarations
  are not ours to annotate; they stay tagged in the barrel only. `cn` and
  `uiPreset`, which ship from their own subpaths, carry `@experimental` now as
  `STABILITY.md` already classified them.

  Twenty prop types were also promoted to `@public`, which is a widening rather
  than a change of intent: `STABILITY.md` already guaranteed that a prop type
  carries the same stability as its component, and every one of these belonged to
  a public component while advertising `@experimental` — so the published type
  withdrew what the component promised, and a plugin could not wrap `Tabs` or
  `Dialog` without depending on something labelled unstable. The rule is now
  enforced by a test rather than written down.

  Modal scrims are a theme token. Six components wrote the backdrop inline as
  `bg-black/80`, identical in light and dark and at four different strengths, so
  it could be neither themed nor white-labelled and was invisible to every token
  check the package has. `--nx-overlay` (with `--nx-overlay-soft` for a scrim over
  content rather than the page, and `--nx-overlay-strong` for one that carries
  text directly — a full-screen state screen, an image lightbox and its caption,
  where the muted detail line rather than the heading decides the strength: over
  a white page `text-white/60` is 2.81:1 on the see-through scrim and 5.66:1 on
  the strong one) is defined for both modes and used everywhere,
  with `bg-overlay` / `bg-overlay-soft` utilities in the v4 theme AND in
  `@nextlyhq/ui/tailwind-preset`, so the documented Tailwind v3 path generates
  them too. Dialogs, sheets and the command palette now share one backdrop
  strength rather than three.

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
