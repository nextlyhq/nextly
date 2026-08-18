# @nextlyhq/eslint-plugin

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
