# @nextlyhq/eslint-plugin

## 0.0.2-alpha.61

### Patch Changes

- [#1021](https://github.com/nextlyhq/nextly/pull/1021) [`788363c`](https://github.com/nextlyhq/nextly/commit/788363c98dab3fb2e97a316e0bc5eea0788207c8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every admin list withholds its primary identifying column from the column-visibility control, so a reader cannot hide the one cell that says which row they are looking at. Each list then asked that control about every column when computing which to hide. A column the control was never given is absent from its list of visible columns, so it answered "not visible" — and the name column disappeared from roles, users, api keys, collections, field groups, plugins, singles, email providers, email templates and image sizes. The control now reports a column outside its remit as visible.

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

- [#1043](https://github.com/nextlyhq/nextly/pull/1043) [`820be87`](https://github.com/nextlyhq/nextly/commit/820be87c5848ac40ce82e0dee570a20bf0f60aca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reading a past version of a document no longer offers a way to open the page builder on it. The blocks field now honours the read-only and disabled states the admin passes to every field, so a historical view shows what the field holds without an editor whose changes would be written into the snapshot.

- [#1087](https://github.com/nextlyhq/nextly/pull/1087) [`fefbeef`](https://github.com/nextlyhq/nextly/commit/fefbeefb6df32f3f723baa7ff29ece63c6c51efc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Branded admin surfaces now pick a foreground that meets WCAG AA. The picker
  compared its dark candidate using the contrast ratio for pure black while
  returning slate-900, so a mid-tone brand colour could be given a foreground it
  had never measured: `#6366f1` shipped 4.00:1 against a 4.5 threshold, making
  primary buttons fail contrast for every user of that colour.

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

- [#1055](https://github.com/nextlyhq/nextly/pull/1055) [`52abdfe`](https://github.com/nextlyhq/nextly/commit/52abdfee28e3e2dafe12a356cf72aee4d5938de7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scroll the page editor's canvas while a block is dragged near its edge. On a page taller than the window, a block could not be moved anywhere outside the visible band at all, because the position it would land at never came on screen.

- [#1012](https://github.com/nextlyhq/nextly/pull/1012) [`8a70233`](https://github.com/nextlyhq/nextly/commit/8a70233318b52917c569c1e5a253d2becf4ad556) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Clicking a block on the page-builder canvas selects it again. A drag took control of the pointer
  as soon as the mouse went down, which made the browser report every click as landing on the canvas
  background rather than on a block — so clicking a block cleared the selection instead of setting
  it. The canvas now takes control only once a drag has actually started.

- [#1120](https://github.com/nextlyhq/nextly/pull/1120) [`9014091`](https://github.com/nextlyhq/nextly/commit/90140917f98b0ae7841c2a4162f85af7b22846dc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Pressing undo while typing a block's text on the canvas rewound the document instead of the words.
  The author lost a block move they had finished with, kept the sentence they wanted back, and got no
  undo where they asked for one.

  `mod+z`, `mod+shift+z` and `mod+y` now decline while the caret is in text, leaving the keystroke to
  the element — which is what an uncontrolled `contentEditable` needs, since inline editing hands the
  DOM over precisely so the browser's own history serves the caret.

- [#1085](https://github.com/nextlyhq/nextly/pull/1085) [`59c702f`](https://github.com/nextlyhq/nextly/commit/59c702fdba7526ec6d7fc1e6002404e413c56452) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A code field is now announced by its label. It renders an editor built from
  several elements with no single control to attach the label to, so the label
  resolved to nothing and a screen reader reached an unnamed region. It is exposed
  as a named group instead, matching how rich text, relationship and upload fields
  are already handled.

- [#1039](https://github.com/nextlyhq/nextly/pull/1039) [`03a47b3`](https://github.com/nextlyhq/nextly/commit/03a47b303bc0523918357c3256cc585aafdb6b58) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - An email provider whose parser returns a value JSON can only carry as text now has it stored in that form, instead of the save being refused.

  The stored configuration is defined as its serialisation, so a `Date` becoming an ISO string is a coercion and is accepted. A parser returning a value that would LOSE data is still refused, and the message now names the field that would be lost rather than describing the rule in the abstract: a key JSON drops, an array's named properties, or a `Map` or `Set` whose entries serialisation cannot see at all.

  A parser that returns a different value each time it reads the same input is still refused, because stored credentials would not survive a read. That comparison is now structural, so a parser that rebuilds its output field by field is no longer refused for changing the order of its own fields.

- [#1110](https://github.com/nextlyhq/nextly/pull/1110) [`5089c60`](https://github.com/nextlyhq/nextly/commit/5089c60843af94b0726036ce4dacfb3f95a4f998) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the storage and the read rule for scheduled content releases: two core tables, a repository, and the pure rule that decides what a release says a document looks like now. Nothing reads them yet. Also removes the reserved `versions.drafts.schedulePublish` option and the unused `scheduled` version status, which were parsed and never read.

- [#1054](https://github.com/nextlyhq/nextly/pull/1054) [`85824d9`](https://github.com/nextlyhq/nextly/commit/85824d957f685b31565fddb354e5134b2e4f22de) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop dropping plugin-contributed field types from every save. A field declared with `pluginField()` — the page builder's blocks field, and any type a plugin adds — was stripped from the request body by the form's validation schema, so edits to it were silently discarded in both the entry and single editors.

- [#1129](https://github.com/nextlyhq/nextly/pull/1129) [`522d7d6`](https://github.com/nextlyhq/nextly/commit/522d7d664850964948613477994f447ac4641a2c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two reads in the page builder's control derivation are corrected. A composite's
  nested field is read by OWN key, as the engine reads style maps everywhere else,
  so a field reached through a prototype no longer decides which control is drawn
  and an inherited accessor no longer runs during a read taken only to draw a
  panel. And an empty record stays on the composite arm: the validator accepts
  `{}` there, so requiring at least one named field sent a stored
  `borderRadius: {}` to the scalar variant and drew a single length control for a
  value the document holds in the four-corner form.

- [#1056](https://github.com/nextlyhq/nextly/pull/1056) [`ff9ba6c`](https://github.com/nextlyhq/nextly/commit/ff9ba6c89ed87f936302389589f98b57e90d8653) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a core table gain an indexed column when upgrading an existing database.

  The additive-tables-only recovery pass is diffed from an empty snapshot, so it
  emits every index in the desired schema while never emitting the column
  additions those indexes depend on. Creating an index over a column the live
  table has not gained yet failed, and because that is not an idempotency error
  it stopped the reconcile before the pass that adds the column could run.

- [#1060](https://github.com/nextlyhq/nextly/pull/1060) [`4a05a64`](https://github.com/nextlyhq/nextly/commit/4a05a64eb0743f7696f9c9f3205d211d46bb1ca8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a contributed field know which document it is being edited inside. `useDocumentIdentity()` reports the collection entry or Single around a field, and the Single editor now supplies that context where only the entry editor did before — so a plugin field can address the document it belongs to instead of only the value it was bound to.

- [#1062](https://github.com/nextlyhq/nextly/pull/1062) [`4d736db`](https://github.com/nextlyhq/nextly/commit/4d736db3f39ede87dea9953efdf5d4c6578e7dba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Hold a status-less edit on every collection write path.

  Editing a published document on a drafts-enabled collection stores the change
  and leaves the live row alone. That was true only of the interactive path: the
  same edit made through the transaction API or a bulk update went straight to
  the live row, so it reached the public site without anyone publishing it.

- [#1096](https://github.com/nextlyhq/nextly/pull/1096) [`7d29da8`](https://github.com/nextlyhq/nextly/commit/7d29da8bb19c36b61da4fc940716df400fbed556) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Report why a collection or Single does not get pending changes, instead of the feature being silently absent. The schema response now carries `draftsDisabledReason` when the configuration asked for the draft split and a rule refused it, and a component that cannot be resolved is named once in a server warning. Adds `useDocumentLocale` to the plugin SDK, so a field inside a localized document can read which language its value belongs to.

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

- [#1103](https://github.com/nextlyhq/nextly/pull/1103) [`748e45c`](https://github.com/nextlyhq/nextly/commit/748e45c41f6414b5b8a1190de64b2619b6509246) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Renaming a float number field on PostgreSQL now keeps the column's contents. Such a column is reported by introspection as `float8`, a spelling the rename detector did not recognise, so it judged the column incompatible with itself and offered only to drop it and recreate it empty. Decimal fields were never affected: they introspect as `numeric`, which the detector already recognised.

- [#1050](https://github.com/nextlyhq/nextly/pull/1050) [`ce3ba3a`](https://github.com/nextlyhq/nextly/commit/ce3ba3a1f3a11a95ee14cbdbcbd3309c78f6de1a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The ink-contrast scan now reads the first-party plugins and the builder, not only the admin and the kit. Those three packages paint admin chrome with the same ink utilities and carried 230 of them, measured by nothing — so a token that is unreadable on a surface it lands on could ship there while the same mistake in the admin failed CI.

  It found one: the conditional-logic notice drew its text with the base warning token, which measures 4.37:1 once its own 10% fill composites over the page container, short of the 4.5:1 text needs. It now uses the 600 shade, which holds 5.13:1 at its worst surface in either mode.

- [#1067](https://github.com/nextlyhq/nextly/pull/1067) [`e7c5261`](https://github.com/nextlyhq/nextly/commit/e7c52610389b68c7f9e3d06f5e52b753e113bfa3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks can now say which of their values an editor may let an author type
  directly on the canvas, and which element holds each one. `core/heading`,
  `core/text` and `core/quote` declare theirs.

  Nothing changes on a published page: the marking is emitted only when a
  renderer is asked for editor addresses, so published markup is unchanged.

- [#1009](https://github.com/nextlyhq/nextly/pull/1009) [`ead5fb7`](https://github.com/nextlyhq/nextly/commit/ead5fb77a8d38dbe744d919bd56975cc4df2fcf5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The "not translated" language dot drew its outline with `border-muted-foreground/60`, which composites to 2.87:1 against the page surface and misses the 3:1 a non-text UI boundary needs. The outline is the only thing that renders that dot, so nothing else carried the state. It now uses the token at full strength, reaching 7.55:1 while staying visually quieter than the draft dot beside it.

- [#1013](https://github.com/nextlyhq/nextly/pull/1013) [`3727712`](https://github.com/nextlyhq/nextly/commit/372771251b8a1d0439f9841b8e8d959d18632697) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder has a layers panel and an ancestor breadcrumb. The panel shows the page as a
  tree, so a block the canvas cannot show — an empty container, or one hidden at the current screen
  size — can still be found and selected, and a search narrows the tree to what matches while keeping
  the containers around it. Selecting a block anywhere reveals it in the tree and shows the trail of
  containers holding it, and each step of that trail selects the container it names. Blocks that are
  locked, hidden at some screen sizes, or shown conditionally say so on their row.

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

- [#1034](https://github.com/nextlyhq/nextly/pull/1034) [`e12fef3`](https://github.com/nextlyhq/nextly/commit/e12fef351831d6f0233e5c7ae8d2c11285e0bda3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The page builder now has a working command palette. Pressing Cmd+K (Ctrl+K) in the editor lists what you can do to the selected block, plus undo, redo and closing the editor, searchable by name. The palette existed but was never mounted, so the shortcut opened the admin palette instead.

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

- [#1072](https://github.com/nextlyhq/nextly/pull/1072) [`af6637b`](https://github.com/nextlyhq/nextly/commit/af6637b48395cfbe5a56d3724f4115d608a58a4b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Reading a past version no longer records it as the author's unsaved work.
  Choosing a version replaces the form's values, which looked like typing, so the
  old version was stored as a recovery point and offered back on the next visit
  as "unsaved changes".

- [#1031](https://github.com/nextlyhq/nextly/pull/1031) [`2ba4029`](https://github.com/nextlyhq/nextly/commit/2ba4029faa33272596b4c75a79c3b7293e72fe43) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The entry editor and the single editor agree on what a form starts with.

  They each carried their own copy of the function that builds a form's default
  values, and the copies had drifted in six ways users could see: a `chips`
  field's declared default applied in one editor and was discarded in the other; a
  `code` field opened empty in one and null in the other; a single-value `select`
  seeded an empty string in one and null in the other.

  There is one implementation now. Every divergence was resolved on its merits
  rather than by keeping a favourite, and the entry editor's behaviour won all six,
  so singles gain the correct handling and entries are unchanged.

- [#1113](https://github.com/nextlyhq/nextly/pull/1113) [`29b5cab`](https://github.com/nextlyhq/nextly/commit/29b5cab442aa852a974ead8e7333c68ff133a111) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group migration lock now reads its clock and derives its timings from one shared module, so a second lock cannot disagree with it about what time it is. No behaviour change: the same expressions and the same 120s/15s/90s values, reached by one definition instead of a private copy.

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

- [#1008](https://github.com/nextlyhq/nextly/pull/1008) [`1cfbe69`](https://github.com/nextlyhq/nextly/commit/1cfbe69cc6563ebf64d1ffa34e2c1e9425eb992a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed fields no longer report themselves as an unknown field type when the list of
  installed plugins fails to load. The list arrives from a session-gated request, and a failed one
  left it empty — which looked exactly like a project with no plugins installed, so a correctly
  installed plugin's field rendered a red "Unknown field type" error. Reloading usually fixed it,
  which made it look like an intermittent fault in the plugin rather than a failed request. The
  field now says the plugin list is unavailable and to reload, and a field whose editor is still
  loading shows a loading state rather than an error.

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

- [#1111](https://github.com/nextlyhq/nextly/pull/1111) [`56de024`](https://github.com/nextlyhq/nextly/commit/56de024d1af68908e738593bbb28fed70908089c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A surface that needs to edit this site's rich text outside the admin's own field — the page builder's
  canvas is the first — can now load the same node classes and theme the field editor registers, through
  `loadRichTextEditorKit()` on `@nextlyhq/plugin-sdk/admin`.

  Sharing the registry is the point. Lexical recognises content by the identity of the classes that
  wrote it, so an editor built on a different set reads existing rich text as plain text — silently, at
  read time, on documents that already saved.

  The loader is async because the node classes carry Lexical and PrismJS with them, a 630KB chunk the
  admin deliberately keeps behind a dynamic import. Awaiting it is what keeps that weight away from
  consumers who never open an editor.

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

- [#981](https://github.com/nextlyhq/nextly/pull/981) [`2dc1965`](https://github.com/nextlyhq/nextly/commit/2dc19653b80543b8779b6ddb97cd817e4348e1b0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Scaffolded plugins now enforce Nextly's design-token rules.

  `create-nextly-app --template plugin` previously produced a project with a generic ESLint setup that knew nothing about the admin's design system, so the token contract reached only code written inside Nextly's own repository. A new plugin now depends on `@nextlyhq/eslint-plugin` and extends its recommended config, so a fixed palette colour or an all-constant inline style fails `pnpm lint` in the author's own project and is underlined in their editor.

  The plugin template also installs from the `alpha` dist-tag, joining the blog template. Both track the active release line because the conservative `latest` tag lags it.

- [#1124](https://github.com/nextlyhq/nextly/pull/1124) [`ffc68f9`](https://github.com/nextlyhq/nextly/commit/ffc68f9c53aeadcdb90ba30098ff399fca6b05a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The collection, field group and single schema builders were three near-copies of one page, and an
  edit to any of them was three edits or a divergence. They now draw the same frame, mount the same
  overlays, and reach the same confirmation before a schema change is applied, so the parts that are
  genuinely per-kind — what each entity's settings mean, which client saves it, and what it calls
  itself — are what is left in each page. Nothing a user can see changes; the field name a duplicate
  takes, what a drag does, and which fields count as the user's are now decided in one place instead
  of three that had already begun to drift.

- [#1084](https://github.com/nextlyhq/nextly/pull/1084) [`d5efc25`](https://github.com/nextlyhq/nextly/commit/d5efc2585fe51b3f78e0975f8584472d32c2366d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed fields and the language switcher no longer disappear after
  moving around the admin. The request that lists installed plugins and configured
  locales is session-gated and does not retry, so one made before sign-in failed
  permanently and nothing re-ran it — leaving an author told to reload the page
  before they could edit the field. Signing in now issues a fresh request, and the
  request is not made at all until the session is known.

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

- [#1052](https://github.com/nextlyhq/nextly/pull/1052) [`426d176`](https://github.com/nextlyhq/nextly/commit/426d176b7da5173fa285052007dc1040cf1f736c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A localized checkbox in translation mode now offers to take its source value, not just show it. The field wrapper renders checkboxes through a separate horizontal layout, and that branch showed the source text without the action beside it — so the one field type that uses it could see what the source said and had no way to use it.

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

- [#1033](https://github.com/nextlyhq/nextly/pull/1033) [`8cd3004`](https://github.com/nextlyhq/nextly/commit/8cd3004b4455032465d4406c5730599ea6c158fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Two new checks close the same gap from opposite sides. `@nextlyhq/no-token-alpha-suffix` rejects an alpha suffix appended to a design token — `\`\${color}20\``produces`var(--nx-primary)20`, which is not valid CSS, so the browser drops the declaration and the element renders with nothing where the tint belonged. It was correct while colours were hex and fails silently now that they are tokens, which is why it survives review. The design-lint guard gains the same rule for stylesheets, plus a named-colour check: `color: rebeccapurple`is as fixed as`#663399`, and a token DEFINED as a named colour quietly ends the aliasing that a whole namespace's contrast depends on.

  The guard also now reads `packages/builder/src`, the editor's entire interface and previously the largest first-party UI surface no design check covered. Its `--nx-builder-*` namespace stays; these rules never cared which namespace a token belongs to, only whether a colour was written down instead of referenced.

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

- [#1053](https://github.com/nextlyhq/nextly/pull/1053) [`782cf82`](https://github.com/nextlyhq/nextly/commit/782cf82ffa502b3af3467f1166e7ce16dc63658c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Let a host keep its Alt shortcuts while the layers tree has focus. Reordering blocks with alt+arrow did nothing when focus sat in the page editor's layers panel, because the tree read the arrow key without checking modifiers and moved its own focus instead.

- [#1047](https://github.com/nextlyhq/nextly/pull/1047) [`8ff87ca`](https://github.com/nextlyhq/nextly/commit/8ff87ca56860026497be0c97cb603e369a09f05d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The tree view can show more than one row selected, and the page builder layers panel now highlights everything the canvas does. Rows can be added to the selection with Cmd or Ctrl click and a run selected with Shift click, from the keyboard as well as the pointer.

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
