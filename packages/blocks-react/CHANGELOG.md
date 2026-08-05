# @nextlyhq/blocks-react

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
