# @nextlyhq/builder

## 0.0.2-alpha.64

### Patch Changes

- [#1571](https://github.com/nextlyhq/nextly/pull/1571) [`6a32025`](https://github.com/nextlyhq/nextly/commit/6a32025b0f41e07c60a9ea0a50e704dd35e16abc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` no longer records an edited collection, single or field group as `applied` on the strength of its table existing. Editing an entity leaves its old table in place, so existence proved nothing about the column, status or localization change the registry row was waiting for. A row is now held back while any migration naming it has not been applied, read from the entity header each migration carries and the applied-file ledger. A row no migration names is promoted exactly as before, and migrations whose scope was never recorded are reported by name at the end of the run.

- Updated dependencies [[`6a32025`](https://github.com/nextlyhq/nextly/commit/6a32025b0f41e07c60a9ea0a50e704dd35e16abc)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.64
  - @nextlyhq/blocks-react@0.0.2-alpha.64
  - @nextlyhq/plugin-sdk@0.0.2-alpha.64
  - @nextlyhq/ui@0.0.2-alpha.64

## 0.0.2-alpha.63

### Patch Changes

- [#1480](https://github.com/nextlyhq/nextly/pull/1480) [`cb1b289`](https://github.com/nextlyhq/nextly/commit/cb1b289248e7c4f5727f39f6d3dd7ed8549a6e5b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The bound the public byte route reads under no longer depends on
  configuration at all. It was the largest of a fixed floor, the row's recorded
  size and the configured upload cap — and that last term could shrink: a row
  recording less than it points at served under a raised cap and was refused
  once the cap was lowered past the object, stranding a font already stored.

  The cap states what may be written next, which is not a fact about an object
  already written, so it is no longer an input. What remains describes the
  object: the size every write path records from the bytes it actually wrote,
  and a floor beneath it for rows written before that was true. Nothing an
  administrator can change lowers it.

- [#1495](https://github.com/nextlyhq/nextly/pull/1495) [`94dfbba`](https://github.com/nextlyhq/nextly/commit/94dfbba63ddf1747e5a087d942b5f591485fcc79) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page rendered from a stored stylesheet drew its cards as hard boxes in the
  text colour, with no fill.

  A consumer with no write path compiles a page once, stores the CSS and hands it
  back to the renderer. That artifact still carries every `var(--site-*)` it was
  compiled with, and the renderer withheld the whole site sheet whenever the
  site's breakpoints were not stated — so nothing declared those custom
  properties. An unresolved `var()` makes its declaration invalid at
  computed-value time, which drops each property to its INITIAL value rather than
  the site's: `transparent` for a background, and `currentColor` for a border.

  The withholding guarded the block-default and named-class tiers, which are
  emitted under the at-rules a site's breakpoints imply. It reached the token tier
  as well, which declares `:root { --site-*: ... }` and reads no breakpoints at
  all. Those tiers are now separated, so a page compiled without stated
  breakpoints still receives the declarations its own CSS references, and pages
  that emit no stylesheet still receive nothing.

- [#1483](https://github.com/nextlyhq/nextly/pull/1483) [`9a4bfb5`](https://github.com/nextlyhq/nextly/commit/9a4bfb5feec8a06cdc51ea8c60c8fe5bd7197891) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Your dashboard can show your own content.

  Every collection your project has now offers two cards through the "Add a
  widget" picker: how many entries it holds, and the entries changed most
  recently. They are built from the collections your install actually has, read
  when the page loads -- so a collection you draw in the Schema Builder can be
  added to your dashboard straight away, without a restart.

  They are OFFERED, never placed for you. An install with forty collections would
  otherwise open onto eighty cards you did not ask for, and removing seventy-seven
  of them is not a dashboard. Add the ones you want.

  A card only appears where it can be honest. A collection with no field that names
  its entries gets no "recent" list, because every row would read as an identifier;
  one with no timestamps gets none either, because "recently" would have nothing to
  sort by. And each card carries the same permission that gates the collection, so
  you are only offered cards for content you can read.

- [#1430](https://github.com/nextlyhq/nextly/pull/1430) [`0e9c097`](https://github.com/nextlyhq/nextly/commit/0e9c0976c1fd9913a1c681f9f60bb38fa2ae6878) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The `actions` archetype is drawn by the host, and Phase 1b's plumbing is finished.

  A plugin declares a card of shortcuts with no UI code of its own:

  ```ts
  {
    id: "acme/shortcuts",
    title: "Shortcuts",
    archetype: "actions",
    defaultSize: "sm",
    actions: [
      { label: "New post", href: "/admin/collections/posts/create" },
      { label: "Invite user", href: "/admin/users/create", requiredPermission: "create-users" },
      { label: "Docs", href: "https://nextly.dev/docs", external: true },
    ],
  }
  ```

  `WidgetAction` is exported from `nextly`, `nextly/config` and `@nextlyhq/plugin-sdk`. An `actions` widget must carry a non-empty list and no other archetype may carry one — the same both-directions rule `component` and `query` follow — and each item needs a label and an href, since neither has a sensible default and a blank one is a shortcut that looks broken rather than absent.

  Each shortcut is gated on its OWN `requiredPermission`, separately from the card's. The two answer different questions: the card's decides whether the widget appears, an item's decides whether that shortcut does. A card of five shortcuts where the reader may use two shows two rather than disappearing, and a shortcut to something they cannot do is worse than none — it advertises a capability, costs a click, and answers with a refusal screen. `external: true` opens in a new tab with `noopener` and says so to a screen reader. A card draws at most six and counts the rest rather than dropping them silently.

  This also fixes a bug that would have broken the FIRST queryless archetype to ship. `text` and `actions` take no query, so they never enter the batch and no slot ever arrives — and the outcome resolver read that absence as "drawn from a query, and this widget declares none". Any body registered for one would have failed on every render, permanently. An archetype now declares whether it is drawn from a result or from the declaration, and the two are dispatched differently.

  **Widget components are emitted into the generated import map.** Being pre-bundled by that map is what puts a component in the registry `PluginSlot` reads — the runtime fallback cannot resolve a bare package specifier in a bundled browser — so while widgets were excluded, a `custom` widget drew its card and then nothing inside it, unless the plugin called `registerComponents` itself from its admin entry, which the documented contract never asked it to do. A declarative widget still contributes no path, having no component to carry.

  `PluginWidgetGrid` is deleted. `WidgetGrid` replaced it in the release that introduced it, nothing has mounted it since, and it survived only through its own test.

- [#1513](https://github.com/nextlyhq/nextly/pull/1513) [`b971f66`](https://github.com/nextlyhq/nextly/commit/b971f66ecef7646ff2f25b94df2688111b96f354) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A placement's `column` is refused when it is present and malformed, and a
  dashboard narrowed to fewer columns stores the arrangement the reader is
  looking at.

  `column` was the one placement field with no shape rule, so `column: "2"`
  passed validation, failed the predicate that asks whether a placement stated a
  column, became a 0, and was then read as an OMISSION -- which the layout
  endpoint answers by keeping the column the card already had. A broken client
  was told nothing and had its card silently kept or moved. Present and
  malformed is now refused; omitted stays valid, because a client written
  before columns sends none and that payload is supported.

  Changing the column count moves no card and changes every answer about where
  the cards are: narrowing four columns to two folds two of them into the last,
  so the cards sharing a column are not the ones they were. The save renumbered
  the array it was handed, which stored a reading of a grid that was no longer
  on screen -- the canonical sequence disagreed with the arrangement until the
  next drag. It is now numbered from the buckets at the count in force.

  A collection also offers a TABLE card beside its count and its list: the same
  recent entries drawn across named columns, which is the first consumer of the
  `table` archetype the admin has always been able to draw and nothing has ever
  generated.

  Its columns are asked of the SOURCE rather than assumed. `status` exists only
  for a collection declaring it and the timestamps only for one that has not
  turned them off, so the card selects the ones that are there -- three columns
  for a collection with a status and two without, rather than a fixed shape
  padded with blanks or a select the read path refuses. A collection whose rows
  nothing names, or that has no `updatedAt` to mean "recent", gets no table at
  all, which are the two refusals the list card already makes.

  The dashboard also offers a QUICK CREATE card: one click from the dashboard to
  an empty entry form, for the collections this reader may create in.

  Its shortcuts depend on the reader, which a declaration cannot express -- the
  collection set changes while the process runs, and which of them a caller may
  create in is a second question on top of that. So it is drawn from the
  collection list the server already filtered, narrowed again by the create
  grant. Neither half is a security boundary and the card does not pretend to be
  one: the create endpoint enforces regardless, so a shortcut shown in error
  costs a click rather than an entry nobody was allowed to make.

  The singular label of a collection now has ONE resolver, which the create
  shortcut and the entry form both ask, so a button and the page it opens name
  the entity identically. The two recent-entry cards likewise share ONE
  eligibility decision, so a collection cannot be given a table without its list.

  The shortcut card also waits for both of its requests before speaking. Its two
  queries resolve independently, so a collection list arriving before the
  permission set filtered every row out and the card told the reader they could
  create nothing -- for the whole of that interval, and permanently when either
  request failed. It now says nothing until both have answered, and says nothing
  about an empty set when the page it read was truncated, because "you may create
  nothing" is false rather than incomplete on an install with more collections
  than one page holds.

- [#1567](https://github.com/nextlyhq/nextly/pull/1567) [`035e9fd`](https://github.com/nextlyhq/nextly/commit/035e9fd034d4d2ac6fb61e4aca416a7d67e764f3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a selection as a reusable component now plans the whole operation, and
  converting one replaces the blocks with a linked instance in the same plan.

  A component definition is not only a tree: its exposed properties and slot
  regions are pointers INTO that tree, and saving a selection re-mints every node
  id in it. A pointer carried across unchanged names a node the stored document
  does not contain — a definition that loads, renders, and offers the property in
  the inspector, where editing it writes an override that resolves to nothing.
  Every pointer is now re-aimed through the map the copy produced, and one that
  names a node outside the selection is refused with the reason rather than
  silently dropped.

  The exposure a caller nominates is judged by the same envelope rules that gate
  publishing, published as `componentEnvelopeIssues` so the plan and the gate
  cannot come to disagree. A converted run is refused for anything its ops would
  be refused for — a locked block, an ambiguous id, a container that will not
  take a component instance — while the author still has the selection in front
  of them.

  `PatternTarget` is now `LibraryTarget`: one type for all three library kinds,
  since a pattern, a component and a layout are stored the same way.

  A convert now refuses everything its own ops would be refused for, including a
  malformed node the author never selected and an id duplicated on a descendant of
  what it removes — `remove` rejects the whole subtree in that case, because the
  inverse it records could not put it back. That rule is published as
  `subtreeRemovalRefusal`, alongside the other refusals a planner has to be able
  to ask.

  A nomination naming a node id the selection holds twice is refused rather than
  silently re-aimed at whichever copy came last.

- [#1541](https://github.com/nextlyhq/nextly/pull/1541) [`cd44127`](https://github.com/nextlyhq/nextly/commit/cd44127699efb1ee427c9b5556621083c816e760) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A component being edited previews the edit, not the last published version.

  Draft mode previewed the wrong document. A page reads the components it embeds
  in one batched query, and the working-draft overlay that surfaces an author's
  pending edits is applied only on the single-entry read path — so the batched
  query returned the live row however wide its lifecycle scope, and the editor
  iframe drew the last published component while the form beside it showed the
  edit in progress. The two disagreed about the same document.

  `status: "all"` could not fix that. It widens which rows match; it does not
  reach a working draft, which lives in a snapshot the list path never consults.

  A route serving drafts now reads its definitions one per component, opting into
  the overlay explicitly. That read is deliberately not cached, for the reason the
  draft entry read is not: a working draft changes on every save while cache tags
  are burst by writes to the live row, so a cached draft would show an editor
  their previous save and call it a preview.

  The cost is one query per component instead of one per page, and it is paid only
  where drafts are served — the editor iframe, with one author and no shared cache
  entry to protect. Every other route keeps the single batched read, still tagged
  per component id, and a route that names `status: "published"` keeps it too:
  an explicit lifecycle scope beats the draft widening, in the same order the
  overlay rule itself applies them. A shareable preview link is unchanged and
  still resolves embedded components to their published versions.

- [#1490](https://github.com/nextlyhq/nextly/pull/1490) [`da22b42`](https://github.com/nextlyhq/nextly/commit/da22b429de19dde65b77e85e88620e4f58175fe3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A generated type contributed by a plugin is bracketed before `| null` is added
  to it, and the bracket is placed where a comment cannot reach it.

  A plugin's `codegen.tsType` callback returns an arbitrary type expression. Two
  shapes bind looser than a union and captured it: a conditional attached the
  null to its FALSE branch, leaving the true branch rejecting a value the column
  can return, and a function type attached it to the RETURN rather than to the
  field.

  Bracketing is decided by where the expression came from rather than by
  inspecting it, so no formatting of the expression and no type-level syntax
  added later can change the answer. The closing bracket sits on its own line
  because `//` runs to the end of its line, and an expression ending in a
  comment would otherwise swallow it and leave a file that does not compile.

- [#1516](https://github.com/nextlyhq/nextly/pull/1516) [`163337e`](https://github.com/nextlyhq/nextly/commit/163337ef4aef901d1b66c240469882c2dad16d80) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Copying a block subtree can now keep the links it makes to itself.

  A saved pattern whose button links to `#pricing` further down the same pattern
  used to arrive with the link intact and the target gone: copying assigns fresh
  ids and dropped the HTML `id` attributes, because two copies on one page must
  not answer to the same anchor. The link then resolved to whatever `#pricing`
  the destination page happened to own, or to nothing at all, and only on the
  rendered page.

  Those ids are now given new values instead of being removed — derived from the
  original, so `pricing` becomes something an author still recognises in a URL,
  a stylesheet and the attribute panel — and the copy reports what each one
  became, so whatever holds the reference can follow it.

- [#1558](https://github.com/nextlyhq/nextly/pull/1558) [`d7d924a`](https://github.com/nextlyhq/nextly/commit/d7d924a7a34dc370045115fe57f5c4f4d917d321) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A copied subtree can record where it came from, so "the thing this came from has
  changed — do you want the change?" becomes answerable later.

  `BlockNode.origin` is inert: no renderer reads it, no validator requires it, and
  a document without one is complete. It exists to be read later by a surface
  asking whether an upstream source has moved on — the question every mature
  builder's users ask and none of them answer, because an unsynced copy keeps no
  record of its source. It cannot be added retroactively: a page built before the
  field exists can never be told where its blocks came from, which is why it lands
  while the format is still pre-alpha rather than when the feature that reads it
  is built.

  ONE field with a discriminant, rather than one field per source. A pattern copy
  and a detached component are two provenances today and there will be more — an
  imported document, a duplicated page — and each as its own key is a stored
  format that grows a column per feature. The discriminant also lets the arms
  differ honestly: a pattern copy carries a digest of what it copied, because the
  pattern can change underneath it; a detached component carries none, because
  detaching is the act of declining further change.

  The digest is of CONTENT rather than a version number. The engine is handed a
  document and not an entry row, so it can hash what it was given and cannot see
  what the store calls it — and content answers the question more precisely
  anyway, since a re-save that changed nothing bumps a version and leaves a digest
  alone.

  A half-formed record is refused rather than stored. A pattern origin with no
  digest, an empty id, or a source nobody declared would be written and then read
  by a surface that trusts it, so the op layer checks the shape the way it checks
  every other node field. The record is also removable by an ordinary update:
  provenance is a record and not a lock, and a field an update can never address
  is one that can only be removed by deleting the node it sits on.

  The stored format gains an optional field and nothing else. Old documents remain
  valid, and documents carrying the new field are readable by older code — the
  node schema already admits properties it does not know, and an unknown node
  field is measured to survive an op round trip unchanged. So `formatVersion` does
  not move.

  The provenance type is reachable from every entry point that publishes the field
  that names it. A package that exports `BlockNode` and not the union one of its
  fields holds leaves a consumer able to read the value and unable to write its
  type, which is the coupling those entry points exist to avoid — and the
  renderer package already had a guard saying so, which caught it.

  The import scanner behind the format entry's boundary test no longer reads an
  import out of ordinary code. A module specifier cannot contain a newline, and
  without that constraint the literal `"from"` matched the keyword pattern — the
  string's closing quote read as a specifier's opening one, capturing the next two
  lines and reporting them as an external dependency. Any code holding that string
  would have tripped it.

- [#1469](https://github.com/nextlyhq/nextly/pull/1469) [`ec7cd63`](https://github.com/nextlyhq/nextly/commit/ec7cd63eea740373186d64b973cee0a716037a7c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The class manager could be taken down by one corrupt class.

  `NodeStyles` says states map to breakpoints map to values. A stored document only
  promises to be JSON, and the usability gate admits a class whose `styles` is a plain
  record without walking into it — so a persisted `{ base: { base: null } }` reached
  `Object.keys(null)` and threw. Not one broken row: the whole panel, including the
  rows an author would have used to delete the class that broke it.

  Three shapes reached it, in two different functions — a null state map, a null
  values map under any state, and a null base that got as far as the engine's
  compiler and threw inside it. All three are now guarded with `isPlainRecord`, the
  predicate the page compiler already uses for exactly this, at exactly these two
  levels. The class is still listed, because repairing a corrupt entry is not this
  panel's job and hiding it would take away the only row an author could act on.

  A context that writes no rule is also no longer counted as behaviour. The row said
  "1 more elsewhere" whenever a state or breakpoint held any key at all, including
  keys naming a property the catalog does not define or a value whose grammar it
  refuses — both of which the compiler drops. The count now comes from the compiled
  declarations, so the caveat describes the stylesheet the visitor actually gets.

- [#1494](https://github.com/nextlyhq/nextly/pull/1494) [`9804e9d`](https://github.com/nextlyhq/nextly/commit/9804e9d64b22585db519950c854348ba9fea3974) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A generated create input may omit the publish status, and the lifecycle name is
  reserved against column-less fields too.

  The base artifacts state `status` as required because a read always carries one,
  and the create artifacts are derived from them — so requiring it there made the
  generated type and the generated validator reject an ordinary status-less
  create that the API accepts and stores as a draft. The create artifacts now
  drop it from the omit list and reintroduce it optional.

  A column-less field named `status` — a component, or a many-to-many — was
  accepted by config validation, because the column rules exempt fields that
  occupy no column and returned before the lifecycle check. Such a field keeps
  its declared name as its payload key, so the generated interface and schema
  declared `status` twice and the generated file did not compile. The name is now
  refused before that exemption, matched on the declared name, so a column-less
  `Status` stays a distinct member.

- [#1511](https://github.com/nextlyhq/nextly/pull/1511) [`a853ca4`](https://github.com/nextlyhq/nextly/commit/a853ca4694a70831ec6af073dede9ff750d611f3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard is arranged in COLUMNS the reader chooses, rather than in one
  wrapped twelve-column grid.

  Cards took uneven fractions of twelve, so a card's width depended on its
  neighbours. dnd-kit's sorting strategies predict positions from measured
  rectangles and need a predictable layout; with mixed spans they mispredict and
  the cards visibly resize mid-drag -- the behaviour its own tracker records as
  variable sized sortables being stretched when dragged. Each column is now an
  independent vertical list of equal-width items, which is the case those
  strategies are built for and one that supports items of varying HEIGHT, the
  dimension a dashboard card genuinely varies in.

  A reader picks 2, 3 or 4 columns while editing. Placements gain a `column`
  beside their existing `order`, the stored layout gains a `columnCount`, and the
  schema moves to v2 -- migrating a v1 row on READ rather than refusing it, since
  the reader would otherwise meet their own saved dashboard as an internal error.

  Crossing columns is reachable by CLICK as well as by dragging. WCAG 2.2 SC
  2.5.7 requires a single-pointer route to anything a drag achieves and states
  that a keyboard equivalent does not satisfy it on its own, so the sideways
  controls are what make the new drag permissible rather than a convenience
  beside it.

  Two fixes fall out of the same work. A card that changed only its column
  compared as unchanged, so Save stayed disabled and a sideways move could not be
  persisted at all. And a card whose column falls outside the current count is
  folded into the last column for drawing while KEEPING its stored column, so
  narrowing the dashboard and widening it again returns every card to where the
  reader put it.

- [#1454](https://github.com/nextlyhq/nextly/pull/1454) [`954b1f0`](https://github.com/nextlyhq/nextly/commit/954b1f03121e920e1b0c5b09511cfd5b8e71d3ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A dashboard arrangement now survives a reload.

  `nextly_widget_layout` stores one row per reader: which cards, in which order,
  at which size, and which they have put away. `GET /api/dashboard/layout` returns
  that arrangement resolved against the live registry, and `PUT` replaces it,
  guarded by a version so two tabs cannot silently overwrite each other. A reader
  who has never arranged anything still sees the registry's own order, so nothing
  changes for anybody until they move a card.

  The stored row holds an identity and a position and nothing else. It never
  copies a widget's `requiredPermission`: every question about whether this reader
  may see a card is asked of the live registry on each read, so tightening a
  permission takes effect immediately rather than after the reader next saves.
  A card they may not see is dropped from the response silently -- and carried
  through untouched on the next write, so being unable to see it is not a way to
  lose it.

  Both guards travel on the wire, and a write must echo both. `version` catches a
  second tab that saved first. `scope` catches the other half: the snapshot a
  client holds was shaped by which widgets it could see, and a permission grant
  moves that without touching the row -- so a card that was hidden at read time
  and visible at write time would otherwise be in neither the submission nor the
  carried-through set, and the write would delete it with `version` still
  matching.

- [#1470](https://github.com/nextlyhq/nextly/pull/1470) [`976ae33`](https://github.com/nextlyhq/nextly/commit/976ae3303ef7ef4aebb76ddd73a490fe1677b76c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard arrangement agrees with the grid that draws it.

  Six corrections to how a widget's declaration reaches the stored layout. Two
  plugins contributing the same widget id now resolve to the same one on both
  sides -- the first declared, which is what the grid has always rendered --
  rather than the server placing one plugin's widget while the grid drew another's.
  A contribution using the deprecated `size: "half"` alias is translated to a real
  size when the server builds its default arrangement, instead of storing a
  placement with no geometry under a card the grid was already drawing at half
  width. That translation now has one implementation, in core, which both sides
  ask.

  Removing a card and adding it back restores the height its author declared, not
  only its width. A widget whose component draws nothing collapses its grid cell
  again rather than leaving a blank full-width slot. Cancelling after a save
  failed takes the failure message with it, instead of leaving "your changes are
  still here" on screen after discarding them.

  And a default arrangement is now bounded by the same limit a save is: an install
  declaring more widgets than a single write may carry was answered with a default
  layout the server would refuse, so the reader's first gesture failed and the
  dashboard could not be arranged at all.

  A widget id names one declaration, chosen the same way on both sides. Two
  plugins contributing the same id resolve to the first declared, and a
  declaration the reader may not see no longer passes its id to the next one --
  which had let a second plugin's ungated card render exactly where the first
  plugin's gated one was withheld.

  A declared size or height must be a non-empty string. An empty one was read as
  "unstated" by the server and as "stated" by the grid, so a card was stored at one
  width and drawn at another; a non-string height reached a placement the next
  save would refuse. Both are refused at boot now, where the author can still see
  the mistake, and an unfamiliar value like a newer core's size still passes.

  The default arrangement is bounded by what one save may carry, and the bound is
  applied to what the reader can actually see -- widgets they have no access to no
  longer consume it. Past that limit the picker still lists what is left, says the
  dashboard is full, and refuses the add rather than building an arrangement that
  could never be saved.

- [#1436](https://github.com/nextlyhq/nextly/pull/1436) [`270761c`](https://github.com/nextlyhq/nextly/commit/270761c23811a2b127df645ca7bfeb87cc1c8557) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A divider draws a line, and a spacer takes up space.

  Both blocks rendered nothing an author could see. `core/divider` is an `<hr>`,
  which a user agent draws with an inset 3D border no design system wants and a
  CSS reset removes entirely — so the element was either wrong or invisible
  depending on the host. It now states all four sides itself: three at zero and
  one hairline in the border token, a token because it is a colour and a literal
  would be wrong in whichever of light and dark it was not chosen for.

  `core/spacer` renders an empty `<div>`, which is zero-high with nothing
  declared, so inserting one produced no space and nothing to select. It starts at
  `2rem`. That stays a style rather than becoming a prop — height is per-breakpoint
  in this system — so any breakpoint may override it.

  The population assertion in `base-styles.test.tsx` names both, which is what
  makes a future block that declares a default the compiler silently drops fail
  here rather than in a browser.

- [#1450](https://github.com/nextlyhq/nextly/pull/1450) [`1ca360b`](https://github.com/nextlyhq/nextly/commit/1ca360b9c7565e9944523fab640a7368b6bee25a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A self-hosted font could be uploaded nowhere and served from nowhere. The
  upload allowlist carried no font type, so a `.woff2` was refused before it was
  stored; and a `@font-face` may not name another host, so a font that did reach
  S3, Vercel Blob or UploadThing was unusable at the only address it had.

  `font/woff2` and `font/woff` are now accepted — and only those two, because
  nothing here converts TTF or OTF, which would be stored and sent to every
  visitor at several times the size of the same face with nothing reporting it.

  Stored bytes can now be served from the site's own origin at
  `/api/media/:id/raw`, which the existing media handlers mount. It answers
  without a session, because the browser fetching a font does not have one, and
  what keeps that safe is the type: it serves the publicly servable formats and
  answers 404 — never 403 — for everything else, so it cannot be used to read a
  private file or to ask whether one exists.

  Reading a stored object also stopped being two implementations. The attachment
  path and the new route ask one function, which tries the adapter's own `read`
  and falls back to a bounded fetch of its public URL, refusing over-cap bytes in
  the same words either way. An over-sized error page is no longer reported as an
  over-sized file.

- [#1482](https://github.com/nextlyhq/nextly/pull/1482) [`2cfabb1`](https://github.com/nextlyhq/nextly/commit/2cfabb19a7b326e73ebe750886dc8b66babde54c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An author can add a font file to a site from the fonts panel. Choosing a
  `.woff2` or `.woff` stores it through the media pipeline and declares the
  `@font-face` that loads it, pointing at this site's own byte route — the only
  kind of source the engine accepts, since a face fetched from another server
  hands that server every visitor's IP address before the page can be read.

  The weight and style are asked for rather than guessed from the filename. A
  face declaring the wrong weight loads, matches nothing the author meant, and
  the page renders in the fallback with no error anywhere; the family alone is
  prefilled from the filename, where a wrong guess is visible in a field before
  it is stored.

  The faces a site loads are now grouped by family, each cut named. Adding a
  typeface means adding its regular, its bold and its italic, and a flat list
  repeated the name while saying nothing about which weights the family covers.

  `useUploadMedia` is available to plugin admin components through
  `@nextlyhq/plugin-sdk/admin`. It is the one route a plugin has to put bytes on
  the site, which anything referencing a file — a `@font-face` above all — needs
  before it can point at one.

  The panel's controls are not a form of their own. They are rendered inside the
  entry editor's, and a nested form's submit reaches the editor's handler — so
  pressing Enter in one of these fields started the upload AND saved the page
  entry, committing the document as it stood before the builder opened. Enter now
  adds the font and nothing else.

  An add is refused when the stored style holds a font row this version cannot
  read, naming the row. The section is saved by replacement, so appending to what
  was read would have saved a list that row is missing from — and the save would
  have succeeded, because the list sent is exactly the one the checker approves.

  Web font formats carry the `format()` keyword their `src` entries take, so the
  panel, the upload gate and the public byte route read one table instead of
  three; a descending weight range such as `900 100` is refused, because it is a
  range no specification gives a meaning to — a browser parses and keeps it, so
  what the face then matches is left to the engine.

- [#1464](https://github.com/nextlyhq/nextly/pull/1464) [`c38ac4a`](https://github.com/nextlyhq/nextly/commit/c38ac4aa5ebdc779f87deb2d19b01f1a3e21ac49) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A form block published to a page rendered as a column of labels with nothing
  under them. The fields were there, focusable and submittable, and invisible: a
  browser draws a border and a background on an input, a CSS reset takes both
  away, and the reset the scaffold ships is one. Its submit had the same problem
  from the other direction — a bare button stripped back to plain text, sitting
  on the same page as a button block that is a blue rounded control.

  Form controls now draw a border, a background and padding of their own, so they
  do not depend on the host leaving a browser default alone. The submit wears the
  button block's appearance rather than a second description of it, because a
  form's submit and a button are one control to the person filling it in.

  The colours come from tokens and the spacing does not, which is the split the
  card block already states: a literal colour is wrong in whichever of light and
  dark it was not chosen for, while a literal length is safe in both.

  The control is outlined in a new guaranteed token, `color.border-strong`, and not in
  the existing `color.border`. The hairline is decorative — `#e5e7eb` on `#ffffff` is
  1.24:1 — and a control's border is the only thing telling a person where the field is,
  which WCAG 2.2 SC 1.4.11 requires to clear 3:1. Outlining a field in a divider colour
  is the same invisible control this change exists to fix. `color.border` keeps its
  value and its job; sites inherit the new token automatically and can retune either
  without moving the other, which is the split Material 3 draws between `outline` and
  `outline-variant`.

  The playground now selects its dark tokens with `darkMode: "media"`. The engine
  defaults to writing them under `[data-nx-theme="dark"]`, which a host with a theme
  toggle sets; this app has no toggle and switches theme through
  `prefers-color-scheme`, so the whole dark half of the token set was never applying —
  a control kept `#ffffff` on a `#0a0a0a` page.

- [#1524](https://github.com/nextlyhq/nextly/pull/1524) [`2450aa6`](https://github.com/nextlyhq/nextly/commit/2450aa6a30545c66fee55fd86ec07cff2e128a4f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A block hidden by a visibility condition no longer draws the components inside
  it. The condition already removed that block and everything under it before a
  reader saw the page, but the components in it were still being loaded and
  counted — so a page could be refused for publishing over a component nobody
  could be shown, and a change to that component still made the page rebuild. A
  component held directly by a hidden block was already treated this way; now a
  component held further down is too.

  A component whose stored data cannot be read is described as unreadable rather
  than missing wherever that is reported, so the fix offered is to repair the
  component rather than to publish one that already exists.

  A page with an unrecognised note about a component that failed to load no
  longer takes the whole page down with it.

  The rule holds one level down as well: a hidden block inside a reusable
  component no longer draws the components under it either.

  Two places on a page that use the same component now always agree about it.
  Where a site supplies components itself, one that answered differently the
  second time it was asked could draw in one place and report itself broken in
  the other.

- [#1424](https://github.com/nextlyhq/nextly/pull/1424) [`523e95f`](https://github.com/nextlyhq/nextly/commit/523e95f429fe4f6f16f01d87a44379582626077c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The `list` archetype is drawn by the host. A plugin can declare a list widget with no UI code of its own:

  ```ts
  {
    id: "acme/recent",
    title: "Recent posts",
    archetype: "list",
    defaultSize: "md",
    query: {
      source: "collection:posts",
      op: "list",
      select: ["title", "slug"],
      limit: 5,
    },
  }
  ```

  Which field each row shows is taken from the query's `select`, in order: the first selected field is the row's label, and the second — where there is one — is the muted line beneath it. Derived from `select` rather than declared again, because the author has already said which fields the widget is about and a second declaration could disagree with it; it also means a card cannot display a field it never asked the server for.

  A `list` whose query selects nothing is refused by name in its own card rather than guessed at. Without `select` the rows carry whatever the collection happens to hold, so core would be picking a key out of a document it knows nothing about — and the key it picked would change the day someone added a column.

  A cell that is not printable is left out rather than stringified. A relationship, a repeater or a localized value arrives as an object, and `String(value)` renders "[object Object]", which reads as data rather than as a defect; the row still holds its place so the number of rows matches the number of results. `0` and `false` are printed, since only `null`, `undefined` and blank strings are absences. An empty result says so instead of drawing an empty list, and a card shows at most five rows.

- [#1449](https://github.com/nextlyhq/nextly/pull/1449) [`890d811`](https://github.com/nextlyhq/nextly/commit/890d8113e59c06a625d1ce825472049b298b4f9a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The default storage adapter resolved a file by name three times to read it
  once: to validate the path, to ask for its size, and to pull in its contents.
  A file replaced between the second and the third came back under a cap
  measured on the file it displaced, and one still being appended to was
  buffered whole however small it had been when asked. The read deadline reached
  it not at all, so a storage directory on an unresponsive network mount held a
  read open with nothing left to end it.

  A local read now runs against one open descriptor, counts the bytes as they
  arrive instead of trusting the size reported beforehand, and answers within
  the deadline it advertises — the same bounds the cloud adapters already kept.

- [#1519](https://github.com/nextlyhq/nextly/pull/1519) [`56bfd93`](https://github.com/nextlyhq/nextly/commit/56bfd93ea828a344273b9c9254780cf0ee8bf7d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page could reference a reusable component and nothing would draw it. The
  reference is one node holding a component id, a variant name and a set of
  overrides; what a reader has to render is that component's whole tree, with the
  overrides applied and the page's own slot content in place of the component's
  defaults. Nothing turned the first into the second.

  The blocks engine now resolves them. Every inlined node is identified from the
  instance and the node it came from, so one page produces the same ids on every
  render and two instances of one component never collide — which is what lets
  styles, editor history and React keys go on addressing them. A variant's values
  apply first and the instance's own beat them, and an override can clear a value
  rather than only replace it, so an author can empty a subtitle the component
  fills in.

  A component that cannot be inlined — not published yet, containing itself, or
  nested past the composition limit — costs its own region rather than the page:
  the reference stays where it is, marked with why, and the rest of the page
  renders.

- [#1522](https://github.com/nextlyhq/nextly/pull/1522) [`3d8cb12`](https://github.com/nextlyhq/nextly/commit/3d8cb129507cc5699922d45c1fe9988d6c748d70) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page could reference a reusable component and nothing drew it. The engine
  knew how to replace the reference with the component's own blocks, but no
  reader ran that step — so the renderer, the stylesheet, the page reader and the
  route helper all worked from a document with a hole in it.

  Composition is now a pass of the pipeline every one of those readers already
  shares, so a component resolved for one of them is resolved for all four. It
  runs before migration, so a component authored against an older version of a
  block is brought up to date like any other content rather than handed over as
  stored, and the components themselves are repaired against the same limits the
  page is — an unchecked block inside a component would otherwise reach the page
  through a door the page's own checks had closed.

  A page also reports which components it drew and which it could not, so
  whatever fetched them can keep the page up to date when they change.

  A component that could not be loaded now says so where it sits, instead of
  reading as an unrecognised block. A stored stylesheet is no longer reused once
  composition has added blocks it was never compiled for, which would have left
  every one of them unstyled on a page that looked fine.

  Two limits behaved wrongly at the edges. A component larger than the page's
  size limit was quietly trimmed to fit before anything could object, so the page
  published part of a component with nothing to say the rest was missing; the
  limit is now enforced where it can be reported. And the editor's style
  explanations were computed without the components the page draws, so what an
  author was told about where a value came from described a different page from
  the one in front of them.

  A component that arrived broken — empty, or not a document at all — brought
  down the whole page, including pages that never used it. Such an entry is now
  skipped and the reference it was for is reported as unreadable: the component
  is there and its stored data is corrupt, which is a different thing to fix from
  a component nobody has published.

  Three more repairs at the same seam. A component that arrives as something
  other than a document — an empty object, or a page saved under a component's
  name — used to compose to nothing at all, so its whole region vanished from the
  page with nothing to say why; it is now reported like any other component that
  could not be loaded. A stored page can no longer claim one of its own blocks is
  an unloadable component and have that believed. And a page now prepares only
  the components it actually uses, following one component's reference to
  another, instead of paying for the whole library on every render.

  Three last repairs at the same seam. A page that referenced several components
  it could not find could lose a component it COULD find, depending on the order
  the references happened to appear in. A component stored in a format this
  version does not understand is now reported rather than reshaped and drawn. And
  the renderer and the page reader now agree about what an unloadable component
  is, so the renderer no longer hides a block the reader returns.

  One walk instead of two. Preparing a component and deciding to read one were
  separate passes over the page, and they could disagree — so a component chosen
  by an instance's override, one that survived a definition's own repair, or one
  sitting past a truncated scan was reported as missing even though it had been
  supplied. There is now a single answer, given where the component is actually
  wanted, which also means a page follows a chain of components only as far as it
  can draw it rather than preparing every component the chain names. And a
  component whose stored data cannot be read is now reported as a fault in that
  component, so the message points at it instead of at the page holding it.

- [#1529](https://github.com/nextlyhq/nextly/pull/1529) [`fc42c6c`](https://github.com/nextlyhq/nextly/commit/fc42c6cd714d697567e94ad93a7f2203e4fb1599) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page now loads the components it embeds. Placing a reusable component on a
  page drew nothing on the served site, because nobody was fetching the
  component: the renderer knew how to draw one and was never handed it.

  A page reads every component it references in one query, follows a component
  that holds another as far as a page can draw it, and reads them at the same
  posture as the page itself — so a published page draws published components and
  a draft preview draws drafts. Sites that store components somewhere of their own
  can say where, or supply them directly.

  Publishing one component now rebuilds exactly the pages that embed it, rather
  than every page on the site. The read carries a tag naming that component alone,
  so a page that never used it is left alone.

  A site running several deployments against different databases no longer risks
  one of them serving another's components from a shared cache. A page embedding
  more components than a cache can track is now read in several queries, so every
  component still updates the pages that use it. And a component reference that
  is blank rather than missing no longer takes the whole page down.

  Three more corrections at the same step. A site that raises its block limit
  through its style settings now loads components for the whole page rather than
  the first part of it. A site that supplies components itself is held to the same
  per-page read allowance as one that does not. And a component that cannot be
  found is looked for once rather than once per place it is referenced from,
  which stops a page spending its allowance on the same absent component and
  losing a later one that is really there.

- [#1526](https://github.com/nextlyhq/nextly/pull/1526) [`8a326cd`](https://github.com/nextlyhq/nextly/commit/8a326cddb900bc5055f7cabe901df7cf2c69c190) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page that exactly fills its block limit is no longer refused over where the
  author happened to put a slot. Placing a component into a region of another
  component frees the space the reference itself occupied, and that space was
  only becoming available part-way through drawing — so an otherwise identical
  page could be accepted or refused depending on the order of the blocks around
  the region.

  Two more repairs at the same step. A component whose stored blocks are wider
  than the whole page allows is no longer walked in full before the page is
  refused for being too large. And content a page places into a region of a
  component is no longer loaded when the page has already replaced the region
  around it — the blocks it was going into were never going to be drawn.

- [#1560](https://github.com/nextlyhq/nextly/pull/1560) [`f535b3d`](https://github.com/nextlyhq/nextly/commit/f535b3db7a8a43cfbc640b986f2b84c4c438b593) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An inserted pattern records which pattern it came from, and what that pattern
  looked like at the time.

  Each inserted root carries `origin: { from: "pattern", id, digest }`, so "the
  pattern this section came from has changed — do you want the change?" becomes
  answerable later. It could not be added retroactively: a page built before this
  can never be told where its blocks came from.

  The ROOTS only. The run is what was inserted; a descendant did not come from the
  pattern separately, and marking every node would make an author detaching one
  child look like a second insertion.

  It is OVERWRITTEN, never filled in only where absent. A root can arrive already
  carrying a record from an earlier copy, and leaving that in place would
  attribute the insertion to a pattern it has nothing to do with — worse than no
  record, because a staleness check would then compare against the wrong source
  and answer confidently.

  For the same reason, saving a selection STRIPS any provenance it was already
  carrying, at every depth. A stored pattern's nodes came from the page, not from
  wherever the page's nodes came from, so a pattern saved out of already-inserted
  content would otherwise claim a source it never had.

  The digest is of content rather than a version. The engine is handed a document
  and never an entry row — it can hash what it was given and cannot see what the
  store calls it — and content answers the question more precisely anyway, since a
  re-save that changed nothing bumps a version and leaves a digest alone. It is a
  change hint and not a security boundary: a collision costs one missed notice,
  which is why it is a short hash rather than a cryptographic one.

  Inserting takes the pattern's identity alongside its document, as one value.
  Two arguments could be supplied out of step, and an id belonging to a different
  pattern than the nodes writes provenance that reads as authoritative and is
  wrong.

  The engine's forest rewrite is published. Three of its behaviours are ones a
  caller changing a single field across a stored tree gets wrong — a cycle entry
  dropped rather than kept, a malformed entry passed through, a malformed slot
  preserved — and each was learned here. A planner that wrote its own walk
  inherited none of them; the two that had are now expressed through the shared
  one.

  The digest describes what a copy would CARRY, so a root's own provenance is
  excluded from it. Inserting overwrites that field, and hashing it would make
  clearing an inert record nothing copies report every existing copy as stale. A
  record deeper than a root is hashed, because that one is copied as it stands.
  The exclusion lives inside the digest rather than at the call site, so a later
  staleness check cannot hash different content from the copy it is judging.

  A pattern handed over without an identity is refused rather than given a record
  the op layer rejects. Every non-empty string is a legal id and only the empty
  one is not, which a type cannot say.

  Node ids are excluded from the digest too, for the same reason a root's own
  provenance is: inserting mints every id fresh at every depth, so no stored id
  reaches a copy. Hashing them made an identity-only rewrite of a pattern report
  every existing copy as stale at once.

  The rule inside the digest is now one question asked of each field — does a copy
  carry this, or does inserting regenerate it? A field the copy derives FROM stays
  in: renaming a `cssId` from `pricing` to `plans` changes what every copy renders,
  because the minted replacement is built from the stored value. The walk is
  structure-aware rather than a serializer replacer keyed on the name `id`, which
  would have dropped a prop an author named `id` and an `attributes.id` the copy
  does carry.

  An id reference is hashed as its tokens, because that is how the copier writes
  it back: `"hero   label"` and `"hero label"` name the same two references and
  every copy carries the second, so hashing the spacing reported a change no copy
  can show. Through the copier's own rule, now published, rather than a second
  split that would agree until one of them moved — and only for the
  reference-valued attributes, since whitespace inside an ordinary one is content
  a copy carries exactly.

  An attribute stored under `__proto__` is hashed like any other. Attribute names
  come from persisted JSON, and assigning to that one runs the legacy prototype
  setter instead of creating an own property — so the attribute would have been
  absent from what is hashed while the copier carries it, and editing it would
  have produced the same digest and no upstream-change notice. Written through the
  package's prototype-safe record writer, which exists for exactly this.

  The rules these copiers share are reachable from the package entry. A module's
  `export` keyword makes a symbol importable within the package; a consumer gets
  only what the entry re-exports, and two of these had the first without the
  second — so a surface holding `BlockOrigin` had no way to check one, and a
  surface copying nodes had no way to tokenise an id reference the way the copier
  does. Both are the defect the rules were centralised to prevent: a caller who
  cannot import the answer writes a second one.

  A test now asserts that every function `document.ts` and `tree.ts` export is
  reachable from the entry, asked of the module object rather than of the index
  source, so a re-export that does not resolve cannot pass it.

- [#1557](https://github.com/nextlyhq/nextly/pull/1557) [`d009a1c`](https://github.com/nextlyhq/nextly/commit/d009a1c8e27231cf579df51d38d6379b01c1da61) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A saved pattern can be planned into a page, and every refusal the edit would
  have hit is made before the plan exists rather than thrown while it applies.

  `planInsertPattern` is the inverse of saving one, and the second composition
  planner. It re-identifies the pattern's roots together, so a pattern placed twice
  on one page shares no node id and no DOM id with its other copy, and a reference
  crossing from one root to the next follows the copy rather than pointing back at
  the library. The `"document"` target replaces the page's root forest — a
  full-page pattern IS a page layout, and an empty document can be started from one
  — while leaving the page's own settings alone, so starting from a pattern does
  not repaint the page.

  The refusals are the point. A plan that reports success and then throws when it
  is applied defeats the reason planning is separate from doing, so the planner
  asks everything the op layer will ask and can be asked early: whether each block
  may sit where it is going, through both halves of the shared nesting rule — the
  child naming its permitted parents, and the slot naming what it admits; whether
  the incoming pattern holds a locked block, which cannot be inserted because the
  inverse of an insert is a remove and a remove refuses a locked subtree, so the
  insert could never be undone; whether replacing the page would delete a locked
  block already on it, which is the same rule reached from the other side and a
  different block from the author's point of view, so it says so separately; and
  whether the destination id is one the document holds twice, which the op layer
  refuses because the incoming node would be placed under both.

  A refusal names what it needs. A block that may not sit in a container reports
  the parents it does permit, and a slot that will not have it reports what it
  admits, so a surface can say where the block CAN go instead of only that it
  cannot go here.

  `lockedWithin` is published from the engine. A planner has to be able to ask
  whether a subtree is locked before it builds an insert around it, and a rule the
  op layer keeps to itself is one a planner would have to guess at.

  One rule decides where a block may sit, for every planner and every
  destination. Saving a run lifts it to a document root and inserting a pattern
  puts it at a root or in a slot, and those were two implementations of one
  question — which is how two answers about where a block may live come to
  disagree. The target now says which half of the nesting rule to ask, rather than
  each planner asking in its own way.

  A destination that does not exist is told apart from one that exists twice.
  Counting "not exactly one" sent a stale target — a container that was deleted
  between opening the editor and dropping the pattern — to the sentence about a
  malformed document, which is advice no author can act on. None means aim
  somewhere that exists; more than one means the document itself is wrong.

  The position is checked against the op layer's own rule, asked without applying
  anything, so a negative index or a parent named without its slot is refused
  where a plan is made rather than thrown where it is applied.

  Replacing a document refuses one whose ids are not unique. The replacing target
  removes every root, and a remove refuses an id the document holds twice — its
  own and any inside the subtree it takes with it — so this was a plan that could
  not apply. A positional insert removes nothing and is unaffected, which is why
  the check belongs to the one target rather than to the planner.

  A stored pattern's nodes are checked against the shape rule the insert applies.
  A pattern is persisted, so it can hold a node that type-checks and is still
  structurally invalid — a `version` of zero is the cheap example — and the plan
  reported success while the insert threw on it. Asked of the op layer's own rule
  rather than a copy of it, so the two cannot come to disagree about what a node
  is. The machine caps on depth and size stay with the apply, because they depend
  on limits the plan was never given.

  The shape check judges structure, not caps. Depth and size depend on the limits
  whoever applies passes, so judging them here made a plan refuse a document the
  caller's own apply would accept — the dry run disagreeing with the run it
  predicts, in the direction nobody can debug. It uses the same shape-only limits
  the remove path already uses, and the caps stay where the numbers are known.

  Replacing a document checks the shape of what it removes. That target removes
  every root, and a remove asks the same shape question an insert does, so a page
  holding a malformed node produced a plan that could not apply.

  A pattern that spells one rendered id on two of its own nodes is refused rather
  than placed. Re-identifying does not repair it and is not meant to: two nodes
  sharing an id map to ONE replacement deliberately, because the pair addressed
  one target before and still addresses one after. What that preserves is the
  duplicate, and the copy carries it into a page where an anchor resolves to
  whichever element the browser reaches first and a label names the wrong control.

  A saved pattern that contains a locked block can be inserted. The op layer
  refuses an insert carrying a locked subtree, because its inverse is a remove and
  a remove refuses one, so the insert could never be undone — and taken literally
  that made a supported flow impossible: saving a selection with a locked block
  succeeds, the stored pattern keeps the lock, and the pattern was then insertable
  nowhere. A library row nothing can place is worse than refusing the save or
  dropping the lock without saying so. The nodes now arrive unlocked and an update
  locks them where they landed, so the group ends in the state the pattern
  described and stays undoable: inverses are recorded in undo order, so the unlock
  runs before the remove and the remove never meets a locked node.

  Both stored documents are checked before either is copied. A pattern is
  persisted, so it can hold a value JSON cannot carry — a function reaching props
  from an in-process caller — and cloning it threw a native error rather than the
  refusal this layer promises. It can also be written in a format this version
  cannot edit, which the apply refuses before it looks at anything else.

  Nesting is checked throughout the copied forest rather than only at its roots. A
  pattern's internal placements were legal when it was saved and the rules can
  have moved since, so a pattern saved before a block gained a parent restriction
  would insert and leave the page unpublishable.

  The destination is judged by the apply's own document rule rather than by one
  field of it. Checking the format version closed the case that is easy to imagine
  and left the ones that are not: a page whose kind was written by a newer
  version, or one carrying a value JSON cannot hold, planned successfully and threw
  before the first op was dispatched. Everything the apply asks before it looks at
  an op is now asked where the plan is made.

  Asking it meant naming it: the checks were written inline and are now three
  functions with the questions they answer — is this a record whose fields are safe
  to read, are its values ones an edit can save, and does it say what it is. The
  order between them is unchanged and load-bearing, because each reads something
  the one before it vouched for.

- [#1421](https://github.com/nextlyhq/nextly/pull/1421) [`bdbf505`](https://github.com/nextlyhq/nextly/commit/bdbf5058c6cf3fa6dab1b737124dc2803d56e622) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A plugin can now contribute a dashboard widget WITHOUT shipping any UI code. Declare an `archetype` and the `query` it is drawn from and the host draws the card:

  ```ts
  contributes: {
    admin: {
      widgets: [
        {
          id: "acme/posts",
          title: "Published posts",
          archetype: "metric",
          defaultSize: "sm",
          query: { source: "collection:posts", op: "count" },
        },
      ],
    },
  }
  ```

  `component` was required on every contributed widget until now, which made this whole tier impossible to declare — an author had to name a component core would never resolve. The requirement was honest when it was written: `PluginWidgetGrid` was the only consumer, it rendered `PluginSlot path={widget.component}` and nothing else, so a widget without one drew an empty cell. That contract said the requirement would become conditional "when that grid exists and can draw a widget from its archetype alone". It does now, it draws `metric` from a query, and nothing mounts `PluginWidgetGrid` any more.

  `PluginAdminWidget` is therefore a union of `PluginAdminCustomWidget` (ships a `component`) and `PluginAdminDeclarativeWidget`, which is itself split by whether core needs data: `PluginAdminDataWidget` (`metric`, `table`, `list` — an `archetype` AND a `query`) and `PluginAdminQuerylessWidget` (`text`, `actions` — an archetype and NO query, since the registry validator refuses one on them). All of them are exported from `nextly/config`, alongside `DataWidgetArchetype` and `QuerylessWidgetArchetype`. The classification is derived from `DATA_ARCHETYPES`/`QUERYLESS_ARCHETYPES` in core rather than restated, and a compile-time assertion fails if an archetype is ever added to the vocabulary without being classified — spelling the declarative half as "every archetype but `custom`" is what made `text` and `actions` undeclarable in the first place, while contradicting the registry validator about the same two names. A union rather than making `component` optional, because "either a component, or an archetype and a query" is the actual rule and all-optional fields cannot state it — `{ id }` would type-check as a widget describing no body at all. Both arms still allow `component`, so every existing `{ id, component, size }` declaration compiles unchanged: the union adds a second route rather than constraining the first. A component may accompany a data archetype deliberately, as the fallback body for an archetype this admin release cannot draw yet.

  The archetype renderer table is looked up by OWN property. Accepting an unrecognised archetype means the name is an arbitrary string from a plugin, and a plain object answers for every name on `Object.prototype` too: `archetype: "__proto__"` made the table look like it held a renderer and then threw `body is not a function`, which took down the whole grid because nothing wraps a widget individually — and `"constructor"`, `"toString"` and `"valueOf"` are worse, since they ARE functions, get called with a widget result, and draw a blank error with no message.

  An archetype this version of Nextly does not recognise no longer fails boot. `assertAdminWidgets` runs during plugin resolution, so refusing one would abort the whole install over a single card — and the reachable cause is a plugin built against a newer core. It is accepted, logged with the known vocabulary so a typo is still findable, and the grid reports it by name in that card's own place while the rest of the dashboard stands. This follows what Grafana does with an unknown panel type and what VS Code does with an unrecognised contribution.

  The boot diagnostic for a widget that describes no body now names both routes out, rather than telling authors the grid renders a widget "through its `component` and through nothing else". The unknown-archetype warning is emitted from the boot gate alone: `validatedAdminWidgets` also runs on every `/api/admin-meta` request, which is public and uncached, so warning there would have written a line per anonymous request forever.

  A widget whose archetype this release cannot draw, and which ships no component to draw it instead, no longer has its query put in the batch. Nothing could use the result: the card reports the missing renderer by name, and asking for the data spent an access-checked read and one of the batch's limited slots on a value discarded on arrival, on every mount and every window focus. A component-bearing widget still gets its query, because its component consumes the slot.

  A widget that supplies a `component` must supply a usable one, even when its archetype and query would have carried it anyway. The admin resolver reads that field for truthiness, so `component: "   "` won the archetype fallback and drew a blank card where the archetype's own diagnostic belonged.

  The unknown-archetype warning is emitted once per plugin, widget and archetype. `assertAdminWidgets` runs more than once per boot — `registerServices` calls it through `resolvePlugins` and again on the transformed list, and the CLI does the same — so an unchanged widget was reported at least twice, which reads as two problems.

  Every new author-facing type is exported from the `nextly` root and `@nextlyhq/plugin-sdk` as well as `nextly/config`, so a plugin author can annotate a reusable declaration without importing from a core subpath.

  The plugin documentation now shows both tiers; it previously showed only the component form and listed a declarative query as a future addition. It also states plainly that `metric` is the only archetype the host draws today, so an author does not follow the new example into a permanently failing card.

- [#1473](https://github.com/nextlyhq/nextly/pull/1473) [`56031de`](https://github.com/nextlyhq/nextly/commit/56031de49b5b093b3c896cd6749d90125d8f0882) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The tokens panel refuses to preview a value carrying a `var()`, because a reference
  there resolves against the PANEL's own custom properties rather than the canvas's and
  would draw a colour or a size the published page does not have. It asked that question
  with a regex over the raw text.

  A CSS function token is an identifier immediately followed by `(`, and the identifier
  is read decoded — so `v\61 r(--nx-measure-wide)` is a `var()` to a browser and was not
  one to that regex. It was previewed, resolving against the admin `--nx-*` namespace,
  which resolves in the panel and which no published page emits. The preview was
  confidently wrong rather than merely absent, which is the failure the guard exists to
  prevent.

  `referencesCustomProperty` is a new export from `@nextlyhq/blocks-engine`. It parses
  the value and compares decoded function names, so it also sees a reference nested
  inside a `calc()` or inside a fallback, and it answers "yes" for a value it cannot
  parse — a caller is deciding whether to draw something, and declining to draw a value
  that would not have rendered costs nothing.

  It lives in the engine because the engine owns CSS semantics and already held every
  part. Three modules had answered this question three ways, on purpose: `contrast.ts`
  decodes, `dtcg.ts` reads raw and documents that a var() with an escaped name is then
  read as invalid rather than dynamic, and `css-value.ts` had the parser and the decoder
  but kept the comparison private. A fourth answer written in the panel would have been
  the defect rather than the fix — and the raw reading that is safe in `dtcg` fails in
  the opposite direction here, where unseen means drawn.

- [#1440](https://github.com/nextlyhq/nextly/pull/1440) [`2e9b56d`](https://github.com/nextlyhq/nextly/commit/2e9b56d0d776dda469020d71f200ac1ed253e7cf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing every language no longer discards a translation that was waiting to
  go live.

  A document that exists in one language only — German, say — keeps its other
  translations in a pending state until someone publishes them. Saving English
  text against such a document stores it as a pending edit, and publishing every
  language should carry that edit live along with everything else.

  It did not. The publish loaded the pending edit and folded it into the write,
  then declined to write the translation row, then deleted the edit as though it
  had been applied. The English text became unreachable from every read — the
  public view, the editor's view, and the pending queue alike — while the call
  reported success. Only a version-history snapshot retained it, recoverable by a
  manual restore that nothing prompted anyone to perform.

  Publishing every language deliberately does not invent a translation for a
  language nobody has written; that remains true. An edit an author typed and
  saved is not an invention, so it now lands where it was going, and the document
  reads back with the text that was published. Both collections and Singles were
  affected and both are fixed.

- [#1457](https://github.com/nextlyhq/nextly/pull/1457) [`1f75ca8`](https://github.com/nextlyhq/nextly/commit/1f75ca8067ac7986a4707649e13b3036f27aad0a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A lifecycle-bounded read is bounded to a SET of states, not to one.

  Nothing an author sees changes yet. The vocabulary is still `draft` and
  `published`, every read returns what it returned before, and the whole suite
  passes unchanged — which is the point of doing it this way round.

  What changes is what the read path can EXPRESS. A workflow may call several
  states public, or several states not-public, and an equality can only ever name
  one of them: the rest would vanish from reads with nothing erroring. Phase 1
  refused that case rather than emit a query it could not make correct. The
  predicate now builds a set membership when there is more than one state and
  stays an equality when there is one, so the widening is invisible to every
  workflow that exists today.

  The resolved filter carries WHY its set was chosen rather than leaving each
  consumer to work it out. Deciding whether a due release may widen a read means
  knowing whether the read is public, and four call sites were re-deriving that
  from the values — a second answer to a question the resolver had already
  answered, which disagrees the moment a workflow's public and non-public sets
  are not complements.

  The per-locale filter is widened with it. A translation is dropped when its
  own `_status` falls outside the read's scope, and that test lived in two
  copies plus two SQL builders; a draft translation surviving it is unpublished
  text resolved onto a public row, so the copies are now one function.

  A workflow is validated where it is DECLARED. A state name longer than the
  status column, two states of one name, a workflow with nothing public: each is
  otherwise found at write time, on one dialect, in production — and SQLite is the
  permissive one, so a suite run against it says nothing about the two dialects
  that reject it.

  An EMPTY status set selects nothing rather than breaking the query. A workflow
  whose every state is public leaves the non-public set empty, and an explicit
  draft read of that collection resolves to it; rendered literally that is
  `_status IN ()`, which PostgreSQL and MySQL reject as a syntax error. The read
  then fails with a 500 instead of returning the no rows the caller asked for.

  No collection can name a workflow yet. This change makes the read path able to
  carry one and validates a workflow where it is declared; the option that lets a
  config attach one is deliberately not here, because it reaches write, schema and
  boot paths that still compare against a single word.

- [#1437](https://github.com/nextlyhq/nextly/pull/1437) [`8ff06f9`](https://github.com/nextlyhq/nextly/commit/8ff06f92d61e7a82ebb1513d20e72b5e3f6d28e2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A message the editor raised while its shell was too narrow to draw landed on a
  surface nobody could reach. Below its minimum width the shell puts its whole
  subtree behind `hidden` and `inert` and shows a notice in its place — but
  neither attribute unmounts anything, so a control behind that notice was still
  mounted and still deciding, from the fact that it was mounted, that it could
  speak for itself. It wrote the message inline, into a subtree taken out of paint
  and excluded from the accessibility tree. The queue it should have fallen back
  to was no better: the region that draws it was mounted inside the same wrapper.
  An author who narrowed a window while a class was being created saw the
  narrow-width notice, no message, and left believing the class existed.

  Being mounted is now only half of what "can still be seen" means: the shell
  publishes whether it is the subtree the author is actually using, and the
  decision to speak inline consults it. The notice region moved out of the
  suppressed wrapper and is mounted once, unconditionally, rather than switched
  between the two branches — a live region has to exist before text is put into
  it, and one that remounts whenever the width crosses the threshold is created at
  the exact moment it is needed.

  Declaring the editor's tokens and BEING the editor's root are now separate
  classes. They were one, so a surface mounted outside the root could only resolve
  `--nx-builder-*` by claiming to be a second root, which every selector meaning
  "the editor" would then match.

  The canvas toolbar's `Show empty containers` switch says what it does. A
  container holding no blocks has no height of its own and cannot be seen or
  selected, which is the state the control exists for and the one its label never
  named.

- [#1461](https://github.com/nextlyhq/nextly/pull/1461) [`e60cdae`](https://github.com/nextlyhq/nextly/commit/e60cdaee78bf7d6e2dacea40144a90a8beb6fb8c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Moving a block with the keyboard now explains itself when the move is not
  allowed. Before, a block that could not go where you sent it simply did not
  move, with nothing said — while dragging the same block showed you why and what
  would work instead. The reason reached people using a mouse and nobody else,
  which is backwards: the keyboard route is the one someone uses when they cannot
  drag.

  The wording is the same one a drag shows, so both routes say the same thing. If
  the move fails for a reason the layout rules do not explain, it says only that
  the block did not move rather than inventing a cause. Pressing up on the first
  block is still silent — there is nowhere to go, and saying so on every press
  would be noise.

- [#1423](https://github.com/nextlyhq/nextly/pull/1423) [`35bca3e`](https://github.com/nextlyhq/nextly/commit/35bca3ecfb6e50eb357a9faccf78dd592830a3e8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - "Add to release" is now a document action like any other, and says why when it
  cannot be used.

  It was an untyped `ReactNode` slot on the entry and single forms, filled by a
  component that rendered its own button. That shape decided four things it had
  no business deciding. It was always a toolbar button, always leftmost, and
  could not be moved. It could not be ordered against the built-in actions, so a
  plugin's contribution and the page's had no defined sequence. It could not
  carry a reason, so it returned `null` in three separate places — an author
  without the document's publish grant, or editing a translation, saw nothing at
  all, which is indistinguishable from a site with no releases feature. And its
  width was what pushed Save under the version-history panel, because an
  unplaceable control still changes where the placeable ones sit.

  The page now contributes a DESCRIPTION paired with a handler, and the model
  decides the rest: this belongs in the overflow menu beside Duplicate, because
  scheduling a release is a document-management act rather than a leading one.

  Existence and usability are now different questions. Authority over the
  FEATURE decides whether the action exists — a caller who may not assemble
  releases, or a document type with no publish lifecycle, has nothing worth
  naming. Facts about THIS DOCUMENT decide whether it can be used, and those
  appear disabled with the reason attached rather than vanishing.

  A built-in wins an id collision, and one function decides both the action list
  and the binding map. Splitting them would let the bar draw a built-in verb
  wired to a contribution that lost its collision — Delete, from the model, with
  its danger styling and its permission reason, running somebody else's handler.
  Nothing about that looks wrong on screen.

  The old trigger's hazard is retired rather than restated: it sat inside the
  editor's own `<form>`, where a `<button>` with no `type` defaults to `submit`,
  so opening the dialog once saved the document and published dirty fields before
  anyone had chosen a release. A menu item is not inside the form and runs a
  callback, so the shape cannot recur.

- [#1420](https://github.com/nextlyhq/nextly/pull/1420) [`c2f01c6`](https://github.com/nextlyhq/nextly/commit/c2f01c621750664a4467bb05fa33aee097f5ce93) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Move every language of a document when a scheduled release runs. A release member that names no language means the whole document, but the write took that to mean the default language: a scheduled takedown pulled the main row down and left every translation live, and reported success while doing it — so a page could read as unpublished in the admin while its German version was still being served. A scheduled publish had the mirror problem, putting the document live with its translations still held back.

  The selector is the wildcard locale the i18n layer already defines, and it rides the ordinary write path rather than a second one. That matters more than it sounds: the ordinary path is what authorizes the transition, runs the collection's hooks, folds in any pending working draft and records the outbox event, and a materialiser routed around it would publish different content than the same publish performed by hand. Singles behave the same way, because a release member holds either kind.

  The wildcard moves a publication status and refuses anything else. "Write these values into every language" is a different and far more destructive operation than "move this document's lifecycle across every language" — it would copy one translation's prose over all the others — so a wildcard write that names any other field is rejected rather than narrowed, and says so.

- [#1533](https://github.com/nextlyhq/nextly/pull/1533) [`cd67a66`](https://github.com/nextlyhq/nextly/commit/cd67a66e9b00b1b50f205d68034c19b3419003bf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page picks up a component's scheduled changes at the moment the release goes
  live. The page itself was already refreshing on time; the components inside it
  were not, so a page could keep drawing yesterday's version of a component until
  something unrelated happened to change it.

- [#1465](https://github.com/nextlyhq/nextly/pull/1465) [`677ae93`](https://github.com/nextlyhq/nextly/commit/677ae93c74e5cc4ef1ecffd5baf02bebf5ac9216) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A row of columns laid out a grid and left the gutter at zero, so the one block whose
  whole purpose is side-by-side content rendered its columns touching. Measured on a
  published page: three tracks of 427px with nothing between them. It now has a gutter,
  `1rem` — the same amount `core/gallery` and `core/accordion` already space their
  children by, so three grid containers do not space their children three different ways.

  The value is a length rather than the `space.4` token it names, and that is a
  deliberate limit rather than an oversight. A consumer with no write path compiles the
  stylesheet once, stores it, and hands it back; on that path `PageRenderer` states no
  breakpoints and emits no site sheet, so nothing defines `--site-*` while the stored CSS
  still references it. A token gutter arrives as a `var()` with nothing behind it, which
  is invalid at computed-value time, and the gap falls back to zero — the exact defect
  this change exists to fix. A test now fails if the gutter becomes a token before that
  path defines what it references.

  A page's stored content is untouched, and an author who set their own gap still wins,
  since authored styles outrank a block default.

- [#1554](https://github.com/nextlyhq/nextly/pull/1554) [`2a25b1e`](https://github.com/nextlyhq/nextly/commit/2a25b1ecdfe1dc3c5d91c3690546888be8489536) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A selection can be saved as a pattern, and whether it is one run of siblings is
  now decided in one place.

  `planSaveAsPattern` is the first of the composition planners: it reads a
  document and answers with the library row to create and the ops the page needs,
  writing nothing. Saving a pattern leaves the page exactly as it was — a pattern
  is copied on insert and keeps no link back — so its page ops are empty, and that
  is the whole behavioural difference from converting a selection into a linked
  component. Splitting the decision from the doing is what lets the caller put the
  create and the page edit in one unit of work and roll the create back when the
  edit fails, and it makes a dry run and a real run the same function rather than
  two that agree until one moves.

  The rule about what may be saved — a contiguous run of siblings in one parent
  and slot — moves into the engine and is published from it. The builder had a
  private half of it, which was right while the editor was its only caller and
  stopped being right once planners existed: a planner runs inside a plugin's
  server action, where the builder cannot be imported because it peer-depends on
  React, and the dependency direction is builder to engine, so the engine could
  not have imported a builder-side rule back. One of the two would have had to be
  a second implementation of "do these blocks share a list", and the module that
  held the first one says why that ends badly — it would eventually disagree with
  the toolbar and the keyboard, which act through it. The builder's copy is
  deleted and its multi-block reorder now asks the engine.

  The refusal reports its CAUSE rather than a sentence. Which remedy to offer
  belongs to the verb — moving, saving as a pattern and converting to a component
  are three different things to be told to do instead — so the engine says what it
  observed and each surface phrases it. An id the document does not hold is
  reported separately from blocks that sit in different containers: one is a
  caller out of step with the document and the other is an author who selected
  across a boundary, and a single refusal would have sent both to whichever
  sentence was written first.

  `reidForestWithMap` re-identifies a run of roots as ONE copy. A saved selection
  is several roots, and re-identifying them one at a time is not the same
  operation: each call can only see the subtree it was handed, so a reference that
  crosses from one root to the next finds no entry in that pass's map and is left
  pointing at the element in the page the pattern was saved from. For
  `aria-labelledby` and `aria-describedby` that is a copy that has silently lost
  its accessible name — invisible to everyone not using assistive technology, and
  by the time it is noticed the pattern is on twenty pages. `reidSubtreeWithMap`
  is now this function called with one root, so the singular and the plural cannot
  drift into disagreeing about what a copy is.

  A stored pattern gets fresh ids rather than the page's. It would render
  correctly either way, because insert re-identifies too; storing the page's ids
  would still be wrong, because a node id is how everything here addresses a node
  — styles, locale overlays, the class-usage record, editor history — and two
  stored documents claiming one id leave any index keyed on it unable to say which
  node it describes. Page-scoped settings are not copied: a document background
  and its custom CSS describe the page, not the run, so a pattern carrying them
  would repaint every page it was inserted into.

  A copied subtree's fragment links follow it. `cssId` is not referenced only by
  markup: a link's `href` may be `#pricing`, and the renderer passes a bare
  fragment straight through to the DOM, so a copier that mints a new id for the
  target and leaves the link behind stores an anchor resolving to nothing — the
  same silent breakage as a dangling `aria-labelledby`, one prop over. Composition
  had grown this rule; the copier that saves a pattern was written without it, and
  a later insert cannot repair the result because its own map is keyed by the id
  the save already renamed. The rule now lives in one module that both copiers
  use. It stays narrow — only a whole string of `#` followed by an id THIS copy
  minted is rewritten — so `"#1 bestseller"` is content and a fragment addressing
  something outside the copied run belongs to the page and keeps working.

  Locating a node tolerates a damaged document. A stored slot holding `null`
  instead of an array, or a list with a hole in it, threw out of the search and
  took down every caller — a multi-block reorder and a saved pattern included —
  for a node neither of them had touched. These primitives are documented as
  reading documents nothing has validated, so a broken entry is skipped and the
  answer is about the nodes that were actually asked for.

  Only a field that HOLDS a link target is rewritten, and matching a minted id is
  not enough on its own. `core/heading` declares `text` and `href` as separate
  props, so a heading legitimately reading `#pricing` beside a sibling carrying
  `cssId: "pricing"` was rewritten to `#pricing-<suffix>` — authored content
  changed silently, and then carried into every insertion of the pattern. The
  field name now decides and the value only decides whether there is anything to
  do, with `href` and `url` listed as data the way the id-bearing markup
  attributes already are. A block with a differently-named target leaves a link
  that no longer jumps, which an author can see and repair; the alternative
  changed what a page said without anyone being able to see it.

  The scan bounds WORK rather than depth. A rich-text link inside a list item sits
  ten values down a prop tree, past the old depth cap of eight, so an ordinary
  link in a bulleted list was left pointing at an id that had been re-minted. Any
  fixed depth is arbitrary — rich text nests as deeply as an author nests it —
  while a visit budget bounds a wide tree as well as a deep one and still
  terminates on a value that refers to itself.

  A saved run reads each selected node by its own id. Resolving the run's parent a
  second time and indexing into its slot is not the same operation on a stored
  document nothing validated: two nodes may share an id, and the parent a lookup
  answers with is the first one, not necessarily the one the selection was located
  under. Measured on a document with two parents sharing an id, selecting the
  second parent's children saved the first parent's.

  A run is identified by the nodes it was found at, not by their ids. An id is not
  an identity on a document nothing validated: two parents may share one, so
  comparing parent ids merged two containers and accepted children that were never
  siblings. Worse, two lookups of one id disagree in a way no reader would
  predict, because locating a node checks every root before descending while
  finding one walks each root and its descendants in turn — so a nested node and a
  later top-level node sharing an id resolve differently, and re-resolving stored
  the wrong one. The run now carries the node and the parent it actually reached,
  which removes the second lookup rather than trying to make the two agree.

  A saved run is refused when it could not be a document. Saving lifts the
  selection out of whatever contained it, so the pattern's roots are the selected
  blocks — and a block declaring which parents it may sit in has just lost the only
  one it had. Selecting columns inside a Columns block is the ordinary way to reach
  this, and the planner reported success while the create refused the document. The
  shared nesting rule is consulted before the lift and the refusal names the
  parents the block requires.

  A bound link's fallback follows the copy. A bound `href` keeps its literal in
  `bindings.href.fallback`, which is exactly what renders when the source is empty
  or unresolvable — so a fallback left behind produces a link that works until the
  data does not, which is the one case the fallback exists to cover.

  The prop scan is bounded by the document rather than by a number. Both earlier
  caps were guesses about how large a legitimate prop tree gets, and a document
  past the guess had its links silently left dangling instead of being refused. How
  large a document may be is already decided once, by the document limits, so all
  that a cap was really buying was termination on a value that refers to itself —
  which a path set gives without capping anything.

  `FRAGMENT_REFERENCE_PROPS`, `remapFragmentProps` and `remapFragmentBindings` are
  exported. A rule described as the single source for every copying surface, which
  a consumer cannot import, is a rule they will write again — which is precisely
  how this one came to exist twice.

  The link scan carries its own stack and its own replacement map. Three separate
  bounds had been tried here and each was a guess about how large a valid prop
  tree gets — a depth cap, a visit budget, and then the component-envelope key
  budget applied to opaque prop records the format does not cap at all. Every one
  of them failed in the same direction: a document past the guess had its links
  silently left dangling instead of being refused. Depth and width are properties
  of authored content, and how large a document may be is already decided once by
  the document limits, so the walk now has no limit of its own.

  A recursive walk also could not survive its own input: a few thousand nested
  records is tens of kilobytes, inside the byte limit, and exhausted the call
  stack. The walk is iterative for the same reason the forest walker is.

  Rebuilding through one replacement per source object is what makes a copied
  graph come out a graph. Guarding a cycle by tracking the path terminates but
  leaves the copy holding an edge back to the ORIGINAL object — still carrying the
  id the pass just rewrote — so one graph ends up with two versions of one node.
  The same map preserves structure shared without a cycle, rather than splitting a
  record reached from two places into two copies that can drift apart.

- [#1563](https://github.com/nextlyhq/nextly/pull/1563) [`b33a09d`](https://github.com/nextlyhq/nextly/commit/b33a09dd59e6f3f1454dd574cff782cd9e6799df) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A pattern saved from the page had its DOM ids rewritten. A block whose `cssId`
  an author typed as `hero` was stored as `hero-3ee4a0d4`, and that value is one
  people read and write: it appears in a URL fragment, in a stylesheet and in the
  attribute panel.

  An id is rewritten so that a copy placed BESIDE its original does not emit the
  same HTML `id` twice. That is the only reason for it, and neither saving nor
  inserting was asking whether it applied: a saved run becomes a document of its
  own and is beside nothing, and inserting into a page holding no `hero` renamed
  it regardless.

  Both now rename only what would actually collide. Saving keeps every id;
  inserting keeps the ones its destination does not already hold, and steers
  around the ones it does. Starting a page from a full-page pattern keeps them
  all, because that replaces the page's blocks rather than joining them.

  The rewriting had two further costs. Saving one selection twice produced two
  different documents, so anything fingerprinting a pattern's content reported a
  change nobody made. And the suffixes accumulated: saving, inserting and saving
  the copy back grew the id by nine characters each time round, with no bound.

  One thing this does not do: if a block's id had to be changed when the pattern
  was placed, saving that copy back over the pattern keeps the changed name. Undoing
  it would mean guessing which names were changed from how they look, and a page
  built by a script or an import can legitimately name things the same way — so the
  guess would quietly rewrite an id somebody meant, along with the links to it.

  Saving a selection over an existing pattern is now planned as well, so a
  library does not fill up with `hero-v2` and `hero-v2-final`. It replaces the
  pattern's content and leaves the row's own name and description alone, and it
  brings the run it was saved from back into sync — without it, blocks that had
  just defined a pattern would report themselves out of date against it.

  Saving a selection also now refuses what inserting it would refuse: a block the
  editor could not place, one nested somewhere the rules no longer allow, two
  blocks sharing a single HTML `id`, or a page written in a format this version
  does not accept. Pages are saved forgivingly and the rules move underneath
  them, so each of those could be sitting in a page that renders — and saving one
  produced a library entry that could be seen, could not be placed anywhere, and
  said nothing about why until someone tried.

  A block can name its HTML `id` two ways — the field in the panel and the
  custom-attributes escape hatch beside it — and the page shows only one of them.
  Four places in the codebase worked out which one for themselves, and two got it
  wrong in ways an author would see: a block was refused an id no other block was
  using, and a copied block was renamed to avoid an id that was never on the page.
  There is now one answer, and everything asks it.

- [#1501](https://github.com/nextlyhq/nextly/pull/1501) [`0de476f`](https://github.com/nextlyhq/nextly/commit/0de476fd4ed7cfccc25b93036423ab41887b83de) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A scaffolded app builds its absolute URLs from the origin it is actually served
  on. The templates hardcoded `http://localhost:3000` in five places, so anyone
  running on another port — or running when 3000 is taken, which moves Next to a
  different port on its own — got pages that render while every canonical link,
  Open Graph tag, sitemap entry and RSS URL points at nothing. The port is not
  knowable when the project is generated and is knowable at runtime, so the
  derivation moved into the app.

  The base template also documented `NEXT_PUBLIC_APP_URL` while its layout read
  `NEXT_PUBLIC_SITE_URL`, so setting the only URL variable a new project was given
  changed nothing a reader would ever see. Both are now documented with what each
  one is for — the app's own origin, which the backend uses for emails and preview
  links, and the public site's origin, used for metadata — and the public one
  falls back to the app's rather than to localhost.

  The five copies of that expression are now one module, `src/lib/site-url.ts`,
  which every template inherits.

- [#1476](https://github.com/nextlyhq/nextly/pull/1476) [`e8ee9d5`](https://github.com/nextlyhq/nextly/commit/e8ee9d5bffcdf1f753c1b0ee5641263be326ae52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The bound the public byte route reads under only ever grows now, because
  each of its inputs is unreliable in a different direction. A row written
  before the stored size was taken from the validated bytes can understate
  what it points at, and an installation that lowers `security.limits.fileSize`
  moves the configured cap below objects it accepted earlier. With both true at
  once, every number derived from present state sits under the real object and a
  font stored legitimately stops being served, permanently.

  Keeping the route's long-standing default as a floor is what closes that: it
  is not derived from present state, so no configuration change and no
  mis-recorded row can push the bound below what was servable before.

- [#1568](https://github.com/nextlyhq/nextly/pull/1568) [`644cd82`](https://github.com/nextlyhq/nextly/commit/644cd82f77d43c6e28937bf5100254313505ed6a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A link inside a component pointed at nothing once the component was composed.

  A node can spell an HTML id two ways — the modelled `cssId` and the `attributes`
  escape hatch — and it renders at most one of them: `cssId` shadows the bag.
  Composition was scoping both spellings independently, so a shadowed value got a
  per-instance id minted for it as well. That value is what the reference table is
  keyed on, so every `aria-describedby`, `<label for>` and `#fragment` naming it
  was rewritten to point at an id nothing renders.

  Shadowed ids are usually shadowed for a reason: a definition referring to one
  was referring to an element in the HOST page, where it resolved. Composition was
  breaking exactly those references, which is strictly worse than leaving them
  alone.

  Only the id a node actually renders is scoped now, through the same published
  rule the pattern copier uses. Two spellings carrying one value still move
  together to one replacement, so a document that spelled its id both ways keeps
  answering to a single address.

  The bag is also measured before the rendered id is derived from it. The rule
  mirrors the renderer, so it accepts shapes the rewrite refuses and reads every
  key to do so — which on a malformed definition published a mapping for an id
  that then stayed on the element, and did the reading unbounded once per
  instance.

- [#1530](https://github.com/nextlyhq/nextly/pull/1530) [`cabf1ba`](https://github.com/nextlyhq/nextly/commit/cabf1ba5fbc3bd4abe8c417467d933af053044c4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page's title, description and link preview now come from the same page a
  visitor sees. When a heading or an image lived inside a reusable component, the
  page showed it and the metadata did not — so a search result or a shared link
  described the page as though that content were not there, on exactly the pages
  built out of components.

- [#1518](https://github.com/nextlyhq/nextly/pull/1518) [`012c59f`](https://github.com/nextlyhq/nextly/commit/012c59f918cc0b1a779a412b790dd91eb280172d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A widget source can now be answered by a DOMAIN SERVICE rather than compiled to
  a collection query, which is what the `system:` source kind has reserved
  vocabulary for since it was declared.

  Almost everything Nextly knows lives outside the collection tables -- a release
  is not a row in one, a translation gap is a relationship between rows -- and
  each is governed by a service that already decides who may see it. So a system
  source hands the question to that service WITH the caller and adds nothing: no
  `where` clause of its own, and no second copy of an authorization rule it
  cannot see.

  `registerSystemSource` publishes the source and its resolver together, because
  a source registered without one is discoverable, validates, and fails only when
  a reader puts the card on their dashboard. It accepts only a `system:` source:
  the resolver store is keyed by id, and an entry under a collection id would
  answer a question the access-controlled Direct API is meant to answer. A system
  source nothing answers is refused exactly as a source that does not exist, since
  a distinct message would confirm it is real.

  `POST /api/dashboard/query` admits these sources, which is what makes the kind
  reachable at all. It takes no read decision of its own for one: a system
  source's rows are not an entity the permission table names, and the service that
  owns them authorizes the same caller, so a check invented at the endpoint would
  be a coarser second copy of a rule it cannot see. Collection sources are
  unchanged, and every other kind is still refused.

- [#1443](https://github.com/nextlyhq/nextly/pull/1443) [`55bf5d1`](https://github.com/nextlyhq/nextly/commit/55bf5d1ac4985e9a418bef297a6c02365691b3da) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A content state now declares whether it is public, and the read path asks.

  Nothing an author sees changes. The vocabulary is still `draft` and `published`,
  the default workflow declares exactly those two, and every read returns what it
  returned before — which is the point of doing it this way round.

  What changes is where the answer comes from. The auto-filter that decides what
  an untrusted caller may see no longer compares against the literal `"published"`;
  it asks the workflow which of its states are public. Admitting a third state
  later is then a change to one file rather than to every reader.

  A state the workflow does not declare answers NOT public. A row can carry a
  state a later edit removed, and the only safe reading of "nobody has decided
  about this" is that it is not published — absence of a decision is not
  permission.

  The release-aware read paths ask the same question. A due release publishes into
  whatever state the workflow calls public, so the four places that recognised the
  word `published` — the SQL condition, both collection read paths and Singles —
  now ask whether the state IS public. Under the default workflow they take exactly
  the branch they took before; under a workflow that renames its public state they
  keep revealing scheduled publications and keep applying scheduled withdrawals,
  where a literal would have skipped both and shown a query that returns rows and
  looks like it worked.

  The single-public-state assertion is deliberate. A workflow with two public
  states needs a set predicate rather than an equality, which the SQL builder does
  not construct yet, so this refuses rather than silently dropping rows from every
  public read.

- [#1531](https://github.com/nextlyhq/nextly/pull/1531) [`93d3651`](https://github.com/nextlyhq/nextly/commit/93d3651ded63f07655becea60a51d07a6b14de0d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page draws a component chosen through a component's own settings. When one
  component let a page swap which component sits inside it, the page loaded the
  original and drew a placeholder where the chosen one should be — because the
  step that loads components was reading the stored page while the step that
  draws them was reading the page's settings.

  The two now agree by construction: loading asks the drawing step what it needs
  rather than working it out separately, so a component reached by any route the
  renderer understands is loaded, including routes added later.

- [#1428](https://github.com/nextlyhq/nextly/pull/1428) [`5a18cb0`](https://github.com/nextlyhq/nextly/commit/5a18cb07e8dce79255d7c102b97822457c15dcca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The `table` archetype is drawn by the host. A plugin declares a table widget with no UI code of its own:

  ```ts
  {
    id: "acme/posts",
    title: "Recent posts",
    archetype: "table",
    defaultSize: "lg",
    query: {
      source: "collection:posts",
      op: "list",
      select: ["title", "publishedAt"],
      limit: 5,
    },
  }
  ```

  Each column is headed by that field's label from the collection, so a heading reads "Published at" rather than `publishedAt` — the same string the entry form puts above the field, agreeing by construction rather than through a second declaration that could drift. Where a source has no label the field name is used, which is a poor heading but a true one.

  The columns come from what the SERVER returned, not from `select`, and that is the difference that matters. A field carrying an `access.read` rule denying the viewer is stripped from every row before selection runs, so heading the table from the declaration would draw a column no row can fill and print the label of a field this reader may not see. Rows that arrive with no column descriptions are refused by name rather than falling back to `select`, because that fallback is exactly the one that would undo the server's filtering.

  A table that selects nothing says so without running a query, an empty result says "Nothing yet." instead of drawing an empty table, and a card shows at most five rows with the footer link as the way to the rest. A cell holding an object is left blank rather than rendered as "[object Object]"; `0` and `false` are printed, since only null, undefined and blank are absences.

  The cell reading shared with `list` now lives in one module, so "what does this cell say" has one answer rather than two that drift the first time either is corrected.

- [#1500](https://github.com/nextlyhq/nextly/pull/1500) [`bb10eaf`](https://github.com/nextlyhq/nextly/commit/bb10eaf906333e42696b9f65ac217f0dad5f90c6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A touch author is told what a press does. Pressing a tile in the insert panel
  already moves the description to it, so a block can be read before it is taken —
  on a pointer that cannot hover, that was the one affordance nothing announced.
  The panel now says so in a line beside the description rather than on the tile,
  and it appears from the pointer actually used rather than the one the device is
  classified by, so a touchscreen laptop driven by its trackpad still shows it the
  moment the author touches the screen.

- [#1489](https://github.com/nextlyhq/nextly/pull/1489) [`5eab012`](https://github.com/nextlyhq/nextly/commit/5eab012263d3a0cf46a404510f543ee8884294c6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A font weight is checked as CSS reads it rather than as JavaScript converts it.
  `0x190` becomes 400 on the way through a numeric conversion and passes any
  bound applied afterwards, while the string kept in the descriptor is still
  `0x190` — which CSS cannot parse, so the browser drops the declaration and
  matches the face at a weight nobody chose. The exponent and fraction forms CSS
  does accept, such as `1e3`, `.5e3` and `400.0`, still work. A decimal point
  with no digit after it is refused too: the tokenizer takes `400.` as `400`
  followed by a stray point, and the descriptor is dropped.

  Choosing the same font file twice in a row works. A file input is uncontrolled,
  so clearing the panel's own state left the element still holding the previous
  choice — and a browser raises no event for an unchanged selection, which left
  the Add button disabled while the picker displayed the very file just chosen.
  Adding one variable font's italic after its upright is that flow.

- [#1425](https://github.com/nextlyhq/nextly/pull/1425) [`6af9888`](https://github.com/nextlyhq/nextly/commit/6af9888fe5bf829e5775c3de14d80791e4a52353) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A widget source now carries the human label of each field it exposes, and a `list` result describes the columns the query selected.

  `WidgetSourceField` gains an optional `label`, carried from the field's own config — the same string the entry form puts above it. A widget that draws a TABLE needs a column heading, and the only honest one is the label the field already has. The alternatives are both worse: deriving prose from an identifier guesses at capitalisation and word breaks it cannot know, and asking the widget author to declare headings puts a second answer beside `select`, free to disagree with it.

  A `list` result gains `fields`: the selected field names in the order they were selected, each with its label where the source has one. Carried on the RESULT rather than published as source metadata, and that placement is an access-control decision. A widget's source is proven readable before a row is returned and `select` names the fields the caller asked for, so answering with labels for exactly those fields discloses nothing new. A separate metadata channel would be an enumeration surface: the query endpoint is careful that a source the caller may not read answers exactly as one that does not exist, and publishing field lists beside it would undo that.

  The columns describe what the caller could actually READ. A field may carry its own `access.read` rule, and the read strips a denied field from every row before selection runs — so describing the declared selection would advertise a column no row can fill and disclose the human label of a field the caller may not read. The description is derived from the rows that came back, in `select` order, and a field selected twice yields one column rather than two. Nothing is described when no rows came back: with no rows there is no evidence about which fields survived, and answering from the declaration would put the disclosure back on the empty case.

  A field label that is present but unusable is refused at source registration rather than only normalized on the collection path. A plugin registering its own source through the SDK reaches the stored snapshot untouched by that path, and `label: "   "` is legal TypeScript — so the empty column head this field exists to prevent arrived through the one channel that had no normalization.

  The admin carries the descriptions through. Its `WidgetResult` declares `fields`, and the response parser — which rebuilds a list result from checked fields, so anything not named is discarded — now names them, validating each descriptor. A malformed heading costs the columns and nothing more, because the rows are the answer.

  `fields` is present only when the query declared `select`. Without it the rows carry whatever the collection holds, so there are no columns the widget chose and nothing honest to head them with. A label that is blank or whitespace is omitted rather than passed on, since an empty column head above real data is worse than falling back to the field name.

- [#1459](https://github.com/nextlyhq/nextly/pull/1459) [`586951f`](https://github.com/nextlyhq/nextly/commit/586951f90200da183bfa00dafceed00614dc9c4b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin types a job's status as the wire can actually carry it.

  The core's union describes what the current server sends and is right about
  that. A client is a different position: during a rolling deploy a newer server
  sends a status the bundle was built before, and typing the received field as the
  closed union asserts that cannot happen — the exact claim every guard in this
  feature exists because it is false.

  So the admin widens `status` to a string at the boundary, where the
  uncertainty actually is, and keeps the union for the exhaustive presentation
  map, which is the one place a closed set is correct.

- [#1545](https://github.com/nextlyhq/nextly/pull/1545) [`43ffe9b`](https://github.com/nextlyhq/nextly/commit/43ffe9b0a267ec6dd973c1c2dc5b1658c9e7a2f9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The activity feed obeys a collection's stored read rule, and no longer publishes
  a count it cannot authorize.

  Its scope was collection-level, and `entryTitle` is stored on the log row at
  write time rather than hydrated through the read path — so nothing between the
  table and the response consulted a document rule. Under a stored `owner-only`
  or `custom` read rule the feed reported other authors' entry titles, entry ids,
  and the names and email addresses attached to their edits. Measured: with the
  ordinary read returning one document for the caller, the feed returned four
  rows spanning both authors.

  Each row's document is now authorized as the caller, by the same decision the
  pending-edit cards use — one implementation, so the two surfaces cannot come to
  different conclusions about who may see a document. A stored rule can be an
  arbitrary function and its constraint is expressed over the collection's own
  fields, which an audit row does not carry, so the constraint cannot be pushed
  into this query the way it is pushed into a collection read; asking the read
  path about a known set of ids is the one form that works for every rule.

  Rows that name no document keep their existing treatment: a settings mutation
  is filed under a namespace that is neither a collection nor a single, the
  caller's scope already admitted it, and dropping those would remove credential
  rotations from the feed entirely.

  `total` is gone from the response. It counted the rows the collection scope
  admitted, so it reported edits to documents the reader may not open — the same
  disclosure the rows carried, in a number — and it cannot be narrowed without
  authorizing every matching row, which is unbounded over a table that only
  grows. `hasMore` carries the pagination instead, observed by authorizing one
  row past the page. The hand-written `COUNT(*)` behind the old field is removed
  with it.

  The activity feed now records the LANGUAGE a write was made in and authorizes
  each row in it. A stored `custom` read rule is a predicate over a collection's
  own fields, and a localized field answers differently per translation, so a row
  judged without a locale is judged against the default one — and an edit made in
  a language the rule denies could still show its title. The locale is derived
  from the event resource that already carries it, so a write cannot report one
  language to a webhook subscriber and a different one to the trail. Rows written
  before the column, and writes with no language of their own, leave it NULL and
  are read as the default, which is what they already meant.

  Deleting a document no longer erases it from the feed. A collection delete
  removes the row before appending `entry.deleted`, so the document the event
  names can never be found again — and authorizing by readability alone dropped
  the deletion, and every earlier event for that document, for everyone including
  a super admin. Such a row is now kept without its stored title or metadata: the
  rule that decided who could read them died with the document, so a reader learns
  that something was deleted, by whom and when, but not what it was called. A
  document that still exists and was refused stays refused, and a probe that
  cannot answer drops the row rather than publishing it.

  The feed also refuses outright when the content registry cannot be enumerated.
  A slug missing from the registry is read as an install-level event and kept
  without asking the read path — correct when the map is whole, and the same rule
  admits every document row unauthorized when it is not.

  Refill rounds are anchored to the last row read rather than to a running offset,
  and ordered by a unique key as well as the instant: `activity_log` grows while a
  feed is being built, so under OFFSET a row inserted between rounds shifts every
  later position, repeating one row and silently skipping another.

  Each activity row now records what it is ABOUT — a collection document, a
  single, or an install-level settings change — rather than leaving the feed to
  infer it from the slug. A resource that already held a now-reserved name may
  keep it, so an upgraded installation can have a real collection sharing a
  settings namespace; registry membership then read a credential rotation as a
  document in that collection, refused it, and stripped the changed-field detail
  the row exists to record. Rows written before the column fall back to the
  registry, which is what they were always judged by.

- [#1467](https://github.com/nextlyhq/nextly/pull/1467) [`b3532bd`](https://github.com/nextlyhq/nextly/commit/b3532bd5180e85e2e4585fc7503060df36127de3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An embed block dropped on a page rendered at 300 by 150 pixels — the size a
  browser gives an iframe when nobody says otherwise — so a video sat
  postage-stamp sized in the corner of a full-width column. The block declared no
  default size at all.

  An embed now fills the width it is given and takes its height from a sixteen by
  nine ratio, which is what the players this block exists for actually serve. It
  is a default rather than a rule: an author setting their own height or ratio
  still wins, which is what a square player or an audio embed needs.

- [#1496](https://github.com/nextlyhq/nextly/pull/1496) [`8527d85`](https://github.com/nextlyhq/nextly/commit/8527d8510672eee4db98fc9455bfe4e2bb825dc8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An empty paginated list no longer claims a row that is not there. The count
  line builds its range from the page and page size at one end and clamps it to
  the total at the other, so with no rows the two ends crossed and it read
  "Showing 1-0 of 0" — a range starting past its end. It now says how many there
  are, which for an empty list is none. Reachable today on a webhook endpoint's
  deliveries page, which renders the control with no rows.

- [#1521](https://github.com/nextlyhq/nextly/pull/1521) [`6a0ebf9`](https://github.com/nextlyhq/nextly/commit/6a0ebf932466fd75234fb0906bc6dd979d0930bc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A component instance that an author had hidden was published to everyone. The
  instance node carried the visibility rule; composition replaced it with the
  component's own blocks, and the rule went with it — so the pass that withholds
  hidden content found nothing left to withhold, and content restricted to one
  audience was served to every visitor. An instance an author hides is now left
  in place for that pass to remove, and hiding a component at one screen size
  carries onto everything it draws.

  Placing the same component twice also published its HTML ids twice. Anchors,
  `<label for>` and id selectors then reached whichever copy the browser found
  first. Each instance now derives its own, by the same rule that already applies
  when a pattern is inserted, so a page holding both carries one spelling rather
  than two.

  Three limits were not the limits they claimed to be. A page's node cap counted
  only what composition added, so a full page could resolve to twice the cap
  while every later pass believed it was reading a bounded document. Slot content
  left behind under a slot a component no longer offers was composed in full
  before being discarded, which could exhaust that cap and cost the page a
  component it does show. And a component's overrides were counted only after the
  whole record had been read, so an oversized one was never bounded at all.

  A page, a region or a template supplied where a component was expected is now
  refused instead of being drawn as though it were one.

  Copying a component also broke the relationships built on its ids. A heading
  that names a field, or help text a control points at, is wired together by id —
  and moving the ids without moving the references left every one of them
  pointing at something that no longer exists, so a screen reader announced the
  control with no name and no description at all. References now move with their
  targets, including inside patterns, where the same copy had the same effect. A
  reference to something the copy does not contain is left alone.

  Three smaller repairs. A component instance stored with an empty visibility
  setting could stop a page rendering outright. A component whose own visibility
  setting could not be read was being rewritten into one that reads as
  unrestricted, which would have published content that was meant to be withheld.
  And content left behind under a slot a component no longer offers was still
  counted against the page's size limit even though it is discarded, so a page
  could be refused a component that would have fitted.

  Four smaller repairs found the same way. Content a page places inside a
  component kept its own id references, instead of having them redirected at the
  component's copies. A block hidden by an instance no longer counts against the
  page's size limit, since it draws nothing. A component whose visibility setting
  was stored empty now takes the instance's per-screen hiding like any other. And
  copying a pattern no longer fails on a node whose attributes were stored empty.

  Two more relationships now travel with the copies. A link pointing at a spot
  inside its own component — the "#pricing" kind — moves with that spot, so it no
  longer sends a reader to somewhere on the page that does not exist; a link
  naming anything else is left exactly as written. And hiding a component only on
  some screen sizes now keeps its full setting, so a component hidden on tablet
  but restored on mobile appears on mobile again, instead of staying hidden all
  the way down.

  A component that arrives unreadable is also reported as broken data rather than
  as a component nobody has published, so an author is offered the remedy that
  can actually help.

- [#1488](https://github.com/nextlyhq/nextly/pull/1488) [`ebe163c`](https://github.com/nextlyhq/nextly/commit/ebe163cfb9febeb5ca592c378566b42878510030) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A generated type for an optional field now admits null, because the column
  does. `field.required !== true` is what decides column nullability in
  `field-column-descriptor.ts`, so an unset optional field is read back as SQL
  NULL — and nothing on the collections read path turns that null into
  undefined. The emitted `field?: T` claimed only that the key might be absent,
  which is a different statement and one the database never makes: a consumer
  writing `entry.subtitle.trim()` type-checked and threw at runtime.

  Optional fields now emit `field?: T | null`.

  The `?` is KEPT alongside `| null` rather than replaced by it, which is the
  part worth stating. The input types are derived from the entity interface
  (`CreateInput = Omit<...>`), and the same emission builds the field-group
  interfaces that nest inside entity fields, so dropping `?` would demand an
  explicit `null` for every optional key at every depth on create. A wrapper
  could relax the top level; it could not reach the nested ones. Prisma and
  Drizzle drop `?` because their row types are flat and their inputs are
  generated separately rather than derived — the shape here is Payload's, for
  the same nesting reason.

  `unknown` is left alone, since it already admits null and the union would be
  noise in a file a user reads. Required fields are unchanged: their columns are
  NOT NULL, so offering null would send every consumer down a branch that cannot
  happen.

- [#1472](https://github.com/nextlyhq/nextly/pull/1472) [`dafbc83`](https://github.com/nextlyhq/nextly/commit/dafbc835cde8119d3bd99c3b19ff9bf076941b18) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The API Keys screen no longer offers controls the endpoint behind them will
  refuse.

  The list route was widened to admit `read-api-keys`, because the endpoint
  accepts that grant — but the page still rendered Create unconditionally and
  every active row still offered Edit and Revoke. A reader who could only view
  keys was shown three controls, each leading to a route or request that turns
  them away.

  Each control is now gated on the grants its own operation needs, and the row
  itself follows the same gate as the Edit item rather than staying clickable
  into a route that refuses. The create route accepts what the endpoint accepts
  instead of the narrower grant alone.

  The rule behind all of them is declared once, in the package that enforces it:
  `nextly/config` exports the API-key policy, the endpoints authorise from it, and
  the admin's route guards and controls derive their grant slugs from the same
  declaration through `permissionSlug`. Writing that rule twice is what let the
  list route demand `update-api-keys` while the endpoint accepted `read-api-keys`.
  The table's two gates are required props rather than defaulted, so a call site
  cannot omit them and silently offer everything.

- [#1463](https://github.com/nextlyhq/nextly/pull/1463) [`175b31e`](https://github.com/nextlyhq/nextly/commit/175b31eff640d9cbe9404cceb6c227dfdd3a3d98) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Arrange your own dashboard.

  An "Edit dashboard" button turns the grid into edit mode: drag a card, or move it
  with buttons, hide one without losing where it sat, remove one entirely, and add
  back anything you are missing. Save commits the arrangement; Cancel discards it;
  Reset puts you back on the default and keeps you tracking it, so a widget added
  later still reaches you.

  Every change is held locally until you save. Each write is guarded twice -- by a
  version that catches another tab, and by a token that catches the set of widgets
  available to you moving underneath what you are looking at -- and both refuse the
  same way, with a message and a Reload rather than a silent overwrite. Your work
  stays on screen while you decide.

  Moving a card never requires a drag. Move up and Move down are ordinary buttons,
  because WCAG 2.2 requires a single-pointer alternative to every dragging movement
  and a keyboard shortcut does not satisfy it. Reorders are announced through the
  grid's existing live region.

  The dashboard also stops depending on the arrangement being reachable: if it has
  not loaded, or cannot load, the cards draw in their declared order exactly as
  before rather than leaving the page blank.

- [#1509](https://github.com/nextlyhq/nextly/pull/1509) [`dbf2d0e`](https://github.com/nextlyhq/nextly/commit/dbf2d0e995f62f80f888815be4fe0d3fce53f455) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The gutters in `core/columns`, `core/gallery` and `core/accordion` follow the
  site's spacing token again instead of a hard-coded length.

  All three shipped with `{ $token: "space.4" }`, rendered their children
  touching, and were changed to a literal `1rem` for it. The cause was not the
  token: the renderer withheld the token tier from a consumer handing back a
  stored stylesheet, so the reference arrived as a `var()` with nothing behind it
  — invalid at computed-value time, and `gap` falls back to `normal`, which is
  zero for a grid.

  That path now carries the declaration, so the reference resolves and a site that
  redefines `space.4` moves all three. The rendered value is unchanged for a site
  that does not: measured in a browser on the path that used to fail, the computed
  `column-gap` is `16px` and the space between two columns is 16 pixels.

- [#1514](https://github.com/nextlyhq/nextly/pull/1514) [`c585ddd`](https://github.com/nextlyhq/nextly/commit/c585ddd4616302fe909475110dfd1fa693130248) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A component definition can now say which of its properties an instance may
  override, and which regions an instance may fill.

  A `component` document carries an `exposed` list — each entry pointing at a
  node in its own tree and the prop on it an instance may replace — and a `slots`
  map — keyed by slot id — naming the regions an instance may put its own
  blocks into. Named variants
  preset those values. A component that exposes nothing is still a component: a
  footer nobody may edit is the point of one, not an unfinished definition.

  Every pointer is checked when the document is validated, and one that does not
  resolve is refused rather than stored. Deleting a node, renaming a container's
  slot or removing an exposure leaves a definition that still loads and still
  renders — the fault only appears later, as an author editing a property and
  seeing nothing change on any page carrying the component. The refusal names the
  node or slot it could not find, and what the node declares instead.

  A variant states the label its picker shows and at least one override it
  presets — one that presets nothing is a picker entry that does nothing when
  chosen. An exposed slot needs a usable id, and the block types it accepts are
  held to the same grammar a node's own type is. And
  an exposed slot states the label the layers panel shows. A variant cannot carry slot content yet: that content is a second node
  forest, and the one place a forest is checked for malformed nodes, duplicate
  ids and depth is the walk over the document's own nodes — so it lands with the
  resolver that inlines it, rather than being stored unchecked.

  Component instances gained `overrides`, which distinguishes three states rather
  than two: a property absent from the map inherits what the definition or
  variant provides, one set to `{ $unset: true }` renders empty, and any other
  value replaces. Without the middle state an author could not clear a subtitle
  their definition fills in.

- [#1498](https://github.com/nextlyhq/nextly/pull/1498) [`333ecc5`](https://github.com/nextlyhq/nextly/commit/333ecc5d46cbb46439e1985fa312d12a0d68a28d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A collection built in the Schema Builder now survives the deploy.

  The migration that path writes created the table and nothing else. That file is
  committed and replayed against a database that has never seen the Builder, where
  the `dynamic_collections` row it writes locally does not exist -- so production
  got the table and no row at all, and the collection was absent from the admin
  rather than merely showing a stale status.

  The migration now carries the row too, built by the same builder `migrate:create`
  uses rather than a second statement that would have to agree with it. The two
  committed migration is the only thing replayed against the target database, so
  it has to be self-sufficient: nothing else recreates the registry row there.

- [#1515](https://github.com/nextlyhq/nextly/pull/1515) [`48cb708`](https://github.com/nextlyhq/nextly/commit/48cb708dc9994e5c4e0f8a632027298cdcbe477a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder's op vocabulary is now importable without React, from
  `@nextlyhq/builder/ops`.

  An op is a change to a document rather than a gesture in a React tree: a server
  action that promotes a selection to a component, and an agent asked to insert a
  section, apply the same ops the canvas applies. Published only from the package
  root, those callers had two options and both were wrong — pull a client
  boundary into a server module, or grow a second implementation that agrees with
  this one until the day it does not.

  The subpath is built by the same server-safe configuration that already
  publishes `./geometry` and `./shell-state`, so it carries no `"use client"`
  banner and a Server Component can load it. Nothing that already imports these
  names from the package root has changed.

- [#1540](https://github.com/nextlyhq/nextly/pull/1540) [`0ae809b`](https://github.com/nextlyhq/nextly/commit/0ae809bb20216966a15b7aa0e7f4754c1f15846a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The CLI now says "field group" where it still said "component". `db:sync` and
  `generate-types` print a `Field groups` count, a failed sync reports field
  groups, and a generated migration carries a `-- Field groups:` header. Migration
  files written before this keep working: the header is read back under both
  spellings, so an older file is still reported as touching the field groups it
  touches.

- [#1517](https://github.com/nextlyhq/nextly/pull/1517) [`71d2563`](https://github.com/nextlyhq/nextly/commit/71d2563bd0020c10f0b191c79ce4715834784fb7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Listing collections filters by permission BEFORE it pages, so the count
  describes the rows the caller can see.

  Filtering the already-fetched page instead left the rows and the meta
  describing different sets: `total` became the number of survivors on ONE page,
  so `totalPages` collapsed to 1 and `hasNext` was false however many pages the
  reader could actually reach. A client reading that stops at the first page and
  every collection past it is unreachable -- and the pre-filter count it replaced
  reported how many collections exist that the reader may not see.

  The registry now takes a `slugAllowlist` and puts it in the WHERE clause, so
  the COUNT and the page read the same rows. `readableSlugAllowlist` resolves it
  once for both the collections and the singles listings, which had two copies of
  that resolution; its three answers stay distinct -- no filter, no rows, or
  exactly these slugs.

- [#1528](https://github.com/nextlyhq/nextly/pull/1528) [`45e58b2`](https://github.com/nextlyhq/nextly/commit/45e58b2897071b6d7f914a6aabb0af57fdd1bbd9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard can say how much work is waiting: `system:versions` answers how
  many documents hold edits that are not live, and which ones were touched most
  recently.

  That needed a capability the data layer did not have. There was no `count`
  anywhere in it -- collection totals go through an access-controlled path built
  for collection tables, and nothing could count a system table, so a caller
  wanting a number selected the rows and measured the array. The adapter now has
  one, with `distinctOn` for the case that makes it worth having: a working draft
  is one row per document per LOCALE, so "14 documents have unpublished changes"
  counted from rows says 42 for an install translating into three languages.

  `distinctOn` compiles to `COUNT(*)` over a `SELECT DISTINCT` subquery and never
  to `COUNT(DISTINCT a, b)`. The inline form is not portable and fails in the
  direction hardest to notice -- MySQL accepts it, PostgreSQL needs a row
  constructor, and SQLite rejects it outright -- so a query written against one
  engine is a syntax error on another. It is exercised against all three.

  The access decision lives in the resolver, which is the difference from
  `system:releases`. That service authorizes itself, so its resolver hands the
  caller through and adds nothing; `VersionsService` has no authorization at all,
  and none of its methods takes an actor. A resolver that simply called it would
  answer an install-wide number to a reader entitled to part of it, so the reads
  are bounded by asking the access layer per registered entity -- the same
  decision the dashboard's own endpoints take. That is not the same as filtering
  the caller's permission slugs, in either direction: an API key is judged on its
  OWN stamped scope rather than on the roles of whoever minted it, and a
  collection authorized or refused purely in code is decided by its rule rather
  than by a permission row. The answer is always enumerated, so a caller who may
  read nothing gets exactly nothing rather than a value that could be read as no
  filter at all.

  The card publishes the document's identity and its instant, never the snapshot:
  that column is the unpublished content itself.

- [#1427](https://github.com/nextlyhq/nextly/pull/1427) [`070cb7b`](https://github.com/nextlyhq/nextly/commit/070cb7ba01510c5c924070c5e39cc6c3c0a7ef34) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin derives its email draft-preview payload from the schema the server
  validates against, instead of restating it.

  The client type was a hand-written mirror of the endpoint's zod schema, so the
  wire contract had two definitions. Adding a required field on the server left
  the admin compiling cleanly while every preview request was rejected at
  runtime — a failure that only shows up in a browser, on a surface whose whole
  point is telling an author the truth about what they are sending.

  `nextly/api/email-template-preview-types` now exposes the contract as a
  types-only entry point, so a consumer building the request derives its payload
  and its result from the canonical schema and the renderer's own output type. It
  pulls zod and nothing else — no DI container, no route handler — so a type-only
  import costs a browser bundle nothing.

  The published request type is the schema's INPUT rather than its output. The
  three fields that default to null are optional on the wire and required after
  parsing, so exporting the parsed shape as the request contract would reject
  payloads the endpoint accepts. Both are exposed: `DraftPreviewRequest` for a
  caller building a body, `DraftPreviewParsed` for a handler reading one.

- [#1540](https://github.com/nextlyhq/nextly/pull/1540) [`0ae809b`](https://github.com/nextlyhq/nextly/commit/0ae809bb20216966a15b7aa0e7f4754c1f15846a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - When a schema change needs a terminal it cannot get, the error listing what you
  would have been asked to approve no longer stops at three items without saying
  so. It now names how many more there are, and how many of the omitted ones are
  column drops — the only kind that loses data. Previously a run with 57 events
  listed three and gave no sign that 17 of the 18 column drops were among the
  ones it did not show.

- [`bec0a02`](https://github.com/nextlyhq/nextly/commit/bec0a02dafdcead5bf5c95da73dc7472076b693d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Whether core can draw a widget is now a question about the DECLARATION, not just its archetype.

  An archetype having a renderer says nothing about whether that renderer can draw a particular widget: a `list` needs its query to `select` the fields each row shows, and the same renderer that claims the archetype refuses a declaration without them. Treating those as one question cost two things.

  A list widget that selects nothing had its query batched anyway. The refusal arrived only after the request came back, so the server performed an unprojected read, shipped every accessible document to the browser, and the card discarded them to print "selects no fields" — on every mount and every window-focus refetch. The declaration is refused before the batch is built now, so the card says the same thing without a database read.

  And a widget declared through both channels lost its plugin component. The contributed component is the fallback for a widget core cannot draw, and core reported that it could — so a registration naming `list` without `select` replaced a working plugin card with an error. The fallback now asks whether this declaration is drawable, so the component stays.

  An archetype states its own precondition beside its body, and returns the reason rather than a boolean, so the card explains what is missing in the words of the archetype that knows.

- [#1542](https://github.com/nextlyhq/nextly/pull/1542) [`bde930a`](https://github.com/nextlyhq/nextly/commit/bde930a70492d9bbcebc5fa48166bccb4fad6916) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every package's npm page now answers the same four questions: what state the
  package is in, how to install it, what it relates to, and its licence. Eight
  packages were missing at least one of those, and `@nextlyhq/adapter-drizzle`
  was a three-line stub that never said you are not meant to install it directly.

- [#1442](https://github.com/nextlyhq/nextly/pull/1442) [`afb9daa`](https://github.com/nextlyhq/nextly/commit/afb9daa5e201bd8e382ea5cb86c2c4de4a59c651) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every storage adapter can read a stored file back as bytes. The contract has
  declared `read` as an optional member for some time and only the local adapter
  supplied it, so a caller reaching for it against S3, Vercel Blob or UploadThing
  got `undefined` and fell through whatever branch followed — a capability that
  reads as present and behaves as absent.

  The three remaining adapters implement it now. S3 reads through its own SDK; the
  two URL-addressed services fetch the address their service issued, since a
  derived URL is a guess at a string another system owns.

  A missing key answers `null`, which is an ordinary fact about the store. A
  transport failure does NOT: a dropped connection to a file whose lookup just
  succeeded is reported as an error rather than as absence, because folding the
  two together invites a caller to treat a live file as deleted and write a
  replacement over it. That separation is stated once, in a shared helper both
  URL-addressed adapters call, rather than being spelled out per adapter where the
  two copies would drift.

  S3 returns an empty buffer for a zero-byte object rather than `null`, for the
  same reason: a stored empty file is not a missing one.

- [#1456](https://github.com/nextlyhq/nextly/pull/1456) [`7eeb8e4`](https://github.com/nextlyhq/nextly/commit/7eeb8e4dc94991d3794f6a9ea5d380e3985050f5) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Accept both the `"component"` and `"fieldGroup"` field type spellings in stored definitions — across the schema pipeline, query filters, entry defaults, sanitization, and field-group registry lookups — so collections containing field groups no longer grow ghost parent-table columns that trigger interactive rename prompts on startup.

- [#1492](https://github.com/nextlyhq/nextly/pull/1492) [`2dd62dc`](https://github.com/nextlyhq/nextly/commit/2dd62dc69ddd89d927fc4bdcb4bc5104caa94754) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Generated types and Zod schemas now declare the publish lifecycle.

  A collection or Single that sets `status: true` carries a draft/published
  column, and the generated artifacts said nothing about it — so a consumer of
  your generated types could not tell a draft from a published entry, which is
  the one distinction the lifecycle exists to express.

  Both artifacts now emit `status: "draft" | "published"` for those records, and
  nothing at all for the ones that do not declare it.

  The set comes from `LIFECYCLE_STATUSES` rather than being typed out, because
  its own docblock says it is stated once so that callers rejecting other values
  do not write the rejection from memory. Adding a status there now widens the
  generated type and the generated validator together.

  It is deliberately NOT `VersionStatus`. That union also carries `"unpublished"`,
  which describes a row in the version history rather than an entry, and no entry
  is ever written with it — offering it would send consumers down a branch that
  cannot occur.

  The member is neither optional nor nullable: the column is `NOT NULL DEFAULT
'draft'`, so a read always has a value.

- [#1527](https://github.com/nextlyhq/nextly/pull/1527) [`912c54d`](https://github.com/nextlyhq/nextly/commit/912c54dbb03b4aadbd048a3bd7b745b5cfc132ea) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page that exactly fills its block limit is no longer refused because of parts
  of a component that were hidden anyway. Hiding a block inside a component costs
  the page nothing, and the step that prepares the page's own content for the
  regions of that component was counting those hidden blocks against the page —
  so a component with several hidden blocks before a region could push an
  otherwise valid page over the limit.

  Blocks hidden by a visibility CONDITION still count, and they should: the block
  itself is still placed on the page until the condition is evaluated, so the
  page pays for it either way.

- [#1422](https://github.com/nextlyhq/nextly/pull/1422) [`079bcb1`](https://github.com/nextlyhq/nextly/commit/079bcb15a70e35b76484f941b81be57e6cf41ac3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Opening a document's version history made most of the document's own controls
  stop working, without disabling them or reporting anything.

  The panel is pinned to the window's edge with `position: fixed`, which takes it
  out of the layout — so the page underneath kept its full width and carried on
  drawing beneath it. Measured in a browser at 1280x720, the panel occupied
  x 800-1280 at every height, and `document.elementFromPoint` at each control's
  own centre returned a row of the panel rather than the control: Save draft,
  Publish, the overflow menu, the rail toggle, the entry's copy-id button, and
  the account, theme and notification controls in the admin header. Eight
  controls, all visible, all enabled, none of them reachable.

  Nothing reported a refusal because nothing refused. The pointer simply landed
  on a different element, which is worse than a disabled control — a disabled one
  at least says it will not act.

  Space is now reserved rather than fought over. `SidePanelReservation` carries a
  mounted panel's claim up to the layout, which indents its content column by
  that much, so the page ends where the panel begins. A `z-index` would not have
  helped: raising the page over the panel puts the page's controls on top of the
  panel's rows, which is the same collision with the winner swapped.

  The width is stated once and both the element and the reservation are taken
  from it. Two literals would agree until one of them changed, and the failure
  after that is silent in the same way as the original: a strip of document drawn
  under a panel, its controls quietly inert.

  Where the window cannot hold both, the panel is modal instead of non-modal.
  That is not a lesser fallback — it is the honest state. The panel covers the
  document either way, and a modal one blocks the clicks it is swallowing and
  scrims what it has withdrawn, instead of accepting them into nothing. Both
  behaviours derive from the single question of whether room was made, so the
  panel cannot end up non-modal over a page that nothing moved.

- [#1559](https://github.com/nextlyhq/nextly/pull/1559) [`0e104e3`](https://github.com/nextlyhq/nextly/commit/0e104e3ec8a5bef63c7d7a59cc7d3e52e957df0d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` now records what it created, so a collection built in the
  Schema Builder and deployed to production shows its dashboard cards.

  It did not before. `registerFromMigrations` is the only writer that records
  `applied`, and its one caller sits inside `runBootTimeApplyIfDev`, whose first
  line returns unless `NODE_ENV === "development"`. The CLI applied the DDL and
  touched no registry row at all, so the row stayed `pending` after its table
  existed — and a restart re-ran the same dev-gated path and changed nothing.

  A third phase now runs after the file migrations, inside the migrate lock. It
  registers what the snapshots describe, then moves every pending row whose table
  actually exists to `applied`. A row whose table is NOT there is left exactly as
  it was: after a migrate run, that has two indistinguishable causes — a migration
  that failed, and one that was never generated — and marking the second `failed`
  would turn a collection still waiting for its DDL into one somebody has to
  repair by hand. The pass runs on every invocation, so a row that misses one run
  is picked up by the next.

  The command still succeeds if the bookkeeping fails. By then the DDL has landed,
  and MySQL commits DDL implicitly, so there is no transaction to roll back into;
  failing would report a migration that worked as broken.

  `getRecordsWithPendingMigrations` was broken and could not have worked for
  anyone. It filtered on `migration_status` and ordered by `created_at` — physical
  column names — while the adapter resolves columns by their Drizzle property
  names, so it threw "Column not found in table" for every caller. It had no
  callers, which is why nothing surfaced it: it was written for a reconciliation
  pass that was never wired up.

  Three sibling queries in the same base service carried the same mistake and are
  fixed with it: two `orderBy` clauses naming `created_at`, which an adapter does
  not reject — it ignores them, so the caller believed it had asked for an order
  it never got — and one `migrationStatus` filter that would have thrown for
  anyone who passed it. The three list paths now share one reader, so a method
  cannot be written that skips the ordering, the deserialization or the error
  mapping while looking correct beside the others.

  The reconciliation could not have worked from the CLI at all. `adapter.select`
  maps a table name through a resolver and refuses when none is installed, and a
  `nextly migrate` run has no boot to install one — so every registry read threw,
  the per-registry guard caught all three, and the command reported success having
  repaired nothing. It now installs the resolver the way `prune`,
  `webhooks-prune`, `migrate-field-groups` and `dev-server` each already do.

  The guard no longer hides that. A registry the pass could not read is reported
  rather than folded into a count of zero, because zero rows repaired and zero
  rows readable are the same number and opposite facts. `nextly migrate` says so,
  and no longer announces "Database is up to date" while registry work it just
  measured is outstanding.

- [#1569](https://github.com/nextlyhq/nextly/pull/1569) [`acce8fa`](https://github.com/nextlyhq/nextly/commit/acce8fafcb8cd32dd18fbf4d22fb9269a1a61203) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A generated migration's header now names only the collections, singles and field groups that migration changes, instead of every entity in the config, and carries `-- Entity scope: touched` to say so. A localization companion names its entity by kind, so a single or field group is no longer written as a collection.

  `nextly migrate:create --blank` explains how to annotate a hand-written migration and ships the marker, so naming the entity is the whole step.

- [#1525](https://github.com/nextlyhq/nextly/pull/1525) [`31be0c4`](https://github.com/nextlyhq/nextly/commit/31be0c43473c72e626622631a22a873b035a7738) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content a page places inside a hidden part of a component is no longer loaded.
  The blocks were never going to be shown — the part holding them is hidden, so
  they and everything in them were already being dropped — but any component
  among them was still being fetched and counted. A page could be refused for
  publishing over a component in there, and a change to that component still
  rebuilt the page.

- [#1523](https://github.com/nextlyhq/nextly/pull/1523) [`a416256`](https://github.com/nextlyhq/nextly/commit/a416256b7d48000b874fcea91e83256a92a5023b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard can draw a card of several numbers, each one a link into the list
  it counts. `stats` is a new archetype: where `metric` is one number from one
  query, a `stats` card declares `cells`, and every cell carries its own query.

  Each cell being its own ordinary `count` is what keeps the card honest about
  access. A reader who may not read one of the collections simply loses that
  number, judged by the same rule every other widget query is judged by -- where
  one composite query would need a source that knows every domain it counts, and
  a single authorization decision covering all of them.

  Every collection that declares a status now generates a health card: total,
  published and draft, with each number linking to that collection's list filtered
  the same way. The link and the number are built from one value, so a card cannot
  promise a filter its link does not apply.

  `stats` is classified as its own kind rather than filed under an existing one.
  `DATA_ARCHETYPES` means "requires the singular query field", which a stats card
  must not have; `QUERYLESS_ARCHETYPES` means "needs no data at all", which the
  admin turns into a body that never enters the batch. Both names have agreed
  until now because no archetype needed data without using `query`.

- [#1417](https://github.com/nextlyhq/nextly/pull/1417) [`3059b32`](https://github.com/nextlyhq/nextly/commit/3059b329754db1ca9b65394cc8cda25cf33cb199) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Every admin list now takes its column policy from one hook instead of ten
  hand-written copies.

  The policy is small but load-bearing: some columns are pinned and never offered
  to the toggle, the reader's choice is remembered per list, and a column is
  hidden exactly when the remembered choice says so. Ten surfaces carried the
  same three decisions written out by hand, each copy free to drift. The new
  `useTableColumns` hook owns the policy once, and the ten entity lists — API
  keys, collections, field groups, plugins, roles, email providers, email
  templates, singles, users and image sizes — now declare their storage key,
  their columns and their pinned set, nothing more.

  Stored column choices are untouched: every list keeps the storage key its
  readers already have choices under, so nothing anyone has hidden comes back.

  The image sizes list also stops rebuilding its pinned-column set on every
  render. The set now lives at module scope like every other list's, which
  removes the last arrangement that could have been one refactor away from a
  render loop.

- [#1414](https://github.com/nextlyhq/nextly/pull/1414) [`123b6b7`](https://github.com/nextlyhq/nextly/commit/123b6b761b9c37b18ee724353bc0738d02fd73e8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make the preview one control instead of three. The entry header carried a pane toggle, an open-the-preview action and a copy-link action, the last two already sharing a menu while the toggle sat beside them looking like a second preview button — three of the header's seven controls for one idea. Where a side pane exists it now leads, because it is the cheapest of the three and the only one with a state worth showing, and opening and copying move into a menu beside it. Where no pane exists the shape is unchanged: a plain button when only one thing can be done, and one menu when both can.

- [#1460](https://github.com/nextlyhq/nextly/pull/1460) [`25f3eb0`](https://github.com/nextlyhq/nextly/commit/25f3eb0a9db36fc88ca6583a7550b24cfd741404) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An installation's upload policy applied to one entry point and not the other.
  The published server action reaches the legacy media service, which never runs
  the configured validator, so that path enforced no allowlist, no magic-byte
  comparison and no sanitisation while the mounted REST handler enforced all
  three. A deployment excluding a format through `security.uploads` had the
  setting silently ignored on the action, and what lands there is retrievable
  through the anonymous byte route. The action now builds the validator from the
  same config and refuses before anything is stored.

  A file's type is also inferred from its name for every accepted format rather
  than for fonts alone. The media dropzone offers each of them by suffix, and a
  browser reports no type at all for whatever its platform does not register — so
  a file the browser accepted was refused by the server for carrying no type.
  Fonts still answer to their own signature, because the sniffer recognises
  neither WOFF nor WOFF2; every other inferred type meets the magic-byte
  comparison.

  A configured allowlist naming a font by its legacy spelling never met an
  upload's canonicalised claim, so a full override advertised a format it then
  refused. Allowlist entries canonicalise through the same table.

- [#1432](https://github.com/nextlyhq/nextly/pull/1432) [`5f78af3`](https://github.com/nextlyhq/nextly/commit/5f78af3b16dc3072bbf6d3e491fd884a7cf61f01) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - One rule for a queryless widget's query, not two.

  The registry refused a `query` on a `text` or `actions` widget while the same
  declaration reached boot through `contributes.admin.widgets` and passed. Core
  draws those archetypes from the declaration alone, so the admin batched a read
  on every mount and refetch whose result the declared renderer never looks at.

  `querylessQueryProblem` is now the single non-throwing rule, and both the
  registry validator and the boot gate ask it — the same shape `actionProblem`
  already established for shortcut items.

- [#1444](https://github.com/nextlyhq/nextly/pull/1444) [`d990e70`](https://github.com/nextlyhq/nextly/commit/d990e707950654044420c0bfc487354ae744257a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The two channels into the widget registry now agree where they should, and
  differ only where a plugin's version says they must.

  `registerWidget` and `contributes.admin.widgets` had been validating the same
  field values with two rule sets, and four fields came apart one at a time. The
  shared half is now one rule both ask.

  The shared half is deliberately narrow. A contribution crosses a VERSION
  boundary -- a plugin may be built against a newer core -- so a closed-vocabulary
  check applied there aborts a whole plugin install the moment that plugin names a
  size, height or chrome value this core has not learned yet. The admin already
  survives those by falling back. Vocabulary checks are therefore the registry's
  alone, and only version-independent rules are shared: a shortcut missing its
  label or href, a non-finite order, a query that is not an object, and a
  placement rule that runs only for archetypes this core recognises.

  One rule moved the other way: the registry accepted a truthy non-object `query`
  that the contributions gate refused, so it now refuses one too.

  A divergence test records the whole relationship -- the rules both channels must
  agree on, and every difference that is deliberate, each with the reason it is
  not drift.

- [#1485](https://github.com/nextlyhq/nextly/pull/1485) [`f9d4f7b`](https://github.com/nextlyhq/nextly/commit/f9d4f7bfe6a035911be35b8c8f18d9f1d3509c4e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The SQLite bootstrap module imports the storage-format catalog once.

  Two changes landed within seconds of each other, each adding the same import at
  a different line. Neither conflicted, so git kept both and the package stopped
  building on `TS2300: Duplicate identifier 'STORAGE_FORMAT'`.

- [#1512](https://github.com/nextlyhq/nextly/pull/1512) [`a19dcb7`](https://github.com/nextlyhq/nextly/commit/a19dcb7bda1d6e39e7a4fa12ef80424993cc8767) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Patterns, components and layouts are now three stores the page builder ships,
  so a site can keep saved starting points and reusable pieces beside its pages.
  - **Patterns** are copied when you insert them. A pattern carries a title,
    description, category, keywords and a granularity, so the library can be
    browsed and searched rather than scrolled.
  - **Components** are placed by reference, so editing one changes every page
    that carries it. A component may name the Layout area it suits, which is how
    a site header stays out of the ordinary insert list without being a
    different kind of thing.
  - **Layouts** name which component fills each area around a page. Areas are
    rows rather than columns, so adding an announcement bar or a sidebar later
    costs no migration.

  Each store is offered by one sidebar link — the page builder's own — rather
  than also appearing in the automatic collection navigation.

  All three separate saving from publishing: a draft is worked on privately and
  publishing is the single act that ships it. Each appears in the admin behind
  its own read permission, and each accepts only its own kind of document, so a
  page cannot be stored as a pattern.

  A Layout may fill each area only once, so one Layout cannot name two headers
  and leave whatever reads it first to decide which page gets which.

  Plugin menu items may now name the collection they point at, with
  `collection: "patterns"` beside `to`. The item's destination and its read
  permission are then derived from the slug the host actually registered, so a
  `.rename({ patterns: "saved-patterns" })` no longer leaves the link pointing
  at a list that does not exist or gates it on a permission nobody is seeded.

  A menu item naming a collection its plugin does not contribute is refused when
  the plugin is registered, rather than throwing on every admin request once the
  app is already running. An item that names a collection keeps the destination
  it declared — including any list state such as `?status=draft` — and only has
  its collection segment rewritten when a rename actually moves it.

  Creating a document in a blocks field now seeds an empty document of a kind
  that field accepts. Previously it always seeded a page, so a store declaring
  `kinds: ["pattern"]` offered an editor that looked like it worked and a save
  the server refused.

  Nothing yet renders a component instance or resolves a Layout — this is the
  storage and the permissions the rest of the feature is built on. A Layout row
  names no variant yet, because a component has none to name.

- [#1570](https://github.com/nextlyhq/nextly/pull/1570) [`7eca660`](https://github.com/nextlyhq/nextly/commit/7eca660c688323deb39965fd8ba72c247f973faf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Pages is listed once, with the rest of your content.

  The page-builder plugin contributed a "Pages" menu entry pointing at a
  collection the Collections listing already offered, so the same screen appeared
  under two names. The entry is gone; the menu now holds the three libraries —
  patterns, components and layouts — which are the pieces pages are built from and
  are genuinely global.

  It was also a claim the code does not support. The page builder is a FIELD TYPE:
  any collection may declare `blocks` and a Single may too, and nothing in the
  engine, the builder or the plugin knows the slug `pages`. A menu promising that
  the page builder means Pages gets less true the moment a second collection
  declares the field, and nothing would ever have added that one.

  Switching page while building is unaffected — the editor's own left rail carries
  a Pages panel, which is where that job belongs.

  A note repeated in the three library collections is corrected at the same time.
  It claimed two automatic navigation sources reach them and that plugin ownership
  cannot move a duplicate. Only one source reaches them, because the other lists
  `admin.isPlugin` collections and this package never sets that flag; and declared
  PLACEMENT does move a listing, which is the distinction ownership and placement
  are separate questions about.

- [#1532](https://github.com/nextlyhq/nextly/pull/1532) [`02e108d`](https://github.com/nextlyhq/nextly/commit/02e108d6d56ad35b3518a33decc2e55c642cbe28) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard's pending-edit cards obey a collection's stored read rule.

  Entity-level access answers whether a collection is in reach; it does not
  decide which of its documents are. A collection carrying a stored `owner-only`
  or `custom` read rule admits every editor at that check while the ordinary read
  path narrows to a subset — so counting and listing version rows filtered by
  collection name alone reported one author's documents to another, handing back
  their entry ids, languages and the instants they were last edited.

  The cards now ask the ordinary read path which of the candidate documents the
  caller may actually see, rather than reproducing a rule that can be an arbitrary
  function. Singles are asked per language, because a localized Single is a
  different document per language and a rule can answer differently for each. A
  row whose scope is neither a collection nor a single is dropped rather than
  admitted, since nothing can judge it.

  A localized document is authorized per LANGUAGE — collections as well as
  Singles, because a stored rule is a predicate over the collection's own fields
  and a localized field answers differently per language. Rows reach that decision
  one per locale and are collapsed to one per document only afterwards.
  Collapsing first offered each document's newest locale alone: where that one was
  denied and an older one readable, the document vanished from a card its reader
  was entitled to see.

  Nothing sizes the read from configuration either. The row bound used to be the
  install's current locale count, which does not describe the data — working
  drafts written under a locale since removed are still rows — so it could fetch
  too few rows to find the documents asked for while every check said the answer
  was exact. The read is paged instead, and the only bound is how many documents
  the caller wants.

  A pending row for a Single is checked against the live document's id, resolved
  without materializing it. Version rows outlive the documents they describe, so a
  Single deleted and recreated leaves rows naming its predecessor — and the read
  probe goes through a path that auto-creates a missing Single, which would have
  made loading a dashboard perform a write.

  A row whose language is no longer configured, or whose scope kind no longer
  matches the registry, is dropped rather than guessed at: forwarding an
  unconfigured locale silently authorizes the default one, and a slug freed by a
  deleted collection and taken over by a Single would send an orphaned row to a
  read path that cannot answer about it.

  Paged reads use a cursor anchored to the last row read, and order by a unique key
  as well as the instant. `updatedAt` alone is
  not a total order, and paging one with OFFSET can return a row twice and skip
  another, losing a document that nothing downstream can notice is missing.

  That answer cannot be computed in SQL — the rule lives on the collection, the
  candidates live in the version table, and the data layer has no join — so the
  count walks candidates and authorizes them, which is bounded work. Past that
  bound it reports `atLeast` and the card renders `N+`, rather than failing or
  showing a number that is quietly too small.

  It is a floor rather than a refusal because every mechanism that tried to keep
  the promise of exactness past a bound produced a wrong answer instead: a
  document quota could not tell "exactly this many" from "more than this many",
  and a shortcut on documents already seen conflated encountering a document with
  deciding it, since authorization is per language. The bound is also on rows the
  CALLER reads, not on a count of candidates taken before the rules narrow them —
  that made one reader's card depend on data they cannot see, and disclosed which
  side of the threshold that unseen population sat on.

  The count enumerates by row id rather than by recency. `updatedAt` advances
  every time somebody types, so a draft not yet read can move ahead of a
  recency cursor and be skipped for the rest of the walk; a working-draft update
  never rewrites the id.

- [#1534](https://github.com/nextlyhq/nextly/pull/1534) [`3adf2f9`](https://github.com/nextlyhq/nextly/commit/3adf2f9c63ec74abe7cfb2bb84fe17de3854e455) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin READMEs no longer tell you plugins are unavailable. Three plugins ship
  today — the Visual Page Builder, SEO and the form builder — but the form
  builder's README said "Plugins are not ready for use yet" and told you not to
  rely on them in production, which is the page npm shows on the package. Every
  plugin README now carries the same short alpha note and links to the stability
  ladder, so you can see which surfaces are settled and which are still moving.

  `@nextlyhq/admin-css` gains a README; it was published with a blank page on npm.

  The plugin SDK's own source said dashboard widgets were "reserved, not
  rendered". They do render, and are marked experimental only because the
  contribution shape is still settling.

- [#1493](https://github.com/nextlyhq/nextly/pull/1493) [`9ac96d7`](https://github.com/nextlyhq/nextly/commit/9ac96d7b1d1322a1a9f2ed618c09337682d5d7e9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold a collection's handlers back when the metadata sync REPORTS a failure
  after the DDL, not only when it throws.

  The sync answers a per-collection failure by resolving with `errors[]` rather
  than rejecting. The post-DDL landing read only the rejection, so a partial
  failure published handlers and recording policies against a field tree the
  registry had not accepted — the state the rejection branch beside it already
  existed to prevent, reached by the shape it did not catch.

- [#1544](https://github.com/nextlyhq/nextly/pull/1544) [`1e3da4f`](https://github.com/nextlyhq/nextly/commit/1e3da4f88a5288c5148484240daae365387d06d1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing a page says whether its components are live.

  A page and the components it embeds are separate documents with separate
  lifecycles, so publishing the page said nothing about them. The page then drew a
  missing-component marker exactly where the author expected content, and the save
  reported plain success.

  It now reports. Publishing still succeeds — publishing a page before its
  components is an ordinary order of work, and refusing it would block a
  legitimate sequence to prevent a state the author is about to leave anyway — and
  the response carries a notice saying how many embedded components are not live.

  Which states count as published is not decided a second time. The check reads
  the component store under a published scope and treats the ids that do not come
  back as the answer, so the query service keeps owning a rule a project can
  extend with public states of its own. That also collapses two cases worth
  collapsing: an unpublished component and a deleted one leave the same hole, and
  the author's next move is the same for both.

  It asks the renderer's own discovery rather than walking stored documents. That
  is not an optimisation, it is the difference between two questions: reachability
  is decided after an instance's overrides have chosen a component, under the
  composition cap, over the tree the repair pass retained. A walk answers before
  all three, so it names components a visitor never meets — a condition-gated
  instance, slot content the chosen definition discards, an id an override
  replaced — and misses ones it does. `unsuppliedComponentIds` is exported from
  `@nextlyhq/blocks-react` so a caller outside the render can ask the question
  without building a second traversal, which is what this now uses.

  That also settles nesting for free: a published component embedding an
  unpublished one is a hole the renderer meets one level down, and the discovery
  already runs to a fixed point.

  It reads one component field, the one the renderer reads, rather than every
  blocks field a store happens to carry.

  It stays silent where it cannot decide. A localized component store publishes
  per language on a companion row, so a published-scoped read answers for no
  language in particular and would report live components as missing; a notice
  that fires on a case it cannot decide is one authors learn to dismiss. It also
  declines inside a caller-owned transaction, where it would read a database that
  does not yet contain the write it was called for.

  The condition is the state the write LEAVES BEHIND rather than the transition
  into it, so dropping an unpublished component into an already-live page reports
  too — the case a publish-time-only rule would miss. It requires the collection to
  own the Draft/Published lifecycle, because `status` is an ordinary field name a
  project may use for its own vocabulary and the name alone answers nothing. And it
  says nothing on a working-draft save: a pending draft keeps the live parent's
  `status`, so it is indistinguishable from a publish by its own fields while the
  document a visitor loads has not changed at all.

  To make that last one answerable, a write that stores a working draft now stamps
  `_isWorkingDraft` on the document its post-commit hooks receive, not only on the
  response. The read overlay already marked it; a hook could not ask.

  The lookup is chunked. A collection query is clamped to 500 rows and returns a
  subset silently, while a document may reference far more instances than that, so
  one unbounded query would report every published component past the first page
  as unpublished.

  It reads what the adapter actually stored. JSON columns come back as text on
  SQLite and any adapter that stores them that way, and the write path parses them
  after these hooks run — so an object-only check found no documents at all there
  and reported nothing for every page, silently.

  It says nothing for a localized page collection, for the reason it says nothing
  for a localized component store: publication happens per language on a companion
  row whose status the write path deliberately does not merge into the document
  its hooks receive, so the main row answers for no language in particular.

  Bulk writes carry their warnings too. `respondBulk` already emitted them and the
  admin dropped them at the response type, so an author publishing ten pages at
  once was told nothing an author publishing one of them would have been told.
  Both bulk hooks now report through the same presenter single-entry writes use.

  A published component whose stored document cannot be read is no longer reported
  as unpublished. Somebody published it, and republishing cannot repair a
  malformed value — presence and readability are separate questions and the
  resolver already reports them as different reasons.

  The store read clears both identity channels, as the renderer's own component
  read does: an omitted `user` or `req` restores whatever identity the pooled
  reader was booted with, and an `afterRead` hook branching on the caller would
  hand this check a definition the anonymous visitor never sees.

  A warning names the row it is about wherever the server said so, so several
  notices from one bulk write can be told apart.

  A component the discovery cap stopped it from asking about is no longer named as
  unpublished. The page does have a hole there, but nobody failed to publish
  anything, and publishing the named component again cannot repair it.

  A host that pointed the renderer at a different component store, or supplies
  definitions from a custom source, can point the notice at the same store or turn
  it off, and can name the single page field a route renders where a collection
  declares several: the route is configured in the host's app and is not visible from the
  write path, so a redirected renderer would otherwise be judged against a store it
  does not read from.

  Warnings now carry a severity. A post-commit hook could already tell a caller
  that a side effect broke, by raising; there was no way to say something true
  about a write that succeeded, and an advisory sent through the failure channel
  arrives wearing a failure's code. Both travel in one array because they are one
  question to a consumer, and the admin reports them differently: a save with only
  an advisory is no longer phrased as though something failed, and a real failure
  still owns the headline while the advisory travels beside it rather than being
  dropped. Anything not explicitly marked an advisory is treated as a failure, so
  a server that never sends the field cannot have its failures downgraded into
  reassuring language.

  The notice offers no action yet. Publishing the components alongside the page is
  a separate capability, and copy promising an affordance nobody can reach is
  worse than copy promising nothing.

- [#1546](https://github.com/nextlyhq/nextly/pull/1546) [`e5b9788`](https://github.com/nextlyhq/nextly/commit/e5b9788975cc3b8a40853761d0ebcc789850cc52) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The readiness notice reads definitions the way the page renders them.

  Relationship depth is no longer forced to zero. The renderer's component read
  states no depth, so the collection service expands to its default before running
  `afterRead` hooks. Forcing zero handed those hooks bare ids, and a hook whose
  blocks output depends on an expanded relationship then produced a different
  component graph than the page draws — missing an unpublished component, or
  naming one no visitor meets.

  A bulk write's warnings reach a consumer that renders its own feedback. They
  were carried into the built-in toast only, so turning `showToast` off to handle
  them yourself was the one route that could not see them: the presenter being
  opted out of was the only thing reading the array. Post-commit hook failures
  were lost the same way, not just readiness notices.

- [#1537](https://github.com/nextlyhq/nextly/pull/1537) [`674584d`](https://github.com/nextlyhq/nextly/commit/674584d5beff4857f9ad907a37f4538fd7fdaf36) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Whether a page fits its block limit no longer depends on the order a
  component's regions were set up in. When a component offers two regions and a
  page fills one with something larger and one with something smaller, the
  smaller content hands back room the larger one needs — but only after it has
  been placed, so the page was accepted or refused according to which region
  happened to be declared first. The larger content is now tried again once the
  smaller has actually released its room.

- [#1562](https://github.com/nextlyhq/nextly/pull/1562) [`ec1609d`](https://github.com/nextlyhq/nextly/commit/ec1609d656265ba5df8dfde243c3e6441caf3e37) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` no longer records an entity as applied because a snapshot
  mentions it. Registration reads every `*.snapshot.json` in the migrations
  directory and inserts each missing entity with `migrationStatus: "applied"` —
  so a `--step N` run exposed entities belonging to migrations it never reached
  as applied, while their tables may not exist. Nothing downstream could correct
  that: the pending sweep beside it only looks at rows still marked pending, and
  those rows were not.

  Registration now takes the evidence for the claim. A snapshot is read only when
  its migration is recorded applied in `nextly_schema_events`, through the same
  `isFileApplied` query the migrate command already uses to decide what is
  outstanding — so what registers and what executes read one source instead of
  two that can disagree.

  The pairing is by migration GROUP: `runFileMigrations` records `0001_x.sql`
  whether it executed `0001_x.sql` or `0001_x.mysql.sql`, and the snapshot beside
  it is `meta/0001_x.snapshot.json`.

  Omitting the check keeps the previous behaviour, which the development boot path
  relies on deliberately: it applies every pending migration immediately before
  registering, so it has no unapplied snapshot to skip.

- [#1484](https://github.com/nextlyhq/nextly/pull/1484) [`712ef78`](https://github.com/nextlyhq/nextly/commit/712ef789d06ffe3db1db2a7e2ccb011b0d095be1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The SQLite bootstrap reads the field-group registry's name from the catalog
  instead of writing it out.

  Six statements spelled `dynamic_components` as a literal. That is the spelling
  the storage migration renames, and the catalog in `schemas/storage-format.ts`
  is what makes that a rename rather than a search — a literal elsewhere is a
  copy the rename cannot reach. The repository gates on this, and the gate was
  failing on `main`.

  No behavioural change: the constant resolves to the same string today. What
  changes is that it will still resolve correctly after the registry moves.

- [#1471](https://github.com/nextlyhq/nextly/pull/1471) [`56bf9c1`](https://github.com/nextlyhq/nextly/commit/56bf9c1f457877984d5ac9985d73e0816674f951) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A `db:sync` on an existing SQLite database no longer recreates the field-group
  registry a migration moved away from.

  The bootstrap replay added for existing databases ran every statement, including
  `CREATE TABLE IF NOT EXISTS "dynamic_components"`. On a database whose registry
  has been migrated to `dynamic_field_groups` that does not add a spare table:
  `chooseRegistryTable` prefers the legacy spelling whenever it is present, so
  every subsequent read and registration switches to the empty one and every
  migrated component becomes unreachable.

  The registry's `CREATE TABLE` is no longer replayed at all. Its five indexes
  are, retargeted to whichever registry the database actually holds — an
  installation created by the older fallback has none of them, and the rename
  carries that gap across, so `db:sync` still reconciles them. A registry that is
  genuinely absent is created by the system-table service, which resolves the
  spelling before creating rather than writing a fixed name.

  Which registry a database holds is resolved once, through the same catalog
  resolver its readers use, and applied to both the fresh push bundle and the raw
  DDL — so a database holding a migrated registry and no `users` table cannot have
  the legacy spelling created for it by either path. When resolution cannot say,
  neither path names a registry: a CREATE is additive and nothing undoes it.

- [#1553](https://github.com/nextlyhq/nextly/pull/1553) [`cd8ad57`](https://github.com/nextlyhq/nextly/commit/cd8ad57224245aeba568da79f31fe254f137bc17) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop publishing the retired category as an npm keyword.

  `nextly`, `@nextlyhq/plugin-form-builder` and `@nextlyhq/plugin-seo` each
  listed `app-framework`, so the category the project moved away from was
  searchable on npm, where more people meet it than meet the repository.
  `nextly@0.0.2-alpha.62` carries it today.

  The platform keyword becomes `page-builder`, which is the half of the
  descriptor npm had no word for. The two plugins simply drop it: neither is a
  framework, and the keyword was describing the host rather than the plugin.

- [#1458](https://github.com/nextlyhq/nextly/pull/1458) [`6d1c03a`](https://github.com/nextlyhq/nextly/commit/6d1c03a4f0f01d195ec93d3ac89bd6d2eb694b99) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Rows in the tokens and classes panels named things without describing them.

  A token row previewed only colours, so a shadow was an opaque string of
  offsets, a size was a number with nothing to compare it against, and a weight
  looked exactly like a number. Each kind that has a visual form is now drawn as
  the thing it is: a shadow cast, a length measured, a weight and a family set in
  themselves, and a duration shown by taking that long to cross its slot. A
  number and a custom value are still shown as nothing, because neither has a
  form to draw, and no value is previewed unless it can be resolved without the
  site's token table — a reference resolved against the panel would show a colour
  or a size the page does not have.

  A class row named the class and counted the documents using it, and never said
  what the class was for. It now lists the properties the class writes, compiled
  by the engine rather than described a second time here, so what the row claims
  and what the stylesheet carries cannot disagree. Because a class holds styles
  for every state and breakpoint and a row can honestly show one, it shows the
  base and says how many other places the class also sets something rather than
  showing the base as though it were the whole story.

- [#1468](https://github.com/nextlyhq/nextly/pull/1468) [`7560d27`](https://github.com/nextlyhq/nextly/commit/7560d27f18e530bcba51941fccbe5c09b8dc1cb3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A font this installation agreed to store could not be served. The public byte
  route bounded its read with a constant while `security.limits.fileSize` is
  configurable, so a deployment accepting 20mb stored a 12MB font and then
  refused it on every request — permanently, and with a status the author cannot
  act on. The route now reads up to the same number the upload policy allowed,
  which is the only defensible bound: below it the product declines to hand back
  what it took.

  A missing media row is also identified by the cross-realm brand rather than by
  `instanceof`. A route handler and the shared media service can be instantiated
  from different server bundles, and two copies of the package are two distinct
  classes — so an absence raised by the other copy escaped to the generic
  handler, which answers with a structured document, while a present-but-private
  row answers with a blank 404. Telling those two apart is what the route exists
  to prevent.

- [#1462](https://github.com/nextlyhq/nextly/pull/1462) [`db4df47`](https://github.com/nextlyhq/nextly/commit/db4df47dcc7f5627c9f406d0ceecc620bcd53d1a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Settings entry in the admin sidebar now sends each reader to the first
  destination in the panel they can actually open, read off the panel's own
  navigation table rather than a list maintained beside it.

  An operator whose only settings-area grant was `manage-background-jobs` saw
  the Settings entry, followed it, and landed on General Settings — a page whose
  data answers to `manage-settings` and returns 403 — because the landing was a
  hand-written chain of seven destinations that Background Jobs had never been
  added to. Their one reachable screen was never offered.

  A destination is now skipped when its own route is guarded more narrowly than
  the link that shows it, so a reader holding only `read-api-keys` is no longer
  sent to a page that turns them away.

- [#1455](https://github.com/nextlyhq/nextly/pull/1455) [`414d92d`](https://github.com/nextlyhq/nextly/commit/414d92d7fcde43f4209c51308acf96e4b7ab6700) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Margin and padding now read as the box they describe. Instead of four stacked
  rows — Block start, Block end, Inline start, Inline end — the four sides are
  drawn around a small diagram, so which edge each value belongs to is something
  you see rather than something you read.

  The diagram follows the page being edited, not the admin. On a right-to-left
  site the inline start is the right-hand edge, and that is where the control for
  it appears, even while the admin itself is in English. Where the page cannot be
  measured — before the canvas has drawn, or while a block is still loading — the
  four labelled rows are shown instead, because a diagram that might be pointing
  at the wrong edge is worse than words that cannot be.

- [#1448](https://github.com/nextlyhq/nextly/pull/1448) [`9e79e11`](https://github.com/nextlyhq/nextly/commit/9e79e1150550c9ebff34f7feb7fdeb127d9d9911) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder's inspector is easier to read. A property's label now sits
  beside its control instead of above it, so a group of settings fits on screen
  together instead of being scrolled through — and the panel re-stacks on its own
  when you drag the rail narrow.

  Settings offering three short choices, such as font style, are now shown as
  three buttons rather than a menu you have to open to see them.

- [#1466](https://github.com/nextlyhq/nextly/pull/1466) [`b0e7cd0`](https://github.com/nextlyhq/nextly/commit/b0e7cd062b8195b7280f83133bd6e4d740d399ad) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The SQLite bootstrap DDL now creates the indexes it declares, and the three
  schema-registry tables it never created at all.

  This DDL runs where drizzle-kit's push cannot — no TTY, no interactive
  confirmation — so it is the path taken exactly where nobody is watching. A
  missing index breaks no insert; it makes every query against that column a
  scan, which is why fifty of them were declared on all three dialects and
  created on none.

  Forty-three added in total: twenty-eight on tables the bootstrap already
  created, and fifteen on `dynamic_collections`, `dynamic_singles` and
  `dynamic_components`, which are now created too. A UNIQUE constraint the DDL
  already spells inline — on the column, or as `UNIQUE(a, b)` at the end of the
  table — is the same index under a name SQLite chooses, so those are recognised
  rather than emitted a second time; a named index beside one builds a second
  B-tree over the same columns for every write.

  Only `dynamic_singles` was entirely absent — nothing creates it outside tests.
  The other two are created by `SystemTableService`, which the same fallback calls
  next, but from its own hand-written DDL that has 19 columns on PostgreSQL and 21
  on SQLite where the schema declares 25. Those definitions disagree with the
  schema and with each other. The statements added here are generated from the
  Drizzle column configs and run first, so on SQLite the complete definition is
  the one that wins.

  These statements now also reach databases that already exist. The caller
  returned as soon as it saw a `users` table, so the only path that ran them was
  the one taken by a database that did not exist yet — leaving `nextly db:sync`,
  the documented recovery command, unable to supply anything added since an
  install was created. An existing SQLite database is reconciled instead; every
  statement is IF NOT EXISTS, so re-running adds only what is absent. A table
  whose COLUMNS drifted is not repaired this way, since SQLite skips a CREATE
  TABLE wholesale once the table exists.

  The guard that was meant to catch this could not see two of the tables. It read
  the schema SOURCE for a literal table name, and `dynamic_components` is built
  by a factory from a computed one, so it was absent from every comparison and
  passed by absence. It now walks the dialect bundle — the same object graph the
  ORM writes through — and a new integration test executes the DDL against a real
  SQLite database and reads the indexes back, rather than comparing two strings
  drawn from the same repository.

- [#1433](https://github.com/nextlyhq/nextly/pull/1433) [`b4c041d`](https://github.com/nextlyhq/nextly/commit/b4c041d2ef47af8328c82c8998dad6b5f8dff941) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder's chrome now spends its width on the document rather than on
  its own labels, and the page reads as a sheet.

  The canvas declared no background, so it inherited the editor's frame — and a
  block declares none of its own, so the grey showed through the document. What
  an author composed looked nothing like what a visitor loads, which is the one
  thing the canvas exists to show. It now carries the page surface, a border and
  room around it. The border rather than tone alone, because which surface is
  lighter INVERTS between modes: the page is 98.84 against a 96.52 frame in light
  and 0 against 10.68 in dark, so a separation carried on the surfaces would need
  tuning twice and checking twice, while one border token sits outside both on
  either side of that inversion.

  Everything that makes the sheet is stated on the PAGE rather than on the region
  around it, so several side by side — one per breakpoint — would each carry
  their own edge with nothing to revisit.

  Exit, the breakpoint manager and the tier tabs are glyphs now. Together they
  were spending about 170px of a bar whose job is to get out of the way, and
  every one of them kept its accessible name and gained a tooltip.

  A tier's glyph is chosen by the WIDTH it applies at, never by its label. A tier
  is named by the site — "Tablet" on one, "Kiosk" or "Watch" on another — so a
  lookup keyed by name answers for the words somebody happened to use and has
  nothing to say for every site that chose differently.

  The SELECTED tier keeps its word. The width readout beside these tabs is
  deliberately empty while the selection already names the applying tier, so
  icon-only throughout would take the name off the screen entirely in the
  commonest state; two tiers can also share a glyph, and identical pictures would
  then be the only thing telling them apart.

  Zoom gained the stepper that its own model already supported: `steppedZoom` was
  exported with no caller, so stepping was reachable from a host and not from the
  editor. Each direction disables where the step list ends, so a button that
  cannot move says so rather than depressing and changing nothing.

- [#1445](https://github.com/nextlyhq/nextly/pull/1445) [`d9c3e98`](https://github.com/nextlyhq/nextly/commit/d9c3e9897b1e9f62f24d58f0f10ee65a0d2219fb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder says why a block will not go where you aimed it.

  Dragging a block on the canvas used to answer one question — a line showing where
  it would land between its siblings. Everything else was silent. A block gave no
  sign it could be picked up, nothing showed which block was moving once it was,
  and a region that would not accept it simply showed no line at all, which reads
  as the editor not noticing rather than as an answer.

  Dragging now says all of it. A block shows a grab cursor before the press and a
  grabbing one during; the block being moved dims where it sits, so it stays
  readable instead of being replaced by a floating copy; the container that will
  receive the block is outlined, which the line alone cannot say when the same
  coordinate is the bottom edge of one container and the top edge of the next.

  And a refusal explains itself. Dropping a block into a container that will not
  take it shows a "no drop" cursor, outlines that container, gives the reason, and
  follows it with the remedy — so "no" arrives as an instruction rather than as
  nothing happening.

  The three reasons a drop can be refused each get their own wording, because they
  need different things from an author. A slot that admits only certain blocks
  says what it takes. The other two say where the block you are holding is allowed
  to go, which is a different fact and the one you can act on: a block refused by
  a container has not learned anything about that container's appetite, it has
  learned which containers will have it.

- [#1477](https://github.com/nextlyhq/nextly/pull/1477) [`245ef1f`](https://github.com/nextlyhq/nextly/commit/245ef1fbf32cba16fca7e880390e8735655fd130) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard's save-failure alert is legible at its edges.

  Its border was drawn at 40% strength, which composites to 1.69:1 against the
  page -- below the 3:1 a border carrying meaning has to meet. It is drawn at full
  strength now, matching every other error surface in the admin. Nothing else about
  the message changes.

- [#1429](https://github.com/nextlyhq/nextly/pull/1429) [`1e24731`](https://github.com/nextlyhq/nextly/commit/1e2473199ad77041c647dc23b1dc5ed7ad1cf7c8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now says when it is holding work the document does not have.

  The editor takes the whole window and asks the admin to hide its chrome, so
  nothing outside it is on screen while an author is editing. Inside it, the only
  reading was the publish pill — and that pill answers a different question,
  "is this page live?", which has no answer on a collection that declares no
  publish lifecycle. There it renders nothing, correctly, and took the only
  indication of unsaved work down with it. An author editing such a page had
  nothing in the toolbar to read at all, while `documentDirty` was already being
  computed a few lines away.

  Whether work is outstanding and whether the page is live are two questions, so
  they are now two readings. The dirty state is derived once and both read it, so
  they cannot disagree about it.

  The new reading is SILENT when nothing is outstanding, rather than saying
  "Saved". The same `false` is produced by a document that was never saved — a
  blocks field renders inside a create form and inside previews — so a positive
  claim there would tell an author their work was safe on the strength of nothing
  having been typed. That asymmetry is the point: the state worth interrupting
  someone for is the one where leaving loses something.

- [#1441](https://github.com/nextlyhq/nextly/pull/1441) [`c1a1668`](https://github.com/nextlyhq/nextly/commit/c1a1668c5abfe0da38e5f9b27a58d13e80179d84) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page's edit screen now shows the page itself. Where the page-builder field
  previously drew a grey box listing internal block type names — `core/section`,
  `core/text ×3` — it draws a live, read-only miniature of the page, the number of
  blocks it holds, and one clear button into the page builder. An empty page
  invites you to build it rather than reporting that it is empty.

  The miniature uses the same renderer that draws the published page, so what you
  see on the edit screen is what a visitor gets. It waits for your site's own
  styles before drawing, rather than showing a page styled with defaults your site
  does not use.

- [#1549](https://github.com/nextlyhq/nextly/pull/1549) [`e9b505a`](https://github.com/nextlyhq/nextly/commit/e9b505ac5fb922263e336985b1277a8d04b79cf5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The op vocabulary is part of the engine.

  `BuilderOp`, `applyOp`, `applyOps`, `OpError`, `positionOf` and the shapes
  around them now live in `@nextlyhq/blocks-engine` and are re-exported by
  `@nextlyhq/builder` unchanged. Applying an edit is not an editing-surface
  concern: a plugin route, a script or an agent has the same right to the
  operations the editor applies, and each would otherwise grow its own vocabulary
  that agrees with this one only until one of them changed.

  Nothing about the operations themselves changed. The relocation is byte for
  byte, and the existing suite of 202 operation tests runs unchanged against it
  through the builder's re-export — which is the point of leaving those tests
  where they are.

  They live in the engine's own module rather than beside the reserved operation
  names. `format.ts` re-exports those names, and the vocabulary reaches the
  registry and the validators, which pull in a glob matcher and a CSS parser. That
  entry point exists so a generator or a schema publisher does not load the
  validator, the migrations and the style compiler; putting the vocabulary beside
  the names would have pulled all of it through, which its boundary test caught.

  `@nextlyhq/builder/ops` is unchanged and still published: a server action or an
  agent importing it keeps working exactly as before.

- [#1561](https://github.com/nextlyhq/nextly/pull/1561) [`be2018d`](https://github.com/nextlyhq/nextly/commit/be2018d5cd7f75cada63238d4ae5f677f11f065d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The npm listing for `nextly` no longer carries the keyword `framework`. The word
  could mean an application framework, a UI framework or a backend framework, which
  is why the project moved away from it; the GitHub topic had already been cleared
  and the package keyword had not.

- [#1451](https://github.com/nextlyhq/nextly/pull/1451) [`bfc42e8`](https://github.com/nextlyhq/nextly/commit/bfc42e89b262640c0b40c0d63600fc0eefd7e425) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The tokens and classes panels opened with machinery and never said what they
  were for. A mode switch, a DTCG import/export control and eight tabs of
  vocabulary came before any sentence about what a token does to the site, so an
  author who did not already know the concept had nothing to read.

  Each panel now opens with a sentence in the author's words. The tokens panel
  says that every block using a token follows it, on every page, and names the
  mode being edited — a token can hold separate light and dark values, and an
  edit reaches only the one on screen. The
  classes panel says a class is a saved set of styles and that you apply one
  beside the style controls — which explains the split rather than leaving the
  absent create button reading as a missing feature.

  The eight token tabs become one grouped list. A kind with no tokens is now
  absent rather than an empty tab to click into and find nothing, and search
  crosses every kind at once, which the tabs could not do without silently
  crossing the boundary they asserted. Because a list of only non-empty groups
  leaves nowhere to stand to make the first token of a kind, creation now names
  its kind instead of relying on which tab was open.

  Empty states report what is absent, say what belongs there and offer the next
  action. The classes panel's "Not in index" list is the one that most needed it:
  an empty result there is good news, and it used to read as a failure.

  The DTCG import and export control moves below the tokens it operates on.

- [#1543](https://github.com/nextlyhq/nextly/pull/1543) [`4a70c95`](https://github.com/nextlyhq/nextly/commit/4a70c95a9df8657f285b37b87024d9d11be65f2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Index the dashboard's pending-edit reads, and resolve the content registry once per query.

  `nextly_versions` gains `nextly_versions_pending_edits_idx`, covering the
  predicates that define a working draft plus the collection filter and the
  cursor's ordering. Every existing index on that table leads with `scope_kind`,
  which these queries never constrain, so both dashboard cards answered with a
  full table scan: the count's row budget bounded the rows it received and
  nothing about the work the database did to find them.

  The pending-edit walk now resolves the registry and the configured locales ONCE
  per query rather than per page, and derives its candidate collections from the
  same snapshot it judges rows against. A registry that cannot be enumerated is
  reported rather than silently contributing nothing, so the cards refuse instead
  of stating that no document has unpublished edits.

  Core-schema reconciliation now compares INDEXES, not columns alone. The core
  snapshot omitted them, and the diff skips a table whose index data is absent, so
  an index-only release produced no operations at all and `nextly migrate`
  reported the core schema as up to date: the index reached newly created
  databases and no existing one. Partial indexes stay out of the comparison, since
  the snapshot type has nowhere to record a predicate and claiming one
  unconditionally proposed the same index on every run.

  A count that could only establish a floor now renders as one in every archetype
  that draws it; `stats` cells previously formatted the total alone and presented
  a bounded number as exact. A linked stats cell also names its count in the
  link's accessible name — an `aria-label` replaces the element's descendants, so
  a screen reader announced the destination with no number at all.

- [#1419](https://github.com/nextlyhq/nextly/pull/1419) [`f4f464d`](https://github.com/nextlyhq/nextly/commit/f4f464d2ff4dc6492da6890da3b603ac3949a802) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template preview now shows what recipients receive.

  The editor interpolated `{{variables}}` in the browser, which was a second
  implementation of a render the server already performs — and the two had
  drifted. The preview omitted the preheader entirely, and reported an empty
  plain-text part for every template that does not author one, when the send path
  derives that text from the body and delivers it. Both were invisible: a preview
  that leaves something out looks correct.

  The editor now renders through `POST /api/email-templates/preview`, which
  composes a draft with the same function the transport uses, so the two cannot
  disagree. The browser-side copy is deleted rather than kept in sync.

  Also fixed in the renderer itself: a layout row rendering ITSELF resolved
  `{{appName}}` and `{{year}}` against nothing and emitted `<footer> </footer>`.
  Those values were supplied only to a wrapper that a body was spliced into, but
  it is the same markup either way. An explicit value from the caller still wins.

  The preview frame now draws at the 600px width HTML email is authored against
  rather than 640, and scales to fit the pane instead of reflowing the email to a
  width no recipient uses — with the real width and the scale shown, so a frame
  drawn smaller is never mistaken for one at true size.

- [#1418](https://github.com/nextlyhq/nextly/pull/1418) [`bfd8b83`](https://github.com/nextlyhq/nextly/commit/bfd8b8325bbe90d061ea8de5a39bfde0c3658349) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let the preview control keep its name and show its progress. Its menu trigger carried a fixed accessible name, which overrode the label a collection had declared — so a control reading "View page" on screen answered to "Preview options" and to nothing a voice-control user could see. And once copying a link moved into that menu, choosing it closed the menu and took the only spinner with it, leaving a slow mint with no sign it had started. The trigger is now named after the control it belongs to, and it carries the copying state itself.

- [#1438](https://github.com/nextlyhq/nextly/pull/1438) [`b77d772`](https://github.com/nextlyhq/nextly/commit/b77d772a051a22c96c0549d8df831f0dcda7e0e4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `GET /api/jobs` reports what the background queue recently did.

  A background job that fails is invisible. There is no request to inspect, no
  status code and no page that went blank — so a scheduled release that did not
  publish looked exactly like one that was not due yet. The outcome, the attempt
  count and the error were all recorded on the row and readable only with SQL.

  Each row carries a DERIVED status beside its stored state, because the stored
  vocabulary cannot express the distinction that matters most. A job whose attempt
  failed and which will try again is written back as `pending`, indistinguishable
  by state from one that has never run — while `failed` is terminal and means the
  work will not happen without a person. `jobDisplayStatus` separates them from
  the attempt count, in one place, so a client cannot derive a second answer.

  Read-only on purpose: no retry, no cancel, no requeue. Each is a write on
  already-authorized work and needs its own decision about who may perform it,
  and shipping them beside a read would settle those questions by omission.

  Gated on `manage-background-jobs`, the permission the trigger already uses.
  `lastError` carries whatever a handler threw, which is internal detail rather
  than content, and there is no seeded read permission to widen to — inventing one
  would change what preset roles grant as a side effect of adding an endpoint.

  Terminal rows are pruned on the retention window, seven days by default, so this
  is recent history by construction rather than an archive.

  `meta.hasNext` is answered by a probe row rather than stated. Reading one row
  beyond the limit is what proves more exists; a full page cannot, because a queue
  whose length is an exact multiple of the limit would then claim a next page that
  is empty. A monitor that reports itself complete while showing a slice is how an
  operator concludes the failure they are hunting never happened.

  `lastError` is delivered exactly as it was recorded. The response opts out of
  the global timezone rewrite, as the webhook delivery endpoints do: that pass
  rewrites every date-looking string in a payload by value, and a handler that
  surfaces a timestamp as its whole message would have had the debugging record
  altered. The row's own timestamps arrive in UTC, which is the same fallback the
  pass takes when no timezone is configured.

  The recent-jobs ordering index is now created on SQLite, not merely declared.
  A Drizzle index declaration reaches an existing database through nothing —
  core reconciliation compares names and columns only, so index-only drift
  produces no operations — and SQLite's core DDL, which re-runs idempotently, had
  no statement for it. PostgreSQL and MySQL create it on a fresh push; repairing
  an existing installation on those dialects needs a general core index step in
  `nextly upgrade`, which is filed rather than built here.

- [#1415](https://github.com/nextlyhq/nextly/pull/1415) [`7892e77`](https://github.com/nextlyhq/nextly/commit/7892e773b7c3150b355b638c33f2137a8956fda9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The reason a save was refused now stays on screen.

  The message explaining a rejected save sat in the same strip as the variable
  chips, which scrolls once a template declares enough of them — so on those
  templates the explanation could sit just out of view and saving looked silent
  again. The message now has its own row and cannot scroll away.

- [#1435](https://github.com/nextlyhq/nextly/pull/1435) [`2b24391`](https://github.com/nextlyhq/nextly/commit/2b243917a54c527955a4d407428ebd391ff75b13) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The webhook signing secret is now the first thing on the edit page, not the last.

  Setting up an endpoint means copying the signing secret into the receiving
  system. That value sat below every configuration field, so the task a person
  arrives to do was reachable only by scrolling past the form they had not come to
  edit — and on a short window it was not visible at all.

  The secret, its rotation controls and the link to the delivery log now sit in
  one panel under the page header, which is where an integration credential lives
  in every service a developer already uses. Configuration keeps its own reading
  order beneath, and deletion stays at the bottom: the one irreversible act on the
  page is not something to put where a reader lands.

  Nothing changes about who may do what. Rotation was never gated on the update
  permission and still is not, which is pinned by a test so a later reading of
  `canManage` as "may rotate" has to be a deliberate change.

  The create page shows no panel, because an endpoint has no secret until it
  exists.

- [#1439](https://github.com/nextlyhq/nextly/pull/1439) [`cee45fd`](https://github.com/nextlyhq/nextly/commit/cee45fdb0dd8512fecea4d30a9ad3a3cf4d6c15f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The whole dashboard is drawn by one grid.

  Core's four dashboard cards — the seed prompt, collection counts, singles and the
  team summary — are widgets now, registered through the same `registerWidget` door
  a plugin uses and resolved from reserved `core#` component paths. The dashboard
  page mounts a welcome header and the grid; nothing else.

  Until now the grid drew only what plugins contributed, and nothing contributes a
  widget yet, so a real dashboard rendered none of the widget system while the
  cards a user actually saw sat hardcoded above it.

  Two new optional fields make that possible without changing what anyone sees:
  - `defaultOrder` states where a widget sits. Position previously depended on
    which channel a widget arrived through, since registrations resolve after
    contributions. Absent sorts last, so every existing dashboard keeps its order.
  - `chrome: "none"` lets a `custom` widget decline the card frame when it is
    already a designed surface. Refused on every archetype core draws, where the
    card owns the title and the busy state.

  A grid cell whose widget draws nothing now collapses, so a card that hides itself
  leaves no gap.

- [#1555](https://github.com/nextlyhq/nextly/pull/1555) [`01b9ddf`](https://github.com/nextlyhq/nextly/commit/01b9ddfaac42e141005b155f7cd8d9b7da2e32ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two finished dashboard surfaces reached no reader, and both are now cards on the
  widget grid.

  `system:releases` shipped as a registered, access-controlled widget source with
  no widget naming it, so nothing on any dashboard could ask it anything. It now
  backs `core/upcoming-releases`, a list of what is scheduled and not yet shipped,
  soonest first. It is the one core card carrying a `requiredPermission`, because
  `ReleasesService.find` authorizes by throwing: an ungranted reader would get a
  card stuck in its error state rather than an empty one, so the card is hidden
  from them instead — and its placement is kept in the stored layout, so widening
  someone's grant brings the card back where it was.

  The recent-activity feed had an endpoint and a component and nothing rendering
  it; the dashboard drew the welcome header and the grid alone. `RecentActivity`
  is now `core/recent-activity`, which also makes it hideable and reorderable like
  every other card. Two controls on it were removed rather than moved: a
  "Detailed Log" link whose destination was the dashboard the card sits on, and a
  "Sync Previous Events" button with no handler behind it. There is no audit-log
  page for either to point at, and a dashboard feed showing a fixed handful of
  rows with no in-widget pagination is what the products we compared against all
  do. Its chrome now matches the cards beside it.

  A core card names its body as a `core#` string in `nextly` and that string is
  bound to a component in `@nextlyhq/admin`. The two packages do not depend on
  each other, so nothing could notice one naming something the other never
  registered — a card would quietly draw the unresolved placeholder. A test now
  holds the two lists against each other.

  A widget's `requiredPermission` now also accepts an ARRAY, meaning any-of. A
  single slug could not describe the rule the services behind these cards apply:
  `ReleasesService.authorize` treats `create` or `publish` as satisfying `read`,
  deliberately, so a role granted only `create` can see the release it just made,
  and the admin's `canViewReleases` capability lists all three. A card gated on
  the read slug alone was a third encoding of that rule and the only one that
  disagreed. Existing single-slug declarations are unchanged.

  Two shipped list cards selected more fields than the `list` archetype draws. It
  renders the first two and silently ignores the rest, so `core/recently-edited`
  showed a collection beside an opaque document id and never the timestamp, on a
  card whose description promises "newest first". Both now select two, and the
  renderer declares how many it draws so a test can hold declarations to it.

  A widget's permission gate is now decided in ONE place, `nextly/widget-gate` — a
  browser-safe entry point with no imports of its own. The layout endpoint and the
  admin both decide whether a reader may be told a card exists, and they had two
  implementations of that answer: a card the server sends and the browser hides is
  invisible with nothing logged anywhere. The rule is parameterised by how a
  single slug is answered, so the server passes its resolved verdicts and the
  browser passes the session's predicate.

  A contributed any-of gate no longer goes missing. Boot accepted an array through
  the shared validator, but the summary layout resolution reads was built by a
  string-only reader that dropped it — so the layout endpoint saw no gate and
  published the card's id and default placement to every authenticated reader
  while the browser hid it.

  List and table cells are now PRESENTED by the kind their source declared, rather
  than printed. Every source already declares its date fields as dates and that
  declaration stopped at the server, so a row drew `2026-09-01T07:00:00.000Z` on
  cards whose whole subject is when. `WidgetResultField` carries the type, and an
  unrecognised one degrades to plain text rather than refusing the result.

  Relative times on the activity feed update while the card is open. Deriving the
  label at render instead of at fetch was half the repair; a card nobody touches
  gets no renders, so `useNowTick` supplies them.

  Widget date cells honour the admin's configured timezone. General Settings
  carries one and `GeneralSettingsSyncProvider` publishes it to the formatter
  every other admin date already uses, so a cell reading the browser's own zone
  made these cards disagree with the dates beside them for any administrator who
  had set one.

  The admin derives the presentable field kinds from core's
  `WIDGET_SOURCE_FIELD_TYPES` instead of restating them. Hand-keeping the list
  meant core could add a kind, the server emit it, and the browser silently erase
  it on the way in — the cell falling back to raw text with nothing reporting that
  a presentation had been lost.

- [#1447](https://github.com/nextlyhq/nextly/pull/1447) [`801464b`](https://github.com/nextlyhq/nextly/commit/801464b25ec8ba8e92eb79bff13e2d3896f84dc9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Background jobs are visible in the admin, under Settings.

  A job that fails is invisible. There is no request to inspect, no status code
  and no page that went blank, so a scheduled release that did not publish looks
  exactly like one that was not due yet. `GET /api/jobs` made that readable; this
  is the screen that reads it.

  Read-only, and that is the design rather than a first step. Retry, cancel and
  requeue are writes on already-authorized work, each needing its own decision
  about who may perform it, and offering them beside a read would settle those
  questions by omission.

  Failures are stated ABOVE the table, because the question that brings someone
  here is almost always "did the thing I expected happen", and a red row twelve
  lines down is a worse answer than a sentence at the top. The notice is its own
  component and fetches and authorizes for itself, so a release or a webhook page
  can mount it beside the object whose work failed by adding one element. It stays
  silent when nothing failed, when the window is still loading, and for a viewer
  who may not read jobs — a notice that appears routinely is one its reader learns
  to skip.

  A retrying job is deliberately not presented as a failure. It is the system
  healing itself and needs nobody; colouring it like a dead job is the documented
  mistake in queue tooling, which raises an alarm for the harmless case and buries
  the one that matters. `failed` is the only red pill on the screen.

  Two sentences keep the screen honest. It says when the window is truncated,
  because otherwise fifty rows read as the whole story. And it states the
  seven-day retention, because a list that silently forgets is one an operator
  reads as proof a job never ran.

  The grants that reveal the Settings panel are now read off the panel itself.
  A capability list decides whether the rail entry appears at all, separate from
  the gate on each destination inside it, and it was maintained by hand beside the
  navigation table — so Background Jobs was added to one side only, its own gate
  passed, and an operator holding just `manage-background-jobs` was stopped by the
  rail above it, with the page reachable solely by typing its URL and nothing
  erroring to say so. The list is now derived from the navigation, so a
  destination added to the panel reveals it by construction and the same omission
  cannot be made twice.

  Two enumerations of the Settings panel became one. Whether the rail entry
  appears and whether `/admin/settings` opens at all were each maintained by hand
  beside the navigation table, so Background Jobs was added to the panel and to
  neither — and fixing only the first produced a rail entry that led to a page
  which turned the operator away. Both now read the table, so a destination added
  to the panel is both visible and reachable by construction.

  The failure summary asks the SERVER for one task's jobs. It was fetching the
  global recent window and filtering it, which filters rows a busier task has
  already crowded out: mounted beside a release, it would have stayed silent about
  that release's failure whenever webhook deliveries were noisier. The endpoint
  takes a `slug` and narrows in the query, before the limit.

  Which statuses need attention, and which stored states express them, are one
  declaration. A predicate saying "this needs a person" and a list saying "select
  these rows" are the same decision at two layers, and written separately they
  agree only until a second actionable status is added — at which point the list
  goes stale and the database discards the new failures before the predicate can
  see them. The list is now computed from the same table the predicate reads, and
  a test derives that table from the status function rather than trusting it.

  An unknown job state is refused rather than dropped. Dropping looks
  conservative and inverts the request: with every name dropped the filter
  disappears, so `?state=faield` returned a successful read of every state — the
  widest possible answer to a request for a narrower one.

  Job timestamps render through the admin's configured formatter. An installation
  sets a timezone and a date format; a local `toLocaleString` reads the browser's
  instead, so the same instant appeared two different ways on one page and nothing
  said so.

  The table narrows on the SERVER too. Once the summary started asking the
  database for failures, a locally-filtered table could show nothing under a
  notice reporting one — the two halves of one screen disagreeing, because only
  one of them had asked. Choosing a status now sends the stored states that can
  produce it, and the client separates only the statuses that share a state.

  "Needs attention" is total over wire strings. A newer server can send a status
  this build has never heard of, which `jobStatusPresentation` already degrades
  for; the predicate indexed its table directly and threw on that key, taking down
  the page whose job is to report that something is wrong. It answers false for an
  unfamiliar status, so the summary keeps two rules rather than one: a status the
  core calls actionable is kept, and so is one this build does not recognise —
  because the rows a stale client would otherwise drop are exactly the new kind of
  failure nobody has seen yet. What it drops is only what it knows to be quiet.

  A failed job is described as terminal, not as having spent its attempts. The
  runner returns terminal immediately when the identity it would run as is gone,
  so a job can reach that state on its first attempt, and telling an operator the
  retries were exhausted sends them looking for a backoff that never happened.

  An expanded error keeps an operable label. Hiding every child of the disclosure
  on open left an empty control — nothing to click to collapse it and nothing for
  a screen reader to announce.

  It also asks for FAILURES rather than sifting recent rows. A window is the most
  recent N jobs, so N healthy ones running after a failure push it out — and a
  summary that looked inside that window would report nothing wrong with the
  confidence of a check it never performed. The endpoint takes stored states, and
  the core publishes which of them need attention.

  A long error is readable without a mouse. A clipped line with the full text in a
  `title` is unreachable on touch, which is where a queue often gets checked; a
  long error is now a native disclosure, operable by pointer, touch and keyboard.

  A failed read no longer looks like a healthy queue. When the request errors
  there is no data, and rendering nothing there is exactly what "nothing failed"
  renders — telling an operator that nothing needs attention when the truth is
  that nothing could be checked. It now says the queue could not be read.

  Retention is presented as the DEFAULT, not as the installation's policy. A host
  passing `retentionMs` to `runJobsPass` keeps rows for another period, and `null`
  disables pruning entirely; nothing on the read path can see which was chosen, so
  a flat "removed after 7 days" is a claim the screen cannot support — and this is
  the sentence operators are meant to trust about absent rows. The number itself
  now comes from the core's own constant, moved to a leaf module so a client
  importing it does not pull the Direct API graph along with it.

  "Needs attention" is asked of the core's `jobNeedsAttention` rather than
  compared against `failed` here, so a second actionable terminal state cannot be
  silently omitted from the notice while the exhaustive presentation map goes on
  compiling.

  A due time reads the schedule as well as the retry. `runAt` is when a job asked
  to run and `nextAttemptAt` is when a failed one will try again; reading only the
  second showed a dash for a scheduled release, which is the case that brings
  someone to this screen.

  The failed-job reason stays in the narrow render. `hideOnMobile` removes a
  column from the card view rather than truncating it, so marking the error text
  that way left a phone showing that a job failed with no way to read why.

  The status vocabulary is imported from the core rather than restated. `nextly`
  now publishes `nextly/api/jobs-list-types`, and the wire item is DERIVED from
  the row the route emits, so a field or a status added on the server reaches the
  admin's types without a second edit — and an unfamiliar status still renders
  verbatim rather than blank, for a server ahead of the client.

- [#1520](https://github.com/nextlyhq/nextly/pull/1520) [`9f8aaec`](https://github.com/nextlyhq/nextly/commit/9f8aaeccf015bd3790a4577084334a206cd37835) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The dashboard can show what ships next: `system:releases` is the first widget
  source answered by a domain service rather than compiled to a collection query.

  Asking for it honestly needed one change underneath. `findReleases` ordered
  recent-first, which is right for "what happened" and wrong for "what is coming":
  a limited query for the next few releases returned the FURTHEST OUT ones, with
  real rows in a plausible order and nothing in the result to say so. It now takes
  an `order` option, defaulting to the existing recent-first behaviour so no
  current caller changes, and NULLS LAST is stated in both directions — the
  default differs per dialect, so an unscheduled draft would otherwise be the
  "next release" on some databases and not others.

  The card asks a fixed question and refuses a `where` or `sort` rather than
  accepting one and discarding it, publishes three of the release row's eleven
  columns, and hands the releases service the caller so that service's own
  `authorize` remains the only rule deciding which releases anyone sees.

  Two fixes to the source machinery itself. `POST /api/dashboard/query` decided a
  system source was usable from its KIND alone, which admitted one nothing had
  registered a resolver for — and every message past that point is specific, so an
  undeclared field was answered in detail for a registered source and generically
  for an invented one, distinguishing the two. The endpoint now asks the executor
  the same question the executor asks, from one shared implementation. And the
  boot-time registry reset cleared the widget sources without clearing their
  resolvers, so a removed or renamed system source left its resolver addressable
  for the process lifetime, holding whatever its closure captured.

- [#1452](https://github.com/nextlyhq/nextly/pull/1452) [`58edba2`](https://github.com/nextlyhq/nextly/commit/58edba2fba1df9e4c03b8dd03506e5ea3e7bfb17) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Three follow-ups to the widget contract boundary.

  `chrome` is a string in every version, and moving its closed vocabulary to the
  registry took the shape check with it -- so `chrome: 42` was published as a
  `WidgetChrome`. The renderer treats anything but `"none"` as `"card"`, so it
  rendered and boot said nothing about a configuration its author got wrong.

  The divergence rows now name the diagnostic they exist for. A fixture can
  violate more than one rule -- `{ defaultSize: "sm", minSize: "xl", maxSize: "sm" }`
  breaks both size orderings -- so a row could stay green when its own rule was
  deleted and another caught the input.

  And an acceptance case for `{ component, chrome: "none" }` with no archetype,
  which is the typed and renderable form: resolution supplies `custom`, where
  `"none"` is legal. Nothing else exercised that standing through the chrome rule.

- [#1491](https://github.com/nextlyhq/nextly/pull/1491) [`332677c`](https://github.com/nextlyhq/nextly/commit/332677c986a4f127ead48d8b5a46bac172ad91b2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Name an entry the same way on every surface, and announce a refused schema
  change only where the metadata actually moved.

  Three spellings of "is this value a usable title" disagreed: one accepted a
  whitespace-only string, one refused a number, and one refused a bigint. A
  collection whose title field held an invoice number was named by it in the
  editor and by its id on the page comparing its versions. There is now one rule,
  `readableTitleText`, and the three callers ask it.

  The dashboard's recent-entries projection also named fewer candidates than the
  heading walk considers, so `label`, `subject` and `heading` were absent from
  every real read and could never be reached. It now spreads from the same list
  the walk reads.

  The widget source refresh no longer announces a deferral on a reload that
  carries only a refused change: that path skips the metadata sync by design, so
  its registry still describes the unchanged table, and announcing one withheld
  generated cards that were working.

- Updated dependencies [[`cb1b289`](https://github.com/nextlyhq/nextly/commit/cb1b289248e7c4f5727f39f6d3dd7ed8549a6e5b), [`94dfbba`](https://github.com/nextlyhq/nextly/commit/94dfbba63ddf1747e5a087d942b5f591485fcc79), [`9a4bfb5`](https://github.com/nextlyhq/nextly/commit/9a4bfb5feec8a06cdc51ea8c60c8fe5bd7197891), [`0e9c097`](https://github.com/nextlyhq/nextly/commit/0e9c0976c1fd9913a1c681f9f60bb38fa2ae6878), [`b971f66`](https://github.com/nextlyhq/nextly/commit/b971f66ecef7646ff2f25b94df2688111b96f354), [`035e9fd`](https://github.com/nextlyhq/nextly/commit/035e9fd034d4d2ac6fb61e4aca416a7d67e764f3), [`cd44127`](https://github.com/nextlyhq/nextly/commit/cd44127699efb1ee427c9b5556621083c816e760), [`da22b42`](https://github.com/nextlyhq/nextly/commit/da22b429de19dde65b77e85e88620e4f58175fe3), [`163337e`](https://github.com/nextlyhq/nextly/commit/163337ef4aef901d1b66c240469882c2dad16d80), [`d7d924a`](https://github.com/nextlyhq/nextly/commit/d7d924a7a34dc370045115fe57f5c4f4d917d321), [`ec7cd63`](https://github.com/nextlyhq/nextly/commit/ec7cd63eea740373186d64b973cee0a716037a7c), [`9804e9d`](https://github.com/nextlyhq/nextly/commit/9804e9d64b22585db519950c854348ba9fea3974), [`a853ca4`](https://github.com/nextlyhq/nextly/commit/a853ca4694a70831ec6af073dede9ff750d611f3), [`954b1f0`](https://github.com/nextlyhq/nextly/commit/954b1f03121e920e1b0c5b09511cfd5b8e71d3ba), [`976ae33`](https://github.com/nextlyhq/nextly/commit/976ae3303ef7ef4aebb76ddd73a490fe1677b76c), [`270761c`](https://github.com/nextlyhq/nextly/commit/270761c23811a2b127df645ca7bfeb87cc1c8557), [`1ca360b`](https://github.com/nextlyhq/nextly/commit/1ca360b9c7565e9944523fab640a7368b6bee25a), [`2cfabb1`](https://github.com/nextlyhq/nextly/commit/2cfabb19a7b326e73ebe750886dc8b66babde54c), [`c38ac4a`](https://github.com/nextlyhq/nextly/commit/c38ac4aa5ebdc779f87deb2d19b01f1a3e21ac49), [`2450aa6`](https://github.com/nextlyhq/nextly/commit/2450aa6a30545c66fee55fd86ec07cff2e128a4f), [`523e95f`](https://github.com/nextlyhq/nextly/commit/523e95f429fe4f6f16f01d87a44379582626077c), [`890d811`](https://github.com/nextlyhq/nextly/commit/890d8113e59c06a625d1ce825472049b298b4f9a), [`56bfd93`](https://github.com/nextlyhq/nextly/commit/56bfd93ea828a344273b9c9254780cf0ee8bf7d7), [`3d8cb12`](https://github.com/nextlyhq/nextly/commit/3d8cb129507cc5699922d45c1fe9988d6c748d70), [`fc42c6c`](https://github.com/nextlyhq/nextly/commit/fc42c6cd714d697567e94ad93a7f2203e4fb1599), [`8a326cd`](https://github.com/nextlyhq/nextly/commit/8a326cddb900bc5055f7cabe901df7cf2c69c190), [`f535b3d`](https://github.com/nextlyhq/nextly/commit/f535b3db7a8a43cfbc640b986f2b84c4c438b593), [`d009a1c`](https://github.com/nextlyhq/nextly/commit/d009a1c8e27231cf579df51d38d6379b01c1da61), [`bdbf505`](https://github.com/nextlyhq/nextly/commit/bdbf5058c6cf3fa6dab1b737124dc2803d56e622), [`56031de`](https://github.com/nextlyhq/nextly/commit/56031de49b5b093b3c896cd6749d90125d8f0882), [`2e9b56d`](https://github.com/nextlyhq/nextly/commit/2e9b56d0d776dda469020d71f200ac1ed253e7cf), [`1f75ca8`](https://github.com/nextlyhq/nextly/commit/1f75ca8067ac7986a4707649e13b3036f27aad0a), [`8ff06f9`](https://github.com/nextlyhq/nextly/commit/8ff06f92d61e7a82ebb1513d20e72b5e3f6d28e2), [`e60cdae`](https://github.com/nextlyhq/nextly/commit/e60cdaee78bf7d6e2dacea40144a90a8beb6fb8c), [`35bca3e`](https://github.com/nextlyhq/nextly/commit/35bca3ecfb6e50eb357a9faccf78dd592830a3e8), [`c2f01c6`](https://github.com/nextlyhq/nextly/commit/c2f01c621750664a4467bb05fa33aee097f5ce93), [`cd67a66`](https://github.com/nextlyhq/nextly/commit/cd67a66e9b00b1b50f205d68034c19b3419003bf), [`677ae93`](https://github.com/nextlyhq/nextly/commit/677ae93c74e5cc4ef1ecffd5baf02bebf5ac9216), [`2a25b1e`](https://github.com/nextlyhq/nextly/commit/2a25b1ecdfe1dc3c5d91c3690546888be8489536), [`b33a09d`](https://github.com/nextlyhq/nextly/commit/b33a09dd59e6f3f1454dd574cff782cd9e6799df), [`0de476f`](https://github.com/nextlyhq/nextly/commit/0de476fd4ed7cfccc25b93036423ab41887b83de), [`e8ee9d5`](https://github.com/nextlyhq/nextly/commit/e8ee9d5bffcdf1f753c1b0ee5641263be326ae52), [`644cd82`](https://github.com/nextlyhq/nextly/commit/644cd82f77d43c6e28937bf5100254313505ed6a), [`cabf1ba`](https://github.com/nextlyhq/nextly/commit/cabf1ba5fbc3bd4abe8c417467d933af053044c4), [`012c59f`](https://github.com/nextlyhq/nextly/commit/012c59f918cc0b1a779a412b790dd91eb280172d), [`55bf5d1`](https://github.com/nextlyhq/nextly/commit/55bf5d1ac4985e9a418bef297a6c02365691b3da), [`93d3651`](https://github.com/nextlyhq/nextly/commit/93d3651ded63f07655becea60a51d07a6b14de0d), [`5a18cb0`](https://github.com/nextlyhq/nextly/commit/5a18cb07e8dce79255d7c102b97822457c15dcca), [`bb10eaf`](https://github.com/nextlyhq/nextly/commit/bb10eaf906333e42696b9f65ac217f0dad5f90c6), [`5eab012`](https://github.com/nextlyhq/nextly/commit/5eab012263d3a0cf46a404510f543ee8884294c6), [`6af9888`](https://github.com/nextlyhq/nextly/commit/6af9888fe5bf829e5775c3de14d80791e4a52353), [`586951f`](https://github.com/nextlyhq/nextly/commit/586951f90200da183bfa00dafceed00614dc9c4b), [`43ffe9b`](https://github.com/nextlyhq/nextly/commit/43ffe9b0a267ec6dd973c1c2dc5b1658c9e7a2f9), [`b3532bd`](https://github.com/nextlyhq/nextly/commit/b3532bd5180e85e2e4585fc7503060df36127de3), [`8527d85`](https://github.com/nextlyhq/nextly/commit/8527d8510672eee4db98fc9455bfe4e2bb825dc8), [`6a0ebf9`](https://github.com/nextlyhq/nextly/commit/6a0ebf932466fd75234fb0906bc6dd979d0930bc), [`ebe163c`](https://github.com/nextlyhq/nextly/commit/ebe163cfb9febeb5ca592c378566b42878510030), [`dafbc83`](https://github.com/nextlyhq/nextly/commit/dafbc835cde8119d3bd99c3b19ff9bf076941b18), [`175b31e`](https://github.com/nextlyhq/nextly/commit/175b31eff640d9cbe9404cceb6c227dfdd3a3d98), [`dbf2d0e`](https://github.com/nextlyhq/nextly/commit/dbf2d0e995f62f80f888815be4fe0d3fce53f455), [`c585ddd`](https://github.com/nextlyhq/nextly/commit/c585ddd4616302fe909475110dfd1fa693130248), [`333ecc5`](https://github.com/nextlyhq/nextly/commit/333ecc5d46cbb46439e1985fa312d12a0d68a28d), [`48cb708`](https://github.com/nextlyhq/nextly/commit/48cb708dc9994e5c4e0f8a632027298cdcbe477a), [`0ae809b`](https://github.com/nextlyhq/nextly/commit/0ae809bb20216966a15b7aa0e7f4754c1f15846a), [`71d2563`](https://github.com/nextlyhq/nextly/commit/71d2563bd0020c10f0b191c79ce4715834784fb7), [`45e58b2`](https://github.com/nextlyhq/nextly/commit/45e58b2897071b6d7f914a6aabb0af57fdd1bbd9), [`070cb7b`](https://github.com/nextlyhq/nextly/commit/070cb7ba01510c5c924070c5e39cc6c3c0a7ef34), [`0ae809b`](https://github.com/nextlyhq/nextly/commit/0ae809bb20216966a15b7aa0e7f4754c1f15846a), [`bec0a02`](https://github.com/nextlyhq/nextly/commit/bec0a02dafdcead5bf5c95da73dc7472076b693d), [`bde930a`](https://github.com/nextlyhq/nextly/commit/bde930a70492d9bbcebc5fa48166bccb4fad6916), [`afb9daa`](https://github.com/nextlyhq/nextly/commit/afb9daa5e201bd8e382ea5cb86c2c4de4a59c651), [`7eeb8e4`](https://github.com/nextlyhq/nextly/commit/7eeb8e4dc94991d3794f6a9ea5d380e3985050f5), [`2dd62dc`](https://github.com/nextlyhq/nextly/commit/2dd62dc69ddd89d927fc4bdcb4bc5104caa94754), [`912c54d`](https://github.com/nextlyhq/nextly/commit/912c54dbb03b4aadbd048a3bd7b745b5cfc132ea), [`079bcb1`](https://github.com/nextlyhq/nextly/commit/079bcb15a70e35b76484f941b81be57e6cf41ac3), [`0e104e3`](https://github.com/nextlyhq/nextly/commit/0e104e3ec8a5bef63c7d7a59cc7d3e52e957df0d), [`acce8fa`](https://github.com/nextlyhq/nextly/commit/acce8fafcb8cd32dd18fbf4d22fb9269a1a61203), [`31be0c4`](https://github.com/nextlyhq/nextly/commit/31be0c43473c72e626622631a22a873b035a7738), [`a416256`](https://github.com/nextlyhq/nextly/commit/a416256b7d48000b874fcea91e83256a92a5023b), [`3059b32`](https://github.com/nextlyhq/nextly/commit/3059b329754db1ca9b65394cc8cda25cf33cb199), [`123b6b7`](https://github.com/nextlyhq/nextly/commit/123b6b761b9c37b18ee724353bc0738d02fd73e8), [`25f3eb0`](https://github.com/nextlyhq/nextly/commit/25f3eb0a9db36fc88ca6583a7550b24cfd741404), [`5f78af3`](https://github.com/nextlyhq/nextly/commit/5f78af3b16dc3072bbf6d3e491fd884a7cf61f01), [`d990e70`](https://github.com/nextlyhq/nextly/commit/d990e707950654044420c0bfc487354ae744257a), [`f9d4f7b`](https://github.com/nextlyhq/nextly/commit/f9d4f7bfe6a035911be35b8c8f18d9f1d3509c4e), [`a19dcb7`](https://github.com/nextlyhq/nextly/commit/a19dcb7bda1d6e39e7a4fa12ef80424993cc8767), [`7eca660`](https://github.com/nextlyhq/nextly/commit/7eca660c688323deb39965fd8ba72c247f973faf), [`02e108d`](https://github.com/nextlyhq/nextly/commit/02e108d6d56ad35b3518a33decc2e55c642cbe28), [`3adf2f9`](https://github.com/nextlyhq/nextly/commit/3adf2f9c63ec74abe7cfb2bb84fe17de3854e455), [`9ac96d7`](https://github.com/nextlyhq/nextly/commit/9ac96d7b1d1322a1a9f2ed618c09337682d5d7e9), [`1e3da4f`](https://github.com/nextlyhq/nextly/commit/1e3da4f88a5288c5148484240daae365387d06d1), [`e5b9788`](https://github.com/nextlyhq/nextly/commit/e5b9788975cc3b8a40853761d0ebcc789850cc52), [`674584d`](https://github.com/nextlyhq/nextly/commit/674584d5beff4857f9ad907a37f4538fd7fdaf36), [`ec1609d`](https://github.com/nextlyhq/nextly/commit/ec1609d656265ba5df8dfde243c3e6441caf3e37), [`712ef78`](https://github.com/nextlyhq/nextly/commit/712ef789d06ffe3db1db2a7e2ccb011b0d095be1), [`56bf9c1`](https://github.com/nextlyhq/nextly/commit/56bf9c1f457877984d5ac9985d73e0816674f951), [`cd8ad57`](https://github.com/nextlyhq/nextly/commit/cd8ad57224245aeba568da79f31fe254f137bc17), [`6d1c03a`](https://github.com/nextlyhq/nextly/commit/6d1c03a4f0f01d195ec93d3ac89bd6d2eb694b99), [`7560d27`](https://github.com/nextlyhq/nextly/commit/7560d27f18e530bcba51941fccbe5c09b8dc1cb3), [`db4df47`](https://github.com/nextlyhq/nextly/commit/db4df47dcc7f5627c9f406d0ceecc620bcd53d1a), [`414d92d`](https://github.com/nextlyhq/nextly/commit/414d92d7fcde43f4209c51308acf96e4b7ab6700), [`9e79e11`](https://github.com/nextlyhq/nextly/commit/9e79e1150550c9ebff34f7feb7fdeb127d9d9911), [`b0e7cd0`](https://github.com/nextlyhq/nextly/commit/b0e7cd062b8195b7280f83133bd6e4d740d399ad), [`b4c041d`](https://github.com/nextlyhq/nextly/commit/b4c041d2ef47af8328c82c8998dad6b5f8dff941), [`d9c3e98`](https://github.com/nextlyhq/nextly/commit/d9c3e9897b1e9f62f24d58f0f10ee65a0d2219fb), [`245ef1f`](https://github.com/nextlyhq/nextly/commit/245ef1fbf32cba16fca7e880390e8735655fd130), [`1e24731`](https://github.com/nextlyhq/nextly/commit/1e2473199ad77041c647dc23b1dc5ed7ad1cf7c8), [`c1a1668`](https://github.com/nextlyhq/nextly/commit/c1a1668c5abfe0da38e5f9b27a58d13e80179d84), [`e9b505a`](https://github.com/nextlyhq/nextly/commit/e9b505ac5fb922263e336985b1277a8d04b79cf5), [`be2018d`](https://github.com/nextlyhq/nextly/commit/be2018d5cd7f75cada63238d4ae5f677f11f065d), [`bfc42e8`](https://github.com/nextlyhq/nextly/commit/bfc42e89b262640c0b40c0d63600fc0eefd7e425), [`4a70c95`](https://github.com/nextlyhq/nextly/commit/4a70c95a9df8657f285b37b87024d9d11be65f2d), [`f4f464d`](https://github.com/nextlyhq/nextly/commit/f4f464d2ff4dc6492da6890da3b603ac3949a802), [`bfd8b83`](https://github.com/nextlyhq/nextly/commit/bfd8b8325bbe90d061ea8de5a39bfde0c3658349), [`b77d772`](https://github.com/nextlyhq/nextly/commit/b77d772a051a22c96c0549d8df831f0dcda7e0e4), [`7892e77`](https://github.com/nextlyhq/nextly/commit/7892e773b7c3150b355b638c33f2137a8956fda9), [`2b24391`](https://github.com/nextlyhq/nextly/commit/2b243917a54c527955a4d407428ebd391ff75b13), [`cee45fd`](https://github.com/nextlyhq/nextly/commit/cee45fdb0dd8512fecea4d30a9ad3a3cf4d6c15f), [`01b9ddf`](https://github.com/nextlyhq/nextly/commit/01b9ddfaac42e141005b155f7cd8d9b7da2e32ac), [`801464b`](https://github.com/nextlyhq/nextly/commit/801464b25ec8ba8e92eb79bff13e2d3896f84dc9), [`9f8aaec`](https://github.com/nextlyhq/nextly/commit/9f8aaeccf015bd3790a4577084334a206cd37835), [`58edba2`](https://github.com/nextlyhq/nextly/commit/58edba2fba1df9e4c03b8dd03506e5ea3e7bfb17), [`332677c`](https://github.com/nextlyhq/nextly/commit/332677c986a4f127ead48d8b5a46bac172ad91b2)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.63
  - @nextlyhq/blocks-react@0.0.2-alpha.63
  - @nextlyhq/plugin-sdk@0.0.2-alpha.63
  - @nextlyhq/ui@0.0.2-alpha.63

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

- Updated dependencies [[`0a3ea83`](https://github.com/nextlyhq/nextly/commit/0a3ea834a9d57c4ab659e6f67d6d37971f842223), [`067a435`](https://github.com/nextlyhq/nextly/commit/067a435c4b2e6bf56118e4b2f9b8009000cd25f1), [`bc7d846`](https://github.com/nextlyhq/nextly/commit/bc7d8464e6bddf2b901d2857ed3667c6ed5be464), [`8fa8293`](https://github.com/nextlyhq/nextly/commit/8fa8293ece897161417b36f3f5cabb1ae4bfb7a3), [`36d6ab2`](https://github.com/nextlyhq/nextly/commit/36d6ab2a1f57f16233ffd3204b1dcf5943971e1e), [`0bb454b`](https://github.com/nextlyhq/nextly/commit/0bb454b7fcc84a76390617b63906ddc6ff836b57), [`4e13096`](https://github.com/nextlyhq/nextly/commit/4e13096b7b273ae395f14d89fa84220eb9fc7d63), [`665ec46`](https://github.com/nextlyhq/nextly/commit/665ec46383b19bb84569da756d58000d2942120c), [`5761c64`](https://github.com/nextlyhq/nextly/commit/5761c6482449e9a6df6b62f8900bc43c2a1220ce), [`db55e6f`](https://github.com/nextlyhq/nextly/commit/db55e6f2c59f6460e9d3c621f2218580c44b8324), [`faf5e20`](https://github.com/nextlyhq/nextly/commit/faf5e20fb796b6b3e6500fca5f6576514430dad6), [`a07bada`](https://github.com/nextlyhq/nextly/commit/a07bada13a805eaec28c895960d81232482f8917), [`bfc0785`](https://github.com/nextlyhq/nextly/commit/bfc0785dc74053cc4db5d8537a9b653c82354f8d), [`34668e6`](https://github.com/nextlyhq/nextly/commit/34668e612fc47810fddd7a2a9a40f55f68ce6be5), [`59b6196`](https://github.com/nextlyhq/nextly/commit/59b6196870033d6df0be0be9a54def73729612c6), [`566e880`](https://github.com/nextlyhq/nextly/commit/566e880fa57e1c774662655fec59befb45fff7b2), [`efac6c8`](https://github.com/nextlyhq/nextly/commit/efac6c8e7857a86c3789627802c6954d0ee3585f), [`5d03c89`](https://github.com/nextlyhq/nextly/commit/5d03c89d0a5eace30f8e1bdc6f8ea0e412bac87e), [`8999a12`](https://github.com/nextlyhq/nextly/commit/8999a1201cf1b1538d7cd3e7bcdbd783f767f2f9), [`db6c595`](https://github.com/nextlyhq/nextly/commit/db6c595b634c82633e4009223f85b30d48d17065), [`15aa6b6`](https://github.com/nextlyhq/nextly/commit/15aa6b6f653c3f23ff7fb6d6bcc2dc9a376bfe8e), [`408464e`](https://github.com/nextlyhq/nextly/commit/408464e584e83e33510e9d487f142566bb65b054), [`0d6c261`](https://github.com/nextlyhq/nextly/commit/0d6c261703ea43a8688ceab5218ccd24c9d089f0), [`a0aea91`](https://github.com/nextlyhq/nextly/commit/a0aea917f759b9911ef7ddc2b211b4aef5b82797), [`abbc142`](https://github.com/nextlyhq/nextly/commit/abbc142cb17404f9c76b5d68b9081af56d49b4cd), [`406a172`](https://github.com/nextlyhq/nextly/commit/406a17275292c2622dfc16d65806d965264b387e), [`ffc2a04`](https://github.com/nextlyhq/nextly/commit/ffc2a04de9f689dd7d4409d8553e59a340e32c29), [`62763e8`](https://github.com/nextlyhq/nextly/commit/62763e89b731fdfc555b774cfaad6c29db264209), [`f8048b0`](https://github.com/nextlyhq/nextly/commit/f8048b054ad720c99726d75eb1cd16c6b5eb3ab5), [`592f074`](https://github.com/nextlyhq/nextly/commit/592f0740b8e99e2349c23bd64ec89456341dfbd4), [`27d9b12`](https://github.com/nextlyhq/nextly/commit/27d9b12b868e2364e275d50d65c8929e2b12fea7), [`d0ae5d1`](https://github.com/nextlyhq/nextly/commit/d0ae5d1e7cda45537b7af66b154501a273dd8034), [`330e917`](https://github.com/nextlyhq/nextly/commit/330e917a6e1117ee40975dcb758cdf4ac177c12c), [`b54a77a`](https://github.com/nextlyhq/nextly/commit/b54a77aab30e113500a8f3854cd316f9ce601dae), [`c3e6028`](https://github.com/nextlyhq/nextly/commit/c3e60283118eb6e82c2187caa7e9eec923e6f5d8), [`86f6a40`](https://github.com/nextlyhq/nextly/commit/86f6a40e98296793a23c575d848299ea6c7621ed), [`8a3a64e`](https://github.com/nextlyhq/nextly/commit/8a3a64e1991daf4d7c3fc9bd8f2f99ed61a1e580), [`d283f53`](https://github.com/nextlyhq/nextly/commit/d283f53112767dae2e6340fc1f5a8e7e021407c7), [`a5efcd7`](https://github.com/nextlyhq/nextly/commit/a5efcd75f8558116daf6b1241a2d5db4fb3528c4), [`b8d460d`](https://github.com/nextlyhq/nextly/commit/b8d460db1ce0f3c57cbcb7c4cd75b79c41063196), [`60e1c83`](https://github.com/nextlyhq/nextly/commit/60e1c8384c708819ae7bd3534373318d83d73d0f), [`1867585`](https://github.com/nextlyhq/nextly/commit/1867585468db8ba7891ab3e908ca8d98c7f4dbdc), [`b1f2b7b`](https://github.com/nextlyhq/nextly/commit/b1f2b7bce4fe6d0e8b11d93e1538a32a99370601), [`a430cd6`](https://github.com/nextlyhq/nextly/commit/a430cd6c6a116ecaed8640ce4b4af4b9cefcf037), [`15e5315`](https://github.com/nextlyhq/nextly/commit/15e53150740350e52af69ebb936e892f5d303066), [`d6d7c57`](https://github.com/nextlyhq/nextly/commit/d6d7c5749fbe85b2b50bc22c84649833ad630c98), [`07c615d`](https://github.com/nextlyhq/nextly/commit/07c615d2300434e19aa34b41a813e79e9ffdc9cf), [`b93f913`](https://github.com/nextlyhq/nextly/commit/b93f9138e4ded8482b4097adafc88f3df75982d8), [`519c0ed`](https://github.com/nextlyhq/nextly/commit/519c0ed89e00a27607e6c510378723a50c99ada1), [`5c78e6f`](https://github.com/nextlyhq/nextly/commit/5c78e6f9a93a962f166891fb9b26dff5cf46bfea), [`5ea2963`](https://github.com/nextlyhq/nextly/commit/5ea2963e8533a9217fa7db5f6071301b8f7a985b), [`3ddb334`](https://github.com/nextlyhq/nextly/commit/3ddb334f62f935004907234b7839de558e8a62f8), [`d70c83b`](https://github.com/nextlyhq/nextly/commit/d70c83bd1b304beb91a5971f24141d7c552612da), [`9717c64`](https://github.com/nextlyhq/nextly/commit/9717c64f461cccffaf007a91de3a5a76d09a3348), [`8f979fe`](https://github.com/nextlyhq/nextly/commit/8f979fed6f9622b478a12b5adb65caede6726b63), [`85ab528`](https://github.com/nextlyhq/nextly/commit/85ab5285d39258304f7f8a28ec47c496beb5c94e), [`b8659c2`](https://github.com/nextlyhq/nextly/commit/b8659c24d287714529b7c609deb22928cd34935e), [`46976be`](https://github.com/nextlyhq/nextly/commit/46976be27f051d5958da29eaa40efd700de69f8a), [`15eedaa`](https://github.com/nextlyhq/nextly/commit/15eedaaca67cf61eab14d55a26b663ba347d0761), [`cd184c0`](https://github.com/nextlyhq/nextly/commit/cd184c0a0ad8bcd385662087c1a84561dcf61013), [`26dd60a`](https://github.com/nextlyhq/nextly/commit/26dd60a5212b6d377aabe17aea1906fcea30acee), [`76346bb`](https://github.com/nextlyhq/nextly/commit/76346bbb3ea9c37481e32326982491053dd2fe75), [`4c1e006`](https://github.com/nextlyhq/nextly/commit/4c1e0066b79c05c8f93aed3f7d31b9fb28645b2e), [`9726e90`](https://github.com/nextlyhq/nextly/commit/9726e90631180a9e8602397192d5068987152034), [`9ab4632`](https://github.com/nextlyhq/nextly/commit/9ab4632b3fdccab46fafe6dc382557611666f157), [`8bcc279`](https://github.com/nextlyhq/nextly/commit/8bcc27989f45a0287e9ceccfb91a95b27d65d2a6), [`d4a3ecf`](https://github.com/nextlyhq/nextly/commit/d4a3ecf81640b13b3700c934c32b7c04a444c65e), [`d6b45e4`](https://github.com/nextlyhq/nextly/commit/d6b45e404ac8fc3056db4dcb91fdbf1138a51332), [`b4894b8`](https://github.com/nextlyhq/nextly/commit/b4894b8ac4bc398b2eb8d30c7ebf179fa8af57ab), [`9c5c169`](https://github.com/nextlyhq/nextly/commit/9c5c169c334d6eec9e7f756cd594982db032b9f8), [`b566a48`](https://github.com/nextlyhq/nextly/commit/b566a48c5d7b7648f500ad2764b1b0d9831af578), [`66bbff0`](https://github.com/nextlyhq/nextly/commit/66bbff00b133c56812ab1052cbb34858d8506a37), [`0188d15`](https://github.com/nextlyhq/nextly/commit/0188d15ad2433990ed6a48c68c18f4e872354c3d), [`e5780f8`](https://github.com/nextlyhq/nextly/commit/e5780f82b0fdc29ae7963da5ed868407a8d545d6), [`e87bdb5`](https://github.com/nextlyhq/nextly/commit/e87bdb51e508e9c51693ff1e1547ea509990feb0), [`ddd6129`](https://github.com/nextlyhq/nextly/commit/ddd6129278b0a8eca63b8eb19e59497d3f1abe73)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.62
  - @nextlyhq/blocks-react@0.0.2-alpha.62
  - @nextlyhq/plugin-sdk@0.0.2-alpha.62
  - @nextlyhq/ui@0.0.2-alpha.62

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

- [#1007](https://github.com/nextlyhq/nextly/pull/1007) [`fd5355c`](https://github.com/nextlyhq/nextly/commit/fd5355c06ba1c09be8924683847e8bf211531f69) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks can now be dragged on the page-builder canvas. Dragging a block shows a line where it
  will land and drops it there, including into a container, and the line is chosen by the region
  the pointer is over rather than by the nearest rectangle — so a block goes where it is aimed
  even when its neighbours are very different heights. Pressing Escape abandons a drag without
  moving anything, a press that does not travel stays a click, and a locked block does not move.
  Everything drag does was already possible from the keyboard, which remains the way to place a
  block precisely between two very short ones.

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

- [#1093](https://github.com/nextlyhq/nextly/pull/1093) [`8a3c96a`](https://github.com/nextlyhq/nextly/commit/8a3c96ab2bbaee266ebdf641dc02e2c6a1413fe9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The editor canvas drew every block flush and unstyled while the published page drew the author's
  real spacing. An author setting a margin, a height or any other per-node style saw nothing change
  until they published.

  Node styles are a SEPARATE tier from the site sheet, and `PageRenderer` compiles them only when it
  is handed a style context. The public routes pass one; the editor never did. The failure is silent
  by construction rather than loud: `resolvePageStyles` withholds the sheet and keeps the class names,
  so every block carried its `nx-pb-<hash>` class and nothing defined it — the markup looked correct
  and the page looked unstyled.

  Measured both ways on one document, with the style context the only variable: without it, zero
  scoped rules, zero gaps between siblings and a spacer collapsed to zero pixels; with it, six rules,
  24px gaps and the spacer at its authored 48px. That collapse is also why dragging felt broken —
  the 2px drop indicator had no gap to draw into and landed on top of flush text.

  The breakpoints come from `siteBreakpoints()` rather than a set spelled at the call site, because
  `site-style.ts` exists so the field validator and the canvas cannot disagree about what this site's
  breakpoints are. The canvas is now its third consumer.

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

- [#1028](https://github.com/nextlyhq/nextly/pull/1028) [`73ff427`](https://github.com/nextlyhq/nextly/commit/73ff427499412b947faf02c1e9515d95411ca198) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Breaking for SMTP users:** `nodemailer` is now an optional peer dependency. If you send email over SMTP, run `npm install nodemailer`.

  It was a hard dependency of `nextly`, so every install carried roughly 676 KB for a transport most installs never use, and it is the mail dependency with the most security churn. Installs that send through Resend or SendLayer, or that send no email at all, no longer download it. The SMTP provider, its settings form and its connection test are unchanged, and a stored SMTP configuration keeps working once the package is present.

  Three things make the absence explain itself rather than surfacing as a failed password reset. A send names the package and the command instead of reporting a module-not-found. The server logs one warning at boot when a stored provider cannot run. The provider settings form shows which package is missing, the exact command, and a link to its documentation, and still lets the configuration be saved.

  Email now also sends to the server log when no provider is configured at all, instead of failing. A fresh install threw a 422 on its first send, which is the password-reset flow, so a new install could not complete the first thing a user does after signing up. Outside production the rendered body is written too, so a developer can follow a reset link; in production only the recipient and subject are recorded, because reset and verification bodies carry live tokens. Mailpit remains the recommended local inbox and is unaffected.

  Email provider descriptors now report whether the install can actually use each provider, so a plugin that needs a package the host has not installed can say so in the admin rather than being offered and failing when a message is sent.

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

- [#1102](https://github.com/nextlyhq/nextly/pull/1102) [`3dd8424`](https://github.com/nextlyhq/nextly/commit/3dd8424520acd87e644cd1a810f4ac1972dd8e93) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field that covers the whole entry form left its author unable to reach the rest of the entry.
  The page builder opens full-screen over the form, so setting an SEO description or a publish date
  meant closing the editor — and closing it discards its undo history.

  The builder's left rail now offers a Settings panel holding the entry's other fields, rendered by
  the form's own renderer through `useEntryFieldsPanel`. What the panel draws and what the form
  submits are one thing; a second form instance would fork the state and lose whichever copy did not
  save.

  The asking field is excluded, and so is the field its `admin.condition` depends on: offering a page
  builder inside its own settings panel would nest an editor in its own chrome, and offering the
  control that un-renders it would be an unlabelled second exit.

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

- [#1116](https://github.com/nextlyhq/nextly/pull/1116) [`efc33bd`](https://github.com/nextlyhq/nextly/commit/efc33bdabf97d0b4b31f5ef0892191fc327d7bce) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A site's style inputs — design tokens with light/dark values, self-hosted fonts, named
  classes and breakpoints — now persist. The page builder registers a versioned Site Style
  single that stores admin edits, layered over optional code-stated defaults on
  `pageBuilder({ siteStyle })`; one merge resolves the two, writes are validated with the
  engine's own rules and refused on garbage, and a published route passes the merged result
  per request via `loadSiteStyle`, so a stored token or class reaches the served page's site
  sheet without a redeploy.

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

- Updated dependencies [[`0f656db`](https://github.com/nextlyhq/nextly/commit/0f656db6820d7644ec3bda6b33bd2e816855588c), [`2d1868f`](https://github.com/nextlyhq/nextly/commit/2d1868f737a0cabfb3179dc936fa22b03dd8c05b), [`f75f8db`](https://github.com/nextlyhq/nextly/commit/f75f8dbdbeea7f22108c810d0a02c57bde1ed96d), [`e1804a3`](https://github.com/nextlyhq/nextly/commit/e1804a3d2410791222f6dd2a45055e72b11e15aa), [`9aad0b0`](https://github.com/nextlyhq/nextly/commit/9aad0b018da5f855b396f087d8d7c328ea25ef85), [`9174670`](https://github.com/nextlyhq/nextly/commit/91746709aaad166b01524e1760cd33f8c8229066), [`c0d5195`](https://github.com/nextlyhq/nextly/commit/c0d51951cd688042b2f6c50812bee58e250ff3b1), [`3a1e43c`](https://github.com/nextlyhq/nextly/commit/3a1e43c80c3670897aca4f00fad81ad221b46a1a), [`ef7dc0e`](https://github.com/nextlyhq/nextly/commit/ef7dc0e07639bab4400dba70c04144f27b065f40), [`788363c`](https://github.com/nextlyhq/nextly/commit/788363c98dab3fb2e97a316e0bc5eea0788207c8), [`93f9889`](https://github.com/nextlyhq/nextly/commit/93f9889e6d0ce621b9e9d8c7cd32faaea707cf59), [`e1b16fa`](https://github.com/nextlyhq/nextly/commit/e1b16fad0bacf0cfe61a95a5c918ce93b517e0eb), [`23fe766`](https://github.com/nextlyhq/nextly/commit/23fe76682f49ce3037ff70d556172b9fd28df98a), [`6848510`](https://github.com/nextlyhq/nextly/commit/68485109d294be88f89969a261048165acde2a09), [`57a2771`](https://github.com/nextlyhq/nextly/commit/57a2771c82377227d4a6e6632eb5ce576000be51), [`b4e95bf`](https://github.com/nextlyhq/nextly/commit/b4e95bff26425ddd733304701601b155fd65e262), [`000bac9`](https://github.com/nextlyhq/nextly/commit/000bac942edbb3cb758c41c96220289a39c414a7), [`ef1ee3e`](https://github.com/nextlyhq/nextly/commit/ef1ee3eec50deb24595ce5e4a200ac23bcb2b900), [`2dea22a`](https://github.com/nextlyhq/nextly/commit/2dea22ade9293651e51d3990bfb6df5ed83b993c), [`820be87`](https://github.com/nextlyhq/nextly/commit/820be87c5848ac40ce82e0dee570a20bf0f60aca), [`827d5fd`](https://github.com/nextlyhq/nextly/commit/827d5fde9d7eef3870a4945812d68580709b8bd3), [`fefbeef`](https://github.com/nextlyhq/nextly/commit/fefbeefb6df32f3f723baa7ff29ece63c6c51efc), [`0ed3c26`](https://github.com/nextlyhq/nextly/commit/0ed3c2666e1c803734095d6ffba5b92cff6176cd), [`0353157`](https://github.com/nextlyhq/nextly/commit/0353157e7337424e46d1ba04139b505e0356d329), [`56bb1d1`](https://github.com/nextlyhq/nextly/commit/56bb1d14cbde68ea8044b6e22ff66d5cda544036), [`17c181a`](https://github.com/nextlyhq/nextly/commit/17c181a323606e109f6b35757b99c3702b6f5ed5), [`992a626`](https://github.com/nextlyhq/nextly/commit/992a626a2458470a9bbfa128b65c9931dcbe2342), [`927183e`](https://github.com/nextlyhq/nextly/commit/927183ee98033531245cabd66d0d57bdd05a6497), [`53e4495`](https://github.com/nextlyhq/nextly/commit/53e4495c3d6d8e441cd43fc317c7a56257d48004), [`b943c67`](https://github.com/nextlyhq/nextly/commit/b943c67b3d253d4ccbcbe70a7e742c4cb7bd7ea0), [`9bdc9b5`](https://github.com/nextlyhq/nextly/commit/9bdc9b5be28e44305bd27a409c39dc03ef22256b), [`edb49ef`](https://github.com/nextlyhq/nextly/commit/edb49ef7a56c06adf5059b9d021062db672d76b0), [`a1a5705`](https://github.com/nextlyhq/nextly/commit/a1a5705694ba0687edbb3aee711a00e50a3ddc92), [`08175f9`](https://github.com/nextlyhq/nextly/commit/08175f9fa1f697bd8d3265c8ce07bf06d2480a19), [`744a791`](https://github.com/nextlyhq/nextly/commit/744a79119534ac8db1ff292d6cf9beafd0fb959e), [`314f5aa`](https://github.com/nextlyhq/nextly/commit/314f5aacdd9f258dbdccbef6a151af5e771ab959), [`52abdfe`](https://github.com/nextlyhq/nextly/commit/52abdfee28e3e2dafe12a356cf72aee4d5938de7), [`375c8ce`](https://github.com/nextlyhq/nextly/commit/375c8ce9d4be66ec1637a42781156af2398cd76e), [`8a70233`](https://github.com/nextlyhq/nextly/commit/8a70233318b52917c569c1e5a253d2becf4ad556), [`fd5355c`](https://github.com/nextlyhq/nextly/commit/fd5355c06ba1c09be8924683847e8bf211531f69), [`0cbe2c0`](https://github.com/nextlyhq/nextly/commit/0cbe2c07804ca0a9ae9222999c4dd968dfe72c10), [`760cc02`](https://github.com/nextlyhq/nextly/commit/760cc02ab5f40d0314051747de72f44d573d2bd5), [`7f71689`](https://github.com/nextlyhq/nextly/commit/7f716895f83d2450fbbab643e890e9e7ec7e73a9), [`9014091`](https://github.com/nextlyhq/nextly/commit/90140917f98b0ae7841c2a4162f85af7b22846dc), [`acbfb43`](https://github.com/nextlyhq/nextly/commit/acbfb432223b8b3b4da1748324a2ae6582680b6e), [`7c2f581`](https://github.com/nextlyhq/nextly/commit/7c2f581eee969e95958b71731107cb0b0004ea75), [`689c321`](https://github.com/nextlyhq/nextly/commit/689c3216b4bce96870c44613a562b35413170167), [`37e0edb`](https://github.com/nextlyhq/nextly/commit/37e0edb1dfe22b0674c2983354432d3729f3e55f), [`6551bdb`](https://github.com/nextlyhq/nextly/commit/6551bdb26005392fc0a27c78c0df6aedbb955866), [`9a59c8c`](https://github.com/nextlyhq/nextly/commit/9a59c8cb339fe444227e32d968c74ac985370c10), [`297f499`](https://github.com/nextlyhq/nextly/commit/297f499517a13d31651317b30b7869a454f061d8), [`aa275cd`](https://github.com/nextlyhq/nextly/commit/aa275cdd68ac2f04228fab7bbad105029472e0e4), [`effece2`](https://github.com/nextlyhq/nextly/commit/effece22c5b82d389845f50378f83c2337532daa), [`a47f423`](https://github.com/nextlyhq/nextly/commit/a47f42334438fce1a3f73f2eae40365cab04d941), [`843b884`](https://github.com/nextlyhq/nextly/commit/843b8847294ab5291145db28892c1c29db1dae02), [`8fa89e1`](https://github.com/nextlyhq/nextly/commit/8fa89e1689662304f8ad8022e1b01734eec286d6), [`59c702f`](https://github.com/nextlyhq/nextly/commit/59c702fdba7526ec6d7fc1e6002404e413c56452), [`081d7b0`](https://github.com/nextlyhq/nextly/commit/081d7b04cc59fff6adb75de4388961b9024d8a57), [`03a47b3`](https://github.com/nextlyhq/nextly/commit/03a47b303bc0523918357c3256cc585aafdb6b58), [`bb9f0fd`](https://github.com/nextlyhq/nextly/commit/bb9f0fda9fdfab712381ab432da03fb0b692ab40), [`5089c60`](https://github.com/nextlyhq/nextly/commit/5089c60843af94b0726036ce4dacfb3f95a4f998), [`85824d9`](https://github.com/nextlyhq/nextly/commit/85824d957f685b31565fddb354e5134b2e4f22de), [`d34e7f9`](https://github.com/nextlyhq/nextly/commit/d34e7f966fa088a033f8cf31150d7a48511c0238), [`522d7d6`](https://github.com/nextlyhq/nextly/commit/522d7d664850964948613477994f447ac4641a2c), [`a6e61d6`](https://github.com/nextlyhq/nextly/commit/a6e61d6ec793d502689d57ce2de6411e3593ffae), [`4ae7624`](https://github.com/nextlyhq/nextly/commit/4ae7624c35d27d0464ecdf0f332925121b0fdb96), [`1f7187b`](https://github.com/nextlyhq/nextly/commit/1f7187b3020b3e791aaa8a11ea23ae6c42cff4d4), [`ff9ba6c`](https://github.com/nextlyhq/nextly/commit/ff9ba6c89ed87f936302389589f98b57e90d8653), [`7b0b099`](https://github.com/nextlyhq/nextly/commit/7b0b0991d6403e0dddc2e74644deb5bafee3f567), [`4490e3b`](https://github.com/nextlyhq/nextly/commit/4490e3b1a34a5ae8f0a36beafae1b0171e30351b), [`4d29175`](https://github.com/nextlyhq/nextly/commit/4d291755cc6ca5eef20ea6a01f1a988e63aa0db0), [`c76df0b`](https://github.com/nextlyhq/nextly/commit/c76df0b2adcaa3c29296598549d3c017e7e0c191), [`4a05a64`](https://github.com/nextlyhq/nextly/commit/4a05a64eb0743f7696f9c9f3205d211d46bb1ca8), [`4d736db`](https://github.com/nextlyhq/nextly/commit/4d736db3f39ede87dea9953efdf5d4c6578e7dba), [`7d29da8`](https://github.com/nextlyhq/nextly/commit/7d29da8bb19c36b61da4fc940716df400fbed556), [`9ee1842`](https://github.com/nextlyhq/nextly/commit/9ee1842cce461ddd347aa58240907e9083791ef5), [`0e5decc`](https://github.com/nextlyhq/nextly/commit/0e5decccfac518019671831278a14dccf85d578e), [`90fe49b`](https://github.com/nextlyhq/nextly/commit/90fe49b39011389d1d788fbce6703d46a7be3605), [`47f23f0`](https://github.com/nextlyhq/nextly/commit/47f23f029c7662eab9862a44a0e60c34c16b440b), [`8a3c96a`](https://github.com/nextlyhq/nextly/commit/8a3c96ab2bbaee266ebdf641dc02e2c6a1413fe9), [`165fe0f`](https://github.com/nextlyhq/nextly/commit/165fe0f8507dc1ca1da247ef5ce0fc6a0fe1bf0a), [`73ff427`](https://github.com/nextlyhq/nextly/commit/73ff427499412b947faf02c1e9515d95411ca198), [`d2fdb05`](https://github.com/nextlyhq/nextly/commit/d2fdb05652a264c47072f84b7680d034bae898ee), [`6959a28`](https://github.com/nextlyhq/nextly/commit/6959a2889cf2cca98c011165997ebc377595cfdf), [`f354cff`](https://github.com/nextlyhq/nextly/commit/f354cffe275b3c3e02d73aadb82596014946a653), [`8eaba1f`](https://github.com/nextlyhq/nextly/commit/8eaba1f3e5752016d6cdfeb95e3bb3fb87d5a3b3), [`3dd8424`](https://github.com/nextlyhq/nextly/commit/3dd8424520acd87e644cd1a810f4ac1972dd8e93), [`180e6ed`](https://github.com/nextlyhq/nextly/commit/180e6ed0660baafbf5f6d36c69d0ed36c2c6715c), [`4caf451`](https://github.com/nextlyhq/nextly/commit/4caf4511abd556564a92fc91a92493a23aebe9e1), [`ef46199`](https://github.com/nextlyhq/nextly/commit/ef4619964114f674c76ae068ddf6bfb42263a735), [`09e56d3`](https://github.com/nextlyhq/nextly/commit/09e56d3eb7bca439da56bf6da97c15e87540d2e1), [`cfdbf30`](https://github.com/nextlyhq/nextly/commit/cfdbf30d405ad9dd395665bbca10c7ba6c9a4209), [`748e45c`](https://github.com/nextlyhq/nextly/commit/748e45c41f6414b5b8a1190de64b2619b6509246), [`f8c6456`](https://github.com/nextlyhq/nextly/commit/f8c6456e2ba5bc21836e264147e5eb115d176098), [`2cea567`](https://github.com/nextlyhq/nextly/commit/2cea5676fd6047cfdc17280194e501c10e961594), [`a17d7b9`](https://github.com/nextlyhq/nextly/commit/a17d7b9c5e794838a6770ec3a3d6cce72bc08623), [`e84a451`](https://github.com/nextlyhq/nextly/commit/e84a451a89c5a8ad7d56c38027ce317defc2295d), [`792cabc`](https://github.com/nextlyhq/nextly/commit/792cabc141b0d04038650bb855e47f0dd4e49265), [`0e5f971`](https://github.com/nextlyhq/nextly/commit/0e5f97117f4bdecc8adec6423b28d727f30e33bd), [`b0f6033`](https://github.com/nextlyhq/nextly/commit/b0f6033b340ed98632043bbba75018af8e1152c3), [`6bf770f`](https://github.com/nextlyhq/nextly/commit/6bf770fbdbc9bc6441f1b7efc834dcbba313739e), [`ce3ba3a`](https://github.com/nextlyhq/nextly/commit/ce3ba3a1f3a11a95ee14cbdbcbd3309c78f6de1a), [`7e18e80`](https://github.com/nextlyhq/nextly/commit/7e18e8075c3239521b14d2a7344a000cf5903259), [`e7c5261`](https://github.com/nextlyhq/nextly/commit/e7c52610389b68c7f9e3d06f5e52b753e113bfa3), [`a1f067a`](https://github.com/nextlyhq/nextly/commit/a1f067a549c7391190efdaaf7e2d27035622c508), [`57aacaa`](https://github.com/nextlyhq/nextly/commit/57aacaa7c7d8760065636761bbf2c7779140c384), [`1c7fda6`](https://github.com/nextlyhq/nextly/commit/1c7fda67ccf7d717ab0af3dcdb889480646c4222), [`ead5fb7`](https://github.com/nextlyhq/nextly/commit/ead5fb77a8d38dbe744d919bd56975cc4df2fcf5), [`3be0d93`](https://github.com/nextlyhq/nextly/commit/3be0d934125103ab6ee4dbdd7a799dec410f004f), [`3727712`](https://github.com/nextlyhq/nextly/commit/372771251b8a1d0439f9841b8e8d959d18632697), [`f797c86`](https://github.com/nextlyhq/nextly/commit/f797c8641e631a22a21b558f0593f37ee8633a29), [`30d0860`](https://github.com/nextlyhq/nextly/commit/30d08608f8aadeea36733762a312d03a8ccfb2f2), [`b8f5ead`](https://github.com/nextlyhq/nextly/commit/b8f5ead0af1a2ea1a445e3b1ed6f13e07bc02b33), [`3782024`](https://github.com/nextlyhq/nextly/commit/37820249b7014d3cae792061d5d24580b1fb205f), [`a6efa47`](https://github.com/nextlyhq/nextly/commit/a6efa47997671b0c9ec298f0491bd8787850b3bb), [`33e09c9`](https://github.com/nextlyhq/nextly/commit/33e09c9e3c802f07c6894bb3af7739f50ca87646), [`e12fef3`](https://github.com/nextlyhq/nextly/commit/e12fef351831d6f0233e5c7ae8d2c11285e0bda3), [`20f4a16`](https://github.com/nextlyhq/nextly/commit/20f4a1694000c0cb982ca364057102afb7da8a70), [`2f0a973`](https://github.com/nextlyhq/nextly/commit/2f0a97333b2a87b58a34268d61cff95e2639ccd4), [`c1f8d00`](https://github.com/nextlyhq/nextly/commit/c1f8d00f363b4017264fb5a71c8b352a0d089156), [`46720cf`](https://github.com/nextlyhq/nextly/commit/46720cff7457fc30f045ff2d4280760db10a3688), [`44fad04`](https://github.com/nextlyhq/nextly/commit/44fad046d2a673e4e23c682652dec52863d36fb1), [`d11047b`](https://github.com/nextlyhq/nextly/commit/d11047b69875d65aef60e150fac3e068bec6ce14), [`af6637b`](https://github.com/nextlyhq/nextly/commit/af6637b48395cfbe5a56d3724f4115d608a58a4b), [`315c523`](https://github.com/nextlyhq/nextly/commit/315c523aac5df9ec8d601a238cc452e533c1e660), [`4e9a396`](https://github.com/nextlyhq/nextly/commit/4e9a396b9792ba57dffd32cb4c878bba98f23031), [`2a46a22`](https://github.com/nextlyhq/nextly/commit/2a46a222b9aca25058ad85dd4bb08ca5a4801efa), [`2e5576d`](https://github.com/nextlyhq/nextly/commit/2e5576d936be9847d890aa4510ee20204d54bf60), [`85cf546`](https://github.com/nextlyhq/nextly/commit/85cf546c3b17ef0aef08d5da1f96140ba24f78a0), [`2ba4029`](https://github.com/nextlyhq/nextly/commit/2ba4029faa33272596b4c75a79c3b7293e72fe43), [`efffb03`](https://github.com/nextlyhq/nextly/commit/efffb03970582deb7080af4ce304649a727bb506), [`b8a9b17`](https://github.com/nextlyhq/nextly/commit/b8a9b17da19ff6b6561f46667eeb2bf98d9e5451), [`29b5cab`](https://github.com/nextlyhq/nextly/commit/29b5cab442aa852a974ead8e7333c68ff133a111), [`2791d3a`](https://github.com/nextlyhq/nextly/commit/2791d3a6259e2d8fa911b3f448f88691d33ae917), [`8234829`](https://github.com/nextlyhq/nextly/commit/82348299e08a945a01450f2397c23851869de918), [`f4e27fe`](https://github.com/nextlyhq/nextly/commit/f4e27fefe80d2baa582023a42842291b7d9aae17), [`cf57071`](https://github.com/nextlyhq/nextly/commit/cf5707192799a961da02cd37e3b508c22de58eca), [`2fe2409`](https://github.com/nextlyhq/nextly/commit/2fe240971acbb6b0250af53a655369ed5a61bf28), [`1d26760`](https://github.com/nextlyhq/nextly/commit/1d26760212d85ae95d1aa44697a9846cdcf18570), [`8356918`](https://github.com/nextlyhq/nextly/commit/83569186484391113629e38cb003dc883f38e5f2), [`8115473`](https://github.com/nextlyhq/nextly/commit/8115473dda3feaef9e69e6f0e84961ca7e08841f), [`99d7824`](https://github.com/nextlyhq/nextly/commit/99d78240db617f0d0bd9cd9bbe5cfc4444622ef2), [`1ca795a`](https://github.com/nextlyhq/nextly/commit/1ca795ac1deb451e85b8cb34599ea1ca5b3184f5), [`a691def`](https://github.com/nextlyhq/nextly/commit/a691def619ad3a362c7bd9379b25876ebcf0a565), [`e5f4b8f`](https://github.com/nextlyhq/nextly/commit/e5f4b8f869407413e22517f871657e85fd578359), [`6c5b14c`](https://github.com/nextlyhq/nextly/commit/6c5b14c7606899a42440e0bde7298fd699243bfb), [`22b39d0`](https://github.com/nextlyhq/nextly/commit/22b39d09d2c0cfd03b1efce8ee9d4189447b808d), [`6bfba73`](https://github.com/nextlyhq/nextly/commit/6bfba73f953c8ad3abb6032f2a014a2e75e083f9), [`3a48dce`](https://github.com/nextlyhq/nextly/commit/3a48dcec2afc68d8a7ef8b81178ac3ff044e8c76), [`e86d212`](https://github.com/nextlyhq/nextly/commit/e86d2128adf2a84305f1aa74718bfb2cf084289f), [`ca204b1`](https://github.com/nextlyhq/nextly/commit/ca204b1b65780b54d45b0c566831d04a671c54c0), [`8cb76ed`](https://github.com/nextlyhq/nextly/commit/8cb76ed4b564975fe6a4cf41ef4b05d6c1c938b8), [`1cfbe69`](https://github.com/nextlyhq/nextly/commit/1cfbe69cc6563ebf64d1ffa34e2c1e9425eb992a), [`2ed85ab`](https://github.com/nextlyhq/nextly/commit/2ed85abb8c113d8403dd41cc8013d0ea6960e350), [`f86de75`](https://github.com/nextlyhq/nextly/commit/f86de7523d5d5786dfe3803a3bed0340ca3ba7c6), [`da85f3a`](https://github.com/nextlyhq/nextly/commit/da85f3a75796bbcf0817fd9705858900cc5a0e4e), [`50ac759`](https://github.com/nextlyhq/nextly/commit/50ac7596c29fc8a8b818edd383ad2dbe3a8f5e43), [`2bb8685`](https://github.com/nextlyhq/nextly/commit/2bb868512455b064bf175eff8637042560a9d2ce), [`188cf9f`](https://github.com/nextlyhq/nextly/commit/188cf9fccdcaa06f185401b18d397b6bc7dffd53), [`283525b`](https://github.com/nextlyhq/nextly/commit/283525bb526ac9ed4efeb23315d08a9ff7486c00), [`01fd952`](https://github.com/nextlyhq/nextly/commit/01fd95249ba1bfa9cabf7506b599c8ddc14b357b), [`a86a5c4`](https://github.com/nextlyhq/nextly/commit/a86a5c4be48b1576f150ba6a4b40158c0f5ed05f), [`af3a434`](https://github.com/nextlyhq/nextly/commit/af3a434466e07f9225cf0c4242a14b60a77605bb), [`e3843ab`](https://github.com/nextlyhq/nextly/commit/e3843abae557e023ce53b3ae39fde1790c02ae61), [`1ac7062`](https://github.com/nextlyhq/nextly/commit/1ac7062ba794b84e894afc0b98e71a23f3883155), [`9ae5707`](https://github.com/nextlyhq/nextly/commit/9ae5707a103e8d322c8f36efe841d265658bfb86), [`c3000c4`](https://github.com/nextlyhq/nextly/commit/c3000c4a327d78281abe2acac110ae39fa18a7db), [`3e058be`](https://github.com/nextlyhq/nextly/commit/3e058beb345b0c52694fdf853e459c19008223cd), [`569c262`](https://github.com/nextlyhq/nextly/commit/569c262c1952adb32274f21615f95f209a05cd7f), [`5a1a770`](https://github.com/nextlyhq/nextly/commit/5a1a770fb646465667d69b785052fcfba0316c76), [`727f256`](https://github.com/nextlyhq/nextly/commit/727f25622e81ea67abe7d6d17031ecc64c370e8b), [`04de93b`](https://github.com/nextlyhq/nextly/commit/04de93b6bc10ba1cd5a6ecebc7d10ac191a66cc7), [`8ed9caf`](https://github.com/nextlyhq/nextly/commit/8ed9caff4e922b5860dd1a82c79ef7c8c34f5038), [`b5d9429`](https://github.com/nextlyhq/nextly/commit/b5d9429426c9ee4f7e83d5a82e30d3538de90bdf), [`4603031`](https://github.com/nextlyhq/nextly/commit/46030314646b31181fac2023b1bdbd4fcb46e311), [`01f4c8a`](https://github.com/nextlyhq/nextly/commit/01f4c8a53eb48003b835b110b1624ac101645a15), [`56de024`](https://github.com/nextlyhq/nextly/commit/56de024d1af68908e738593bbb28fed70908089c), [`682924c`](https://github.com/nextlyhq/nextly/commit/682924c32bf54e4b39561938fae967afe37282af), [`3b93cd9`](https://github.com/nextlyhq/nextly/commit/3b93cd9760d9589d28987bcff801151da310608d), [`5599ca8`](https://github.com/nextlyhq/nextly/commit/5599ca83b35be9704d32e617e5d051d8f04642f6), [`d84cb2b`](https://github.com/nextlyhq/nextly/commit/d84cb2bab026dd7e83490d867c60e7b07ee531a3), [`a41dc43`](https://github.com/nextlyhq/nextly/commit/a41dc431683aaa06b00979d693f9de22d9061828), [`2dc1965`](https://github.com/nextlyhq/nextly/commit/2dc19653b80543b8779b6ddb97cd817e4348e1b0), [`8516ecc`](https://github.com/nextlyhq/nextly/commit/8516ecc20f3e385e3bf700bc98d826c3c3e70239), [`ffc68f9`](https://github.com/nextlyhq/nextly/commit/ffc68f9c53aeadcdb90ba30098ff399fca6b05a4), [`405c804`](https://github.com/nextlyhq/nextly/commit/405c8044281e2c699daa7b8492bd4957ea436825), [`70ede4e`](https://github.com/nextlyhq/nextly/commit/70ede4e7597e415f266f744985d5587619a44636), [`1de8eca`](https://github.com/nextlyhq/nextly/commit/1de8eca4d07befab324b127eb9f3d17aec6c0d3b), [`d5efc25`](https://github.com/nextlyhq/nextly/commit/d5efc2585fe51b3f78e0975f8584472d32c2366d), [`0499947`](https://github.com/nextlyhq/nextly/commit/0499947735ddfe370a87f1804cb49cb712ff6a39), [`f94003f`](https://github.com/nextlyhq/nextly/commit/f94003ff56c4fb575ef241a638a20ec67484de89), [`aa08c98`](https://github.com/nextlyhq/nextly/commit/aa08c9825ade8443239541cf304c7c546f5c1a23), [`2c016d9`](https://github.com/nextlyhq/nextly/commit/2c016d997efbef2548f5989aa07981bb83e023d6), [`be9cee9`](https://github.com/nextlyhq/nextly/commit/be9cee9d8a417c9b087d17489aa388a779742700), [`381f6ce`](https://github.com/nextlyhq/nextly/commit/381f6ce811fd4b102d6fe772891327ce1d1be5f7), [`4693f6a`](https://github.com/nextlyhq/nextly/commit/4693f6a5bc39d18df3e142e07be0f6b25a8888f6), [`b05cea8`](https://github.com/nextlyhq/nextly/commit/b05cea831266086afe7562e38c0d5be0a5dcc284), [`4364193`](https://github.com/nextlyhq/nextly/commit/4364193b97dbd829a4dfd6215d33fedd1cd33467), [`80a9daf`](https://github.com/nextlyhq/nextly/commit/80a9daf54d12e1020eb2eb521356eb8dd685cb7d), [`9984d1a`](https://github.com/nextlyhq/nextly/commit/9984d1a8b68b1677b7ffb9935682500ea4b3a4ac), [`9e95f9d`](https://github.com/nextlyhq/nextly/commit/9e95f9dca5f30dfc92d154c85df4b12114f77924), [`9e59e84`](https://github.com/nextlyhq/nextly/commit/9e59e84506c370728b13967d5892de9ba5939ce5), [`ab7f064`](https://github.com/nextlyhq/nextly/commit/ab7f064cb35c758c39802ad2a6606c4fe6d31fac), [`39627e6`](https://github.com/nextlyhq/nextly/commit/39627e62a6cf9f8c2085aa6c45d9b4cb074c55eb), [`62bc267`](https://github.com/nextlyhq/nextly/commit/62bc26763da9cda4d3c598c584d113435c853f51), [`efc33bd`](https://github.com/nextlyhq/nextly/commit/efc33bdabf97d0b4b31f5ef0892191fc327d7bce), [`0937227`](https://github.com/nextlyhq/nextly/commit/0937227ac4657c895647daf568620e9b03bc0c7a), [`4672cd8`](https://github.com/nextlyhq/nextly/commit/4672cd884c684076056c3ecd1df5c832496f1e40), [`249506a`](https://github.com/nextlyhq/nextly/commit/249506a695408dcce020b70d02451c2c32940cc5), [`b5c9199`](https://github.com/nextlyhq/nextly/commit/b5c9199141de10cc59bc5cc2f809d1e2142522c2), [`426d176`](https://github.com/nextlyhq/nextly/commit/426d176b7da5173fa285052007dc1040cf1f736c), [`661c9fd`](https://github.com/nextlyhq/nextly/commit/661c9fd3cb1af1c6ad70f00d1d33efeae5caa51d), [`2172c33`](https://github.com/nextlyhq/nextly/commit/2172c33759a1871890e21699239888b2a4adeec8), [`fc499ff`](https://github.com/nextlyhq/nextly/commit/fc499ffa55921ecac48d831812e8a00cf2b2921e), [`aa88709`](https://github.com/nextlyhq/nextly/commit/aa88709fb1ab5cfd68ded934a572041659fa4939), [`cb61a5c`](https://github.com/nextlyhq/nextly/commit/cb61a5cfade318136de99a649b491a7bd7055b23), [`6ef538d`](https://github.com/nextlyhq/nextly/commit/6ef538d0fd9f208e06531d8e01c5410cc2cc16ac), [`f3caf10`](https://github.com/nextlyhq/nextly/commit/f3caf104d6f6d2ecbd56f46bb5fee3160f4cc0ef), [`9adee4a`](https://github.com/nextlyhq/nextly/commit/9adee4ab76fa8203d77d7eda5f4deb85a97c7716), [`07864b8`](https://github.com/nextlyhq/nextly/commit/07864b8bf61d3e06d439af953ad1df224e5405c8), [`89a13c7`](https://github.com/nextlyhq/nextly/commit/89a13c779c02d0d37f95d464292b19d15cd30858), [`8cd3004`](https://github.com/nextlyhq/nextly/commit/8cd3004b4455032465d4406c5730599ea6c158fa), [`e5228b5`](https://github.com/nextlyhq/nextly/commit/e5228b57b2e4325c5a6c8c7b2ee1debfd62a8545), [`43c18d3`](https://github.com/nextlyhq/nextly/commit/43c18d37dc13db3a30bcdb82e10dddb0e09c0208), [`9b94631`](https://github.com/nextlyhq/nextly/commit/9b9463194d6466bb00c35639152697e7ee27294a), [`d5fb5bf`](https://github.com/nextlyhq/nextly/commit/d5fb5bf223d0003c7d21d27399584bf6dde7785a), [`133a749`](https://github.com/nextlyhq/nextly/commit/133a749a1548869f5378583526e43c2254b4f647), [`e1f4612`](https://github.com/nextlyhq/nextly/commit/e1f4612d1607ec904d4b47071f1792a990098283), [`2db288d`](https://github.com/nextlyhq/nextly/commit/2db288de9906162ae83850b12d419617b2067cf2), [`b4fec5f`](https://github.com/nextlyhq/nextly/commit/b4fec5f2df776290151a9151127e5894198a7807), [`175b6fa`](https://github.com/nextlyhq/nextly/commit/175b6fa154f7052588470b50ca73fcef8fdb6d45), [`d8cf8e6`](https://github.com/nextlyhq/nextly/commit/d8cf8e61076b94966ca4d6fad2dfd73c2c0d6283), [`703f22c`](https://github.com/nextlyhq/nextly/commit/703f22c47cbc0f3768aa152235ca3ad4b66693cf), [`782cf82`](https://github.com/nextlyhq/nextly/commit/782cf82ffa502b3af3467f1166e7ce16dc63658c), [`8ff87ca`](https://github.com/nextlyhq/nextly/commit/8ff87ca56860026497be0c97cb603e369a09f05d), [`76f716f`](https://github.com/nextlyhq/nextly/commit/76f716fece75dc23e901a6a959788c4b34a5408f), [`ba700b5`](https://github.com/nextlyhq/nextly/commit/ba700b5d34abcc3bf3a259ced6fa1ed33e39d4bf), [`0709e5e`](https://github.com/nextlyhq/nextly/commit/0709e5ec0cf42351d7acb21bbad767de4c339ae6), [`e78cd96`](https://github.com/nextlyhq/nextly/commit/e78cd966e113870667458dd27438ea1a902a2df7), [`9805fad`](https://github.com/nextlyhq/nextly/commit/9805fad34487ddf39d38f8b32fe66eb3c763e1b0), [`4669bfd`](https://github.com/nextlyhq/nextly/commit/4669bfdd6442badcae91bb21e0c8faa9752d8274), [`d754cfa`](https://github.com/nextlyhq/nextly/commit/d754cfa881f34d7bafc831c6d0e6840ae8b19164), [`1608884`](https://github.com/nextlyhq/nextly/commit/1608884a297632dfbd03323780d81518f5602c51), [`7f3c431`](https://github.com/nextlyhq/nextly/commit/7f3c431cb01e360fb88b7637d08cd74f9bac87d1), [`e41222f`](https://github.com/nextlyhq/nextly/commit/e41222fead5a69407c2a99914fa6b41ede864e9f), [`d3908b1`](https://github.com/nextlyhq/nextly/commit/d3908b166749575d7a815de2cf8576b8e1f6b02c), [`fb05a08`](https://github.com/nextlyhq/nextly/commit/fb05a08b9c4605091f3aa151ce2d3ac86f3e4640), [`9f57bb3`](https://github.com/nextlyhq/nextly/commit/9f57bb3e674d02daace62f12c9b2d39570846aa8), [`2c6b5dc`](https://github.com/nextlyhq/nextly/commit/2c6b5dc28ba3a7013401affa757bbcfe4ac4138d)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.61
  - @nextlyhq/blocks-react@0.0.2-alpha.61
  - @nextlyhq/plugin-sdk@0.0.2-alpha.61
  - @nextlyhq/ui@0.0.2-alpha.61

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

- Updated dependencies [[`205ac43`](https://github.com/nextlyhq/nextly/commit/205ac43ecab968ba3346863773a17fc497bffe02), [`da50ecb`](https://github.com/nextlyhq/nextly/commit/da50ecb035f86c11e60e50f85497b2ca6cf81364), [`f9dbc5f`](https://github.com/nextlyhq/nextly/commit/f9dbc5f86d51fda80b6fd7f2109aa387cd9a5fe8), [`6bf8cca`](https://github.com/nextlyhq/nextly/commit/6bf8ccaa7c5b39cf8142853e66d223b71f3c7568), [`14dc716`](https://github.com/nextlyhq/nextly/commit/14dc7166c07e9f5e059b54be7a14ca8c06678437), [`376429a`](https://github.com/nextlyhq/nextly/commit/376429ae4dcf559a29043db4ce9af907dc44ade7), [`8df7086`](https://github.com/nextlyhq/nextly/commit/8df7086c2eaca7634d6350115394547a6aa05b80), [`2d11910`](https://github.com/nextlyhq/nextly/commit/2d1191061664111851c30b1739c859a309a51399), [`811c4bf`](https://github.com/nextlyhq/nextly/commit/811c4bf653ea40129d4448b01452f533bdf50bc8), [`42f0c1e`](https://github.com/nextlyhq/nextly/commit/42f0c1e669f1634064d1d90a63790b8cf8c24e46), [`85d0d97`](https://github.com/nextlyhq/nextly/commit/85d0d97945abab5797f18da63e6d9f7e21580a87), [`055dc7f`](https://github.com/nextlyhq/nextly/commit/055dc7ffb0e8e4038b3f7f2c812e677d0c45903a), [`5037057`](https://github.com/nextlyhq/nextly/commit/5037057fa10f1fedee25bfcc272d24314ad11528), [`ff2fb60`](https://github.com/nextlyhq/nextly/commit/ff2fb60ba340d08063c63f68b39df06d72b0cc57), [`fad081c`](https://github.com/nextlyhq/nextly/commit/fad081c242f6e04ae72a3ecf352a38da73f57fda), [`b903379`](https://github.com/nextlyhq/nextly/commit/b903379ae597168156d4ece4b8622d340be96ad5), [`ea623f2`](https://github.com/nextlyhq/nextly/commit/ea623f2c06cfb57366f6debc1e613c1c84fb42eb), [`9b27446`](https://github.com/nextlyhq/nextly/commit/9b274464cbcc28e48637876cae0ef4d1b76d7b01), [`e56dddb`](https://github.com/nextlyhq/nextly/commit/e56dddb31483d0e76f5dbeaca2681d55c42f398e), [`03cd7d8`](https://github.com/nextlyhq/nextly/commit/03cd7d81bd3e830079217110d8bd8d32cafefbf1), [`03e5182`](https://github.com/nextlyhq/nextly/commit/03e518254e640114fafd8251841b9ed58a88959a)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.60
  - @nextlyhq/blocks-react@0.0.2-alpha.60
  - @nextlyhq/ui@0.0.2-alpha.60
  - @nextlyhq/plugin-sdk@0.0.2-alpha.60

## 0.0.2-alpha.59

### Patch Changes

- [#957](https://github.com/nextlyhq/nextly/pull/957) [`bf1477a`](https://github.com/nextlyhq/nextly/commit/bf1477aa82fdcca011b955a8764d1a2848e7e04b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An added or removed text field showed a blank space on the version it never reached, instead of
  saying it was not present there. Splitting an inline text diff leaves one side with no runs at
  all, and an empty paragraph reads as a field that existed and held nothing. Which side a field
  never reached is now decided in one place for every kind of field, so a renderer cannot answer it
  differently.

- [#907](https://github.com/nextlyhq/nextly/pull/907) [`1cb27c2`](https://github.com/nextlyhq/nextly/commit/1cb27c201fef195bd470c3d7bd54d4621dfb6610) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): show the recovery-point indicator before the first recording

  The entry header hid the indicator until a recording had happened, so the first
  edit to a saved entry showed nothing for the whole debounce window, which is
  exactly when a reader most needs telling their change is not stored yet.

  The header now asks only whether recording is possible at all. AutoSaveIndicator
  already returns nothing when it has no state to report, so the header restating
  that was a duplicate that could disagree with it.

  The indicator copy also described a local draft, which it no longer is.

- [#912](https://github.com/nextlyhq/nextly/pull/912) [`70ab60f`](https://github.com/nextlyhq/nextly/commit/70ab60f8dfac2bb5b231f04c217ba555ef1596ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): offer recovered work back when an editor opens

  Recording without offering is a loop that never closes: the work was stored and
  nobody was ever told it existed. The entry editor now reads the calling author
  own recovery point on open and offers it back.

  A non-blocking strip above the fields rather than a modal. A modal suited the
  older local draft, which was almost always your own work from a tab that had
  just crashed. A server recovery point is a wider set, including work from
  another device or from days ago, so demanding an answer before the document can
  be read turns a rescue into an obstacle.

  An offer is withheld when the document was saved after the recovery point, and
  made anyway when the document timestamp is unknown: a spurious offer costs one
  dismissal, while a suppressed one loses work recorded specifically so it could
  not be lost.

- [#900](https://github.com/nextlyhq/nextly/pull/900) [`01b32a2`](https://github.com/nextlyhq/nextly/commit/01b32a21c45c52e9cdd90c5464cbf86743a3c2ff) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): add the autosave transport to versionApi

  The autosave endpoints had no client. protectedApi carried no PUT verb at all,
  so the write endpoint was unreachable from the admin regardless of which caller
  wanted it.

  Adds the verb, and the two calls that use it: recording the values currently in
  the editor as the calling author's recovery point, and reading that back.
  PUT rather than POST because the row is rolling, one per document and author
  rewritten in place, so sending the same snapshot twice leaves one recovery
  point and an unacknowledged retry is safe.

- [#906](https://github.com/nextlyhq/nextly/pull/906) [`8efeff5`](https://github.com/nextlyhq/nextly/commit/8efeff5b4d6c83936629a8594ef493cc4450cff5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): record recovery points from the entry editor

  Mounts the autosave hook in the entry editor and shows its state in the header
  action cluster, which is what makes server-side recovery points reachable for
  the first time: the endpoints, the transport and the hook all existed with
  nothing calling them.

  Recording engages only once an entry has an id, since the endpoint addresses a
  document that exists, and pauses while a real save is in flight so a snapshot
  cannot describe a state that never existed.

- [#931](https://github.com/nextlyhq/nextly/pull/931) [`8ff3ed3`](https://github.com/nextlyhq/nextly/commit/8ff3ed33e40a9f6b238eecea889249f6086f9cd0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page editor now takes the whole window. The admin's sidebars, header and page frame step aside while an immersive surface is mounted, and restore themselves when you leave it.

- [#902](https://github.com/nextlyhq/nextly/pull/902) [`67926e3`](https://github.com/nextlyhq/nextly/commit/67926e3f70c5c17f40c2b424fe20fec4b1e6c727) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): record the editor values as a server-side recovery point

  A debounced hook that writes the values currently in the form to the calling
  author rolling recovery point, and reports the status back.

  It is not a save. The dirty flag is left exactly as the form set it, so the
  unsaved-changes guard goes on firing, and the values are read with getValues
  rather than through handleSubmit, which validates and refuses on failure and
  would therefore record nothing for the half-finished input most worth keeping.

  Recording is triggered by the dirty flag rather than by the update type, which
  react-hook-form leaves undefined for any change that does not come from a
  registered input own DOM handler.

- [#898](https://github.com/nextlyhq/nextly/pull/898) [`9ea28f1`](https://github.com/nextlyhq/nextly/commit/9ea28f10c0b49f3161e4ad7f4acf394aa09b3fdd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): put seven more admin form pages on the shared layout

  The API key, role, settings, webhook and user-field forms now consume
  `FormLayout`, `FormActions`, `FieldShell` and `Grid` from `@nextlyhq/ui`
  instead of hand-rolled page padding, a fixed action row, `SettingsRow`'s
  horizontal label-left/control-right grid, and viewport-breakpoint grids.

  Converted: `CreateApiKeyForm`, `EditApiKeyForm`, `RoleForm` (with
  `RoleBasicInfo`), `ImageSizeForm`, `EmailProviderForm` (with
  `ProviderConfigFields`), the general settings page, `WebhookForm`,
  `UserFieldForm`, and the Full Name/Email/Password fields in
  `UserFormFields`. Every compound `Select` field among them (API key Token
  Duration/Type/Role, Image Size Resize Mode/Format, general settings
  Timezone/Date Format/Time Format, and each provider config field's `select`
  kind) now wires its `SelectTrigger` through `FieldShell`'s render-function
  `children`, the same pattern the form builder's conversion established.

  Composite controls with no single focusable element to attach an id to are
  named as GROUPS instead, via `SettingsRowGroup`: `ProviderTypePicker`, the
  webhook event-type checkbox group and the webhook custom-headers row each get
  `role="group"` with `aria-labelledby` rather than a `<label for>` aimed at a
  control that never carries the id. Measured in a browser before and after: all
  three pointed at nothing in both light and dark themes.

  Left hand-rolled, each with its own comment: `FieldTypePicker` and the
  sign-in-method `RadioGroup`; horizontal label-left/switch-right settings rows
  (`UserFieldForm`'s "Allow multiple selections", "Required" and "Active");
  read-only value rows with no control at all (`EditApiKeyForm`'s Key
  Properties); and one page grid needing an asymmetric row/column gap `Grid`'s
  `gap` prop cannot express (`UserFormFields`'s two-column split).

  `RoleBasicInfo.test.tsx` — failing on `main` before this change, asserting
  placeholders, descriptions and a system-role message the component has never
  rendered — is repaired to match what the component actually renders.

- [#872](https://github.com/nextlyhq/nextly/pull/872) [`1dd9b90`](https://github.com/nextlyhq/nextly/commit/1dd9b90cfe67c220ddf12495d6d6126b4bd76f45) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(ui): add a shared admin form layout layer

  A shared form layout layer for the admin: a named field-width vocabulary for
  consistently sized controls, section chrome composed from the existing card,
  a single page-level action bar, and an opt-in responsive mode on the existing
  grid.

  `FieldShell` associates its label with whichever id actually ends up on the
  control (a caller's own id or a generated one, never an explicitly-`undefined`
  one), composes `aria-describedby` with whatever the control already carries
  rather than replacing it, and forces `aria-invalid` when `error` is rendered
  even if the control claims otherwise. It owns this prop merge itself with
  `cloneElement` instead of Radix `Slot`, warns in development rather than
  silently disconnecting when handed a `Fragment`, and narrows `children` to a
  single element to match what it can actually slot in. `FormSection` names its
  region with `aria-labelledby`. `Grid`'s `responsive` mode now splits
  `className`/`style`/`ref` (parent-layout concerns) from `cols`/`gap` (internal
  layout) between its wrapper and inner grid; non-responsive mode is unchanged.

- [#929](https://github.com/nextlyhq/nextly/pull/929) [`7fa0cc2`](https://github.com/nextlyhq/nextly/commit/7fa0cc27abfab02cf2e960f616848106f4b99b8c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): send the autosave snapshot as the request body

  Restoring a recovery point put nothing back in the form.

  The autosave endpoint treats the request BODY as the snapshot and reads the
  locale from the request params. The client wrapped the values in an envelope
  instead, so that envelope was stored as the snapshot and every field ended up
  one level too deep; a restore then wrote an object with no field names the form
  recognised. The locale it carried in the body was never read.

  Also enables drafts and autosave on the playground posts collection. No
  collection there or in any template enabled it, so the policy gate refused every
  write and nothing had ever exercised the path.

- [#919](https://github.com/nextlyhq/nextly/pull/919) [`5c0a5ff`](https://github.com/nextlyhq/nextly/commit/5c0a5ffcd6b3d4498b2b443608df1854ba50ceac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): let the autosave scope helper accept an absent document id

  The helper required a string, so every call site supplied its own empty-string
  fallback. That put one rule in two places: the helper, which its tests reach,
  and a fallback at each caller, which they do not.

  Accepting null and undefined removes the fallback rather than testing it, so
  there is no longer a per-caller decision to get wrong.

- [#938](https://github.com/nextlyhq/nextly/pull/938) [`2585aab`](https://github.com/nextlyhq/nextly/commit/2585aabea3bdd27a9ba7be33fe6730a35a448c09) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix: supersede the autosave recovery point on a real save

  Saving now deletes the saving author recovery point, on both the collection and
  Single write paths, inside the write transaction.

  This removes a comparison that could not be made correctly. Deciding whether to
  offer recovered work compared a version timestamp against a document timestamp,
  and those live in different tables that do not share a clock: one records UTC
  and the other local time carrying a Z. The comparison was wrong by the server
  offset and silently withheld every offer on a Single. A row that exists only
  while there is unsaved work needs no comparison.

  Scoped to the saving author, so another editor unsaved work survives. Inside the
  transaction, so a failed save leaves the recovery point rather than destroying
  the only copy of work it did not store.

  Also moves the Single recovery banner into the main column: above the flex row
  it sat under the sticky header, which intercepted pointer events, so the offer
  was visible and its buttons were not clickable.

- [#943](https://github.com/nextlyhq/nextly/pull/943) [`f19b259`](https://github.com/nextlyhq/nextly/commit/f19b259f08e3feafe59864571a39e9e65e3c5db9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The block editor opens full screen from a blocks field, covering the entry form, with a labelled way back to it.

- [#910](https://github.com/nextlyhq/nextly/pull/910) [`53c9909`](https://github.com/nextlyhq/nextly/commit/53c9909839bb16e4af86f3a94e36de1682346186) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Saving a field group in the Schema Builder no longer reports success when the change was only half made.

  The save changes the database tables first and then records what it did. If that recording step failed, the failure was written to the server console and the response still said the schema had been applied. The tables held the new shape, the stored definition still described the old one, and nothing marked the field group as needing repair.

  That was worse than it sounds, because the version number was deliberately left where it was. An editor already open would therefore pass its staleness check and plan its next change from a shape the database no longer had — the exact retry the `diverged` state exists to refuse, arriving through the one path that never marked it.

  A failed recording is now recorded. The field group is marked `diverged`, and the response says which of three things actually happened, because the operator's next step differs for each: the failure was marked, so reconcile and do not retry; the record turned out to have moved on, so reload before doing anything, since the change was probably saved and the field group may also have been deleted; or nothing could be recorded at all, so the server log is the only trace.

  One case that used to be reported as a failure now correctly reports success. MySQL has no `RETURNING`, so a write is an update followed by a read, and a read that fails after the update has already committed used to be treated as though nothing was written. The save now re-reads the row and reports success when it already carries the change.

- [#961](https://github.com/nextlyhq/nextly/pull/961) [`2638c5f`](https://github.com/nextlyhq/nextly/commit/2638c5f5ecf431d1d10745cb4e6d660cf2f60f5a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating a collection or single now asks how it is edited, so enabling the page builder no longer means finding the right field type in a picker afterwards.

- [#941](https://github.com/nextlyhq/nextly/pull/941) [`68a2903`](https://github.com/nextlyhq/nextly/commit/68a2903c47c8037dfcbe722a9e233869b9bee61d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the builder's editor state: one place a document changes, with undo built from the op layer's own inverses rather than from document snapshots.

- [#940](https://github.com/nextlyhq/nextly/pull/940) [`27b8b45`](https://github.com/nextlyhq/nextly/commit/27b8b455f0327aaa74389d37ff023bd7d16db5bd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(builder): move a block with the keyboard, on two axes

  Dragging was the only way to reorder a block, so the editor could not be used by
  anyone who does not use a pointer.

  `keyboardMovePosition` answers where the selected block goes for four intents,
  split across two axes so that each has an inverse: `up` / `down` reorder among
  siblings and never change the parent, `indent` / `outdent` change the parent and
  never reorder anything that stays put. Every press is undone by the opposite
  press, which is what lets someone driving the editor without sight of the result
  recover from a mistaken key.

  It reports what the move DOES as well as where it lands, so the wiring can
  announce "moved down" and "moved into Group" differently without re-deriving the
  difference by comparing parents. Moves that change parent also name the slot they
  vacate, because a keyboard author moves one block at a time and emptying a
  container is the common case rather than the rare one.

  One asymmetry is deliberate and pinned by a test: `indent` appends, so outdenting
  a block that was not its container's last child and indenting it back returns it
  at the end. Recovering the original index would mean carrying state across
  presses.

  Not yet exported from any entry point: it has no consumer until the canvas wires
  it up.

- [#926](https://github.com/nextlyhq/nextly/pull/926) [`c17e9f6`](https://github.com/nextlyhq/nextly/commit/c17e9f6717750c8c31adf968a2be8b67b448bf25) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(builder): hold a drop target until the pointer has travelled a threshold

  A pointer resting near the boundary between two drop targets jitters by a pixel
  or two and the target underneath it alternates, which shows as a flickering
  insertion indicator and as a block landing where the author did not aim.

  `nextTargetSwitchState` makes a rival target hold while the pointer travels a set
  distance before it replaces the committed one. It reads two points and a number
  and no geometry at all, so a 1px divider, an author-set 0px spacer, a 900px hero,
  a vertical stack and a grid all behave identically — a minimum-size rule cannot
  say that, because a spacer's height has no lower bound and any pixel floor makes
  some authored block impossible to drop beside.

  The threshold is measured from where the candidate first differed from the
  committed target, not from where the last switch happened. The latter is
  satisfied by construction before the pointer reaches any seam, so it would be met
  exactly where it is not needed and never where it is.

  Not yet exported from any entry point: it has no consumer until a canvas wires it
  up, and an unused public export is a surface with no caller to keep it honest.

- [#933](https://github.com/nextlyhq/nextly/pull/933) [`aef5d90`](https://github.com/nextlyhq/nextly/commit/aef5d909feff93e773dd03cc4133b51b1ad1bd41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): core/card adopts the surface and border tokens

  `core/card` declined a background and a border for as long as no design token
  resolved. Both `color.surface` and `color.border` are now in the guaranteed set
  and both render paths emit the sheet that defines them, so the block carries
  them — as `{ $token }` references rather than literals, because a literal colour
  is wrong in whichever of light and dark it was not chosen for, which is the whole
  reason a token set exists. The border is written per LOGICAL side, so a
  right-to-left page borders the side an author means.

  This also DELETES the ratchet that forbade `{ $token }` in `baseStyles`, which is
  the swap it was written for: its stated expiry was "when the site stylesheet is
  wired into the render path", and both paths now emit it. It is replaced by the
  question that matters now — a default may only name a token the guaranteed set
  DEFINES, because a reference to an undefined name dangles for exactly the reason
  the old defect did, and neither the catalog check nor the compiled-CSS check can
  see it.

- [#878](https://github.com/nextlyhq/nextly/pull/878) [`a458074`](https://github.com/nextlyhq/nextly/commit/a45807451d1572cdb44ebfbd9421af49909cc036) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page can now be laid out in columns. `core/columns` and `core/column` ship as container presets: the row restricts its slot to columns, and a column declares the row as its only parent, so each column keeps an identity that can be selected, styled and dropped into. The row layout is an overridable default style rather than a rule in the renderer.

- [#875](https://github.com/nextlyhq/nextly/pull/875) [`f6497c7`](https://github.com/nextlyhq/nextly/commit/f6497c788a29c36b72a05574b6afa0c348b658f2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Preview links can be wired to a content route in one call, granting exactly the one unpublished entry the link was minted for rather than every unpublished entry on the site.

- [#921](https://github.com/nextlyhq/nextly/pull/921) [`e3bafe8`](https://github.com/nextlyhq/nextly/commit/e3bafe82889959fe90ba8bd8b40d721eeaa66d31) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two paths that change field-group storage now hold a storage migration out while they run.

  A field-group storage migration renames the registry table and every field group's data table. Two paths could previously run at the same time as one: the code-first sync that materialises field groups defined in your config at boot and on hot reload, and the `db:sync` pass that deletes field groups no longer present in code.

  The deletion pass was the more consequential of the two. It reads the table names first and then drops them one at a time, so a migration renaming those tables partway through left the remaining drops addressing names that no longer existed. Because those statements are `DROP TABLE IF EXISTS`, that failed silently: the field group survived as a table nothing scanned for again. The exclusion is now held across the whole pass rather than per field group, so the names it read stay valid until it finishes.

  The code-first sync writes definition rows only and creates no tables, so it holds the migration out without being able to create the lock itself — a deployment whose database role has permission to write rows but not to create tables keeps booting exactly as before.

  Neither path changes what it does when no migration is running.

- [#890](https://github.com/nextlyhq/nextly/pull/890) [`cfabd89`](https://github.com/nextlyhq/nextly/commit/cfabd89a0fcf4a4a746da88666c744f9c71c54fc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Adds `core/accordion` and `core/accordion-item` to the block library. A section holds ordinary blocks rather than a string of Markdown, so an image or a button can live inside one, and the disclosure itself is a native `<details>` — no client JavaScript.

- [#969](https://github.com/nextlyhq/nextly/pull/969) [`e50fcbf`](https://github.com/nextlyhq/nextly/commit/e50fcbf7dc74a87305dc94c1c53d1fdd2671bc3d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The block palette now reads as names rather than identifiers. Core blocks declare a label, a category and search keywords, so the inserter groups them under Layout, Content, Media and Interactive instead of a single "other" heading, and a search for "picture" finds the image block.

- [#888](https://github.com/nextlyhq/nextly/pull/888) [`ac1d8e1`](https://github.com/nextlyhq/nextly/commit/ac1d8e1e0c1cc60064ec39d401badc7251672593) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): add core/card and core/form to the block library

  Two blocks the derived block list marks as needed by every site inventoried,
  including a client project.

  `core/card` is a preset over the shared container implementation, differing
  from a box only in what it starts as: rounded and clipping. The clip is the
  substance rather than the rounding, because a border radius paints the box and
  does not constrain its descendants, so a card that rounds without clipping
  renders a child image's square corners over its own curve. It carries no
  default padding, because padding on the card makes a full-bleed image
  impossible; and no default background or border, because the guaranteed token
  set has no surface or border colour and a hardcoded one is wrong in whichever
  of light and dark it was not chosen for.

  `core/form` renders plain HTML and ships no client JavaScript — the
  form-builder plugin remains the one that stores submissions, and contributes no
  block of its own, so the two do not compete. Its whole layout is one grid on
  the root, so every label and control is a direct child rather than nested;
  labels associate by `htmlFor` and an id derived from the node's id, so two
  forms on one page cannot mint the same id and re-point one form's label at
  another's field. The `action` is read through the same URL guard the other
  blocks use, so a stored scheme that executes rather than navigates is refused.

  `base-styles.test.tsx` is derived from `coreBlocks` rather than listing blocks
  by hand: it asserts that every property a block declares in `baseStyles` is
  known to `STYLE_CATALOG` and reaches the compiled stylesheet under that block's
  own selector. Those are separate questions — a catalog property is still
  dropped when its value does not match the grammar the catalog declares for it —
  and the pair covers the failure that shipped in `core/columns`, whose first
  version declared a flex item property the catalog does not carry and which the
  compiler dropped silently while an object assertion stayed green.

- [#893](https://github.com/nextlyhq/nextly/pull/893) [`0277719`](https://github.com/nextlyhq/nextly/commit/0277719b340ccc05f57c97eab4129bae100a58f3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Adds `core/gallery`, a reflowing grid of pictures restricted to `core/image` so every item carries alt text and an intrinsic size. It sizes to its container rather than to a viewport breakpoint, so it reflows correctly inside a column or a card.

- [#847](https://github.com/nextlyhq/nextly/pull/847) [`4e4272a`](https://github.com/nextlyhq/nextly/commit/4e4272abe35d656e4081e05fa80302040f65bd81) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page-builder canvas now tells an author WHY a drop was refused instead of silently doing nothing. Drop planning returns a discriminated outcome — action, refused with a reason, unchanged, or unresolved — and the drag overlay shows the reason while the drag is still in the air.

- [#870](https://github.com/nextlyhq/nextly/pull/870) [`566b592`](https://github.com/nextlyhq/nextly/commit/566b592a74cd2a8ccbece30b629b8512fa5c3fcc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The editor now asks the block engine whether a block may nest under a container, rather than
  deciding it a second time. One rule, three callers: the drag, the keyboard insert, and the
  engine's own validation of a stored document.

- [#865](https://github.com/nextlyhq/nextly/pull/865) [`7acb441`](https://github.com/nextlyhq/nextly/commit/7acb44182c3886cc99714b49cd33759eb35d4a48) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page-builder editor adopts the builder shell for its chrome.

  The editor hand-rolled a three-pane layout, a toolbar and a breakpoint switcher. The shell supplies all of that as slots, so the editor passes its canvas, inspector, block library and device switcher into it rather than laying them out. The drag provider and its overlay are untouched: the shell owns no drag machinery and never looks inside the canvas slot.

  The shell no longer renders the document primary landmark. Its canvas region was a main element, and every mount sits inside a host that already has one, so a second gave assistive technology two competing primary landmarks. It is a named region now, which is also the more accurate description of an editor embedded in a page that owns its own primary content.

  Leaving the editor is optional. A host with nowhere to return to, such as the editor embedded as a field inside an entry form, gets no exit affordance at all rather than one that does nothing.

- [#953](https://github.com/nextlyhq/nextly/pull/953) [`50d1d73`](https://github.com/nextlyhq/nextly/commit/50d1d7368f902ae3eab6e14d0716197c91963e76) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template editor no longer draws on top of the live preview on narrower screens.

- [#946](https://github.com/nextlyhq/nextly/pull/946) [`fac7f05`](https://github.com/nextlyhq/nextly/commit/fac7f05c6e7f52ffba0c32d516ac17e97b62c069) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Enforce a slot's allow-list. A container declaring which blocks its slot holds is now checked on validation, where only the child half of the nesting rule was checked before. `canNestInSlot` is exported alongside `canNest` and `canBeRoot`, so an editor deciding what to offer or whether to accept a drop can ask both halves of the rule instead of computing one of them itself.

- [#866](https://github.com/nextlyhq/nextly/pull/866) [`412518f`](https://github.com/nextlyhq/nextly/commit/412518f3f23c1199ab887dcf486f6823005e96f6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Block documents are now checked against where each block says it belongs: a block that declares the containers it may sit inside is reported when it sits anywhere else, including at the top level of a document. Validation also no longer skips its per-value checks on a document whose stored form merely differs from the document in memory, so problems in those documents are reported instead of silently passing.

- [#873](https://github.com/nextlyhq/nextly/pull/873) [`e045e5c`](https://github.com/nextlyhq/nextly/commit/e045e5cfcaa8ee12f60a70bc02c77eab5da81f4b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Store a rolling autosave recovery point per document and author, authorized as an update of the document, with password fields stripped before the snapshot is persisted and the rows removed when the document is deleted.

- [#927](https://github.com/nextlyhq/nextly/pull/927) [`33c0cd6`](https://github.com/nextlyhq/nextly/commit/33c0cd696c07dfd6a789ece5a499c1306403f49d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): announce document status in one polite region

  The entry editor reported whether an author's work was stored visually only.
  `AutoSaveIndicator` cycles through "Saving…", "Saved", "Unsaved changes" and
  "Not saved", and the header carried no live region at all — so the control
  whose whole purpose is reassuring someone their work is safe did that for
  sighted users only.

  The header now has a single `role="status"` / `aria-live="polite"` region
  covering document status. One region rather than one per concern: two live
  regions in the same header interrupt each other, and a reader cannot tell which
  announcement belongs to what they just did.

  Two deliberate choices. The transient "saving" state is silent, because autosave
  debounces and announcing it speaks over the reader every few seconds while they
  type — what matters is where the state came to rest. And the spoken wording is a
  full sentence ("Your work is stored") rather than the chip's terse label, since
  an announcement arrives with no visual context to tell the listener what the
  word refers to.

  The region also accepts translation progress, so a multilingual entry can report
  both kinds of document state through the same channel.

- [#950](https://github.com/nextlyhq/nextly/pull/950) [`9d5111d`](https://github.com/nextlyhq/nextly/commit/9d5111dbcef507d98b3f81b3adadc19b5f37210c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): show translation progress as one instrument

  The entry editor described the same fact in three places: a language switcher
  in the header, per-language status pills in the document rail, and a
  completeness badge in the list. An author had to assemble "where am I, what
  state is everywhere else, and how far along is this document" from three
  fragments two panels apart.

  The pills now sit beside the switcher with a completeness bar and a written
  count, as one strip. The document rail keeps the ACTIONS on other languages
  (copy from another language, publish all) — those are document management
  rather than status.

  The count is derived once by `translationCounts` and read by both the bar and
  the header's spoken status region, so the two cannot drift. A language present
  in the entry's translation map but no longer configured is ignored rather than
  counted, which previously made "5 of 4" reachable.

- [#970](https://github.com/nextlyhq/nextly/pull/970) [`87c544d`](https://github.com/nextlyhq/nextly/commit/87c544d6904f0f7f66f4287199f70e276ee34266) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `@nextlyhq/eslint-plugin`: design-token lint rules that plugin authors can run in their own projects.

  Nextly's admin is themeable because its surfaces read design tokens, and a surface that reaches past them keeps its light-mode appearance in dark mode. That contract was only enforced inside this repository, so the first-party plugins followed it and plugins built by anyone else had nothing checking them.

  The new package ships three rules — `no-palette-classes`, `no-hardcoded-colors` and `no-static-inline-style` — with a `recommended` config bundled in. Install it and extend `nextly.configs.recommended` to get the same checks the admin holds itself to, in your editor and in your CI. A genuine exception is marked in place with a `design-lint-ok: <reason>` comment rather than by disabling a rule.

  The repository's own design guard now derives which trees it scans instead of listing them, so a plugin package added later is covered automatically, and it reports what it read so a run that scanned nothing can no longer be mistaken for a clean one. The plugin template's settings page is rebuilt on design tokens, matching the guidance its own comment gives.

- [#880](https://github.com/nextlyhq/nextly/pull/880) [`37fa697`](https://github.com/nextlyhq/nextly/commit/37fa6970659ac2db1355d7176706b3ae6f906985) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-group repair for a code-managed group now writes its fix instead of being refused for the lock the caller was already cleared past.

- [#863](https://github.com/nextlyhq/nextly/pull/863) [`51acbc2`](https://github.com/nextlyhq/nextly/commit/51acbc205506c96cfed799162a440b660037dd0b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field groups can now be repaired after a failed schema change: a new reconcile operation (POST /api/field-groups/schema/[slug]/reconcile) rewrites the stored definition to describe the live tables, reporting removed, repaired and adopted fields by name. The divergence marker is now version-conditional, so a healthy field group can no longer be marked diverged after transient read failures.

- [#960](https://github.com/nextlyhq/nextly/pull/960) [`a217a11`](https://github.com/nextlyhq/nextly/commit/a217a11baa95de76eb3fe05f48b0a3cf02454e58) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): announce the field-group repair notice and clear its contrast failure

  The field-group builder drew its save-blocked notice as a hand-rolled tinted
  box: a 40%-alpha destructive border that composites to 1.69:1 over the page
  surface, against the 3:1 WCAG 1.4.11 asks of a component boundary. That single
  call site was the sole reason `packages/ui`'s contrast suite shipped red, so
  every lane touching `ui` inherited a failing test that was not theirs.

  It is now the shared `Alert`, whose destructive variant carries full-strength
  scale tokens and a solid left accent. The notice also gains `role="alert"`:
  `needsRepair` is derived from fetched data, so the refusal appears after the
  page settles and was previously announced to nobody.

- [#904](https://github.com/nextlyhq/nextly/pull/904) [`7a37c01`](https://github.com/nextlyhq/nextly/commit/7a37c01c22222e23f5b4741cb2ce2e4e6a5d0c21) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field group whose stored definition no longer describes its tables can now be repaired from the admin, and the repair is shown before it runs.

  A field group is marked `diverged` when its tables changed and the record describing them did not, and it refuses every schema edit until that record is repaired. The repair existed but nothing could reach it. The Schema Builder now explains the block where it happens — on the field group being edited, which is where saving is refused — and the field group list offers the same repair on any row marked `diverged` or `failed`.

  The repair is previewed first. Reviewing it lists what would change by name rather than by count: fields whose columns are gone, attributes being brought back in line, and columns nobody declared, which are adopted under a type guessed from the physical column and are the ones worth correcting afterwards. Where the definition cannot be repaired without guessing — a column present on both tables, a physical type that no longer matches — each reason is reported individually and nothing is written. Approving a repair sends the version it was read against, so a plan reviewed in one tab can never be applied to a field group another tab has changed since. Previewing writes nothing and takes no lock, so it is safe to run at any time.

  The same operation is available as `GET` and `POST` on `/api/field-groups/schema/[slug]/reconcile` for callers driving it directly, and the result types are exported from `nextly/field-group-reconcile` for anyone rendering them.

  Note for anyone managing roles: saving in the Schema Builder requires `update-settings`. A role holding `create-settings` without it can open the builder and cannot save, which surfaces as saving being broken for one person rather than as a permission.

- [#882](https://github.com/nextlyhq/nextly/pull/882) [`6963637`](https://github.com/nextlyhq/nextly/commit/69636376c9170e7f63260a95ce6c774d399117d7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-group repair now refuses a table whose primary key is not exactly the expected one, and one whose system columns have lost their database defaults.

- [#939](https://github.com/nextlyhq/nextly/pull/939) [`296a050`](https://github.com/nextlyhq/nextly/commit/296a050d104b99c4146bb35e3465440b81e33b4a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix the page-builder plugin's admin registration. The blocks field named a component the admin could not resolve, so it rendered as an empty group, and three slot specifiers still pointed at components the plugin no longer ships.

- [#896](https://github.com/nextlyhq/nextly/pull/896) [`a5d1c1f`](https://github.com/nextlyhq/nextly/commit/a5d1c1f8f124e535b734ce640c019cfdf6702016) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(blocks-react): stop three blocks depending on token CSS nothing emits

  `core/form`, `core/accordion` and `core/gallery` each declared
  `gap: { $token: "space.4" }`. A token reference compiles to
  `var(--site-space-4)`, and nothing in this repository ever emits that variable,
  so the declaration was invalid at computed-value time and `gap` fell back to
  `normal` — zero for a grid. Three blocks rendered with their children touching.

  Measured three ways that agree: `compileSiteSheet`, the only thing that turns a
  token set into CSS, has zero consumers outside `blocks-engine`;
  `emitTokenBlocks` is called only by that function, its own tests and a
  benchmark; and the string `--site-` appears in no source file outside the engine
  at all, against a positive control of `--nx-` appearing in four. So
  `defaultSiteTokens()` guarantees nothing today — it is a default nobody applies.

  Every existing check passed while this was broken: the property is in
  `STYLE_CATALOG`, and the declaration did reach the compiled stylesheet. Whether
  the `var()` inside the value RESOLVES is a third question, and nothing asked it.

  The blocks now use the length `space.4` itself declares, so the value does not
  change when this becomes a token again. `base-styles.test.tsx` gains the check
  that asks the third question, walking to the leaf so a token nested inside an
  object-shaped declaration is caught too, with a positive control for both
  shapes. It is a ratchet with an expiry: when the site stylesheet is wired into
  the render path it should be deleted by the change that wires it, rather than
  weakened or exempted per block.

- [#879](https://github.com/nextlyhq/nextly/pull/879) [`06ae4f4`](https://github.com/nextlyhq/nextly/commit/06ae4f4c7a989de9500ca8b0023ae00e58e2ff13) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Put the form builder's Create/Edit view on the shared form-layout components
  (`FormLayout`, `FormActions`, `FieldShell`, `Grid`) from `@nextlyhq/ui`.

  The view no longer hand-rolls its own card, page padding or a negative-margin
  hack to escape that padding; `FormLayout` owns the measure. The submit and
  cancel actions moved into one `FormActions` bar at the end of the page, fed the
  form state's existing dirty flag instead of a second, separately-rendered
  unsaved-changes indicator. The Settings and Notifications tabs no longer cap
  their own width, so they fill the page measure instead of sitting narrower
  than it. The Notifications sheet's two-column rows moved off a viewport
  breakpoint onto `Grid`'s container-query mode, since the admin content region
  is narrower than the window whenever both sidebars are open.

  Simple single-element fields (plain text/email inputs) now render through
  `FieldShell` for their label, description and error wiring.

  `FieldShell`'s `children` now also accepts a function —
  `(field: FieldShellRenderProps) => ReactNode`, `FieldShellRenderProps` newly
  exported — receiving the `{ id, describedBy, invalid }` it computes so a
  caller can apply that wiring to a nested element instead of relying on a
  single top-level `cloneElement`. This is what a compound Radix control needs:
  `Select`'s root destructures a fixed prop list and never forwards the rest,
  so an id cloned onto it never reaches the real, focusable `SelectTrigger` two
  levels down — silently, with no error and no warning. Both call paths derive
  their id/`aria-describedby`/`aria-invalid` from one shared computation, so
  they cannot drift into disagreeing about the same field. In development,
  `FieldShell` now also checks after mount whether the id it computed landed on
  any element in the document at all, and warns once, by field name, if it did
  not — the general form of the defect a compound control's dropped id was a
  specific case of. Every `Select`-driven field in the form builder's Create/
  Edit view and its Notifications sheet (Status, Email provider, Email
  template, Send-to type, Recipient address in field mode, Reply-To mode,
  Reply-To visitor-field in field mode, and the send-condition Field and
  Comparison pickers) now goes through `FieldShell` using this render-function
  form, wiring their `SelectTrigger` correctly for the first time. `RadioGroup`,
  `AddressChipList` and the horizontal label-left/control-right rows
  (`SettingRow`, the Enabled toggle) stay hand-rolled for their own, unrelated
  reasons, each documented at its own call site.

- [#917](https://github.com/nextlyhq/nextly/pull/917) [`9d3b241`](https://github.com/nextlyhq/nextly/commit/9d3b241694672f8996690bb0115115ddb846fecc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): describe a field only when a description renders

  `FormControl` named the description element in `aria-describedby`
  unconditionally, while `FormDescription` renders nothing when it has no
  children. Every field without a description therefore pointed assistive
  technology at an element that was never on the page: the admin has 76
  `FormControl` usages against 3 `FormDescription`, and 13 of the 14 files using
  `FormControl` contain no description at all.

  `FormDescription` now registers its presence on the field context and
  `FormControl` composes `aria-describedby` from the elements that actually
  render. Measured in a browser across eight admin form routes in both themes:
  five dangling references before, zero after.

- [#967](https://github.com/nextlyhq/nextly/pull/967) [`7dc4c4d`](https://github.com/nextlyhq/nextly/commit/7dc4c4d87c42f9f47d720ec6de95dc336cceeb11) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Opening a document's version history no longer takes the document away. The panel was built on a
  modal surface, so it dimmed the page behind a scrim, trapped focus inside itself and withdrew
  everything else from the accessibility tree — leaving the one thing an editor needs beside a
  version, the document itself, unreachable and unscrollable. It is now a non-modal panel: the page
  stays lit, scrollable and focusable while history is open, and the panel closes from its own
  controls or Escape rather than from any click into the page.

  The Sheet primitive gains the same capability for every caller. Its root already accepted Radix's
  modal flag; the scrim is now derived from that one value rather than decided separately by the
  content, so a non-modal sheet cannot paint a scrim over a page it deliberately left interactive.
  Existing sheets are unchanged, because modal remains the default.

- [#874](https://github.com/nextlyhq/nextly/pull/874) [`09e8a8c`](https://github.com/nextlyhq/nextly/commit/09e8a8c4325eec4a27a49be2ed442dd1243f88e6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scaffolding into a project whose instruction files include one another through
  symlinks no longer writes a pointer that loops.

  A relative include resolves from the directory it was written in, so one file
  reached through two aliases in different directories points at two different
  targets. The scaffolder now identifies a visited file by that pair rather than by
  the file alone, so an alias whose includes lead somewhere new is followed instead
  of skipped.

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

- [#968](https://github.com/nextlyhq/nextly/pull/968) [`135137e`](https://github.com/nextlyhq/nextly/commit/135137e476f4f8cc3f21f5c6c9a7f742130ed3c8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two more admin lists — API keys and image sizes — use the shared list layout, so their search
  field, column control and spacing match the rest of the admin instead of each carrying their own.
  The image-sizes note about config-defined sizes now sits with the list it describes.

- [#949](https://github.com/nextlyhq/nextly/pull/949) [`9142a57`](https://github.com/nextlyhq/nextly/commit/9142a576b9cacfb615566304b857bb8f74e5e834) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field-group storage migration no longer rewrites the vocabulary stored inside field definitions. It renamed a stored field's `type` to a spelling no runtime code reads, so a migrated database held definitions the application refused at boot. Table, column and registry renames are unchanged, and a database migrated by an earlier build is repaired by rolling back and re-running.

- [#928](https://github.com/nextlyhq/nextly/pull/928) [`651f952`](https://github.com/nextlyhq/nextly/commit/651f9527be72e3738ab44816258d1e5c65b5fd07) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate:field-groups` renames field-group storage to its current names, and previews by default.

  Field groups were called components once, and the old vocabulary is still in the database: the registry table, each field group's data table, and the column naming which field group a stored row belongs to. Nextly reads whichever generation a database holds, so nothing forces this — a site that never runs it keeps working. This is the command for tidying it up, one site at a time.

  Running it with no flags writes nothing and prints the plan. Applying is `--apply`, which requires `--backup-confirmed` alongside it, and `--down` rolls a completed migration back. A preview takes no lock and issues no DDL, so it can be run with a read-only credential.

  The preview reports three things separately, because they answer different questions: every storage object that would be renamed, listed by name rather than counted; whether the plan was checked against your database or merely proposed, since another run writing at the same time makes the list an upper bound; and what could be seen of the migration lock, where "nothing is running" and "the lock could not be read" are reported as the different answers they are.

  A new guide, Field group storage migration, covers the per-site runbook, how to read the preview, and rollback.

- [#937](https://github.com/nextlyhq/nextly/pull/937) [`bf4bc63`](https://github.com/nextlyhq/nextly/commit/bf4bc63ed868f3abecf14eae10525ea61a52cd55) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate:field-groups --apply` could not complete.

  The command installed no table resolver, so the migration failed at its first system-table read with "Table \"dynamic_collections\" not found in schema registry" — on every database. Previewing was unaffected, which is why it was not caught: a preview stops before the writes that resolve tables, so the command previewed correctly and then failed on the first real run.

  Both spellings of the field-group registry are now registered, because this is the one operation that runs while that name is changing.

- [#924](https://github.com/nextlyhq/nextly/pull/924) [`8e4f633`](https://github.com/nextlyhq/nextly/commit/8e4f6335f49f192f72144d36082c5739e990df25) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): give the editor a per-node DOM address

  `PageRenderer` gains `nodeAttribute`, OFF by default. Turned on, each block's
  root carries `data-nx-node="<node id>"` — the only per-node hook that reaches the
  DOM independently of styling.

  The scoped class cannot serve: `classNameFor` returns the block-TYPE class alone
  for a node with no compiled styles, so hit-testing on the class cannot address an
  unstyled node and would resolve to the wrong instance. Most nodes on a real page
  are unstyled.

  The attribute is applied ABOVE `withNodeAttributes`' early return rather than
  joined to its allowlist loop, because that return fires for any node with no
  `cssId` and no `attributes` — nearly every node — so an address on the loop would
  have landed on almost nothing while a fixture setting either field passed.

  Off by default because a published page should not carry editor concerns, which
  is why Gutenberg's `data-block` is editor-only. Opt-in is also reversible;
  always-on would be a breaking change to remove.

  `NODE_ID_ATTRIBUTE` is published so an editor never hard-codes the spelling.

- [#952](https://github.com/nextlyhq/nextly/pull/952) [`b7fa15a`](https://github.com/nextlyhq/nextly/commit/b7fa15a17657903e040a42a5400632dfbee57e7f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Pages are built from blocks. The per-entry choice between the page builder and a rich-text editor is retired, so how an entry is edited is decided by its fields rather than stored on each entry.

- [#960](https://github.com/nextlyhq/nextly/pull/960) [`92c88a0`](https://github.com/nextlyhq/nextly/commit/92c88a0685a72e2c0364576afc747433e2bd2c74) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(tsconfig): give each package its own incremental build info

  `tsBuildInfoFile` was declared as a plain relative path in the shared base
  config, and a relative path there resolves against the file that declares it —
  not against the config extending it. Every package in the workspace therefore
  wrote its TypeScript incremental state to one shared file inside
  `packages/tsconfig`, each `tsc` run overwriting the last, so the state a package
  read back always described a different program. Turbo runs these in parallel,
  so they also raced to write it.

  The same path put the file outside every package's own directory, so turbo's
  package-scoped `outputs` matched nothing and 21 packages logged
  `no output files found for task <pkg>#check-types` on every run.

  `${configDir}` resolves to the directory of the extending config, which is what
  was meant. Removing the option instead is not available: tsup's dts step drives
  tsc through flags rather than a config file, where `--incremental` without an
  explicit `--tsBuildInfoFile` is TS5074 and fails the build.

- [#944](https://github.com/nextlyhq/nextly/pull/944) [`76a87de`](https://github.com/nextlyhq/nextly/commit/76a87de75fa6acab7606b3225abb6da43a590e57) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field provided by a plugin no longer flashes "Unknown field type" while the admin is still loading which plugins are installed.

- [#855](https://github.com/nextlyhq/nextly/pull/855) [`dcfe35d`](https://github.com/nextlyhq/nextly/commit/dcfe35dac4e86734eb4605a3895a6ffcd08fe8ef) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Resolve an entry preview URL in one place, on the server.

  A collection declares its preview two ways and they are disjoint: code-first writes a function of the entry, a UI-created collection writes a template string. Both are now answered by one resolver, so the admin asks where an entry previews instead of deciding for itself.

  Resolving on the server is what makes the preview button reachable for editors and authors. The site URL sits behind a settings permission neither role holds, so a browser-side answer was unavailable to exactly the people who share previews.

- [#971](https://github.com/nextlyhq/nextly/pull/971) [`b867052`](https://github.com/nextlyhq/nextly/commit/b867052dea9e00b84fcfc161f736e8d017f350c5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A read-only rich-text field no longer shows a row of dead formatting buttons. The toolbar was
  rendered and greyed rather than omitted, so every read-only rich-text field carried a band of
  controls that could not be used, and assistive technology found a toolbar with a dozen unusable
  buttons in it. The other structured inputs already drop their controls when the field cannot be
  edited; this one now matches them.

- [#886](https://github.com/nextlyhq/nextly/pull/886) [`58a7707`](https://github.com/nextlyhq/nextly/commit/58a77077950cdb9599d5020f109740f96abb97fe) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A table rebuilt from a live PostgreSQL snapshot keeps its declared column widths instead of widening them to unbounded.

- [#934](https://github.com/nextlyhq/nextly/pull/934) [`416bf6d`](https://github.com/nextlyhq/nextly/commit/416bf6d23699417f9f94c389fc562597ec8a659b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Remove the page builder's parallel document model, renderer and editor. Documents are the engine's `BlockDocument`, blocks render through `@nextlyhq/blocks-react`, and the plugin registers the `blocks` field rather than implementing an editor of its own. The `./render` entry is gone; `./admin` now exports only the blocks field's summary component.

- [#885](https://github.com/nextlyhq/nextly/pull/885) [`1b9e433`](https://github.com/nextlyhq/nextly/commit/1b9e433287a366c89d3a44df3e4ba0bcd3328dca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A content route now tells its `draft` decision which locale it reads in, and `previewDraftGate` compares the token against that locale rather than one configured separately. A preview link scoped to one translation is no longer accepted for another.

- [#908](https://github.com/nextlyhq/nextly/pull/908) [`033235a`](https://github.com/nextlyhq/nextly/commit/033235a7cf762426ed3ea389a4586d2aff58c7fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): a route emits the site stylesheet by default

  `createBlocksPage` gains `siteStyles` and supplies a sheet by DEFAULT, unlike the
  bare `PageRenderer`. Without one, every `{ $token }` resolves to nothing — and a
  framework route is exactly where "it should already work" is the right answer.
  `PageRenderer` stays opt-in because a standalone consumer owns its own `<head>`
  and may already emit a token sheet; a Nextly route owns neither.

  Default-on was licensed by measurement rather than assumed safe: no block
  declares a token (enforced by a ratchet over every `baseStyles`) and no seeded or
  fixture document references one, so nothing's appearance can change by the
  definitions arriving.

  `breakpoints` falls back to `styleContext`'s, derived once — two answers to "what
  are this site's breakpoints" is how the shared sheet and the page sheet come to
  disagree about which at-rules a tier compiles under, invisibly, because each
  sheet is internally consistent on its own.

  The root entry now re-exports `SiteSheetInput` and its transitive closure
  (`SiteTokenSet`, `SiteToken`, `TokenKind`, `FontFaceDef`, `FontSource`,
  `DarkModeStrategy`), so a consumer can construct a site's design system rather
  than merely name the prop.

- [#976](https://github.com/nextlyhq/nextly/pull/976) [`942d5d1`](https://github.com/nextlyhq/nextly/commit/942d5d1b47bf14ce6a22761d6176fadf0739d06a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Routes now declare which sidebar section they belong to, and plugins can choose where their own pages and menu items appear.

  The admin sidebar previously decided which navigation icon was active by matching the URL against a list of paths, falling back to Dashboard when none matched. A route missing from that list did not fail — it quietly highlighted Dashboard, which looks identical to a page that really is Dashboard. That is how a top-level admin route shipped highlighting the wrong entry, unnoticed.

  Each route now states its own section, and the type system requires it: a new admin route that does not say where it belongs fails to build instead of appearing in the wrong place.

  For plugin authors, admin pages and menu items accept an optional `section`, so a plugin is no longer confined to the Plugins area. Omitting it defers to the plugin's own placement, so a plugin that already declares where it lives does not repeat itself for every page, and `"standalone"` reuses the top-level entry and icon such a plugin already gets for its collections.

- [#793](https://github.com/nextlyhq/nextly/pull/793) [`bb98ed8`](https://github.com/nextlyhq/nextly/commit/bb98ed825029344476407d13cdec0f0b3feb83a1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scaffolded projects now ship an `AGENTS.md` agent guide and a `CLAUDE.md` that
  points at it, following the pattern the monorepo uses for itself.

  The guide is written for a coding agent picking the project up cold: where the
  config and collections live, which commands exist, and the things that surprise
  people — that `find()` is loosely typed until `types:generate` runs, that users
  are read through their own namespace rather than as a collection, and that a
  migration you generate is a single file in this project's own dialect, while a
  suffixed set beside it means that migration was shipped rather than generated.

  The generated content sits inside a managed block, so a future regeneration can
  replace it without touching notes written above or below it.

- [#954](https://github.com/nextlyhq/nextly/pull/954) [`17c9613`](https://github.com/nextlyhq/nextly/commit/17c961329ca69fec6237cdd0630c53bef3eecc2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - When a schema change is blocked by a stale migration lock, the error now names the command that clears it instead of advising a retry that cannot succeed.

- [#883](https://github.com/nextlyhq/nextly/pull/883) [`565f81a`](https://github.com/nextlyhq/nextly/commit/565f81ad2904963c51a19c6d5b8f4b7cbec87492) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema snapshots now record a column's declared size or precision, so field-group repair can tell a resized column from an unchanged one on PostgreSQL.

- [#955](https://github.com/nextlyhq/nextly/pull/955) [`50f1f43`](https://github.com/nextlyhq/nextly/commit/50f1f4348e75188ddf7dc134a448c363e74ba504) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(admin): name the settings secret field and verify label landing

  `SettingsRow` emits a `<label for>` for every row, while whether anything claims
  that id depends entirely on what the caller passes as children. The email
  provider's secret field wrapped its control in a positioning `<div>` inside
  `FormControl`, which is a Radix `Slot` and clones onto its single child — so the
  id, `aria-describedby` and `aria-invalid` all landed on the div. A label cannot
  name a div, so the API key and SMTP password fields had no accessible name and
  their validation errors were never announced, while the id still resolved.

  `FormControl` now sits on the input itself, and a development-time check reports
  both ways a label can fail to reach a control: an id nothing carries, and an id
  carried by an element a label cannot name. The mechanism is shared with the
  entry-form fields, which previously carried a presence-only copy that could not
  see the second case.

- [#892](https://github.com/nextlyhq/nextly/pull/892) [`f41d727`](https://github.com/nextlyhq/nextly/commit/f41d727897b6a8557da35f86b39b0f61e4e66866) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Dropdowns and pickers opened inside the page editor no longer stay on screen when the editor hides itself. If the editor did not have enough width it would show a notice explaining that, while an open dropdown floated on top of the notice and could still be clicked.

- [#884](https://github.com/nextlyhq/nextly/pull/884) [`fde0372`](https://github.com/nextlyhq/nextly/commit/fde03721180cc972195bc8ff460426c8fd91e97a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page editor now decides whether it fits by measuring the space it was actually given, rather than the size of the browser window. Embedded as a field inside a form on a wide screen, it used to conclude it had room and squeeze the rail, panel and canvas below the widths they need; it now says it needs more width in that case, and goes back to the full layout as soon as the space grows again.

  The media picker also no longer floats over that message. It opens in a layer outside the editor, so hiding the editor left an open picker visible and clickable on top of the notice saying the editor was unavailable.

- [#887](https://github.com/nextlyhq/nextly/pull/887) [`f5a5c9c`](https://github.com/nextlyhq/nextly/commit/f5a5c9cfd1fd97d04c5cca62a5a81d82315df2a6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page editor now says it needs more width, rather than a wider screen, when it cannot fit. It measures the space it was given, so an editor placed in a narrow column on a large display was telling authors their screen was too small, which was both untrue and impossible to act on.

- [#918](https://github.com/nextlyhq/nextly/pull/918) [`8f9f7cb`](https://github.com/nextlyhq/nextly/commit/8f9f7cb9d05b41222576d66730b8dd0872871a6a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(admin): record and recover autosaved work in Singles

  Singles get the same recovery points the entry editor already had: recorded
  while the author types, offered back on open, and reported in the header beside
  the save action.

  Autosave was previously present in one editor and silently absent in the other,
  which is a worse state than either extreme because nothing tells the author
  which one they are in.

- [#916](https://github.com/nextlyhq/nextly/pull/916) [`0ba8307`](https://github.com/nextlyhq/nextly/commit/0ba83079d661cd35ab85642b5374be5ab15fbc8f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): emit the design-token sheet by default from PageRenderer too

  `PageRenderer` was opt-in while a Nextly route emitted by default, and the
  asymmetry cost more than it saved: a block could not reference a token at all,
  because a default reading `color.surface` resolved on a route and silently
  resolved to nothing in a standalone render. `core/card` shipped with no
  background and no border for that reason, and the pressure that produced six
  blocks reaching for the admin `--nx-*` namespace stayed exactly where it was.

  Both paths now emit, and a host opts out with `siteStyles={false}` — an explicit
  refusal rather than an empty token list, because `resolveSiteTokens` LAYERS, so
  an empty override means "no overrides" and still yields every default. A test is
  what found that the opt-out did not exist at all.

  Breakpoints come from the RECONCILED compile context rather than the caller's
  `styleContext`, so a consumer rendering a stored artifact — the ordinary
  production path — gets a sheet instead of nothing.

- [#903](https://github.com/nextlyhq/nextly/pull/903) [`cc50a87`](https://github.com/nextlyhq/nextly/commit/cc50a871ff0398698fe828667229346861bcb33d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): emit the site stylesheet, so design tokens resolve at all

  `PageRenderer` gains an opt-in `siteStyles` prop that compiles the shared sheet
  and emits it BEFORE the page's own, and `blocks-engine` gains
  `resolveSiteTokens`, which layers a site's own tokens over the defaults by name.

  Until now nothing in the repository called `compileSiteSheet`. The token
  pipeline was built, tested and unreachable: `defaultSiteTokens()` was a default
  nobody applied, and every `{ $token }` compiled to a `var()` with nothing behind
  it. Three shipped blocks were broken by that and nothing reported it, because an
  unresolved custom property makes the declaration invalid at computed-value time
  and the property silently falls back to its initial value.

  Order is the cascade: font faces, tokens and block-type defaults first, the
  page's own sheet after, which is what lets a node's own value beat a class and a
  class beat a block default.

  Layering rather than replacing means a site supplying one brand colour does not
  thereby lose `content.width` and `space.4`. This is the arrangement Gutenberg's
  `theme.json` reaches — core defaults, then the theme's file, then the user's
  saved styles — and a stored per-site override layers the same way, so the third
  tier needs no new mechanism.

  Opt-in rather than automatic: emitting token definitions unasked changes what a
  stored token reference resolves to, and a page whose current appearance depends
  on one dangling is a page that moves.

- [#911](https://github.com/nextlyhq/nextly/pull/911) [`2d7cebd`](https://github.com/nextlyhq/nextly/commit/2d7cebdf5fab4f7c7d26cb739e72606ea90963de) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-engine): add color.surface, color.border and color.muted to the guaranteed token set

  The guaranteed set had no surface colour and no border colour, and their absence
  made four blocks compromise: `core/card` shipped with no background and no
  border, `badge` was unbuildable because a tinted background IS the block, the
  accordion had no divider and the table no border colour.

  It also created a defect class. Because nothing in the set could express a
  surface, six blocks across three lanes independently reached for `--nx-*` — the
  ADMIN namespace, which no published page emits, so those rules validated,
  compiled, shipped and resolved to nothing. That is design pressure rather than
  six mistakes: when the correct mechanism is missing, whatever resembles it gets
  used.

  All three define both light and dark values, and a test now requires that of
  every colour token rather than only the new ones — a colour defined only for
  light silently keeps its light value on a dark page. `color.muted` was chosen to
  clear WCAG AA against `color.background` in both modes rather than by eye,
  because a muted token that fails contrast is worse than none: it reads as
  sanctioned.

  One border colour rather than a subtle/strong scale. A scale is much harder to
  remove from a guaranteed set than to add to one, and no block has asked for the
  distinction; a site wanting more defines its own, and `resolveSiteTokens` layers
  additions by name.

- [#956](https://github.com/nextlyhq/nextly/pull/956) [`ec90b04`](https://github.com/nextlyhq/nextly/commit/ec90b04eb763793702ddd1afa82e08c78c65ba5d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Comparing two versions now opens a dialog sized for a comparison instead of a third mode inside
  the 480px history panel. A diff is a two-column reading by nature, and that panel could not hold
  two columns, so the comparison was written to stack; each field now states its before and after
  side by side under headings naming the two versions, and folds back into a stack only where the
  surface is genuinely too narrow for two. A field that exists on one side only says so on the
  other, rather than leaving a blank that reads the same as an empty value. The history panel keeps
  its list and preview and no longer swaps its body out to compare.

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

- [#894](https://github.com/nextlyhq/nextly/pull/894) [`05fa889`](https://github.com/nextlyhq/nextly/commit/05fa88981d5df7dcb5cb6a77dee4046f4d5039e5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(nextly): add a concurrency token to the autosave compare-and-set

  The rolling autosave row is rewritten in place, guarded by a compare-and-set so
  that two tabs belonging to one author cannot overwrite each other. That guard
  compared `updated_at` against the value the write had observed, and the stored
  resolution of a timestamp differs per dialect: SQLite keeps whole epoch seconds
  and MySQL milliseconds. Two rewrites close enough together serialize
  identically, so the second writer observes exactly what the first wrote, its
  predicate matches, and it overwrites newer work believing the row untouched.

  `nextly_versions` gains a monotonic `revision` counter. The compare-and-set
  reads it, applies only while the row still holds it, and writes its successor.
  A counter has no resolution to exhaust, so the guard holds however close
  together two writes fall.

  The column is additive and carries a default, so `nextly migrate` adds it to
  databases that already exist rather than refusing the migration.

- [#973](https://github.com/nextlyhq/nextly/pull/973) [`0d974f7`](https://github.com/nextlyhq/nextly/commit/0d974f738a633ea7280726bffb5b4ee3ad04cdd0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix two defects in `@nextlyhq/eslint-plugin`'s colour vocabulary.

  `no-palette-classes` missed a fixed palette colour placed behind an arbitrary Tailwind variant — `data-[state=open]:bg-red-500`, `supports-[display:grid]:bg-red-500` and the bracket-led `[&>*]:bg-red-500` all reported clean, so a colour that ignores dark mode and retheming passed lint.

  `no-hardcoded-colors` rejected the four-digit spelling of the mode-invariant colours it documents as legitimate: `#0000` and `#fff8` were reported as hardcoded, because alpha was only offered on the six-digit forms.

- Updated dependencies [[`bf1477a`](https://github.com/nextlyhq/nextly/commit/bf1477aa82fdcca011b955a8764d1a2848e7e04b), [`1cb27c2`](https://github.com/nextlyhq/nextly/commit/1cb27c201fef195bd470c3d7bd54d4621dfb6610), [`70ab60f`](https://github.com/nextlyhq/nextly/commit/70ab60f8dfac2bb5b231f04c217ba555ef1596ac), [`01b32a2`](https://github.com/nextlyhq/nextly/commit/01b32a21c45c52e9cdd90c5464cbf86743a3c2ff), [`8efeff5`](https://github.com/nextlyhq/nextly/commit/8efeff5b4d6c83936629a8594ef493cc4450cff5), [`8ff3ed3`](https://github.com/nextlyhq/nextly/commit/8ff3ed33e40a9f6b238eecea889249f6086f9cd0), [`67926e3`](https://github.com/nextlyhq/nextly/commit/67926e3f70c5c17f40c2b424fe20fec4b1e6c727), [`9ea28f1`](https://github.com/nextlyhq/nextly/commit/9ea28f10c0b49f3161e4ad7f4acf394aa09b3fdd), [`1dd9b90`](https://github.com/nextlyhq/nextly/commit/1dd9b90cfe67c220ddf12495d6d6126b4bd76f45), [`69f3a61`](https://github.com/nextlyhq/nextly/commit/69f3a6141aeb610844216346790b4e6b25b9cf9e), [`7fa0cc2`](https://github.com/nextlyhq/nextly/commit/7fa0cc27abfab02cf2e960f616848106f4b99b8c), [`5c0a5ff`](https://github.com/nextlyhq/nextly/commit/5c0a5ffcd6b3d4498b2b443608df1854ba50ceac), [`2585aab`](https://github.com/nextlyhq/nextly/commit/2585aabea3bdd27a9ba7be33fe6730a35a448c09), [`f19b259`](https://github.com/nextlyhq/nextly/commit/f19b259f08e3feafe59864571a39e9e65e3c5db9), [`53c9909`](https://github.com/nextlyhq/nextly/commit/53c9909839bb16e4af86f3a94e36de1682346186), [`2638c5f`](https://github.com/nextlyhq/nextly/commit/2638c5f5ecf431d1d10745cb4e6d660cf2f60f5a), [`68a2903`](https://github.com/nextlyhq/nextly/commit/68a2903c47c8037dfcbe722a9e233869b9bee61d), [`27b8b45`](https://github.com/nextlyhq/nextly/commit/27b8b455f0327aaa74389d37ff023bd7d16db5bd), [`c17e9f6`](https://github.com/nextlyhq/nextly/commit/c17e9f6717750c8c31adf968a2be8b67b448bf25), [`aef5d90`](https://github.com/nextlyhq/nextly/commit/aef5d909feff93e773dd03cc4133b51b1ad1bd41), [`a458074`](https://github.com/nextlyhq/nextly/commit/a45807451d1572cdb44ebfbd9421af49909cc036), [`f6497c7`](https://github.com/nextlyhq/nextly/commit/f6497c788a29c36b72a05574b6afa0c348b658f2), [`e3bafe8`](https://github.com/nextlyhq/nextly/commit/e3bafe82889959fe90ba8bd8b40d721eeaa66d31), [`cfabd89`](https://github.com/nextlyhq/nextly/commit/cfabd89a0fcf4a4a746da88666c744f9c71c54fc), [`e50fcbf`](https://github.com/nextlyhq/nextly/commit/e50fcbf7dc74a87305dc94c1c53d1fdd2671bc3d), [`ac1d8e1`](https://github.com/nextlyhq/nextly/commit/ac1d8e1e0c1cc60064ec39d401badc7251672593), [`0277719`](https://github.com/nextlyhq/nextly/commit/0277719b340ccc05f57c97eab4129bae100a58f3), [`4e4272a`](https://github.com/nextlyhq/nextly/commit/4e4272abe35d656e4081e05fa80302040f65bd81), [`566b592`](https://github.com/nextlyhq/nextly/commit/566b592a74cd2a8ccbece30b629b8512fa5c3fcc), [`7acb441`](https://github.com/nextlyhq/nextly/commit/7acb44182c3886cc99714b49cd33759eb35d4a48), [`50d1d73`](https://github.com/nextlyhq/nextly/commit/50d1d7368f902ae3eab6e14d0716197c91963e76), [`fac7f05`](https://github.com/nextlyhq/nextly/commit/fac7f05c6e7f52ffba0c32d516ac17e97b62c069), [`412518f`](https://github.com/nextlyhq/nextly/commit/412518f3f23c1199ab887dcf486f6823005e96f6), [`e045e5c`](https://github.com/nextlyhq/nextly/commit/e045e5cfcaa8ee12f60a70bc02c77eab5da81f4b), [`33c0cd6`](https://github.com/nextlyhq/nextly/commit/33c0cd696c07dfd6a789ece5a499c1306403f49d), [`9d5111d`](https://github.com/nextlyhq/nextly/commit/9d5111dbcef507d98b3f81b3adadc19b5f37210c), [`87c544d`](https://github.com/nextlyhq/nextly/commit/87c544d6904f0f7f66f4287199f70e276ee34266), [`37fa697`](https://github.com/nextlyhq/nextly/commit/37fa6970659ac2db1355d7176706b3ae6f906985), [`51acbc2`](https://github.com/nextlyhq/nextly/commit/51acbc205506c96cfed799162a440b660037dd0b), [`a217a11`](https://github.com/nextlyhq/nextly/commit/a217a11baa95de76eb3fe05f48b0a3cf02454e58), [`7a37c01`](https://github.com/nextlyhq/nextly/commit/7a37c01c22222e23f5b4741cb2ce2e4e6a5d0c21), [`6963637`](https://github.com/nextlyhq/nextly/commit/69636376c9170e7f63260a95ce6c774d399117d7), [`486696c`](https://github.com/nextlyhq/nextly/commit/486696c2d4e3f866d6bb9c138bfd584983de6509), [`296a050`](https://github.com/nextlyhq/nextly/commit/296a050d104b99c4146bb35e3465440b81e33b4a), [`a5d1c1f`](https://github.com/nextlyhq/nextly/commit/a5d1c1f8f124e535b734ce640c019cfdf6702016), [`06ae4f4`](https://github.com/nextlyhq/nextly/commit/06ae4f4c7a989de9500ca8b0023ae00e58e2ff13), [`9d3b241`](https://github.com/nextlyhq/nextly/commit/9d3b241694672f8996690bb0115115ddb846fecc), [`7dc4c4d`](https://github.com/nextlyhq/nextly/commit/7dc4c4d87c42f9f47d720ec6de95dc336cceeb11), [`09e8a8c`](https://github.com/nextlyhq/nextly/commit/09e8a8c4325eec4a27a49be2ed442dd1243f88e6), [`fa0db5e`](https://github.com/nextlyhq/nextly/commit/fa0db5eb51c477fc2b73cd6bcf04252bd774736e), [`d16b42c`](https://github.com/nextlyhq/nextly/commit/d16b42cae03c18417bad7728fc49ab31ba3abbbd), [`02a4df8`](https://github.com/nextlyhq/nextly/commit/02a4df814dbbd1ef84308e25244537095da696ea), [`1b369d1`](https://github.com/nextlyhq/nextly/commit/1b369d1a60ee2174fe94c7c984394de988d3bfd7), [`135137e`](https://github.com/nextlyhq/nextly/commit/135137e476f4f8cc3f21f5c6c9a7f742130ed3c8), [`4524623`](https://github.com/nextlyhq/nextly/commit/452462393dd6f1145f80c4d89e5b64f2c4f8e69a), [`9142a57`](https://github.com/nextlyhq/nextly/commit/9142a576b9cacfb615566304b857bb8f74e5e834), [`651f952`](https://github.com/nextlyhq/nextly/commit/651f9527be72e3738ab44816258d1e5c65b5fd07), [`bf4bc63`](https://github.com/nextlyhq/nextly/commit/bf4bc63ed868f3abecf14eae10525ea61a52cd55), [`8e4f633`](https://github.com/nextlyhq/nextly/commit/8e4f6335f49f192f72144d36082c5739e990df25), [`b7fa15a`](https://github.com/nextlyhq/nextly/commit/b7fa15a17657903e040a42a5400632dfbee57e7f), [`92c88a0`](https://github.com/nextlyhq/nextly/commit/92c88a0685a72e2c0364576afc747433e2bd2c74), [`76a87de`](https://github.com/nextlyhq/nextly/commit/76a87de75fa6acab7606b3225abb6da43a590e57), [`dcfe35d`](https://github.com/nextlyhq/nextly/commit/dcfe35dac4e86734eb4605a3895a6ffcd08fe8ef), [`b867052`](https://github.com/nextlyhq/nextly/commit/b867052dea9e00b84fcfc161f736e8d017f350c5), [`58a7707`](https://github.com/nextlyhq/nextly/commit/58a77077950cdb9599d5020f109740f96abb97fe), [`416bf6d`](https://github.com/nextlyhq/nextly/commit/416bf6d23699417f9f94c389fc562597ec8a659b), [`1b9e433`](https://github.com/nextlyhq/nextly/commit/1b9e433287a366c89d3a44df3e4ba0bcd3328dca), [`033235a`](https://github.com/nextlyhq/nextly/commit/033235a7cf762426ed3ea389a4586d2aff58c7fa), [`942d5d1`](https://github.com/nextlyhq/nextly/commit/942d5d1b47bf14ce6a22761d6176fadf0739d06a), [`bb98ed8`](https://github.com/nextlyhq/nextly/commit/bb98ed825029344476407d13cdec0f0b3feb83a1), [`17c9613`](https://github.com/nextlyhq/nextly/commit/17c961329ca69fec6237cdd0630c53bef3eecc2d), [`565f81a`](https://github.com/nextlyhq/nextly/commit/565f81ad2904963c51a19c6d5b8f4b7cbec87492), [`50f1f43`](https://github.com/nextlyhq/nextly/commit/50f1f4348e75188ddf7dc134a448c363e74ba504), [`f41d727`](https://github.com/nextlyhq/nextly/commit/f41d727897b6a8557da35f86b39b0f61e4e66866), [`fde0372`](https://github.com/nextlyhq/nextly/commit/fde03721180cc972195bc8ff460426c8fd91e97a), [`f5a5c9c`](https://github.com/nextlyhq/nextly/commit/f5a5c9cfd1fd97d04c5cca62a5a81d82315df2a6), [`8f9f7cb`](https://github.com/nextlyhq/nextly/commit/8f9f7cb9d05b41222576d66730b8dd0872871a6a), [`0ba8307`](https://github.com/nextlyhq/nextly/commit/0ba83079d661cd35ab85642b5374be5ab15fbc8f), [`cc50a87`](https://github.com/nextlyhq/nextly/commit/cc50a871ff0398698fe828667229346861bcb33d), [`2d7cebd`](https://github.com/nextlyhq/nextly/commit/2d7cebdf5fab4f7c7d26cb739e72606ea90963de), [`b4a0e9c`](https://github.com/nextlyhq/nextly/commit/b4a0e9c40c8f74362224803a7d8eaf8db4733905), [`b20b41e`](https://github.com/nextlyhq/nextly/commit/b20b41e6c5bdab57b1081e7e9380d28bfa890e6b), [`ec90b04`](https://github.com/nextlyhq/nextly/commit/ec90b04eb763793702ddd1afa82e08c78c65ba5d), [`4891d3f`](https://github.com/nextlyhq/nextly/commit/4891d3fae8ca1ce9a75ef3e44e38357b4f967888), [`4fb19fe`](https://github.com/nextlyhq/nextly/commit/4fb19feb500e33941ab32fd0f7e4ae2cb29b36a0), [`05fa889`](https://github.com/nextlyhq/nextly/commit/05fa88981d5df7dcb5cb6a77dee4046f4d5039e5), [`0d974f7`](https://github.com/nextlyhq/nextly/commit/0d974f738a633ea7280726bffb5b4ee3ad04cdd0)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.59
  - @nextlyhq/blocks-react@0.0.2-alpha.59
  - @nextlyhq/ui@0.0.2-alpha.59
  - @nextlyhq/plugin-sdk@0.0.2-alpha.59

## 0.0.2-alpha.58

### Patch Changes

- [#720](https://github.com/nextlyhq/nextly/pull/720) [`8a7e734`](https://github.com/nextlyhq/nextly/commit/8a7e734cce5d8948b779d28ff875a41c63e0071a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Take the reference palette's light-mode values for the admin, and record what
  that costs where a reader will find it.

  `--nx-input`, `--nx-border-strong` and `--nx-sidebar-border` move to the
  reference border weight; `--nx-destructive` and `--nx-destructive-solid` move to
  the reference red; `--nx-sidebar-foreground` matches the active nav ink so the
  sidebar reads at body-text weight.

  Several of those render below their WCAG minimum, deliberately. Each affected
  pairing is listed in the new `contrast/accepted.ts` with the ratio it actually
  measures, and the contrast suites hold every entry to three properties: it still
  measures what is recorded, it is still below its threshold, and it still names a
  token the theme declares. The sharpest is white on the destructive fill at
  3.84:1, which is the label of the Delete, Discard and Unpublish confirm buttons.

  Because resting and active sidebar ink are now one value in light mode, the
  active row also carries a font-weight change. A fill at 1.11:1 cannot identify a
  state on its own, and a weight difference is not a colour, so it is not subject
  to a contrast ratio at all.

  Dark mode is unchanged apart from `--nx-success`, which moves a step lighter to
  clear its minimum on the muted surface with the margin the suite requires.

  Checkbox and radio take a new `--nx-control-border` rather than following the
  field border down. A field is identifiable without its edge; an unchecked box is
  only the box, so its boundary is held to 3:1 with no acceptance.

- [#830](https://github.com/nextlyhq/nextly/pull/830) [`f53dbd8`](https://github.com/nextlyhq/nextly/commit/f53dbd82ffa339c278630b12c7d812fbf4ea0ba3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give every admin list one owner for its page state, and one source for its page-size policy.

  Twelve list surfaces each held the same two `useState` calls plus their own `handlePageSizeChange` wrapper that set the size and then reset the page. They now use the existing `usePagination` hook, which owns those resets. That removes the drift risk across the copies and, more usefully, removes the wrapper entirely: `onPageSizeChange` is the hook's `setPageSize`, which resets the page in the same update, so a query keyed on both refetches once rather than twice.

  The page-size options were a literal `[10, 25, 50]` written out at nine call sites. They are now `PAGINATION.TABLE_PAGE_SIZE_OPTIONS`, beside the existing page-size constants, so the policy can change in one place. The two lists that deliberately differ keep their own: the media grid offers 12/24/48/96 because it lays out thumbnails, and the delivery log offers 20/50/100 because it is read in long scans. `usePagination`'s own defaults now derive from those constants rather than restating 0 and 10.

  `Pagination`'s `pageSizeOptions` is typed `readonly number[]`, since the component only maps over it and a mutable type would reject the shared options for no reason a caller could act on.

  Two lists stay off the hook and say why where they declare their state. The entries list is 1-indexed because that is what its API takes, and converting at every read and write trades one clear boundary for a class of off-by-one. The relationship picker accumulates results rather than paginating them: its page number only increments, results append, and there is no way back to a previous page.

- [#840](https://github.com/nextlyhq/nextly/pull/840) [`f5a5405`](https://github.com/nextlyhq/nextly/commit/f5a540543aa36ea2853b0d043312765ac4ca7e54) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `GET /api/admin-meta/workspace`, a session-gated route serving the admin metadata that describes the installation: mounted plugins and their contributions, configured locales, custom sidebar groups, and builder availability. `/api/admin-meta` still serves these alongside branding until the admin reads them from the new route, so nothing is withheld from an anonymous caller yet.

- [#783](https://github.com/nextlyhq/nextly/pull/783) [`376a3a4`](https://github.com/nextlyhq/nextly/commit/376a3a49a0a5d0a13a85c546cebd08444a9443ed) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Repair the blog template so a scaffolded project type-checks and builds.

  A new blog project failed its build at the search-index step: it has no posts,
  so Pagefind indexed nothing and exited non-zero. The empty case is now reported
  and skipped, while a real Pagefind failure still stops the build.

  SQL statement splitting no longer tracks string state through comment text. An
  apostrophe in a retained comment opened a string that never closed, which merged
  every following statement into one that SQLite rejects.

  The query layer narrows documents with runtime-checked readers instead of
  asserting them to its domain types, and a collection can declare defaultColumns
  in code as the admin and the visual schema already allowed. That option is now
  also carried through collection sync, which previously rebuilt the persisted
  admin shape in two places and dropped it in both.

  Type change worth reading before upgrading: `FindUsersArgs` no longer inherits
  the `FindArgs` options that `users.find()` does not implement — `where`,
  `status`, `sort`, `select`, `populate` and `pagination`. Passing them compiled
  and did nothing, so a `where` clause intended as an exact lookup returned the
  first arbitrary user; code that passes one will now fail to compile. Use
  `search`, or read a page and compare the field directly.

- [#785](https://github.com/nextlyhq/nextly/pull/785) [`8dc013e`](https://github.com/nextlyhq/nextly/commit/8dc013efe16d092c852fdd84db548f755a53fbee) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Refuse to start when boot migrations did not run. With `db.runMigrationsOnBoot`,
  an instance that could not take the migrate lock before its wait deadline used
  to log `Boot migrations complete (0 applied)` and serve traffic — `applied` is 0
  there and 0 on an up-to-date database, so nothing distinguished them. On a
  rolling deploy that is the second replica serving against a schema it never
  migrated. It now fails startup, which an orchestrator retries once the other
  instance finishes; a genuinely stale lock is cleared with
  `nextly migrate --force-unlock`.

  `withMigrateLock` reports whether its body ran instead of returning `undefined`
  for both "returned nothing" and "never ran", so every caller has to decide. Its
  wait-timeout message said "proceeding without it" while returning without
  running the migrations, and now says they were skipped.

- [#768](https://github.com/nextlyhq/nextly/pull/768) [`7ea3567`](https://github.com/nextlyhq/nextly/commit/7ea3567c5c858d5ada4d8537c54e5aa88dc546df) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(create-nextly-app): generate a build script that runs on Windows, and stop swallowing a failed search-index build

- [#752](https://github.com/nextlyhq/nextly/pull/752) [`59d84dd`](https://github.com/nextlyhq/nextly/commit/59d84ddc00c32c067c20a041b09e8f537befa27a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a command palette to the page-builder editor. Opens on `mod+k`, searches the commands the host
  supplies, and runs the one chosen. Commands are data rather than built in, so the palette holds the
  keyboard surface and the host keeps its own vocabulary.

- [#754](https://github.com/nextlyhq/nextly/pull/754) [`51ddce0`](https://github.com/nextlyhq/nextly/commit/51ddce0ce43df0e7800167426c531ac64ddcb56c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - point the builder dev watchers at `src`, so `pnpm dev` rebuilds again

  `tsup --watch` defaults to watching `.`, and at that root it never notices an
  edit: no `Change detected`, no rebuild, and an artifact byte-identical
  afterwards. Measured back to back on tsup 8.5.0 — `--watch .` saw nothing,
  `--watch src` detected the same edit and rebuilt it.

  Nothing errored while it was broken, which is why it survived: the watcher logs
  a successful initial build and then `Watching for changes`, and the only symptom
  is the ABSENCE of a later build line in output that scrolls. Anyone debugging a
  stale `dist` was debugging code that had never been rebuilt.

- [#733](https://github.com/nextlyhq/nextly/pull/733) [`24a3a4d`](https://github.com/nextlyhq/nextly/commit/24a3a4d8a145cf28d86ad8f4adaed1a01e886704) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - add the page-builder editor shell

  `@nextlyhq/builder` gains `BuilderShell` — the editor frame: an icon rail, one
  switched left panel, the canvas slot, a fixed right inspector, and the bars
  around them. Presentational by contract: it owns which panel is open and the
  region widths, and owns nothing about the document, so selection arrives as a
  prop.

  Also exported: the shell's own decisions (`LEFT_PANELS`, `PANEL_BOUNDS`,
  `RAIL_WIDTH`, `MIN_SHELL_WIDTH`, `MIN_CANVAS_WIDTH`) and the `PreferenceStore`
  port a host implements to keep chrome preferences wherever it already keeps
  preferences.

  New subpath `@nextlyhq/builder/styles.css` carries the `--nx-builder-*` chrome
  token layer. A consumer that renders the shell without importing it gets
  unstyled markup.

- [#682](https://github.com/nextlyhq/nextly/pull/682) [`7b19d8a`](https://github.com/nextlyhq/nextly/commit/7b19d8a32ef93fa0fca34a04e0fa245e35f83f67) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the op store's vocabulary and inverse derivation to the builder: every document change is one of four id-addressed ops, and the op that undoes it is derived from the state it was applied to rather than declared by the caller.

- [#831](https://github.com/nextlyhq/nextly/pull/831) [`7a23525`](https://github.com/nextlyhq/nextly/commit/7a2352598add92995fd8f3314a1eced3f87cef5d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Rank every canvas drop target on one collision scale, so which target claims the pointer no longer depends on how deeply the page nests.

- [#813](https://github.com/nextlyhq/nextly/pull/813) [`a6555f8`](https://github.com/nextlyhq/nextly/commit/a6555f87b80d7f454de94a69ed850c773a279567) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop the page-builder canvas reflowing when a drag starts. Drop zones no longer grow from zero to six pixels on dragstart, so blocks stay where they are while you aim, and the insertion bar now paints above blocks that carry a stacking context of their own.

- [#781](https://github.com/nextlyhq/nextly/pull/781) [`cec9cc3`](https://github.com/nextlyhq/nextly/commit/cec9cc391639f1632882d7f5af0c5d9f5d989145) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Updating a field group now changes its table wherever the update comes from. The mounted PATCH route and the Direct API previously stored the new fields without moving the physical schema, so only the admin panel performed the whole operation. A companion-table transition that fails now refuses the update instead of recording it as done, and the Direct API can toggle a field group localized.

- [#795](https://github.com/nextlyhq/nextly/pull/795) [`faf7fd7`](https://github.com/nextlyhq/nextly/commit/faf7fd704e2625cf9c2ca1156fbe02c73f270e53) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add `core/column` as a real block and restrict `core/columns` to accept only columns, so a column can carry its own width, background and alignment.

  A block whose slot refuses it is now reported by the repair banner and repaired by WRAPPING it in the one type the slot admits, so a page stored with loose children in a columns row can be fixed without discarding them. The block library's Insert button applies the same drop rules a drag does, inserting into the nearest place that accepts the block and reporting when there is nowhere. Slots declare whether they lay their children out with flex or grid, so the canvas stops interleaving drop zones that would become cells of that layout.

  A block can declare the parents it may sit under — `parent`, matching the field of the same name in Gutenberg's block metadata — enforced on the editor and the write path alike, with the repair banner offering to wrap a stray block in the parent it names. This is the half a slot's `allow` list cannot express: a slot naming a type must not confine that type to it, and a block that is meaningless outside one parent has to say so itself.

  It is declared on `@nextlyhq/blocks-engine`'s `BlockDefinition`, so it reaches plugin authors through `@nextlyhq/plugin-sdk/blocks` alongside every other block field. A contributed block's nesting rules are enforced wherever the engine registry is populated — the write validator, the repair finder and the node constructor resolve a block's slots and permitted parents through it when this package's own registry does not hold the block. **Not yet in the browser editor:** blocks are registered by a plugin's server-side `init`, and the admin's client config transports only `remotePatterns`, so the browser realm's registry is empty and the canvas applies no contributed rule. Enforcement therefore holds at SAVE and not during editing, which is the safe direction — a document the editor let you build is still refused rather than stored — and it is a gap rather than a design. Slot allow-lists honour the engine's namespace wildcard (`core/*`) wherever they are read, rather than only exact names.

  `core/column` uses `parent` so inserting a Column while one is selected produces a sibling in the row rather than a column nested inside a column.

  `blocks.manifest.json` carries `parent`, and its `manifestVersion` moves to **2**. That artifact is read by editor builds and by agents to decide where a block may legally sit, so omitting the field would not have made the restriction lenient — it would have told every reader there was none, and they would generate placements the write validator then refuses. The bump is required rather than cautious: the entry schema is strict, so a v1 reader rejects an entry carrying the new field outright.

  The block library's Insert button now reaches a container's NAMED slot, not only `default`, so a container the drag path accepts is no longer refused by the click path. Documents are migrated when the editor loads them, which is what makes any block's `migrate` reachable at all — and migration only ever moves a document forward, never stamping an older definition version onto data written by a newer one.

  The slot rules are now enforced in the editor's reducer, so paste, keyboard reorder and anything added later cannot write a document the save path refuses — previously only drag-and-drop consulted them. Documents are migrated when the editor loads them, which is what makes any block's `migrate` reachable at all.

  Every drop target on the canvas now ranks by its depth in the tree, rather than only the zones between children doing so. A droppable that names no collision priority keeps the one its detector assigned — 3 with the pointer inside it, 2 otherwise — and dnd-kit compares priority before collision type and before overlap, so those targets outranked every zone shallower than that constant however the rectangles lay. The insert-before and append targets carried on each block were in that state, which put a nested container's own append target at or below the zones of the container holding it. They now read the same depth the zones do, so nesting decides which container claims a drop and geometry decides only where depths tie.

  Fixes a crash opening an Image's aspect-ratio control: Radix refuses a select item whose value is the empty string.

- [#766](https://github.com/nextlyhq/nextly/pull/766) [`29e8129`](https://github.com/nextlyhq/nextly/commit/29e812978aa103900bf229cb463834527b810c70) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group storage migration lock is now part of the schema Nextly reconciles. It was created on demand and declared nowhere, so it sat outside every migration: a change to that table could never reach an installation that already had one, because the statement that creates it does nothing to a table that exists. Nothing about the lock behaves differently today; what changes is that it can be maintained at all.

- [#758](https://github.com/nextlyhq/nextly/pull/758) [`fb9a0c0`](https://github.com/nextlyhq/nextly/commit/fb9a0c0adee95279897796bb3f9ef454457e1525) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Show a disabled plugin's permissions on its detail page. They are seeded and
  granted whatever the plugin's enabled state, so withholding them made the page
  disagree with the database. Routes stay withheld — those genuinely are not
  mounted — and are disclosed separately as pending.

- [#817](https://github.com/nextlyhq/nextly/pull/817) [`5fc9cc7`](https://github.com/nextlyhq/nextly/commit/5fc9cc7857f8c0685289fe2473ffd5243fe45b76) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An email provider update no longer records a configuration change when a parser returns the same fields in a different order. `updateProvider` compared serialised text while the write path compares structurally, so a save that altered nothing could file a configuration-change entry in the activity log.

- [#751](https://github.com/nextlyhq/nextly/pull/751) [`e344e47`](https://github.com/nextlyhq/nextly/commit/e344e47aca0aef1df894d52b06d9c985568bf390) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email delivery log is now bounded, and an erasure request survives a
  secret rotation.

  The log records who was written to, identified by a digest of their address,
  and it grew on every send with nothing to remove it. The column that was meant
  to govern it and the index beside it were written and never read, so an
  operator reading a labelled retention class would reasonably have concluded
  something enforced it.

  A sweep now removes rows past their window. It is offered by the SEND path
  rather than by a content write, because rows here are created by sends: that is
  when the table grows, a content write has no relationship to email volume, and
  an install that never sends mail carries no pass at all. Omitting the setting
  keeps a default window rather than keeping rows forever, since an unbounded
  record of recipients is not a reasonable default for a table an install fills
  without opting in.

  This is the second half of erasure, and the halves cover different people.
  Erasing a named recipient only reaches someone a caller can name, and many
  recipients never had an account. The sweep reaches every row by age, whoever it
  belonged to.

  Erasure also reached only rows hashed with the CURRENT secret. Rotating it left
  older rows carrying a value the request no longer computed, so it matched
  nothing and reported success — a privacy request that silently under-delivers.
  Retired secrets can now be listed in \`NEXTLY_SECRET_PREVIOUS\`, kept for reading
  and never for writing, and an erasure matches every digest those generations
  could have produced. It accepts a comma-separated list for the ordinary case and
  a JSON array for the secrets a comma-separated list cannot express — one holding
  a comma or significant whitespace, \`null\` for a generation that was unkeyed, and
  \`""\` for a secret that really was empty. Documented under "Rotating
  \`NEXTLY_SECRET\`" in the environment reference.

  Two things are deliberately unchanged. A send already in flight when a deletion
  commits still records its row; closing that would mean keeping a list of the
  addresses that asked to be forgotten, and the sweep bounds the row instead. And
  the retry columns stay inert: nothing drains this table, and a queue nobody
  drains looks durable without being so.

- [#807](https://github.com/nextlyhq/nextly/pull/807) [`8bb149f`](https://github.com/nextlyhq/nextly/commit/8bb149f5ef4adc116f5017edf45227bfb3a60b29) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Direct API now reports whether a field group is localized. A field-group update whose registry write fails after its companion table already changed is recorded with a new `diverged` migration status and reported as a change that stands, rather than raised as though nothing had happened. `diverged` is deliberately distinct from `failed`: `failed` means the table was never created and retrying is the repair, while `diverged` means the tables hold the new shape and the stored definition holds the old one, so the field group must be reconciled and the edit must NOT be retried. A diverged field group is refused for further schema edits until it is reconciled.

- [#800](https://github.com/nextlyhq/nextly/pull/800) [`7b23e26`](https://github.com/nextlyhq/nextly/commit/7b23e26f27e716a06815e7b995eb0e55a7415df8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Updating a field group now refuses a field change that would need a column on its main table, pointing the caller at the schema preview and apply flow. Previously the request succeeded, recorded the new fields, and left the table without the columns it claimed to have.

- [#745](https://github.com/nextlyhq/nextly/pull/745) [`4c8d39c`](https://github.com/nextlyhq/nextly/commit/4c8d39c312db0feb8093f14751655779ce27793a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Retention no longer reads a sub-millisecond window as a request to delete everything.

  A retention window is a whole number of milliseconds, so a fractional value is
  rounded down. That rounding ran AFTER the check for zero, which meant any window
  under one millisecond arrived as a window rather than as the zero it becomes:
  \`0.5\` was not zero when the check ran, and was zero by the time it was used.

  On the audit trails a window of zero is treated as a mistake and replaced by the
  default, because erasing the record of who did what on a typo is not
  recoverable. That protection was reachable only by writing exactly zero. A value
  that rounded to zero skipped it and produced a cutoff of the current moment,
  which removes the entire trail on the next pass.

  The rounding now happens before the reading, so a window is judged as the value
  it actually resolves to. A delivery ledger set to a fraction still keeps
  nothing, which is that trail's own position on zero and unchanged.

- [#748](https://github.com/nextlyhq/nextly/pull/748) [`a5ab500`](https://github.com/nextlyhq/nextly/commit/a5ab50030b2eff47cd27be868ff0aa66766eb306) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Label both ends of a date range, instead of relying on a placeholder that never renders.

  A date input paints its own `dd/mm/yyyy` format hint and ignores `placeholder` outright, so a range written that way drew two identical empty boxes with nothing saying which end was which. The same spelling renders correctly on text and number inputs, which is why it survived: the defect is specific to one input type and invisible in the source.

  Both date ranges in the admin -- the condition row and the entries filter menu -- now use one `RangeField` with real `<label>` elements bound to their inputs, and the pair is exposed as a named group. The filter menu had no accessible name on either input at all.

- [#850](https://github.com/nextlyhq/nextly/pull/850) [`9cdbbe1`](https://github.com/nextlyhq/nextly/commit/9cdbbe1ff99962e16aad872e58696607742f9da3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An interrupt during a legacy migration-lock claim now waits for the claim to settle before releasing it, so a shutdown no longer clears the row while the claim is still landing.

- [#757](https://github.com/nextlyhq/nextly/pull/757) [`d6f526e`](https://github.com/nextlyhq/nextly/commit/d6f526e160088587646c1f088379c8f71f2c655b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give `DataTableView` a `pagination` prop and let the table place its own pager.

  A pager's placement depends on whether the row table or the mobile card view is showing, and `DataTableView` is the only component that knows: the pager sits inside the card on desktop and takes the column's gap on mobile. Every list used to build the pager markup itself and hand it over, which left that decision at the call site — where the wrong arrangement is the one you get by writing the markup in reading order, and where several surfaces had drifted into it.

  Tables now pass `pagination` as data: `currentPage`, `pageSize`, `onPageChange` and the rest, typed as the pager's own props rather than a restatement of them. A caller supplying state has no opportunity to place the control, so the mistake is no longer available to make. API keys, deliveries, webhooks, collections, field groups, singles, roles, users, plugins, email providers, email templates, image sizes, entries and the media list view are all on it, and `MediaListView` forwards the prop rather than a node.

  Two surfaces keep rendering a pager directly, and say why where they render it: the media grid, which has no row-versus-card view to place one for, and the user-fields list, whose drag-reorderable rows are drawn by a DndContext over a plain table rather than by `DataTableView`.

  Two fixes found along the way. Choosing a larger page size on the image sizes list left the page number pointing past the end, showing the empty message over a list that had rows. And the media library's two pagers now carry distinct accessible labels rather than both announcing themselves as "Pagination".

- [#773](https://github.com/nextlyhq/nextly/pull/773) [`7948d1f`](https://github.com/nextlyhq/nextly/commit/7948d1f2cba84da90cb1b7acb97f859073de53b6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(create-nextly-app): keep pnpm add working in a pnpm scaffold

- [#771](https://github.com/nextlyhq/nextly/pull/771) [`fc92a4d`](https://github.com/nextlyhq/nextly/commit/fc92a4d643afbe8990ae562c84e2d3364e4c144b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Decide a boxed BigInt by its internal slot rather than by `Symbol.toStringTag`, so a document cannot tag itself unstorable, and skip the whole-document serialization for a document the engine already refused as too large.

- [#846](https://github.com/nextlyhq/nextly/pull/846) [`f29ebeb`](https://github.com/nextlyhq/nextly/commit/f29ebeb89fd7eb4755bcc2580a007cbdde6e2f21) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A schema sync on a database whose migration-lock table predates its expiry column now holds that lock by owner instead of running without one.

- [#777](https://github.com/nextlyhq/nextly/pull/777) [`9a291fe`](https://github.com/nextlyhq/nextly/commit/9a291fe3c25b49f2ce692b1bbb02ad068f0e4c01) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group migration lock now expires. A run renews its claim while it works, so a run that crashes or is killed no longer leaves a lock only an operator can clear, while a run that is still working keeps the lock for as long as it needs it. A run whose claim is taken over or can no longer be renewed fails loudly instead of continuing unprotected.

- [#838](https://github.com/nextlyhq/nextly/pull/838) [`b58f55c`](https://github.com/nextlyhq/nextly/commit/b58f55c725010b7a86d7ac9317f519c8eeb9fa19) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A schema sync now reports a migration lock it had to skip, and a run whose lock renewal never answers fails instead of hanging.

- [#833](https://github.com/nextlyhq/nextly/pull/833) [`a0e2817`](https://github.com/nextlyhq/nextly/commit/a0e2817a27fa0b257e1e96dece65fc15ab3a02d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make one control size name mean one control height.

  `size="sm"` resolved to `--nx-control-height-md` (36px) on `Button` and `--nx-control-height-sm` (32px) on `Input` and `SelectTrigger`, so a small button beside a small input or select sat 4px out of line. `default` and `lg` already agreed; only `sm` diverged.

  Input and select now take the same step as button. Nothing changes visually today: there was not one `<Input size="sm">` or `<SelectTrigger size="sm">` anywhere in the repository, which is why the divergence survived — it was waiting for its first call site rather than showing up on a screen. Aligning the other direction would have shrunk sixty live buttons to fix a case nobody had hit yet.

  A test now calls the exported `cva` functions and asserts that every size name shared by these primitives resolves to the same height token, and that the steps stay ordered. It reads the class string a caller actually receives rather than parsing the variant maps out of the source.

  The admin sidebar's search field asked for `h-9` directly, which happened to equal the small step and then stopped tracking it. It takes `size="sm"` now, and its icon is centred rather than offset by a fixed `top-2.5` that only centred inside a 36px control — the same height decision written a second time.

- [#857](https://github.com/nextlyhq/nextly/pull/857) [`224c729`](https://github.com/nextlyhq/nextly/commit/224c7293b42887f4e397c637c949374fd5d5415b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Declare the admin's session-free routes once.

  Which routes are reachable without a session was answered in three places: the
  page registry, a hand-kept set in the refresh interceptor, and the
  `pages/(auth)/` directory. A page added to the registry but missed in the
  interceptor still rendered, but its expected 401 redirected to login and
  discarded the URL, which is how an invite token was once lost.

  `PUBLIC_ROUTE_PATHS` in `constants/routes.ts` is now the declaration. The
  registry keys its public pages by that type, so the two cannot disagree without
  failing the build, and the interceptor derives its set from the same array. A
  test reads the `(auth)` directory, which no type can reach, and fails on a page
  nobody declared. No behaviour changes.

- [#743](https://github.com/nextlyhq/nextly/pull/743) [`b55e278`](https://github.com/nextlyhq/nextly/commit/b55e2782c8614ca207e195fa3f4e7bcd442f0904) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Retention now keeps what you asked it to keep.

  Setting a retention window to `Infinity` — the strongest way the type allows you
  to say "keep these forever" — was deleting instead. Audit trails were removed
  after 90 days and webhook events after 30, on the schedule the default sets,
  while the setting itself read as accepted. Nothing surfaced it: the pass ran,
  reported success, and pruned rows the configuration had asked to retain.

  The cause was two separate answers to one question. Audit and webhook retention
  each resolved a configured window in their own file, and the two had drifted: a
  2000-year window kept everything, an infinite one deleted, and the same input
  produced different outcomes depending on which trail it was written for. Webhook
  retention also had no upper bound at all, so a very large window produced a
  cutoff date no database column can store, which made the pass fail silently on
  every run and leave the ledger unpruned.

  There is now one resolver behind both, built on the rule they disagreed about:
  refusing a value must never delete more than accepting it would. An infinite
  window, and any window longer than a date can express, now mean keep forever.
  Values that ask for less than the default, or for nothing coherent, still fall
  back to the default, because that direction cannot lose data.

  How long a window a trail can express is stated by the trail rather than shared,
  because it is set by the column the cutoff is compared against and those differ.
  Content activity is compared against a column counting from 1970 and so tops out
  around fifty years; the audit, event and delivery trails count from a calendar
  year and accept far longer windows. Sharing one ceiling would have meant a
  window a column can hold being answered with "never prune", which is unbounded
  growth on a setting that asked for the opposite.

  Two positions each trail holds on its own are unchanged: `false` still means
  keep forever everywhere, and a delivery ledger set to zero still keeps nothing,
  which is a real choice for a table whose only purpose is making a retry
  possible.

- [#779](https://github.com/nextlyhq/nextly/pull/779) [`332d56e`](https://github.com/nextlyhq/nextly/commit/332d56eef8f8ee5d4663842cc08dbc2a9681f9cc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Write a block node's own fields in the declared order when an op rewrites it, so undoing a removed field restores the document rather than only its values.

- [#856](https://github.com/nextlyhq/nextly/pull/856) [`f7545fe`](https://github.com/nextlyhq/nextly/commit/f7545fe0bd0c69c1c97f1bf9771c1ceb32f28db2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Disclose a plugin's retired permissions on its detail page instead of omitting
  them.

  The permission list endpoint now forwards `includeOrphaned`, so a caller that
  reports what a plugin owns can ask for rows nothing declares any more. They are
  shown marked rather than hidden: the row still exists and still carries its
  grants, so leaving it out understated what a plugin left behind. Lists that
  OFFER permissions are unchanged, because the option is off unless asked for, so
  the role permission matrix still shows only permissions that enforce something.

- [#809](https://github.com/nextlyhq/nextly/pull/809) [`e19f31a`](https://github.com/nextlyhq/nextly/commit/e19f31adc28b782bb1bb05193d66c715ea20d9d1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(nextly): persist the admin options a collection is allowed to set

  order and sidebarGroup were accepted by CollectionAdminOptions and dropped by the
  projection that writes the registry, so a code-first collection could set its
  sidebar position, type-check, and still sort by the default. admin.description
  had no column under admin at all; it now resolves to the collection's own
  description, which is the field the admin already renders and the Schema Builder
  already edits.

  A compile-time assertion now requires every admin option to be either persisted
  or listed with the reason it is not, so adding one forces the author to classify
  it in the same change. That list is exactly what drifted twice before.

- [#747](https://github.com/nextlyhq/nextly/pull/747) [`c92db86`](https://github.com/nextlyhq/nextly/commit/c92db8633ee5ee63b5069ee977e9af0c31af8023) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reject duplicate plugin admin slugs at boot. `pluginAdminSlug` collapses every
  non-alphanumeric run to a single dash, so distinct package names can map to one
  slug and the plugins then share a single admin address — one plugin's detail
  page opens the other's, and host `pluginOverrides` apply to the wrong package.
  No lookup downstream can detect this, because every lookup along that address
  returns a plugin. `resolvePlugins` now refuses to start, naming both packages
  and the slug they collide on.

- [#762](https://github.com/nextlyhq/nextly/pull/762) [`e24638c`](https://github.com/nextlyhq/nextly/commit/e24638cdd4ee84d35917bfeeab45fdca86aa1c59) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Warn at boot when a plugin ships without an `admin.description`. Without one the
  admin can only show the package specifier wherever it lists that plugin, and
  nothing previously stopped a plugin shipping that way.

- [#749](https://github.com/nextlyhq/nextly/pull/749) [`2f2f089`](https://github.com/nextlyhq/nextly/commit/2f2f089ba9ce46974e4d0ddf08102651524450ac) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give the installed plugin detail page a two-column layout with a sticky
  metadata rail. About moves into an aside beside the contributions rather than
  below them, so what a plugin adds — its permissions and API routes included —
  stays visible while its metadata is read.

- [#742](https://github.com/nextlyhq/nextly/pull/742) [`d4f6480`](https://github.com/nextlyhq/nextly/commit/d4f6480cea50689cfa33165cb5c55eb7b3800e5a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin now has a plugin directory, at Plugins then Browse plugins.

  It lists the plugins Nextly publishes with a description, category and author, marks the ones already installed, and searches by name, description and tags. A curated row sits above the grid while there is more in the grid than in the row.

  It is discovery only. Installing a plugin means adding a dependency and a line to `nextly.config.ts`, so the directory never writes to your source or changes plugin state. Where a listed plugin is already installed, its own icon and description are shown rather than the directory's copy of them.

- [#753](https://github.com/nextlyhq/nextly/pull/753) [`85d526e`](https://github.com/nextlyhq/nextly/commit/85d526e395f1b3b6f400c3d8e5d91e41218405f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Disclose the routes a disabled plugin would serve once enabled. A disabled
  plugin mounts no routes, so `routes` stays empty and the same declarations
  travel as `whenEnabled` instead — only those that would actually mount, checked
  by the same fold that mounts them. Its permissions are untouched by this: they
  are seeded whatever the plugin's enabled state, so they were never pending on
  anything.

- [#826](https://github.com/nextlyhq/nextly/pull/826) [`f0b9f1d`](https://github.com/nextlyhq/nextly/commit/f0b9f1dd75cce4aeb50cc645ae6a18f28cfc9015) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Show a plugin's permissions on its detail page again, read from the
  authenticated permissions endpoint rather than the public admin-meta payload.

  These are the rows the seeder actually created, which is a different set from
  the declarations: a `publish` or `unpublish` declaration naming a collection
  or single is dropped, because the seeder emits that slug itself and keeps the
  row ownerless. The page now reports what exists rather than what was asked
  for, and it reports nothing at all when the request fails instead of showing
  an empty section.

- [#842](https://github.com/nextlyhq/nextly/pull/842) [`4fdbf77`](https://github.com/nextlyhq/nextly/commit/4fdbf77588275523d2fa41b36096e01fe420fded) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry editor now offers **Copy shareable link**.

  The preview-link machinery already shipped — a mint route gated by `update`, an admin service, a `usePreviewLink` hook and the `PreviewActions` control — but nothing in the standalone editor rendered any of it: the control was wired only into the form footer, which the editor renders in embedded (modal) layouts alone. An author had no way to reach the feature.

  The control now sits in the editor's action bar, directly left of Save, for a saved entry whose author holds `update` on the collection. The permission half of that condition is resolved by the header itself rather than by each caller, so the gate cannot be omitted by a future call site.

- [#845](https://github.com/nextlyhq/nextly/pull/845) [`1b0689e`](https://github.com/nextlyhq/nextly/commit/1b0689e386d92caf0e0848d6f5b8753414e09421) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Serve only branding from the public `/api/admin-meta`. Plugin contributions, configured locales, custom sidebar groups and builder availability now come from the session-gated `/api/admin-meta/workspace`, so a plugin-declared permission slug is no longer readable before sign-in. The admin reads both and merges them, so no component changes.

- [#823](https://github.com/nextlyhq/nextly/pull/823) [`5244934`](https://github.com/nextlyhq/nextly/commit/52449340278ffa7d3baddf4f31a1c77846885bd4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop serving plugins' declared custom permissions on the public
  `/api/admin-meta` payload. That endpoint answers without authentication, so
  every plugin action and resource name it carried was readable by anyone who
  could reach the app.

  The plugin detail page no longer lists a plugin's permissions. Reading them
  from an authenticated endpoint is a separate change and is not in this
  release.

- [#738](https://github.com/nextlyhq/nextly/pull/738) [`2f3bb57`](https://github.com/nextlyhq/nextly/commit/2f3bb5767b69c5a2388db21efb78b4a99b055779) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The block document format now publishes a JSON Schema, so a generator, an editor
  build or an agent can check a document against the format without TypeScript.

- [#737](https://github.com/nextlyhq/nextly/pull/737) [`791a08e`](https://github.com/nextlyhq/nextly/commit/791a08e369f6ac483bb3c71a0a620a61d246ac78) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field-group storage migration dry run no longer writes anything. It observes the migration lock instead of claiming it, so a preview works with a read-only database role, and reports what it could learn about the lock as `lock` on the dry-run outcome rather than refusing when another run is in flight. `lock` is `{ kind: "held", owner }`, `{ kind: "not-held" }` or `{ kind: "unknown", reason }` — an unreadable lock table is reported as unknown rather than as nothing holding the lock.

  Because a preview takes no lock, another run can advance between its reads and leave it scoring the plan against a state the database was never in. A dry run now re-reads and retries when that happens, and the outcome carries `basis` to say which answer it ended up with: `{ kind: "reconciled" }` when the plan was scored against the live catalog, or `{ kind: "unreconciled", reason }` when a writer kept moving underneath it. An unreconciled preview still reports every rename the migration declares rather than an empty list, so it can never be mistaken for "nothing to do". Refusals that re-reading cannot clear are ultimately preserved: a torn-shaped but persistent conflict now spends its attempts confirming the database is not moving before the refusal stands, so a conflicted database sees the extra catalog reads that stability check costs.

- [#789](https://github.com/nextlyhq/nextly/pull/789) [`0b3fc78`](https://github.com/nextlyhq/nextly/commit/0b3fc784e2d4543b6f7ad4b173e5339c953f0c37) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix the scaffold job's workspace-package pin, and fail closed on an unreadable
  search-index manifest.

  The pin rewrites dependency specifiers after the scaffold has generated its
  lockfile, and pnpm turns frozen-lockfile on by default in CI — so the pnpm blog
  leg aborted with ERR_PNPM_OUTDATED_LOCKFILE before it could build.

  An index manifest that exists but cannot be parsed no longer reads as owning
  nothing. writeFileSync is not atomic, so an interrupted build can truncate it,
  and treating that as an empty ownership list left the previous index in place
  while the status flipped to empty — the search page would load and serve
  unpublished results.

- [#791](https://github.com/nextlyhq/nextly/pull/791) [`20c1d43`](https://github.com/nextlyhq/nextly/commit/20c1d43e62f955acd591b8f0fd0217b729c10fd7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop generating a `db:migrate:reset` script that names a command the CLI does not
  register. Every scaffolded project shipped an `npm run db:migrate:reset` that
  failed; `db:migrate:fresh` already drops all tables and re-runs the migrations.

- [#759](https://github.com/nextlyhq/nextly/pull/759) [`e520db5`](https://github.com/nextlyhq/nextly/commit/e520db52237548856988f6cf41115c7fc3f98d99) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Schema Builder change to a single or a field group now holds the field-group storage migration out for its whole duration, rather than being able to start one halfway through. The exclusion is taken before the change plans anything, so a create, an update or a delete either runs against storage nothing is renaming or is refused
  outright — and a change that is refused has written no row and built no table of its own. Taking
  the exclusion can still create the migration lock's own table, which is empty, holds no content,
  and would have been created by the next successful change anyway. A database that has never run a migration is covered too: these paths may create the lock table, so a first migration cannot claim it and start renaming underneath a change already in progress.

  Not every way of changing schema is covered yet. The Admin's confirmed apply, the standalone
  schema routes, collections and user fields still write without the exclusion, so they can run
  alongside a storage migration.

- [#801](https://github.com/nextlyhq/nextly/pull/801) [`d9bbcf6`](https://github.com/nextlyhq/nextly/commit/d9bbcf6b15b0f1b0cd8e9d63fe700bf5e3bd0d39) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Toggling a field group between localized and not now advances its schema version, so a Schema Builder tab opened before the change is told to reload instead of overwriting it. Previously only a field change advanced the version, and the toggle moves columns between tables.

- [#739](https://github.com/nextlyhq/nextly/pull/739) [`b09b087`](https://github.com/nextlyhq/nextly/commit/b09b087de9c5adb64b96b61d85f4760142986c24) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make the admin search field an `Input` rather than a second implementation of one.

  `SearchBar` restated Input's classes instead of composing it, and the copy had drifted twelve ways: no `aria-invalid` or `data-[invalid=true]` handling at all, so a search field could not show an error state; `focus:border-primary` without the `!` Input uses; and no `selection:*` colours, `placeholder:opacity-50` or `disabled:pointer-events-none`. Palette work reached every input except this one, because the border token was named in two places and only one was maintained.

  The field is also `type="search"` now, so assistive technology announces it as one.

  Its `className` reaches the wrapper, not the field, so the `border-input` and `border-border` classes eighteen call sites passed were inert. Those are removed, and in development the component now names any it receives so the next one is visible rather than silent.

  That warning judges the class string the element actually receives, and only reports a class that does nothing on the box as rendered: give the wrapper a border and a border colour paints, give it padding and a background shows around the field, and in each case the class is left alone.

  `Input` also sets its own text colour now. It set one for file inputs and for placeholders but never for the field's own text, so it inherited whatever surrounded it — which Tailwind's preflight resets to `inherit` on form controls.

- [#761](https://github.com/nextlyhq/nextly/pull/761) [`7133efb`](https://github.com/nextlyhq/nextly/commit/7133efbe98776e1df1985c3df9bd3cbe276b411b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Load template and playground fonts from packages instead of fetching them from Google Fonts during the build.

- [#784](https://github.com/nextlyhq/nextly/pull/784) [`eefb655`](https://github.com/nextlyhq/nextly/commit/eefb655f52b071f765894dd06daa505a256c15ec) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Give a list's page state one implementation.

  Thirteen places in the admin held the same two lines: set the page size, return to page one. The copy that drifted meant choosing a larger page size from a later page asked for rows past the end of the list, and the table rendered its empty message over a list that had rows.

  `usePagination` owns page and size together, so the resets travel with the state rather than with each caller: a size change returns to the first page, and `resetPage` covers a search or filter change that alters which rows exist. Both settings move in one update, so a query keyed on them refetches once rather than once per setter. `useServerTable` derives from it rather than restating it.

- [#767](https://github.com/nextlyhq/nextly/pull/767) [`9a8d259`](https://github.com/nextlyhq/nextly/commit/9a8d2597a5cbec0963119853b2c295e86c70ac6d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(create-nextly-app): declare `packages` in the generated pnpm-workspace.yaml so scaffolded projects install on pnpm 9

- [#770](https://github.com/nextlyhq/nextly/pull/770) [`dd3eafd`](https://github.com/nextlyhq/nextly/commit/dd3eafdc2825568abf093e42a042b2582f9a23d1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(create-nextly-app): ship the template .gitignore through npm packing, so a new project does not commit its .env

- [#797](https://github.com/nextlyhq/nextly/pull/797) [`ec9b4c7`](https://github.com/nextlyhq/nextly/commit/ec9b4c79967de4e1ee30cd3f55cd623a246c318e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bound block-document validation by the limits the survey enforced, so a caller passing a limits object whose values change between reads can no longer make the walk outrun the cap that was checked.

- [#721](https://github.com/nextlyhq/nextly/pull/721) [`a398047`](https://github.com/nextlyhq/nextly/commit/a398047976af71559a5f9a1bb5a44014926e421d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Tabs now look the same everywhere.

  The admin's tab strips are an underline control: the active tab is marked by a
  bottom border, and the tab is square so that border runs flush to its edges. The
  shared component already draws all of it — the underline, the active and hover
  colours, the focus ring.

  Several first-party plugin screens were drawing their own instead. The form
  builder switched the underline off and repainted it from React state through an
  inline style, three field-editor tabs restated the whole indicator, and a few
  places re-declared a square corner the component already guarantees. The result
  was the same component wearing a different appearance depending on the screen.

  Those screens now pass layout only and let the component draw the indicator, so
  the page builder's inspector, the form builder, its field editor, its preview
  and its submissions list all match the rest of the admin. Layout overrides stay
  allowed, because a tab strip in a dialog is a different shape from one in a
  sheet.

  A test reads every first-party call site and reports one that repaints the
  indicator, so the next screen to do it is caught in review rather than noticed
  later. It reads what a call site is written as, which is not the same as
  guaranteeing the appearance cannot be forked: a class arriving from another
  module, through a prop spread, or through a slotted child is not something it
  can see. The component stays deliberately overridable so a theme can move these
  values, and that is the same door a call site can walk through.

- [#821](https://github.com/nextlyhq/nextly/pull/821) [`d011d54`](https://github.com/nextlyhq/nextly/commit/d011d5430555319dcd89a55ef7a51bdfac280ac1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Render a table's custom footer beside its pager rather than instead of it.

  `DataTableView` resolved its footer slot as `pagination ? pager : footer`, on the reasoning that two pagers in one slot is not a composition anyone wants. But `footer` takes an arbitrary node rather than a pager: a caller using it for a selection summary or bulk actions and then adopting `pagination` lost that content, with both props public, both permitted by the type, and nothing reporting the loss. Both render now, footer first, since a summary describes the rows above it and the pager moves between them.

  Also removes a comment in the media library that explained the grid pager's accessible label by what a source-level placement guard needed. That guard was deleted in the same release, so the comment described nothing; the screen-reader reason is the real one and is kept.

- [#828](https://github.com/nextlyhq/nextly/pull/828) [`e5e4023`](https://github.com/nextlyhq/nextly/commit/e5e40239f4f577d0171a981a34c0b83daa024b26) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Tabs gain `TabsList variant="ghost"` and `TabsTrigger size="sm"`, so the compact tab appearance is named rather than spelled out in `className` at each call site. The two call sites that hand-rolled the ghost list disagreed on its height (`h-8` and `h-7`); the variant settles it at `h-8`.

- [#778](https://github.com/nextlyhq/nextly/pull/778) [`d3e487a`](https://github.com/nextlyhq/nextly/commit/d3e487a85d8918cc7ed393bdb4d5c9d5b82547fd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Store the configuration a provider parsed, and refuse a write whose parse is not a fixed point.

  The service persisted whatever the caller submitted while the adapter closed over the parse result, so every difference between the two became a defect somewhere that read the row. It now persists the parsed value, and checks before writing that parsing the stored form returns the stored form -- rejecting a `parseConfig` that derives a credential, returns a value JSON cannot carry, or refuses its own output, each of which would otherwise hand the adapter a configuration nobody saved.

- [#804](https://github.com/nextlyhq/nextly/pull/804) [`a88d6c5`](https://github.com/nextlyhq/nextly/commit/a88d6c5f00056a1674cea84084d273ba632b0179) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Ignore the config copies tsup writes for a package that builds more than one bundle. A watcher stopped with Ctrl-C left a tsup.<name>.config.bundled\_\*.mjs behind that no ignore rule covered, and the next lint failed with a parsing error naming a file nobody wrote.

- [#750](https://github.com/nextlyhq/nextly/pull/750) [`36825d4`](https://github.com/nextlyhq/nextly/commit/36825d4816a2d706a7a39c78986ba8a99120f8b8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Start both build watchers of `@nextlyhq/ui` on every platform. The `dev` script used a POSIX
  background-and-wait, which `cmd.exe` runs sequentially, so on Windows the first watcher held the
  line and the server-safe artifacts were never rebuilt — with no error, no exit code and no output.

- [#741](https://github.com/nextlyhq/nextly/pull/741) [`02ade17`](https://github.com/nextlyhq/nextly/commit/02ade17719d38ed68b062b582f2fea5835ddb33a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Convert `packages/ui`'s build scripts to TypeScript and delete the hand-written
  declaration files beside them. Nothing kept a `.d.mts` in step with the module
  it typed, so a test compared the two — and that comparison had to model every way
  ECMAScript can publish a name. There is no second list to drift now, and the
  scripts are type-checked for the first time.

- [#803](https://github.com/nextlyhq/nextly/pull/803) [`40dfd52`](https://github.com/nextlyhq/nextly/commit/40dfd52196a6ac4ea03352665a1c8a0654bbf048) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(nextly): paginate users by user rather than by role-joined row

  listUsers applied LIMIT/OFFSET to a query that left-joined user_roles and roles
  and grouped afterwards, so a user holding three roles consumed three rows of the
  page. A page of N therefore returned fewer than N users, and OFFSET advanced
  over joined rows rather than users — which skipped users entirely rather than
  merely short-filling the page. Measured on nine users with two holding three
  roles each: walking every page visited six of them.

  The page query now selects one row per user and roles are fetched for exactly
  the users that page selected, so total keeps counting the same thing it always
  did and a page of N contains N distinct users. Role order per user is now
  deterministic; the join left it to the planner.

- [#799](https://github.com/nextlyhq/nextly/pull/799) [`5ff805e`](https://github.com/nextlyhq/nextly/commit/5ff805ed742ef695823e0e1a214f32010d92ef02) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add validateDocument, which returns the survey a validation judged a block document with, so a caller can ask whether the engine measured it in full instead of inferring that from issue codes. validate keeps its signature and becomes the narrow view over it.

- [#799](https://github.com/nextlyhq/nextly/pull/799) [`5ff805e`](https://github.com/nextlyhq/nextly/commit/5ff805ed742ef695823e0e1a214f32010d92ef02) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report which of three things JSON does to a block document instead of one flag for all of them. A document JSON writes but rewrites - an array hole, a dropped key, a negative zero - is no longer refused as having no stored form, and a document the validator declined to read is reported as unmeasured rather than as unwritable.

- Updated dependencies [[`8a7e734`](https://github.com/nextlyhq/nextly/commit/8a7e734cce5d8948b779d28ff875a41c63e0071a), [`f53dbd8`](https://github.com/nextlyhq/nextly/commit/f53dbd82ffa339c278630b12c7d812fbf4ea0ba3), [`f5a5405`](https://github.com/nextlyhq/nextly/commit/f5a540543aa36ea2853b0d043312765ac4ca7e54), [`376a3a4`](https://github.com/nextlyhq/nextly/commit/376a3a49a0a5d0a13a85c546cebd08444a9443ed), [`8dc013e`](https://github.com/nextlyhq/nextly/commit/8dc013efe16d092c852fdd84db548f755a53fbee), [`7ea3567`](https://github.com/nextlyhq/nextly/commit/7ea3567c5c858d5ada4d8537c54e5aa88dc546df), [`59d84dd`](https://github.com/nextlyhq/nextly/commit/59d84ddc00c32c067c20a041b09e8f537befa27a), [`51ddce0`](https://github.com/nextlyhq/nextly/commit/51ddce0ce43df0e7800167426c531ac64ddcb56c), [`24a3a4d`](https://github.com/nextlyhq/nextly/commit/24a3a4d8a145cf28d86ad8f4adaed1a01e886704), [`7b19d8a`](https://github.com/nextlyhq/nextly/commit/7b19d8a32ef93fa0fca34a04e0fa245e35f83f67), [`7a23525`](https://github.com/nextlyhq/nextly/commit/7a2352598add92995fd8f3314a1eced3f87cef5d), [`a6555f8`](https://github.com/nextlyhq/nextly/commit/a6555f87b80d7f454de94a69ed850c773a279567), [`cec9cc3`](https://github.com/nextlyhq/nextly/commit/cec9cc391639f1632882d7f5af0c5d9f5d989145), [`faf7fd7`](https://github.com/nextlyhq/nextly/commit/faf7fd704e2625cf9c2ca1156fbe02c73f270e53), [`29e8129`](https://github.com/nextlyhq/nextly/commit/29e812978aa103900bf229cb463834527b810c70), [`fb9a0c0`](https://github.com/nextlyhq/nextly/commit/fb9a0c0adee95279897796bb3f9ef454457e1525), [`5fc9cc7`](https://github.com/nextlyhq/nextly/commit/5fc9cc7857f8c0685289fe2473ffd5243fe45b76), [`e344e47`](https://github.com/nextlyhq/nextly/commit/e344e47aca0aef1df894d52b06d9c985568bf390), [`8bb149f`](https://github.com/nextlyhq/nextly/commit/8bb149f5ef4adc116f5017edf45227bfb3a60b29), [`7b23e26`](https://github.com/nextlyhq/nextly/commit/7b23e26f27e716a06815e7b995eb0e55a7415df8), [`4c8d39c`](https://github.com/nextlyhq/nextly/commit/4c8d39c312db0feb8093f14751655779ce27793a), [`a5ab500`](https://github.com/nextlyhq/nextly/commit/a5ab50030b2eff47cd27be868ff0aa66766eb306), [`9cdbbe1`](https://github.com/nextlyhq/nextly/commit/9cdbbe1ff99962e16aad872e58696607742f9da3), [`d6f526e`](https://github.com/nextlyhq/nextly/commit/d6f526e160088587646c1f088379c8f71f2c655b), [`7948d1f`](https://github.com/nextlyhq/nextly/commit/7948d1f2cba84da90cb1b7acb97f859073de53b6), [`fc92a4d`](https://github.com/nextlyhq/nextly/commit/fc92a4d643afbe8990ae562c84e2d3364e4c144b), [`f29ebeb`](https://github.com/nextlyhq/nextly/commit/f29ebeb89fd7eb4755bcc2580a007cbdde6e2f21), [`9a291fe`](https://github.com/nextlyhq/nextly/commit/9a291fe3c25b49f2ce692b1bbb02ad068f0e4c01), [`b58f55c`](https://github.com/nextlyhq/nextly/commit/b58f55c725010b7a86d7ac9317f519c8eeb9fa19), [`a0e2817`](https://github.com/nextlyhq/nextly/commit/a0e2817a27fa0b257e1e96dece65fc15ab3a02d4), [`224c729`](https://github.com/nextlyhq/nextly/commit/224c7293b42887f4e397c637c949374fd5d5415b), [`b55e278`](https://github.com/nextlyhq/nextly/commit/b55e2782c8614ca207e195fa3f4e7bcd442f0904), [`332d56e`](https://github.com/nextlyhq/nextly/commit/332d56eef8f8ee5d4663842cc08dbc2a9681f9cc), [`f7545fe`](https://github.com/nextlyhq/nextly/commit/f7545fe0bd0c69c1c97f1bf9771c1ceb32f28db2), [`e19f31a`](https://github.com/nextlyhq/nextly/commit/e19f31adc28b782bb1bb05193d66c715ea20d9d1), [`c92db86`](https://github.com/nextlyhq/nextly/commit/c92db8633ee5ee63b5069ee977e9af0c31af8023), [`e24638c`](https://github.com/nextlyhq/nextly/commit/e24638cdd4ee84d35917bfeeab45fdca86aa1c59), [`2f2f089`](https://github.com/nextlyhq/nextly/commit/2f2f089ba9ce46974e4d0ddf08102651524450ac), [`d4f6480`](https://github.com/nextlyhq/nextly/commit/d4f6480cea50689cfa33165cb5c55eb7b3800e5a), [`85d526e`](https://github.com/nextlyhq/nextly/commit/85d526e395f1b3b6f400c3d8e5d91e41218405f4), [`f0b9f1d`](https://github.com/nextlyhq/nextly/commit/f0b9f1dd75cce4aeb50cc645ae6a18f28cfc9015), [`4fdbf77`](https://github.com/nextlyhq/nextly/commit/4fdbf77588275523d2fa41b36096e01fe420fded), [`1b0689e`](https://github.com/nextlyhq/nextly/commit/1b0689e386d92caf0e0848d6f5b8753414e09421), [`5244934`](https://github.com/nextlyhq/nextly/commit/52449340278ffa7d3baddf4f31a1c77846885bd4), [`2f3bb57`](https://github.com/nextlyhq/nextly/commit/2f3bb5767b69c5a2388db21efb78b4a99b055779), [`791a08e`](https://github.com/nextlyhq/nextly/commit/791a08e369f6ac483bb3c71a0a620a61d246ac78), [`0b3fc78`](https://github.com/nextlyhq/nextly/commit/0b3fc784e2d4543b6f7ad4b173e5339c953f0c37), [`20c1d43`](https://github.com/nextlyhq/nextly/commit/20c1d43e62f955acd591b8f0fd0217b729c10fd7), [`e520db5`](https://github.com/nextlyhq/nextly/commit/e520db52237548856988f6cf41115c7fc3f98d99), [`d9bbcf6`](https://github.com/nextlyhq/nextly/commit/d9bbcf6b15b0f1b0cd8e9d63fe700bf5e3bd0d39), [`b09b087`](https://github.com/nextlyhq/nextly/commit/b09b087de9c5adb64b96b61d85f4760142986c24), [`7133efb`](https://github.com/nextlyhq/nextly/commit/7133efbe98776e1df1985c3df9bd3cbe276b411b), [`eefb655`](https://github.com/nextlyhq/nextly/commit/eefb655f52b071f765894dd06daa505a256c15ec), [`9a8d259`](https://github.com/nextlyhq/nextly/commit/9a8d2597a5cbec0963119853b2c295e86c70ac6d), [`dd3eafd`](https://github.com/nextlyhq/nextly/commit/dd3eafdc2825568abf093e42a042b2582f9a23d1), [`ec9b4c7`](https://github.com/nextlyhq/nextly/commit/ec9b4c79967de4e1ee30cd3f55cd623a246c318e), [`a398047`](https://github.com/nextlyhq/nextly/commit/a398047976af71559a5f9a1bb5a44014926e421d), [`d011d54`](https://github.com/nextlyhq/nextly/commit/d011d5430555319dcd89a55ef7a51bdfac280ac1), [`e5e4023`](https://github.com/nextlyhq/nextly/commit/e5e40239f4f577d0171a981a34c0b83daa024b26), [`d3e487a`](https://github.com/nextlyhq/nextly/commit/d3e487a85d8918cc7ed393bdb4d5c9d5b82547fd), [`a88d6c5`](https://github.com/nextlyhq/nextly/commit/a88d6c5f00056a1674cea84084d273ba632b0179), [`36825d4`](https://github.com/nextlyhq/nextly/commit/36825d4816a2d706a7a39c78986ba8a99120f8b8), [`02ade17`](https://github.com/nextlyhq/nextly/commit/02ade17719d38ed68b062b582f2fea5835ddb33a), [`40dfd52`](https://github.com/nextlyhq/nextly/commit/40dfd52196a6ac4ea03352665a1c8a0654bbf048), [`5ff805e`](https://github.com/nextlyhq/nextly/commit/5ff805ed742ef695823e0e1a214f32010d92ef02), [`5ff805e`](https://github.com/nextlyhq/nextly/commit/5ff805ed742ef695823e0e1a214f32010d92ef02)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.58
  - @nextlyhq/blocks-react@0.0.2-alpha.58
  - @nextlyhq/ui@0.0.2-alpha.58
  - @nextlyhq/plugin-sdk@0.0.2-alpha.58

## 0.0.2-alpha.57

### Patch Changes

- [#714](https://github.com/nextlyhq/nextly/pull/714) [`5673fff`](https://github.com/nextlyhq/nextly/commit/5673fffb7f3f43b26985bb075550d3bd1ee4f4eb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin now ships with rounded corners and the Geist typeface. Corner radius comes from a single `--radius` knob, so changing that one declaration re-rounds the whole panel, and a plugin built against the published Tailwind preset re-rounds with it.

- [#699](https://github.com/nextlyhq/nextly/pull/699) [`6936078`](https://github.com/nextlyhq/nextly/commit/6936078db4533fc7fdde0650903debe13000747f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add an experimental BreakpointDialog to @nextlyhq/ui, with the validation behind it. The style compiler discards a breakpoint it cannot use rather than raising, so a bad definition is lost silently and surfaces later as stale styles; the dialog refuses to save any set that would lose one.

- [#728](https://github.com/nextlyhq/nextly/pull/728) [`38e5e6b`](https://github.com/nextlyhq/nextly/commit/38e5e6b6c6b58222b727c675a4a03d98d1a58c8e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - move the breakpoint editor into the builder, where its rules can be derived

  `lib/breakpoints.ts` and `breakpoint-dialog.tsx` restated the style compiler's
  breakpoint drop rules because `@nextlyhq/ui` is the block-agnostic layer and
  cannot depend on `@nextlyhq/blocks-engine`. Two implementations of one rule
  agree the day they are written and drift silently after.

  They now live in `@nextlyhq/builder`, which already depends on the engine and
  imports `MAX_BREAKPOINTS_PER_AXIS` and the breakpoint types from it rather than
  mirroring them.

  **Breaking, and deliberate:** the `@nextlyhq/ui/breakpoints` subpath is removed,
  along with `BreakpointDialog` and the breakpoint types from the root barrel.
  Nothing in this repository imported them, and every affected export was
  `@experimental`.

- [#683](https://github.com/nextlyhq/nextly/pull/683) [`5bfac2f`](https://github.com/nextlyhq/nextly/commit/5bfac2feea1c56af92b4d74364cda15f9a5c511f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the builder's host-canvas coordinate mapping: one module converts between the canvas frame and the host page, including the scaled border inset that places the frame's content origin. A sibling test scans for cross-frame rectangle reads elsewhere in the package, recognising a bounded set of spellings; it narrows the paths taken by accident rather than enforcing single ownership.

- [#717](https://github.com/nextlyhq/nextly/pull/717) [`5a05e7b`](https://github.com/nextlyhq/nextly/commit/5a05e7bf97b45c5003fff51a56a7b442137140c9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add an experimental ColorPicker to @nextlyhq/ui, with the pointer-to-colour geometry behind it on the server-safe @nextlyhq/ui/color entry. The picker knows nothing about design tokens: a swatch carries an opaque value it hands back untouched, so a host storing a token reference keeps it rather than receiving the colour that token happened to resolve to.

- [#713](https://github.com/nextlyhq/nextly/pull/713) [`dbd95b3`](https://github.com/nextlyhq/nextly/commit/dbd95b3603f1efc4ec8480c9cdd7f50b5977d02d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Erase a recipient from the email delivery log.

  Deleting a user left their delivery rows behind carrying a keyed hash of their
  address, which an install holds the key for, so the table went on answering
  "was this person written to, and when" for an account that no longer exists.
  `eraseRecipientDeliveries` overwrites that hash with a value no address can
  produce, keeping the row, its status and its timing so aggregate questions
  still have an answer. `deleteUser` calls it inside its existing transaction, so
  a failed erasure takes the deletion with it rather than leaving the two out of
  step.

  The erasure takes an ADDRESS rather than a user id, because most recipients
  never had an account: a password reset to an address that never registered, a
  CC, a BCC added by a `beforeSend` filter. Those people can ask to be erased too
  and no account deletion will ever fire for them, so it is callable directly.

  `EmailDeliveryRecord.recipientHash` is now `string | null`, where null means
  erased.

- [#734](https://github.com/nextlyhq/nextly/pull/734) [`193d5ec`](https://github.com/nextlyhq/nextly/commit/193d5ecdda826cce47832026299242fefd5bfa29) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Advertise the Node range this project actually supports. Every package declared
  `>=20.0.0` while the repository requires `^20.19.0 || ^22.12.0 || >=24.0.0`, so
  installs on 20.6-20.18 or on 23.x succeeded without warning and failed later at
  runtime. Release preflight now derives the expected range from the root manifest
  and rejects a package that disagrees, so the two cannot drift apart again.

- [#722](https://github.com/nextlyhq/nextly/pull/722) [`696281d`](https://github.com/nextlyhq/nextly/commit/696281d123832fb1a4a39e4aaf7d27ed085e35a6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field group instances now report their stored type through `nextly/field-group-type`, a new entry point that reads whichever spelling a document carries and writes the current one. The admin editor uses it, so content saved before and after the storage rename stays readable and selectable in both.

- [#700](https://github.com/nextlyhq/nextly/pull/700) [`cf04a67`](https://github.com/nextlyhq/nextly/commit/cf04a678a0922d8261b34e93d47819cfa83e46ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Correct the frame content origin to include the iframe's padding, and measure that inset in one place.

  An iframe's nested viewport begins at the content box, so padding displaces it exactly as a border does. Callers built the inset from `clientLeft`/`clientTop`, which report the border alone, so every frame-local point mapped toward the border by the scaled padding. `frameInsetOf` is now exported as the single reader, and both the README recipe and the `FrameGeometry` documentation name it instead of restating arithmetic three call sites had already got wrong.

- [#689](https://github.com/nextlyhq/nextly/pull/689) [`213a860`](https://github.com/nextlyhq/nextly/commit/213a8602d3225f4343976b71d9702a7b9a4161b1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Admin list pages now attach their pagination to the table it belongs to, instead of leaving it floating a row below the table on some pages and attached on others. Applies to users, plugins, roles and webhook endpoints.

- [#725](https://github.com/nextlyhq/nextly/pull/725) [`73885c6`](https://github.com/nextlyhq/nextly/commit/73885c682f74612fef4fe62122dcacee33267d14) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group storage migration can now report what it would rename without changing any content or recording that a run happened, and refuses to run for real unless the caller states that a restorable backup exists. A preview still claims the migration lock, so it needs a role that can write to Nextly's own lock table.

- [#719](https://github.com/nextlyhq/nextly/pull/719) [`f61172e`](https://github.com/nextlyhq/nextly/commit/f61172e816caca32009f61c4c16183e8bd546a35) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A stylesheet stored for a page is no longer reused when a block migration has
  since turned one of its nodes into one that renders nothing. The rules compiled
  for that node, and any image the rules fetched, were still being served for
  markup no visitor receives.

- [#730](https://github.com/nextlyhq/nextly/pull/730) [`6683ef3`](https://github.com/nextlyhq/nextly/commit/6683ef387595684355bba1e02c128f76df5624d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin icons now resolve through one shared rule, so the same plugin shows the same icon everywhere in the admin, and a plugin can ship its own logo image instead of naming a built-in glyph.

  The SEO plugin now describes itself in the plugins list instead of showing a bare package name.

  A styling fixture used only by the end-to-end suite no longer appears as an installed plugin, and no longer injects a showcase section into the Posts collection list, in a normal development server.

- [#740](https://github.com/nextlyhq/nextly/pull/740) [`db7122d`](https://github.com/nextlyhq/nextly/commit/db7122d484e841a087827babcaff402c0711da0c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-sdk` now exports `pluginAdminSlug`, `PLUGIN_CATEGORIES` and `isPluginCategory` (experimental), so a plugin author can derive a plugin's admin slug and check a category against the vocabulary `definePlugin` accepts, rather than reimplementing either. They are also on `nextly` and `nextly/config` for host apps.

  The admin uses those exports instead of its own copies. It previously derived a plugin's URL slug with its own implementation of core's algorithm, so a plugin page could be linked at one slug and routed at another the moment either side changed, and it kept its own list of valid categories, so it could reject a category `definePlugin` accepts.

  Nothing changes in the admin UI. The plugin directory that consumes these is not built yet; this is the groundwork it needs.

- [#727](https://github.com/nextlyhq/nextly/pull/727) [`53fca3e`](https://github.com/nextlyhq/nextly/commit/53fca3e4fa89ec7c6f116f25f4b01263f6e6995d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On desktop, the Plugins item in the admin sidebar now opens the plugins page when you click it, instead of only expanding the sub-sidebar and leaving you to find the page yourself. On mobile it still opens the panel, as every sidebar section with a panel does, and Installed Plugins is the first entry inside it. The item also stays visible when no plugins are installed, so a new project can reach the plugins page at all.

  Users who can read a plugin's collections but cannot manage settings keep the sub-sidebar, since the plugins page itself is settings-guarded.

  The secondary sidebar now closes when the category it is showing stops being one of the sidebar's destinations, so a slow or failing permissions load no longer leaves an empty panel open beside the page.

- [#671](https://github.com/nextlyhq/nextly/pull/671) [`75054a8`](https://github.com/nextlyhq/nextly/commit/75054a806e40cf66a30dfc4d75159cd104b1836d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Relationship expansion can now be told WHICH collections a trusted read may
  reach, judged per expansion target.

  `overrideAccess` says the caller is trusted. It said nothing about the
  collection a relationship points at — which the caller never named and may not
  serve to the same audience — so a trusted read spread that trust into every
  target it populated. A caller serving one fixed audience can now state its
  trusted set, and anything outside it is read as that audience would read it.

  Absent the new option nothing changes, so the Direct API keeps its semantics: a
  caller that has already decided who is asking is not narrowed by a default it
  never chose.

- [#724](https://github.com/nextlyhq/nextly/pull/724) [`35ff30a`](https://github.com/nextlyhq/nextly/commit/35ff30a7ed36f7c498aaed68d8dfbbaa95d14547) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A page whose stylesheet is reused now keeps it when a block migration turns a
  condition-gated node into one that renders nothing. Those nodes never had rules
  in the shared sheet, so withholding it cost every other block on the page its
  styling.

- [#673](https://github.com/nextlyhq/nextly/pull/673) [`67082d1`](https://github.com/nextlyhq/nextly/commit/67082d1004fb7d00a63c3d18b83dbf22f9e28ec0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Check the built server-safe entry points against what the build recorded, and stop publishing the
  bundler metafiles those checks read.

  The gate reads two records the build already wrote — the module specifiers surviving in each
  artifact and every chunk reachable from it, and the bundler's own metafile of what it inlined. A
  bundled dependency leaves no import to find, so the text alone cannot answer what an artifact
  reaches. The metafiles are build inputs to that check rather than something a consumer needs, so
  they are excluded from the published files.

- [#702](https://github.com/nextlyhq/nextly/pull/702) [`8011731`](https://github.com/nextlyhq/nextly/commit/8011731fb441fbdccdd29d5d262804c1cb078041) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - fix(ui): ignore a dispatched event that is not a keystroke

  The shortcut manager listens on `document`, so every event dispatched anywhere on
  the page reaches it — including synthetic ones from code outside the application.
  A password manager typing into a credential field dispatches a `keydown` carrying
  no `key`, and the manager spread it as a string, crashing the page with
  `TypeError: key is not iterable`. It now ignores an event it cannot read as a
  keystroke, and leaves it propagating to whichever listener does understand it.

- [#697](https://github.com/nextlyhq/nextly/pull/697) [`ca1cc48`](https://github.com/nextlyhq/nextly/commit/ca1cc48e76701d8f12ec8f525da24241635d5744) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Carry a trusted write's bound into a Single's upload expansion. A Single holding uploads and no relationship field returned whole media rows in its write response, because the bound reached only the relationship expansion beside it, which returns early for such a document.

- [#705](https://github.com/nextlyhq/nextly/pull/705) [`ecefaa2`](https://github.com/nextlyhq/nextly/commit/ecefaa23244212cfe5ca617797f1fab54372e9cf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field group instance now reports its type whichever spelling the stored document uses, so content written before and after the storage rename both read. A `where` filter on the type keeps working under either spelling, and version snapshots keep recording the type of components nested inside a dynamic zone. Reading that type is one shared call rather than a key spelled out at each site, which is what keeps the rename a change in a single place.

- [#716](https://github.com/nextlyhq/nextly/pull/716) [`cf48bd7`](https://github.com/nextlyhq/nextly/commit/cf48bd72cda0d605de50b3eb70b4115a5f1c15e8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A version snapshot now records each field group instance under one spelling of its type key. An entry captured before the storage rename, restored, and captured again previously kept its old key alongside the new one, so the snapshot announced the same instance's type twice.

- [#731](https://github.com/nextlyhq/nextly/pull/731) [`298d41e`](https://github.com/nextlyhq/nextly/commit/298d41ee1efa2e800fa7ebc755d065930e5cf629) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Page builder inspector: keep the open panel tab in sync when the selected block changes type, so the inspector no longer shows a tab the block does not have.

- Updated dependencies [[`5673fff`](https://github.com/nextlyhq/nextly/commit/5673fffb7f3f43b26985bb075550d3bd1ee4f4eb), [`6936078`](https://github.com/nextlyhq/nextly/commit/6936078db4533fc7fdde0650903debe13000747f), [`38e5e6b`](https://github.com/nextlyhq/nextly/commit/38e5e6b6c6b58222b727c675a4a03d98d1a58c8e), [`5bfac2f`](https://github.com/nextlyhq/nextly/commit/5bfac2feea1c56af92b4d74364cda15f9a5c511f), [`5a05e7b`](https://github.com/nextlyhq/nextly/commit/5a05e7bf97b45c5003fff51a56a7b442137140c9), [`dbd95b3`](https://github.com/nextlyhq/nextly/commit/dbd95b3603f1efc4ec8480c9cdd7f50b5977d02d), [`193d5ec`](https://github.com/nextlyhq/nextly/commit/193d5ecdda826cce47832026299242fefd5bfa29), [`696281d`](https://github.com/nextlyhq/nextly/commit/696281d123832fb1a4a39e4aaf7d27ed085e35a6), [`cf04a67`](https://github.com/nextlyhq/nextly/commit/cf04a678a0922d8261b34e93d47819cfa83e46ba), [`213a860`](https://github.com/nextlyhq/nextly/commit/213a8602d3225f4343976b71d9702a7b9a4161b1), [`73885c6`](https://github.com/nextlyhq/nextly/commit/73885c682f74612fef4fe62122dcacee33267d14), [`f61172e`](https://github.com/nextlyhq/nextly/commit/f61172e816caca32009f61c4c16183e8bd546a35), [`6683ef3`](https://github.com/nextlyhq/nextly/commit/6683ef387595684355bba1e02c128f76df5624d6), [`db7122d`](https://github.com/nextlyhq/nextly/commit/db7122d484e841a087827babcaff402c0711da0c), [`53fca3e`](https://github.com/nextlyhq/nextly/commit/53fca3e4fa89ec7c6f116f25f4b01263f6e6995d), [`75054a8`](https://github.com/nextlyhq/nextly/commit/75054a806e40cf66a30dfc4d75159cd104b1836d), [`35ff30a`](https://github.com/nextlyhq/nextly/commit/35ff30a7ed36f7c498aaed68d8dfbbaa95d14547), [`67082d1`](https://github.com/nextlyhq/nextly/commit/67082d1004fb7d00a63c3d18b83dbf22f9e28ec0), [`8011731`](https://github.com/nextlyhq/nextly/commit/8011731fb441fbdccdd29d5d262804c1cb078041), [`ca1cc48`](https://github.com/nextlyhq/nextly/commit/ca1cc48e76701d8f12ec8f525da24241635d5744), [`ecefaa2`](https://github.com/nextlyhq/nextly/commit/ecefaa23244212cfe5ca617797f1fab54372e9cf), [`cf48bd7`](https://github.com/nextlyhq/nextly/commit/cf48bd72cda0d605de50b3eb70b4115a5f1c15e8), [`298d41e`](https://github.com/nextlyhq/nextly/commit/298d41ee1efa2e800fa7ebc755d065930e5cf629)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.57
  - @nextlyhq/blocks-react@0.0.2-alpha.57
  - @nextlyhq/plugin-sdk@0.0.2-alpha.57
  - @nextlyhq/ui@0.0.2-alpha.57

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
