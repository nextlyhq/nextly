# @nextlyhq/builder

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
