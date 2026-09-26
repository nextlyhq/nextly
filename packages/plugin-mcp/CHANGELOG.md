# @nextlyhq/plugin-mcp

## 0.0.2-alpha.67

### Patch Changes

- [#1874](https://github.com/nextlyhq/nextly/pull/1874) [`ce962c7`](https://github.com/nextlyhq/nextly/commit/ce962c7c0eda26659674261f544ea545e48afa2e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A class whose id was `__proto__` could not be renamed again after a refused
  save. The class manager records which rename of each class is the live one, and
  it kept that record on a plain object keyed by class id, where `__proto__` reads
  back an inherited object and a write to it stores nothing. The refused rename
  never released its pending name, so retrying the same name was taken as no
  change at all.

  The record is now a `Map`, and the pending names are read as the record's own
  entries in both the editor and the class manager panel, so a class behaves the
  same whatever id it carries.

- [#1876](https://github.com/nextlyhq/nextly/pull/1876) [`14f98f7`](https://github.com/nextlyhq/nextly/commit/14f98f7c1d0444330509289895c22140b82a2425) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A link saved in a pattern now points at the element the page actually shows.
  When a selection held a visible renamed element and a hidden copy with the
  same id (hidden by a visibility condition), a link from an unrelated block could
  keep the old id, which nothing renders once the hidden copy is left off the
  page. The visible element now decides where such a link points. A hidden
  element decides only when nothing visible carries that id, so a link and its
  target stay together when the condition later shows it. Hidden elements still
  get their own ids put back.

- [#1890](https://github.com/nextlyhq/nextly/pull/1890) [`9225d83`](https://github.com/nextlyhq/nextly/commit/9225d83bcf412df81cda8b841fceb3725e13c6d6) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Three field-editor fixes:

  The form builder's field list was keyed by the field's name, and the Field
  Name input rewrites that name on every keystroke — so each character
  unmounted the card being edited and focus fell out of the input, forcing the
  author to click back in before every next character. Card keys are now minted
  by the list and follow the field through a rename, so renaming a field keeps
  its card, and the input's focus, in place.

  The Schema Builder translated a Label into its auto-derived Name one
  character at a time: every space, apostrophe, period or colon became its own
  underscore, so a label of "phone no." named the field `phone_no_`. The
  derivation now follows the formatting rule the builder's other name and slug
  derivations already apply — a run of anything that is not a letter or a digit
  collapses to one underscore, and nothing dangles at either end. The rule is
  for labels only: a stored name the server already accepts passes through
  every save untouched (its legal underscore runs and trailing underscore are
  identity, not noise), a name minted under the previous rule still follows its
  label, and renaming a form field keeps the card open through the empty
  intermediate value of a clear-and-retype.

  A Code field's content could overflow its box: field rows lay fields on
  proportional grid tracks, and a bare `Nfr` track honors an item's
  min-content — which a Code field makes as wide as its longest unwrapped
  line, since CodeMirror draws its document with `white-space: pre`. Each row
  item's automatic minimum is now zeroed, so tracks keep their proportional
  width and a long line scrolls inside CodeMirror's own scroller instead of
  widening the page.

- [#1891](https://github.com/nextlyhq/nextly/pull/1891) [`04ac714`](https://github.com/nextlyhq/nextly/commit/04ac7145684096ed3887fe6c2faf0dffb740f5b0) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - QA round: builder layout and editor fixes.

  The schema builder's Advanced tab offered the Localized switch on component
  references, where it could only save a flag storage cannot honour — the
  reference holds no value of its own, so toggling it read as Apply being
  broken. The switch is now disabled there and names where component
  localization actually lives: the fields inside the component.

  The builder pages render standalone, and the breadcrumb above the entity
  name was plain text — on a phone there was no way back to the list after
  saving. It is now a link home. The field editor sheet no longer pushes its
  left edge off narrow screens, select popups clamp to a scrollable height
  even where the positioning variable is absent, the list-view card title and
  value cells can shrink so long text truncates inside the card instead of
  painting over it, and plugin route URLs wrap within their card instead of
  overflowing past it.

- [#1893](https://github.com/nextlyhq/nextly/pull/1893) [`95a3318`](https://github.com/nextlyhq/nextly/commit/95a3318f5278a49fb82a5fa4ccd3093ef8f75ae8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The development toolchain moves to Node 24.21.0 and pnpm 12.5.1. Nothing
  about the published packages changes: `engines.node` still reads
  `^20.19.0 || ^22.12.0 || >=24.0.0`, so Node 20 and 22 remain supported, and the
  version legs `package-smoke` derives from that range still test their floors.
  What moved is what contributors and CI run.

  The pnpm upgrade is the part with teeth, because modern pnpm reads its settings
  from one place and silently ignores the others. The `pnpm.overrides` block in
  `package.json` and `link-workspace-packages` in `.npmrc` were both being read
  by pnpm 9 and would both have been dropped without a word — the overrides are
  security floors, so losing them would have been quiet rather than loud. They now
  live in `pnpm-workspace.yaml` as `overrides` and `linkWorkspacePackages`,
  entry for entry, alongside an `allowBuilds` allowlist that replaces the
  `onlyBuiltDependencies` spelling pnpm deprecated.

  Two dependencies the root had been getting by accident are now declared. pnpm 9
  linked `@nextlyhq/eslint-config` and `@nextlyhq/prettier-config` into the
  workspace root even though nothing asked for them; pnpm 10 stopped, and the root
  `eslint.config.mjs` — which imports the first — could no longer be loaded, so
  every package without its own config failed to lint. `typescript-eslint` was
  reaching the plugin template the same way. A dependency that resolves because of
  a hoisting accident is a dependency that disappears without its manifest ever
  changing, which is what happened here.

- [#1888](https://github.com/nextlyhq/nextly/pull/1888) [`109ff0a`](https://github.com/nextlyhq/nextly/commit/109ff0ac4fe2f3b238c7afcf7e47068eb892f3bd) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - User emails are lowercased when an account is created, so an address typed
  with any capital letter is now findable at sign-in instead of permanently
  failing with "Invalid email or password". Creating an account whose email
  matches an existing one is now rejected as a duplicate — including
  repeating an address an earlier version stored with uppercase letters — and
  findByEmail keeps finding those legacy accounts by their stored spelling.
- Updated dependencies [[`ce962c7`](https://github.com/nextlyhq/nextly/commit/ce962c7c0eda26659674261f544ea545e48afa2e), [`14f98f7`](https://github.com/nextlyhq/nextly/commit/14f98f7c1d0444330509289895c22140b82a2425), [`9225d83`](https://github.com/nextlyhq/nextly/commit/9225d83bcf412df81cda8b841fceb3725e13c6d6), [`04ac714`](https://github.com/nextlyhq/nextly/commit/04ac7145684096ed3887fe6c2faf0dffb740f5b0), [`95a3318`](https://github.com/nextlyhq/nextly/commit/95a3318f5278a49fb82a5fa4ccd3093ef8f75ae8), [`109ff0a`](https://github.com/nextlyhq/nextly/commit/109ff0ac4fe2f3b238c7afcf7e47068eb892f3bd)]:
  - nextly@0.0.2-alpha.67
  - @nextlyhq/plugin-sdk@0.0.2-alpha.67

## 0.0.2-alpha.66

### Patch Changes

- [#1792](https://github.com/nextlyhq/nextly/pull/1792) [`da323d5`](https://github.com/nextlyhq/nextly/commit/da323d58366d362dfaadb7a1ab9593dbf98d18b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The schema builder's drag announcements name every field, and its row ids are
  only the ones the list mints.

  A field just added to the canvas has no label and no name until its author
  fills them in, and it drags in that state: it was announced as nothing at all
  ("Picked up , row 2") and, beside a named field, as "and Title". It is now
  called "an unnamed field", on the announcement and on the nested drag handle
  alike. A row id that is not `row-` followed by a canonical nonnegative integer
  no longer names a row, so a drop the reorder would refuse is no longer
  announced as a move.

- [#1697](https://github.com/nextlyhq/nextly/pull/1697) [`b87f0d3`](https://github.com/nextlyhq/nextly/commit/b87f0d3d0d6468c17bb9728738a1729b07c74230) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard card asserted a meaning its own data did not have. The status
  breakdown was generated for any collection carrying a field NAMED `status`, and
  the schema permits an ordinary field of that name with the publishing lifecycle
  switched off — so such a collection got a card titled "by status", describing
  the split "between draft and published", over a column holding whatever that
  author's field holds. It is now gated on the lifecycle capability itself, which
  is what the health card beside it already read.

  A chart's placeholder rows were told apart by styling alone. A bucket holding no
  value and one holding the literal text `(empty)` were drawn in different colours
  and announced identically, so the readers who most needed the distinction were
  the ones without it. A placeholder now says what it is — "no value stored" —
  rather than relying on italics. Exact separation is not achievable, because no
  string can be reserved from a column of arbitrary text; what is fixed is that
  the placeholder describes itself instead of depending on something a screen
  reader never sees.

- [#1756](https://github.com/nextlyhq/nextly/pull/1756) [`705926b`](https://github.com/nextlyhq/nextly/commit/705926b091c1e6ab17fd4065d89dfc2d29c094b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The collections and singles cards no longer decide for themselves whether they
  have anything to show.

  A fresh dashboard made the same "get started" pitch three times: the setup
  checklist, the demo-content offer, and a third panel the collections card drew
  on its own when it had no counts. The singles card went the other way and
  returned nothing at all when the install had no singles -- and a card that
  renders nothing still holds its place in the grid, so the layout reserved an
  empty slot on every install that never used them.

  Both cards now declare a condition, and the host offers them only while it
  holds. Two names join the closed set a conditional widget may use:
  `collections:present` and `singles:present`, each true while this reader may
  read at least one. They are about what exists rather than what is in it, so a
  collection with no entries yet still counts as present -- it is still something
  to list -- which is what separates them from `content:empty`. The
  `GetStartedEmptyState` panel is removed; the checklist and the demo offer, which
  the host withdraws on their own, are the two pitches a new reader meets.

- [#1723](https://github.com/nextlyhq/nextly/pull/1723) [`4c03302`](https://github.com/nextlyhq/nextly/commit/4c03302fd9a8532e033c2cfb16a878a25408b9d0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard's setup checklist is answered by the server now, and shown only
  while there is something left to do.

  It used to derive its own steps in the browser from dashboard statistics, and
  decide for itself whether to appear by reading a dismissal out of
  `localStorage`. Both were wrong in the same direction. The steps were computed
  in two places from the same four counts, so they could drift; and dismissal was
  per BROWSER, which answers a question about a person — the same admin on a
  second machine met a checklist they had already finished, and a colleague met
  one reporting someone else's progress.

  The host answers both. It reports which steps this reader has finished, and the
  widget condition deciding whether the card is offered is DERIVED from that same
  answer — so a card showing every row ticked, and a card that will not go away,
  are both unreachable.

  Steps are detected rather than self-reported: nothing is ticked by hand, the
  install is asked. Only what can be answered about the reader is included, so an
  editor is never held short of finishing by content they are not allowed to see.
  The first step is complete for everyone, and truthfully so — reaching the card
  means an account exists and they made it. A checklist that opens above zero is
  finished far more often than one that opens empty, and that head start is worth
  having only if it is true.

  A transient card can now name SEVERAL conditions, and is offered only while
  every one of them holds.

  The get-started card needed two, and neither answers alone: is there nothing to
  look at, and is the offer of demo content still open. Declining that offer
  creates no content, so the card kept its slot on the strength of the install
  still being empty — visible, drawing nothing, for a reader who had already said
  no. The two conditions are scoped differently on purpose: whether there is
  content to see is about the reader, while whether a project took the demo data
  is recorded once for the project, so a second admin is not offered it again
  after the first declined.

  The dashboard's last browser-stored dismissal is gone with it. A hook that
  derived onboarding steps in the browser and remembered dismissal in
  `localStorage` had no consumer left once the host started answering, and the
  types beside it described a checklist that no longer exists — including a step
  vocabulary listing five names none of which are detected any more.

- [#1770](https://github.com/nextlyhq/nextly/pull/1770) [`732da46`](https://github.com/nextlyhq/nextly/commit/732da46718b4e1342ad517d05a276bcfaf45ef8b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An exposure row reports itself cleared when the winning clear erases its
  target — at its own path or an ancestor's, by any exposure — never when the
  clear is below it, and a cleared row's value is always absent rather than the
  clear sentinel.

- [#1773](https://github.com/nextlyhq/nextly/pull/1773) [`716adbd`](https://github.com/nextlyhq/nextly/commit/716adbd7b710559b33d9d568f187b310206e6bd5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The insert panel offers the site's components beside its blocks and patterns,
  and placing one writes a single instance node that keeps pointing at the
  definition — nothing is copied into the page. Component definitions now reach
  the editor through a route of their own, `GET …/library/components`, gated by
  the components collection's read permission and answering the canonical
  `{ items, meta }` envelope. It lists every lifecycle state the caller may read,
  so a never-published component can be placed on a draft page, and reads each
  definition by id AS THE USER so an author who may edit a component sees its
  working draft while one who may only read it sees the live definition. The
  canvas and the entry form's resting miniature both resolve instances against
  them, so a placed component renders in the builder — and stays rendered after
  Done — rather than as a could-not-be-loaded placeholder; both wait for the read
  and say when it failed, with a way to try again. A definition whose own root is
  another component is judged for placement by what that component draws, under
  the site's own document caps, and the panel says when a tier of the library was
  too large to load whole or could not be read.

  The component tier is read in the language the surrounding document is being
  edited in, as the public page reads it, so a localized component draws on the
  canvas as it will on the page; and a row without a title — a custom collection
  with none, or one field-level access redacts — is offered labelled by its id
  rather than left out.

  The Direct API's `findByID` now forwards `status`, so an untrusted by-id read
  can reach a row that was never published — a caller passing it before was
  silently ignored. A plugin route's caller gains `identity()`, which resolves
  once per request the identity an access rule is evaluated against — the user
  with their roles, and an API key's scope — so a route reading through the
  Direct API on the caller's behalf reads as the caller its own gate admitted;
  `PluginRouteIdentity` names its answer in the SDK.

- [#1827](https://github.com/nextlyhq/nextly/pull/1827) [`a6ea554`](https://github.com/nextlyhq/nextly/commit/a6ea554476000f65d384a2b169802c637154c96f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A component can no longer be saved into a shape where the library references
  itself.

  Components may place other components, so the library is a directed graph. A
  loop in it is not a crash — the renderer detects one and draws what it reached —
  but it leaves a gap where the loop closes, on every page placing anything on the
  loop, and nothing said how it got there. The editor already withheld the tiles
  that would close one, but that is a snapshot: an author saving against a library
  read that had since gone stale closed a loop anyway.

  The write now refuses, naming the chain to break — `Hero → Banner → Hero` —
  rather than leaving the author to find which placement did it. The check reads
  each referenced component as it currently stands, and refuses rather than
  guessing when it cannot read them all. A component the saving author cannot read
  is named only as `…`, so a refusal does not hand out identifiers.

  What it does NOT close is a chain that mixes lifecycle states. The published
  walk reads every state, so a component that has never been published can join a
  chain the public renderer cannot draw — it could not load that row — and a save
  is then refused for a loop no reader sees. Reading only public states is not
  available to a plugin: naming the state matches nothing on a site whose workflow
  calls its public state something else, and dropping the system-level read would
  hide a component the author cannot see, which is a MISSED loop rather than a
  false one. So it over-refuses, which is the recoverable direction.

  What it does NOT close is a loop that only an EXISTING placement of the saved
  component completes. A page or component already placing it may carry an override
  keyed for an exposure it does not yet declare, which is inert; declaring that
  exposure activates the override and can point a nested node back at the placer.
  Measured on the renderer: the same library composes cleanly before the exposure is
  declared and reports a cycle after, while the saved component judged on its own
  composes cleanly either way. Seeing it means asking which components place this
  one — the reverse direction, which neither the walk nor the composition of a
  single subject can supply.

  What it does NOT close is two authors closing a loop between them at the SAME
  moment. The check runs before its own write commits and takes no lock the other
  write contends for, and a plugin hook has no transaction to enlist in — so two
  saves that each read the other's document before either commits are both
  approved. Closing that needs a boundary the two writes share.

  A component's VARIANTS and its PLACEMENTS count as references. A variant may
  preset an exposed `componentId`, and a placement may override one on the
  component it places — so a definition whose stored ids look harmless can still
  resolve back to itself. Both the insert panel and the write judge a definition by
  what it can reach that way, so the editor does not offer a component whose insert
  the save would refuse.

  What decides a refusal is the RENDERER, not that scan. Overrides flow down
  through nesting, so a placement can re-point a node two levels below it: the
  scan is short by a level wherever that happens, and long by a stored edge
  wherever an override points one away from the loop. Both directions are real, so
  a save is judged by composing it with the same function that draws the page —
  the only answer guaranteed to match what a reader would see. The scan still runs
  first, because it is what can name the chain to break; it no longer has a vote.

  That is asked once per variant the component offers, and once for a placement
  naming none. Only one variant resolves at a time, so a loop that exists under
  one selection is real, and a scan that unions them all would refuse a component
  whose every selection is fine.

  A component that names ITSELF is refused from the submitted document alone,
  without reading the library at all — nothing in it can reopen an edge the
  document has already closed, and the reads it skips each run the site's hooks.

  A limit the composition reaches is not a report that there is no loop. Where a
  chain runs deeper than components may nest, the renderer stops before the loop
  closes and has seen nothing past that point — so the save is refused on the
  scan's own chain rather than approved on the renderer's silence. The same holds
  for a library it could not finish reading.

  Clearing a component's content is not the same as leaving it alone. A publish
  that also empties the field stores nothing, so it can close no loop, and it is
  allowed — where previously the accumulated draft was judged instead and the save
  was refused for a chain that very write removes.

  It judges the lifecycle form the write actually changes. An ordinary editor save
  is stored as a working draft and leaves the published row alone, so it is checked
  against what a preview would show; publishing checks the live library as well.
  Publishing an accumulated draft is checked too, even when the request carries
  nothing but the new status — that is the write that brings the draft's content
  live.

  It is deliberately a refusal rather than a warning: the author who closes a loop
  is not the person who sees the gap, so a notice would go to someone who has no
  reason to act on it.

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

- [#1683](https://github.com/nextlyhq/nextly/pull/1683) [`fda49c2`](https://github.com/nextlyhq/nextly/commit/fda49c2876a4842ed47d4aa142b5bd6ec7f1eaab) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard could count and group entries but had no way to show either as a
  picture. Every chart meant writing a React component, which is how a dashboard
  stops looking like one product.

  Two archetypes now draw from a query the way `metric` and `table` already do,
  so an author declares a chart instead of shipping code: `bars` compares the
  buckets of a `groupBy`, and `timeseries` plots the points of a window.

  They are drawn here rather than by a charting dependency. The popular one pulls
  eleven packages — a state-management stack in every install's admin bundle for
  two shapes — and renders `role="application"`, which puts a screen reader into
  forms mode over a graphic that has no keyboard interface. Owning the markup is
  what makes the right pattern reachable: each chart is a labelled graphic with a
  text alternative naming what it shows, beside the same numbers as a real table.

  The bars run horizontally because their labels are whatever the grouped column
  holds — author names, tags, statuses — and a column chart has only its own
  width for those, which forces rotation or truncation. A capped bucket set says
  so rather than presenting a partial comparison as the whole one, and a
  timeseries labels each point in UTC, the zone its buckets were computed in, so
  the axis cannot name a different day than the server did.

  Every collection that can answer them now generates the two cards, beside the
  count, list and table it already generated — so the charts are something an
  install has rather than something a plugin author could build. A timeline is
  withheld from a collection whose only dates the read cannot bucket, and a
  status breakdown from one with no status column, because offering a card whose
  query is then refused is a card that draws an error on every load.

- [#1821](https://github.com/nextlyhq/nextly/pull/1821) [`2fa4696`](https://github.com/nextlyhq/nextly/commit/2fa4696c3e5becc4fc5fc954cb8d429a7ffe34ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A function default cannot read a field the caller may not write. A `defaultValue` written as a function receives the data built so far, and that data still held every value the caller sent, including one a field rule denies them, so a default could read the forbidden value and carry it into a field the caller IS allowed to write: the denied field was stripped and its value persisted anyway, one column across. The rules are now applied to a COPY, and the copy is what the functions read. The record itself is left alone until the pass that decides what is stored, because a rule may depend on a sibling the caller omitted precisely BECAUSE it has a default, and judging that rule before the defaults exist would deny it and lose the value for good.

  That copy is now defaulted and judged a second time before the record reads it. A field the caller may not write still takes its own declared default, and the pass that runs before the defaults has no key to judge because nothing supplied one; left in the copy, a later function default read it and carried it into a field the caller CAN write, so the rule was defeated one column across by the field's own default rather than by the caller's input.

  A config reload installs the live config's field functions, replacing them wholesale at the point the reload commits. Replacing rather than adding, so an entity the new config no longer declares stops deciding anything: a collection dropped from the config keeps its registry row and its table so an orphan sweep can find them, so it stays addressable. At the commit point rather than when the config is read, so a reload whose DDL succeeds and whose later sync fails does not leave a rule from a config the process refused deciding writes. The field-level registry holds every field's `access` rules, hooks, `validate` and function `defaultValue`, none of which survive being stored, and a reload never went back through service registration: an edit to any of them kept running the version from process start until the dev server was restarted. That is wrong in the direction that matters most for an access rule, since a rule tightened in the config was not the one being enforced. Applied on the same optimistic terms as the field-type registry, and restored by the same undo when a reload is abandoned.

  An access rule declared inside an unnamed container is captured. The registry keyed only named entries, so every rule, hook and validator inside an unnamed presentational group was dropped. `defineCollection` refuses a field with no name, but a plugin contributing raw config is checked on its field TYPES and not their names, so the shape reaches the live config.

  A Single's first read no longer invents an incomplete group. Filling a group for the sake of one defaulted child, while a required sibling has no default and no value, stored a document the next create or update would refuse; that insert runs no validation pass of its own. The group is left absent instead.

  The documentation no longer claims a field group's children take their defaults before the entry's hooks. They are written in their own pass afterwards, so the parent's hooks see such a child as absent.

  A `defaultValue` written as a function now works on a reusable field group's children. A field group's fields are read from its stored definition on every write, and a function does not survive being stored, so only constants applied there: a function default on a field-group child was silently dropped on every write. Field groups now get the same live-config capture collections and Singles have, so the function form resolves from the config at boot, and it is re-read when the dev server reloads the config. It resolves against the instance being built, so a child may compute from a sibling defaulted before it.

  Only the default is wired. The same capture holds a field's `access` rules, hooks and `validate`, and nothing reads those for a field group, so registering them changes nothing about whether they are enforced.

  The promote gate judges the draft the write actually commits.

  The gate that re-judges a Single's pending change before it is published ran before the write transaction, where it could only judge a copy of the world as it was. It now runs inside that transaction, on the draft the transaction has locked, which closes what a pre-flight check could not: a draft saved by another writer between the check and the commit is now the draft that is judged; a `beforeChange` hook that turns a status-less edit into a publish no longer slips past a check that ran before the hooks; and `publishAllLocales`, which applies every language's snapshot to one row, now judges the combined result rather than each language against its own shared values. Resolving the caller's grants is the one thing that cannot happen inside a transaction, since it queries the pooled connection that transaction holds, so it is resolved beforehand and handed in.

  A field rule on a child of a group or a repeater row is enforced. The check copied the snapshot shallowly, so the rules deleted a denied nested value from the copy and the original alike and the comparison then saw an unchanged container. A denied child is now found at its own depth and named at its own path.

  A publish is no longer refused over a field nobody touched. The comparison read the live document through a read that expands an upload or a relationship into the document behind it, while the snapshot holds the identifier, so an untouched field of either kind looked like an edit. Both sides now go through one conversion.

  A draft older than a newly required field is refused rather than published. The check judged the promoted document as a patch, which skips absent properties by design, so a snapshot written before a field became required reported nothing and published a document that violates the contract.

  An API key is judged on the grants stamped on the key, not on the database roles of whoever owns it.

- [#1768](https://github.com/nextlyhq/nextly/pull/1768) [`2bcccdd`](https://github.com/nextlyhq/nextly/commit/2bcccddfbb83b9d9e5a57a555cedb321ed4a85c1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every sortable table in the admin can be reordered from the keyboard, and a
  screen reader is told what is being moved.

  Two tables -- the collection fields list and the user fields page -- accepted
  only a pointer, so a keyboard user could not reorder them at all. They now use
  the same sensors as every other drag surface: Space or Enter picks a row up,
  the arrow keys move it, Space drops it, Escape puts it back.

  What a drag says has changed on every surface. The defaults read the
  draggable's id aloud -- "Picked up draggable item 3f9a…" -- and every id here
  is a field name or a uuid. A drag now names the thing and where it sits:
  "Picked up Title, position 1 of 4", "Title is over Body, position 3 of 4",
  "Title moved to position 3 of 4". On the dashboard the same sentences name the
  card and its column, matching what the Move buttons already say, so a card
  moved by keyboard and one moved by button sound the same. Each drag handle is
  also named after its row, so tabbing through them no longer reads as a list of
  identical buttons.

- [#1831](https://github.com/nextlyhq/nextly/pull/1831) [`b25490b`](https://github.com/nextlyhq/nextly/commit/b25490bc4af5bad91bc67a5333ec28295199e211) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field hook now runs for the fields a write touched, and reads the whole row
  either way.

  A localized update assembles the complete translation onto the row it returns,
  because the version snapshot and the outgoing events describe a translation
  rather than the one field of it that moved. Field hooks were selected by what
  was present in that row, so an `afterChange` handler on a sibling nobody
  edited started firing for an unchanged value — sending mail, re-indexing and
  calling out for a field the write never named.

  Which handlers run and what each handler can see are now separate questions.
  The set of touched fields decides the first; the row stays whole, so a hook
  that derives a search document from an unchanged neighbour can still read it.

- [#1677](https://github.com/nextlyhq/nextly/pull/1677) [`793c9c1`](https://github.com/nextlyhq/nextly/commit/793c9c120dbd3525c6b3be4fcc4cb53059a8891d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The engine's three whole-document measurements — `countNodes`, `treeDepth` and `documentBytes` — now refuse a forest they cannot afford to walk instead of grinding through it or raising a native error.

  They walk ENTRIES, not objects, and deliberately so: one node object placed in two slots is two elements of the document, and counting it once would report half a real size and pass a cap the document exceeds. That makes the walk exponential in depth for a forest whose branches share a node object — 21 shared objects reach 2,097,151 entries, and every further object doubles it.

  `documentBytes` was the sharp edge. `JSON.stringify` expands each shared node into a copy per path that reaches it, so it allocated 132 MB for 21 objects and raised `RangeError: Invalid string length` at 23 — from a document a few kilobytes in memory, in the one function that decides whether a document may be stored.

  All three now throw `ForestTooLargeError`, against the ceiling that fits what each one actually spends:
  - `countNodes` and `treeDepth` refuse past `MAX_VALUE_PARTS` (4,194,304) — the ceiling the op layer's preflight **already** refused values at, now shared rather than duplicated.
  - `documentBytes` refuses past `MAX_SERIALIZED_VALUES`, which is derived from the byte cap it protects: every serialized value contributes at least one byte, so a document that has emitted more values than the cap has bytes cannot come in under it.

  Sharing the first number is the point: a second, lower ceiling for the structural readers would let a dry run accept a document the apply then refuses, and would sit below `maxNodes` on a site that legitimately raised it. The serializer keeps its own because it bounds a different resource — a structural walk reads, while serialization BUILDS as it goes, so one numeral buys different amounts of work in each. Both are exported from the package root, and `@nextlyhq/blocks-engine/format` exports the error with `MAX_SERIALIZED_VALUES`, the only one bounding anything that entry exposes.

  The messages name the routes to the ceiling without claiming which one a caller hit, because no reader compares object identity and so none can tell. Inside `applyOp` the refusal arrives as an `OpError` like every other, so the `...Refusal` helpers still return a reason rather than throwing at their caller. Composition and the builder's deletion metadata degrade rather than propagate it: an unmeasurable subtree refunds nothing and reports no descendant count, so a page still renders and a block can still be deleted.

  Nothing a site can store is affected. `JSON.parse` produces fresh objects and cannot express sharing, so a stored document is never such a forest; the bound is reachable only by a forest built in memory by code.

- [#1706](https://github.com/nextlyhq/nextly/pull/1706) [`1bfc12e`](https://github.com/nextlyhq/nextly/commit/1bfc12eb4c3122d6e4984d69195f45061d281e5b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A spacing handle stopped following the pointer when a drag took a margin past zero.

  A margin dragged below zero is drawn on the other side of the block's edge, and
  its two sides swap roles when that happens. The handle kept the side it was given
  when the drag began, so once the value crossed zero it sat on the edge that no
  longer moves and the block stopped responding — the drag had to be released and
  started again to carry on.

  The handle now takes the side the band is drawn with as it is drawn, so a stroke
  that runs a margin from positive to negative keeps moving the block the whole way.

- [#1863](https://github.com/nextlyhq/nextly/pull/1863) [`6e22e58`](https://github.com/nextlyhq/nextly/commit/6e22e58f389affa7f922afb65cc4db8f3db5d63c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Fonts panel no longer warns that a font stack will be dropped when a `var()` names its custom property with a CSS hex escape. `var(--\62 rand)` is `var(--brand)` to a browser, and is now read as the same working substitution.

- [#1667](https://github.com/nextlyhq/nextly/pull/1667) [`48967c8`](https://github.com/nextlyhq/nextly/commit/48967c89417abfe6ad1e474eb7ea476b473274e0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A hook could not tell whether the write it was running on came from a browser
  or from a seed script, so a rule that only makes sense for a visitor, a rate
  limit or a honeypot, could not be written at the write seam at all. It had to
  live in one route, and a collection that grants public create has more than one
  door into it.

  Collection operations now accept the HTTP request that produced them, and the
  core resolves it into the facts hooks read as `ctx.req`: the headers, and a
  client address judged against this deployment's `security.trustProxy` and
  `TRUSTED_PROXY_IPS` rather than read raw off `x-forwarded-for`, which is
  whatever the sender chose to claim. `ctx.req.http` is absent when no request
  produced the write, and that absence is what tells a request-scoped rule to
  stand down instead of judging a server-side import as a visitor.

  Both HTTP doors pass it down, and `ctx.services.collections` takes it too, so a
  plugin serving its own route can hand over the request it was given. The form
  route's audit column now records the resolved address instead of the leftmost
  forwarded hop.

- [#1733](https://github.com/nextlyhq/nextly/pull/1733) [`cadd25b`](https://github.com/nextlyhq/nextly/commit/cadd25b48744ccc5a2658678b4164776e8c22d69) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A job handler is told which job it is running.

  Delivery is at-least-once, so one queued job can reach a handler more than
  once, and the documentation says to write handlers that survive that. It did
  not say how. The context carried the identity, the clock, a content API and the
  tick deadline, and nothing that identified the queued row, so a handler had
  nothing stable to key an external side effect on.

  It now receives `jobId`, the same on every attempt, which is the key to hand a
  payment provider's idempotency header or the unique column an upsert targets.
  It also receives `attempt`, counting from 1, which is written to the row before
  the handler starts, so a handler that dies part-way still leaves the count
  advanced. It is not the deduplication signal: `attempt > 1` says an earlier run
  began, not what it finished.

  The same page told operators to size `leaseMs` to the work. Nobody could:
  the built-in route passes only a batch size and a duration, and the public
  configuration takes job definitions alone. It was also the wrong advice, since
  the lease is renewed while a handler is alive and so already covers work that
  merely takes a long time. The page now documents the fixed lease as a stall
  tolerance and points at the key a handler can actually use.

- [#1814](https://github.com/nextlyhq/nextly/pull/1814) [`83a2e49`](https://github.com/nextlyhq/nextly/commit/83a2e4925aa0c1de40011bbcce25018ee7b9db72) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A many-to-many field's junction table is now followed by the table itself, not
  by the field that names it. A junction name reused for a field pointing at
  another collection is dropped and created again — before, `CREATE TABLE IF NOT
EXISTS` kept the old table and its old link column. Changing a field's
  `junctionTable` renames its table with the links in it, and pointing a field at
  another collection gives it a new table instead of none. Two many-to-many fields
  cannot store their links in one table, whether the name is the author's or the
  generated one, and a save that would move a junction off a table another field
  still uses, or onto one that already exists, is refused by name.

- [#1676](https://github.com/nextlyhq/nextly/pull/1676) [`419d5f2`](https://github.com/nextlyhq/nextly/commit/419d5f2b7666b42e3c2b02639835b44257401ff3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key is judged on its own grants at every access gate, not only the
  first one. Transaction writes, field-level access rules and the coarse
  collection gate all resolved the permissions of the key's OWNER when the key's
  own scope did not reach them, so a key issued to read could act with the
  authority of whoever created it.

  A permission now reaches a code-defined `access` rule in the spelling those
  rules are documented to receive (`posts:read`), so a rule written as
  `({ permissions }) => permissions.includes("posts:read")` decides the same way
  for an API key as it does for a session.

  The scope a plugin route handler receives is its own copy. Narrowing it in place
  now affects only that request, where before it edited the key's real grants for
  every request for the next five minutes.

- [#1656](https://github.com/nextlyhq/nextly/pull/1656) [`9893b11`](https://github.com/nextlyhq/nextly/commit/9893b119dbdd3fbc1f171b4ed9cf6146388d94bf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin route received the caller's account and nothing else. For a request
  authenticated with an API key that account is the key's OWNER, so the access
  check resolved the owner's roles and a key scoped to read was authorized to
  write whatever its owner could — reaching, for a key minted by a super-admin,
  the unconditional super-admin allow.

  `AuthenticatedScope` already existed for exactly this and is honoured by the
  collection access services; the plugin route path was the one surface it was
  never wired into. The key's own grants now travel with the account, from the
  dispatcher through `ServiceOpts` and `RequestContext` to the collection facade.

  A session caller is unaffected: it carries no key scope and resolves the same
  way it always has, super-admin bypass included.

- [#1695](https://github.com/nextlyhq/nextly/pull/1695) [`89f515b`](https://github.com/nextlyhq/nextly/commit/89f515b0d6a9e12a669a4a02ef173264b439a1e9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key is judged on the scope the request is CURRENTLY under, for
  the whole of an operation rather than at the one call that names it.

  A route that narrowed its own scope before a transactional write had the
  narrowing discarded: the transaction methods sit outside the plugin facade's
  wrapper, so the scope reached the argument and never a gate, and the write was
  judged on the grant the route had given up. The transaction params carry it now,
  including the delete path, where the owner predicate was resolved without it —
  so a key owned by a super-admin took a bypass that belongs to a session.

  A release operation resolves its target before it acts, and that lookup ran
  with no scope at all, so it read on the key OWNER's grants. The scope is pinned
  for the operation instead of handed to half of it.

  `narrowScope` accepts a caller that has none. A signed-in person reaches the
  same routes an API key does, and requiring each call site to guard that is how
  a `!` reached the documentation — where it was a crash for every session
  caller.

  The API-key scope built by the Single detail route named `actorType` and
  `permissions` only, so a documented `permissions.includes("site:publish")` was
  handed the stored slugs and denied a key that held the grant.

  Hand-writing that scope is refused rather than corrected again, and the refusal
  runs in two places because one is not enough. A lint selector rejects the
  literal — in either key order, shorthand, with a nested object between the keys,
  and with a spread standing in for the second half. The one shape it cannot see
  is a spread of an existing scope that replaces only `permissions`, which keeps
  every original row and so keeps naming a grant the caller has just given up;
  nothing in the syntax separates that from an ordinary config overlay, so
  `ruleFacingPermissions` refuses it where the disagreement decides the answer.

- [#1663](https://github.com/nextlyhq/nextly/pull/1663) [`5aae8fc`](https://github.com/nextlyhq/nextly/commit/5aae8fcf9386e47a94de8974c92a76b5727e0e21) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a component that a Layout still uses is now refused, and the message
  names the Layouts to go and edit. A Layout wraps every page assigned to it, so
  removing a component it uses would leave a gap on all of them at once — unlike
  an ordinary page, where the renderer draws one visible, recoverable
  placeholder.

  Draft Layouts count. A component named only by an unpublished Layout is on no
  page yet, and deleting it would break that Layout the moment someone publishes,
  by which time the cause is a deletion nobody remembers.

  The database could not have caught this: a Layout's areas are stored as one
  JSON column, so the reference to the component emits no foreign key.

- [#1772](https://github.com/nextlyhq/nextly/pull/1772) [`c80d0da`](https://github.com/nextlyhq/nextly/commit/c80d0dafd69f9825b75e1a33b97aeb7891575c2e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The collections and singles listings show exactly what the reader may open.

  Both lists scoped themselves by the stored `{slug}:read` grants alone, while
  every other read -- opening a document, the dashboard's own scope, a version
  read -- also consults the entity's code-defined `access.read`. The two
  disagreed in both directions: a collection or Single authorised entirely in
  code has no grant row, so it was left out of the list a reader could open it
  from, and on the dashboard the singles card was offered for it and then drew
  nothing; a grant the code rule refuses was listed anyway.

  Both listings now take the same read decision as everything else. One
  consequence for API keys: a key owned by a super admin no longer lists every
  collection and Single. It is judged on its own stamped scope, which is the rule
  every other read path already applied to it.

- [#1707](https://github.com/nextlyhq/nextly/pull/1707) [`9c8d64d`](https://github.com/nextlyhq/nextly/commit/9c8d64d5e41a85d7cf5c76d4e5b7fc66b3134f7c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An author who opened a document somebody else was already editing had exactly
  one thing they could do about it: take the document over, displacing a colleague
  mid-sentence. The polite option was to close the tab and hope.

  The lock strip now offers "Request edit access" beside "Take over", and the
  holder is told — passively, in the same strip — that someone is waiting. Nothing
  else changes: the request moves no claim, asks the holder for no answer, cannot
  be refused, and the lease expiring stays the only thing that transfers a
  document. Every action the holder had, they keep, including the Save they are
  being given time to reach.

  The ask is a standing one rather than a single message. The editor that is
  locked out is already polling for the document on every beat, so the request
  rides that poll and is re-stated for as long as the person is still there and
  still waiting. Close the tab and it lapses, so a holder is never nudged on
  behalf of a colleague who has gone.

  Pressing the button is answered. The strip replaces it with "We have let Bob
  know you are waiting" — text, not a disabled button, because a control that
  stays on screen having stopped doing anything is what a broken one looks like.
  The confirmation is shown only when the SERVER has the ask on record, so a
  request that landed nowhere cannot be reported as delivered.

  The holder's notice is a `status` region and not a dialog. There is no APG basis
  for one here — that pattern is for urgent interruptions a person must answer —
  and it is spoken once when it appears rather than on every heartbeat.

- [#1856](https://github.com/nextlyhq/nextly/pull/1856) [`f6ddafa`](https://github.com/nextlyhq/nextly/commit/f6ddafa0c3ed698309cd9c1f42449955955718d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field added to a collection now becomes the same column it would have become
  when the table was created.

  Three implementations answered "what column is this field?", and the one the
  product READS through — the canonical descriptor, used by the runtime Drizzle
  table and by the schema diff — was not the one the Schema Builder wrote with.
  So the table a user got was not the table the rest of the system believed it
  had, and the failure surfaced far from its cause: a diff proposing the same
  change on every run, or a write rejected by a column whose type nobody
  declared.

  Both paths that CREATE a column now read the descriptor. The path that alters
  an existing column deliberately does not, and that boundary is the whole safety
  argument: restating a live column under a mapping it was not built with is a
  narrowing `MODIFY` on MySQL that truncates stored values for an edit that
  touched nothing but a flag. No existing table is altered by this change.

  Two of the fixed disagreements were losing data outright on a column added to a
  table that already existed:
  - A number field set to `float` was added as a whole-number column on all three
    databases, silently discarding every fraction written to it. It is now
    `float8` / `double` / `real`, which is what the same field gets when its table
    is created.
  - A text field declared short was added unbounded on PostgreSQL and MySQL,
    losing the width the field asked for.

  Both happened because the ADD COLUMN path rendered a column from the field's
  type and length alone and never saw its options or validation.

  One family of disagreements is deliberately NOT converged here. The descriptor
  stores a field holding many values (`hasMany` numbers, uploads, relationships)
  and a repeater or group as a JSON array where these generators emit a scalar.
  That changes the column's storage class rather than its spelling, and the type
  is not the only thing that would have to move with it: indexability is decided
  from the old rendering, a relationship attaches a scalar foreign key, validation
  bounds are emitted as a comparison against the column, and a required column's
  backfill derives a scalar default from the declared type. Taking the
  descriptor's type alone would emit `CREATE INDEX` on a JSON column, a foreign
  key from an array to a scalar id, and `json NOT NULL DEFAULT 0`. Those stay
  recorded as known disagreements until the consumers move in one change.

  A MySQL `MODIFY` issued only to change a column's nullability now restates the
  column's LIVE type, read from the catalog, rather than a rendered one. MySQL
  restates the whole definition on every `MODIFY`, so such an edit has to name a
  type — and once new columns come from the descriptor, no renderer is right for
  both: rendering the old mapping narrows a float created as `double` to
  `decimal(10,2)`, and rendering the descriptor narrows a `select` created as
  unbounded `text` to `varchar(255)`. Both truncate, for an edit that asked for
  nothing but a required flag. The database knows which it is, so it is asked. A
  caller that does not read the live table keeps the previous behaviour.

  Some column types are spelled differently as a result — `int4` for `integer`
  and `bool` for `boolean` on PostgreSQL, `tinyint(1)` for `boolean` on MySQL.
  These are the same types under the names the descriptor and the database's own
  catalog use, not storage changes.

  One consequence worth stating plainly: on MySQL a `select` or `radio` column
  created from now on is `varchar(255)` where it used to be unbounded `text`,
  because that is what the descriptor says. Nothing existing is affected and
  nothing can be truncated, since only columns that do not yet exist are rendered
  this way. Whether the descriptor should instead move to `text` for these types
  is a separate open question.

  The conformance matrix that pins these three implementations against each other
  lost 23 accepted disagreements, all of them on the collection generator's
  create and add-column paths. Its ratchet is checked in both directions, so an
  entry describing a disagreement that no longer happens fails the suite — the
  list could not have been left stale.

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

- [#1882](https://github.com/nextlyhq/nextly/pull/1882) [`dbebaf7`](https://github.com/nextlyhq/nextly/commit/dbebaf7fb786e7a14c1998267662d12b6245c014) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a published page no longer puts the edit live. Pages now keep a working
  draft, as components and Layouts already do: Save stores the draft while the
  site keeps serving what was published, and Publish changes puts the draft live.
  A new page offers Save draft and Publish.

  Existing sites see this on their published pages from the first save after
  upgrading, with no migration. Pages also gain autosave recovery points while an
  author works in the page editor.

- [#1860](https://github.com/nextlyhq/nextly/pull/1860) [`ab3791d`](https://github.com/nextlyhq/nextly/commit/ab3791d667180008cb83be4ef0acb514b3d2f130) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An edit made to a collection that has been saved but not yet deployed no longer
  narrows the column its own creation migration is about to write.

  Such a collection has a registry record and no table, and the two artefacts
  replay in order: the create runs first, then the edit. Everything the edit
  believes about that table is therefore a prediction, and the indexes and
  foreign keys were already predicted for exactly this reason. The column TYPES
  were not — they were reported as unknown, which sent MySQL's `MODIFY` to the
  legacy renderer.

  The two renderers now disagree by design, so that fallback had a consequence: a
  float field is created as `double`, and a follow-up requiredness edit in the
  same window emitted `MODIFY COLUMN ... decimal(10,2)`. Both artefacts are
  correct read alone, and applying them in order narrows and rounds a column the
  deployment had just built.

  The planned types are predicted by the same class that emits the CREATE, beside
  the planned indexes and keys, so a prediction and the statement it predicts
  cannot describe different columns.

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

- [#1684](https://github.com/nextlyhq/nextly/pull/1684) [`a2cd0f3`](https://github.com/nextlyhq/nextly/commit/a2cd0f30c363c10409d6872d799f832422f567ce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now serve a route at a top-level path instead of under
  `/plugins/<plugin-name>`, by declaring `mount: "root"`. That is what lets a
  plugin take over an endpoint the core stops shipping without every caller
  having to change the URL they already use.

  It cannot take a path the core serves. Root routes are matched only after the
  built-in router has declined, so the core's answer always comes first: a plugin
  declaring `/collections` gets the collections API like anyone else, not control
  of it. The ordering is the guard rather than a list of reserved prefixes, which
  would have to be updated every time the core gained a route and would fail
  silently when it was not.

  Two plugins still cannot claim one address: rooting a route keeps the collision
  check that the namespace used to make unnecessary. That check asks within a
  mount, because the two are matched in separate passes and a root route that
  merely resembles a namespaced one never competes with it for a request.

  A route is also refused at boot when it is rooted somewhere the request never
  arrives, rather than registering and silently answering nothing. That covers
  `/auth`, `/plugins`, `/admin-meta` and the development endpoints, all of which
  are answered before the point a root route is consulted. A `mount` outside
  `"plugin" | "root"` is refused for the same reason: only an untyped caller can
  produce one, and it would register under one name and be looked up under
  another.

  `PluginRouteMount` is exported from `nextly` and `@nextlyhq/plugin-sdk` beside
  `PluginRoute`, so a plugin author writing a reusable route builder can name it.

  A request that could reach a plugin route always waits for initialisation to
  finish, not merely for the routes to appear. The route registry fills partway
  through startup, so a second request arriving in that window could previously
  run a handler before permissions were seeded and migrations had settled.

  Nothing changes for a route that does not ask. The default is unchanged, so
  every existing plugin route stays where it is.

- [#1819](https://github.com/nextlyhq/nextly/pull/1819) [`39c96f3`](https://github.com/nextlyhq/nextly/commit/39c96f3f1248cb5a56bddf8f4d0ae76d9972d577) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can update many entries in one call. `ctx.services.collections` ended at `createMany`: plugin code could write many rows in one call and then had no way to change them in one, elevated or not, so the only batch update available to it was a loop of `updateEntry` calls, each with its own transaction, its own access pass and its own cache flush. `updateMany(slug, entries, opts?)` takes one `{ id, data }` per row, so a single call can apply a different patch to each row, and returns the same `BatchOperationResult` `createMany` returns: partial success, with `errors[].index` indexing the array the caller passed. There is deliberately no by-filter form; `listEntries` and this method compose to the same thing with the rows named, and a filter that matches more than its author meant is the failure a batch write cannot take back. A `locale` is refused by name, as on `createMany`, because the bulk pipeline writes in one pass and cannot store a translation. `@experimental` on the plugin surface until a first-party plugin exercises it.

- [#1769](https://github.com/nextlyhq/nextly/pull/1769) [`4de79a2`](https://github.com/nextlyhq/nextly/commit/4de79a2137618d5541d45ee0bec95fe4d7e791a2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now name the locale it reads or writes in. `ServiceOpts` — the
  options every `ctx.services.collections` call takes — gains `locale` and
  `fallbackLocale`, spelled as the request context and the REST API already
  spell them, and both are carried through to the collection services. Until
  now the request context could hold the pair and every read accepted it, but
  nothing on the plugin path could say it and the facade's forwarding seam
  dropped it even when a context did: every plugin read and write on a localized
  site was in the default language, silently. A code that is not a configured
  locale resolves to the default on a read, as it does on the wire, and is
  refused on a write, so a typo cannot overwrite the default language's
  content. `createMany` refuses any locale by name rather than filing the rows
  under the default language silently; its bulk pipeline cannot store a
  translation yet. `deleteEntry` refuses one likewise: a delete removes every
  translation with the document, and a locale on it would read as removing one.
  The selectors `*` and `all` are refused outright, from one classifier now
  exported as `isLocaleSelector` from `@nextlyhq/plugin-sdk`: a value forwarded from a query string
  must never be able to publish every translation of a document. The same
  spellings are reserved at localization configuration, together with `none`,
  the wire's spelling of no fallback — a site can no longer name a language
  `all` or `none`, neither of which could ever be read, written or chosen as
  one. An empty locale reads as none named.

  The form builder uses it for the one place a visitor could see the gap. A
  form that redirects to a picked page read that page with no locale, so a page
  whose slug is `thanks` in English and `merci` in French sent every visitor to
  `/thanks`. `submitForm` takes `locale`, and the built-in
  `POST /api/forms/:slug/submit` reads it from `?locale=` — the same place
  core's own routes take a locale — so a French submission is answered with the
  French URL, and one that names no language is answered as before. The target
  is read as the visitor rather than as the system, so a translation still in
  draft is never the URL a visitor is sent to; the published default answers
  until it is published. The read wildcards (`all`, `*`) are not a language and
  read as none.

- [#1673](https://github.com/nextlyhq/nextly/pull/1673) [`69b9aa5`](https://github.com/nextlyhq/nextly/commit/69b9aa535d9073c5ab693fdb0a86d09f743276ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin route can now ask what its caller may do, not only who they are.

  `ctx.caller` carries `authMethod`, the authenticating `apiKeyId`, the token's
  verified `claims`, and `can(action, resource)` — answered through the same
  machinery that decides a route's own `requiredPermission`: a scoped API key on
  its own stamped grants and the code-defined rule evaluated against them, and a
  session through the RBAC service with its super-admin bypass. A super admin does
  not bypass an API key's scope.

  This is additive and changes no existing behaviour. It exists because
  `ctx.authenticatedScope` answers only for API keys — a session caller's grants
  are resolved on demand and it holds no stamped scope — so a route could not ask
  "may this signed-in author create in collection X", which is the question an
  admin panel needs in order to gate a create action before showing it.

  Deliberately not a permission array: a session's is empty by design, so a route
  reading one would refuse every signed-in user while appearing to check
  something. The write remains the enforcement point; this is a UX and routing
  aid.

- [#1679](https://github.com/nextlyhq/nextly/pull/1679) [`113f82c`](https://github.com/nextlyhq/nextly/commit/113f82c827874ebace3f8cb4e2a120d6c695883a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin-contributed route reached the collections through the managed facade
  without carrying the request it was serving, so a hook underneath one read a
  browser's write as background work. Every route written before that field
  existed names no request, which is all of them: the page-builder's save route
  and the form-builder's export routes among them. A request-scoped rule, a rate
  limit or an audit, stood down for exactly the traffic it exists to judge.

  The route dispatcher pins the request once, beside the caller scope it already
  pins, so a contributed route inherits it without naming it.

- [#1807](https://github.com/nextlyhq/nextly/pull/1807) [`348ceb9`](https://github.com/nextlyhq/nextly/commit/348ceb93a51cf8fca0ae55ee5dcbb132baeaa015) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A database error from the adapters now says which operation failed on which
  table on every dialect. The context was attached only when the message did not
  already contain the operation's name, and on PostgreSQL and MySQL the driver's
  message quotes the failed statement — which Drizzle spells in lower case — so
  an `update`, `insert` or `delete` there, or any table or column whose name
  contains the word, arrived without it. The error still carries the table as
  before; only the message changes, and only where the context was missing.

- [#1854](https://github.com/nextlyhq/nextly/pull/1854) [`e700886`](https://github.com/nextlyhq/nextly/commit/e7008868e8b631c7e2ba4bc74b6e166b72d6eb41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A reader can send a first-run card away from the card itself, and dismissing one no longer stops later widgets from reaching them.

  A widget declaring `dismissible` draws a control on the card, outside edit mode: a card that addresses somebody who has just arrived should not require discovering the dashboard editor first. Framed cards carry it in their header; unframed cards float it in the free corner. It is offered only from the width at which editing -- the one route to bringing a card back -- is available, and `dismissible` must be a boolean on both declaration channels.

  Dismissing hides the placement rather than deleting it. The write has its own channel, so its failures never reach the editor's chrome, it locks every other layout write while it is in flight, it confirms against the refreshed dashboard before announcing, and focus moves into the widgets region when the card holding it goes.

  A layout row now records whether its reader ARRANGED it. A row written only by dismissals still follows the live registry -- a widget declared later is placed, and positions track the declared order -- with the reader's dismissals applied. The editor's save takes charge of the arrangement, and a row once arranged stays arranged whatever a later write says. Every row written before this reads as arranged, so existing dashboards are unchanged; the flag lives in the stored JSON, so nothing migrates on any dialect.

  `toggleHidden` and `remove` now announce through the grid's live region, where both used to change the dashboard in silence.

- [#1840](https://github.com/nextlyhq/nextly/pull/1840) [`16efd9c`](https://github.com/nextlyhq/nextly/commit/16efd9cf7383708209c5b8306f73efbac7b246fb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A function default cannot read a denied sibling from inside a group or a repeater row either.

  The create path judges the field rules on a copy of the request and hands that copy to the function defaults, so a default cannot read a value its writer was not allowed to send. When the rules removed a whole container, the copy had no counterpart for it, and the walk read that as no copy having been given at all: it fell back to the caller's own row, which is exactly the unfiltered data the copy exists to replace. A nested default could then carry a denied sibling into a child the caller may write, while the pass that decides what is stored removed only the field it came from. A container missing from the copy is now read as a container the rules emptied, which is the only way one goes missing.

  A Single's first read judges a required nested child by the rule the write validator will apply. `required: true` on the field and `validation: { required: true }` beside its other rules are both supported spellings, and this read tested only the first, so a group invented for one defaulted child was stored with a required sibling empty and the next write refused the document. The validator's own predicate is shared now rather than restated.

- [#1753](https://github.com/nextlyhq/nextly/pull/1753) [`08bce33`](https://github.com/nextlyhq/nextly/commit/08bce33d147922909894f2b00e245aae0e54e9f2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A class rename the host refuses with an empty or whitespace-only reason is now
  reported in the same words a rename that threw already used, rather than as
  an alert with nothing written in it. The refusal's shape is the documented one
  and the host did refuse, so silence would report a failed rename as a success;
  what was missing was only the words, and those are supplied.

- [#1752](https://github.com/nextlyhq/nextly/pull/1752) [`cde0bd0`](https://github.com/nextlyhq/nextly/commit/cde0bd0b8bf2425c2afe753c4c058060fcfefd9d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A class rename refused by a host is shown to the author only when the refusal
  carries the reason the panel is about to print. The guard that recognised an
  outcome read one field of it — whether `ok` was a boolean — and then narrowed
  to a type promising `reason: string`, so any unrelated failure-shaped result a
  host handed back was accepted as a refusal. `{ ok: false, error }`, which is
  what an ordinary mutation helper answers with, reported `undefined`.

  The notice renders on the reported reason not being `null`, and `undefined` is
  not `null`, so the author got an error box with nothing written in it and a
  screen reader announced an alert carrying no text — a rename declared failed
  with no way to learn why. A result this cannot vouch for is silence again, as
  it always was for a host that answers with nothing.

- [#1757](https://github.com/nextlyhq/nextly/pull/1757) [`9ca0cfd`](https://github.com/nextlyhq/nextly/commit/9ca0cfda21f4c3ddb57e970570b3aead8e36af90) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `DropRegion.at` is now `DropRegion.target`. The module spelled two ideas with
  one word: on a region, `at` was the placement a block would be nested into,
  while on a `DropTarget`, `at` was a position and `target` was that placement.
  A host reading both had to remember which `at` it held. The region now names
  the placement as the target does, and `at` means a position everywhere in the
  module. A value still spelling `at` on a region is a type error rather than a
  silent fall-through; the package is `@experimental` throughout, so no alias
  is kept.

- [#1834](https://github.com/nextlyhq/nextly/pull/1834) [`c52aa59`](https://github.com/nextlyhq/nextly/commit/c52aa5970405a62f3bbd13df67722afa444a9d77) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An edit to what a relationship does when the row it points at is deleted now
  reaches the database.

  A foreign key carried the actions the statement that CREATED it wrote, and
  nothing else ever changed them. Moving \`posts.author\` from cascade to restrict
  saved successfully and recorded restrict, while the database went on cascading
  — so deleting an author still destroyed their posts. The same held for a
  many-to-many, whose junction kept the actions it was built with.

  Both are emitted now, through one implementation. PostgreSQL and MySQL drop
  the constraint and declare it again under its own name, as two statements:
  MySQL rejects a drop and an add of one name in a single \`ALTER TABLE\`, and on
  PostgreSQL a single statement would depend on the order the server applies its
  subcommands in. A junction has both of its foreign keys rebuilt, and the table
  itself is left alone — rebuilding it would destroy every link it holds for a
  change that never needed to touch one.

  SQLite refuses the edit by name rather than performing it. It cannot alter a
  constraint at all, and the table rebuild that would be required has caused
  real data loss in three independent tools that automated it; refusing is what
  this dialect already does for a foreign-key drop and for a unique constraint
  it cannot enforce.

  Three things the statements meet on the way to the database are handled with
  them, because emitting the right SQL is only half of arriving:
  - They are emitted one statement per chunk. The runner splits a migration on
    its breakpoint markers and never on semicolons, and the MySQL driver is
    configured to refuse a query carrying more than one statement — so a
    semicolon-joined pair was rejected whole, and this edit did nothing at all
    on MySQL.
  - Turning a link optional now relaxes its column as well as its key, in that
    order, and turning one required replaces the key before tightening the
    column. A relationship's requiredness never moved its column before: the
    descriptor calls the column nullable whichever way `required` is set, so an
    optional link kept a NOT NULL column while its key moved to `SET NULL` —
    which MySQL rejects outright, and PostgreSQL accepts and then fails on the
    first delete, in production.
  - The key that is dropped is the one the table actually carries, read from it
    rather than derived from a naming convention. A column whose key was
    installed under another name, or that carries none because it was edited
    from a scalar into a relationship, no longer aborts the migration.

  The edit is also paired the way the rest of the save pairs, rather than by
  name alone: a relationship renamed in the same save carries its action edit
  (it previously emitted the rename and left the old action enforced), and a
  field whose storage moved leaves its key to the path that creates it rather
  than declaring the same constraint twice. Many-to-many junctions are paired
  once for both their table move and their action edit, so a save that did both
  can no longer fall between the two.

  Two referential actions are now refused rather than emitted for a server to
  reject halfway. `onUpdate: "set null"` on a required relationship is the pair
  `onDelete` has always refused, reached through the other half. And `set null`
  on a many-to-many cannot hold at all: both link columns are `NOT NULL`,
  because a link naming nothing on one side is not a link.

  One behaviour changed on SQLite. A junction action edit was refused by name
  when the junction kept its table and silently ignored when the same save also
  renamed it — so whether the edit was refused or lost depended on whether you
  happened to rename. It is refused in both cases now. SQLite still cannot
  change a junction's referential actions; renaming one on its own is
  unaffected.

  Two further things the column's METADATA cannot answer are now asked of the
  column itself:
  - Installing `SET NULL` states that the column accepts nulls rather than
    inferring it from requiredness. A database migrated before a requiredness
    toggle relaxed anything still carries whatever `CREATE TABLE` gave the
    column, so a relationship both definitions call optional can be sitting on
    a `NOT NULL` column right now — and the statement is idempotent, so this
    also repairs the ones the old behaviour left behind.
  - Making a field required is refused, before any statement is written, when
    entries still leave that column empty. The server rejects the tightening,
    and by then the statements ahead of it have run — auto-committed on MySQL,
    including the foreign-key replacement a relationship's tightening is
    ordered behind, which would leave the table carrying no key at all while
    the save was recorded as made. The check reads the live rows; a caller that
    does not supply them keeps the behaviour it had.

  A definition already stored is read rather than judged. The previous creation
  path accepted a required relationship declaring `onUpdate: "set null"`, and
  refusing to READ that combination would have frozen the collection holding it:
  the repair is itself an edit, and every save visits every relationship the
  collection keeps, so one legacy field would have blocked unrelated changes to
  its neighbours. What a save ASKS FOR is still refused — including a save that
  flips requiredness onto a declaration that was legal before.

  What a field was is now answered in ONE place for every pass in a save. The
  action pass carried a renamed field's edit while the column pass, keyed on the
  new name, skipped the same field — so a link renamed and turned optional in
  one save had its key moved to `SET NULL` and its column left `NOT NULL`.

  The SQLite refusal in the schema templates is a `NextlyError` rather than a
  bare `Error` subclass, so it reaches a caller as the typed envelope every
  other refusal in the package uses. The class and its message are unchanged;
  callers and tests identify it by type.

  Two things about the check above, both found before it shipped:
  - It asks only about columns that are ON this table. A localized collection
    keeps its translatable columns in a companion, so probing the main table for
    one asked for a column it does not have — and that error arrives before any
    migration is generated, which would have failed every save on a localized
    collection with an optional translatable field.
  - Relaxing a column for a `SET NULL` key keeps the default it carries. MySQL
    restates the entire column definition on `MODIFY`, so a narrower rendering
    silently removed the relationship's configured default for future inserts.
    Both callers now render that statement through one function.

  A column the live table does not have YET is its own answer, not a clean one.
  Its `ADD` is queued, so it holds no nulls today — and reading that as "no
  nulls" let a save make the field required, after which the deployment creates
  the column holding NULL in every existing row and fails on the next statement.
  Absence is reported separately now and refused only where the table already
  has entries, with its own message: deploy the change that adds the field
  first, fill the entries in, then make it required.

  Which columns exist is read from the database rather than predicted from the
  field definitions. Predicting it was wrong twice — a localized collection
  keeps its translatable columns in a companion table, and a deployment holding
  an unapplied migration has a field whose column is not there yet — and each
  repair only covered the reason someone had just met. The reader now narrows to
  the columns the catalog reports before it probes anything, so it cannot be
  asked about a column that is not there whatever the caller believed. The
  caller's list is a query-reduction narrowing and says so.

  The requiredness precondition uses the save's own rename pair, like every
  other pass in a save. A field renamed and made required in one go read as
  newly added, skipped the refusal, and had the tightening emitted anyway; the
  nulls are recorded against the column the live table still has, so that is the
  name the check reads.

  The live column read is resolved to the catalog's own spelling of the table.
  MySQL under `lower_case_table_names=1` answers a query for a mixed-case table
  by reporting the name it folded, so the map came back keyed as `dc_posts` for a
  table asked about as `Dc_Posts` and an exact lookup missed the very table it had
  just described. That miss reported no nulls and no absent columns, which is
  indistinguishable from a clean table, so the refusal above withdrew itself on
  exactly the server whose DDL auto-commits. The folding rule is given rather than
  queried, for the reason the apply pipeline already records: the only name being
  matched is the one this read just asked the server to describe, so a
  case-insensitive match cannot select a different object. PostgreSQL is left
  case-sensitive, where the two spellings are two different tables.

  Singles ask the same question of their own table. The precondition is keyed
  entirely on facts the caller supplies, so a caller that reads none does not get
  a weaker check — it gets no check: the refusal returns at its first guard. The
  singles path read whether the table had rows and which columns carried keys and
  indexes, and never read the null state, so a single that tightened a field over
  an entry leaving it empty, or over a column an undeployed migration has not
  added yet, still had the nullability statement written for PostgreSQL and MySQL
  to reject. It reads both now, through the same reader the collection path uses,
  narrowed to the columns this pass will actually diff — a localized single keeps
  its translatable columns in a companion table and they are not this pass's to
  ask about.

- [#1796](https://github.com/nextlyhq/nextly/pull/1796) [`10ef8d9`](https://github.com/nextlyhq/nextly/commit/10ef8d95573eebad5bfdd8bd2daebdfb7193f141) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A many-to-many field's junction table now follows the field through its life in the migrations the builder writes.

  Adding a many-to-many relationship field has always created its junction table; nothing removed it. A removed field left the table standing with every link in it — unread, and inherited by any field added later under the same name, because the creation runs `CREATE TABLE IF NOT EXISTS`. A renamed field was worse: the rename detector only pairs fields that have a column, so a many-to-many rename fell to the add/drop loops, which created a fresh, empty junction for the new name and left the old one, links and all, orphaned. Dropping a collection dropped its table and its `_locales` companion and left its junctions behind.

  Now:
  - **Removing** a many-to-many field emits `DROP TABLE IF EXISTS <junction>`, the table resolved by the same rule the creation uses (the author's `junctionTable` name when set, the generated name otherwise). Moving the field to a storage class that has a column does the same, then adds the column.
  - **Renaming** a many-to-many field — one removed and one added that point at the same target under the same relation kind — emits `ALTER TABLE <old> RENAME TO <new>`, spelled the same on PostgreSQL, MySQL and SQLite, so the links travel with the name, and then renames every index and constraint whose generated name embedded the old table name (PostgreSQL renames them; MySQL renames the indexes and re-declares the foreign keys under their new names; SQLite rebuilds the indexes and needs nothing for its per-table constraints). Without that, a later field reusing the old field name would find its index and constraint names already taken. A junction the author named keeps its name and emits nothing. More than one such pairing in a single save is refused by name (`MANY_TO_MANY_RENAME_AMBIGUOUS`), as two field-group renames already are: a wrong pairing would hand one field the other's links. Removals and additions that pair with nothing are plain drops and creates.
  - The junction lifecycle is decided on the **full** field lists, so a `localized: true` many-to-many — which the column diff of a localized collection never sees — is created, renamed and dropped like any other; and a save that renames a many-to-many and a field group together carries both.
  - **Dropping** a collection drops the junctions its own fields own before the companion and the main table. A junction that another collection's field points at this table through is that field's, and stays with it; what should happen to such a field when its target collection is dropped is a separate question, filed for a decision.

  `generateDropTableMigration` takes the collection's fields (defaulting to none) so it can name those junctions; the collections delete path passes them.

- [#1868](https://github.com/nextlyhq/nextly/pull/1868) [`c5f8fe8`](https://github.com/nextlyhq/nextly/commit/c5f8fe82e43e86e29760a434129b68b524670192) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving part of a page as a pattern no longer gives a block an id it never had.
  When a pattern is inserted beside an element that already uses one of its ids,
  the insert renames the copy (`pricing` becomes `pricing-4985ccb3`) and records the
  rename, so a later save can store the pattern under its own name again. That
  record said what an id became but not which block it belonged to, so a block
  added afterwards and given the renamed id was also saved as `pricing`.

  An insert now also records which blocks it renamed, as `renamedNodes` beside
  `renamed` on the inserted root's `origin`. A save restores an id only on a block
  listed there that still exists once on the page and still carries the renamed
  id. A block that was deleted, whose id was changed, or that was added later
  keeps the id it has. Hiding a block behind a visibility condition does not
  change this.

  Existing pages behave as they do today. A pattern inserted before this release
  has no such list, and saving from it restores by id exactly as before, including
  the case above. Inserting the pattern again writes the list, and saving over a
  pattern keeps whichever form its record already has. `patternRenameRecord` reads
  a stored record's renames and its list together, in one pass.

- [#1857](https://github.com/nextlyhq/nextly/pull/1857) [`9bac152`](https://github.com/nextlyhq/nextly/commit/9bac152475a676d84d360bef7a6f999cbc9986f1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A rename of a site class survives the panel it was started from.

  The class manager lives in a rail that unmounts it on every switch, and that
  switch is exactly what makes two renames of one class overlap: the author
  renames, moves away, comes back, renames again, and the first write is still on
  the network. Two things were decided from state that the unmount destroyed or
  that the wrong attempt cleared.

  The name a class is HEADING FOR is now released only by the rename that is still
  the live one. An earlier attempt finishing under a later one used to release it
  for both — and the panel then judges the next edit against the name on screen
  rather than the one being written, so typing the original back reads as "nothing
  changed" and is silently dropped while the later rename goes on to persist a
  different name.

  And whether an answer still describes the rename being attempted is now decided
  from an identity the HOST owns. Kept inside the field, it was destroyed by the
  unmount and started again from zero, so the first answer to arrive after a switch
  passed as the current one: a refusal for a rename the author had already replaced
  was raised from the shell, naming an edit that no longer existed.

  Both decisions now read the same identity, because they are the same question
  asked twice.

- [#1692](https://github.com/nextlyhq/nextly/pull/1692) [`dc38f47`](https://github.com/nextlyhq/nextly/commit/dc38f4758422964a2ff34fe5556020d552e4b3dc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin route can compute the permission it requires.

  `requiredPermission` took a fixed slug, and a permission slug spells a
  collection — which the host can rename. A route gating on one of its own
  plugin's collections therefore had to choose between demanding a grant nobody
  was seeded on the installs that renamed it, or declaring no permission at all.
  The page builder's save-pattern route chose the second, so a write was reachable
  by any authenticated caller.

  It now also accepts a function of the plugin's own resolved names:

  ```ts
  requiredPermission: ({ collection }) => collection("patterns", "create"),
  ```

  The scope composes the slug through the same helper core seeds with, so a route
  never spells one itself, and the demanded grant follows a rename. A resolver
  that throws refuses the request rather than falling through to the ungated path.

- [#1699](https://github.com/nextlyhq/nextly/pull/1699) [`c293917`](https://github.com/nextlyhq/nextly/commit/c293917acd1e74d5d8722696589c31ba69d90bc2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard chart's table draws its row separators at full strength.

  At half alpha they measured 1.11:1 against the page surface, where WCAG asks
  3:1. A separator in a data table is structural rather than decorative — it is
  what tells a reader which number belongs to which row — so it carries the
  contrast a reader needs, and it now matches the shared table primitive every
  other table already uses.

  The plugin-route documentation's scope-narrowing example is a complete route
  rather than a fragment. It referenced `ctx`, `id` and `data` with nothing
  declaring them, so a reader copying it got three errors and could not see where
  those values come from. It now shows the handler they arrive in.

- [#1875](https://github.com/nextlyhq/nextly/pull/1875) [`3d60b11`](https://github.com/nextlyhq/nextly/commit/3d60b11362c0faf2b55685ae08a6b3513fb871d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a component could do far more work than its bound said. Before a save,
  each of the component's variants is composed to check that the component does
  not end up referencing itself, and that work was charged only for the
  component's own nodes. A small component placing a large one composed the large
  one again under every variant, and a large component naming itself was not
  checked at all on a save made without the Direct API.

  Each composition is now charged, by the composer itself, for every entry it
  examines, including expansions it abandons and nodes an override hides, against
  one allowance per save. A save that spends it is refused, and the message says
  what the author can change. `resolveComponentInstances` takes that allowance as
  the `work` option, and reports `loopsClosed`, every component a reference loop
  closed on, so a loop found just before the allowance ran out is still named as a
  loop rather than as spent work.

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

- [#1800](https://github.com/nextlyhq/nextly/pull/1800) [`e8e8d78`](https://github.com/nextlyhq/nextly/commit/e8e8d7855ca06ce444c9dfaba4ed23b45a64ceb4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single read now applies field-level `access.read` rules before its field-level `afterRead` hooks, and again after them, the way a collection read always has. Before, a denied field's own hook ran and saw the value, and a hook on an allowed sibling could read the denied value; the response was redacted, but app code had already seen it. Access decides on what is stored; hooks shape what is returned.

- [#1687](https://github.com/nextlyhq/nextly/pull/1687) [`adfafa3`](https://github.com/nextlyhq/nextly/commit/adfafa36762a24745b69ca1e14367f310940fbce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A spacing drag handle sat on the wrong edge for most margins, and dragged
  backwards there.

  Which edge of a band moves when its value grows is a property of the layout
  rather than of the box. Measured in Chromium, growing `margin-top` drives the
  block's border edge down while its outer edge stays pinned by whatever precedes
  it; `margin-left` does the same against the container, and so does `margin-right`
  on a block whose width is auto — while `margin-bottom`, and `margin-right` on a
  fixed width, do the opposite. The editor now asks the element on every side, for
  margins as it already did for paddings, so the handle sits on the edge that
  responds and the drag follows the pointer.

  It asks each time it draws, so the handle follows whatever the block is doing
  whenever anything prompts a fresh look: an edit that settles a height, a
  breakpoint that swaps the width model, a container query answering to a sibling,
  a state being previewed. None of those has to be anticipated for the handle to
  be right. A margin that changes only under a real `:hover` is still described at
  rest, which is what the editor has always done, because nothing reports that.

  The measurement also leaves the page alone properly now. It works by pushing a
  value onto the block and putting it back, and on a block with no inline style of
  its own the attribute was left behind empty — invisible on screen, and visible to
  everything in the editor that watches the page for edits. Nothing is left behind.

  Two smaller corrections come with it. A handle on a negative margin now grows
  the value in the direction the edge actually travels, instead of committing a
  larger negative number and running the block away from the pointer. And a
  transformed block is measured against the scale its margins are laid out in
  rather than the one it renders at, which had inverted the handle on any block
  carrying a transform of its own.

- [#1859](https://github.com/nextlyhq/nextly/pull/1859) [`812f167`](https://github.com/nextlyhq/nextly/commit/812f16767fec5aecb0acf41711ddc1d7047c8e26) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A publish that also edits a group, repeater or JSON field no longer fails validation.

  When a pending change existed, publishing it together with an edit to any group, repeater or JSON field was refused as "must be an object", with no field rules involved at all. The ordinary write encodes those fields to their column strings before the publish is judged, and the check on the document being published then read a group as text. Both checks now read the document in its logical shape, through the same conversion that reads the live row, and the write encodes it once.

  A field declared inside a group or a repeater is judged as content, however it is named.

  The publish gate skips the store's own bookkeeping columns, such as `id` and `updatedAt`, and defers to the field names the schema declares so that a real field with one of those names is still judged. Those names were collected in a way that stopped at the first named container, so a declared field nested inside a group or repeater was still skipped, and a Single's publish was not given the names at all. The names are collected at every depth now, for collections and Singles alike.

- [#1832](https://github.com/nextlyhq/nextly/pull/1832) [`9ad1744`](https://github.com/nextlyhq/nextly/commit/9ad17448d2176b786041efae68a86d73678bf3b4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard's onboarding checklist now offers "create your first collection" to
  every reader who could finish it, and to no reader who could not.

  An administrator who is not a super admin was never shown the step. Creating a
  collection seeds its permissions to the super-admin role, but the built-in role
  presets are re-resolved against the live permission list on every boot, and the
  `admin` preset covers a content collection — so an admin does reach what they
  created, from the next start. The checklist asked only about the immediate seed
  and hid a step that was theirs to take.

  An API key was offered it on any grant beginning `read-`. The read decision
  admits a key on an exact `read-<slug>` match, so a key stamped `read-settings`
  could only finish the step by creating a collection called `settings` — a
  reserved name. It is now offered the step only where its grant names a
  collection that could actually be created.

  Both answers are computed from the declarations that produce them — the seeder's
  role and the preset predicates, and the collection slug rules themselves — rather
  than restated beside them, so a preset or a reserved name that changes carries
  the checklist with it.

  A widget source contributed by a plugin is now keyed from the record the registry
  published rather than by reading the plugin's object a second time. A JavaScript
  `id` may be an accessor or a proxy, and a second read that answered differently
  filed the resolver under an id no source claimed, leaving the published source
  failing every query as unanswerable.

  A widget source's resolver now receives the host's `ResolverOptions` — a
  cancellation signal today — beside the question it is answering. The dashboard's
  per-slot budget already stopped waiting for a resolver that hung, but a promise
  has no cancellation, so the work went on running and further requests started
  more of it. The signal is aborted when that budget expires, so a resolver that
  passes it to whatever it calls (`fetch` takes one directly) stops rather than
  merely stops being awaited.

  The parameter is optional and arrives in an options object, so every resolver
  written before it keeps working unchanged, and anything the host offers later
  becomes a field there rather than another positional argument. `ResolverOptions`
  is published through `nextly` and `@nextlyhq/plugin-sdk` alongside the resolver
  types.

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

- [#1747](https://github.com/nextlyhq/nextly/pull/1747) [`d29c54d`](https://github.com/nextlyhq/nextly/commit/d29c54daca0076cd0c41192946d2056046c66ac4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Renaming a class in the page builder could be refused without the author being
  told. A host that answers immediately — because the site style is locked, or the
  name is one it already knows is taken — had its refusal discarded, so the row
  cleared and the rename looked like it had worked until the next read. A host that
  answered a moment later was always shown correctly; only the immediate answer was
  lost.

- [#1782](https://github.com/nextlyhq/nextly/pull/1782) [`e1605f8`](https://github.com/nextlyhq/nextly/commit/e1605f8b03c0c4111716d426fe0a125e3f174b2c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A `text` widget declares its prose and the dashboard draws it.

  The archetype existed in the contract with nothing to carry the prose and no
  renderer behind it: a plugin declaring one got a card reading "not rendered
  yet". A text widget now declares `content` as markdown -- headings, paragraphs,
  lists, emphasis, inline code, block quotes and links -- and the host draws it
  through the same rich-text stack the editor uses, read-only, loaded only when a
  text card is on the dashboard.

  Three things the markdown cannot do, by design. Raw HTML is shown as the text it
  is. A link may point at `http`, `https`, `mailto`, `tel`, or a path on this site
  written as `/...`, `./...` or `#...`; one to anything else is left on screen as
  the markdown it was written in, so the author can see it was refused. And the
  content is bounded at registration, and refused over the bound rather than cut:
  it travels inside every dashboard load for every reader offered the card. An
  external link opens in a new tab.

  `content` is required for `text` and refused on every other archetype, on both
  the registry and the plugin channel through one rule.

  The admin workspace payload now carries only the widget declarations its reader
  may see, and only the parts of them. A declaration is its whole content -- a
  `text` widget's prose, an `actions` widget's shortcuts -- so the gate a widget
  declares through `requiredPermission`, and the gate each of its actions
  declares, is applied on the server before the declaration ships, from the
  plugin channel and the registry alike, by the same decision the dashboard
  layout endpoint places cards with. Where two plugins contribute the same widget
  id, only the first declaration ships, which is the one the dashboard draws.
  Previously every authenticated caller received every declaration whole and the
  browser hid the gated cards and shortcuts.
  A registered widget the payload cannot carry -- one JSON drops or rewrites --
  no longer wins a collision with a contributed one; the contribution stands, as
  itself, with the gate it declared. And a numeric character reference outside
  Unicode's range (`&#1114112;` and up) in a text widget's markdown now draws as
  the replacement character, as it would on a web page, instead of blanking the
  card.

  The dashboard layout's `scope` token now also covers which shortcuts inside
  the visible cards the reader may see, so the admin re-reads its workspace when
  a reader gains or loses a shortcut's permission and not only when a card
  appears or disappears.

- [#1867](https://github.com/nextlyhq/nextly/pull/1867) [`0d5f838`](https://github.com/nextlyhq/nextly/commit/0d5f838701b6ef77b390fa79eaf985f50b449dca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Importing a design-token file reports what the reader passed over from the reader itself, rather than from a second walk of the file. Two of the format's own fields now say what was lost: `$extends` (the group it would inherit from is not followed, so those tokens are not imported) and `$deprecated`. A token the importer refuses no longer also claims its value was read from `$value`.

- [#1885](https://github.com/nextlyhq/nextly/pull/1885) [`0708ec6`](https://github.com/nextlyhq/nextly/commit/0708ec68cd6785776f073f8e4453ffd95d8ccaca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A design-token import no longer calls an `$extends` that points through a `$`-prefixed key an inheritance, and a token refused for its name or identity still says when its `$type` was ignored.

- [#1788](https://github.com/nextlyhq/nextly/pull/1788) [`9e59229`](https://github.com/nextlyhq/nextly/commit/9e59229d43ae0a57b2d14bf8c30c651f45bbab52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A bulk create (`createMany`) and a create or update made inside a caller's transaction now write a `fieldGroup` field's value to its component table, as the ordinary create and update do. Before, a bulk create of any collection that embeds a field group failed every row with `no column named <field>`, and a transactional update reported success while leaving the component's old value in place. A transactional update held as a working draft now carries the field group in the draft.

- [#1801](https://github.com/nextlyhq/nextly/pull/1801) [`0121364`](https://github.com/nextlyhq/nextly/commit/0121364ce39b6f2780b3500b1a35aff700769af5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `updateEntries` on the collection entry service now takes `overrideAccess`, as `createEntries` already did: the collection gate, the publish-transition pre-resolve and every per-entry write skip access when it is set. Before, a trusted batch update had no trusted path and was judged as an anonymous caller, so every row was refused on a collection whose update rule wants a user.

- [#1728](https://github.com/nextlyhq/nextly/pull/1728) [`06f192f`](https://github.com/nextlyhq/nextly/commit/06f192f9b0546085ca3bd700cff0b97fe94206e1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly --version` reports the version that shipped.

  The constant behind it was typed by hand under a comment saying it "should
  match package.json version". It did not: the CLI answered `0.1.0` while the
  package shipped `0.0.2-alpha.65`, so anyone asking the tool which Nextly they
  were working against got a confident wrong answer — and telemetry attributed
  every CLI event to a version that has never been published.

  It is asked of the same resolver the plugin system already uses to validate a
  plugin's `nextly` compatibility range, so a reported version and a
  compatibility answer can no longer disagree. A test holds the two together.

  The scaffolded agent guide now says how to find that version and where the
  authoritative documentation is, including the two machine-readable indexes at
  `/llms.txt` and `/llms-full.txt`. An agent working in a Nextly project would
  otherwise answer from whatever it remembers of some other version.

- [#1702](https://github.com/nextlyhq/nextly/pull/1702) [`2a6f497`](https://github.com/nextlyhq/nextly/commit/2a6f497fe51cb6bc2403bf77b1e929ceeb45b4a0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard card that only matters sometimes had to hide itself. The
  get-started card was placed in the grid, given an order, and then rendered
  nothing once seeding was done — so the arrangement reserved a slot for a card
  drawing nothing, and the reason lived in a component rather than in the
  declaration.

  A widget can now declare that it is transient: it names the condition it shows
  under, and the host stops offering the card once that condition lapses.
  Pinning and reader dismissal are not part of this release — a card cannot yet
  ask to sit above the ordinary order, and a reader cannot yet end one early —
  a reader who declines the get-started offer keeps its slot until the install
  has content.

  The condition is a NAME from a closed set the host owns, never a predicate or
  callback a widget supplies, so an onboarding surface cannot become the kind of
  unconstrained notice channel that other admin ecosystems have never managed to
  contain. A name this release cannot answer is refused when the widget is
  registered, where the author can still be told.

  The first condition asks whether THIS reader can see any content, and is
  deliberately about the reader rather than the install: answering across
  everything would report on rows the reader is not allowed to know exist. A
  draft counts as content — someone who has written one post and not published it
  is not looking at an empty install.

- [#1735](https://github.com/nextlyhq/nextly/pull/1735) [`8653c19`](https://github.com/nextlyhq/nextly/commit/8653c19201992cd0243b2927ad017efe1da9a288) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An API key's write appears in the activity trail.

  It recorded nothing before — not mislabelled, absent. The recorder refused any
  actor that was not a signed-in person, because a row's identity column is
  joined to the accounts table and a key's own id would find no account and be
  filed as an already-erased person. So every write made with an API key was
  invisible, and nothing about it is recoverable after the fact.

  The row now carries the KIND of caller its identity column refers to, and the
  admin's Recent Activity names the key rather than showing a blank actor.
  `user_id` is unchanged and still required: it is already documented as the
  actor's opaque reference, so one nullable `actor_type` is the whole schema
  change and no dialect needs a nullability rebuild.

  A NULL kind means a row written before this existed. Those are all user writes,
  because no other kind was recordable.

  Writes with NO initiating actor — seeds, migrations, imports and jobs — are
  still not recorded, and the reason has changed rather than gone away. They run
  while the schema is being created, and a failure to write the trail fails the
  surrounding write: a trail insert against a table that does not exist yet would
  fail the seed that was creating it. That needs its own answer.

- [#1837](https://github.com/nextlyhq/nextly/pull/1837) [`9c071ae`](https://github.com/nextlyhq/nextly/commit/9c071ae85e64e59942653408215b4ef0f06277ed) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-mcp` now serves a Model Context Protocol endpoint. It exposes
  nothing through it: no tool, resource or prompt is registered yet, so a client
  that connects finds a server with no capabilities. What this release adds is the
  address, and the checks that decide who may reach it.

  The endpoint is a Nextly route rather than a file you mount yourself, so it
  inherits the authentication every other route gets: a signed-in session, or
  `Authorization: Bearer` with an API key. A key is judged on the grants stamped
  on the key itself rather than on what the person who minted it can reach, so an
  agent is bounded by the key you give it. A scaffolded project serves the
  endpoint at `/admin/api/mcp`.

  It stays off unless you turn it on. While `enabled` is `false`, which is the
  default, the plugin contributes no route at all.

  A request addressed to a hostname you have not published is refused with `403`.
  That is what the transport specification requires a server to do, and what makes
  a name an attacker controls useless even when it has been made to resolve to
  your server: the protocol library ships both the `Origin` and `Host` checks and
  applies neither, so a handler wired straight to a route answers a forged `Host`
  with `200`. By default the endpoint answers on the hostname of
  `NEXT_PUBLIC_APP_URL`, and on localhost if that is unset; `allowedHosts` names
  them yourself, and replaces that default rather than adding to it.

  Clients speaking the 2025 revisions are served statelessly, which is every
  shipping client today. `GET` and `DELETE` answer `405`: they were the session
  operations, and the `2026-07-28` revision removed them.

- [#1665](https://github.com/nextlyhq/nextly/pull/1665) [`fe5206e`](https://github.com/nextlyhq/nextly/commit/fe5206ea8f57a9466d20ee4cb28827fcb1011138) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly.group` and `nextly.timeseries` now work on the documented instance.
  `getNextly({ config })` builds its object by binding one method at a time and
  forwarded neither, so both were `undefined` on the path the docs recommend
  while working through the lazy singleton — `group` since it shipped. A test now
  compares the instance against the Direct API's own surface, so the next
  omission fails rather than reaching a consumer.

  A yearly timeseries no longer reports zeros. The documented maximum of 366
  intervals starts in 1661, and MySQL renders that bound with `FROM_UNIXTIME`,
  which answers NULL outside its range — so the predicate meant to bound the scan
  matched nothing. A bound outside what the column can store is now omitted,
  which excludes no row that could exist.

  A timeline refuses earlier and more clearly. A malformed date field is named
  rather than surfacing as a server fault; an unsupported interval is judged after
  collection authorization, so an untrusted caller gets the access refusal rather
  than a response that confirms the collection exists; and the window and the
  release visibility now resolve against one clock.

  A collection source describes what its timeline can actually do. It advertises
  `timeseries` only when it exposes a date the read would accept, and marks a date
  the read would refuse so a dashboard cannot register a card that fails on every
  load.

- [#1694](https://github.com/nextlyhq/nextly/pull/1694) [`ea942ba`](https://github.com/nextlyhq/nextly/commit/ea942bacdafeb46e228b88c932ad04a476122c83) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An editor can tell which rendered elements belong to a component instance.

  A component is inlined at render, so the instance node is replaced by the tree
  its definition describes and every element inside one carries a node id the
  page's own document does not contain. An editor hit-testing on the node address
  alone therefore resolved a click inside a component to an address it could not
  select, edit or delete.

  `INSTANCE_ATTRIBUTE` names the instance an element's node belongs to — the one
  the author actually placed on the page, even where components nest. It is
  written only for nodes the definition supplied, which is the half that makes it
  useful: an instance's slot content is nested inside the same inlined tree but
  belongs to the page, so it stays unmarked and directly selectable. That content
  is exactly what a marketer opened the editor to change.

  It rides the editor's node address the way its siblings do, so a published page
  carries none of it.

  A node that arrives already claiming `instanceOf` loses the claim. That field
  means "the resolver inlined this from a definition", and only the resolving pass
  may say so — but documents arrive from places that never ran it, and unknown
  node keys are preserved through storage deliberately. Left standing, an editor
  would send a click, an edit or a delete to a component the author never placed,
  while the node they were pointing at is one of their own.

  The composition-free fast path now walks a document carrying such a claim. That
  path was previously a pure optimisation; it is not one any more, because the
  document where a false claim survives is precisely the one with no components in
  it.

  The marker is the renderer's to write, and the renderer takes that back from
  the two other parties who could reach it.

  A BLOCK builds the element the marker lands on, so it can return a root that
  already carries one — hardcoded, or spread from a stored attribute bag. The
  marker is now ASSIGNED in both directions rather than merely added, so a root
  whose node carries no resolver provenance has the attribute removed rather than
  left as the block wrote it. The stored document's route into the same namespace
  was already closed; this is the same rule for the route a block controls.

  A block is also handed the node object itself, and everything read back after
  it runs is whatever it left behind. The editor's address — both the instance
  and the node id — is now snapshotted at the boundary before any of a block's
  code runs, including `rendersNothing` and the `slots` read, and carried down
  the synchronous and awaited paths. The awaited one matters most: "after the
  render" is a window there rather than an instant, and the same node object
  re-enters the output check on the far side of it.

  Placeholders carry the markers too. A placeholder is drawn INSTEAD of the
  block, so it never reached the marking step — which left the one element an
  author can see and click, when a block inside a component fails, addressing
  nothing. Definition node ids are re-minted during composition, so for those the
  host instance is the only thing an editor can act on.

- [#1662](https://github.com/nextlyhq/nextly/pull/1662) [`fe645f1`](https://github.com/nextlyhq/nextly/commit/fe645f17a0492ccc22cb57e0acc11cffaca1ae04) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The block renderer now asks the engine which HTML `id` a block emits instead of deciding again. `renderedDomId` was already the one rule for that question — validation, the planners, the copier, the resolver, the tree walker and the builder all derive from it — and the renderer, the thing that rule models, was the last place keeping its own copy.

  One rendered-output change comes with it: a block whose id is set to an EMPTY STRING no longer emits `id=""`. It emits no `id` attribute at all. Nothing addressable is lost — the DOM Standard unsets an element's ID when the attribute is the empty string, so `getElementById("")` never matched it and no `aria-labelledby`, `for` or `#` selector could reach it, while the HTML Standard requires an id to hold at least one character. What shipped before was invalid markup that addressed nothing.

  An empty id still SHADOWS an `id` in the block's attributes, which is the part authors can observe, and the inspector still offers to remove it. Its note now says the block renders no id at all and that the attribute id is ignored, rather than describing the `id=""` that no longer appears.

- [#1848](https://github.com/nextlyhq/nextly/pull/1848) [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-mcp` corrections, and two package summaries that said the
  opposite of what the package does.

  The npm description and the root package catalogue still described the package
  as a placeholder serving no endpoint, which is what a reader discovering it
  through the registry or through an indexed README was told. Both now say what it
  is.

  The route matcher's grammar is published. `routePathIsLiteral` answers whether a
  path names exactly one address or a family of them, and `@nextlyhq/plugin-sdk`
  re-exports it, so a plugin taking a path from an operator can refuse a pattern
  while the config is being written without restating the rule beside the matcher
  that will actually route. A restatement stricter than the matcher refuses paths
  that would have worked, which is what happened here: a check that refused every
  `:` rejected `/mcp:v1`, a literal addressing exactly one URL.

  `path` refuses a value that cannot address a single endpoint (a missing leading
  slash, a trailing one, a `:param` pattern, or the mount itself) at the moment it
  is written rather than as a 404 to explain later. Its documentation also now
  says what it cannot promise: a path Nextly itself serves will not reach the
  endpoint, because core answers first, and that precedence is deliberate.

  Authentication runs before the endpoint's address check, so a request carrying
  no credential is answered `401` whatever address it used. That is written down
  now, in the package and in its README, rather than left for a reader to discover
  from a status they did not expect.

- [#1763](https://github.com/nextlyhq/nextly/pull/1763) [`0afa12a`](https://github.com/nextlyhq/nextly/commit/0afa12a3300679a97939f463e82702a721d1b505) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The instance exposure view no longer reports an ancestor as cleared when only a
  descendant path was cleared, no longer counts an override on a path the resolver
  refuses to write as in force, and finds each row's winning write among its own
  node's writes rather than scanning every write per row.

- [#1746](https://github.com/nextlyhq/nextly/pull/1746) [`c284753`](https://github.com/nextlyhq/nextly/commit/c28475395a77f334aa45acc75e8f85c439d8e455) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An editor can ask what one component instance currently shows for each property
  its definition exposes, through `instanceExposure`.

  It answers with the value in force and WHICH layer supplied it — the definition
  itself, a variant preset, or the instance's own override — because those need
  different offers: resetting a value the author never set is not a reset. The
  answer separates a deliberately cleared property from one the definition simply
  leaves empty, which render identically and are not the same edit, and it reports
  overrides whose exposed property has since been removed rather than dropping
  them silently.

  Derived from the precedence the resolver already applies rather than computed
  beside it, so a renderer and an editor cannot disagree about what is in force.

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

- [#1743](https://github.com/nextlyhq/nextly/pull/1743) [`9563aa3`](https://github.com/nextlyhq/nextly/commit/9563aa3ec7fe14b189797ab3227cdb3bd41666f0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A missing dashboard service no longer fails a content write.

  The audit recorder asks the container for that service, and a container reports
  an absent registration two ways: by throwing, and by answering `undefined`. Only
  the throw was handled, so the second walked past the catch that exists to keep an
  audit failure from failing the write, and died on a property access instead. "No
  dashboard service registered" became a FAILED CONTENT WRITE.

  The activity feed also names a system actor as "System" instead of rendering a
  blank author. Nothing writes those rows yet, and this release does not start:
  a write that names no initiating user is still not recorded, because a plugin's
  `init()` hook runs before pending migrations do, and an insert against a table
  that has not been migrated yet would take the boot down with it. The column can
  already hold the value, so the reader handles it rather than showing an empty
  author for every import and job the moment something does.

- [#1731](https://github.com/nextlyhq/nextly/pull/1731) [`110d2bc`](https://github.com/nextlyhq/nextly/commit/110d2bcdcfe19e9a846ea6e40abcc52af5611600) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The guidance for anonymous content reads described a limitation that no longer
  holds, in the direction that matters: it said inline `defineCollection({ access })`
  code rules are not applied without a user, and told readers to gate such content
  behind an authenticated read.

  Those rules ARE applied now. A code rule reads what it is handed, and an
  anonymous caller is something it can be handed, so it receives `user: null` and
  no roles and decides on that. A rule written `read: ({ user }) => !!user` hides
  the content exactly as its author intended.

  What an anonymous read still cannot apply is a row-level CONSTRAINT rule,
  owner-only or a custom rule returning a query predicate. Those compare a row
  against somebody and there is nobody to compare it to, so the guidance to use an
  authenticated read stands for them and now says so specifically.

  Both copies are corrected, in `resolveContent`'s own contract and in the routing
  guide. Two tests hold the claim at the point that decides it, including a
  control that no inline rule still means the stored rules decide.

- [#1870](https://github.com/nextlyhq/nextly/pull/1870) [`d95e4d6`](https://github.com/nextlyhq/nextly/commit/d95e4d695fd2678071a8b93c016b8e80199b7229) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scoped API key reaching a collection or single through a permission-gated route, including plugin routes that declare `requiredPermission`, is now held to that entity's code-defined `access` rule. Previously holding the grant was enough on these routes, while the collection routes already applied the rule. A key the rule refuses now receives 403 where it was admitted.

- [#1720](https://github.com/nextlyhq/nextly/pull/1720) [`da86960`](https://github.com/nextlyhq/nextly/commit/da869606c5d326aac1b75a50a2324c6e47d39bad) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The usage index is backfilled, so "used on N pages" can be exact on a site that
  existed before it.

  The write hooks maintain the index going FORWARD. Nothing filled it for
  documents already stored when the plugin was installed, or when a version added
  an index, so every component on such a site had no rows at all — and no rows is
  indistinguishable from a component nothing uses, which is the answer a delete
  decision acts on. Until now `complete` was false unconditionally for that
  reason.

  A sweep does the filling, because nobody is in a position to enqueue it: the
  work is owed from the moment the plugin meets existing content, and the events
  that make it owed are not things any handler sees.

  Each pass walks one (collection, field, locale, variant) — the smallest unit a
  rebuild can finish, so the largest one certain to make progress — stops at the
  runner's deadline, and defers the rest to a durable queue. A scope is recorded
  only after its walk resolves AND brings every row it touched into agreement, so
  a partial rebuild is retried rather than marked done and never revisited.

  A document too large to read whole is the one exception, and it is recorded
  rather than retried. Exceeding a bound is deterministic — the same document
  exceeds it on every pass — so refusing would leave the scope outstanding for
  ever and make every drain rescan the collection. Such a document leaves an
  `unreadable` marker instead, written before the scope is recorded, and that
  marker keeps health from calling any count exact until a later save or a change
  of traversal limits makes the document readable again.

  It pages by KEYSET rather than by offset. Deleting a document the walk has
  already passed shifts everything behind it back, so an offset walk skips the row
  that crosses the boundary — survivable for a repair, where the missed document
  keeps the rows it had, and not for a first fill, where it has none and nothing
  notices. Resuming after the last id seen removes the shift entirely.

  Collections come from the live REGISTRY, not from configuration. The Schema
  Builder creates collections at runtime, and those exist only there; enumerating
  the configured set would walk a narrower population than the hooks maintain
  while judging readiness against that same short list.

  Completion is recomputed against the scopes that exist NOW and against the
  bounds the index is derived under. Adding a collection, a locale or drafts
  returns the count to a floor until the new work is done, and changing
  `pageBuilder({ limits })` starts a new generation rather than inheriting
  progress made under bounds the renderer no longer applies.

- [#1816](https://github.com/nextlyhq/nextly/pull/1816) [`075870a`](https://github.com/nextlyhq/nextly/commit/075870acd262c00fa048c63ab9e85568dcede8e7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A bulk write now reaches a localized collection. `createMany` failed every row
  on a collection with `localized: true` — the shared create implementation wrote
  the translatable values to the main table, which has no columns for them, so
  the driver's own message ("no column named …") came back per row. It performs
  the same split as a single create and writes the companion row for the write's
  locale, inside the same transaction; the shared update implementation, which
  had the identical gap, upserts that row. Both refuse a named locale as before:
  these paths write the default language.

- [#1712](https://github.com/nextlyhq/nextly/pull/1712) [`1f4941c`](https://github.com/nextlyhq/nextly/commit/1f4941cb6c84487ee4fc1d554e3fdbda3812dad6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two slots of the chart palette were not legible in light mode. Measured against
  the surface a widget draws on, the cyan and amber slots reached 2.21:1 and
  2.15:1 — below the 3:1 minimum that applies to a graphical object someone has to
  read to read the chart. The draft segment of the content lifecycle card is drawn
  in the amber one.

  Both move down their ramp in light mode only: cyan-600 and amber-700, measured
  at 3.68:1 and 5.02:1. Dark mode is untouched, where the lighter steps sit at
  9.0:1 and 9.3:1 against the same surface — the two modes need different steps of
  one ramp rather than a single shared value, which is what they had.

  The palette is now asserted rather than exempt. Every slot is held to the
  minimum against the card surface, in both modes, so a slot that fails is caught
  when the colour changes rather than when someone first draws a chart with it.
  The bar fill a widget paints over its track is asserted the same way.

  The lifecycle ring drew its two arcs touching, with nothing between them but
  their own colours — 2.15:1 apart in dark mode, where one arc is white. A
  separator in the surface colour is now carved under each segment, so where one
  arc ends is visible whatever the two colours are. No palette choice could have
  fixed that boundary: one of the two segments is the primary, and a colour far
  enough from both white and a near-black card would have dictated the amber for
  every other chart to settle one ring.

  The builder's style inspector paints its provenance dots in the same two slots,
  on a surface that aliases the muted container rather than the card. Those two
  pairings are asserted as well.

- [#1862](https://github.com/nextlyhq/nextly/pull/1862) [`6556810`](https://github.com/nextlyhq/nextly/commit/65568108bc06b44df60efa450bdcc3021b39af6d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The class manager now describes a class the way the page compiles it: a declaration the site's remote-host policy drops is no longer listed, and styles held under a site-defined breakpoint are counted in the "more elsewhere" note.

- [#1642](https://github.com/nextlyhq/nextly/pull/1642) [`c7b8348`](https://github.com/nextlyhq/nextly/commit/c7b834843e3d3b2aae652cbc6d2f07c104289f4e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Collection reads: give the list, count and by-id paths one implementation per concern, and apply the stored read rule's query constraint on all three.

  A read by ID resolved its row predicate from the owner-only rule alone, while listing and counting resolved it from the access-control service's query channel. The two agree for an `owner-only` rule and nowhere else, so a `custom` read rule returning a query constraint filtered every listing and left a read by ID unfiltered — a row withheld from the list was reachable by its ID. All three paths now ask the same question, translate the answer through the same where-builder, and refuse a constraint they cannot fully express.

- [#1809](https://github.com/nextlyhq/nextly/pull/1809) [`f3ab090`](https://github.com/nextlyhq/nextly/commit/f3ab09095686af3c7ddf831767d90bfce43276c9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field defaults now reach every write that applies them, at every depth. A `defaultValue` declared as a function is applied on an ordinary REST or Direct API collection create; before, a collection's fields reached that write from their stored definition, where a function does not survive, so the field was left empty. A new field-group instance fills the defaults its own fields declare before it is validated, so a required child with a default no longer refuses an instance the caller could not have completed. A Single's first read fills the defaults declared inside its groups and repeater rows, and refuses a password default at any depth, as it already did at the top level. In a LOCALIZED field group, a repeatable or dynamic-zone instance is now prepared before its write is split between the main row and the companion row, so the defaults it takes, the relationships it normalizes and the passwords it hashes reach the rows that are stored rather than being left on a payload the split had already copied.

- [#1871](https://github.com/nextlyhq/nextly/pull/1871) [`44fec3d`](https://github.com/nextlyhq/nextly/commit/44fec3d8d7503652c8faef483587b9af7d5c99cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving part of a page as a pattern now puts each renamed id back on the right
  block, even when blocks in the selection came from different patterns.

  Before, a save had one answer per id for the whole selection. When two blocks
  or two links disagreed about what an id used to be called, nothing was put back
  and the pattern kept a page-specific id such as `pricing-4985ccb3`. Now each
  block that carries an id is decided on its own, and a link follows the element
  it points at: if that element is saved too, the link takes whatever id the
  element ends up with, and otherwise the link goes back to the name its own
  pattern gave it.

  Existing pages and patterns need no change. Saves that already put ids back
  store the same result as before; the difference is only in selections that mix
  blocks from different patterns or components, which now keep correct ids where
  they used to keep page-specific ones. `reidForestWithMap` accepts a new
  `restoreEach` policy for callers that need this per-node decision.

- [#1776](https://github.com/nextlyhq/nextly/pull/1776) [`5702cdc`](https://github.com/nextlyhq/nextly/commit/5702cdc54ef8f97ed319721503ec59a75494818a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every drag surface in the admin now names what it is moving, and a drop back
  onto the same row is reported as unchanged.

  The select-field option list, the hooks editor, the repeater and component
  rows, and the schema builder canvas still announced dnd-kit's generated ids
  during a drag. They now say the option's label, the hook's name, "Gallery item
  2", or the labels of the fields in a builder row -- "Picked up First name and
  Last name, row 1 of 3". The option and hook drag handles are named after their
  item; the hook handle had no accessible name at all.

  Dropping an item where it was picked up -- Space twice, or a pointer released
  over the original row -- used to announce that it had "moved to" its own
  position. It now says it was dropped where it was and nothing moved, which is
  what happened.

  The schema builder canvas packed its rows two different ways: the list left
  hidden fields out and gave a repeater or group its own full row, while the
  reorder that consumed the list's row numbers did neither. With a hidden field
  above, or a half-width repeater, dragging a row moved a different row. Both
  now read one packing, so the row you drag is the row that moves.

- [#1750](https://github.com/nextlyhq/nextly/pull/1750) [`1bd2187`](https://github.com/nextlyhq/nextly/commit/1bd218792cda7ebb04ef271f1daa1da93041f92b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `getCachedNextly` is exported from `@nextlyhq/plugin-sdk`. Plugin server work
  that runs outside a route has no `ctx.services` to reach through and no config
  in scope, so it needs the already-booted instance; until now the only import
  path was core's root, which is not the surface a plugin's compatibility is
  governed on. It is `@experimental` there, per the stability ladder.

  `@nextlyhq/plugin-page-builder` reads its site-style single through that import
  now instead of core's root.

  Its docblock also described the wrong boundary. It said publishing the accessor
  from `nextly/runtime` would force a `next` peer dependency on plugin consumers.
  It would not: `next` is the one peer this package does not mark optional, so a
  consumer resolves it whichever subpath they import. What the root actually
  avoids is `next/*` entering a module graph that has no request lifecycle to run
  inside, which matters to a plugin bundled for the browser and to the CLI.

- [#1835](https://github.com/nextlyhq/nextly/pull/1835) [`9c2e0e7`](https://github.com/nextlyhq/nextly/commit/9c2e0e7c10dc483b1d29a2675d91c7a9cdbb83a8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The onboarding checklist now judges an API key's read grant by the rules a
  collection create actually runs, rather than by the code-first config validator.

  The checklist links its step to the Schema Builder, whose create posts to
  `POST /collections` and validates the name with `collectionNameSchema`. That
  schema's verdict is therefore whether the step can be finished, and the
  code-first validator disagreed with it in both directions: it reserves `admin`
  and `dashboard`, which the Builder creates happily, and it allows hyphens, which
  the Builder does not. So a key stamped `read-admin` was refused a step it could
  finish, and one stamped `read-team-updates` was offered a step it could not.

  The predicate now asks `collectionNameSchema` itself rather than restating any
  rule, so a reserved name or a length limit added there reaches the checklist with
  nobody editing a second file. That also brings in two refusals no restatement
  had: SQL keywords such as `select`, and the Builder's own reserved names such as
  `accounts`.

  An app that cold boots only through `createDynamicHandlers` now seeds its preset
  roles as well as its permissions. That path re-seeded permissions on the first
  request but never re-resolved the presets, so an administrator who was not a
  super admin never received a new collection's grants there, however many times
  the app restarted. The two are now one boot operation that both paths call,
  which is the same fix this module already carries for plugin-declared
  permissions.

- [#1736](https://github.com/nextlyhq/nextly/pull/1736) [`e9adb7b`](https://github.com/nextlyhq/nextly/commit/e9adb7b44f0d23c7ef3b288d4a56009da2a54826) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate:fresh` empties the database and rebuilds it. On PostgreSQL it
  asked for the list of tables to drop from a schema called `public`, but the
  `DROP` it then issues names no schema at all, so it goes wherever the
  connection's `search_path` points.

  On an installation that keeps Nextly in its own schema those two disagreed, in
  both directions at once: Nextly's own tables were never listed, so they survived
  the reset — and whatever else happened to be in `public` was listed, and dropped.

  Discovery now asks which tables the drop will actually reach, rather than naming
  a schema at all. Nothing changes for a database that uses `public`, which is the
  default.

- [#1709](https://github.com/nextlyhq/nextly/pull/1709) [`0c9ec43`](https://github.com/nextlyhq/nextly/commit/0c9ec43d265b3e468c31ce0c87deb3b3d84edee6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An editor holding a document confirms its claim every fifteen seconds, and those
  confirmations can overlap: a slow one and the next one are both in flight, and
  their answers can come back in the wrong order. The lease already knew this and
  only ever moves forward. What the same reply says about a colleague waiting for
  the document did not, so a confirmation that left BEFORE anybody asked could land
  after one that already reported the request, and quietly take the notice away
  again until some later beat happened to restore it.

  Only the newest confirmation may now change that notice, on the same rule and for
  the same reason the lease uses.

- [#1737](https://github.com/nextlyhq/nextly/pull/1737) [`81bf0d1`](https://github.com/nextlyhq/nextly/commit/81bf0d16305ebc5f9f7fdd873c65d92b17f739f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Four repairs to the dashboard's onboarding card, and one performance fix behind
  it.

  Declining the offer of demo content now drops the card from the open dashboard.
  Skipping used to change nothing the server could see, so only a successful seed
  refreshed the arrangement; the card's condition reads the decline now, which
  left the one gesture that could strand a placement the server had stopped
  offering — visible in edit mode, and refused on save.

  A step this build cannot name no longer reads as a finished checklist. Dropping
  an unreadable row keeps the card from breaking, and on its own it introduced
  something worse: a newer server reporting an outstanding step under a name this
  build does not know would leave every remaining row complete, so the card
  announced itself finished and asked to be taken down while the server went on
  offering it.

  The checklist follows a schema change. Two of its steps are answered from the
  collection registry, so creating a collection in another tab moved the answer
  without moving the card, which went on asking for a collection that existed.

  One layout read now resolves the reader's collections once. Two conditions ask
  overlapping questions of the same rows, and each was resolving them
  independently — three authorization traversals and two counted reads per
  collection for a single dashboard load.

- [#1742](https://github.com/nextlyhq/nextly/pull/1742) [`73b7cb6`](https://github.com/nextlyhq/nextly/commit/73b7cb60667b1d542e567e180db316ece98da085) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The setup checklist no longer shows a finished list to a reader who still has
  work to do.

  Its answer was held as fresh for five minutes and the card is unmounted whenever
  it is not offered, so the two combined: a reader who completed onboarding and
  then deleted their last collection was offered the card again, and it drew every
  row ticked from the answer the previous visit had left behind. It reads what is
  true now, and will not report completion from anything it did not just fetch.

  Applying schema changes refreshes it too. Two of its steps are answered from the
  collections a schema change moves, and the card's own listener is not mounted at
  the moment that matters — the answer changes precisely while the card is absent.

- [#1751](https://github.com/nextlyhq/nextly/pull/1751) [`dd4027c`](https://github.com/nextlyhq/nextly/commit/dd4027ce091e4fff416763e6adf4bd6cd0679767) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The setup checklist no longer vanishes from a reader who still has a step to do.

  Whether the card was allowed to drop itself was settled by comparing when its
  answer arrived against when it mounted, and a wall clock cannot make that
  comparison. `Date.now()` is deliberately coarsened by browser
  anti-fingerprinting -- to 100ms buckets under Firefox's resistFingerprinting --
  so both readings can land on the same value; and it steps backwards under a
  clock correction, which can place the mount before an answer that genuinely
  predates it. Either one let the card act on the previous visit's completed
  answer and drop itself while a step was still outstanding.

  It now asks the query observer how many answers have arrived since it
  subscribed, a count that can neither collide nor run backwards, and requires
  that answer to have succeeded: a refetch that fails leaves the earlier
  completed answer in place, and a failure to refresh is no longer read as
  progress.

- [#1659](https://github.com/nextlyhq/nextly/pull/1659) [`80db282`](https://github.com/nextlyhq/nextly/commit/80db2825804616d8a01ffef09ddd5b685c9eca92) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Access is decided by one mechanism. The stored per-operation rules are gone.

  Two independent systems answered "may this caller do this", and only one of them
  was configurable. The code-defined `access` on a collection's or Single's own
  config is reached from every transport. The stored rules were a second engine —
  five rule types evaluated against a JSON column — with no way to author them:
  collections had no code, UI or REST surface for the column at all, and a Single
  had only an undocumented REST field. Two evaluators for one question is a
  divergence waiting to be found by whoever hits the gap between them, and the
  half nobody could configure is the half nobody was checking.

  So the second engine is removed rather than reconciled. `AccessControlService`
  and its five evaluators, the `StoredAccessRule` / `CollectionAccessRules` /
  `SingleAccessRules` types, the operation constants that only served them, and
  the `access_rules` column on `dynamic_collections` and `dynamic_singles` all go.
  `AccessOperation` and `ACCESS_OPERATIONS` stay: the RBAC gate is keyed on them.

  Three behaviours change. Two narrow; one WIDENS, and it is the one to read
  before upgrading.

  **Stored rules are no longer enforced.** Any value still in `access_rules` is
  ignored from this release on. For most installations that changes nothing,
  because nothing could write the column: collections had no surface for it at
  all. It DOES change behaviour for an installation that set a Single's rules
  through the undocumented REST field, or wrote the column directly — and the
  widest case is an `owner-only` read. That filter was produced by the stored
  evaluator alone, so a list, count or by-id read that used to return only the
  caller's own rows now returns every row the coarse gate admits for the
  collection. Before upgrading, express any rule you still need as code-defined
  `access` on the collection's or Single's config; that is the only place a rule
  is read now. An installation whose database still holds rules is told so at
  startup, with the tables and row counts, so the case is named rather than
  silently widened.

  An anonymous publish or unpublish is refused outright. It previously fell
  through to a rule-less public default unless an explicit stored `publish` rule
  denied it, so a collection with no rules — which was every collection — let an
  unauthenticated caller move a document into the published state.

  Populating a relationship judges the TARGET COLLECTION for the caller, once per
  expansion rather than once per row, by evaluating that collection's own
  code-defined `access.read` with the same context a direct read of it builds. A
  session caller's rule sees their real roles and effective permissions; a
  scoped API key's rule sees the key's own grants and roles, in the spelling a
  rule reads (`posts:read`) on every path — the translation-worklist read had
  built that caller by hand with the stored spelling. An anonymous reader is
  judged by the target's rule too, as a direct anonymous read of it is, and so
  is an anonymous read of a Single. So a related row is admitted or refused
  with every other row of that target, and a row the caller can read directly
  does not vanish from a relationship pointing at it. What expansion mirrors is
  the target's code-defined rule, and only that: it does not require the
  target's database `read-<target>` grant, for the reason it never did
  (requiring a grant naming a collection the caller never asked for by name
  would empty the relationship for every caller whose grants do not list it).
  So a target that declares no read rule is populated for a caller the direct
  read would refuse on the grant alone; a target whose rule refuses the caller
  is withheld — and decided before any of its rows are queried.

  A new database never gets the `access_rules` column. One that already has it
  keeps it, and every schema entry point reports it rather than dropping it:
  `nextly migrate` refuses and names it (`drops column
'dynamic_collections.access_rules'`), the dev-server reconcile blocks the drop
  and says so, and `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` is how an operator removes
  it. Dropping a column that holds configured rules is their decision, not a
  side effect of upgrading.

  One upgrade is NOT supported and is called out rather than papered over. A
  database old enough to be missing core columns added since — a 0.45-era
  install — reconciles a drop and several adds on one table, which drizzle-kit
  pairs to ask whether the drop is a rename. `pushSchema` builds that resolver
  internally with no way to supply a hints handler, so it throws, the boot
  degrades to its additive-tables-only baseline, and no column alteration lands.
  Such a database should run `nextly migrate` before taking this release.
  `upgrade-sim-045.integration.test.ts` is skipped for that reason, with the fix
  that restores it named in its header.

- [#1713](https://github.com/nextlyhq/nextly/pull/1713) [`91e66a4`](https://github.com/nextlyhq/nextly/commit/91e66a469537bd835408209354fe6da6043b946d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The check for a part name is now available to code outside the engine.

  A block states styles against named parts, and whether a given name is one the
  engine will accept was a question only the engine could answer — the check sat
  inside the package with no way out. Anything else that had to know, a store
  validating a class library on save for instance, had to keep its own copy of the
  rule, and a second copy drifts from the first without anyone noticing: the copy
  accepts a name the compiler then refuses, and the styles simply do not appear.

  There is one answer to that question again, and it is the engine's.

- [#1716](https://github.com/nextlyhq/nextly/pull/1716) [`1862d9e`](https://github.com/nextlyhq/nextly/commit/1862d9eb29737dfbc41175e7d0da4b87bb53821f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Choosing how many versions a collection keeps, and then editing that collection
  in the Builder, silently discarded the retention setting from `ui-schema.json`.
  The create path wrote it and the edit path did not, and the file is updated by
  replacing the whole entity — so the next edit replaced an entity that had the
  setting with one that did not.

  Six places each built that file's entry by hand, and each had forgotten a
  different setting. They now share one projection, and which settings the file
  carries is declared in a single list that the compiler checks: adding a Builder
  setting no longer compiles until somebody has said whether the file carries it.

  Which settings a _component_ may carry is part of that list, because the manifest
  refuses version history, retention, cache revalidation and webhook recording on
  one — a component has no entries of its own, so those belong to whatever embeds
  it. It refuses the key rather than the value, so a shared projection had to leave
  them out rather than send `false`.

  A description is also trimmed in one place now — the settings form both writes
  read from — so the record in the database and the entry in the file can no longer
  disagree about one with spaces around it. Clearing a description still sends the
  value that clears it, which is not the same as saying nothing about the field. And saving a field group's fields before its settings have
  loaded no longer replaces its entry with a nameless one.

- [#1829](https://github.com/nextlyhq/nextly/pull/1829) [`c211fb3`](https://github.com/nextlyhq/nextly/commit/c211fb3b7e0faea435ab1c33137b4ed7211be671) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The signal that retires a cached authorization answer is now stored in the
  database, so every instance sees it. It was a counter held in memory, which
  moved only in the process that handled the change: a second instance neither
  saw the move nor had one of its own, and went on serving what it had cached
  until the entry aged out. On the shared tier that meant a revoked grant could
  outlive its revocation by the whole cache lifetime.

  Cross-instance revocation now takes effect within about a second. Each instance
  reads the shared counter at most once per second rather than once per check, so
  the cost is one small indexed read per second per instance and not one per
  request. The instance that MADE the change applies it immediately.

  Two behaviour changes worth knowing about.

  An invalidation naming one user now retires every in-memory answer rather than
  that user's alone. The counter other instances read carries a number and not a
  user id, so a change they can see cannot be narrower than "something in RBAC
  moved", and keeping the scope locally would mean only the instance that made the
  change applied it narrowly. Refilling is a couple of indexed queries and role
  changes are rare; a stale answer costs a grant the install revoked.

  A batch of permission writes no longer holds back the in-memory tiers. It never
  existed to: what it saves is the unfiltered rewrite of every stored row, and
  that is still deferred to the end of the batch.

  Installations upgraded from an earlier version keep working before they
  reconcile their core tables. The new table arrives through `nextly db:sync`, and
  until it does, every read and write of the counter degrades to the previous
  in-memory behaviour rather than failing the authorization check that asked. The
  degraded state is reported once so an operator can see why cross-instance
  invalidation is not yet in effect.

- [#1844](https://github.com/nextlyhq/nextly/pull/1844) [`4eabbbf`](https://github.com/nextlyhq/nextly/commit/4eabbbf22a1e2df58b6bbb7baebd7561096789b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing a collection entry no longer discards an edit it is not allowed to publish.

  A publish folds the held working draft into the live row and then deletes that draft. The field rules ran when the caller's payload arrived, and for a publish that payload is just the status, so the draft's content reached the row having been judged only when it was saved. Where the publisher was not the author and a rule denied them one of the draft's values, that value was stripped: the rest was published, the pending change was consumed, and the author's edit was gone with no error and nothing left to recover it from.

  The promotion is refused instead, naming each field at its own path, including a field nested inside a group, and the pending change is kept for someone who can write it. Stripping stays the right answer on an ordinary write, where the value is the caller's own input and dropping it costs them nothing they did not already have. Only a value the write would CHANGE refuses it, so a denied field sitting at the value it already holds publishes as it always did.

  The same question is now answered in one place for every publish path. A Single's publish, `publishAllLocales` and a collection's publish each assemble the document they are about to write in their own way, since a collection's also carries components and many-to-many rows, and then hand it to one shared judge.

  A collection field rule is judged on the caller's own authority. An API key carries the grants stamped on the key, and the write paths did not pass them to the field rules, so a rule reading `permissions` was answered from the database roles of whoever owns the key. A correctly scoped key could not write a field it holds the grant for: the value was dropped in silence and the call still reported success.

  The caller's permissions are resolved before the publish transaction opens. The promotion gate runs under the row lock, because a check that runs before the write can disagree with the write, and a permission lookup first issued from in there waits on the pooled connection the transaction is holding: against a small pool the publish hung rather than failed.

  Only the pending change's own values are refused. A value the caller sends with the publish is stripped as it is on any other write, because it is their own input and dropping it costs them nothing they did not already have. The two are told apart because a rule reads its siblings: a caller's value can be allowed when their payload is judged alone and denied once the pending change is folded in, and refusing there would block a publish over the caller's own edit.

  An untouched field is not read as an edit because of how it was stored. A pending change is JSON, so a timestamp reaches the comparison as the ISO string it was serialised to while the live row comes back from the driver as a `Date`; compared as they arrive, every date-bearing field the publisher may not write refused a publish that changed nothing.

  Ownership is decided value by value, not by the container a refusal is reported at. The rules delete a denied component or group whole, so the removal names the container, and its contents can have two authors: a caller who patched one field of it, and the pending change that supplied the rest. Treating the whole subtree as the caller's because they supplied part of it dropped the pending change's siblings and deleted the draft, which is the loss this check exists to prevent one level down.

- [#1853](https://github.com/nextlyhq/nextly/pull/1853) [`1654240`](https://github.com/nextlyhq/nextly/commit/16542400fca8a7dcd0f88f776ce69d16df28f63b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing no longer clears a protected value nobody touched.

  The gate that judges a promotion applied the field rules and then handed their output to the write. The rules DELETE a value the caller may not write, which is the right answer for the caller's own input on an ordinary write and the wrong thing to persist here: a group is one JSON column, so a denied child removed from it was serialised over the whole column and the live value went with it. Measured on a group whose `runbook` only an owner may write, with someone else publishing an edit to an unrelated field: the column came back empty.

  A denied field keeps its LIVE value now. That is what an update means, the caller may not write the field so the field does not change, and it is the answer Payload gives to the same question. One call decides the refusal and returns the document to write, so the document that was judged is the document that lands, and there is no second interpretation of the rules' output to get wrong.

  The rules are asked of the live row as well as of the promoted document. A rule is only ever asked about a key that is present, so a field a pending change removes outright was judged nowhere: absent from the promoted document, and so never in its denied set to begin with.

  Refusal is decided value by value over both sides, and a value the store keeps for itself is not content. A denied component or repeater row carries its own identity and timestamps beside the author's values, and a snapshot's timestamps never match the row's, so counted as content a denied component would refuse every publish.

  A Single's publish keeps refusing a denied value the caller sent, where a collection's now drops it back to live. The difference is deliberate and is about what each write can apply: a collection persists exactly what the gate returns, while a Single's promotion writes from the stored snapshot in another representation, so a correction made in the gate would never reach the row and the forbidden value would go live. Refusing is what that path already did, and it is safe, since nothing denied is allowed to change and the snapshot's own copy therefore already equals live.

  The schema has the final word on what is content. The store's own columns share their names with plausible field names, so a collection that declares a field called `id` or `updatedAt` inside a group means it, and a name list consulted alone would skip an edit to it and let a publisher the rules deny put it live. The declared field names are handed in and the name list is now consulted only for a name the schema does not claim.

- [#1729](https://github.com/nextlyhq/nextly/pull/1729) [`3b4b269`](https://github.com/nextlyhq/nextly/commit/3b4b269ac4953c7cdfa38223d6759cdb45d0bb52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two names each meant two different things depending on which entry point you
  imported from, and nothing at the call site said which had arrived.

  `isFieldGroupType` was a one-argument boolean test on `nextly` and a
  two-argument type guard on `nextly/field-group-type`. The guard keeps the name,
  because it is the one application code writes when rendering a dynamic zone:
  `isFieldGroupType(block, "hero")`. The token test is `isFieldGroupFieldType`,
  which is not a new coinage: `nextly/field-group-type` was already re-exporting
  it under exactly that alias, with a comment explaining that the two predicates
  had to be kept apart. The alias is the real name now, so no entry publishes the
  spelling it was working around.

  `createAdapter` was the database factory on `nextly` and `nextly/database`, and
  the CLI's own on `nextly/cli/utils`. They return different types. The factory
  keeps the name, since it builds the `DrizzleAdapter` an application runs on; the
  CLI's is `createCliAdapter`, returning the small `CLIDatabaseAdapter` that is
  connect, disconnect and a dialect.

  Neither name appears in the docs or any template, so nothing published changes
  for a reader.

  The list of known clashes in the export-contract test is now EMPTY, which is the
  part that lasts. It held these two, recorded rather than fixed because each
  needed the decision `getNextly` needed. With both made, nothing is exempt and
  the next such name fails on the day it appears instead of joining a list.

- [#1708](https://github.com/nextlyhq/nextly/pull/1708) [`aaa8c8c`](https://github.com/nextlyhq/nextly/commit/aaa8c8ce271634b7d0404048cb93b34e096ca3d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Update and delete cannot disagree about who owns a row.

  Both write paths fall back to comparing a fetched row's owner against the
  caller when the SQL owner predicate is absent, and each decided that inline.
  Update knew that a scoped API key is judged on its own stamped grants and so
  does not inherit its owner's super-admin bypass; delete did not. A key owned by
  a super-admin could therefore delete a row it does not own, while the same key
  could not update one.

  The fallback is reachable rather than theoretical: the owner constraint answers
  `null` when a metadata read fails, which leaves the predicate off the fetch and
  this check standing alone.

  `ownerSafetyNetApplies` is the single answer now and both paths ask it. It
  takes the caller's scope rather than a boolean each site derives, so what
  counts as a scoped key is decided once.

- [#1847](https://github.com/nextlyhq/nextly/pull/1847) [`4e91f14`](https://github.com/nextlyhq/nextly/commit/4e91f147a8540ce68cdab064c5717b3263b77f69) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Three corrections to the shared RBAC epoch, all of them a cache that went on
  answering after the answer stopped being true.

  A batch of permission writes defers its shared announcement until the batch
  ends, and the local retirement that goes with it empties the caches the
  permission module holds. An API key's copied grants are not one of those, so a
  key went on answering with revoked grants for the batch's whole length. Every
  cache now asks one predicate about whether a cached answer is still current, and
  a batch holds that predicate closed for its length, so the caches living
  elsewhere are covered by the same act rather than by being remembered.

  A write that reached the shared row but whose read-back failed left the instance
  holding the value from before the write while believing it owed nothing, so
  answers filed under the old value read as current again. An epoch counts as
  trustworthy now only once its value has actually been read back.

  An installation whose epoch row does not exist yet answered with a value every
  such installation shares, so failing over to a different database, or restoring
  a backup taken before the first role change, left cached answers looking
  current. The row is created with an identity of its own on first read instead.

- [#1686](https://github.com/nextlyhq/nextly/pull/1686) [`2b278e7`](https://github.com/nextlyhq/nextly/commit/2b278e7ea0d4453e09b82feab8700ebda9e6ca2a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A `group` or `timeseries` read given a `null` key answered with an unclassified
  500 instead of naming the problem. The validator treated `null` as "no key
  given" while every read that consumes it decides absence with `=== undefined`,
  so the value it excused was still a key by the time it reached the column
  lookup, and the crash arrived through the one input the guard had waved past.
  Both API arguments are required strings, so nothing can mean "absent" by
  writing `null`; it is now refused by name.

  A localized date is refused by ONE rule rather than two. The read path and the
  widget validator each decided separately that a localized field cannot be
  grouped, and the day localized aggregation becomes supported they would have
  disagreed — the read accepting a key the validator still refused, leaving a
  path no author could reach. Both now ask the same leaf, which imports nothing
  so the validator can reach it.

  A widget source declaring a `bucketable` flag that is not a boolean is refused
  when it registers. Query validation rejects only the literal `false`, so the
  string `"false"` — legal in untyped JavaScript and in JSON — advertised a date
  the read then refused, and the widget failed on every load with nothing naming
  the cause.

- [#1793](https://github.com/nextlyhq/nextly/pull/1793) [`985a438`](https://github.com/nextlyhq/nextly/commit/985a43864958499c8c4216458d2ca41d864663bc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `createEntryInTransaction`, `updateEntryInTransaction` and `deleteEntryInTransaction` on the collection service share one tail: collect what the write left for `withTransaction`, then convert a failed envelope. A failed transactional create now carries the collection in its log context and a failed transactional delete now logs a warning, as the update already did. Nothing on the wire changes.

- [#1722](https://github.com/nextlyhq/nextly/pull/1722) [`52c6f1f`](https://github.com/nextlyhq/nextly/commit/52c6f1f9088c107ef2f2126ffd9b29e8e6a05d64) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `reidSubtreeWithMap` is no longer exported. Use `reidForestWithMap([node])`.

  It re-identified a single subtree, and it was a thinner version of the function
  beside it: the forest form takes a policy saying what should happen to DOM ids,
  and the single-root form never accepted one. Anything needing that behaviour had
  to use the forest form anyway, and nothing in the product ever called this.

  The forest form does the same work for one root as for many, so a caller passes
  a list of one and gets the answer it already wanted, with the option this one
  could not offer.

- [#1784](https://github.com/nextlyhq/nextly/pull/1784) [`4a34f1e`](https://github.com/nextlyhq/nextly/commit/4a34f1e5a3ecd6327452a342d194fca6f676820e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - zod is 4.6 now, from 4.1. The MCP server library needs 4.2 or newer, and a
  second copy of zod beside the first would make every schema a stranger to the
  other's `instanceof`; one version everywhere is what lets the coming MCP plugin
  describe its tools in the same language the rest of Nextly describes content.

  One behaviour moved with it. zod's JSON Schema converter now refuses a schema
  whose registrations collide on an `id` rather than emitting a shorter schema,
  which is the corruption the block document emitter already refused; the
  emitter turns that refusal into its own, so a caller still sees one error for
  one reason, and a document checked against a derivation that cannot be made is
  answered rather than thrown at.

- [#1721](https://github.com/nextlyhq/nextly/pull/1721) [`928b982`](https://github.com/nextlyhq/nextly/commit/928b9829b79c0a96e75d97e7f115eb6aa293e51f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On PostgreSQL, Nextly reads a database's current shape to work out what a
  migration should change. Those reads looked in a schema called `public`, while
  every statement Nextly writes is unqualified and lands wherever the connection's
  `search_path` points. On a deployment that uses its own schema — one per tenant,
  or just a house convention — the two disagreed.

  The reads now resolve a table the same way the writes do, quoting the name first
  so one whose spelling carries capitals — which a custom table name may — resolves
  to itself rather than to nothing. Nothing changes for a database that uses
  `public`, which is the default.

  What it fixes on the others: columns that exist read as absent, so a migration
  offered to add what was already there; and where a table of the same name existed
  in `public`, its shape answered for the real one — comparing against a table
  nothing writes to.

- [#1710](https://github.com/nextlyhq/nextly/pull/1710) [`29bc0da`](https://github.com/nextlyhq/nextly/commit/29bc0dafc4bf0f2ef6e82b5462beb0a1aa7147e2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deciding which of two overlapping heartbeats answered most recently was done by
  comparing the time each was sent. That reads the wall clock, and a wall clock can
  go backwards — an NTP correction, a virtual machine resuming, somebody setting the
  time by hand. After a correction, a later heartbeat carries a SMALLER number than
  an earlier one, so the editor holding the document would ignore every subsequent
  answer about a colleague waiting until the clock caught up, which for a large
  correction is minutes or never.

  Which reply is newer is a question about order, not about elapsed time, so it is
  now decided by counting the heartbeats rather than by timing them. How much lease
  is left is still measured with the clock, because that is a duration and only a
  clock can answer it.

- [#1802](https://github.com/nextlyhq/nextly/pull/1802) [`4fbf860`](https://github.com/nextlyhq/nextly/commit/4fbf8608d8ca740783b4c6c2b3348c32ddfa2c3e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection read, a single read and an embedded component read now resolve a
  translatable field through one language chain rather than three private copies
  of the same rule.

  Nothing published changes for a reader: the three copies agreed, and the
  per-request `fallbackLocale` contract — `false` or `"none"` for the requested
  language alone, a named locale to fall back through that locale's own chain,
  otherwise the configured chain under the global `fallback` switch — is exactly
  what each path answered before. What changes is that a future difference in
  how a single and a collection fall back is no longer possible by omission:
  there is one place to change, and the drift the three copies invited is closed.

- [#1685](https://github.com/nextlyhq/nextly/pull/1685) [`f9079d0`](https://github.com/nextlyhq/nextly/commit/f9079d066cf7b14c1bfc539d4618f43f841845d9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The plugin scaffold's own test could time out on a first run.

  `plugin.test.ts` boots a real Nextly instance in `beforeEach`, building a DI
  container, registering the plugin's schema and running auto-sync against a real
  SQLite database. Its vitest config stated no budget, so it inherited the
  defaults: 5 seconds for the case and 10 for the hook, both sized for a unit test
  that touches none of that.

  A boot is about a second and a half on a warm machine, and the first run of a
  freshly scaffolded project is the least warm moment there is: a cold install, no
  build cache, whatever else the laptop or CI container is doing. It is also the
  first command a new plugin author runs, so a timeout there reads as a broken
  scaffold rather than a tight budget.

  Both budgets are now 30 seconds, matching what this repository's own integration
  lane gives a suite that boots.

- [#1724](https://github.com/nextlyhq/nextly/pull/1724) [`c0c8c52`](https://github.com/nextlyhq/nextly/commit/c0c8c520d2af2f538fd0b423c983b95c15c37ea1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Clicking inside a component selects the instance the author placed.

  A component is inlined at render: the instance node is replaced by the tree its
  definition describes, and every element of that tree carries an id re-minted
  during composition — one the page's stored document does not contain. The canvas
  resolved a click to that id and handed it to selection, which could not act on
  it; the drag path happened to bail instead, because its lookup could not find
  the node either.

  The hit-test now asks the ELEMENT whether it is definition-owned, and answers
  with the host instance when it is.

  Asking the element rather than its ancestors is the whole design. An instance's
  SLOT CONTENT belongs to the page and is deliberately unmarked, but it renders
  nested inside the definition's marked box — so walking up finds that box and
  returns the component for a node the author can and should select directly,
  which is exactly the content someone opened the editor to change. The marker is
  per-node rather than a wrapper element so this can be decided without walking.

  The inverse reader answers the same addresses. An instance id names a node that
  renders no element of its own, so chrome measuring the selection is pointed at
  the first element the definition contributed — the outermost one, in document
  order.

- [#1715](https://github.com/nextlyhq/nextly/pull/1715) [`001ad57`](https://github.com/nextlyhq/nextly/commit/001ad576aba2869b8e7157538918ee55351d1c9a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `slugToStaticParam` turns a stored slug into the path segments a route serves.
  Anything that emits a URL for an entry has to agree with the route about that —
  a sitemap, a canonical, a link between entries — so the SEO plugin and the blocks
  renderer both call it rather than re-deriving the rule.

  It was defined inside the content route's module, so an application build that
  bundles rather than externalises `nextly` acquired that whole module graph to get
  one pure string function: the Direct API, the error type, the not-found trigger
  and the content resolver. Measured with esbuild against the source, importing the
  function pulled **1042 modules and 18.4 MB**; from its own module it pulls **2
  modules and 1.4 KB**.

  It now lives in a leaf module that imports only the reserved-path check, and is
  published as its own entry point, `nextly/route-path`. Both halves were needed: a
  leaf module alone changed nothing a consumer could reach, because every published
  spelling still resolved to the built route bundle, which had already inlined the
  function beside its Direct API imports. `@nextlyhq/plugin-sdk/routing` — which is
  how the SEO plugin reaches it — now pulls **5 modules and 1.4 KB in place of 2,471
  and 21.1 MB**.

  Every published spelling still exports the same function, and tests assert they
  are one function rather than several that agree today.

  Its published documentation was also wrong: the generated types carried a
  paragraph about Direct API access defaults, left behind by an unrelated change,
  in place of any description of what the function does.

- [#1703](https://github.com/nextlyhq/nextly/pull/1703) [`7176d47`](https://github.com/nextlyhq/nextly/commit/7176d477c907edce488bd815b0d9c4141318c6fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A second author who opens a document somebody else is editing gets a read-only
  editor and no way to say anything about it. The only thing they can do is take
  the document over, which displaces a colleague mid-sentence — so the polite
  option was to close the tab and hope.

  The lock row can now carry a standing request to edit, and the holder is told
  about it on the heartbeat they were already making. It is a COURTESY and not a
  consent gate: it moves no claim, asks the holder for no answer, and cannot be
  refused. The lease expiring stays the only thing that transfers a document.

  The request is held on a lease of its own, the same length as a claim and
  refreshed on the same beat, because the useful fact is "somebody is waiting
  right now" rather than "somebody once asked". An editor that closed the tab
  stops refreshing it and the mark lapses, so a holder is never nudged on behalf
  of a colleague who has already gone. A claim changing hands clears it outright,
  since a request is about the claim it was made against.

  It rides the claim rather than travelling on a route of its own. The editor that
  is locked out is already asking for the document on every beat — that poll is
  how it learns the holder has left — so the standing "still waiting" is carried
  by a request that was going to be sent anyway, rather than doubling the traffic
  of a read-only tab. Winning the document records nothing, because a caller that
  holds a document is not waiting for one.

- [#1657](https://github.com/nextlyhq/nextly/pull/1657) [`167147a`](https://github.com/nextlyhq/nextly/commit/167147acb291c536f9a3008a076798926a2e2add) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The spacing bands on the canvas could only be read. Every change to a margin or
  a padding had to be made in the Style panel, with the author's attention in one
  place and the space they were judging in another.

  Each band now carries a handle on the edge that moves. Dragging it previews the
  value live and writes the document once, on release, so a gesture of fifty
  pointer moves costs one entry in the history rather than fifty. Shift moves
  every side of the box and Alt moves the pair across from it, each side stepping
  from its own starting value so a deliberate asymmetry survives the gesture.

  The handles are focusable and take the arrow keys, with Page Up and Page Down
  for a coarser step, so everything a drag can do has a keyboard route to the same
  value — the Style panel's fields remain the third. Which side a handle writes is
  resolved from the element's own writing mode and direction, so dragging the left
  edge of a right-to-left block edits the inline END, as the page renders it.

  A side whose value is a token, `auto`, a percentage or any other unit a pixel
  drag cannot preserve refuses to be dragged and says so, rather than silently
  replacing it with the pixels it happens to resolve to today.

- [#1681](https://github.com/nextlyhq/nextly/pull/1681) [`1f254ff`](https://github.com/nextlyhq/nextly/commit/1f254ffc4af6fe8cc04c31ef815005c3348ee08b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Honeypot and rate limiting ran in the form route. The submissions collection
  grants public create on purpose, so a visitor can submit without an account,
  which makes the generic collection create a second public door and the Direct
  API a third. Submissions arriving that way were stored with no rule having
  looked at them.

  Both now run at the write seam every door passes through, and only when a
  request produced the write: a seed, an import or a scheduled job is not
  rate-limited by its own importer. A honeypot hit is still stored flagged rather
  than dropped, so a false positive stays reviewable. A submission over the limit
  is refused, and the form route still answers its own visitor with a success so
  a bot learns nothing from the difference.

  The rate-limit window moved out of a `Map` private to this package and into the
  deployment's own store, the one the REST and auth limiters already share.
  Configure `rateLimit.store` once and all three count together. A private Map
  counts per process: across several, the effective limit becomes the configured
  number times the number of instances, and it fails open under load.

  `cleanupRateLimitStore`, `getRateLimitStoreSize`, `clearRateLimitStore` and
  `isRateLimited` are no longer exported. They existed to manage that Map.

- [#1658](https://github.com/nextlyhq/nextly/pull/1658) [`49dc8e8`](https://github.com/nextlyhq/nextly/commit/49dc8e8034a6dd68ae29d0d658ba8374add9451f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now records which documents embed which components, in a
  `nx_pb_component_usage` collection maintained automatically as pages are saved
  and deleted. Nothing surfaces it yet; it is what will let the library say a
  component is used on N pages, and let deleting one tell you what still embeds
  it instead of quietly breaking those pages.

  It is maintained by the same write-path pass that already keeps the class usage
  index, so a save reads each document once and both indexes derive from that
  read rather than the document being read twice.

  A page too large to read whole records that fact rather than recording nothing,
  because "embeds no components" is the answer that would make deleting one look
  safe.

  Repairing the indexes is now one call, `rebuildPageBuilderUsageIndexes`, which
  takes the document store and both index stores and repairs every index the
  plugin maintains — it names the set itself, so an index added in a later
  version is repaired without a caller having to know it exists.
  `rebuildClassUsageIndex` still works and still repairs the class index alone;
  it is deprecated for one release because that narrowness is exactly the trap —
  a site that upgraded and ran it would have left its component index empty, and
  an empty index reports every component as used nowhere.

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

- [#1805](https://github.com/nextlyhq/nextly/pull/1805) [`f7d0b6a`](https://github.com/nextlyhq/nextly/commit/f7d0b6afe5fb9b8ebc4ee9c8491b6356732319c3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard is arranged from the `md` breakpoint up.

  Below it every card is already full width in one column, so an arrangement is
  a stacked list with little to reorder, and touch drag is where accessibility
  regressions hide. The Edit dashboard control is no longer offered there -- the
  arrangement made on a wider screen applies at every width -- and an edit
  already under way keeps its Save, Cancel and Reset whatever the window is
  narrowed to, so a mid-edit resize never traps the reader. An emptied dashboard
  tells a narrow-screen reader that the way back is a larger screen.

- [#1848](https://github.com/nextlyhq/nextly/pull/1848) [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Model Context Protocol endpoint knows which caller it is serving.

  A plugin route handler is called with the request AND the route context, and the
  endpoint declared only the first. The services facade and the authenticated user
  were therefore discarded before the protocol layer saw them, which cost nothing
  while the endpoint exposed no tools and would have cost a great deal the moment
  one arrived: a tool would have read and written with no user attached.

  The context now travels as itself, scoped to the request. A key's own grants are
  untouched by this, because they already are ambient: the plugin dispatcher runs
  every handler inside the caller scope, so a service call made anywhere in the
  request is judged on the grants stamped on the key rather than on the roles of
  whoever minted it. Repeating that here would have answered one question twice.

  A request whose caller cannot be established is now refused at construction
  rather than served a server built for nobody.

  The endpoint also gains its auth proof matrix, driven through the real
  dispatcher with a real API key: an unauthenticated caller is refused, an
  unverifiable credential is refused, a real key is served, and the address guard
  is shown refusing that same key on a foreign Host and a foreign Origin while
  serving it on the configured site's own. That last pair is the first time the
  guard has been observable at all, because an unauthenticated probe never reaches
  it.

- [#1855](https://github.com/nextlyhq/nextly/pull/1855) [`1b66317`](https://github.com/nextlyhq/nextly/commit/1b66317a4dcbcf830a282c6a1dc8795a59921293) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `get_initial_context`: the first thing an agent should ask a Nextly install.

  An agent arriving at an unfamiliar CMS knows the protocol and nothing about the
  install, and without this it discovers the shape by trial, spending a request
  per guess. One call now answers what it can work with and how this CMS expects
  to be asked. The tool name follows the convention other CMS servers have settled
  on, so a client looking for it finds it where it looks.

  The answer is scoped to the caller. It lists the collections and singles that
  caller may read, taken from core's own access decision rather than from the
  registry, so a key scoped to one corner of an install does not learn the shape
  of the rest. It also reports whether the list is the WHOLE answer: describing an
  install is a positive claim, and a registry that could not be enumerated would
  otherwise be reported as an install with no content.

  The instructions and the data do not mix, and that is a security property rather
  than a style. A tool result is text the model reads, and a model cannot reliably
  tell an instruction the server wrote from one that arrived inside a value. The
  instructions are a constant, and the schema travels beside them as structured
  content, so a collection an attacker can name cannot reach the sentence that
  tells the agent how to behave.

  The package's own descriptions say what it now does. The npm description, the
  root catalogue entry, the README and the admin panel all stated that the plugin
  exposed no tools, which is what somebody evaluating the release would have been
  told about a release that exposes one.

  `readableContent` is published from core and re-exported by
  `@nextlyhq/plugin-sdk`, because a plugin that describes an install needs the
  coarse readable set and composing it from the registry, the caller conversion
  and the per-entity decision is exactly where the dashboard's own version once
  went wrong: it derived the set by filtering permission slugs, which disclosed a
  refused collection on one surface while hiding a code-authorized one on another.

- [#1704](https://github.com/nextlyhq/nextly/pull/1704) [`03bf79b`](https://github.com/nextlyhq/nextly/commit/03bf79be79d6918f55011e5fbe1bcb35d3e95aa9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form builder now serves its own public endpoints. `GET /api/forms`,
  `GET /api/forms/{slug}` and `POST /api/forms/{slug}/submit` answer at exactly
  those addresses, so no caller changes anything, but the plugin that owns the
  collections is the one reading them.

  The core used to serve those three, and named the `forms` and `form-submissions`
  tables in four places while declaring neither. That meant they failed on any
  install that renamed a collection through the plugin's own overrides, and they
  were never reachable at all without the plugin installed, because the tables did
  not exist. Nothing that worked before stops working.

  Spam is now decided before a submission is validated on that route. A bot that
  trips the honeypot while also omitting a required field used to receive a
  validation error, which tells it which of the two it got wrong and stored no
  evidence; it now receives what an accepted submission receives, and the flagged
  row is kept for review. A submission the rate limiter refuses is answered the
  same way rather than as a 429.

  Three response helpers are exported for plugins serving their own HTTP routes:
  `respondList`, `respondDoc` and `respondAction`, joining `respondMutation`. A
  plugin taking over an endpoint has to answer in the body the endpoint already
  answered in, and a hand-built one both drifts from the canonical shape and drops
  the post-commit warnings these carry.

  `trustedClientIp` is exported beside `getTrustedClientIp`, which needed
  settings a plugin cannot read. Exported alone, the resolver was reachable and
  unusable, leaving a plugin to read `x-forwarded-for` itself.

  A plugin route can now say who it acts as and how its timestamps are presented,
  which is what owning a top-level endpoint actually requires. `ServiceOpts` gains
  `as: "public"`, a caller with no session whose collection access rules are still
  enforced; a public route previously had to elevate to `system` to read at all,
  silently overriding a host that had restricted a collection. `PluginRoute` gains
  `formatTimestamps`, so a route answering with collection documents presents
  stored times in the installation's timezone the way the built-in read does.

  The response envelopes and `trustedClientIp` are re-exported through
  `@nextlyhq/plugin-sdk`, which is the surface a plugin author is promised.

  A collection's code-defined `access` rule is now evaluated for a caller with no
  session. The coarse gate resolved roles and permissions from a user id and so
  returned early without one, which meant `access: { create: false }` and
  `read: ({ user }) => !!user` were accepted at boot, recorded, and never asked
  about the one caller they most clearly describe. Only the stored rules ran,
  which live elsewhere and are usually empty, so the declaration was inert while
  looking deliberate. The DB permission check still needs a user and still does
  not run without one.

- [#1755](https://github.com/nextlyhq/nextly/pull/1755) [`8f63701`](https://github.com/nextlyhq/nextly/commit/8f637018bb5db985efb0e19ae220faf1211e83d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The insert panel's placement sentence — "Adds inside …", announced to a
  screen-reader author as the answer to where the next block will land — now
  names the container the way every other surface does. It read the container's
  declared label directly and said "the selected block" when there was none, so
  a container the palette, the layers and the inspector all call "Box" was the
  one place it went unnamed, and a label declared as an empty string produced a
  sentence with nothing after "inside". The name is derived from the same rule
  the palette reads, so the container is called what the author just clicked.

- [#1836](https://github.com/nextlyhq/nextly/pull/1836) [`9cbd6bf`](https://github.com/nextlyhq/nextly/commit/9cbd6bf92c25bfa189edc7c900b75a4b75495567) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The publish gate resolves the caller's permissions before it opens the write transaction, reads the language it is judging, and judges the state the write actually commits.

  Three corrections to the gate that re-judges a Single's pending change at publish. The permission lookup was constructed before the transaction but not performed until the gate asked for it, which was inside the transaction: on a one-connection pool that query waits for the connection the transaction is holding and the publish hangs. It is performed up front now, and the gate is handed the answer.

  A localized Single's live values are on the companion row of the language being published, and the comparison read only the main row, so a translated field the publisher may not write, resubmitted unchanged by a full form, compared against nothing and read as a forbidden edit. The publish was refused although it changed nothing anyone objected to. Both publish paths now overlay the companion values of the language they are judging.

  Publishing every language applies each snapshot to the same main row, so a shared value that a later language overwrites is not the value that lands. The gate judged each language with its own snapshot laid over the combined state, which put those superseded values back and could refuse a publish whose committed document is valid. Only the language's own translations are laid over the final shared state now.

  Both halves of the gate now judge one document: the live row for the language being published, with the pending change and the caller's payload over it. That is the row the write produces, and judging anything else answers for a document that is not being written.

  A field rule reads its siblings, so shown the snapshot alone it can allow a value the committed row must deny: a protected field saved while `kind` was `public` could be published in the same request that sets `kind` to `private`. It cuts the other way too. A shared value one language's pending change edits and a later language's overwrites never reaches the row, and judged snapshot by snapshot that superseded edit refused a publish the write would have committed cleanly.

  Building on the live row also stops a partial translated draft being refused for its own untouched siblings. A save carries only the fields it was given, so a snapshot for a localized Single has no property for the translations it did not touch; judged as a whole document those read as missing, and publishing a one-field fix was refused for a required sibling sitting valid on the companion row.

  The permission lookup is performed only for a Single that can hold a pending change at all. Whether a given write publishes one is not known until its hooks have run and the draft has been read under the row lock, but a Single with no published state or no drafts can never reach the gate, and every authenticated update was paying for the roles and permissions queries to answer a question it would never ask.

- [#1678](https://github.com/nextlyhq/nextly/pull/1678) [`6d0e94f`](https://github.com/nextlyhq/nextly/commit/6d0e94f1f152c4ba4e62b9724ff5f85c961fbe31) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Save as pattern verb now asks whether the author may create a pattern, and
  says so when they may not.

  A role that can update pages but lacks the separately seeded `create` grant on
  the patterns collection was offered the verb on the toolbar, the context menu
  and the command palette. The author filled in the form and the save was refused
  — legibly, and after the work.

  Only the server can answer this. The grant is held against the RESOLVED
  collection, a site may have renamed it, and the browser knows the declared name
  alone; gating on that would refuse an author who holds the grant, hiding a
  feature that works. So the plugin contributes a small authenticated route that
  asks the framework's own `ctx.caller.can`, and the editor reads it once on
  mount, before any of the three surfaces draws.

  The verb is DISABLED WITH A REASON rather than hidden, matching every other
  refusal on that toolbar, and it stays offered while the answer is in flight: a
  wrong "yes" costs the late refusal that already happened, while a wrong "no"
  hides a feature the author holds and nothing on the canvas would explain it.

  Not a security boundary. The write authorizes itself, exactly as before.

- [#1839](https://github.com/nextlyhq/nextly/pull/1839) [`cf1c679`](https://github.com/nextlyhq/nextly/commit/cf1c679d93250c372ccfbc04140616466986c0f6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-seo` now publishes a dashboard data source, `plugin:seo/issues`,
  counting the SEO gaps in the collections it was configured to extend — documents
  missing a meta title, canonical URL, meta description or social image, and
  documents hidden from search engines by `noindex`.

  It is the first plugin to use `contributes.widgetSources`, and it is built
  entirely from `@nextlyhq/plugin-sdk`: nothing it imports is unavailable to a
  third-party plugin, which is what makes it a reference rather than a
  demonstration.

  Every read is scoped to the caller through `callerReadOptions`, so the number
  describes what that reader can see; a collection they cannot read contributes
  zero rather than failing the card. The scan is bounded, and past the bound the
  answer reports a floor rather than a figure that is quietly too small — the
  fields live in a JSON column that a database-side `count` cannot filter on, so
  the rows are read and inspected. It also honours the resolver cancellation
  signal, stopping between pages once the dashboard has given up waiting.

  The checks follow the fields a project actually configured: `seoPlugin({ fields })`
  replaces the default group, so a project storing a `focusKeyword` and nothing else
  is not told every document is missing four things it never asked to store.

  A card can also ask for one kind of issue by name — `where: { issue: { equals:
"Missing meta title" } }` — which gives a per-issue number without needing a
  chart. An operator the source cannot honour is refused rather than answered with
  the unfiltered total.

  A collection the reader may not see contributes zero; anything else that fails —
  a database outage, a failing hook — reaches the card as an error rather than
  being folded into a count that is quietly too small.

  It also draws the card. `@nextlyhq/plugin-seo` contributes an "SEO issues" stats
  widget to the dashboard — one labelled number per issue, so a reader sees that
  eleven pages have no title rather than that the site has twenty-three problems.
  The card is declarative: it names an archetype and a query per cell, the host
  draws it, and none of the plugin's code enters the admin bundle.

  Its cells are computed from the same checks the source counts by, so a project
  that replaced the default fields gets numbers only for what it installed, and one
  whose override leaves nothing to check gets no card rather than an empty frame.

- [#1787](https://github.com/nextlyhq/nextly/pull/1787) [`2a8263a`](https://github.com/nextlyhq/nextly/commit/2a8263a3fa218fb47cc9ba43f1ef5c61ff9f521f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A transaction's `update` is built by the adapter, the way its `insert` already was, so it writes the columns the physical table has rather than the ones the runtime model declares.

  The main UPDATE of every collection entry was a hand-built SQL string in the mutation service, because the typed `tx.update` went through the Drizzle query builder and the builder drops any key naming a column the runtime model does not declare — without a word. One write depends on exactly such a column: the localization transition window, where `localized` has been flipped on a collection, the runtime model has moved its translatable columns to a companion table that does not exist yet, and the default locale must keep writing the physical main table until it does. The transactional INSERT already reached that column because every adapter builds it itself. This is the UPDATE half of the same rule, so the mutation service now makes the same `tx.update` call every other update makes, and the raw statement is gone from product code.

  What changes for a caller of `tx.update`:
  - A column the model declares binds exactly as before — through that column's own encoder, so dates, JSON documents and booleans reach the driver as the bytes the query builder sent. Existing callers see no difference on the wire.
  - A column the model does not declare is written to the physical table, bound the way that adapter's transactional insert binds every value.
  - A key naming no column on the table is a SQL error from the database, where the query builder silently dropped it. This surfaced one: the transaction and batch update path passed `updatedAt` for a dynamic table whose column is `updated_at`, so those writes never bumped the timestamp; they do now.
  - A key whose value is `undefined` is not written — JSON's meaning of an absent key, and what the query builder already did. For the collection entry update this is a change: the raw path bound `undefined` as SQL NULL, so an own `undefined` from a server caller or a hook cleared the column. `null` still clears it.
  - An update that names nothing to write is refused by name (`No values to set`), as the query builder refused it.
  - The pooled `update` is unchanged.

- [#1880](https://github.com/nextlyhq/nextly/pull/1880) [`32d89c2`](https://github.com/nextlyhq/nextly/commit/32d89c2dbbae9e6c9724879a8ff74d5d0622ce4a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly/translation-filter-states` publishes the translation states the translations API accepts (`TRANSLATION_FILTER_STATES` and `TranslationFilterState`) from a module with no server dependencies, so a client can import the list instead of restating it. The admin translation worklist now derives its filter tabs and the state it sends from that list, so a state the server stops accepting can no longer stay on offer and answer with an empty worklist.

- [#1812](https://github.com/nextlyhq/nextly/pull/1812) [`d58455c`](https://github.com/nextlyhq/nextly/commit/d58455c6e7d90cd8c4aac0fd58839632c01c204a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A text widget's markdown and the dashboard's workspace payload close four gaps.

  A link written as a path that a browser would read as another site --
  `/\example.com`, `https:example.com` -- is left on screen as the markdown it
  was written in, instead of becoming a link that leaves the admin in the same
  tab. A numeric character reference past Unicode's range now draws as the
  replacement character however it is escaped (`&\#1114112;`,
  `&#1114112\;`), and a card whose markdown the editor cannot convert for any
  other reason is drawn as the text it was written in rather than left blank.

  The admin reads its workspace payload again whenever the dashboard layout
  reports a different widget audience from the one the payload was built for,
  including on the first dashboard visit after a permission change, where a
  payload cached beforehand used to be kept. The layout read reports the token
  as `audience` and the workspace payload as `widgetAudience`: one token for
  one reader. The workspace payload also ships exactly the generated card
  definitions its permission decision was taken on, even when a concurrent
  request refreshes them in between.

- [#1690](https://github.com/nextlyhq/nextly/pull/1690) [`23d36f3`](https://github.com/nextlyhq/nextly/commit/23d36f3f9c9eb92262bcb08e14e68be515f096d8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder can answer "used on N pages" for a component.

  `componentUsageCount` reads the usage index through a grouped query and counts
  DISTINCT documents. That distinction is the feature rather than an
  implementation detail: the index files a row per field, per locale and per
  stored variant, so a page using one component in two languages while holding a
  pending draft contributes several rows — and a count of rows would report that
  page as several, then climb every time somebody added a translation.

  The answer carries whether it is complete, and it can be short for two
  reasons. A grouped read is capped, so a component used on more pages than the
  cap comes back at the cap. And a document too large to walk whole is recorded
  as a single marker with its references discarded, so it is missing from every
  component's count rather than wrong in one of them — a component embedded only
  there would otherwise read as used by nothing at all. Either way
  `complete: false` says the number is a floor, and the surface decides how to
  say so.

  One reason it is a floor today is worth stating plainly, because it applies to
  every site: the write hooks maintain the index going FORWARD, and nothing yet
  fills it for documents that already existed. So `complete` is false until a
  backfill exists, and a surface shows "at least N" rather than a total. That is
  the honest reading — a component with no rows is indistinguishable from one
  nothing uses, and the flag exists precisely so that difference is not papered
  over. The backfill itself is a separate change.

  `usageCountReader` binds the count to the Direct API. It reads as the system
  because the index denies every access rule it declares, and an untrusted read
  answers an empty set — indistinguishable from a component nothing uses. It
  takes the index collection's slug, so `COMPONENT_USAGE_INDEX_SLUG` is exported
  beside it: the plugin resolves that name from its own context, which
  application code cannot reach, and without the export the only way to call the
  reader would be to spell the collection name as a literal.

  `readUsageIndexHealth` is exported for the same reason. The count REQUIRES the
  health, so publishing one without the other would leave a consumer able to get
  a trustworthy answer only by reproducing private queries or hard-coding the
  object — which is the confident `complete: true` the flag exists to prevent,
  written by hand.

- Updated dependencies [[`da323d5`](https://github.com/nextlyhq/nextly/commit/da323d58366d362dfaadb7a1ab9593dbf98d18b2), [`b87f0d3`](https://github.com/nextlyhq/nextly/commit/b87f0d3d0d6468c17bb9728738a1729b07c74230), [`705926b`](https://github.com/nextlyhq/nextly/commit/705926b091c1e6ab17fd4065d89dfc2d29c094b2), [`4c03302`](https://github.com/nextlyhq/nextly/commit/4c03302fd9a8532e033c2cfb16a878a25408b9d0), [`732da46`](https://github.com/nextlyhq/nextly/commit/732da46718b4e1342ad517d05a276bcfaf45ef8b), [`716adbd`](https://github.com/nextlyhq/nextly/commit/716adbd7b710559b33d9d568f187b310206e6bd5), [`a6ea554`](https://github.com/nextlyhq/nextly/commit/a6ea554476000f65d384a2b169802c637154c96f), [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c), [`fda49c2`](https://github.com/nextlyhq/nextly/commit/fda49c2876a4842ed47d4aa142b5bd6ec7f1eaab), [`2fa4696`](https://github.com/nextlyhq/nextly/commit/2fa4696c3e5becc4fc5fc954cb8d429a7ffe34ba), [`2bcccdd`](https://github.com/nextlyhq/nextly/commit/2bcccddfbb83b9d9e5a57a555cedb321ed4a85c1), [`b25490b`](https://github.com/nextlyhq/nextly/commit/b25490bc4af5bad91bc67a5333ec28295199e211), [`793c9c1`](https://github.com/nextlyhq/nextly/commit/793c9c120dbd3525c6b3be4fcc4cb53059a8891d), [`1bfc12e`](https://github.com/nextlyhq/nextly/commit/1bfc12eb4c3122d6e4984d69195f45061d281e5b), [`6e22e58`](https://github.com/nextlyhq/nextly/commit/6e22e58f389affa7f922afb65cc4db8f3db5d63c), [`48967c8`](https://github.com/nextlyhq/nextly/commit/48967c89417abfe6ad1e474eb7ea476b473274e0), [`cadd25b`](https://github.com/nextlyhq/nextly/commit/cadd25b48744ccc5a2658678b4164776e8c22d69), [`83a2e49`](https://github.com/nextlyhq/nextly/commit/83a2e4925aa0c1de40011bbcce25018ee7b9db72), [`419d5f2`](https://github.com/nextlyhq/nextly/commit/419d5f2b7666b42e3c2b02639835b44257401ff3), [`9893b11`](https://github.com/nextlyhq/nextly/commit/9893b119dbdd3fbc1f171b4ed9cf6146388d94bf), [`89f515b`](https://github.com/nextlyhq/nextly/commit/89f515b0d6a9e12a669a4a02ef173264b439a1e9), [`5aae8fc`](https://github.com/nextlyhq/nextly/commit/5aae8fcf9386e47a94de8974c92a76b5727e0e21), [`c80d0da`](https://github.com/nextlyhq/nextly/commit/c80d0dafd69f9825b75e1a33b97aeb7891575c2e), [`9c8d64d`](https://github.com/nextlyhq/nextly/commit/9c8d64d5e41a85d7cf5c76d4e5b7fc66b3134f7c), [`f6ddafa`](https://github.com/nextlyhq/nextly/commit/f6ddafa0c3ed698309cd9c1f42449955955718d4), [`1ca2733`](https://github.com/nextlyhq/nextly/commit/1ca273325ff393fc3dead74febc678985014e16a), [`dbebaf7`](https://github.com/nextlyhq/nextly/commit/dbebaf7fb786e7a14c1998267662d12b6245c014), [`ab3791d`](https://github.com/nextlyhq/nextly/commit/ab3791d667180008cb83be4ef0acb514b3d2f130), [`5992aab`](https://github.com/nextlyhq/nextly/commit/5992aabbae4e25b1a3a672e883c231f1c79336d7), [`a2cd0f3`](https://github.com/nextlyhq/nextly/commit/a2cd0f30c363c10409d6872d799f832422f567ce), [`39c96f3`](https://github.com/nextlyhq/nextly/commit/39c96f3f1248cb5a56bddf8f4d0ae76d9972d577), [`4de79a2`](https://github.com/nextlyhq/nextly/commit/4de79a2137618d5541d45ee0bec95fe4d7e791a2), [`69b9aa5`](https://github.com/nextlyhq/nextly/commit/69b9aa535d9073c5ab693fdb0a86d09f743276ac), [`113f82c`](https://github.com/nextlyhq/nextly/commit/113f82c827874ebace3f8cb4e2a120d6c695883a), [`348ceb9`](https://github.com/nextlyhq/nextly/commit/348ceb93a51cf8fca0ae55ee5dcbb132baeaa015), [`e700886`](https://github.com/nextlyhq/nextly/commit/e7008868e8b631c7e2ba4bc74b6e166b72d6eb41), [`16efd9c`](https://github.com/nextlyhq/nextly/commit/16efd9cf7383708209c5b8306f73efbac7b246fb), [`08bce33`](https://github.com/nextlyhq/nextly/commit/08bce33d147922909894f2b00e245aae0e54e9f2), [`cde0bd0`](https://github.com/nextlyhq/nextly/commit/cde0bd0b8bf2425c2afe753c4c058060fcfefd9d), [`9ca0cfd`](https://github.com/nextlyhq/nextly/commit/9ca0cfda21f4c3ddb57e970570b3aead8e36af90), [`c52aa59`](https://github.com/nextlyhq/nextly/commit/c52aa5970405a62f3bbd13df67722afa444a9d77), [`10ef8d9`](https://github.com/nextlyhq/nextly/commit/10ef8d95573eebad5bfdd8bd2daebdfb7193f141), [`c5f8fe8`](https://github.com/nextlyhq/nextly/commit/c5f8fe82e43e86e29760a434129b68b524670192), [`9bac152`](https://github.com/nextlyhq/nextly/commit/9bac152475a676d84d360bef7a6f999cbc9986f1), [`dc38f47`](https://github.com/nextlyhq/nextly/commit/dc38f4758422964a2ff34fe5556020d552e4b3dc), [`c293917`](https://github.com/nextlyhq/nextly/commit/c293917acd1e74d5d8722696589c31ba69d90bc2), [`3d60b11`](https://github.com/nextlyhq/nextly/commit/3d60b11362c0faf2b55685ae08a6b3513fb871d7), [`4e25eb2`](https://github.com/nextlyhq/nextly/commit/4e25eb229a30824e620457bdf24ffe527ad716be), [`ebd0b24`](https://github.com/nextlyhq/nextly/commit/ebd0b243cd812d63d5cd5f90aa054f6648e671e8), [`e8e8d78`](https://github.com/nextlyhq/nextly/commit/e8e8d7855ca06ce444c9dfaba4ed23b45a64ceb4), [`adfafa3`](https://github.com/nextlyhq/nextly/commit/adfafa36762a24745b69ca1e14367f310940fbce), [`812f167`](https://github.com/nextlyhq/nextly/commit/812f16767fec5aecb0acf41711ddc1d7047c8e26), [`9ad1744`](https://github.com/nextlyhq/nextly/commit/9ad17448d2176b786041efae68a86d73678bf3b4), [`1532b2e`](https://github.com/nextlyhq/nextly/commit/1532b2e28b095a859c02501c4a4b785b2ac01146), [`cd95546`](https://github.com/nextlyhq/nextly/commit/cd9554690379d1620eded8b7d58107ea43f6a669), [`d29c54d`](https://github.com/nextlyhq/nextly/commit/d29c54daca0076cd0c41192946d2056046c66ac4), [`e1605f8`](https://github.com/nextlyhq/nextly/commit/e1605f8b03c0c4111716d426fe0a125e3f174b2c), [`0d5f838`](https://github.com/nextlyhq/nextly/commit/0d5f838701b6ef77b390fa79eaf985f50b449dca), [`0708ec6`](https://github.com/nextlyhq/nextly/commit/0708ec68cd6785776f073f8e4453ffd95d8ccaca), [`9e59229`](https://github.com/nextlyhq/nextly/commit/9e59229d43ae0a57b2d14bf8c30c651f45bbab52), [`0121364`](https://github.com/nextlyhq/nextly/commit/0121364ce39b6f2780b3500b1a35aff700769af5), [`06f192f`](https://github.com/nextlyhq/nextly/commit/06f192f9b0546085ca3bd700cff0b97fe94206e1), [`2a6f497`](https://github.com/nextlyhq/nextly/commit/2a6f497fe51cb6bc2403bf77b1e929ceeb45b4a0), [`8653c19`](https://github.com/nextlyhq/nextly/commit/8653c19201992cd0243b2927ad017efe1da9a288), [`9c071ae`](https://github.com/nextlyhq/nextly/commit/9c071ae85e64e59942653408215b4ef0f06277ed), [`fe5206e`](https://github.com/nextlyhq/nextly/commit/fe5206ea8f57a9466d20ee4cb28827fcb1011138), [`ea942ba`](https://github.com/nextlyhq/nextly/commit/ea942bacdafeb46e228b88c932ad04a476122c83), [`fe645f1`](https://github.com/nextlyhq/nextly/commit/fe645f17a0492ccc22cb57e0acc11cffaca1ae04), [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c), [`0afa12a`](https://github.com/nextlyhq/nextly/commit/0afa12a3300679a97939f463e82702a721d1b505), [`c284753`](https://github.com/nextlyhq/nextly/commit/c28475395a77f334aa45acc75e8f85c439d8e455), [`aa21dbb`](https://github.com/nextlyhq/nextly/commit/aa21dbbb107406f7b6068add48495780c539da10), [`a8f84fd`](https://github.com/nextlyhq/nextly/commit/a8f84fd40143f450577ee49c8262644cdc10c02c), [`9563aa3`](https://github.com/nextlyhq/nextly/commit/9563aa3ec7fe14b189797ab3227cdb3bd41666f0), [`110d2bc`](https://github.com/nextlyhq/nextly/commit/110d2bcdcfe19e9a846ea6e40abcc52af5611600), [`d95e4d6`](https://github.com/nextlyhq/nextly/commit/d95e4d695fd2678071a8b93c016b8e80199b7229), [`da86960`](https://github.com/nextlyhq/nextly/commit/da869606c5d326aac1b75a50a2324c6e47d39bad), [`075870a`](https://github.com/nextlyhq/nextly/commit/075870acd262c00fa048c63ab9e85568dcede8e7), [`1f4941c`](https://github.com/nextlyhq/nextly/commit/1f4941cb6c84487ee4fc1d554e3fdbda3812dad6), [`6556810`](https://github.com/nextlyhq/nextly/commit/65568108bc06b44df60efa450bdcc3021b39af6d), [`c7b8348`](https://github.com/nextlyhq/nextly/commit/c7b834843e3d3b2aae652cbc6d2f07c104289f4e), [`f3ab090`](https://github.com/nextlyhq/nextly/commit/f3ab09095686af3c7ddf831767d90bfce43276c9), [`44fec3d`](https://github.com/nextlyhq/nextly/commit/44fec3d8d7503652c8faef483587b9af7d5c99cd), [`5702cdc`](https://github.com/nextlyhq/nextly/commit/5702cdc54ef8f97ed319721503ec59a75494818a), [`1bd2187`](https://github.com/nextlyhq/nextly/commit/1bd218792cda7ebb04ef271f1daa1da93041f92b), [`9c2e0e7`](https://github.com/nextlyhq/nextly/commit/9c2e0e7c10dc483b1d29a2675d91c7a9cdbb83a8), [`e9adb7b`](https://github.com/nextlyhq/nextly/commit/e9adb7b44f0d23c7ef3b288d4a56009da2a54826), [`0c9ec43`](https://github.com/nextlyhq/nextly/commit/0c9ec43d265b3e468c31ce0c87deb3b3d84edee6), [`81bf0d1`](https://github.com/nextlyhq/nextly/commit/81bf0d16305ebc5f9f7fdd873c65d92b17f739f4), [`73b7cb6`](https://github.com/nextlyhq/nextly/commit/73b7cb60667b1d542e567e180db316ece98da085), [`dd4027c`](https://github.com/nextlyhq/nextly/commit/dd4027ce091e4fff416763e6adf4bd6cd0679767), [`80db282`](https://github.com/nextlyhq/nextly/commit/80db2825804616d8a01ffef09ddd5b685c9eca92), [`91e66a4`](https://github.com/nextlyhq/nextly/commit/91e66a469537bd835408209354fe6da6043b946d), [`1862d9e`](https://github.com/nextlyhq/nextly/commit/1862d9eb29737dfbc41175e7d0da4b87bb53821f), [`c211fb3`](https://github.com/nextlyhq/nextly/commit/c211fb3b7e0faea435ab1c33137b4ed7211be671), [`4eabbbf`](https://github.com/nextlyhq/nextly/commit/4eabbbf22a1e2df58b6bbb7baebd7561096789b2), [`1654240`](https://github.com/nextlyhq/nextly/commit/16542400fca8a7dcd0f88f776ce69d16df28f63b), [`3b4b269`](https://github.com/nextlyhq/nextly/commit/3b4b269ac4953c7cdfa38223d6759cdb45d0bb52), [`aaa8c8c`](https://github.com/nextlyhq/nextly/commit/aaa8c8ce271634b7d0404048cb93b34e096ca3d5), [`4e91f14`](https://github.com/nextlyhq/nextly/commit/4e91f147a8540ce68cdab064c5717b3263b77f69), [`2b278e7`](https://github.com/nextlyhq/nextly/commit/2b278e7ea0d4453e09b82feab8700ebda9e6ca2a), [`985a438`](https://github.com/nextlyhq/nextly/commit/985a43864958499c8c4216458d2ca41d864663bc), [`52c6f1f`](https://github.com/nextlyhq/nextly/commit/52c6f1f9088c107ef2f2126ffd9b29e8e6a05d64), [`4a34f1e`](https://github.com/nextlyhq/nextly/commit/4a34f1e5a3ecd6327452a342d194fca6f676820e), [`928b982`](https://github.com/nextlyhq/nextly/commit/928b9829b79c0a96e75d97e7f115eb6aa293e51f), [`29bc0da`](https://github.com/nextlyhq/nextly/commit/29bc0dafc4bf0f2ef6e82b5462beb0a1aa7147e2), [`4fbf860`](https://github.com/nextlyhq/nextly/commit/4fbf8608d8ca740783b4c6c2b3348c32ddfa2c3e), [`f9079d0`](https://github.com/nextlyhq/nextly/commit/f9079d066cf7b14c1bfc539d4618f43f841845d9), [`c0c8c52`](https://github.com/nextlyhq/nextly/commit/c0c8c520d2af2f538fd0b423c983b95c15c37ea1), [`001ad57`](https://github.com/nextlyhq/nextly/commit/001ad576aba2869b8e7157538918ee55351d1c9a), [`7176d47`](https://github.com/nextlyhq/nextly/commit/7176d477c907edce488bd815b0d9c4141318c6fa), [`167147a`](https://github.com/nextlyhq/nextly/commit/167147acb291c536f9a3008a076798926a2e2add), [`1f254ff`](https://github.com/nextlyhq/nextly/commit/1f254ffc4af6fe8cc04c31ef815005c3348ee08b), [`49dc8e8`](https://github.com/nextlyhq/nextly/commit/49dc8e8034a6dd68ae29d0d658ba8374add9451f), [`d550908`](https://github.com/nextlyhq/nextly/commit/d55090872d3cb319fcb29bbb4e79ab356ecff963), [`f7d0b6a`](https://github.com/nextlyhq/nextly/commit/f7d0b6afe5fb9b8ebc4ee9c8491b6356732319c3), [`57cd97a`](https://github.com/nextlyhq/nextly/commit/57cd97a4d78d1040962add73fa38a4c057f7dd9c), [`1b66317`](https://github.com/nextlyhq/nextly/commit/1b66317a4dcbcf830a282c6a1dc8795a59921293), [`03bf79b`](https://github.com/nextlyhq/nextly/commit/03bf79be79d6918f55011e5fbe1bcb35d3e95aa9), [`8f63701`](https://github.com/nextlyhq/nextly/commit/8f637018bb5db985efb0e19ae220faf1211e83d4), [`9cbd6bf`](https://github.com/nextlyhq/nextly/commit/9cbd6bf92c25bfa189edc7c900b75a4b75495567), [`6d0e94f`](https://github.com/nextlyhq/nextly/commit/6d0e94f1f152c4ba4e62b9724ff5f85c961fbe31), [`cf1c679`](https://github.com/nextlyhq/nextly/commit/cf1c679d93250c372ccfbc04140616466986c0f6), [`2a8263a`](https://github.com/nextlyhq/nextly/commit/2a8263a3fa218fb47cc9ba43f1ef5c61ff9f521f), [`32d89c2`](https://github.com/nextlyhq/nextly/commit/32d89c2dbbae9e6c9724879a8ff74d5d0622ce4a), [`d58455c`](https://github.com/nextlyhq/nextly/commit/d58455c6e7d90cd8c4aac0fd58839632c01c204a), [`23d36f3`](https://github.com/nextlyhq/nextly/commit/23d36f3f9c9eb92262bcb08e14e68be515f096d8)]:
  - nextly@0.0.2-alpha.66
  - @nextlyhq/plugin-sdk@0.0.2-alpha.66
