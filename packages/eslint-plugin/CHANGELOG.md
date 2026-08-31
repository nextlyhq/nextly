# @nextlyhq/eslint-plugin

## 0.0.2-alpha.62

### Patch Changes

- [#1382](https://github.com/nextlyhq/nextly/pull/1382) [`0a3ea83`](https://github.com/nextlyhq/nextly/commit/0a3ea834a9d57c4ab659e6f67d6d37971f842223) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block that draws more than one element could only style one of them. Its
  default styles are keyed by block type, so they compile to a single rule on a
  single class — the figure wrapping an image and its caption, or the list
  wrapping its items, share one class and everything not wearing it is
  unreachable. `core/form` had already flattened its own markup to work around
  this, at the documented cost that a label sits as far from its own control as
  from the next field.

  A block can now name the elements it renders and state styles for each. The
  names are a closed set the block publishes rather than open selectors, so a
  block may change what it draws without invalidating styles addressed to it.

- [#1376](https://github.com/nextlyhq/nextly/pull/1376) [`067a435`](https://github.com/nextlyhq/nextly/commit/067a435c4b2e6bf56118e4b2f9b8009000cd25f1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A published page emitted styling hooks that nothing styled, so a correct
  document rendered broken: images ran full width past their column, body text had
  no gutter, and a call to action drew as bare underlined link text.

  The mechanism was already here. A block definition's `baseStyles` compiles to
  one rule per block type PRESENT in the document, every default is wrapped in
  `:where()` so it weighs nothing against a site's own CSS, and the token set
  merges in three tiers. Six blocks used it; four more do now.

  `core/image` takes `max-width: 100%` with `height: auto`. The element carries
  width and height attributes from the media record, which reserve its box and
  prevent layout shift — and are also a SIZE, so an asset wider than its column
  overflowed. Constraining the width alone would leave the attribute height
  standing and draw the image squashed, so the pair moves together or not at all.

  `core/button` takes one look rather than variants, because `type` there is the
  HTML attribute rather than a visual kind. Its colours are tokens and its
  geometry is literal: a literal colour is wrong in whichever mode it was not
  chosen for, while no radius token is guaranteed to exist.

  `core/list` gets its markers back and `core/quote` its indent. Both are removed
  by an ordinary CSS reset — Tailwind's Preflight sets `list-style: none` on every
  list and zeroes margins everywhere, and the scaffold this project ships imports
  it — so a bulleted list rendered with no bullets and a quotation was
  indistinguishable from a paragraph. The list states `list-style-type: revert`
  rather than a marker, because one rule serves both `<ul>` and `<ol>` and naming
  a marker would put bullets on ordered lists.

  A contained container is finally constrained. The rule behind that class could
  not be a block default at all — containment is a PROP, so every container of a
  type wears the same block-type class whether it opted in or not, and a default
  keyed by type would constrain the ones that declined. It is emitted by the site
  stylesheet instead, reading the site's own `content.width` token through the
  same prefix resolution that declared it, and it states no width of its own: a
  site whose tokens omit one gets no containment rather than a width from a place
  it cannot see.

- [#1406](https://github.com/nextlyhq/nextly/pull/1406) [`bc7d846`](https://github.com/nextlyhq/nextly/commit/bc7d8464e6bddf2b901d2857ed3667c6ed5be464) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a calendar view of what ships when. The releases page now offers two views of the same set: a list, which answers what launches exist, and a month grid, which answers what is coming and whether anything collides — a question the list can only answer by being read end to end. Each day shows how much is happening and whether any of it has stopped, and selecting a day lists those releases at full width; a month grid goes unreadable if the releases themselves are drawn into it, and the cells are narrow at any window size. Narrow screens get the month as an agenda instead of a squeezed grid, because somebody on a phone is usually asking what happens next rather than what collides.

  The times are shown in a zone the reader chooses, named on the page, and remembered between visits. This is not a detail: a release carries an instant and the author's timezone, so which day it lands on has no answer until a zone is named — a launch at eleven at night in New York is the following day in London. Without an explicit choice two colleagues comparing the same page would see one launch on two different days, with nothing on screen to explain why. The zone arithmetic the schedule input already used has moved into one module shared by both, since two implementations of a timezone conversion agree until a daylight boundary and then differ by an hour in a way neither screen can show.

- [#1396](https://github.com/nextlyhq/nextly/pull/1396) [`8fa8293`](https://github.com/nextlyhq/nextly/commit/8fa8293ece897161417b36f3f5cabb1ae4bfb7a3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the page-builder canvas centred whenever an author chooses a zoom level. Choosing a scale used to move the page against the left edge of the canvas — not only when zooming out, but at 100% too on any breakpoint narrower than the region, so a mobile preview sat hard left while the same tier was centred before the zoom control was touched. Centring now travels with the width the canvas is given rather than being restated at each branch that sets one, so the box is centred at every scale it can be drawn at, and above 100% it overflows and scrolls from the left edge exactly as before.

- [#1393](https://github.com/nextlyhq/nextly/pull/1393) [`36d6ab2`](https://github.com/nextlyhq/nextly/commit/36d6ab2a1f57f16233ffd3204b1dcf5943971e1e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Added the dashboard widget surface: a widget registry, a source registry that names collections rather than tables, a declarative query that is validated before it compiles, and `POST /api/dashboard/query` to run a batch of them for the signed-in caller. Every widget read goes through the ordinary access-controlled path with the requesting user, so a widget returns exactly the rows that caller could have listed itself — including the refusal it would get for filtering or sorting on a field carrying a read rule, which a widget query is given no exemption from.

  The sources a widget may name are derived from the collection registry, which is what makes BOTH ways of defining a collection queryable: a collection drawn in the Schema Builder lives only in that registry and has no entry in `nextly.config.ts` at all. They are read where a query needs them rather than snapshotted at boot, so a collection created while the app is running is queryable without a restart, and one that has been deleted stops being nameable.

  The endpoint decides whether the caller may read a source BEFORE it says anything specific about the query. A source the caller may not use answers exactly as one that does not exist does — same for an unsupported op and for a query that fails while running — with the detail in the log, so the endpoint cannot be used to enumerate an install's collections or to read database error text. A malformed request body answers in the same `{ error: { code, message, requestId } }` envelope as every other endpoint.

  Changed the shape of a plugin's `contributes.admin.widgets` entries. `component` stays REQUIRED, because the dashboard grid renders a widget through its component and through nothing else, so a widget without one would be accepted everywhere and draw an empty cell. The new declarative fields — `title`, `archetype`, `defaultSize`, the size bounds, `query` and `link` — are all OPTIONAL additions, so existing `{ id, component, size }` declarations keep compiling unchanged. `size` is the sizing the current grid reads; `defaultSize` is published for the archetype-driven grid and is not read yet.

  A widget definition is validated more completely at registration: `defaultSize` must sit inside `minSize`/`maxSize` rather than only those two agreeing with each other, `defaultHeight` must name a real height rather than being enforced by the type alone, a `custom` widget's `component` must be more than an empty or whitespace-only string, and `overrideWidget(id, def)` requires `def.id` to be the id it replaces. The registry stores an immutable snapshot, so a definition edited after registration no longer bypasses validation, the `extendWidget` patch allowlist or the `overrideWidget` path. `WidgetHeight`, `WIDGET_HEIGHTS` and the source-contract vocabularies (`WidgetSourceField`, `WidgetSourceFieldType`, `WidgetSourceKind`, `WidgetOp`) are exported from the root, so every type a published shape names can be named. A collection declared `timestamps: false` no longer offers `createdAt`/`updatedAt` as selectable or sortable fields it does not have.

  A source's `kind` is now derived from its id: the `collection:`, `single:` and `system:` namespaces are reserved for their own kinds, so a source cannot be registered whose id and kind disagree — which previously let a plugin claim `collection:posts` and make every dashboard query request fail when the collection sources were next rebuilt. Source registration also stores an immutable snapshot, so the field allowlist a query is checked against cannot be edited after it was validated. The fields a collection exposes are read through the shared addressable-fields walk, so a field inside an unnamed presentational group — stored at the collection's top level — is selectable, sortable and filterable, while a field inside a repeater, stored per row, is correctly not offered.

  The widget surface is re-exported from `@nextlyhq/plugin-sdk`, which is the only package a plugin author is asked to import: `registerWidget`, `registerSource`, the query and source contracts, and every vocabulary a published shape names. Exported from the `nextly` root alone, and with no `nextly/widgets` subpath, the registry could not be reached at all by a plugin following the documented surface. It is `@experimental` alongside `PluginAdminWidget`, which is the same feature seen from the contributions side.

  A collection with Draft/Published enabled now declares its `status` column, so a widget can select, sort and filter on it -- the flag reaches the source the same way `timestamps` does. A collection without one still does not, since the column does not exist there.

  A contributed admin widget must carry a usable `id` and `component` before it is published. `component` is required by the type, which reaches a TypeScript caller and nothing else, so a plugin authored in JavaScript could contribute an empty one and the dashboard grid would draw a blank card from it; the id keys that cell, so a blank one collides with every other blank one.

  `POST /api/dashboard/query` checks the request body before it touches the database, so a malformed body or a batch over the cap no longer costs a collection-registry read per attempt. A batch's read decisions are taken through the bounded authorization path rather than started all at once, so 30 queries naming 30 different collections no longer open 30 simultaneous permission reads from a cold cache.

  A `near` or `within` filter is validated with the same parsers that execute it, so a malformed geo value is refused instead of being accepted and then silently dropped — which had left the query running with no condition at all and returning the whole collection. A widget contributed by a plugin is checked at boot for values that cannot survive being serialized to the browser, because a contributed widget is copied into the `/api/admin-meta/workspace` payload and one that cannot be encoded failed that request for every admin rather than only its own card. `POST /api/dashboard/query` answers a body that is not valid JSON with the canonical validation envelope rather than a 500, and the dashboard routes no longer match a URL carrying extra path segments.

- [#1402](https://github.com/nextlyhq/nextly/pull/1402) [`0bb454b`](https://github.com/nextlyhq/nextly/commit/0bb454b7fcc84a76390617b63906ddc6ff836b57) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard now draws widgets. The server half — the registry, the query
  contract and `POST /api/dashboard/query` — has been merged and unused, with
  nothing on the client asking it anything.

  Widgets share one anatomy: a header, a body, and an optional footer carrying a
  freshness line and at most one link. Core draws that frame for declarative
  archetypes and plugin components alike, so a plugin contributes a body and
  inherits the loading, error and accessibility behaviour rather than deciding it
  again. Loading marks the body busy instead of replacing it with a spinner, so a
  refresh does not discard the number already on screen, and a widget that fails
  keeps its title — an anonymous error box does not say which card broke.

  Every visible widget's query goes out in a single request, and a widget the
  current user may not see contributes no query at all. Sizes are named steps on a
  twelve-column grid; below the `md` breakpoint every widget is full width, which
  the previous plugin grid got wrong.

  Only the `metric` archetype renders in this release. The rest report themselves
  as not yet drawn rather than coming up blank, and a payload that does not match
  its archetype says so rather than being silently coerced into a number.

- [#1377](https://github.com/nextlyhq/nextly/pull/1377) [`4e13096`](https://github.com/nextlyhq/nextly/commit/4e13096b7b273ae395f14d89fa84220eb9fc7d63) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bound the content-releases drain by the deadline its runner supplies rather than a budget of its own, so a pass that starts late fits inside what is left of the tick instead of overrunning it, and measure the remaining pass from the runner's own clock in both built-in drains so an injected clock no longer starves one or overruns the other.

- [#1371](https://github.com/nextlyhq/nextly/pull/1371) [`665ec46`](https://github.com/nextlyhq/nextly/commit/665ec46383b19bb84569da756d58000d2942120c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A failing scheduled release no longer blocks the healthy ones.

  A drain pass always runs its first release group whatever the clock says —
  otherwise a budget too small for one would leave a backlog stalled forever. With
  a fixed order that guarantee became its own problem: a release whose write fails
  holds itself open, is planned first again on the next run, consumes the budget
  again, and every healthy release behind it waits indefinitely. Nothing crashes
  and every pass reports success, so the symptom is simply that some releases never
  go live.

  The order now rotates, so every release group reaches the front. One that keeps
  failing is still retried — that is the contract — but it no longer starves the
  rest while it does.

- [#1325](https://github.com/nextlyhq/nextly/pull/1325) [`5761c64`](https://github.com/nextlyhq/nextly/commit/5761c6482449e9a6df6b62f8900bc43c2a1220ce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give headings and paragraphs a typographic baseline, and let a site's own CSS
  override a block type's defaults.

  Under a host's CSS reset an `h1` and an `h3` differ only in tag name, so a
  correct document rendered as undifferentiated text. Block defaults could not fix
  it: they are keyed by block TYPE and a heading's level is a PROP, so one
  `core/heading` default gives every level the same size. The compiler now accepts
  `elementBases`, keyed by element, and `blocks-react` supplies a baseline for
  `h1`–`h6` and `p`.

  Both default tiers are anchored to a single page-root class with the rest of the
  selector inside `:where()`. That weighs one class: enough to clear a bare
  element reset, and still below a host's own class rule, so a default remains
  something a site can override. Previously block defaults carried the doubled
  page-root prefix that exists to make an AUTHOR's values outrank host CSS.

  The heading scale is sized in `em`, which is what lets an author's typography
  reach a heading at all. These defaults are rules ON the element, while a page
  setting or a block's own value arrives by inheritance, and a direct rule beats
  an inherited one whatever either weighs — so a page set to `20px` left every
  heading at its default size. In `em` the default is a multiple of what was
  inherited instead of a replacement for it: the same page now gives an `h1`
  `45px`, while a document that sets nothing is unchanged and a site's own
  `.content h1` still wins.

  `TYPOGRAPHY_DEFAULTS` and `withTypographyDefaults` are exported so a host can
  replace the baseline.

- [#1361](https://github.com/nextlyhq/nextly/pull/1361) [`db55e6f`](https://github.com/nextlyhq/nextly/commit/db55e6f2c59f6460e9d3c621f2218580c44b8324) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A background job now knows how long it has.

  Jobs run on a tick — a scheduler calls your site, the runner works through what is
  due, and the platform ends the request. Work that walks an open-ended set, like
  publishing every release that has come due, has to stop somewhere sensible and
  leave the rest for the next tick. Until now nothing told it where that was: the
  runner held the budget and never mentioned it, so anything wanting to be a good
  citizen had to be handed the number separately.

  Every job handler now receives `deadline` — the instant its pass intends to stop.
  Short jobs can ignore it. A job that walks a large set should stop when it passes
  and leave the remainder queued, which is safe because the queue is durable and
  the next tick continues where this one left off.

  Stopping early must leave the remaining work queued rather than marking it done.
  Work that was never attempted produces no error, and an absence of failure is
  easily mistaken for success.

  Also fixed: a recurring job whose slug was near the maximum length was accepted
  when you defined it and then silently refused when the runner tried to queue it,
  so it never ran. Such a slug is now rejected where you write it, with a message
  naming the real limit.

- [#1381](https://github.com/nextlyhq/nextly/pull/1381) [`faf5e20`](https://github.com/nextlyhq/nextly/commit/faf5e20fb796b6b3e6500fca5f6576514430dad6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the document soft lock's server half: a lease on one entry, its heartbeat, its expiry and its sweep.

  Two authors opening the same entry previously overwrote each other in silence — there was no lock and no `updatedAt` precondition, so the second save won and neither author was told. `nextly_document_lock` now holds one row per document being edited, and `acquireDocumentLock`, `renewDocumentLock`, `releaseDocumentLock`, `readDocumentLock` and `sweepExpiredDocumentLocks` take, keep, give up, observe and collect a claim.

  Every liveness comparison is a SQL expression the database evaluates itself, on its own clock. Contenders sit on different instances whose clocks disagree, so a claim written from one clock and judged against another is decided by that skew rather than by who holds the lock.

  A claim identifies an ACQUISITION rather than a person: each carries a token minted when it was taken, and every heartbeat and release must present it. One author with the document open in two tabs holds two claims under one user id, and a release from the closed tab must not free the claim the other tab is still editing under.

  A lease lasts 150 seconds and its holder confirms every 15, both derived from one TTL. Expiry alone releases a claim, so a holder that crashed or went offline does not lock a document indefinitely, and a person may deliberately take over a live one.

  The HTTP surface that exposes this is not included, so no behaviour changes for a user yet.

- [#1378](https://github.com/nextlyhq/nextly/pull/1378) [`a07bada`](https://github.com/nextlyhq/nextly/commit/a07bada13a805eaec28c895960d81232482f8917) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block that declares `supports: { list: true }` was rejected by the plugin
  authoring types. The style catalog gained a `list` group, but the authoring
  vocabulary plugin authors compile against was never extended to match, so the
  one capability that lets a block opt into list marker styling could not be
  written down.

- [#1387](https://github.com/nextlyhq/nextly/pull/1387) [`bfc0785`](https://github.com/nextlyhq/nextly/commit/bfc0785dc74053cc4db5d8537a9b653c82354f8d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block can now say that it needs JavaScript in the browser, and a stored page
  can be asked which of its blocks do. React already decides what ships — a module
  carrying `"use client"` is bundled for the browser and one without it is not —
  but that is a fact about a MODULE, visible to a bundler. A page is stored as
  JSON naming block types, so nothing reading one could tell an interactive block
  from an inert one without importing the whole library.

  The declaration states a reason rather than a flag, because a block becomes
  heavier for every visitor the moment it opts in and the author is the only one
  who knows whether that was worth it.

- [#1342](https://github.com/nextlyhq/nextly/pull/1342) [`34668e6`](https://github.com/nextlyhq/nextly/commit/34668e612fc47810fddd7a2a9a40f55f68ce6be5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A translation restored from the archive can no longer be left describing itself as current.

  Deciding whether a translations table carries the column that records when each language was
  last written used to be a question the database was asked indirectly: a statement was attempted,
  and any failure at all was read as "the column is not there". A dropped connection, or an
  account permitted to write the table but not to read the catalogue, therefore answered the same
  way a genuinely older table does — and on that answer a restore preserves the timestamp already
  on a language while replacing its content with older archived material, leaving a translation
  that reports itself as up to date when it is not.

  The question is now answered from the table's own column list. Absent is absent; anything that
  prevents the question being answered is reported rather than being turned into a claim about the
  schema.

- [#1385](https://github.com/nextlyhq/nextly/pull/1385) [`59b6196`](https://github.com/nextlyhq/nextly/commit/59b6196870033d6df0be0be9a54def73729612c6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Typing an attribution on a quote moved the quotation. A user agent indents a
  `<blockquote>` about 40px, and in the attributed shape that margin sat inside
  the block's own indent and added to it — so the same quote drew at 24px bare and
  64px attributed, in any site without a CSS reset. Both now draw at 24px.

  An image's caption drew at the body's own size directly beneath the picture, so
  it read as another paragraph that happened to follow an image rather than as a
  caption.

  A form's fields did not group. One even gap separated a label from the control
  it names and one question from the next, so nothing read as belonging together —
  a label sat as far from its own input as from the next field entirely. The gap
  is now the distance from a label to its control, and the control states the
  distance to the next field.

- [#1323](https://github.com/nextlyhq/nextly/pull/1323) [`566e880`](https://github.com/nextlyhq/nextly/commit/566e880fa57e1c774662655fec59befb45fff7b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scheduled content releases are now performed, not just anticipated.

  A due release previously changed only what a reader saw. Nothing wrote the
  change down, so cancelling a release that had already "gone live" silently
  reverted the content, and nothing outside a live database read ever saw it at
  all. A release now materialises: each document is published or withdrawn
  through the ORDINARY content mutation, as the author of the member that
  scheduled it.

  Running it as that person rather than as a trusted system principal is the
  point. A release is somebody's decision to publish something later, and the
  write that carries it out is theirs — anything else would let a scheduled
  publish reach content its author could not have published by hand. A member
  whose author was never recorded, or whose account has since been deleted or
  deactivated, is refused rather than run as anybody else, and its release stays
  scheduled so the next pass retries instead of the work disappearing from both
  the content and the schedule.

  Public pages also expire when a release is due. A cached route previously had
  two ways to go stale — a tag someone busts, or a fixed number of seconds — and
  neither fits a scheduled publish: tags do nothing until something runs, so a
  page cached before the due instant could serve pre-release content
  indefinitely, and a fixed window is a guess unrelated to when anything changes.
  The cache lifetime is now derived from the schedule itself, and capped by how
  stale the schedule this server holds may be.

  That cap is a behaviour change worth knowing about: a runtime with a database
  attached now revalidates public reads on a thirty-second window even where no
  release has ever been scheduled, where it previously cached them until a tag
  was busted. The alternative was worse and silent. The schedule is read through
  a short-lived memo, and a server that has not itself written the schedule
  cannot see one written by another server for the length of that memo — so a
  page rendered in that window was being cached with no expiry at all, on the
  strength of a memo saying nothing was due. It then outlived the release
  indefinitely, because nothing re-rendered the page to ask again. A page may now
  never outlive the memo its bound came from.

  Three permissions are seeded — reading content releases, creating them, and
  publishing them. Scheduling is deliberately separate from creating: assembling
  a release changes nothing a reader can see, while scheduling one is what puts
  content live later.

  The permission resource is named `content-releases`, not `releases`. Registering
  a resource reserves its name against collections and Singles, and "releases" is
  a word real sites use for content — a press-releases collection is among the
  most common on a corporate site. Reserving it would have failed an existing
  install at boot and quietly cost preset roles their access to a Schema-Builder
  collection of that name.

  Also fixes the content client handed to a background job, which called the
  Direct API through an extracted method reference. That works against the
  module-level facade and fails against a booted instance, which reaches its
  context through `this`.

- [#1383](https://github.com/nextlyhq/nextly/pull/1383) [`efac6c8`](https://github.com/nextlyhq/nextly/commit/efac6c8e7857a86c3789627802c6954d0ee3585f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Honour the declared null-ordering control in the Drizzle adapter, which was read nowhere, and make content releases reachable: a `nextly.releases.*` Direct API namespace over a service that finally enforces the three release permissions, refusing to schedule a document the caller could not publish themselves.

- [#1348](https://github.com/nextlyhq/nextly/pull/1348) [`5d03c89`](https://github.com/nextlyhq/nextly/commit/5d03c89d0a5eace30f8e1bdc6f8ea0e412bac87e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every language of an entry can now be taken down at once, through the
  collections service.

  Publishing every language has been possible since i18n M7. Withdrawing them had
  no counterpart at any layer — no admin hook, no route, no service method — so
  there was no way to take a localized document down as a whole. An ordinary
  update carrying no locale reaches the DEFAULT language only, leaving every other
  translation published.

  `unpublishAllLocales` closes it at the service layer. It is NOT yet reachable
  from a REST route or from a scheduled release: wiring a release through it was
  attempted and reverted in this PR, because the all-languages lifecycle does not
  fold a pending working draft or run mutation hooks, and a scheduled publish needs
  both. So this ships the missing capability and the honest boundary around it —
  the localized takedown gap in Content Releases stays open until that wiring is
  designed rather than inherited.

  The direction is a parameter rather than a second method. Publishing every
  language and withdrawing every language differ in a target status, an access
  action, and whether the write can establish first publication; the other 745
  lines — the access gate, the row lock, the companion sweep, the version capture,
  the event fan-out, the cache flush — are the same operation. `publishAllLocales`
  keeps its signature and behaviour and delegates to the shared path.

  `first_published_at` is untouched by a withdrawal. It records when a document
  first became reachable, which taking it down does not change; re-dating or
  clearing it would make a later republish report a first publication that had
  already happened.

  A takedown REFUSES rather than half-performing when a collection's translation
  table physically lacks its per-language status column — the state left by
  enabling Draft/Published on a collection that was already localized. Publishing
  into that state fails loudly and loses nothing; a withdrawal that reported
  success would leave every translation readable, so this one names the
  collection, explains the state, and changes nothing.

  Per-language writes are unaffected, and a locale-scoped member is never widened
  into a document-wide one.

- [#1360](https://github.com/nextlyhq/nextly/pull/1360) [`8999a12`](https://github.com/nextlyhq/nextly/commit/8999a1201cf1b1538d7cd3e7bcdbd783f767f2f9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scheduled release drain now fits the tick it runs in.

  Materialising due releases walked every planned action with no deadline. The job
  runner cannot bound that — its wall-clock budget is checked before each job is
  claimed, so it limits how many jobs a pass starts, never how long one already
  running handler takes. On a serverless platform a tick is killed at a fixed
  limit, so a site with a large backlog could have its drain cut off partway and
  then restart from the beginning on the next tick, re-walking what it had already
  done.

  A pass now stops starting new actions once its budget is spent, and reports how
  many it deferred. It never stops midway through a content mutation: nothing can
  interrupt one, and abandoning it half-done outside the database would be worse
  than being late. At least one action always runs, so a budget too small for a
  single action cannot stall a backlog forever.

  Releases whose actions were not reached stay scheduled and are retried on the
  next pass, exactly like releases with a failed member. Without that they would
  have been marked published having done only part of their work, losing the
  members that never ran.

- [#1390](https://github.com/nextlyhq/nextly/pull/1390) [`db6c595`](https://github.com/nextlyhq/nextly/commit/db6c595b634c82633e4009223f85b30d48d17065) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give content releases a REST surface at `/api/releases`, where scheduling and cancelling demand the publish authority that assembling a release does not.

- [#1397](https://github.com/nextlyhq/nextly/pull/1397) [`15aa6b6`](https://github.com/nextlyhq/nextly/commit/15aa6b6f653c3f23ff7fb6d6bcc2dc9a376bfe8e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the page builder's Settings panel something to show. It was offered on the rail and opened blank for the commonest shape a collection takes — a title, a slug and a builder field — because the panel was filled from the entry form's body rule, which strips title and slug on the grounds that the form header already draws them. A builder covering the whole window suppresses that header, so the two fields most worth reaching from inside the editor were the two being withheld, and a document's own name could not be read there at all. The panel now offers them, grouped as Page above the collection's own fields, and it is withheld entirely when a document genuinely has nothing beside its builder field. `useEntryFieldsPanel` takes the asking field's path and answers with the fields drawn, or null — one value for both the decision to offer a panel and what goes in it, so a surface cannot offer a region it renders nothing into.

- [#1347](https://github.com/nextlyhq/nextly/pull/1347) [`408464e`](https://github.com/nextlyhq/nextly/commit/408464e584e83e33510e9d487f142566bb65b054) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A resizable splitter now has to say what it divides, and the type is what
  enforces it.

  The handle between two panels is focusable, so a keyboard user lands on it
  whether or not anyone thought about them. `react-resizable-panels` supplies
  everything else about that element — the separator role, the orientation, and
  a position between a minimum and a maximum — but it cannot supply the one
  thing only the caller knows: what the two panels hold. Every handle in the
  admin was unnamed, so landing on one announced a bare number, "74", with
  nothing saying what was at 74 or what moving it would do.

  The name is now REQUIRED by the component's type rather than recommended in
  its documentation. A rule with nothing enforcing it is not a control, and this
  one had already been broken at every call site by people who had no reason to
  know: the handle looks like a divider, and dividers are not usually things you
  name. Either `aria-label` or `aria-labelledby` satisfies it, and the two cannot
  be combined — a second name is not a stronger label, it is an ambiguity
  resolved by precedence rules the author is not thinking about.

  The four splitters in the product are named for what sits on each side of them:
  the page builder's panel-and-canvas and canvas-and-inspector divisions, the API
  playground's request and response panes, and the translation editor's source
  and target.

- [#1379](https://github.com/nextlyhq/nextly/pull/1379) [`0d6c261`](https://github.com/nextlyhq/nextly/commit/0d6c261703ea43a8688ceab5218ccd24c9d089f0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let an editor take every language of an entry down at once, by wiring the unpublish-all route to the takedown that was already built, tested and reachable by nothing.

- [#1408](https://github.com/nextlyhq/nextly/pull/1408) [`a0aea91`](https://github.com/nextlyhq/nextly/commit/a0aea917f759b9911ef7ddc2b211b4aef5b82797) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Show every kind of title a document can hold. `title` is an ownable system column and a code-first schema may redefine it with any field type, so the value reaching the entry header can be a number or a boolean as well as a string. The header's controlled input accepted only strings and numbers, so a document whose title is a checkbox read as "Untitled" over its saved value. The accepted types are now a set rather than a chain of comparisons, because this list has grown twice and each omission read as a deliberate narrowing rather than a case nobody had listed.

- [#1352](https://github.com/nextlyhq/nextly/pull/1352) [`abbc142`](https://github.com/nextlyhq/nextly/commit/abbc142cb17404f9c76b5d68b9081af56d49b4cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A translation now says when its source has moved on since it was written.

  The timestamp each language already records is finally read. A language whose
  source was edited after it was translated is marked as needing review, and stays
  exactly what it was otherwise -- still translated, and still published if it was
  published. A translation that has fallen behind is not a demotion; it is a
  second fact about a language that is still live, and treating it as a state
  would take a working translation off the screen it belongs on.

  Reported only where it can be established. The signal depends on a column older
  translation tables do not carry, and whether a given one carries it is now
  checked against the database rather than assumed from configuration. A site that
  has not run `nextly migrate` yet sees nothing new instead of an error, and every
  language there reports as unknown -- never as up to date, because a translation
  the system cannot vouch for must not be described as current.

  Singles carry the signal too. Their languages are stamped on every write like
  any other, so the comparison is as valid there -- but a Single's history is not
  seeded, so languages written before this shipped have no timestamp and stay
  unknown rather than being described as current.

  Nothing here asks a person to keep the signal honest. It is derived from when
  each language was last written, so re-saving a translation clears it as a
  consequence of the save, and no flag is left behind for someone to remember to
  untick.

- [#1332](https://github.com/nextlyhq/nextly/pull/1332) [`406a172`](https://github.com/nextlyhq/nextly/commit/406a17275292c2622dfc16d65806d965264b387e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Record when each language of a document was last written, so a later change can
  tell a finished translation from one whose source has moved on since.

  This release is the groundwork only: a language's timestamp moves when that
  language's CONTENT is written, for every kind of localized content, and nothing
  surfaces it yet. Publishing or unpublishing a language changes no words, so it
  leaves the timestamp alone -- otherwise a lifecycle change on the source
  language would report every translation as needing review on an edit nobody
  made.

  Collections that already exist are seeded from their version history, so their
  languages carry a timestamp from the moment this lands. Singles are not seeded,
  even though they keep history that would allow it: nothing reads the signal for
  a Single today, and seeding one would commit every future reader to whatever
  this release happened to write. Their languages are stamped from their next
  save onward, like any language whose history is unknown.

  A database created before this keeps no history of when each language was
  written, so the value is seeded from version history where that exists and left
  unknown where it does not. Unknown is never treated as up to date: a language
  the system cannot vouch for is left alone rather than described as current.

- [#1407](https://github.com/nextlyhq/nextly/pull/1407) [`ffc2a04`](https://github.com/nextlyhq/nextly/commit/ffc2a04de9f689dd7d4409d8553e59a340e32c29) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard widget declared through BOTH channels is now MERGED, with the registered definition authoritative over every field it can state. The registry is the single place that knows which widgets exist in a running app, and `overrideWidget` and `extendWidget` exist so a later plugin can correct an earlier widget; preferring the contribution discarded every one of those corrections without saying so. A tightened `requiredPermission` is the case that matters: a widget an operator believed they had restricted was still drawn, and its query still entered the batch, for a user the running configuration said may not see it.

  Merged rather than substituted, because a registered definition cannot carry a `component` on any archetype but `custom` — so replacing the contribution with it would discard the only thing on either side able to draw a `list`, `table`, `text` or `actions` card, and a widget that had been rendering its plugin body would render "the list widget archetype is not rendered yet" instead. The contribution supplies the component and the trimmings the registration left out; the registry supplies the permission, the query, the archetype, the title and its declared size. The card keeps the POSITION the contribution gave it, so it does not jump across the grid, but it takes the registry's `defaultSize`, so its width can change to what the authoritative definition asks for.

  Relatedly, a widget that names an archetype this release does not draw now falls back to a component it shipped, rather than showing an error where a working card was available. The fallback is asked of the archetype table itself, so it stops applying on its own the day core learns to draw that archetype. And a duplicate id inside the registry payload is now resolved to its first entry on both read paths, so deduplication and the permission gate cannot disagree about which of the two the payload meant.

  A widget result is validated against its own `op` before it is read. `{ "ok": true, "result": { "op": "count" } }` previously passed an is-it-an-object check and was then read as a count, and the missing total took the whole grid down with it — replacing every card with an error page, which is the exact blast radius the per-slot shape exists to prevent. A result carrying the wrong op for its widget is still passed through, because the archetype refuses it by name and that sentence is more useful than a generic one.

  A custom widget that declares a query is now told when a refetch is in flight. The grid keeps such a card's body through a window-focus refetch, so without this the card reported `aria-busy="false"` while it was reading, and the plugin's own component could not tell a refetch from an idle card — the slot holds the previous answer in both cases. The card's freshness line is shown for these widgets too, since they took part in the batch that produced it — but withheld when their slot was a refusal, because the batch's timestamp is true of the request and not of a card whose body is drawn from a failure.

  A card's freshness line keeps advancing while the dashboard sits open. It was computed once at render and the dashboard takes no further renders on its own, so a card fetched hours earlier went on reading "Updated just now". It is now a `<time>` element carrying the exact instant, with the relative label refreshed on a cadence matched to its own age.

- [#1330](https://github.com/nextlyhq/nextly/pull/1330) [`62763e8`](https://github.com/nextlyhq/nextly/commit/62763e89b731fdfc555b774cfaad6c29db264209) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-level write rules now apply to an anonymous write, not only an
  authenticated one.

  A collection may legitimately allow anonymous creates — a contact form, a public
  submission. On one, a field declaring `access: { create: () => false }` was
  enforced against every signed-in writer and skipped entirely for an
  unauthenticated one, because the write guard treated "no user" as a trusted
  system context. An unauthenticated writer could therefore set a field that every
  authenticated user was forbidden from setting.

  The guard now gates on `overrideAccess` alone, which is what the matching READ
  guard has always done. An internal writer that needs to set a protected field
  still says so explicitly with `overrideAccess: true`; that bypass is unchanged.
  An anonymous writer resolves to no permissions and no roles, so a rule asking
  for a grant refuses it.

- [#1291](https://github.com/nextlyhq/nextly/pull/1291) [`f8048b0`](https://github.com/nextlyhq/nextly/commit/f8048b054ad720c99726d75eb1cd16c6b5eb3ab5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Share the entry and Single editors' takeover-layout and autosave-recovery logic.

  The form body under a `layout: "takeover"` field, and the restoring of an autosave recovery point, are each computed once and asked by both editors instead of being derived separately in each — so the two editors cannot answer them differently as either changes.

- [#1400](https://github.com/nextlyhq/nextly/pull/1400) [`592f074`](https://github.com/nextlyhq/nextly/commit/592f0740b8e99e2349c23bd64ec89456341dfbd4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard widget contract promised that an accepted query is one the
  executor will run, and three ways of accepting a query that could not run, or
  that ran differently from what it said, are closed.

  A geographic `count` was accepted and then refused at execution: geo predicates
  are evaluated over rows a count never fetches, so validation now refuses the
  combination rather than letting it fail in its batch slot. An explicitly empty
  `select` read as "no fields" and produced a full document, because a selection
  is applied only when it has keys; it is now refused, the way an empty `where`
  combinator already was. And a plugin `setup` transformer could contribute an
  admin widget carrying a value JSON cannot encode: the resolver validated only
  the list it was handed, so the widget reached `/api/admin-meta/workspace` and
  failed that request for every admin.

  Rebuilding the collection sources is also all-or-nothing now. Two fields that
  flatten to one name -- which an unnamed layout group can produce without its
  author writing a duplicate -- used to abort the rebuild after the previous
  sources had already been deleted, leaving widgets that had worked a moment
  earlier answering "unavailable source". Duplicates are resolved to the first
  declaration, and a rebuild that fails anywhere leaves the previous set standing.

  The admin's `PluginWidgetMeta` is derived from the server's declaration through
  `nextly/config` rather than restated, so the two can no longer describe the same
  payload differently.

- [#1392](https://github.com/nextlyhq/nextly/pull/1392) [`27d9b12`](https://github.com/nextlyhq/nextly/commit/27d9b12b868e2364e275d50d65c8929e2b12fea7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give content releases a home in the admin. A Releases entry in the sidebar leads to a list of what is going live and when, and each release opens onto its own page showing the documents it contains, so an editor can see exactly what ships before committing to a moment. Releases can be created, scheduled against a named timezone, and cancelled from there, and every action is offered only to a caller who holds the authority the server checks. The instant is shown in the timezone its author chose, rendered through the admin's configured date and time format.

- [#1399](https://github.com/nextlyhq/nextly/pull/1399) [`d0ae5d1`](https://github.com/nextlyhq/nextly/commit/d0ae5d1e7cda45537b7af66b154501a273dd8034) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An email template preview now shows exactly what will be sent.

  Previewing a template and sending it were composed separately, and had drifted:
  the preview left out the hidden preheader line, rendered a layout's own
  `{{year}}` and `{{appName}}` as blanks — so a layout footer previewed empty —
  escaped a subject that is delivered as plain text, and never showed the
  plain-text part of the message at all. Both now go through one composition, so
  they cannot disagree.

  Previews also work before a template is saved. A new
  `POST /api/email-templates/preview` renders template fields directly, which the
  existing per-template preview route cannot do: it reads the stored row, so it
  shows nothing of what is being typed and has no row to read at all while a
  template is being created.

- [#1389](https://github.com/nextlyhq/nextly/pull/1389) [`330e917`](https://github.com/nextlyhq/nextly/commit/330e917a6e1117ee40975dcb758cdf4ac177c12c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Honour a Nextly instance's own access configuration in `nextly.releases.*`, so an instance built with `overrideAccess: false` has its release operations checked instead of silently trusted.

- [#1366](https://github.com/nextlyhq/nextly/pull/1366) [`b54a77a`](https://github.com/nextlyhq/nextly/commit/b54a77aab30e113500a8f3854cd316f9ce601dae) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now ask for work to happen later.

  ```ts
  await nextly.jobs.queue({
    task: "email:welcome",
    input: { userId: user.id },
    runAt: tomorrowAt9am,
    runAs: user.id,
  });
  ```

  Queueing returns as soon as the job is recorded, not when the work is done — so
  a slow task no longer has to happen inside the request that asked for it. The job
  is a row in your database, so it survives a restart and runs when a trigger next
  drains the queue.

  `runAt` says when the job may START. Omit it and the job runs at the next drain.

  `runAs` names whose authority the job carries. Omit it and the job acts as
  nobody — which is not the same as acting as the system: a job with no identity
  gets a content client with no privileges rather than a privileged one. Never take
  this value from a request body; choosing whose authority to spend is the caller's
  decision to make deliberately.

  `dedupeKey` suppresses a duplicate while an equal key is still outstanding, and
  the key is released once the job finishes. That makes it "one export per document
  at a time" rather than "one export ever", so recurring work keeps working.

  `input` is typed from the task name once you declare your job types:

  ```ts
  declare module "nextly" {
    export interface GeneratedTypes {
      jobs: { "email:welcome": { userId: string } };
    }
  }
  ```

  This is the same interface that already types your collection and single slugs,
  so there is one place to declare what your project contains. Without it, task
  names are ordinary strings and input is unchecked — nothing breaks, you simply
  get no inference.

  Plugins can declare and queue job types too, via `@nextlyhq/plugin-sdk`. Marked
  experimental there until a first-party plugin ships one.

- [#1358](https://github.com/nextlyhq/nextly/pull/1358) [`c3e6028`](https://github.com/nextlyhq/nextly/commit/c3e60283118eb6e82c2187caa7e9eec923e6f5d8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop asking the database a question whose answer is thrown away.

  A site whose translations tables have not been migrated yet was paying an extra
  catalogue lookup on every content list and every single-document read, to
  establish something the code immediately discarded: whether a translations table
  records when each language was written, for entities whose translations table is
  not there at all.

  Nothing about what anyone sees changes. The lookup is now made only where its
  answer is used.

- [#1401](https://github.com/nextlyhq/nextly/pull/1401) [`86f6a40`](https://github.com/nextlyhq/nextly/commit/86f6a40e98296793a23c575d848299ea6c7621ed) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop a group of releases as one indivisible step, and refuse to schedule a release that cannot run. Releases that share a document are only ever discharged together, and stopping them one write at a time left the group split whenever a process died partway — the survivor then became the winner on every shared document and could take the opposite lifecycle action to the one the whole group would have produced. Ordering the writes was not enough and could not be made enough: two releases scheduled for the same instant are separated per document by when each member was added, so each can win a different document of the same group, and no ordering of releases preserves a winner chosen per member. The group now moves inside one transaction, so a partial transition cannot be represented at all. Scheduling also now refuses a release with a member nothing can run — a deleted author, no recorded author, a member naming one language — from every state rather than only from a release already marked as stopped, because a colleague leaving does not wait for a background pass and the person scheduling cannot see whether one has run.

- [#1335](https://github.com/nextlyhq/nextly/pull/1335) [`8a3a64e`](https://github.com/nextlyhq/nextly/commit/8a3a64e1991daf4d7c3fc9bd8f2f99ed61a1e580) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The canvas says how large it is drawing, and lets you choose.

  The editor has always scaled the page to fit whatever room the panels left, so opening a panel shrank it — from 89% to 59.5% — with nothing on screen naming either number and no way to set one. An author judging type or spacing was doing it at a size they had not chosen and could not read.

  The percentage is now always shown, including while fitting, because that is the state the editor spends most of its time in. Choosing a size instead makes it stay put: the page stops resizing when panels open, and the canvas scrolls rather than shrinking. Fit is still the default, sits in the same menu as the sizes, and is how you get back.

  Magnification is new. The old scale could only ever shrink, so there was no way to look closely at anything.

  The choice is remembered per browser, like the other editor preferences, and a stored value that is not a usable size is ignored rather than painting the canvas somewhere the control cannot be reached.

- [#1369](https://github.com/nextlyhq/nextly/pull/1369) [`d283f53`](https://github.com/nextlyhq/nextly/commit/d283f53112767dae2e6340fc1f5a8e7e021407c7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Choose which interaction state you are styling.

  The Style tab now opens with a None / Hover / Focused / Pressed control. Values
  you edit go to the chosen state, and the canvas draws the selected block in it,
  so what you are editing and what you are looking at are the same thing.

  Each state says whether it already holds styles of its own. Reading the values
  cannot tell you that: styles inherit, so a state you have never touched shows
  the base values and looks set. The marker is in the accessible name as well as
  on screen.

  Leaving the Style tab returns the canvas to the normal appearance, so a state
  switched on cannot be left behind on a tab that no longer shows the control.

- [#1380](https://github.com/nextlyhq/nextly/pull/1380) [`a5efcd7`](https://github.com/nextlyhq/nextly/commit/a5efcd75f8558116daf6b1241a2d5db4fb3528c4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Classify a missing column by the driver's error code rather than by the wording of its message.

  Three call sites answered "did this statement name a column the table does not have" independently, and the three disagreed. Two matched English message text; between them they covered disjoint MySQL errors, so each was blind to the case the other handled — a staleness read recognised `Unknown column` (1054) but not `Key column ... doesn't exist` (1072), and a degraded index push recognised 1072 but not 1054.

  Matching wording is unsound on MySQL regardless of coverage: `lc_messages` selects among roughly twenty translations, has session scope as well as global, and can be changed at runtime. A server answering in any other language defeated the match silently, and in the dangerous direction — the predicate returned false, the caller concluded the column was present, and the tolerance it exists to provide was skipped.

  The single implementation reads the driver code first, per dialect, walking the cause chain where drivers actually put it. Wording is still consulted for a level whose code does not classify: SQLite exposes no code for this, and a wrapper may drop one. Because the code is read first, the wording no longer has to survive translation.

  Two narrower views derive from it rather than reimplementing it: whether a specific named column is the missing one, and which of the two forms the error reports, since only MySQL separates an index's missing column from a statement's.

- [#1327](https://github.com/nextlyhq/nextly/pull/1327) [`b8d460d`](https://github.com/nextlyhq/nextly/commit/b8d460db1ce0f3c57cbcb7c4cd75b79c41063196) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make the form schema generator read the same per-type rule set the field
  editor reads, so a validation rule cannot be offered by one and ignored by
  the other.

  That now includes the custom error message, which the generator applied
  whatever the rule set said, and the pattern override on a phone field: a
  stored pattern used to stand the phone's own format check down even where
  the rule set did not enforce patterns, leaving the field accepting any
  text at all.

- [#1338](https://github.com/nextlyhq/nextly/pull/1338) [`60e1c83`](https://github.com/nextlyhq/nextly/commit/60e1c8384c708819ae7bd3534373318d83d73d0f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Detect a missing column through the driver error the ORM wraps, so a translation
  table created before the staleness timestamp existed reports "unknown" instead
  of failing the read.

- [#1359](https://github.com/nextlyhq/nextly/pull/1359) [`1867585`](https://github.com/nextlyhq/nextly/commit/1867585468db8ba7891ab3e908ca8d98c7f4dbdc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Find every translation that has fallen behind, in one place.

  The translation worklist gains a "Needs review" tab: the languages whose source
  was edited after they were written, across every collection, newest first. They
  are still translated and still published -- this is a second fact about a live
  translation, not a demotion -- so the tab is named for what to do about them
  rather than for what was measured.

  It also says what it could not check. A collection whose translations table does
  not yet record when each language was written cannot answer this question, and a
  collection that quietly contributes nothing to a list is indistinguishable from
  one with nothing to report. Those are now named on screen, with the
  thing that fixes it -- `nextly migrate` on a deployed site, or a restart (or
  `nextly db:sync`) in development, because a development database kept in step by
  the sync and reload loop has no migration file that adds the column. That is kept
  separate from the collections a single request could not cover, because reloading
  helps there and would only loop here.

- [#1374](https://github.com/nextlyhq/nextly/pull/1374) [`b1f2b7b`](https://github.com/nextlyhq/nextly/commit/b1f2b7bce4fe6d0e8b11d93e1538a32a99370601) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop the colour picker saving a colour you did not finish typing.

  Typing a hex colour used to save on every keystroke. Because a prefix of a
  valid colour is itself a valid colour — `#123456` passes through `#123` and
  `#1234` — stopping partway left the last of those saved. Typing `#123456` and
  pausing at `#12345` stored `#11223344`, a colour nobody typed, replacing what
  was there.

  A typed colour is now saved when you finish it: press Enter, or leave the
  field. Dragging on the surface and the sliders is unchanged and still updates
  as you move. Dismissing the picker mid-word discards the unfinished text and
  leaves your stored colour alone.

- [#1403](https://github.com/nextlyhq/nextly/pull/1403) [`a430cd6`](https://github.com/nextlyhq/nextly/commit/a430cd6c6a116ecaed8640ce4b4af4b9cefcf037) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix scheduling a release, which failed for every request the admin sent. The check that refuses an impossible date read the UTC offset from a fixed position in the string, and the offset does not sit at a fixed position: seconds and milliseconds are both optional in the accepted format. `Date.prototype.toISOString()` always writes milliseconds, so every schedule request from the product carried a shape that made the check compute an unusable date and fail with an internal error. Two quieter faults came from the same line — an instant written with a real UTC offset had that offset read as zero, so a moment shortly after midnight was judged against the previous day and refused as a date that does not exist, and the impossible-date check it performs was silently doing nothing wherever milliseconds were present. The offset is now read from the end of the string, and the accepted shapes are covered by tests written from what a client actually sends rather than from what is convenient to write by hand.

  Put the "Add to release" control with the document's other actions, beside Save and Publish. It sat in a bar of its own spanning the full width above the editor, which placed it underneath the sticky side panel on a document that has one: the panel took the clicks and the hover meant for the button, so it could be seen and not used. Both editors are affected and both now render it through the same slot the form already offers, so the control is placed by the same layout that places everything else it belongs with.

- [#1362](https://github.com/nextlyhq/nextly/pull/1362) [`15e5315`](https://github.com/nextlyhq/nextly/commit/15e53150740350e52af69ebb936e892f5d303066) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Preview an interaction state on every rendering of the selected block.

  A block inside `core/collection-loop` is drawn once per entry, so one selected
  node is many elements. The forced state reached only the first of them, which
  outlined every row while showing the hover appearance on one.

  A block whose render returns a promise now keeps its selection outline and its
  previewed state. React commits the Suspense fallback first and the resolved
  element later, and that second commit changes nothing the canvas was watching —
  so selecting an image or a collection loop left it unmarked until an unrelated
  edit happened to redraw it.

  A page rendered with the preview turned off no longer inherits a stored site
  sheet that had it on. The route's answer now wins in both directions, so a
  page's own rules and the shared class rules cannot disagree about what `:hover`
  selects.

- [#1375](https://github.com/nextlyhq/nextly/pull/1375) [`d6d7c57`](https://github.com/nextlyhq/nextly/commit/d6d7c5749fbe85b2b50bc22c84649833ad630c98) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Background jobs can be granted in the admin again.

  `manage-background-jobs` is seeded and enforced, but the admin's permission
  screens did not list the resource — so the row never appeared, and there was no
  way to give anyone that permission without editing the database. It now appears
  in the permissions page, the role matrix and the capability builder, alongside
  webhooks and API keys.

- [#1384](https://github.com/nextlyhq/nextly/pull/1384) [`07c615d`](https://github.com/nextlyhq/nextly/commit/07c615d2300434e19aa34b41a813e79e9ffdc9cf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin dashboard now shows only what the signed-in caller is permitted to
  read. Previously a caller holding NO read permissions was treated as having no
  filter at all, so the least-privileged account saw every collection; the
  activity feed applied no permission filter of any kind; and recent entries were
  read with hand-built SQL that bypassed access control entirely.

  Operators should expect restricted users to report an EMPTIER dashboard than
  before, and that is the fix rather than a regression. A user without read
  permission on a collection no longer sees its entry count, its draft/published
  breakdown, its recently-edited entries, or its activity-feed rows — including
  the entry titles, author names and author emails those rows carry. The
  "changes in the last 24 hours" figure is now counted over the same permitted
  collections instead of over every collection.

  API keys are judged on their OWN stamped grant rather than on the roles of
  whoever minted them. A deliberately narrowed key issued by a super-admin
  previously inherited that super-admin's reach on the dashboard endpoints; it
  now sees only the collections it was actually granted.

  What a caller may read is now decided by the ACCESS LAYER rather than inferred
  from the permission table's rows. A collection whose `access.read` rule refuses
  the caller is excluded even when a permission row would have admitted it — the
  dashboard now agrees with what `GET /api/collections/{slug}` answers. A
  collection authorized entirely in code, with no permission row at all, is
  included for the same reason. Per-collection entry counts are read with access
  enforced, so a collection with an owner-only or custom read rule now reports the
  number of rows the caller may actually see rather than every row in the table.

  Two behaviour changes are worth planning for:
  - A super-admin's activity feed is now bounded by the collections and settings
    resources that currently exist. Activity rows naming a collection that has
    since been removed from the config are no longer listed, and no longer
    counted in the 24-hour figure.
  - A recently-edited entry whose title field holds a structured value (a `json`,
    `group`, `repeater`, `component` or `chips` field named by
    `admin.useAsTitle`) is now labelled with its id instead of rendering as
    `[object Object]`. An empty, boolean or date-valued title field falls through
    to the next candidate field and then to the id, where before it rendered as an
    empty or nonsensical heading. That fallback chain now actually runs: the
    recent-entries read selects the fallback fields (`title`, `name`) alongside
    the collection's configured title field, where before they were silently
    dropped by the projection and the chain could never do anything but return
    the id.
  - The draft/published breakdown on `/stats` is now read through the same
    access-enforced count as the per-collection totals beside it, instead of a
    raw query over the whole table. A collection with an owner-only or custom
    stored read rule previously reported every author's draft/published split to
    every reader who could open it at all, and that number disagreed with
    `content.totalEntries` sitting next to it in the same response; the two now
    always agree (`totalEntries === status.published + status.draft`). This also
    fixes the breakdown never actually running for a collection with the
    Draft/Published lifecycle enabled: it identified such a collection by
    scanning its fields for one literally named `status`, but a field with that
    name is REJECTED by config validation while the lifecycle is on, so every
    lifecycle collection was silently treated as having no status at all.

  One failure mode is deliberately visible as an empty dashboard: if the
  permission lookup itself fails transiently, the dashboard answers HTTP 200 with
  nothing in it rather than falling back to showing everything. An empty
  dashboard that should not be empty is worth investigating in the server logs.

  For anyone calling the Direct API: `nextly.count()` accepts a `status` option
  (`"published" | "draft" | "all"`), matching `nextly.find()`. Its absence is
  unchanged — an access-enforced count still defaults to published-only on a
  collection with the draft/publish lifecycle — but a caller that wants the same
  rows a `find({ status: "all" })` would return can now ask for them, and the two
  totals agree.

- [#1367](https://github.com/nextlyhq/nextly/pull/1367) [`b93f913`](https://github.com/nextlyhq/nextly/commit/b93f9138e4ded8482b4097adafc88f3df75982d8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Mount the classes manager so an author can reach it: the panel reports that usage was not read rather than reporting an empty index, withholds a delete nothing can carry out, and shows a rename the host refused instead of clearing as though it landed.

- [#1412](https://github.com/nextlyhq/nextly/pull/1412) [`519c0ed`](https://github.com/nextlyhq/nextly/commit/519c0ed89e00a27607e6c510378723a50c99ada1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give a document one leading action instead of several competing ones. A published entry with unpublished edits drew Save, Publish and Unpublish side by side at equal weight, so an author read three buttons to find the one they wanted, and Unpublish — rare, public, and undone only by publishing again — sat one slip from Publish. There is now a single primary action derived from the document's state, the quieter save beside it, and everything else in a menu split into routine and destructive groups. "Publish" on a document that is already live now reads "Publish changes", which says what it will do. What an author may do is decided in a module with no React in it, so every combination of status, drafts, permissions and history is testable without rendering a header; where each action is drawn is decided from that description rather than by where its markup happened to sit. The collections menu drops "Show JSON" in favour of "View API response", which is what Singles already offered.

- [#1356](https://github.com/nextlyhq/nextly/pull/1356) [`5c78e6f`](https://github.com/nextlyhq/nextly/commit/5c78e6f9a93a962f166891fb9b26dff5cf46bfea) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Show the right blocks when previewing an interaction state.

  Focus no longer lights up a selected block's ancestors. `:hover` and `:active`
  match an element and every ancestor of it, but `:focus-visible` does not — that
  is `:focus-within`, which the builder does not emit. Previewing focus therefore
  showed an enclosing block's focus styles for an appearance no visitor sees.

  Page-level state styles now apply in the preview at all: the marker is put on
  the rendered page root, which is what those rules select, rather than on the
  canvas wrapper around it.

  Each interaction state's meaning is defined once and both the published and
  preview selectors are derived from it, so the two cannot drift into matching
  different pseudo-classes.

- [#1334](https://github.com/nextlyhq/nextly/pull/1334) [`5ea2963`](https://github.com/nextlyhq/nextly/commit/5ea2963e8533a9217fa7db5f6071301b8f7a985b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block can now be dragged from the insert panel onto the canvas.

  Dragging a block from the insert panel onto the canvas shares everything with
  dragging a block already on it — where a drop may land, when the target is
  allowed to change, the autoscroll, the indicator and Escape. The two differ at
  exactly one call, made when the pointer is released: a move rewrites a node's
  position, an insert builds the node the palette described and adds it there.

  The node is built at the release rather than at the start of the gesture, so
  the document is untouched while the author is still choosing, and the whole
  drag leaves a single entry on the undo stack.

  Clicking a row still inserts, exactly as before. The drag only ever adds a
  second way to do it.

- [#1339](https://github.com/nextlyhq/nextly/pull/1339) [`3ddb334`](https://github.com/nextlyhq/nextly/commit/3ddb334f62f935004907234b7839de558e8a62f8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep one drag in flight at a time on the block canvas.

  A second finger pressing a palette row, or a block, while a drag was already
  running replaced that drag with no ending of its own. The first drag's release
  then went unheard and its click was never suppressed, so the row it started
  from inserted a block the author never dropped — while the second drag carried
  on. A stray touch now leaves the drag in progress alone.

- [#1370](https://github.com/nextlyhq/nextly/pull/1370) [`d70c83b`](https://github.com/nextlyhq/nextly/commit/d70c83bd1b304beb91a5971f24141d7c552612da) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - One scheduled endpoint now drains everything.

  Webhook delivery runs on the shared job runner. If you schedule `/api/jobs/run`,
  your webhooks are delivered by it — you no longer need a separate cron entry per
  subsystem, and anything added later that needs a regular tick is covered by the
  schedule you already have.

  Nothing you have set up stops working. `/api/webhooks/drain` is unchanged and
  still does exactly what it did; a deployment scheduling it can carry on. If you
  schedule both, they simply share the work — each delivery is claimed under a
  lease, so two passes do not both pick up the same one, and whichever arrives
  second finds nothing left to claim.

  That is not a promise of exactly-once delivery, and never was. Webhook delivery
  is at-least-once: the request goes out before the row recording it is finalized,
  so a process killed in between leaves that delivery eligible for another attempt.
  Every request carries a stable `webhook-id`, and receivers should continue to use
  it to ignore a repeat.

  Both triggers now read one set of limits for how much a single tick may do, so
  they cannot drift into behaving differently depending on which one fired.

  A drain pass that ends with failed deliveries is now reported. The job itself
  completes — a failed delivery is retried on its own schedule and is not a failed
  pass — so previously a receiver that had quietly stopped accepting anything left
  no trace outside its own delivery rows.

- [#1404](https://github.com/nextlyhq/nextly/pull/1404) [`9717c64`](https://github.com/nextlyhq/nextly/commit/9717c64f461cccffaf007a91de3a5a76d09a3348) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Editors that take over the admin window now share one shell.

  Four surfaces already built the same arrangement by hand — hiding the admin's
  navigation, a bar across the top, and a draggable split down the middle — and
  each built it slightly differently. The shell names that arrangement once, with
  its regions declared, so an editor says which parts it has instead of arranging
  them itself. Nothing changes on screen yet; the email template editor is its
  first user in a following change.

- [#1405](https://github.com/nextlyhq/nextly/pull/1405) [`8f979fe`](https://github.com/nextlyhq/nextly/commit/8f979fed6f9622b478a12b5adb65caede6726b63) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make the document title one value rather than two copies of it. The entry header kept its own copy of the title, so a rename made anywhere else never reached it — and a takeover field can now do exactly that: renaming a page in the builder's settings panel left the header behind the editor showing the old name, and the next keystroke there saved the old name back over the rename. The header's title moves into `EntryTitleInput`, which reads the form rather than holding a copy, and is a control the header's other surfaces can reuse. Separately, the settings panel no longer counts a group whose every child is conditioned away: those children render nothing, so counting them offered the panel with a heading over an empty group. Conditions on nested fields are now read at the qualified path the renderer resolves them against.

- [#1373](https://github.com/nextlyhq/nextly/pull/1373) [`85ab528`](https://github.com/nextlyhq/nextly/commit/85ab5285d39258304f7f8a28ec47c496beb5c94e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Open the Style tab when the editor restores a state you were editing.

  A host that reopens the builder on a block you were styling in its hover state
  now lands on the Style tab, with the state control in view. Previously the
  canvas drew the block mid-hover while the only control that explains or clears
  that state sat behind a tab nothing had opened.

  An ordinary mount still opens on Content.

- [#1372](https://github.com/nextlyhq/nextly/pull/1372) [`b8659c2`](https://github.com/nextlyhq/nextly/commit/b8659c24d287714529b7c609deb22928cd34935e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a host state how many class rows the manager mounts at once, so the bound is a stated page size rather than a fixed one. The size takes effect when it changes, and a value that cannot bound a list falls back to the default rather than stranding classes out of reach.

- [#1353](https://github.com/nextlyhq/nextly/pull/1353) [`46976be`](https://github.com/nextlyhq/nextly/commit/46976be27f051d5958da29eaa40efd700de69f8a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read a `font-family` value the way CSS does, in four places it did not.
  - A `var()` call is dynamic only when it names a custom property. CSS requires
    the first argument to begin with `--`, so `var(foo)` computes to an invalid
    `font-family` and the browser drops the declaration rather than falling
    through to the next family. Treating every `var(` as dynamic gave a dropped
    declaration an all-clear.
  - Quoted family content keeps its spacing verbatim. `" Brand "` names a family
    whose name carries those spaces and is a different family from `Brand`;
    matching it against a face called `Brand` claimed a file renders that does
    not. Whitespace outside the quotes is still separation and still trims.
  - A bare `default` is invalid rather than a whole-value keyword. Unlike
    `inherit`, `initial`, `unset`, `revert` and `revert-layer`, it is excluded
    from `<family-name>`, so the browser drops a declaration reading it bare.
  - A comma inside `var(--font, Arial)` is not a family separator. Depth is
    counted rather than flagged, because `var(--a, var(--b, serif))` nests.

  `emitTokenBlocks` now reports the tokens it wrote alongside the CSS and its
  issues. It refuses a token on five separate grounds, and a caller asking "which
  tokens does this site emit" had to restate all five — a second statement that
  agrees today and drifts the first time one changes. The fonts panel reports on
  that list, so a token the compiler refuses is no longer described as a typeface
  the site renders.

  The fonts panel draws a subset face with glyphs that face covers. A face limited
  to a non-Latin `unicodeRange` renders none of the Latin specimen, so the row
  demonstrated another subset or a fallback rather than the file it names.

- [#1410](https://github.com/nextlyhq/nextly/pull/1410) [`15eedaa`](https://github.com/nextlyhq/nextly/commit/15eedaaca67cf61eab14d55a26b663ba347d0761) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Put the release lists on the same table every other list in the admin uses, bound how large a release may get, and say what would stop a release before it is scheduled rather than after. The list of releases and the documents inside one were the last surfaces still built by hand from cards, which cost them column alignment, sorting and the shared empty and loading states that entries, media, api keys and webhooks all share. A release can now hold at most a thousand documents — a bound rather than a policy, since nothing in the model stopped one growing until it could neither be displayed nor settled in a single pass. And the schedule dialog now asks what stands in the way while somebody is choosing the moment, naming the documents whose author has gone or which name a single language, because the server's refusal can say that a release cannot run but not which documents to fix.

- [#1343](https://github.com/nextlyhq/nextly/pull/1343) [`cd184c0`](https://github.com/nextlyhq/nextly/commit/cd184c0a0ad8bcd385662087c1a84561dcf61013) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the fonts panel, which reports which typefaces a site will actually render.

  `compileSiteSheet` emits `@font-face` blocks and token custom properties
  independently, so a `fontFamily` token naming a family the site loads no face
  for is emitted exactly like one that has it. The page then draws in whatever
  the browser reaches for next, nothing errors, and nothing is logged — the same
  silent substitution the sheet's own `tokenPrefix` note describes one property
  along.

  The panel joins the two lists, which is the only way to see it: the tokens
  studio edits one token and knows nothing about faces, and the inspector knows
  nothing about either. It authors nothing itself, so creating and renaming
  typeface tokens stays the studio's single job.

  Every family is drawn in itself. A list of typeface names set in the interface's
  own font asks an author to choose a typeface from its name, and a family the
  site does not provide renders in the fallback — so the substitution is visible
  rather than described.

  Nothing is called missing or unavailable. A named family with no face may be
  installed on the reader's device, so the wording says what is true: this site
  provides no font file for it.

  `readFamilyList`, `familyPartKind` and `splitFamilyList` are now published from
  `@nextlyhq/blocks-engine`, and they classify rather than answering yes or no.
  CSS reads a family list four ways and a boolean misdescribes two of them: a
  stack holding `var(--font-geist)` is read perfectly and cannot be resolved from
  the text, and a lone `inherit` is valid while naming no family at all. Each item
  is classified as a name, a generic keyword, a `var()` substitution, a CSS-wide
  keyword, or invalid; the list's own reading follows from those.

  `familyToDtcg` asks the same reading and applies its own narrower rule to the
  answer, so the DTCG export and any surface reporting on a site cannot disagree
  about what a browser will read.

  `splitFamilyList` no longer discards empty items — it keeps them, marked
  invalid. `font-family: Brand,` is a parse error the browser drops the whole
  declaration for, and reporting it as the single family `Brand` described a value
  the page never rendered.

  `BuilderShell`'s `openInsertPanelToken` is now `openPanelRequest`, carrying the
  panel alongside the count. Opening `insert` from the canvas appender and opening
  `tokens` from the fonts panel are the same request with a different subject, and
  two props would have been two answers to one question.

- [#1286](https://github.com/nextlyhq/nextly/pull/1286) [`26dd60a`](https://github.com/nextlyhq/nextly/commit/26dd60a5212b6d377aabe17aea1906fcea30acee) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Pressing Enter to accept an IME suggestion no longer submits a rich-text insert
  dialog.

  Choosing a candidate in a Japanese, Chinese or Korean input method ends with
  Enter, and the dialogs read that as "insert". An author composing a link title
  or a button label had the dialog close on them mid-word, with whatever the
  editor had at that moment.

  The table, video, button and button-link dialogs also share one shell now,
  rather than each carrying its own copy of the same open, focus and submit
  behaviour.

- [#1355](https://github.com/nextlyhq/nextly/pull/1355) [`76346bb`](https://github.com/nextlyhq/nextly/commit/76346bbb3ea9c37481e32326982491053dd2fe75) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scheduled content releases now actually publish themselves.

  The background job runner has had everything it needed to do this except the two
  things that make it run: a way to be triggered, and a list of the work it knows
  how to do. Both are here. A release drain is registered as a job type at startup,
  and a new endpoint runs the queue.

  Point your scheduler at `/api/jobs/run` — Vercel Cron, a system cron, or anything
  that can make an HTTP request on an interval — and due releases publish without
  anyone being awake. Each pass is bounded, so an invocation finishes well inside a
  serverless time limit and the next one picks up where it stopped; the queue is a
  table in your database, so nothing is lost in between.

  Who may pull that trigger is the same question the webhook drain already
  answered, and it now has one answer rather than two. A scheduler authenticates
  with a shared secret — `NEXTLY_DRAIN_SECRET`, or Vercel's own `CRON_SECRET` —
  compared in constant time. A person authenticates normally and needs the new
  `manage-background-jobs` permission, which super-admins receive automatically.

  Running the queue by hand grants nothing else: every job runs as the person it
  was queued for, resolved when it runs, so pressing the trigger makes work that
  was already scheduled and already authorized happen now. It does not let the
  person who pressed it do that work themselves.

  `background-jobs` is now a reserved name. If you have a collection or Single
  called `background-jobs`, rename it before upgrading — a content type sharing a
  name with a system resource would have its permissions treated as the system's,
  and preset roles would quietly lose access to it.

  When a release fails to publish — its author was deleted, a write was refused —
  that member is now reported individually in your logs, with the document and the
  reason, rather than being counted and forgotten while the release silently waits
  for a retry that will never succeed.

- [#1394](https://github.com/nextlyhq/nextly/pull/1394) [`4c1e006`](https://github.com/nextlyhq/nextly/commit/4c1e0066b79c05c8f93aed3f7d31b9fb28645b2e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Tell an editor, on the document itself, when it is going to change on its own. A document in a scheduled release now carries a bar above the editor naming each release, what will happen to it, and the moment in the timezone its author chose — and answering the question an editable scheduled document raises, which is whether changes saved now are included. They are: a release points at its document rather than copying it, and publishing promotes whatever the working draft holds at that instant. The release list can be filtered to the releases holding one document, which is what the banner reads.

- [#1395](https://github.com/nextlyhq/nextly/pull/1395) [`9726e90`](https://github.com/nextlyhq/nextly/commit/9726e90631180a9e8602397192d5068987152034) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop a release that can never run, and say what to fix. A refused release used to stay scheduled and be replanned every tick forever while reading exactly like a healthy one, so nobody learned anything until the launch did not happen. Only permanent refusals stop it — a member with no author, an author who has been deleted or deactivated, a member naming one language — because the transient ones are documented as evidence of nothing and halting on a momentary database error would lose a launch the next pass would have completed. The release page then names each member standing in the way and what resolves it, worked out from the members on every read rather than recorded when it stopped, so it stops naming a cause somebody has already fixed.

- [#1350](https://github.com/nextlyhq/nextly/pull/1350) [`9ab4632`](https://github.com/nextlyhq/nextly/commit/9ab4632b3fdccab46fafe6dc382557611666f157) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The permissions UI now knows about content releases.

  Adding `content-releases` as a system resource in core left the admin's four
  copies of that list behind, so the permission was filed under Collections in the
  role editor, mapped as per-collection access by the capability builder, and
  rendered under the wrong bucket on the permissions page. Nothing threw — a
  miscategorised permission simply shows the wrong thing, which is why a
  role-matrix entry that quietly changes what preset roles can reach is worth
  fixing as a defect rather than as tidying.

  Content releases now sit with the editorial surfaces in the permissions page's
  display order, next to media, rather than after the delivery and integration
  entries: it is a tool an editor reaches daily, not infrastructure.

- [#1351](https://github.com/nextlyhq/nextly/pull/1351) [`8bcc279`](https://github.com/nextlyhq/nextly/commit/8bcc27989f45a0287e9ceccfb91a95b27d65d2a6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fit the canvas to the pane it is actually laid out in.

  The canvas measured its DOM parent to decide how far to shrink a pinned width.
  Since the block context menu arrived, that parent is a wrapper with
  `display: contents` — it generates no box, so it measures zero, and a zero
  region made the fit fall back to its identity. An author who pinned Tablet at
  1024px was editing at whatever width the pane happened to be, with the control
  still showing Tablet selected and no readout to contradict it.

  It now measures the nearest ancestor that actually generates a box.

- [#1346](https://github.com/nextlyhq/nextly/pull/1346) [`d4a3ecf`](https://github.com/nextlyhq/nextly/commit/d4a3ecf81640b13b3700c934c32b7c04a444c65e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let the canvas show the interaction state the style panel is editing.

  A page cannot force a pseudo-class on itself, so an author switching the panel
  to hover was editing an appearance nothing could show them. A preview sheet now
  gives each state a class alternative beside its pseudo-class, and the canvas
  puts that class on the selected block — so hover, focus and active look on the
  canvas the way they will look to a visitor.

  The alternative, measuring which pseudo-classes actually match, was declined:
  the pointer is in the inspector whenever anyone is reading the panel, so a
  measured `:hover` is false every time and every hover control would report
  unset permanently.

  The marker sits inside the `:where()` that already wrapped each pseudo-class, so
  it carries no specificity and a previewed rule weighs exactly what the published
  one weighs. Published sheets do not ask for it and are unchanged.

- [#1409](https://github.com/nextlyhq/nextly/pull/1409) [`d6b45e4`](https://github.com/nextlyhq/nextly/commit/d6b45e404ac8fc3056db4dcb91fdbf1138a51332) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal: the email template editor is now a directory of focused modules
  rather than one 1878-line file.

  No behaviour changes and no API changes — the editor renders exactly as before
  and is imported from the same place. The split gives each region of the editor
  its own module, which is what the forthcoming rework of that screen builds on.

- [#1411](https://github.com/nextlyhq/nextly/pull/1411) [`b4894b8`](https://github.com/nextlyhq/nextly/commit/b4894b8ac4bc398b2eb8d30c7ebf179fa8af57ab) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template editor now gets the window.

  Editing a template used to leave roughly half the screen to navigation: the
  settings menu stayed open beside a fixed panel of variables and settings, and
  the code and the preview shared what was left. On a 1280px screen that was
  316px each — too narrow to read a line of the template or to see the email at
  its real width.

  The settings menu now steps aside while you edit, and the two panes you are
  actually working in take the space, with a handle between them so you can give
  whichever one you need more room. Everything that addresses the mail — From,
  Reply-to, Subject and the preheader — sits together at the top instead of being
  split between the editor and a settings tab, and the variables you insert are
  beside the cursor rather than a panel away. Settings open over the preview when
  you want them and leave the code where it was.

- [#1413](https://github.com/nextlyhq/nextly/pull/1413) [`9c5c169`](https://github.com/nextlyhq/nextly/commit/9c5c169c334d6eec9e7f756cd594982db032b9f8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fixes four problems in the email template editor.

  Save no longer appears to do nothing. If a declared variable was missing its
  name and you had closed Settings, saving was refused with no message anywhere,
  because the only place that message appears is inside Settings. Saving now
  reopens the panel that holds whatever needs fixing.

  On a phone the editor's action bar now wraps instead of pushing Save off the
  side of the screen, and the variable strip above the code can no longer grow
  until there is no room left to write in.

  And the settings menu, while it steps aside during editing, no longer leaves its
  links reachable by keyboard — tabbing could previously carry you out of the
  editor through a menu you could not see.

- [#1340](https://github.com/nextlyhq/nextly/pull/1340) [`b566a48`](https://github.com/nextlyhq/nextly/commit/b566a48c5d7b7648f500ad2764b1b0d9831af578) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Insert panel is a grid of tiles, and the block you are pointing at explains
  itself in a strip along the bottom.

  It was a list: one block per row, each carrying two lines of description. Every
  block was legible and only a handful were visible at once, so finding one meant
  reading rather than recognising, and the panel ran to well over a screen for a
  library of twenty blocks.

  Making it a grid on its own would have meant deleting the descriptions. A tile
  at the panel's default width is about eighty-five pixels — an icon and a short
  word — while the descriptions run from ninety-nine to a hundred and eighty-five
  characters, and they are not padding. Card's description is what says it CLIPS
  its contents, which is the whole reason to choose it over Box. Accordion's is
  what says it restricts what can be dropped inside it. A grid that dropped them
  would look better and answer fewer questions.

  So the descriptions moved rather than went. The tile under the pointer, under
  the keyboard, or under a finger is described in full in a strip at the foot of
  the panel. It follows FOCUS as well as hover, which is what separates it from a
  tooltip: a tooltip is reachable only with a mouse, so it is no help on a touch
  screen and no help at all to anyone arrowing through the panel. It follows a
  PRESS too, because a touch screen sends no hover before contact — without that,
  the tap that finally moved the description would be the same tap that inserts.

  Arrow keys are unchanged, and that is deliberate rather than an omission. The
  palette publishes listbox semantics, where a screen reader announces "option 4
  of 18" and Down means the next option; moving by a grid ROW instead would make
  that announcement wrong by two every time. An honest grid keyboard needs a grid
  accessibility tree — rows, cells and coordinates — and that is not something
  the panel can add on top of the widget it composes. The grid is a layout, and
  reading order runs left to right and then down, which is the order the arrow
  keys already move in.

  Each tile is now NAMED by its block and DESCRIBED by its sentence, rather than
  announcing the two run together. A screen reader previously read a tile as
  "TextA paragraph of plain text" — the name and the description concatenated
  with no separator, and whether any separator appeared at all depended on the
  stylesheet rather than the markup. The two are now stated separately, so the
  block's name is read first and its description second.

  The description reference is also safe for blocks nobody has written yet. A
  variation's name is an unrestricted string and a variation is identified as
  `block#variation`, so a variation named "wide card" used to put a SPACE in the
  reference — which is a space-separated list of ids, so assistive technology
  looked for two ids that did not exist and announced the tile with no
  description at all.

  The description strip now READS the palette's highlight rather than steering
  it, and `@nextlyhq/ui` publishes `useCommandHighlight` so it can.

  Steering it was wrong in a way that only assistive technology could see. The
  palette's controlled value sets which tile is MARKED and does not move the
  internal cursor that the announced option and the scroll position follow — so
  the tile drawn as current and the option announced as current drifted apart,
  and after a search removed the highlighted tile the announcement named an
  element that was no longer in the document at all. A reference that resolves to
  nothing is worse than none: a screen reader is told there is a current option
  and then cannot find it.

  Reading the palette's own state leaves one owner. It follows a pointer, an
  arrow key and a filter alike, because those are the palette's business and it
  was always doing them correctly.

  Two smaller repairs to the same panel. A tile's identifier is now allocated
  once and never reused, so a host replacing the block definitions while the
  panel is open cannot have an identifier come to mean a different block — which
  would have described one block and inserted another. And the description strip
  returns to the top when it changes subject, instead of opening the next
  description partway down where a previous one had been scrolled.

- [#1344](https://github.com/nextlyhq/nextly/pull/1344) [`66bbff0`](https://github.com/nextlyhq/nextly/commit/66bbff00b133c56812ab1052cbb34858d8506a37) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report a heading's typographic baseline even when its block renders
  asynchronously.

  The style inspector reads which element a node is drawn as by looking at the
  canvas. That read was driven by a dependency list, and the DOM moves for reasons
  no prop captures: a block whose `render` returns a promise commits its Suspense
  fallback first and its resolved root later, changing neither the canvas element,
  nor the selection, nor the document. The read therefore ran only before the
  marked element existed, and an async block resolving to a heading reported its
  font size as unset for as long as it stayed selected.

  The reader observes the canvas subtree now, including the node-id attribute
  itself — a node's id moving between elements changes the answer without adding
  or removing any.

- [#1368](https://github.com/nextlyhq/nextly/pull/1368) [`0188d15`](https://github.com/nextlyhq/nextly/commit/0188d15ad2433990ed6a48c68c18f4e872354c3d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix the translation worklist's review tab, which returned an error instead of a
  list.

  Selecting "Needs review" asked for an internal service that is never registered,
  so the tab failed before it could look at anything. The other four tabs never
  took that path and were unaffected. It now derives what it needs from the
  collection it already has.

- [#1354](https://github.com/nextlyhq/nextly/pull/1354) [`e5780f8`](https://github.com/nextlyhq/nextly/commit/e5780f82b0fdc29ae7963da5ed868407a8d545d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Insert panel's description strip keeps checking whether it is hiding text,
  rather than checking once per block.

  The strip becomes a focusable, named region when a description is too long to
  fit, so a keyboard can reach the part a pointer would scroll to. It measured
  that only when the highlighted block changed — so dragging the panel narrower,
  raising the browser zoom, or increasing the font size could push a description
  past the edge with nothing noticing. Its tail was then unreachable without a
  mouse. Widening the panel had the mirror problem: the description fitted again
  and the focus stop stayed, so tabbing toward the blocks went through a region
  that had nothing more to show.

  It now watches its own size, which catches every one of those, and re-checks on
  each render, which catches the case a size watcher cannot see: a block whose
  description is replaced with a longer one keeps its identity and its box, and
  only the text inside it grows.

- [#1363](https://github.com/nextlyhq/nextly/pull/1363) [`e87bdb5`](https://github.com/nextlyhq/nextly/commit/e87bdb51e508e9c51693ff1e1547ea509990feb0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read only the `var()` calls CSS actually substitutes, match a hosted font family verbatim, choose a specimen the face can draw, publish the projection from a registry record to the draft-split question, and report a class refusal that arrives after the control raising it has gone.

- [#1357](https://github.com/nextlyhq/nextly/pull/1357) [`ddd6129`](https://github.com/nextlyhq/nextly/commit/ddd6129278b0a8eca63b8eb19e59497d3f1abe73) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Withdrawing somebody's access now stops their scheduled releases too.

  A release runs every action as the person who scheduled it, deliberately, so
  that scheduling cannot become a way to publish something you were not allowed to
  publish. The read side did not know that. It projected any due member of any
  scheduled release without checking whether that person still existed or was
  still active — so deactivating an employee stopped their scheduled publish from
  being written while every visitor went on seeing it as published.

  It was permanent rather than temporary. A member whose author cannot be resolved
  fails, a failed member holds its release open, and a release that stays
  scheduled goes on being projected forever.

  The read path now derives from the same answer the write path does: a due member
  is projected only while its author exists and is active. A member with no
  recorded author is not projected at all, matching the write path's refusal —
  there is nobody to act as, so it describes an effect no write could perform.

  If the lookup itself fails, nothing is projected rather than everything: a
  database that cannot answer must not be read as "everyone is still authorised".

## 0.0.2-alpha.61

### Patch Changes

- [#1242](https://github.com/nextlyhq/nextly/pull/1242) [`0f656db`](https://github.com/nextlyhq/nextly/commit/0f656db6820d7644ec3bda6b33bd2e816855588c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Comparing two versions of a document now says what changed in rich text, JSON
  and code, where before it could only say THAT they differed.

  Rich text was not compared at all. Two versions came back as two whole editor
  documents, and the panel flattened each to plain text and showed them side by
  side with nothing marked — so an edit to one sentence and a whole new paragraph
  looked the same as no change. It is now compared block by block: an added
  paragraph reads as an added paragraph, and an edited one shows which words
  moved.

  Crucially it compares more than the words. Swapping an image for a different
  one, repointing a link, un-bolding a phrase, demoting a heading, changing a
  list from bulleted to numbered — each of these leaves the text byte-identical,
  and each was previously reported as no change at all. Every property a person
  can edit is now part of the comparison, so the only way to change a document
  without the comparison noticing is not to change it.

  JSON was shown as two printed blobs with nothing marked. It is now compared
  line by line, and reordering keys is correctly NOT a change, so a formatting
  difference no longer reads as an edit.

  Code fields were compared as running prose, which wrapped them into a
  proportional-font paragraph — harder to read in the comparison than simply
  viewing the version. They are now compared line by line as well, and coloured
  in the language the field declares: SQL reads as SQL, Python as Python. Each
  side is read whole rather than a line at a time, so a comment or a docstring
  spanning several lines stays one comment instead of its later lines being
  coloured as though they were code.

  When something genuinely cannot be compared — a media element with no
  identifiable source, a value that cannot be represented — the comparison says
  so instead of reporting the two sides as identical. "I could not read this" and
  "these are the same" point a person deciding whether to restore in opposite
  directions.

  The admin now draws all of this. A rich-text comparison keeps the document's
  own shape — one row per paragraph, in order — with the changed words marked in
  place and a coloured edge marking a paragraph that was added or removed. JSON
  and code are shown as numbered lines with the same colours the editors use, so
  a value reads the same wherever you meet it.

  A field whose comparison this version of the admin cannot draw now says so and
  names itself, instead of disappearing from the list — a field that vanishes
  from a comparison reads exactly like a field that did not change.

  A picture, gallery or button that was added or removed now says WHICH one. Such
  a block carries no words, so a comparison built on text alone showed an
  Added badge above an empty row and left the reader unable to tell what had
  arrived.

  Blocks that read alike are no longer confused for one another. Inserting a
  paragraph among others with the same words and a different link used to report
  two edits and an unrelated addition — none of them the change that was made.

  A password field that was later retyped as code or JSON keeps its protection.
  Old versions still hold the stored hash, and the comparison now masks it in
  what it displays while still reporting that it changed, so a changed password
  is neither printed nor passed off as unchanged.

- [#1306](https://github.com/nextlyhq/nextly/pull/1306) [`2d1868f`](https://github.com/nextlyhq/nextly/commit/2d1868f737a0cabfb3179dc936fa22b03dd8c05b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The content client a background job receives now enforces the identity it
  advertises, and a transient database error during a job's lease check no longer
  stops the whole queue.

  The client removed only `overrideAccess` and `user` from a handler's arguments.
  Five other authorization-bearing options travelled through untouched, and one of
  them was decisive: `actor` carries an API-key scope whose `permissions` array is
  read as authoritative rather than being checked against the queued user's
  grants, so a handler could hand itself any permission it named. `trusted`,
  `enforceFieldAccess`, `fieldAccessUser` and `frameworkFilter` each disabled a
  different guard. All seven are now stripped from the call rather than overridden,
  and a compile-time check fails the build if a future option is added to the
  Direct API without being classified as either owned or safe to forward.

  That check immediately found four options nobody had classified.

  A job's `ctx.content` also types correctly in a project with generated types.
  The client's signatures were derived by mapping over the Direct API, which
  collapsed each generic to its constraint: `find({ collection: "posts" })` came
  back typed as the union of every collection's row, and `findSingles()` lost its
  optional argument.

  Finally, the lease re-check a job performs before running its handler could
  throw. It sat outside both failure boundaries, so a transient adapter error
  aborted the entire drain — leaving that job leased and skipping every other job
  due in the same pass. It is now charged as an ordinary attempt, and the job
  retries on its own backoff.

- [#1300](https://github.com/nextlyhq/nextly/pull/1300) [`f75f8db`](https://github.com/nextlyhq/nextly/commit/f75f8dbdbeea7f22108c810d0a02c57bde1ed96d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A job now runs with exactly the authority of the person who queued it, and a
  release scheduled far ahead no longer quietly prunes itself.

  The identity a job resolves is built by the same constructor every authenticated
  request uses. It previously assembled its own, which dropped the single-role
  alias that rules written as `user.role` read: those rules compared against
  nothing, denying authorized work — and a negative rule such as
  `user.role !== "suspended"` GRANTED work it should have refused.

  A job also re-proves it still holds its lease after resolving that identity.
  Resolving it is two database reads, and a lease that expired while they were in
  flight could be taken over by another runner, which then did the work a second
  time.

  `retentionMs: null` now does what it documents. It means "keep the history, I
  prune it myself", and it was being read as "unset" — so the seven-day default
  came back and deleted the rows a deployment had asked to keep.

  The content client handed to a job handler carries the Direct API's own
  signatures, so `ctx.content.find({ collection: "posts" })` compiles and its
  result is usable without casts. Passing `overrideAccess` or `user` through it is
  now a compile error rather than something silently ignored.

  On MySQL, the column recording who a job runs as is as wide as the user id
  column it stores, so a job queued by a user with a longer id is no longer
  refused — or truncated into an id that resolves to nobody, which was reported as
  a deleted account.

  Two lint gates were repaired. The v1 upgrade simulation now recognises the jobs
  table as a legitimate post-0.45 addition instead of a phantom diff, and source
  modules under `src/` whose names begin with `run-` are linted again: a pattern
  meant for dev-tooling scripts had been silently excluding three real modules
  from every lint gate.

- [#1301](https://github.com/nextlyhq/nextly/pull/1301) [`e1804a3`](https://github.com/nextlyhq/nextly/commit/e1804a3d2410791222f6dd2a45055e72b11e15aa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scheduled release now takes content DOWN as well as putting it up.

  Scheduling an unpublish did nothing. The decision was resolved correctly — the
  code knew the document was due to be withdrawn — and then only the publish half
  was passed to the read paths, so the ordinary `status = published` filter went
  on returning the row the release was supposed to retire. Collection listings,
  Single reads and relationship expansions all apply both directions now.

  Release visibility is decided from DOCUMENT-WIDE members only. Per-locale
  lifecycle is not stored on the row this filter applies to: a localized document
  is public through its main row or through any one of its translations, and
  publishing or withdrawing a single language writes that language's companion row
  and deliberately leaves the main row alone. Applying a one-language decision to
  the whole document contradicted that in both directions, so it no longer
  happens. Scheduling a release for one language is not yet supported and cannot
  regress anything today, because releases have no write surface.

  A single read also resolves releases against ONE instant, and a listing's count
  now shares the instant its rows used, so a release becoming due mid-request
  cannot produce a page whose rows and total disagree.

- [#1197](https://github.com/nextlyhq/nextly/pull/1197) [`9aad0b0`](https://github.com/nextlyhq/nextly/commit/9aad0b018da5f855b396f087d8d7c328ea25ef85) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A route names one collection, and the page it renders reaches others through
  relationships that were never named. A route that skipped access checks could
  stay silent about how far that skipping travelled, and silence meant every
  collection it happened to reach.

  On a pre-rendered route that is written into a static file: another
  collection restricted or unpublished rows, served to everyone, still there
  after the row is taken down.

  A route that skips access checks must now say which collections that reaches.
  One that genuinely serves everything says so by name. Routes that already
  declared their reach are unaffected, and no page changes what it renders.

- [#1308](https://github.com/nextlyhq/nextly/pull/1308) [`9174670`](https://github.com/nextlyhq/nextly/commit/91746709aaad166b01524e1760cd33f8c8229066) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Columns block now arrives with two columns instead of being empty.

  Inserting Columns used to place a container with nothing in it, so an author
  got an empty box and had to build both columns by hand before the block was
  worth anything. An accordion had the same problem for the same reason: its
  slot accepts only accordion sections, and a section cannot be placed anywhere
  else, so an empty accordion offered no way forward. Both now arrive ready to
  use — a row with two columns, an accordion with one section.

  A block declares this for itself, so plugin containers can do the same. Each
  slot may name the children it starts with:

      slots: {
        children: {
          defaultBlock: [{ type: "acme/cell" }, { type: "acme/cell" }],
        },
      }

  Each entry is one child, and each carries its own props, so a row whose columns
  have different widths is expressed by writing two different entries rather than
  by repeating a count. The children are created fresh every time the block is
  placed, so two rows on one page never share an id.

  Card, Gallery, Box, Section and the accordion's own sections deliberately do
  NOT declare a default: their slots accept any block, or accept one that is
  placeable on its own, so there is no starting child that would be righter than
  none.

  BREAKING for block authors: `SlotSpec.template` is REMOVED. It held a list of
  stored nodes carrying literal ids, so two containers expanded from one template
  would have collided on `duplicate-node-id` — nothing in the codebase ever
  expanded it, and no released behaviour depended on it. Replace a `template`
  with a `defaultBlock` naming the child TYPES; ids are then minted per instance.

- [#1168](https://github.com/nextlyhq/nextly/pull/1168) [`3a1e43c`](https://github.com/nextlyhq/nextly/commit/3a1e43c80c3670897aca4f00fad81ad221b46a1a) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Extract shared transaction CRUD forwarders and error classification into @nextlyhq/adapter-drizzle.

  Unifies duplicated `TransactionContext` CRUD forwarding (`select`, `selectOne`, `update`, `delete`, `upsert`, `getDrizzle`) and standardized `handleQueryError` context wrapping across MySQL, PostgreSQL, and SQLite dialect adapters into `@nextlyhq/adapter-drizzle`. Dialect-specific driver locking, transaction lifecycle, raw statement execution, and error code tables remain in each dialect adapter.

- [#1280](https://github.com/nextlyhq/nextly/pull/1280) [`ef7dc0e`](https://github.com/nextlyhq/nextly/commit/ef7dc0e07639bab4400dba70c04144f27b065f40) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An empty container on the page-builder canvas now offers an Add control that puts the new block inside it. Pressing it selects the container and opens the insert panel in one step, so the block you choose next lands inside rather than beside it.

  A container you have positioned `fixed` or `sticky` is not offered one, because it stops travelling with the page the control is drawn over and the control would come to rest on unrelated content. Select it and insert as before to fill it.

  Nor is a container inside a wrapper you have set to `display: none`, since nothing of it is on the canvas to put a control on. It comes back the moment the wrapper is shown again, and selecting it and inserting fills it either way.

- [#1021](https://github.com/nextlyhq/nextly/pull/1021) [`788363c`](https://github.com/nextlyhq/nextly/commit/788363c98dab3fb2e97a316e0bc5eea0788207c8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every admin list withholds its primary identifying column from the column-visibility control, so a reader cannot hide the one cell that says which row they are looking at. Each list then asked that control about every column when computing which to hide. A column the control was never given is absent from its list of visible columns, so it answered "not visible" — and the name column disappeared from roles, users, api keys, collections, field groups, plugins, singles, email providers, email templates and image sizes. The control now reports a column outside its remit as visible.

- [#1296](https://github.com/nextlyhq/nextly/pull/1296) [`93f9889`](https://github.com/nextlyhq/nextly/commit/93f9889e6d0ce621b9e9d8c7cd32faaea707cf59) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An empty container inside a closed accordion section no longer offers an Add control on the page-builder canvas.

  A browser lays out a closed section's contents as though the section were open, while drawing none of it, so the control was placed on a rectangle nothing occupies — over the NEXT section's title. Pressing there added the block to a section you had not chosen, with nothing on screen to explain it. Open the section and the control is there.

- [#1206](https://github.com/nextlyhq/nextly/pull/1206) [`e1b16fa`](https://github.com/nextlyhq/nextly/commit/e1b16fad0bacf0cfe61a95a5c918ce93b517e0eb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Rate limiting on the login and API-key paths kept its counters in the memory of
  whichever process handled the request. On a deployment that runs more than one
  instance — which is the normal way to run a Next.js app — every instance kept
  its own count, so a limit of five attempts became five per instance, and the
  number of instances is decided by the platform rather than by anyone.

  The limit that protects sign-in was therefore looser than configured, quietly,
  and most so under heavy traffic.

  The window can now be kept somewhere both instances can see. Supply a store on
  the rate limit config and the login and API-key limits are counted once for the
  whole deployment. Change nothing and the behaviour is exactly as before.

- [#1127](https://github.com/nextlyhq/nextly/pull/1127) [`23fe766`](https://github.com/nextlyhq/nextly/commit/23fe76682f49ce3037ff70d556172b9fd28df98a) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Signed-out screens now say why a request failed. Signing up, setting up the
  first admin account, signing in, accepting an invite, resetting a password,
  setting a first password and verifying an email all read the reason the
  server sent instead of a bare "Validation failed." A rejected name or
  password now names the rule it broke, and first-run setup reports each
  unmet password requirement rather than a single generic sentence.

- [#1077](https://github.com/nextlyhq/nextly/pull/1077) [`6848510`](https://github.com/nextlyhq/nextly/commit/68485109d294be88f89969a261048165acde2a09) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The signed-out screens are drawn by two shared cards instead of fifteen
  hand-written copies. Sign in, sign up, first-run setup, forgot password, reset
  password, accept invite and verify email looked alike by repetition, so the
  logo, the mount fade and the branded product name could drift apart on any one
  of them. Nothing changes on screen.

- [#1057](https://github.com/nextlyhq/nextly/pull/1057) [`57a2771`](https://github.com/nextlyhq/nextly/commit/57a2771c82377227d4a6e6632eb5ce576000be51) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Separate autosave's recording machinery from the form it was written against, so a second editor can record recovery points on the same timing, status vocabulary and coalescing rules rather than reimplementing them. No change to how the entry and single editors behave.

- [#1162](https://github.com/nextlyhq/nextly/pull/1162) [`b4e95bf`](https://github.com/nextlyhq/nextly/commit/b4e95bff26425ddd733304701601b155fd65e262) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An author who rounded a block's corners saw the spacing overlay paint colour into the
  transparent corners beside it, outside the shape the block actually renders as. The padding
  bands were full-width strips cut from the padding box's RECTANGLE, while a rounded padding box
  curves away from that rectangle — and a band is read as a measurement, so one covering ground
  the block does not occupy states a measurement that is false. The bands are now cut to the
  curve, and the value chip still overflows its band so a number in a four-pixel gap stays
  readable.

  The same curve is now respected on the way in. A block inside a rounded container that clips
  its overflow can sit within all four of that container's straight edges and still have a corner
  removed by the curve; the overlay accepted it and drew bands across the part that is not
  rendered. It now tests the corner itself rather than declining every rounded container, so the
  ordinary rounded card keeps its overlay.

  Two further cases the curve reaches. A block rounded to match the container it fills is not cut
  at all, while its bounding rectangle's corners sit outside every one of that container's arcs, so
  the overlay used to vanish on the ordinary nested rounded card; the block's own curve is now part
  of the comparison. And an overlay already on screen now notices a radius change on its own —
  nothing else about a band moves when only the corner does, so it previously kept painting the
  curve the block used to have until something else happened to move it.

- [#1194](https://github.com/nextlyhq/nextly/pull/1194) [`000bac9`](https://github.com/nextlyhq/nextly/commit/000bac942edbb3cb758c41c96220289a39c414a7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Multi-selection style editing gains its model layer, and every style write in
  the builder now goes through it.

  Selecting several blocks and changing one property is a different question from
  editing one block, because it has to say what a shared value MEANS before it can
  offer to change it. Three blocks agreeing on a padding is not the same as three
  blocks disagreeing, and a control showing nothing is not the same as one showing
  "Mixed": typing into the first sets a value nobody had, while typing into the
  second replaces values that differ. An author is entitled to know which of those
  they are about to do, so a shared value is a third answer rather than an absence.

  Values are compared by their serialised shape with keys sorted at every level. A
  style value is a tree, and two blocks holding equal trees hold equal values
  however separately those trees were assembled — comparing by reference reports
  every selection as mixed, which is always.

  A batch produces ONE group of ops for one history entry, built per node from
  that node's own stored styles rather than from the primary's. A style op patches
  the whole envelope, so an op built once and repeated carries the primary's
  unrelated declarations to every other block.

  The single-block path now goes through the same layer as a group of one. The
  alternative was two implementations of "what ops set this address", which agree
  the day they are written and drift afterwards — leaving the surface an author
  reaches through a multi-selection behaving unlike the one they reach through a
  single click, with each path's own tests passing.

- [#1147](https://github.com/nextlyhq/nextly/pull/1147) [`ef1ee3e`](https://github.com/nextlyhq/nextly/commit/ef1ee3eec50deb24595ce5e4a200ac23bcb2b900) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An inherited block-base entry is no longer turned into an emitted CSS rule.

  `compilePageCss` emits a block type's defaults only when `Object.hasOwn` finds
  the entry, because a node type reaches a SELECTOR and the compiler reads
  persisted data whether or not anything validated it. Narrowing a stated
  `blockBases` record to the types a page draws copied whatever the lookup
  answered — so a record reached through `Object.create`, or one whose prototype
  had been polluted, had its inherited entry made an OWN property of the narrowed
  record, and the compiler then emitted a rule it had deliberately declined to
  emit.

  A style value longer than `MAX_VALUE_LENGTH` is also read no further than the
  compiler reads it. The engine refuses such a value before parsing and emits no
  declaration, so two of them produce identical CSS — carrying both in full
  invalidated a byte-identical stored stylesheet over a suffix nothing reads, and
  put an arbitrarily large allocation into every cache check. `MAX_VALUE_LENGTH`
  is exported so a writer can honour the same number.

  A design token's name is now bounded at `MAX_TOKEN_NAME_LENGTH`, on both sides
  of a reference. The name grammar constrained the alphabet and not the length, so
  a name of megabytes of otherwise-valid characters was scanned in full by the
  pattern on every compile and copied into a `var()` on every rule that used it.
  Bounding it also makes the stamp above sound for every string it reads rather
  than for most of them: a token name reaches CSS through `scalarText`, so two
  names agreeing up to the truncation point and differing after it compiled apart
  under one identifier, and the stored sheet was then reused for the wrong one.
  The cap is deliberately larger than the one on a class name, because a token
  name is composed from a design-token file's nesting depth rather than typed.

  A block type is bounded at `MAX_BLOCK_TYPE_LENGTH` before its grammar runs, for
  the same reason and by the same measure. The engine now also exports
  `EMITTABLE_STRING_BOUNDS`: every bound on a string it can write into CSS, as
  data rather than as prose. A consumer that digests compiler inputs has to keep
  enough of each string to tell two apart whenever they compile differently, and
  the list of which strings those are had been kept twice as a comment — short by
  one both times.

  Registration, document validation and compilation now share one block-type
  predicate, `isBlockType`, exported from the document model. The three carried
  identical copies of the grammar, so a bound added to one accepted a name the
  others rejected: a block could register and validate while the compiler omitted
  its declared defaults, rendering without the look it declares and reporting
  nothing.

  The shared-input stamp's encoding is bumped, and its contract now covers what
  the COMPILER emits as well as what the stamp serializes. A stamp keys on inputs,
  so it cannot see the compiler treating unchanged inputs differently — a stored
  stylesheet would otherwise be served for a compile that no longer produces it.

  A custom-property prefix is bounded too, and the block-name cap now reaches the
  generated block manifest and its published JSON Schema. Without the second,
  `nextly generate` accepts a declaration `registerBlocks` refuses at boot, which
  is the opposite of what an artifact describing a plugin's declaration is for.
  The manifest restates the cap rather than importing it, as it already does for
  the block-version bound, and the engine-parity test holds the two equal.

  `isBlockType` and its cap are also exported from `@nextlyhq/blocks-engine/format`,
  so a generator reading the document format from the lightweight entry can apply
  the same rule instead of deciding independently what a node type may be.

  The emission cap applies to a token's IDENTITY rather than to its display name.
  A token's identity is its id when it has one, so a renamed token emits under
  that id and its name reaches no stylesheet — capping the name would have deleted
  a working token from the site sheet the moment an author gave it a long label,
  and a rename is meant to cost nothing.

  Both DTCG gates follow the same identity rule as the emitter, through one shared
  answer rather than a third copy of it. Without that, a renamed token with a long
  label was silently dropped from an export and refused on the way back in, while
  Nextly went on rendering it.

  A token name's DEPTH is bounded as well as its length. The DTCG exporter writes
  one nested group per dot-separated segment and the reader walks those groups, so
  a label deep enough produced a file this package could not read back — an
  exporter emitting a document that fails its own round trip. Bounded separately
  from length because depth is the property that breaks, and a renamed token's
  label is deliberately free of the length cap.

  The builder's rename gate follows the same rule, so the editor no longer refuses
  a label the engine accepts, and `EMITTABLE_STRING_BOUNDS` lists the literal
  style value — the largest bound of the set, and the one whose omission let a
  consumer verify every listed bound and still choose a limit below it.

  Renaming a token whose identity the new rules cannot emit re-pins the identity
  to the new name rather than carrying the unusable one forward. A site stored
  before these bounds existed can hold such a token, and carrying its identity
  through a rename left it permanently unrenderable with no way to repair it from
  the editor. A WORKING identity still never moves, which is what rename exists to
  protect.

  A label and an identity are asked different questions by different functions
  rather than one function reading a string whose role the caller decides. Depth
  belongs to a label, because only a label becomes nested design-token groups;
  the emission cap belongs to an identity, because only an identity becomes a
  custom property. Conflating them cleared working identities on rename.

  Both fields are checked for being strings before the grammar runs, since
  `RegExp.test` coerces and a stored number satisfied it before reaching a place
  that assumed a string — one malformed settings entry aborted every page compile.

  The design-token reader bounds nesting before descending rather than at the
  leaf, so a deeply nested file is refused instead of exhausting the stack.

  A page scope is bounded and listed too — it prefixes every rule a page emits, so
  an oversized one is copied once per rule, and it was the last emitted string
  with no cap.

  `safeTokenPrefix` takes what actually reaches it. A persisted `null` is not the
  absent value its old signature described, and reading a length off it aborted
  the compile the fallback exists to keep going.

  A stored page stylesheet records the scope its selectors were actually written
  under rather than the one the caller asked for. A scope the compiler refuses is
  dropped and the sheet compiled global, so recording the request stored an
  artifact claiming an isolation its own selectors did not carry — and the
  renderer attaches that class, which is how one document's rules reach another
  rendered beside it. That held for any refused scope, not only an oversized one.

  A font format is bounded, and the token studio refuses a name that lands on a
  custom property another token already occupies. The name-to-property mapping is
  deliberately not injective, so two visibly different, individually legal names
  can collide and the compiler drops whichever it reaches second.

  The selector `emitTokenBlocks` writes under is bounded, and the token studio no
  longer lets a new row claim an identity another row has frozen under a different
  display name — the compiler writes the older token and drops the new one.

  Both design-token gates name the depth limit when they refuse for it, instead of
  reporting a grammar problem the name does not have.

- [#1164](https://github.com/nextlyhq/nextly/pull/1164) [`2dea22a`](https://github.com/nextlyhq/nextly/commit/2dea22ade9293651e51d3990bfb6df5ed83b993c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Adds an Advanced tab to the page builder's inspector, where a block's `id` and
  its own HTML attributes can be set. Both were already modelled and already
  applied to the rendered element; until now nothing in the editor could write
  them, so an anchor to link to or a `data-` attribute an analytics script reads
  had to be added outside the builder.

  A row that the page would not render is refused where the author can still see
  why, rather than saved and dropped later: an attribute the renderer does not
  allow, a second row setting a name another row already sets, and an `id` that
  the CSS id field beside it would win over. The rule is the renderer's own and is
  asked rather than copied, so the editor cannot come to accept a name the page
  then discards.

- [#1043](https://github.com/nextlyhq/nextly/pull/1043) [`820be87`](https://github.com/nextlyhq/nextly/commit/820be87c5848ac40ce82e0dee570a20bf0f60aca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reading a past version of a document no longer offers a way to open the page builder on it. The blocks field now honours the read-only and disabled states the admin passes to every field, so a historical view shows what the field holds without an editor whose changes would be written into the snapshot.

- [#1223](https://github.com/nextlyhq/nextly/pull/1223) [`827d5fd`](https://github.com/nextlyhq/nextly/commit/827d5fde9d7eef3870a4945812d68580709b8bd3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks carry an icon, and the palette and layers tree draw it.

  `BlockEditorMeta.icon` was declared and never used: no block named one and no
  surface drew one, because nothing said what the string should contain. It now
  names a concept from `BLOCK_ICONS` — `"columns"`, `"quote"`, `"loop"` — and all
  nineteen core blocks declare one.

  The vocabulary is concepts rather than the names of an icon library's exports.
  The editor draws with `lucide-react`, which is a peer dependency admitting any
  `>=0.400.0`, so naming its exports in the block contract would let a host's
  choice of release break a plugin block whose author did nothing wrong, and would
  freeze the editor's art direction into every block definition ever written. One
  file decides what each concept looks like, so the editor can re-skin without a
  block file changing.

  A block that names no icon, or names one this editor has never heard of, draws a
  generic mark rather than nothing. An editor cannot tell a plugin author's typo
  from a concept a newer engine added, and a row with no mark is a different shape
  from every row beside it.

- [#1087](https://github.com/nextlyhq/nextly/pull/1087) [`fefbeef`](https://github.com/nextlyhq/nextly/commit/fefbeefb6df32f3f723baa7ff29ece63c6c51efc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Branded admin surfaces now pick a foreground that meets WCAG AA. The picker
  compared its dark candidate using the contrast ratio for pure black while
  returning slate-900, so a mid-tone brand colour could be given a foreground it
  had never measured: `#6366f1` shipped 4.00:1 against a 4.5 threshold, making
  primary buttons fail contrast for every user of that colour.

- [#1216](https://github.com/nextlyhq/nextly/pull/1216) [`0ed3c26`](https://github.com/nextlyhq/nextly/commit/0ed3c2666e1c803734095d6ffba5b92cff6176cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Move `authoredBreakpoints` and `inCascadeOrder` from the page-builder editor
  into the blocks engine, beside the `BreakpointDef` and `BreakpointSet` types
  they operate on.

  Both answer questions that the stored record does not: which rows an author
  actually defined — a stored set may carry a reserved `base` row that the
  compiler prepends regardless — and the order in which the cascade applies them.
  More than one package now asks, so a second implementation would agree about
  what a breakpoint means while disagreeing about which rows exist and in what
  order they apply.

  The editor re-exports both, so every existing import keeps working.

- [#1074](https://github.com/nextlyhq/nextly/pull/1074) [`0353157`](https://github.com/nextlyhq/nextly/commit/0353157e7337424e46d1ba04139b505e0356d329) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two accessibility defects in the page-builder shell, found by an axe audit that
  now runs in CI.

  The canvas scrolls and nothing inside it is focusable, so at `tabindex="-1"` a
  keyboard user could not scroll it at all. And the bottom bar carried an
  `aria-label` on a role that prohibits one, so the name was never announced.

- [#1041](https://github.com/nextlyhq/nextly/pull/1041) [`56bb1d1`](https://github.com/nextlyhq/nextly/commit/56bb1d14cbde68ea8044b6e22ff66d5cda544036) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now make several changes as one action, so an edit that touches more than one block takes a single undo to reverse and either happens completely or not at all.

- [#1025](https://github.com/nextlyhq/nextly/pull/1025) [`17c181a`](https://github.com/nextlyhq/nextly/commit/17c181a323606e109f6b35757b99c3702b6f5ed5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder gains a floating toolbar on the selected block: select its container, move it up or down, duplicate it, or delete it. These actions existed only as keyboard shortcuts before, so they were undiscoverable without reading a shortcut list. Unavailable actions stay in place and explain why, and a press still announces to screen readers through the same live region the keyboard uses.

- [#1030](https://github.com/nextlyhq/nextly/pull/1030) [`992a626`](https://github.com/nextlyhq/nextly/commit/992a626a2458470a9bbfa128b65c9931dcbe2342) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Pressing Escape in the page builder no longer navigates away from the entry and discards unsaved block edits. The editor now claims the key: it clears the block selection, leaves a text field to handle its own dismissal, and stands aside only for an open dialog.

- [#1070](https://github.com/nextlyhq/nextly/pull/1070) [`927183e`](https://github.com/nextlyhq/nextly/commit/927183ee98033531245cabd66d0d57bdd05a6497) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now shows whether the page is a draft, published, or has a
  pending change — the status the editor's own chrome would have shown, which it
  hides while the canvas has the window.

  Fields can read it: `useDocumentStatus` reports how the document stands for the
  language being edited, beside `useDocumentIdentity`, which reports which
  document it is.

- [#1040](https://github.com/nextlyhq/nextly/pull/1040) [`53e4495`](https://github.com/nextlyhq/nextly/commit/53e4495c3d6d8e441cd43fc317c7a56257d48004) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder canvas now holds more than one block selected. Click replaces the selection, Cmd or Ctrl click adds and removes a block, and Shift click selects a run. The block the inspector is editing is drawn at full strength so it stays clear which one the panels describe.

- [#1068](https://github.com/nextlyhq/nextly/pull/1068) [`b943c67`](https://github.com/nextlyhq/nextly/commit/b943c67b3d253d4ccbcbe70a7e742c4cb7bd7ea0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now shows a getting-started card: add a block, write
  something, add a second one. Every step is read from the page itself rather
  than tracked, so it describes what is there rather than what someone once did.

  Dismissible, and a site can turn it off entirely with
  `pageBuilder({ checklist: false })`.

- [#1063](https://github.com/nextlyhq/nextly/pull/1063) [`9bdc9b5`](https://github.com/nextlyhq/nextly/commit/9bdc9b5be28e44305bd27a409c39dc03ef22256b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Work laid out in the page builder now survives a lost tab. While the block
  editor is open its live document is recorded as a recovery point on the same
  debounce the entry and Single editors already use, and reopening the document
  offers it back behind the existing restore prompt.

  Autosave also stops re-asking once the server has declined it. An entity whose
  owner has not enabled recovery points previously collected a rejected request
  every couple of seconds for as long as an editor stayed open.

- [#1036](https://github.com/nextlyhq/nextly/pull/1036) [`edb49ef`](https://github.com/nextlyhq/nextly/commit/edb49ef7a56c06adf5059b9d021062db672d76b0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder gains the rules a multi-block selection needs: click to replace, mod-click to add or remove, shift-click to select a run. Published as plain functions so a host or an agent reads a selection the same way the editor does.

- [#1042](https://github.com/nextlyhq/nextly/pull/1042) [`a1a5705`](https://github.com/nextlyhq/nextly/commit/a1a5705694ba0687edbb3aee711a00e50a3ddc92) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Delete and duplicate now act on every selected block at once in the page builder, as a single action that one undo reverses. A locked block in the selection stops the whole delete and says which one.

- [#1045](https://github.com/nextlyhq/nextly/pull/1045) [`08175f9`](https://github.com/nextlyhq/nextly/commit/08175f9fa1f697bd8d3265c8ce07bf06d2480a19) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder toolbar and inspector now answer for a whole selection. The toolbar sits over everything selected and offers the actions that apply to all of them; the inspector says how many blocks are selected and can lock or unlock them together, showing a mixed state when only some are locked.

- [#1029](https://github.com/nextlyhq/nextly/pull/1029) [`744a791`](https://github.com/nextlyhq/nextly/commit/744a79119534ac8db1ff292d6cf9beafd0fb959e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder toolbar no longer shows a keyboard hint that named the wrong modifier on macOS, and its arrow-key navigation no longer jumps backwards after an action that moves the selection.

- [#1252](https://github.com/nextlyhq/nextly/pull/1252) [`314f5aa`](https://github.com/nextlyhq/nextly/commit/314f5aacdd9f258dbdccbef6a151af5e771ab959) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A difference that lives under a `__proto__` key is no longer read as "no
  change". The registry compares a code-first config against its stored row
  through a canonical serialisation, and that rebuild assigned keys to an ordinary
  object — where `__proto__` invokes the legacy prototype setter instead of
  becoming an enumerable property, so `JSON.stringify` omitted it and two configs
  differing only there compared equal. `JSON.parse` creates that key as an
  ordinary own key, so a stored JSON column round-tripping through it arrives
  carrying one.

- [#1055](https://github.com/nextlyhq/nextly/pull/1055) [`52abdfe`](https://github.com/nextlyhq/nextly/commit/52abdfee28e3e2dafe12a356cf72aee4d5938de7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scroll the page editor's canvas while a block is dragged near its edge. On a page taller than the window, a block could not be moved anywhere outside the visible band at all, because the position it would land at never came on screen.

- [#1231](https://github.com/nextlyhq/nextly/pull/1231) [`375c8ce`](https://github.com/nextlyhq/nextly/commit/375c8ce9d4be66ec1637a42781156af2398cd76e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The editor canvas had no way to say which breakpoint you were editing, so every
  style edit landed in the widest tier no matter how the page looked on screen.

  Choosing a tier now sizes the canvas, and everything else follows from the width
  the box actually gets: which tier an edit writes to, and which tiers the Style
  tab reports as live. There is no second piece of state that could disagree with
  what is on the canvas.

  Because the width the box gets is what decides, an editor region narrower than
  the site's widest breakpoint now says so — the canvas reports the tier it is
  really in rather than the one that was asked for.

- [#1012](https://github.com/nextlyhq/nextly/pull/1012) [`8a70233`](https://github.com/nextlyhq/nextly/commit/8a70233318b52917c569c1e5a253d2becf4ad556) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Clicking a block on the page-builder canvas selects it again. A drag took control of the pointer
  as soon as the mouse went down, which made the browser report every click as landing on the canvas
  background rather than on a block — so clicking a block cleared the selection instead of setting
  it. The canvas now takes control only once a drag has actually started.

- [#1249](https://github.com/nextlyhq/nextly/pull/1249) [`0cbe2c0`](https://github.com/nextlyhq/nextly/commit/0cbe2c07804ca0a9ae9222999c4dd968dfe72c10) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The editor canvas asks the renderer which breakpoints a page compiles against,
  rather than working it out alongside it. The two answers agreed, and a second
  answer to one question is one that agrees until the day it does not.

- [#1316](https://github.com/nextlyhq/nextly/pull/1316) [`760cc02`](https://github.com/nextlyhq/nextly/commit/760cc02ab5f40d0314051747de72f44d573d2bd5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Right-clicking a block on the canvas opens a menu.

  Nothing happened before: the editor had no context menu anywhere, so an author looking for the block's actions where every comparable builder puts them found nothing. The menu offers the same verbs the floating toolbar offers, in the same order, with the same availability and the same reasons — it is another way to reach them rather than a second list that can disagree. A verb that is unavailable stays visible and says why, because a menu that silently drops Delete answers "why can I not delete this" with nothing at all.

  Right-clicking a block also selects it first, so the menu always acts on the block under the pointer. Right-clicking one of several selected blocks keeps that selection instead of replacing it.

  A touch long press opens it too, on the block under the finger. The platform's context-menu key reaches it from any block that draws a focusable control, since that sends the same event a right-click does; a block that draws none cannot open it, and neither can the canvas background. Every verb in it stays reachable without a pointer regardless, through the keystrokes, the block toolbar and the command palette, so this adds a route rather than becoming the only one.

- [#1261](https://github.com/nextlyhq/nextly/pull/1261) [`7f71689`](https://github.com/nextlyhq/nextly/commit/7f716895f83d2450fbbab643e890e9e7ec7e73a9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can edit the base breakpoint again. The canvas is now scaled so
  a tier wider than the space available still fits, instead of being capped at the
  region and silently editing the narrower tier that width implies.

- [#1120](https://github.com/nextlyhq/nextly/pull/1120) [`9014091`](https://github.com/nextlyhq/nextly/commit/90140917f98b0ae7841c2a4162f85af7b22846dc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Pressing undo while typing a block's text on the canvas rewound the document instead of the words.
  The author lost a block move they had finished with, kept the sentence they wanted back, and got no
  undo where they asked for one.

  `mod+z`, `mod+shift+z` and `mod+y` now decline while the caret is in text, leaving the keystroke to
  the element — which is what an uncontrolled `contentEditable` needs, since inline editing hands the
  DOM over precisely so the browser's own history serves the caret.

- [#1320](https://github.com/nextlyhq/nextly/pull/1320) [`acbfb43`](https://github.com/nextlyhq/nextly/commit/acbfb432223b8b3b4da1748324a2ae6582680b6e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A failure reported by the class selector is now matched to its element by what
  that element holds rather than by the identity of the list holding it. A block
  with no classes is described by a freshly built list on every redraw, so the
  message was discarded on the next one — which is every one — and an author
  never saw it.

  The name being typed also survives a class being created. The field stays
  usable while the save is in flight, so an author can begin the next name before
  the first one lands, and finishing the first no longer clears what they typed
  since.

- [#1310](https://github.com/nextlyhq/nextly/pull/1310) [`7c2f581`](https://github.com/nextlyhq/nextly/commit/7c2f581eee969e95958b71731107cb0b0004ea75) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The class surfaces now refuse the states the engine cannot render, rather than
  recording them and drawing them as done.

  An element that already carries as many classes as a page applies refuses both
  applying and creating, and one that stores more than that says so — those extra
  references style nothing, and removing a class could previously bring one into
  use with no explanation. A name is refused once the library is full, because
  such a class emits no rule and cannot be saved at all.

  The list of classes to add is bounded and says how many it withheld, so a long
  library narrows by typing instead of putting thousands of rows in front of an
  author. Its rows leave the keyboard where the ARIA combobox pattern puts it —
  in the field, with the highlighted row named to assistive technology — instead
  of taking every row into the tab order.

  Renaming a class to the name it already has no longer reports an edit, so a
  document is not revised into a version that renders identically.

- [#1248](https://github.com/nextlyhq/nextly/pull/1248) [`689c321`](https://github.com/nextlyhq/nextly/commit/689c3216b4bce96870c44613a562b35413170167) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The class-usage index now finds the blocks fields it is responsible for by reading a
  collection's LIVE configuration, so a collection created after the plugin was wired - or a
  blocks field added to an existing one - is tracked rather than missed.

  A blocks field inside a PRESENTATIONAL group is found. A group without a name stores nothing
  of its own and its children live at the parent path, so such a field is reached the same way
  a top-level one is; skipping it would leave that document's classes out of the index
  entirely, and a class the page still renders would then read as unused. A NAMED group and a
  repeater stay excluded, because their children are reachable only through a path the rebuild
  cannot resolve - indexing those would write rows nothing could ever reconcile or sweep.

  A group whose name is the EMPTY STRING is presentational too. That is what a host writes for
  a layout group it gave no key, and core resolves references and redacts paths through such a
  group at the parent level - so one definition of "has a name" now answers both questions this
  filter asks, and a group cannot be read as named while the blocks field inside it is read as
  unaddressable.

  A group that contains itself no longer hides its siblings. Expansion is tracked by identity,
  so a cyclic group is descended into once; a bound alone ended the walk without ever reaching
  the fields declared after the cycle, and an empty result is indistinguishable from a
  collection that declares no blocks field - every class the document applies would have read
  as unused.

  A group with a very long field list is read whole. The walk holds a cursor into each list where
  it lies rather than moving children into a queue: moving them passes each one as an argument,
  which reaches the engine's limit at around a hundred thousand and throws. Maintenance runs
  after the document has committed, so a throw there reports a failed save for one that
  succeeded.

  There is no cap on how many declarations are visited. Expanding each group at most once is
  what makes the walk finite, and it is sufficient - a cap beside it would end a cyclic walk
  without reaching the fields the cycle hides, and on a merely LONG list it stops partway and
  returns fewer descriptors while reporting nothing, so those documents' classes go unindexed
  and read as unused. Nothing validates a field count, so a long list is legal configuration
  rather than evidence the config is wrong.

  Whether a field stores per language is decided by the collection's localization master switch
  together with the field's own flag, through the same classifier storage obeys. A field flagged
  localized on a collection that stores no translations is held ONCE, under the empty locale
  key; reading the flag alone enumerated a subject per configured language and left the single
  subject a read resolves to holding no rows at all. The filter therefore takes the collection
  rather than its field list, because pairing one collection's fields with another's switch
  would produce subjects under locales that collection never stores.

  Configuration is read defensively, because it arrives as whatever the host wrote, including
  from untyped JavaScript and the Schema Builder's stored JSON. The localized flag and the
  master switch are both read as strict booleans, so a stored string does not file one
  document's classes under every language. A field with no usable name is skipped rather than
  defaulted, since the name is the column every row is keyed by. A duplicate name yields one
  subject rather than two.

- [#1268](https://github.com/nextlyhq/nextly/pull/1268) [`37e0edb`](https://github.com/nextlyhq/nextly/commit/37e0edb1dfe22b0674c2983354432d3729f3e55f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now maintains its class-usage index on every write.

  ONE registration on the wildcard, not one per collection. The set of collections is not known
  when a plugin is wired - the Schema Builder creates them at runtime, and a blocks field can be
  added to an existing one - so a list captured at registration would silently stop covering the
  collections that were added after it. The wildcard resolves when the hook executes and the
  filter is applied inside, against the collection's LIVE configuration.

  The cheap filter runs first. The hook fires for EVERY collection on EVERY save, and most
  declare no blocks field; the draft-split question below it reaches the component registry, so
  an untracked collection must not reach it. That ordering is what makes maintaining the index
  affordable at all.

  Whether a collection keeps a working draft is ASKED rather than assumed, through the published
  question. It cannot be read off `status`, which is true for collections that keep no draft -
  and every collection reaches this hook through the registry, which stores `versions` already
  resolved, including collections defined in config: the sync writes them through
  `resolveVersionsConfig`. Guessing it wrong files rows against a document that does not exist,
  or omits the classes only a draft applies.

  The plugin's own index table is skipped. Every row it inserts is a create on that collection,
  which fires this same hook - so without the guard the first maintained save recurses.

  A failure is RAISED, which is the supported way to report one from a side-effect phase. The
  hook registry already knows what `after*` means: it catches the throw, keeps the committed
  write, logs, runs the remaining handlers, and records a warning the REST and Direct API
  responses carry back. So the caller learns the safety index is stale and can act on it.
  Swallowing would bypass all of that - the operation would report plain success, and a stale
  index is exactly the state in which a class a page still renders reads as unused and can be
  deleted.

  Every subject is attempted before it raises, and the message says how many of how many failed.
  Reconciliation is per-subject and idempotent, so stopping at the first failure would leave the
  later subjects stale as well as the failed one.

  A write inside a CALLER-OWNED transaction is skipped. Core runs the after-hook before that
  transaction commits and binds its executor onto the hook context to say so; maintenance reaches
  the database through the pooled Direct API, which cannot join it - so on a small pool it can
  stall on the connection the transaction holds, and otherwise it reads a database that does not
  yet contain the write it was called for. Rows derived from that read record the document's
  previous classes, or none at all for a create, and report success. The rebuild is what repairs
  a subject a write bypassed.

  The plugin now installs this in its own `init`, so a host that installs the page builder gets
  the index table and the thing that maintains it together. A table with no maintenance records
  nothing while reporting success, which is the state in which every class on a site reads as
  unused.

  A SINGLE is skipped. Core namespaces a Single's hooks as `single:<slug>`, and a wildcard
  registration receives those too - including the page builder's own site-style Single, so every
  style save reached this handler and was looked up as a collection that does not exist. The
  index models Single subjects, but a plugin has no supported way to READ a Single's document:
  the one available path creates the row when it is absent, so reconciling Singles would
  materialise every Single in the app as a side effect of asking about them.

  Rows are derived under the limits the HOST configured rather than the engine defaults. A host
  that raises them is telling the renderer to draw more nodes, and an index derived under the
  defaults would leave the classes on those nodes unrecorded - so a class the page renders reads
  as unused.

  The index collection is resolved through the plugin's own identity rather than its declared
  slug. An integrator may rename it, and the schema then creates only the renamed collection: a
  hook holding the literal would write every row to a table that does not exist, and would not
  recognise its own writes, so the first maintained save would recurse.

  The store now OWNS its collection instead of being told at every call. Naming the slug per call
  meant four literals inside the maintenance module alone, each of which would have kept writing
  to the declared name on a renamed installation.

  Deletion is deliberately absent. Removing a document's rows is a different reconciliation -
  there is no document left to derive from - and it is built separately rather than bolted on
  here.

- [#1212](https://github.com/nextlyhq/nextly/pull/1212) [`6551bdb`](https://github.com/nextlyhq/nextly/commit/6551bdb26005392fc0a27c78c0df6aedbb955866) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now stores a reverse index of which documents reference which named classes.

  The classes UI has to answer "how many places is this used" before an author renames or
  deletes a class, and a class is referenced BY ID from inside each page's stored document.
  Answering that live means opening every page on the site every time the number is shown -
  and a page's blocks live in one JSON-shaped column across three dialects with no shared,
  portable containment query, so there is no cheap version of that scan.

  `nx_pb_class_usage` records one row per reference: a document that uses three classes
  contributes three rows. The question the library asks is "which documents use THIS class",
  so a row per pair answers it with an indexed lookup instead of a walk over every document.

  A single is addressed by its SLUG, with an empty entity key, because its row may not exist
  until somebody edits it - an unedited single still renders its declared defaults. The key is
  kept non-null rather than nullable, because a nullable member of a uniqueness constraint
  compares as unknown on most dialects.

  No composite constraint is created over those columns, and that is a limitation rather than
  a choice: a collection's declared `indexes` do not reach the schema pipeline, which derives
  a table's indexes from its FIELDS. Uniqueness is kept by reconciliation instead - a second
  row for a class already recorded is removed rather than counted - so a race between two
  writes to one document can both insert. The `classId` lookup is a field-level index, which
  the pipeline does build.

  The table is written by the plugin and closed to everything else. `internal` sets
  `admin.hidden` and nothing more - no API route, dispatcher or registry sync reads it - so
  the access rules are the only thing keeping these rows private, not a second layer behind
  a first.

  A document whose references cannot all be read contributes ONE marker row rather than a row
  per class it managed to read. Skipping the write preserves whatever rows a subject already
  had and preserves nothing when it has none - which is the state an oversized document is in
  the first time anything indexes it - so without the marker that subject looks exactly like
  one referencing nothing, and a class its unread part applies reads as unused.

  The marker's class id is LONGER than the engine's cap on a class id, which is what keeps it
  disjoint from every real reference. Not the empty string: `isUsableNamedClass` constrains an
  id by type and length only - no pattern and no minimum - so the empty string is a usable
  class id and a document can genuinely reference one. Length is the only lever that rule
  leaves, so anything building on this design must use the exported constant rather than
  inventing a sentinel.

  The table records no webhook events. An omitted `webhooks` option RECORDS - the registry
  reads `webhooks?.record !== false`, which `undefined` satisfies - so a site with an endpoint
  subscribed to `entry.*` would otherwise receive every row this table writes, carrying the
  full document, and access rules are not consulted for outbox delivery.

  This release adds the table and the logic that decides its contents. Nothing maintains it
  yet; the write path follows, and it owes reconciliation one guarantee this cannot give
  itself: the diff must be serialised with the document write it derives from, or re-derived
  from the row that won, because two writes diffing against the same stored rows can otherwise
  let the loser's removals delete rows the winning document still justifies.

- [#1221](https://github.com/nextlyhq/nextly/pull/1221) [`9a59c8c`](https://github.com/nextlyhq/nextly/commit/9a59c8cb339fe444227e32d968c74ac985370c10) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now rebuild a COLLECTION's class-usage rows from its documents.

  A collection with drafts holds TWO documents under one id, and they can apply different
  classes: a pure draft edit leaves the live row untouched, so the published page and the
  pending draft disagree until somebody publishes. The key therefore carries a `variant`
  alongside the locale, and a rebuild of one variant leaves the other's rows untouched.
  Counting both is deliberate - deleting a class an unpublished draft applies breaks that
  draft the moment it is published.

  The variant selects the DOCUMENT that is read as well as labelling the rows it files, and
  both dimensions are required on the store contract for the same reason: a store that cannot
  be told which one to read answers both passes identically, which records the published
  classes as the draft's and omits the ones only the draft applies. It is a closed set rather
  than free text, because a value outside it produces rows that no query built from a real
  subject can select - neither to reconcile nor to sweep.

  Two limits are worth stating, because "the index is recoverable" is wider than what this
  rebuilds. It repairs one collection's field at a time, so rows whose subject names a
  collection that no longer exists - or whose columns were corrupted by a restore or a
  direct write - are unreachable by every query it makes and survive a pass it reports as
  clean. Removing those needs the set of ALL live subjects, which is the caller's knowledge
  rather than this module's.

  Scoped to collections deliberately: the index models single subjects too, and a plugin has
  no supported way to read a Single's document - the one readable path creates the row when
  it is absent, so a sweep over Singles would materialise every Single in the app while
  appearing to work. Singles gain a rebuild when that reader does.

  The index is a CACHE of something derivable, and that is the only reason it is allowed to
  exist: the answer is always recoverable by walking the documents again. This is that walk.
  Documents written before the index existed have no rows at all; a write that bypassed
  maintenance leaves rows that disagree with the document; and maintenance runs after the
  document commits, so a failure there leaves the document saved and its rows stale. None of
  those is visible from the rows themselves.

  It walks ordered by `id` rather than by anything it can change. Offset paging reads position
  N of an ordered set, so ordering by a mutable key while writing during the walk reshuffles
  rows between queries and skips some - and `updatedAt`, the obvious ordering for a
  maintenance pass, is exactly the key each write moves.

  The existence check the sweep makes is asked in the SAME locale and variant as the rows it
  decides the fate of. A document's published and draft forms come and go independently -
  discarding a working draft leaves the published document untouched - so a check asking only
  whether some document has that id answers yes for a draft that is gone, and its rows survive
  every future pass. Nothing else could remove them, because the sweep is the only mechanism
  that can and it would be the one unable to see the difference.

  Rows whose document no longer exists are swept: a document deleted through a path that
  bypassed maintenance never appears in the walk, so its rows would otherwise survive a
  rebuild that reported success. The sweep runs only after the walk completes, since against a
  partial one it would delete the rows of every document not yet reached.

  The bounds a rebuild derives under are REQUIRED rather than optional, on every entry point a
  caller invokes. Omitting them is not neutral: the derivation falls back to the engine
  defaults while the host may have configured others, and the two directions fail in opposite
  ways - raised bounds record a document the renderer draws whole as an undetermined marker
  instead of its classes, and lowered bounds count classes on nodes the page never draws.
  Passing the engine defaults explicitly is still available and is now a decision rather than
  an omission - and the page-builder package now RE-EXPORTS `DEFAULT_LIMITS` and its
  `DocumentLimits` type, so a host running the defaults has a value to name. It could not
  reach the engine by name: that is a dependency of this package rather than of the app, and
  the two moves left without it were both wrong - take a direct dependency on the engine to
  obtain one constant, or copy the numbers and let them drift away from the bounds the
  renderer applies.

  It stops at the first failure. Swallowing one and continuing would report a completed
  rebuild that repaired nothing, which is the report that stops anyone looking. Stopping is
  affordable because reconciliation is idempotent: a rerun writes the same rows.

  `scanned` and `repaired` answer different questions, and `undetermined` is separate from
  both: a scanned document answered, and an undetermined one did not.

  Beneath it, maintenance brings one document's rows into agreement with it. Reconciling
  rather than replacing matters because the table is read constantly: between a delete and a
  re-insert the document appears to reference NOTHING, so a usage count read in that window
  reports zero and a safe-delete check performed in it gets the one answer that permits the
  deletion. Inserts are issued before removals for the same reason at a finer grain.

  A document that cannot be read whole contributes one marker row and nothing else, whose
  class id is longer than the engine's cap so it cannot collide with a real reference. The
  prefix it managed to read is discarded, because reconciling against a prefix removes the
  rows for every reference past the bound.

  A rebuild is not subject to the race the write path will have: reconciliation is sound only
  when its caller visits a subject once at a time, and a rebuild does so by construction. That
  property has to be arranged by whatever wires this into writes, and is recorded where the
  diff is computed.

- [#1271](https://github.com/nextlyhq/nextly/pull/1271) [`297f499`](https://github.com/nextlyhq/nextly/commit/297f499517a13d31651317b30b7869a454f061d8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now reads the document a class-usage subject names, in the lifecycle state and
  the language that subject is keyed by.

  Neither variant is read through a lifecycle filter, and that is the correction at the centre of
  this change. An explicit status is a CONJUNCTION: the list service constrains the main row and
  then hands the same value to the localized companion's own status, so a document has to be in
  that state twice over to be returned. Three real states satisfy neither side of it - a
  translation unpublished while the default stays published, the inverse, and a collection with
  status enabled whose draft split is ineligible and whose single row happens to be a draft - and
  each of those was indexed nowhere, so a class used only there passed the safe-delete check.

  Both subjects are read by id instead, which applies no lifecycle filter for a trusted caller,
  and they differ only in whether they opt into the working draft. A draft subject takes the
  sidecar overlay when there is one, identified by its marker, and records nothing when there is
  none - a document with no pending edits has no draft content to describe. The published subject
  takes whatever row exists, whatever state that row is in, which is where a document that has
  never been published gets indexed at all. Where no sidecar exists the two subjects therefore
  describe the same document, and the published one carries its classes. That over-counts against
  a draft that was never separately edited, and over-counting is the direction to fail in: it
  warns about a delete that was safe, where the filter permitted one that was not.

  A subject with a real locale asks with FALLBACK OFF. Fallback is on by default, so a language
  with no translation resolved the field from its fallback chain, and the resulting classes were
  filed under a translation that does not exist. Every subject derives from its own stored
  translation, or the per-locale model the reconciler and the rebuild share stops being true.

  A read that cannot be performed RAISES instead of answering empty. Errors are never suppressed,
  so a failing read hook - or a document a read hook narrowed away - comes back as an unsuccessful
  result rather than as nothing. This matters because absence is treated as a reason to leave a
  subject's rows alone: that protects the classes already indexed, but does nothing for a class
  the current save introduced, which would have no row to protect and would be indexed nowhere.
  A withheld document is now reported to the caller instead of counted as absent.

  An absent document leaves that subject's rows ALONE. Absence cannot be made definite through any
  read available to a plugin, so the asymmetry decides it - keeping a row that should have gone
  overcounts, so the UI warns, a deletion is refused, and the next rebuild corrects it; deleting
  one that should have stayed undercounts, so the class reads as unused, the safe-delete check
  permits it, and the pages that render it lose it. Only one of those is recoverable. Rows for a
  variant that has genuinely gone are removed by the rebuild's sweep, which walks the documents
  and can tell them apart.

  A document that does not identify itself as the subject's is refused, and its rows are left
  alone. Neither end of the read can be trusted on its own: a `beforeOperation` read hook may
  rewrite the queried id and the service builds its predicate from the rewritten one, so asking
  about a document is not the same as being answered about it; and `afterRead` replaces the
  document, so a collection may rewrite or drop the id for reasons unrelated to which row was
  read. A returned id that differs is therefore either a legitimate reshape or another document
  entirely, and nothing available to a plugin distinguishes them.

  The asymmetry decides it rather than a guess about which hook is likelier. Reconciling an
  unconfirmed document files ITS classes under this subject and removes the rows the real document
  earned, so a class that document still renders reads as unused and becomes deletable. Refusing
  costs a maintenance pass: the rows stay, the index over-counts, a delete is refused, the caller
  is told, and the next rebuild corrects it.

  The cost is worth naming plainly. A collection whose `afterRead` rewrites or strips the id
  cannot have its class usage maintained, and every save on it reports a maintenance failure. That
  is a loud, diagnosable refusal instead of a silent corruption.

  Deleting a document now removes the class-usage rows it owned.

  Until now the index only ever learned about writes. A deleted page's rows stayed behind and kept
  counting towards their classes, so a class that nothing rendered any more could never be deleted -
  the safe-delete check reported usage by a document nobody could open. The rebuild's sweep could
  reach some of those rows but only within one collection, field, locale and variant at a time.

  This is the one place in the write path where absence is definite. Everywhere else, whether a
  document is there has to be answered by reading, and a read cannot answer it: a list read applies
  beforeOperation and beforeRead regardless of access override, so a tenant scope or a soft-delete
  filter withholds a live row and the page comes back empty, indistinguishable from a document that
  is gone. That is why an absent document otherwise leaves its rows alone. Here nothing is inferred -
  the hook is the notification that the row was removed, and it runs after the delete committed.

  Removal is bound on the document and deliberately not on field, locale or variant. A delete removes
  the document in every language and both lifecycle states at once, so every subject it owned goes
  with it. It also does not consult the collection's configuration first: a blocks field REMOVED from
  a collection after its rows were written would make the collection look untracked, and every row
  that field ever owned would survive the delete with no document left to reconcile it against.

  A failure is raised rather than swallowed, for the same reason a failed save is. The deletion is
  already committed and cannot be rolled back, so the throw becomes a warning the caller receives -
  and rows that survive a deleted document name a document that no longer exists, so no later write
  will reconcile them.

  Deletes inside a caller-owned transaction are skipped, as writes are: the hook runs before that
  transaction commits and the pooled Direct API cannot join it. Singles and the index's own
  collection are skipped for the reasons they already were.

- [#1264](https://github.com/nextlyhq/nextly/pull/1264) [`aa275cd`](https://github.com/nextlyhq/nextly/commit/aa275cdd68ac2f04228fab7bbad105029472e0e4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now reach the database from inside a save, to maintain its class-usage
  index.

  The decisions - which subjects a save owes an update to, and how one subject's rows are
  reconciled - already existed and take their database access as an interface so they can be
  tested against values. This is the one place those interfaces become real calls, through the
  Direct API a hook is handed.

  Three mappings carry it, and each is a way the index gets filed against the WRONG document
  while every layer above reports success.

  The working draft is overlaid only for a DRAFT subject. The two variants are separate rows
  precisely because the two documents can differ; omitting the overlay for a draft subject
  records the published row's classes as the draft's, and passing it for a published subject
  does the reverse wherever a draft exists.

  A SHARED field asks with no locale rather than with the empty string. A shared field stores
  one value every language reads, and that value is what a read with no locale resolves to;
  asking for the `""` locale asks for a language nobody configured.

  Documents are read at depth 0. The rows derive from the stored blocks JSON, and populating
  relationships replaces ids with documents - changing the shape the derivation walks, while
  adding reads a save does not need. A missing document resolves to nothing rather than to an
  error, which is the right reading for an untranslated locale or a document with no pending
  draft.

  Index writes are made as the SYSTEM. The table's access rules deny everything and they are the
  only thing keeping these rows private - `internal` sets `admin.hidden` and nothing more - so a
  write that respected the acting user would fail for every user and the index would never be
  maintained.

  The index store passes the Direct API's list envelope straight through, because the reconciler
  asks for exactly what the API answers. Translating between them would restate one shape twice.

  The reader returns the document under the SUBJECT'S FIELD rather than the collection row it
  came in. The derivation walks a top-level `nodes` array, and a record has none - so handing
  back the row derives no rows at all and every class the document applies reads as unused,
  which is the state that licences deleting one a page still renders.

  A DRAFT subject is answered only when the row carries the working-draft marker. Asking for the
  draft overlay on a document with no pending draft returns the live published row rather than
  nothing, so accepting it files the published classes under a draft that does not exist -
  phantom references no rebuild can reconcile, which block deleting a class nothing uses.

- [#1251](https://github.com/nextlyhq/nextly/pull/1251) [`effece2`](https://github.com/nextlyhq/nextly/commit/effece22c5b82d389845f50378f83c2337532daa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now enumerate every class-usage subject one written document owns.

  A save has to bring the index into agreement with the document that was just written, and
  the unit the index is keyed by is not the document: it is the document CROSSED with a
  locale and a variant. One save therefore owes an update to several subjects at once, and
  which ones is a property of the collection rather than of the write.

  The variants come from whether the collection stores a working draft beside its published
  row. A collection without that split owns one variant, and asking it for a draft would
  reconcile rows against a document that does not exist - filing the published classes as a
  draft's, or deleting the rows of a draft the site never had. A collection with the split
  owns both, because a pure draft edit leaves the published row untouched and the two forms
  can apply different classes.

  The locales come from the FIELD rather than from the site. A localized field stores one
  value per locale, so it owns one subject per configured locale; a shared field stores a
  single value every locale reads, so it owns exactly one subject under the empty locale key
  that storage actually uses. Deriving both from the site's locale list instead would give a
  shared field one subject per language, and each pass would then delete the rows the pass
  before it had just written.

  A collection is enumerated for every blocks field it declares, because a subject is keyed
  by the field as well - two blocks fields on one document are two independent sets of rows,
  and reconciling one against the other's classes removes references the document still makes.

  This is enumeration only. Nothing calls it yet; the save hook that does follows.

- [#1255](https://github.com/nextlyhq/nextly/pull/1255) [`a47f423`](https://github.com/nextlyhq/nextly/commit/a47f42334438fce1a3f73f2eae40365cab04d941) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now bring a written document's whole class-usage record into agreement
  with it in one pass.

  Maintenance already reconciled ONE subject against ONE document. A save owes an update to
  several: the index is keyed by document CROSSED with a locale and a variant, and the hook that
  will drive this is not told which of those was written. `_status` is stripped from the payload
  before a hook sees it, and the write locale is known at the call site and never forwarded. So
  "reconcile what changed" is not expressible, and every subject the document owns is
  re-derived instead. That costs a read per subject on a save that touched one of them, and the
  alternative is leaving a stale subject behind - which is the state that makes a class a page
  still renders read as unused.

  A collection this index does not track costs nothing and reads nothing: no blocks field means
  no subject, so the walk does not run. The filter reads the configuration handed to it rather
  than a list captured when the plugin was wired, so a collection created afterwards is tracked.

  Nothing here throws. Collection `after*` hooks run once the write has COMMITTED, so raising
  would report a failed save for a document already on disk - the author is told their work was
  lost when it was not. Every failure is captured and reported instead, per subject. An index
  that disagrees with a document is recoverable by a rebuild; a false error is not recoverable
  at all.

  One subject's failure does not stop the others. Their rows are independent, so stopping would
  leave every later subject stale as well as the failed one, turning one recoverable
  disagreement into several - and reconciliation is idempotent, so a rerun repairs whatever a
  pass could not.

  A document that is ABSENT in one locale and variant is left alone rather than reconciled
  against nothing. Absence is ordinary: a collection with drafts holds a published row for a
  document with no pending draft, and a localized field has no value in a locale nobody has
  translated. Reconciling would delete that subject's rows. Removing rows for documents that
  are really gone belongs to the rebuild's sweep, which can tell those apart and this cannot.

  The document behind each subject is obtained through an injected reader rather than reached
  for here. The subject names a locale and a variant, and how those are addressed is a property
  of the runtime the caller is in - and it keeps this half testable against values.

- [#1228](https://github.com/nextlyhq/nextly/pull/1228) [`843b884`](https://github.com/nextlyhq/nextly/commit/843b8847294ab5291145db28892c1c29db1dae02) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A closed form now shows the message its author wrote.

  The forms collection has always offered a "Closed Form Message" box, and the Status field has always promised that closed forms display a message instead of accepting submissions. Nothing read it: every form that was not published was refused with one fixed sentence, and the public route hid closed forms as completely as forms that had never existed.

  A form that has been public now explains itself at its own address, and a submission to it returns the author's message. A draft is unchanged — it has never been public, so its address answers exactly as an unused one does and nothing about it confirms it exists. The public listing is unchanged too and still shows published forms only, so a closed form can be explained to someone holding its link without letting anyone discover form slugs by probing.

  Authors can write that message. The custom Edit view replaces the generic collection editor and rendered no control for the field, so until now the only value anyone could get was the schema default. A "Message for visitors" box now appears in the form's metadata card the moment its status is set to Closed — at the point the decision is made, which is when an author knows what it should say.

  "Closed" now has to mean the form was once live. It is accepted on creation and on a straight draft-to-closed edit, so on its own it did not establish that a form had ever been public — and the by-slug endpoint served those, handing the fields and configuration of an unreleased form to anyone who guessed its slug. Forms record when they first go live, and only a form that did answers with its message. One created closed, or never published, answers exactly as an unused address does. Forms already live when this ships are unaffected: the stamp qualifies "closed", and nothing else.

  All four public paths give the same answer. The by-slug endpoint, the submit endpoint, the Direct API and the plugin's own handler each decided this separately and disagreed — one filtered closed forms out and returned 404, one returned a fixed sentence, one returned the author's message — so what a visitor was told depended on which entry point their client happened to use. They now read one shared answer, and `closedMessage` is declared on the exported `FormDocument` type rather than reached through a cast.

  A form that was already live keeps working. Forms published before this shipped carry no record of when they went live, so the write that closes one is the only chance to make it — and that write says only `closed`, with the proof sitting on the stored side. Either side of the transition now counts. The stamp is also never inherited: duplicating an entry copies every field, and a copy of a closed form would otherwise arrive already qualifying as previously public at a slug nobody has seen.

  A submission to a closed form is answered as a state conflict carrying the author's message, rather than a validation failure whose canonical message reads "Validation failed." with the explanation nested inside it — which a client reading the documented error shape would receive and never show.

  A form nobody may know about answers with one sentence, whichever path is asked. The plugin's submission handler told a draft or a never-released form that it was "not currently accepting submissions" while telling a nonexistent slug "Form not found" — so the two remained distinguishable by probing, through the one path that had not been unified.

  A closed form answers with its message and nothing else. It was answering with the whole row — fields, settings, notifications — on the strength of a stamp that says the FORM was once public. That is not the same as saying THIS address was: a closed form can be given a new slug afterwards, and fields and settings can be added while it stays closed. A published form still returns its whole document, because a client cannot render one without it; a closed form renders a sentence, so the row was disclosure the feature never needed.

  The sentence a hidden form is answered with is one sentence. All four paths had been given one reading of WHICH forms answer as absent while each still formatted the answer itself, so a draft was "Form not found" through the Direct API and "Not found." over REST — and which a visitor saw still depended on their client. `NextlyError.notFound` takes a domain message now, the way `conflict` already did, and every path takes the text from one place.

- [#1151](https://github.com/nextlyhq/nextly/pull/1151) [`8fa89e1`](https://github.com/nextlyhq/nextly/commit/8fa89e1689662304f8ad8022e1b01734eec286d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Colour code in the admin from the theme's own palette instead of CodeMirror's
  bundled one. API Playground responses, generated snippets, request bodies, code
  fields and email templates all read `--nx-code-*`, so they follow a retheme,
  match the rich-text editor's code blocks, and come under the contrast audit
  that already covers those tokens. One style now serves both modes, because the
  tokens are redeclared under `.dark` — light and dark no longer drift apart.

  Code also renders in the admin's own mono face rather than a hardcoded stack,
  and a bracket under the caret keeps its highlight instead of losing its colour.

- [#1085](https://github.com/nextlyhq/nextly/pull/1085) [`59c702f`](https://github.com/nextlyhq/nextly/commit/59c702fdba7526ec6d7fc1e6002404e413c56452) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A code field is now announced by its label. It renders an editor built from
  several elements with no single control to attach the label to, so the label
  resolved to nothing and a screen reader reached an unnamed region. It is exposed
  as a named group instead, matching how rich text, relationship and upload fields
  are already handled.

- [#1326](https://github.com/nextlyhq/nextly/pull/1326) [`081d7b0`](https://github.com/nextlyhq/nextly/commit/081d7b04cc59fff6adb75de4388961b9024d8a57) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the content language when choosing another version to compare, so the
  comparison stays named in the language of the versions it is showing.

- [#1039](https://github.com/nextlyhq/nextly/pull/1039) [`03a47b3`](https://github.com/nextlyhq/nextly/commit/03a47b303bc0523918357c3256cc585aafdb6b58) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An email provider whose parser returns a value JSON can only carry as text now has it stored in that form, instead of the save being refused.

  The stored configuration is defined as its serialisation, so a `Date` becoming an ISO string is a coercion and is accepted. A parser returning a value that would LOSE data is still refused, and the message now names the field that would be lost rather than describing the rule in the abstract: a key JSON drops, an array's named properties, or a `Map` or `Set` whose entries serialisation cannot see at all.

  A parser that returns a different value each time it reads the same input is still refused, because stored credentials would not survive a read. That comparison is now structural, so a parser that rebuilds its output field by field is no longer refused for changing the order of its own fields.

- [#1278](https://github.com/nextlyhq/nextly/pull/1278) [`bb9f0fd`](https://github.com/nextlyhq/nextly/commit/bb9f0fda9fdfab712381ab432da03fb0b692ab40) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Editing an entry or a single now uses the width a document needs, instead of
  the narrower column meant for a settings form.

  The editor shared one reading width with pages like Settings. That width suits a
  short list of labelled controls, but an entry is a document: its fields include
  rich text, media and repeated groups, and the document panel on the right was
  taking its share out of the same column. On a large screen the field you type
  into ended up under half the width of the area around it, the editor toolbar
  wrapped onto a third row, and the buttons in the header dropped their labels to
  show as icons alone.

  Entries and singles now use the wider of the two measures, in every state the
  page can be in — while it is loading, when it cannot load, and once it has
  loaded. A page that changed width as its content arrived would move every field
  sideways at the moment the data appeared.

  Settings pages are unchanged. The narrower width is right for them, and that is
  the point: which width a page takes now follows from what the page holds.

- [#1110](https://github.com/nextlyhq/nextly/pull/1110) [`5089c60`](https://github.com/nextlyhq/nextly/commit/5089c60843af94b0726036ce4dacfb3f95a4f998) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the storage and the read rule for scheduled content releases: two core tables, a repository, and the pure rule that decides what a release says a document looks like now. Nothing reads them yet. Also removes the reserved `versions.drafts.schedulePublish` option and the unused `scheduled` version status, which were parsed and never read.

- [#1054](https://github.com/nextlyhq/nextly/pull/1054) [`85824d9`](https://github.com/nextlyhq/nextly/commit/85824d957f685b31565fddb354e5134b2e4f22de) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop dropping plugin-contributed field types from every save. A field declared with `pluginField()` — the page builder's blocks field, and any type a plugin adds — was stripped from the request body by the form's validation schema, so edits to it were silently discarded in both the entry and single editors.

- [#1245](https://github.com/nextlyhq/nextly/pull/1245) [`d34e7f9`](https://github.com/nextlyhq/nextly/commit/d34e7f966fa088a033f8cf31150d7a48511c0238) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Each style control can now say which breakpoint its value came from, and act on
  it: a value set at the tier you are editing offers to reset, and a value
  arriving from another tier offers to go there.

  Only controls that have earned an action get one. An unset control offers
  nothing, so a panel does not fill with buttons for values nobody has touched.

  Reset names what it will reveal rather than only that it clears — in a
  desktop-first cascade a value usually falls back to a wider tier, and not
  always to the base one.

  Going to a tier sizes the canvas to it. There is no second setting for which
  breakpoint you are editing, so the canvas and the inspector cannot disagree.

- [#1129](https://github.com/nextlyhq/nextly/pull/1129) [`522d7d6`](https://github.com/nextlyhq/nextly/commit/522d7d664850964948613477994f447ac4641a2c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two reads in the page builder's control derivation are corrected. A composite's
  nested field is read by OWN key, as the engine reads style maps everywhere else,
  so a field reached through a prototype no longer decides which control is drawn
  and an inherited accessor no longer runs during a read taken only to draw a
  panel. And an empty record stays on the composite arm: the validator accepts
  `{}` there, so requiring at least one named field sent a stored
  `borderRadius: {}` to the scalar variant and drew a single length control for a
  value the document holds in the four-corner form.

- [#1188](https://github.com/nextlyhq/nextly/pull/1188) [`a6e61d6`](https://github.com/nextlyhq/nextly/commit/a6e61d6ec793d502689d57ce2de6411e3593ffae) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Measure the admin's core form pages.

  The entry editor, the create page and the user forms rendered at whatever width
  the panel gave them. Measured on the post editor at a 1440px viewport, the form
  was 1048px wide, so a Meta Title input ran nearly a metre. They now take the
  same reading measure the settings pages do.

  The frame an entry page renders in is decided in one place, which the default
  form now shares with the custom-view branches. A takeover field asks for the
  whole window from INSIDE that form, and a page that declared a measure without
  honouring the request would have handed the page builder a 56rem column.

- [#1279](https://github.com/nextlyhq/nextly/pull/1279) [`4ae7624`](https://github.com/nextlyhq/nextly/commit/4ae7624c35d27d0464ecdf0f332925121b0fdb96) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add inline rich text on the page-builder canvas: a `core/rich-text` block, and one shared editor an author types into directly on the page.

  A passage with bold, links, lists and headings inside it is now one block rather than one block per fragment. Double-clicking it opens a rich-text editor in place; double-clicking a plain value still opens the plain one, decided from the block's own prop declaration so the two surfaces cannot disagree about which values are theirs.

  The stored shape, the format bits and the walk that draws them already existed and are reused rather than reimplemented, so a passage renders the same on a page as it serializes in the CMS.

  The editor is loaded on first edit rather than on mount, because its node classes carry a 630KB chunk an author who never edits a passage should never fetch. It is reached through `@nextlyhq/plugin-sdk/admin`, which now hands over the operations to edit one passage rather than the editor itself: a consumer that built its own would have to import Lexical, and a second copy of Lexical makes its node classes unrecognisable, with content saving and reading back as plain text.

  An edit no longer opens against part of the page that has since been replaced: if the canvas re-renders while the editor is still loading, the passage is left alone rather than handed to an element nobody is looking at.

  The save shortcut is matched exactly rather than approximately, so pressing Ctrl+Shift+S — the browser's Save As on several platforms — no longer closes an open passage and changes the field for a keystroke the form does not treat as save.

  A page description no longer runs a button's label into the words after it: a passage reading "Before", a button, then "After" described the page as "Before Buy nowAfter", because the walk that flattens rich text to plain treated any node carrying its own text as inline. Block-like nodes now end a line, whether or not they hold their text directly.

  An author who double-clicks a passage while another one is holding unsaved text is now told why nothing opened, rather than finding the gesture silently do nothing.

  Two canvases open at once no longer take an unsaved passage from one another. There is one editor behind every surface, so a passage kept open because its words could not be written is now held at that editor rather than only by the surface holding it, and anything asking for the editor is refused until it is released.

  An element is also given back with the `autocapitalize` it arrived with, which the editor sets on focus and clears on release.

  A passage keeps the order the author wrote it in. Words after an image inside a heading or a disclosure label used to be gathered back in front of it, so a heading reading "Before[image]After" rendered as one heading saying "BeforeAfter" with the image behind text that had followed it.

  The editor also opens the passage as it stands when the editor arrives rather than as it stood when the edit was requested, so an undo or another surface landing while the editor loads no longer puts the caret into content nobody can see and refuses the first thing typed into it.

  An inline edit that cannot be written no longer disappears, however the author left it — clicking away ends far more edits than the exit button does, and that path said nothing at all.

  An inline edit that cannot be written no longer disappears. A passage the page changed underneath, or one the page refuses to store, keeps its editor open with the author's words still in it, and leaving the editor is declined until they have dealt with it rather than closing over the top of them; a passage whose block was deleted or locked while they typed says so instead of vanishing quietly.

  A rich value is also now refused by the canvas plain-text editor. It declares itself editable in place like any other inline prop, but that path reads a value as text and writes a string back, so before this an author who double-clicked a passage would have found an empty element and committed an empty string over their work on the way out.

- [#1160](https://github.com/nextlyhq/nextly/pull/1160) [`1f7187b`](https://github.com/nextlyhq/nextly/commit/1f7187b3020b3e791aaa8a11ea23ae6c42cff4d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Declare `--nx-shell-measure` in the theme.

  The page shell read the token but nothing declared it, so it resolved to a
  `var()` fallback written at its one call site — meaning a theme retuning the
  form measure moved every surface around the page content and left the content
  column where it was. Declaring it restores that reach and lets the grid template
  read the token directly.

- [#1056](https://github.com/nextlyhq/nextly/pull/1056) [`ff9ba6c`](https://github.com/nextlyhq/nextly/commit/ff9ba6c89ed87f936302389589f98b57e90d8653) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a core table gain an indexed column when upgrading an existing database.

  The additive-tables-only recovery pass is diffed from an empty snapshot, so it
  emits every index in the desired schema while never emitting the column
  additions those indexes depend on. Creating an index over a column the live
  table has not gained yet failed, and because that is not an idempotency error
  it stopped the reconcile before the pass that adds the column could run.

- [#1177](https://github.com/nextlyhq/nextly/pull/1177) [`7b0b099`](https://github.com/nextlyhq/nextly/commit/7b0b0991d6403e0dddc2e74644deb5bafee3f567) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field a caller may not read can no longer be used to filter

  Field-level read rules redact values from rows that have already been selected,
  so they were powerless against a `where`: the row set itself varied with the
  hidden value. A caller could ask `equals` for each candidate and read the answer
  off which query returned the row -- the value never rendered, and fully
  recoverable.

  Demonstrated against a real database before being fixed: with a `codename` field
  denied to the reader, filtering on it returned different rows per term while the
  column was correctly absent from every response.

  A filter naming a field that carries a read rule is now refused, and says which
  field. Conservative on purpose -- a read rule is a function of the row, and at
  query time there is no row to judge, so a field that CAN deny is treated as one
  that does. Fields with no read rule are unaffected, as are callers passing
  `overrideAccess`, which have already decided who is asking.

- [#1183](https://github.com/nextlyhq/nextly/pull/1183) [`4490e3b`](https://github.com/nextlyhq/nextly/commit/4490e3b1a34a5ae8f0a36beafae1b0171e30351b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Sorting and searching can no longer read a field the caller cannot

  The guard that stopped a `where` naming a read-protected field left three
  neighbouring paths open, each reaching the same value by a different route.

  Sorting by a protected field ordered rows by a column the caller could not see,
  and order is a comparison: a caller able to create rows with chosen anchors can
  bisect a neighbour's value from where it lands between them. Refused now.

  Searching matched protected columns, because text fields are auto-detected as
  searchable and the search predicate never consulted field access. Search is
  NARROWED rather than refused: the caller named no column, so dropping the ones
  they may not read answers exactly what they asked.

  A group or repeater carrying no rule of its own but holding a protected child
  was filterable as a whole. These are stored as JSON, and as TEXT on SQLite, so
  `contains` against the serialised container probed the child without naming it.
  The guard now judges a container by anything nested inside it.

  One correction in the other direction: the filter guard judged the predicate
  AFTER hooks had settled it, so a `beforeRead` hook narrowing a read by a
  protected column -- a tenant scope is the ordinary case -- had the whole read
  rejected. It now judges what the CALLER sent. Trusted server code narrowing a
  read is what those hooks are for.

  Framework lookups say so explicitly. Content routing addresses a page by its
  slug, and a site may protect that field; without a way to declare the filter as
  the framework's own, an enforced route would 404 every page. The declaration is
  per-operation and cannot be inherited, since a config-level exemption would let
  a caller's filter acquire it through a nested read.

- [#1214](https://github.com/nextlyhq/nextly/pull/1214) [`4d29175`](https://github.com/nextlyhq/nextly/commit/4d291755cc6ca5eef20ea6a01f1a988e63aa0db0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Digest a preview container seed whose reduction to identifier-safe characters
  would lose information, rather than carrying the reduced form.

  The reduction is many-to-one, so two short seeds differing only in collapsed
  characters received one container name — the collision the per-surface factory
  exists to prevent, and an authored container spelled with that name would
  capture the responsive queries of every surface colliding there. Only seeds long
  enough to exceed the emitted-name bound were digested, so the guarantee held
  above the length threshold and not below it.

- [#1324](https://github.com/nextlyhq/nextly/pull/1324) [`c76df0b`](https://github.com/nextlyhq/nextly/commit/c76df0b2adcaa3c29296598549d3c017e7e0c191) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating a class while the selection moves to another block no longer writes
  one block's classes through the other's. The class is created and simply not
  applied: putting it on a block the author never asked about is worse than not
  applying it at all.

  A refusal that no longer describes the selected block is now cleared rather
  than hidden, so a class list the block held before cannot bring the message
  back.

- [#1060](https://github.com/nextlyhq/nextly/pull/1060) [`4a05a64`](https://github.com/nextlyhq/nextly/commit/4a05a64eb0743f7696f9c9f3205d211d46bb1ca8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a contributed field know which document it is being edited inside. `useDocumentIdentity()` reports the collection entry or Single around a field, and the Single editor now supplies that context where only the entry editor did before — so a plugin field can address the document it belongs to instead of only the value it was bound to.

- [#1062](https://github.com/nextlyhq/nextly/pull/1062) [`4d736db`](https://github.com/nextlyhq/nextly/commit/4d736db3f39ede87dea9953efdf5d4c6578e7dba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold a status-less edit on every collection write path.

  Editing a published document on a drafts-enabled collection stores the change
  and leaves the live row alone. That was true only of the interactive path: the
  same edit made through the transaction API or a bulk update went straight to
  the live row, so it reached the public site without anyone publishing it.

- [#1096](https://github.com/nextlyhq/nextly/pull/1096) [`7d29da8`](https://github.com/nextlyhq/nextly/commit/7d29da8bb19c36b61da4fc940716df400fbed556) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report why a collection or Single does not get pending changes, instead of the feature being silently absent. The schema response now carries `draftsDisabledReason` when the configuration asked for the draft split and a rule refused it, and a component that cannot be resolved is named once in a server warning. Adds `useDocumentLocale` to the plugin SDK, so a field inside a localized document can read which language its value belongs to.

- [#1277](https://github.com/nextlyhq/nextly/pull/1277) [`9ee1842`](https://github.com/nextlyhq/nextly/commit/9ee1842cce461ddd347aa58240907e9083791ef5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A date field on a single (a settings page, a homepage — any one-off document)
  now comes back the same way whether you are looking at the published version or
  at unpublished changes.

  Before, the published version handed your code a real date and the unpublished
  one handed it a piece of text that merely looked like a date. Anything that then
  asked the date a question — what year is this, is it before that — worked on the
  published document and failed on the one with pending edits. The failure only
  appeared once someone had unsaved changes, which is exactly when it is hardest
  to connect to a cause.

  The shaping that produces an unpublished document now restores date values the
  same way an ordinary read does, so both come back in the same form.

  System timestamps such as "last updated" are deliberately left as they were.
  Singles and collections genuinely present those differently, and making them
  uniform here would have fixed one and broken the other — so which behaviour
  applies is now stated explicitly by each caller rather than assumed.

- [#1302](https://github.com/nextlyhq/nextly/pull/1302) [`0e5decc`](https://github.com/nextlyhq/nextly/commit/0e5decccfac518019671831278a14dccf85d578e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make dragging a block in the page editor smoother. Every pointer move measured the canvas twice for one pointer position — once to place it among the blocks and once for the threshold that decides when a rival drop target takes over — and each measurement forces the browser to lay the page out there and then. Both answers now come from a single measurement, so a drag has less work to finish between one frame and the next.

- [#1032](https://github.com/nextlyhq/nextly/pull/1032) [`90fe49b`](https://github.com/nextlyhq/nextly/commit/90fe49b39011389d1d788fbce6703d46a7be3605) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Installing the page builder plugin no longer pulls in @dnd-kit/dom and @dnd-kit/react. Neither was imported by any code; they were left behind when the canvas drag shipped on its own implementation.

- [#1020](https://github.com/nextlyhq/nextly/pull/1020) [`47f23f0`](https://github.com/nextlyhq/nextly/commit/47f23f029c7662eab9862a44a0e60c34c16b440b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block can be duplicated in the page builder with Cmd/Ctrl+D. The copy lands immediately after the
  original, in the same container, and becomes the selected block so the next edit goes to the copy
  rather than to the block it came from. A named block's copy is suffixed, so two of them can be told
  apart in the layers panel. The whole block is copied, including everything inside a container, and
  one undo removes it.

- [#1027](https://github.com/nextlyhq/nextly/pull/1027) [`165fe0f`](https://github.com/nextlyhq/nextly/commit/165fe0f8507dc1ca1da247ef5ce0fc6a0fe1bf0a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The content language an editor is open in now lives in the URL.

  `?locale=de` makes the language linkable, survives a reload, and comes back with
  the browser's back button. An unconfigured value falls back to the default
  rather than being sent to the API.

  It also stops a language switch from silently discarding unsaved work. Switching
  refetches the document, so the edits go — and as component state that happened
  with nothing able to ask first. As a URL it is a navigation, which the
  unsaved-changes guard already understands, so it asks. The guard now compares
  the query as well as the path, because here the query is part of where you are
  rather than decoration on it.

  A language mark in the entry list opens that row in that language, which is the
  same act as being sent a link to it.

- [#1257](https://github.com/nextlyhq/nextly/pull/1257) [`d2fdb05`](https://github.com/nextlyhq/nextly/commit/d2fdb05652a264c47072f84b7680d034bae898ee) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Empty containers on the page-builder canvas now show as a dashed box you can
  click, instead of being invisible. A canvas setting turns the boxes off when
  you want to see the page as a visitor will.

- [#1180](https://github.com/nextlyhq/nextly/pull/1180) [`6959a28`](https://github.com/nextlyhq/nextly/commit/6959a2889cf2cca98c011165997ebc377595cfdf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Lets an author remove a CSS id that is present but empty.

  The renderer treats the modelled field as present whenever it is a string, so a
  stored empty id renders `id=""` and hides any `id` set in the attributes beside
  it. The inspector collapsed that state into an absent field, so the box looked
  empty, every attempt to clear it read as no change, and the id could never be
  removed — a state only an import or a script can create, and then not undo.

  The three states the document distinguishes now survive being read, and removing
  an empty id is an explicit action that appears only in that state and says
  whether it is about to reveal an id the attributes were holding. Cleaning it up
  on sight, or folding it into an unrelated save, would change the anchor a page
  renders without the author asking.

- [#1190](https://github.com/nextlyhq/nextly/pull/1190) [`f354cff`](https://github.com/nextlyhq/nextly/commit/f354cffe275b3c3e02d73aadb82596014946a653) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a slot whose stored name is `__proto__`, and stop refusing to edit a document that cannot be serialized.

  Rebuilding a record under keys that came from stored data lost any entry named `__proto__`: plain assignment invokes the legacy prototype setter rather than creating a property, so the slot vanished from `Object.keys` and from the stored JSON, and the record's prototype was silently replaced. `removeNode` and `migrateDocument` both hit this, which means deleting one node — or migrating an unrelated one — could delete stored content elsewhere in the same document. `insertNode` had it in both directions, since reading `slots["__proto__"]` returns `Object.prototype` rather than `undefined`.

  Separately, the tree primitives now agree on what to do with a document that `JSON.stringify` refuses. They transform what they can reach and never refuse work because the document they were given was already damaged; whether the result can be saved is decided once, at the write, by the check that already answers it. Previously `duplicateNode` alone refused outright when any part of the forest was cyclic, so a corrupt block anywhere on a page stopped an author copying a healthy one.

- [#1179](https://github.com/nextlyhq/nextly/pull/1179) [`8eaba1f`](https://github.com/nextlyhq/nextly/commit/8eaba1f3e5752016d6cdfeb95e3bb3fb87d5a3b3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The engine's tree primitives terminate on a document whose slots form a cycle.

  Such a document reaches these functions the same way every other malformed
  shape does: a stored forest is not required to have been validated, and an
  in-process producer can build one directly. `countNodes`, `findNode` asked for
  an absent id, `updateNode`, `duplicateNode` and `reidSubtree` exited with
  `RangeError: Maximum call stack size exceeded`, and `treeDepth` did not throw
  at all — it SPUN, holding a caller open rather than failing, which is the
  version nobody attributes correctly.

  Each now carries the ancestors its current position was reached through, so a
  node reached through itself is not descended into again. That is deliberately
  narrower than skipping every node already seen: one node object placed in two
  different slots is two elements of the document and is still counted, measured
  and rebuilt twice, exactly as before. Behaviour on every acyclic document is
  unchanged.

  An immutable rebuild cannot reproduce a cycle, since the result would have to
  contain itself. `updateNode` and `reidSubtree` therefore drop the edge that
  closes it and return a finite forest rather than failing the operation.

  `duplicateNode` REFUSES instead, returning the forest unchanged, and the
  difference is deliberate. It adds a node rather than transforming one, so the
  original stays in the result — a copy taken from a forest that cannot be
  serialized still cannot be serialized, whatever is done to the clone. Reporting
  success there would hand back a document that cannot be stored.

- [#1284](https://github.com/nextlyhq/nextly/pull/1284) [`180e6ed`](https://github.com/nextlyhq/nextly/commit/180e6ed0660baafbf5f6d36c69d0ed36c2c6715c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Editing an entry now gives the fields the room the document panel was taking.

  The panel on the right sat inside the same column as the fields, so its width
  came out of theirs. On a 1680px screen the widest field an author could type
  into was about 800px of a 1352px area, with the panel accounting for most of
  the difference.

  The page now takes the full width and the FIELDS carry the reading width
  instead, with the panel beside them rather than inside them. The same screen
  now gives 968px to the fields; a wider display caps them at a comfortable
  reading width and leaves the rest as margin, so lines never grow unreadably
  long. Creating an entry is unchanged, because it has no panel to reclaim
  space from.

  Pages that have no panel are untouched, including any edit screen supplied by
  a plugin: a page takes the full width only when its own content says it will
  bound itself, so nothing is widened that has nothing to gain from it.

  Also removes an unused placeholder component from the admin that rendered a
  stray product name and was referenced nowhere.

- [#1044](https://github.com/nextlyhq/nextly/pull/1044) [`4caf451`](https://github.com/nextlyhq/nextly/commit/4caf4511abd556564a92fc91a92493a23aebe9e1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Breaking for existing projects:** `esbuild` is now an optional peer dependency. Run `npm install --save-dev esbuild` in your project. Newly scaffolded projects already declare it.

  It was a hard dependency of `nextly`, so every install downloaded roughly 9.6 MB for tooling that exists to compile `nextly.config.ts`. Nothing that serves a request needs it. Three things do: development, where the dev server re-reads the config; the `nextly` CLI; and production only when `db.runMigrationsOnBoot` is switched on, which is opt-in and off by default. A production deployment installing without dev dependencies no longer downloads it at all.

  When it is missing, reading the config now names the package, the exact command, and what needs it, instead of failing with a module-not-found from three different call paths.

  With this, `nextly` carries 20 runtime dependencies. `nodemailer`, `sharp` and `esbuild` have all moved to optional peers, which together removes roughly 28 MB per platform from an install that uses none of them.

- [#1049](https://github.com/nextlyhq/nextly/pull/1049) [`ef46199`](https://github.com/nextlyhq/nextly/commit/ef4619964114f674c76ae068ddf6bfb42263a735) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A read that legitimately answers "this does not exist" no longer arrives as `undefined` in the admin. The shared HTTP client treated a `null` JSON document as an absent body, so an endpoint answering `200 application/json` with `null` — which is what asking for an autosave recovery point does when the author has none — came back with nothing, and React Query rejected it with "Query data cannot be undefined" on every entry and single editor load. The client now returns the `null` the server sent, and tells it apart from a body that could not be parsed, which had been indistinguishable because both were caught to the same value.

- [#1073](https://github.com/nextlyhq/nextly/pull/1073) [`09e56d3`](https://github.com/nextlyhq/nextly/commit/09e56d3eb7bca439da56bf6da97c15e87540d2e1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The save shortcut works inside the page builder, and leaving with unsaved
  block edits now warns.

  A field that keeps its own editing state can tell the form so with
  `useReportUnsavedWork`. It reports one boolean about itself; it cannot save or
  publish.

- [#1169](https://github.com/nextlyhq/nextly/pull/1169) [`cfdbf30`](https://github.com/nextlyhq/nextly/commit/cfdbf30d405ad9dd395665bbca10c7ba6c9a4209) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Entry-form validation wrote its repeater row-count rule once per field type, and the copies had
  already drifted apart in wording: under-filling a repeating number field said "Minimum 3 values
  required" while every other list field said "Minimum 3 items required". The repeater row-count,
  string length, and numeric range rules now each have one implementation that every field type
  shares, with the field's own noun naming what was counted. A repeating number field now words
  its row bounds like every other list field — "Minimum 3 items required" — the one user-visible
  string this changes. What any field accepts or rejects is unchanged.

- [#1103](https://github.com/nextlyhq/nextly/pull/1103) [`748e45c`](https://github.com/nextlyhq/nextly/commit/748e45c41f6414b5b8a1190de64b2619b6509246) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Renaming a float number field on PostgreSQL now keeps the column's contents. Such a column is reported by introspection as `float8`, a spelling the rename detector did not recognise, so it judged the column incompatible with itself and offered only to drop it and recreate it empty. Decimal fields were never affected: they introspect as `numeric`, which the detector already recognised.

- [#1186](https://github.com/nextlyhq/nextly/pull/1186) [`f8c6456`](https://github.com/nextlyhq/nextly/commit/f8c6456e2ba5bc21836e264147e5eb115d176098) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the form builder's identity fields a surface.

  Form Name, Slug and Status sat on the bare page with nothing holding them
  together, and their controls were transparent, so they read as outlines rather
  than as inputs. They are now one card.

  The builder canvas below stays unframed: it draws its own dashed drop zone, and
  a card around it is a box inside a box. The tab rail sits on the page between
  them, because it switches what is below it rather than belonging to the fields
  above it.

- [#1215](https://github.com/nextlyhq/nextly/pull/1215) [`2cea567`](https://github.com/nextlyhq/nextly/commit/2cea5676fd6047cfdc17280194e501c10e961594) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form redirect targets: list them by the field each collection configures, project the read, mark what is not published, and refuse only the pairing that would send a visitor to a missing page.

  The picker listed target documents by a fixed set of fields, so a collection that names its documents through `admin.useAsTitle` — `headline`, say — showed opaque ids and an author could save a redirect to the wrong page. It now reads each collection's configured title field. The same request sent its field projection in a form the API discards, so every scalar and JSON field of up to fifty documents came back per collection; for page-builder targets that is the whole block tree. The projection is now encoded in the form the API accepts.

  Unpublished pages stay in the picker on purpose — a form is usually configured beside the page it points at — but they are now marked, and saving is refused only when a form that accepts submissions points at a page that has never been published. A draft form pointing at a draft page saves normally, since the two go live together. The rule is judged on the state a write leaves behind, so it also catches publishing a form over such a target in a later save, and it covers both settings that can name a page rather than only the picker's own.

  A collection that publishes per locale is left alone: a page whose translation is public still reads as a draft on its main row, so neither the marker nor the refusal treats it as unpublished.

- [#1202](https://github.com/nextlyhq/nextly/pull/1202) [`a17d7b9`](https://github.com/nextlyhq/nextly/commit/a17d7b9c5e794838a6770ec3a3d6cce72bc08623) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A form can redirect to a page an author picks, and the page is resolved to a real URL at submit time.

- [#1161](https://github.com/nextlyhq/nextly/pull/1161) [`e84a451`](https://github.com/nextlyhq/nextly/commit/e84a451a89c5a8ad7d56c38027ce317defc2295d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give a form section its own vertical rhythm.

  A settings section padded its fields horizontally and left the vertical spacing
  to each row, and the two shipped row idioms disagreed: one supplied it and one
  did not. A section built from the second rendered its first field hard against
  the top border of its card and its last against the bottom. The section now
  applies a single `--nx-field-gap` token to every direct child, so the card edge
  padding and the gap between two fields are one decision that cannot drift apart.

- [#1193](https://github.com/nextlyhq/nextly/pull/1193) [`792cabc`](https://github.com/nextlyhq/nextly/commit/792cabc141b0d04038650bb855e47f0dd4e49265) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Edit a form's notifications on the page, not in a panel over it.

  The editor was a 560px sheet that slid over the form and carried its own
  "Save changes" beside the page's own commit, with nothing saying which one
  persisted. It also dimmed the page it slid over, so the one thing a panel is
  for — keeping the page in view — was not delivered.

  Each notification is now a row that expands in place. Edits reach the form as
  they are typed, so the page's action bar is the only commit, and address
  validation moved from a save press to leaving the field. One row opens at a
  time, so the list keeps the overview its summaries exist to give.

- [#1220](https://github.com/nextlyhq/nextly/pull/1220) [`0e5f971`](https://github.com/nextlyhq/nextly/commit/0e5f97117f4bdecc8adec6423b28d727f30e33bd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form editor: give every tab a surface, and balance the metadata card.

  The Settings, Preview and Notifications tabs drew no background of their own, so their content sat directly on the page's grey while the metadata card above them was white — the panels read as holes in the page rather than as sheets on it. Each tab now sits on the same white card the rest of the admin uses for form content, and the Settings tab gets there by adopting the shared `FormSection` instead of a heading it had rolled itself, so its sections look like every other settings page in the product.

  The metadata card's padding was even at 20px top and bottom, but the first thing inside it is a label and the last is a control: a label's line box carries leading above its glyphs, so the visible gap measured 24px above and 21px below. The bottom step is now one larger, which makes the two read as equal.

- [#1204](https://github.com/nextlyhq/nextly/pull/1204) [`b0f6033`](https://github.com/nextlyhq/nextly/commit/b0f6033b340ed98632043bbba75018af8e1152c3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two corrections to the builder's op layer.

  The style inspector still refuses a multi-selection — it says how many blocks
  are selected and asks for one — so nothing an author can do changes here.

  A group of ops whose members cancel out no longer records a history entry. Each
  op changed something, the document ended where it began, and an entry recording
  that would undo to no visible effect, which is the refusal a single op already
  gets. A group reaches it by a route a single op cannot take: grow a value, then
  restore it.

  Applying a group is one call rather than a fold at the call site, so what a
  group MEANS — its atomicity, its inverses in undo order, and answering with no
  inverses when it changed nothing on balance — lives in one place. A group of one
  is the single op call and nothing more.

  The caps are unchanged. Every op in a group is still judged against the document
  as it stands when that op runs, which is what keeps an accepted edit undoable:
  a group allowed to exceed the cap in passing can hand back an inverse the cap
  then refuses, and undo pops its entry before replaying it.

- [#1146](https://github.com/nextlyhq/nextly/pull/1146) [`6bf770f`](https://github.com/nextlyhq/nextly/commit/6bf770fbdbc9bc6441f1b7efc834dcbba313739e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the Style tab alive when a stored document holds a malformed style tier.
  A node holding `styles: { base: null }` reaches the editor — the field's guard
  admits any value whose `nodes` is an array, deliberately — and every read of a
  tier then threw during render, taking the whole tab down. Guarded at
  `valuesAt`, which is the one place reading, writing and clearing a value all
  pass through, and at the contrast scan that walks every address.

- [#1050](https://github.com/nextlyhq/nextly/pull/1050) [`ce3ba3a`](https://github.com/nextlyhq/nextly/commit/ce3ba3a1f3a11a95ee14cbdbcbd3309c78f6de1a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The ink-contrast scan now reads the first-party plugins and the builder, not only the admin and the kit. Those three packages paint admin chrome with the same ink utilities and carried 230 of them, measured by nothing — so a token that is unreadable on a surface it lands on could ship there while the same mistake in the admin failed CI.

  It found one: the conditional-logic notice drew its text with the base warning token, which measures 4.37:1 once its own 10% fill composites over the page container, short of the 4.5:1 text needs. It now uses the 600 shade, which holds 5.13:1 at its worst surface in either mode.

- [#1299](https://github.com/nextlyhq/nextly/pull/1299) [`7e18e80`](https://github.com/nextlyhq/nextly/commit/7e18e8075c3239521b14d2a7344a000cf5903259) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Place the caret where an author clicked, in a passage the editor restyles.

  Opening an inline edit replaces the passage's markup and applies the editor's own theme, so a heading's size, a list's indentation and a table's box can all change the moment editing begins. The click position was being measured after that, against a layout nobody had seen — so in any passage whose appearance changes, the caret could land on an unrelated character or at the end. It is measured now at the last moment the page still shows what the author clicked.

  A page description also includes the labels on a button group. Every one is drawn on the page, and each is stored in a place the walk that flattens a passage to plain text never read, so a passage offering "Basic" and "Pro" described the page without them. Read in the shared walk, so search indexing and the crawler description agree.

- [#1067](https://github.com/nextlyhq/nextly/pull/1067) [`e7c5261`](https://github.com/nextlyhq/nextly/commit/e7c52610389b68c7f9e3d06f5e52b753e113bfa3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks can now say which of their values an editor may let an author type
  directly on the canvas, and which element holds each one. `core/heading`,
  `core/text` and `core/quote` declare theirs.

  Nothing changes on a published page: the marking is emitted only when a
  renderer is asked for editor addresses, so published markup is unchanged.

- [#1254](https://github.com/nextlyhq/nextly/pull/1254) [`a1f067a`](https://github.com/nextlyhq/nextly/commit/a1f067a549c7391190efdaaf7e2d27035622c508) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A decoration shorthand resolves into the longhands it assigns, so its cascade is read the way a browser reads it.

- [#1273](https://github.com/nextlyhq/nextly/pull/1273) [`57aacaa`](https://github.com/nextlyhq/nextly/commit/57aacaa7c7d8760065636761bbf2c7779140c384) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Nextly can now run work in the background — reliably, at a chosen time, and as
  a chosen person. This is the foundation the scheduled-publishing work needs, and
  it replaces the pattern where each feature that needed background work grew its
  own private runner.

  A job records what to run, when it may start, whose authority it runs with, and
  how many attempts it gets. It survives a restart, because it is a row in your
  database rather than something held in memory, and it works on PostgreSQL, MySQL
  and SQLite with nothing extra to install — no Redis, no separate queue service,
  nothing to run alongside your site.

  Two things it will not do, both deliberate.

  Two processes will not pick up the same job at the same moment. Whichever gets
  there first takes a short lease on it, and the other simply leaves it alone. If
  the first stalls long enough for the lease to lapse, another picks the job up —
  and the stalled one is then refused when it tries to record what it did, so a
  slow worker cannot overwrite the result of the one that replaced it.

  A job that is still being worked on holds on to its claim: the lease is extended
  while the handler runs, so ordinary long-running work does not get taken over
  part-way through.

  That is still a guarantee about the RECORD rather than about the work. If a
  process stalls or loses its connection, it stops extending the claim while
  whatever it was doing may still be in flight, and another process can pick the
  job up. Every durable queue works this way — it is not possible to promise
  otherwise once a job can touch something outside the database — so a handler
  should be written so that running it twice is harmless.

  Finished jobs are cleared out on a rolling window rather than kept forever, so a
  job that runs every few minutes does not fill the table with its own history.

  It will not quietly run as somebody more powerful. A job remembers who queued
  it, and it acts as that person, with their roles. If that account has since been
  deleted or deactivated, the job stops and says so rather than continuing with no
  identity — which would mean running with no access rules applied at all. It also
  never falls back to an administrator or a system account.

  Failures back off before trying again, and the wait is deliberately staggered.
  When one destination goes down, everything queued for it fails at the same
  moment; without staggering they would all retry at the same instant, and hit the
  recovering destination with the entire backlog at once, over and over. Retries
  are also capped, and a job that keeps failing eventually stops and records why.

  A run is time-boxed, so it finishes cleanly inside a scheduled task or a
  serverless function rather than being cut off partway. Anything it did not reach
  is still queued for the next run.

  Nothing is silently skipped. A job whose type no longer exists in your code is
  recorded with that reason rather than passed over — a queue that never drains
  looks exactly like an empty one, and this makes the difference visible.

- [#1333](https://github.com/nextlyhq/nextly/pull/1333) [`1c7fda6`](https://github.com/nextlyhq/nextly/commit/1c7fda67ccf7d717ab0af3dcdb889480646c4222) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal: the keystroke hint builds its modifier list from a table.

  No change to what any hint says. The order modifiers are written in is a convention, and a list makes that order the thing being read rather than something recoverable only by following five branches in sequence.

- [#1009](https://github.com/nextlyhq/nextly/pull/1009) [`ead5fb7`](https://github.com/nextlyhq/nextly/commit/ead5fb77a8d38dbe744d919bd56975cc4df2fcf5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The "not translated" language dot drew its outline with `border-muted-foreground/60`, which composites to 2.87:1 against the page surface and misses the 3:1 a non-text UI boundary needs. The outline is the only thing that renders that dot, so nothing else carried the state. It now uses the token at full strength, reaching 7.55:1 while staying visually quieter than the draft dot beside it.

- [#1253](https://github.com/nextlyhq/nextly/pull/1253) [`3be0d93`](https://github.com/nextlyhq/nextly/commit/3be0d934125103ab6ee4dbdd7a799dec410f004f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The language panel can be used on a site with many languages. Past eight, it
  offers a filter that matches a language by name or by code, so finding one is a
  search rather than a scan down a column of near-identical rows. Clearing the
  filter brings them all back; a query that matches nothing says so rather than
  showing an empty list.

  Its header wraps instead of running past the card. In a ~320px rail the label,
  the progress meter, the count and up to two actions did not fit on one line, and
  "Publish all" was drawn 47px beyond the card's edge — while a non-default
  language was being edited, which is exactly when it is the control an author
  wants.

- [#1013](https://github.com/nextlyhq/nextly/pull/1013) [`3727712`](https://github.com/nextlyhq/nextly/commit/372771251b8a1d0439f9841b8e8d959d18632697) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder has a layers panel and an ancestor breadcrumb. The panel shows the page as a
  tree, so a block the canvas cannot show — an empty container, or one hidden at the current screen
  size — can still be found and selected, and a search narrows the tree to what matches while keeping
  the containers around it. Selecting a block anywhere reveals it in the tree and shows the trail of
  containers holding it, and each step of that trail selects the container it names. Blocks that are
  locked, hidden at some screen sizes, or shown conditionally say so on their row.

- [#1328](https://github.com/nextlyhq/nextly/pull/1328) [`f797c86`](https://github.com/nextlyhq/nextly/commit/f797c8641e631a22a21b558f0593f37ee8633a29) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The layers panel says how to reorder a block.

  Moving and nesting a block with the keyboard already worked while the layers panel had focus, but nothing said so, and a capability nobody can find reads exactly like a missing one. The panel now shows the keystrokes under the tree, and screen readers hear them on entering the tree rather than only if they reach the text below it.

  The keystrokes are spelled for the keyboard in front of the author — Option on a Mac, Alt elsewhere — and they are read from the bindings the editor actually registers, so a rebound key changes the hint with it instead of leaving a label that teaches a keystroke which does nothing.

- [#1024](https://github.com/nextlyhq/nextly/pull/1024) [`30d0860`](https://github.com/nextlyhq/nextly/commit/30d08608f8aadeea36733762a312d03a8ccfb2f2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Leaving an entry editor with unsaved changes now asks first.

  The admin ships an unsaved-changes guard — dialog, history interception,
  back/forward handling, `beforeunload` — and nothing has ever mounted it. It has
  been present since the first commit, exported through a barrel no consumer
  imports, and touched since only by two theme passes that restyled a dialog which
  never appeared. So navigating away from a half-written entry discarded it in
  silence.

  It is mounted now for the entry editor, and an action that has already asked the
  question — Discard changes — says so rather than being asked it twice.

  Not yet mounted for singles: an untouched single reports itself dirty on load,
  so the guard would question a document nobody had edited. That is recorded as
  its own defect rather than worked around here.

- [#1023](https://github.com/nextlyhq/nextly/pull/1023) [`b8f5ead`](https://github.com/nextlyhq/nextly/commit/b8f5ead0af1a2ea1a445e3b1ed6f13e07bc02b33) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry list shows which languages a row is missing.

  Two surfaces were answering "how far along are this document's translations"
  separately and disagreeing: for an entry with only its default language written,
  the editor's language panel read "1 of 3 translated" while the list's badge read
  "0/2". There is now one derivation, and it excludes the default language on both
  sides — that is the source a translation is made FROM, not one of them.

  The list's count is replaced by one mark per translatable language. A count says
  how much is left and never which, so choosing what to translate next meant
  opening rows to find out. Each mark carries its language and state in its
  accessible name, and the row carries a spoken summary naming exactly what is
  missing.

  That column also never actually appeared. It had been added to a second,
  unreferenced column builder that no table has called since the list moved to its
  current one, so no user has seen it. The live builder now renders it and the
  dead one is gone.

- [#1016](https://github.com/nextlyhq/nextly/pull/1016) [`3782024`](https://github.com/nextlyhq/nextly/commit/37820249b7014d3cae792061d5d24580b1fb205f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A locked block in the page builder now resists being moved or deleted, and says why. Until now the
  flag was honoured only when dragging, so a block the layers panel showed as locked could still be
  moved with the keyboard or deleted outright. Deleting a container that holds a locked block is
  refused too, since removing the container would destroy the block inside it, and the refusal names
  which block is locked. Moving a container is still allowed, because its locked children keep their
  place inside it.

- [#1226](https://github.com/nextlyhq/nextly/pull/1226) [`a6efa47`](https://github.com/nextlyhq/nextly/commit/a6efa47997671b0c9ec298f0491bd8787850b3bb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema renames no longer claim "data preserved" over a conversion that changes the stored values.

  Renaming a column between two types in the same family was offered as preserving the data. Exact and approximate numerics share that family, so converting a `numeric(10,2)` money column to `float8` was labelled "data preserved" while every value became the nearest binary float — `19.99` stored as `19.989999999999998` — and the reverse rounded to the target scale and failed outright above its precision. The same label appeared in the terminal prompt and in the Schema Builder dialog.

  Preservation is now answered separately from compatibility. Family membership still decides whether a drop/add pair can be read as a rename at all; whether the values survive it is its own question, and both surfaces read that instead. A conversion that rewrites values says so and explains what happens to them, and neither surface pre-selects it when a preserving rename is available.

  The declared size travels with the column. PostgreSQL introspection records `numeric(10,2)` as a bare `numeric` with the precision in a separate field, and the operations a diff emits recorded only the bare token — so a rename that narrowed the precision described a move between two identical types, and the narrowing cast was offered as preserving. Every operation that records a column's type now records its declaration.

  The terminal prompt says what it is about to do. `migrate:create` asked "Apply as rename?" with the same sentence whether the rename kept every value or rewrote them, and Enter accepted. It now names the effect on the values before asking, and says that declining drops the column and loses all of them rather than merely "losing data" — both answers cost something once a conversion is involved, so the prompt names both costs. `--accept-renames` warns for each value-changing rename it accepts unattended.

  A dismissed schema preview no longer answers for the next one. Cancelling the Schema Builder's change dialog keeps it mounted so a retry re-opens the same unsaved answers; a DIFFERENT preview arriving reused them, so the second preview kept the first's rename target — or, when the columns had changed, left every option unselected while Apply still sent each one as drop-and-add. Each preview now gets its own dialog, which covers the NOT NULL defaults on it for the same reason.

- [#1209](https://github.com/nextlyhq/nextly/pull/1209) [`33e09c9`](https://github.com/nextlyhq/nextly/commit/33e09c9e3c802f07c6894bb3af7739f50ca87646) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Replacing an image, renaming it, or deleting it left cached pages showing the
  old one. Media writes announced nothing to the cache, so a page that had already
  been rendered kept its copy until something unrelated happened to rebuild it.

  A media write now invalidates that file, using the same tagging a content change
  already uses. A page that renders an upload tags its read with
  \`nextlyTags("media", id)\` and is rebuilt when the file changes.

  Deleting or uploading many files at once announces them together, so clearing a
  folder of images tells the cache once rather than once per file.

- [#1034](https://github.com/nextlyhq/nextly/pull/1034) [`e12fef3`](https://github.com/nextlyhq/nextly/commit/e12fef351831d6f0233e5c7ae8d2c11285e0bda3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now has a working command palette. Pressing Cmd+K (Ctrl+K) in the editor lists what you can do to the selected block, plus undo, redo and closing the editor, searchable by name. The palette existed but was never mounted, so the shortcut opened the admin palette instead.

- [#1314](https://github.com/nextlyhq/nextly/pull/1314) [`20f4a16`](https://github.com/nextlyhq/nextly/commit/20f4a1694000c0cb982ca364057102afb7da8a70) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The class selector now appears in the style inspector, above the style
  sections, so applying a class happens on the element being styled rather than
  behind a context switch. Until now the surface existed and nothing rendered it.

  Applying or removing an existing class is written by the inspector itself,
  because it is an edit to the selected block and the panel already writes those
  — a host only supplies the site's class library and handles creating a new
  class, which needs a site-style write no panel can reach. Removing the last
  class removes the field rather than storing an empty list, so undo restores the
  block as it was.

  A host that has not opted in gets no class surface at all, and one that has
  opted in but is still reading its library gets a loading state, so the two are
  never drawn the same way.

- [#1195](https://github.com/nextlyhq/nextly/pull/1195) [`2f0a973`](https://github.com/nextlyhq/nextly/commit/2f0a97333b2a87b58a34268d61cff95e2639ccd4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Preview action in the entry editor is now wired to something. `useEntryPreview` answers
  whether a collection previews and where, and nothing called it — so the two props
  `PreviewActions` needs arrived as their defaults and the control could only ever draw its
  copy-link half. Every layer existed and none of them were joined, which is why the button was
  absent rather than broken.

  It opens the SAVED draft, and the machinery that claimed otherwise is gone. The admin used to
  write the editor's unsaved form values into session storage and append `?_preview=<key>` to the
  URL, and nothing anywhere ever read that key back: the site renders the draft route on the
  server, so the values it shows are the ones the server read. Carrying browser-held values into
  that render would mean the page displaying content that never passed the field-level read rules
  the draft route applies, which is the trust boundary the preview work has just spent eight pull
  requests establishing. The address is resolved from the saved row for the same reason — resolving
  it from an unsaved slug names a page that does not exist yet.

  The preview is therefore offered only once an entry has been saved, and its reasons for declining
  now reach the editor as messages that say what to do about them.

- [#1051](https://github.com/nextlyhq/nextly/pull/1051) [`c1f8d00`](https://github.com/nextlyhq/nextly/commit/c1f8d00f363b4017264fb5a71c8b352a0d089156) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Move several selected blocks at once. The page editor's toolbar and its alt+arrow shortcuts now reorder a whole selection that shares a container, as one step per block and one undo for the group, where they previously refused any selection larger than one. A selection spread across two containers still refuses, and now says why.

- [#1114](https://github.com/nextlyhq/nextly/pull/1114) [`46720cf`](https://github.com/nextlyhq/nextly/commit/46720cff7457fc30f045ff2d4280760db10a3688) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On MySQL, a schema baseline read from a live database could not be applied
  anywhere. MySQL reports a column's expression default — which is what a
  required JSON, repeater, group or chips field gets — without the parentheses it
  requires around one, so the recorded schema described a table no MySQL server
  would create, including the one it was read from. The parentheses are now
  restored when the baseline is recorded. `CURRENT_TIMESTAMP` is left as it is,
  because MySQL quietly rewrites the parenthesised form into a different default,
  so a table rebuilt from the recorded schema would not match the one it was read
  from.

  This fixes the defaults Nextly itself creates. One case is still broken and is
  tracked separately: a default someone wrote by hand that contains a quoted
  piece of text, such as `DEFAULT (lower('X'))`, is reported by MySQL in a form
  that the parentheses alone do not make valid.

- [#1018](https://github.com/nextlyhq/nextly/pull/1018) [`44fad04`](https://github.com/nextlyhq/nextly/commit/44fad046d2a673e4e23c682652dec52863d36fb1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks can be named and locked from the page builder inspector. A name replaces the block type
  wherever the editor refers to that block — the layers panel, the ancestor breadcrumb and the
  spoken announcements — so a page with six headings no longer presents six identical rows. The lock
  checkbox sets the flag the editor already honours, so locking a block from here immediately stops
  it being moved or deleted. Clearing a name or releasing a lock removes the field rather than
  storing an empty value.

- [#1319](https://github.com/nextlyhq/nextly/pull/1319) [`d11047b`](https://github.com/nextlyhq/nextly/commit/d11047b69875d65aef60e150fac3e068bec6ce14) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Splits the background-job runner's per-job step into named parts.

  `runOne` was one long function that stated the same failure decision three
  times — once for a failed identity lookup, once for a failed lease re-check and
  once for a handler that threw. It states it once now, and the branch for a job
  whose type this instance does not recognise is its own function. Behaviour is
  unchanged.

- [#1072](https://github.com/nextlyhq/nextly/pull/1072) [`af6637b`](https://github.com/nextlyhq/nextly/commit/af6637b48395cfbe5a56d3724f4115d608a58a4b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reading a past version no longer records it as the author's unsaved work.
  Choosing a version replaces the form's values, which looked like typing, so the
  old version was stored as a recovery point and offered back on the next visit
  as "unsaved changes".

- [#1198](https://github.com/nextlyhq/nextly/pull/1198) [`315c523`](https://github.com/nextlyhq/nextly/commit/315c523aac5df9ec8d601a238cc452e533c1e660) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a notification row's name still while it expands.

  The row's accessible name changed with its state — "Edit notification X" when
  closed, "Collapse notification X" when open — while `aria-expanded` already said
  which it was. A name that moves with state is one a screen-reader user cannot
  refer to twice, and one no caller can hold a handle on across a click.

- [#1256](https://github.com/nextlyhq/nextly/pull/1256) [`4e9a396`](https://github.com/nextlyhq/nextly/commit/4e9a396b9792ba57dffd32cb4c878bba98f23031) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The walk that decides which fields a level addresses is published, so a plugin can call it instead of writing its own.

  An unnamed group exists to lay fields out: its children are stored at the level the group sits in, not under it. A named group stores its children under itself. Telling those apart is what finds where a value is actually kept, and it was implemented twice — once in core's version tagging, once in the page-builder plugin, because the core one was exported from its module and from no public entry, so a plugin could only reach it by importing core's file layout.

  The published one no longer dies on config an author can write. A group that contains itself overflowed the call stack, and a group wider than the engine's argument limit threw out of `push(...children)` — both reached inside a post-commit hook, where a throw reports a failed save for one that actually succeeded. The walk is iterative and carries a cycle guard, so neither is reachable, and a field list that is not a list, an entry that is not an object, and a `fields` that is not an array are answered with what is there rather than an exception.

  `addressableFields` is published from `nextly` and re-exported from `@nextlyhq/plugin-sdk` as `@experimental`, recorded in that package's stability ledger. It is AVAILABLE for the page-builder to migrate onto; that plugin still runs its own walk, and moving it is a behavioural change for that index rather than a deletion. It returns the widest union a field can be, because an unnamed group may contain a contributed field and flattening it returns something no built-in union describes — a narrower promise turned a plugin's own field into `never` at the moment its owner tried to recognise it. A caller that must not descend some containers says so with `descendInto`. That choice has to be made during the walk rather than afterwards: the result holds the flattened children themselves, so a field reached through an unnamed repeater — whose values are stored per row — is the same object as one reached through an unnamed group, and no filter over the returned list can separate them. It had no tests anywhere; it has fifteen now, eight of which pin what it already did so the move can be shown to have changed nothing that was working.

  The schema resolver that runs before it on the save path is hardened the same way. `resolveComponentFieldMap` collected component slugs by recursing over the same `fields` graph with no visited set and spreading the result into `push`, so a config whose group contained itself, or a list wider than the engine's argument limit, still threw there — one function earlier than the walk, and after the row was already written.

  The redaction walk that reads version history is hardened too. `stripPasswordsThroughComponents` descends through an unnamed container by recursing on the SAME value with a different field list, so a schema whose container reached itself looped there — after the resolver, on a route that only becomes reachable once the resolver returns. The containers currently open on a path are tracked and released on the way out, so a schema shared by many rows is still walked once per row rather than once in total.

- [#1311](https://github.com/nextlyhq/nextly/pull/1311) [`2a46a22`](https://github.com/nextlyhq/nextly/commit/2a46a222b9aca25058ad85dd4bb08ca5a4801efa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a link on the words that follow a button inside a heading.

  A heading may hold only phrasing content, so a button an author put inside one moves out to sit after it — and any words the author wrote after that button move with it, to stay in the order they were written. Those words were being re-wrapped in a single copy of the link around them, together with the button. A link may not contain another interactive element, so the renderer drops such a wrapper, and the trailing words silently lost the link the author had applied to them. The same passage with an image in place of the button kept its link, so one document rendered by two rules. Each run the wrapper may legally hold now keeps its own copy, in the author's order.

  A page description also reads a button label stored as a number the same way the page draws it.

  A label of `0` — from an import, a migration, or an older row — is drawn as the character "0" on the page, because a stored number is text a reader recognises. The projection that flattens a passage for search indexing and the crawler description accepted only strings, so it described the page without a label the page displays. Both now read through one decision about what counts as authored text.

- [#1259](https://github.com/nextlyhq/nextly/pull/1259) [`2e5576d`](https://github.com/nextlyhq/nextly/commit/2e5576d936be9847d890aa4510ee20204d54bf60) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The registry sync compared stored JSON through its own canonicaliser, and the
  schema domain compared it through another. Two implementations that agree today
  are one edit away from disagreeing, and the failure they produce is silent: a
  resource that re-syncs on every boot, or one that never notices a real change.
  There is now one, `shared/lib/canonical-json`, and the registry base class calls
  it.

  One behaviour changes with the move. A value containing a cycle used to throw
  out of the comparison and take the sync down with it; it now serialises to
  `undefined`, so two unrepresentable values compare equal and the sync proceeds.
  A cycle cannot survive a round trip through the database in the first place, so
  the throw could only ever report a bug in the caller — loudly, in the wrong
  place, at boot.

  No exported API changes: the comparison is a protected method on the registry
  base class and both call forms are internal.

- [#1312](https://github.com/nextlyhq/nextly/pull/1312) [`85cf546`](https://github.com/nextlyhq/nextly/commit/85cf546c3b17ef0aef08d5da1f96140ba24f78a0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Write every localized companion row through one upsert. The collection write
  path carried a private copy that built the same `INSERT ... ON CONFLICT` as the
  shared helper, kept separate only because it holds a transaction and the helper
  took an adapter. A transaction can now present itself as that adapter, so the
  copy is gone and there is a single place a companion column is written.

- [#1031](https://github.com/nextlyhq/nextly/pull/1031) [`2ba4029`](https://github.com/nextlyhq/nextly/commit/2ba4029faa33272596b4c75a79c3b7293e72fe43) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry editor and the single editor agree on what a form starts with.

  They each carried their own copy of the function that builds a form's default
  values, and the copies had drifted in six ways users could see: a `chips`
  field's declared default applied in one editor and was discarded in the other; a
  `code` field opened empty in one and null in the other; a single-value `select`
  seeded an empty string in one and null in the other.

  There is one implementation now. Every divergence was resolved on its merits
  rather than by keeping a favourite, and the entry editor's behaviour won all six,
  so singles gain the correct handling and entries are unchanged.

- [#1262](https://github.com/nextlyhq/nextly/pull/1262) [`efffb03`](https://github.com/nextlyhq/nextly/commit/efffb03970582deb7080af4ce304649a727bb506) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every counter in a document now says what it is counting. The language panel
  read "0 of 2 translated" while translation mode read "0 of 2 fields translated"
  a few clicks away, and with three languages and two translatable fields the two
  numbers coincide exactly where a person first meets them. The panel now names
  its unit like the other three do, so the shape is the same everywhere: "N of M
  languages translated", "N of M fields translated".

  Field names are resolved in one place. The form printed "Excerpt", the entry
  list printed "Excerpt" through its own second copy of the humaniser, and other
  surfaces printed the raw key `excerpt` — the same field with two names, and the
  raw key is the one a translator cannot act on. `fieldLabel` and
  `humanizeFieldName` now answer that once, and treat kebab and snake keys alike:
  `user-email` was coming out "User-email" from one of the copies.

- [#1258](https://github.com/nextlyhq/nextly/pull/1258) [`b8a9b17`](https://github.com/nextlyhq/nextly/commit/b8a9b17da19ff6b6561f46667eeb2bf98d9e5451) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry header no longer carries a second copy of the language state. The row
  of language pills, the count beside it and the "Languages" actions menu are
  gone; the document rail's language panel says all three, and said them already.
  The pills and the panel reported the SAME number from the same function — one as
  what was done, one as what was left — a few centimetres apart, and the pills
  could not be fixed in place: past six languages they overflowed a clipped row,
  so a site with fourteen could not reach eight of them at all.

  The legend explaining the state dots moved into the panel, where it opens on
  request. It was the one thing the actions menu carried that the panel did not,
  and without it the dots are decodable only by hovering.

  Filling one language from another moved into the panel with the rest, and
  widened on the way. Every language can now be filled from another, not only an
  empty one, and the button reports which it is doing — "Start from…" where there
  is nothing to lose, "Replace from…" where there is — before the confirm step
  spells out what gets overwritten. The language being edited names its own
  source, since it is the one row whose source cannot be inferred from where the
  author is standing.

  Creating an entry still says which language the first save will be in, since a
  document that does not exist yet has no translations to report.

- [#1113](https://github.com/nextlyhq/nextly/pull/1113) [`29b5cab`](https://github.com/nextlyhq/nextly/commit/29b5cab442aa852a974ead8e7333c68ff133a111) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group migration lock now reads its clock and derives its timings from one shared module, so a second lock cannot disagree with it about what time it is. No behaviour change: the same expressions and the same 120s/15s/90s values, reached by one definition instead of a private copy.

- [#1178](https://github.com/nextlyhq/nextly/pull/1178) [`2791d3a`](https://github.com/nextlyhq/nextly/commit/2791d3a6259e2d8fa911b3f448f88691d33ae917) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the page one measure instead of two.

  A settings page decided its own width twice: `PageContainer` padded the panel
  and `FormLayout`, rendered from inside each form, centred a `max-w` column and
  padded again. The two disagreed by 24px, so a page's heading and its first form
  card did not share a left edge.

  `PageContainer` now takes an opt-in `width` and spends the inset as grid
  columns, and `FormLayout` is gone. Its `56rem` and `72rem` were a hand-written
  second copy of `--nx-measure-form` and `--nx-measure-wide`, free to drift the
  moment a theme retuned either token. `FormActions` is unchanged and now sits at
  the page's measure rather than the layout's.

  Omitting `width` keeps the container the padded block it has always been, which
  is what the pages that manage their own height depend on.

- [#1158](https://github.com/nextlyhq/nextly/pull/1158) [`8234829`](https://github.com/nextlyhq/nextly/commit/82348299e08a945a01450f2397c23851869de918) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The API Playground for a Single now fills the page and scrolls inside its panes,
  matching the collection view. The two pages had been maintained as separate
  copies and had drifted apart; they are one page now, so a change to either
  reaches both.

- [#1140](https://github.com/nextlyhq/nextly/pull/1140) [`f4e27fe`](https://github.com/nextlyhq/nextly/commit/f4e27fefe80d2baa582023a42842291b7d9aae17) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - One reading of a validation payload, and a guard that answers for the whole shape.

  `parseServerErrors` traversed `data.errors` independently of `validationIssues`,
  so the entry form and the SDK disagreed about a partial issue: one dropped it,
  the other kept it with missing fields. Both now read through one normalizer and
  the form derives its stricter subset from the result.

  A blank message is reported as absent rather than carried, so a surface keying
  issues by field falls back to its own wording instead of showing an author a
  refusal with nothing in it.

  `isApiError` checks every present field rather than `status` alone. It narrows
  `unknown` across the SDK boundary, where another client's error carrying a
  numeric status would otherwise be handed over as an `ApiError` whose `code` is
  declared `string` and is not.

- [#1239](https://github.com/nextlyhq/nextly/pull/1239) [`cf57071`](https://github.com/nextlyhq/nextly/commit/cf5707192799a961da02cd37e3b508c22de58eca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Comparing two versions of a document means comparing two sequences: rich text
  is a sequence of blocks, and formatted JSON or code is a sequence of lines.
  Both need the same operation — work out which units correspond, which were
  added, which were removed, and which are the same unit edited — before anything
  can say what changed inside one.

  This adds that operation once, as a shared internal step, rather than letting
  the rich-text and source comparisons each grow their own. Two implementations
  of one question agree on the day they are written and drift silently
  afterwards.

  Inserting a paragraph now marks only that paragraph added, instead of marking
  every paragraph after it as changed. An edited unit is reported as one changed
  row rather than as a deletion sitting beside an unrelated addition, so a
  word-level comparison can run within it.

  Where the two sides are too large to align, it says so rather than returning a
  partial result: "I could not compare these" and "these are identical" are
  different answers, and a silently truncated comparison reads as a confident
  one.

  Nothing uses this yet, so no comparison changes shape. The rich-text and
  JSON comparisons that build on it follow.

- [#1126](https://github.com/nextlyhq/nextly/pull/1126) [`2fe2409`](https://github.com/nextlyhq/nextly/commit/2fe240971acbb6b0250af53a655369ed5a61bf28) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The translator that turns a `WhereClause` into a Drizzle condition existed
  twice: the copy the adapter calls on every filtered read, update and delete,
  and a second, identical copy in `nextly` that nothing imported. The drizzle v1
  migration had already had to apply the same fix to both. The unused copy is
  gone, and the shipped one now carries the test suite — rewritten to assert the
  SQL and parameters each operator produces, so a filter that quietly means the
  opposite of what it says cannot pass.

  Writing those tests turned up two ways a filter could silently widen, and both
  are fixed. Neither affects a where clause that already produced a condition.
  - A clause whose branches ALL resolve to nothing — `{ and: [{}] }`,
    `{ not: {} }`, `{ or: [{}] }` — used to come back as "no condition". Because
    `update` and `delete` take the where clause as a required argument and omit
    the WHERE when none is returned, asking to delete a subset that way deleted
    the whole table. It now throws. An empty `{}`, which is how callers say "no
    filter", is unchanged.
  - `CONTAINS` now matches its value literally: `%` and `_` inside it are escaped
    rather than acting as wildcards, so `CONTAINS "50%"` finds the text "50%"
    instead of every row containing "50". Verified against PostgreSQL 17,
    MySQL 8.4 and SQLite.

  `WHERE_OPERATORS` is a new export from `@nextlyhq/adapter-drizzle/types`: the
  list of every operator a where clause accepts, as a value. The `WhereOperator`
  type is now derived from it, so code validating caller input against the list
  and the type narrowing that input cannot fall out of step.

- [#1061](https://github.com/nextlyhq/nextly/pull/1061) [`1d26760`](https://github.com/nextlyhq/nextly/commit/1d26760212d85ae95d1aa44697a9846cdcf18570) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the working-draft write one implementation.

  The store-and-accumulate step lived inline in a single update path, which is why
  the transaction-owning and batch write surfaces could not reach it. It is now a
  method those paths can call, with no change to what the existing caller does.

- [#1123](https://github.com/nextlyhq/nextly/pull/1123) [`8356918`](https://github.com/nextlyhq/nextly/commit/83569186484391113629e38cb003dc883f38e5f2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Creating, updating and deleting an entry inside a transaction ran through two
  implementations: one for a caller that owns the transaction, and a separate
  streamlined copy the batch services call per item. The copies had already
  drifted — a truncated comment on one side, a differently worded error message,
  and a first-publication marker whose rule had to be restated for the batch path
  after it was found missing there. Each verb now has ONE implementation that both
  entry points delegate to, so the two cannot disagree again; the things that
  genuinely differ between them (whether the collection-level access check runs
  here or was hoisted to a batch caller, whether user hooks run, and which shape
  of the row-ownership gate applies) are named options on that one path rather
  than two bodies kept in step by hand.

  No behaviour changes. Every public method keeps its signature, and the batch
  services are untouched.

- [#1144](https://github.com/nextlyhq/nextly/pull/1144) [`8115473`](https://github.com/nextlyhq/nextly/commit/8115473dda3feaef9e69e6f0e84961ca7e08841f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A stored page stylesheet now records which shared style inputs it was compiled against.

  A page's compiled CSS is cached beside the document and reused on later renders.
  That cache was keyed on the host-fetch policy alone, so four site-level inputs
  could move underneath it with nothing noticing: the breakpoints, whose ids and
  bounds decide every at-rule; the token prefix, which renders into every `var()`
  the sheet references; the named-class library, whose slugs become the selectors
  themselves; and the block-type defaults, which are emitted into that same sheet.

  When one moved, the newly compiled site sheet and the stored page sheet stopped
  agreeing and CSS failed silently — an unresolved custom property invalidates its
  declaration rather than reporting, and a selector nothing declares never
  matches. The page rendered, partly unstyled, with no error anywhere.

  `PageStyles` gains `sharedInputsId`, a digest of those inputs, compared on every
  render and treated as a repair cause when it disagrees. Artifacts written before
  this field existed carry no stamp and are recompiled against any render that
  states its inputs. The resolver RETURNS the stamped result and does not write it,
  so whether that is paid once or on every request depends on whether the caller
  persists or caches what it gets back.

  `PageRenderer` derives the identity from the site styles it was given as well as
  from a compile context, so the ordinary route — a stored artifact plus
  `siteStyles`, compiling nothing itself — is covered rather than exempt. Because
  those inputs can also compile a replacement, a refusal there recompiles the sheet
  instead of withholding it.

  The identity is taken over what the compiler READS, not over what was stored,
  which is the difference between invalidating a page and invalidating the site.
  Breakpoints are read through the engine's normalisation, so a definition it
  discards moves nothing; the token prefix is the one tokens are actually written
  under, so swapping one rejected spelling for another moves nothing; and block
  defaults are narrowed to the types a page draws, so a default changing for a
  block it does not hold moves nothing. A stored record wider than the compiler
  will read declines to identify the inputs at all rather than being read past
  that bound, which recompiles rather than reusing a sheet that was only partly
  described.

  `PageRenderer` also hands the site's own `mayFetchUrl` to the compile it
  synthesizes from `siteStyles`. The shared sheet has always honoured it, the
  page sheet is emitted after, and a page compiled under weaker rules would
  publish a request the sheet beside it was refused.

  A class or block-base envelope is read only under the states the compiler emits
  from. `compilePageCss` iterates `STYLE_STATES` and never reaches a key outside
  it, so two envelopes differing only under an unrecognised state compile to the
  same CSS — reading the whole object rejected every stored artifact over a
  difference no stylesheet can show. The state list is imported rather than
  restated, so it follows the engine rather than drifting from it.

  Block defaults are narrowed to the types a page draws in ONE place, the
  resolver, so the exported entry point and the renderer cannot answer
  differently. `resolvePageStyles` gains `storedDocument` for the caller that
  pruned before calling it: the documented flow is prune-then-resolve, and two of
  those prunes are licensed to KEEP the stored artifact, so an identity derived
  from what survived would drop a type whose last node such a prune removed and
  refuse the very sheet it was allowed in order to reuse.

  `breakpointContexts` now bounds a stored axis BEFORE anything filters it. The per-axis
  limit bounded its output and not its work, so an axis of a million definitions
  was scanned in full on the way to keeping seven — paid by every reader keyed on
  which breakpoints a site emits under, including one whose stylesheet is
  reusable. The bound is on the RAW axis rather than on what survives the filter,
  because a bound after the filter bounds only the sort while every stored
  definition is still visited. Past `MAX_SCANNED_KEYS` definitions on one axis the
  survivors are now chosen from that prefix; nothing legitimate reaches it, since
  the declared limit is seven.

  `breakpointContexts` also drops a definition whose id is longer than the new
  `MAX_BREAKPOINT_ID_LENGTH`, which is exported beside the per-axis cap so a store
  validating on write can refuse what the compiler will not read.

  `validate()` now derives which breakpoint ids a site defines from that same
  normalisation instead of scanning the stored axes. The two disagreed about the
  same document: a definition the compiler drops — an unusable bound, a viewport
  entry with no bound, a duplicate past the first, one past the per-axis cap, or
  an over-long id — was counted as known by validation, so styles keyed to it
  validated with no issue and then compiled to nothing. It corrects the opposite
  case too: `base` is always defined, even when the stored set names no base
  definition, which the scan alone reported as unknown. The per-axis limit bounded how MANY definitions are
  read and said nothing about their size, and an id is a lookup key every reader
  of the normalised axis carries — so one enormous stored value was copied on
  every render that asked which breakpoints a site defines. Dropped rather than
  truncated, so the id is simply not one this site defines and the values stored
  under it are reported stale, exactly as an unusable bound already behaves.

  Neither the shared-input identity nor `toPageStyles` is part of this package's
  public entry. It was
  briefly published so an external write path could stamp what `toPageStyles`
  stores, and that was wrong: the identity a reader derives is taken over a
  compile context the resolver has already narrowed, so a writer computing one
  from its own context writes an artifact every read refuses. A writer's answer is
  `resolvePageStyles` with no stored artifact — it compiles and returns the
  stamped result, so the value written is the value a reader recomputes.
  `toPageStyles` goes with it: it asks its caller for that same identity, so
  published it is a converter that cannot make a reusable artifact. `fetchPolicyLabel`
  stays, and the difference is the point — that label is a pure function of the
  host's pattern list, which a reader computes from the same list, so a writer can
  match it.

  `@nextlyhq/blocks-engine` exports `breakpointContexts`, `safeTokenPrefix`,
  `MAX_SCANNED_KEYS` and `MAX_NAMED_CLASS_NAME_LENGTH`: the compiler's own normalised breakpoints, the prefix tokens
  are really written under, and the width past which a stored record is not read.
  Anything keyed on what a stylesheet contains reads these rather than the stored
  settings, which change without the output changing.

- [#1200](https://github.com/nextlyhq/nextly/pull/1200) [`99d7824`](https://github.com/nextlyhq/nextly/commit/99d78240db617f0d0bd9cd9bbe5cfc4444622ef2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The shared page error fallback carries a stable marker, so a caller can tell an error page apart from the page it replaced.

- [#1171](https://github.com/nextlyhq/nextly/pull/1171) [`1ca795a`](https://github.com/nextlyhq/nextly/commit/1ca795ac1deb451e85b8cb34599ea1ca5b3184f5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `PageHeader`, and let each settings page declare its own identity.

  A page's breadcrumb trail, name, summary and actions are now one component
  instead of markup written out at each page. The settings pages previously took
  their title from a chain of sixteen branches matching `window.location.pathname`
  in a file none of them imported, so adding a route meant editing a foreign
  `if`, the header was wrong for any page reachable at more than one path, and a
  plugin could not contribute a settings page at all because it cannot add a
  branch to a chain it does not ship. Each page now passes its own title.

- [#1150](https://github.com/nextlyhq/nextly/pull/1150) [`a691def`](https://github.com/nextlyhq/nextly/commit/a691def619ad3a362c7bd9379b25876ebcf0a565) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `PageShell` and `Bleed`, the admin's page-level layout primitives.

  `PageShell` owns a page's horizontal inset and its measure, and spends both as
  grid columns rather than as padding. That difference fixes a class of layout bug
  rather than one instance of it: padding cannot be cancelled by a descendant, so a
  block that needed to run edge-to-edge previously had to be rendered outside the
  wrapper imposing the measure, and two wrappers that each applied an inset
  silently added theirs together. As columns there is a single declaration, every
  child shares a left edge by default, and `Bleed` turns full-bleed content into
  something a page declares rather than something it achieves by accident.

  Both are `@experimental`. Nothing renders them yet — pages migrate onto them
  separately — so this release changes no existing page.

- [#1298](https://github.com/nextlyhq/nextly/pull/1298) [`e5f4b8f`](https://github.com/nextlyhq/nextly/commit/e5f4b8f869407413e22517f871657e85fd578359) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can now answer, in one place, what its two class surfaces show and what an edit to
  them produces.

  Both surfaces ask the same rules, so a selector cannot decide a class is applicable while the
  manager calls it unused. Ordering follows the library position that decides precedence rather than
  the name or the stored array, because that order is what resolves a conflict between two classes on
  one node - sorting for display would show an override relationship the page does not apply.

  A class the library does not know is dropped from a node rather than drawn as an unnamed chip. The
  engine omits such a class from the stylesheet, so a chip for it would offer to edit something no
  page can display.

  A typed name is held to the engine's own grammar rather than a second one, and a duplicate is
  refused rather than merged: two classes with one slug emit the same selector, so the later would
  silently override the earlier for every node carrying it.

  Applying a class appends it rather than reordering to library position. The stored order does not
  decide precedence, so rewriting it would produce a document change that renders identically - a
  diff nobody can explain and a version-history entry that means nothing.

  Deleting a class that documents reference requires a confirmation naming the count. The count is
  read from an index maintained on write, which has no concurrency control and therefore errs upward,
  so it warns about a deletion that was safe rather than waving through one that was not.

- [#1139](https://github.com/nextlyhq/nextly/pull/1139) [`6c5b14c`](https://github.com/nextlyhq/nextly/commit/6c5b14c7606899a42440e0bde7298fd699243bfb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the page-builder style inspector unit-aware numeric editing and a two-state toggle, without narrowing what a style value may be.

  Arrow keys step a measurement and keep its unit — Shift steps by ten, matching what Figma, Framer and Webflow all do — and a menu beside the field swaps the unit, offering only units the property itself accepts.

  A keyword property with exactly two values draws a pair of buttons instead of a menu, so both options are visible and each is one click. No property in the style catalog declares a two-value keyword today, so this changes nothing an author currently sees; it takes effect for the first property that does, with no further editor change.

  Every one of these is layered ON the existing text field rather than replacing it. A style value is stored as a string and may legitimately be `auto`, `clamp(1rem, 2vw, 3rem)`, a two-part shorthand like `10px 20px`, a CSS-wide keyword, or a design-token reference — so a control that modelled a length as a number plus a unit would write five of those six away the first time the field was touched. The affordances engage only where the stored value is a single simple measurement and disengage silently everywhere else, and whether a stepped or unit-swapped result is legal is decided by asking the engine with the property's own rules rather than by restating them.

- [#1141](https://github.com/nextlyhq/nextly/pull/1141) [`22b39d0`](https://github.com/nextlyhq/nextly/commit/22b39d09d2c0cfd03b1efce8ee9d4189447b808d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A design token's stable identity now survives a save, and the tier merge keys on it.

  The stored-tokens write validator rebuilt each token from a field allowlist, so
  an `id` written through the editor was dropped on every save — a rename appeared
  to work while the identity keeping existing references resolving was gone. The
  id is carried through, and refused rather than dropped when it is not a string.

  `resolveSiteStyle` merged the config and stored token tiers by name while the
  engine resolves by identity. A renamed stored token therefore stopped matching
  its config counterpart and the default survived beside it, leaving a stale entry
  in the list every studio reads. Both stages now key on `tokenIdentity`.

- [#1075](https://github.com/nextlyhq/nextly/pull/1075) [`6bfba73`](https://github.com/nextlyhq/nextly/commit/6bfba73f953c8ad3abb6032f2a014a2e75e083f9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Show which languages hold unpublished changes, and confirm before publishing all.

  The language panel now marks a language that has changes waiting, so an editor
  can see it without opening each language in turn. Publishing every language asks
  first and says how many carry unpublished work, because that action puts all of
  it live at once.

  Two fixes underneath: an edit that named no language was written straight to the
  live site instead of being held, and a translated document's pending change was
  never shown back to the editor who saved it.

- [#1066](https://github.com/nextlyhq/nextly/pull/1066) [`3a48dce`](https://github.com/nextlyhq/nextly/commit/3a48dcec2afc68d8a7ef8b81178ac3ff044e8c76) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold pending changes per language on a translated document.

  Editing a published translation now holds the change for that language and
  leaves the other translations alone, and publishing a language publishes that
  language's pending change. Previously a multilingual collection had no pending
  changes at all: every edit to a published translation went straight to the live
  site.

- [#1079](https://github.com/nextlyhq/nextly/pull/1079) [`e86d212`](https://github.com/nextlyhq/nextly/commit/e86d2128adf2a84305f1aa74718bfb2cf084289f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Discarding a pending change now removes the language it was asked for. On a
  localized collection the discard named no language, so it resolved to the
  default: the editor's Discard threw away the default language's pending
  change while leaving the one on screen, and reset the form to the default
  language's live values.

- [#1159](https://github.com/nextlyhq/nextly/pull/1159) [`ca204b1`](https://github.com/nextlyhq/nextly/commit/ca204b1b65780b54d45b0c566831d04a671c54c0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The API Playground's request and response panes can now be resized by dragging
  the divider between them, and the width you choose is remembered. Its query
  parameters lay themselves out from the width of their own pane rather than the
  browser window, so the hints stay readable when the pane is narrow.

  On the Code tab, Copy now copies the code you are looking at rather than the
  response body, and there is one copy button instead of two. Your choice of
  Nextly, fetch or cURL is remembered. Response status, latency and size hold
  their place so the panel no longer shifts when a reply arrives, and the
  empty-state text is no longer set in a code face.

- [#1265](https://github.com/nextlyhq/nextly/pull/1265) [`8cb76ed`](https://github.com/nextlyhq/nextly/commit/8cb76ed4b564975fe6a4cf41ef4b05d6c1c938b8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugins can now be built from the same controls the admin is built from.

  Until now a plugin author could reach for a `Card`, a `Stack` and a `Grid` — and
  then had nothing to put inside them. No button, no text input, no select, no
  dialog, no label. The guidance was to fall back to a stylesheet of your own,
  which meant every plugin that needed a button drew one that did not quite match
  the admin around it: a slightly different height, a slightly different focus
  ring, a slightly different blue. Those differences are what a design system
  exists to prevent, and they were arriving through the one door it did not cover.

  `@nextlyhq/plugin-sdk/admin` now exports the controls a settings form is
  actually made of — `Button`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Label`,
  `Select` and `Dialog` with their parts, plus the form scaffolding `FieldShell`,
  `FormSection` and `FormActions`. They are the admin's own components, so a
  plugin page inherits the admin's spacing, colours, dark mode and focus
  behaviour with no build step and nothing to keep in sync.

  This is what Payload, Strapi and Directus all do — the extension author gets the
  real component library rather than a curated subset of it.

  The set stops at what an ordinary form cannot be built without, rather than
  covering everything. A component that is exported becomes something plugins
  depend on, and adding a name later is a much smaller event for everyone than
  taking one away.

- [#1008](https://github.com/nextlyhq/nextly/pull/1008) [`1cfbe69`](https://github.com/nextlyhq/nextly/commit/1cfbe69cc6563ebf64d1ffa34e2c1e9425eb992a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed fields no longer report themselves as an unknown field type when the list of
  installed plugins fails to load. The list arrives from a session-gated request, and a failed one
  left it empty — which looked exactly like a project with no plugins installed, so a correctly
  installed plugin's field rendered a red "Unknown field type" error. Reloading usually fixed it,
  which made it look like an intermittent fault in the plugin rather than a failed request. The
  field now says the plugin list is unavailable and to reload, and a field whose editor is still
  loading shows a loading state rather than an error.

- [#1196](https://github.com/nextlyhq/nextly/pull/1196) [`2ed85ab`](https://github.com/nextlyhq/nextly/commit/2ed85abb8c113d8403dd41cc8013d0ea6960e350) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a plugin see the app's Singles.

  `ctx.services` has always been able to answer "what collections exist and what is in them", and had no counterpart for Singles — so a plugin sweeping the app's documents silently covered only half of it. `ctx.services.singles.list()` returns the declared Singles and their field definitions.

  Read-only and registry-only: it returns no Single's content and creates nothing. That last part is deliberate rather than incidental, because a read-shaped call on the Single path is not free of side effects in general — the readable half of the preview check creates a Single's row when it is absent, and a plugin walking every Single to build an index would otherwise bring every Single in the app into existence as a side effect of looking.

  Singles are addressed by slug here, because a Single's row may not exist until something writes to it, so its row id is not a name a caller can hold.

- [#1232](https://github.com/nextlyhq/nextly/pull/1232) [`f86de75`](https://github.com/nextlyhq/nextly/commit/f86de7523d5d5786dfe3803a3bed0340ca3ba7c6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Narrowing a column's precision or length now generates a migration.

  Changing a decimal from `numeric(10, 2)` to `numeric(5, 1)`, or a text column from `varchar(255)` to `varchar(20)`, produced no operation at all: the Schema Builder reported no changes, no migration was written, and the column kept its old size. The two declarations reduce to one type name, and the diff compared only the name.

  That was a deliberate trade-off when it was made — the note in the column builder says as much, and states the condition for lifting it: "resizing a decimal column needs a manual migration until the introspector captures numeric_precision/numeric_scale on the live side". The introspector has since done exactly that. The comparison now reads the declared size alongside the type name, so a resize is seen.

  Sizes are compared only when both sides state one. A column that is `varchar(255)` in the database against a field that asks for plain text is not a resize — it is two descriptions at different levels of detail — and treating it as a change would emit an operation on every apply against an existing database and never converge. That is the failure the name-only comparison existed to prevent, and it stays prevented.

  A resize was already classified as a destructive change, so it is confirmed before it runs rather than applied quietly. It now says what it is doing: the operation carries both declarations, where it previously carried the bare type name and would have described the change as "from 'numeric' to 'numeric'".

  A resize keeps the column's other attributes. MySQL spells a type change as `MODIFY COLUMN`, which restates the whole definition and drops whatever it does not restate — so a `NOT NULL DEFAULT '0'` column would come out of a generated resize nullable and defaultless, with no schema push behind the migration to put them back and no way for its DOWN to recover them. Both pairs now travel with the types.

- [#1176](https://github.com/nextlyhq/nextly/pull/1176) [`da85f3a`](https://github.com/nextlyhq/nextly/commit/da85f3a75796bbcf0817fd9705858900cc5a0e4e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Close two holes in the preset/stylesheet boundary check, and fix the v3 config example.

  The duplication guard read only the first `@layer components` block and only
  plugins written as a bare function. A cascade layer may be opened more than
  once, and Tailwind's own `plugin()` helper returns `{ handler, config }` rather
  than the function, so a rule restated through either route passed the guard
  while it reported a clean boundary.

  The Tailwind v3 config in the README was not valid JavaScript and omitted the
  scan path for the published bundle, so following it produced a syntax error and,
  once corrected, components with their utilities missing.

  Also records why three rows in the admin no longer pad themselves: the enclosing
  section supplies the rhythm, and the two paddings are additive.

- [#1201](https://github.com/nextlyhq/nextly/pull/1201) [`50ac759`](https://github.com/nextlyhq/nextly/commit/50ac7596c29fc8a8b818edd383ad2dbe3a8f5e43) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The editor can compile a page for a preview surface that is not the browser window.

  A responsive breakpoint says "apply below this width" and asks the browser window. An editor that
  shows the page inside a resizable box shares that window, so narrowing the box changes nothing about
  which rules apply — the block gets narrower and keeps its widest styling. This adds an option that
  emits those breakpoints against the box instead, so a preview shows what the page will actually look
  like at that width.

  Published pages are untouched. The option is off unless a caller asks for it, so a page's compiled
  stylesheet and its cached identity are byte-for-byte what they were.

  Breakpoints that respond to a block's own container are deliberately not previewable this way, and
  are emitted so that they match nothing rather than matching the preview box — a container breakpoint
  depends on where the block sits, and showing it against the surrounding editor would be wrong in a
  way that looks right.

- [#1230](https://github.com/nextlyhq/nextly/pull/1230) [`2bb8685`](https://github.com/nextlyhq/nextly/commit/2bb868512455b064bf175eff8637042560a9d2ce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The in-admin preview pane now works when the admin and the site share a host
  but differ by PORT — a contributor running the admin on `:3000` against a site
  on `:3100` gets the pane instead of being sent to a new tab.

  Whether a preview can be shown in a frame is now answered by the server, in the
  mint response, rather than by the browser comparing two URLs. The question is
  whether the preview COOKIE survives being framed, and only the server can see
  both halves of that: the site's address, and the `SameSite` attribute the cookie
  is actually set with. The browser was answering a question it could not see the
  inputs to — correct only while nobody changed the cookie, and wrong silently
  afterwards, because the failure mode is a frame that renders the PUBLISHED page
  under a draft caption.

  Being stricter than the truth was the visible half of that. The old test
  compared origins, and origins include the port while same-site does not, so the
  dev split above was refused for a reason browsers do not apply.

  The mint response carries `embeddable` beside `url` and `expiresAt`. It states
  that the SESSION reaches a frame, not that the frame will load: an application's
  own `frame-ancestors` is invisible from the server, and a caller must not read
  it as a promise that the embed succeeds.

  Where the server still declines, nothing changes — the pane says so and offers
  the new tab that works everywhere. That fallback is not a stopgap: browsers that
  block third-party cookies prevent an embedded cross-site preview regardless of
  the cookie's attributes, so every CMS that embeds one keeps a first-party
  fallback beside it.

  One limit is deliberate and recorded in the code. `admin.example.com` and
  `example.com` ARE same-site and would be safe to frame, and the server still
  refuses them, because separating that shape from `foo.github.io` and
  `bar.github.io` needs a public-suffix list this repository does not carry. The
  refusal is the affordable error: a wrong `false` costs a tab, a wrong `true`
  shows the published page and says it is a draft.

- [#1205](https://github.com/nextlyhq/nextly/pull/1205) [`188cf9f`](https://github.com/nextlyhq/nextly/commit/188cf9fccdcaa06f185401b18d397b6bc7dffd53) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Minting a preview link now leaves an audit record, and so does revoking every link.

  A preview link is a bearer credential: whoever holds one reads the draft it names,
  rendered through the MINTER's field-level permissions. Issuing and destroying those
  was invisible - `preview-links.ts` made no audit or activity call at all, so nothing
  recorded who opened a draft up, which document, or when the revocation that cut every
  reader off happened.

  Recorded to the security trail rather than the content one, because that is what this
  is. The activity log is content-shaped - its action is create/update/delete and it
  requires a collection - so a mint recorded there would surface in the dashboard feed as
  though someone had edited the entry. The `audit_log` beside it already carries the
  auth events, the actor model, the erasure path a deleted account needs and the retention
  window, and this is the same kind of event.

  The row names the document, the language, the expiry and the generation, and never the
  token: a trail carrying the credential would hand its reader the access it exists to
  describe. Written at the one point both the entry and Single mints funnel through, so
  neither path can be given a record the other lacks, and only after signing - a refused
  mint produces no credential and now leaves no row claiming otherwise.

- [#1152](https://github.com/nextlyhq/nextly/pull/1152) [`283525b`](https://github.com/nextlyhq/nextly/commit/283525bb526ac9ed4efeb23315d08a9ff7486c00) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Preview links work. The whole draft-preview stack shipped built and exported but never
  connected to anything: no application mounted `createPreviewRoute`, no content route consulted a
  preview token, and the copy-link button in the entry editor handed out a URL that answered 404.

  Mounting it is now one line, because `createPreviewRoute()` and `previewDraftGate()` take no
  required arguments. The signing secret, the revocation generation, Next's draft mode and the
  request's cookies are all facts about the booted instance rather than decisions a site makes, so
  they default — and a route file that costs a paragraph of wiring is a route file nobody writes:

  ```ts
  // src/app/api/preview/route.ts
  import { createPreviewRoute } from "nextly/runtime";

  export const { GET } = createPreviewRoute();
  ```

  Where a link lands is derived from the collection's own preview declaration — the `url` function a
  code-first collection carries, or the `urlTemplate` a UI-created one does — so nothing has to be
  restated. A site that routes its content some other way still supplies its own `redirectTo`.

  This no longer requires a configured site URL. The admin needs an absolute URL because it may be
  served from another origin; the preview route does not, because it is already running on the site,
  so a relative path resolves against the origin the visitor is standing on. Where there is no origin
  to compare against, the path's shape is checked instead, so a protocol-relative value cannot pass
  itself off as a local path.

  The absolute URL the admin hands out no longer requires one either. The **Site URL** setting still
  wins where it is set, because it is the only value that can name a site on a different origin from
  the admin — but where it is empty, `NEXT_PUBLIC_APP_URL` answers, which is the same chain media
  URLs and email links already resolve through and is already required in production. That setting
  starts empty on every installation and nothing prompts anyone to fill it in, so "Copy shareable
  link" previously answered "ask an administrator" on every fresh install, including one where the
  admin and the site are plainly the same application. A value that is not http(s) is refused from
  either source rather than copied to a clipboard.

  Add `draft: previewDraftGate()` to the content route the link lands on. Without it the route serves
  published entries only, and a preview link verifies, redirects, and then answers 404 from a page
  that looks entirely correct.

  A collection that declares no preview URL now refuses to mint a link, instead of reporting success
  and handing over one that answers 404. Nextly cannot work out where an entry is served — only the
  application knows whether a post with the slug `hello-world` is at `/hello-world` or
  `/blog/hello-world` — so a collection says it:

  ```ts
  admin: {
    preview: {
      url: entry => (entry.slug ? `/blog/${entry.slug}` : null),
    },
  },
  ```

  The "Copy shareable link" button still appears either way, deliberately: hiding it would leave an
  editor with a feature that vanished and nothing explaining why. Refusing at the click puts the
  cause, and the fact that a developer is the one who fixes it, in front of the person who hit it.

  The page builder's own `pages` collection declares one when — and only when — the host says where
  those pages are served: `pageBuilder({ pagePreviewPath: "/{slug}" })` for pages at the site root,
  `"/blocks/{slug}"` for a site that mounts them under a prefix. There is deliberately no default.
  The plugin cannot install your preview route or your draft gate and cannot discover where you
  mounted your pages, so a defaulted path would let an editor mint a link that resolves to nothing —
  strictly worse than the refusal, which names what a developer needs to add. Passing the option is
  how an app states that it has done the wiring.

  In development, a content route that receives a valid preview link while declaring no
  `draft` hook now says so, naming the hook to add. Production is unchanged: every refusal stays an
  identical 404, because one that varied by cause would let a stranger discover which entries have
  drafts.

  The preview mount is validated when configuration is read, rather than when an editor clicks "Copy
  shareable link". `preview.route` names where your app mounts `createPreviewRoute`, and a value that
  cannot produce a working link — one pointing at another origin, or carrying a query, a fragment or a
  `..` segment — stops the boot with a message naming the value and the remedy. Previously the first
  sign of a bad mount was an editor being refused a link, and the person who can fix it is not the
  person reading that message.

  It is resolved after plugin `setup` transformers run, so a mount a plugin adds or replaces is
  checked as the one a link is actually built from, and the normalised value is what the container
  carries: `"/api/preview/"` no longer means one thing where it is read and another where it is used.

  A mount carrying its own query is refused rather than accepted and mangled. The link's `token`
  parameter is appended to this path, so `"/api/preview?tenant=a"` was assigned as a pathname and
  handed out as `/api/preview%3Ftenant=a` — a link that reaches no route and carries no token. A `..`
  is refused for a related reason: it resolves against whatever base the link is built on, and a site
  URL carrying its own path is a different base from the origin, so the mount would not be the one the
  value names.

  New guide: **Draft Preview Links**.

- [#1167](https://github.com/nextlyhq/nextly/pull/1167) [`01fd952`](https://github.com/nextlyhq/nextly/commit/01fd95249ba1bfa9cabf7506b599c8ddc14b357b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Singles can be previewed. A Single is draftable — it carries the same Draft / Published lifecycle a
  collection does — and was structurally unable to produce a shareable link: the preview token could
  only name a collection and an entry id, and a Single has neither.

  A preview token now names either an entry or a single. Every token already minted keeps verifying,
  byte-identically: the entry variant's discriminator is optional and an entry token is still signed
  without it. An unrecognised kind is refused rather than defaulted.

  Declare where a Single is served, as you would for a collection:

  ```ts
  export const Homepage = defineSingle({
    slug: "homepage",
    status: true,
    admin: { preview: { url: () => "/" } },
  });
  ```

  Then gate the route that renders it — `createSingleRoute` for a hand-rendered Single, or
  `createSinglePage` for one built in the page builder, which accepts the hook now:

  ```ts
  const { SinglePage, generateMetadata } = createSinglePage({
    slug: "homepage",
    field: "layout",
    draft: previewSingleDraftGate(),
  });
  ```

  `previewSingleDraftGate()` answers yes or no rather than handing back an id, because a Single has
  exactly one document: the gate's subject and the token's subject are the same thing, so there is no
  second row to check the answer against. A granted draft read is trusted and uncached — trusted
  because the working-draft overlay is gated on edit capability while the route resolves anonymously,
  and an enforced read would return published values while reporting success; uncached because a
  draft is per-visitor, and one cached draft is served to everyone who asks next.
  `createPublicSingleRoute` refuses the hook outright for that reason.

  The Single editor offers "Copy shareable link" on the same terms as the entry editor, including the
  refusal that names what a developer must add when no preview URL is declared. On a localized Single
  the link is scoped to the language being edited — including the DEFAULT language, where the editor
  represents the active locale as "none". An absent locale claim is not "the default language": it
  authorizes every locale, so a link minted that way would open translations that have never been
  published.

  Minting authorizes the view the token hands out, rather than the coarser one that is easier to ask
  for. Three things it now checks that it did not: the caller's **read** grant — the mint route gates
  on `update`, so nothing had established that whoever asks may read the document at all; the Single's
  own **stored access rules**, evaluated against the loaded document; and the **translation the token
  names**, since a custom rule can allow the default language and deny the one being shared.

  A localized Single with no locale named is refused outright. An absent locale claim covers every
  translation, so honouring the request would hand out the grant the refusal exists to withhold.

  Minting evaluates the Single's own stored access rules, not just the coarse per-slug permission.
  Owner-only, role-based and custom rules are decided against the loaded document and can deny a
  caller who holds the permission — and a link is a bearer credential for the draft, so authorizing it
  on the permission alone handed out a view the real update path refuses. That evaluation is now one
  function shared with version history, which gates the same kind of disclosure for the same reason.

  **`createSingleRoute` and `createSinglePage` gain `trustedCollections`, and it defaults to nothing.**
  A draft grant names ONE document and says nothing about what that document points at, so the
  trusted read it triggers no longer spreads to everything the Single populates — a target reached
  through a relationship is read the way an anonymous visitor would read it unless you name it:

  ```ts
  createSinglePage({
    slug: "landing-page",
    field: "hero",
    trustedCollections: ["posts"],
    draft: previewSingleDraftGate(),
  });
  ```

  This is the same option, with the same meaning, that `createContentRoute` already carries. It only
  ever narrows, and it applies to `createPublicSingleRoute` too — a public Single page that populates
  relationships and needs them read as trusted must now name those collections. The bound is part of
  the cached read's key, so two routes mounting one Single with different bounds no longer share a
  cache entry: without that, the more-trusted route warms the cache and the other is served its
  populated restricted rows having never run its own bound.

  `SinglePreviewConfig` is exported from `nextly/config`, so a typed preview declaration can be
  defined or shared the way `CollectionPreviewConfig` already allows.

- [#1237](https://github.com/nextlyhq/nextly/pull/1237) [`a86a5c4`](https://github.com/nextlyhq/nextly/commit/a86a5c4be48b1576f150ba6a4b40158c0f5ed05f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The in-admin preview pane can now be shown at a chosen viewport width instead of
  whatever width the editor happened to leave it.

  This matters more than it sounds. The pane sits in a split that reserves a
  minimum editor, so at its default position the preview is a few hundred pixels
  wide — which means it was faithfully previewing a MOBILE viewport, decided by
  wherever the divider was last dragged rather than by anything anyone chose. The
  two controls were also coupled: widening the preview meant narrowing the editor
  being typed into.

  Choosing a width now does two things in order. The split gives the preview as
  much room as the minimum editor allows, and only whatever still does not fit is
  scaled down. On a wide window nothing is scaled at all.

  A scaled frame keeps its requested width, so the site's own media queries still
  resolve against the viewport being previewed and the preview stays truthful
  about layout. What it stops being truthful about is physical size — text renders
  smaller than a visitor would see it — so the toolbar always states the real
  width and the scale beside it rather than letting the shrinking pass unremarked.

  This release ships the control with **Responsive** and a custom width. Named
  presets follow: they will come from a collection's own declaration where one
  exists, and from the site's page-builder breakpoints otherwise, so a preset can
  never disagree with the breakpoints the site actually uses. No phone/tablet/
  desktop numbers are invented here, and there are deliberately no device icons —
  a site names its own breakpoints, and no glyph is honest for a tier an author
  called "Kiosk".

  The toolbar wraps instead of running off the edge. At a 1024px window the pane
  is about 450px wide, and a viewport select, a width box, a scaling note and
  three actions do not fit on one line — the pane clips its overflow, so
  open-in-a-new-tab and close sat past the edge with no way to scroll to them.
  Measured in a browser at that width: they were 40px and 98px outside the
  clipping box, and hit-testing their centres reached nothing. The three actions
  stay together as one unit, so the row breaks between the viewport control and
  them rather than through the middle of them.

  Clearing the width box no longer takes the box away. It held one value for two
  different facts — what the box says and what the frame is sized to — so an empty
  box committed "no width", which selected Responsive, which removed the input the
  author was typing in. The text being typed is now kept separately, and a width
  is committed only once the box names one a frame can be sized to.

  The custom width box commits the whole number it shows. `parseInt` read `390.5`
  as `390` and `1e3` as `1` — both of which a number input accepts and displays in
  full — so the frame was sized to a width the box was not showing, and blurring
  replaced the author's text with the truncated value.

  The pane measures itself before the browser paints rather than after, so a frame
  cannot be drawn at the wrong width on the way to the right one.

  The custom width is taken when you stop typing, not on every keystroke. The
  frame is a live iframe of the site, so each committed width re-lays-out a whole
  page — and clearing the box to type `768` emits `7`, `76`, `768`, collapsing the
  preview to 7px and then 76px on the way. Leaving the box commits immediately, so
  a width typed and clicked away from is not lost. Widths below one pixel are
  refused: the input's `min` marks the field invalid without clamping it, and
  below a pixel the preview is not narrow but absent.

- [#1225](https://github.com/nextlyhq/nextly/pull/1225) [`af3a434`](https://github.com/nextlyhq/nextly/commit/af3a434466e07f9225cf0c4242a14b60a77605bb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Opening or closing the preview no longer throws away work in progress.

  The preview pane wrapped the editor only while it was open, so every toggle put
  the editor at a different place in the component tree and React unmounted and
  rebuilt the whole thing. Anything a field was holding that had not yet reached
  the form went with it — and the field most likely to be holding something is the
  one deliberately keeping a value the form would reject, such as JSON mid-edit
  that is not valid yet. Clicking Preview discarded it silently: no error, no
  prompt, the field simply showed its last saved value again.

  The editor now stays in one place whether the preview is open or shut. Closed,
  the pane's own elements generate no box at all, so the page is laid out exactly
  as it would be if the pane were not there — the same mechanism the editor
  already uses to hand its measure to the page builder.

  The split itself is now built from ordinary elements rather than the resizable
  panel library, because that library sizes its panels with inline styles that no
  stylesheet can stand down: a panel wrapping the editor while the preview was
  closed would clip it and move scrolling off the page. The divider keeps its
  keyboard support — arrow keys nudge it, Home and End take it to either limit —
  and reports its position to assistive technology as it moves.

- [#1217](https://github.com/nextlyhq/nextly/pull/1217) [`e3843ab`](https://github.com/nextlyhq/nextly/commit/e3843abae557e023ce53b3ae39fde1790c02ae61) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Asking for a preview link that cannot be built now says which of seven things
  is wrong, instead of telling every editor to fill in a slug.

  The resolver behind preview links refuses for seven distinct reasons: the
  document is confirmed gone, the document could not be READ at all, the collection
  declares no preview, the declaration yields no address for this document yet, the
  declaration FAILED while running, the address it yields is on a different site,
  or it does not parse. All of them arrived as
  one message — "this entry has no preview address yet, so filling in the fields
  its preview URL is built from — usually the slug — makes it shareable." For most
  of them that is wrong and unactionable. An editor whose slug was already correct
  was sent to look at the one field that was not the problem, and a preview URL
  pointing at another origin is something no field on the entry can change.

  Each refusal now names its own remedy and the person who can apply it — a
  missing declaration is a developer's job, an empty slug is the editor's, and a
  foreign origin belongs to whoever owns the preview URL or the site URL setting.

  **A failed read is no longer reported as a deletion**, and that pair is worth
  calling out because the two diagnoses are opposites. A transient database error,
  a rate limit, or a throwing read hook establishes nothing about whether the
  document exists — so the read reports absence only on a 404, and anything else
  now says "could not be read just now, please try again in a moment" rather than
  telling an author their work may have been deleted while it sits there intact.
  Reads that report failure by throwing rather than by returning an envelope, which
  is how the Direct API answers for Singles, are translated the same way.

  **The public preview route is deliberately unchanged and still answers all seven
  with the same 404.** That is not an oversight: distinguishing them there would
  let a stranger holding a forged token tell a deleted entry from an unpublished
  one from a collection that has no preview, which is an oracle for what exists in
  draft. The reasons are surfaced only on the authenticated path, where the caller
  already holds edit access on the document and learns nothing by being told —
  enforced by a capability the anonymous path cannot construct, rather than by a
  comment asking callers not to. The route's answer is DERIVED from the detailed
  one in a single place rather than computed alongside it, so the two cannot drift
  into disagreeing about when to refuse.

- [#1172](https://github.com/nextlyhq/nextly/pull/1172) [`1ac7062`](https://github.com/nextlyhq/nextly/commit/1ac7062ba794b84e894afc0b98e71a23f3883155) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A preview link no longer shows its recipient fields the person who shared it cannot see.

  A granted draft read is trusted — that is what lets the working draft appear at all, since the
  overlay is gated on edit capability while a preview route resolves anonymously. But ONE flag
  decided both row trust and FIELD trust, so trusting the row switched field-level read rules off
  along with it and the page rendered every field. An editor denied a field could therefore read it
  by sharing a link and opening it themselves.

  Those two trusts are now separate. A read can say `enforceFieldAccess: true` beside
  `overrideAccess: true` — keeping the row bypass, giving up the field one — and the rules are then
  evaluated as the `user` it names, inside the query pipeline's own before-and-after-hooks passes.
  That placement matters: an `afterRead` hook runs between them, so a hook cannot copy a denied field
  onto an allowed one. Omitting the new option is exactly today's behaviour, so no existing caller
  changes.

  The preview route uses it to render a draft as the person who shared it. The token records who that
  was — as a basis for field rules, never as an identity: the bearer is still anonymous and still
  reaches exactly the one document the link names. It is applied to the draft read alone; once a
  grant stops answering a path the request is an ordinary anonymous one again, and public content is
  not judged by a stranger's rules.

  Revocation reaches links already in circulation, and it takes two things rather than one. The
  identity is re-read on every render rather than frozen into the token, so a deleted or deactivated
  account stops rendering immediately. But rebuilding an identity re-evaluates FIELD rules and
  nothing else — the read still bypasses the row and collection checks — so the render also re-asks
  the question the mint asked: may this person still preview this entry. A sharer who keeps their
  account and loses their authority stops serving the draft on the next render.

  A link whose sender cannot be identified — an account since deleted or deactivated, or a token
  minted before the record existed — is refused rather than rendered. Rendering it as nobody would apply no field rules
  at all, which is the leak itself; the visitor sees the published page or a 404, the same as an
  expired link. Links minted in the hour before this ships therefore stop working, and re-sharing is
  the remedy.

  One limit worth knowing. A deployment authenticating through its own provider can put arbitrary
  claims on a token, and those exist only for the duration of a request. A field rule reading one
  sees it absent here — and absence is not the safe direction, since `user.tier !== "restricted"`
  passes when `tier` is missing. Such a rule can show a field in a preview that it withholds from the
  sharer's own admin view.

- [#1211](https://github.com/nextlyhq/nextly/pull/1211) [`9ae5707`](https://github.com/nextlyhq/nextly/commit/9ae5707a103e8d322c8f36efe841d265658bfb86) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An entry can now be edited beside the page it becomes. A new control in the editor
  opens a preview pane: the editor keeps the left of the screen, the site renders in a
  frame on the right, and the divider between them moves.

  The frame is an IFRAME rather than the page redrawn inside the admin, and that is the
  decision the rest follows from. A frame is a real browsing context with a real
  viewport, so the site's own responsive rules resolve exactly as they do for a visitor,
  and its document is the site's — nothing the admin styles reaches in and nothing the
  site styles reaches out.

  It shows the last SAVED draft, and says so on the toolbar rather than leaving an
  author to infer it. Saving refreshes it. Autosave does not, and cannot: autosave
  records a private per-author recovery point while the preview reads the working draft,
  so the two are different rows and moving one changes nothing the other can show.
  Making them the same thing would let anyone holding a preview link read half-typed
  content, which is a decision about who sees unfinished work rather than a refresh
  strategy.

  Opening the pane releases the editor's 56rem measure by ASKING for it, the way the
  page builder asks, rather than by the page declaring a second width — so a reader who
  never opens the preview gets exactly the page they had. The admin's navigation stays:
  this is a pane beside the editor, not a surface that took the window.

  The credential is minted when the pane opens and re-minted only as it approaches
  expiry. An ordinary refresh remounts the frame, so watching a page through a long edit
  does not issue a bearer credential per save.

  Two situations leave the pane empty with a sentence rather than a frame, because in
  both the browser would quietly serve the PUBLISHED page into something captioned as a
  draft. A site served from a different address than the admin cannot receive the preview
  cookie in a frame at all — the Preview button still opens it in a tab, which works
  everywhere. And because a site keeps one preview session per browser, opening previews
  for two different entries takes the session from the first; that pane now says so and
  takes it back when refreshed, instead of showing published content under a draft label.
  The default scaffold, where the admin is mounted inside the site's own app, is affected
  by neither.

- [#1250](https://github.com/nextlyhq/nextly/pull/1250) [`c3000c4`](https://github.com/nextlyhq/nextly/commit/c3000c4a327d78281abe2acac110ae39fa18a7db) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The pane toggle says what clicking it will do again. A collection that declares
  no preview label was handed the defaulted "Preview", so the button read
  "Preview" in both the open and closed states instead of "Show preview" and
  "Hide preview". The declared label now travels and absence is preserved, which
  is what lets the button and the pane each apply the wording its own sentence
  takes.

  Choosing "Custom width" always opens the box. It commits a seed width, and where
  a site declared a viewport at that same width — 1280 is the seed and an ordinary
  desktop tier — the control resolved it as that preset and never showed the
  input, so a custom width could not be entered at all.

  A named viewport is previewed at exactly the width it declares. Widths are no
  longer rounded, so a site can offer 767.6 — and reading the chosen option with
  `parseInt` sized the frame to 767, one side of the site's own
  `@media (max-width: 767.6px)` boundary, then matched no viewport and showed
  "Custom" for an option just picked by name.

  A fractional custom width no longer reads as invalid. A number input steps by 1
  unless told otherwise, so the browser reported a committed `390.5` as a step
  mismatch while the preview was using that exact width.

- [#1237](https://github.com/nextlyhq/nextly/pull/1237) [`3e058be`](https://github.com/nextlyhq/nextly/commit/3e058beb345b0c52694fdf853e459c19008223cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The preview pane's viewport control now offers named widths, and they come from
  the site rather than from a list Nextly invented.

  A collection or Single can declare them:

  ```typescript
  admin: {
    preview: {
      url: entry => `/blog/${entry.slug}`,
      breakpoints: [
        { label: "Phone", width: 390 },
        { label: "Desktop", width: 1280 },
      ],
    },
  }
  ```

  `breakpoints` also accepts a FUNCTION, evaluated per link on the server. That is
  what lets a source which changes stay current: a page-builder site keeps its
  breakpoints in stored data an author edits, and a list captured when the config
  was defined would go stale the moment they change one.

  `@nextlyhq/plugin-page-builder` supplies exactly that for sites that use it:

  ```typescript
  breakpoints: previewViewportsFromSiteStyle({ reader: async () => /* ... */ })
  ```

  so the pane offers the site's OWN tiers, by the names their author gave them,
  read through the same reader the style compiler uses — a preset therefore cannot
  name a width the compiled stylesheet has no rule for.

  Where neither is declared, the control keeps Responsive and a custom width.
  Nothing invents phone/tablet/desktop numbers, because nothing here can know the
  widths a site's CSS actually breaks at: a site whose tablet is 991px would
  otherwise get a "Tablet" preset that sizes the frame to 1024 and lands in a tier
  its stylesheet never uses.

  A malformed row is dropped rather than failing the list, and a declaration that
  throws costs its presets rather than the preview — these are a convenience on
  top of a credential handout, and losing the link is the worse outcome.

  The page builder's own `pages` collection offers them too. The helper that reads
  a site's breakpoints was exported but nothing in the standard
  `pageBuilder({ pagePreviewPath })` flow could hand it to that collection, so the
  presets reached only collections a host had composed by hand — not the primary
  page-builder workflow. It is now the default, since a page-builder site's
  breakpoints are the widths its stylesheet changes at. Pass
  `pagePreviewBreakpoints` to override it, or `false` to offer none.

  `pagesCollection` takes one options object instead of two positional arguments,
  which is what those two said to do as soon as a third arrived. Call
  `pagesCollection({ previewPath, limits })` in place of
  `pagesCollection(previewPath, limits)`.

  A Single can declare `breakpoints` as well. The mint path already resolved
  whatever a preview declaration carried without knowing which kind of document it
  came from, but `SinglePreviewConfig` listed only `url`, `openInNewTab` and
  `label` — so the feature was reachable from no Single at all.

  Two viewports that could mislead are now dropped rather than offered. A declared
  width below half a pixel rounded to `0`, producing a named "0px" option that
  previewed the full pane instead. And where two breakpoint definitions claim one
  id, the label and the width could come from different rows — the compiler keeps
  the widest, a lookup by id alone kept the last — putting one tier's name on
  another's width. Both sides are now read from the definition that survived.

- [#1243](https://github.com/nextlyhq/nextly/pull/1243) [`569c262`](https://github.com/nextlyhq/nextly/commit/569c262c1952adb32274f21615f95f209a05cd7f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now ask whether a collection stores a working draft beside its published row.

  `collectionDraftSplit(collection)` answers it, and takes the collection AS AUTHORED - so
  `versions: true` and `versions: { drafts: true }` both work, rather than the resolved
  `{ drafts: { enabled } }` shape that only exists after config load and that nobody writes by
  hand. It is published through `@nextlyhq/plugin-sdk`, which is the surface a plugin may
  depend on.

  The framework already answered this question internally; it was reachable from no public
  entry, so a plugin had two options and both were wrong. It could
  guess from `status: true` - the obvious flag, and true for collections that store no draft at
  all - or it could reimplement the five conditions the split really resolves from: versioning
  resolving `drafts.enabled`, `status: true`, no reachable password field, every reachable
  component schema resolving, and no component carrying one.

  Either way a plugin keying its own data by published/draft writes records against a document
  that does not exist, and nothing downstream can tell those records from real ones. The
  page-builder's class-usage index is the first case; any plugin storing anything per variant
  has the same problem.

  The reason travels with the verdict rather than being reduced to a boolean, so a caller can
  say WHY a collection it expected to draft does not.

  The collection shape it accepts is PROJECTED from `CollectionConfig` rather than restated
  beside it, so the three properties the question reads carry whatever the authoring type says
  they carry. A parallel declaration would keep compiling after `CollectionConfig` widened one
  of them, and a collection an author can legally write would then be rejected by the helper
  published to read it - with nothing failing anywhere, because the function and its exported
  type would share the stale copy.

  Published from the package root rather than `nextly/config`, because answering the question
  reaches the component registry through the service container, and `config` is a client entry -
  exporting it there would pull server code into a browser bundle.

- [#1260](https://github.com/nextlyhq/nextly/pull/1260) [`5a1a770`](https://github.com/nextlyhq/nextly/commit/5a1a770fb646465667d69b785052fcfba0316c76) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now ask whether a collection stores a working draft when that collection was
  created through the SCHEMA BUILDER rather than written in config.

  `collectionDraftSplit` answers for authored config. A Builder collection is not that: it lives
  in the dynamic registry, and the registry stores `versions` already RESOLVED -
  `dynamic_collections.versions` holds `{ drafts: { enabled } }`, not the `true` or
  `{ drafts: true }` an author writes. Handing that record to the authored form is rejected by
  the checker, and from untyped code it answers `false` for a collection whose drafts are ON,
  because nothing named `drafts.enabled` is there to read.

  That failure is silent and total for a whole class of collections. A plugin keying its own
  data by published/draft would omit every Builder collection's draft entirely while reporting
  success - and the page-builder's class-usage index is exactly such a plugin, so this is a
  prerequisite for it rather than a convenience.

  `resolvedCollectionDraftSplit` takes the registry's record. The function already existed and
  already took this shape; it was reachable from no public entry, so a plugin that could FETCH a
  Builder collection had no supported way to ask this of it.

  Two functions rather than one accepting either, and the type test asserts they reject each
  other in both directions. The inputs overlap in neither, and a single function would have to
  guess which it was handed - `versions: true` and `{ drafts: { enabled: true } }` are both
  values a runtime check can misread, and guessing wrong fails in the direction that silently
  disables drafts. Which one to call is decided by where the collection came from, which the
  caller knows and the value does not say.

  Renamed at the boundary. Internally it is `schemaDraftSplit`, named for the caller it was
  written for; a published name has to say what it TAKES, because that is the only thing a
  plugin author choosing between the two can see.

- [#1275](https://github.com/nextlyhq/nextly/pull/1275) [`727f256`](https://github.com/nextlyhq/nextly/commit/727f25622e81ea67abe7d6d17031ecc64c370e8b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The renderer no longer passes a stored `null` into a compile input declared as a value, and the type it publishes for its reconciled inputs now admits the `null` it can genuinely return. A colour draft also survives a right-click on a Reset, which invokes nothing.

- [#1157](https://github.com/nextlyhq/nextly/pull/1157) [`04de93b`](https://github.com/nextlyhq/nextly/commit/04de93b6bc10ba1cd5a6ecebc7d10ac191a66cc7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Record which named classes each page references, so the classes UI can answer
  "where is this used" as a lookup rather than by walking every stored document.
  A hidden `usedClasses` field on the pages collection is derived in the same
  write that saves the page, so no window exists where a page is stored and its
  record is not. The walk is total over persisted data: a malformed document
  contributes what it can read instead of failing an author's save, and it keeps
  the readable entries of a partly-malformed class list because under-counting is
  the direction that gets a class deleted.

  `walkNodes` now skips an entry that is not an object and a slot whose children
  are not an array, rather than throwing. It is shared by everything that reads a
  document, so one malformed entry previously broke counting, measuring and
  rendering alike — each looking like a fault of its own.

  It also walks iteratively and skips a node already on the path from the root to
  itself, so neither a forest nested deeper than the call stack allows nor a slot
  holding one of its own ancestors ends the walk with a `RangeError`. Depth is a
  validation rule and this walk runs on documents whether or not validation passed
  on them. Tracking the ancestor path rather than every node seen keeps one node
  object placed in two slots visited twice, which is what lets an insert still
  detect a duplicate ID inside an incoming subtree.

  Its third parameter now accepts a `WalkOptions` object — `parent`, `maxNodes`
  and `onCycle` — and still accepts a bare parent node, so a caller compiled
  against the previous signature keeps working. `maxNodes` ends the traversal
  rather than only skipping work in the callback, and the walk holds each list
  with a cursor instead of seeding one stack entry per top-level node, so the
  budget bounds a very wide root array too. Traversal order and the parent each
  callback receives are unchanged.

  The node selection both readers use is now one function, `selectNodes`, exported
  from the engine and consumed by the style compiler and by the class-usage
  record. They previously stopped at the same NUMBER by different walks, and equal
  limits reached by different walks select different nodes: a document whose first
  root nests deeply spends the whole budget inside it under a depth-first walk and
  reaches later top-level siblings under a level-ordered one. A class on such a
  sibling was styled and rendered while being absent from the record a safe-delete
  check reads.

  `insertNode` refuses a subtree containing a cycle. The shared walk is
  cycle-tolerant so that readers answer rather than fail, which makes the repeat
  invisible in what it visits; the walk now reports a skipped cycle, and the
  insertion guard refuses on it. Accepting one produced a cyclic forest at the top
  level and a `RangeError` when inserting into a parent.

  The page-builder plugin, its pages collection and `rebuildClassUsage` take the
  document `limits` pages are rendered under. `PageRenderer` already accepted
  them, so a host raising them rendered more of a document than the usage record
  counted — a class on a node the page draws was missing from the list a
  safe-delete check reads. Left unset, every side uses the engine defaults and
  agrees by construction.

  The page-save hook leaves a write that says nothing about `usedClasses`
  completely alone. On a drafts-enabled collection, publishing sends `status` by
  itself and the mutation service folds the promoted draft UNDER the post-hook
  payload, so a value derived here from the outgoing live row replaced the record
  the draft accumulated from the very content being published.

  An incomplete derivation is no longer recorded. `classUsageOf` replaces
  `classIdsUsedBy` and returns whether the whole document was read; when a bound
  stopped the selection, the write hook removes the field and the rebuild counts
  the page as `undetermined` rather than storing a list. The record exists so a
  class can be deleted safely, and a delete check reads a missing id as evidence
  the class is unused — so a list truncated by a bound would licence exactly the
  deletion it is there to prevent. A page with no record blocks deletion until a
  rebuild can give it one, which is the same position a page written before the
  field existed is already in.

- [#1274](https://github.com/nextlyhq/nextly/pull/1274) [`8ed9caf`](https://github.com/nextlyhq/nextly/commit/8ed9caff4e922b5860dd1a82c79ef7c8c34f5038) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A language switch that was refused no longer fills a language later. Asking to
  start one language from another travels with a navigation, and on a dirty form
  the unsaved-changes guard holds that navigation until the author answers. When
  they chose "Keep Editing" the request stayed behind — so reaching that language
  afterwards by any other route, browser history or a later switch, opened a copy
  confirmation for something declined minutes earlier, with nothing on screen to
  explain why.

  The guard now says when it was refused, and both ways out of it count: the
  button and dismissing with Escape. Confirming still carries the request through,
  which is the case that must keep working — reporting a refusal there would drop
  the intent at the one moment it was meant to be honoured.

- [#1081](https://github.com/nextlyhq/nextly/pull/1081) [`b5d9429`](https://github.com/nextlyhq/nextly/commit/b5d9429426c9ee4f7e83d5a82e30d3538de90bdf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Code-defined `access` blocks are registered for every config, not only one that
  declares code-first collections. The registration ran inside the collection
  sync, which returns early when there are none, so an app defining only Singles
  never registered their rules — and an unregistered rule does not fail closed,
  it stops applying, falling through to the caller's stored permissions.

- [#1086](https://github.com/nextlyhq/nextly/pull/1086) [`4603031`](https://github.com/nextlyhq/nextly/commit/46030314646b31181fac2023b1bdbd4fcb46e311) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder's `customCss` field and the permission gating it are removed.
  Nothing rendered what the field stored and nothing sanitized it, while a
  permission in front of it implied its safety had been considered — so the change
  that added the missing render call would have had every reason to treat the
  stored text as already clean.

  **Upgrading:** the `customCss` column on the `pages` collection is no longer
  declared, so a schema sync will offer to drop it. Anything stored there was
  never rendered on a page.

  Two type comments claiming this CSS was sanitized and scoped now say plainly
  that it is neither.

- [#1331](https://github.com/nextlyhq/nextly/pull/1331) [`01f4c8a`](https://github.com/nextlyhq/nextly/commit/01f4c8a53eb48003b835b110b1624ac101645a15) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Retire the per-page `usedClasses` record in favour of the class-usage index.

  Two mechanisms answered "which documents reference this class". `usedClasses`
  was a hidden JSON field on each page holding the ids its document referenced;
  `nx_pb_class_usage` is a queryable index maintained on every write. The field
  was written on four paths and read by nothing but its own rebuild deciding
  whether to rewrite it, so it could not answer the question it was kept for —
  that answer already came from the index.

  Removed, and therefore breaking for anyone importing them:
  - `rebuildClassUsage`, and the `PageUsageStore` and `RebuildReport` types.
    `rebuildClassUsageIndex` is the equivalent and rebuilds the index the
    plugin actually reads. The two names differed by one word while doing
    unrelated things, so a host wiring the repair path could reach the one that
    maintains nothing.
  - The `usedClasses` field on the `pages` collection, with the `beforeChange`
    hook that derived it.
  - The `limits` option on `pagesCollection`. Nothing consumed it once the
    derivation went, and an option that is accepted and ignored is worse than
    one that is absent.

  Hosts that called `rebuildClassUsage` should call `rebuildClassUsageIndex`,
  which takes the collection, field, locale and variant it walks.

  The `pages.usedClasses` COLUMN needs a deliberate schema step, because the
  field leaving the collection makes it live-only and the diff emits
  `drop_column` for it. What happens next depends on the classifier mode:
  - `dev-additive`, which is the HMR boot-apply path: the drop is skipped with
    a warning and the column stays.
  - Interactive sync: a destructive-drop confirmation naming the table and the
    row count.
  - `production-strict`, which is migrate Phase 1: the sync REFUSES while any
    destructive operation is present, so a deploy stops until the drop is taken
    deliberately.

  Taking the drop is safe — the column holds a derived value nothing reads —
  but it is a data-losing operation and this does not perform it for you.

- [#1111](https://github.com/nextlyhq/nextly/pull/1111) [`56de024`](https://github.com/nextlyhq/nextly/commit/56de024d1af68908e738593bbb28fed70908089c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A surface that needs to edit this site's rich text outside the admin's own field — the page builder's
  canvas is the first — can now load the same node classes and theme the field editor registers, through
  `loadRichTextEditorKit()` on `@nextlyhq/plugin-sdk/admin`.

  Sharing the registry is the point. Lexical recognises content by the identity of the classes that
  wrote it, so an editor built on a different set reads existing rich text as plain text — silently, at
  read time, on documents that already saved.

  The loader is async because the node classes carry Lexical and PrismJS with them, a 630KB chunk the
  admin deliberately keeps behind a dynamic import. Awaiting it is what keeps that weight away from
  consumers who never open an editor.

- [#1297](https://github.com/nextlyhq/nextly/pull/1297) [`682924c`](https://github.com/nextlyhq/nextly/commit/682924c32bf54e4b39561938fae967afe37282af) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read an empty rich-text document as an absence in the version diff, so a
  field moving between `null` and Lexical's canonical empty document no longer
  reports as added or removed, and no longer renders a blank added block.

- [#1121](https://github.com/nextlyhq/nextly/pull/1121) [`3b93cd9`](https://github.com/nextlyhq/nextly/commit/3b93cd9760d9589d28987bcff801151da310608d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Rich text can now live in a block and render on a published page. A block prop
  holds exactly what the rich-text field holds — Lexical's serialized tree — so an
  author's rich text is one kind of thing wherever they typed it.

  The type, the format bits and the "is this rich text" test move into
  `blocks-engine`, which the CMS and the renderer both already depend on, and the
  CMS now reads them from there instead of keeping its own. The two cannot share a
  READER: the renderer is forbidden from importing the CMS. They can share a
  DEFINITION, and now do, so the two can only disagree about output and never
  about what the data means. The copies this replaces had already drifted — the
  CMS's test accepted a root with no `children`, which its own serializer could
  only render as empty.

  A stored link URL is now sanitized before it reaches an `href`, through the same
  boundary every other stored URL in the renderer crosses; a destination that
  boundary refuses renders as the author's words rather than as a link. Links keep
  the `target` and `rel` the editor stored. Lexical's three case formats are
  recognised rather than dropped, and horizontal rules, tables, code blocks and
  collapsible sections render as themselves instead of as loose text.

  Two fixes to how stored text is read. A malformed node — a `null` where a node
  belongs — is skipped rather than throwing during the render of a published page.
  And plain-text extraction no longer inserts a space between every text leaf,
  which turned a part-bold `prefix` into `pre fix` for anything reading it for
  search or SEO; separators now fall at block boundaries, and the walk is
  iterative so a deeply nested value cannot exhaust the call stack.

  Dragging a block on the canvas no longer selects its text instead of moving it.
  Blocks are made of text, so a press that lands on a word and then moves is
  ambiguous, and the browser resolved it first: selection begins on the first
  move, while the drag engine waits for the pointer to travel far enough to mean
  a drag. Whether a given press hit a word depended on where the glyphs fell, so
  the same gesture worked or failed depending on the font. The canvas now treats a
  press as a grab, and text being edited opts back in to being selectable.

- [#1244](https://github.com/nextlyhq/nextly/pull/1244) [`5599ca8`](https://github.com/nextlyhq/nextly/commit/5599ca83b35be9704d32e617e5d051d8f04642f6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Rich-text font, size, colour and highlight now reach the published page.

- [#1229](https://github.com/nextlyhq/nextly/pull/1229) [`d84cb2b`](https://github.com/nextlyhq/nextly/commit/d84cb2bab026dd7e83490d867c60e7b07ee531a3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Images, galleries and buttons inside rich text render on the page.

  An author who placed an image in a rich-text field saw it in the editor and the
  published page had no trace of it. Those nodes keep their content in their own
  fields rather than in `children`, and the renderer's unknown-node fallback
  descends into children — so it found none and drew nothing at all, with nothing
  anywhere reporting a loss. Image, gallery, button and button-group now draw.

  Dispatch reads the node's TYPE before its `text` field. A button holds its label
  in `text`, so asked the other way round it published as bare words in the middle
  of an article. One node with the same collision had already been answered with a
  guard in front of the branch; ordering answers it for every node instead.

  `RichText` accepts an optional `hostPolicy`, the same object a block receives.
  Media sources cross the two filters blocks apply: the scheme check refuses a
  value that could execute and applies whether or not a policy was passed, while
  the site's fetch list is asked only when configured — absent means unasked, so a
  site that never configured one keeps its images.

  One refused source removes itself rather than what surrounds it. A gallery drops
  the image it cannot fetch and keeps the rest; a group drops the button whose
  destination was refused and keeps its siblings.

  Video is not yet drawn, and a check now says so out loud rather than leaving it
  silent: a conformance test beside the editor's own node registration reads the node
  types it registers and the types the renderer draws, and fails on any
  that is neither drawn nor declared with a reason.

- [#1173](https://github.com/nextlyhq/nextly/pull/1173) [`a41dc43`](https://github.com/nextlyhq/nextly/commit/a41dc431683aaa06b00979d693f9de22d9061828) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every style control in the inspector now says where its value came from. A small dot beside the
  label reports whether you set the value on this block, or it arrived from a named class, from the
  block's own defaults, or from the page — named in words on hover and to a screen reader, not only
  by colour. A property nothing has set shows no dot at all, so a section of empty controls stays
  quiet.

  The distinction is the point: a control showing an inherited value looks identical to one you
  authored, and typing into it silently takes the value over. Knowing which is which before you
  type is what stops an author editing a class through a control that appears to belong to one
  block.

  Where a value could have been written by either of two controls — a background image can come
  from the image field or the gradient field, and the compiled cascade records only the CSS it
  wrote — the dot stays absent rather than claiming a value the control may not hold.

- [#981](https://github.com/nextlyhq/nextly/pull/981) [`2dc1965`](https://github.com/nextlyhq/nextly/commit/2dc19653b80543b8779b6ddb97cd817e4348e1b0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scaffolded plugins now enforce Nextly's design-token rules.

  `create-nextly-app --template plugin` previously produced a project with a generic ESLint setup that knew nothing about the admin's design system, so the token contract reached only code written inside Nextly's own repository. A new plugin now depends on `@nextlyhq/eslint-plugin` and extends its recommended config, so a fixed palette colour or an all-constant inline style fails `pnpm lint` in the author's own project and is underlined in their editor.

  The plugin template also installs from the `alpha` dist-tag, joining the blog template. Both track the active release line because the conservative `latest` tag lags it.

- [#1292](https://github.com/nextlyhq/nextly/pull/1292) [`8516ecc`](https://github.com/nextlyhq/nextly/commit/8516ecc20f3e385e3bf700bc98d826c3c3e70239) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content can now be scheduled to publish, and it goes live at the moment you
  chose rather than the next time something happens to run.

  Group the pages, posts and settings that belong to one launch into a release,
  give it a date and time, and everything in it becomes visible together. Removing
  content works the same way — schedule the takedown and it stops being visible on
  the hour you picked.

  The part that is easy to get wrong, and the reason this took the shape it did:
  a release changes what a _reader_ sees, not just what the database stores. So a
  post that is still a draft, but whose release has come due, is returned by an
  ordinary visitor's request — including when it is reached indirectly, as the
  author of a post rather than by name. Content that is published when you ask for
  it directly and missing when you arrive at it through a link is worse than
  content that is late.

  That applies to one-off documents too — a homepage, a settings page — which are
  loaded and refused rather than filtered, and so needed the same answer reached a
  different way.

  While nothing is scheduled, none of this costs anything: the check is a single
  cached comparison, and no extra query is made on a site that has never created
  a release.

- [#1124](https://github.com/nextlyhq/nextly/pull/1124) [`ffc68f9`](https://github.com/nextlyhq/nextly/commit/ffc68f9c53aeadcdb90ba30098ff399fca6b05a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The collection, field group and single schema builders were three near-copies of one page, and an
  edit to any of them was three edits or a divergence. They now draw the same frame, mount the same
  overlays, and reach the same confirmation before a schema change is applied, so the parts that are
  genuinely per-kind — what each entity's settings mean, which client saves it, and what it calls
  itself — are what is left in each page. Nothing a user can see changes; the field name a duplicate
  takes, what a drag does, and which fields count as the user's are now decided in one place instead
  of three that had already begun to drift.

- [#1166](https://github.com/nextlyhq/nextly/pull/1166) [`405c804`](https://github.com/nextlyhq/nextly/commit/405c8044281e2c699daa7b8492bd4957ea436825) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scroll a tab strip without making the strip itself the scroller.

  A tab list that carried its own `overflow-x-auto` became a scroll container on
  BOTH axes, because CSS computes `visible` to `auto` when the other axis is not
  visible. The trigger's underline is drawn by a 2px pull-up onto the list's rail,
  so that pull-up was then reported as vertical overflow and the strip grew a
  stray vertical scrollbar it had no use for. `TabsList` now takes a `scrollable`
  prop that puts the scroll container in a wrapper, leaving the rail intact and
  letting it span the full scroll width.

- [#1235](https://github.com/nextlyhq/nextly/pull/1235) [`70ede4e`](https://github.com/nextlyhq/nextly/commit/70ede4e7597e415f266f744985d5587619a44636) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The `select` query parameter now does what the documentation says, and a request it cannot read is refused rather than answered with every field.

  The REST reference documents one spelling — `?select=id,title,publishedAt` — and it has never worked. The reader accepted a JSON object and nothing else, so the documented request was parsed as nothing, discarded, and answered with the whole document. A caller following the documentation got a response that looked correct and carried every field of every row; the admin's API Playground had to probe a running server to find the form that does work, and recorded the answer in a comment.

  Both spellings are now accepted, and both are documented. `?select=id,title` and `?select={"id":true,"title":true}` do the same thing.

  Anything the reader still cannot understand is a 400 naming the format, instead of a response carrying every field. That covers the shapes that used to pass silently: an array, a truncated fragment, a map whose values are not booleans, and a map naming no fields at all — including `{"title":false}`, which counted as a projection, selected nothing, and was therefore answered with everything, the opposite of what its author meant.

  `nextly/query` exports `encodeSelectParam` and `readSelectParam`, so a caller writes the parameter with the same code the server reads it with. It is a leaf entry point rather than a root export: the admin's API Playground and plugin admin components import it from the browser, and the root entry would bring the server graph with it.

- [#1222](https://github.com/nextlyhq/nextly/pull/1222) [`1de8eca`](https://github.com/nextlyhq/nextly/commit/1de8eca4d07befab324b127eb9f3d17aec6c0d3b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the literal and digested preview-container names disjoint namespaces.

  `previewContainerFor` carries a seed literally when the identifier reduction
  loses nothing and digests it otherwise, but both constructions shared one
  prefix — so a surface seeded with another surface's digest was carried
  literally onto the same name. Two unrelated boxes received one container, which
  is the collision the per-surface factory exists to prevent.

  Marking only one path would have moved the ambiguity rather than closing it,
  since a literal seed can begin with whatever single mark the digest uses. Both
  now carry a mark at a fixed offset, so no pair of inputs can meet.

- [#1084](https://github.com/nextlyhq/nextly/pull/1084) [`d5efc25`](https://github.com/nextlyhq/nextly/commit/d5efc2585fe51b3f78e0975f8584472d32c2366d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed fields and the language switcher no longer disappear after
  moving around the admin. The request that lists installed plugins and configured
  locales is session-gated and does not retry, so one made before sign-in failed
  permanently and nothing re-ran it — leaving an author told to reload the page
  before they could edit the field. Signing in now issues a fresh request, and the
  request is not made at all until the session is known.

- [#1185](https://github.com/nextlyhq/nextly/pull/1185) [`0499947`](https://github.com/nextlyhq/nextly/commit/0499947735ddfe370a87f1804cb49cb712ff6a39) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now set your site's breakpoints from the editor.

  A Breakpoints button in the top bar opens the manager, showing how many the site defines. Add the
  widths your styles should respond to, on the browser window or on a block's own container, and save
  — the canvas compiles against them immediately and every page follows.

  An id is fixed once saved, because it is the key your stored styles are filed under; renaming one
  would quietly detach every style on every page that uses it. Removing a breakpoint is not
  destructive either: styles filed under it simply stop applying, and come back if you add it again
  with the same id.

  The button stays unavailable until your saved styles have finished loading, so the dialog can never
  open on the defaults and save them over the breakpoints you already had.

- [#1035](https://github.com/nextlyhq/nextly/pull/1035) [`f94003f`](https://github.com/nextlyhq/nextly/commit/f94003ff56c4fb575ef241a638a20ec67484de89) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Breaking for installs that process images:** `sharp` is now an optional peer dependency. If you upload images and want thumbnails or configured image sizes, run `npm install sharp`.

  It was a hard dependency of `nextly`, so every install downloaded it: about 18 MB per platform, almost all of it the native libvips binaries. A site with no image uploads, or one using external images, never executed a line of it. Installs that do process images add one command.

  A missing `sharp` now DEGRADES instead of failing. Uploads still succeed and files are still stored; they simply arrive with no thumbnail, no dimensions and no resized copies. Upload security is unchanged, because the check that guards uploads is magic-byte based and never used `sharp`.

  This also fixes a defect that would have made the change unusable. `isValidImage` reported "not an image" whenever it could not run, and the upload route refuses on that with `400 Invalid image file`. An install without the package would therefore have rejected every image upload while blaming the user's file. Image validity now reports three states rather than two, and only a positive finding that a buffer is not an image can refuse an upload.

  The Image Sizes settings page says when the server cannot process images, and names the command that fixes it, so configured sizes that can never be generated no longer fail silently.

  Hosts whose bundler cannot resolve a native module can supply the library directly with `setSharp(sharp)` instead of relying on resolution.

- [#1115](https://github.com/nextlyhq/nextly/pull/1115) [`aa08c98`](https://github.com/nextlyhq/nextly/commit/aa08c9825ade8443239541cf304c7c546f5c1a23) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating a Single over a table left behind by an interrupted earlier create no longer adopts that
  table silently. An empty leftover table is rebuilt from the new request's fields, so a create
  recorded as applied always matches the columns the table really has; a leftover table that holds
  rows refuses the create and names the table, instead of recording a schema the database does not
  have.

- [#1082](https://github.com/nextlyhq/nextly/pull/1082) [`2c016d9`](https://github.com/nextlyhq/nextly/commit/2c016d997efbef2548f5989aa07981bb83e023d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Single documents can now be served as public pages. `createSingleRoute` reads
  as the visitor would and needs no database during a build; `createPublicSingleRoute`
  reads trusted and caches under the single's own tags, so publishing updates the
  live page without a rebuild. `createSinglePage` and `createPublicSinglePage`
  render one through the block renderer.

  A single that is missing, or that the visitor may not see, renders as a missing
  page rather than as an error, so the two are indistinguishable from outside. A
  read that fails for any other reason is raised instead of being cached as a
  permanently missing page.

- [#1309](https://github.com/nextlyhq/nextly/pull/1309) [`be9cee9`](https://github.com/nextlyhq/nextly/commit/be9cee9d8a417c9b087d17489aa388a779742700) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Clear the Single document cache when a Single is created or deleted, so a
  slug reused by a recreated Single stops serving its predecessor's document
  and the version history keyed on that document's id.

- [#1026](https://github.com/nextlyhq/nextly/pull/1026) [`381f6ce`](https://github.com/nextlyhq/nextly/commit/381f6ce811fd4b102d6fe772891327ce1d1be5f7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A single no longer reports itself edited before anyone has typed.

  A structural field stored as `null` — a component or group, `seo: null` in the
  playground — was taken verbatim as the form's default. Its inputs then
  materialise the shape as they register, so the form's values could never equal
  its defaults and the document was dirty from the moment it loaded. Visible as a
  permanent "Not saved" indicator and an always-enabled Save button.

  A stored null for a non-repeatable component or group now falls through to the
  structural default, which is the shape the form will actually hold. Fixed in the
  entry editor too, where the same code carries the same latent defect and only
  avoided it because those documents omit the key rather than storing null.

  With that gone, the unsaved-changes guard is mounted for singles as well: leaving
  a single with real edits now asks first, and leaving an untouched one does not.

- [#1184](https://github.com/nextlyhq/nextly/pull/1184) [`4693f6a`](https://github.com/nextlyhq/nextly/commit/4693f6a5bc39d18df3e142e07be0f6b25a8888f6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A preview link for a Single no longer shows its recipient fields the person who shared it cannot
  see. Collections were repaired separately; this is the same defect on the Single path.

  A granted draft read is trusted — that is what lets the working draft appear at all, since the
  overlay is gated on edit capability while a preview route resolves anonymously. But one flag
  decided both document trust and FIELD trust, so trusting the document switched field-level read
  rules off along with it. An editor denied a field could read it by sharing a link and opening it
  themselves.

  `previewSingleDraftGate` now answers a grant that NAMES the sharer rather than a bare boolean, and
  the route carries that identity into the read as a redaction basis — never as the caller. Every
  hook goes on seeing the anonymous visitor who is actually asking: a hook branching on the caller
  would otherwise produce an editor-only value for whoever holds the link, and a value a hook invents
  need not be a declared field, so redaction could not take it back.

  `SingleRouteConfig.draft` accordingly returns `SingleDraftGrant` instead of `boolean`. A literal
  `true` still grants, for a route mounted behind the application's own auth where every visitor is
  already entitled to the draft; it names nobody and so judges by nobody, which is the previous
  behaviour it preserves.

  Revocation reaches links already in circulation, and it takes two things rather than one. The
  identity is re-read on every render, so a deleted or deactivated account stops rendering at once.
  But rebuilding an identity re-evaluates field rules and nothing else — the read still bypasses the
  Single's own document rules — so the render also re-asks the question the mint asked: may this
  person still preview this Single. `assertSinglePreviewable` takes `routeAuthorized` per call site
  for that reason: true for the mint, which runs behind the route's access gate, and false for a
  render, which is anonymous and has none.

  A link whose sender cannot be identified — an account since deleted or deactivated, or a token
  minted before the record existed — is refused rather than rendered. Rendering it as nobody applies
  no field rules at all, which is the leak itself; the visitor sees the published document or a 404,
  the same as an expired link.

  One limit is unchanged and worth repeating: a deployment authenticating through its own provider
  can put arbitrary claims on a token, and those exist only for the duration of a request. A field
  rule reading one sees it absent here, and absence is not the safe direction.

- [#1233](https://github.com/nextlyhq/nextly/pull/1233) [`b05cea8`](https://github.com/nextlyhq/nextly/commit/b05cea831266086afe7562e38c0d5be0a5dcc284) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single's preview pane is now called by the name the Single declares, instead
  of always saying "Preview". A collection's preview has always honoured
  `admin.preview.label`; a Single's ignored it.

  The server was already sending it. A preview declaration's `url` is a FUNCTION
  and cannot survive being stored as JSON, so it never reaches the browser — but
  the label beside it is a string and does. What was missing is that the admin's
  own type for a Single never declared the field, so nothing read it.

  Two duplications are collapsed rather than extended. The default is derived in
  one place now, shared by entries and Singles, so a second `?? "Preview"` cannot
  keep the fallback after someone changes the real one. And a Single's schema
  carried its own inline copy of the admin options, which had already drifted —
  it was missing `order` and `sidebarGroup`, both of which the server sends. It
  references the shared declaration instead, which is what made the label
  invisible to the editor in the first place.

  Editing that name now takes effect. A code-first Single's `admin` block was
  written to storage only inside the branch that handles a SCHEMA change, and was
  not one of the things that opened it — so renaming a preview, or changing the
  Single's own label or description, reached the row only when some unrelated
  field change happened to trigger a write. The admin reads all three from the
  stored row, because a preview declaration's `url` is a function and cannot
  travel over HTTP, so until then the editor kept showing the old name.

  They are written by their own branch rather than by widening the schema one,
  which would have flagged a migration for an edit that moves no column. The
  collection registry already worked this way; the two now share one predicate for
  the schema question instead of keeping two copies of it in step by hand.

  The button that opens the pane is named by the same word. Renaming the pane
  while its opener still said "Show preview" left the declared label reachable
  only after clicking a control that disagreed with it, so the header takes one
  label and gives it to both rather than growing a second naming prop.

  Two ways the stored copy could go stale are closed with it. A config that
  dropped its admin block or description while ALSO changing a field took the
  schema path, which sent `undefined` — read as "leave the column alone" — and
  stranded the old value. And the comparison that decides whether to write is now
  insensitive to key order: Postgres holds these columns as `jsonb`, which
  normalises the order it was given, so a plain JSON compare re-synced every
  resource on every startup on that adapter alone.

  `ApiSingle.admin.preview` also carries `openInNewTab`, which the collection side
  has always read. It is a boolean, so unlike the `url` beside it, it survives
  being stored and is returned — the type said otherwise, and a caller with a
  stored value could not reach it.

- [#1083](https://github.com/nextlyhq/nextly/pull/1083) [`4364193`](https://github.com/nextlyhq/nextly/commit/4364193b97dbd829a4dfd6215d33fedd1cd33467) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single's pending change can now be discarded. `DELETE /singles/{slug}/versions/working-draft`
  removes one language's held edit under the same row lock a draft save takes, and returns
  the live published document. Discarding was collections-only, so a Single could hold a
  pending change with no way to throw one away.

- [#1089](https://github.com/nextlyhq/nextly/pull/1089) [`80a9daf`](https://github.com/nextlyhq/nextly/commit/80a9daf54d12e1020eb2eb521356eb8dd685cb7d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single's pending change is now visible and discardable in its own editor. The
  engine has held status-less edits to a published Single since the split shipped,
  but no read returned them and the editor never asked: its Save named the status,
  and a write that names one is never held. So the feature was dark for every
  Single, and an author's held edit was invisible to them.

- [#1069](https://github.com/nextlyhq/nextly/pull/1069) [`9984d1a`](https://github.com/nextlyhq/nextly/commit/9984d1a8b68b1677b7ffb9935682500ea4b3a4ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold a status-less edit on a published Single.

  Editing a published Single now holds the change instead of putting it on the
  live site, per language, the way a collection entry does. Publishing applies the
  pending change; publishing every language applies each of them. A Single's
  schema response also reports whether pending changes are on, so its editor can
  offer the matching actions.

- [#1224](https://github.com/nextlyhq/nextly/pull/1224) [`9e95f9d`](https://github.com/nextlyhq/nextly/commit/9e95f9dca5f30dfc92d154c85df4b12114f77924) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single can now be edited beside the page it becomes, the same way a collection
  entry can.

  The split-view preview shipped for entries and stopped there, so the same author
  doing the same job got two different experiences depending on which kind of
  document they had opened: an entry could be previewed in place, while a Single
  offered only "copy a shareable link". A Single has a draft lifecycle, an address
  on the site and a credential that reaches it — everything the pane needs — so the
  gap was in the wiring rather than in anything a Single lacks.

  Nothing was duplicated to do it. The pane, the credential's renewal timer, the
  cross-origin refusal and the one-session-per-browser warning are the same code
  serving both, because a second pane for Singles would have been a second
  implementation of all four, agreeing until one of them was edited. What changed
  is that the pieces now take a SCOPE — a collection entry, or a Single — instead
  of a collection name and an entry id.

  The preview and the shareable link beside it resolve that scope ONCE. Both need
  a language claim and both are wrong in the same way without one: on a localized
  Single opened in its default language the editor's active locale is absent, and
  an absent claim covers every translation rather than the default. Two surfaces
  resolving that separately would agree on the day they were written, so they now
  share one answer, and the pane is offered on exactly the terms the link is.

- [#1037](https://github.com/nextlyhq/nextly/pull/1037) [`9e59e84`](https://github.com/nextlyhq/nextly/commit/9e59e84506c370728b13967d5892de9ba5939ce5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Singles can now publish every language at once. A translated Single could only be published one language at a time, through as many writes as it had translations, and a failure partway left the document half-live — some languages public and others not. `POST /api/singles/{slug}/publish-all` moves the main status and every companion `_status` in one transaction, so the state a reader can observe is either the whole document before the publish or the whole document after it. It is authorized as `update-{slug}` plus `publish-{slug}`, with an owner-only or custom publish rule re-judged against the row under its lock, and it records the same `single.updated` and per-language `single.published` events an ordinary write does. The admin offers "Publish all" on a localized Single with a draft/published lifecycle, alongside the entry editor's.

- [#1132](https://github.com/nextlyhq/nextly/pull/1132) [`ab7f064`](https://github.com/nextlyhq/nextly/commit/ab7f064cb35c758c39802ad2a6606c4fe6d31fac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(blocks-engine, blocks-react): give the site sheet the host-fetch policy the page sheet already had

  `SiteSheetInput` had no `mayFetchUrl` member, so `compileSiteSheet` compiled the
  named-class and block-default tiers with no host question asked — while
  `PageRenderer` passed `remotePatterns` into the page compile for node styles.
  A stored class naming a host the site refuses was therefore emitted into the
  sheet of every page, and the site sheet is emitted first, where a page sheet
  that merely omits a declaration cannot retract one.

  `SiteSheetInput` now accepts `mayFetchUrl` and threads it into its
  `compilePageCss` call. `effectiveCompile` returns the predicate it derives so
  `PageRenderer` hands the same function to both sheets: reading it off the
  reconciled compile context would have asked nothing on the ordinary production
  path, where a consumer rendering a stored artifact supplies no style context and
  that context is `undefined`.

  No `fetchPolicyId` counterpart on this input. That stamp exists so a reader can
  tell whether a stored sheet predates the current rules; this artifact is
  compiled per render and addressed by the hash of its own bytes, so a policy that
  changes what is emitted changes the name.

  A site that configured no `remotePatterns` is unchanged — absent is unasked, not
  an empty allowlist.

- [#1131](https://github.com/nextlyhq/nextly/pull/1131) [`39627e6`](https://github.com/nextlyhq/nextly/commit/39627e62a6cf9f8c2085aa6c45d9b4cb074c55eb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(plugin-page-builder): judge a stored class's values under the site's host policy

  A named class is emitted verbatim into the sheet of every public page, and the
  Site Style write gate never read inside its `styles`. `isUsableNamedClass` types
  the envelope and stops there, so a class carrying
  `background: { url: "https://tracker.example/p.png" }` was stored, compiled and
  served to every visitor of every page — while the identical value written on a
  node was refused, because the renderer polices node styles and nothing policed
  the site sheet.

  The classes field now runs each entry's values through the engine's own
  `validateStyleValues` with the site's `remotePatterns` predicate, derived through
  the same `isFetchableUrl` the published page and the canvas use. Only errors
  refuse a write: a warning is a value the engine accepts and emits.

  How strictly an unrecognised property is judged now depends on whether the site
  configured a host policy, because the validator does not look INSIDE one.
  - **No `remotePatterns`: forgiving, and nothing changes.** A property written by
    a newer engine stays a warning, and an absent policy is treated as unasked
    rather than as an empty allowlist.
  - **`remotePatterns` configured: strict.** An unrecognised property is an error
    and the write is refused, because a value the gate cannot judge could carry a
    `url()` it will never see. Such a site can no longer store a property this
    engine does not know, and is told which one.

  Validation is also bounded now. One issue budget covers the whole classes
  section rather than each property map, and the walk stops once it is spent —
  between maps inside a class and between classes. A payload spreading invalid
  properties across many maps could otherwise ask for work proportional to the
  map count, which the document byte cap alone does not limit.

- [#1136](https://github.com/nextlyhq/nextly/pull/1136) [`62bc267`](https://github.com/nextlyhq/nextly/commit/62bc26763da9cda4d3c598c584d113435c853f51) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the page-builder editor one shared read and write for the stored Site Style document, and draw the canvas from it.

- [#1130](https://github.com/nextlyhq/nextly/pull/1130) [`0937227`](https://github.com/nextlyhq/nextly/commit/0937227ac4657c895647daf568620e9b03bc0c7a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(plugin-page-builder): let a permission decide who reads Site Style

  The Site Style single declared `access: { read: () => true }`, which cannot
  serve the anonymous page render it was written for and does reach every
  authenticated principal. `checkAccess` refuses an absent user before
  consulting any rule, singles are not public endpoints, and a published page
  never uses the route — `loadSiteStyle` reads through the Direct API, whose
  `overrideAccess` default returns before a rule is evaluated. What the rule
  did do was return ahead of the `read-site-style` permission lookup, and the
  `read` action covers the version list, a version, a version diff and the
  autosave recovery point as well as the published document.

  The access block is gone, so read and update alike fall through to the
  permissions seeded with the single. A published render is unchanged; a role
  that should read this document is granted `read-site-style`.

- [#1133](https://github.com/nextlyhq/nextly/pull/1133) [`4672cd8`](https://github.com/nextlyhq/nextly/commit/4672cd884c684076056c3ecd1df5c832496f1e40) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(blocks-react): resolve every shared site-style input once per render

  A render carries two style inputs — the route's `styleContext` and the site's
  `siteStyles` — and compiles twice from them: the shared sheet, and the page's
  own values. Only the class library was reconciled between them. `breakpoints`,
  `tokenPrefix` and `blockBases` were each computed twice, so a stored value that
  reached the sheet never reached the page compile.

  The consequences were silent, because each sheet is internally consistent and
  neither reports anything. A stored breakpoint set replaces the config one
  whole, so a node's value stored under an id the route's set lacks was dropped
  outright; a stored token prefix left every `{ $token }` reference pointing at a
  custom property nothing declared, and an unresolved custom property invalidates
  the declaration rather than reporting.

  `PageRenderer` now resolves the shared inputs once and gives the same values to
  both compiles. Precedence is unchanged for every field — the defect was two
  computations of one question, not the wrong answer to it. A table typed over
  every `SiteSheetInput` key records which side each belongs on, so a field added
  there is a compile error until someone says.

  **Breaking, alpha:** a `siteStyles` PROVIDER is now `{ read, singles }` rather
  than a bare function. Being called per render is not the same as being read per
  render — on a pre-rendered route the whole render is cached and only a tag the
  page carries rebuilds it, while a Direct API read inside the provider
  contributes none. `singles` names the slugs that read consults, which puts
  `nextly:single:<slug>` on the route, so an admin's save reaches the next page
  view as the documentation already promised.

  The two are one type rather than a value and a separate optional property,
  because an optional one leaves the unsafe configuration legal: a provider with
  no declared dependencies compiles, serves a stale sheet, and looks exactly like
  a correct route. `singles: []` states that a provider reads no singles. A plain
  value needs none of this — it cannot change after the module loaded.

  The Site Style write validators also judged the stored tier alone, while every
  consumer compiles the merge. Config entries are inserted first and both engine
  resolutions are first-wins, so a stored class whose slug a config class already
  holds was accepted, then dropped at render, leaving the node that referenced it
  with no rule — and `MAX_NAMED_CLASSES` was counted over the stored array while
  the compiler truncates the merged one. Both are judged against the merge now,
  when a caller states its config tier. Token collisions are reported as the
  DIFFERENCE the write introduces, so a site whose own config already emits an
  issue does not have someone else's mistake charged to the admin saving a token.

  The configured breakpoint set threaded into the blocks field validator judges no
  document, and that is now recorded as the deliberate limit it is rather than
  left looking like an oversight. Making it strict was tried and is wrong while
  the set reaching that call is the config tier alone, resolved at config time
  where there is no database: a page styled at a breakpoint an admin STORED would
  be refused on save while the published renderer compiles it. The parameter keeps
  deciding the one property that is true of the set alone — ids colliding across
  axes — and becomes load-bearing for documents once something can reach the
  stored tier.

  `blocks-engine` now exports `usableNamedClasses` and `usableNamedClassPositions`
  — the list the compiler writes and the renderer is handed, ordering and claim
  rules included.

  The Site Style write gate uses it to answer the only question an author cares
  about: will the class I just wrote render? It compares the ids that resolve
  before and after the write, so it reports a class the write adds that cannot
  render, and a class the site used to render that the write displaces — whether
  by claiming its slug, taking its id, reordering it behind another, or pushing
  it past the cap.

  Modelling that instead of asking was wrong four separate ways in review, each a
  different rule: the merge is keyed by id so a shared id REPLACES rather than
  duplicates, a config tier's own problems are not the writer's to fix, two
  collisions on one slug read identically as messages, and the compiler claims
  slugs after sorting by `orderIndex` rather than in array order. Asking cannot be
  wrong in any of them.

- [#1137](https://github.com/nextlyhq/nextly/pull/1137) [`249506a`](https://github.com/nextlyhq/nextly/commit/249506a695408dcce020b70d02451c2c32940cc5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give a site token a stable identity, so renaming one moves neither the custom property a compiled page references nor the `$token` a stored document holds.

  `SiteToken` gains an optional `id`. A token identity is its `id` when it has one and its `name` otherwise, and both the emitted custom property and the config/stored tier merge key on that identity rather than on the name. Every token stored before the field existed carries no id, so its identity is its name and it emits exactly the property it emitted before — nothing migrates. Renaming pins the identity at the name the token already had and moves only the label, which is what keeps existing references resolving.

  Because an id and a name share one custom-property space, renaming frees the label but not the property behind it: a new token claiming the freed name is refused and named rather than allowed to shadow the token that left it.

  DTCG import and export carry the identity under the `com.nextlyhq.nextly` extension key, which is the only place the format allows it — DTCG has no token id of its own and reserves the `$` prefix. A file from another tool carries no such key and imports with its names for identities rather than having one invented for it.

- [#1138](https://github.com/nextlyhq/nextly/pull/1138) [`b5c9199`](https://github.com/nextlyhq/nextly/commit/b5c9199141de10cc59bc5cc2f809d1e2142522c2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The sitemap now derives each entry's path from `slugToStaticParam` — the route's own answer to
  where a stored slug renders — instead of building one alongside it. A sitemap listing a URL the
  route does not serve costs indexing, and the two derivations had drifted in four ways.

  A nested slug keeps its separators. `docs/getting-started` is a path the catch-all route serves as
  two segments; encoding the slug whole produced `docs%2Fgetting-started`, a single segment naming
  nothing. A slug the route refuses is now skipped rather than advertised: `..`, `a//b` and a leading
  slash all resolve to somewhere the route answers `notFound()` for.

  The reserved-path denylist is asked about the STORED SLUG, which is the value the route itself
  checks — it joins its catch-all params, and those exclude the mount prefix. A page stored as `admin`
  therefore reaches `notFound()` under every mount, so it stays out of the sitemap under every mount
  too. Judging the final URL instead would list `/pages/admin` as unreserved and advertise a dead
  link. The module keeps no second copy of the denylist either way.

  `buildSitemapUrls` and `generateSitemap` gain `basePath`, which declares where a collection's route
  is MOUNTED — the one part of an entry's URL that cannot be derived, because it is decided by where
  the route file sits in the app directory. It defaults to `/<collection>`, so an existing sitemap is
  unchanged for simple slugs. Pass `""` for a collection served at the site root: a page builder's
  pages render at `/about` rather than `/pages/about`, which no previous option could express. A
  function receives each collection name and may return `null` to exclude
  that collection entirely, and it is resolved before the collection is read so an excluded one costs
  no queries. `basePath` is ignored when a custom `urlFor` is supplied, which already owns the whole
  path.

  `basePath` must be a plain path prefix. One carrying a query or fragment is refused rather than
  passed through, because `/docs?lang=en` reaches URL resolution as a query and would advertise every
  entry at a location the route never serves — a misconfiguration is better as an error than as a
  sitemap of subtly wrong URLs.

  `@nextlyhq/plugin-sdk/routing` is a new `@experimental` subpath exporting `slugToStaticParam`, and
  the sitemap takes it from there rather than reaching into `nextly/runtime`. The SDK is the stability boundary, and a
  first-party plugin is the worked example third parties copy, so importing core directly would have
  published the shortcut as the pattern. A SUBPATH rather than a root export: `export … from
"nextly/runtime"` is a static ESM edge, so putting it on the root would make a consumer importing
  only `definePlugin` instantiate that barrel — which transitively reaches around 124 modules and
  3.9 MB, including `fs`, `async_hooks` and `crypto`, and can break a browser or isomorphic bundle.
  Behind a subpath the cost is paid by callers that want routing and by nobody else, which is the same
  reason `/blocks` is separate. The SDK root entry is byte-for-byte the size it was before.

  An empty slug is now skipped under every mount, declared or not. Whether a mount's own root is
  served depends on the route file — a required `[...slug]` catch-all matches no segments and 404s
  there, an optional `[[...slug]]` serves it — and `basePath` names the prefix, not that. Both shapes
  exist in this repository, so declaring a mount is not a claim that its root is routable, and a site
  that does serve its root maps it with `urlFor`. Omitting a URL costs a listing; advertising one that
  404s costs indexing.

  `basePath` also rejects `.` and `..` segments, including their percent-encoded spellings, and a
  backslash: a dot segment is removed by URL resolution before the request is sent, so
  `/docs/../admin` would mount at `/admin` and carry every entry under it somewhere the caller
  never named, and `\` separates segments to the URL parser on an http(s) origin, which would
  walk the same escape past a check that splits only on `/`. A LEADING `//` is refused rather than collapsed: it is
  authority syntax, so `//docs/a` resolves to host `docs` and the collection silently leaves the
  sitemap — but collapsing it to `/docs` would trade that omission for a silent redirection onto the
  site's own origin, and `//cdn.example/blog` plainly means a host. Neither reading can be dismissed,
  so neither is guessed at. A URL carrying a scheme is refused for the same reason. Only an INTERNAL
  doubled separator is collapsed, which carries no such ambiguity.

  Control characters are refused for the same reason a query is: URL parsing DELETES a tab, carriage
  return or newline rather than encoding it, so `/docs` plus a newline plus `admin` reaches the origin
  as `/docsadmin` — a mount nobody wrote. The whole C0 range is refused rather than those three
  spellings, since none of them belongs in a path prefix.

  The plugin's declared core-compat floor rises from `>=0.0.2-alpha.21` to `>=0.0.2-alpha.55`, the
  first core that exports `slugToStaticParam`. On an earlier core the new import fails at module load
  before the plugin can initialise, so the wider range advertised a compatibility that could not
  resolve.

- [#1052](https://github.com/nextlyhq/nextly/pull/1052) [`426d176`](https://github.com/nextlyhq/nextly/commit/426d176b7da5173fa285052007dc1040cf1f736c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A localized checkbox in translation mode now offers to take its source value, not just show it. The field wrapper renders checkboxes through a separate horizontal layout, and that branch showed the source text without the action beside it — so the one field type that uses it could see what the source said and had no way to use it.

- [#1148](https://github.com/nextlyhq/nextly/pull/1148) [`661c9fd`](https://github.com/nextlyhq/nextly/commit/661c9fd3cb1af1c6ad70f00d1d33efeae5caa51d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Drop the spacing overlay's margin bands for a block that carries its own transform. A transform does not affect layout, so a transformed block's margin is not beside its rendered border edge and no scale factor puts it there. Padding is unaffected and still drawn.

- [#1154](https://github.com/nextlyhq/nextly/pull/1154) [`2172c33`](https://github.com/nextlyhq/nextly/commit/2172c33759a1871890e21699239888b2a4adeec8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep a spacing overlay margin band beside an edge the block's own transform leaves where layout put it. A translate composed with a scale pins one edge and moves the other, so suppressing a whole axis hid a band that was still correct.

- [#1145](https://github.com/nextlyhq/nextly/pull/1145) [`fc499ff`](https://github.com/nextlyhq/nextly/commit/fc499ffa55921ecac48d831812e8a00cf2b2921e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(builder): draw the selected block's margin and padding on the canvas

  An author sets spacing in the inspector and looks at the canvas, where until now
  nothing said what a value did — the only way to see it was to change it and watch
  the layout move. The selected block now carries a band over each side that has
  spacing, with the value written on it: amber outside for margin, green inside for
  padding, which is the palette browser developer tools have used for years.

  The values are read from the RENDERED element rather than from the stored style
  tier, because that tier cannot answer the question. The catalog stores spacing per
  LOGICAL side and a band is drawn on a physical one; `auto` has no value until
  layout runs; a percentage resolves against the containing block; and a named
  class, a block-type default or a breakpoint override can win the cascade. Asking
  the page what it is doing keeps one answer where there would otherwise be two.

  Only the primary selection is measured — spacing belongs to a node, and a
  multi-block selection has no margin of its own. Sides with no value draw nothing.
  The bands take no pointer events and are hidden from assistive technology, whose
  route to the same numbers is the inspector's Spacing section.

- [#1267](https://github.com/nextlyhq/nextly/pull/1267) [`aa88709`](https://github.com/nextlyhq/nextly/commit/aa88709fb1ab5cfd68ded934a572041659fa4939) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On SQLite, a failed database write is now reported as what actually went wrong,
  instead of occasionally being reported as a timeout.

  A write that a unique constraint refused — saving a second record with a value
  that has to be one of a kind — was being described as the database being busy.
  The two mean opposite things. A busy database is a temporary condition worth
  trying again in a moment; a refused duplicate will be refused every single time.
  Anything that retried on a timeout could therefore retry a permanently
  impossible write over and over, and the log would blame the database rather than
  naming the duplicate.

  The cause was that the description was being read off the query itself rather
  than off the error. If the failing statement so much as mentioned a column whose
  name contained the word "locked" — and the tables that record sign-in lockouts
  and outgoing webhook deliveries both have one — the failure was read as a lock,
  whatever had really happened.

  This affected the accounts table and the webhook delivery table, so a sign-in
  lockout write or a webhook delivery that failed for any reason has been
  reporting the wrong cause. PostgreSQL and MySQL were never affected.

  Separately, the check for "was this a duplicate?" now looks all the way down a
  failure rather than one step in. A database error arrives wrapped twice before
  application code sees it, and the detail identifying a duplicate sits at the
  bottom, so the check had been answering "no" for genuine duplicates. It also now
  stops safely if a failure somehow refers back to itself, rather than looping.

- [#1128](https://github.com/nextlyhq/nextly/pull/1128) [`cb61a5c`](https://github.com/nextlyhq/nextly/commit/cb61a5cfade318136de99a649b491a7bd7055b23) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder gains the contract its style controls will be built on. Which controls a style
  property offers is now derived from the engine's own catalog rather than listed anywhere, so a
  property added to the catalog gains an editor with no control code written; a leaf kind the
  catalog grows that this build has no control for appears as a known gap instead of vanishing.
  Reading and writing a control's value goes through one address — state, breakpoint, property and
  the path inside it — so nothing spells that path a second time, and every value is checked by the
  catalog's own validator rather than by a control's idea of it. Dragging a value previews it by
  compiling the same declarations the published stylesheet carries, so a token still resolves to the
  custom property it resolves to on the page and a value the compiler would refuse never reaches the
  screen; releasing writes one operation, which is one step of undo. Whether a value was authored
  here, inherited from a class or never set is read from the record the compiler already writes, so
  a control cannot disagree with the page about where a value came from. No controls render yet.

- [#1134](https://github.com/nextlyhq/nextly/pull/1134) [`6ef538d`](https://github.com/nextlyhq/nextly/commit/6ef538d0fd9f208e06531d8e01c5410cc2cc16ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Export the engine’s union arm selection and delete the copy of it the style-controls SDK carried, so a control and the error message beside it describe one arm by construction. When no arm accepts a value the engine now reports through the arm the value was written in — `fontWeight: 5000` says it is above the maximum of 1000 rather than that it is not one of `normal, bold, lighter, bolder`.

  Add the Style tab to the page-builder inspector: Content|Style tabs, one-open accordion sections derived from the catalog’s groups and the block’s own `supports`, and an editable control for every property those allow.

- [#1135](https://github.com/nextlyhq/nextly/pull/1135) [`f3caf10`](https://github.com/nextlyhq/nextly/commit/f3caf104d6f6d2ecbd56f46bb5fee3160f4cc0ef) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Carry the site host-fetch policy into the editor, give the Style tab a way out of every value it shows, and make the union arm one answer across the engine.

- [#1182](https://github.com/nextlyhq/nextly/pull/1182) [`9adee4a`](https://github.com/nextlyhq/nextly/commit/9adee4ab76fa8203d77d7eda5f4deb85a97c7716) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The provenance dot now describes the block the canvas is actually drawing.

  The editor prepares a stored document before it renders — repairing duplicate ids, withholding
  condition-gated nodes, dropping subtrees that a placeholder replaces. The cascade was read from that
  prepared tree while the panel looked its selected block up in the stored one, so where the two
  differed the dot could describe a different block than the one on screen: a class you can see
  applied would read as set by nobody, or be credited to the wrong place.

  The declarations and the tree they describe now travel together, so the panel cannot resolve a block
  in one and read its values from the other.

  Two smaller fixes alongside it. The inspector no longer rebuilds its breakpoint subscriptions on
  every keystroke. And a block the editor is not drawing at all now shows no dot, which is the honest
  answer for something that is not on the page.

- [#1285](https://github.com/nextlyhq/nextly/pull/1285) [`07864b8`](https://github.com/nextlyhq/nextly/commit/07864b8bf61d3e06d439af953ad1df224e5405c8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry editor no longer shifts its fields when a document finishes loading.

  While an entry loads, the placeholder was laid out to a different width than
  the editor that replaces it, so every field moved sideways at the moment the
  content appeared — which reads as the page loading twice rather than as
  content arriving.

  The placeholder now matches the editor it stands in for: the same width, and
  the same panel beside it. Creating an entry no longer shows a placeholder for
  a panel it never displays, and the placeholder's panel is the width the real
  one turns out to be, rather than forty pixels wider.

- [#1143](https://github.com/nextlyhq/nextly/pull/1143) [`89a13c7`](https://github.com/nextlyhq/nextly/commit/89a13c779c02d0d37f95d464292b19d15cd30858) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Colour controls in the page-builder style inspector: a swatch that opens a picker beside the field that owns the value, a token picker over the site's colour tokens, and a WCAG contrast readout for a text-and-background pair.

  The text field remains the control. A stored colour may be `oklch()`, `color-mix()`, a named colour, `currentcolor`, a CSS-wide keyword or a `var()`, and none of them is rewritten by opening the picker — the swatch and the readout offer themselves only where the value can be resolved here, and show nothing where it cannot.

  Choosing a token stores the token's IDENTITY rather than the name shown, so a reference keeps resolving after the token is renamed; a stored reference is displayed under the token's current name.

- [#1033](https://github.com/nextlyhq/nextly/pull/1033) [`8cd3004`](https://github.com/nextlyhq/nextly/commit/8cd3004b4455032465d4406c5730599ea6c158fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two new checks close the same gap from opposite sides. `@nextlyhq/no-token-alpha-suffix` rejects an alpha suffix appended to a design token — `\`\${color}20\``produces`var(--nx-primary)20`, which is not valid CSS, so the browser drops the declaration and the element renders with nothing where the tint belonged. It was correct while colours were hex and fails silently now that they are tokens, which is why it survives review. The design-lint guard gains the same rule for stylesheets, plus a named-colour check: `color: rebeccapurple`is as fixed as`#663399`, and a token DEFINED as a named colour quietly ends the aliasing that a whole namespace's contrast depends on.

  The guard also now reads `packages/builder/src`, the editor's entire interface and previously the largest first-party UI surface no design check covered. Its `--nx-builder-*` namespace stays; these rules never cared which namespace a token belongs to, only whether a colour was written down instead of referenced.

- [#1213](https://github.com/nextlyhq/nextly/pull/1213) [`e5228b5`](https://github.com/nextlyhq/nextly/commit/e5228b57b2e4325c5a6c8c7b2ee1debfd62a8545) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Design-token files keep what a newer build of this system wrote.

  The `com.nextlyhq.nextly` extension key is now split rather than consumed. The
  fields this build reads — `css`, `kind` and `id` — are taken into the token and
  written back from it; anything else found there is kept beside them and written
  out again where it was found. Importing a file exported by a newer build and
  exporting it again no longer strips what that build recorded, and there is no
  longer a warning naming the loss, because there is no loss.

  The format requires a tool to preserve extension data it does not understand,
  and says nothing about a producer meeting a newer version of itself. A
  reverse-domain key names the vendor rather than the build, so the same rule now
  covers both.

  A stored field never shadows one the model states. The split is applied on the
  way out as well as on the way in, so a token saved while a field was unread
  cannot state a value the site has since changed.

  Two places that decide what happens to a token had to learn about it: the
  comparison that decides whether a stored override differs from a site's own
  defaults, which would otherwise drop the preserved data on an unrelated edit,
  and the export's report of what a file cannot hold, since this data reaches
  `JSON.stringify` by the same route as another vendor's.

- [#1149](https://github.com/nextlyhq/nextly/pull/1149) [`43c18d3`](https://github.com/nextlyhq/nextly/commit/43c18d37dc13db3a30bcdb82e10dddb0e09c0208) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the tokens studio to the page builder's left rail. A site's design tokens —
  colours, sizes, fonts, weights, numbers, shadows, durations and custom values —
  are listed by kind and edited where they are read, with light and dark values
  behind one switch. Renaming a token moves only its label: references key on an
  identity the rename freezes, so every block already pointing at the token goes
  on resolving and no stored document is rewritten. The engine's own verdict is
  shown per row, so a value that contradicts its kind, one that would make the
  page fetch a file, and two tokens that would collide on one custom property are
  each reported where they are edited rather than discovered on the canvas.

- [#1153](https://github.com/nextlyhq/nextly/pull/1153) [`9b94631`](https://github.com/nextlyhq/nextly/commit/9b9463194d6466bb00c35639152697e7ee27294a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bring a design-token file into the tokens studio, and take one out. An import
  merges: tokens the file names are added or updated, matched on the identity a
  reference stores, and anything the file does not mention is left alone — so an
  import can never delete a token that blocks across the site still use. A file
  usually holds entries this site has no kind for, since the format defines more
  types than the engine maps, so what fits comes in and everything skipped is
  named with the reason. Export writes the token document a design tool reads back
  exactly, and the CSS custom properties a visitor's stylesheet actually contains,
  compiled by the same function that builds the site sheet.

  Fixes a token named `constructor`, or any path passing through that segment,
  being refused on export as though the site already held it: the emitter read
  the name off the document object directly, where `Object.prototype` answers for
  it. Such a token now leaves and returns unchanged.

  A file can describe one token twice — the format's own `$value`, and the exact
  CSS this system wrote beside it. The stored CSS is still what gets imported,
  since it holds what the author typed, but when the two genuinely disagree the
  import now says so instead of discarding the file's value in silence. Only a
  real difference in the colour is reported, never a difference in how it is
  spelled, so a file exported from here never carries the warning.

  Also: a field this system does not read inside its own extension is now named
  rather than dropped in silence, and a document nested past the group limit is
  refused with one message instead of a second account of every entry inside the
  branch the engine had already rejected whole.

- [#1019](https://github.com/nextlyhq/nextly/pull/1019) [`d5fb5bf`](https://github.com/nextlyhq/nextly/commit/d5fb5bf223d0003c7d21d27399584bf6dde7785a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The document header's labels collapse at the width they were calibrated for.

  The density thresholds were measured against the toolbar row, which carries its
  own horizontal padding. The container they are queried against then moved to the
  header's sticky wrapper, which has none — so each query saw a box 48px wider
  than the space actually available, and every label held on 48px longer than
  intended.

  The effect was measurable rather than theoretical: at a 792px row the labels
  stayed at full width, leaving the title pinned to its minimum with no slack,
  where collapsing them gives it 290px.

  The thresholds now carry that padding explicitly.

- [#1017](https://github.com/nextlyhq/nextly/pull/1017) [`133a749`](https://github.com/nextlyhq/nextly/commit/133a749a1548869f5378583526e43c2254b4f647) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The document header no longer overflows on a phone.

  Collapsing labels recovered enough width for the title down to about 540px, and
  below that there is simply not enough room for a title and a row of controls
  side by side: even with every label already reduced to its icon the cluster
  needs around 370px, against 294px of usable width on a 390px screen.

  So below 32rem the header wraps instead. The title takes its own line and the
  controls sit beneath it, wrapping among themselves rather than running off the
  edge. Nothing is hidden and nothing is clipped; the header is taller on a phone,
  which is the dimension a phone has to spare.

- [#1015](https://github.com/nextlyhq/nextly/pull/1015) [`e1f4612`](https://github.com/nextlyhq/nextly/commit/e1f4612d1607ec904d4b47071f1792a990098283) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The document header's title input no longer collapses.

  The title was a `flex-1` beside an action cluster that never shrank, so it got
  whatever was left: measured on `main`, `row - 598px`, which is 34px in a
  1280-wide window and 0 at 900. It reproduced on non-localized collections too,
  so this was general header behaviour rather than anything about translations.

  Actions now yield before the title does. As the toolbar narrows, supporting
  labels (preview, copy link) drop to their icons, then publish and unpublish do;
  the primary Save never collapses, and the title keeps a readable floor. A
  collapsed label becomes `sr-only` rather than being removed, so every control
  keeps the accessible name it had at full width.

  The queries read the toolbar's own width rather than the viewport's, because the
  document rail is 320px wide and hides at its own breakpoint — one window width
  produces two different toolbar widths, and only the toolbar knows how much room
  the toolbar has.

- [#1046](https://github.com/nextlyhq/nextly/pull/1046) [`2db288d`](https://github.com/nextlyhq/nextly/commit/2db288de9906162ae83850b12d419617b2067cf2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Translating a document now shows the source language beside the one being edited. A translator working a non-default language could previously see the source only as an inline hint under each field, and that hint could render a string or a number and nothing else — so a richText body, a relationship or a chips list had no source text on screen at all, silently. The new mode renders the source through the editor's own field components, so whatever a field can draw the source shows.

  The language pair lives in the URL (`?locale=es&translate=en`), which makes it linkable, reload-safe and reachable with the back button, and makes entering or leaving it a navigation the unsaved-changes guard can see. While the mode is on the admin's navigation, sub-sidebar, header and page frame step aside, and the mode renders its own way back — the suppression layer grants the navigation rail only to a surface that says it can be left.

  The source pane is read-only and shows only the translatable fields: a shared field holds the same value in both languages, so putting it there would fill half the screen with a copy of what is already in the other pane.

- [#1071](https://github.com/nextlyhq/nextly/pull/1071) [`b4fec5f`](https://github.com/nextlyhq/nextly/commit/b4fec5f2df776290151a9151127e5894198a7807) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report which languages hold unpublished changes.

  The translation overview said whether each language was translated and whether
  it was live, but not whether someone had saved work in it that was never
  published. An editor could only find that out by opening each language in turn,
  so on a document with several it went unnoticed.

- [#1048](https://github.com/nextlyhq/nextly/pull/1048) [`175b6fa`](https://github.com/nextlyhq/nextly/commit/175b6fa154f7052588470b50ca73fcef8fdb6d45) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Translation mode now reports progress and can fill a single field from the source. A translator sees how many of this language's fields are done, counted as they type rather than from what was last saved, and each translatable field offers "Use source" where the source has text — for the lines that are the same in both languages, a name, a URL, a product term. The document-level copy still exists for seeding a whole language; this is the grain the side-by-side view makes possible.

  Also fixes two layout defects found by measuring rather than looking. The editor cancels its page container's padding with a negative margin, and inside a translation pane there was no padding to cancel — so its layout was 64px wider than the pane it sat in and the document rail was drawn past the right edge. And a language row in the 320px rail put its label, badges, state and two buttons on one unshrinkable line, which left an untranslated right-to-left language's "Open" button 38px outside the row, unreachable by pointer; that one was not new, and happened on the ordinary editor too.

- [#1276](https://github.com/nextlyhq/nextly/pull/1276) [`d8cf8e6`](https://github.com/nextlyhq/nextly/commit/d8cf8e61076b94966ca4d6fad2dfd73c2c0d6283) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Translators get a page of their own. `Translations` in the sidebar lists what
  needs translating in one language, across every collection at once — the
  question every existing surface could only answer one document at a time, which
  meant opening every document to find the work.

  It is the way IN rather than a second editor: choosing a row opens the document
  in the editor that already exists, in the target language, with the source
  beside it.

  When the server could not consult every collection, the page says WHICH. A
  worklist that quietly omits a collection reads as "nothing to do there", and
  that is indistinguishable from the truth at a glance.

  `PaginationMeta` gains an optional `notConsulted`, omitted by every read that
  consults everything — so its presence is the signal, and no existing response
  changes.

- [#1269](https://github.com/nextlyhq/nextly/pull/1269) [`703f22c`](https://github.com/nextlyhq/nextly/commit/703f22c47cbc0f3768aa152235ca3ad4b66693cf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A translator can now ask what needs them, across the whole site, in one
  language. `GET /api/translations?locale=es&state=missing` returns the
  outstanding documents from every localized collection at once.

  Everything under it already existed: a collection's list query has long
  accepted a reserved `_translated` filter and turned it into a companion
  EXISTS/NOT EXISTS condition, and the entry table already offers that filter on
  one collection. What nobody could ask is the question spanning collections, so
  finding the work meant opening every document in turn. This adds the fan-out and
  reuses the filter, the SQL and the state vocabulary already in use.

  Rows are read with the caller's own user context, roles included, so each
  collection's stored read rules run per row. That matters more than it sounds: a
  worklist is a list of titles, and filtering only at collection level — the
  dashboard's model — would list every author's titles back to a role scoped to
  its own entries. Passing the id without the roles would fail the other way, and
  a role-based collection would report itself fully translated.

  The fan-out is capped at 20 collections and the ones it left out are NAMED in
  the response rather than dropped, because a worklist that silently omits a
  collection reads as "nothing to do there".

- [#1053](https://github.com/nextlyhq/nextly/pull/1053) [`782cf82`](https://github.com/nextlyhq/nextly/commit/782cf82ffa502b3af3467f1166e7ce16dc63658c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a host keep its Alt shortcuts while the layers tree has focus. Reordering blocks with alt+arrow did nothing when focus sat in the page editor's layers panel, because the tree read the arrow key without checking modifiers and moved its own focus instead.

- [#1047](https://github.com/nextlyhq/nextly/pull/1047) [`8ff87ca`](https://github.com/nextlyhq/nextly/commit/8ff87ca56860026497be0c97cb603e369a09f05d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The tree view can show more than one row selected, and the page builder layers panel now highlights everything the canvas does. Rows can be added to the selection with Cmd or Ctrl click and a run selected with Shift click, from the keyboard as well as the pointer.

- [#1191](https://github.com/nextlyhq/nextly/pull/1191) [`76f716f`](https://github.com/nextlyhq/nextly/commit/76f716fece75dc23e901a6a959788c4b34a5408f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A read that skips access checks reaches the collections its relationships point at as well,
  and those were never named by the caller — they were reached through a field. Saying which ones
  it may reach was optional, so a read that had weighed the question and one whose author never saw
  it looked identical: both said nothing, and nothing meant all of them. That omission has shipped
  twice and was caught by review both times.

  Declaring the reach is now required wherever an expansion runs, and a read that trusts everything
  says so by name. No read changes what it returns.

- [#1175](https://github.com/nextlyhq/nextly/pull/1175) [`ba700b5`](https://github.com/nextlyhq/nextly/commit/ba700b5d34abcc3bf3a259ced6fa1ed33e39d4bf) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Unify default-value computation for nested sub-fields across `ComponentInput` and `RepeaterInput`.

  Previously, appending a new component or repeater row computed defaults inconsistently across inputs, leaving nested repeatable component fields as `null` instead of empty arrays and omitting fallback defaults for text and chips sub-fields. Default computation is now centralized in `createDefaultFieldValues` aligning with `getDefaultValues`, and `RowLimitNotice` now accurately displays minimum-rows requirements when an array is empty.

- [#1219](https://github.com/nextlyhq/nextly/pull/1219) [`0709e5e`](https://github.com/nextlyhq/nextly/commit/0709e5ec0cf42351d7acb21bbad767de4c339ae6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a user no longer deletes the files they uploaded. `media.uploaded_by` carries a
  cascading foreign key to the account, so removing a person destroyed every image, document and
  video they had ever added — enforced by the database itself, beneath every service, hook and
  access check, with nothing to intercept it and no warning. A logo uploaded by someone who has
  since left is still the site's logo.

  Deleting an account now clears its name off those files first, in the same transaction, so the
  files stay and only the attribution goes. This applies on every database immediately, existing
  sites included, because it needs no schema migration.

- [#1270](https://github.com/nextlyhq/nextly/pull/1270) [`e78cd96`](https://github.com/nextlyhq/nextly/commit/e78cd966e113870667458dd27438ea1a902a2df7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Validation rules are now edited the same way everywhere, and the form builder
  stops offering rules it cannot enforce.

  The schema builder and the form builder each drew their own validation editor.
  They had drifted: different labels, different help text, and different ideas
  about which rules a field even accepts. The form builder decided that by
  listing type names — text and textarea get length limits, number gets min and
  max — so a field type it had not been written to know about matched none of the
  names. Both surfaces now ask the same question of the same place.

  Fields that exist only inside a form — URL, phone, time and hidden — were being
  offered almost nothing, because they are not part of the core field list that
  answers this question. They store text, so they are now understood as text. A
  URL field with no pattern option was the most obvious casualty.

  The form builder now offers each field type exactly the rules its own validator
  reads back for that type, which is narrower than it sounds and is the point. A
  date accepts minimum and maximum values, and the form's validator reads those
  from a different place — so offering them here would store a bound nothing
  consults. The same was true of length limits on email, phone and URL fields, a
  pattern on a textarea, and every rule on time and hidden fields. A limit that is
  stored but never applied is worse than no limit at all, because the author
  believes the form is guarded when it is not.

  The message shown when a value fails no longer says it describes the pattern.
  In a form it is used for required, length and format failures too, so copy
  written for one rule was appearing for others.

  Plugin authors can build the same editor into their own admin pages —
  `ValidationRulesEditor` is published through `@nextlyhq/plugin-sdk/admin`,
  alongside the controls published in the previous release.

- [#1321](https://github.com/nextlyhq/nextly/pull/1321) [`9805fad`](https://github.com/nextlyhq/nextly/commit/9805fad34487ddf39d38f8b32fe66eb3c763e1b0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Name a version comparison in the language it is about, so a localized
  document is not headed by another language's title, and keep a code or JSON
  field's presence when its lines are too many to align, so a field that was
  added or removed says so instead of reporting a change to something that was
  not there.

- [#1236](https://github.com/nextlyhq/nextly/pull/1236) [`4669bfd`](https://github.com/nextlyhq/nextly/commit/4669bfdd6442badcae91bb21e0c8faa9752d8274) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Version history could be opened but not easily closed. The panel offered no
  close control where one is normally found, clicking the page behind it was
  deliberately ignored, and the only button that did close it sat in the row of
  actions at the bottom — a row that gains three more buttons the moment a
  version is selected, wraps at the panel's width, and carried that button off
  the edge of the screen. Escape worked, but nothing said so.

  The panel now closes from a control beside its title, where a dismissible
  surface is expected to keep one, and it stays there whichever state the panel
  is in. The action row no longer holds an exit, so the compare controls are
  free to wrap onto a second visible line instead of pushing one off-screen, and
  the row itself is gone entirely while no version is selected rather than
  sitting empty below the list.

  Nothing else about the panel changes: it stays beside the document rather than
  over it, so the document it describes is still readable and scrollable while
  history is open.

- [#1247](https://github.com/nextlyhq/nextly/pull/1247) [`d754cfa`](https://github.com/nextlyhq/nextly/commit/d754cfa881f34d7bafc831c6d0e6840ae8b19164) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Version history now has a page of its own.

  Comparing two versions from the history panel meant opening a dialog on top of
  it — two floating surfaces at once, over a document you could no longer see,
  with a comparison squeezed into whatever the panel left over. The comparison
  now opens as a page: the list of versions on the left, the comparison filling
  the rest, and the browser's own back button as the way out.

  The pair being compared is part of the address, so a comparison can be sent to
  a colleague rather than described to them. Opening the page without naming a
  pair shows the most recent change, which is what someone arriving from a
  bookmark is looking for.

  Each version in the list now says what changed in it — the fields, by name —
  so you can find the change you remember without opening each one in turn.

  The history panel stays for a quick look beside the document you are editing,
  and gains a control that opens the full comparison.

  On a document translated into several languages, a comparison now stays within
  one language. The versions of every language share one numbered history, so the
  version before v5 English is often v4 French — a pair that is not a
  before-and-after of anything, and which the server refuses outright. Opening the
  history of a translated document, or choosing a version in it, compares against
  the previous version OF THAT LANGUAGE.

  A version whose predecessor has not been loaded yet no longer claims to be the
  first one ever recorded. It said so at the bottom of every page of a long
  history, and choosing that version then did nothing at all.

  "Open full comparison" is offered only once it knows which pair it would open.
  It previously appeared for every version and, where no pair had been resolved,
  opened a comparison of the two newest versions instead — something the reader
  had not asked to see.

  A history that fails to load no longer also says the document has no versions
  yet. The two now read differently, because "saving will record its first
  version" is the wrong thing to tell someone whose history is merely unreachable.

  Someone with permission to read a document but not to edit it can now use the
  back control. It pointed at the editor, which their permission refuses, so the
  one control always on screen led to a permission error.

- [#1303](https://github.com/nextlyhq/nextly/pull/1303) [`1608884`](https://github.com/nextlyhq/nextly/commit/1608884a297632dfbd03323780d81518f5602c51) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Name each version's language in the comparison page's history rail, and
  stack the rail above the comparison on narrow viewports instead of leaving
  the comparison a sliver beside it.

- [#1181](https://github.com/nextlyhq/nextly/pull/1181) [`7f3c431`](https://github.com/nextlyhq/nextly/commit/7f3c431cb01e360fb88b7637d08cd74f9bac87d1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Warns a block author, in development, when their block does not render a single
  element. The block contract states that a block renders one element and never
  wraps it, because the generated class has to go somewhere — so a block returning
  a fragment, a list or a primitive gives that class no root element to sit on,
  and until now nothing said so.

  Deliberately NOT "its styles never apply", which is the stronger claim and is
  false for a real shape: a wrapper root that places the supplied class on a child
  renders it into the DOM, and the compiled CSS matches normally. What such a
  block certainly loses is the node's ROOT FIELDS — `cssId` and attributes are
  attached to the block's own root element and have nowhere to go — so the warning
  is right and the diagnosis is the narrower one.

  The only existing signal arrived through the placeholder that replaces such a
  block when a document sets an `id` or an attribute on it. That blames the wrong
  person at the wrong moment: a page author sets an anchor, watches the block
  vanish, and has done nothing wrong, while the block author never hears about it.
  The warning fires on the first render instead, whether or not anyone asked for
  anything.

  Read from what the boundary actually received rather than predicted from the
  definition, so the warning and the placeholder cannot come to disagree about the
  same output. A block that draws nothing on purpose is exempt, asked through the
  same rule the placeholder already uses.

- [#1010](https://github.com/nextlyhq/nextly/pull/1010) [`e41222f`](https://github.com/nextlyhq/nextly/commit/e41222fead5a69407c2a99914fa6b41ede864e9f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry and single editors get a language panel: one place that says what
  state every language is in and carries the actions that follow from it, in the
  document rail where there is room and inline where there is not, so the
  language workflow can no longer be the surface that disappears at narrow
  widths.

  Singles can now copy content from another language. The action used to gate on
  a collection slug and an entry id, which is how an entry is addressed rather
  than anything the action needs, so it was collection-only by accident; both
  editors now supply the read themselves and it gates on being able to read a
  source.

  Switching languages is withheld while a past version is on screen, alongside
  the mutations it already withheld, and each language row's controls name the
  language they act on.

- [#1317](https://github.com/nextlyhq/nextly/pull/1317) [`d3908b1`](https://github.com/nextlyhq/nextly/commit/d3908b166749575d7a815de2cf8576b8e1f6b02c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now supplies the class library to its inspector, so the class
  selector is reachable in the editor rather than only in isolation.

  Creating a class writes the site style's `classes` section and answers with the
  new class's id; putting it on the selected block stays with the inspector,
  which already writes blocks. That keeps one application path, so the limit on
  how many classes a block may carry is enforced in a single place rather than
  once per caller.

  A refused save is reported in the author's words instead of clearing the name
  they typed, and a library still being read is told apart from a site that
  genuinely has no classes — only one of those has a field about to fill.

- [#1065](https://github.com/nextlyhq/nextly/pull/1065) [`fb05a08`](https://github.com/nextlyhq/nextly/commit/fb05a08b9c4605091f3aa151ce2d3ac86f3e4640) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Key a pending change by the language it belongs to, and clean it up correctly.

  Deleting a document now removes its pending changes in every language rather
  than only the unlocalized one, which would otherwise leave rows behind pointing
  at a document that no longer exists. A write that cannot name the language it is
  for no longer stores a pending change under the wrong key, where nothing would
  find it again.

- [#1059](https://github.com/nextlyhq/nextly/pull/1059) [`9f57bb3`](https://github.com/nextlyhq/nextly/commit/9f57bb3e674d02daace62f12c9b2d39570846aa8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold a document to one pending change per language in the database.

  A working draft is the only row class the version table's sequence index cannot
  constrain: it carries no version number, and SQL treats NULL as distinct from
  NULL. A dedicated key column, set only on that row class, lets one ordinary
  unique index enforce the rule on every dialect, so two writers can no longer
  each store a pending change for the same document and language.

- [#1174](https://github.com/nextlyhq/nextly/pull/1174) [`2c6b5dc`](https://github.com/nextlyhq/nextly/commit/2c6b5dc28ba3a7013401affa757bbcfe4ac4138d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Schema generator: unify top-level and nested group field Zod schema generation into a single dispatch path and enforce validation constraints consistently.

## 0.0.2-alpha.60

### Patch Changes

- [#995](https://github.com/nextlyhq/nextly/pull/995) [`205ac43`](https://github.com/nextlyhq/nextly/commit/205ac43ecab968ba3346863773a17fc497bffe02) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin and `@nextlyhq/ui` now enforce the same design-token rules shipped to plugin authors.

  Twelve inline styles became utility classes, so those surfaces follow the theme and the spacing scale rather than fixed values. The page-builder drop indicator was painted a fixed `deepskyblue` that ignored light and dark mode entirely; it now uses the primary token.

  The email preview's palette is named in one place and documented as deliberately literal — mail clients do not resolve CSS custom properties, so a preview built from admin tokens would show authors something recipients never receive.

  A `design-lint-ok` exemption now annotates the construct it precedes rather than a single line, so a multi-line declaration needs its reason recorded once. The reach is bounded and cannot extend past a function.

- [#990](https://github.com/nextlyhq/nextly/pull/990) [`da50ecb`](https://github.com/nextlyhq/nextly/commit/da50ecb035f86c11e60e50f85497b2ca6cf81364) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Outline badges now show the border colour they are given. Seven places in the admin ask one for a
  specific colour — a green edge on an enabled plugin, red and blue on submission states — and every
  one was quietly drawn in the default grey instead. The enabled-plugin pill in particular asked for
  a stronger green so its edge stays visible against the background, and did not get it.

- [#999](https://github.com/nextlyhq/nextly/pull/999) [`f9dbc5f`](https://github.com/nextlyhq/nextly/commit/f9dbc5f86d51fda80b6fd7f2109aa387cd9a5fe8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Restoring a version is now offered from the historical-document banner: the entry form passes its restore handler through, so an authorised reader sees the action beside the version they are reading rather than nowhere at all.

- [#998](https://github.com/nextlyhq/nextly/pull/998) [`6bf8cca`](https://github.com/nextlyhq/nextly/commit/6bf8ccaa7c5b39cf8142853e66d223b71f3c7568) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The selected block can now be edited. An inspector reads the props a block declares and draws a control for each, so a heading inserted from the palette can be given its real text instead of staying at the example the palette supplied.

- [#983](https://github.com/nextlyhq/nextly/pull/983) [`14dc716`](https://github.com/nextlyhq/nextly/commit/14dc7166c07e9f5e059b54be7a14ca8c06678437) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The selected block is now outlined on the canvas, and a keyboard move is announced to assistive technology — naming whether the block was reordered or moved into or out of a container, which a keyboard author cannot see.

- [#991](https://github.com/nextlyhq/nextly/pull/991) [`376429a`](https://github.com/nextlyhq/nextly/commit/376429ae4dcf559a29043db4ce9af907dc44ade7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block can now be deleted with Delete or Backspace, and any edit undone with Ctrl+Z or Cmd+Z and redone with Shift+Z or Y. The editor could add and reorder blocks but not remove them, and its undo history had no way to be invoked.

- [#1005](https://github.com/nextlyhq/nextly/pull/1005) [`8df7086`](https://github.com/nextlyhq/nextly/commit/8df7086c2eaca7634d6350115394547a6aa05b80) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry editor's language tools are now visible, reachable, and legible.

  In a localized collection, the document title was invisible: the language strip shared its header row and squeezed the title input to zero width at every screen size. The title now has its own row, with languages on a row of their own beneath it.

  One segmented control shows every language with its state (published, translated, draft, or not translated — carried by shape and text, never colour alone) and switches between them; it replaces the separate dropdown and pill row that both switched languages. A Languages menu in the header offers Copy from and Publish all languages at every screen width — previously those lived only in a side panel that disappears on smaller screens — along with a legend for the language states.

  Creating an entry now says which language it will be created in. The "Shared across languages" badge appears only while editing a non-default language, where it matters. If a language fails to load, the editor offers the way back to the default language instead of only an exit.

- [#985](https://github.com/nextlyhq/nextly/pull/985) [`2d11910`](https://github.com/nextlyhq/nextly/commit/2d1191061664111851c30b1739c859a309a51399) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The collection-entries list now remembers your column choice the same way every other admin list
  does. Behaviour is unchanged — it already remembered — but it is one mechanism now rather than
  two, so the lists cannot drift apart.

- [#984](https://github.com/nextlyhq/nextly/pull/984) [`811c4bf`](https://github.com/nextlyhq/nextly/commit/811c4bf653ea40129d4448b01452f533bdf50bc8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field rendered twice on one page no longer collides with itself. A field's DOM id was its path,
  which is unique within a form and not within a page — so showing a past version beside the live
  editor gave both copies the same ids, and every label in the version panel pointed at the live
  editor's control instead. Those fields lost their accessible name, and clicking one of their labels
  moved focus into the editable document. Ids are now scoped per rendering; the live editor's ids are
  unchanged.

- [#996](https://github.com/nextlyhq/nextly/pull/996) [`42f0c1e`](https://github.com/nextlyhq/nextly/commit/42f0c1e669f1634064d1d90a63790b8cf8c24e46) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reading a past version is now read-only all the way through, and can be acted on from where it is
  read. The save controls stand down while a version is on screen — they act on the live document,
  which is not what is being read — and restoring is offered from the banner over the version itself.

  Three things that stayed editable are fixed with it. The title and the slug are part of the
  document, so they lock with the rest of it rather than quietly changing the live entry from a
  historical page. The set of fields a version shows is now decided by that version's own values, so
  a document whose layout has changed since is not shown through today's layout. And returning to the
  live document clears the panel's selection too, so no row stays marked as the version on screen.

- [#994](https://github.com/nextlyhq/nextly/pull/994) [`85d0d97`](https://github.com/nextlyhq/nextly/commit/85d0d97945abab5797f18da63e6d9f7e21580a87) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Version history reads in the document now. Choosing a version from the panel renders it where the
  document is, read-only, with a banner naming which version is on screen and a way back to the live
  one — instead of squeezing a page into a 480px column beside it. The panel keeps the timeline.

  The live document is untouched throughout: the historical values are rendered against a form of
  their own, so nothing typed is disturbed by opening history and nothing historical can reach a save
  or an autosave. An empty history now leads with a heading rather than a sentence, because when the
  panel is empty that line is the only thing in it.

- [#1001](https://github.com/nextlyhq/nextly/pull/1001) [`055dc7f`](https://github.com/nextlyhq/nextly/commit/055dc7ffb0e8e4038b3f7f2c812e677d0c45903a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Selecting an empty container and inserting now puts the block inside it. Every insert landed as a sibling before, so a container could be added and never filled, and the panel says which of the two placements it will use.

- [#993](https://github.com/nextlyhq/nextly/pull/993) [`5037057`](https://github.com/nextlyhq/nextly/commit/5037057fa10f1fedee25bfcc272d24314ad11528) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Inserting a block now adds one you can see. Blocks were inserted with their defaults, which are deliberately empty, so a new heading rendered as an empty element with no height and the page looked unchanged.

- [#989](https://github.com/nextlyhq/nextly/pull/989) [`ff2fb60`](https://github.com/nextlyhq/nextly/commit/ff2fb60ba340d08063c63f68b39df06d72b0cc57) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A JSON field's parse error is announced again. Scoping field ids moved the error node without
  moving the reference to it, so in a version preview the control described an element that did not
  exist — and a dangling description reaches assistive technology as no description at all, which is
  worse than the plain error it replaced.

- [#980](https://github.com/nextlyhq/nextly/pull/980) [`fad081c`](https://github.com/nextlyhq/nextly/commit/fad081c242f6e04ae72a3ecf352a38da73f57fda) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every admin list now remembers which columns you hid. Previously only collection entries did, so
  narrowing a wide table anywhere else lasted until you closed the tab. Each list keeps its own
  choice, so hiding a column on Users does not change what Roles shows you.

- [#1002](https://github.com/nextlyhq/nextly/pull/1002) [`b903379`](https://github.com/nextlyhq/nextly/commit/b903379ae597168156d4ece4b8622d340be96ad5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `no-hardcoded-colors` now catches CSS named colours.

  The rule already rejected hex, `rgb()`, `hsl()` and `oklch()`, but a name like `deepskyblue` passed — which is how a fixed colour that ignores light and dark mode sat on the page-builder's drop indicator until it was found by reading a file flagged for something else.

  A colour name is an ordinary word, so it is reported only where its position makes it a colour: the value of a colour-valued style property, or the right-hand side of a CSS declaration. Prose and data are untouched — `"the red team"`, `{ fruit: "plum" }` and a label reading `"Tomato"` are all fine. `black`, `white` and `transparent` stay exempt, as their hex spellings already were.

  The rules also stop applying to test files, matching the repository's CSS guard. A fixture writing `color: red` is modelling arbitrary user data rather than styling a surface that ships.

- [#982](https://github.com/nextlyhq/nextly/pull/982) [`ea623f2`](https://github.com/nextlyhq/nextly/commit/ea623f2c06cfb57366f6debc1e613c1c84fb42eb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugins can now actually place their sidebar menu items, and the type describing where they go is importable.

  The previous release accepted a `section` declaration on menu items and then ignored it: every item was flattened into one list rendered under Plugins, so a plugin placed under Settings had its pages in one panel and its menu items in another. Items are now attributed through the same chain a plugin's pages use — the item's own declaration, then the plugin's placement, then Plugins.

  `PluginNavSection`, the type the field is declared with, was also missing from both the `nextly` root and `@nextlyhq/plugin-sdk`, so a plugin author could not import it.

- [#1004](https://github.com/nextlyhq/nextly/pull/1004) [`9b27446`](https://github.com/nextlyhq/nextly/commit/9b274464cbcc28e48637876cae0ef4d1b76d7b01) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scaffolded plugin no longer bundles a copy of `@nextlyhq/ui`.

  The UI kit is supplied by the host admin at run time, but the plugin template declared it only as a devDependency — and tsup externalises peer dependencies while bundling dev ones, so the entire kit was inlined into every published plugin. It is now declared as a peer, matching the first-party plugins, and named in the template's externals.

- [#986](https://github.com/nextlyhq/nextly/pull/986) [`e56dddb`](https://github.com/nextlyhq/nextly/commit/e56dddb31483d0e76f5dbeaca2681d55c42f398e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix five further defects in `@nextlyhq/eslint-plugin` and its guard.

  `no-static-inline-style` reported a computed style key as constant. `{ [cssProperty]: 8 }` styles whichever property the variable holds, so the declaration is runtime-dependent and the rule was rejecting correct code.

  `no-hardcoded-colors` did not detect `oklch()` or `oklab()` literals, which matters more than the older spellings because Nextly's tokens are themselves OKLCH.

  The `design-lint-ok` exemption was matched by substring, so a bare marker silenced a rule while recording no reason, and unrelated text containing the marker silenced one by accident. It is now a directive that must carry a reason.

  `@nextlyhq/plugin-sdk` imported the design-token config without applying it, so its own lint never ran these rules.

- [#988](https://github.com/nextlyhq/nextly/pull/988) [`03cd7d8`](https://github.com/nextlyhq/nextly/commit/03cd7d81bd3e830079217110d8bd8d32cafefbf1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The line under the selected tab now follows the theme. It was marked so that nothing could
  override it, which made it the one piece of admin colour a retheme could not reach.

- [#1003](https://github.com/nextlyhq/nextly/pull/1003) [`03e5182`](https://github.com/nextlyhq/nextly/commit/03e518254e640114fafd8251841b9ed58a88959a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reading a past version now waits for the snapshot to arrive before showing it or offering to restore it. A version read that has not returned reports neither progress nor failure, which previously rendered an empty document as though it were the version and enabled restore for a version nobody had seen.

## 0.0.2-alpha.59

### Patch Changes

- [#970](https://github.com/nextlyhq/nextly/pull/970) [`87c544d`](https://github.com/nextlyhq/nextly/commit/87c544d6904f0f7f66f4287199f70e276ee34266) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `@nextlyhq/eslint-plugin`: design-token lint rules that plugin authors can run in their own projects.

  Nextly's admin is themeable because its surfaces read design tokens, and a surface that reaches past them keeps its light-mode appearance in dark mode. That contract was only enforced inside this repository, so the first-party plugins followed it and plugins built by anyone else had nothing checking them.

  The new package ships three rules — `no-palette-classes`, `no-hardcoded-colors` and `no-static-inline-style` — with a `recommended` config bundled in. Install it and extend `nextly.configs.recommended` to get the same checks the admin holds itself to, in your editor and in your CI. A genuine exception is marked in place with a `design-lint-ok: <reason>` comment rather than by disabling a rule.

  The repository's own design guard now derives which trees it scans instead of listing them, so a plugin package added later is covered automatically, and it reports what it read so a run that scanned nothing can no longer be mistaken for a clean one. The plugin template's settings page is rebuilt on design tokens, matching the guidance its own comment gives.

- [#977](https://github.com/nextlyhq/nextly/pull/977) [`fa0db5e`](https://github.com/nextlyhq/nextly/commit/fa0db5eb51c477fc2b73cd6bcf04252bd774736e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The selected block can be moved with the keyboard: alt+arrow up and down reorder it, alt+arrow left and right move it out of and into a container. Dragging is not the only way to reorder a page, which WCAG 2.2 requires of any function operated by a drag.

- [#979](https://github.com/nextlyhq/nextly/pull/979) [`d16b42c`](https://github.com/nextlyhq/nextly/commit/d16b42cae03c18417bad7728fc49ab31ba3abbbd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hiding a column in an admin list now sticks. The control has always been there, but only the
  collection-entries list remembered what you chose — everywhere else, narrowing a wide table
  lasted until you closed the tab. Roles remembers now, and the rest follow the same route.

- [#975](https://github.com/nextlyhq/nextly/pull/975) [`02a4df8`](https://github.com/nextlyhq/nextly/commit/02a4df814dbbd1ef84308e25244537095da696ea) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every admin list now shares one layout. Loading and failure are part of it: a list that is still
  loading, or that failed to load, keeps its search field and controls in place instead of
  replacing the whole page with a message. The search box no longer disappears from under you the
  moment you type, and the page no longer jumps when results arrive.

  Email providers keeps its type filter visible in the toolbar rather than behind a dropdown, so
  you can see what the list is filtered to without opening anything.

- [#972](https://github.com/nextlyhq/nextly/pull/972) [`1b369d1`](https://github.com/nextlyhq/nextly/commit/1b369d1a60ee2174fe94c7c984394de988d3bfd7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collections, field groups and Singles use the shared list layout, so search, filters, the column
  control and the spacing above the table match every other list in the admin.

  Their empty states are part of that now. Each page carried its own, and each drew the same
  distinction by hand — one message when the list is genuinely empty, with a button to create the
  first record, and a different one when a search or filter simply matched nothing. That rule now
  lives in one place, so no list can drift into offering "create your first" to someone whose
  search just came up short. The empty state also reads as a heading to a screen reader, which it
  did not before.

  When a collections or field-groups list fails to load, the page now reports it the way every
  other list reports a failure, instead of showing a separate warning above a table that is still
  drawn.

- [#974](https://github.com/nextlyhq/nextly/pull/974) [`4891d3f`](https://github.com/nextlyhq/nextly/commit/4891d3fae8ca1ce9a75ef3e44e38357b4f967888) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A past version now reads the way the document reads. Previewing one used to go through a viewer
  written only for version history, which had its own idea of how each field type looked and knew
  nothing about tabs, rows or collapsible sections — so a version was legible but never quite the
  page it came from. It is drawn by the editor's own field components now, read-only, which means
  layout survives, every field type presents exactly as it does when editing, and a field type added
  in future is supported in history the day it renders in the editor.

  The snapshot is rendered against its own form rather than loaded into the live one. Nothing an
  editor has typed is disturbed by opening a version, and no historical value can reach a save or an
  autosave, because those values never enter the form that either of them reads.

- [#978](https://github.com/nextlyhq/nextly/pull/978) [`4fb19fe`](https://github.com/nextlyhq/nextly/commit/4fb19feb500e33941ab32fd0f7e4ae2cb29b36a0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two defects in how a past version renders, both found in review.

  Selecting a second version while the panel stayed open left the previous version's values on screen
  under the new version's heading. The form read its values once when it mounted, and the panel does
  not remount it between selections; it now follows a changed snapshot itself, so the correct
  behaviour belongs to the component rather than to every caller remembering to remount it.

  Structured fields could render empty for a version that plainly held something. A snapshot is
  captured from the persisted row, so a JSON-backed field arrives as text on SQLite and as an object
  on Postgres and MySQL, and a boolean arrives in any of four spellings. Those values are now read
  into runtime shapes before the editor sees them, through the same coercion the diff and the value
  kit already use.

- [#973](https://github.com/nextlyhq/nextly/pull/973) [`0d974f7`](https://github.com/nextlyhq/nextly/commit/0d974f738a633ea7280726bffb5b4ee3ad04cdd0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix two defects in `@nextlyhq/eslint-plugin`'s colour vocabulary.

  `no-palette-classes` missed a fixed palette colour placed behind an arbitrary Tailwind variant — `data-[state=open]:bg-red-500`, `supports-[display:grid]:bg-red-500` and the bracket-led `[&>*]:bg-red-500` all reported clean, so a colour that ignores dark mode and retheming passed lint.

  `no-hardcoded-colors` rejected the four-digit spelling of the mode-invariant colours it documents as legitimate: `#0000` and `#fff8` were reported as hardcoded, because alpha was only offered on the six-digit forms.
