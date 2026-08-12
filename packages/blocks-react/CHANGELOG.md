# @nextlyhq/blocks-react

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

- Updated dependencies [[`175ed53`](https://github.com/nextlyhq/nextly/commit/175ed53cc50e162ae65e47fc73c139c254b89ab8), [`3709979`](https://github.com/nextlyhq/nextly/commit/3709979d10c1301b7882ab0132af4b2347de47d6), [`80ca19e`](https://github.com/nextlyhq/nextly/commit/80ca19e69f5e875f809291863d4c31d33e815554), [`07cd50f`](https://github.com/nextlyhq/nextly/commit/07cd50f4d9ed38ad5d8fbfa644358c17ec4a885b), [`b4e032b`](https://github.com/nextlyhq/nextly/commit/b4e032b862a85d9605360f1c0e3b65b4999cc882), [`19f35d9`](https://github.com/nextlyhq/nextly/commit/19f35d993da7242b084568c74765d75871b3c266), [`8f5d785`](https://github.com/nextlyhq/nextly/commit/8f5d785e2f1bf9614f5242e2c60ee76752d6983c), [`18b529b`](https://github.com/nextlyhq/nextly/commit/18b529b3509206a6b231fd004811a1fa0169f058), [`e1d573e`](https://github.com/nextlyhq/nextly/commit/e1d573e2333fcd7f59eb96d688fe55c23aed9e49), [`f054383`](https://github.com/nextlyhq/nextly/commit/f0543837d0a198d27dee073d078127d95d06f25f), [`743772f`](https://github.com/nextlyhq/nextly/commit/743772f0e3515d2a2cc8cadc700fe45688f56d65), [`ba3a72c`](https://github.com/nextlyhq/nextly/commit/ba3a72c8f664183587552cf88d50f1a13b8bc504), [`a2f2080`](https://github.com/nextlyhq/nextly/commit/a2f2080260f422a37dfc46d42a440c1976e6ae2f), [`5d6f049`](https://github.com/nextlyhq/nextly/commit/5d6f04923abc2459d78a0d7bba0a8f4c73b08fe1), [`d23b9d7`](https://github.com/nextlyhq/nextly/commit/d23b9d7b657b8ade24794e25e8e3f9de7635c96f), [`3b88fff`](https://github.com/nextlyhq/nextly/commit/3b88fffbd0ad44664a700c70310759abadde4ca9), [`edf2b04`](https://github.com/nextlyhq/nextly/commit/edf2b04eab4eb04aa0b4cb8505aa14baaa5d6c20), [`249649e`](https://github.com/nextlyhq/nextly/commit/249649eb921b10f6d87d7a7049c04d355a3e5f93), [`e0e7714`](https://github.com/nextlyhq/nextly/commit/e0e77147aa55d93d1bedfe5f3d7e67b4df2a8db4), [`fe694de`](https://github.com/nextlyhq/nextly/commit/fe694de18295a7a0266fda55a4bf770e7e4db341), [`968b7ce`](https://github.com/nextlyhq/nextly/commit/968b7ce98ce0a898e3e4e03f3370011249145f5f), [`4b2c025`](https://github.com/nextlyhq/nextly/commit/4b2c0250d9f3c82ea4f3764069750c4407883221), [`1ddda0f`](https://github.com/nextlyhq/nextly/commit/1ddda0ff4b976ea7f4f0e9f5a0d67d6d342d00c3), [`38135e8`](https://github.com/nextlyhq/nextly/commit/38135e8cf95b0ba2d444a296fd5b1c85b4d45647), [`6823b57`](https://github.com/nextlyhq/nextly/commit/6823b57db4fd20fc329d853dc4bc7e7737e56d24), [`8b136ed`](https://github.com/nextlyhq/nextly/commit/8b136edce2f7bfd2c1cfeaaa56fe964a7569d5d9), [`68145f1`](https://github.com/nextlyhq/nextly/commit/68145f1ab90b2a188918a2e463302de66275c914), [`80723ec`](https://github.com/nextlyhq/nextly/commit/80723ecd758237170f67cde756385572eb7c8b52), [`264bda2`](https://github.com/nextlyhq/nextly/commit/264bda2eb787413b1c1f3de67361f882556aa6bf), [`db83c18`](https://github.com/nextlyhq/nextly/commit/db83c18c935f53d773ffa2001045a3697778800b), [`0585842`](https://github.com/nextlyhq/nextly/commit/0585842547da6da9b8e62c9599b52ea4dbac6e43), [`a3e1849`](https://github.com/nextlyhq/nextly/commit/a3e1849eb52d8e71c9f549960e63e635a4d9d4dd), [`ed5e26e`](https://github.com/nextlyhq/nextly/commit/ed5e26ecb8efbe990b9619d37a3d4296bfa46e49), [`038935d`](https://github.com/nextlyhq/nextly/commit/038935d4e78aa74dc346f8c6b3d0aab16899dcd4), [`9c12a68`](https://github.com/nextlyhq/nextly/commit/9c12a68e18de3637b14403ed66f0d7658cc0875e), [`c4de051`](https://github.com/nextlyhq/nextly/commit/c4de0513f8d75dcf8a2fec5afe8168e48795165d), [`3278f13`](https://github.com/nextlyhq/nextly/commit/3278f139eeba5022edfc5ec6563a0ab4061921f3), [`bb4ebd0`](https://github.com/nextlyhq/nextly/commit/bb4ebd06da5f31d2f41eb7ba233a5745a2e1ac00), [`532ed04`](https://github.com/nextlyhq/nextly/commit/532ed04aea8e990e23998f8853037eb48927e5d5), [`891ec3b`](https://github.com/nextlyhq/nextly/commit/891ec3b0eb968913727e78558a2cc2fdb4c9eb7c)]:
  - nextly@0.0.2-alpha.56
  - @nextlyhq/blocks-engine@0.0.2-alpha.56

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

- Updated dependencies [[`1d0d27d`](https://github.com/nextlyhq/nextly/commit/1d0d27da2ff89c7df6ccf71fa9f85dde69a7e703), [`81d2590`](https://github.com/nextlyhq/nextly/commit/81d2590371146cb9fe36910785ec20bd17c8439e), [`008cc36`](https://github.com/nextlyhq/nextly/commit/008cc36a3c4100cd8a81f5de14b677bb12b74e81), [`df93bcd`](https://github.com/nextlyhq/nextly/commit/df93bcda8e59c78a7be5b3cd8c8df99eef44e228), [`b978792`](https://github.com/nextlyhq/nextly/commit/b97879221014d6582364d5705f289f63deb87681), [`6b119f1`](https://github.com/nextlyhq/nextly/commit/6b119f1916e2d3f3dab7cb79ad512fb5db9d84da), [`bc0f4ba`](https://github.com/nextlyhq/nextly/commit/bc0f4ba60b93d0d19cca39e2f13a90cb2cba3fbb), [`1ca81bc`](https://github.com/nextlyhq/nextly/commit/1ca81bcf0928b53ae00880ac766f7556010664f3), [`ff522f3`](https://github.com/nextlyhq/nextly/commit/ff522f39fedebbeaec1649079f0d4d05b6d79b46), [`ef2ffdc`](https://github.com/nextlyhq/nextly/commit/ef2ffdcecc12e149616c6ee2825f208fb569b3f3), [`c0dd9fa`](https://github.com/nextlyhq/nextly/commit/c0dd9fa4b7ab0063b04be31fcc7b15fe6d673ac3), [`1e13063`](https://github.com/nextlyhq/nextly/commit/1e1306381ecef036ec08a6d6db3a32d8b7fdef3e), [`17b20bd`](https://github.com/nextlyhq/nextly/commit/17b20bd0d4fb35348c9026f331a7f37b2b009ae5), [`a75e3bf`](https://github.com/nextlyhq/nextly/commit/a75e3bffdb95871182c3a7b08834fd28c11d0696), [`34532d1`](https://github.com/nextlyhq/nextly/commit/34532d11b9f2696ec9713170c346f4024558511e), [`ec7aa8c`](https://github.com/nextlyhq/nextly/commit/ec7aa8c51e2cdddba123947d1a743dfc8fbda154), [`14a3114`](https://github.com/nextlyhq/nextly/commit/14a31145ae3a0a48a81d4037e60f7893aff1adff), [`5a6a25d`](https://github.com/nextlyhq/nextly/commit/5a6a25ded49065dc3dc762ca6b6259f6827a5dd7), [`402a4c4`](https://github.com/nextlyhq/nextly/commit/402a4c4fe17b02fc03b33cf41503e002d9ca5b9c), [`3b26e46`](https://github.com/nextlyhq/nextly/commit/3b26e46246c08e0179c7ac53f1b6c83ab08c59c0), [`c5bc897`](https://github.com/nextlyhq/nextly/commit/c5bc897ebe0df71cc8a0c79a64ec0ac554dfe832), [`6608e42`](https://github.com/nextlyhq/nextly/commit/6608e42dec7d5e6f56b6bda23a038f39d909535d), [`b19f8fb`](https://github.com/nextlyhq/nextly/commit/b19f8fb3febc5c91da75d82944265b7ec337cd3c)]:
  - nextly@0.0.2-alpha.55
  - @nextlyhq/blocks-engine@0.0.2-alpha.55

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

- Updated dependencies [[`8e75d40`](https://github.com/nextlyhq/nextly/commit/8e75d407d157bf21accd86de84e48e2b0bb00218), [`8e81c4f`](https://github.com/nextlyhq/nextly/commit/8e81c4f76e8b760a62575f72abfadd482ee46e3d), [`a363c67`](https://github.com/nextlyhq/nextly/commit/a363c672f3b1e1940c7e099877578b1a930ec6e9), [`c2ca409`](https://github.com/nextlyhq/nextly/commit/c2ca409e194e42fc7e7a298c071b72a73f33e6b7), [`2892263`](https://github.com/nextlyhq/nextly/commit/28922636e9e764df96b49a9fb0871b7c922d5ad6), [`8b7ce78`](https://github.com/nextlyhq/nextly/commit/8b7ce7885aebb8df547fe5a7f48a14811e81dc1e), [`f7229c8`](https://github.com/nextlyhq/nextly/commit/f7229c84998ce6aeff627568c1fbcbfdb77eff9f), [`8ff9c59`](https://github.com/nextlyhq/nextly/commit/8ff9c59b3ff567c6d43245224c50717da988e404), [`e7e51d9`](https://github.com/nextlyhq/nextly/commit/e7e51d9fce1b5cff52ae90a57b0ce1ee4b7920e3), [`fdefbe2`](https://github.com/nextlyhq/nextly/commit/fdefbe2aefe43081d8b1520b49d5f15ccc660a56), [`5bf444e`](https://github.com/nextlyhq/nextly/commit/5bf444ee0806bb15241cce677eaff774b64f4f77), [`5a0c8f6`](https://github.com/nextlyhq/nextly/commit/5a0c8f69dc1283e81229ca71bc3ad0a7de4c39e4), [`a323af5`](https://github.com/nextlyhq/nextly/commit/a323af5349b4d762b52bf2d0ec4160133338be47)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.54

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

- Updated dependencies [[`946a367`](https://github.com/nextlyhq/nextly/commit/946a3672c3ada67157130491eef125372f07e9f8), [`9bd7508`](https://github.com/nextlyhq/nextly/commit/9bd7508dc238cb60803cea9158e072252a0e897a), [`6512e2f`](https://github.com/nextlyhq/nextly/commit/6512e2fa4ff061fb9cdeead340205da8ade47f63), [`c29669c`](https://github.com/nextlyhq/nextly/commit/c29669c92e25cf340218850da01e351ab693c6a2), [`488c668`](https://github.com/nextlyhq/nextly/commit/488c6682598ebf8164fe82c324ee606b0246ae9d), [`1c4bd0a`](https://github.com/nextlyhq/nextly/commit/1c4bd0a8141989a4280ae402c8ce07cffd839e9f), [`6cf9fac`](https://github.com/nextlyhq/nextly/commit/6cf9fac8180f8257503dc41432e899ddd47c3e8a), [`1d8d8c1`](https://github.com/nextlyhq/nextly/commit/1d8d8c12f7010b4653014f12831265208dd84432), [`e5e9db7`](https://github.com/nextlyhq/nextly/commit/e5e9db70f872993bdd6b80fd9ee55d217d755e84), [`41a54ed`](https://github.com/nextlyhq/nextly/commit/41a54eddba8e7dd66739650366fd508088d25bc7), [`c29669c`](https://github.com/nextlyhq/nextly/commit/c29669c92e25cf340218850da01e351ab693c6a2), [`6c1bbbc`](https://github.com/nextlyhq/nextly/commit/6c1bbbc1dbf5b06bb17713090a05c6b16dae2c57), [`6ec956c`](https://github.com/nextlyhq/nextly/commit/6ec956c8532d68d8a6e48a428ecc4c7d7b96306a), [`8ca85e9`](https://github.com/nextlyhq/nextly/commit/8ca85e91b37c023b48be54621ad4f4651bce734e), [`0955295`](https://github.com/nextlyhq/nextly/commit/09552958fecdf658e9ad59565a0ce8e08f7839b5), [`4ce333c`](https://github.com/nextlyhq/nextly/commit/4ce333cae65f8b05519e85cb922a2f2f9b977973), [`dcad4d5`](https://github.com/nextlyhq/nextly/commit/dcad4d569b8aa7327aa0a5fbe8e7c003223f61e0), [`c0cee63`](https://github.com/nextlyhq/nextly/commit/c0cee63f94754a3fb65898a685baeb16c9789b3c), [`e78cf4d`](https://github.com/nextlyhq/nextly/commit/e78cf4dedebe4b0f6d3a34b54c291626ca885fff), [`2beb151`](https://github.com/nextlyhq/nextly/commit/2beb151171cad362ed914aba92ecd0b7ce00b30d), [`c51eb8e`](https://github.com/nextlyhq/nextly/commit/c51eb8e1ca007a15621ae5c36533ff5707480232), [`90d8214`](https://github.com/nextlyhq/nextly/commit/90d821467923edfe6b6eb1254f552dfc8691039b), [`ccaa140`](https://github.com/nextlyhq/nextly/commit/ccaa140893fbd1953b9b309da6ab58e7a6f9b6d7), [`9363bd5`](https://github.com/nextlyhq/nextly/commit/9363bd56eea82ebca880515946ad744fd47a55ee), [`3f60a36`](https://github.com/nextlyhq/nextly/commit/3f60a36eea90c1cee2996a9f80daa57c53d77af3), [`cccd5b6`](https://github.com/nextlyhq/nextly/commit/cccd5b6f76ff1391e6901d4338375cd2ed8f6fd9), [`13d7d1d`](https://github.com/nextlyhq/nextly/commit/13d7d1dc5e8ffbfcd3dedd4693ef493c400496e6)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.53

## 0.0.2-alpha.52

### Patch Changes

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

- Updated dependencies [[`4902ef4`](https://github.com/nextlyhq/nextly/commit/4902ef42388fc4317d5b8e98ed6729184608c58d), [`8bdf575`](https://github.com/nextlyhq/nextly/commit/8bdf575b5837387973ffc226f1820f79abb7b2f4), [`49d44ae`](https://github.com/nextlyhq/nextly/commit/49d44ae78d13ae0fa52f241fcfbdbf5fd19485a1), [`d53bc9f`](https://github.com/nextlyhq/nextly/commit/d53bc9ffd2b9d28a2b5f33ee5f6f3199f74fecfb), [`bffeac4`](https://github.com/nextlyhq/nextly/commit/bffeac4b3e7b8dbf834a8c76bd2b45f65728a9cb), [`938898d`](https://github.com/nextlyhq/nextly/commit/938898d1daf26e1bad8a84f3e46eec55570f4e41), [`a281098`](https://github.com/nextlyhq/nextly/commit/a281098de1cd45a7a089af7a5e8f04a1673e6c4f), [`17be415`](https://github.com/nextlyhq/nextly/commit/17be4155dcf03bd917cc547293dd5b6ee806256e), [`d58130a`](https://github.com/nextlyhq/nextly/commit/d58130a0679313f5819de7e71242e3afde130a01), [`3a1b43b`](https://github.com/nextlyhq/nextly/commit/3a1b43b754392c33c58452c945a8eaa537463f04), [`4f009ae`](https://github.com/nextlyhq/nextly/commit/4f009ae2b05799234c4d07442ea61c4f1799dff7), [`f835ca9`](https://github.com/nextlyhq/nextly/commit/f835ca9680c7bd12d5e512092ae23958eb49292f), [`72c894b`](https://github.com/nextlyhq/nextly/commit/72c894b89f68667af2e2b16e79a1795bdbca10fa), [`9ccff93`](https://github.com/nextlyhq/nextly/commit/9ccff938431db8afba3f67bf5f5107ee8448388c), [`6c77f8f`](https://github.com/nextlyhq/nextly/commit/6c77f8f196acd65848dd4348a277ebec6b07f710)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.52
