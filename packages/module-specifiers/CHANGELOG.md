# @nextlyhq/module-specifiers

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

- [#734](https://github.com/nextlyhq/nextly/pull/734) [`193d5ec`](https://github.com/nextlyhq/nextly/commit/193d5ecdda826cce47832026299242fefd5bfa29) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Advertise the Node range this project actually supports. Every package declared
  `>=20.0.0` while the repository requires `^20.19.0 || ^22.12.0 || >=24.0.0`, so
  installs on 20.6-20.18 or on 23.x succeeded without warning and failed later at
  runtime. Release preflight now derives the expected range from the root manifest
  and rejects a package that disagrees, so the two cannot drift apart again.

- [#722](https://github.com/nextlyhq/nextly/pull/722) [`696281d`](https://github.com/nextlyhq/nextly/commit/696281d123832fb1a4a39e4aaf7d27ed085e35a6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Field group instances now report their stored type through `nextly/field-group-type`, a new entry point that reads whichever spelling a document carries and writes the current one. The admin editor uses it, so content saved before and after the storage rename stays readable and selectable in both.

- [#725](https://github.com/nextlyhq/nextly/pull/725) [`73885c6`](https://github.com/nextlyhq/nextly/commit/73885c682f74612fef4fe62122dcacee33267d14) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The field-group storage migration can now report what it would rename without changing any content or recording that a run happened, and refuses to run for real unless the caller states that a restorable backup exists. A preview still claims the migration lock, so it needs a role that can write to Nextly's own lock table.

- [#730](https://github.com/nextlyhq/nextly/pull/730) [`6683ef3`](https://github.com/nextlyhq/nextly/commit/6683ef387595684355bba1e02c128f76df5624d6) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Plugin icons now resolve through one shared rule, so the same plugin shows the same icon everywhere in the admin, and a plugin can ship its own logo image instead of naming a built-in glyph.

  The SEO plugin now describes itself in the plugins list instead of showing a bare package name.

  A styling fixture used only by the end-to-end suite no longer appears as an installed plugin, and no longer injects a showcase section into the Posts collection list, in a normal development server.

- [#740](https://github.com/nextlyhq/nextly/pull/740) [`db7122d`](https://github.com/nextlyhq/nextly/commit/db7122d484e841a087827babcaff402c0711da0c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/plugin-sdk` now exports `pluginAdminSlug`, `PLUGIN_CATEGORIES` and `isPluginCategory` (experimental), so a plugin author can derive a plugin's admin slug and check a category against the vocabulary `definePlugin` accepts, rather than reimplementing either. They are also on `nextly` and `nextly/config` for host apps.

  The admin uses those exports instead of its own copies. It previously derived a plugin's URL slug with its own implementation of core's algorithm, so a plugin page could be linked at one slug and routed at another the moment either side changed, and it kept its own list of valid categories, so it could reject a category `definePlugin` accepts.

  Nothing changes in the admin UI. The plugin directory that consumes these is not built yet; this is the groundwork it needs.

- [#727](https://github.com/nextlyhq/nextly/pull/727) [`53fca3e`](https://github.com/nextlyhq/nextly/commit/53fca3e4fa89ec7c6f116f25f4b01263f6e6995d) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On desktop, the Plugins item in the admin sidebar now opens the plugins page when you click it, instead of only expanding the sub-sidebar and leaving you to find the page yourself. On mobile it still opens the panel, as every sidebar section with a panel does, and Installed Plugins is the first entry inside it. The item also stays visible when no plugins are installed, so a new project can reach the plugins page at all.

  Users who can read a plugin's collections but cannot manage settings keep the sub-sidebar, since the plugins page itself is settings-guarded.

  The secondary sidebar now closes when the category it is showing stops being one of the sidebar's destinations, so a slow or failing permissions load no longer leaves an empty panel open beside the page.

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

- [#731](https://github.com/nextlyhq/nextly/pull/731) [`298d41e`](https://github.com/nextlyhq/nextly/commit/298d41ee1efa2e800fa7ebc755d065930e5cf629) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Page builder inspector: keep the open panel tab in sync when the selected block changes type, so the inspector no longer shows a tab the block does not have.
