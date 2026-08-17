# @nextlyhq/blocks-react

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
  - nextly@0.0.2-alpha.59
  - @nextlyhq/blocks-engine@0.0.2-alpha.59

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
  - nextly@0.0.2-alpha.58
  - @nextlyhq/blocks-engine@0.0.2-alpha.58

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
  - nextly@0.0.2-alpha.57

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
