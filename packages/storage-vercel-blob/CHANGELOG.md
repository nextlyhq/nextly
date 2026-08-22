# @nextlyhq/storage-vercel-blob

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

- [#1007](https://github.com/nextlyhq/nextly/pull/1007) [`fd5355c`](https://github.com/nextlyhq/nextly/commit/fd5355c06ba1c09be8924683847e8bf211531f69) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks can now be dragged on the page-builder canvas. Dragging a block shows a line where it
  will land and drops it there, including into a container, and the line is chosen by the region
  the pointer is over rather than by the nearest rectangle — so a block goes where it is aimed
  even when its neighbours are very different heights. Pressing Escape abandons a drag without
  moving anything, a press that does not travel stays a click, and a locked block does not move.
  Everything drag does was already possible from the keyboard, which remains the way to place a
  block precisely between two very short ones.

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

- [#909](https://github.com/nextlyhq/nextly/pull/909) [`69f3a61`](https://github.com/nextlyhq/nextly/commit/69f3a6141aeb610844216346790b4e6b25b9cf9e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Tidy up the admin sidebar.

  The Settings panel now lists system configuration before user administration,
  and its groups are declared as data, so a group's heading appears only when it
  actually has something under it.

  On the dashboard, the collapsed secondary panel no longer draws a stray second
  line beside the icon rail, and no longer nudges the page a pixel to the right.

  The built-in Nextly mark sits on a rounded tile in the sidebar and takes its
  colours from the theme in both light and dark mode. A logo you have configured
  yourself is left exactly as you uploaded it.

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

- [#923](https://github.com/nextlyhq/nextly/pull/923) [`486696c`](https://github.com/nextlyhq/nextly/commit/486696c2d4e3f866d6bb9c138bfd584983de6509) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field types now say which validation rules apply to them, in one place.

  The schema builder used to decide which rules to offer from lists of built-in
  type names it kept itself. A plugin-contributed field type is in none of those
  lists, so it was offered no validation rules at all. A plugin type now inherits
  the rules of the built-in type its declared storage behaves as, so a field type
  shipped by a plugin gets length or numeric rules without anyone editing the
  admin.

  Length and row counts are now whole numbers of zero or more, so a minimum
  length of -5 or 2.7 can no longer be saved. Each control also gets a unique id,
  so two field editors open at once no longer share one, which previously left a
  label pointing at the wrong input.

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

- [#959](https://github.com/nextlyhq/nextly/pull/959) [`4524623`](https://github.com/nextlyhq/nextly/commit/452462393dd6f1145f80c4d89e5b64f2c4f8e69a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Admin lists now share one layout above the table. Search, filters, the columns control, the
  selection bar and the empty state came from four different arrangements depending on which page
  you were on, so the gap above the table and the width of the search field changed as you moved
  around the admin. They now come from one place.

  The columns control is part of that shared layout rather than living on a single page, so it is
  available to every list that wants it instead of only to collection entries.

  An empty list now says something different when a search or filter is applied: it tells you the
  query matched nothing, rather than inviting you to create your first record when the records are
  only filtered out.

  Tabs draw the rail their indicator was designed to sit on. Each tab drew a 2px underline and
  pulled itself up onto a line the tab strip was not drawing, so that underline landed on whatever
  followed the tabs — including, above a rounded panel, its corner.

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

- [#962](https://github.com/nextlyhq/nextly/pull/962) [`b4a0e9c`](https://github.com/nextlyhq/nextly/commit/b4a0e9c40c8f74362224803a7d8eaf8db4733905) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Vertical tabs draw their selection line down the side of the list rather than across the bottom
  of it. The component has always documented a vertical arrangement, but the rail beneath the tab
  strip and the marker on the selected tab were both fixed to the bottom edge, so a vertical list
  got a horizontal line underneath it and its selected tab was marked on the wrong side. Both now
  follow the same edge, so they cannot end up on different axes.

- [#930](https://github.com/nextlyhq/nextly/pull/930) [`b20b41e`](https://github.com/nextlyhq/nextly/commit/b20b41e6c5bdab57b1081e7e9380d28bfa890e6b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The schema builder and the form builder now draw validation bounds with the
  same control.

  Both drew their own before, and they disagreed about what a bound accepts: one
  allowed a minimum length of -5 or 2.7, the other did not. Lengths and row
  counts are now whole numbers of zero or more everywhere, while a bound on a
  value stays free to be negative or fractional.

  Clearing a bound now means "no bound" rather than zero, in both builders, and
  each control carries its own identifier so two editors open at once no longer
  share one.

  Plugin authors can use the same control: `ValidationNumberField` is available
  from `@nextlyhq/plugin-sdk/admin`.

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

- [#289](https://github.com/nextlyhq/nextly/pull/289) [`d7327c4`](https://github.com/nextlyhq/nextly/commit/d7327c47190158a0ba7087bba1b4a6db8ac4de0a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin hides publish controls a user is not permitted to use.

  The Publish and Unpublish buttons on the entry editor, and the bulk Publish /
  Unpublish actions in the entry list, now appear only when the current user holds
  the matching permission. An author who may edit but not publish sees Save Draft
  and no Publish button, mirroring what the server allows.

- [#315](https://github.com/nextlyhq/nextly/pull/315) [`10aa0bf`](https://github.com/nextlyhq/nextly/commit/10aa0bf45dd5cc0e410156245a2c3ce1af60c263) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a webhook delivery log to the admin panel. Each endpoint now has a
  Deliveries view listing its past delivery attempts with status, event type,
  response code, and latency, filterable by status and event type. A dedicated
  detail page shows a delivery's full attempt timeline, the last response
  snippet, and a Redeliver action, and the list offers a "Process queue now"
  action to drain pending deliveries on demand.

- [#313](https://github.com/nextlyhq/nextly/pull/313) [`6ef1056`](https://github.com/nextlyhq/nextly/commit/6ef1056a1697beaef56d2cf0be2042a657879a18) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Manage webhook endpoints from the admin panel, under Settings → Webhooks.

  Create an endpoint by naming it, giving it an HTTPS URL, choosing the events it
  receives (any of the content, media, user, and form events, or "all events"),
  and optionally adding static headers. The signing secret is shown once on
  creation and is never included in a normal read or list, but it can be
  retrieved later through the endpoint's privileged "Reveal signing secret"
  action. Endpoints can be edited, enabled or
  disabled, and deleted; deleting one stops its deliveries and clears its secret
  while keeping its delivery history.

  A "Send test event" action posts a signed ping to the endpoint and reports
  whether it was reachable and accepted, so a receiver can be verified before it
  is relied on. Header values are never displayed after they are set (they read
  back hidden), so the form keeps them untouched unless you deliberately re-enter
  the full set.

- [#325](https://github.com/nextlyhq/nextly/pull/325) [`823950b`](https://github.com/nextlyhq/nextly/commit/823950baac1c7302a53b9ca799b6ff517a36b9d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` can now upgrade page documents when a block's schema changes. Blocks that were saved against an older version are automatically brought up to date, one version step at a time, so old pages keep working after a block is improved. If a step is missing or fails, that block keeps its last-good content and is marked so the page shows a placeholder for it instead of breaking, and the failure is reported to the caller.

- [#320](https://github.com/nextlyhq/nextly/pull/320) [`17819aa`](https://github.com/nextlyhq/nextly/commit/17819aaf1642b63c2bc7042e451eef9219275063) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New package `@nextlyhq/blocks-engine`: the foundation of the rebuilt page builder. It ships the stored document format (pages as a plain list of blocks with typed styles, data bindings, visibility rules, and locale-overlay support) plus the pure tree operations editors and tools build on. It is dependency-free and works in any JavaScript runtime, so page documents can be created and edited outside the admin too.

- [#324](https://github.com/nextlyhq/nextly/pull/324) [`a4c38ec`](https://github.com/nextlyhq/nextly/commit/a4c38ec6475299e1a6d2d6c39cb24326706f5474) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` now validates page documents and reports problems in a machine-readable form. Each issue carries a precise location in the document, a stable code, and a suggested fix, so tools and AI agents can pinpoint and repair exactly what is wrong. Validation runs in a strict mode (used when publishing, where unknown blocks or missing breakpoints are errors) or a forgiving mode (used when rendering, where those become warnings so a page still displays what it can).

- [#314](https://github.com/nextlyhq/nextly/pull/314) [`0c69c65`](https://github.com/nextlyhq/nextly/commit/0c69c65228c1b36022278b2c0f4e3c027ce64cba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the cache-revalidation tag scheme and a `revalidate` config option.

  Collections and singles now accept a typed `revalidate?: { tags?, disable? }`
  option (replacing the untyped `custom.revalidateTags` convention), and the core
  computes the `nextly:*` cache tags a content change invalidates (collection, id,
  id+locale, and slug, busting the previous slug too on a rename). Tags are the
  framework-neutral foundation for on-publish revalidation; the write-path wiring
  and the Next cache adapter that flushes them follow.

- [#316](https://github.com/nextlyhq/nextly/pull/316) [`fbe4f7d`](https://github.com/nextlyhq/nextly/commit/fbe4f7dab2acd5ddc52308919cb22e8806beb293) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bust cache tags on every content write.

  Each collection create, update, publish/unpublish, and delete — and each single
  write — now computes the cache tags it invalidates and flushes them after the
  transaction commits, through a registered cache revalidator (a no-op until a Next
  cache adapter is present). A rename busts both the old and new slug tags, a delete
  busts the collection and entry-id tags, and a write that records nothing (a
  rejected or no-op write) busts nothing. Bulk operations aggregate their items'
  tags and flush them once. This wires the tag scheme added previously to the write
  path; the read-side helpers and the Next cache adapter that turns the tags into
  `revalidateTag` calls follow.

- [#312](https://github.com/nextlyhq/nextly/pull/312) [`5d09cbd`](https://github.com/nextlyhq/nextly/commit/5d09cbdea55e4f7ef2a04b61147486f79e584632) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Bind localized companion schema loading to the caller's transaction.

  Deleting or updating a row in a localized collection assembles its document
  from the companion `<table>_locales` table, which loads that companion's
  runtime schema. That metadata read previously went back to the connection pool
  even when the write ran inside a caller-owned transaction, so on a small or
  exhausted pool it could stall the write while the transaction held the only
  connection. The companion schema load now runs on the transaction's own
  connection, completing the transaction-bound write path for localized content.

- [#253](https://github.com/nextlyhq/nextly/pull/253) [`fc1cc41`](https://github.com/nextlyhq/nextly/commit/fc1cc41709f8d3a3ed6e413da851b5d31a99a7be) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix entry-saving and migration table-naming issues.
  - Optional fields (email, length-limited text, multi-select, and similar) no longer block saving an entry when left blank — their validators now run only on a typed value.
  - Multi-value (`hasMany`) select fields now render as a real multi-select and can be saved from the admin, instead of being rejected as "expected array, received string".
  - `nextly migrate:create` and `migrate:check` now name plugin collection tables with the same `dc_` prefix the runtime uses (for example `dc_forms`), so generated migrations match the live database.
  - Number fields inside a component now use the same column type as number fields in collections — integer by default, an exact decimal for `dbType: "decimal"` — instead of always being stored as a floating-point column.
  - On SQLite, changing a column between numeric types (for example real to integer) no longer reports a false "data loss" warning; values are preserved, and cross-type changes such as text to integer still warn.
  - An optional field left blank is now saved as an empty (`NULL`) value rather than an empty string, so an optional unique field no longer rejects the second entry that leaves it blank. Password fields are exempt: a blank password still means "keep the current one".
  - A multi-value select declared with an array default (`defaultValue: ["web", "retail"]`) now starts with those options selected, instead of rendering one unusable entry and failing validation. Multi-value selects on singles now start empty rather than invalid.
  - Saving a collection in the Schema Builder no longer alters tables defined in `nextly.config.ts` or contributed by a plugin. Those tables are owned by your config and are reconciled from it, so a visual edit can only change the entity you are editing — on SQLite and MySQL as well as PostgreSQL.
  - Float number fields in a component now use the same PostgreSQL column type (`double precision`) as the runtime and generated schema, instead of `real`, which left the table permanently out of sync with the desired schema.
  - Changing a component number field's storage (`dbType`, `precision` or `scale`) now alters the column instead of being treated as no change and leaving the old type in place.
  - A component declaring a custom `dbName` is no longer queued for a redundant table sync on every startup.

- [#303](https://github.com/nextlyhq/nextly/pull/303) [`7e35933`](https://github.com/nextlyhq/nextly/commit/7e35933e51d0d0a8ec2b0834443efc2ea896db13) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Enabling localization while adding a translatable field in the same save no longer fails.

  When a field is added and localized in one save, it is (correctly) kept off the main table and lives only in the companion `_locales` table. The companion enable migration seeded the new companion from the main table with `SELECT <all localized columns> FROM <main>` and then dropped those columns, but a field added in the same save was never on the main table, so the seed failed with `column "..." does not exist` and, on singles and components, the whole apply returned 500.

  The enable migration now seeds and drops only the localized columns that already exist on the main table (fields present before this save). A field localized on creation still gets its companion column; it simply has no existing data to copy and nothing to drop.

  Listing entries no longer fails after localization is toggled on for an existing collection. Enabling localization moves translatable columns off the main table, and the entry list reads its columns from the file manager's schema cache. The metadata update path refreshed only the adapter's CRUD schema, leaving that read cache holding the pre-toggle table, so the list query selected a column the table no longer had. The metadata path now refreshes the read cache as well, matching the schema-apply path.

- [#322](https://github.com/nextlyhq/nextly/pull/322) [`6877938`](https://github.com/nextlyhq/nextly/commit/6877938aee3a75ccb1795fee023c636ad12a979e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Cache revalidation now covers every localized URL.

  For a localized collection whose `slug` differs per language, publishing all locales or deleting an entry now busts every locale's page, not just the default one.

- [#318](https://github.com/nextlyhq/nextly/pull/318) [`81c5c1e`](https://github.com/nextlyhq/nextly/commit/81c5c1ed4bf716cc3752dd414c0d4a0ab80474e4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix three content-integrity edge cases.
  - Media focal-point crop regeneration no longer deletes an image's old size
    variants before the row commits. New variants are written to fresh keys, the
    row is committed pointing at them, and the superseded old files are deleted
    only afterwards — so a failed or lost-race write can no longer leave a media
    item referencing files that were already deleted.
  - A localized single's translatable field defaults (including a localized
    title/slug) are now seeded onto its default-locale companion row when the
    single is auto-created, instead of resolving to null until first written.
  - Turning on Draft/Published for an already-localized entity now back-fills the
    default-locale companion status from the main row, so a later publish of the
    default locale is recognized as a real transition (and fires its webhook)
    rather than a no-op against a status that was wrongly reset to draft.

- [#309](https://github.com/nextlyhq/nextly/pull/309) [`c3bd115`](https://github.com/nextlyhq/nextly/commit/c3bd115d10529a80b3bb625823c16063f52a786c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Harden the publish/unpublish permission gate for two edge cases.

  A write that carries an explicit `status: undefined` (something a Direct API
  call, a Server Action, or a hook can produce, though JSON REST cannot) no longer
  silently unpublishes a published entry or single. That value means "no status
  change", so it is dropped before the write instead of being sanitized to a
  database `NULL` that moved the row out of published without the publish gate.

  Writes performed inside a caller-owned transaction (the transactional bulk and
  single-entry create/update paths) now run every read on that transaction's own
  database connection. Previously the publish/unpublish permission check, the
  collection metadata and owner-constraint reads, and the built-in sanitization
  hook's field-metadata read all went back to the connection pool from inside the
  transaction, which could stall the write against a small or exhausted pool while
  the transaction held the only connection.

- [#290](https://github.com/nextlyhq/nextly/pull/290) [`877f8f8`](https://github.com/nextlyhq/nextly/commit/877f8f871b0c5997e58dbddfa7c589e66299fc62) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing and unpublishing content are now first-class permissions, enforced
  concurrency-safely across every write surface for both collections and singles.

  Moving a document into or out of `published` requires `publish-<slug>` /
  `unpublish-<slug>` on top of the write permission, so editing and publishing are
  separate capabilities. The transition is classified against the status read
  under the write's row lock (not a read taken before the transaction), closing
  the race where a concurrent writer could move a row into or out of published and
  slip a transition past the gate; this holds for single, batch, transactional,
  and by-query writes, and for a localized document's per-locale companion status.
  A scoped API key is judged on its own stamped grants rather than the key owner's
  permissions on every write path (create, update, publish/unpublish, duplicate,
  delete, bulk, and version-label edits), and a document-dependent (owner-only or
  custom) transition rule is re-evaluated against the row-locked document. An
  unauthenticated caller can no longer publish a publicly-writable collection or
  single unless an explicit rule allows it.

- [#286](https://github.com/nextlyhq/nextly/pull/286) [`07662f3`](https://github.com/nextlyhq/nextly/commit/07662f3e8413c9162f896d133185a6f4401b5954) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection and single slugs that collide with a system resource are refused.

  Permission identity is `action-resource`, so a content type named after a system resource is granted the same permission rows that resource's routes check. A `webhooks` type reaches the endpoint routes and their signing secrets; a `settings` type reaches the user-fields and component admin surfaces (gated on `{action, "settings"}`, not only `manage`); a `media` type reaches the media routes. Every system resource has such a route, so any system-resource name — `users`, `roles`, `permissions`, `media`, `settings`, `email-providers`, `email-templates`, `api-keys`, `webhooks` — is now rejected as a collection or single slug.

  The check is enforced at every slug-assignment path: code-first validation, the shared collection/single registry guard (create and rename), the Schema Builder's collection registry, and the migration-snapshot boot path (which skips a reserved name rather than replaying it). Components are not restricted, because a component definition does not seed a permission under its own slug.

  An installation that already has a collection or single named one of these must rename it before upgrading.

- [#300](https://github.com/nextlyhq/nextly/pull/300) [`1866e2b`](https://github.com/nextlyhq/nextly/commit/1866e2bd179dd6621d6f79c2102b2d3f01f28c51) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deliver webhooks immediately after a content write instead of waiting for the
  next scheduled drain.

  After a write records an event, Nextly now schedules a bounded delivery pass via
  Next.js `after()`, so the first attempt runs as soon as the response is sent —
  without adding any latency to the write. It degrades gracefully: it does nothing
  when there are no enabled endpoints, when the runtime has no `after()` (Next 14,
  or a non-Next context like the CLI), or on any failure — the scheduled
  `/webhooks/drain` trigger remains the backstop and owns retries and the backlog.

- [#288](https://github.com/nextlyhq/nextly/pull/288) [`0473b28`](https://github.com/nextlyhq/nextly/commit/0473b286cc01b5381a77ea12a2a38556932232ab) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting a webhook endpoint keeps its delivery history.

  Deleting an endpoint used to remove its delivery log with it, because the delivery table's foreign key cascaded. The record of what was sent to an integration is often wanted right after it is torn down, which is exactly when it used to disappear.

  Deleting now retires the endpoint instead of removing it: the row is kept and stamped as deleted, so it vanishes from every read and stops receiving deliveries, but the delivery ledger keeps a real endpoint on the other end of its link. Disabling is still the way to pause an endpoint you mean to bring back; deleting is for one you are finished with but whose record still matters. A retired endpoint is never resurrected, and its outstanding deliveries are ended the same way disabling ends them.

- [#295](https://github.com/nextlyhq/nextly/pull/295) [`d5a2776`](https://github.com/nextlyhq/nextly/commit/d5a277682a00119cc09aed4f6af093a6f5526e7f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Read a webhook endpoint's delivery log over the REST API.

  Two new read-only routes back the admin delivery viewer:
  - `GET /api/webhooks/:id/deliveries` — a paged, newest-first list of an
    endpoint's deliveries (joined to their event for type and resource), with
    optional `status` and `eventType` filters.
  - `GET /api/webhooks/:id/deliveries/:deliveryId` — one delivery with its full
    attempt history and last response snippet.

  Both require `read-webhooks`. Deliveries are scoped by endpoint id and remain
  readable after an endpoint is retired, so its history is not lost. The delivery
  record stores only retry state, status/latency/error, a response snippet, and a
  per-attempt log — never the request headers sent — so this surface cannot leak a
  receiver credential.

- [#296](https://github.com/nextlyhq/nextly/pull/296) [`b1faff4`](https://github.com/nextlyhq/nextly/commit/b1faff4ec73cc8e8d8802df995edaad14d47b501) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fire due webhook deliveries with a drain trigger.

  Adds a `webhooks/drain` route (GET or POST): one request fans out due events
  into deliveries and attempts them, so a scheduler (e.g. Vercel Cron, which
  triggers with a GET) can drive delivery and retries. Until now the delivery
  engine had no production trigger and the event outbox accumulated rows nothing
  sent. The route resolves under wherever you mount the Nextly catch-all handler;
  in the generated app templates that is `/admin/api`, so the scheduler should hit
  `/admin/api/webhooks/drain`. Each invocation does a bounded slice of work and the
  next tick continues, so it stays within a serverless execution limit.

  The route is authorized by a shared secret presented as a bearer token
  (constant-time compare) — either `NEXTLY_DRAIN_SECRET` or Vercel's `CRON_SECRET`
  — OR by an authenticated admin/API-key caller with `update-webhooks`. The
  endpoint registry is now a shared singleton, so a change made through the webhook
  admin API invalidates the same cache a running drain reads instead of waiting for
  a per-drain cache to expire.

- [#298](https://github.com/nextlyhq/nextly/pull/298) [`285cd1e`](https://github.com/nextlyhq/nextly/commit/285cd1ef1073f0135dfba8bfde9bd2218bacf0c5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit an `entry.deleted` webhook event when a collection entry is deleted.

  Deleting an entry now records a durable outbox event carrying the removed
  document in the same read shape the `entry.created`/`entry.updated` events use —
  component subtrees, many-to-many ids, and localized companion values populated,
  password and hidden fields stripped — so a subscriber sees a consistent payload
  for every lifecycle event, including on localized collections. The delete and
  its event run in one transaction (the event never fires for a deletion that
  rolled back), and the row is locked and re-read inside that transaction so two
  concurrent deletes cannot both emit — only the delete that actually removed the
  row records the event. The event is attributed to the acting identity (user or
  API key), for single and bulk deletes alike.

- [#307](https://github.com/nextlyhq/nextly/pull/307) [`6841fb7`](https://github.com/nextlyhq/nextly/commit/6841fb7266a6126516a025a59c48c23064695f61) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit webhook events when media changes.

  Uploading, editing, or deleting a media item now records a `media.uploaded`,
  `media.updated`, or `media.deleted` event in the outbox, attributed to the
  acting user or API key, so webhook subscribers are notified of media changes.
  The event is written in the same transaction as the media row, and physical
  file storage is touched outside that transaction (and, for deletes, only after
  it commits) so a failed event never leaves the database and the stored file out
  of sync.

- [#319](https://github.com/nextlyhq/nextly/pull/319) [`0fea8ba`](https://github.com/nextlyhq/nextly/commit/0fea8baecba81254bebb4fc2f5c51ae718e3286c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix the webhook endpoint edit page crashing with "Cannot read properties of
  undefined (reading 'some')" when the endpoint summary arrives without the
  `secrets` lifecycle field (for example an admin bundle newer than the backend it
  is talking to). The signing-secrets panel now degrades to an empty state instead
  of throwing.

- [#317](https://github.com/nextlyhq/nextly/pull/317) [`0cabdc4`](https://github.com/nextlyhq/nextly/commit/0cabdc44fec22cd871a0b2d4ea9839fab51f1f99) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add webhook signing-secret rotation with a configurable overlap window. An
  endpoint's secret can now be rotated from the admin: a fresh secret becomes the
  primary and the previous one keeps signing for a chosen window (immediately,
  24h, 48h — the default, 7d, or 30d) so a receiver can switch over without
  dropping a delivery. Deliveries in the window carry a signature for both
  secrets, and the old one can be expired early. The endpoint edit page shows each
  active secret's lifecycle.

- [#301](https://github.com/nextlyhq/nextly/pull/301) [`affb839`](https://github.com/nextlyhq/nextly/commit/affb839de05482b96b966f2874187dd514c73e27) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Emit webhook events when a Single changes.

  Updating a Single now records a `single.updated` event carrying the written
  document and its prior state, and a status change additionally records
  `single.published` or `single.unpublished` — so a publish delivers both
  `single.updated` and `single.published`, and a consumer can subscribe to
  whichever it needs. Events fire whether or not the Single has versioning
  enabled, name the locale for a per-language write, and never carry secret
  field values.

- [#310](https://github.com/nextlyhq/nextly/pull/310) [`93cb39f`](https://github.com/nextlyhq/nextly/commit/93cb39ff9dac131a62b6bfee561e1148c9282651) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Test a webhook endpoint and re-send a past delivery over the REST API.

  `POST /api/webhooks/:id/test` sends a signed synthetic ping to the endpoint and
  reports whether it was reachable and accepted (status, latency, response
  snippet), so a receiver can be verified — before or after it is enabled —
  without producing a real event: the test writes nothing to the outbox or the
  delivery log.

  `POST /api/webhooks/:id/deliveries/:deliveryId/redeliver` re-attempts a specific
  past delivery from its stored event payload. The existing delivery row is
  re-armed for another attempt (its retry budget reset, its attempt history kept)
  under a row lock so a delivery that is still being sent is reported as a conflict
  rather than sent twice, and the drain is nudged so it goes out promptly; the
  outcome then shows in the delivery log. An unknown delivery or endpoint id is a
  not-found, while a delivery on a disabled or deleted endpoint is a conflict. Both
  actions require the webhook update permission and an interactive session.

- [#294](https://github.com/nextlyhq/nextly/pull/294) [`53bc7e2`](https://github.com/nextlyhq/nextly/commit/53bc7e2de89b6078b31a771cca2398cbf4a96aa0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook endpoints can subscribe to all events with a wildcard.

  An endpoint's `eventTypes` now accepts `"*"`, meaning it receives every event
  type, including event types added in future versions, without a config edit. The
  wildcard must be used on its own; combining it with specific types is rejected,
  since it already covers them. Fan-out treats a wildcard subscription as matching
  any event type while still honoring the endpoint's enabled state and filter.

## 0.0.2-alpha.39

### Patch Changes

- [#269](https://github.com/nextlyhq/nextly/pull/269) [`091ec3a`](https://github.com/nextlyhq/nextly/commit/091ec3a39f3c01621c8a01dfea61b05a7ae689f4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` now works on PostgreSQL.

  Nextly compares the database it finds against the schema it expects, and refuses to continue if the difference looks like it could destroy data. One comparison was wrong: a column holding a list of values, such as the tags on a media item, was described as a plain value on one side and as a list on the other. Nextly read that as someone having changed the column's type, treated it as destructive, and stopped.

  Because the check runs before anything else, this blocked the whole command on every PostgreSQL project, including a database Nextly itself had just created. The only documented way past it was a flag that permits destructive changes, which in this case would have rewritten the column and lost the values in it.

- [#270](https://github.com/nextlyhq/nextly/pull/270) [`6126db4`](https://github.com/nextlyhq/nextly/commit/6126db4a7ef4afd9ba07146e604168d28d8d22e9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Security events are recorded again.

  The audit log stores failed sign-in attempts, rejected requests, and account changes such as a password being changed or a role being assigned. Events that carry extra detail, such as a rejected request or a failed sign-in, were being dropped on SQLite: the detail is stored as text there but as a structured value on PostgreSQL and MySQL, and the wrong one was being sent. The write failed, and because a failed audit write is deliberately not allowed to interrupt whatever the user was doing, nothing surfaced.

  The effect was a log that looked healthy while missing exactly the entries worth reading. Routine events carry no detail and were saved normally; failed sign-ins and rejected requests carry detail and were not. Anyone reviewing that log after a suspicious event would have seen ordinary account activity and no sign of the attempt.

- [#169](https://github.com/nextlyhq/nextly/pull/169) [`a763b82`](https://github.com/nextlyhq/nextly/commit/a763b82f7d1d95c518e14f9c9fac48a51e5d2a80) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - "Refactor blog template to use SQL migrations instead of seed phases. Add boot-time initialization pipeline that auto-applies migrations and registers collection metadata from snapshot files."

- [#266](https://github.com/nextlyhq/nextly/pull/266) [`fe6734f`](https://github.com/nextlyhq/nextly/commit/fe6734fec8772d8cf012598f8abce839dbc29945) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - CLI commands now explain why they failed.

  Errors carry two messages: a safe one for the browser and a detailed one for whoever is running the code. The CLI was printing the safe one, so a failed `nextly db:sync` said only "An unexpected error occurred." with no table, no query and no cause. The same command now reports the failing query and the database's own explanation, for example `no such column: "localized"`, which is usually the whole answer. Full stack traces remain behind `DEBUG=1`.

  A crash inside Nextly is also no longer reported as a validation error. Creating or updating a collection returned HTTP 400 "Validation failed" when the real cause was a defect in Nextly itself, sending people to search their own payload for a problem that was never there. Those now return 500, so the two cases can be told apart.

- [#277](https://github.com/nextlyhq/nextly/pull/277) [`37c221f`](https://github.com/nextlyhq/nextly/commit/37c221f9159745d9fd70f7e004c54011d561bbe6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema reconcile now converges, and SQLite no longer loses indexes when a table changes.

  Four faults compounded into one. Comparing a primary key's nullability produced a change no `ALTER` can make on SQLite, so it was proposed forever. Comparing a string default compared `'pending'` against `pending`, so every string-defaulted column looked changed, on every dialect. Both kept the reconcile from ever seeing a clean database, and each unnecessary change rebuilt the table — which on SQLite drops its indexes, because the rebuild creates a new table from a schema that never declared them. `nextly_i18n_archive` completed the set: it was declared in the schema the diff reads but missing from the map the apply pushes, so it was proposed on every run and created by none.

  On a real database this took a reconcile from 45 proposed operations to 1, and from 23 to 9 on an older one, where the remainder is the genuine upgrade. Indexes declared for a collection are now re-asserted in the same transaction as the change, so a table cannot commit without them.

- [#267](https://github.com/nextlyhq/nextly/pull/267) [`7811af8`](https://github.com/nextlyhq/nextly/commit/7811af8c1a031b982d728aa1e895c089c14852fd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly db:sync` no longer proposes deleting collections, singles, or components you built in the Schema Builder.

  Content types reach the database two ways: written in `nextly.config.ts`, or created through the Schema Builder, which stores them in the database only. `db:sync` worked out the intended schema from the config file alone, so anything built in the Schema Builder was invisible to it. On SQLite and MySQL the comparison covers the whole database, so those tables were treated as leftovers and lined up to be dropped. The dev server already merged them back in; both now share one implementation of that rule, so they cannot disagree again. If the registry cannot be read, the sync continues with what the config describes and says plainly that Schema Builder content may be flagged.

- [#279](https://github.com/nextlyhq/nextly/pull/279) [`9c94444`](https://github.com/nextlyhq/nextly/commit/9c94444250edd830f90f2ce7a91f7473aa423799) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Deleting a collection, single, or component now removes all of its data instead of leaving parts behind.

  Three kinds of leftovers were possible. Localized entities keep translations in a companion `<table>_locales` table and archived translations in the shared `nextly_i18n_archive`; neither was cleaned up. Embedded component values live as rows in `comp_<slug>` linked to the parent by plain string columns with no foreign key, so dropping the parent table cascaded nothing and stranded every instance, along with its own translations and any components nested inside it. Deleting a component now also sweeps components nested within it.

  Singles were worse still. Their data table was dropped without `CASCADE`, so on PostgreSQL and MySQL the companion's foreign key made the drop fail. The error was logged and swallowed, and the registry row was deleted anyway, leaving both tables stranded with nothing pointing at them. The drop now cascades and its failures propagate, so a delete that cannot finish leaves the single intact and retryable rather than half-removed.

  `nextly prune` gained a sweep for companion tables whose main table is already gone, to clear orphans left by earlier deletes. As with the rest of prune, they are listed by default and only dropped with `--force`. These tables have no registry entry naming their entity, and a slug cannot be recovered from the table name because entities may declare a custom `tableName`, so the sweep drops the table and leaves the shared translation archive untouched rather than purging rows on a guess.

  `db:sync` now reports orphaned singles and components. The orphan scan was gated on the config still declaring at least one entity of that type, so removing the last single or component from `nextly.config.ts` — the very action that strands its table — skipped the check and reported nothing. Collections were unaffected only because most configs still declare some. The scan now runs regardless of the count, in both `db:sync` and watch-mode re-syncs.

  The CLI can now reach component tables. `db:sync` and `nextly prune` build their schema registry from the static system tables, which leaves `comp_` tables unaddressable by the ORM — so the orphan cleanup silently skipped every component table and dropped the parent anyway. Both commands now register each component's runtime schema, read from `dynamic_components`, before any cleanup runs. A component table that still cannot be addressed fails the delete when it holds rows for that entity, rather than being skipped.

- [#287](https://github.com/nextlyhq/nextly/pull/287) [`72b0fdf`](https://github.com/nextlyhq/nextly/commit/72b0fdff56e56189390fd82326df2c601d4f7c6a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The access layer now understands publish and unpublish as operations.

  A collection or single may carry an access rule for `publish` and `unpublish`
  the same way it does for `create` or `update`, and the RBAC check accepts them.
  Nothing enforces them on a write yet; this makes the checks expressible so the
  next release can gate publishing on them.

- [#285](https://github.com/nextlyhq/nextly/pull/285) [`32a0475`](https://github.com/nextlyhq/nextly/commit/32a04754d3e017052643abc3084431574106ee0e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Publishing is now its own permission, separate from editing.

  Every collection and single now seeds `publish` and `unpublish` permissions
  alongside its CRUD ones, and the built-in roles use them: an Editor may publish,
  an Author may write but not publish or take content down, and a Viewer may do
  neither. Nothing is enforced by them yet — this release only creates the
  permissions and assigns them, so existing setups behave exactly as before.

- [#268](https://github.com/nextlyhq/nextly/pull/268) [`4647ac7`](https://github.com/nextlyhq/nextly/commit/4647ac7ef3d712d82cf62d1868d73e4b0bcc88e5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Version history can now be turned on from the Schema Builder.

  Collections and singles get a Version History switch on the Advanced tab of
  their settings, so recording every save no longer requires editing
  `nextly.config.ts`. Turning it on records each save as a version that can be
  previewed and restored from the entry editor; turning it off keeps the versions
  already recorded but stops new ones. It does not add drafts.

  The setting is written to both the database and `ui-schema.json`, so a
  Builder-made change survives the next manifest sync.

- [#271](https://github.com/nextlyhq/nextly/pull/271) [`89649f8`](https://github.com/nextlyhq/nextly/commit/89649f87de815ce7aa69453c0a6e88534fa3d871) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Nextly now tells you when your database is behind the code.

  Nextly's own tables are created the first time it connects to a database and are not changed after that. When a new version expects a column those tables do not have, nothing added it, and nothing said so: the mismatch surfaced later as an unrelated-looking failure, or as a feature that quietly stopped working, because some of them catch their own errors and carry on.

  Startup now compares the tables it finds against the ones this version expects and, if anything is missing, prints which tables and which columns, along with the command to fix it. It does not change your database; upgrades stay something you run deliberately. A database that is already up to date prints nothing and the check costs a few milliseconds.

- [#273](https://github.com/nextlyhq/nextly/pull/273) [`ec7eeb1`](https://github.com/nextlyhq/nextly/commit/ec7eeb1e68d055a8c88904ab824e7335603fe48b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate` no longer refuses on SQLite.

  SQLite reports a text primary key as accepting empty values, because only integer primary keys are automatically required. Nextly's own schema treats every primary key as required, so the two descriptions disagreed on every table, and Nextly read that as someone about to make an existing column required. That change can fail on rows already stored, so it is treated as unsafe and the whole command stops.

  The result was that upgrading a SQLite database was blocked by the very columns Nextly created itself, and `nextly migrate` is the documented way to bring a database up to date, so the only route forward was closed.

- [#261](https://github.com/nextlyhq/nextly/pull/261) [`37495ce`](https://github.com/nextlyhq/nextly/commit/37495ce22a197862e3d57d2762bf3b7815111550) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a stylesheet for using the UI components inside an existing application.

  `@nextlyhq/ui` previously shipped one compiled stylesheet, and it styles the whole page: it includes Tailwind's preflight, which resets headings, lists, form controls and spacing document-wide. That is what a new app wants, and it is why the kit could not be dropped into an app that already has its own design — importing it restyled everything around the components.

  `@nextlyhq/ui/styles.scoped.css` confines every rule to a `.nextly-ui` wrapper, so the components still get the normalised baseline they are built against while the rest of the page keeps its own styling. Put the class on any element and everything inside it is styled; dark mode goes on the same element.

  Selectors are not the only way a stylesheet reaches outside itself, so the scoped sheet also namespaces the three things CSS resolves globally: animation names, so it cannot displace a `spin`, `pulse` or `fade-in` the host defines; Tailwind's internal `--tw-*` property registrations, which would otherwise change the meaning of those names across the whole host document; and the ancestor classes that `dark:` and `group-*:` variants look for, so a `dark` class higher up the host page no longer flips the components into dark utilities while their tokens stay light.

  Overlay components (Dialog, Select, DropdownMenu, Popover, Tooltip, Command) portal to `document.body`, which sits outside that wrapper, so the scoped sheet needs a `PortalProvider` pointing back inside it. The README shows the setup, and `PortalProvider` and `usePortalContainer` are now part of the stable surface because the scoped stylesheet cannot be used correctly without them.

  The plugin styling guide now also explains why a plugin compiles its own CSS ahead of time rather than relying on the host to scan it, and the README documents which of the three stylesheets to reach for.

- [#276](https://github.com/nextlyhq/nextly/pull/276) [`a4576e8`](https://github.com/nextlyhq/nextly/commit/a4576e8256d367e6ed46e5accdbc7b88d181a18b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Versions can be given a name, and restoring one now enforces the same read
  permission as viewing history.

  History identified every version by number, so finding the state you meant to
  go back to meant opening several. A version can now be named from the history
  panel — "before the redesign" — with the number kept beside it, since two
  versions may share a name. Clearing the name puts it back to the number.
  Renaming needs the same permissions as viewing history plus editing the
  document.

  Restore is a write, so it was authorized as one — which meant the permission
  that guards version history was never checked. Someone able to edit a document
  but not read its history could recover an earlier version by restoring it. An
  API key was judged on its owner's permissions rather than its own scope, so a
  read-only key issued by an administrator carried more access than it was given.

  Restore also holds back fields the caller is not allowed to read, rather than
  writing them back unseen, and reports component values it cannot safely apply
  instead of appearing to restore them: a field pointed at a different component
  since the version was captured, and a component list emptied of every allowed
  type.

- [#282](https://github.com/nextlyhq/nextly/pull/282) [`deb3806`](https://github.com/nextlyhq/nextly/commit/deb38068116dcb1fc586e2f95d889b448fc73ae1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Renaming a version now respects the document own access rules.

  A collection or Single can restrict who may edit a particular document, for
  example by allowing only its owner. Someone who could not edit the document
  itself was still able to rename entries in its history, because that check was
  never run on this path. It now is, for both collections and Singles.

- [#280](https://github.com/nextlyhq/nextly/pull/280) [`55c1eb6`](https://github.com/nextlyhq/nextly/commit/55c1eb63d4eae9318b2b43e268c8afe521740158) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Restoring a version now handles components embedded inside other components,
  and inside groups, repeaters and dynamic zones.

  A version records which component each of its values came from, so that
  restoring an old version after a field was pointed at a different component
  reports the mismatch instead of writing the old values into the new component.
  That record stopped at the top level: a component nested inside another one
  kept no such record, so the same restore could quietly put the wrong values in
  the wrong place.

  A nested component is now checked against the components its field allows, the
  same way a top-level one already was, so a restore reports the mismatch instead
  of writing the old values into the new component. The record itself is removed
  before the restore is written, so it stays part of the version history and
  never appears in the document.

- [#263](https://github.com/nextlyhq/nextly/pull/263) [`d398b16`](https://github.com/nextlyhq/nextly/commit/d398b163b7df0007db753c4beaedcfc99220f030) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now put a document back to an earlier version.

  Opening version history and previewing a version now offers a Restore action, behind a confirm that says what will happen. Restoring writes the document immediately and records the result as a new version, so nothing is lost and a restore made in error is undone by restoring again.

  Restore reuses the ordinary edit permission — anyone who can edit the document can restore it, and every restore records who did it and which version it came from. History rows now show that lineage, along with the language a version was captured in.

  Two limits are reported rather than hidden: values a version never stored, such as passwords, are left as they are; and if the schema has since dropped a field the version held, the restore says which fields it could not bring back.

- [#283](https://github.com/nextlyhq/nextly/pull/283) [`7e74c6e`](https://github.com/nextlyhq/nextly/commit/7e74c6efab9847c93a72b3aa7c21662642a038ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook endpoints can now be registered, changed, disabled, removed and managed over the REST API.

  The delivery engine, fan-out and signing were all built before anything could create an endpoint for them to act on — the only rows that ever reached the table were test fixtures. This adds the management layer they were waiting for and the routes that expose it: an endpoint carries a name, a target URL, the event types it subscribes to, and optional static headers, and it receives its own signing secret at creation.

  A URL is resolved and checked before it is stored, not only before it is called. Delivery already refuses private, loopback and cloud-metadata addresses, but that happens long after whoever typed the URL has moved on, so a mistake shows up as a silent, repeating delivery failure. Checking at registration turns it into an error that can still be corrected.

  Registering or changing an endpoint requires an interactive session and cannot be done with an API key. An endpoint names a URL the server will call and send content to, so it is both a request-forgery and an exfiltration primitive.

  Static header values are not returned when an endpoint is read. Delivery sends those headers verbatim, so they routinely carry a credential for the receiver, and handing that back to anyone allowed to view the configuration would leak it. The header names are still shown, and a write that echoes the placeholder back is rejected rather than stored.

  Reading a signing secret is a separate request that asks for the update permission rather than read. The secret is what proves a request came from this install, so a read-only role that could see it could forge traffic every receiver would trust.

  Disabling an endpoint is kept separate from deleting it. Only one of those is reversible, and an endpoint id tends to end up in someone else's configuration. Disabling also stops deliveries that were already queued: previously it only removed the endpoint from future fan-out, so a retry scheduled by an earlier failure, or an event that fanned out moments before, would keep being POSTed until it succeeded or ran out of attempts. Those deliveries are now ended rather than held, so re-enabling an endpoint does not release a burst of events its receiver has long since stopped expecting.

  Deleting an endpoint also discards its delivery history, because the delivery table's webhook foreign key cascades. Disabling is the option to reach for when the record of what was sent still matters.

  Static headers are checked when they are saved. A header name that is not a valid HTTP token, or a value containing a line break, can never be sent: the delivery path could not tell that apart from a network fault, so it treated it as temporary and retried an endpoint that could never succeed.

  `webhooks` is now a reserved collection slug. Permission identity is action plus resource, so a collection with that slug would have shared the exact permission rows the endpoint routes check, and a role granted the collection's `read-webhooks` could have read endpoint configuration while `update-webhooks` revealed signing secrets. An installation that already has a collection with this slug needs to rename it.

  Deliveries still need a trigger. Nothing runs the drain yet, so a registered endpoint will not receive anything until that lands.

- [#262](https://github.com/nextlyhq/nextly/pull/262) [`79ae48a`](https://github.com/nextlyhq/nextly/commit/79ae48a46c68827a152ca86033adf0c125de22cc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Recorded webhook events are now cleaned up automatically.

  Every content change records an event, including in projects that have not set up any webhooks, so that table would otherwise grow for as long as the project is edited. Events are now removed once they are old enough and nothing is still waiting to deliver them, and delivery attempts are removed sooner than the events they belong to. Cleanup runs when webhooks are processed and, for projects that never process any, alongside ordinary content saves, so it does not depend on a scheduled job. It is bounded, so no single save waits on a large cleanup, and a cleanup that fails can never fail the save it followed.

  How long to keep everything is configurable under `webhooks.retention`, in milliseconds, with `false` anywhere meaning keep forever. Events are kept 30 days by default and delivery attempts 7 days. Events also carry a retention class, so the ones a future audit log depends on can be kept for a year while the rest are cleaned up in days.

- [#281](https://github.com/nextlyhq/nextly/pull/281) [`d13ec0e`](https://github.com/nextlyhq/nextly/commit/d13ec0e60249b8e511beabf7612bacf995c60dc9) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook signing secrets can now be generated and stored encrypted.

  Delivery signs each request with the endpoint's secret, but nothing could produce one: there was no generator, and the decrypt step the delivery engine depends on had no implementation outside a test stub. This adds that boundary — a `whsec_` secret in the format Standard Webhooks receivers expect, encrypted under `NEXTLY_SECRET` with the same scheme that already protects email provider credentials.

  Storing a signing secret requires `NEXTLY_SECRET` to be set. Unlike provider configuration, which degrades to plaintext when no key is present, a webhook secret is the signing key itself: stored readable, anyone with database access could sign requests your receivers would trust. It fails instead, and says so.

## 0.0.2-alpha.38

### Patch Changes

- [#250](https://github.com/nextlyhq/nextly/pull/250) [`a302fec`](https://github.com/nextlyhq/nextly/commit/a302fec09fdd22f59763ce91cfbbfcca0f5fc3c7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix admin links ignoring modifier clicks, and route the admin's remaining framework-specific navigation through its own router.

  Links in the admin panel now behave like normal links: Cmd/Ctrl-click and middle-click open them in a new tab, `target="_blank"` is honored, and links that point outside the admin (such as the Help entry in the account menu, which goes to the documentation site) open properly instead of being rewritten into a dead admin route. Previously every one of these was captured and turned into an in-app navigation.

  Internally, the few remaining places that reached for the host framework's navigation directly — the command palette, the entry list's reading of the URL query string, and one entry page's links — now go through the admin's own navigation, link, and a new query-string hook. The entry list also no longer issues an unfiltered request before its URL filter is applied.

- [#258](https://github.com/nextlyhq/nextly/pull/258) [`1104b2f`](https://github.com/nextlyhq/nextly/commit/1104b2fe83ab6a7d940ec38f83bc6c40f6d1817c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal groundwork for viewing a document's history: field values can now be rendered read-only.

  Nothing in the admin reaches this yet, so there is no visible change in this release. It is the display layer the version history drawer will use to show what a document looked like at an earlier point, with a renderer for every built-in field type including the container types the entry list only ever summarised as a count.

- [#260](https://github.com/nextlyhq/nextly/pull/260) [`1f0a3e6`](https://github.com/nextlyhq/nextly/commit/1f0a3e6da323d4a3c5d31e8e7fc8fc9f0c97daca) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - You can now see a document's version history from the editor.

  A History control in the entry header opens a panel listing every saved version of the document, newest first, with who saved it and when. Selecting one shows what the document held at that point, field by field, clearly marked as a past state rather than the live one. Long histories page on demand rather than loading at once.

  Available for both collection entries and singles, on any document with versioning enabled. Restoring a version is not part of this change.

- [#254](https://github.com/nextlyhq/nextly/pull/254) [`7a46bd2`](https://github.com/nextlyhq/nextly/commit/7a46bd2757900bc0b7676ecc0171f7a0f74d7f30) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix custom admin branding colors, which made branded surfaces transparent instead of applying the configured color.

  Setting `admin.branding.colors` did not tint the admin — it broke it. Buttons, the active navigation item, focus rings and the first chart series lost their background entirely and rendered transparent. Removing the setting was the only way back to a working admin, so the feature was effectively unusable.

  The admin's design tokens hold complete colors and are read directly, but branding was still resolving colors to the bare `H S% L%` form an older token scheme expected. That produced an invalid value, which browsers discard. The server-rendered stylesheet that exists to prevent a flash of unbranded color had drifted further still, targeting a CSS class the admin no longer renders and writing token names nothing reads, so it had no effect at all.

  Branding now resolves to complete colors on both paths, and the server-rendered rule targets the class the admin actually uses, so configured colors appear immediately on load without a flash.

- [#244](https://github.com/nextlyhq/nextly/pull/244) [`40fc723`](https://github.com/nextlyhq/nextly/commit/40fc723578f49759310804536a3cacfc51353935) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix plugin admin pages 404ing on a direct link or page refresh.

  A page contributed by a plugin (via `contributes.admin.pages`) showed the admin's "Page Not Found" screen when opened by its URL directly — a deep link, a bookmark, or a hard refresh — even though reaching it by clicking within the admin worked. Plugin page routes register just after the admin loads its plugin metadata, which is later than the router's one-time initial route resolution, so that first resolution ran before the routes existed and never re-ran. The admin now re-resolves the current route once plugin pages are registered, so a directly-loaded plugin page renders instead of 404ing.

- [#255](https://github.com/nextlyhq/nextly/pull/255) [`93a432c`](https://github.com/nextlyhq/nextly/commit/93a432cfff275f423f545ccc8d21324b55c1f3cd) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Make `@nextlyhq/ui` usable as a published package: components now work in a Next.js app, and plugins stay on one shared copy.

  Importing a component from `@nextlyhq/ui` into a server-rendered page failed, because the published bundle lost the `"use client"` marker that tells React these components run in the browser. The marker now ships with the package, and the build fails if it ever goes missing again.

  `@nextlyhq/ui` also becomes a peer dependency of `@nextlyhq/admin` rather than a bundled one. This is what the plugin documentation already described: the admin and every plugin share a single copy, so components cannot end up talking to a second, isolated instance of the design system. Projects created by `create-nextly-app` already install it, so no change is needed there; a project that added `@nextlyhq/admin` by hand should add `@nextlyhq/ui` alongside it.

  Plugins now depend on a compatible _range_ of `@nextlyhq/ui` instead of one exact version, so a plugin keeps working across releases instead of breaking on every one.

  Also: the documented `@nextlyhq/ui/tailwind-preset` entry point now exists (previously the import failed), the package declares which files have side effects so bundlers can drop unused components, and the plugin styling guide no longer names a CSS class and design tokens that do not exist — following it produced styles that silently did nothing.

- [#256](https://github.com/nextlyhq/nextly/pull/256) [`7c93a64`](https://github.com/nextlyhq/nextly/commit/7c93a642495f0b5d04fc2b7a71a755cacfda8ec6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content version history is now available from the main API, at
  `/collections/{slug}/entries/{id}/versions` and `/singles/{slug}/versions` (add
  `/{versionNo}` for one version). Reading a document's history requires the same
  permission as reading the document itself, and a version's stored content is
  filtered the same way a normal read would filter it.

- [#257](https://github.com/nextlyhq/nextly/pull/257) [`c092cb0`](https://github.com/nextlyhq/nextly/commit/c092cb0a92023b62e88d9db5f057b368b28329ee) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Version history now says who made each change.

  Reading a document's version history previously returned only the raw user id of whoever wrote each version, so a history view had nothing to show but an identifier. Each version now carries the display name of its author, resolved in a single batched lookup.

  The projection is a name only, deliberately not an email address, so reading history does not require permission to read users. Attribution never fails a history read: a deleted user, or an unavailable lookup, leaves the version unattributed rather than erroring.

- [#252](https://github.com/nextlyhq/nextly/pull/252) [`cac7062`](https://github.com/nextlyhq/nextly/commit/cac706295f4e0ac42f8f77ee854cdcc645e9e4a1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content version history can now be read, and it no longer grows forever.

  Two new endpoints list a document's versions and fetch a single one, and the same
  surface is available to plugin code. Listing returns metadata only, so opening a
  long history never transfers the stored content.

  Version history is also bounded now. A collection or single keeps the number of
  versions you configured instead of accumulating one for every save ever made; the
  limit was previously accepted in configuration but never applied. The newest
  version and the version matching your currently published content are always
  kept, and trimming happens as part of the same save, so history can never be left
  in a half-trimmed state.

- [#243](https://github.com/nextlyhq/nextly/pull/243) [`b5ecec8`](https://github.com/nextlyhq/nextly/commit/b5ecec8b14844dc8f7a2d643ae2e693df03d49cc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Webhook deliveries are now sent, signed, and retried.

  The delivery engine claims each due webhook delivery, signs the request with Standard Webhooks HMAC headers, sends it over the SSRF-safe transport, and records the outcome. A 2xx marks the delivery sent; a 429 or 5xx is retried with exponential backoff and full jitter up to an attempt cap; any other response fails permanently. A claimed delivery is leased so a concurrent drain cannot double-send, and the network request never holds a database transaction open. A drain orchestrator runs fan-out and delivery together until nothing is currently due. The scheduled trigger that starts a drain is a later change.

- [#251](https://github.com/nextlyhq/nextly/pull/251) [`aa5a663`](https://github.com/nextlyhq/nextly/commit/aa5a6637d70fb1697be7925e7b8dea510984349a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Creating or updating an entry now records a webhook event.

  Entry creates and updates are written to the webhook event outbox inside the same database transaction as the change itself, so an event is never recorded for a write that rolls back and never missed for one that commits. The event carries the document with password and hidden fields removed, and reports which fields changed by comparing against the document as it stood before the write. On a localized collection the translations and per-locale status for the locale being written are included on both sides of that comparison, so a translation nobody touched is not reported as changed and a per-locale publish is reported with the status it actually committed, and the event names the locale it describes so writes to different translations of the same entry can be told apart. Fields are removed by their position in the document rather than by name alone, so a hidden field inside a component no longer removes an unrelated field that happens to share its name. Every event is attributed to whoever performed it: an API key is recorded as the key itself rather than as the user that owns it, a server-side write is attributed to the user it acts for, and an uninitiated write is recorded as the system. Batch writes are not covered yet: entries created through `createMany`, and entries written through the transaction helpers, commit without recording an event. Deletes, status changes, singles, media, users, and form submissions are later changes.

## 0.0.2-alpha.37

### Patch Changes

- [#241](https://github.com/nextlyhq/nextly/pull/241) [`14c88c8`](https://github.com/nextlyhq/nextly/commit/14c88c8982a9bc7c6526289103888193263cb20c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content version snapshots are now captured more faithfully: component subtrees and
  relations are read within the write transaction so just-written data is included
  correctly on every database (no leaked password hashes, no lost ids), a partial
  translation edit keeps the language's other translated fields in the snapshot, and
  publishing all languages records a version and fires the status-change events like
  an ordinary publish. Publishing or changing the status of a single translation now
  also fires the document status-change events, tagged with the language. A versioned
  Single that is auto-created on its first read now starts its version history at that
  moment instead of leaving the live document without any version.

- [#172](https://github.com/nextlyhq/nextly/pull/172) [`dbb4675`](https://github.com/nextlyhq/nextly/commit/dbb46757081a5d68b33ffaead8e621bbbff6e262) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Extend content localization to singles and embedded components, and make disabling localization recoverable.

  Singles and components now localize the same way collections do: mark a single or a component `localized` (in code or the Schema Builder) and its translatable fields move to a companion `_locales` table, with per-language reads and writes (`?locale=`, `?fallback-locale=`), a per-language switcher, and RTL-aware editing. The push pipeline provisions each companion table out of band and keeps the translatable columns off the main table, so a boot-time code-first sync no longer re-adds them.

  Turning localization off is now guarded. `nextly migrate:create` emits a migration that archives every non-default translation into `nextly_i18n_archive` before dropping the companion, and `nextly i18n:restore` replays an archive back onto the companion, so a mistaken disable is reversible rather than a silent data loss.

## 0.0.2-alpha.36

### Patch Changes

- [#211](https://github.com/nextlyhq/nextly/pull/211) [`9647453`](https://github.com/nextlyhq/nextly/commit/96474535bd096f61131f9e5853bc8a24e7f84fc2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The avatar initials on the user edit page are now readable in dark mode.

  When a user has no profile picture, the edit page shows their initials on a tinted circle. In dark mode the initials were painted in a near-black color meant for solid buttons, so they nearly disappeared against the tint (about 1.45:1, where 4.5:1 is required). They now use the primary text color in both modes and read at roughly 11:1 in dark mode.

- [#208](https://github.com/nextlyhq/nextly/pull/208) [`79709b8`](https://github.com/nextlyhq/nextly/commit/79709b8f91cabd9815f9e61f3db8310da07f48d3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Admin colors now meet WCAG 2 AA contrast in both light and dark mode.

  Many admin colors sat below the accessibility minimums. Borders and input outlines were nearly invisible against their surface (as low as 1.2:1, where 3:1 is required); status text (destructive, success, warning) and the status badges and alerts fell short of the 4.5:1 needed for text; popovers were too light for their own borders and inputs; and dozens of faint alpha-opacity utilities (like `text-primary/50` and `border-primary/10`) rendered unreadable text and near-invisible boundaries.

  What changed:
  - Borders, input outlines, and the popover surface are retuned so every boundary clears 3:1. The most visible effect is that hairline borders become distinct medium-contrast lines.
  - Status colors are split into two roles, the industry-standard pattern: the base token (`--nx-destructive`, `--nx-success`, `--nx-warning`) is now the readable text color, and a new `-solid` token is the button fill under white on-color text. This lets both the colored text on a page and the white text on a solid button pass AA, which a single value cannot do in dark mode.
  - The status badge and alert shades, and the warning palette, are retuned so their tinted text passes AA.
  - Faint alpha-opacity utilities that rendered real text or boundaries were replaced across the admin and plugins with their proper semantic tokens; intentionally decorative uses (watermarks, ghost buttons, chart ticks) are left as-is.

  Two checks run with the test suite to keep this from regressing: one asserts every rendered token and color-mix shade pair meets its WCAG minimum in both modes, and one scans the source for faint alpha-opacity color utilities.

- [#238](https://github.com/nextlyhq/nextly/pull/238) [`dd3be32`](https://github.com/nextlyhq/nextly/commit/dd3be329eab4347805258be7549234e7017a7757) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Content writes now commit their relationships and component data in the same transaction as the entry.

  Creating or updating an entry now writes the entry, its component data, and its many-to-many relationships in a single database transaction. Previously the relationship writes ran after the transaction had already committed, so if they failed the entry was left behind without them; now such a failure rolls the whole write back. Single-document updates likewise write the document and its component data in one transaction, so a component failure no longer leaves a half-updated document.

- [#219](https://github.com/nextlyhq/nextly/pull/219) [`37ee3d5`](https://github.com/nextlyhq/nextly/commit/37ee3d54395afbe96e04d02a00d6329127f4c2af) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder saves for collections now reject stale saves reliably.

  The collection schema apply had an optimistic-lock check, but the stored
  schema_version was never advanced on apply, so the check compared against a
  value that never changed and a second admin editing the same collection could
  still overwrite the first (last-write-wins). The apply now persists the bumped
  schema_version, and the check runs through the same guard as singles and
  components: an omitted version is rejected and a stale version is reported as a
  conflict for the client to reload and retry. All three entity kinds now share
  one optimistic-lock behavior and error surface. If the post-apply metadata
  write fails, the response reports the current version rather than the bumped
  one so a retry re-attempts the bump.

- [#217](https://github.com/nextlyhq/nextly/pull/217) [`564bd03`](https://github.com/nextlyhq/nextly/commit/564bd03e6ea0285bfc2f8c8b94e31b0ad93a89d8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fixed inserts failing on collections that use a component field.

  A component field created a column on the parent table, but component values are stored in their own table and stripped from the parent row before insert. That column was therefore never written: when the component field was required it became `NOT NULL` with no value and every insert failed, and even when optional it left a permanently empty column. Component fields no longer create a parent column.

- [#237](https://github.com/nextlyhq/nextly/pull/237) [`972a725`](https://github.com/nextlyhq/nextly/commit/972a7257b071851d2c985ed475936f7d0745c234) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add content localization (multilingual content) for collections, singles, and components.

  Configure an app-level `localization` block (locales, default locale, per-locale fallback and RTL), then mark collections or individual fields `localized`. Translatable fields move into a companion `<table>_locales` table (text-like fields localize by default; opt out per field), so each language stores its own value while the main row keeps shared fields. Reads resolve the requested language with a configurable fallback chain (`?locale=`, `?fallback-locale=`); `?locale=all` returns a language-keyed object per field. Writes target a language with `?locale=`, leaving other translations untouched. Where filters, search, and sort work against localized fields, and on draft-enabled collections each language carries its own publish status, so a published read never surfaces a draft translation.

  The admin gains a language switcher, per-language translation-status pills and a list completeness badge, a copy-from-language action, inline source-language hints while translating, RTL-aware field rendering, and a `_translated` list filter. `nextly migrate:create` emits companion migrations that relocate localized columns while preserving existing default-locale content.

  Non-localized apps are unaffected: without a `localization` config the read/write paths, schema, and admin behave exactly as before.

- [#239](https://github.com/nextlyhq/nextly/pull/239) [`b61b09c`](https://github.com/nextlyhq/nextly/commit/b61b09c9707e0dfb25f741b6d633271017cb37d4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Enable content versioning per collection and single, and record a version snapshot on every create and update.

  A collection or single can now opt into versioning with `versions: true` (or a `versions: { ... }` config); `status: true` also enables it. The resolved config is persisted on a new nullable `versions` column on `dynamic_collections` and `dynamic_singles` (all three dialects, additive) so existing tables pick it up as a plain `ADD COLUMN` on the next schema apply.

  When a collection or single is versioned, every create and update writes one durable `nextly_versions` snapshot inside the same transaction as the content write, so the version commits atomically with the document (no partial history on a rolled-back write). The snapshot is the fully assembled document (parent columns plus component subtrees and many-to-many ids), which is the same shape a read returns, so a restored version equals a normal read. History-only at this stage: the captured status is the document's status when present, otherwise `published`; the draft/publish split, autosave, and retention pruning arrive in later stages. Batch (`createMany` / `updateMany`) capture is a documented fast-follow.

  Concurrent updates to the same document can race on the version number; a lost race is detected as a distinct conflict and the whole transaction is retried (a re-run re-reads the next free number). SQLite serializes transactions and never races; Postgres and MySQL retry.

  Also adds a general `document.statusTransition` event that fires on every status change (carrying `previousStatus` / `status`), alongside the existing `document.published` and `document.statusChanged` events, so workflow logic has one seam to build on.

- [#230](https://github.com/nextlyhq/nextly/pull/230) [`dffdb4c`](https://github.com/nextlyhq/nextly/commit/dffdb4c671ba9f3287a68e23d7c61f4341bafb55) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the `nextly_versions` storage foundation: a managed system table plus its
  repository, snapshot builder, and capture service, and make the adapter
  transaction context map property names to SQL columns so core tables can be
  written inside a transaction. No user-facing behavior changes yet; content
  versioning is wired into write paths in a later release.

- [#212](https://github.com/nextlyhq/nextly/pull/212) [`0d31e01`](https://github.com/nextlyhq/nextly/commit/0d31e0154491270e896704f1c60444c9bbba8346) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder apply now refuses to drop a column unless the drop was explicitly acknowledged.

  Applying a schema change through the admin Schema Builder or the REST apply route no longer relies on a single request-level `confirmed` flag to authorize data loss. Each column drop is classified on the server, and the apply fails closed (surfacing as a confirmation-declined error, no DDL run) unless the request carries an explicit acknowledgment for that specific column. A buggy client or an automated caller that posts a desired schema with a column removed can no longer silently destroy that column's data. The admin Schema Builder confirmation dialog sends the acknowledgment for every field it lists as removed, so the deletion experience is unchanged for admins. Renames (a drop paired with an add) and code-first deletions applied through the terminal path are unaffected.

- [#204](https://github.com/nextlyhq/nextly/pull/204) [`3cd0d84`](https://github.com/nextlyhq/nextly/commit/3cd0d8404278003cc38e79c3ee45e3ce97f68902) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Migrate to Drizzle V1 (`drizzle-orm` + `drizzle-kit` pinned exactly to `1.0.0-rc.4`).

  **What changed under the hood**
  - The schema engine now uses drizzle-kit's per-dialect `payload/*` programmatic entrypoints; the removed `drizzle-kit/api` module is gone from every code path.
  - Runtime relations are assembled centrally with `defineRelations` (relations v2); the 21 per-file `relations()` blocks are deleted. Dynamic (UI-builder) tables register as queryable tables and _can_ carry relation edges through the registry's composition path (the 3-arg `registerDynamicSchema` API); wiring specific edges (e.g. `creator`) at the registration sites is follow-up work.
  - All internal queries use RQB v2 object filters; adapters construct Drizzle with the object form only.
  - The data-loss guard was redesigned for v1's semantics: v1 _includes_ destructive statements in its output (the old omit-and-warn contract is gone), so Nextly scans every statement batch and refuses unexpected destructive SQL. The SQLite cascade defense (#5782) is unchanged and re-verified.

  **What you must do when upgrading**
  - If your app imports `drizzle-orm` directly, move it to **exactly `1.0.0-rc.4`** — the same instance Nextly uses. Mixed versions break Drizzle's internal `is()` checks. Apps that only use Nextly's APIs (the default scaffold) need no change.
  - If you wrote your own `relations()` definitions, follow Drizzle's relations v1→v2 migration guide (`defineRelations`).
  - Run `drizzle-kit up` only if you ALSO ran raw drizzle-kit against the same project.

  **One-time schema reconcile on first boot after upgrading** (automatic, non-destructive, verified against databases created by the previous Drizzle):
  - PostgreSQL: nothing — v1 proposes zero changes on an untouched schema.
  - MySQL: `created_at`/`updated_at` DDL defaults are normalized to `CURRENT_TIMESTAMP` (metadata-only `MODIFY COLUMN`s; previous versions baked a boot-time literal into the default).
  - SQLite: the Nextly metadata tables are rebuilt once via SQLite's data-preserving table-rebuild (v1 represents UNIQUE constraints inline). Your content rows survive; this was pinned by an upgrade-simulation test.

  **Advisory (#5782)**: on SQLite, `PRAGMA foreign_keys=OFF` is silently ignored inside a transaction. Nextly's own applies are defended (rebuilds run outside transactions with an integrity check); raw drizzle-kit migrations you run yourself against the same SQLite database are not covered by that defense.

- [#236](https://github.com/nextlyhq/nextly/pull/236) [`e9e5f7b`](https://github.com/nextlyhq/nextly/commit/e9e5f7bcb5cd2d29fa8c32ffa34edd6910293364) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix many-to-many relationships, which did not work on any database.

  Creating a many-to-many field produced an invalid junction-table migration, so the junction table was never created. Even past that, the target collection was never resolved (so links silently did nothing), the parent table gained a phantom column it should not have, inserts crashed on SQLite, and reads plus inserts failed on MySQL. Many-to-many links now create, read, and delete correctly on Postgres, MySQL, and SQLite.

- [#216](https://github.com/nextlyhq/nextly/pull/216) [`85ef8f0`](https://github.com/nextlyhq/nextly/commit/85ef8f0170f92128195198e49255d7b54e614fe1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Number fields can now store exact decimals for prices and other fractional values.

  Code-first number fields stored whole numbers only, so a value like `19.99` lost its fractional part at the database, even though the field documentation showed prices and cent-level steps. Number fields now accept `dbType: "decimal"` (with optional `precision` and `scale`, defaulting to `DECIMAL(10, 2)`), which stores the value in a fixed-point `DECIMAL`/`NUMERIC` column: exact on Postgres and MySQL, and NUMERIC affinity on SQLite (which has no fixed-precision decimal type). Integer remains the default, so existing fields are unchanged.

  ```ts
  number({ name: "price", dbType: "decimal", scale: 2 }); // stores 19.99 exactly
  ```

- [#235](https://github.com/nextlyhq/nextly/pull/235) [`9c41e35`](https://github.com/nextlyhq/nextly/commit/9c41e356ae7ee371bbd675315785c3107299ed91) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add a `created_by` owner column to collection entry tables and stamp it on create.

  Every collection entry table now carries a nullable `created_by` system column (text, matching the id column type on each dialect) alongside `created_at` / `updated_at`, and it is stamped with the creating user's id on every create path. This makes `owner-only` access work zero-config: the stored rule compares `created_by` to the caller with no per-collection setup. System and seed writes (no user context) leave it null.

  Because the column is nullable with no default, existing tables pick it up as a plain additive `ADD COLUMN` on the next schema apply — no backfill and no interactive prompt.

  The owner column is wired end to end:
  - `owner-only` rules with no `ownerField` now default to the `created_by` column (snake_case), so zero-config owner-only reads/updates/deletes actually match the stamped rows.
  - On MySQL the column is `varchar(191)` (sized to the Auth.js-compatible `users.id`), since it stores a user id, not the row id.
  - Updates cannot rewrite it: `created_by` (and `id` / `created_at`) are stripped from update payloads, so an authorized updater can't transfer a row to another user.
  - It is stripped from list, get, and mutation responses (including populated relationship rows at every depth) so a collection readable by non-creators does not leak the creator's user id, and it is rejected from client-supplied `where` filters (query string and request body, including dotted keys like `created_by.any`) and `sort` so a caller can't target or order rows by creator either.
  - Reserved as a field name in the collection, code-first, and ui-schema validators; scoped to collections only (singles/components don't get the column, so their owner-only rules keep the historical `createdBy` default). An explicit `ownerField: "createdBy"` on a collection normalizes to the stamped column.
  - Indexed on collection tables, since owner-only reads/lists/counts and bulk-by-query enumeration all filter on it.

  This also repairs a latent bug in the bulk create transaction path, which passed camelCase `createdAt` / `updatedAt` keys the database driver rejected; the batch create paths now use the real snake_case column names.

- [#240](https://github.com/nextlyhq/nextly/pull/240) [`d349b9e`](https://github.com/nextlyhq/nextly/commit/d349b9e913ae6f958e4201b6481dfe83cc5cfa5a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Third-party plugins can now style their admin UI.

  The admin stylesheet is precompiled and isolated, so utility classes that live only in an npm-installed plugin were silently dropped. This adds three layers, in order of preference: new `Stack`/`Grid`/`Stat` layout primitives alongside `Card` in the plugin UI kit; a curated, token-driven utility safelist that is always available with no build step; and, for anything beyond that, a per-plugin `admin.styles` stylesheet compiled with the new `nextly-build-admin-css` CLI (`@nextlyhq/admin-css`) and declared via `contributes.admin.styles`. Plugin styling stays scoped under `.nextly-admin` and token-driven (light and dark) by construction — the CLI refuses to emit a stylesheet that would leak into the host page or hardcode a color.

- [#210](https://github.com/nextlyhq/nextly/pull/210) [`6f39d5a`](https://github.com/nextlyhq/nextly/commit/6f39d5a2cedd07f9bd4dd0d71fdef95a9adc2aff) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin-contributed field types now appear in the admin field pickers.

  A plugin that contributes a custom field type can opt it into any admin surface — the Schema Builder (collections and singles), the User Fields page, and the Form Builder — via `contributes.fieldTypes[].surfaces`, and give it a picker label, hint, icon, and category. The type then shows up in that surface's field picker, surface-filtered, and works end to end: it is accepted by the surface's validation, persists as its declared storage primitive (a user field gets a real column of the right type instead of a text fallback), and renders through its own admin component. Plugin authors get a shared, storage-agnostic field-UI kit for this via `@nextlyhq/plugin-sdk/admin` (`FieldTypePicker`, `FieldOptionsEditor`, `withOptionIds`, `FieldDefaultValueInput`, and the new `usePluginFieldTypeEntries` hook), plus `isPluginFieldTypeOnSurface` for server-side validation.

- [#229](https://github.com/nextlyhq/nextly/pull/229) [`2ece35b`](https://github.com/nextlyhq/nextly/commit/2ece35bd89b5b8232637da998af9194d94e158d3) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Raise the published dependency ranges that carried security advisories, so consumers installing these packages can no longer resolve a vulnerable version. Root `pnpm` overrides only protect this repository's own lockfile; these are the direct-range bumps that travel with the published packages.
  - `nextly`: `ws` `^8.18.0` → `^8.21.1`. The floor now excludes `ws` before `8.21.1` (memory-exhaustion DoS, plus CVE-2026-62389 fixed in `8.21.1`).
  - `create-nextly-app`: `tar` `^7.4.0` → `^7.5.19`. `create-nextly-app` extracts downloaded GitHub tarballs via `tar.x`; the floor now excludes the `<=7.5.18` path-traversal / file-smuggling line (patched in `7.5.19`).
  - `@nextlyhq/storage-s3`: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` `^3.966.0` → `^3.1090.0`; the newer AWS SDK no longer pulls the vulnerable `fast-xml-parser` into the S3 path.

  Deliberately NOT changed (documented so a version bump is not mistaken for a fix):
  - `isomorphic-dompurify` (`nextly`, `@nextlyhq/plugin-page-builder`) stays at `^2`. The DOMPurify `ALLOWED_ATTR` advisory is fixed in `dompurify 3.4.11`, but the first `isomorphic-dompurify` version that lower-bounds its bundled DOMPurify there is the `3.x` major, which requires Node `^20.19.0 || ^22.13.0 || >=24` (via `jsdom@29`) and would drop Nextly's advertised `node >=20.0.0`. That trade-off is not worth it for a moderate issue that a fresh install already avoids (`^2` resolves DOMPurify to the patched `3.4.12`). Raising the floor here is deferred to a future Node-support bump.
  - `@nextlyhq/storage-vercel-blob` is unchanged. Its only advisory transitive (`undici`) comes through `@vercel/blob`, which pins `undici ^6.x` on every release, so no `@vercel/blob` range reaches a patched floor for stale consumer lockfiles; a fresh install already resolves the patched `undici 6.27.x`. This is upstream-bound. The package is listed above only because releases version in lockstep — this release does not itself change `@nextlyhq/storage-vercel-blob`'s dependencies.

- [#213](https://github.com/nextlyhq/nextly/pull/213) [`30c2b57`](https://github.com/nextlyhq/nextly/commit/30c2b57829827bc682b47a354cacc3fd90a212ba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Carry the authenticated caller (identity and roles) through REST paths that previously ran without full context, so access control, hooks, and response redaction resolve against the real user.
  - **Bulk update by query** (`PATCH`-style bulk-by-`where`): now runs as the authenticated caller instead of anonymously. Per-entry access checks and hooks receive the user, and the response is redacted to what that user may read, matching the id-based bulk-update path.
  - **Standalone Single detail route** (`nextly/api/singles-detail` `PATCH`): forwards the authorized identity (including roles) into the update, so the response is redacted for that user, matching the dispatcher's single-update path.
  - **Roles in access evaluation**: route-authenticated write requests now carry the caller's role slugs to the service layer, so collection-level `role-based` rules and field-level `access.read` evaluate against real roles instead of an empty context. Role-based rules match on ANY held role (documented OR-logic) for the many-to-many user/role model; the single `role` field is still honored, so existing single-role setups are unchanged.

- [#231](https://github.com/nextlyhq/nextly/pull/231) [`a7fd33d`](https://github.com/nextlyhq/nextly/commit/a7fd33d61c3365d912ec9cd91b4e1ead15c9e5d0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Enforce a collection's stored access rules on REST route writes.

  A collection's stored access rules (`owner-only` / `role-based` / `authenticated` / `custom`) and field-level write access were enforced on the code-first Direct API but silently skipped over the REST route, because route writes forced a full `overrideAccess` bypass — the route only ever ran the coarse RBAC gate, then skipped the stored rules it had never checked. A rule such as "authors may only edit their own posts" was therefore not enforced over HTTP.

  Route writes (collection single, bulk, and singles update) now run with the real user and `overrideAccess: false`; the route's `routeAuthorized` flag only elides the redundant RBAC re-check the middleware already performed, while the stored rules and field-level write access are enforced with the caller. Singles evaluate their persisted `accessRules` (public / authenticated / role-based / custom) on the write path, not just the coarse RBAC permission. `overrideAccess: true` remains the explicit trusted-server escape (seeds, plugin `as:'system'`), and super-admins bypass the stored rules on every write transport.

  Behavior change: collections and Singles that declared stored access rules — and were relying (knowingly or not) on the REST bypass — now have those rules enforced over REST writes. Resources without stored rules are unchanged.

  Read paths are unchanged here: forwarding the authenticated user on REST reads (so owner-only read filtering, field redaction, and the super-admin read bypass apply) is a separate follow-up.

- [#234](https://github.com/nextlyhq/nextly/pull/234) [`4e8f80d`](https://github.com/nextlyhq/nextly/commit/4e8f80d0c0ceb7e17fd935f353495a66112a111e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix two safeFetch edge cases from the IP-pinning change.

  An empty 2xx/204/304 response that still carries a `Content-Encoding` header no longer fails: inflating zero bytes threw and turned a valid empty delivery into a `SafeFetchError`, so `decodeBody` now passes an empty body straight through.

  A URL-backed email attachment that exceeds the size limit now surfaces the same `EMAIL_ATTACHMENT_SIZE_EXCEEDED` validation error the local/S3 path produces, rather than an opaque storage-read failure: the fetch translates a `response-too-large` result into the size-exceeded error, and the attachment resolver passes a typed `NextlyError` from `readBytes` through instead of re-wrapping it.

- [#209](https://github.com/nextlyhq/nextly/pull/209) [`38af42b`](https://github.com/nextlyhq/nextly/commit/38af42b22d9f1e6de6e4770abb199a9d4ed300db) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Close server-side security gaps in the schema write/read pipeline and fix a component-field regression.

  Component fields (`type: "component"`) can be saved again: the shared field-payload gate no longer rejects them for lacking a nested `fields[]` array, since a component field references a component by slug rather than embedding fields. Password fields are now protected everywhere they can appear: hashes are never returned through an expanded relationship (including the users entity's password hash), inside a component instance, or in a create/update response, and a password inside a component is bcrypt-hashed on write instead of stored in plaintext. Server-side validation now covers component instances and rejects an array value for a single-choice select/radio field, and editing an entry with a required password no longer forces you to re-enter it. Component definitions can no longer be listed without authentication, expired sessions on the standalone routes refresh instead of hard-logging-out, rate-limited callers keep their `Retry-After` backoff, and the components route initializes before its permission check so a valid first request is not rejected.

- [#205](https://github.com/nextlyhq/nextly/pull/205) [`585384d`](https://github.com/nextlyhq/nextly/commit/585384ddc8944f4d08c6f59cd42096e0ad3745fa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The schema system now enforces what it promises.

  Every entry write — admin, REST, Direct API, bulk, or forms — is validated server-side against the collection's field rules (required, length, range, pattern, options, row bounds), and failures come back with per-field paths the admin renders inline on the exact field. Field-level `validate`, `access`, and `hooks` in code-first configs now actually execute: custom validators run in the write gate, per-field access strips denied fields from writes and reads, and all four field-hook phases fire at their documented points.

  Password fields are finally honest about "Hashed at rest": values are bcrypt-hashed before storage, never returned by any read or mutation response, and edit forms treat a blank input as "keep the current password".

  The standalone `nextly/api/*` route handlers now authenticate for real — verified session or API key plus the same RBAC permissions their admin-API twins require — replacing a header-presence check; media routing consolidates onto the authenticated `media-handlers` surface, and pre-signed upload URLs require create-media.

  Schema apply endpoints and the `ui-schema.json` mirror now validate fields with one shared schema, so a change can no longer apply to the database while silently failing to reach the committed manifest (upload fields no longer require the `relationTo` the builder never collects), and a failed manifest sync after a delete surfaces as a warning instead of disappearing.

- [#220](https://github.com/nextlyhq/nextly/pull/220) [`2d9165c`](https://github.com/nextlyhq/nextly/commit/2d9165cbde2128925d89b800acf77c1861a567eb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Move `nodemailer` to `^9.0.1` (from `^8`) to pick up the patched line for the message-level `raw` file-access bypass advisory. The SMTP provider builds messages from structured fields and never uses the `raw` option, so this was not reachable, but the dependency is now on a supported, patched release.

  The monorepo's own transitive and toolchain dependencies were also refreshed to their patched releases via `pnpm` overrides (undici, dompurify, next, vite, ws, vitest, js-yaml, fast-uri, fast-xml, @babel/core, tar). This hardens this repository's builds, CI, and local development. `pnpm` overrides are root-project settings and do not travel with the published packages, so they do not by themselves change what a consumer of `nextly` / `create-nextly-app` / `@nextlyhq/storage-*` resolves; raising the affected published dependency ranges for consumers is tracked as a separate follow-up. `turbo` is pinned to `2.9.7` to preserve the workspace build ordering.

- [#215](https://github.com/nextlyhq/nextly/pull/215) [`2f1c981`](https://github.com/nextlyhq/nextly/commit/2f1c98199b06843b381758f1dacea061b29b2d41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema Builder saves for singles and components now reject stale saves.

  Applying a schema change to a single or a component through the Schema Builder previously ignored the version the editor was loaded at, so two admins editing the same single or component would silently overwrite each other (last-write-wins on both the DDL and the stored metadata). Both now compare the submitted version against the current one and reject a stale save with a version-conflict error before any DDL runs, matching the collection apply path. All three entity kinds report the conflict identically, so the client can prompt the editor to reload and retry. Code-first schema changes applied through the dev HMR path are unaffected.

- [#222](https://github.com/nextlyhq/nextly/pull/222) [`f988a69`](https://github.com/nextlyhq/nextly/commit/f988a691a95a2371833b8ba424a7da3402668f5c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Auto-generate a collection entry's `slug` from its `title` before validation.

  Every collection carries an auto-injected required, unique `slug`. Creating an entry with only a title (`create({ data: { title: "Hello World" } })`) now derives the slug (`hello-world`) and dedupes repeats (`hello-world-2`, …) instead of failing with "Slug is required." An explicitly provided slug is still respected and sanitized. This matches the WordPress/Ghost slug-from-title convention and restores the intended behavior after server-side write validation began running ahead of slug generation.

- [#224](https://github.com/nextlyhq/nextly/pull/224) [`e6074bc`](https://github.com/nextlyhq/nextly/commit/e6074bc9f21a048717fa239270d2bd9bebc68429) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Populate a valid `slug` when a title has no URL-safe characters, and re-sanitize hook-set slugs.

  Creating an entry whose title is entirely non-ASCII, emoji, or punctuation (for example `create({ data: { title: "你好世界" } })`) previously produced an empty slug and failed required-field validation, because slug derivation stripped every character. It now falls back to a unique generated token so the required, unique `slug` column stays populated. Additionally, a slug set by a field-level `beforeValidate` hook is re-sanitized before validation and storage, so hook-provided values stay URL-safe.

- [#232](https://github.com/nextlyhq/nextly/pull/232) [`d96bf6a`](https://github.com/nextlyhq/nextly/commit/d96bf6abb9ff94c3463d5da1d32339a8718b0f2c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Pin the validated IP when `safeFetch` connects, closing DNS rebinding.

  `safeFetch` previously validated a URL's resolved addresses and then handed the raw URL to `fetch`, which resolved DNS a second time at connect. An attacker controlling DNS could answer with a public IP during validation and a private one at connect, reaching internal services. It now issues the request over `node:http`/`node:https` with a `lookup` that forces the socket to the exact address validation vetted, so no second resolution can occur. It also stops following redirects (a 3xx is returned as-is), caps the response body, and bounds the whole request (including DNS validation) with a deadline. A new `SafeFetchError` (a `NextlyError`) distinguishes an over-large, timed-out, or undecodable fetch from an SSRF rejection, and gzip/deflate/br response bodies are content-decoded (with a bomb guard) to match the previous behavior. The URL validator now also rejects IPv4-mapped IPv6 literals in their hex-normalized form (for example `[::ffff:127.0.0.1]`, which `URL` rewrites to `::ffff:7f00:1`), closing a loopback/private bypass, and a caller-supplied `Host` header is dropped so it cannot route a request to an internal virtual host behind the validated IP.

- [#226](https://github.com/nextlyhq/nextly/pull/226) [`3086cf4`](https://github.com/nextlyhq/nextly/commit/3086cf4953a3be251d527ef8dadc73f07fbe7796) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Run a transaction's `select`/`selectOne`/`update`/`delete`/`upsert` inside the transaction.

  The `TransactionContext` CRUD methods delegated to the adapter's pool-bound Drizzle instance, so on the pooled adapters (Postgres, MySQL) a read inside a transaction ran on a different connection and could not see rows written earlier in the same uncommitted transaction. Two same-title creates in one transaction (or bulk batch) both chose the base slug and the second hit the unique constraint instead of receiving `-2`. The base CRUD methods now accept an optional transaction-bound executor, and each dialect binds a Drizzle instance to its checked-out connection so context CRUD reads its own writes. SQLite was already correct by virtue of being single-connection; the fix makes all three dialects consistent.

- [#223](https://github.com/nextlyhq/nextly/pull/223) [`7fcdd89`](https://github.com/nextlyhq/nextly/commit/7fcdd89188acb342e536a88a7bdc187b128aa85e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the webhook event envelope and filter-matching primitives.

  Pure, storage-agnostic building blocks for the webhook system: the versioned `WebhookEvent` envelope (with computed `changedFields` and mandatory sensitive-field stripping), the endpoint and filter-spec types, `buildEnvelope()` for assembling an envelope from a resource's current and prior state, and `matchesFilter()` for evaluating a per-webhook filter at fan-out time. No delivery behavior yet; these feed the outbox-capture and delivery slices.

- [#233](https://github.com/nextlyhq/nextly/pull/233) [`0566849`](https://github.com/nextlyhq/nextly/commit/05668498f248a3d4e5ff754a2c0c045507b75fc0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add webhook fan-out: turn durable events into per-endpoint delivery rows.

  `fanOutDueEvents` is the drain's first phase. `recordEvent` writes only the durable event inside the content transaction; fan-out runs separately and matches each un-fanned event to the enabled endpoints (subscribed type plus the endpoint filter) and inserts one `nextly_webhook_deliveries` row per match. This keeps content writes fully decoupled from the webhook registry (the transactional-outbox split), so creating, disabling, or deleting a webhook can never fail an unrelated content write.

  A new `fanned_out_at` marker column on `nextly_events` lets the drain find events still needing fan-out. Fan-out is idempotent under concurrent drains: each event is processed in its own transaction that inserts only the deliveries not already present, with the unique `(webhook_id, event_id)` index as the hard backstop, and a losing race simply retries on the next pass. Also adds the race-safe `WebhookEndpointRegistry` (cached enabled-endpoint load) and the pure `selectDeliveryTargets`. Delivery (signing, sending, retries) lands in a following change.

- [#225](https://github.com/nextlyhq/nextly/pull/225) [`71843e4`](https://github.com/nextlyhq/nextly/commit/71843e4047e8b90650da4631d94e4e0e7d155131) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the webhook transactional-outbox capture.

  `recordEvent` is the single choke-point every write path calls to durably record a content event inside the caller's transaction, so the event commits atomically with the change and can never be lost or fired for a rolled-back change. It writes only the `nextly_events` row; fan-out to endpoints happens later in the drain, keeping content writes fully decoupled from the webhook registry (the canonical transactional-outbox split). Also adds `sensitiveFieldNames`, the password/hidden strip policy (walking nested groups, repeaters, and blocks) that feeds the envelope builder.

- [#227](https://github.com/nextlyhq/nextly/pull/227) [`24b5c85`](https://github.com/nextlyhq/nextly/commit/24b5c856c13c4c3984fe7d6fe7d4975c6ddd139e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add Standard Webhooks payload signing.

  Pure signing primitives for outbound webhook deliveries: `signPayload` and `buildSignatureHeaders` produce the `webhook-id`/`webhook-timestamp`/`webhook-signature` headers (`v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`), and `verifySignature` is a constant-time verify helper covering secret rotation. `whsec_`-prefixed secrets are base64-decoded to key bytes. The delivery engine wires these in later; secrets live encrypted at rest and are decrypted before signing.

- [#221](https://github.com/nextlyhq/nextly/pull/221) [`f29d765`](https://github.com/nextlyhq/nextly/commit/f29d7655565c76eeb7b2bd88581659e71b0ec120) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the webhook and event system tables (nextly_events, nextly_webhooks, nextly_webhook_deliveries).

  These three per-dialect core tables back the durable-outbox webhook system: an append-only event ledger (also the substrate for audit logging and workflows), the outbound-webhook endpoint registry (hashed secrets, subscribed events, structured filter), and the per-endpoint delivery ledger with retry state and an attempt log. They are registered as first-class managed tables, so the schema pipeline creates them on boot. No delivery behavior yet; this is the data model only.

## 0.0.2-alpha.35

### Patch Changes

- [#203](https://github.com/nextlyhq/nextly/pull/203) [`cfd0d83`](https://github.com/nextlyhq/nextly/commit/cfd0d83bafd79efeee715f0c4e396bafc6d43acf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - First-party plugin admin UIs now render exactly as designed.

  The admin stylesheet build now scans the form-builder and page-builder admin sources, so utility classes used only by a plugin are no longer silently dropped from the compiled CSS. Most visibly: the form preview's desktop/mobile toggle now genuinely resizes the simulated pane (mobile was rendering full-width), and over a dozen other spacing, sizing, and border details across the builder, notifications, and submissions screens now apply as intended.

- [#162](https://github.com/nextlyhq/nextly/pull/162) [`2b3b072`](https://github.com/nextlyhq/nextly/commit/2b3b0729ee4e5aa2501356bc1bf0640f5cd8697b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Keep the schema builder out of production, isolate the admin design system from the host site, and fix admin surface consistency.

  **The schema builder is now off in production, and its endpoints enforce it.** `admin.branding.showBuilder` already hid the builder's navigation, but the schema endpoints behind it stayed open — a deployed site would still accept requests to create, alter, or drop collections, singles, and components over HTTP, straight against the live database with no migration to review and no rollback. Those endpoints now refuse with `403 BUILDER_DISABLED` wherever the builder is disabled, the builder's pages send you back to the dashboard instead of loading, and the schema-changes bell is hidden. The builder is disabled in production by default; set `admin.branding.showBuilder: true` to opt back in.

  Reading schemas, entry CRUD, and code-first schema sync are all unaffected — a deployed site still lists its collections and manages its content exactly as before. **If you script schema changes against a production deployment over HTTP, that now returns 403** and is the one thing to check before upgrading.

  The admin's design tokens are now namespaced (`--primary` is now `--nx-primary`, `--background` is now `--nx-background`, and so on) and the admin's scoping wrapper is now `.nextly-admin` (was `.adminapp`). Utility classes are unchanged: `bg-primary`, `text-muted-foreground` and friends keep working exactly as before. This means a site's own `--primary`/`--background` tokens can no longer collide with the admin's, and the admin can no longer restyle the site around it.

  Also fixed: the admin's CSS reset (`html`/`:host` font and line-height, file-input and form-element rules) leaked onto the host page instead of staying inside the admin; `dark:` utility variants were silently corrupted during CSS scoping and now work; a stray selector gave focused inputs the browser-autofill treatment; and the dark-mode sidebar now shares one flat surface with the content instead of appearing as a lighter panel.

  If you wrote custom CSS targeting admin internals, reference the `--nx-*` token names and the `.nextly-admin` wrapper.

  Removed the unused `ResponsiveTable` (and its `Column` type), `BulkSelectCheckbox`, and `RoleAssignDialog` exports. Every admin list already renders through the unified `DataTable`, and none of these were used; if you were importing `ResponsiveTable`, use `DataTable`/`DataTableView` instead.

  There is now one pagination component. The admin had grown three — the shared `Pagination`, an entries-only copy, and a `TablePagination` in `@nextlyhq/ui` that no table used — which is why pagination sat flush against the table on some pages and floated with a stray border on others. The surviving `Pagination` gained the better parts of the others (a `<nav>` landmark, arrow/Home/End keys, a configurable item noun) and its buttons now use the interactive border tier instead of the faint divider tier. `TablePagination` is removed from `@nextlyhq/ui`; use `DataTable`, or `Pagination` from `@nextlyhq/admin`.

  Menu items in dropdowns now show a pointer cursor and a readable hover, and the highlight follows keyboard navigation as well as the mouse.

  Table column choices now survive a refresh, and "Reset to default" restores the collection's real default columns. Both were the same fault: the admin saved a placeholder set of columns over your stored choice before the collection had finished loading.

  Profile changes now show in the header straight away instead of after a reload, and save buttons are text-only — dropping the floppy icon also fixed their spacing on the settings pages.

- [#182](https://github.com/nextlyhq/nextly/pull/182) [`b4e6294`](https://github.com/nextlyhq/nextly/commit/b4e6294d9c8c37dbb646c26b8e3fe701860ae00c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Plugins page now tells you what each plugin actually does to your app, and every plugin has a real page of its own.

  **The plugins list reports honest state.** The "coming soon" banner is gone, and so are the selection checkboxes and the bulk-delete button that only ever said "not available". In their place: an Enabled/Disabled status on every row, an author and description under each name, a category badge, and status filter chips (All / Enabled / Disabled). Plugins are installed and updated with your package manager and wired in your config, so the page reports state instead of pretending to mutate it — there are no fake install, update, or uninstall buttons.

  **Every plugin has a detail page.** Clicking a row opens `/admin/plugins/{plugin}` with the plugin's identity (version, author, license, category, links to its homepage and repository) and a **"What this plugin adds"** section computed from the plugin's real registrations — the collections, navigation items, admin pages, dashboard widgets, field types, permissions, and API routes it actually contributes. A disabled plugin says plainly that its data is retained but its behavior does not load.

  **Plugin settings get a whole page instead of a box.** A plugin that ships a settings UI is linked from its detail page ("Open settings") and renders full-page at `/admin/plugins/{plugin}/settings`. A disabled plugin's settings UI does not load, because a form that pretends to configure inactive behavior would be lying.

  **Plugin authors can now declare identity metadata.** `definePlugin` accepts `author`, `homepage`, `repository`, `docsUrl`, `license`, `category` (a controlled vocabulary the list filters by), and `tags` — mirror your package.json values and the admin does the rest. Both first-party plugins declare theirs.

  Also: the sidebar's "Installed Plugins" item now goes to the plugins overview instead of whichever plugin happened to be first.

- [#164](https://github.com/nextlyhq/nextly/pull/164) [`1ed808c`](https://github.com/nextlyhq/nextly/commit/1ed808c6a8b9c2eeffe7ae3a2c675f7d911cbb88) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix dates reading back empty on SQLite, correct the total reported beside a list, highlight code everywhere it appears, and rebuild the API Playground around the request you are actually sending.

  **Dates on collection entries read back `null` on SQLite, and now don't.** `createdAt`, `updatedAt` and every date field you defined came back empty from the API and rendered as `–` in the admin's Created and Updated columns. Entries are saved inside a transaction, and on that path a date was written as text into a column the reader treats as a number, so nothing failed on save and everything failed on read. Sorting or filtering by a date silently did the wrong thing rather than nothing, because the two encodings do not compare. **Postgres and MySQL were never affected, and neither were Singles or media.** Existing databases are repaired once, automatically, on the next start — you do not need to run anything, and the entries whose dates came back empty will have their real dates again. If you have been working around this by not trusting `createdAt` on SQLite, you can stop.

  **The total beside a list disagreed with the list.** A collection of 5 entries reported `total: 4` when one was a draft, and asking for drafts returned rows with a total of `0`. The count was answering as an anonymous reader while the rows were fetched as you, so it left out everything you could see and a public visitor could not. `totalPages` is derived from that total, so anything paging on it could not reach the last page of its own results — a table could hide entries that were plainly there. Counts now match the rows beside them.

  **Code is highlighted wherever it appears, in both themes.** Code blocks in the rich-text editor were never highlighted at all, the email template editor's dark mode had never worked, and both code editors stayed light when the admin was dark on a dark OS. The frontend rendered code with no highlighting and a colour baked into the markup that your stylesheet could not override. Highlighting now comes from the design tokens, so it follows the active theme, and the HTML sent to your site describes what each token _is_ and leaves the colour to your CSS. The same applies to highlighted (marked) text: it no longer carries a fixed yellow that a dark page could neither restyle nor read.

  **The API Playground now builds a request instead of asking you to remember one.** The method, URL, and Send sit on one pinned line (`⌘↵` to send, `Esc` to cancel), so a long list of parameters no longer pushes them off-screen. Sort is a field picker with a direction toggle rather than free text you had to prefix with `-`; the fields you can return are checkboxes rather than hand-written JSON; depth, limit and page are number inputs carrying the bounds the server enforces. A Code tab shows the same request as cURL, `fetch`, or Nextly SDK — the SDK one runs on a server with no HTTP round trip. The response pane reports size and headers alongside status and latency, and the body downloads exactly as it arrived. Every parameter's explanation now sits under the field it explains instead of behind a hover, where a keyboard or screen reader could not reach it at all.

  **Tooltips appear where you point.** Any tooltip inside the admin's main content could land hundreds of pixels away — under the sidebar — because the positioner and the browser disagreed about what a CSS container is. This affected the collapsed sidebar, the rich-text toolbar, table row actions, and every field help icon.

  **Status colours are now one vocabulary.** Success, warning and destructive each derive their whole range from a single token, so retheming one moves every shade with it and they cannot drift apart. Two different greens meant "success" and two different reds meant "destructive" before this. Along the way a document icon was rendered in the red used for destructive actions, "Advanced Fields" was marked with the same red, and category dots were coloured by hashing the category name — a colour that meant nothing and changed if you renamed it. Those are now neutral, and the design guard rejects raw palette classes so they cannot come back.

  Also: the email template editor gained line numbers and code folding, the request body field is a JSON editor rather than a plain textarea, and `nextly` no longer ships seven editor packages it never loaded.

- [#165](https://github.com/nextlyhq/nextly/pull/165) [`a704e1a`](https://github.com/nextlyhq/nextly/commit/a704e1a4b824d5b6cfb06ff1519f0f24921a8c0f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix role inheritance granting the wrong permissions, show every permission the matrix can grant, and ship Admin, Editor, Author and Viewer roles.

  **Role inheritance resolved in both directions, so a base role collected the permissions of every role built on top of it.** A role holds the permissions of the roles it inherits from, and those are recorded as its children — but the check walked parents too, which made the edge symmetric. Give someone Viewer, and if any role named Viewer as its base, that role's permissions came with it. This is the live check: `hasPermission` resolves through it, and collection, single and middleware access all fall through to `hasPermission`, so every one of them read the same wrong answer. **If you use role inheritance, re-check what your roles actually grant after upgrading** — permissions that leaked in this way will stop being granted, which is the point, and anyone relying on the leak will lose access they should never have had. `role_inherits` is empty on most installs, in which case nothing changes.

  **The permissions matrix showed four columns and your database has seven actions.** `publish` and `export` had nowhere to go, so they were dropped — while "Select All" granted them anyway, off the raw list. The editor granted permissions it could not draw, and the only way to revoke one was Clear All and start again. Columns are now derived from the actions that exist: `publish` appears on the content types that have it, `manage` is its own column instead of being filed under one labelled "Update" (ticking Update on Settings granted `manage-settings`), `delete-api-keys` is no longer hidden by an unexplained special case, and `submissions` has left Collection Types — it is a plugin's resource, not a collection, and it now sits under a **Plugins** tab with an Export column instead of rendering as a row of four dashes.

  **Nextly seeded one role. It now seeds four**: Admin (everything except granting access to others), Editor (content and media, including publish), Author (the same reach without delete or publish), and Viewer (read only). They are predicates rather than fixed lists, re-resolved every boot, so adding a collection does not leave them quietly not covering it. They are system roles and are never assigned to anyone — build your own role on top of one rather than editing it.

  **A role now starts from another role.** "Start from" offers the seeded roles, and the page says what the answer means in a sentence: "This role can do everything Author can, plus 2 permissions ticked below." One base role, not several.

  The role form's **Status field is gone**. It had no column on the roles table, so nothing it collected was ever stored; reads were hardcoded to "Active" and every role's created date rendered as today. Worse, choosing Inactive or Deprecated silently converted the role into a system role, permanently locking its name and slug. The roles list loses its Status and Created columns with it — the API returns neither, and both were invented in the client.

  **Three fixes for permissions that were unreachable or wrong.** `manage-api-keys` carried the action `update`, so nothing could reach it by the name every caller derives — the nav item, two registry entries and the sidebar's settings check all asked for `update-api-keys`, which did not exist, and only super admins (who bypass the check) could not notice. It is now named after its action, and existing databases are corrected on boot without losing grants. `nextly permissions:cleanup` deleted plugin-declared permissions and their grants — it judged a permission orphaned when its resource was not a collection, which a plugin's resource never is — and now consults provenance instead. And permissions whose package stopped declaring them are marked rather than left claiming an owner that no longer wants them; they drop off the menu, keep their grants, and are retired only by an explicit cleanup.

  **Plugins can now say what their permissions are.** `PluginPermission.group` was documented, set by the canonical example, and read by nothing; it now files a permission under a heading within its own plugin's section. New `danger` marks a permission that hands out access or takes data off the site, and the admin warns before granting it.

  **Creating a user who could never sign in now fails instead of succeeding.** Ticking "Require email verification" on a site with no email provider created the account, failed to send the mail, swallowed the failure, and answered "User created." — leaving someone who saw "invalid credentials" every time they tried, because unverified users cannot sign in. The check now runs before the account exists.

  Also fixed: rejecting a role for a real reason said "An unexpected error occurred" instead of the reason, and a duplicated rule in the request handler made a role built purely from base roles impossible to create; checkbox outlines failed contrast in both light and dark modes (1.35:1 and 1.14:1 against a 3:1 requirement) because callers overrode the control's own styling with the divider colour; checkbox hit targets were 16px against a 24px minimum; and form help text was hidden behind an info-icon tooltip instead of sitting under the field it describes.

- [#181](https://github.com/nextlyhq/nextly/pull/181) [`8cc095b`](https://github.com/nextlyhq/nextly/commit/8cc095b7554bd0b0c6d8dc583666a318e0438b16) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Aligned dependency versions across the workspace so every package shares one version of each shared dependency. The form-builder plugin now uses the same major versions of zod (4), @dnd-kit, and react-hook-form as the rest of Nextly, removing duplicate copies from an installed app, and a dependency it never used was dropped. No runtime behavior changes.

- [#185](https://github.com/nextlyhq/nextly/pull/185) [`5241bb2`](https://github.com/nextlyhq/nextly/commit/5241bb289c81f45e80169d56de5607a56f6f8577) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Every field type is now described in one place, and the admin's pickers read from it.

  **New: `nextly/field-catalog`.** A browser-safe, pure-data module describing all 18 built-in field types — key, label, picker category, one-line hint, and icon name — plus `narrowFieldTypeCatalog()` for taking a surface's typed subset. The schema builder's field picker and the user-field type picker both render from it now, so the same field type can no longer be described differently on different screens (the user-field picker's labels and hints updated to the shared wording, e.g. "Textarea" is now "Long text" everywhere).

  **Removed: a drifted duplicate field model inside the admin.** An older, unused set of per-type field editors and their separate field-type definitions had fallen out of sync with the live schema builder and was reachable by nothing. It is deleted rather than left to mislead.

  `@nextlyhq/admin` now declares `nextly` as a peer dependency. Every real admin install already runs inside a Nextly app, so this formalizes what was always true rather than adding a new requirement.

- [#186](https://github.com/nextlyhq/nextly/pull/186) [`eb6751a`](https://github.com/nextlyhq/nextly/commit/eb6751a156b940108f6df1b109d58ac252e1abaa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugins can now build field-editing UI from the same components the admin uses.

  **New in `@nextlyhq/plugin-sdk/admin` (experimental): the field-UI kit.** Three controlled, form-library-agnostic components, following the same author surface as the shared DataTable:
  - **`FieldTypePicker`** — a grid of type cards rendered from `nextly/field-catalog`, narrowed to your surface's allowed types, with the same label, hint, and icon for a type everywhere it appears.
  - **`FieldOptionsEditor`** — the schema builder's options editor: label/value rows with drag reorder, values auto-generated from labels until edited, CSV/JSON import, and select/radio display knobs.
  - **`FieldDefaultValueInput`** — a type-aware default control: checkbox defaults are a true/false choice, select/radio defaults choose among the field's own options, number and date get typed inputs.

  **The options editor now reports every duplicate value at once.** Previously a batch of colliding option values surfaced one collision at a time — fix one, resubmit, discover the next. All duplicated values are now named together in a single warning.

- [#183](https://github.com/nextlyhq/nextly/pull/183) [`4aa9a61`](https://github.com/nextlyhq/nextly/commit/4aa9a61dce555b30da7d1b13608184d9fe4a8e86) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Force a first-sign-in password change when an admin sets a user's password.

  When an admin creates a user by typing a password for them (rather than sending a set-password link), that password is now temporary: the person must replace it the first time they sign in, and the admin-set password stops working once they do. This is the standard treatment for an admin-chosen credential (ASVS 6.4.1) — it keeps the temporary password from becoming the account's long-term one.

  How it works: signing in with such an account issues **no session**. Instead the login response asks for a new password, and the admin gets there through a "Set a new password" step shown right in the sign-in flow. Only after the new password is set is a real session issued — so the temporary password can never be used to do anything except set the replacement. A single-use, short-lived token carries the step; it authorizes nothing else.

  The forced change is cleared automatically whenever the person sets their own password — by completing this step, by changing their password later, or by using a reset link — so it never fires twice. Accounts created by self-registration, by the initial setup flow, or through an invite link are unaffected: those passwords are the person's own choice.

  Additive schema change: a nullable `must_change_password` column on `users`, applied cleanly by your next `nextly db:sync` (no default on existing rows, so nothing is rewritten).

- [#190](https://github.com/nextlyhq/nextly/pull/190) [`2fb740f`](https://github.com/nextlyhq/nextly/commit/2fb740fd609049f2dc90f6439a772e73367d5c1b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form-builder plugin no longer ships a second, unused field-builder UI.

  The package contained a complete parallel implementation of the field builder (a field-type registry, eight per-type editor components, an options editor, and the AddFieldButton/FormFieldList/SortableFieldRow/FieldEditorPanel components) that no screen ever rendered — the live builder uses its own components. These were still exported from the package, so they showed up in editor autocomplete and typed API surface as if they were supported. They are now removed.

  If you imported any of these directly from `@nextlyhq/plugin-form-builder/admin` (FormFieldList, SortableFieldRow, AddFieldButton, FieldEditorPanel, or the per-type field editors), those exports are gone; the supported builder components (FieldLibrary, FormCanvas, FieldEditor, FormPreview, ConditionalLogicEditor) are unchanged.

- [#192](https://github.com/nextlyhq/nextly/pull/192) [`3213d3f`](https://github.com/nextlyhq/nextly/commit/3213d3fcfebeb61c1e37987efab19725fb274275) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form builder's field editing is rebuilt as a card list on Nextly's shared field system.

  **One card per field, edited inline.** The three-pane layout (field palette, canvas, properties sidebar) is gone. Fields are collapsible cards: the header shows the type (from the shared field-type catalog, so icons and names match every other field picker in the admin), the label, the generated name, and a required badge; expanding a card edits its properties right there. "Add field" opens the same catalog-driven type picker used by the rest of the admin.

  **Reordering works three ways**: drag handles, Move up / Move down in each card's menu, and fully keyboard-driven (focus the handle, Space to lift, arrow keys to move, Space to drop).

  **Deleting a referenced field is blocked, with the reason.** A field used by another field's conditional logic or by a notification's recipient shows a disabled Delete listing what references it, instead of letting the deletion silently break those.

  **Select and radio options** now use the shared options editor: drag to reorder options, values auto-generate from labels, CSV/JSON import, and duplicate-value warnings — the old inline editor could only add and remove.

  Also: new fields get readable names (`email`, then `email_2`) instead of timestamp suffixes; the plugin's field enable/disable option now actually filters the type picker (served to the builder via a new permission-gated `/builder-config` plugin route); saving no longer writes a `title` key the forms collection never declared; and the removed `FieldLibrary`/`FormCanvas` exports are superseded by `FieldCards`/`AddFieldDialog`.

- [#197](https://github.com/nextlyhq/nextly/pull/197) [`9e60f5c`](https://github.com/nextlyhq/nextly/commit/9e60f5c070d0b82c25808afbf8e726e17ab6d743) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form notifications are rebuilt: one honest name, new powers, and a send path that respects every setting.

  **It's called Notifications everywhere now.** The tab, the cards, the buttons, and the collection field all say "Notifications" — the "Email Integrations" naming inside the tab is gone.

  **Reply-To from the visitor.** A rule can set its Reply-To to one of the form's email fields, so hitting Reply in your inbox answers the person who submitted the form. A custom fixed address works too.

  **Send conditions.** A rule can carry one condition evaluated against the submitted data ("only send the sales alert when budget equals enterprise"). Unmet conditions skip the rule quietly for that submission.

  **The send path honors what you configure.** The per-rule sender email — previously collected and silently ignored — is now used, falling back to the plugin's `notifications.defaultFrom` option and then the template/provider default. New forms are seeded with one "Admin notification" rule that consumes `notifications.defaultToEmail`, and the `notifications.enabled` option now really turns form emails off. `sendWithTemplate` accepts per-send `from`/`replyTo` overrides.

  **A proper editor.** Rules are cards (with an enable switch, recipient summary, and a "Conditional" badge) edited in an accessible side sheet — replacing a hand-rolled modal that had no dialog semantics, no focus trap, and no Escape handling. Duplicating a rule starts the copy disabled so it never doubles live email. Deleting a form field that a rule's recipient, reply-to, or condition references is blocked with the reason.

  **Fixes**: submission data stored as text (e.g. on SQLite) no longer breaks `{{field}}` recipient resolution in notifications, and email layouts no longer appear as selectable notification templates.

- [#191](https://github.com/nextlyhq/nextly/pull/191) [`f9fc1af`](https://github.com/nextlyhq/nextly/commit/f9fc1aff1a808bca3727cb7eecd6292aef05b391) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The shared field-type catalog now describes the form surface, and plugin field types can declare where they belong.

  `nextly/field-catalog` gains `FORM_FIELD_TYPE_CATALOG`: the form builder's thirteen field types described once in the same catalog the schema builder and user-profile pickers already read, including five form-surface types (url, phone, time, file, hidden) that are deliberately not part of the canonical collection field union — form fields live in a form's JSON, so these can never reach the schema pipeline. The url and phone descriptions are shared with the user-profile surface, so a "URL" field looks and reads the same everywhere.

  Plugin-contributed field types can now declare `surfaces` (entries, users, forms) on their registration. A type only appears in a surface's field picker when the surface admits it, the type declares it, and the host has not excluded it — each level can only remove types, never force one in. Omitting `surfaces` keeps today's behavior (the type appears on the entry editing surface only).

- [#202](https://github.com/nextlyhq/nextly/pull/202) [`23f4897`](https://github.com/nextlyhq/nextly/commit/23f489760a0cea9b23f442e357e998a78c897e41) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The form preview is now an interactive simulation instead of a static mock.

  Type into real inputs and conditional logic reacts live (the same evaluator the runtime uses), hit the form's actual submit button and the configured confirmation plays out — the success message, or an honest "the visitor would now be redirected to …". A desktop/mobile width toggle, a reset button, required markers, help text, and a note about invisible hidden fields complete it. The preview is explicit about what it is: a simulation inside the admin — nothing submits anywhere.

- [#201](https://github.com/nextlyhq/nextly/pull/201) [`f8e3270`](https://github.com/nextlyhq/nextly/commit/f8e32704b155aa5af9dbad157854d79bc81d4c9a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form settings are one honest shape, and every setting shown now does something.

  **One canonical shape.** The builder previously saved settings keys the collection schema never declared, while the schema declared keys the builder never wrote. Now there is one `FormSettings` (the message-vs-redirect confirmation radio included), one reader (`normalizeFormSettings`) that every consumer goes through, and migration-on-read for legacy keys (`confirmationMessage` becomes the success message; the old nested `captcha` object becomes the flat fields) — saved forms lose nothing.

  **Settings that do things.** "Allow multiple submissions" is now real: turn it off and the same visitor (by IP) can submit once, with an honest "You have already submitted this form." on repeats. The per-form honeypot and reCAPTCHA toggles are now real overrides of the plugin's global spam config — tri-state selects where "Inherit" shows what the plugin default actually is, and the form wins where set.

  **Settings that did nothing are gone.** `showResetButton`, `resetButtonText`, `storeSubmissions`, and `submissionLimit` had no consumer anywhere; they no longer appear in the UI or the shape.

- [#198](https://github.com/nextlyhq/nextly/pull/198) [`edcb2d8`](https://github.com/nextlyhq/nextly/commit/edcb2d8ee4fa5e25c4c23cd3f6fcd2eefa6f0336) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Form submissions get an honest server: spam is stored and flagged instead of silently deleted, exports can be real CSV, and submission counts stop lying.

  **Spam is never silently dropped anymore.** Honeypot and reCAPTCHA hits are stored with `status: "spam"` and the detection reason, so a false positive stays reviewable and recoverable — the bot still sees the same fake success, no notification emails fire for flagged rows, and rate-limit hits are still rejected without storage. This also fixes a bug where honeypot detection could never fire at all: the spam check ran on schema-transformed data, which had already stripped the undeclared honeypot fields (and a form's real `website` field can no longer trip the trap either).

  **CSV export is real.** `GET …/submissions/export?format=csv&form=<id>` streams a CSV with columns from the form's fields plus metadata, named after the form and date. Exports page through everything, respect form/status filters, and exclude spam unless you ask for it. The JSON format remains the default.

  **`submissionCount` on forms is now a real number** (spam excluded) instead of a hardcoded 0.

  **Admin edits of submitted data leave a trace**: new `editedAt`/`editedBy` stamps are set whenever the submission `data` changes, and a new `spamReason` field records what flagged a submission.

  **Removed**: the never-mounted `SubmissionList`/`SubmissionDetail` components and the `@nextlyhq/plugin-form-builder/components` subpath that existed only to export them. The builder-config endpoint now also returns the resolved forms/submissions collection slugs so admin components work under slug overrides.

- [#199](https://github.com/nextlyhq/nextly/pull/199) [`e836d9a`](https://github.com/nextlyhq/nextly/commit/e836d9a6348a1ba23879115d90d14c1a24599142) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The submissions list finally shows what people submitted.

  **Per-field columns.** Pick a form and the table's columns become that form's fields — Name, Email, Message — with the standard hide/show column selector. Across all forms you get Form, a data summary, Status, and Submitted. (Submission data is stored keyed by field name, which is what makes real columns possible.)

  **Drawer detail with prev/next.** Click a row for the full submission: values in field order, keys no longer on the form shown honestly, metadata (IP, agent, ID), status and internal notes inline, and prev/next to walk the filtered set without losing your place.

  **Editing behind the update permission.** Admins with update rights can correct submitted values with inputs typed per field; every edit is stamped ("Edited … — the values above are not necessarily what the visitor sent"). There is deliberately no "New Submission" button — submissions are machine-created, and collections can now declare `admin.disableCreate` to say so.

  **Spam is a tab, not a black hole.** The Spam tab lists flagged submissions with the detection reason and a "Not spam" recovery (row action or the drawer's status control). Spam stays out of the other tabs and out of exports by default.

  **Export from the toolbar.** CSV (columns from the selected form's fields) and JSON, respecting the active form and status filter.

  The old `SubmissionsFilter` widget — with its hardcoded slugs that broke under slug overrides — is deleted along with its page registration and the now-empty styles export; host apps no longer import any form-builder CSS.

- [#200](https://github.com/nextlyhq/nextly/pull/200) [`fb14ec8`](https://github.com/nextlyhq/nextly/commit/fb14ec87c308b8122ebd4405cf65d044ea82ab7b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Forms moves into the main sidebar rail.

  The form builder now declares standalone placement: Forms gets its own icon right after Media, and clicking it opens a sub-sidebar with Forms and Submissions. "Forms" appears exactly once — the duplicate entries in the Plugins section and the Collections group are gone, and the redundant second builder that rendered at the plugin "settings" URL is removed (the Forms collection's edit view is the one and only builder). Hosts that prefer Forms under the Plugins section can override the placement in one config line.

- [#171](https://github.com/nextlyhq/nextly/pull/171) [`adcaa08`](https://github.com/nextlyhq/nextly/commit/adcaa08697846fd647e6bec5b22372ab9d2604d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Add the ability to invite a user by a set-password link.

  Nextly can now mint a single-use link that lets a new person set their own password and sign in, and accept that link in one step. `AuthService.generateInviteToken(userId)` returns a 256-bit token (only its SHA-256 hash is stored, and only one is active per account at a time); `AuthService.acceptInvite(token, password)` validates it, sets the password, marks the email verified, activates the account and consumes the token, all in one transaction. The link lasts seven days.

  A new endpoint, **`POST /auth/accept-invite`**, accepts the link over HTTP: it takes `{ token, newPassword }`, is CSRF-protected like the other auth routes, and answers with one generic message for any unusable token (unknown, used, expired) so a guessed token learns nothing about which invites are live — while a weak-password error is passed through, since that is the one thing the person can fix.

  The mechanism is complete and tested at both the service and HTTP layers. What is not here yet: creating a user through the admin does not mint one of these links automatically — that wiring, and the form that shows the copyable link, come next.

  `users.password_hash` is now **nullable on Postgres**, matching SQLite and MySQL, so an invited account can exist before it has a password. This is a schema change your next `nextly db:sync` will apply; loosening a NOT NULL constraint is not data-losing, so it applies cleanly.

- [#178](https://github.com/nextlyhq/nextly/pull/178) [`dacef90`](https://github.com/nextlyhq/nextly/commit/dacef90f0b3bdb944d1bf8aca68b59da4dccfeb8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Invite a user by a set-password link when creating them in the admin.

  Creating a user now asks one question up front — **how should this person sign in?** Choose **Send a set-password link** (the default) and the account is created without a password; the admin gets back a copyable link that lets the new person set their own password and sign in. Choose **Set a password now** and the admin sets it directly, as before. The old "Require email verification" checkbox is gone: whether an account can sign in no longer depends on email being configured or a message being delivered.

  Under the hood, `createLocalUser` with no password creates the account and mints its invite link in the same transaction, so an admin can never be handed a user with no way in. The link is the artifact — it is returned to the admin to deliver however they choose (email, chat, in person); nothing about creating a user depends on a mail provider. Accepting the link sets the password, verifies the email and activates the account in one step, at the new **`/admin/accept-invite`** page.

  Because the account is verified by the act of accepting an invite that reached its address, the create flow no longer pre-checks whether a verification email could be sent — that check, a stopgap that refused to create a user when no mail provider was configured, is removed. Installs with no email set up can now invite users normally.

- [#180](https://github.com/nextlyhq/nextly/pull/180) [`f5426ed`](https://github.com/nextlyhq/nextly/commit/f5426ed147f901daea37df14417fb71a65637d06) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Require authentication and permissions to write media.

  Media writes are no longer open. Previously anyone on the internet could upload, edit, move, or delete a site's media by calling `/api/media` with no login and no key — the endpoint had no auth at all. Now the write operations (upload, update, move, delete, and their folder equivalents) live at a gated **`/admin/api/media`**, where each is checked against a media permission (`create`/`read`/`update`/`delete-media`) and the acting user is taken from the authenticated session or API key, never from a request field like `uploadedBy` (which could name anyone). Reading media stays public at `/api/media` — files are served to anonymous visitors — but that path now serves **reads only**; its write verbs are gone.

  This is why media permissions could not previously gate anything: the admin's session cookie is scoped to `/admin`, so it never reached `/api/media`, and the whole `manage`/`create`/`read`/`delete-media` set was decorative. Moving the management surface under `/admin` is what lets the session authenticate, so the permission checks finally take effect.

  Also adds a real **`update-media`** permission (media had create/read/delete but no update), so editing metadata and moving files gates on `update-media` consistently with every other resource. The built-in Admin, Editor, and Author roles pick it up automatically; Viewer does not.

  **Consumer action:** if your app re-exports the media handlers, mount the gated instance for the admin — `createMediaHandlers({ config, requireAuth: true })` at `app/admin/api/media/[[...path]]/route.ts` — and keep the public read-only instance (`createMediaHandlers({ config })`, exporting `GET` only) at `app/api/media/[[...path]]/route.ts`. Media file URLs in API responses are unchanged and remain public (no `/admin` prefix).

- [#189](https://github.com/nextlyhq/nextly/pull/189) [`89a5e8a`](https://github.com/nextlyhq/nextly/commit/89a5e8aca0fc3dc9d402241f222b72f71d619338) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Media folder navigation no longer moves around, and the library remembers how you like it.

  **One folder model.** Previously, hiding the folder sidebar relocated folders to a different UI above the grid, and showing it moved them back to the left: two different folder UIs behind one confusing toggle. Now the folder tree in the sidebar is simply shown or hidden by a single toggle button, while inline folder navigation on the page (breadcrumbs plus the current level's folder cards, with the same rename/delete/new-subfolder menus) is always there. Nothing relocates; the tree is an overview, the cards are the drill-down.

  **The media library now defaults to the table view** (the grid stays one click away), and your choices stick: view mode, folder-tree visibility, and hidden table columns all persist per browser.

  **The media page gains the sort control** the media picker already had (newest/oldest, name, size).

  Also: the media dropzone's status colors, the upload preview, the media card, and the focal-point marker now use only design-system tokens (no raw color scales or ad-hoc shadows), and an unused media detail dialog was removed.

- [#188](https://github.com/nextlyhq/nextly/pull/188) [`cc3903b`](https://github.com/nextlyhq/nextly/commit/cc3903ba6f0749306219d1fd483847179eedf70a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Media bulk uploads now report every file honestly, and one bad file no longer sabotages the batch.

  **Dropping more than 10 files no longer rejects the whole batch.** Previously a drop of 11 valid files uploaded nothing and labeled every file "Too many files". Now the first 10 upload and the rest are listed as skipped, each saying so.

  **A batch with an oversized file now reads as what it is: a partial success.** Previously 9 valid files uploaded silently behind a full-width red "Invalid file type or size" panel, and the 9 success rows vanished after 2 seconds while the error stayed. Now every file gets its own row in one upload queue: per-file progress while uploading, a green check per success, and a persistent human-readable reason per failure ("File is too large (max 10 MB)" instead of "File is larger than 5242880 bytes"). The summary line reports "9 uploaded, 1 failed" and the queue stays until dismissed whenever anything failed; all-success queues dismiss themselves.

  **The upload drop target now closes itself when an upload starts** — no more hunting for the close icon — while the queue stays visible. Files that fail on the server get a one-click Retry.

  Also: the client-side size limit default now matches the server's 10MB default (it was 5MB, so files between 5 and 10MB were refused by the client that the server would have accepted), the dropzone no longer nests interactive buttons (invalid markup), and its status colors now use the design system's semantic tokens.

- [#166](https://github.com/nextlyhq/nextly/pull/166) [`55d8eb8`](https://github.com/nextlyhq/nextly/commit/55d8eb8cf5f9c8d9d47d51ed5665334a00fe9431) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Stop a custom user field from displacing a built-in one, and fix a field's name and type once it exists.

  **A custom user field named `email` replaced the real email address, and one named `id` replaced the identity used to create the session.** Custom fields live in their own table, but they are assigned onto the user object _after_ the built-ins, so the custom value wins. The same order applies to validation: a custom text field named `email` turned the built-in `z.string().email()` into a plain optional string, so a user could be created with an invalid address or none at all. Password checking was never affected — the hash is read by a separate query that custom fields cannot reach — but anything reading `user.id` from the object returned after sign-in was.

  `defineConfig()` has always refused these names. Nothing else did: the admin, `POST /api/user-fields` and `PATCH /api/user-fields/:id` all reach the same service, and it checked only that the field was not code-defined. The one check on that path ran in the browser and was skipped when editing. **Creating or renaming a field to any built-in name is now refused wherever the request comes from**, and the message says which name and why. `defineConfig()` and the API now share one implementation, so the two lists cannot drift apart.

  **If your database already has such a field, it stops being applied on the next boot** and Nextly logs which field it dropped. The row is left alone so you can rename it by hand. This is a behaviour change: a field named `email`, `id`, `name`, `isActive`, `passwordHash`, `roles` or any other built-in name will disappear from your users' data until it is renamed — it was displacing a built-in rather than sitting beside it.

  **A field's name and type can no longer change after it is created.** Both name the database column, and Nextly's schema reconciler only adds columns — so renaming left the old column and everything in it stranded under the old name, and changing the type left the column at its original type. The admin now says so under each field rather than only greying the input out, and label, description, placeholder, default, required and active all stay editable. Sending a name or type back unchanged is still accepted, so existing clients that submit a whole field keep working. Directus locks field keys for the same reason; Strapi renames and loses the data.

  Also in this release: **Nextly now has browser tests**, run in CI against a real server and a real database. They cover what unit tests structurally cannot — rendered layout, contrast, and whether the admin boots at all — and they caught nothing new, which is the point: they are there so that the column-width and contrast regressions fixed in the previous release cannot come back unnoticed. Contributors can run them with `pnpm --filter @nextlyhq/e2e test:e2e`; see `e2e/README.md`. This changes nothing about how you use Nextly.

- [#187](https://github.com/nextlyhq/nextly/pull/187) [`1a2214b`](https://github.com/nextlyhq/nextly/commit/1a2214be62e50cd747cd831c909fc2e108bbab65) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - User custom fields gained real validation, two new types, multi-value selects, and a rebuilt creation page.

  **A field's validation bounds finally do something.** `minLength`/`maxLength` (text-like fields) and `min`/`max` (number) used to be documented on the public field types and read by the checker — but no storage existed for them, so a code-declared `maxLength: 200` silently did nothing. They are now persisted (new nullable columns on `user_field_definitions`, all three databases), synced from `defineConfig()`, editable in the admin's new Validation section, and enforced: an out-of-range value is rejected with a per-field message naming the limit. A `maxLength` also sizes newly created text columns as `varchar(n)`. Existing rows are untouched; constraints apply to new writes on fields that declare them.

  **New field types: URL and Phone.** Both validated text, both available to `defineConfig()` and the admin alike. They are user-profile types only — collections cannot declare them, so they never touch the schema pipeline.

  **Selects can store multiple values.** The backend always supported `hasMany`; the admin now offers "Allow multiple selections" when creating a select field. Like name and type, it is fixed at creation because it decides the backing column's type.

  **The Create/Edit User Field page was rebuilt** on the shared field-UI kit: a single-column form whose reading order matches its causal order — the type picker (all 10 types, rendered from the shared catalog) sits at the top and everything it governs follows. The 400px side rail, the duplicated header, and the stale "Field Rules & Default" heading are gone; the selected type card's highlight is token-driven (the inline style that defeated it is deleted); duplicate option values are reported all at once.

- [#175](https://github.com/nextlyhq/nextly/pull/175) [`f4c95c1`](https://github.com/nextlyhq/nextly/commit/f4c95c144f01c7007f126e554e9226cc7e8655f1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Dependency-manifest consistency pass across the workspace: package.json dependency keys are now consistently ordered and the playground's Next.js lint preset is aligned with its Next.js version. No runtime behavior changes for any package.

## 0.0.2-alpha.34

### Patch Changes

- [#156](https://github.com/nextlyhq/nextly/pull/156) [`fd0aa70`](https://github.com/nextlyhq/nextly/commit/fd0aa706eb1ae4ed485e0337919b020d49181ccb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A comprehensive visual refresh of the Nextly admin.
  - **Consistent lists everywhere.** Every admin list — collections, entries, users, roles, media, API keys, singles, components, plugins, and form-builder submissions — now uses one unified data table with full-row navigation, and plugins can extend any list through new registries exported from the admin package.
  - **Design-token theming.** Hardcoded colors were replaced with design tokens across light and dark mode: dark-mode surfaces and text, a three-tier border scale that fixes the pervasive faint borders, clearer sidebar active states, readable link/breadcrumb contrast, and more legible badges, checkboxes, and radios. The admin is on Tailwind CSS 4.3 with the shadcn setup aligned to Tailwind v4's `@theme inline` model.
  - **Responsiveness.** The sidebar collapses to the mobile drawer across the full tablet range, wide tables keep readable columns and scroll horizontally, and the form builder's two-pane layout and tab strip adapt to narrow widths.
  - **Auth and API-key pages.** API keys open a full edit page on the shared settings layout, the registration form places one field per row, and the auth pages have corrected borders and width.
  - **Code-first schemas.** Collections, singles, and components defined in code now open in a read-only builder view instead of appearing broken.
  - **Email subsystem.** A redesigned full-width template workbench with a fixed HTML/plain-text editor-and-preview toggle; emails send as `multipart/alternative` with a plain-text alternative; every send emits a consistent log record; providers gain an Active toggle and dark-mode-legible logos; providers and templates render in the unified table; templates and layouts are unified into one kind-tagged model; and a Send test action is available while editing a template.
  - **Form builder.** The builder UI now matches the Nextly admin design system (monochrome theming), reports its version from `package.json`, and every package entry exposes a `default` export condition.

- [#158](https://github.com/nextlyhq/nextly/pull/158) [`f90fd3d`](https://github.com/nextlyhq/nextly/commit/f90fd3dd75b06e0d5818ffacfe79d0bd7db21575) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Nextly design system now lives in `@nextlyhq/ui` and is self-contained. You can style plugins and custom admin UIs two ways: import `@nextlyhq/ui/styles.css` for fully-styled, token-driven, dark-mode-aware components with zero Tailwind setup, or import `@nextlyhq/ui/theme.css` to build your own utilities against the token contract (tokens on `:root`/`.dark`, the `@theme` mappings, and the dark variant). Add the `dark` class to switch themes.

  Control heights (Button, Input, Select) are now driven by a `--control-height` token scale, so control density can be tuned from one place; default sizes are unchanged. The admin renders identically to before — it now sources its tokens from `@nextlyhq/ui` with no visual change and no token leakage into the host page.

  The form-builder and page-builder plugins now consume the design tokens directly (`var(--token)` / `color-mix`), so their admin UIs are fully token-driven and render correctly in both light and dark mode — the page-builder's canvas selection and drop indicators now follow the admin theme instead of a fixed accent. A new [plugin UI authoring guide](https://github.com/nextlyhq/nextly/blob/main/packages/ui/docs/plugin-ui-authoring.md) documents the token contract, and a `lint:design` check (wired into CI) keeps admin and plugin styles token-driven.

  The theme switcher (light / dark / system) now lives in the admin top bar for one-click access and applies instantly, instead of being tucked inside Settings behind a save.

- [#157](https://github.com/nextlyhq/nextly/pull/157) [`2b725ea`](https://github.com/nextlyhq/nextly/commit/2b725eab34613b4b49be6975ad2fb3add81ee29d) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Expand the page builder toward Elementor/Gutenberg parity: a much larger block set, deep per-block options, entrance motion, global design tokens, and platform helpers — all built on the plugin's existing extension seams with no Nextly-core changes.
  - **`supports` capability model.** A block declares which style capabilities it exposes (`supports: { typography, color, background, border, shadow, dimensions, position, opacity, filters, motion, visibility, interactions, customCss, customAttributes }`) and the inspector's Style/Advanced controls plus the compiled CSS are derived from that single declaration. `styleControls` remains as an escape hatch.
  - **Expanded styling.** The typed `StyleValues` now covers full typography (family/weight/appearance/letter-case/decoration/line-height/letter- & word-spacing), structured borders, box-shadow (with presets), background image + linear gradient, sizing (min-height/object-fit/overflow/aspect-ratio), opacity, CSS filters, transforms, absolute/fixed/sticky position + z-index, Gutenberg-style width alignment (wide/full), and descendant link colors (default/hover). All values pass css-tree validation before emission.
  - **Per-block custom CSS + attributes.** Authors can write per-block CSS using the Elementor-style `selector` keyword (sanitized and scoped at render), set a CSS ID and custom HTML attributes (allowlisted), and hide a block per breakpoint. New composite inspector controls: border, background, gradient, position, slider, box-shadow, unit-aware dimension, repeater, and icon picker; the typography selects now carry real option lists.
  - **~40 new/upgraded blocks.** Structure (Columns, Spacer, Divider, Anchor, Row/Stack); Basic (List, Icon List, Badge, Icon, Button Group, Rich Text, Table, Social Icons, Progress Bar, Counter, Rating, Countdown) plus inline formatting (bold/italic/link/highlight/strikethrough/sub/superscript) on Paragraph/Heading/List; Media (Cover, Gallery, Image/Logo Carousel, Slides, Content Carousel, Hotspot, Lottie) plus Image (caption/link/aspect/rounded) and Video (self-hosted, autoplay/mute/loop/controls, privacy host, poster) upgrades; Content cards (Icon Box, Image Box, CTA Card, Flip Box, Pricing Table, Price List, Form, Testimonial + Carousel, Reviews, Logo Cloud); Interactive (Tabs, Accordion, Toggle, Off Canvas — all server-rendered with no client JS via CSS scroll-snap / native `<details>` / the checkbox-hack); Utility (HTML/Embed, Map, reusable `core/ref`).
  - **Entrance motion.** A `motion` option compiles fade/slide/zoom entrance animations to CSS wrapped in `prefers-reduced-motion: no-preference`, with keyframes emitted once per page.
  - **Platform helpers.** Global design tokens surfaced as inspector color swatches, cycle-guarded reusable blocks (`core/ref`), template composition (`composeTemplate`), revision snapshot/prune helpers, and editor copy/paste + copy-style/paste-style with a navigator flatten utility.
  - **Packaging fix.** `sideEffects` now covers the source admin and block-registration entries so the plugin's components and blocks register from a plain side-effect import even under source-mode/monorepo bundling (previously tree-shaken, leaving the editor empty).

  All additions are additive and optional, so existing pages need no migration.

## 0.0.2-alpha.33

### Patch Changes

- [#154](https://github.com/nextlyhq/nextly/pull/154) [`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Add editable page-level custom CSS with live preview in the page builder editor

## 0.0.2-alpha.32

### Patch Changes

- Fix installation of the plugin in fresh apps: internal `@nextlyhq/*` peer dependencies now use the `workspace:*` protocol, so each published version's peers are rewritten to the versions released alongside it instead of a hard-coded (and stale) pin. Previously `npm install @nextlyhq/plugin-page-builder` / `nextly add` failed with `ERESOLVE` because the published peers demanded an older core version than the one installed.

## 0.0.2-alpha.31

### Patch Changes

- [#150](https://github.com/nextlyhq/nextly/pull/150) [`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Per-entry editor choice + the generic, plugin-agnostic platform hooks that power it. A collection or single can offer a per-entry **Default / Page Builder** toggle, and turning it on shows a visual canvas instead of the normal fields — delivered entirely through reusable extension points, with no page-builder-specific code in core or admin.
  - **Plugin field types round-trip to production.** `ui-schema.json` (the committable schema manifest) now accepts plugin-contributed field types, and the CLI registers `contributes.fieldTypes` before generating migrations — so a plugin field type resolves to its declared storage column and survives to production. Previously a UI-created plugin field was downgraded to `json` in the manifest, so the real type was lost outside dev.
  - **`layout: "takeover"` field-type flag.** A plugin field type can declare that, when a field of that type is active, the entry/single form collapses to just that field plus the field that controls its `admin.condition` — hiding the rest. Generic: it keys off field-type metadata (`branding.plugins[].fieldTypes[].layout`) and the existing condition evaluator, so any plugin field type can opt in.
  - **`contributes.admin.schemaBuilderSlot`.** Plugins can render a control above the field list in the collection/single schema builders, receiving `{ fields, setFields, disabled, context }` to add builder-time behavior (e.g. an editor-choice toggle) without core knowing the plugin.
  - **`contributes.admin.entryFormToolbarSlot`.** Plugins can render a control in the entry/single form header toolbar, reading and writing form state via react-hook-form — for form-level controls like a mode toggle.
  - **Managed (hidden) fields.** A field marked `admin.hidden` is kept out of the schema-builder "Your fields" list and out of the entry-form body while its value still lives in the form state — used for plugin plumbing that's driven by a toolbar control rather than shown as a field.

  `@nextlyhq/plugin-page-builder` is the first consumer of all of the above and is published through the same release: it registers a `page-builder` field type with `layout: "takeover"`, contributes the "Use Page Builder" schema-builder toggle and the per-entry Default / Page Builder form-toolbar toggle, ships the visual block editor (drag-and-drop canvas, inspector, responsive preview, query loop), and works for both code-first (`withPageBuilder()`) and UI-created collections and singles. Packaging: declares `sideEffects` so its admin components register from a plain side-effect import, with pinned peer versions for clean installs.

## 0.0.2-alpha.30

### Patch Changes

- [#145](https://github.com/nextlyhq/nextly/pull/145) [`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The API reference was not correctly specified in the `useEffect` dependency array. It was set as `[api]`, whereas it should have been `[api.public]`.

## 0.0.2-alpha.29

### Patch Changes

- [#143](https://github.com/nextlyhq/nextly/pull/143) [`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Extensible plugin platform — plugins are first-class, semver-protected extensions of a Nextly app, wired through a single `plugins` array in `defineConfig`.
  - **Plugin contract + SDK**: `definePlugin()` and the `plugins` array, with `@nextlyhq/plugin-sdk` as the stable, semver-protected authoring boundary (the packages stay `0.x` alpha; the SDK surface is held to the stability ladder). Boot-time dependency ordering via `dependsOn` / `optionalDependsOn`, version-range checks, and an `enabled` gate.
  - **Schema contributions**: plugins can contribute their own collections, singles, and components; `contributes.extend` adds fields to existing collections — both code-first AND UI-Builder–created ones — and cross-plugin relations resolve at boot. Plugin-owned fields carry provenance (`source`/`owner`/`locked`) and render locked + labelled in the Schema Builder so they can't be edited away.
  - **Permissions**: `contributes.permissions` registers custom permissions and role bundles that flow through the existing access-control checks.
  - **HTTP routes**: namespaced, secure-by-default plugin routes mounted under `/api/plugins/<name>/…`, with the same auth/CSRF guarantees as core routes.
  - **Admin UI contributions**: menu items, full pages, settings panels, custom views, and header/toolbar slots (show/hide defaults + inject components). Plugin admin component modules are auto-registered.
  - **Lifecycle events + filters**: an event bus plugins publish to and subscribe from, plus context filters they can transform — the basis for cache invalidation, side effects, and cross-plugin reactions.
  - **Custom field types, email providers/templates, and auth extensibility** (strategies + hooks) are all pluggable through the same contract.
  - **First-party + tooling**: ships `@nextlyhq/plugin-form-builder`, the `nextly add <package>` install-and-wire CLI command, and `create-nextly-app` plugin scaffolding.

## 0.0.2-alpha.28

## 0.0.2-alpha.27

### Patch Changes

- [#131](https://github.com/nextlyhq/nextly/pull/131) [`4f86e82`](https://github.com/nextlyhq/nextly/commit/4f86e82cfea10911fef89ecde14a8a42ec4f0397) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Stop collections from generating orphan Drizzle `.ts` schema files.

  Creating or updating a collection (via the admin UI or `nextly db:sync`) used to write a Drizzle `.ts` schema into `src/db/schemas/dynamic/` and maintain an `index.ts` barrel. Nothing imported these files: the runtime resolves each table's Drizzle schema from the `dynamic_collections` metadata via `generateRuntimeSchema`, exactly as singles and components already do (those never generated `.ts` files). The only consumer was the raw `drizzle-kit` binary via `merge-schemas` / `drizzle-kit-entry`, which requires a `drizzle.config.ts` that the framework's own commands never invoke. The generated files therefore drifted from the database and read as dead code.

  Collections now behave like singles and components: the data table is created, the field definitions are stored in `dynamic_collections`, an in-memory runtime schema is registered, and the SQL migration is still written to `src/db/migrations/dynamic/` (it remains the durable DDL applied by `nextly migrate`). No `.ts` schema file is written.

  Changes:
  - `CollectionFileManager`: replaced `saveArtifacts`/`saveUpdateArtifacts` with a migration-only `saveMigration`; removed `updateSchemaIndex`, `removeFromSchemaIndex`, and the disk-based `reloadSchema` hot-reload.
  - `CollectionMetadataService`: create/update/delete now persist only the SQL migration. The update path relies on the existing `registerRuntimeSchema` call to refresh the in-memory table, so no on-disk reload is needed.
  - Removed the now-unused `generateSchemaCode` Drizzle code generator from `DynamicCollectionSchemaService` and the `schemaCode`/`schemaFileName` fields from `CollectionArtifacts`.
  - `nextly db:sync --schemas` no longer writes Drizzle `.ts` files; the flag now only generates Zod validation schemas.

  Also removed the unused `NEXTLY_SKIP_SCHEMA_FILES` environment toggle (it was set nowhere and only gated the now-removed file writes).

- [#126](https://github.com/nextlyhq/nextly/pull/126) [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - parseMediaRoute had no case for the 'bulk' segment, so DELETE /api/media/bulk fell through to the single-item path and treated 'bulk' as a mediaId, causing a 404 from the database.

## 0.0.2-alpha.26

### Patch Changes

- [#123](https://github.com/nextlyhq/nextly/pull/123) [`6964718`](https://github.com/nextlyhq/nextly/commit/6964718c5d36dba4a337fbce1bf70a55c5554b1f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Single edit forms no longer ask for a title and slug. A Single is a one-instance document whose identity is fixed by its config (`label` + `slug`), but the admin previously rendered title and slug as editable, required inputs — forcing redundant input for values already determined by the definition.

  The single edit form now shows the title (from the single's `label`) and slug (from the configured `slug`) as read-only, non-editable fields, and submitting never errors on them. `EntrySystemHeader` and `EntryMetaStrip` gain opt-in `lockIdentity`/`lockSlug` flags (default off, so collection entry forms are unchanged); for singles the title/slug are seeded from config, the client validation for those two fields is relaxed, and slug auto-generation is disabled.

## 0.0.2-alpha.25

### Patch Changes

- [#121](https://github.com/nextlyhq/nextly/pull/121) [`8cc3a1c`](https://github.com/nextlyhq/nextly/commit/8cc3a1cccfce7bd0064d16f683022420b99f3fe8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fresh projects scaffolded with `pnpm create nextly-app` no longer fail to install under pnpm 11. pnpm 11 stopped reading the `pnpm` field from `package.json`, so the `pnpm.onlyBuiltDependencies` allowlist the scaffolder emitted was ignored: `pnpm install` aborted with `ERR_PNPM_IGNORED_BUILDS`, and past that `better-sqlite3` never compiled its native binding (SQLite scaffolds crashed at boot) while `sharp`, `esbuild`, and `unrs-resolver` were silently blocked.

  The scaffolder now writes the build-script allowlist to `pnpm-workspace.yaml` instead, emitting both `allowBuilds` (read by pnpm 11+) and `onlyBuiltDependencies` (read by pnpm 10.6+), and drops the now-dead `pnpm` field from the generated `package.json`. `better-sqlite3` is always allow-listed so the `--use-yalc` dev flow — which installs every adapter — builds it too. npm, yarn, and pnpm 9 run dependency build scripts by default and ignore the file, so it is harmless under those package managers.

## 0.0.2-alpha.24

### Patch Changes

- [#103](https://github.com/nextlyhq/nextly/pull/103) [`01f3f7a`](https://github.com/nextlyhq/nextly/commit/01f3f7a22eb2e85fb6987b43264c07e993872fa7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Forward `cc`/`bcc` consistently across every email send path.

  `nextly.email.send` and `nextly.email.sendWithTemplate` (Direct API) now accept and forward `cc`/`bcc` — they are added to `SendEmailArgs` and `SendTemplateEmailArgs`. Previously the Direct API namespace silently dropped both fields, so only the REST route (`/api/email/send-with-template`) honored them. `EmailService.sendWithTemplate` also dropped `cc`/`bcc` on its code-first template fallback branch while the DB-template branch already forwarded them; both branches now forward them. Empty `cc`/`bcc` arrays are not forwarded, so they don't override the "no options" path.

## 0.0.2-alpha.23

### Patch Changes

- [#101](https://github.com/nextlyhq/nextly/pull/101) [`7f7845b`](https://github.com/nextlyhq/nextly/commit/7f7845b5feeec3b30ed86ae459ef3d2347734cca) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix component CRUD breaking with a 500 after a dev-server config hot-reload.

  `reloadNextlyConfig` rebuilt the runtime Drizzle descriptors for `comp_*` data tables with the collection/single `generateRuntimeSchema`, which prepends `id`/`title`/`slug` base columns and omits the `_parent_id`/`_parent_table`/`_parent_field`/`_order` link columns that components use to reference their parent document. This overwrote the correct boot-time registration.

  After a hot-reload the bad descriptor no longer matched the physical table, so component reads (which filter by `_parent_id`) failed and were swallowed as "no rows", and component writes (which insert the `_parent_*` columns) were rejected by the database. Saving any Single or Collection document that embeds a component returned a 500.

  The reload path now builds `comp_*` descriptors with `ComponentSchemaService.generateRuntimeSchema`, matching the boot path and the physical `comp_*` table. Adds a regression test asserting the refreshed descriptor exposes the `_parent_*` link columns and not `title`/`slug`.

## 0.0.2-alpha.22

### Patch Changes

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`bdece5c`](https://github.com/nextlyhq/nextly/commit/bdece5c41872f0f9cb71b4fc43dca034fabdbfe5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix code-first / HMR schema applies wrongly dropping managed tables on SQLite & MySQL.

  On SQLite and MySQL, drizzle-kit's `pushSchema` ignores `tablesFilter` and introspects the whole database, so any managed table missing from the desired schema was flagged as a data-losing "orphan" DROP — failing the apply and offering the table as a spurious rename source. Three cases are fixed:
  - **Schema-events ledger (`nextly_schema_events`)** is now a first-class managed core table (declared in `getCoreSchema` / `getDialectTables` / `CORE_TABLE_NAMES`), so no schema path — apply, HMR, `migrate`, or `db:sync` — ever treats it as an orphan drop or offers it as a spurious rename target. To make it round-trip cleanly, the SQLite primary key gains an explicit `NOT NULL` (SQLite, unlike PG/MySQL, treats a bare `TEXT PRIMARY KEY` as nullable) and the SQLite partial unique index is dropped — drizzle-kit 0.31.10 cannot round-trip a SQLite partial index ([drizzle-team/drizzle-orm#4688](https://github.com/drizzle-team/drizzle-orm/issues/4688)), and keeping it churned `DROP/CREATE INDEX` on every push. Postgres keeps its partial unique index. The "one applied row per file" guarantee is now enforced in code on all dialects: an atomic conditional `markApplied` (sets `applied` only when no other applied row exists for the filename) plus the existing cross-process migrate lock.
  - **UI-created collections, singles, and components** are now preserved during a code-first HMR apply: every DB-registered resource is included in the desired schema (code-config entries take precedence), so adding a collection in code no longer drops resources created via the admin UI.
  - **Migration status**: a collection added in code after the initial DB setup is now marked `applied` once its table is created, instead of showing `pending` forever in the builder listing (mirrors the existing singles behaviour).

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`faf14cd`](https://github.com/nextlyhq/nextly/commit/faf14cdfe644e3c0ecdb84c691289d01e6c80010) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix fresh-database first-run aborting on MySQL.

  Now that `nextly_schema_events` is a core table, `freshPushSchema` creates it (and its indexes) during first-run setup. The setup then also replayed the out-of-band `getSchemaEventsDdl` unconditionally, and the MySQL raw DDL's `CREATE INDEX` has no `IF NOT EXISTS`, so it failed with a duplicate-index error and first-run reported failure on a fresh MySQL database. The out-of-band bootstrap is now guarded by a `tableExists` check (matching `nextly migrate`'s `ensureLedger`), so it only runs as a fallback when the ledger is genuinely missing.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`17f0353`](https://github.com/nextlyhq/nextly/commit/17f0353fb0d21086171278a6f9cbf0470e9775f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `nextly migrate:create` generating the wrong schema for components.

  The migration snapshot generator built component tables with the **collection** table-builder, so they came out with `slug`/`title` and were missing the component embedding columns (`_parent_id`, `_parent_table`, `_parent_field`, `_order`, `_component_type`). The generated snapshot then diverged from the real component table the apply pipeline creates, which made `nextly migrate:resolve --applied` fail its schema-match verification for any project with a component. Components now use `buildDesiredTableFromComponentFields`, matching the apply path.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`7f465db`](https://github.com/nextlyhq/nextly/commit/7f465db7721381a10c458fca6cc182164c0651a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `nextly migrate:create` omitting the component parent index, which broke `migrate:resolve --applied`.

  The apply pipeline always creates a composite index (`idx_<table>_parent` on `_parent_id`, `_parent_table`, `_parent_field`) for component tables, but the migration-snapshot builder did not emit it. So the live index looked like an unmanaged extra and `nextly migrate:resolve --applied` failed verification ("Live schema does not match the target snapshot") for any project with a component. The snapshot builder now emits the parent index, matching the apply pipeline.

- [#87](https://github.com/nextlyhq/nextly/pull/87) [`7cae340`](https://github.com/nextlyhq/nextly/commit/7cae34051c5739bfd9afa78bf9c901a6d934b8d4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix two `nextly_schema_events` ledger edge cases on the code-first schema path.
  - **Postgres index/default churn:** the ledger's raw bootstrap DDL declared `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, but the Drizzle def supplies the value app-side (`$defaultFn`) with no SQL default. Now that the ledger is a core table flowing through drizzle-kit's Postgres diff, that mismatch made every push/migrate emit `ALTER COLUMN started_at DROP DEFAULT`. The raw DDL now omits the redundant default (matching the MySQL/SQLite ledger DDL and the `id` column), so the ledger round-trips cleanly with no churn. Added a Postgres round-trip integration test alongside the existing SQLite one.
  - **`markApplied` race no-op:** when the "one applied row per file" guard blocked a concurrent second apply, the losing row was left dangling at `in_progress` and the caller still logged a success. `markApplied` now resolves the blocked row to `superseded` and returns whether it applied, and `nextly migrate` reports the file as already-applied-by-a-concurrent-run instead of a false success.

## 0.0.2-alpha.21

### Patch Changes

- [#84](https://github.com/nextlyhq/nextly/pull/84) [`0e17fc6`](https://github.com/nextlyhq/nextly/commit/0e17fc6c3b4863552380729d61f938049e15ca1e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Unified schema-migration pipeline with `ui-schema.json` dual-write.
  - **Migration CLI**: `migrate:create` / `migrate` / `migrate:check` / `migrate:status`, plus `migrate:down` for forward-resolved rollbacks (DOWN SQL generated at create time, renames preserved). A pooler-safe TTL migration lock replaces the session advisory lock that leaked through Neon's PgBouncer, and production deployments can run pending migrations on boot (`db.runMigrationsOnBoot` + `db.migrateLockTtlSeconds`).
  - **`ui-schema.json` dual-write**: the admin Schema Builder always applies changes to the dev database AND writes a committable `ui-schema.json` (the file-only mode is retired). The manifest is now a lossless record of every field option the builder/code-first can set — full validation (min/max length, pattern, etc.), per-field admin (width, description, placeholder…), `unique`, `index`, labels, the Draft/Published `status` flag (persisted from both the field-change and settings-only save paths), and polymorphic `relationTo` arrays (previously truncated to the first target). The `toggle` field type round-trips correctly.
  - **Correct column types**: `migrate:create` no longer flattens fields before diffing, so hasMany and polymorphic relationships emit `json` columns instead of a single `text` id column.
  - **Diffable index/unique migrations** (Postgres/MySQL/SQLite): field `unique`/`index`, single-relationship auto-indexes, and the system slug/created_at indexes are now diffed and emitted (`CREATE`/`DROP INDEX`) with live-DB introspection, down-migration support, and a backward-compat sentinel so pre-existing tables don't churn.
  - **Cleanup**: removed the unused `verification_tokens` table (a leftover from the retired Auth.js integration; custom auth uses `email_verification_tokens` and `password_reset_tokens`). `dev:reset` auto-detects the dialect from `DATABASE_URL`, and the ui-schema field-type set was widened to the full canonical list.

## 0.0.2-alpha.20

### Patch Changes

- [#63](https://github.com/nextlyhq/nextly/pull/63) [`f721539`](https://github.com/nextlyhq/nextly/commit/f721539a8ee9cccfcd179e1bc96de0863a160345) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Singles builder popup now auto-derives the slug as kebab-case to match the web convention used by public routes and the entry-form slug validator. Typing `About Page` as the singular name now fills the slug as `about-page` instead of `about_page`. Collections and components keep their existing snake_case defaults so their backend validators continue to accept the auto-generated value unchanged. The shared `BuilderSettingsModal` forwards the per-kind identifier to `BasicsTab`, where the slug-case helper is selected; a new `toKebabName` helper lives alongside `toSnakeName` in `@admin/lib/builder` for downstream consumers that need URL-friendly identifiers.

  `create-nextly-app` now resolves the published `@nextlyhq/ui` and `@nextlyhq/plugin-form-builder` versions from the npm registry alongside the other `@nextlyhq/*` packages it scaffolds. Generated `package.json` files pin both via their published semver range instead of falling back to `"latest"`, so fresh projects install the same versions the CLI was tested against.

## 0.0.2-alpha.19

### Patch Changes

- [#61](https://github.com/nextlyhq/nextly/pull/61) [`e2b4131`](https://github.com/nextlyhq/nextly/commit/e2b4131f63f4de10587772717d707a0a61ce62f9) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - Admin UI polish across the Entries forms, Schema Builder, sidebar, and global loaders.

  Field width is now respected end-to-end. `packFieldsIntoRows` no longer treats `group` as a block-only field, so groups participate in the same row-packing as regular fields and honour `admin.width` on both the builder canvas and the entry form. `FieldRow` adds a synthetic spacer column when a row's declared widths sum to less than 100% so partial-width fields keep their authored size instead of stretching to fill, and uses `items-start` so adjacent fields of different heights align cleanly. `NestedFieldGroup` in the schema builder uses the shared `packIntoRows` / `parseWidth` helpers to render nested children in the same row layout as the top-level canvas; `repeater` and `group` containers are forced to full width to stay readable. `ComponentRow` and `GroupInput` now delegate to `FieldRow` + `packFieldsIntoRows` instead of mapping each child through `FieldRenderer` directly, so nested component and group fields lay out consistently with the surrounding form. `pack-fields-into-rows` also guards against `undefined` / non-array `fields` input.

  Entries table no longer shows the `id` column by default. `getDefaultVisibleColumns` keeps `id` available in the column toggler but excludes it from the initial visible set, matching the rest of the admin's "title first" presentation.

  Schema Builder toolbar is now sticky. `BuilderToolbar` sticks to the top of the builder viewport (`sticky top-0 z-30`) with a solid background so it stays visible while scrolling long field lists; the collection / single / component builder pages were restructured to render the toolbar outside `PageContainer` so the sticky positioning has the correct scroll parent, and the container drops its bottom padding to remove the gap underneath.

  Sidebar no longer flashes the empty / unauthorised state during hydration. `DualSidebar` now treats `!isHydrated` as part of `hasPermissionDataPending` (alongside the existing permissions-loading / error checks), so menu groups render their loading skeletons until the router and permissions are both ready instead of briefly showing nothing.

  `PermissionGuard` loading state is replaced with a branded loader: a glassmorphic card with an ambient glow, the shared `Spinner`, and the Nextly brand mark animated via two new global keyframes (`brand-orbit`, `brand-pulse`) added to `globals.css`. A `?debug_loading=true` query param force-enables the loading view to make iteration on the loader easier. Auth setup / reset-password / user-management / email-provider secret-field inputs get small consistency tweaks alongside the same loader treatment.

## 0.0.2-alpha.18

### Patch Changes

- [#55](https://github.com/nextlyhq/nextly/pull/55) [`de3ec7e`](https://github.com/nextlyhq/nextly/commit/de3ec7e941eb3c7fc33df9dc403e0c5a5135c0b0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Three related singles / API consistency fixes.

  REST responses for collections previously included both snake_case (`created_at`, `updated_at`) and camelCase (`createdAt`, `updatedAt`) variants of the system timestamp fields. The conversion helper added the camelCase aliases but never removed the snake_case originals, so list and detail endpoints surfaced duplicate keys per row. The snake-to-camel conversion now lives in a single helper, `convertTimestampsToCamelCase`, exported from `shared/lib/case-conversion.ts` next to the existing `keysToCamelCase` / `keysToSnakeCase` utilities. Both `collection-query-service` and the singles `deserializeJsonFields` path call it directly. The previous `withTimestampAliases` wrapper and its re-export from `domains/collections/index.ts` are removed. Collections responses now match singles / media / users / api-keys / uploads, which already emitted the camelCase form only.

  The admin sidebar's singles list now renders every single in the project rather than capping at the `useSingles()` default page size of 10. `DynamicSingleNav` drives a `useInfiniteQuery` against the singles endpoint and walks subsequent pages while `meta.hasNext` is true. Each request is bounded to 100 rows so per-request DB load stays small. Secondary consumers that derive visibility or grouping data from the singles list (`DualSidebar`, `DynamicCustomGroupNav`, `SinglesLandingRedirect`) now pass an explicit `pageSize: 100` to `useSingles`, matching the pattern already used by the collections sidebar fetch. This stops the same truncation symptom from hiding section headers or misrouting the `/admin/singles` landing redirect when the project has more than 10 singles.

  The `GET /admin/api/singles` handler now accepts a 1-based `page` query parameter as an alternative to `offset`. The admin UI's shared `buildQuery` helper emits `page` for every paginated route; previously the singles endpoint read only `offset`, so a page change in the Singles builder table left the offset at 0 and the same first page was returned for every navigation. When both `offset` and `page` are supplied `offset` wins, preserving the existing external API contract.

## 0.0.2-alpha.17

### Patch Changes

- [#56](https://github.com/nextlyhq/nextly/pull/56) [`4d7b4f7`](https://github.com/nextlyhq/nextly/commit/4d7b4f76a4a697fd98b7f98e784179a3fe100c8f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix the schema-apply pipeline silently skipping column type changes on Postgres, leaving the live DB permanently drifted while the journal still recorded the apply as successful.

  **The bug, end-to-end.** When a Builder field was reclassified from a text-like type (`text`, `richText`, `textarea`) to a JSON-backed type (`group`, `repeater`, `blocks`, `json`, `chips`, `point`), the diff engine produced a `change_column_type` operation (`text` → `jsonb` on Postgres). That op type was not in the fast in-memory DDL emitter's allow-list, so the pipeline fell back to `drizzle-kit`'s `pushSchema`. `pushSchema` considers `text` → `jsonb` a non-implicit cast and, in programmatic (non-TTY) mode, omits the `ALTER COLUMN … SET DATA TYPE` statement from `statementsToExecute`, returning the omission only in `warnings`. The pipeline ran the (now-empty or partial) statement list, hit no error, and the migration journal recorded `status='success'`. The next preview compared the live `text` column to the desired `jsonb` token from `field-column-descriptor` and re-detected the same drift — forever. A site running on Neon (rext-site-v2 / `dc_case_studies`) ended up with 10 columns stuck on `text` after three "successful" UI applies on 2026-05-20.

  **The fix.** Four complementary changes in `domains/schema/pipeline/`:
  1. The fast in-memory DDL emitter now owns `change_column_type`, `change_column_nullable`, and `change_column_default` on Postgres. `change_column_type` emits `ALTER TABLE … ALTER COLUMN … SET DATA TYPE <toType> USING "<col>"::<toType>` — the explicit `USING` cast covers the cross-family transitions that Postgres refuses to do implicitly (including the `text` → `jsonb` case), and Postgres errors loudly at execution when no registered cast exists between the source and target types. `change_column_nullable` emits `SET NOT NULL` / `DROP NOT NULL` per the `toNullable` value. `change_column_default` emits `SET DEFAULT <expr>` (raw expression, owned by `build-from-fields`) or `DROP DEFAULT` when `toDefault === undefined`. The three op types are added to `FAST_PATH_OP_TYPES` so they never reach drizzle-kit on Postgres again.
  2. The code-first SQL template at `sql-templates/postgres.ts` (consumed by `nextly migrate:create`) now emits the same `USING "<col>"::<toType>` clause for `change_column_type`. Without this, code-first projects on Postgres would have produced a `.sql` file in the repo whose `ALTER COLUMN … TYPE jsonb` failed at `nextly migrate` apply time in CI — the same drift loop as the Builder UI path, just deferred to migration-apply time. Both consumer surfaces (the apply pipeline and the migration-file generator) now share the same `USING` contract.
  3. Empty op lists on Postgres now also take the fast path (which emits nothing) instead of falling through to drizzle-kit. Letting drizzle-kit handle a "no ops" apply meant it ran its own catalog re-introspection and rename heuristics against the full live DB, and emitted destructive DDL that the diff engine had explicitly decided was not needed. The textarea→richText regression on rext-site-v2 / `test_verify_fix` surfaced this: both field types map to a `text` column on Postgres, so the diff produced zero column-level ops, but the slow path then attempted `DROP INDEX "single_pricings_pkey"` for an unrelated managed table, which Postgres rejects because a primary-key index cannot be dropped directly. Trusting our own diff for "no DDL is needed" closes that surface entirely.
  4. A safety net for the slow path (MySQL / SQLite, where the in-memory emitter does not apply, or any future op type that hasn't yet been added to the fast path). After `kit.pushSchema(...)` returns, the pipeline now inspects `pushResult.warnings`; when drizzle-kit declined any statement the apply throws a `PushSchemaError` carrying the warning text, so the journal correctly records a failed apply rather than a false success. Operators see the precise drizzle-kit message instead of an invisible silent skip, and the next apply will not re-detect the same phantom drift.

  Affected sites running on a published `0.0.2-alpha.0` … `0.0.2-alpha.16` still need a one-time `ALTER TABLE … ALTER COLUMN … SET DATA TYPE jsonb USING …` to relabel columns that were created as `text` during the silent-skip window; the fix prevents NEW drift but does not retroactively repair existing tables (running an Apply through the Builder after upgrading does the relabel automatically). Unit tests cover the three new emitter cases (including identifier-quoting through the `USING` clause), the routing-eligibility decisions for each (including the empty-ops case), and the safety-net throw path with a representative drizzle-kit warning payload.

## 0.0.2-alpha.16

### Patch Changes

- [#52](https://github.com/nextlyhq/nextly/pull/52) [`9bc10b6`](https://github.com/nextlyhq/nextly/commit/9bc10b6b548974a1e4c49ed4c9ec1e0902536f37) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix `update operation failed on table '<table>': value.toISOString is not a function` when saving a Single document or a component instance that includes a date field. JSON request bodies deliver date values as ISO strings (e.g. `"2026-05-20T12:22:29.417Z"`), but Drizzle binds `timestamp` columns by calling `.toISOString()` on the bound value -- so an unmodified string travelling through the adapter blows up at the driver layer. `CollectionMutationService` already coerced date strings into `Date` objects inline at every write site, but the equivalent step was missing from `SingleMutationService.update` and from `ComponentMutationService.serializeComponentRow` (which feeds every insert / update path in the component service via `buildInsertRow` and direct calls).

  A new `coerceDateFieldsToDate(data, fields)` helper in `shared/lib/field-transform.ts` mutates the row in place, converting string values for `field.type === "date"` columns into `Date` objects. Existing `Date`, `null`, and `undefined` values pass through untouched, so the function is idempotent and safe to call on rows that were coerced upstream. The signature accepts a structural `ReadonlyArray<{ name?: string; type?: string }>` so the same helper covers both `FieldConfig[]` (singles, components) and the runtime `FieldDefinition[]` (collections). The helper is wired into `single-mutation-service.update` before snake-casing the row and into `component-mutation-service.serializeComponentRow` before column mapping. The six inline copies of the same coercion block in `collection-mutation-service.ts` were collapsed onto the shared helper as part of the same change so there is one implementation across all three domains. Result: PATCH `/admin/api/singles/<slug>` with a `date` field, inserts / updates on components with date fields, and the existing collection flows that already worked all succeed against Postgres, MySQL, and SQLite. Unit tests cover the helper's coercion, idempotency, null / undefined pass-through, and no-touch behaviour for non-date fields.

## 0.0.2-alpha.15

### Patch Changes

- [#51](https://github.com/nextlyhq/nextly/pull/51) [`ab23486`](https://github.com/nextlyhq/nextly/commit/ab234866888691751f6baa7738a854624f86dbbd) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix users created through the admin "Create user" page being unable to sign in, and clear up the misleading checkbox that caused the silent failure in the first place.

  The form's submit handler in `packages/admin/src/pages/dashboard/users/create.tsx` collected the "Active Account" checkbox value into `values.active` but never forwarded it to the API, so the backend always saw `isActive` as `undefined` and fell back to its default of `false`. `verify-credentials.ts` rejects inactive accounts at every login leg, so the newly-created user could authenticate with the right password and still see a generic "invalid credentials" error. The submit handler now sends `isActive: values.active ?? true`, matching the checkbox's documented "Default: Yes" UX. The backend default of `false` is intentionally preserved -- it is load-bearing for self-registration via `/auth/register`, where `auth-service.verifyEmail` is what flips `isActive` to `true` and gates login on proof of email ownership.

  The companion checkbox was also reworked. It was labeled "Send Welcome Email" with help text "Send an email with login credentials after account creation", but it actually sets `emailVerified: null` and dispatches a _verification_ email -- the user could not sign in until they clicked the link. Combined with the form's "Active: Yes" default, that meant the out-of-the-box "create user" flow promised immediate login but silently delivered the opposite. The form field is now named `requireEmailVerification`, the label is "Require Email Verification", the help text is honest about the verification gate, the default is unchecked (so the form's "Active + immediate login" promise holds end-to-end), the checkbox is disabled when the account is inactive (verification is meaningless for a disabled account), and an inline note surfaces when both flags are on so the admin understands login is still gated until the verification link is clicked. The wire shape is unchanged -- `requireEmailVerification` maps onto the historical `sendWelcomeEmail` field at submit time so existing API consumers keep working.

## 0.0.2-alpha.14

### Patch Changes

- [#49](https://github.com/nextlyhq/nextly/pull/49) [`ea7fbe5`](https://github.com/nextlyhq/nextly/commit/ea7fbe5d2b0071304db50a8da835a91dd90a94ed) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix two related admin-auth failures that surface on hosted databases (Neon, Supabase, PlanetScale, etc.) during transient DB hiccups.

  **Login/setup fluctuation.** The `getUserCount` dependency in the auth handler bridge used to swallow any DB error and return `0`, which made `GET /auth/setup-status` reply `{ isSetup: false }` whenever a pool cold-start, brief disconnect, or failover landed on this endpoint — the admin route guards then redirected the user to `/admin/setup`, the next call returned `{ isSetup: true }` once the DB recovered, and the guards redirected back to `/admin/login`, oscillating until the next hiccup or full page reload. The user count is the bootstrap-gate for two security-relevant decisions (setup-status reporting and the first-admin pre-check), and treating an unknown count as zero also opened a window where a transient DB failure during `POST /auth/setup` could allow a second super-admin to be created while the real first user was briefly invisible to the query. `getUserCount` now propagates errors; `handleSetupStatus` and `handleSetup` catch them, emit a canonical `503 SERVICE_UNAVAILABLE` envelope through the shared `buildAuthErrorResponse` helper (`application/problem+json` + `x-request-id`), and log a structured operator event (`setup-status-failed` / `setup-precheck-failed`). The admin's `PrivateRoute` and `PublicRoute` now consume a shared `lib/auth/setup-status.ts` module that fail-safes to "setup complete" on any failure (network error, 5xx, invalid response shape) — staying on the dashboard or login screen is recoverable on the next request, whereas dragging an authenticated user into the setup wizard is destructive. `useCurrentUserPermissions` is gated by `routeType === "private"` so its `refetchOnWindowFocus` cannot fire `/me/permissions` during a brief Suspense window on a public route.

  **Intermittent logout around the access-token TTL boundary.** The same swallow-and-return-null pattern lived in `findUserById`, which the refresh handler called after deleting the old refresh token. A momentary DB hiccup at the 15-minute boundary returned `null` from the lookup, the handler interpreted that as "user is gone" and ran `clearAndDeny` — clearing both auth cookies and revoking the still-valid session. `findUserById` now propagates errors; `handleRefresh` was reordered so all read-only lookups (`findUserById`, `fetchRoleIds`, `fetchCustomFields`) run BEFORE the destructive `deleteRefreshToken`, and is wrapped in a try/catch that returns `503 SERVICE_UNAVAILABLE` on any DB failure with cookies and tokens intact — the client retries on the next request and the session survives. The admin's `refreshAccessToken` was a boolean primitive that treated every non-200 response (5xx, network errors, our new 503) as "session invalid" and redirected to login; it now returns a tri-state (`ok` / `auth_failed` / `transient`) so `authFetch` only redirects on a genuine 401 from `/auth/refresh` and surfaces transient server errors to the caller without logging the user out.

  Internal: consolidated four identical `build{Login,Register,Forgot,Setup}ErrorResponse` helpers into a single `buildAuthErrorResponse` in `handler-utils.ts`, fixed a long-standing `change-password` test mock missing `auditLog`/`trustProxy`/`trustedProxyIps`, and added regression tests covering the 503 path on both setup endpoints, the refresh-handler 503 path (asserting no cookie clearing and no token deletion), and the "no super-admin is created when the pre-check throws" security invariant.

## 0.0.2-alpha.13

### Patch Changes

- [#46](https://github.com/nextlyhq/nextly/pull/46) [`f943cb3`](https://github.com/nextlyhq/nextly/commit/f943cb32b94dffedf98a7e922f3c44338c042782) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Unified upload validation across both upload paths. `/api/media` now applies the same filename hygiene, extension blocklist, MIME allowlist, magic-byte sniff, and SVG sanitization that `/admin/api/collections/[slug]/uploads` already had — previously the global Media endpoint accepted any MIME type and any byte content up to 10MB with no sanitization. Validation logic is extracted into `services/upload-validation/`, both `UploadService` and `MediaService` call its `validateAndSanitizeUpload` entrypoint, and every validation failure now throws `NextlyError.validation` with a stable machine code (`FILENAME_INVALID`, `EXTENSION_BLOCKED`, `MIME_BLOCKED`, `MIME_NOT_ALLOWED`, `SIZE_EXCEEDED`, `MAGIC_BYTE_MISMATCH`, `SVG_SANITIZATION_FAILED`, `UNSUPPORTED_FOR_BACKEND`). The SVG sanitizer is tightened from `USE_PROFILES: { svg, svgFilters }` alone to explicit `FORBID_TAGS` (`foreignObject`, `animate*`, `image`, `iframe`, `object`, `embed`, `audio`, `video`, `source`, `track`, `style`) plus `FORBID_ATTR` (event handlers, `formaction`, `xlink:show`/`actuate`) and an `uponSanitizeAttribute` hook that strips any `href`/`xlink:href` whose value isn't fragment-only (`#id`). DOCTYPE declarations are stripped before sanitization to defang XML billion-laughs entity expansion, and a 2MB SVG-specific size cap is enforced separately from the general per-file limit. The magic-byte check closes a real polyglot bypass: claiming `image/svg+xml` with non-SVG bytes (or claiming a non-SVG type with XML bytes) is now rejected before the sanitizer runs.

  Breaking: `UploadService.upload()` now throws `NextlyError.validation` on validation failures instead of returning `{ success: false, errors, … }` — storage-layer 5xx failures still return the result-shape. `/api/media` rejects files outside the default MIME allowlist (override via `security.uploads.allowedMimeTypes` or `additionalMimeTypes`). SVG uploads with `<foreignObject>`, external `href`, animations, `<style>` blocks, or `data:` URIs will have those elements stripped — sanitized output may differ from input. `@nextlyhq/storage-vercel-blob` now supports SVG uploads (previously refused). The adapter returns Vercel Blob's `downloadUrl` (the file URL with `?download=1` appended) when the upload requests `contentDisposition: "attachment"`, so direct top-level navigation forces an attachment download while `<img src>` rendering remains unaffected. HTML uploads continue to be rejected with `NextlyError.validation` (code `UNSUPPORTED_FOR_BACKEND`, HTTP 415) — they're unsafe to host on a shared blob CDN regardless of disposition. `storage-local` cannot set per-file headers via Next.js static serving; sanitization still runs so stored bytes are safe, but self-hosters who want strict response headers should serve through a CDN with a response-header policy.

  A new structured event `nextly.upload.rejected` is emitted on every validation failure with `{ code, route, mimeType, filename, size }` so operators can alert on attack-pattern spikes (sudden bursts of `MAGIC_BYTE_MISMATCH` or `EXTENSION_BLOCKED` indicate polyglot probing).

  Build/dependency: the `pnpm.overrides` block now bumps `undici` to `^7` to fix a pre-existing latent runtime bug — `jsdom@28` (a transitive dep of `isomorphic-dompurify`) requires `undici@7+`'s `lib/handler/wrap-handler.js`, but the workspace was resolving `undici@6.25.0`. Any SVG upload through the existing pipeline would have crashed in production; no test exercised that path so it was undetected.

## 0.0.2-alpha.12

### Patch Changes

- [#43](https://github.com/nextlyhq/nextly/pull/43) [`bbecc0d`](https://github.com/nextlyhq/nextly/commit/bbecc0d6eb91d751d49e5a4f892300d6928be015) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fresh projects scaffolded with `pnpm create nextly-app` no longer crash at boot under pnpm 10+. pnpm 10 blocks dependency install scripts by default, and without an allowlist `better-sqlite3` never built its native binding, so SQLite scaffolds threw `Could not locate the bindings file` on the first admin request. `sharp`, `esbuild`, and `unrs-resolver` were silently blocked too, producing a slow JS image fallback, drizzle-kit slowness, and an eslint resolver warning respectively. The scaffolder now emits `pnpm.onlyBuiltDependencies` in the generated `package.json`: `sharp`, `esbuild`, and `unrs-resolver` always, plus `better-sqlite3` when the SQLite adapter is selected. npm, yarn, and bun ignore the `pnpm`-namespaced field, so it is harmless under those package managers.

## 0.0.2-alpha.11

### Patch Changes

- [#41](https://github.com/nextlyhq/nextly/pull/41) [`50151bc`](https://github.com/nextlyhq/nextly/commit/50151bc2f056ab474010ebf1e8d62b5973b0554a) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix drizzle-kit rename TUI ("Is `dc_posts` table created or renamed from another table?") firing on SQLite and MySQL after the schema-apply scope-reduction landed. The scope-reduction filter iterated by managed-table names and stripped the static system tables that `buildDrizzleSchema` injects so drizzle-kit's diff recognises them. On SQLite/MySQL drizzle-kit ignores `tablesFilter`, so the missing system tables looked like drops, paired with the managed adds, and produced the rename TUI on every fresh-install boot — crashing Next.js's non-TTY server thread. The scope-reduction filter now preserves non-managed entries via `!isManagedTable(name)`, restoring the injection's intended effect on every dialect.

## 0.0.2-alpha.10

### Patch Changes

- [#38](https://github.com/nextlyhq/nextly/pull/38) [`04da3a7`](https://github.com/nextlyhq/nextly/commit/04da3a7fdcc7ec197f05bdd49c853ee92e39a4b5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix: variant URLs in populated `media.sizes[*].url` are now absolutized too. The initial absolutization pass only rewrote the top-level `url` and `thumbnailUrl` fields, so on SQLite — which stores `media.sizes` as TEXT and returns the column as an unparsed JSON string — clients consuming `getMediaVariant(media, "card")` on populated entries still received relative `/uploads/...` paths. `absolutizeMediaUrls` now normalises string-encoded sizes into an object before rewriting variant URLs, so populated media on entry responses returns reachable variant URLs across every dialect. Unparseable JSON resolves to `null` rather than leaking the raw string to the API consumer.

  Also: `toAbsoluteMediaUrl` and `absolutizeMediaUrls` resolve `baseUrl` lazily — the env-backed default fires only when a relative URL actually needs prefixing. Pass-through cases (absolute URLs, null/undefined/empty) no longer touch the env proxy, so the "absolute URLs unchanged" contract holds in contexts that have not booted env validation (isolated tests, bundler-time analysis).

## 0.0.2-alpha.9

### Patch Changes

- [#36](https://github.com/nextlyhq/nextly/pull/36) [`10479d0`](https://github.com/nextlyhq/nextly/commit/10479d0a617759504c1f805170e4dae9dd65bced) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Media URLs returned from the API are now absolute. Previously, the local storage adapter wrote `/uploads/...` paths and surfaced them verbatim in API responses — mobile clients, edge workers, and any consumer without the deployment's origin baked in could not resolve the URL. Now, `MediaService` responses, populated `media` relations on entry responses, and the collection upload handlers (`POST` / `GET /admin/api/collections/<slug>/uploads`) prefix relative URLs with `NEXT_PUBLIC_APP_URL` (priority: `emailConfig.baseUrl` override > `NEXT_PUBLIC_APP_URL` > `http://localhost:3000` in dev). Cloud-adapter URLs (S3, Vercel Blob, R2) are already absolute and pass through unchanged. Consumers that previously concatenated the base URL themselves should drop the prefix — double-prefix detection is in place, but the new behaviour means the prefix is no longer needed. The env schema already requires `NEXT_PUBLIC_APP_URL` in production, so the localhost fallback is only reachable in development.

  Internal: extracted a shared `getBaseUrl(override?)` helper at `src/shared/lib/get-base-url.ts` so the email service and the new media-absolutization path resolve through one priority chain. `EmailService.getBaseUrl` and the new `getMediaBaseUrl` both delegate to it.

## 0.0.2-alpha.8

### Patch Changes

- [#34](https://github.com/nextlyhq/nextly/pull/34) [`a5d2af6`](https://github.com/nextlyhq/nextly/commit/a5d2af6f065f8ba03da0e05a69e1b328339fa698) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix severe Builder slowness and connection-pool exhaustion when running Nextly against Neon Postgres, and complete the code-first column-delete workflow. Adapter now wires the provider's declared `statementTimeoutMs` into `pg.Pool` (Neon's 30s default was previously ignored, letting stuck queries pin pool slots forever) and bumps Node 20+'s 250 ms Happy Eyeballs per-address timeout floor to 5 s on first connect so transcontinental Neon endpoints stop surfacing `ETIMEDOUT` after exhausting every resolved address. `DB_POOL_MAX`/`MIN`/`IDLE_TIMEOUT`/`QUERY_TIMEOUT` env vars were always documented but never plumbed into the factory — they now flow through with per-field `??` fallback so each value can fall back to the adapter's dialect-specific defaults (notably the PG adapter's `min: 0` for Neon auto-suspend recovery). Boot/HMR drift-check now uses bounded concurrency (3 workers) instead of unbounded `Promise.all` that saturated a Neon pool of 5 with 10+ collections. HMR `serverComponentChanges` events get a 300 ms trailing debounce so editor burst-saves stop firing a full pipeline per save. A short-lived live-snapshot cache deduplicates the two `introspectLiveSnapshot` calls that previously fired during a single Builder apply, and a missing `instrumentation.ts` warning surfaces in dev to nudge users toward the single-worker warmup pattern. A new fast in-memory DDL emitter on PostgreSQL bypasses drizzle-kit's ~10 s catalog re-introspection for the common Builder op set (`add_column`, `add_table`), and even on the slow-path fallback the pushSchema call is now scoped to only the table(s) actually touched by the resolved ops rather than every managed table. `filterUnsafeStatements` also blocks orphan `DROP SEQUENCE` / `DROP INDEX` whose inferred owner table is not in the desired schema. A new diff-time default normaliser collapses Postgres's redundant `::<type>` cast suffix (e.g. `'draft'::character varying`) and lowercases `now()` so the diff stops emitting phantom `change_column_default` ops for every system column on every apply; a long-standing descriptor drift between `runtime-schema-generator` and `field-column-descriptor` (status `text` vs `varchar`, missing `now()` defaults on `created_at`/`updated_at`) is also fixed so the new fast path actually triggers in the real Builder flow. End-to-end on a real Neon instance: Builder Save HTTP timing drops from ~11 s to ~5 s and the in-pipeline schema apply drops from ~10 s to ~1.4 s. Code-first column deletes now flow through a new `destructive_drop` `ClassifierEvent` that the `ClackTerminalPromptDispatcher` renders as a `Drop "<column>" from "<table>"?` confirm in the dev terminal — removing a field from `nextly.config.ts` and saving prompts you to confirm before destroying data, matching Drizzle Kit's `push` UX; `NEXTLY_ALLOW_CODE_FIRST_DROPS=1` auto-confirms every drop without prompting for CI/non-interactive workflows. Finally, the API Playground response viewer no longer crashes with "Unrecognized extension value" — the admin bundle was loading two copies of `@codemirror/state` (6.5.3 + 6.6.0) which broke `instanceof Extension`; a `pnpm.overrides` pin forces a single resolution.

## 0.0.2-alpha.7

### Patch Changes

- [#32](https://github.com/nextlyhq/nextly/pull/32) [`e41725d`](https://github.com/nextlyhq/nextly/commit/e41725d63a11255392bd5534f3b1f6d89d8276b4) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Internal refactor: consolidate the `packages/nextly/src/services/auth/` shim layer. The shim was a directory of one-line `export *` re-exports left over from an earlier reorganisation; the canonical code already lived in `packages/nextly/src/domains/auth/services/`. The shim directory has been removed and 29 internal call sites have been pointed at the canonical location. A duplicate test suite of 13 files (mechanical-path-only drift, no logic divergence) has been deleted in favour of the existing copies under `domains/auth/__tests__/`. A new `@nextly/domains/*` TypeScript path alias is added to match the existing `@nextly/services/*` / `@nextly/auth/*` pattern. No public exports, runtime behaviour, or wire-format changes; this is shipped as a patch because every package version moves together in the alpha train.

- [#30](https://github.com/nextlyhq/nextly/pull/30) [`bd92f1b`](https://github.com/nextlyhq/nextly/commit/bd92f1b31df5efcc36da9458af4787fe2ed0f348) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `create-nextly-app` now prompts for a folder name when none is given on the command line. Previously, running `npx create-nextly-app` with no positional argument was silently treated as "install in the current directory" and then aborted with a `Directory not empty` error once the user finished the template and database prompts. The CLI now asks `What should your project be called?` with `my-nextly-app` pre-filled. You can accept the default with Enter, type any folder name, or type `.` (or `./`) to install in the current directory, matching the way the positional argument already worked. When the chosen target directory is non-empty the CLI now offers a three-option recovery prompt (cancel, remove existing files and continue, or ignore files and continue) instead of aborting outright. The `remove` option preserves any `.git` directory so existing history is kept.

  Note for scripted or CI use: the no-argument form is no longer equivalent to `npx create-nextly-app .`; it now opens an interactive prompt. If you were relying on the previous behavior in a non-interactive environment, pass `.` (or any folder name) explicitly.

## 0.0.2-alpha.6

### Patch Changes

- [#28](https://github.com/nextlyhq/nextly/pull/28) [`338b668`](https://github.com/nextlyhq/nextly/commit/338b6685d462fadca2030c27075452b3ecefc12e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Fix `Cannot find package '@nextlyhq/plugin-form-builder'` on `pnpm dev` for blank scaffolds. The base admin page (`templates/base/src/app/admin/[[...params]]/page.tsx`) and the existing-project admin generator both hard-coded three side-effect imports for `@nextlyhq/plugin-form-builder`, but the package was only added to `package.json` on the fresh-scaffold npm path. Blank scaffolds and existing-project installs got the imports without the dep, so `next dev` failed at module resolution. The plugin is now opt-in per template: blank ships a plugin-less admin page; the blog template overlays a blog-specific admin page that re-adds the imports (mirroring how `formBuilderPlugin` is registered only in the blog config). `generatePackageJson` and the yalc paths in `installDependencies` accept a `projectType` and only include `@nextlyhq/plugin-form-builder` when the selected template uses it.

## 0.0.2-alpha.5

### Patch Changes

- [#26](https://github.com/nextlyhq/nextly/pull/26) [`fc88dc2`](https://github.com/nextlyhq/nextly/commit/fc88dc28206b212ffa20bbfac95e36bebaeabeb6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Collection mutation paths now resolve the physical table through `collection.tableName`, honoring `dbName` overrides instead of always deriving the name from the slug. The code-first boot sync detects when a collection's resolved `tableName` differs from the row in `dynamic_collections`, renames the physical table (Postgres/SQLite/MySQL quoted `ALTER TABLE ... RENAME TO`), writes the new name back, and invalidates the cached Drizzle schema in `CollectionFileManager` so the next request rebuilds against the renamed table — previously a `dbName` change left CRUD pointing at the stale table until a server restart. When both the old and new physical tables exist, the rename is skipped with a warn so the user can resolve the conflict manually. Component runtime-schema refresh after a UI-driven create/update/apply now flows through the DI `SchemaRegistry` (with a typed fallback to the adapter's `tableResolver` for non-DI paths) and surfaces failures as warnings instead of swallowing them in a silent try/catch — the prior behavior left `comp_*` queries selecting pre-rename column names until restart. Generated timestamp columns (`createdAt`, `updatedAt`) now emit `withTimezone: false` / plain `TIMESTAMP` for Postgres, aligning behavior across SQLite, MySQL, and Postgres.

## 0.0.2-alpha.4

### Patch Changes

- [#23](https://github.com/nextlyhq/nextly/pull/23) [`af98b55`](https://github.com/nextlyhq/nextly/commit/af98b555c0cf4166320ebe61f7c1ecd6a261ed2d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Fix Single document fields appearing empty after a component-field rename. Schema-apply and external-schema-update handlers invalidated `["collections"]`, `["entries"]`, `["singles"]`, and `["components"]` — but Single document data lives under a separate `["single-documents"]` namespace (used by `useSingleDocument`), which was never invalidated. After a rename, `useSingleSchema` refetched with the new field name while `useSingleDocument` kept serving cached data keyed by the old name, so the form rendered `data[newName]` as `undefined` and the field appeared blank until a hard refresh. Collections were unaffected because `useEntry` lives under `["entries"]`, which was already in the invalidation list. The `["single-documents"]` key is now invalidated alongside the others. Also propagate the Draft/Published `status` flag through `buildFullDesiredSchema` for both collections and singles, mirroring the earlier preview-pipeline fix so the full-schema build path doesn't drop the column either.

## 0.0.2-alpha.3

### Patch Changes

- [#19](https://github.com/nextlyhq/nextly/pull/19) [`7f4d5d4`](https://github.com/nextlyhq/nextly/commit/7f4d5d4c74bddcb633e80c356a5638911e047edc) Thanks [@aqib-rx](https://github.com/aqib-rx)! - HTTP read endpoints now return entries/documents regardless of status by default. Previously, `GET /api/collections/<slug>/entries`, `GET /api/collections/<slug>/entries/<id>`, `GET /api/collections/<slug>/entries/count`, and `GET /api/singles/<slug>` defaulted to "published-only" and required `?status=all` to see drafts — confusing for the admin API Playground, which returned 404 for any status-enabled single or collection whose only document was still in draft. The new default is to return all records; pass `?status=published` (or `?status=draft`) to filter explicitly. The routes still require authentication, so this only affects callers that already have read permission.

## 0.0.2-alpha.2

### Patch Changes

- [#17](https://github.com/nextlyhq/nextly/pull/17) [`8e77998`](https://github.com/nextlyhq/nextly/commit/8e7799840dbacd5efb453401a5b9fdca52a27aa8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Fix UI Schema Builder silently dropping the Draft/Published `status` column when editing a collection or single. Saving a field change on a `status: true` entity used to surface a "Rename status → \<new field\>" option (selected by default) because `previewDesiredSchema` did not propagate the Draft/Published flag into the desired snapshot — confirming the dialog DROPped the column and every subsequent entry POST with `status: "published"` failed with `table dc_<slug> has no column named status`. The flag now flows through the preview/apply pipeline for both collections and singles, so the column survives edits.

## 0.0.2-alpha.1

### Patch Changes

- [#13](https://github.com/nextlyhq/nextly/pull/13) [`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Iterative alpha bump: clean stale @nextly/ in adapter descriptions; contributor bootstrap fix; first OIDC-published release.

## 0.0.2-alpha.0

### Patch Changes

- [#4](https://github.com/nextlyhq/nextly/pull/4) [`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Initial alpha release of Nextly — a TypeScript-first, Next.js-native CMS and app framework.

  All 12 packages publish at `0.0.2-alpha.0` in lockstep under the `alpha` dist-tag.

  **Highlights:**
  - **Core (`nextly`)** — REST + Direct API, RBAC, hooks, and the runtime engine. API key prefix is `nx_live_`.
  - **Admin (`@nextlyhq/admin`)** — Full-featured admin dashboard.
  - **UI (`@nextlyhq/ui`)** — Headless component primitives shared across packages and plugins.
  - **CLI (`create-nextly-app`)** — Project scaffolder with blog and blank templates, multi-DB picker, telemetry opt-out.
  - **Database adapters** — `@nextlyhq/adapter-postgres`, `@nextlyhq/adapter-mysql`, `@nextlyhq/adapter-sqlite`, plus the shared `@nextlyhq/adapter-drizzle` base.
  - **Storage adapters** — `@nextlyhq/storage-s3` (also R2 / MinIO / B2 / Wasabi), `@nextlyhq/storage-vercel-blob`, `@nextlyhq/storage-uploadthing`.
  - **Plugins (preview)** — `@nextlyhq/plugin-form-builder` for early exploration; public plugin APIs stabilize at the beta release.

  **Alpha caveats:** APIs may change before `1.0`. Pin exact versions in production.

  **Install:**

  ```bash
  pnpm create nextly-app@alpha my-app
  # or
  npx create-nextly-app@alpha my-app
  ```
