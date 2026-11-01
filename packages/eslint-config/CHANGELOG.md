# @nextlyhq/eslint-config

## 0.0.2-alpha.73

### Patch Changes

- [#3048](https://github.com/nextlyhq/nextly/pull/3048) [`61e4ebf`](https://github.com/nextlyhq/nextly/commit/61e4ebf3582517cecf900de34abfc32bfa4365cf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Schema Builder Single now keeps its registry row in a migration when a code-first collection shadows a Builder collection of the same slug. `nextly migrate:create` used to leave out the row of every Builder entity sharing a shadowed slug, of any kind, so the Single's settings change reached the snapshot but not a deployed registry.

  `nextly migrate --dry-run --step <n>` now also names a pending Schema Builder file with no snapshot that the step leaves out of the preview. A real run refuses such a file before applying anything, whatever `--step` says.

- [#2967](https://github.com/nextlyhq/nextly/pull/2967) [`ba98d35`](https://github.com/nextlyhq/nextly/commit/ba98d35d2ac1be94f45389fa16a934083530dc6e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A bulk or batch write is limited to the entries its access rule's filter matches, as a write to one entry is. A bulk update or delete by query changes only the entries the filter matches, and counts only those; an entry outside it is neither written nor named. A bulk update or delete by ids writes each entry the filter matches and fails each other one on its own: as a missing entry where the caller may not read it, and as refused where it may. A batch of updates or deletes in one transaction does the same for each item, and an item the caller may not read fails in the same words as one that does not exist. A by-ids bulk update that would move an entry out of the filter refuses that entry alone; inside a batch in one transaction, it refuses the whole batch, with nothing changed. The filter is matched in the default language, as the write to one entry matches it.

- [#3063](https://github.com/nextlyhq/nextly/pull/3063) [`8f1d6aa`](https://github.com/nextlyhq/nextly/commit/8f1d6aabb2eb1bd06b8fae8a810c122acc581166) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A collection field with a camelCase name, created or changed through the API
  or the Direct API, keeps its name, and its column is the snake_case form the
  write path uses (`metaTitle` → `meta_title`), as with code-first collections.
  Before, the name itself was lowercased on save (`metaTitle` became the field
  `metatitle`), so every write to the field as declared failed with "no column
  named meta_title".
  - Existing collections keep their fields where they are: an update sending a
    field that differs from a stored one only in case, or that names the same
    column, keeps the stored name, so a field stored lowercased keeps its
    column and values. Renaming such columns to the snake_case form is not done
    here.
  - Field names are checked by the column they become: two names that become
    one column (`metaTitle` and `meta_title`), a name whose column is a system
    column (`createdAt`), and a column longer than 63 characters are refused.
  - A camelCase field's `min`, `max` and `minLength` constraints are created on
    its column.
  - A collection created through the API or Direct API with camelCase field
    names is edited through the API: the Schema Builder refuses camelCase names,
    its own and in its manifest.

- [#3085](https://github.com/nextlyhq/nextly/pull/3085) [`2cd3af0`](https://github.com/nextlyhq/nextly/commit/2cd3af09a5635c443a9c7d50d1576f01adfab512) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card's common settings change on the card itself, and every card's menu offers the same four things.
  - **The quick popover**: a card's title, and Settings in its "…" menu, open a popover holding the card's Collection, the settings its widget marks quick (a period, such as Over time's Date range) and its Size, ending with "More settings", which opens the settings sheet. A change applies to the card at once, with the popover still open and the card beside it. Outside customise mode it is saved for that reader alone, and a toast says so and offers Undo, which puts back what the card had just before that change; the toast is the one place a screen reader hears it, and the dashboard's own announcement stays silent for it. In customise mode it is staged with the session's other changes until Save. Escape closes it, and focus goes back to the title or the menu it was opened from.
  - **Every card's menu at rest lists Settings, Size, Refresh and Remove**, in that order, each where the card has it. Size saves the card's width and height at once, with Undo, through the same layout write customise mode's Save makes. A reader following the default keeps a size they choose this way: the stored row now records which cards they resized, held to each widget's bounds, while every other card goes on following the size the default gives it. Rows written before this read as they always did, with no migration, and resetting the dashboard clears the sizes with the rest. Remove takes any card off at once, asking nothing, with Undo in the removal notice. For a reader following the default dashboard it is their own dismissal of the card, so they keep following the default; for a reader who has arranged their dashboard it takes the card out of their arrangement, so adding the widget again from the gallery meets no hidden copy, and Undo puts it back where it was, with its settings. The layout read now says which of the two a reader is (`arranged`). Before, only a card whose widget declared `dismissible` could be removed outside customise mode, with a dismiss button of its own; that button is gone, and `dismissible` is deprecated: it has no effect, is still accepted, and will be removed with the legacy definition fields. The customise menu now lists Settings and Size first, then the moves, then Remove.
  - **A widget may mark up to three settings `quick`**, where it could mark one. A declaration marking two or three, which startup refused, now starts; one marking four or more is still refused, with each named. The limit is published as `MAX_QUICK_SETTINGS` from `nextly/config`, beside `MAX_CHOSEN_FIELDS`, and the quick popover holds that many beside the card's Collection. The card's header draws the first marked setting it can draw.
  - **A dashboard write no longer re-asks every card.** Each read of the layout carries a read-ahead token of its own, and the cards' batch was asked again under every new one, so the layout read that follows a reader's own write (a quick setting, a size, a removal) asked every card on the dashboard again for one card's change. The batch now takes a fresh layout answer's token only when that answer hides or reveals a card, so a write asks again only the card it changed, and a fresh read that reveals a card still has the batch asked for it once.
  - **Entering customise mode takes a card's Undo toast down**, so an Undo pressed after customising began no longer writes underneath the open draft.

- [#3109](https://github.com/nextlyhq/nextly/pull/3109) [`dc6ff76`](https://github.com/nextlyhq/nextly/commit/dc6ff762aa76e3015cdc32f82c93c708ba9eee63) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card's quick changes hold up in three cases they did not.
  - **A size a reader chose stays theirs when the default catches up.** A reader following the default who resized a card kept that size only while it differed from the default's, so once a later release gave the widget's default that same size, the next unrelated change outside customise mode (a setting, or removing another card) forgot the size was theirs, and a later change to the default moved their card. A chosen size now stays chosen while a write leaves it as stored, including for a card the row holds under an id an earlier default gave it; resizing the card, back to the default's size or to any other, is what gives it up or replaces it.
  - **A quick change is always said, with its Undo.** When the card's new answer arrived before the save reported landing, the toast that says the change, and offers Undo, never appeared. It now does, as soon as the save lands, judged by the card's own answer, so a card on a dashboard large enough to be asked in several requests is said too. A change whose new answer was refused is still said as saved but not shown.
  - **Removing a card takes its Undo toast down.** Removing a card within the ten seconds its last quick change's toast stays left that toast, and its Undo, on screen; pressing Undo could write the removed card's earlier setting or size back. The toast now goes with the card, and an Undo pressed after it does nothing.

- [#3136](https://github.com/nextlyhq/nextly/pull/3136) [`427cd05`](https://github.com/nextlyhq/nextly/commit/427cd05e92ec3d2ed181737c1263e120c55015af) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card no longer brings the settings panel's loading screen or the form label check with it. Each card only starts fetching its settings panel and asks whether the admin runs in development, so a page that draws cards without opening their settings, such as the development widget preview page, loads less. Nothing looks or works differently.

- [#2917](https://github.com/nextlyhq/nextly/pull/2917) [`1e04032`](https://github.com/nextlyhq/nextly/commit/1e04032f8a9d454817ce891631f306f446eada0c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A collection something depends on can no longer be deleted. While a field of another collection, a Single or a field group points at it, a foreign key a plugin or the app declares points at its table, or a plugin or the app has added a column, index, foreign key or check to one of its tables, the Schema Builder's delete, the schema API, `nextly prune --force` and `migrate:create` refuse before anything is removed, naming each with its owner and table and saying what to do. Where those cannot be read the delete is refused rather than going ahead. A Builder bulk delete is now one request checked as a whole, so collections that point only at one another can be deleted together; deleting each alone is refused. A Builder delete that fails part-way, of one collection or several, now removes nothing on PostgreSQL and SQLite: their field-group values, translations, tables and registry rows go in one transaction, and the drop migration written for it is withdrawn. On MySQL, which keeps each table drop as it runs, every collection not yet deleted stays registered and the message says to delete again to finish.

- [#3083](https://github.com/nextlyhq/nextly/pull/3083) [`5a1f466`](https://github.com/nextlyhq/nextly/commit/5a1f46609344007750a6e980f2305f540dc0b372) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly generate:widget <name>` scaffolds a working dashboard widget in the site or plugin it runs in: a declaration, a component of its own for `--view component`, and a test that loads it as the instance's administrator and draws its card. Pick how it shows its data with `--view figure|list|table|bars|series|component` (a figure when left out), and whether it reads from a collection the reader chooses with `--collection`. It lists the widget in the site's `admin.dashboard.widgets` or the plugin's `contributes.dashboard.widgets` when the file has a shape it can edit safely, and otherwise leaves the file as it was and prints the line to add. A project without `@nextlyhq/plugin-sdk`, which the test imports, or `@nextlyhq/adapter-sqlite`, which it boots on, gets them added to its devDependencies at the running `nextly`'s version, and is told to install. It honours the root `-c, --config` path. It never writes over an existing file unless given `--force`, generating a widget again leaves it listed and imported once, and it refuses to switch a widget between a component of its own and a core view, naming the files to remove first; `--dry-run` shows everything without writing, and on a terminal it asks for anything left out. A site's widgets are named `site/<name>`, a plugin's under its own name, with its scope in front when that name is one core keeps (`@acme/core` → `acme-core/<name>`). `nextly` gains a dependency on `@babel/parser`, which the command reads the config with to find where the widget is listed; only `generate:widget` loads it, so nothing else pays for it. `createTestNextly` gains an experimental `widgets` option, for a site's own widgets, and gives an instance booted without a `NEXTLY_SECRET` a random one, so `runWidgetLoad` works without setting it first.

- [#2939](https://github.com/nextlyhq/nextly/pull/2939) [`d448b12`](https://github.com/nextlyhq/nextly/commit/d448b129f4bd0b8d7c5fc028d616fe4ab7ea6168) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard asks for its collections, its layout and your permissions once per load instead of twice, and each screen you open asks for your permissions afresh. A card missing a setting says "No collection chosen yet" beside its "Choose collection" button, or, where no button is shown, to choose it in the card's settings.

- [#2828](https://github.com/nextlyhq/nextly/pull/2828) [`86f764c`](https://github.com/nextlyhq/nextly/commit/86f764cc9ecd45b41db3179cae4523e9c86fb980) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection's `delete` access rule may answer a filter instead of `true`. A delete through the Direct API or a plugin service then removes an entry only if it matches the filter. An entry outside the filter is left in place and refused: with a 403 where the caller may read it, and as a missing entry (404) where it may not. The entry is matched under the delete's lock, so a concurrent change can't move it out of the filter between the check and the delete. A filter on a translated field is matched in the site's default language, since a delete removes every language.

  Over REST, and for the bulk and batch deletes, a delete rule's filter is still refused, as before.

- [#3089](https://github.com/nextlyhq/nextly/pull/3089) [`0d263df`](https://github.com/nextlyhq/nextly/commit/0d263df16f7a64921378c99de9d9a30dc067b34d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting a collection or a Single now expires its cached pages straight away, so the site stops showing content that is gone. A collection or Single that opts out of revalidation is still left alone.

- [#3098](https://github.com/nextlyhq/nextly/pull/3098) [`d232fdf`](https://github.com/nextlyhq/nextly/commit/d232fdf7f032a2809f3d92d5443a9b45ba750d89) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Team activity no longer reads as though a whole collection was deleted. A row names the entry by its title when it carries one ("Ana deleted Spring launch announcement"), and otherwise says "an entry in" the collection ("Ana deleted an entry in Posts"); a Single without a name is "a Single". A row carries no title when the entry has none, or when the entry no longer exists, so a title the reader may not be told is never shown and never called empty. Settings changes keep naming what they changed, and legacy settings activity rows now arrive with `subjectKind: "settings"`: a row on `GET /dashboard/activity` or from the `system:activity` source that was recorded before the kind was, under a settings namespace, said `null` and now says `"settings"`.

- [#2997](https://github.com/nextlyhq/nextly/pull/2997) [`40f6fb2`](https://github.com/nextlyhq/nextly/commit/40f6fb2d8db5173f014d73e316d96d672251dc36) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A development server now has a widget preview page. While the server runs in development, the admin offers a page (linked from customise mode's bar) that draws every widget the reader may see from its declared `preview` cases, at its smallest, default and largest sizes, in light and dark, in its ready state and in each frame state (loading, empty, error, not available), with an accessibility check beside each state. A widget with no preview case says so in place of its ready state. No widget's data is loaded. A production server neither serves the page nor its read, `GET /api/_dev/widget-previews`, which answers there as any path it does not serve. Startup now also refuses a preview case whose settings would not reach the browser as they are, such as a date inside a filter setting.

- [#3110](https://github.com/nextlyhq/nextly/pull/3110) [`ce79d13`](https://github.com/nextlyhq/nextly/commit/ce79d13906f9036af5e9eddbb50edd2a7278c4d4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A finished step on the dashboard's setup card has a border you can see: it now draws at full success strength instead of a faint tint that failed the contrast check.

- [#2806](https://github.com/nextlyhq/nextly/pull/2806) [`9c61b19`](https://github.com/nextlyhq/nextly/commit/9c61b1922cbaeb3cb033caf3809eaca2c6edd251) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin route whose `requiredPermission` cannot be worked out, because its resolver throws or returns an empty permission, now answers 500 `INTERNAL_ERROR`, as any server fault does. It is not answered 403, since no access the caller held could have been enough, and the request is never let through.

  A REST request whose handler reports a failure as a returned result, rather than throwing it, is answered with that failure's own status and code: a refusal 403 `FORBIDDEN`, a missing record 404, a busy database 503. A reported failure with no message is answered by its status too.

- [#3043](https://github.com/nextlyhq/nextly/pull/3043) [`6c5c357`](https://github.com/nextlyhq/nextly/commit/6c5c3579988188de75f6c1a86e63787006d9449b) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A field group with a many-to-many relationship can now be created on MySQL. Its relation column holds a list of ids, and it no longer gets a plain index on any database: MySQL refused the index, so the create failed, and on PostgreSQL the index refused a save once the list held about a hundred ids. A unique field in a field group also no longer gets a plain index beside its unique one.

  The next migration drops an unused index on many-to-many fields in field groups.

- [#2931](https://github.com/nextlyhq/nextly/pull/2931) [`f12038e`](https://github.com/nextlyhq/nextly/commit/f12038e0f747d9db0ad9f968d1e69a9af938292f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field renamed and made required, or given a new default, in one change now keeps that change in the migration `nextly migrate:create` writes, on every database. On MySQL, a column made required or renamed by a migration keeps its comment, character set, collation and the checks that use it; on SQLite, a migration that would rebuild a table holding a collation, an index or a table option (`STRICT`, `WITHOUT ROWID`) the schema does not record is refused with a message saying so, rather than dropping it. Making a field required no longer stops `migrate:create` on MySQL or SQLite with a request to write the migration by hand.

- [#3082](https://github.com/nextlyhq/nextly/pull/3082) [`2c5e1d8`](https://github.com/nextlyhq/nextly/commit/2c5e1d834449d4afaf6fdc5e4e8c1003bbfda193) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A new core table, `nextly_cache_tag_expiries`, keeps when each cache tag last expired, on the database's clock. It's where writes made outside a request (a job, the CLI, another instance) will record the tags they change, so every instance can expire its cached reads. Run `nextly migrate` to add it. Until it exists, nextly warns once and works as before.

  Rows older than seven days are pruned by a retention pass, in bounded batches, both on writes and on the scheduled webhook drain.

- [#3125](https://github.com/nextlyhq/nextly/pull/3125) [`29905db`](https://github.com/nextlyhq/nextly/commit/29905db3c17cf2bb762541c29a03391cbd1c76c8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A cached read, through `cachedFind` or Nextly's collection and Single routes, now leaves out any tag longer than the 256 characters Next.js accepts before applying the 128-tag limit, so an over-long tag can no longer push a valid one off the end. The caching and REST guides now say when a page shows a write, what happens when an expiry fails, which writes expire pages, and that the login returns `accessToken`.

- [#2858](https://github.com/nextlyhq/nextly/pull/2858) [`e86162c`](https://github.com/nextlyhq/nextly/commit/e86162c5ded69bfe263c9ddb100f0418a3d0269c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A check of whether a caller may read a collection now answers yes where the collection's `read` rule answers with a filter, where it answered no before: `ctx.caller.can`, `GET /me/capabilities`, the dashboard and widget scopes, and the entity reader behind versions, translations and content events. What those checks let the caller read is limited to the entries the filter matches, and a document lock is read only for a document the filter matches.

- [#2978](https://github.com/nextlyhq/nextly/pull/2978) [`51765f3`](https://github.com/nextlyhq/nextly/commit/51765f3d018aa0984a7b0f15f3b82c04ee60e6f5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On the media page, a page picked straight after it loads now stays picked. Moving to another page within a moment of the page opening used to send you back to page one, because the search box reset the page while settling a search that had not changed. Media tiles and their checkboxes are also named by the file name the tile shows, not its storage path, so screen readers read the name you uploaded, and voice control or a search by that name finds the tile.

- [#3050](https://github.com/nextlyhq/nextly/pull/3050) [`b09382d`](https://github.com/nextlyhq/nextly/commit/b09382dd7e7ad31a4c74faedfb155bba9dd9c3b6) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A migration's state is now read from its latest outcome alone, and an interrupted run leaves nothing half-recorded.
  - `nextly migrate`, `migrate:down`, `migrate:status` and `migrate:resolve` read an app migration as applied or rolled back from the last run, rollback or `migrate:resolve` that recorded one. An attempt that failed or stopped afterwards no longer makes an applied migration read as pending, so it is never applied twice.
  - A migration file run in a transaction on PostgreSQL or SQLite records its attempt and its outcome inside that transaction. When the process is killed, its connection drops or a statement fails, nothing of the file is left, not even a ledger row, and the next `nextly migrate` applies it from its start. A failed file of this kind is no longer listed as failed by `migrate:status`; the command that ran it reported the error.
  - On MySQL, and for a file marked `-- nextly:no-transaction`, `migrate:down` now records that a rollback started before its first statement, as `nextly migrate` already did for a file. A rollback that stops part-way is shown by `migrate:status` as one that recorded no outcome, and the migration stays recorded applied.
  - An attempt cleared by `migrate:resolve --failed-cleanup` is no longer read as a rollback, so clearing an attempt made after a migration was applied leaves it applied.
  - A migration file with no snapshot whose statement fails now ends with "Migration <name> failed: <reason>", as a file with a snapshot does, rather than the database's bare message.

- [#2539](https://github.com/nextlyhq/nextly/pull/2539) [`7f61574`](https://github.com/nextlyhq/nextly/commit/7f61574f6b4f10d9c73e07dbe56ed36212baa8ea) Thanks [@aqib-rx](https://github.com/aqib-rx)! - On MySQL, a migration file marked to run outside a transaction now runs in strict mode like every other migration, so a statement that would cut a stored value short fails instead of silently truncating it.

- [#2905](https://github.com/nextlyhq/nextly/pull/2905) [`36f75e4`](https://github.com/nextlyhq/nextly/commit/36f75e4bb47d0c43599ad35b0419fc4ad956c3b1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard widget whose component is missing from the app's component map now draws its own
  card's error state, and the rest of the admin serves. Production no longer reads, checks or
  writes the map: the admin's server layout does nothing there, and no longer refuses the admin
  over a missing widget component. In development the map is still written again when it falls
  behind; where it cannot be (`NEXTLY_GENERATED_FILES_WRITE=0`, or a folder that is not writable)
  the server log names each missing component, its owner and the fix instead of refusing.

  The card's error names the widget, its owner and the missing path in development, and says only
  that the component could not be loaded in production. The grid counts the card as failed.

  New: `nextly generate:types --check` compares the committed map with the config and writes
  nothing. It exits 1 naming each missing component and each path no longer declared, and 2 when
  it cannot load the config. Run it in CI.

  The error code `NEXTLY_ADMIN_COMPONENT_MAP_STALE` is gone with the refusal it named. The widget
  definition gains an `owner` that core publishes for a widget drawn by its own component;
  `registerWidget()` and `overrideWidget()` refuse it, as they refuse `serverData`.

- [#3090](https://github.com/nextlyhq/nextly/pull/3090) [`addefbe`](https://github.com/nextlyhq/nextly/commit/addefbe37bb7009371d88a1460e83d7a264b60a4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard header gains a New button beside Customize. Its main part
  creates the type a person created most recently (or the first they may
  create), and its menu lists the recent types, then every type they may create,
  grouped as the sidebar groups them, with a search past ten. It is hidden for
  someone who may create nothing. The command palette offers "Create <type>" for
  each type too. A type is remembered as recent when an entry of it is created,
  from anywhere in the admin, not when its form is opened.

  The Create card is removed: `core/quick-create` is no longer a core widget, and
  core's default dashboard gives Needs attention its row. Its id is now a retired
  card, as the per-collection and per-Single cards are: a site whose
  `admin.dashboard.defaultLayout` (or `hide` or `overrides`) still names it is
  refused at startup with a message saying creating entries now lives in the
  dashboard header's New button, so remove it from the config. A saved layout
  holding it reads without it.

  The header holds its layout from the first paint: the summary line's height,
  Customize's place and the New button's fixed width are reserved before their
  data arrives, so nothing in the header moves as the dashboard loads.

- [#2835](https://github.com/nextlyhq/nextly/pull/2835) [`be529a6`](https://github.com/nextlyhq/nextly/commit/be529a69c968e275de44c3172a2e54a7fad06f2a) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A password inside a group is kept when an edit doesn't resend it. An update that leaves out, or sends empty, a password held in a group or repeater, or in a field group held inline in one, keeps its stored hash; `null` still clears it and a new value replaces it. Repeater rows keep their own by id, and a translated group keeps the written language's.

- [#2609](https://github.com/nextlyhq/nextly/pull/2609) [`95e7772`](https://github.com/nextlyhq/nextly/commit/95e77720d0cfb3c0f37582ec563d90b4456f4a5a) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A plugin can pin a version in its own transaction (experimental). `ctx.services.versions.pins.registerHolder({ name, label })` registers a version pin holder in the plugin's namespace, so two plugins naming a holder alike hold apart and none reaches one of core's. Its `pin`, `release`, `releaseAll` and `list` take `{ tx }`: the handle `ctx.db.transaction` passes its callback, or the transaction `ctx.services.collections.withTransaction` hands its work. A pin commits or rolls back with the plugin's own writes, under the same document lock and refusals as core's pins. The plugin SDK exports the types, with `VersionPinHolderDefinition` (what `registerHolder` takes) and `VersionRef`. A registered holder now reads its own slots as well: `holder.list(db, ref)` takes a transaction or the adapter and names the holder in the query, so what other features pin on the same document is never read. Registration returns a `RegisteredVersionPinHolder`, a `VersionPinHolder` with `list`; `VersionPinHolder` itself is unchanged, so a type written to it keeps compiling.

- [#3077](https://github.com/nextlyhq/nextly/pull/3077) [`e454ad1`](https://github.com/nextlyhq/nextly/commit/e454ad189c176a6ef1df69da302c120fc4d655b6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin's write made as a user inside `ctx.services.collections.withTransaction` reads that user's roles on the transaction. They were read on the pool, outside it: a role the transaction had taken away was still on the caller a field rule reads as `req.user`, so a rule checking `req.user.roles` could allow a write the transaction's own roles refuse, and on PostgreSQL and MySQL each lookup ran on another connection while the transaction held its own.

- [#3119](https://github.com/nextlyhq/nextly/pull/3119) [`91cef56`](https://github.com/nextlyhq/nextly/commit/91cef56f68250ae869305fbcc303e2293ce90fa8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin that writes to columns it added to a collection, a Single or a component through `ctx.db.contributed` now expires the cached pages showing that entry or Single, as any other content write does. Inside `ctx.db.transaction` the pages expire once the transaction commits, and a rolled-back write expires nothing. A cached page also keeps its own collection's or Single's tag when a read names more tags than Next.js keeps. On SQLite, a collection or Single deleted inside `ctx.db.transaction` expires its cached pages once that transaction commits, and not at all when it rolls back; on PostgreSQL and MySQL that delete commits on its own connection, so it expires them straight away and a rollback does not undo it.

- [#2837](https://github.com/nextlyhq/nextly/pull/2837) [`a6c1920`](https://github.com/nextlyhq/nextly/commit/a6c19209ecee2968ba2cbf927913827728c23524) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A populated relationship under the related collection's `read` rule that answers with a filter now shows the related rows the filter matches, where it withheld every row of that collection before. A row the filter does not match is withheld, as a row the caller may not read is.

- [#2811](https://github.com/nextlyhq/nextly/pull/2811) [`b707e03`](https://github.com/nextlyhq/nextly/commit/b707e0316a5b798a0ec47bbdfcdf3810cbdc0cd7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A built-in Public role is added: the role visitors will be judged by. It does not change access yet. It can't be deleted, renamed, given to a person or an API key, or joined to another role's inheritance; only its permissions can be set.

  A site whose own role already used the slug `public` keeps that role under the next free slug (`public-1`, `public-2`, …) on the first boot of this version, with its name, holders, permissions and inheritance unchanged, and the change is logged. Code access rules that check the role slug `public` must check the new slug instead.

  Saving a role in the admin keeps its slug.

  An app or plugin role declared with the slug `public` is refused at boot, as one declared with `super-admin` already is.

  At boot, the Public role is given `read-media` and the read of each collection and Single whose `read` rule answers `true` for a visitor. Each read is granted once, so one an owner removes stays removed. Access doesn't change yet.

  Plugins can declare permissions for the Public role on their own collections with `contributes.publicGrants` (experimental), for example `[{ collection: "tickets", action: "create" }]`. Only `read` and `create` can be granted. Each grant is made once at boot, so one an owner removes stays removed, and a grant on a collection the plugin doesn't contribute is refused and logged. The form builder uses it to let the Public role create form submissions. A plugin's grant lasts only while an enabled plugin declares it: disabling or removing the plugin, or a version that no longer declares it, removes the grant, and the removal is logged. Declaring it again grants it again, except one an owner had already removed.

  Each startup log names what the Public role does not hold yet that visitors may rely on: reads with no `read` rule, reads whose rule answers neither `true` nor `false`, writes whose rule answers `true` for anyone, and rules that failed or gave no answer when asked. Grant the Public role each one visitors should keep.

- [#2868](https://github.com/nextlyhq/nextly/pull/2868) [`593302d`](https://github.com/nextlyhq/nextly/commit/593302d08f2e904c0991f2a61c8bde12be02e017) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A publish of every language at once is limited to the entries its `publish` rule's filter matches: through the Direct API (`nextly.update` by `id` with `locale: "*"`) or REST (`publish-all`, or a status-only write with `?locale=*`). The rule is asked in each language the publish puts live, and the entry is matched against that language's filter, in that language. `unpublish-all` is limited the same way, its filter matched in the default language. An entry outside a filter is refused and left as it was: with a 403 where the caller may read it, and as a missing entry (404) where it may not. The entry is matched before the write, under its row lock and once the write is in.

- [#2829](https://github.com/nextlyhq/nextly/pull/2829) [`fbbdf63`](https://github.com/nextlyhq/nextly/commit/fbbdf63c1612512c49dec0ee0e014783f7da2dfc) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A read by id under a collection `read` rule that answers with a filter, through the Direct API, a plugin service or REST, now reads an entry the filter matches and answers one it does not match exactly as an entry that does not exist, where it refused such a caller before. Such a read returns the entry the filter matched, without its pending working draft. A read rule's filter can't name a field inside a component yet: a rule whose filter does is refused, and the refusal is logged once.

  A read rule's filter that names a localized field must hold in each language the read may fall back to, so a read never shows a fallback value the rule refuses. A filter on a localized date, a read rule's or a caller's own `where`, now compares the date as the instant it names on every database.

- [#2890](https://github.com/nextlyhq/nextly/pull/2890) [`b372376`](https://github.com/nextlyhq/nextly/commit/b372376b8be48707368cb8582f70f433dbcb0c56) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection's `read` rule is now typed to answer a filter, typed by the collection's own fields: `defineCollection` checks each key and operator the rule's filter names, and the value each is compared with, so a misspelt field or operator fails to compile. The keys are the top-level fields declared with a field factory or inline, and the system fields; a path into a group is not typed yet. The new types (`CollectionRuleFilter`, `CollectionFilterRule`, `CollectionRuleAnswer`, `UntypedRuleFilter`, `CollectionFilterRuleInput`) are experimental.

  Existing code compiles unchanged, with one exception. `CollectionAccessControl['read']` now includes a filter-returning rule; code that used it as the type of any rule should use `AccessControlFunction | boolean`. The field factories that a filter can name (`text`, `textarea`, `email`, `code`, `number`, `checkbox`, `date`, `select`, `radio`, `upload`, `relationship`) keep the name as written, and still return their field's config type; a name built at runtime is a `string`, as before, and leaves the filter untyped. `CollectionConfigInput` takes two type parameters with defaults that keep its meaning. Code that calls a stored read rule and reads its answer as a boolean should handle the filter case, or treat any answer other than `true` as a refusal.

- [#2810](https://github.com/nextlyhq/nextly/pull/2810) [`e2e162b`](https://github.com/nextlyhq/nextly/commit/e2e162ba33229f265b78286c6429fac94c61d2d8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection's `read` rule may now answer with a filter (a `where`) instead of `true`, as an experimental step: a list, its total, a count, and the group and timeseries reads made through the Direct API or a plugin service then read only the entries the filter matches, as does a page the website resolves by its slug. Every other read, including a read by id, every REST route and relationship population, still refuses a caller whose rule answers with a filter, as before, and the rule's type is unchanged. A read rule's filter can't use `near` or `within` yet, nor the reserved `_translated`, `_pendingChange` and `_inRelease` keys: a rule whose filter does is refused, and the refusal is logged once.

- [#2969](https://github.com/nextlyhq/nextly/pull/2969) [`df26ad9`](https://github.com/nextlyhq/nextly/commit/df26ad9c63ab3088400cc3c464f03ac0bb49d001) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A user who may publish a document but not change it now waits for a colleague who is editing it: while someone else holds the document, Publish, Publish changes, Unpublish and Publish all are held, and the read-only page names who is editing. The reader never claims the document; they read who holds it on the same beat an editor's claim is renewed, and their writes are held until that first read answers.

- [#3144](https://github.com/nextlyhq/nextly/pull/3144) [`a9c81fe`](https://github.com/nextlyhq/nextly/commit/a9c81fec45940156db1e3da8ecfa0c8a42bb0065) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Fixed: in an app without nextly's cache handlers, a write made outside a request (a job, a script) or one whose cache expiry failed inside a request is expired in Next.js's own cache again at the next request, as before the cache tag expiry ledger was connected at startup. The ledger records it for nextly's handlers, and Next.js's own cache never reads that record, so a read cached without a revalidate time could otherwise keep the previous version.

  Other instances now treat a recorded cache tag expiry as standing for one second past the write, the time an instance may keep a collection's settings cached. An entry another instance fills from settings cached before a schema change is therefore not served once the change is recorded. The instance that made the write isn't held to that second, since it cleared its own cached settings at once, and a tag that expires again never has its recorded time moved back.

  A write made while nextly is restarting, after one registration released the ledger and before the next one connects it, is now kept and recorded by the next ledger, instead of reaching only the instance that made it.

- [#3095](https://github.com/nextlyhq/nextly/pull/3095) [`f06be6e`](https://github.com/nextlyhq/nextly/commit/f06be6e70b5083ea0b90903cd19660dec9757173) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Visual Schema Builder's create dialogs for a collection, a Single and a field group now show why an address is refused (for example, that a Single address cannot end in `_locales`, or that it names a Nextly system resource) instead of a bare "Validation failed.".

- [#3169](https://github.com/nextlyhq/nextly/pull/3169) [`daa57a6`](https://github.com/nextlyhq/nextly/commit/daa57a6a98eb7904e75e584e2d21125652db6f03) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - When the database refuses the record that tells other instances a cache tag expired, nextly now retries it by itself until it succeeds: after 1 second, then waiting twice as long each time up to 30 seconds, and at the process's next cached read, where a timer may not run. Other instances see the write within about a minute of the database answering again, instead of only after the process's next write. It logs once when the retries start and once when they succeed, and the timer stops when nextly's services are released.

- [#3099](https://github.com/nextlyhq/nextly/pull/3099) [`70ddd2d`](https://github.com/nextlyhq/nextly/commit/70ddd2da7e5082a4dadb353cfccb56deb2aa81f1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Single publish refused because someone else published newer shared values now reads the
  caller's grants inside its own transaction when the request was routed and trusted. They were read
  on another database connection while the transaction held one, so a visitor's Public role read ran
  outside it and, on a small connection pool, could wait for a connection that never came free.

- [#2822](https://github.com/nextlyhq/nextly/pull/2822) [`a96eecf`](https://github.com/nextlyhq/nextly/commit/a96eecfb9048ddd9b9d0a49f8513d9d706a1f58d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A REST request that only changes an entry's status and is refused now says which action it was refused (publish or unpublish), not edit.

- [#3006](https://github.com/nextlyhq/nextly/pull/3006) [`40d4a03`](https://github.com/nextlyhq/nextly/commit/40d4a03d84a4e68f20c53c761ac4aa5b0c1b18af) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Populating a relationship under a read rule that answers a filter reads the related rows' columns with Drizzle's current column helper, so it runs unchanged on Drizzle v1.

- [#3021](https://github.com/nextlyhq/nextly/pull/3021) [`ad1287e`](https://github.com/nextlyhq/nextly/commit/ad1287e1a93b2a1d883ddb42b0342eb83246c211) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release that is not ready to go out now says so inside a border drawn at the destructive colour's full strength, which meets the 3:1 contrast a border needs, where the faded border before it did not.

- [#3049](https://github.com/nextlyhq/nextly/pull/3049) [`d1c1822`](https://github.com/nextlyhq/nextly/commit/d1c18221f0c767d38f0778a5ed047474b06b194c) Thanks [@aqib-rx](https://github.com/aqib-rx)! - The Schema Builder's save preview no longer reports removing a field that
  holds values as safe.
  - A removed field's values are counted where they are stored: a translated
    field's in its translations table, every other field's on the main table,
    by its stored column name. Before, a translated field was counted on the
    main table, and a field whose name differs from its column (`metaTitle`,
    stored as `meta_title`) was queried by the wrong name. Both counts failed
    and read as 0.
  - A count that cannot be read is no longer taken as 0. The removal is classed
    `destructive`, carries `rowCountUnknown: true` (a new optional field on the
    preview's removed rows), and a warning says the count could not be read.
    A field group or many-to-many relationship, whose values live in their own
    table, is reported the same way.
  - Switching a relationship between one related entry and many is classed
    `destructive`, in both directions, with a warning that its values are
    stored differently and may be lost.

- [#2904](https://github.com/nextlyhq/nextly/pull/2904) [`12ebd59`](https://github.com/nextlyhq/nextly/commit/12ebd59f21baaae65a6a51f6148c730244a2b841) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A collection or Single removed from your configuration is no longer brought back by `next dev`, a configuration reload, `next build` or `nextly db:sync`. Once a migration has dropped its tables, no start creates them again, and while they are kept no start changes them or its registry row. A Schema Builder collection or Single still gets a missing table created in development, as before.

- [#3123](https://github.com/nextlyhq/nextly/pull/3123) [`be33daa`](https://github.com/nextlyhq/nextly/commit/be33daaeec3f4794f9fd5ec62d71d4d0ee066fa2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Where the server cannot read the app's migrations folder (a standalone or serverless bundle may leave it out), the admin no longer tells the operator to write a drop migration for a collection or Single removed from code; opening a version of such a document no longer sends a "seen" mark that the server would refuse; and reading a removed entity's state on a request no longer loads the CLI's migrate command.

- [#2995](https://github.com/nextlyhq/nextly/pull/2995) [`b274eef`](https://github.com/nextlyhq/nextly/commit/b274eef37e550856a6bb5b61b1024498636ca09c) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - A collection on either side of a many-to-many relationship is no longer renamed. Its links live in a junction table spelled from both collections' slugs, which a rename keeps, so after a rename the relationship read every link as empty. The rename is now refused with a conflict naming the fields, and the links stay readable. A collection or Single rename also holds the schema lock now, as every other schema change does, so one started while a migration or another schema change is running is refused at once, with nothing changed.

- [#2821](https://github.com/nextlyhq/nextly/pull/2821) [`5fdc335`](https://github.com/nextlyhq/nextly/commit/5fdc335401238e4f5714b2c67ecf74931795a45b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A REST list or count of a collection's entries now reads only the entries a collection's `read` rule's filter matches, where it refused such a caller before. The rule is asked once in the request, for the route and the read alike. Every other REST route still refuses a caller whose read rule answers with a filter.

- [#2893](https://github.com/nextlyhq/nextly/pull/2893) [`10b81a9`](https://github.com/nextlyhq/nextly/commit/10b81a93539d216dd92778a837afba7876510be1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A REST write is limited to the entries its access rule's filter matches, as a write through the Direct API is: an update, a delete, a publish or unpublish sent as a status change, and the writes an editor makes through an entry's versions (a restore, a discard of the held edit, taking the live shared values, an autosave). The route lets a caller through on the filter its rule answers and keeps it for the request; the write matches the entry against that filter, in the language the write names, or the default where it names none. An entry outside it is refused and left as it was: with a 403 where the caller may read it, and as a missing entry (404) where it may not. A check that cannot apply the filter refuses rather than allowing every entry.

  A restore that the update refuses is now answered as the update was: a 403 where the caller may read the entry, rather than a 404 for every refusal.

- [#3004](https://github.com/nextlyhq/nextly/pull/3004) [`7ae01fc`](https://github.com/nextlyhq/nextly/commit/7ae01fc7ceba6193e96c8284f99f6ead15e7d7fe) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - A Schema Builder change that MySQL refused part-way is finished by saving it again:
  - A relationship whose options name its target collection (`options.target`), the relationships
    the schema pipeline gives a foreign key, gets that key when the change adds it, even when the
    earlier attempt already added its column. A relationship the collection already records is
    planned no new key, and one the change renames, in this attempt or in the one that failed,
    keeps what its old column had: no key where it had none.
  - A field made translated over a column the translations table already has takes that column as
    its own only when it holds every value the field allows: the same type, a length or precision at
    least as large, and empty values allowed. Otherwise the change is refused before anything
    changes, naming the column, both definitions and how to go on, since the column may hold the
    field's values from the change that did not finish.
  - A field the change made translated whose values the earlier attempt already moved is finished by
    the retry. A retry that also narrows its length or precision is refused, saying how to finish
    the earlier change first.

  The same check applies where a config sync (`nextly db:sync`, its `--watch` loop, `nextly migrate`
  and a config reload under `next dev`) takes a translations column already there as a field's own,
  for the fields that run newly translates, judged against the fields recorded before the run.

  A config sync now widens a translated field's column when the config raises its length or
  precision, keeping the column's other properties; a column already wide enough is left as it is.
  A column that cannot hold the field and cannot be widened to it, such as one of another type, is
  never converted: the run that changes the field is refused, and later runs report it as a warning.

  The Schema Builder now shows why a schema change was refused, naming each field and its reason,
  instead of only "Validation failed.".

- [#3180](https://github.com/nextlyhq/nextly/pull/3180) [`fde2cc9`](https://github.com/nextlyhq/nextly/commit/fde2cc97d370cf392846615becdb7d4da6dbd79a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - With nextly's cache handlers installed, a database that takes connections but never answers can no longer hold cached public reads. Every call to the cache tag expiry ledger, a lookup or a record, is now given up on after 5 seconds, and a cached read waits at most a second on a retry of a refused record, which goes on in the background. Before, both waited for as long as the database did. A call given up on is not cancelled and keeps its connection, so while one is still running no other of its kind is started: a database that does not answer holds one waiting record and one waiting lookup per process, not one more at every write, retry and lookup. A lookup that is given up on counts its tags as expired at that moment: entries cached before it are read afresh, and those cached after it are served, until the next lookup says what the ledger holds.

  A retried cache tag expiry record now writes only to the ledger: it no longer expires the tag in the instance again, so a page regenerated since the write stays cached while the retries fail. When a retry succeeds, it is judged by the database time it read, as a write's own record is, since another instance may have recorded the same tag in that millisecond; a page regenerated during the outage is rebuilt once then. A record that answers after it was given up on is not made again by the retry, but only for the write it was made for: an earlier record landing late does not stand in for a later one the ledger refused. A refusal kept while a retry is under way waits the first retry delay again once that retry succeeds, and the tags a cache expiry hand-off gave back after its timeout are retried too, rather than waiting for the next write. Each record the ledger refuses is now logged with its tags (`cache-tag-record-failed`), a refusal during a retry included, so the content another instance may still serve stale can be named; the retries themselves are said only when they begin and when they succeed.

- [#3060](https://github.com/nextlyhq/nextly/pull/3060) [`70201c5`](https://github.com/nextlyhq/nextly/commit/70201c535868904e463dee592b44632b9ddb5196) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A role or permission change now takes effect at once everywhere in the server process that made it. A production Next.js build loads Nextly's modules more than once in one process, and each copy kept its own record of the role version, so a check asked through a service another copy had registered could serve the grant it had cached for up to a second after the change: a release's readiness then read Ready for a document whose author had just lost the right to publish it, and the early stop of a scheduled release on that change could miss it. Every copy now shares the one role version.

- [#2794](https://github.com/nextlyhq/nextly/pull/2794) [`4211cec`](https://github.com/nextlyhq/nextly/commit/4211cecc38c19bbe24ea8b7ee1fc2c60d7d6fc05) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A code access rule that answers with a filter that isn't well formed (an unknown operator, an empty `in`, an `and` that isn't a list, and the other shapes a `where` refuses), or a filter from a create rule or a Single's rule, which may only answer `true` or `false`, is now reported in the log once, naming the rule's collection and operation. In development it is also raised as an error. The caller is refused either way, as before. A rule that answers a well-formed filter is refused as before too, and its log notice now says the check does not apply a rule's filter, rather than telling the rule to answer `true` or `false`.

- [#3084](https://github.com/nextlyhq/nextly/pull/3084) [`8b1de71`](https://github.com/nextlyhq/nextly/commit/8b1de71e91e7a13d6836b059968716cff6fe1ae6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A setting's own editor (`@experimental`) gets two fixes.
  - **`SettingEditorProps<Value>["onChange"]` takes `Value | undefined`**, so an editor can clear an optional setting: `onChange(undefined)` saves the setting unset, and the card reads its default, or no value where it has none. This is a widening of the parameter: an editor that calls `onChange` with a value keeps compiling unchanged. Only code that builds `SettingEditorProps` itself, with an `onChange` that accepts `Value` alone, needs its callback to accept `undefined` too.
  - **An editor for a Field setting is held to the fields the chosen collection offers the reader** in the settings sheet. A field the collection does not offer is named under the editor on Done ("names a field that is not available", the words the layout write refuses it with) and nothing is saved, rather than failing the whole sheet's save. The check is the layout write's own field-fit rule (`unfitContentField`).

- [#2943](https://github.com/nextlyhq/nextly/pull/2943) [`3901727`](https://github.com/nextlyhq/nextly/commit/3901727917e92e033aad5dee1bc00705547a2cc7) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A change to settings alone now reaches production. When only a collection's, Single's or field group's settings change (labels, description, icon, sidebar group and other admin options, versioning, Draft/Published, the localisation flag, or a field's help text, placeholder or hidden flag), in code or in the Schema Builder, `nextly migrate:create` writes a migration with no table statements that names each entity and what changed (`-- Settings: posts: description`), with its snapshot. A migration that changes columns also names every settings change since the previous snapshot, a cleared setting counts as a change, and a Builder entity's registry row travels with its settings change. Site content settings (general settings, the email setup) never appear in a migration.

  Every snapshot `migrate:create` writes now records every entity's settings. Snapshots written before this release carry none and are read as saying nothing about them, so the first `migrate:create` after upgrading writes one settings-only migration that records every entity's settings (`-- Settings: posts: settings recorded`).

  `nextly migrate` now refuses a pending migration file the Schema Builder wrote with no snapshot beside it (a `<timestamp>_create_<slug>.sql`, `_update_`, `_drop_`, `_i18n_` or `_status_` file), where it used to apply it as written. It stops before changing anything, names the file, and says to replace it with the migration `nextly migrate:create` writes for that change. `nextly migrate:check` names the same file and remedy.

- [#2961](https://github.com/nextlyhq/nextly/pull/2961) [`3520911`](https://github.com/nextlyhq/nextly/commit/3520911c35ca7ad6b4a247f4c217cbf0faa15d42) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A site's own dashboard widgets, declared in `admin.dashboard.widgets`, are now registered and
  offered like a plugin's, and `defaultLayout` may place them; startup no longer warns that they
  are checked but not applied. Their components are listed in the generated component map, by
  `next dev`, `nextly generate:types` and its `--check`, under the site config's name. A site names
  a component relative to its config file (`"./dashboard/notes#NotesCard"`), which the map imports
  from its own folder, or by a package name; a path alias is refused at startup with the relative
  spelling to write instead. Widgets a plugin's `setup()` adds to the site's dashboard are listed
  too, as the running server registers them. In development a map whose config has moved is
  written again, so a component named relative to the config resolves from its new folder.

- [#3182](https://github.com/nextlyhq/nextly/pull/3182) [`816e497`](https://github.com/nextlyhq/nextly/commit/816e49758fe1923f97f3b5e7c46577ceb279eb55) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - With nextly's cache handlers, a slow lookup of the tag expiry ledger can no longer make an instance serve an entry filled before another instance's write. Each instance learns the database's clock from its lookups, and it took the statement to have run halfway through the round trip. Under load, a lookup that waited for a connection could then put an entry seconds later than it began, past the write's recorded expiry, and that entry was served for its whole lifetime. The statement is now taken to have run as late as its answer arrived, so an entry looks no later than it began, and each lookup's bound replaces the last, so a database clock that stepped back, as after a failover, is followed at once. A slow lookup can still cost a rebuild, but never a stale read. An earlier copy of nextly's cache module still loaded after a hot reload keeps its own offset, which this one does not read.

- [#2974](https://github.com/nextlyhq/nextly/pull/2974) [`297fd0d`](https://github.com/nextlyhq/nextly/commit/297fd0dc89a7fc73143511d595aafd66098c0734) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A SQLite migration that rebuilds a table to change a column's nullability or default is now refused when a column carries an `ON CONFLICT` policy the schema does not record, rather than rebuilding the table without it.

- [#3191](https://github.com/nextlyhq/nextly/pull/3191) [`8eec014`](https://github.com/nextlyhq/nextly/commit/8eec0145cb586026bd6045c8854285bbab47e34c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - With nextly's cache handlers, a database that stops answering now holds at most four cache tag ledger calls of each kind per process, a record or a lookup, from the moment they start. Before, every write and lookup in the first five seconds of an outage started a call of its own before any was given up on. Further calls wait for a slot within the same five seconds, and are turned away rather than started if a call of their kind is given up on meanwhile. A call of a withdrawn ledger that never answers no longer holds back the ledger installed after it, and a call still waiting for a withdrawn ledger's slot is turned away when the next is installed, never started against the withdrawn one. A retry turned away while an earlier record is stuck no longer stops that record, landing late, from counting as the expiry it was, so the retry doesn't record it a second time. After a hot reload, an expiry an earlier copy of nextly's cache module looked up is asked about again before it is judged by, so this copy never judges it by a clock offset it learned before a database failover. If that lookup fails, it is not asked again before the lookup lifetime passes, and meanwhile the expiry counts as no earlier than the failure, so entries begun before then are still refused.

- [#3015](https://github.com/nextlyhq/nextly/pull/3015) [`65a6525`](https://github.com/nextlyhq/nextly/commit/65a6525b84252a4273eeefb1c7347817698a8cac) Thanks [@faisal-rx](https://github.com/faisal-rx)! - After a restart, a delete inside a plugin's own transaction, opened by `ctx.services.collections.withTransaction` or by `ctx.db.transaction`, is now judged by a delete rule's filter on a translated field. Before, such a delete was refused, even for an entry the filter matched, until some earlier write or read had looked at the collection's translation table, because a write inside a transaction cannot look that table up itself.

  At boot, Nextly now looks up each translated collection's, Single's and field group's translation table once, in the background. Startup doesn't wait for it; it costs one database look-up per translated entity. Until it finishes, such a delete is refused as before. A look-up that fails is logged and skipped.

- [#3039](https://github.com/nextlyhq/nextly/pull/3039) [`26617bb`](https://github.com/nextlyhq/nextly/commit/26617bb6cf7b2e8fc050a4c0237a11fd79c746d2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A restore of a version and a take of the live values into a held edit are judged by the update rule in the language they write, as an update in that language is. A rule that refuses one language, such as `update: ({ locale }) => locale !== "de"`, now refuses a restore of a German version and a take of the live values into a German held edit; before, both went through, because the route judged them in every language and the write did not ask the rule again. A rule that allows only one language, such as `locale === "de"`, now allows a restore of a German version and a take of the live values into a German held edit, which it refused before. A rule whose filter is answered by language is matched in the written language: a restore or take that matches the German filter succeeds, and one that does not is refused. This holds for a collection entry and a Single.

- [#2955](https://github.com/nextlyhq/nextly/pull/2955) [`e742eb1`](https://github.com/nextlyhq/nextly/commit/e742eb150894afe3ac99d3613217d950c4fc24ad) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A checked call with no signed-in user and no plugin person, which the Public role doesn't cover, is answered 401 `AUTH_REQUIRED` ("Authentication required.") by the Direct API and plugin services, as REST answers it, instead of 403: signing in could grant what it asked for. A rule that refuses a visitor the Public role does cover is still answered 403. A website page still answers such a refusal with its not-found page.

- [#3086](https://github.com/nextlyhq/nextly/pull/3086) [`d12dc54`](https://github.com/nextlyhq/nextly/commit/d12dc5430c09ef9f938f25797c590b8b1cef892f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `renderWidgetCard` from `@nextlyhq/plugin-sdk/testing/admin` now loads in a jsdom test. It reached `nextly/testing`, whose test instance refuses to load where `window` is defined, so a card test under jsdom failed on import. The card helpers it uses are published on their own as `nextly/testing/widget-card`, which loads in a browser environment; `nextly/testing` still exports them.

- [#2894](https://github.com/nextlyhq/nextly/pull/2894) [`da46404`](https://github.com/nextlyhq/nextly/commit/da46404049de75b57dca86e1cddeedc0b3ef0508) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `defineWidget` takes its fields by the names a widget is read by, and startup
  names every fault of every owner in one message.

  **Breaking for `defineWidget` (`@experimental`).** The fields are renamed, with
  no old spelling kept:
  - `data` is now `load`.
  - `display` is now `view`, which is one of core's views (`"figure"`, `"list"`,
    `"table"`, `"bars"`, `"series"`) or `{ component: "<module>#<Export>" }`.
    Today's display names are not view names: `"metric"` is now `"figure"`, and
    `"timeseries"` is now `"series"`.
  - `empty.when` is now the top-level `isEmpty`, and a view with its own
    component must give it. `empty` holds the message and the action.
  - `example` is now `preview`, a list of named cases, each checked against the
    widget's data and settings types. A case is written
    `{ name, data, settings? }`.
  - `permission` is now `access`.
  - `sketch` is removed: the add panel draws the view's own sketch.

  A declaration still using an old name is refused at startup, and the message
  names the field that replaced it.

  **New, all `@experimental`:**
  - An `icon` field.
  - `category` is optional, and defaults to "Other".
  - The `CoreView`, `WidgetView`, `WidgetAccess`, `WidgetPreviewCase` and
    `WidgetSummary` types, exported from `nextly` and `@nextlyhq/plugin-sdk`.

  **Typed now, judged in a later release:**
  - `access` as the collections a widget reads, or as a predicate of the person;
  - `shows`;
  - `summary`, a label and a count for the dashboard's header.

  Until that release, a declaration using any of these is refused at startup
  rather than started with the rule ignored.

  **Startup:**
  - Core's own widgets, every plugin's and the site's go through one
    registration, so a fault in core's list and a plugin's fault arrive in the
    same message, and nothing is kept until every check passes.
  - A long title or description no longer stops startup.
  - Core's widget list is one module per widget under `core-widgets/`.

  **Core's Note card is declared with `defineWidget`**, as a plugin's widget is.
  It reads the same to its reader, with one exception: an unwritten note's empty
  state now reads "Nothing written yet. Write it in the card's settings.", drawn
  by the card's frame like every other empty card.

- [#2910](https://github.com/nextlyhq/nextly/pull/2910) [`ddd7fea`](https://github.com/nextlyhq/nextly/commit/ddd7fea005595dcc7f7487fea3df18c8aeb44d51) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard widget declared with `defineWidget` now reads its data only through its `load` function, run on the server for the person asking. Its read services read as that person, so two people see what their own access allows. **Breaking:** the `load: { query }` form is removed, along with the `ContentQuery` type the package root exported. A widget still using it is refused at startup with a message saying `load` must be a function. Move the query into a function that reads with the `count` and `find` services it is handed: `load: async ({ settings, services }) => ({ total: await services.count(settings.collection) })`.

  Each card is now decided in order before its data is read. A person who fails the widget's `access` gets the card's "not available" state, and `access` may now be a permission name, `{ collections }` (every collection must be readable by the person, renamed collections included) or a function of the person; a function that throws counts as no access and is logged. A card missing a setting its widget needs draws "Choose <setting> in the card's settings" as its empty state. A widget's `shows` function is now judged per card: when it answers false, the card is left off that person's dashboard and out of the update count, and customise mode shows it marked "Not shown for you right now". A data function that throws, runs past its time budget or answers a value JSON cannot carry fails its own card only, and the cards beside it are still drawn. The log names the plugin, the widget and the reason; the plugin's own error message and stack are logged only in development, since they can hold data.

- [#2903](https://github.com/nextlyhq/nextly/pull/2903) [`4827a40`](https://github.com/nextlyhq/nextly/commit/4827a40af6d90f47c490c92848aa89afca50f115) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection's `update`, `delete`, `publish` and `unpublish` rules may return a filter in their declared type, as its `read` rule may: `defineCollection` types the filter by the collection's own fields, so a misspelt field or operator, or a value of the wrong kind, fails to compile. `CollectionAccessControl`'s `update`, `delete`, `publish` and `unpublish` now accept a rule that answers a filter. Code that stores one of those rules as a general rule should type it `AccessControlFunction | boolean`, which every operation still accepts.

- [#2838](https://github.com/nextlyhq/nextly/pull/2838) [`757ee53`](https://github.com/nextlyhq/nextly/commit/757ee53df21e33209d698ec280937f18af9b0f08) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A collection's `update`, `publish` and `unpublish` access rules may answer a filter instead of `true`. A write through the Direct API or a plugin service, by a signed-in user or an API key, then changes an entry only if it matches the filter. An entry outside the filter is left as it was and refused: with a 403 where the caller may read it, and as a missing entry (404) where it may not. The entry is matched under the write's lock, and a write inside the caller's own transaction is matched in that transaction.

  A write that changes an entry's data must leave it matching every filter that judged it. An update that would move the entry out of its filter is refused with a 403 and changes nothing, and so is a publish that would promote a held edit doing the same. A filter on a translated field is matched in the language being written, and an unpublish of every language at once is matched in the default language. An edit held as a pending change on a published entry is refused when it changes a field the update filter names, and is otherwise held and shown to a caller whose update filter matches the entry.

  Over REST, for the bulk and batch writes, for a release's members, and for a publish of every language at once, an update, publish or unpublish rule's filter is still refused, as before.

- [#2972](https://github.com/nextlyhq/nextly/pull/2972) [`5aa5147`](https://github.com/nextlyhq/nextly/commit/5aa5147400b353a104f891942ac49f82d23a9301) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A content write that couldn't expire its cached pages no longer fails silently. The expiry is retried, then handed off to finish outside the request. The response carries a notice that the change is saved and its public pages may show the previous version for a while. Server Actions now let the writer read their own write at once. A release's pages follow each collection's and Single's `revalidate` settings, so an opted-out collection is left alone and extra tags are expired too.

- [#3024](https://github.com/nextlyhq/nextly/pull/3024) [`d98fada`](https://github.com/nextlyhq/nextly/commit/d98fada0d2eded65a69decfd92be89dc3268670f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin's or the API's yes-or-no question of whether a caller may update, delete, publish or unpublish a collection now answers no when that action's rule answers a filter: `ctx.caller.can(...)` in a plugin route and `nextly.access.check(...)`. Such an answer names no entry and applies no filter. A read under a filter still answers yes. The hints are unchanged, a filter counting as the permission held: the admin's capability cells, a dashboard widget's and an attention item's offer, and giving up a document lock.

- [#2985](https://github.com/nextlyhq/nextly/pull/2985) [`39198ae`](https://github.com/nextlyhq/nextly/commit/39198ae6a970e2e8219a80600e0fbce09f5248ed) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `nextly.access.check` answers with the access decision every route asks. Two answers change. On media, settings and the Email hub, a `manage-` permission now counts as the plain read, create, update and delete it stands for, as every route already counts it, so a role holding only `manage-settings` may update settings by `access.check` too. And for a read, `true` now means the user may read some entries: where a collection's `read` rule answers a filter, the user may read only the entries the filter matches, so read with the user's context (`overrideAccess: false`) rather than as a trusted call, which returns every entry. A write whose rule answers a filter is still refused, and a check that cannot read the user's roles or grants refuses rather than throws.

- [#2639](https://github.com/nextlyhq/nextly/pull/2639) [`86be951`](https://github.com/nextlyhq/nextly/commit/86be951788245067fb5945ca6022709371c42c01) Thanks [@aqib-rx](https://github.com/aqib-rx)! - An access rule on a site whose languages are stored, rather than declared in its configuration, is now told every language the site has. Before, such a rule was told none. A site that declares its languages in its configuration is unchanged.

- [#3022](https://github.com/nextlyhq/nextly/pull/3022) [`3982d12`](https://github.com/nextlyhq/nextly/commit/3982d121d6c334786203b8cb9cdc01593a3e3a55) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The access-control service no longer has a `checkAccess` method. Nothing in Nextly called it any more: every check asks the access decision, and code that asked whether a user may act should ask `nextly.access.check({ userId, operation, resource })`, which answers as the route gate does.

- [#3134](https://github.com/nextlyhq/nextly/pull/3134) [`b667a77`](https://github.com/nextlyhq/nextly/commit/b667a7753fd358386a042f3ecab2413a4a025aad) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Adding a widget to the dashboard now happens in a gallery that shows each widget
  once, drawn small by its own view, instead of a list grouped by collection.

  Open Add widget in customise mode to search widgets or collections, filter by
  All, Content, Activity, Trends or Plugins, and pick from up to four suggested
  pairs, such as "Recent Posts" or "Pages over time". Suggestions follow the
  collections you saved most in the last 30 days, or the ones with the most
  entries if you have saved none. A widget that reads a collection opens a short
  add step in the same panel: choose the collection (it starts on the one you
  edit most), the period where the widget has one and the width, and see the card
  previewed before Add to dashboard. A widget that reads no collection is added
  straight away. Searching a collection's name lists each widget that can read it
  as a pair, such as "Count · Posts", which adds with that collection chosen.
  Cards you removed this session are listed first and come back with their
  settings.

  What the gallery offers is decided on the server, as the person asking, by the
  new `GET /api/dashboard/gallery`. It leaves out any widget whose own `access`
  or `shows` refuses them, and any collection they may not read or that is kept
  off the dashboard.

  Core's Count, Over time, Breakdown and Note widgets now declare a preview case
  of sample data, which their gallery tiles are drawn from.

- [#2901](https://github.com/nextlyhq/nextly/pull/2901) [`06dd5a0`](https://github.com/nextlyhq/nextly/commit/06dd5a01d480b8bc51778d5ced273431772c45f1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin accepts the plain settings and email permissions. Settings pages are shown on `read-settings` and used on the permission their action names: creating an image size or a user field asks `create-settings`, editing one `update-settings`, and the plugins area any settings change. A role that may only read settings sees General, Image Sizes and User Fields read-only: it may open a user field to see it, and is offered no save, add, edit, delete or reorder it would be refused. A plugin's "Open settings" link is shown only to a caller its settings page lets in. A role still holding `manage-settings`, `manage-email-providers`, `manage-email-templates` or `manage-media` keeps every page it had, since the admin counts each as the plain read, create, update and delete it stands for, as the server does. A plugin that names no settings permission of its own now asks `update-settings` (before, `manage-settings`, which still counts as it).

- [#2819](https://github.com/nextlyhq/nextly/pull/2819) [`a71a6b9`](https://github.com/nextlyhq/nextly/commit/a71a6b95fe6429908ac6c7ad41abfe475bd8e7b8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin asks each request it sends as the server judges that request: the localized list, the editor and quick-edit ask for every language's translation state only where the server lets the user read them all, the list and quick-edit in the default language their reads are sent in, and otherwise show no Languages column or language filter; the version history and its compare pages are offered only to a user who may read the whole history, in every language, and are not offered at all otherwise; Publish all languages warns that languages whose state could not be read may go live too; Publish all languages, a create (sent with no language, so in the default one) and the quick-edit modal's save each follow their own answer from `GET /me/capabilities`. The permission list is asked again when the role assignment it was read under ends. `/me/permissions` answers an API key with the key's own permissions.

- [#2896](https://github.com/nextlyhq/nextly/pull/2896) [`318499c`](https://github.com/nextlyhq/nextly/commit/318499c76f2216e2db6fca7aec122eb1d964a915) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - ---

  The admin's bundle size is now checked on every CI run, so a change that makes it noticeably bigger fails with the size it measured and the budget it broke. The total the package ships stays within 3,500 KB minified; the code every admin page shares stays within 280 KB gzipped; and each page is held to its own measured size plus 10%. A new page has to be measured and pinned when it is added (`pnpm --filter @nextlyhq/admin check:budgets --pin`). Lazily loaded pages now ship in chunks named after their place in the admin, so each can be told apart from build to build.

- [#2859](https://github.com/nextlyhq/nextly/pull/2859) [`c9763fe`](https://github.com/nextlyhq/nextly/commit/c9763fe073d73af003b5837fe920a39bc4e9cd3a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin rail has one Content item in place of Collections and Singles. Its panel switches between the two with a segmented control, and one search finds either kind and marks the other part when it has matches.

- [#2938](https://github.com/nextlyhq/nextly/pull/2938) [`f0ec3fb`](https://github.com/nextlyhq/nextly/commit/f0ec3fb59f96493488d9b21782a34900faabbab7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An app scaffolded with `create-nextly-app`, or one it adds Nextly to, renders its admin for each request, never from a cache another user's request filled. Its admin layout renders its shell statically and awaits `connection()` beneath a Suspense boundary, so with Cache Components on the build still prerenders the shell, and nothing the admin reads is shared between users. Adding Nextly to an existing app writes the base template's own admin layout, so it renders the same way as a new project. The plugin template's development app gets the same admin layout.

- [#2850](https://github.com/nextlyhq/nextly/pull/2850) [`fb23a75`](https://github.com/nextlyhq/nextly/commit/fb23a7538776e1d2a592b26db699f4b818d90a51) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin no longer shows an empty page while the server is starting. A signed-in screen says it is loading at once, says the server is starting after a few seconds, and offers Try again after about 45 seconds; if the server cannot be reached, it says so with Try again instead of sending you to the login page. The login and setup pages draw at once and check the session in the background.

- [#2876](https://github.com/nextlyhq/nextly/pull/2876) [`3f1c3bc`](https://github.com/nextlyhq/nextly/commit/3f1c3bcde9ee84bff5513400a26c5905f6a6485a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Admin pages open faster after a hover. Pointing at a link, focusing it with the keyboard or touching it now starts loading that page's code, so the click usually finds it ready. Downloads and links to other sites are left alone. While a page's code is still loading, the spinner appears only after 200 ms, so a fast load no longer flashes it. Screen readers still hear "Loading" straight away. If a page's code fails to load, the error is written to the browser console and a later visit tries again.

- [#3045](https://github.com/nextlyhq/nextly/pull/3045) [`75cd420`](https://github.com/nextlyhq/nextly/commit/75cd4204f60b3c3d051901eb9b3ac16182fafef2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's rich-text editor and a release's page load less code: the editor about 80 KB less, minified, and a release's page no longer loads the document history screen's rows to name who did what. Both work and look as before.

- [#2521](https://github.com/nextlyhq/nextly/pull/2521) [`e8c62cf`](https://github.com/nextlyhq/nextly/commit/e8c62cf0d04069f642658ec8f9e7a8be234c898f) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Admin pages load on demand: opening any screen fetches the shared shell and that screen's chunk instead of every page's, with a loading state while the chunk arrives and a retry when its fetch fails. The first screen no longer downloads the other 58 pages; the finer split adds per-chunk overhead, so the shipped total is slightly larger.

- [#2909](https://github.com/nextlyhq/nextly/pull/2909) [`892f387`](https://github.com/nextlyhq/nextly/commit/892f387bf599f1aa0dac083713e33c576dd05a08) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every admin screen now names its browser tab, as in "Posts · Golden Shop": the screen, then your site's name, with the item's name first on a screen that shows one, so several admin tabs and their history entries can be told apart.

- [#3064](https://github.com/nextlyhq/nextly/pull/3064) [`b72584f`](https://github.com/nextlyhq/nextly/commit/b72584fa00234c66bfe12140bfc63eccf70d8049) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On a wide screen, the admin's main column no longer slides sideways when the second sidebar panel opens or closes. Moving between the dashboard and a collection list, the media library, a plugin or settings used to move the whole column 256 px as the panel beside it opened and closed. The panel's column is now held on every screen of the wide layout, empty where the screen has no panel, so the column the reader was reading stays where it was. Screens without a panel, the dashboard among them, are 256 px narrower as a result, and the dashboard's cards wrap to that width; nothing saved changes. An editor that takes the full width still releases the panel's column, and on a phone the panel still opens over the page in the navigation drawer.

- [#2944](https://github.com/nextlyhq/nextly/pull/2944) [`ef8d848`](https://github.com/nextlyhq/nextly/commit/ef8d8489cbacd58864303f5bad7d78117d9ee23a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On a fresh load, the admin's sidebar and header no longer move while they fill in. The sidebar's icons used to be pushed down as the sections the reader's permissions and content decide arrived, and the header's controls slid sideways when the notification bell joined them. The sidebar now draws its icons only as far as is already decided, so each one that arrives later lands below the ones drawn, and the header draws the account menu at once and the controls beside it together once what decides them is known.

- [#2886](https://github.com/nextlyhq/nextly/pull/2886) [`e670881`](https://github.com/nextlyhq/nextly/commit/e670881fa44c5f4ef7301dcc809517d3d96727bf) Thanks [@faisal-rx](https://github.com/faisal-rx)! - When the server refuses an action, the admin now shows the server's own message as it is, such as "You can't delete this post.", rather than putting "Failed to delete entry:" in front of it. A refused entry list says so in place of the empty state, and a collection read that the server answers with 404 is no longer read again as a Single unless the slug is one.

- [#2897](https://github.com/nextlyhq/nextly/pull/2897) [`1adbe35`](https://github.com/nextlyhq/nextly/commit/1adbe35bd89c843b253a1443eb9f46e5b8ce757f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin has a "Skip to content" link, the first thing Tab reaches on every page. It moves focus past the rail, the sidebar and the header into the page's main region, so a keyboard user no longer tabs through every collection and Single on each page. It stays hidden until it has focus.

- [#2881](https://github.com/nextlyhq/nextly/pull/2881) [`9f3c012`](https://github.com/nextlyhq/nextly/commit/9f3c012eed9695ee2630bf160931d487fc2bf0cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's stylesheet is now generated from the admin's own code, the shared UI components and the first-party plugin screens, and nothing else in the package. Before, the build scanned every file in the package, prose included: a note or changelog quoting a class with an unfinished value such as `[var(...)]` produced invalid CSS that took down every admin page, and classes quoted in the changelog were shipped in the stylesheet. The stylesheet loses only those quoted classes; nothing the admin draws changes.

- [#2926](https://github.com/nextlyhq/nextly/pull/2926) [`68e9366`](https://github.com/nextlyhq/nextly/commit/68e93669166d2131d17fef66a74a6ec31d9e9835) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's empty state can now offer the card's own settings as its action: `empty: { action: { label: "Choose a collection", opens: "settings" } }` beside the existing `{ label, link, permission? }`. The card draws it as a button that opens that card's settings sheet with focus on its first field. The button appears only at rest, and only where the reader can change that card's settings, so a settings preview, customise mode, or a card whose settings can't be saved right now shows the message alone. Startup refuses an action that gives both `opens` and a link or permission, any `opens` value other than `"settings"`, and `opens: "settings"` on a widget that declares no settings. Core's Note uses it: an unwritten Note now reads "Nothing written yet." with a "Write a note" button.

- [#2971](https://github.com/nextlyhq/nextly/pull/2971) [`f5b4f3e`](https://github.com/nextlyhq/nextly/commit/f5b4f3e36a9f8805d91b46a444d82f28324c831a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An unpublished or unknown blocks page answers 404 again when Cache Components is off, which is every app's default. The page factories in `@nextlyhq/blocks-react/next` wrapped their read in a Suspense boundary, so the page's shell streamed before `notFound()` ran and the request answered 200 with the not-found page. They now add the boundary only under Cache Components, where a static shell needs it, and read before the page returns otherwise.

  `nextly/runtime` now exports `cacheComponentsEnabled(value)`, which says whether a value means Cache Components is on: the config's `true`, or the `"true"` Next.js inlines into an app's bundle as `process.env.__NEXT_CACHE_COMPONENTS`.

- [#2948](https://github.com/nextlyhq/nextly/pull/2948) [`0e7928e`](https://github.com/nextlyhq/nextly/commit/0e7928ed7d6204996b77e7a02ca470b9bd3a6bea) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An upload keeps the alt text it is given. `nextly.media.upload({ file, altText })` stored every file without its alt text, so anything that needs one on a new image had nothing to read. The blog template's demo seed, for one, failed most of its posts, because a post refuses a featured image with no alt text. Alt text set on a file afterwards was never affected.

- [#3127](https://github.com/nextlyhq/nextly/pull/3127) [`2e31455`](https://github.com/nextlyhq/nextly/commit/2e31455a1bb3e27f9549690963a8f9bb6ea995c9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Breaking: image sizes are no longer made or offered.** An uploaded image is now stored as the original and one thumbnail, nothing more. The thumbnail is the whole image fitted inside 480×480, keeping its proportions and never enlarged, instead of a 300×300 centre crop. Moving an item's focus point saves the point and stores no new file.

  What an app loses, and what to use instead:
  - The sizes defined at **Settings › Image sizes** are no longer cut at upload or when the focus point moves. The screen, its menu entry and the `/admin/api/image-sizes` routes (list, get, create, update, delete, `regeneration-status`, `regenerate`) are removed; a request to one is answered as an unknown route (404).
  - Media items no longer carry `sizes` in any API: REST, the Direct API (`MediaFile`), server actions, populated relationships and Singles, and `media.*` webhook payloads. The `Media` type `@nextlyhq/admin` exports loses `sizes`.
  - Removed from `nextly`: `getMediaVariant`, `getSmallestMediaVariant`, `GetMediaVariantOptions` and `MediaLike`. Removed from `nextly/storage`: `generateImageSizes`, `deleteImageSizes`, `ImageSizeConfig`, `GenerateImageSizesOptions`, `UploadFn`, and `ImageProcessor.resizeWithFocalPoint`. Removed from `nextly/schemas` (and the root): the `imageSizes` table.
  - Instead: give an item's `url` to `next/image`, which resizes it on request (a custom loader can send that to an image CDN); use `thumbnailUrl` for a small preview; and use `focalX` and `focalY` with `object-position` to keep the subject in frame.

  Nothing stored is removed by this release. Items uploaded before it keep their `sizes`, their size files and their square thumbnail, and the `image_sizes` table and its rows stay; none of it is read. Deleting such an item still removes its size files.

- [#2932](https://github.com/nextlyhq/nextly/pull/2932) [`f26504c`](https://github.com/nextlyhq/nextly/commit/f26504cf648899ec35d40dc29e01c67f183a7feb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `system:attention` answers a new `list` query, the attention digest: each reader's open work, read
  as that reader at read time, one item per thing waiting. The grouped answer the current Needs
  attention card reads is unchanged.
  - Each item carries `id`, `kind` (`stopped`, `overdue` or `plugin`), `label`, `count`, `atLeast`
    when the count is a floor, `severity`, an admin-relative `link`, and `failed` when it could not
    be counted (`@experimental`).
  - Core's kinds are releases that stopped and overdue releases, both critical, each the releases
    domain's own count, linked to Releases filtered to its reason, and shown only to a reader of
    releases.
  - Plugins' attention items (`contributes.dashboard.attention`) now reach the digest as warnings.
    An item with `permission` shows only to a holder of it, and one with `collections` only to a
    reader of one of them. Who may see an item is asked within its own budget, and a check that
    fails or runs out of time hides the item. Its `count` reads only those collections, as the
    reader, and one the reader cannot read answers empty.
  - Every item is counted at once, each within its own 10-second budget. One that throws, runs out of
    time or answers something that is not a count fails alone and is logged with its plugin and id.
    Counts above 99 read as 99 and a floor. A reader whose access to releases cannot be read is
    shown neither release kind.
  - Startup refuses, in the one dashboard fault message, an attention item that breaks its shape,
    repeats another's id, uses the reserved `core`, `collection` or `single` namespace, names a
    permission other than in its stored `action-resource` form, or is one of more than 10 from a
    plugin. An item naming a collection the site does not have is warned about
    and shows to nobody.

- [#2898](https://github.com/nextlyhq/nextly/pull/2898) [`09f5858`](https://github.com/nextlyhq/nextly/commit/09f5858b8e522a1eda4845210bb7ce75f1403a9e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A cached dashboard is refetched when any widget's Collection setting changes, including one its widget's query does not read: the settings sheet and the workspace still show such a setting, so a change to it no longer leaves the earlier payload in place.

- [#3072](https://github.com/nextlyhq/nextly/pull/3072) [`d1b6d9c`](https://github.com/nextlyhq/nextly/commit/d1b6d9c08522b938e10c41d8aa5297e2e41d2923) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Going Back or Forward from a document with unsaved changes asks before leaving again on an app rendered with Cache Components. There the admin's code arrives after Next's router has started listening for Back, so the router moved to the page Back was going to before the admin was asked, and the changes were lost without a word. Where the browser lets a page cancel Back (it does once the reader has used the page), the admin now cancels it before it moves and asks; where it does not, or where the browser has no Navigation API, it asks as before. Nothing changes for an app without Cache Components, and a Back with nothing unsaved is never touched.

- [#3092](https://github.com/nextlyhq/nextly/pull/3092) [`f538b9c`](https://github.com/nextlyhq/nextly/commit/f538b9cb28e7acc654def96c84725ecbf454c5c9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Going Back from a document view, such as the Page Builder, to the document's own form now lands on the form on an app rendered with Cache Components. There the view, kept mounted while hidden, wrote the field it was editing onto the form's address as Back showed it again, so Back seemed to do nothing. A view now corrects the field in the address only while the address is still its own.

- [#2928](https://github.com/nextlyhq/nextly/pull/2928) [`f5f5d8d`](https://github.com/nextlyhq/nextly/commit/f5f5d8de1aa7ed30db983afcc8b6641022848312) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A blog category or tag whose slug is `__none__` renders its posts. The blog's archive routes give the build that slug as a placeholder when the site has no archives yet, and its page answered the not-found page on every request too, so a real archive with that slug could never be seen. The placeholder now stops before the database only while `next build` runs.

- [#2906](https://github.com/nextlyhq/nextly/pull/2906) [`f5a4d1b`](https://github.com/nextlyhq/nextly/commit/f5a4d1b2ce0d797225bca76f8ceb6db0efef7820) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The blog template's category and tag pages no longer answer 500 on a site built before it had any categories or tags. Both an unknown archive and one created after the build failed, because Next.js took the archive routes for static when the build rendered none of them. The build now always renders one, so it learns the pages read the request. An unknown archive shows the not-found page, and one added after the build lists its posts, page 2 included.

- [#3069](https://github.com/nextlyhq/nextly/pull/3069) [`e1b87f4`](https://github.com/nextlyhq/nextly/commit/e1b87f4f1d0c926a5b95633400f4e6284ea2a43f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The blog template lets an author edit and delete only the posts they wrote, while anyone who may publish posts changes every post. A blog scaffolded with the visual approach has no such rule, so its seed gives authors no delete permission on posts.

- [#2925](https://github.com/nextlyhq/nextly/pull/2925) [`a9961b2`](https://github.com/nextlyhq/nextly/commit/a9961b25af06b8e6608a57003a7588b2c4306223) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The blog template's migration creates the `first_published_at` column on its posts, categories, tags and Singles. Without it, a blog scaffolded with the visual approach failed every read of those tables ("no such column first_published_at"), so its pages errored. The migration's `status` columns are now `NOT NULL`, and posts' `content` column is `text` on PostgreSQL and MySQL, as nextly builds them.

  On MySQL the migration failed part way: MySQL has no `CREATE INDEX IF NOT EXISTS`, keys no TEXT column without a length, and refuses a foreign key between tables of different collations. Its indexes are now plain `CREATE INDEX`; the columns that reference a row (`user_ext`'s ids, posts' `author` and `featured_image`, Site Settings' `logo`) and the author `slug` are varchar columns; and its tables take the database's collation, as nextly's own `users` and `media` do. Author slugs stay unique, as on PostgreSQL and SQLite.

  A blog scaffolded with the visual approach before this release keeps the migration it was created with, so it needs the column added once. On PostgreSQL:

  ```sql
  ALTER TABLE "dc_posts" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
  ALTER TABLE "dc_categories" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
  ALTER TABLE "dc_tags" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
  ALTER TABLE "single_site_settings" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
  ALTER TABLE "single_navigation" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
  ALTER TABLE "single_homepage" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
  ```

  On MySQL:

  ```sql
  ALTER TABLE `dc_posts` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
  ALTER TABLE `dc_categories` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
  ALTER TABLE `dc_tags` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
  ALTER TABLE `single_site_settings` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
  ALTER TABLE `single_navigation` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
  ALTER TABLE `single_homepage` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
  ```

  On SQLite:

  ```sql
  ALTER TABLE "dc_posts" ADD COLUMN "first_published_at" INTEGER;
  ALTER TABLE "dc_categories" ADD COLUMN "first_published_at" INTEGER;
  ALTER TABLE "dc_tags" ADD COLUMN "first_published_at" INTEGER;
  ALTER TABLE "single_site_settings" ADD COLUMN "first_published_at" INTEGER;
  ALTER TABLE "single_navigation" ADD COLUMN "first_published_at" INTEGER;
  ALTER TABLE "single_homepage" ADD COLUMN "first_published_at" INTEGER;
  ```

- [#3154](https://github.com/nextlyhq/nextly/pull/3154) [`058c212`](https://github.com/nextlyhq/nextly/commit/058c2121b64d0dc1c7a846ded9557a8e58be7db2) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Cache Components and Partial Prefetching are now on in every Nextly app, and Nextly supports only that state.
  - A project `create-nextly-app` creates sets `cacheComponents: true` and `partialPrefetching: true` in its `next.config`, with Nextly's cache handlers (`cacheHandler`, `cacheMaxMemorySize: 0` and `cacheHandlers.default`), which make the first read after a write show the new version. A `next.config.mjs` defines `require` with `createRequire` to resolve them.
  - A new blog's `src/nextly/cached-read.ts` is the `"use cache"` read function itself, so its reads go through it from the start. The separate `cached-read.cache-components.txt` is gone.
  - When `create-nextly-app` adds Nextly to an existing app, it turns both options on where either is off or missing, including in an app an earlier Nextly release turned off, and adds Nextly's cache handlers. Its report names each change. A setting it can't read safely (a spread, a computed value, a wrapper call) leaves the file as it was, and the report prints the exact lines to add. A config with a cache handler of its own keeps it, and the report prints Nextly's handler lines.
  - The blank template's home page reads the admin's setup status inside a `<Suspense>` boundary, so it prerenders as a static shell under Cache Components.
  - Nextly warns once at start when Cache Components is off, from the value `instrumentation.ts` passes to `createRegister`, and `withNextly()` warns once when either option is off in the config it wraps. `partialPrefetching` reaches no code while an app runs, so only `withNextly()` can check it. The old warning that Cache Components is unsupported is gone.

  `createRegister(config, { cacheComponents })` is unchanged: keep passing `process.env.__NEXT_CACHE_COMPONENTS` from `instrumentation.ts`.

  **Upgrading an app made by an earlier release**, which has `cacheComponents: false`: run `create-nextly-app` in the app again, or set `cacheComponents: true`, `partialPrefetching: true` and Nextly's cache handlers in `next.config` by hand. A blog also replaces its stub `src/nextly/cached-read.ts` with the read function the caching guide prints. What to set, and why: https://nextlyhq.com/docs/getting-started/installation#cache-components

- [#3129](https://github.com/nextlyhq/nextly/pull/3129) [`6085158`](https://github.com/nextlyhq/nextly/commit/608515882b7f1d8b6ddb90d55c3264f20ee83475) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Under Cache Components, Nextly's cached reads can now go through a `"use cache"` function of the app's own, registered with the new `registerCachedRead` and `runRegisteredRead` from `nextly/runtime`, so a page read right after a write shows the new version with Nextly's cache handlers installed. The blog template ships `src/nextly/cached-read.ts` as a stub that registers nothing while Cache Components is off, and its Cache Components version beside it. A read with `revalidate: false` stays tag-only, and one past its `revalidate` is refreshed in the background. A read outside a request or build, in a script or a background job, runs directly, uncached.

  `withNextly()` and Nextly's start no longer warn that Cache Components is unsupported and should be turned off. Instead, with Cache Components on and no function registered, Nextly warns once at the first cached read, naming the file to add. `create-nextly-app` still writes Cache Components off, now as Nextly's default, and links to how to turn it on. Nothing changes with Cache Components off.

- [#3122](https://github.com/nextlyhq/nextly/pull/3122) [`9f40d47`](https://github.com/nextlyhq/nextly/commit/9f40d47a8ef49a338b2d2023bd2b70842f2fcaf0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Two cache handlers for `next.config`: `nextly/cache-handler` for `cacheHandler` (with `cacheMaxMemorySize: 0`) and `nextly/cache-handlers` for `cacheHandlers.default`. They keep entries in each instance's memory, at most 50 MB each, least recently used first out. Before serving an entry they ask the cache tag expiry ledger, by key, when its tags last expired, so a write recorded there from another instance or outside a request expires the entry within seconds. An answer is reused for five seconds. An entry older than the ledger keeps an expiry (seven days) is never served.

  The handlers don't read the ledger yet: nextly will hand it to them at startup in a later release. Until then they expire only what their own instance expires, as Next.js's default handlers do.

- [#3170](https://github.com/nextlyhq/nextly/pull/3170) [`21f7246`](https://github.com/nextlyhq/nextly/commit/21f724657f247c0af2a99f78390c6bf30676ae13) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Without nextly's cache handlers, a cached public read in production is now given a revalidate of 30 seconds, so a write from another instance, the CLI or a job shows within a minute of a visit: the first read past the 30 seconds is served the previous version once while it refreshes, and the next is fresh. The app's `"use cache"` read function, as `create-nextly-app` writes it, now expires a timed read at twice its revalidate and never within 5 minutes (`Math.max(revalidate * 2, 300)`, where it was `60`), so it serves no entry older than 5 minutes. Next.js leaves a `"use cache"` entry that expires within 5 minutes out of a static prerender, and a route that must be static (`ensureStatic`) then fails to build. A read with no such function registered is refreshed at 30 seconds but not expired. The warning for this case says it applies to an app that keeps a cache handler of its own too, and links the installation guide.

  Who sees a change: an app without nextly's handlers, including one made by an earlier release with Cache Components off, now refreshes its cached public reads at 30 seconds rather than 60, through `unstable_cache`. Its reads are fresher, at the cost of rebuilding each one about twice as often. The 5-minute expiry concerns only an app that turned Cache Components on by hand without nextly's handlers, since a new app ships the handlers. If your `src/nextly/cached-read.ts` has `Math.max(revalidate * 2, 60)`, change the `60` to `300`.

  The warning for Cache Components or Partial Prefetching being off now goes through nextly's logger, as `cache-components-off` (and `cache-components-unknown` when `createRegister()` isn't told the value), so an app's own logger receives it. A line said while Next.js loads the config, before `instrumentation.ts` has run, waits for the app's logger and goes out when one is installed, when `register()` runs, after ten seconds, or as the process exits, whichever comes first. It no longer repeats the cache handlers, which have a warning of their own.

  `create-nextly-app` no longer writes `require.resolve(...)` handler lines into an ES module `next.config` that declares `require` after its config object, where loading the config would throw. It prints the lines instead, and says to move the declaration. When it keeps an app's own cache handler, its report says what that costs: cached public reads refresh within a minute of a visit.

- [#2797](https://github.com/nextlyhq/nextly/pull/2797) [`8508a09`](https://github.com/nextlyhq/nextly/commit/8508a09575b826db83eb8368fc4de667639bc9df) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The `@experimental` `GET /me/capabilities` answer gives each collection and Single a cell for each request the admin sends whose languages differ from its action's own: `readTranslations` (a read with every language's translation state, such as a localized list or a document with `translation-status`), `readHistory` (the version history of every language), `publishEveryLanguage` (publishing every language at once, the publish rule asked once for each configured language), `createInDefaultLanguage` and `updateInDefaultLanguage` (a create or an update sent with no language, which writes the default one; a Single has no create), and `duplicate` (a copy of a published entry: the source read and the create, in the default language and its fallbacks, and publish too where the collection has a Draft/Published lifecycle, since the copy is created published; a draft never published cannot be copied, whoever asks; collections only). A cell answers for every document of its collection, so where the request depends on the document (`publishEveryLanguage`, `duplicate`) it takes the strict side and never offers what the route might refuse for some document. Each is the answer the route gives that request. `GET /me/permissions` now returns `validUntil`: when the permission list stops holding, the soonest end of a role assignment it was read under, or `null`.

- [#3155](https://github.com/nextlyhq/nextly/pull/3155) [`ad522bb`](https://github.com/nextlyhq/nextly/commit/ad522bbdf58de9340e26ec7aee6f596ddccbbe45) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Keep a cleared card title and an emptied filter, and see a hoisted `var` as a taken name in `nextly generate:widget`.
  - **A cleared card title stays cleared.** A reader who clears the Title of a card the site's default titles now keeps the automatic title: the layout stores the clearing as an empty `title` (`""`), which the default's own title no longer comes back over. An empty title reads as automatic, as no title does. Rows stored before have no `title` where a reader cleared one, and keep reading as they did.
  - **Removing a filter's last chip keeps the card unfiltered.** Where a widget's Filter has a default, removing its last chip stores an empty filter (`{}`), as the preview's Clear filters does, so the default no longer filters the card again or comes back as a chip.
  - **`nextly generate:widget` sees a hoisted `var`.** A `var` inside a top-level `if`, loop, block, `try` or `switch` of `nextly.config.ts` counts as a name already taken, so the command does not add an import that would collide with it. A `var` inside a function, and a block's `let` or `const`, stay in their own scope.

- [#3107](https://github.com/nextlyhq/nextly/pull/3107) [`8a9d59c`](https://github.com/nextlyhq/nextly/commit/8a9d59c7bf8bd599b239096df7cc5b6306f4e4fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A card's More settings opens a side panel that shows the card as it will look, beside a dashboard that stays usable.
  - **The panel is not modal.** The dashboard behind it can still be read and clicked, and clicking it does not close the panel. The panel is 480 to 560 px wide, and full width on a phone.
  - **A live preview at the top** draws the card at the size tier its real width gives it, scaled down to fit when the card is wider than the panel.
  - **The settings are grouped into Data, Display and Advanced**, and Advanced starts folded. Each section shows only what the widget declares, and Display always holds the card's title. Each section has its own Reset to defaults link.
  - **Filters are chips** ("Title is Hello ✕"). A card can have several, joined with AND, and "+ Add filter" adds one. One condition is stored as before; two or more are stored under `and`. The fields offered are still only those of the chosen collection that no read rule can refuse.
  - **Changing the collection says what it reset**, beside the Collection field: "Changing the collection reset Filter and Sort".
  - **The preview says "No entries match these filters"**, with Clear filters, when the panel's filters match nothing.
  - **Done saves and Cancel or Escape discard.** Leaving the page with changes still in the panel asks first, with the admin's usual Save, Discard and Keep editing. While customising, the dashboard's own prompt asks instead, so a leave is asked about once. Its Save keeps an open panel's change in the saved arrangement, as the panel's Done would. If the panel would refuse that change (a title too long, a filter begun and not finished), Save stops and nothing is saved: the panel says what to fix, with focus on it. Discard drops both.
  - **A filter begun and not finished is refused on Done**, with "Finish this filter, or remove it." Before, it was saved without that filter.
  - **One panel at a time.** Opening another card's settings closes a panel with nothing unsaved. A panel holding a change asks first, and the other card's panel opens only once the reader has answered.
  - **A card's automatic title** names its subject and its range ("Posts · last 30 days"), with the widget's name beneath it ("Over time").

  Published additions (all `patch`):
  - **`section`** on a widget setting: `"data"`, `"display"` or `"advanced"`, accepted by every setting builder, and refused at startup when it is anything else. Unset, a setting over the card's content (Collection, Filter, Sort, Group by, Field) and a date range are drawn under Data, and every other setting under Display. A setting goes under Advanced only when it says so. Core's list cards fold their Density there.
  - **`title`** on a dashboard placement: the title a reader gives one card. It is trimmed, holds at most 80 characters, and is checked by the same layout write as the rest of the placement. Empty or absent means automatic.
  - **`MAX_CARD_TITLE_LENGTH`** from `nextly/config`: the bound the layout write applies to that title, so the admin's field uses the same number.

- [#2871](https://github.com/nextlyhq/nextly/pull/2871) [`05d6439`](https://github.com/nextlyhq/nextly/commit/05d643927a4a06449a2388c60a75402348dd5a76) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's charts are drawn by Recharts 3, behind the admin's own chart components, and
  look as the redesign draws them: an area under a line with its value axis, gridlines and dates,
  and a dashed rule, a hollow point and a tooltip on the point in view; a chart of groups as rows of
  name, bar and count. `GroupsChart` and `OverTimeChart` keep their names and props.
  - The chart engine loads only where a chart is drawn, never in what the admin loads before its
    first screen, and no published type names it. A new CI check, `check-bundle-boundaries`, holds
    both.
  - Every chart's numbers are in a visually hidden table that assistive tech can always reach, in
    place of the "View as table" disclosure, which hid them until opened.
  - A chart animates its marks in only when the person has not asked for reduced motion.
  - A chart of statuses keeps each status's colour on every card. A chart of any other field draws
    every bar in the first chart colour, where each value used to take a colour hashed from it.
  - The five chart colours, `--nx-chart-1` to `--nx-chart-5`, are re-tuned so that each pair stays
    apart for readers with protanopia, deuteranopia or tritanopia, in light and dark, and still
    clear 3:1 against the card, a bar's track and the tooltip. A theme that sets its own chart
    colours is unaffected.

- [#2888](https://github.com/nextlyhq/nextly/pull/2888) [`a2eb334`](https://github.com/nextlyhq/nextly/commit/a2eb334ffedf141f7554b9aa43fded353dd03196) Thanks [@faisal-rx](https://github.com/faisal-rx)! - On the roles screen, a role built on a base role now holds only its own permissions. The base's are shown ticked and locked but are never saved onto the role, so they no longer outlast a change to the base. Clear All takes away everything the role holds itself, and a new role built on one base with no permissions of its own is told it needs one before anything is saved.

- [#3005](https://github.com/nextlyhq/nextly/pull/3005) [`eb94c2a`](https://github.com/nextlyhq/nextly/commit/eb94c2a556c7969ca3deed8a4ab5919957957c18) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Every `nextly` command that fails now ends with the same four lines: what happened, why, what to run next, and a link to the page for its error code, under a code of its own (`CONFIG_NOT_FOUND`, `CONFIG_SYNTAX_ERROR`, `SCHEMA_LOCK_HELD`, `DATA_LOSS_CONSENT_REQUIRED` and the others listed at https://nextlyhq.com/docs/cli/errors). It no longer prints an internal envelope such as `[INVALID_INPUT] Failed to load Nextly configuration. | Config loader error | context: {…}`, and a configuration's syntax error is shown once, with its file, line and column. `--verbose` (or `DEBUG=1`) adds the internal context and the stack below those lines. The CLI's codes are separate from the REST API's error codes, which are unchanged; each keeps its meaning in later releases, and the codes the production-migrations guide documents (`MIGRATION_TAMPERED`, `MIGRATION_MISSING`) keep their spelling. The exit code of a failed command is still 1.

- [#2874](https://github.com/nextlyhq/nextly/pull/2874) [`0afea88`](https://github.com/nextlyhq/nextly/commit/0afea8802f6fdb9dcb7bb089c97094adb188c8f5) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Get started card is compact: twelve columns by four rows by default, and as short as three. It draws the whole steps its rows hold, then "Show N more", which grows the card in place to show every step; "Show less" folds it back, and the card is drawn at its own size again on the next load. Nothing is saved by either.

  A card that is empty, failed or not available to its reader now shows its message centred in the card rather than at its top-left, so a tall card no longer looks unfinished.

- [#2610](https://github.com/nextlyhq/nextly/pull/2610) [`559363f`](https://github.com/nextlyhq/nextly/commit/559363f1cce8abbeefd2845fb6b62a382f4b6d9e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Removed `ServiceContainer.withTransaction` and `ServiceDispatcher.withTransaction`. Both opened a transaction and then ran their callback on services that used the pooled connection, so nothing they did was atomic, and on a pool of one connection they waited forever. Neither had a caller. Use the database adapter's `transaction()` instead, and hand the work inside it the transaction it is given.

- [#3087](https://github.com/nextlyhq/nextly/pull/3087) [`c61f59e`](https://github.com/nextlyhq/nextly/commit/c61f59ebe7f235aeb200181923910df9b9766f6a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Recently edited card is replaced by **Continue where you left
  off**. Its header offers two tabs, as a segmented control: **Mine**, the default, lists the entries and
  Singles you pinned, in the order you pinned them, then the ones you saved most
  recently; **Team** lists what other people saved most recently, each with who
  saved it. Every row shows the collection's icon, the entry's title, "<collection>
  · edited <time>" and its status (Draft, Published, Changed, Scheduled), opens the
  entry, and has Pin or Unpin in its "…" menu. A title is read as you may read it
  now: an entry you can no longer read, or one that was deleted, is left out.

  Removed, with no alias: the `core/recently-edited` widget and the
  `system:recent-edits` source. A saved dashboard naming `core/recently-edited`
  keeps an empty place for it until the reader arranges it again; a site config
  that names it (`defaultLayout`, `hide`, `replace`, `overrides`) is refused at
  startup and should name `core/continue` instead. The exported `CoreWidgetId`
  type names `core/continue` in its place. A widget source may now narrow by a
  `tab` filter (`"mine"` or `"team"`, `@experimental`).

  A card's quick setting that is a choice of exactly two options is now drawn on
  its header as a segmented control (a radio group: the arrows, Home and End move
  and choose) rather than a dropdown; a choice of any other number of options
  keeps the dropdown.

  Pins: a pin whose entry or Single no longer exists is removed when your pins
  are read and no longer counts toward the limit of 20, and two pins made at the
  same moment can no longer take a reader past that limit.

- [#2820](https://github.com/nextlyhq/nextly/pull/2820) [`999f3ba`](https://github.com/nextlyhq/nextly/commit/999f3ba2b1b65c92cb7b540eb8eb68226c1963af) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Wherever the document panel holding an entry's or a Single's ID is not on screen (a phone, a tablet, or a collapsed panel), the strip under the editor's header shows the ID with a control to copy it, for a user who may only read the document as for one who may change it. A copy the browser refuses, or a page served without clipboard access, says so and shows the ID to copy by hand.

- [#3171](https://github.com/nextlyhq/nextly/pull/3171) [`52dc872`](https://github.com/nextlyhq/nextly/commit/52dc8725866b77ccd5e89624ac7154c2e727a0f1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's Content, Team, Continue where you left off, Upcoming releases and Team activity cards are now declared with `defineWidget`, like every other core card but Create, and are answered on the server by their own `load`. A widget's permission gate has one spelling, a declaration's `access` (`WidgetAccessGate`): one permission, `{ anyOf }` or `{ allOf }`. A bare list is no longer a gate, and `{ anyOf }` still opens a card for a holder of any one of its permissions. No setting drives a widget's query because of its name: a number setting called `limit`, a select called `dateRange` or `tab`, and a checkbox called `onlyMine` reach a declared widget's `load` like any other setting.

  Removed exports:
  - `nextly/widget-result`: `WidgetComponentProps`. A widget's component is handed `WidgetProps`.
  - `nextly/widget-gate`: `WidgetPermissionGate`. A gate is typed `WidgetAccessGate`, from `nextly`. To migrate, import `WidgetAccessGate` from `nextly` in its place, set it as a declared widget's `access`, and write a bare list of permissions (`["a", "b"]`) as `{ anyOf: ["a", "b"] }`.

  The dashboard layout read no longer sends each widget's add-panel group, sub-group, sketch or rank; its `available` list is already in the add panel's order.

- [#3113](https://github.com/nextlyhq/nextly/pull/3113) [`2cd9b2a`](https://github.com/nextlyhq/nextly/commit/2cd9b2af76114635ca431e3059442578d95ccdca) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's default dashboard is now the agreed set, in grid order: Set up your project across the row (12 by 2); Needs attention (8 columns) beside Upcoming releases (4); Continue where you left off beside Content (6 each); then the form-builder plugin's New form submissions card, named as optional so a site without the plugin leaves it out with no startup fault, beside Team activity. Each entry states its size, every row sharing one height. The Create card is no longer on the default; it stays in the add panel.

  Continue where you left off and Team activity are offered only to a reader who may read a collection or a Single the dashboard lists, so a reader of no content is no longer shown two cards that could only be empty.

  While only one of Needs attention and Upcoming releases is on show on the default dashboard, the admin draws it across the whole row. The width is drawn, never saved, and a dashboard the reader arranged keeps its own sizes.

  No widget a plugin declares with `defineWidget` is placed on a default dashboard on its own any more. `contributes.dashboard.suggest` is still accepted and checked at startup, places nothing, and is deprecated: the add panel offers the plugin's widgets, and a site that wants one on its default names it in `admin.dashboard.defaultLayout` (`{ widget: "<id>", optional: true }` where the plugin may be absent). Nothing else follows the default's own cards any more, so the site config's `admin.dashboard.suggestions` changes nothing: it is still accepted and checked (`true` or `false`), so a config that sets it keeps starting, and is deprecated; remove it.

  A reader who has saved their dashboard keeps it as saved; a reset returns to the new default.

- [#2963](https://github.com/nextlyhq/nextly/pull/2963) [`25fa563`](https://github.com/nextlyhq/nextly/commit/25fa563fc99c7dcf0724035f67d3621292818558) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget declared with `defineWidget` can load for the size its card is drawn at. A card missing a setting stays readable while the dashboard is customised, and a retired per-collection card is told what replaced it without a guessed name. All of the new API is `@experimental`.
  - **`size` on `load`'s input**: `{ w, h, tier }`, the card's grid size within
    the widget's bounds and its tier (`"small"`, `"medium"` or `"large"`), as the
    admin predicts it from the dashboard's width. `shows` is handed the same
    size. A card that is resized or crosses a tier runs its `load` again, on its
    own. A card asked with no tier, such as one judged on the server for a
    default dashboard, is loaded at its stored size, or its widget's default for
    a card not yet saved, at `"medium"`. The type is `WidgetLoadSize`, exported
    from `nextly` and `@nextlyhq/plugin-sdk`.
  - **`rowsThatFit(size, { density })`** in `nextly` and at the
    `@nextlyhq/plugin-sdk` root: how many list rows a card of that height draws
    at `"default"` or `"compact"` density, at most ten, by the formula core's own
    list cards use.
  - **Customise mode** no longer dims a card's empty, failed or not-available
    message: only an answer is dimmed, so the words that say what to do stay at
    full contrast.
  - **A retired `collection/…` card** named in a layout write is told the
    collection to set by its label when exactly one the writer may read made it,
    and otherwise "the collection this card showed", never a slug read back from
    its id.
  - **`Widget.FooterLink`** is the one link a card's footer draws: beside a
    `Widget.List` with `viewAllHref` it takes the place of "View all" rather
    than sitting beside it, and in development a second FooterLink in one card
    is named once in the console.
  - **A plugin's attention item** reading a declared collection its reader may
    not read has each read checked first, so a malformed one fails for every
    reader alike, and only then is answered as an empty collection.

- [#3058](https://github.com/nextlyhq/nextly/pull/3058) [`df95bc7`](https://github.com/nextlyhq/nextly/commit/df95bc7c42a8d3025e0f3ece94cfa8c4742e4603) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's Count, Breakdown, Over time and Recent entries cards are declared with `defineWidget`, as Note is: each card's data is answered on the server by its declaration's `load`, through the public read services alone and for the size the card is drawn at, and its admin component draws that data. Each keeps its id, title, description, sizes, settings and what it shows.
  - **Count** reads its number at every size, what scheduled releases will
    publish from the medium tier, and on a large card alone the last 30 days as
    a series over that range and the 30 days before them as a count over the
    window as long that ends where the series starts.
  - **Recent entries** asks the rows its height holds at its density, at most
    its "Number of items", and one more that says more exist.
  - **Breakdown, Over time and Count's trend** draw "View as table" under their
    chart: a button that swaps the chart for a table of the same values in the
    card, closed again with Escape, which hands focus back to the button.
  - **Each card loads in its own shape** again: a figure, bars, a series or a
    list, and its add-panel row is sketched the same way.
  - **Team** stays as it is, and is no longer on the default dashboard: a reader
    who manages the team adds it from the add panel.
  - **`overrideWidget()`** now refuses the four moved ids, as it refuses every
    declared widget; `extendWidget()` still applies to them.
  - A Filter of no conditions adds nothing to a widget's query, rather than an
    empty `where`.
  - **A series over a range** counts, in its last interval, a row MySQL stored
    rounded across that interval's end within the second it is read in, as a
    windowed count of the same range does; on MySQL the series' scan bound now
    keeps that second.
  - **A windowed `count`** checks the call's own `where` as written before
    narrowing it to the window, so a malformed filter is refused exactly as it
    is without a window, never wrapped and run.
  - **A declared widget's loading skeleton** lays out its rows from its
    `skeleton`: a list loads as a list's rows, and a table as a table with its
    heading and columns on a wide card. Recent entries loads as a table.
  - **A write made outside a request** (a script, a job) no longer retries
    every pending cache expiry: pending expiries are kept once each and expire
    at the next write inside a request, and the waiting is logged once.

- [#2549](https://github.com/nextlyhq/nextly/pull/2549) [`ab71b3c`](https://github.com/nextlyhq/nextly/commit/ab71b3c3cb04422540a0923ac4c76a8fc5eb2df0) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A hand-written migration that drops or renames a table and then runs `CREATE TABLE IF NOT EXISTS` under the same name is no longer refused on PostgreSQL when a later statement alters that table.

- [#3184](https://github.com/nextlyhq/nextly/pull/3184) [`e6606c7`](https://github.com/nextlyhq/nextly/commit/e6606c7e28438f5440304b93e2598c3601544b94) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's New button and a card's More settings panel work better with a keyboard and a screen reader. The New menu is a named list of the types you can create, its search is labelled once there are more than ten, focus goes straight to the list so each type is announced as you move through it, the type the arrow keys are on is outlined, and Escape hands focus back to the button. When New starts creating a different type it says so. In More settings, "Changing the collection reset ..." is now reliably announced. The add gallery says its count after Clear only once, and "Resume setup"'s failure message is announced on its own rather than inside the summary line.

- [#3158](https://github.com/nextlyhq/nextly/pull/3158) [`53c6692`](https://github.com/nextlyhq/nextly/commit/53c66920916b9a9949a785e2558d20dd048ab61c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard is easier to use with a keyboard and a screen reader. The add gallery now says how many widgets it lists when a filter chip is chosen, and after Clear it says the count for the chip still on rather than for every widget. The header's summary line is announced when its counts change, and pressing Refresh leaves focus on the page's heading instead of losing it. The environment badge has an edge you can see in every tone, and Remove in a card's menu meets text contrast in light mode.

- [#2848](https://github.com/nextlyhq/nextly/pull/2848) [`4c17f5b`](https://github.com/nextlyhq/nextly/commit/4c17f5b37f52270969d6d508ca9b878779976e81) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Breaking:** a dashboard card's size is now `{ w, h }` on a 12-column grid, with rows of one fixed height (`w` from 1 to 12, `h` from 2 to 12). That is the only way to state a size. `defineWidget` takes `size: { default, min?, max? }` in place of `widths` and `width`, and so do registered and contributed widgets, in place of `defaultSize`, `minSize`, `maxSize`, the allowed and default widths, `defaultHeight` and `size: "half" | "full"`. The site config's `admin.dashboard` takes `w` and `h` on `defaultLayout` cards, and `overrides[id].size` narrows a widget's bounds without ever widening them. A widget's own component is handed its size as `{ w, h, tier }`. `WIDGET_SIZES`, `WIDGET_WIDTHS`, `WIDGET_HEIGHTS` and their types are removed, as are the unused `DEFAULT_COLUMN_COUNT` and `COLUMN_COUNTS`; `GRID_COLUMNS`, `MIN_GRID_ROWS`, `MAX_GRID_ROWS`, `GridSize`, `WidgetSizeDeclaration`, `WidgetSizeBounds` and the size helpers are added.

  **Breaking:** saved dashboards are reset. The stored layout moves to format version 4. A dashboard saved in an earlier version (1, 2 or 3) is read as not saved, so its owner sees the current default dashboard, and the old row is replaced the next time they save anything. Nothing from an earlier layout is carried over.

  The dashboard reflows by its own width, not the window's. At 1,024 px and wider every card is drawn at its `w`. From 640 to 1,023 px a card of 6 columns or fewer is drawn at 6 and a wider one at 12. Below 640 px there is one column. A card keeps its height in every band, and a reader resizes a card's width and height from its menu, within its widget's bounds.

  The admin sidebar no longer draws the previous section's panel for a frame after a navigation, which moved the whole page as it closed.

  In customise mode, a card's Width choices name each width by its share of the row where it is an exact one, "½" with "6 columns" beneath, and always include the widget's own default. The line that shows where a dragged card will land now allows for cards of different heights, as the grid places them. The Get started card is drawn tall enough for every step it shows, eight rows by default, instead of cutting its last steps off.

- [#2908](https://github.com/nextlyhq/nextly/pull/2908) [`ec2bdee`](https://github.com/nextlyhq/nextly/commit/ec2bdeed18bad85617949ab1416394f7f9907759) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Recent entries card's reader can choose which of the collection's fields its rows show after
  the title, from a new "Fields on each row" setting.
  - `settings.fields({ of })` declares a `fields` content setting on a widget (`@experimental`): an
    ordered choice of up to `MAX_CHOSEN_FIELDS` (3, exported from `nextly/config`) of the named
    Collection setting's fields. It must work over a Collection setting with `rows: "titled"`, on a
    widget whose query is a `list`; startup refuses it anywhere else.
  - A choice must name only fields the reader is offered and a row can print, the rule a Sort or
    Filter is held to. A field a read rule withholds, or one no row can print (a structured or
    many-valued field), is never offered, and a stored choice naming one falls back to the card's own
    fields. A source marks a field no row can print with `presentable: false`.
  - A Collection setting is applied before the settings that depend on it, whatever order a widget
    declares them in.
  - The settings sheet draws Fields as a multi-select of the fields it may offer, never the title,
    stops at the most a row shows and says so, and resets a stored choice naming a field no longer
    offered, saying so.
  - Recent entries leads each row with its collection's initial, shows the chosen fields in the
    order chosen, and draws its status as a pill on a collection with a lifecycle.
  - Every content setting's control names a field by its label, or its name made readable, as the
    card's column headings do, never by its key.
  - Dates in list and table cards read short ("Today, 9:40 PM", "Yesterday", "Oct 24, 9:40 PM", with
    the year only when it is not this one), with the full date on hover.
  - A clearable select's clear button now sits beside the select rather than over its arrow, and can
    be reached from the keyboard.

- [#2864](https://github.com/nextlyhq/nextly/pull/2864) [`35d09f2`](https://github.com/nextlyhq/nextly/commit/35d09f2329eb3640d9977ff1196e495c0f9a5564) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every dashboard list draws with one row layout and one list card:
  - Each row has a leading icon or avatar, a one-line title (cut with "…", the full text on hover and focus), a meta line of up to three fields, a trailing status or time, and a "…" menu named for its row. The whole row links to what it names; a row with nowhere to go is plain text.
  - A list shows only the whole rows its card holds (3, 5 or 10 by size, at most 10) and never scrolls. When it holds more, one footer says so: "View all (N)" to the full list, or "N more" where there is no list to open. "More exist" is gone.
  - Large cards draw the same rows as a table, with the same links and order.
  - List cards gain a Density setting: default or compact rows.
  - A collection list's answer now carries its total, from the same read, so "View all (N)" names the number the list it opens holds.
  - Recent activity rows now open the entry or Single they are about, and Upcoming releases rows open their release.
  - Removed: the unused `RecentEntriesWidget` export. A card's "Number of items" now goes up to 10, the most a list draws.

- [#2940](https://github.com/nextlyhq/nextly/pull/2940) [`62ed111`](https://github.com/nextlyhq/nextly/commit/62ed111b60757090f007ebe07d8ab65f731ae9db) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Two new core tables hold what each reader's dashboard keeps for them. They are additive, created by
  `nextly migrate`, and by boot where boot applies the core schema. Run `nextly migrate` to create
  them on an existing site.
  - `nextly_dashboard_pins`: one row per reader per pinned entry or Single (`user_id`, `target_type`,
    `target_slug`, `entry_id`, `pinned_at`), unique on the reader and the target. A Single's
    `entry_id` is empty rather than NULL, so the unique index holds the same on PostgreSQL, MySQL
    and SQLite.
  - `nextly_dashboard_preferences`: one short value (at most 255 characters) per reader per key
    (`user_id`, `preference_key`, `value`, `updated_at`), unique on the reader and the key.
  - A reader's rows in both are deleted with the reader.
  - Until the tables exist, a reader has no pins and every preference reads as unset; pinning is
    refused with a message naming `nextly migrate`. Nothing reads or writes them yet: the dashboard's
    pins and remembered choices are built on them next.

- [#2817](https://github.com/nextlyhq/nextly/pull/2817) [`8f43634`](https://github.com/nextlyhq/nextly/commit/8f4363442ce77d2016a1d20f5cc6034b02847d7c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Direct API's `overrideAccess` documentation no longer mentions row-level filters, which no access rule applied.

- [#2949](https://github.com/nextlyhq/nextly/pull/2949) [`83c3e75`](https://github.com/nextlyhq/nextly/commit/83c3e7577ba874c53f8d96074d48d95526cadc3e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every card of a default dashboard keeps its own identity. A widget a site's `defaultLayout`
  places more than once names an `id` for each further card (`{ widget, id, settings }`), and
  startup refuses a repeat without one, or two cards under one id, showing the entry to write. A
  row following the default keeps each card's removal and settings under that id.

  A declared widget's `shows` is now judged with the settings a reader gave its card, and a save
  staged before a card's verdict changed is refused as stale, rather than leaving that card out; a
  save that changes such a setting answers with the token the next save is checked against.
  An optional `defaultLayout` entry whose widget is not installed no longer counts against the
  dashboard's limit. `contributes.dashboard.widgets: null` is refused at startup as not a list.

- [#2919](https://github.com/nextlyhq/nextly/pull/2919) [`8e51541`](https://github.com/nextlyhq/nextly/commit/8e51541f55cf5168ffbc84ad8c282db519e04e83) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Each item in the admin sidebar's icon rail is now named for assistive technology. The rail draws an icon alone, so a screen reader announced its buttons with no name. Each link and button now carries the item's label.

- [#3047](https://github.com/nextlyhq/nextly/pull/3047) [`4819fa6`](https://github.com/nextlyhq/nextly/commit/4819fa69d4cc0ce20dec143f10af952e3fcdaef3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Masking email addresses in a log line now costs time in proportion to its length. A quoted address was read from every double quote with no limit, so a long line of escaped quotes cost its length squared, and text an attacker could put into a log line could hold a production server's CPU for seconds. A quoted local part is now read for at most 64 characters between its quotes: RFC 5321 caps a whole local part, quotes included, at 64.

- [#2968](https://github.com/nextlyhq/nextly/pull/2968) [`a241511`](https://github.com/nextlyhq/nextly/commit/a241511b21a0f3849e90200d2bc114b0be13e1dc) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API checks email providers, email templates and user fields when a call asks to be checked. With `overrideAccess: false`, each `nextly.emailProviders`, `nextly.emailTemplates` and `nextly.userFields` call now asks what the REST route for the same operation asks, before any work: read, create, update or delete on `email-providers` or `email-templates`, and on `settings` for user fields. Before, such a call read and changed them for any caller. A trusted call, the default, is unchanged.

- [#2922](https://github.com/nextlyhq/nextly/pull/2922) [`a17c744`](https://github.com/nextlyhq/nextly/commit/a17c744a8f29a6bf565350f1a4f5349f7a9c87ba) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Email hub's Messages, Design and Sending tabs, a plugin's settings, and a webhook delivery each name their own browser tab, so they can be told apart from one another.

- [#2872](https://github.com/nextlyhq/nextly/pull/2872) [`e3e9ff5`](https://github.com/nextlyhq/nextly/commit/e3e9ff58eb44bb9668dc612205b7b512925545b2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every module in nextly that read a dialect's tables now reads the loaded dialect's, so a process no longer imports the other two dialects' table definitions through email, webhooks, jobs, API keys, settings, widgets, translations or the boot-time core schema check. Nothing changes in what any API returns.

- [#3146](https://github.com/nextlyhq/nextly/pull/3146) [`d7e8655`](https://github.com/nextlyhq/nextly/commit/d7e8655949c70379740e380c73e4fd7b0da8ba70) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly generate:widget` leaves a config as it was, and prints the import to add, when the widget's name is already taken there: by a declaration of the config's own (`const openOrders = defineCollection(...)`), or by an import that is not the generated named export, such as a default or aliased import of the widget's file, which a `--force` regeneration would otherwise have left pointing at an export that no longer exists. A plugin's admin entry is read the same way before the card's export is added: its own export, however formatted, is kept, and the name exported from another module is left for the author. `--config` must name a file inside the project the command runs in, following links, so another project's config is no longer edited alongside this project's manifest. `--dry-run` says which dependencies a run would add rather than to install ones it has not added. The paths it prints, the test to run among them, use forward slashes on Windows too, as the imports it writes already did. `createTestNextly` puts `DB_DIALECT` and the generated `NEXTLY_SECRET` back when its default SQLite adapter cannot be created, as it does when a boot fails.

- [#3094](https://github.com/nextlyhq/nextly/pull/3094) [`356602d`](https://github.com/nextlyhq/nextly/commit/356602d09f45a5b17f4b13a5b6ca80f617714a1e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard holds a cached layout answer to the width it was read at: a card that hides while empty is drawn without only where every card is drawn at the tier the answer judged it at, so a return visit on a narrower window or another device no longer hides a card that has something to show at its tier. And a dashboard whose every card took itself off it, including a plugin card whose own component reported its answer empty, now says it is empty and offers the way back, instead of drawing nothing.

- [#2856](https://github.com/nextlyhq/nextly/pull/2856) [`bb4647d`](https://github.com/nextlyhq/nextly/commit/bb4647d3e2474e81f4331d055caed4faeb5fd8d2) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A version read now names a field it withheld inside a list by that row's index in the version (`items.1.secret`), not by the list alone (`items.secret`). A read rule that reads its row can allow a field in one row of a repeater or repeatable component and deny it in another, and the old path hid the field in every row. A comparison now hides the field only in the row each version withheld it in, so the other rows' changes to that field still show. The shape of `withheld` is experimental: a client that matched list fields by the row-less path should match the indexed one.

- [#2629](https://github.com/nextlyhq/nextly/pull/2629) [`b4aecd4`](https://github.com/nextlyhq/nextly/commit/b4aecd4dfca6e5daac8cc58f154828567b07858a) Thanks [@aqib-rx](https://github.com/aqib-rx)! - An earlier version in the history panel now marks each field the reader may not read: the field keeps its label, and where its value would be it says "Hidden: you don't have access to this field." beside a lock icon. Until now it showed an empty input, which could not be told apart from a field the version never held. A field is matched by its full path, so a field inside a group is marked as well, and a component withheld whole says so in place of its card. The restore confirmation now says that fields you can't access are not restored and keep their current values. The message after a restore that left fields behind no longer says those fields are no longer in the schema, because a field you may not read or write is left behind too.

- [#2935](https://github.com/nextlyhq/nextly/pull/2935) [`d2af8ec`](https://github.com/nextlyhq/nextly/commit/d2af8ecddf864dc7b34ec700356425527a1e5d4a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Logs now take out a credential recognised by its form wherever it appears, under any field name or inside a message: a JWT, a GitHub, GitLab, npm, Slack or Stripe token, an AWS access key id, a Google OAuth token or a PEM private key, along with the value of a quoted JSON name such as `"access token"` or `"2fa_token"` that is not a plain identifier.

- [#3032](https://github.com/nextlyhq/nextly/pull/3032) [`2e79ba6`](https://github.com/nextlyhq/nextly/commit/2e79ba6c129cfb4ecef7e6271f7ed5b03d42691c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A log line now hides the value after a quoted name longer than 256 characters that holds spaces,
  quotes or other escapes, such as `"… access token":"…"` in a JSON body or in a body quoted inside a
  message.

- [#2861](https://github.com/nextlyhq/nextly/pull/2861) [`558c718`](https://github.com/nextlyhq/nextly/commit/558c718a5ad9d1d25fe65a077ac6213ae15879de) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Nextly's logs no longer contain credentials. Saving or reading a Single, and listing entries, collections, media or users, logged the call's options, and those carry the request: the caller's `Authorization` header (an API key) and session cookie were written to the server log, in production too. Every log writer (service loggers, including one an app passes in; the structured logger; the database and auth loggers) now takes out request, response and headers objects, fields named like a credential (`authorization`, `cookie`, `password`, `token`, `apiKey` and similar), and `Bearer` or `Basic` credentials in text, in every environment. Those log lines now name only the Single, its language or the collection.

  **If you ran an earlier version:** your server logs may hold API keys and session cookies of people who saved or read Singles. Rotate the API keys that were used, sign out existing sessions, and delete or expire old logs where your host allows.

- [#2833](https://github.com/nextlyhq/nextly/pull/2833) [`24e80d6`](https://github.com/nextlyhq/nextly/commit/24e80d6f8d5f339355a4ab3168dc09d079a3cc72) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A role or API key holding `manage-media`, `manage-settings`, `manage-email-providers` or `manage-email-templates` now passes every gate that asks read, create, update or delete on that same resource: a route asking one permission or any of several, `ctx.caller.can`, a dashboard widget's or a document lock's required permission, the schema builder's collection list, and the system-resource reads. The access decision already counted it, but these gates did not, so a holder of `manage-email-providers` was refused a route asking `update-email-providers`. It never counts as publish or unpublish, as any other action, or on any other resource.

- [#2933](https://github.com/nextlyhq/nextly/pull/2933) [`fc94900`](https://github.com/nextlyhq/nextly/commit/fc9490076024916ba6edc9cffc9eb4c7dc19eb1a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The media library now opens an item's details in a panel beside the grid that expands to a full-screen viewer, keeps its controls on one row, fits each image inside its tile (whole when a stored image size shows it whole, otherwise from the light thumbnail), and sets the focus point as one dot on the whole image, which is now saved: a media update used to drop the focus point it was given.

- [#3194](https://github.com/nextlyhq/nextly/pull/3194) [`1878128`](https://github.com/nextlyhq/nextly/commit/1878128ff615a338208c5f5403b2148e51ce32dc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Media library fixes: Used in never names what a reader cannot open, Undo never claims to restore
  an item already deleted, and a folder delete never moves or removes an item waiting on its Undo.
  - `GET /admin/api/media/:id/usage` counts the documents on the page the reader may not open as one
    number, `meta.hiddenCount`, in place of `meta.hidden`, whose list by collection or Single named
    them.
  - An item deleted at once (the delete route, a bulk delete, `nextly.media.delete`) while an earlier
    delete's Undo was open is answered by that Undo as already deleted, not restored.
  - Deleting a folder while an item in it is being deleted with Undo is refused (409) even when the
    delete with Undo started a moment after the folder was checked, with or without its contents, and
    nothing in the folder is removed or moved. A folder delete waits for, rather than failing with a
    database deadlock against, a delete with Undo, a file moved into one of its folders, or a folder
    moved within it; folder moves and folder deletes run one at a time. A file added to one of its
    folders while it runs is deleted with the contents, never left at the library root.
  - Switching between All media, Missing alt text and Unused, changing folder, searching or filtering
    by type clears the selection, so a bulk delete or move acts only on files on screen.
  - Used in reads only the usage rows of the documents on the page, however many Singles use the item.
  - A file storage could not remove when a delete with Undo finished stays recorded, and the job that
    finishes the delete removes it once storage takes it.

- [#3062](https://github.com/nextlyhq/nextly/pull/3062) [`05c865b`](https://github.com/nextlyhq/nextly/commit/05c865b921f5687de5d36136559ad0a8b38c0bcf) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The media library takes files dropped anywhere on the page, into the folder on screen, and lists every upload in a tray with its own progress. Any number of files can be added: three upload at once and the rest wait, where a drop used to stop at ten and send them all together. A file that fails says why and offers Retry without stopping the others, and a file refused before upload (too large, or a type the server does not accept) says so on its row. The tray stays until it is closed, and the admin's toasts appear above it while it is open. The media picker's drop area uses the same queue and tray. The Upload button opens the file chooser directly, and a person who may not upload has neither it nor the drop target.

- [#3187](https://github.com/nextlyhq/nextly/pull/3187) [`83256a3`](https://github.com/nextlyhq/nextly/commit/83256a3b7980cc5668d25fe70c083ea4f38e92d1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The media library gains views beside its folders, a Used in list, a delete that can be undone, and
  Replace.
  - Beside the folders: All media, Missing alt text and Unused, each with its count, and every folder
    with its own. A view lists its items across every folder, with the same search, filter, sort and
    paging. Unused lists an item only when no document uses it and no avatar or logo keeps its
    address. Its list says whether the usage record it read was complete, and the page shows it only
    when that same answer says so: until `nextly media reindex-usage` has run, or while a rebuild runs
    during the read, Unused says the record is still being built instead of listing items content
    may still use.
  - An item's details say where it is used: each document the person may open, as a link, with its
    collection or Single, the fields that use the item that the person may read, and the languages
    when only some do, and how many more they cannot open. A field a read rule withholds from the
    person is never named. A translation the person cannot read shows neither its fields nor its
    language. `GET /admin/api/media/:id/usage` answers it a page of documents at a time (`page`, and
    `limit` up to 50, 20 by default) in the usual list envelope, `meta.total` counting every document
    using the item; the details and the delete dialog say how many places in all and show the rest
    with Show more. Until `nextly media reindex-usage` has run, Used in and the delete dialog never
    say an item is unused. Before `nextly migrate` has created the usage table, it answers no uses,
    the record not built, rather than failing.
  - Delete lists where an item is used before asking, then takes it out of every list and count at
    once and offers Undo for ten seconds, one Undo for a bulk delete. The item, its files, folder and
    usage stay until the window ends; then it is deleted with its files, by the server even if the
    person has left the page or the server restarted (a job queued with the delete finishes it through
    the jobs queue), every item of a large delete included. A server stopped part way through
    finishing a delete leaves it to be finished, never an item back in the library or files left
    behind. Up to 1,000 items (`MEDIA_DELETE_LIMIT`, exported from `nextly/config`) are deleted in one
    request, all of them or none; a larger selection is refused before you confirm.
    `POST /admin/api/media/deletions` and `/deletions/undo` take a list of ids and need the delete
    permission. The existing `DELETE` routes still delete at once. A folder holding an item inside its
    Undo window cannot be deleted, with or without its contents, until that window has passed: the
    request answers 409, and the folder delete dialog says why.
  - Undo brings back only what that delete marked, never an item another delete was already
    removing, and offers it for the whole of those items' own window: an item already waiting keeps
    its own, earlier deadline, which the answer's `deleteAfter` gives, while `markedDeleteAfter`
    gives this delete's own. Each item is judged against its own deadline, so an Undo of several
    items brings back every one still inside its window and lists the rest as already deleted; an
    Undo after an item's deadline is refused for that item. If a database statement fails part way,
    the Undo is rolled back and brings back none of them.
  - Replace file stores a new file under the same item: the same id, name, alt text, caption, folder
    and usage, with a new address and thumbnail, so every document using it by id (upload fields,
    block documents, attachments) shows the new file at once. Rich text, a JSON field, a block
    document or any other value naming the file by its address (`src` or `url`), email-template
    images, users' avatars and the email and site logos keep showing the previous image until they are
    edited, so while any does, the old file is kept; the Replace dialog says how many and lists the
    documents, and Used in marks each. A page that still names a replaced file's old address goes on
    counting as a use when it is saved again, even while the Replace is finishing. Until
    `nextly media reindex-usage` has run, the old file is always kept, and the dialog says so. The
    kept file goes when the item is deleted, by any delete, a folder deleted with its contents
    included. The focus point and a video's or audio file's duration are cleared.
    `POST /admin/api/media/:id/replace` answers it, with the upload's own checks, and
    `GET /admin/api/media/:id/usage?byAddress=true` lists the uses by address, with the avatars and
    logos keeping it and whether the usage record is built.

  The media usage table, new in this release, records whether each use names the item by its id or
  by its address, in an `address` column. `nextly migrate` creates the table with it, and adds it to
  a table created from an unreleased build. A usage record built before the column existed, or before
  block documents with their own list of items had their addresses recorded too, reads as still
  being built, which keeps old files on Replace and the Unused view closed, until
  `nextly media reindex-usage` is run once more.

  The database adapters' `select` now honours its `distinct` option, which it declared and ignored.

- [#2853](https://github.com/nextlyhq/nextly/pull/2853) [`1dc0940`](https://github.com/nextlyhq/nextly/commit/1dc09404a04db360673ed79046bde567d0ebee34) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The media library loads faster. The folder tree asks for a folder's subfolders only when you open it, instead of fetching every folder's subfolders and whole contents on each visit, and the root's contents are no longer downloaded. The file list keeps showing while a page, sort, search or edit refreshes it, and an upload refreshes it once. The Delete folder dialog now counts the folder's files correctly; it always said 0.

- [#3126](https://github.com/nextlyhq/nextly/pull/3126) [`150fef2`](https://github.com/nextlyhq/nextly/commit/150fef20b8019617e59a34c03846ab9f476b9758) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The media library now keeps a record of which media items each document uses, and reads its folder
  counts and folder contents from the database.
  - A new core table, `nextly_media_usage`, holds one row per media item used by one field of one
    document, in one language (`media_id`, `subject_kind`, `subject_slug`, `document_id`,
    `field_path`, `locale`). It is additive, created by `nextly migrate` like every core table. Run
    `nextly migrate` to create it on an existing site.
  - The record is rewritten in the same transaction as every write that changes a collection entry,
    a Single or an email template: create, update, publish and unpublish, the transaction API and
    batch writes. It covers upload fields (one id or a list), images, videos and galleries in rich
    text (by their address), block documents (`assets.mediaIds`), the addresses any other JSON value
    holds under `src` or `url`, and these inside groups, repeaters and field groups. An address that
    names an item by its media route (`/api/media/<id>/raw`, as a Page Builder font face does) is read
    as that item, and one made absolute against the site (`https://site/uploads/a.png`) by its path. A
    value every language shares is recorded with an empty `locale`; a translated one, under its
    language, including a language removed in Settings, whose content is kept. A working draft held beside published content is recorded once it is
    published. A deleted document's rows, every row of a deleted collection or Single, and a deleted
    media item's rows go with them.
  - `nextly media reindex-usage` rebuilds the record from the stored content. Run it once after
    `nextly migrate`: until then, content written before this release is not in the record, and the
    counts below say so (`usageRecorded: false`). A new site's record is complete from the start. Run it
    from the project's own folder: from another one, or with a `--config` outside the project, it
    rebuilds nothing and ends with `MEDIA_REINDEX_OUTSIDE_PROJECT`, as `media orphans --apply` does.
  - `GET /api/media/counts` answers every folder's item count, the items in no folder, and the counts
    of all items, images missing alt text and items nothing uses, in one query. An item a user's
    avatar, the email brand's logo or the site's logos keep is in use: these are stored as the item's
    address, outside any document, and the count and the `unused` view ask them directly.
  - The media list takes `view=missing-alt` or `view=unused`.
  - The media list's and a folder's `type` filter now narrows to the kind each file is shown as:
    `document` is a PDF, an office file or any text, and `other` is what no kind names. Before, both
    matched nothing, as each kind was read as the first part of the MIME type.
  - A folder's contents (`GET /api/media/folders/:id/contents` and `/folders/root/contents`) now
    come a page at a time, sorted and filtered in the database: `page`, `limit` (at most 100),
    `search`, `type`, `sortBy` and `sortOrder`, as the media list takes them. The response adds
    `meta` (`total`, `page`, `limit`, `totalPages`), and `files` holds that page, 24 items unless a
    `limit` is given. A caller that counted `files` for a folder's size reads `meta.total` instead.
  - A plugin that writes content through the Direct API is recorded like any writer. One that writes
    media ids into tables of its own is not.

- [#3066](https://github.com/nextlyhq/nextly/pull/3066) [`8196870`](https://github.com/nextlyhq/nextly/commit/819687040be8acf193d3459f252547b56566c925) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `nextly migrate:create` and `nextly migrate:check` work again in a project nothing else has loaded. Neither connects to the database, and both stopped on an unexpected error ("the tables were read before that dialect was loaded"). The schema they compile now loads its dialect's tables itself.

- [#2911](https://github.com/nextlyhq/nextly/pull/2911) [`21c7e25`](https://github.com/nextlyhq/nextly/commit/21c7e25412179f5409de2ac5979a925a20cb8945) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `nextly migrate`, once it finishes, and `nextly migrate:status` now name every place the registry and the database disagree: a registry row whose table does not exist, a field a registry row records whose column does not exist (such as a plugin's new field whose column was never added), and a collection, single or field group the configuration declares that has no registry row. Both only read, and neither changes its exit code for what it names. `migrate:status --json` carries the findings under a new `registry` key. Nothing at server start makes this comparison, so a deployment that runs neither command does not see it: run `nextly migrate` (or `nextly migrate:status`) where you deploy.

- [#3016](https://github.com/nextlyhq/nextly/pull/3016) [`54b6213`](https://github.com/nextlyhq/nextly/commit/54b6213e53db7fc416da9921f60dca2671c50e21) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - `nextly migrate --step` no longer stops inside a field leaving translation. When the step budget runs out after the move's archive or main file, the run goes on through its shared file and says so, so nothing can write a value into the new shared column between the main file and the copy that fills it. The copy still takes each entry's default-language value, as the Schema Builder and turning translation off do.

- [#3128](https://github.com/nextlyhq/nextly/pull/3128) [`63683a8`](https://github.com/nextlyhq/nextly/commit/63683a8afae9064de900b4bbfc53903128bcac42) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On MySQL, the first `nextly migrate` after an upgrade that adds a core table no
  longer fails on foreign keys the site already has ("Duplicate foreign key
  constraint name"). The core tables are now reconciled without looking at the
  site's content tables, as on PostgreSQL.

- [#2800](https://github.com/nextlyhq/nextly/pull/2800) [`4220e4d`](https://github.com/nextlyhq/nextly/commit/4220e4dee9fd6e9d39a9077f378ea56a5282f675) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - MySQL's migrate lock is now scoped to the database, so apps sharing a MySQL server no longer block each other's migrations. The lock was a server-wide named lock with one fixed name, so a `nextly migrate` (or a dev boot applying migrations) on one database refused, or waited, while another database on the same server was migrating. While older versions may still be running, a new one also waits while any process holds the old server-wide lock name, so a new process never migrates beside an older one that started first. The other order is not covered: an older process starting after a newer one has taken the new lock will not see it. So during the upgrade, don't run an old and a new `nextly migrate` against the same database at once, and if your app sets `db.runMigrationsOnBoot`, run `nextly migrate` before rolling out replicas that migrate on boot.

  On MySQL, the busy-lock error no longer suggests `--force-unlock`, which has nothing to clear there: it says the lock is released when the other process's connection ends, so wait for it or stop it. When the lock it met is the older, server-wide one, held by an older Nextly perhaps migrating another database on the same server, it says so. PostgreSQL's message is unchanged.

- [#3027](https://github.com/nextlyhq/nextly/pull/3027) [`6cd900a`](https://github.com/nextlyhq/nextly/commit/6cd900ac9f41f56d23ceee04419ccd56e051cea0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Needs attention card is now "Needs your attention": a digest of open work waiting for the reader, which leaves the dashboard while nothing is waiting.
  - One row per item, most urgent first: releases that stopped and overdue releases (critical), then items plugins add (warnings). Each row shows its severity by shape as well as colour, the item's label and count ("Overdue releases · 2", "99+" past the cap), why it is waiting, and one Review.
  - An item whose count could not be read says "Not all checked" with a Retry, so the card never reads as clear while something went unchecked. Nothing on the card dismisses an item; it leaves when the work is done.
  - At its new default of 8 by 3 the card draws the items that fit and folds the rest behind "Show N more", which grows the card in place until "Show less". Create, beside it on the default dashboard, is 3 rows tall to match.
  - The card no longer counts unpublished changes or entries publishing this week: those are the Content table's and Upcoming releases' to show.
  - It is answered as the caller who asked, so an API key sees only the items its own grant reaches.
  - A plugin's attention item (`defineAttentionItem`, experimental) may give an optional one-line `reason`, drawn under its label. Startup refuses a reason that is empty or spans lines.
  - A list row's one action may carry a longer accessible name than its visible label.
  - The dashboard header's "N things need you" counts the same items the card draws, read from the same digest as the same reader: one number, the card's title count, with "N+" when an item could not be counted or its count is a floor, and its link opens the overdue releases when they are waiting. A plugin's attention items count as items like core's.
  - A card that hides while empty, and that the layout read found empty, is shown (and announced) once its own answer on the dashboard holds something, rather than staying off until the next visit. One rule judges both (`cardAnswerIsEmpty`, experimental, from `nextly/widget-result`).
  - `nextly/attention-keys` (experimental): `digestTotal` and `isDrawnAttentionItem` count and test the digest's items for the header and the card alike. `attentionTotalOf`, the total of the grouped answer the previous card drew, is removed: nothing reads that total now; count the digest with `digestTotal` instead.

- [#3088](https://github.com/nextlyhq/nextly/pull/3088) [`e20641e`](https://github.com/nextlyhq/nextly/commit/e20641ef69908f0420c081845c04d41148c6c96e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The form-builder plugin adds a dashboard card, New form submissions, declared
  with `defineWidget`. It lists the submissions nobody has opened yet, newest
  first: who sent each one (their name or email, where the form asks for one,
  with common spellings of a name field such as `firstName`, `first_name` or
  "Your full name" recognised), the form and the first line of the first text
  answer, each held to 140 characters, and when, in words that move on while
  the dashboard stays open and as a date in the admin's timezone from a week
  on. Opening a row marks that submission read, as the person opening it and
  only while it is still new; someone who may not update submissions leaves it
  new. Once it is marked, the dashboard's cards and its header count are asked
  again, so a dashboard left open behind the new tab stops listing it. The
  card's title carries how many are new ("New form submissions 3"), the total
  its header part counts, and no count while none are. A reader of more than
  1,000 forms has the first 1,000 counted, and both the title and the header
  say it is a floor ("1000+"). The card's
  footer leads to every submission. While nothing is new it
  stays on the dashboard and says "No new submissions", with a link to all of
  them, to the collection as the site installed it, renamed or not.

  The card reads as the person viewing it, so a submission of a form they may
  not read is never listed or counted. It is shown to someone who may read the
  forms and the submissions while at least one form is theirs to read, and its
  own read, asked for no rows, puts the same count in the dashboard header's
  summary. Its id, `NEW_SUBMISSIONS_WIDGET_ID` (`form-builder/new-submissions`),
  is exported for a site's own default layout to name.

  The submissions collection now indexes its `status` and `submittedAt` fields
  (`idx_dc_form_submissions_status`, `idx_dc_form_submissions_submitted_at`), which
  the card's read filters and sorts by. A development server adds them on its
  next start; a production site adds them with its next `nextly migrate:create`
  and `nextly migrate`. Nothing is dropped or rewritten.

  A submission created through a request (a visitor's, or any HTTP create) is
  now stored with the server's `submittedAt`, whatever date it sends, so a
  visitor cannot date a submission into the future to keep it at the top of
  the card. Such a submission also starts as `new` whatever status it sends
  (spam detection may still flag it `spam`), so a visitor cannot file one as
  already read. A create made on the server with no request behind it, such as
  an import restoring old submissions, keeps the date and the status it names.

  A widget's `summary.count` may now answer `{ count, atLeast }` as well as a
  number (`WidgetSummaryCount`), and the dashboard header shows a floor as
  "N+"; a widget answering a plain number is unchanged. `summary.count` is now
  handed the request's `scope`, as `load` is, and a widget data read's `find`
  takes a `context` it hands the collection's hooks. The card reads the forms
  with it so the form-builder's per-form submission count is skipped, and scans
  the readable forms once per request for the card and the header.

  `@nextlyhq/plugin-sdk` adds two types to its root, `AnyWidget` and
  `WidgetReadServices`, for a plugin's widget code to be written in, and four
  parts to its widget kit at `@nextlyhq/plugin-sdk/admin` (experimental, like
  the rest of the kit): `formatWidgetTime`, a row's time as core's list cards
  word it; `useWidgetClock`, the minute clock they move it on with;
  `Widget.useTitleCount`, the frame's hook that shows a count beside a card's
  title and reads it with the title, as the Needs your attention card shows its
  items, a floor as "N+"; and `useRefreshDashboard`, which asks the dashboard's
  cards and header summary again after a widget's own write.

- [#2927](https://github.com/nextlyhq/nextly/pull/2927) [`5d26b05`](https://github.com/nextlyhq/nextly/commit/5d26b05a3944b2e44620e1c2f40a1c46709a080e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - nextly carries no code for Next.js or React releases it does not support, and refuses to start on one.
  - **The start check.** When nextly starts (`getNextly()`), it checks the installed `next`, `react` and `react-dom` against the supported ranges (`next` ^16.4.1, `react` and `react-dom` ^19.3.0), each on its own. It refuses to start outside them, with a `CONFIGURATION_ERROR` naming each installed version and its range. A package the app does not have, as where the CLI or a test runs, is not judged.
  - **Next.js APIs are used directly.** The Next.js 14 and 15 fallbacks are gone: `unstable_after`, a synchronous `draftMode()` or `cookies()`, and the checks of whether an export exists. If an API nextly uses is missing at run time, nextly throws a `CONFIGURATION_ERROR` naming the Next.js range it needs. Running outside a Next.js app, where `next` is not installed or there is no request, still works as before.
  - **`createPreviewRoute`'s `draftMode` and `readPreviewScope`'s `cookies`** must return promises, as Next.js's own do. A synchronous function no longer type-checks; pass `draftMode` and `cookies` from `next/headers`, or make a test's fake `async`.
  - **`nextly` now names `react` and `react-dom` as peers,** each with the range `^19.3.0`, beside `next`'s `^16.4.1`. Every Next.js app already installs both. These peer ranges are now the one place the supported versions are declared: `nextly`'s start check reads them, and `create-nextly-app` builds them in.
  - **`CONFIGURATION_ERROR` is a canonical error code** (status 500), with a `NextlyError.configuration()` factory. Every refusal of an app nextly can't work in uses it: a missing `config`, an unsupported Next.js or React, or a Next.js missing an API nextly uses.
  - **create-nextly-app** no longer reads the app's Next.js version to choose how to write `serverExternalPackages`; it writes the top-level option, which every supported release reads. An app whose config still lists packages under the deprecated `experimental.serverComponentsExternalPackages` is left unchanged. The output says to move those entries into the top-level `serverExternalPackages` list and delete the experimental key, because Next.js copies the old list over the new one.

- [#2880](https://github.com/nextlyhq/nextly/pull/2880) [`15221b2`](https://github.com/nextlyhq/nextly/commit/15221b205f93a88998eb845e5aaedbd8bb84d01f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Next.js 15 and React 18 are no longer supported.** Nextly now supports only Next.js 16.4.1 or later within 16.x, and React and React DOM 19.3.0 or later within 19.x, and every package that names them accepts exactly `next ^16.4.1` and `react`/`react-dom ^19.3.0`.

  To upgrade an app before updating Nextly:
  - Next.js: `npx @next/codemod@latest upgrade 16.4.2`
  - React: `npm install react@^19.3.0 react-dom@^19.3.0` (or your package manager's equivalent)

  `create-nextly-app` now writes `next`, `eslint-config-next`, `react` and `react-dom` at the reviewed minor (`~16.4.2`, `~19.3.1`) rather than npm's latest release, and stops before changing an existing app whose installed Next.js, React or React DOM is outside these ranges, naming the installed version and what to change.

- [#2813](https://github.com/nextlyhq/nextly/pull/2813) [`04c2914`](https://github.com/nextlyhq/nextly/commit/04c291435888461aeef019de7aa95d96cc38a489) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `nextly upgrade` now runs in steps, and says it has nothing to do only when no step has work. A new step hashes passwords stored before this release: each password inside a group or repeater that is not yet a hash is stored as a hash of itself, so it keeps working, and a value already in a password hasher's format is left alone. Another removes any password a version's snapshot still holds. Both report counts, never values, and `nextly migrate` names `nextly upgrade` while a password stored as written remains.

- [#2945](https://github.com/nextlyhq/nextly/pull/2945) [`4f20aea`](https://github.com/nextlyhq/nextly/commit/4f20aea644b0e569a9d7b40eda532632dea5b279) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard no longer makes a card per collection or per Single. A card about one collection is a core widget (Count, Breakdown, Over time or Recent entries) whose Collection setting names it, so adding a collection adds no widget. A Single's edits show in Recently edited (`core/recently-edited`). **Breaking:**
  - The `collection/<slug>-<kind>` and `single/<slug>-<kind>` cards are no longer offered, drawn or accepted.
  - A saved dashboard holding one drops it when it is read, and the next save stores the dashboard without it.
  - A layout write naming one is refused, and so is `registerWidget` with an id in either namespace, at startup. The message says the card is retired and what replaced it: add Count, Breakdown, Over time or Recent entries and set its Collection to the collection's slug, or, for a Single, that its edits show in Recently edited.
  - A site config (`dashboard.defaultLayout`, `hide` or `overrides`) naming one is refused at startup, an optional `defaultLayout` card included, naming the id and what replaced it.

- [#3130](https://github.com/nextlyhq/nextly/pull/3130) [`d6b5b63`](https://github.com/nextlyhq/nextly/commit/d6b5b63cd9ee972fc4f3bab4daba052f62bb7857) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A write made inside a transaction no longer runs retention passes from inside it. A pass runs its own statements on the connection pool, outside the transaction and blind to its writes, so the write path now offers none while a transaction is open. Passes run on the next write made outside a transaction, or on the scheduled drain. The cache tag expiry ledger's prune, which runs on every install, was the first pass to show this.

- [#3185](https://github.com/nextlyhq/nextly/pull/3185) [`d870e9e`](https://github.com/nextlyhq/nextly/commit/d870e9ecc90e8d4a954e253c262d8ce3f330b757) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every dashboard widget, core's own included, is now declared with `defineWidget`, so the older way of writing one as a definition is gone. Each card is answered on the server by its declaration's `load` and asked for by its card. The admin no longer asks a card's own query, a stats card's cells or a custom card's cells through the dashboard batch, and no longer draws the `text`, `actions` and `stats` archetypes, a self-drawn custom card that is handed no data, or a card footer link from the widget. A widget's view is a core view (`figure`, `list`, `table`, `bars`, `series`) or a component of its own (`view: { component }`).

  Removed exports:
  - `nextly/config`: `WidgetDefinition`. Declare the widget with `defineWidget` (from `nextly` or `@nextlyhq/plugin-sdk`) under a plugin's `contributes.dashboard.widgets` or the site's `admin.dashboard.widgets`. To migrate, move the definition's `title`, `description`, `size`, `settings` and `requiredPermission` onto the declaration (the permission becomes `access`), and replace its `query` with a `load` that returns the card's data.
  - `nextly/config`: `WidgetAction`. There is no `actions` archetype: draw a card of shortcuts with a component of its own (`view: { component }`). To migrate, move the shortcut list into that component, and hide any shortcut the reader may not use there.
  - `nextly/config`: `WidgetStatCell`. There is no `stats` archetype: declare one widget per number with `view: "figure"`, or draw several numbers with a component of its own. To migrate, move each cell's count into the card's `load`, and return the numbers as its data.
  - `nextly/config`: `WidgetQueryCell`. A card no longer asks cells through the batch: its `load` reads everything it draws. To migrate, run each cell's query inside the card's `load` and return the answers together as its data.

  Added export:
  - `nextly/widget-result`: `PublishedWidget`, a type only. The widget as `/admin-meta/workspace` serves it to the admin, derived from the function the registry publishes every widget through. Never written by a widget author; declare a widget with `defineWidget`.

  A widget no longer carries `serverData`, `sizedQuery`, `dismissible`, `link`, `cells`, `actions`, `content` or a `query` of its own. Every card's "…" menu offers Remove, and a list's "View all" link is drawn by `Widget.List`'s `viewAllHref`.

- [#3002](https://github.com/nextlyhq/nextly/pull/3002) [`3dfc0c7`](https://github.com/nextlyhq/nextly/commit/3dfc0c7672243ade90e23ea40c013d879ea9befa) Thanks [@aqib-rx](https://github.com/aqib-rx)! - One rule now judges a new collection, Single or field-group address, wherever it is set: `nextly.config.ts`, the Visual Schema Builder, the REST schema endpoints, `nextly.fieldGroups.create()`, `nextly migrate:check` and `nextly migrate:create`. Before, these disagreed: the Builder accepted `admin` and refused `team-updates`, configuration did the reverse, and the collection schema endpoint took any 255-character name.
  - A hyphen is accepted everywhere, and the table is named from the snake_case form (`team-updates` is stored in `dc_team_updates`). A second address with the same snake_case form is refused, naming both: among collections and Singles, and among field groups.
  - Every road refuses a route or system table Nextly uses (`admin`, `accounts` and others), a system resource for a collection or Single, a reserved SQL word, and an address whose tables would pass the 63-character name limit. New limits for new addresses: 48 characters for a Single and 47 for a field group.
  - An entity that already exists under an address the rule now refuses keeps working, and `nextly migrate:check` warns about it once. The Direct API's `fieldGroups.update()` no longer re-judges a field group's existing address.

- [#2913](https://github.com/nextlyhq/nextly/pull/2913) [`7c24c38`](https://github.com/nextlyhq/nextly/commit/7c24c383486c50ad8cfff73b1fe2a203f984ccfa) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Deleting data now takes one consent, on every command that does it: `--accept-data-loss` on the command line, or `NEXTLY_ACCEPT_DATA_LOSS` in the environment. It covers the development push and `db:sync` dropping columns, `migrate:down` running a DOWN that loses data, `migrate:fresh`, `prune`, and a full `plugins uninstall`.

  Given alone, it covers every deletion of the run, and the run prints each table and column before deleting it. Given a list (`--accept-data-loss=posts,pages.summary`), it covers only those: a named table covers dropping it, dropping any of its columns and removing its rows, and a named `table.column` covers dropping that column. Anything the list leaves out is refused, by name, and nothing changes. At a terminal with no consent, every deletion is listed, with each table's rows and each column's non-empty values, and the command asks. With no terminal and no consent, it refuses at once, changes nothing, and prints the consent that would cover it, where `migrate:fresh` used to wait for an answer nobody could give. `migrate:fresh` deletes every table, so it takes the consent without a list, and `migrate:down` takes it without a list too while it judges a DOWN as a whole.

  **Earlier consent spellings** keep working for what each covered before, and say they are deprecated, naming the new spelling: `NEXTLY_ALLOW_CODE_FIRST_DROPS` for the development push and `db:sync`, `--allow-data-loss` for `migrate:down`, `--force` for `prune` and for `migrate:fresh`. Each covers only its own command's deletions; anything else in the same run needs the new consent. Once the new consent is given, it alone decides: an earlier spelling still set beside it is named as ignored, so it cannot widen a list.

  **`plugins uninstall --yes` no longer drops tables.** A full uninstall drops the plugin's tables only with the data-loss consent (`--accept-data-loss`, or a list naming its tables); `--keep-data` is unchanged and needs none. A script that uninstalls with `--yes` and no consent now stops, changes nothing, and names the consent that would let it continue.

  `nextly prune` with no consent and no terminal still lists the orphaned tables and drops nothing, and now prints the consent that drops them. Each orphan is listed with the archived translations its removal deletes.

- [#2936](https://github.com/nextlyhq/nextly/pull/2936) [`01d930a`](https://github.com/nextlyhq/nextly/commit/01d930a7323a9e5fa364ec554f884e5da2de8fa9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every person with no saved dashboard now gets one default, built from one `defaultLayout`: the site's `admin.dashboard.defaultLayout`, or core's own when the site gives none. A site's default is applied: its cards, in its order, at the sizes it states and with its starting settings. An entry marked `optional: true` is left out without a fault when its widget is not installed.

  After the default's own cards come the plugins' suggestions (`contributes.dashboard.suggest`), in the order the site lists its plugins, unless the site sets `suggestions: false`. Widgets of the older contribution shape are suggested by being declared, ordered by `defaultOrder`, so today's defaults keep their cards. A suggestion never reaches a dashboard someone has saved; the add panel offers it there.

  Each person's default leaves out the cards they may not see, including a declared card whose `access` refuses them or whose `shows` answers no. A first save keeps those cards in the row, so they come back once shown.

  Also in this release:
  - `contributes.dashboard.widgets` is optional, for a plugin that adds only Needs attention items.
  - `defineAttentionItem`, `AttentionItem` and `AttentionCount` are exported from `@nextlyhq/plugin-sdk` (experimental), for declaring a plugin's items under `contributes.dashboard.attention`; each reaches the attention digest as a warning.
  - A list with an empty slot (`[a, , b]`) in `admin.dashboard` or `contributes.dashboard` is refused, naming the list.
  - Startup's dashboard warnings go through the app's configured logger.

- [#2845](https://github.com/nextlyhq/nextly/pull/2845) [`b94fc6e`](https://github.com/nextlyhq/nextly/commit/b94fc6e7d4a8cf10a1be742ce0a95d43ccce0320) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Every dashboard card is drawn in one frame, which draws every state.** (experimental)
  - **One header, one height.** A card's header is one fixed height in every state, size and mode. It shows the card's subject as its title ("Posts") and the widget's own name beneath it when the two differ ("Count"); a card set to no collection is titled as its widget. The quick control and the card's menu sit at the header's right end, in that order, on every card. The declaration's description is no longer drawn in the header (the add panel still shows it).
  - **One spacing.** Cards are padded 16 px with 12 px between header and body. The grid puts 16 px between cards, widening to 24 px across (never down) where the dashboard is at least 1,280 px wide.
  - **The frame draws every state.** Loading, refreshing, empty, error and not-available are drawn the same way on every card, from one `CardState`. A failed answer for a card drawn by its own component is now the frame's error, with Retry, or the one not-available state; the component is not called. A component that reads something more from a good answer (nothing in it, or an answer it cannot read) returns `FrameState` with that state, and the frame draws it.
  - **No "Updated" line on cards.** Cards no longer say when their data arrived. The dashboard grid marks when the oldest answer it shows arrived (`data-answered-at`) for a page-level indicator.
  - **Refresh in the card menu.** Every card that asks for data has Refresh in its menu, which asks again for that card alone. The menu stays reachable while the card's settings cannot be saved; only Settings is disabled then.
  - **`hidesWhenEmpty`** on `defineWidget` (and core's own declarations) takes a card off the dashboard while its answer is empty, rather than drawing the empty state. A failed or not-available card is never hidden, and customise mode still shows it, marked "Hidden while empty".

  **Breaking, with no replacement or deprecation period:**
  - `chrome` is gone from widget declarations, and a widget that names it is refused at startup ("chrome is not a widget field"). Every card is framed. `WIDGET_CHROME` and `WidgetChrome` are no longer exported from `nextly` or `@nextlyhq/plugin-sdk`.
  - `CardEmpty`, `CardError`, `CardSkeleton` and `CardUnavailable` are no longer exported from `@nextlyhq/admin` or `@nextlyhq/plugin-sdk/admin`. A widget's component returns `FrameState` instead.
  - `RecentEntriesWidget` and the standalone `RecentActivity` section (and `RecentActivityProps`) are no longer exported from `@nextlyhq/admin`; the dashboard's own Recent entries and Recent activity cards replace them.

- [#3103](https://github.com/nextlyhq/nextly/pull/3103) [`9900d7e`](https://github.com/nextlyhq/nextly/commit/9900d7eead3fd9e95bee73eaf2b2ee7273bb3652) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin adds dashboard widgets one way: each declared with `defineWidget` under `contributes.dashboard.widgets`, its data read by the widget's `load` as the person asking. **Breaking:**
  - `contributes.admin.widgets` and `contributes.widgetSources` are no longer fields of a plugin's contributions. Startup refuses a plugin that still carries either, naming the plugin and the key, with the new error code `NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL`. Declare each widget with `defineWidget` under `contributes.dashboard.widgets`, and read its data in its `load` (`services.count`, `find`, `groupBy`, `timeseries`) instead of answering a source.
  - `nextly` no longer exports `registerWidget`, `overrideWidget`, `extendWidget`, `deregisterWidget` or `registerSource`. Declare a widget with `defineWidget` under `contributes.dashboard.widgets` (a plugin) or `admin.dashboard.widgets` (the site config), and change, replace or hide another widget with the site config's `admin.dashboard.overrides`, `replace` and `hide`.
  - `@nextlyhq/plugin-sdk` no longer exports `registerWidget` or `registerSource`; declare the widget with `defineWidget` under `contributes.dashboard.widgets`.
  - `nextly` and `@nextlyhq/plugin-sdk` no longer export the types `PluginWidgetSource`, `PluginSourceResolver` and `PluginManySourceResolver`, the contract `contributes.widgetSources` took. A widget's `load` is typed by `defineWidget`.

- [#2824](https://github.com/nextlyhq/nextly/pull/2824) [`b900812`](https://github.com/nextlyhq/nextly/commit/b900812ce26fbce192823945195b62eb9dbc201a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - nextly's table bundles, per-feature table helpers and core schema now load only the running database dialect's table definitions, where before importing nextly loaded all three dialects'.

  The `schema` export, which held all three dialects' tables, is removed from `nextly` and `nextly/database`. Read tables with `getDialectTables(dialect)` after creating the adapter.

  Four functions now read a loaded dialect's tables, and throw, naming the fix, if called before that dialect is loaded:
  - `getCoreSchema`, from `nextly` and `nextly/schemas`;
  - `getStaticRelations`, `getDialectTables` and `getDialectTablesForPush`, from `nextly` and `nextly/database`.

  Creating the adapter loads its dialect, so code that runs after that is unaffected. Code that calls them without an adapter, such as schema tooling, first runs `await loadDialectTables(dialect)`, exported from `nextly`, `nextly/database` and `nextly/schemas`.

  `new ServiceContainer(adapter)`, from `nextly`, reads its adapter's tables when it is constructed. An adapter made by `createAdapter`, or handed to Nextly's config, is unaffected; one built directly from `@nextlyhq/adapter-postgres`, `@nextlyhq/adapter-mysql` or `@nextlyhq/adapter-sqlite` first needs `await loadDialectTables(adapter.getCapabilities().dialect)`, and the constructor's error names that line. `seedPermissions` and `seedSuperAdmin`, from `nextly/database/seeders`, load the dialect of the adapter they are given themselves.

- [#3166](https://github.com/nextlyhq/nextly/pull/3166) [`1be91d5`](https://github.com/nextlyhq/nextly/commit/1be91d5951bb8c4fbc2030aeeda1b5e4d5859b2c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A return to the dashboard no longer leaves out, for its first frame, a card that needs a permission (Upcoming releases): each new screen asks for your permissions again while the answer it holds keeps counting, so nothing under that card moves.

- [#2892](https://github.com/nextlyhq/nextly/pull/2892) [`7faa40c`](https://github.com/nextlyhq/nextly/commit/7faa40c3693b8444334ce71553d5b8c217b47afb) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Settings and the Email hub are granted by plain permissions. `create-settings`, `update-settings` and `delete-settings`, `update-email-providers` and `update-email-templates` are seeded, and settings create and delete are no longer hidden from the permission list. Each settings and email gate asks the permission its action names, so a role ticked "update settings" can change the general settings, the languages and the sidebar. Image sizes ask their own action on settings rather than `manage-settings`. A schema change (a collection's or a Single's definition) asks all three of create, update and delete on settings. A role holding a `manage-` permission keeps every one of these, since it still counts as the plain four.

- [#2877](https://github.com/nextlyhq/nextly/pull/2877) [`51bba02`](https://github.com/nextlyhq/nextly/commit/51bba0271701ae7fac8626cc2f509eb78ed74b9f) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Blocks a plugin contributes now reach the page builder's editor. A plugin declaring blocks names an `editorEntry`, a module exporting the same definitions; `nextly generate:types` imports it in the admin's component map, and the editor offers those blocks in the Add panel and its search, with an inspector, and opens stored pages holding them without a placeholder. A block's own inspector (`editor.component`) is drawn in place of its generated content controls and given `{ node, props, commit, readOnly }` (`BlockInspectorProps` from `@nextlyhq/plugin-sdk/blocks`, experimental). Block code can read the document and window it is drawn in through `useBlockEnvironment()` from the new `@nextlyhq/blocks-react/environment` entry. A block registered in code rather than declared reaches the server only, and development now says so once, naming it.

- [#3014](https://github.com/nextlyhq/nextly/pull/3014) [`7d4131e`](https://github.com/nextlyhq/nextly/commit/7d4131ee6dd7305c5ea23a24931dbceecec81172) Thanks [@faisal-rx](https://github.com/faisal-rx)! - On the roles screen, two permissions a plugin declares under the same name on the same resource are told apart by their action as well, so each switch reads differently, for example "Export (reports, export-csv)". A plugin group's folded level stays on one line beside a long plugin name.

- [#2887](https://github.com/nextlyhq/nextly/pull/2887) [`dbc6d49`](https://github.com/nextlyhq/nextly/commit/dbc6d49213d8292f9fe7e544ab65616e2be26f2a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Opening a plugin's admin page directly, from a bookmark, a refresh or a link, no longer shows "Page Not Found" while the admin loads. The page's address shows a loading state until the plugin pages are known, then the page itself, or a genuine not-found page if no plugin provides it. If the admin's metadata could not be loaded, it says so and offers Try again instead of waiting forever. Other addresses that match nothing still show not found at once.

- [#2869](https://github.com/nextlyhq/nextly/pull/2869) [`8e2a2ff`](https://github.com/nextlyhq/nextly/commit/8e2a2ff2abc40bfb738d21877e1e6d9e46c94327) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin no longer offers the built-in Public role where a role is given to a user or an API key, or built on by another role, since the server refuses it there. The roles screen still lists it. Each role the API returns now carries `assignable`, false for the Public role.

- [#2814](https://github.com/nextlyhq/nextly/pull/2814) [`14c115e`](https://github.com/nextlyhq/nextly/commit/14c115ea90de3bd59c1cd33dd69137448a7d019f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A write that changes only an entry's status, a publish or an unpublish, is now judged by its own permission and code rule alone. Before, it also needed the update permission and update rule, so a role that may publish but not edit could not publish at all. A publish-only caller sends the status alone, `{ "status": "published" }`, and the pending draft, if there is one, goes live with its fields still judged by their own rules. A write that names any other field, even at its current value, needs update too, and without it nothing is written, the status included. This holds over REST, the Direct API, a plugin's services, batch and query updates and Singles; publishing or unpublishing every language needs only its own permission, and the admin's capabilities answer publish the same way. A status-only write to every language (`locale: "*"`) that publishes asks the publish rule once in each language it puts live, as publishing every language does.

- [#2954](https://github.com/nextlyhq/nextly/pull/2954) [`574bc71`](https://github.com/nextlyhq/nextly/commit/574bc71a4d9202819df0784582000bdae8fc7375) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A caller who may publish an entry sees its pending changes, as one who may edit it does. A user who may read and publish an entry, but not change it, now publishes it from the read-only page: Publish on a draft, and Publish changes on a published entry holding an editor's draft. Publish and Unpublish send the status alone, which their own permissions judge, so they go through where a save is refused; Unpublish on the read-only page now works too. The same holds for a Single with a lifecycle. `GET /me/capabilities` answers `publishEveryLanguage` with publish alone on a collection with a Draft/Published lifecycle, so the admin offers Publish all languages to such a user; a Single, and a collection without a lifecycle, still ask update too.

- [#2834](https://github.com/nextlyhq/nextly/pull/2834) [`6682890`](https://github.com/nextlyhq/nextly/commit/6682890a2d5a0047fa0053f111f2791d7fe4d4f2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - On a document a user may change in one language and only read in another, switching languages shows the loading screen while the new language's access is checked, so nothing is shown or offered for it until that is known; the language the user may only read then opens read-only, with the reader's banner.

- [#2804](https://github.com/nextlyhq/nextly/pull/2804) [`50865a1`](https://github.com/nextlyhq/nextly/commit/50865a1589a0c038abcdf7c4164a8c8f700440f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An entry or a Single now opens for a user who may read it but not change it, on the same page an editor gets, read-only: a banner says their access lets them view it but not change it, and to ask an admin. Saving, discarding a draft, duplicating, previewing and sharing a preview are not offered, while unpublishing and deleting each still follow their own permission, and history and the id stay. Such a user makes no claim on the document, so nobody is told they are editing it. A custom edit view is handed the same read-only state through `documentLock`.

- [#2958](https://github.com/nextlyhq/nextly/pull/2958) [`ddf8c32`](https://github.com/nextlyhq/nextly/commit/ddf8c329ef43dd4eacc37d390436a890fd6d3e6b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A reader can now pin up to 20 entries and Singles to come back to, from the "Pin to dashboard" item in an entry's or Single's "More actions" menu. Pins are kept per reader on the server (`GET`, `POST` and `DELETE /api/dashboard/pins`), so they follow the reader across devices; an API key cannot pin.
  - A 21st pin is refused with a message naming the limit; pinning something already pinned is not a 21st.
  - A pin needs read access to what it names. While a reader may no longer read a pinned entry, it is left out of their pins with no title and no placeholder, and kept, so it returns if their access does.
  - Deleting an entry (one, several, or by query), a Single or a whole collection deletes every reader's pins of it, in the delete's own transaction.
  - Before `nextly migrate` creates the pins table, a reader has no pins, a pin is refused naming the command, and deletes work as before: the table's presence is asked before the delete's transaction opens.
  - The admin's `useDashboardPins` hook and the pin action are ready for the dashboard to draw pins (`@experimental`).
  - A delete inside a transaction its caller holds asks whether the pins table exists on that transaction's own connection, so it completes on a pool of one connection. `DrizzleAdapter` gains the internal `tableExistsThrough`, the catalogue lookup `tableExists` makes, run on a given executor; `tableExists` answers as before.

- [#3034](https://github.com/nextlyhq/nextly/pull/3034) [`4a250c9`](https://github.com/nextlyhq/nextly/commit/4a250c99e6b96a6ce0ca9a47e5577bc9f21ac504) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - Reads of a translated site take fewer round trips to the database:
  - A translated entry's detail read takes its translations in the same query as the entry, so
    one statement does what two did. A site with one language matches its translations with `=`
    rather than `IN`.
  - A Single's and a component's registry row are read from the same one-second cache a
    collection's already is, outside a transaction. Every registry write this process makes clears
    it at once; a change made by another process is seen within a second.
  - A Single's or a component's translations table is described once per definition instead of
    on every read, and a collection's translated read takes its registry row from that cache.

  Every read returns what it returned before.

- [#3040](https://github.com/nextlyhq/nextly/pull/3040) [`b0ddc60`](https://github.com/nextlyhq/nextly/commit/b0ddc60200569db36757d37bd5ed05e603d28532) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Red now means a deletion, and the Schema Builder speaks one plain language.
  - **`AlertDialogAction` (`@nextlyhq/ui`) is primary by default.** It was red
    by default, so every dialog that confirmed a save, a publish or a restore
    looked like data loss unless its caller overrode the colour. It now takes
    `variant?: "primary" | "destructive"`, defaulting to `"primary"`. If your
    own dialog confirms a deletion and relied on the red default, pass
    `variant="destructive"`. The admin's own dialogs that delete data (a
    field's delete, a removal or a value-losing type change in the save
    review, a discarded draft, a copy over another language's values, a
    dashboard reset or replace) pass it.
  - **The Schema Builder's save review is red only when the save deletes stored
    values.** The colour now follows the preview's rows: a removed field is
    always red, and a type change is red when the preview classes it as able to
    lose values (today it classes every type change so). A change that only
    needs an answer, or values moving to the translation archive, no longer
    shows a red save. A save that removes a field always opens the full review,
    not the short confirmation.
  - **Field types have one plain name everywhere:** "Rich text" (was
    "Editor"), "Image or file" (was "Media"), "Link to entries" (was
    "Relationship"), "Repeating rows" (was "Repeater") and "Field group" (was
    "Field Group"). Type ids are unchanged; only what a person reads moved.
    The field settings sheet shows the plain name, not the internal id.
  - **The Builder names the kind it edits** (collection, Single or field group)
    in its empty states, titles and messages, and writes titles, labels and
    buttons in sentence case, the confirming action last.

- [#3008](https://github.com/nextlyhq/nextly/pull/3008) [`ffca213`](https://github.com/nextlyhq/nextly/commit/ffca213a0804b7b7ca7fc31750cee147c42b7f5d) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - Releases gain two experimental operations that each do several things, all
  of them or none, in one database transaction. A refusal, or a failed write
  (the last one included), leaves no release, no document and no revision
  change behind.
  - Adding several documents to a release at once, each with its action:
    `nextly.releases.addMembers({ releaseId, members })`, or
    `POST /api/releases/:id/members/batch`. Each document is checked as adding
    it alone is checked, and a selection that would take the release past its
    200 documents is refused whole, saying how many fit. A hard problem in the
    refusal names its document in `data.problems[].document`. It is how the
    linked documents an add offers are added.
  - Scheduling a document in one step:
    `nextly.releases.scheduleDocument({ into, document, linked, ... })`, or
    `POST /api/releases/schedule-document`. With `into: "own"` it makes a
    single-document release, scheduled; with accepted linked documents it makes
    an ordinary release holding them all. `into: "existing"` adds to an ordinary
    draft or scheduled release, and `into: "new"` makes a draft release.

  Behaviour change: taking the document out of a single-document release that
  has not run (draft, scheduled or stopped) now cancels that release through
  the cancel operation, under its permission (`publish-content-releases`), and
  keeps it as cancelled. Before, a draft or stopped one was left empty, and
  the document of a scheduled one could not be taken out. Whoever may create
  but not publish releases is now refused this, and the release's
  `can.removeMember` says so. The answer says which happened:
  `nextly.releases.removeMember` now resolves to `{ releaseCancelled }`
  instead of nothing, and `DELETE /api/releases/:id/members/:memberId`
  returns the same field. A removal retried after its answer was lost finds
  the release already cancelled and is answered as done. The admin's release
  page asks to confirm cancelling a single-document release when its document
  is taken out, and says the release was cancelled.

- [#2962](https://github.com/nextlyhq/nextly/pull/2962) [`f457522`](https://github.com/nextlyhq/nextly/commit/f457522941b1c8aa5039e49e998bf33e0f9dc77e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A release now admits a document where its author's publish or unpublish rule answers a filter that matches it, rather than refusing every document under a rule that answers a filter. Adding a document, switching its action and the readiness check before a run match the document against the rule's filter, as the run's own write does; a document the filter does not match is refused, and a document the author may not read is answered as one that is not there. An API key is judged by its own grants and rules as well as its maker's.

- [#3031](https://github.com/nextlyhq/nextly/pull/3031) [`b7c815d`](https://github.com/nextlyhq/nextly/commit/b7c815d5fbfb8c8ca9b05899640270b708794cb7) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - A release's owner is now told when it misses its time. A release still scheduled more than 10 minutes after its time gives its owner one notice of kind `releases.overdue`, recorded by each `releases:drain` pass before it runs anything, or, for a release published that late, in the transaction that publishes it. The notice says the release missed its time, or that it ran late. Both are keyed on the instant missed, so one miss is one notice, and a pass seen twice tells nobody again.

  Where the site can send email, every new release notice, stopped or overdue, is also emailed to its person, with a key made from the notice's id, and only to an active person who may still read releases, asked again on every attempt. The job that sends the email is recorded in the notice's own transaction, so a notice never stands without it, and retries a send that may succeed later with backoff, as many times as a queued email. The email writes the release's time in the zone it was scheduled in, named, and links to the release only when `NEXT_PUBLIC_APP_URL` is set. `NoticesService` gains `byId`, and the stopped notice keeps the release's zone. A new job type, `releases:notice-email`, is registered.

- [#3017](https://github.com/nextlyhq/nextly/pull/3017) [`f18bcd8`](https://github.com/nextlyhq/nextly/commit/f18bcd878878283a9577cd19ba924c98a5b4a164) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - A release's page now names its documents by title, grouped by collection, and says of each whether it goes live or comes down and whether it is ready, with what is wrong and the way to fix it: open the document, or take it out. A summary says how many are ready ("5 of 6 ready"), and Schedule and Publish now wait while a document would stop the release, or while its documents have not loaded. Documents the reader may not view are counted in their collection ("2 documents you can't view · Posts") and never named. The title and description are edited in place by someone who may rename releases; a document is switched between going live and coming down, or taken out, by someone who may change the release's documents; and Schedule, Publish now, Cancel and Delete are offered as on the releases list, each only to those the server says may take it. Taking the only document out of a single-document release says first that it cancels the release, and is offered only to someone who may cancel releases, as the server's capabilities say. Beside the documents, the page shows the release's owner, time zone and creation date, and its history from the record of content events: who created, renamed, scheduled or ran it, and which documents were added, switched or removed.

- [#3131](https://github.com/nextlyhq/nextly/pull/3131) [`8dda2e9`](https://github.com/nextlyhq/nextly/commit/8dda2e9e6ae2da184d0c5a1b043b6ccba193cf25) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Removing the image sizes an earlier release stored.** Items uploaded before image sizes were removed still name their size files in the media table's `sizes` column, and the size definitions are still in the `image_sizes` table. This release adds the way to remove them, in two steps run after it is deployed, and nothing is removed until you run them. Until then your site keeps working, and startup names what is left. Where the note on image sizes says nothing stored is removed, read it as nothing removed automatically: neither that change nor this one removes anything stored, and these commands remove it only when you run them.
  - `nextly media remove-sizes` lists, as a dry run that changes nothing, every size file items name, which it would remove and which it would keep. `nextly media remove-sizes --apply` **deletes those files from your media storage** and then clears each item's `sizes`, item by item. It never deletes an original or a thumbnail: an item whose thumbnail is one of its sizes keeps that file, as does any size file another item uses, checked again just before each removal so an upload made meanwhile keeps its file. An item is left as it is, named, and the command exits non-zero when the storage fails to delete one of its files with anything but an error saying that file is not there, when its files are on another storage than the one configured now (a URL relative to the site counts as local disk), when a size is recorded by its path alone (which shows no storage, so it is left for you to remove by hand), or when that check cannot be made; running it again picks up where it stopped.
  - `nextly media remove-sizes --apply --drop` then **drops the `image_sizes` table, with its rows (the size definitions), and the `media.sizes` column**. It drops nothing while any item still names a size file or another table has a foreign key to `image_sizes` (each key is named, and the drop never cascades), and drops each only when the database shows it is what image sizes left; a table of that name that is not shown to be Nextly's is kept and named. `nextly migrate` never drops either, from the command line or at startup.
  - A new install has neither the column nor the table, `CORE_TABLE_NAMES` (from `nextly/schemas`) no longer lists `image_sizes`, and the `media` table exported from `nextly/schemas` no longer declares `sizes`. The name `sizes` is reserved on the media table: a column an app or a plugin contributes under it is refused.

  **Back up first, and restore both together.** Before `--apply`, back up the database (`pg_dump`, `mysqldump`, or a copy of the SQLite file) and the media storage folder or bucket (for example `cp -R public/uploads …` or `aws s3 sync s3://your-bucket …`), at the same time. To undo the removal, restore the database dump and copy the files back to the same paths; restoring one without the other leaves records and files that disagree. The media storage guide has each step: deploy, dry run, back up, remove, drop, check, restore.

- [#2975](https://github.com/nextlyhq/nextly/pull/2975) [`34980f0`](https://github.com/nextlyhq/nextly/commit/34980f04181f19d9e4641ec3806dbc636d5abb92) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Three more writes to a collection removed from code are refused at their start with `ENTITY_REMOVED_FROM_CODE`, as every other write to one already is: an update or delete by query that matches nothing (the REST `bulkUpdateByQuery` and the Direct API's `update` and `delete` with `where`), which answered success; unpublishing every language when the collection's translation table has no per-language status, which answered that conflict instead; and a batch write in partial mode, which counted each entry's refusal among its failures without its code. Nothing changes for a declared collection.

- [#3041](https://github.com/nextlyhq/nextly/pull/3041) [`e0a5273`](https://github.com/nextlyhq/nextly/commit/e0a527317e6d05e823dc20d688d40d49d5bad2fe) Thanks [@zeshan-rx](https://github.com/zeshan-rx)! - Renaming a collection or Single in the Schema Builder is now quick on a long release record. The rename rewrote each stored JSON value that named the old slug in a statement of its own, inside the rename's transaction: every event in a release's history about one of the entity's documents, every webhook filter listing it. JSON values are now written many rows to a statement, so the number of statements no longer grows with the number of events, on PostgreSQL, MySQL and SQLite alike. The rename now reads, from release history, only the events about a document.

- [#3001](https://github.com/nextlyhq/nextly/pull/3001) [`d2401dd`](https://github.com/nextlyhq/nextly/commit/d2401dde83150446b45fab098e75566c15df6f14) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A new `nextly repair-columns` command reports every column whose type or nullability differs from its field, on the tables Nextly builds from field definitions (collections, Singles, field groups, user fields and their translation tables). Each column is judged against its field as the database last had it applied, read from the newest applied migration snapshot (or, where none records the entity, its registry row): a missing table or column is reported as not migrated, and a change that no migration has applied yet (including an entity or user field no migration has created) as pending, pointing to `migrate:create`. A plugin's column names the plugin, and where it can the report says why a column differs: created before a named release, or by a generator that still creates it. It changes nothing in the database, and it refuses to give a verdict when an applied migration snapshot cannot be read.

- [#2611](https://github.com/nextlyhq/nextly/pull/2611) [`32fc290`](https://github.com/nextlyhq/nextly/commit/32fc29099457c8c6935a3d0a3f80f6bb25d37057) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A translated field marked Required or Unique can now stop being translated in one change, in the Schema Builder (a collection's save and schema dialog, a Single's save and schema dialog, a field group's schema dialog) and through `nextly migrate:create`. Its shared column is created without the setting, filled with the default language's values, and then made required or unique. Before anything runs, the Builder checks that the values can take the setting: an entry with no default-language value refuses Required, and two entries that would end up with the same value refuse Unique. The refusal names the field and how many entries are in the way, never a value, and the schema dialog shows it before Apply. `migrate:create` has no database to check against, so it applies the setting after the copy and before the translated column is dropped, and a value the database refuses leaves everything in place. In a schema dialog, a setting the database refuses leaves the field translated with every language kept, and saving again finishes the change. A Single's schema save records the field without a refused setting, and its next save applies it.

- [#3010](https://github.com/nextlyhq/nextly/pull/3010) [`a4a357c`](https://github.com/nextlyhq/nextly/commit/a4a357c2f25687f69699d35589a46d6c11c17daa) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Each start names the roles still holding a retired manage permission only after its own seeding has run, so a built-in role that seeding converts is no longer named for an upgrade the same start already made. `nextly upgrade` checks scheduled releases once after converting roles, rather than once for each role it converts.

- [#2964](https://github.com/nextlyhq/nextly/pull/2964) [`c35e0d0`](https://github.com/nextlyhq/nextly/commit/c35e0d044bd651d5f05556cd6cdcdeb3bbbd7d8b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin route whose `requiredPermission` is `manage-media`, `manage-settings`, `manage-email-providers` or `manage-email-templates`, or a `ctx.caller.can("manage", resource)` on one of those four, is answered by the plain read, create, update and delete there together: a caller holding all four passes, one missing any of them is refused, and a role `nextly upgrade` has not yet converted passes as before. Each plugin that asks is warned once, naming the permission to ask instead; ask the plain permission the route needs, such as `update-settings`.

- [#2959](https://github.com/nextlyhq/nextly/pull/2959) [`4634e7c`](https://github.com/nextlyhq/nextly/commit/4634e7c504e57b9a8e96160afd0ca8ef0f6e3eca) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Run `nextly upgrade` after updating. It converts each role holding a retired manage permission (manage-settings, manage-media or manage-email-\*) into the four plain permissions it stands for; until it runs, those roles keep working as before.

  `manage-media`, `manage-settings`, `manage-email-providers` and `manage-email-templates` are retired in favour of the plain read, create, update and delete permissions there. `nextly upgrade` gives each role holding one the plain four on that resource and takes the `manage-` permission off, once. Until a role is converted, each start names it, with the command to run. Setting, creating or updating a role with one of these `manage-` permissions now stores the plain four instead, which gives the same access, and so do role presets and the super-admin seeder at each boot. Removing a retired manage permission from a role removes the four permissions it stands for. `manage-background-jobs` is unchanged.

- [#2987](https://github.com/nextlyhq/nextly/pull/2987) [`7c07a60`](https://github.com/nextlyhq/nextly/commit/7c07a60e4cfdafdc5c0df225fddddc779dea34b9) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Run `nextly upgrade` after updating. Roles that held manage-settings, manage-media or manage-email-\* keep their access only once it has run.

  `manage-media`, `manage-settings`, `manage-email-providers` and `manage-email-templates` are no longer counted anywhere: a role holding one of them, not yet converted by `nextly upgrade`, is refused read, create, update and delete on that resource, by the server and in the admin, until it has run. The four are no longer seeded; an install that has them keeps their rows, so the upgrade can still find the roles holding them, and each start still names those roles. On the roles screen, such a role's media, settings or Email hub row reads No access, with a note to run `nextly upgrade`; saving the role converts it too. `manage-background-jobs` and `manage-permissions` are unchanged.

- [#2891](https://github.com/nextlyhq/nextly/pull/2891) [`833a63f`](https://github.com/nextlyhq/nextly/commit/833a63fbb190a4830c275a3b5581ea9c4688091d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal groundwork for the roles screen's per-collection access levels, with no change to what anyone may do. The admin gains the rows the roles screen will show, one per collection and Single, from the screen's list of entities and the permissions: the level a role's permissions give each row, what setting a level changes (only that row's standard actions; inherited permissions, the row's other actions and every other row are kept), and which levels a role's base roles leave on offer. Nothing uses them yet.

- [#2970](https://github.com/nextlyhq/nextly/pull/2970) [`4e3dc88`](https://github.com/nextlyhq/nextly/commit/4e3dc88d700e8cb2773984485641339e33a3d31b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The roles screen sets one level per collection and Single: No access, Can view, Can edit or Can publish (a Single has no create or delete, so its Can edit is view and edit). The levels sit side by side on a wide screen and in a select on a phone. Each row's "Each action" switch shows a switch for each of its permissions; a row whose actions match no level reads Custom and is saved exactly as its switches stand. A base role's grants show on the rows they give to, marked "from" the base, and a row offers no level below them. The roles screen now reads its collections and Singles from `GET /roles/screen`; permissions that belong to no collection or Single stay in the grid below, whose Clear All takes away only its own.

- [#2991](https://github.com/nextlyhq/nextly/pull/2991) [`92891bb`](https://github.com/nextlyhq/nextly/commit/92891bb185e208492a4802d99f2e0ce4171189c5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The roles screen folds each plugin's collections under the plugin's name, closed at first, with one word for what a role holds across them (a level, or Custom). Open, a plugin shows a level row for each of its collections and a switch for each permission it declares of its own, such as the form builder's Export Submissions. A plugin that declares permissions but contributes no collection gets its group too. Those permissions leave the grid below, which keeps the remaining settings permissions.

- [#3012](https://github.com/nextlyhq/nextly/pull/3012) [`69c15e4`](https://github.com/nextlyhq/nextly/commit/69c15e4f521744114f1d0562cfacfb566207980e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The roles screen sets media, settings, email providers and email templates by level (No access, Can view, Can edit), in a new "Media, settings and email" section beside collections and Singles. A role still holding a retired `manage-` permission on one of them reads Can edit, with a note that `nextly upgrade` converts it into the plain permissions, and saving the role keeps that access. The Settings row says that changing collections and Singles needs Can edit on Settings.

- [#2942](https://github.com/nextlyhq/nextly/pull/2942) [`59a218a`](https://github.com/nextlyhq/nextly/commit/59a218aea2454b0e8f3d5fc97fd49ecc59ae86f1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Pages built with nextly's route helpers now prerender a static shell under Next.js Cache Components. The blocks page helpers in `@nextlyhq/blocks-react/next` (`createBlocksPage`, `createPublicBlocksPage`, `createSinglePage` and `createPublicSinglePage`) render their page inside a `<Suspense>` boundary, so what a page reads at request time (a preview cookie, an access-enforced read, a path the build did not list) streams in beneath it. Their page components keep the same type. `createContentRoute` and `createSingleRoute` from `nextly/runtime` stay free of React: with Cache Components on, render their page inside a `<Suspense>` of your own, as the routing guide now shows.

  An uncached read now waits for the request with Next.js's `connection()` instead of calling `unstable_noStore()`. Outside a request, in a script or a test, it runs as before.

  `releaseBoundedRevalidate` from `nextly/runtime` takes the same arguments. With Cache Components off, nothing changes. With Cache Components on, it returns the lifetime you pass and reads neither the clock nor the database, so a scheduled release reaches a page cached there only through the cache tags its schedule flushes, not by shortening the page's lifetime. Cache Components stays off by default until a release going live refreshes cached pages under it too. Nextly reads whether Cache Components is on from the value Next.js writes into the code it bundles, so an app that loads `nextly` unbundled, as `serverExternalPackages` does, keeps the release bound.

- [#3117](https://github.com/nextlyhq/nextly/pull/3117) [`1eea1bd`](https://github.com/nextlyhq/nextly/commit/1eea1bde9fbd47511b06a7618eb8cabb4e63f00e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Sample content on the setup card loads at most once at a time for the whole site, and every outcome stays on the card until the person has seen it.
  - **One load at a time.** The project's sample-content route hands its load to Nextly's runner (`sampleContentPost` from `nextly/database/seeders`), which claims the site's one load in `nextly_meta` before loading anything. A start while another load is unfinished, after somebody loaded or declined, or after a failed load without `{ "confirm": true }` is refused with 409 and loads nothing, on every dialect. No new table: the latest load or decline is one `seed.current` row, claimed by one conditional write (inserted only where none exists, then moved only from the failed load it was read as), so every read of the site's answer is three rows however many loads were tried; `seed.run.<n>` keeps a copy of the last three, and `seed.completedAt` and `seed.skippedAt` keep their meaning. The route answers a load as `{ message, item }` and a refusal or failure in the standard error envelope, with `data.reason`; its confirmation body is read through the bounded byte reader.
  - **Offered only to someone who can load it.** "Load sample content" is offered only when the route's probe answers 2xx for this person, only while the site holds no entry and nobody has answered. When the site's answer cannot be read, the card offers no load and shows "Add your first entry". The card asks for the site's current answer whenever the dashboard regains focus, and after every answer from the server.
  - **Every outcome stays.** A probe that fails or refuses withholds only the offer, never a load the site started, so setup never retires over one. A load's progress and outcome survive the card being drawn again, customise mode included. A load that never reported says "A load started at <time> has not finished" and starts nothing else, however long ago it started. A failed load says what failed, with "Add your first entry", and Try again (while the site holds no entry) warns that some content may already be there and loads again only once confirmed. A load whose record failed says exactly that, and its Try again records it without loading again. A check of the other steps that fails while a run is on show is said beside it, with its own Retry. Continue shows the steps as they are now.
  - **Declining and recording are Nextly's.** `PUT /api/dashboard/setup` takes `sample: "decline"` and `sample: { record }` (internal to the admin), so neither reaches a route that loads. The blog template's `/admin/api/meta/seed-status` declines through the same runner and no longer writes `seed.completedAt`; `GET` also answers the site's answer and its load. Nothing is retried on its own.
  - **Inside the admin** (none of it published), the `useSeedStatus` hook and `seedApi.runSeed`, `getStatus` and `setSkipped` are replaced by `seedApi.start` and the setup card's own data. A project route older than the runner still loads, as before, without the single-load guarantee: copy the blog template's two routes to get it.

- [#3143](https://github.com/nextlyhq/nextly/pull/3143) [`0ba50cd`](https://github.com/nextlyhq/nextly/commit/0ba50cd3d598b1382a0a8f34bb6119b6dc50aa73) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's setup card no longer fails a request on every load on sites without a sample-content route, and setup can finish there.

- [#3101](https://github.com/nextlyhq/nextly/pull/3101) [`c3e320b`](https://github.com/nextlyhq/nextly/commit/c3e320b8040f3fe6548f29249eabbe25cfb149a1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The editor's Publish button gains an arrow with "Schedule publish…" and "Add to release…". Schedule publish… asks for a date, a time and a time zone, says back when the document will go live, and refuses a time that has passed. It then makes a release holding only this document, scheduled for that time, in one step that lands whole or not at all. The release shows at once in the scheduled-release banner and in the document panel's Publishing section, which also offers Schedule publish… while the document is not scheduled. For a person who may not create and schedule releases, or publish the document, or who is on a translation, it stays in the menu, held, with the reason. While someone else is editing the document, it and Add to release… are held as Publish is. Where saving publishes at once (a live document with no drafts), the dialog says so rather than promising later saves wait for the release. Add to release… moves from the More menu to the same arrow. Where saving leads instead of publishing, on a published document with no unsaved edits, both stay in the More menu. The release is named after the title as it stands in the editor, saved or not. A release dialog left open by moving to another document no longer reopens on coming back.

- [#2857](https://github.com/nextlyhq/nextly/pull/2857) [`306db44`](https://github.com/nextlyhq/nextly/commit/306db442c8786b74874d718ac01f38493758159c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The scheduled-release banner is no longer hidden behind the editor's header. On an entry or a Single that is part of a scheduled release, the banner saying so now sits directly under the header, inside the editor, where it can be read and its link followed. Before, the editor's top row slid over it.

- [#3104](https://github.com/nextlyhq/nextly/pull/3104) [`2579766`](https://github.com/nextlyhq/nextly/commit/25797661eaaec2e3cbde5895c0c708897bc069a0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `MAX_ATTENTION_ITEMS_PER_PLUGIN` is now exported from `nextly` and from `@nextlyhq/plugin-sdk`: the most Needs attention items one plugin may declare, which startup holds every plugin to. It is intended to be stable, so a plugin with a line per collection it reads builds no more than this instead of restating the number; `@nextlyhq/plugin-seo` now reads it from the SDK.

  The SEO plugin's Needs attention lines now share one scan budget for each answer of the Needs attention card, rather than one each: ten large collections read at most one budget's pages between them on a dashboard load, and a line left short of the end says its count is a floor.

- [#3078](https://github.com/nextlyhq/nextly/pull/3078) [`dfa41cb`](https://github.com/nextlyhq/nextly/commit/dfa41cbf66e2e017033413041d8b39c79dfdedcf) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A production boot with `db.runMigrationsOnBoot` now refuses a pending Schema Builder migration file with no snapshot beside it, as `nextly migrate` does, rather than applying it as written.

  A plugin option holding a list named `fields` or `blocks` is recorded in a migration snapshot as it is written. The `access` key of its entries was dropped, as though they were field declarations, so a change to it produced no settings migration and no `SETTINGS_DRIFT`.

  Removing the last hook from a code-first collection or Single no longer reads as a settings change. Code-first hooks are functions, which snapshots do not record, so `nextly migrate:create` wrote a migration for nothing and `nextly migrate:check` failed until it was committed.

- [#3153](https://github.com/nextlyhq/nextly/pull/3153) [`4c0f45e`](https://github.com/nextlyhq/nextly/commit/4c0f45ebdbfc97af37f0a2a92e8596f0bba1feb7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's setup card stays one row of steps, at its own height, at every width: where the card is too narrow for every step to read in full, its steps scroll sideways inside it rather than wrapping and growing the card, so nothing under it moves as the dashboard loads.

- [#3114](https://github.com/nextlyhq/nextly/pull/3114) [`33265ee`](https://github.com/nextlyhq/nextly/commit/33265ee6198f86c1f295af159e3a781ca133376f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The setup card's collapse and dismiss sit in its header, beside the card's menu, whether the card is expanded or collapsed. The steps now span the card's full width, and their short hints ("2 of 5 · Open · Skip", "Invite · Skip") read in full on narrow screens. A collapsed card's header is fully visible, so no hidden control can take keyboard focus. A dashboard arranged before the setup card replaced Get started now shows the setup card in the same place, and Customize offers it back while it still applies to you. Reading a reader's setup state now takes one query, and later expanding or collapsing the card on another device is picked up.

- [#3093](https://github.com/nextlyhq/nextly/pull/3093) [`2a2163d`](https://github.com/nextlyhq/nextly/commit/2a2163d7b282e2aa4eb082401b9f09b324ce064e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's setup card is now "Set up your project" (`core/setup`): one compact row of step tiles at full width, offered to super-admins only, that collapses, dismisses and goes away once setup is done.
  - **The steps**, decided on the server from the site's data, each offered only to a reader who could finish it: start with sample content (where the project's sample-content route lets the reader load it, while nobody has answered and the site holds no entry), create a collection, add a first entry (which opens a new entry of the first collection the reader may create in), fill in your Singles (one step for all of them, "N of M filled in", opening a short list of the Singles) and invite a teammate. Skip is offered on the Singles and Invite steps only, and a skipped step counts as done.
  - **Not known is not open.** When a registry cannot be listed, or a check fails or runs out of time, the card says it could not check setup and offers Retry, and shows no step as open.
  - **Per reader, on the server.** Collapsing, dismissing and skipping are kept in the dashboard preferences (`nextly_dashboard_preferences`), so they follow the reader across devices, and never in the layout, so a reader following the default dashboard keeps following it. `GET` and `PUT /api/dashboard/setup` read and change them for the signed-in super-admin (internal to the admin). Until `nextly migrate` creates the preferences table the card is drawn expanded and its changes are not kept.
  - **Collapsed is one line.** A collapsed setup card is one grid row tall: "Set up your project · N of M done", with Expand and Dismiss. The card frame gains this for any body that collapses itself (`useCardCollapsed`, internal to the admin): the cell spans one row, and the frame keeps the card's title for assistive technology only, with no gap or footer, at rest and never in customise mode. Expanded, the card fits its 12 × 2 size: "N of M done" in the header beside the title (a card body may now report a short phrase there, as well as a count), a thin progress bar and one row of compact tiles. It grows in place only while the reader has the Singles' list open, or where its tiles wrap below 640 px.
  - **Resume setup.** While a dismissed card has not yet said "You're all set", the dashboard header ends its summary line with "Resume setup", for super-admins; pressing it brings the card back.
  - **Declining sample content** draws its tile done once the decline is recorded, and the card then asks for its steps again. A decline that fails keeps the step open, says it could not be saved, and Retry declines again.
  - **"You're all set" once.** When every step the card draws is done or skipped, the card says so once; from the next load it is gone, with no way to resume it. A sample step the project's route refuses the reader is not drawn, so it never holds the card open. The `onboarding:incomplete` condition reads the same answer, with the reader's skips, so it stops holding when their card is done.

  Removed, with no alias or conversion (the old card's shapes are used by no site):
  - the `core/get-started` widget, its `core#GetStartedCard` component and the layout read's `getStarted` field and `?getStarted=1` read. A saved layout that still names `core/get-started` no longer draws it.
  - `GET /api/dashboard/onboarding`.
  - From `nextly` and `nextly/config`: `GET_STARTED_WIDGET_ID`, `GET_STARTED_STEP_KINDS`, `GET_STARTED_SKIPPABLE_KINDS`, `GetStartedAnswer`, `GetStartedStep`, `GetStartedStepKind`, `GetStartedStepStatus`, `ONBOARDING_STEPS`, `isOnboardingStepId`, `OnboardingStepId` and `OnboardingStep`. In their place `nextly/config` exports the setup vocabulary (`SETUP_STEP_KINDS`, `SETUP_SKIPPABLE_KINDS`, `SetupStep`, `SetupAnswer`, `SetupCardData` and their helpers), `@experimental`.
  - From `@nextlyhq/admin`: `OnboardingChecklist` and `OnboardingChecklistSkeleton`.

- [#2851](https://github.com/nextlyhq/nextly/pull/2851) [`f2bd1e7`](https://github.com/nextlyhq/nextly/commit/f2bd1e7b443567ba72c14f99cd5b35db63e324bf) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Single created with "Blocks" (or another plugin field) as its answer to "How is this edited?" now gets that field, so its editor shows the Page Builder like a collection entry does. Before, the Single was created with no fields. New collections and Singles also write their starting field to `ui-schema.json`, which used to record them with none.

- [#2646](https://github.com/nextlyhq/nextly/pull/2646) [`9494cb2`](https://github.com/nextlyhq/nextly/commit/9494cb23c03a34cb3cc8943686ce7dd2bf2566de) Thanks [@aqib-rx](https://github.com/aqib-rx)! - On a site whose languages are stored rather than declared in its configuration, restoring a version recorded in one of the site's languages now writes that language's values instead of dropping them. After any change to the language list, cached pages are read again, so a page cached without a time limit no longer keeps serving the previous default language. A request to `/api/languages` with anything after the path now answers not found instead of listing or changing the languages. A site can have at most 200 active languages, the most a reorder can name, so the list can always be reordered.

- [#2981](https://github.com/nextlyhq/nextly/pull/2981) [`40a23d8`](https://github.com/nextlyhq/nextly/commit/40a23d8f182271613a9a9bcb98c3ab346049b9a0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin draws a plugin's detail page and the general settings page from smaller parts. Nothing either page shows or does changes.

- [#2808](https://github.com/nextlyhq/nextly/pull/2808) [`c2ff3da`](https://github.com/nextlyhq/nextly/commit/c2ff3da1307acafca08afa11645aa47dd6afc532) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Super-admin authority is decided in one place: from the roles a lookup finds for the caller.
  - **A user handed in by server code is judged by the roles they hold.** A `user` handed to the Direct API, or to a service, that names the `super-admin` role (`role` or `roles`) without holding it is now judged like any other signed-in user: by their roles and permissions, at the collection and Single gates and when relationships are populated. A user who holds the role, directly or through an inherited one, passes as before. If your server code hands Nextly a user object, its `role`/`roles` fields no longer grant anything; pass the user's id and let Nextly look them up, or use `overrideAccess: true` for trusted server work.
  - **A plugin's signed-in person is judged as the person** when relationships are populated, whatever user the read also names.
  - **The schema journal (`GET /api/schema/journal`) is read by a super-admin's session; an API key is refused.** The admin's notification bell reads it through the session and is unchanged.

- [#2823](https://github.com/nextlyhq/nextly/pull/2823) [`3c05b0a`](https://github.com/nextlyhq/nextly/commit/3c05b0a73f3f4e7117ae79703fa5895b02315aad) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A full-access API key made by an active super-admin now acts with super-admin authority at every way in: it holds every permission, passes every collection and Single access rule and the read rules of related collections, and reads the schema journal. Field rules still apply to it, as they do to a super-admin.
  - **Only a full-access key, and only while its maker is an active super-admin.** The authority is worked out for each request from the maker's standing, so the key loses it when the maker does (the super-admin role removed or expired, or the account deactivated) and gains it when the maker becomes a super-admin, within the bound the maker's own sessions follow.
  - **Read-only and role-based keys keep their types' limits**, whoever made them, and pass no access rule a super-admin would pass.
  - **A plugin route that narrows a key's scope** (`narrowScope`) carries none of this authority: the narrowed scope is judged on its own grants.
  - **`nextly.access.checkApiKey` returns an optional `actor`** (experimental): the key's own scope, to pass as the Direct API `actor`, so a route that checks a key itself is answered as a request on that key is.
  - **A key's super-admin authority lasts no longer than the bound a session follows** when its scope is kept past its request; after that the scope is judged on its grants alone.
  - **What Nextly keeps for a signed-in person still refuses every key**, this one included: granting or taking away super-admin, creating a preview link, and marking a version as seen.

- [#3074](https://github.com/nextlyhq/nextly/pull/3074) [`5126a6e`](https://github.com/nextlyhq/nextly/commit/5126a6ea290a1e57c2eed16f227d23dfc449d60d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A super-admin's full-access API key now has its authority answered once per request: every check the request makes gives the answer its first check gave, so a request that crosses the moment the authority lapses is no longer refused partway through, for example at a publish after its route admitted it, at a plugin route's write after the route's permission gate, or at each entry of a bulk publish. A request that starts after that moment is refused at its first check, as before.

- [#3097](https://github.com/nextlyhq/nextly/pull/3097) [`287f155`](https://github.com/nextlyhq/nextly/commit/287f1553775e90e6f4d9be289c3a3ac0207603fc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Super-admins can add a System health card to the dashboard: the running Nextly version, whether migrations are applied, and whether storage is working.
  - Three lines, always drawn: Version ("Nextly 0.0.2-alpha.66"), Migrations ("Up to date", "N pending" while boot migrations apply, or "Failed") and Storage ("Working", or "Last write failed 5m ago" with a short reason and the adapter). A line the answer did not settle, missing or with a status the admin does not know, reads "Couldn't check", never healthy. Each line leads with its severity by shape as well as colour: a check, a triangle, "!" in a filled circle, or "?" in an outlined circle, named in words for assistive technology.
  - Migrations read "Failed" when a migration has an apply or a rollback that failed or never finished and nothing has resolved since, the same standing `nextly migrate:status` reads (so a failed `migrate:down` of an applied migration counts), or a collection's last schema change failed or was interrupted (still open ten minutes after it started), with a link to resolve each: the migrations guide, or the collection in the Schema Builder.
  - Each problem is judged by its own migration's or collection's records, however many newer events the ledger holds.
  - Each problem also appears in Needs your attention as a critical "System problems" item: a migration's says to run `nextly migrate:status` to see which, and a schema change's or storage's links the Schema Builder's collections or the media library.
  - Only super-admins are offered the card, may place it or see its problems; nobody else is told it exists.
  - The storage layer now records its last failed server-side write, an upload, a delete or a bulk delete (when, the adapter's type, and a reason chosen from a fixed set, never the adapter's error message) and clears it on the next successful write. The record is kept per process and in memory: a restart or another instance does not see it.

- [#3105](https://github.com/nextlyhq/nextly/pull/3105) [`05ff350`](https://github.com/nextlyhq/nextly/commit/05ff35098105c525577bc74e2d578273dc88f020) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - System health is more careful about what it confirms:
  - A migration another process is applying (a CLI, or a second instance during a rolling deployment) reads as pending while its attempt is less than ten minutes old, the same threshold a schema change is judged by, and as failed only once it is older and still unfinished. Before, it read as failed as soon as this process's own boot migrations had settled.
  - The migrations line reads "Couldn't check" when the answer's schema-change result is missing or malformed, instead of "Up to date": only a schema-change result plus migrations "ok" reads healthy.
  - The version line reads "Couldn't check" when the answer carries no version, instead of a green "Nextly unknown".
  - A storage failure's age ("Last write failed 5m ago") now keeps counting while the dashboard stays open, on the same minute clock the other dashboard cards use.
  - A failed collection schema change followed by a successful retry in the same millisecond is now resolved by the retry on every database: the schema ledger stamps each collection's (and each Single's and component's) schema changes in strictly increasing start times, as it already did for each migration's records.

- [#2608](https://github.com/nextlyhq/nextly/pull/2608) [`ba752fb`](https://github.com/nextlyhq/nextly/commit/ba752fba9353c715f882d1520b3a46ac493aa148) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Taking the live shared values into a pending change now applies to the document the caller was checked against: a Single replaced since is refused as not found, and its pending change is left alone. The same holds for discarding a Single's pending change. Both now read the Single's row and take its lock in one step, so a row replaced while the request waits for that lock is seen as it is rather than as it was read, and neither writes into the document that has gone. A field rule judging whether a value may be taken now sees the whole pending change as taking would leave it, so a rule that reads another field, such as a price writable only while a lock is open, answers for the real document rather than for the taken fields alone. The judgement is repeated whenever a field is left behind, since the document the remaining fields were judged beside changes with it: where the only field that allowed another is itself one the caller may not write, neither is taken, rather than saving the combination the rule refuses.

- [#2587](https://github.com/nextlyhq/nextly/pull/2587) [`4f953ea`](https://github.com/nextlyhq/nextly/commit/4f953ea5dc3b7a5de450b0222ae32485d7612de7) Thanks [@aqib-rx](https://github.com/aqib-rx)! - In the admin, "Take the live values" on a publish refused over out-of-date shared fields now stores the editor's form as it is when the action is taken, with the editor's own Save and never publishing, so edits made after the refusal are no longer lost when the editor reloads, and a document view's pending work is committed first. The editor then shows the live values of the fields taken, keeping its other edits, so publishing again no longer sends the old value and puts it back live. If the take's request fails, the editor still reloads before it can be edited again, so it never keeps values the take may have replaced. The refusal toast is one per document and language, and closes when the editor leaves them. Moving to another language while the take is still running no longer writes the first language's live values into the second one's form: the take stands for the language it named, and the editor reloads to show it. In a quick edit, the action says to open the document instead.

- [#3162](https://github.com/nextlyhq/nextly/pull/3162) [`244b113`](https://github.com/nextlyhq/nextly/commit/244b113c437140679189e22e93168e091ed8fa65) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The admin keeps its own look in a site whose stylesheet styles bare elements.

  The admin renders inside your app's document, so your global CSS is in the cascade with it. A rule such as `h2 { font-size: clamp(1.5rem, 4vw, 2.25rem) }` in a `globals.css` is unlayered, and an unlayered rule beats every rule in a cascade layer whatever their specificity, so it beat the admin's own stylesheet: on an app made from the blog template, every dashboard card title drew at 36px on its 20px line, clipped. The admin's stylesheet now ends with one unlayered rule, `all: revert-layer` on everything inside `.nextly-admin`, weighted to beat any selector made only of element names (`h2`, `body main p`, `button::before`) and nothing that names a class, an attribute, a pseudo-class or an id. Your element rules no longer reach the admin, while your class-based styling of a component you add to it still does. The Page Builder's canvas is the exception, on purpose: it draws your page inside the admin, so your element rules still reach it and it looks like the finished page. In an app without such rules nothing the admin draws changes.

  `@nextlyhq/admin-css` adds the rule in `isolateAdminStylesheet` and exports `hasHostElementShield(css)`, which the admin's build uses to check the stylesheet it ships still carries it after minification.

  The base and blog templates write their focus ring as `html body :where(:focus-visible)`, which weighs two element names. Their pages draw it as before, it still beats a reset such as `button { outline: none }` added later, and it no longer redraws the admin's focused controls with the site's ring and corner.

  **An existing app made from the base or blog template:** in `src/app/globals.css`, change the focus-ring selector `*:focus-visible` to `html body :where(:focus-visible)`, keeping its declarations. The old selector weighs a pseudo-class, which outweighs the admin's rule, so until it changes every focused control in the admin is drawn with your site's ring instead of the admin's own. Your site's pages draw the same either way. Another rule of yours that puts a pseudo-class on a bare element, such as `a:hover`, reaches the admin the same way; writing it as `a:where(:hover)` keeps it off, provided nothing else on your site relies on its weight.

- [#3080](https://github.com/nextlyhq/nextly/pull/3080) [`830dfa4`](https://github.com/nextlyhq/nextly/commit/830dfa443f7b22a881714ba25fc8c1068641d4fe) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin now marks a collection or Single removed from code. While its registry row says your code defines it and `nextly.config.ts` no longer declares it, it stays in the Content navigation, the Singles list and its own screens with a "Removed" mark, and its list and edit screens show a notice naming it, saying it is no longer in the configuration, and giving the next step for where its retirement stands: `nextly migrate:create` and then `nextly migrate` while its tables exist and no migration drops it; `nextly migrate`, naming the file, while a written migration that drops it is not yet applied; and, where an applied migration dropped its main table but its registry row remains, that an earlier release left it part-retired and that `nextly prune` lists what remains. Its entries can still be read, and the admin offers nothing that would change them: no New, Save, Publish, Unpublish, Delete, Duplicate, bulk action, restore or version naming. Publishing every language at once is held as well, and a write the server refuses because the entity was removed from code, such as one sent from a screen opened before the removal, now shows the server's own sentence on every path, publishing every language and discarding a pending change included, and turns that screen read-only without a reload. The collection and Single listings and schema reads (`GET /api/collections`, `/api/collections/{slug}`, `/api/singles`, `/api/singles/{slug}/schema`) add `removedFromCode: true` and `removedFromCodeState` to such an entity; every other entity's response is unchanged. Schema Builder and plugin collections and Singles are never marked.

  **Compatibility:** a site that still edits a collection or Single removed from code is refused from this release, in the admin as in every other entry point. There are two ways out: declare it again in `nextly.config.ts` to keep it, or retire it by running `nextly migrate:create` and then `nextly migrate`.

  **Databases already half-retired:** an earlier release could apply a migration that dropped a removed collection's or Single's table and leave its registry row behind, which `nextly migrate` does not yet clean up. The admin now reports such an entity as part-retired. Until that clean-up is automated, check for one with `nextly migrate:status`, which names a registry row whose table does not exist, and, after taking a backup, remove what remains by hand: its row in `dynamic_collections` or `dynamic_singles`, and the rows that name it in the field-group, translation-archive, version and autosave tables.

- [#3147](https://github.com/nextlyhq/nextly/pull/3147) [`4a727b9`](https://github.com/nextlyhq/nextly/commit/4a727b919adbab13b249423874b2586d3d9d3f87) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin-css` now exports `isolateAdminStylesheet(css, { prefix })` and `ADMIN_NAME_PREFIX`. The function is the admin stylesheet's whole isolation sequence, in order: every selector scoped under `.nextly-admin`, keyframe names and registered `@property` names prefixed, and then a check that throws if any rule escaped the scope. The admin's own build now calls it, and so can a tool that compiles the admin's source stylesheet itself. The admin's published stylesheet is unchanged, byte for byte.

- [#2952](https://github.com/nextlyhq/nextly/pull/2952) [`b11985d`](https://github.com/nextlyhq/nextly/commit/b11985db74c6878b2bfb6139b78d827b91cfb48d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The blog template's demo content seeds every post with a featured image, and its author avatars load. Two posts named images the template doesn't ship, so they seeded with none. The avatars pointed at a folder that doesn't exist, so each one was a broken link. Two posts that share an image now each keep their own alt text.

- [#2983](https://github.com/nextlyhq/nextly/pull/2983) [`6cc24ae`](https://github.com/nextlyhq/nextly/commit/6cc24ae5381f218723485c1ee09bb069718182d6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The blog template builds and serves with Next.js Cache Components and Partial Prefetching on, against an empty database and against seeded content. It still works as before with them off, which is how a new project is created.
  - The route segment exports Cache Components refuses are gone: `runtime = "nodejs"` from the five Open Graph routes (Node.js is the default), `dynamicParams = true` from the post page (the default), and `dynamic = "force-static"` from the search page (it is static without it).
  - The post and author pages, like the category and tag pages before them, prerender one placeholder path when the database has none. Cache Components refuses an empty `generateStaticParams`, and the placeholder answers not found.
  - A post's slug can no longer be `__none__`, the placeholder's: the post page keeps the not-found page the build stored for it. Every other slug is accepted as before.
  - The footer's year is read inside a cached read, and the RSS feeds no longer carry a `lastBuildDate`, an optional element the posts cannot supply honestly, so no render reads the clock outside a cache. Each item keeps its own `pubDate`.
  - An unknown category or tag is now decided before the page reads `?page=`. Under Cache Components, the first request for a slug that does not exist gets the not-found page with `noindex`, and every later request gets a 404.
  - The error pages' "Try again" button calls `retry()`, which fetches the page again, rather than `reset()`, which only re-rendered what had already failed.

- [#2934](https://github.com/nextlyhq/nextly/pull/2934) [`d0a69b2`](https://github.com/nextlyhq/nextly/commit/d0a69b2a6332c14447a87d9134ddcb4b3b72330a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly`'s start check judges the Next.js, React and React DOM of the app a command was pointed at. A plugin's `onInstall` or `onUninstall` run with `nextly --cwd apps/site plugins …` used to read the directory the CLI was started in. From a monorepo root that installs none of them, an unsupported app went unjudged. `registerServices()` takes an optional `appRoot` (default: the process's directory), and `loadConfig()` returns the `projectRoot` it resolved.

- [#2921](https://github.com/nextlyhq/nextly/pull/2921) [`8356d38`](https://github.com/nextlyhq/nextly/commit/8356d388d49997f045a96772796a620fd3d090ad) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - nextly's CLI and every caller that reads a config no longer load all of core's dashboard widgets to check a site's dashboard declaration: core's widget ids are read from a module that imports nothing.

- [#3071](https://github.com/nextlyhq/nextly/pull/3071) [`2c5e7b1`](https://github.com/nextlyhq/nextly/commit/2c5e7b1abc21b91ad10213082a3f8794361fa132) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Content card is one compact table, `core/content-table`: a row per collection and Single the reader may see, with Entries, Drafts, when it was last updated, and a create button on each row. It takes `core/content`'s place in core's default dashboard.
  - **Columns:** Name links to the collection's list or the Single; Entries and Drafts are counted as the reader; Updated is the row's last change, with who made it and what they did on hover; and **+** opens a new entry, drawn only where the reader may create. A Single's row says "Single" in place of the counts and offers Edit where the reader may update it, or View where they may only read it. Both decisions are judged in the default language, as the pages they open write; both open the Single, read-only for a reader who may not update. The card's subtitle says how many collections and Singles the reader may see ("8 collections · 5 Singles").
  - **Updated** and its name come from one change. Where the activity trail holds the row's latest change, a publish or an unpublish on its own included, the card shows that change's instant and who made it ("Published by Ben"). Where the trail holds none, or only one a second or more older than the row's own last update (the row was written since by something the trail did not record), it shows the row's own last update (a collection's newest entry the reader may read, or a Single's document) and names nobody.
  - **By size:** a medium or large card, the default half-width card among them, draws the table. A narrow medium card, under 450 px wide as on a phone, keeps the table and every column but draws Updated short ("5m") and each row's action smaller: **+** as a smaller icon button named for the entry it creates ("Create Post"), Edit or View in smaller type. Names keep their room, and creating stays on the row. A small card, under 340 px, draws each row's name on its own line with the counts and Updated under it. Every row is the dashboard's list row height, so the rows a card's size holds fill it.
  - **Drafts** are counted by the collection list's own Draft filter and link to that filtered list, so the number and the list agree. A collection without Draft/Published shows "—". The `/stats` draft figure counts by the same rule.
  - **Order:** by the instant each row's Updated shows, the most recently updated first, so a save the trail records without moving the live entry's own date (a published entry's working draft) ranks the row as it dates it; with collections that hold no entries last and drawn muted. The card draws as many rows as its size holds and cuts the rest, with no footer: the subtitle says how many there are, the admin has no page listing every collection to link to (`/admin/collections` redirects to one collection's entries), and each row opens its own list or Single.
  - **Bounded:** the card is asked for the rows it draws, and only those are counted, rather than every collection on the site. To rank them, a load reads the latest update of at most 50 collections and Singles, four at a time, and builds the rows it draws four at a time: every one the activity trail's latest 50 saves name, then the rest by name. On a site with more than 50, the rest are not ranked and do not appear on the card.
  - **Removed: the `core/content` widget.** The old Content tile card is gone, with no alias or conversion. A layout write naming `core/content` is refused, and a site `defaultLayout` or `hide` naming it no longer finds a widget. A reader whose saved layout already holds it keeps that card's place stored but no longer sees it, and adds Content again from the add panel. Use `core/content-table` instead.
  - **Removed public export: `CollectionQuickLinks` from `@nextlyhq/admin`.** It was the tile card's body and has no replacement export. `ContentSingleTile`, its Single tile, is deleted too.
  - **`system:content` rows** no longer carry `published`; they carry `canCreate` and `singularLabel` (a collection's), `canUpdate` (a Single's, decided as a real update is), `updatedAt`, who made that change and `event`, what they did. The answer carries `total`, the number of collections and Singles the reader could be shown, and `totalByKind`, how that divides (`{ collection, single }`).
  - **New, experimental: `totalByKind` on a list widget result** (`nextly/widget-result`), how `total` divides among the kinds of row a source answers. Optional; a source whose rows are of one kind leaves it out. Where present it must be a plain object of whole counts of at least zero: a declared widget's list or table answer carrying any other is refused, as one with a malformed `total` is, and the admin drops it from an answer.
  - **Continue where you left off:** the empty Team tab names the trail's span again ("No edits by others in the last 90 days"). The admin's widget answers had been dropping the list's `window`.

- [#3057](https://github.com/nextlyhq/nextly/pull/3057) [`536eeb8`](https://github.com/nextlyhq/nextly/commit/536eeb814e46d4877366891b7e30a8a7d6c1e304) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's header is part of the page: a greeting by the reader's own hour, the project's
  name as the page's one heading, with the environment `admin.environment` names as a badge beside
  it, and a live line of what needs the reader ("2 things need you · 1 release tomorrow · 3 new
  submissions"), each part counted as the reader by its card's own source and linking to that card.
  "Updated N min ago · Refresh" shows once, in the header, only while the dashboard's data is more
  than five minutes old. Customize moves into the header. `GET /api/dashboard/summary` answers the
  line, and a widget's `summary` is now accepted at startup and counted for each card a reader is
  shown.

- [#3121](https://github.com/nextlyhq/nextly/pull/3121) [`1dddd98`](https://github.com/nextlyhq/nextly/commit/1dddd985cb18033b841645a7eadcce1b5a3b3614) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard loads about 70 KB less on every visit, and every admin page's first load is lighter. A dashboard card's settings panel, which draws its form with the entry editor's fields, now loads when a reader is about to open it, as the pointer comes over or focus reaches the card's menu, its quick popover's More settings or its empty state's button, rather than with the dashboard itself. The upload tray in the media library and the upload drop area loads as it appears, and the code the admin loads before any page draws no longer carries the dashboard's drag-and-drop or every release query. Nothing looks or works differently.

- [#3091](https://github.com/nextlyhq/nextly/pull/3091) [`9ae07bd`](https://github.com/nextlyhq/nextly/commit/9ae07bd07290927dfa25e49bb86250c6cfeea5ca) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard header's summary line stays honest when a read fails: it no
  longer shows cached counts or "You're all caught up" after a failed refresh,
  reads again on a schema update, and reports a widget whose card could not be
  judged, or a layout that could not be read, as unknown rather than as nothing
  to do. Its links focus the exact card the summary names, and Ctrl/Cmd-click
  opens the list in a new tab as a link should.

- [#2996](https://github.com/nextlyhq/nextly/pull/2996) [`8f9f87f`](https://github.com/nextlyhq/nextly/commit/8f9f87fa7e2791f226ec989ff930212f8b7acfab) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In `next dev`, the admin's component map now lists a site widget that a plugin's `setup()` adds
  to `admin.dashboard`, as the server registers it, so its card draws rather than showing its
  missing-component error until `nextly generate:types` is run.

- [#3065](https://github.com/nextlyhq/nextly/pull/3065) [`365bf29`](https://github.com/nextlyhq/nextly/commit/365bf2970cb8b94deba86d928cf7a838f7e12118) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The editor's document panel now reads Status, Publishing, Language and Details. Status says where the document stands in the language being edited, as the bar's status does; Publishing names the release the document is scheduled in and when, or says it is not scheduled. The panel and the preview pane share the right side: opening the preview folds the panel, and showing the panel closes the preview. Below 1000px of editor width the panel opens over the fields when asked for, with its own close button, and below 600px it opens as a sheet from the bottom of the screen, with History, the preview and the panel toggle in the document's More menu. The panel toggle is now named "Show document panel" or "Hide document panel".

- [#2924](https://github.com/nextlyhq/nextly/pull/2924) [`fb9e721`](https://github.com/nextlyhq/nextly/commit/fb9e7216e45fd7c8ee2860de730ba2baef90dc13) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The entry and Single editors now show where you are in the admin's top bar, keep their status, save state and actions in one bar that stays at the top as you scroll, list their notices under that bar in one order, and start with a large title, with an entry's URL slug on the line beneath it.

- [#3135](https://github.com/nextlyhq/nextly/pull/3135) [`8d9eadf`](https://github.com/nextlyhq/nextly/commit/8d9eadf1bde48974fb40ed836bccf99d70684039) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - nextly now connects its cache tag expiry ledger when it starts. With `nextly/cache-handler` and `nextly/cache-handlers` installed, a write made outside a request (a job, the CLI, a script) reaches every instance's cached reads within seconds, instead of waiting for the next request on the instance that made it. While the ledger can't be used, for example before `nextly migrate` has added its table, nextly warns once and keeps the expiry for that process's next request, as before.

  The scheduled webhook drain now leaves the ledger prune a share of its time budget when one-purpose secrets or preview links have a backlog, instead of letting those sweeps spend all of it. A `use cache` result with `expire: 0` isn't stored outside development, matching Next.js's own handler, and the incremental handler keeps a bounded record of recent reads during bursts.

- [#2937](https://github.com/nextlyhq/nextly/pull/2937) [`5f91eec`](https://github.com/nextlyhq/nextly/commit/5f91eec0b24b1ee036f2fd264b83c7a850bc2b61) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly generate:types --check` now also fails a component map that checks widget props against
  a different config file from the one it loaded, or against none, and names both. A map whose
  declarations hold no widget needs no config import, so a freshly scaffolded project passes as
  shipped. It accepts components exported under non-ASCII names. `extendWidget` refuses a patch
  that carries `owner` or `serverData`, even with no value.

- [#3177](https://github.com/nextlyhq/nextly/pull/3177) [`cf31078`](https://github.com/nextlyhq/nextly/commit/cf31078f7695f39edfd9b9df1b39d7b030ffe81b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's New menu now groups its types the way the sidebar does, for
  every type a person may create rather than only the sidebar's first page of
  them. A plugin type with no group of its own shares the one Other section with
  a type grouped as Other, as it does in the sidebar.

- [#3189](https://github.com/nextlyhq/nextly/pull/3189) [`918de83`](https://github.com/nextlyhq/nextly/commit/918de830960b75de59004131b94206afddcb26f0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's New menu marks focus in its search on the whole search row, the
  magnifier included: a rounded frame inside the row in the text colour, clear of
  the menu's edges. The search field no longer draws a box of its own that ran
  into the menu's top and right edges.

- [#3138](https://github.com/nextlyhq/nextly/pull/3138) [`34753d2`](https://github.com/nextlyhq/nextly/commit/34753d27b8d3bc4b6fd46e3ee39b082674f3f712) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The older widget shape is removed, with no alias, warning or migration. A widget is declared with `defineWidget` under a plugin's `contributes.dashboard.widgets` or the site's `admin.dashboard.widgets`, names its view with `WidgetView` (one of core's five views, or `{ component }`), and its component is handed `WidgetProps`. Startup still refuses a plugin carrying `contributes.admin.widgets` or `contributes.widgetSources`.

  Removed exports:
  - `nextly`: `WidgetDefinition`, `WIDGET_ARCHETYPES`, `WidgetArchetype`, `DataWidgetArchetype`, `QuerylessWidgetArchetype`, `CellWidgetArchetype`, `WidgetStatCell`, `WidgetAction`, `WidgetPatch`, `getWidget`, `listWidgets`, `CoreDisplay`, `ComponentDisplay`, `WidgetDisplay`, and the `PluginAdminWidget` family: `PluginAdminWidget`, `PluginAdminCustomWidget`, `PluginAdminDataWidget`, `PluginAdminStatsWidget`, `PluginAdminDeclarativeWidget`, `PluginAdminQuerylessWidget`, `DeclarativeWidgetArchetype`.
  - `nextly/config`: the `PluginAdminWidget` family and `DeclarativeWidgetArchetype`, `WidgetArchetype`, `DataWidgetArchetype`, `QuerylessWidgetArchetype` and `CellWidgetArchetype`.
  - `@nextlyhq/plugin-sdk`: `WidgetDefinition`, `WIDGET_ARCHETYPES`, `WidgetArchetype`, `DataWidgetArchetype`, `QuerylessWidgetArchetype`, `WidgetAction`, and the `PluginAdminWidget` family and `DeclarativeWidgetArchetype`.
  - `@nextlyhq/plugin-sdk/widgets`: `WidgetComponentProps`, `WidgetSlot` and `WidgetQueryBatchResponse`.

  A plugin's admin metadata no longer carries `widgets`, and the add panel lists a plugin's declared widget under that plugin.

- [#3188](https://github.com/nextlyhq/nextly/pull/3188) [`8452c7a`](https://github.com/nextlyhq/nextly/commit/8452c7ace06f955caa0bcb9e5c1932eb9c674063) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's side rail keeps a visible keyboard focus indicator under forced colors, such as Windows High Contrast, where its focus ring is not drawn.

- [#3183](https://github.com/nextlyhq/nextly/pull/3183) [`cb47059`](https://github.com/nextlyhq/nextly/commit/cb47059007f898e13b293cc26313d41c9e0df959) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's side rail now draws a focus ring on its logo and every entry when reached by keyboard, in light and dark.

  Schedule publish no longer sends a second schedule for a document whose first request is still out after you move to another document and back; the action waits, and says why, until that request finishes.

- [#3025](https://github.com/nextlyhq/nextly/pull/3025) [`ea46340`](https://github.com/nextlyhq/nextly/commit/ea463403790f2ad929f3d2e664d43b8e5006b561) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The roles screen shows the built-in roles as they are. Super-admin says it has every permission, including new collections and plugins, and offers nothing to change. The Public role, which sets what visitors who aren't signed in may do, offers No access and Can view on each row. A write stays reachable through a row's switches, with a warning beside it, and saving it changes only its permissions. A preset is shown read-only, with "Copy to change" opening a new role that starts with the preset's permissions and description. Roles from the API carry `builtIn: "public" | "super-admin"` to tell these two apart.

- [#2882](https://github.com/nextlyhq/nextly/pull/2882) [`e58aa76`](https://github.com/nextlyhq/nextly/commit/e58aa76094d717aacd9f512457f314a6ac874038) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Schema changes now take one lock per database, the schema lock, renewed while it is held. `nextly migrate` and the boot migrate step, `migrate:down`, `migrate:baseline`, `migrate:resolve`, `upgrade`, plugin install and uninstall, `migrate:field-groups --apply`, `db:sync`, the development push and the Single and field-group Schema Builder saves all hold it for the whole of their work, so none of them runs beside another, and SQLite gains a real lock: a development server and a command-line run on one SQLite file now exclude each other. A run of any length keeps the lock; one that dies lets it lapse within one lease (`db.migrateLockTtlSeconds`, now 120 seconds by default), with nobody clearing it by hand. A command-line run that finds the lock held waits about a minute and then stops without changing anything, naming the command that holds it, when it started and when the lock lapses if that holder has gone; a Schema Builder save is refused at once and asks you to save again once the migration ends; a production start with `runMigrationsOnBoot` refuses to start rather than serve. A command releases the lock however it ends, on an interrupt too.

  While an upgrade is rolled out, the earlier `nextly_migrate_lock` (and MySQL's named migrate lock) and `nextly_field_group_lock` are honoured and held beside the new lock, so a process of an earlier version is still excluded. A path that took no lock in an earlier version cannot see the new one — on SQLite, an earlier `nextly migrate`; on every dialect, a Collection Builder save, `migrate:fresh`, `prune` and the development start's registry sync — so stop processes of earlier versions before the first run of this one.

- [#3073](https://github.com/nextlyhq/nextly/pull/3073) [`9606b7d`](https://github.com/nextlyhq/nextly/commit/9606b7d4aafd4adf99307d93e6001535b3503780) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The SEO plugin's dashboard card is now declared with `defineWidget` under `contributes.dashboard`, as any plugin's widget is. The card, `seo/issues`, draws one bar per kind of issue in the collections the plugin extends, from a `load` that reads through the services bound to the person asking, so the numbers are what that person may see. It is offered to a person who may read every one of those collections. The issue count is also on the Needs attention card, as one line per collection (`seo/issues-<collection>`, "SEO issues in <collection>"): each shows only to a reader of its collection, counts that collection's issues and links to its list, so every line a reader is shown opens. Needs attention lists up to 10 SEO collections, the most lines core takes from one plugin: the first ten configured get a line each, and the card covers all of them.

  A widget's data reads gain one option: `services.find` takes `depth: 0` to return links as their stored ids, unexpanded, where a read naming no depth still expands them as before. `0` is the only depth a read may name. The SEO scan reads at `depth: 0`, so a page's social image is judged by the id it stores: a reader who may not read media is no longer told every page with an image is missing one, and an image whose file is gone counts as present, as it did before.

  A bars card's names now take a column as wide as the longest of them, up to two fifths of the chart, in place of a fixed 80 px one that cut names sharing their first words to the same "Missing me…"; a name still too long ends in "…" and keeps its whole name as its label and its title.

  Removed from `@nextlyhq/plugin-seo`, with nothing in their place: the `plugin:seo/issues` data source and `seoIssuesWidgetSource`, `issueFilter`, `SEO_ISSUES_SOURCE_ID`, `ISSUE_FIELD` and `ISSUE_SCAN_PAGE_SIZE`, and `seoIssuesWidget`, the stats card. The card and the Needs attention line reach the dashboard through `seoPlugin`; `SEO_ISSUES_WIDGET_ID` names the card in a site's `admin.dashboard`.

- [#2960](https://github.com/nextlyhq/nextly/pull/2960) [`863d0d6`](https://github.com/nextlyhq/nextly/commit/863d0d6862d12a1c5fd928cfca3257bfb3c619e0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A site's `admin.dashboard` `hide`, `replace` and `overrides` now take effect. A hidden widget,
  a built-in an alternative replaces, and an alternative no `replace` names are offered to nobody
  and drawn on no dashboard; their saved cards are kept and come back if the config changes. The
  default places an alternative where the built-in it replaces was. An override's title,
  description, narrowed sizes and starting settings apply wherever the widget is offered, drawn or
  answered. Only `widgets` is still checked but not applied, and startup says so.

  A default card's `id` must hold text, as the layout endpoint requires; a reader's stored choice
  carries only to a card of the same widget; the dashboard's token tells apart any two sets of
  withheld cards; and a reset staged by a reader with an arranged dashboard is refused when a card
  of the default it would return to has since changed whether it shows.

- [#2980](https://github.com/nextlyhq/nextly/pull/2980) [`ac9dfb7`](https://github.com/nextlyhq/nextly/commit/ac9dfb759b02de6bb28667fa20fa2dff48ef511c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The site's dashboard rules now hold across reloads and replacements. A reload checks its config
  against the widgets as declared, not as the previous boot's overrides narrowed them. A built-in
  that `replace` puts an alternative in place of keeps each card's own id, place and size (held
  within the alternative's bounds), dropping only the built-in's settings, so two replaced cards stay
  two. An override of a Collection setting's starting value reaches the summary the dashboard
  withholds cards and builds its token from, so every reading names one collection.

- [#2867](https://github.com/nextlyhq/nextly/pull/2867) [`d994f7e`](https://github.com/nextlyhq/nextly/commit/d994f7e7d782f06d302ca8810e8cacb4e8824a6f) Thanks [@aqib-rx](https://github.com/aqib-rx)! - On SQLite, a translated field marked unique is now held unique within each language by a partial index over its value and language, which leaves blank values out. A schema change made in the Schema Builder on a site holding such a field no longer fails while reading the database. The rule it enforces is unchanged.

- [#2578](https://github.com/nextlyhq/nextly/pull/2578) [`817ed45`](https://github.com/nextlyhq/nextly/commit/817ed45299c2ec8fe38e094dfbca1ab655c08527) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A translated field marked unique is now unique within each language. The same value is refused twice in one language, as a duplicate of a shared unique field is (409 `DUPLICATE`), and allowed once in each language. A text value left blank is never a duplicate, and nothing stored changes: the rule is an index on each translations table, keyed on the value with blanks left out, so every read returns what it did before. A translated number, boolean or date has no blank: zero and false are values like any other. Values count as the same exactly as for a shared unique field of that column: on MySQL, under its default case- and accent-insensitive collation, "About" and "about" are one value.

  Every way of declaring the field enforces it. The Schema Builder adds the index when it creates a collection, Single or field group, and adds or drops it when a field becomes or stops being unique. `db:sync`, and the reload under `next dev`, do the same for fields defined in code. `nextly migrate:create` writes a migration that adds or drops it, so production gets it with `nextly migrate`. Until the index is there, each start names the field and what adds it: the commands to run for a field defined in code, or saving the entity in the Schema Builder for one made there.

  Adding the rule is refused before anything changes where it cannot hold:
  - where a language already holds a value twice, naming the documents in each language but never the value (`TRANSLATED_UNIQUE_OVER_DUPLICATES`). The Schema Builder refuses the save. `db:sync` reports it and leaves that field without its index. `nextly migrate` stops at that migration file before running any of it, so nothing is half-applied, even on MySQL;
  - on a database server that cannot build the index (`UNIQUE_NOT_ENFORCEABLE_ON_DIALECT`): MariaDB, and MySQL before 8.0.13.

  Give the listed documents different values, or leave one blank, and run it again.

  Before this, a translated unique field was not enforced at all. A field already marked unique and translated gets its index the next time its entity is saved in the Schema Builder, or from the next `db:sync`, or from the next `migrate:create` and `nextly migrate`. Each of these is refused, as above, if a language already holds a value twice.

  The migration files that add or drop these indexes are a new kind, so their header is version 4. An older version of nextly refuses to run them and says to upgrade, rather than running them wrongly.

- [#3056](https://github.com/nextlyhq/nextly/pull/3056) [`4b59d78`](https://github.com/nextlyhq/nextly/commit/4b59d78442641cf2a3364309aa0d51d71c0ecca7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A translation table dropped while the app is running, by hand or by a tool outside the app, no longer fails the next localized write with a server error. The write is refused with the same "translations are not ready" conflict, naming the command to run, that a table missing at the start gets, and the next write checks the table again.

- [#3193](https://github.com/nextlyhq/nextly/pull/3193) [`bfaf41b`](https://github.com/nextlyhq/nextly/commit/bfaf41ba3ac282420848ceb2ab11ec704dcbca98) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Apps starting together on a new database, or beside `nextly migrate`, all come up: the core schema is set up by one of them while the others wait, and a configured PostgreSQL schema is created once, whatever the database's default isolation level, instead of failing the connections that lose the race to create it.

- [#3186](https://github.com/nextlyhq/nextly/pull/3186) [`3c9e4ee`](https://github.com/nextlyhq/nextly/commit/3c9e4eeaca64f168b54273c834d706d95129e516) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Two `nextly migrate` runs started together on PostgreSQL no longer fail creating the schema lock.

- [#3174](https://github.com/nextlyhq/nextly/pull/3174) [`647aa67`](https://github.com/nextlyhq/nextly/commit/647aa67972c1b398cc5ddd477892d5415414428b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Undo puts a removed card back even when the widgets you can add changed in the meantime, such as when a colleague schedules the site's first release.

- [#2999](https://github.com/nextlyhq/nextly/pull/2999) [`bb80d0c`](https://github.com/nextlyhq/nextly/commit/bb80d0c7047545b32b055e0cbf3d2c13178a9e70) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A read or write of a collection or Single that the database has not been migrated for now says so, instead of answering every request with a 500 "An unexpected error occurred." This covers three cases: a declared field's column is missing, the entity's table is missing, or the running server never registered the entity (for example, a migration added it after the server started). The answer is a 409 with the code `ENTITY_NOT_MIGRATED`. Its message names the collection or Single and `nextly migrate`, and it never carries SQL or the database's own wording. `error.data` carries `reason` (`column`, `table` or `unregistered`), `kind` and `slug`. The field and the table are physical names from the registry, so they are named, in the message and as `field` and `table` in `error.data`, only to trusted server code (`overrideAccess` without `enforceFieldAccess`, as the Direct API calls by default). REST and other callers held to access rules are told the entity only. The server log always has both. This holds on PostgreSQL, MySQL and SQLite, through the REST API and the Direct API.

  The database adapters now refuse a call on a table their schema registry does not hold with the code `NEXTLY_TABLE_NOT_REGISTERED` (exported as `TABLE_NOT_REGISTERED_CODE`, with `tableNotRegisteredError`, from `@nextlyhq/adapter-drizzle/types`). The message still says "not found in schema registry", now names what is missing instead of `setTableResolver()`, and carries the code.

  **Compatibility:** a client that recognised these failures as a 500 `INTERNAL_ERROR` now receives a 409 `ENTITY_NOT_MIGRATED`.

- [#2826](https://github.com/nextlyhq/nextly/pull/2826) [`c0b45eb`](https://github.com/nextlyhq/nextly/commit/c0b45eb13749e6486e59f562cec6f2e4cee231b6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Removes an internal helper nothing in Nextly called any more. No behaviour changes, and nothing exported from a published entry point is affected.

- [#2889](https://github.com/nextlyhq/nextly/pull/2889) [`6f728f3`](https://github.com/nextlyhq/nextly/commit/6f728f3eed46615eb5bea3318482abb70de72238) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A visitor, a checked call with no signed-in user, is judged by the Public role: it reads, creates, updates or deletes where the Public role holds the permission and the target's rule, if it declares one, answers `true`, and a rule reading the caller's permissions sees the Public role's. Without the permission a visitor is refused as needing sign-in, and a rule that refuses it as not allowed; the status a caller sees is unchanged. A visitor reads published content only, whatever it asks for, and media through the Public role's `read-media`. `createTestNextly` takes `seedPublic: true` to run the boot's seeding, for tests that need the Public role.

- [#2912](https://github.com/nextlyhq/nextly/pull/2912) [`9fc2d47`](https://github.com/nextlyhq/nextly/commit/9fc2d472d92a1b863b3612229d2e282fa88adc20) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A visitor, a request with no session and no key, now reads media through the admin's media routes when the Public role holds `read-media`, as a checked Direct API media read that names nobody now does too. Boot seeding gives the Public role `read-media`. Taken off the Public role, those reads are refused with 401, asking the visitor to sign in, as before. A request whose session or key is not valid is still asked to sign in again, and media writes still need a signed-in caller.

- [#3061](https://github.com/nextlyhq/nextly/pull/3061) [`eb9ae7b`](https://github.com/nextlyhq/nextly/commit/eb9ae7b67af9b53d5ac6fe147d960763e726068b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Page Builder pages are served to visitors again. Since visitors are judged by the Public role, a collection with no read rule is not served to someone who is not signed in: boot grants the Public role a collection's read only where the collection's read rule answers `true`, so a site serving its pages through `createBlocksPage` answered every visitor 404. The plugin's `pages` collection now declares that anyone may read it. A visitor still sees published pages only: a draft page, and the unpublished edit of a published one, stay unseen, whatever the request asks for. Your own collections that visitors read need the same: a read rule that answers `true`, or the read granted to the Public role in the admin's Roles screen.

- [#2899](https://github.com/nextlyhq/nextly/pull/2899) [`2d2a32a`](https://github.com/nextlyhq/nextly/commit/2d2a32a7cfef176c8d28899d55b79801084814f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Visitors can use the REST API for what the Public role grants. A request carrying no credential to a collection's entries or a Single is judged by the Public role, as a checked call with no user is: it may list, count and read published content, and create, update or delete an entry, where Public holds the permission and the target's rule, if it declares one, answers `true`. Without the permission it is still asked to sign in (401); a rule that refuses it answers 403. Versions, events, autosaves, bulk writes, duplicating and publishing still need a signed-in caller, as do media routes.

- [#3102](https://github.com/nextlyhq/nextly/pull/3102) [`ace4ac2`](https://github.com/nextlyhq/nextly/commit/ace4ac2053913981b43d2208f90be6ca11a1e6c5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On the first start after upgrading to a version where visitors are judged by the Public role, Nextly logs once which collections and Singles visitors could read before and can't now: those with no `read` rule, or one answering visitors with a filter, whose read the Public role doesn't hold. To let visitors read one with no `read` rule again, declare `access: { read: () => true }` on it, and the Public role is granted its read at the next start, or grant the Public role its read (`read-<slug>`) on the Roles screen. For one whose rule answers a filter, grant the read: the filter still applies. A rule that refuses visitors, with `false`, `null` or a filter that isn't well formed, is never named. A new install isn't told, and the notice isn't repeated.

  The startup log of what the Public role doesn't hold yet no longer names reads with no `read` rule at every start, since a collection kept private that way is ordinary. It still names reads whose rule answers a filter, writes whose rule answers `true`, and rules that failed when asked.

- [#3081](https://github.com/nextlyhq/nextly/pull/3081) [`b75d1c3`](https://github.com/nextlyhq/nextly/commit/b75d1c307db01b107f7b65ae7b0873974cf69905) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Team activity replaces Recent activity on the dashboard. Each row says who created, saved, published, unpublished or deleted which entry or Single, names its collection by its label, and opens the entry; a deletion is not a link. It shows only events about what the reader may read. `core/recent-activity` is removed with no alias, and the `core#RecentActivity` component is now `core#TeamActivity`. A site's `admin.dashboard` overrides, `hide` or `replace` entries naming `core/recent-activity` should name `core/team-activity` instead. A saved layout that holds a Recent activity card keeps it as a row that is no longer drawn, so a reader who wants the card adds Team activity from the gallery. The rows of `GET /dashboard/activity` and of the `system:activity` source carry an `event`: `"created"`, `"saved"`, `"published"`, `"unpublished"` or `"deleted"`, the closed `ActivityEvent` type now exported from `nextly/widget-result`. Upcoming releases lists the Releases list's Upcoming tab, soonest first, read at the same instant as its stopped and overdue counts so a release is never in both or neither, with each release's entries and whether its checks found it Ready or "N issues", keeps its stopped and overdue line, hides while nothing is scheduled, stopped or overdue, and may be widened to the full row.

- [#2860](https://github.com/nextlyhq/nextly/pull/2860) [`d409789`](https://github.com/nextlyhq/nextly/commit/d4097892576867f1026b1123ee16971c572a8b1b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card drawn by its own component no longer remounts every time the dashboard re-renders, and one whose component throws now shows its error once instead of locking the page in a render loop ("Maximum update depth exceeded"). Each card is handed the same answer object for as long as its answer is unchanged.

- [#2956](https://github.com/nextlyhq/nextly/pull/2956) [`d55ddf5`](https://github.com/nextlyhq/nextly/commit/d55ddf5043b8c4e4fa829039ef0ce65bcd4921e1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget declared with `defineWidget` can now read groups and counts over time,
  choose where it is offered, and gate who sees it on several permissions. All of
  it is `@experimental`.
  - **`services.groupBy(collection, { field?, where?, status?, limit? })`** answers
    `{ buckets }`, the data the `bars` view draws, so `load` can return it as it
    comes. With no `field`, it groups by the collection's own field: its status
    when it has drafts, otherwise its first field with choices, as a card's Group
    by setting does.
  - **`services.timeseries(collection, { range, dateField?, where?, status? })`**
    answers `{ points, interval }`, the data the `series` view draws. `range` is
    `"7d"`, `"30d"`, `"90d"` or `"12m"`, the values `setting.dateRange()` offers;
    the range picks the interval (a day, a week or a month), and `interval` says
    which one the points were counted in. Entries are placed by `createdAt` unless
    `dateField` names another date.
  - **`status: "published" | "all"`** on `count`, `find`, `groupBy` and
    `timeseries`. Reads count published entries, as before, unless they ask for
    `"all"`, which includes drafts. Every read still runs as the person viewing
    the card, with their read access.
  - **`offered: "per-collection" | "on-request"`** on `defineWidget`, the same
    values a registered widget's `offered` takes. A widget offered per collection
    needs a Collection setting, and startup refuses any other value.
    `several: false` now holds such a widget to one card: it was dropped before,
    and an offered widget allows several by default.
  - **`access`** also takes `{ anyOf: [...] }` (any one of several permissions)
    and `{ allOf: [...] }` (every entry, each a permission or `{ anyOf }`). These
    forms decide who is offered the widget, as a single permission name does. A
    bare list is refused at startup, with a message pointing to `{ anyOf }`. An
    `access` function may now be async and return any value; only `true` lets
    the person see the card.
  - **New types** `WidgetAccessGate`, `WidgetInterval` and `WidgetRange`,
    exported from `nextly` and `@nextlyhq/plugin-sdk`.
  - **`Widget.FooterLink`** in `@nextlyhq/plugin-sdk/admin`:
    `<Widget.FooterLink href label />` draws a link in the card's own footer,
    where core's cards put "View all". It replaces the widget's own link while
    it is shown, so the footer still holds only one link.

- [#3011](https://github.com/nextlyhq/nextly/pull/3011) [`a368b29`](https://github.com/nextlyhq/nextly/commit/a368b29970df4aa50e0e64bb7efac9443453ecb6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's `load` can read more of what a dashboard card shows, through the same read services, as the person viewing the card. All of it is `@experimental`.
  - **`count(collection, { window })`** counts the entries whose `dateField`
    (`createdAt` when absent) falls in a range's window, the one a `timeseries`
    over that range is drawn across; `previous: true` counts the window as long
    that ends where that one starts. The type is `WidgetCountWindow`.
  - **`find(collection, { total: true })`** also answers `total`, how many
    entries the same read matched, and `atLeast: true` when that is a floor. A
    `limit` of `0` now answers no rows rather than one, agreeing with
    `rowsThatFit`, which is `0` for a card too short to hold a row.
  - **`groupBy`** answers `truncated: true` when groups were left out and
    `atLeast: true` when its counts are floors.
  - **`describe(collection)`** answers `{ title?, status, fields }`
    (`WidgetCollectionDescription`): the field that titles an entry, whether the
    collection has a draft and published `status`, and each field the viewer may
    read with its `name`, its `label` (the collection's own, or the field's
    name made readable as the admin names it, "Created At" for `createdAt`),
    `type`, `choices`, and `groupable: false` / `presentable: false` where they
    apply (`WidgetCollectionField`). It is checked as a read of the collection
    is.
  - **A `dateField`** for `count`'s window or for `timeseries` must be a date
    field of the collection that every reader of it may read; any other is
    refused, the same way for everyone.
  - **`skeleton`** on `defineWidget` (`"figure"`, `"list"`, `"bars"`,
    `"series"` or `"table"`, the type `WidgetSkeleton`) is the shape a card
    loads in and the sketch its add-panel row is drawn with. It is checked at
    startup like every other field.
  - **A window that ends now** (a ranged `timeseries`, `count`'s current
    window, a `since` read with no `until`) now keeps the whole second it is
    read in. MySQL stores a `DATETIME` to the nearest second, so an entry made
    just before a read could be stored a moment after it and left out until the
    clock passed it; it is counted now, with no change to stored values.
  - **A load's `size`** is held to a site's `overrides` size bounds where they
    narrow the widget's own, as the admin draws the card.
  - **The admin** warns once per card, while developing, about a second
    `Widget.FooterLink` in one card, rather than on every change of their count.

- [#3029](https://github.com/nextlyhq/nextly/pull/3029) [`8dea8a4`](https://github.com/nextlyhq/nextly/commit/8dea8a4b5b87d07169ebfb1d00242bc47bf2b018) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's settings get the rest of what they were declared to do.
  - **A setting's own editor** (`@experimental`): any setting builder takes `editor: { component: "<module>#<Export>" }`, drawn in the card's settings sheet in place of the setting's own field. The component is handed `SettingEditorProps` of the setting's value (the value, `onChange`, the card's other settings, and whether the sheet is saving), exported from `nextly` and `@nextlyhq/plugin-sdk`. Editors join the generated admin component map, which holds each one to its setting's value at compile time. A value an editor sets is held to the setting's own rules: the sheet names one that breaks them on Done, and the layout write refuses it (below). An editor is handed `undefined` for a setting with no value. Startup refuses an `editor` that names no component, one component used both as a widget's view and as a setting's editor, and an `editor` on a widget registered with `registerWidget` or contributed through `contributes.admin.widgets`, which says "custom setting editors need a defineWidget declaration" and names the widget and setting.
  - **The layout write holds a card's changed settings to its widget's declaration**: a value of the wrong kind, outside a number's range, not among a select's options, or a Field naming a field the chosen collection does not offer the reader is refused with a validation error naming the setting. A value stored before its widget narrowed its declaration still saves unchanged.
  - **A Field setting is checked before the card loads**: a field the chosen collection no longer has, or one its reader may not read, is replaced as the settings sheet replaces it: by the setting's default where the collection offers that field, otherwise left unset, so the card asks for the field again and its `load` never sees the stale value. The collections are read once per batch of cards, and a stored field is kept while the registry cannot be read. The rules are the settings sheet's own, now functions both use (`contentFieldFits`, `unfitContentField`, `startsAtDefault`, `staleValueTakesDefault` and `settingValueProblem` in `nextly/config`).
  - **Prompts built from a setting's label are written in sentence case** on the server as in the admin: a card missing its Collection answers "No collection chosen yet". `noSettingChosen` and `settingInSentence` are in `nextly/widget-result`.
  - **A day-only date keeps its day in every time zone.** The date input showed a day saved as UTC midnight as the day before to anyone west of UTC, and saved that earlier day on the next edit. Day, month and time-of-day values are now shown in UTC, the zone they are saved in, wherever the input is used: collection fields, user fields and widget settings. Date-and-time values are still shown in the reader's own zone.

- [#2953](https://github.com/nextlyhq/nextly/pull/2953) [`c6ec2bb`](https://github.com/nextlyhq/nextly/commit/c6ec2bbd4bf1424015179a262b58de9d77617591) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's settings are now written with the collections' field builders. `setting.text`, `setting.textarea`, `setting.number`, `setting.checkbox`, `setting.select` and `setting.date` take the config the matching collection field takes, less the `name` the setting's key gives, with a `label` required. Beside them are the dashboard's pickers: `setting.collection`, `setting.fieldOf` (a field of the chosen collection), `setting.dateRange`, `setting.filter`, `setting.sort`, `setting.groupBy` and `setting.fields`. `setting` and the collections' `option` are exported from `@nextlyhq/plugin-sdk` and from `nextly`.

  ```ts
  settings: {
    currency: setting.select({
      label: "Currency",
      options: [option("US dollar", "usd"), option("Euro", "eur")],
      defaultValue: "usd",
      quick: true,
    }),
    collection: setting.collection({ label: "Collection" }),
    sortBy: setting.fieldOf({ of: "collection", label: "Sort by" }),
  }
  ```

  Breaking, for the experimental widget SDK only: the `widgetSettings` export from `nextly` is removed. Write `setting.number({ label, defaultValue, min, max })` for `widgetSettings.items()`, `setting.dateRange({ label })` for `dateRange()`, `setting.checkbox({ label, defaultValue })` for `toggle()` and `onlyMine()`, and `setting.select({ label, options, defaultValue })` for `select()` and `chartStyle()`. `default` is now `defaultValue`, as on a collection field.

  Startup now refuses a declared setting without a label, and a preview case whose settings name a setting the widget does not declare or a value that setting would refuse. The settings sheet opens a stored value its setting no longer accepts at the default the card falls back to, and a settings fault quoting a value no formatter can print is still reported.

- [#2914](https://github.com/nextlyhq/nextly/pull/2914) [`bca01de`](https://github.com/nextlyhq/nextly/commit/bca01dead5d4eefc9f0c74df422caf0067a0ce56) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's own view now draws with the kit core's own cards are built from, published from
  `@nextlyhq/plugin-sdk/admin` (experimental):
  - `Widget.Figure`: one number, written for the card's size tier and heard in full.
  - `Widget.List`: rows of a title, up to three fields and an end, with at most one visible action
    each and no menu, as many as the card's size and the query's `limit` hold, with the shared
    "View all" footer, which takes the place of the widget's own footer link.
  - `Widget.Table`: rows across at most three named columns, drawn as a table on a wide card.
  - `Widget.BarChart` and `Widget.SeriesChart`: the dashboard's charts, with an optional `unit`
    their tooltips write after each number ("12 orders").
  - `formatWidgetNumber`, `formatWidgetChange` and `widgetChartColour`, from the server-safe
    root `@nextlyhq/plugin-sdk`, so server code can call them too. They are `@nextlyhq/ui`'s
    own formatters and chart colour, and `@nextlyhq/plugin-sdk` now depends on `@nextlyhq/ui`
    for them. `@nextlyhq/ui/format` gains `chartColour` and `ChartSlot`.

  Every part draws with the theme's tokens only, in light and dark.

  **Breaking, with no alias:** these names are removed from `@nextlyhq/plugin-sdk/admin` and
  `@nextlyhq/admin`:

  | Removed                                                                                      | Use instead                                                                                                 |
  | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
  | `CardFigure`                                                                                 | `Widget.Figure`                                                                                             |
  | `cardNumber`                                                                                 | `formatWidgetNumber`                                                                                        |
  | `cardChange`                                                                                 | `formatWidgetChange`                                                                                        |
  | `GroupsChart`, `GroupsChartProps`, `GroupsChartGroup`                                        | `Widget.BarChart`, `WidgetBarChartProps`, `WidgetBarChartGroup`                                             |
  | `OverTimeChart`, `OverTimeChartProps`, `OverTimeSeries`, `OverTimePoint`, `OverTimeInterval` | `Widget.SeriesChart`, `WidgetSeriesChartProps`, `WidgetSeries`, `WidgetSeriesPoint`, `WidgetSeriesInterval` |

  Each replacement takes the same props as the name it replaces.

- [#3026](https://github.com/nextlyhq/nextly/pull/3026) [`cb68da3`](https://github.com/nextlyhq/nextly/commit/cb68da39aa8c7c8b663887f866cc00155ee23388) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget can now be tested without a browser. `runWidgetLoad` from `@nextlyhq/plugin-sdk/testing` runs a widget's `load` against a test instance for the person you name, through the dashboard's own route, so that person's access applies exactly as it does on the dashboard, and answers in the card's own states: `ready` or `empty` with the data, `needs-setting`, `unavailable`, `not-shown` or `error`. `renderWidgetCard` from the new `@nextlyhq/plugin-sdk/testing/admin` entry draws the card in the admin's own frame, for a state you name or for what a load answered, at a size and in a light or dark scheme. Both are experimental. They sit in entries no production entry reaches, and the bundle check now refuses any production source that imports one.

- [#3152](https://github.com/nextlyhq/nextly/pull/3152) [`54d0553`](https://github.com/nextlyhq/nextly/commit/54d05536284613467d4b5ceeb51108d1e1bb982b) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The recovery a drift error prints for a database never adopted into the migration history now keeps the separator its migration's path is written with, on every line. On Windows, a path written with forward slashes no longer gets an `rm` line with backslashes under an `mv` line with forward slashes; a path Windows resolved keeps its backslashes, as before.

- [#2870](https://github.com/nextlyhq/nextly/pull/2870) [`275d2a8`](https://github.com/nextlyhq/nextly/commit/275d2a80b885a55766de823a18320912704be8b9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `withNextly()` now adds the database drivers and adapters to the top-level `outputFileTracingIncludes`, which is where Next.js reads it, instead of under `experimental`. Every build and dev start of an app using it no longer warns that the key is unrecognized and has moved, and an app's own top-level `outputFileTracingIncludes` is kept: Next.js used to replace it with Nextly's list, so files the app asked to trace were left out of its deployment. An app's own entries still under `experimental.outputFileTracingIncludes` are moved to the top level with the rest.

- [#3159](https://github.com/nextlyhq/nextly/pull/3159) [`f7bc915`](https://github.com/nextlyhq/nextly/commit/f7bc91599fc3c0f53afeec1fbf65d77fc7660bae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Without nextly's cache handlers, cached public reads in production refresh at least once a minute, so writes from another process show within 60 seconds. Install the handlers to keep longer lifetimes. nextly logs one `cache-handlers-not-shared` warning per process while this bound is in force, with the `next.config` lines that install them.

- [#2918](https://github.com/nextlyhq/nextly/pull/2918) [`e994522`](https://github.com/nextlyhq/nextly/commit/e994522ac581976215e4407fdd4f8fe0066d58fc) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A collection or Single removed from your configuration is now read-only. While its registry row says your code defines it and `nextly.config.ts` no longer declares it, every write to its entries is refused, through the admin, the REST API, the Direct API, a plugin's content and version-history services, and the release engine: creating, editing, deleting, duplicating, publishing and withdrawing, bulk changes, restoring, naming and pinning versions, autosaves, working drafts and "seen" marks. Nothing about the entry changes, and its entries can still be read while its tables exist. The refusal is a 409 with the code `ENTITY_REMOVED_FROM_CODE`, names the collection or Single, and carries its `kind` and `slug` in `error.data`. Schema Builder and plugin collections and Singles are not affected.

  **Compatibility:** a site that still edits a collection or Single removed from code is refused from this release. There are two ways out: declare it again in `nextly.config.ts` to keep it, or retire it by running `nextly migrate:create` and then `nextly migrate`, which drops its tables.

## 0.0.2-alpha.72

### Patch Changes

- [#2542](https://github.com/nextlyhq/nextly/pull/2542) [`012c992`](https://github.com/nextlyhq/nextly/commit/012c9925120136f2aedc58aaa4b630f8ad50b355) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A keyed send now holds up through crashes, slow providers and partial failures.
  A send that reached some recipients and not others reports each recipient's
  outcome (`partlyDelivered`, `recipients`), and a retry with the same key sends
  only to those not yet accepted, whichever provider carries it. Every provider
  call has a 2-minute deadline and a cancellation signal; a call that has not
  answered by then is reported as unknown and retryable, and its claim stays held
  for up to 10 minutes while the call may still answer. A failure whose delivery
  cannot be known carries `unknown: true`. A keyed send's delivery records and
  its outcome are committed together. Sends whose recipients all fare alike
  return the result they always did.

- [#2805](https://github.com/nextlyhq/nextly/pull/2805) [`bb1f8dd`](https://github.com/nextlyhq/nextly/commit/bb1f8dd3ff101c0209fff13ece785bde338043bd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A publish that sends a related many-to-many field with an id repeated, such as `["a", "b", "a"]` over `["a", "b"]`, is no longer recorded as editing that field. The ids are compared as a set: each id counts once, whatever its order.

- [#2717](https://github.com/nextlyhq/nextly/pull/2717) [`5288bfd`](https://github.com/nextlyhq/nextly/commit/5288bfd5d65646c267f3c0b98cb6bb84219e33b2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Single's publish that sends a whole group or field group no longer loses a pending edit to a field inside it that the publisher may not write. The publisher's copy of that field is judged at the pending change's value rather than the live one, so the publish is refused, naming the field, and the pending change is kept. A publish whose pending change leaves that field alone goes through as before.

- [#2777](https://github.com/nextlyhq/nextly/pull/2777) [`8ead799`](https://github.com/nextlyhq/nextly/commit/8ead799267595329cf4bc7f0e68244950a3dead8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An entry you may not read is answered exactly as one that doesn't exist: 404 `NOT_FOUND`, "Not found.", whatever you asked to do with it. An entry you may read but not change is still answered 403, with what you may not do.

  This holds for a request naming one collection entry or a Single's document, through REST, the Direct API, plugin services and the routes built on them, the document lock among them. The Direct API and plugin services answer an update, delete or publish of an entry you may not read with 404, as REST does. Whether you may read is asked as a plain read is, in the site's default language.

  One place does not take that answer at its word: a dashboard card reading a Single. A card for a Single you may not read fails instead of showing "Nothing yet". Singles are the site's own configuration, defined in code, so their names are not secret, and an empty card for a refusal would tell the admin something false. A Single that really has no document still shows as empty.

  A client that reads the status of a refused request on one entry should read the code instead: `NOT_FOUND` for one it may not read, `FORBIDDEN` for one it may read but not change. A caller with no identity keeps its current answer.

- [#2795](https://github.com/nextlyhq/nextly/pull/2795) [`b1888dc`](https://github.com/nextlyhq/nextly/commit/b1888dc9c5e4c67cacadd21340b0940176bfc19b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Breakdown card's Collection setting now offers only collections the card can divide, even when the card is already set to one: each collection is judged from the widget's declaration, not from the card as already asked.

  A widget whose cells all depend on a condition the collection doesn't meet is no longer offered on that collection.

  Registration now refuses a grouped query that leaves its key to a Group by setting the query's source doesn't take.

- [#2771](https://github.com/nextlyhq/nextly/pull/2771) [`fd69795`](https://github.com/nextlyhq/nextly/commit/fd69795b39d7e2fb959cca28b2f56bd78f2916b0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `GET /me/capabilities` now names only the collections and Singles the signed-in caller may read, the same ones the collection and Single lists show that caller. Before, it named every collection and Single in the install, with `read: false` where the caller could not read one, so any signed-in user could learn every entity's name. A client that treated a missing entity as "nothing allowed" sees no change in what it may offer.

- [#2836](https://github.com/nextlyhq/nextly/pull/2836) [`79a2a07`](https://github.com/nextlyhq/nextly/commit/79a2a0704ca7d7dda9afd6491bc15232f8058f23) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard cards set to a collection are judged more precisely:
  - Which collections a reader may read is now asked of every collection a card may be set to, not read off core's generated cards. Two collections whose names differ only by `_` and `-` (for example `a_b` and `a-b`) lose their generated cards to the clash, but a Count, Recent entries, Over time or Breakdown card set to either is now shown to a reader who may read it, instead of being withheld.
  - A widget's Collection setting withholds a card only where the setting actually decides what the card reads. A widget whose registration replaced its query, so the setting no longer reaches it, no longer has its cards withheld for a collection it never reads.
  - A saved count card converted for a reader who may not see the Count widget takes the widths Count is registered with, not the core default.
  - The admin's cached workspace data is refreshed when a widget's Collection setting changes, or when the collections a reader may read change, so the settings sheet never shows an outdated setting.

- [#2789](https://github.com/nextlyhq/nextly/pull/2789) [`1b681df`](https://github.com/nextlyhq/nextly/commit/1b681dfbddaacbacbc172ad428f5aff5ae5b58b2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recent entries and Over time read what their settings name, and nothing else.
  - **Recent entries**, or any titled list, set to a collection it cannot title (one naming no title field or having no `updatedAt`) reads nothing and shows that it is not available, rather than the collection its widget was declared with.
  - **Over time** over 12 months, read on February 29, starts on February 28 of the year before, not on March 1, so its first month is drawn. Drawn as bars, the first and last bars are as wide as the rest and inside the chart.
  - **Widget queries:** a timeseries with a `range` refuses a `limit`, which the range's own number of points would otherwise silently replace.

- [#2809](https://github.com/nextlyhq/nextly/pull/2809) [`d7b2251`](https://github.com/nextlyhq/nextly/commit/d7b2251bb3366e5614718bdd6ffcec027c7cebc2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Saved dashboard cards from core's generated per-collection widgets now become the widgets offered per collection, as saved count and health cards already became Count:
  - a list or table card becomes Recent entries, which shows each entry's title, status and when it was updated from medium size, and is a table when drawn large;
  - a timeline card becomes Over time, over the last 30 days, when it counted entries by when they were created;
  - a breakdown card becomes Breakdown, by status, while its collection still has a draft and published lifecycle.

  Each converted card is set to its collection, exactly the card a reader adds from the add panel; a Breakdown card also keeps grouping by status. It keeps its place, and its width is drawn at the nearest one its new widget allows. A collection's list and table cards become one Recent entries card. A converted card joins a card of the same widget the dashboard already holds for that collection only when that card has no other settings, so a filtered list stays as it was. A card is converted only when it can be converted exactly. Otherwise it stays as stored, out of view, and is never rewritten: a card whose collection the reader may not read (until they may), a timeline that counted by another date, a breakdown whose collection has no lifecycle any more, a deleted collection's card, and a plugin's card under a generated-looking id while that plugin is disabled.

- [#2727](https://github.com/nextlyhq/nextly/pull/2727) [`15ba004`](https://github.com/nextlyhq/nextly/commit/15ba004d693c5c32c19ae30d480ecf4aa2bb4813) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card set to a collection the reader may not read is no longer handed to them. Their layout read leaves it out, exactly as it leaves out a card of a widget they may not see, and their saves keep it in place, so it returns once they may read the collection. A collection that does not exist is treated the same way, so a reader cannot learn which collections exist from what comes back. A save that adds such a card is refused, with one answer whether the collection exists or not. The card's collection is read as its settings resolve it, its declared default included, and only a value shaped like a collection name names one: a special value such as `*` withholds nothing.

  Saved count and health cards converting to Count cards also change in four ways:
  - A card whose id two collections the reader may read could spell is set to no collection. A collection the reader may not read changes nothing: the card is set to the one readable collection that spells its id, so the result never tells the reader that the other exists.
  - The merged card's width comes from the Count widget as registered, including a plugin's changes to it.
  - A layout saved from a snapshot taken before a collection was renamed between such spellings (`a_b` to `a-b`) is refused, so it cannot write the old name back.
  - The collections the conversion reads come from the same refresh as the reader's cards.

- [#2787](https://github.com/nextlyhq/nextly/pull/2787) [`e8af47b`](https://github.com/nextlyhq/nextly/commit/e8af47bc65eb4e838443da79666333ea25f21411) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A reader can add a Breakdown card from a collection's group in the add panel. It shows how that collection's entries divide: by status on a collection with a draft and published lifecycle, otherwise by its first field with choices. Breakdown is offered only on collections with something to divide by, in the add panel and in the card's Collection setting alike. A field guarded by a read rule is never offered as a grouping. A stored grouping that names one falls back to the collection's own grouping, and a query naming one is still refused.

  For widget authors, a Group by setting can take its default from the collection with `defaultFrom: "collection"`. A grouped query that leaves its key to such a setting may omit `groupBy`. Both are `@experimental`.

- [#2779](https://github.com/nextlyhq/nextly/pull/2779) [`312ca31`](https://github.com/nextlyhq/nextly/commit/312ca315753c9ea4e6957a76d29973e77ab72e1e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Removed from `nextly/auth`, deprecated in 0.0.2-alpha.69: the role checks `hasRole`, `hasAnyRole` and `hasAllRoles`, the guards `requireRole`, `requireAnyRole` and `requireAllRoles`, `checkPermission`, `authenticateApiKey`, `checkCollectionAccess`, and the session `AuthContext` type. The role checks compared role ids with role names, so they never matched. To ask whether a signed-in user may do something, use `nextly.access.check({ userId, resource, operation })`; for an API key, use `nextly.access.checkApiKey({ rawKey })`, which returns the key's own permissions and roles (it runs no collection rule, so if you passed `checkCollectionAccess` an `evaluateCodeAccess`, keep running that collection rule too); for super-admin authority, use `isSuperAdmin(userId)`. The error helpers `createErrorResponse`, `createJsonErrorResponse` and `isErrorResponse` stay.

- [#2661](https://github.com/nextlyhq/nextly/pull/2661) [`d5fff1d`](https://github.com/nextlyhq/nextly/commit/d5fff1d2e510b5fdec786d3e0981b3a8ab3a717a) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Email hub's Design tab now edits the brand settings beside a live preview. Pick an email, and the preview shows each change to the logo, its width, the accent, background and content colours, the font and the footer before anything is saved; a save bar says how many emails a save changes. Where the page builder's site style defines colours, **Match my site** offers its light-theme colours for each part of the email, suggesting the ones named for each, and the site's font where email clients have it or the closest email-safe one, saying which. The tab says which emails the brand settings reach and why they don't reach the others, and warns when the site's own Default layout keeps them from its emails. Layouts list the emails each one wraps and open in the same workbench as an email, and a layout kept as the previous engine sent it, or with an update from its owner, is said there too. The draft preview (`POST /api/email-templates/preview`) takes an optional `brand` change, checked by the rules a save is and laid over the saved settings for that render only.

- [#2780](https://github.com/nextlyhq/nextly/pull/2780) [`5cc1065`](https://github.com/nextlyhq/nextly/commit/5cc10653b2a1015be09c70e38767f1c8fcdcb8ab) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A rule's `permissions` no longer includes the earlier `posts:read` spelling, deprecated in 0.0.2-alpha.69: a rule that checks `posts:read` now refuses, and nothing warns about it. Check the spelling the Roles screen shows, `read-posts`. The list a rule is handed holds each permission once, as stored.

- [#2778](https://github.com/nextlyhq/nextly/pull/2778) [`9886067`](https://github.com/nextlyhq/nextly/commit/98860672ea50beaa36404b45e85b6228726cff18) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The entry list and editor offer only the actions your role allows. A collection's list shows "New" (and the empty list's "Create" and the new-entry shortcut) only to someone who may create there. It shows row checkboxes and the bulk bar only when a bulk action (delete, publish or unpublish) is allowed, and "Delete selected", a row's Delete and the editor's Delete only to someone who may delete. Select-all and the Delete key follow the same answers. The quick-edit and quick-create windows opened from a relationship field offer Save or Create only with the update or create permission; without it the entry is shown read-only. The answers come from the server, code access rules included, and the server still enforces every request.

- [#2680](https://github.com/nextlyhq/nextly/pull/2680) [`9322000`](https://github.com/nextlyhq/nextly/commit/9322000ba67b7f21e8627ad292c85c5aed04b010) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Erasing someone now reaches their queued email (`@experimental` with the
  queued send). Deleting a staff user, or a plugin reporting one of its people
  deleted, cancels every queued email that names them and clears its message, in
  the deletion's own transaction; erasing an address does the same for queued
  email to it that names nobody. An email queued for someone already deleted is
  stored cancelled and never sent, whichever of the two commits first. An
  attempt already with the provider is left to finish, and its delivery record
  is written erased.

  Held messages are sealed again under the current `NEXTLY_SECRET` when the app
  starts after a rotation, while `NEXTLY_SECRET_PREVIOUS` can still open them, so
  a queued email stays deliverable across any number of rotations; the server
  log says how many no configured secret can open.

  A queued email now records the person it names, and a new
  `email_queue_recipients` table keeps a keyed digest of each recipient, never
  the address, so an erased address can be found. `nextly migrate` and boot add
  both on all three databases.

- [#2718](https://github.com/nextlyhq/nextly/pull/2718) [`1bf5f48`](https://github.com/nextlyhq/nextly/commit/1bf5f4827625c1793cafe28dd4a449ba23639e65) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Field rules in field groups now hold at more of a write's edges.
  - **A new instance's inline field groups:** an update that adds a field-group instance creates the field groups it holds inline with it, so a child its create rule allows is stored rather than dropped. A single field group's instance sent without its id is still judged as the update its save makes.
  - **Repeated row ids:** a repeater or field-group list row repeating another's id takes none of the stored row's protected values, and every row is judged by its own siblings.
  - **Translated groups:** in a localized collection, a field group held in a translated group keeps a child its update rule denies, in each language.
  - **Fields named like store columns:** a field a field group declares, named like one of the store's own columns (such as `updatedAt` inside a group), is judged as content when a publish is checked, so a pending edit to it that the publisher may not write is refused rather than lost.
  - **Held drafts in every language:** a held draft that removes an instance keeps it when it holds a protected value in any language, without relying on the update's own check.
  - **Protected passwords:** an update that clears a field-group instance, or leaves it out of a list, keeps it when a rule protects its password, though the stored hash is never read back.

- [#2770](https://github.com/nextlyhq/nextly/pull/2770) [`a6185f9`](https://github.com/nextlyhq/nextly/commit/a6185f9cea74e5ac6652ddd4f15d47baddf0d592) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A field's write rule is now told the entry's id as stored, on an update, a transactional or batch update, a publish that puts a pending draft live, and taking a live value into a draft.

  The `data` a field write rule reads no longer carries values only the server decides, as the request body sent them: the `id`, `createdAt`, `updatedAt`, `createdBy` and `firstPublishedAt`. On an update, `id` is the stored entry's. On a create, it is there only where the collection keeps the id a create sends (`db.allowIdOnCreate`), since that is the id the entry is stored under.

- [#2827](https://github.com/nextlyhq/nextly/pull/2827) [`6dbec28`](https://github.com/nextlyhq/nextly/commit/6dbec28efc437ae6ff1a311dc3d2b8bce02d7fa6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Get started card and the deprecated onboarding read are corrected in five ways:
  - **The deprecated `GET /api/dashboard/onboarding` answers as it always has until it is removed.** A step whose own check failed or ran out of time is a row not complete again, and "not known" means only that the collections or Singles could not be listed. The Get started card still withholds such a step.
  - **A failed sample-content load says so.** It shows its message and a Retry, instead of the controls disappearing.
  - **Loading sample content, or declining it, counts as acting on the card.** A reader who finishes the last step from there is told "You're all set", and the card no longer simply goes.
  - **A staged reset previews the default the reset will land on.** It includes Get started even when the reader's own arrangement holds no such card.
  - **The card draws every step the server sends, in the server's order.** Runs of Singles still fold, and a step of a kind the admin does not know is drawn, not dropped.

- [#2803](https://github.com/nextlyhq/nextly/pull/2803) [`0208272`](https://github.com/nextlyhq/nextly/commit/020827216f44f4d38a5831f3b7676b2abf3432bf) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Each system list and its dashboard count read who may see that list from one definition.

  The users, roles, permissions, media, field-group and API-key lists each declare their read gate once, in `auth/list-read-gates`, and say how it is checked as well as what it asks. The users, roles, permissions and media gates are the system read policy's own, the one the checked Direct API reads, so the REST lists, the dashboard's counts and the Direct API admit the same callers. The list routes and the dashboard summary's counts both read those gates and check them the same way, so a count can no longer be given to a caller its list refuses, or kept from one it admits, after a change to only one of them. The API-key list's reach (every user's keys) is declared there too, and the key count covers what the list shows.

  No caller's answer changes. The permissions count is now checked through the any-of check the permissions list uses, rather than the single-grant check. For an API key and for a session the two agree on `read-roles`.

- [#2774](https://github.com/nextlyhq/nextly/pull/2774) [`014a66f`](https://github.com/nextlyhq/nextly/commit/014a66f9fe42b2ca5774f629e2f4a440102896c1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Role assignments and role inheritance are stored under the ids the users and roles themselves carry. On MySQL, which matches ids without regard to letter case, a request naming a user or role in another case is stored as that row's own id, and a role named twice in two cases is recognized as one when it would inherit itself.

- [#2785](https://github.com/nextlyhq/nextly/pull/2785) [`10b3066`](https://github.com/nextlyhq/nextly/commit/10b306694a8b9e2331469ce4cb3f14fa192e5d98) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Passwords are stored hashed at every depth, and no read returns one: not a read by id or in a list, a read of every translation, a version snapshot or a webhook payload.

- [#2695](https://github.com/nextlyhq/nextly/pull/2695) [`cb25ebe`](https://github.com/nextlyhq/nextly/commit/cb25ebe597da13788b32aff8bffd46336c72ce37) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The `user_permission_cache` table is retired. Nothing has read it since permission answers stopped being stored, so a new install no longer creates it. While an existing database still has it, every access change empties it before the role version is published, so an instance still running an earlier release that reads it, even one upgrading past the release in between, never serves a revoked grant from it. Where `PERMISSION_CACHE_ENABLED=false` says no instance reads it, it is left as it is. An existing database keeps it, and the startup warning names it with its row count, until `nextly migrate` runs with `NEXTLY_DROP_RETIRED_AUTH_TABLES=1`. That drops it even when it holds rows, since they were only copies of answers recomputed from roles, and logs the drop; `NEXTLY_DROP_NONEMPTY_RETIRED` still governs only the retired `accounts` and `sessions` tables. Until the drop, on MySQL, where the table has no foreign key to `users`, a deleted user's rows stay in it; they name only the user's id and permissions.

  The `userPermissionCache` schema export, deprecated in the previous release, is removed from `nextly`, `nextly/schemas` and the dialect schemas in `nextly/database`, together with the `users.permissionCache` relation. Nothing in Nextly reads the table, so code that queried it reads only answers no longer written; remove those queries. The name `user_permission_cache` is reserved, so an app table cannot take it.

- [#2731](https://github.com/nextlyhq/nextly/pull/2731) [`9f5ebf7`](https://github.com/nextlyhq/nextly/commit/9f5ebf70ba8b14f6b6ea16c0d607e6c2ef9ed5cd) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A code access rule no longer lets in a signed-in user or an API key that lacks the permission: the permission is asked first, and the rule only narrows it, for collections, Singles, related rows and writes alike, as well as `nextly.access.check`. Where a rule was letting such users in, grant the permission on the role screen; for this release, each request newly refused this way is logged once, naming the permission to grant.

- [#2557](https://github.com/nextlyhq/nextly/pull/2557) [`8192ba9`](https://github.com/nextlyhq/nextly/commit/8192ba9473e446ac31174de24a7b06d7b06ef464) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Publishing several languages at once asks the publish rule once for each
  language it puts live.

  Publishing every language of an entry or a Single, and writing
  `status: "published"` with `locale: "*"`, used to ask the publish rule once,
  told every language and no single one. A rule answering by language, such as
  `publish: ({ locale }) => locale !== "fr"`, was then asked with no `locale`
  and let French go live. Each of them now asks the rule once for each language
  going live, with `locale` set to that language and `locales` to every
  language going live, inside the publish, before anything is written. Any
  refusal refuses the whole publish, so no language goes live; the server log
  names the languages refused.

  Unpublishing every language is still asked once, in every language.

- [#2791](https://github.com/nextlyhq/nextly/pull/2791) [`fee1a3f`](https://github.com/nextlyhq/nextly/commit/fee1a3f7dcf0fd0e11ed495fac2196d1928511f6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A publish that only sends back what the draft already holds is no longer credited as the publisher's edit in Recently edited.

  The draft and the document the publish writes are now compared once, as a stored snapshot holds them. So none of these counts as a change:
  - a date sent as a `Date` beside the ISO string the draft keeps;
  - part of a component sent back as the draft holds it;
  - many-to-many ids in another order.

  A Single's own field named `createdBy` counts as content, as it does for any field a person writes.

  Two dashboard fixes:
  - A Note's text is drawn as written, so a leading indent keeps its Markdown meaning.
  - A layout write holds a placement id reused for another widget to the new widget's text bound.

- [#2799](https://github.com/nextlyhq/nextly/pull/2799) [`3419aef`](https://github.com/nextlyhq/nextly/commit/3419aef09ec76e13dff4cde2e5e7937234581969) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A ranged widget query validates again unchanged, and settings say what they may hand back.
  - **Widget queries:** a timeseries over a `range` carries no `limit` once validated, so what `validateWidgetQuery` returns validates again unchanged. A widget declaring a `limit` number setting beside a ranged query is refused at registration and as a contribution, since its range sets how many points are drawn.
  - **`applyWidgetSettings`** returns `AppliedQuery<T>`: the query as declared with each setting applied, or, for a titled list set to a collection it cannot title, the same with no `source` and no `select`. The type is exported from `nextly/config`.

  All of it is `@experimental` while the content widgets are built.

- [#2740](https://github.com/nextlyhq/nextly/pull/2740) [`71bc1ed`](https://github.com/nextlyhq/nextly/commit/71bc1ed8a2b0b24506582e53693943d4da5b2ebc) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Refusals that aren't about permission now say why, and stay 403 `FORBIDDEN`:
  - A person-only action asked by an API key: "Only a signed-in person can manage API keys." (or webhooks, preview links, a dashboard layout, notices, or marking a version as seen).
  - A change or delete of a role or permission built into Nextly: "This role is built in, so it can't be changed." (or "deleted", or "permission").
  - A trigger request from a site the installation doesn't allow: "This request came from a site that isn't allowed to make it."
  - A Single deleted without `force`: "A Single can't be deleted from here."

  Each used to read "You don't have permission to perform this action.", which sent people looking for a permission that wouldn't help. One delete that was allowed is now refused. A built-in permission deleted by action and resource, rather than by id, was deleted when it was unassigned. It is now refused as the delete by id always refused it. A hidden internal permission is refused in the generic words, so a delete doesn't confirm it exists.

  Refusals for want of permission are unchanged: they never say which check refused.

- [#2792](https://github.com/nextlyhq/nextly/pull/2792) [`83a8583`](https://github.com/nextlyhq/nextly/commit/83a8583a754f8317ca5a5412f2b09fa244a78fa0) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New projects now ship the route that serves local uploads, `src/app/uploads/[...path]/route.ts`, and `create-nextly-app` writes it into an existing app it adds Nextly to, unless the app already answers `/uploads`. A production server then serves an upload the moment it finishes, with nothing to add by hand. An app created before this release adds the file itself, as [Media & Storage](https://nextlyhq.com/docs/guides/media-storage#how-local-uploads-are-served) shows.

- [#2812](https://github.com/nextlyhq/nextly/pull/2812) [`c0147d0`](https://github.com/nextlyhq/nextly/commit/c0147d0e841b0e1db1137c9607043de5cebb050d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Security: fast-uri moves to 3.1.9.
  - fast-uri before 3.1.9 had URI-parsing flaws: scheme spoofing through percent-encoding, host confusion during canonicalization, and two lower-severity ones (GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp). `@nextlyhq/telemetry` reaches it through `conf` and `ajv`, which validate only telemetry's own consent settings against a fixed schema, so no untrusted URI passes through it. The floor still rises, so no install can resolve an affected version.

- [#2796](https://github.com/nextlyhq/nextly/pull/2796) [`4b45393`](https://github.com/nextlyhq/nextly/commit/4b45393cb3a6db5fe16d512bf4870bedad0e7713) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Security: the MCP server SDK moves to 2.3.1, nodemailer to 10.2.1 and undici to 7.30.1.
  - `@nextlyhq/plugin-mcp` moves from `@modelcontextprotocol/server` 2.0.0 to 2.3.1. Before 2.3.0, one HTTP request within the default size limit could exhaust the server's memory during validation (GHSA-46jr-4wx8-v453); the MCP endpoint validates every request, so it was reachable. Two other advisories fixed in 2.3.0 (GHSA-jm63-cq47-j5jp, GHSA-rvq5-wwqv-78pq) didn't apply: the endpoint already builds a fresh server for each request, and it doesn't use the SDK's bearer authentication.
  - nextly's optional `nodemailer` peer moves from `^9.0.1` to `^10.2.1`. nodemailer before 10.1.4 had address-parser denial-of-service and parsing flaws (GHSA-prgh-xp8r-p3m5, GHSA-v53p-9fqp-m79j, GHSA-8c8m-p3m8-cjg8 and others), and the SMTP provider passes the addresses it sends to through that parser. **Apps using nodemailer for SMTP need nodemailer 10:** run `npm install nodemailer@^10.2.1`. nodemailer 10 needs Node.js 20 or later, which Nextly already requires, and nothing in Nextly's use of it changes.
  - undici, which `@vercel/blob` and the jsdom behind HTML sanitizing pull in, moves to 7.30.1, past three denial-of-service and integrity advisories (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472). Neither path was exposed in practice: Vercel Blob's client talks only to Vercel's API, and sanitizing loads nothing over the network.

- [#2825](https://github.com/nextlyhq/nextly/pull/2825) [`9609671`](https://github.com/nextlyhq/nextly/commit/96096711b0bff44ebd880549adcfb5cb3b2a2f1c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The site config can shape the dashboard: `admin.dashboard`, checked at startup.
  - **`widgets`, `hide`, `overrides`, `defaultLayout`, `suggestions` and `replace`** are accepted and checked, but **not applied yet** in this version. Startup logs one warning naming each one a site sets. The site's own widgets, declared with `defineWidget()` as a plugin's are, are checked together with the plugins' widgets, and other keys may name them.
  - **Startup refuses a site config that names a widget that does not exist** (with the nearest id), or that uses a key `admin.dashboard`, an `overrides` entry or a `defaultLayout` card does not take (with the key it most likely meant). An id in the `collection/` or `single/` namespace, a card core derives from the content later, is not refused as unknown at startup; its entry's shape is still checked. It also refuses:
    - a width a widget does not allow, or widths that widen rather than narrow;
    - a setting a widget does not declare, or a value it does not accept;
    - a title or a description that breaks the declaration rules;
    - a default dashboard with more cards than a dashboard holds, or that lists a widget allowing one card more than once;
    - a default or a replacement naming a hidden widget, or a replacement no plugin offers for that built-in.
  - **A plugin's `suggest` and `alternatives`** may name only its own widgets, and an alternative only in place of a built-in that exists. A plugin's dashboard contribution is read once at startup, every check reads that copy, and a key it does not take is refused with the key it most likely meant.
  - **All startup faults are reported together** with the widget declarations' own.
  - `AdminDashboardConfig`, `WidgetRef`, `DefaultLayoutCard` and `WidgetOverride` are exported from `nextly`.

  All of it is `@experimental` while the dashboard widget SDK is built.

- [#2699](https://github.com/nextlyhq/nextly/pull/2699) [`48d7c12`](https://github.com/nextlyhq/nextly/commit/48d7c12382a268bfc3d2218b6eda4d2fa2915af5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A template test email no longer goes to the template's Cc and Bcc. Send test now reaches only the signed-in person who pressed it: the template's stored copies, such as a team inbox, are left out of the test, which carries sample data. Real sends of the template still copy them.

- [#2682](https://github.com/nextlyhq/nextly/pull/2682) [`2a2b068`](https://github.com/nextlyhq/nextly/commit/2a2b068ec874d0c1081baf1534b9eb8b7c614beb) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin now learns from the server what you may do with each collection and Single, so a collection's code access rule is reflected in what it offers, not only the permissions your roles hold: the collection and Single pages, the dashboard's quick-create shortcuts and the navigation all follow that answer. It is asked in the content language on screen, kept between pages rather than asked again by every component, and asked again on focus, when your soonest role assignment ends, after a change to roles, permissions or role assignments, and after a schema change. Once that role assignment has ended, the earlier answer no longer counts, even if asking again fails. Until the server has answered, no collection or Single is offered. The system sections (users, roles, media, settings, email, webhooks, releases) are still offered from your permission list, and stay available when only the answer about collections fails.

- [#2735](https://github.com/nextlyhq/nextly/pull/2735) [`b142980`](https://github.com/nextlyhq/nextly/commit/b142980b0d06aeac05ef308fb3863f5cea01f91c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `useCan` and `<Can>` (exported by the admin and re-exported by `@nextlyhq/plugin-sdk`) now answer a read, create, update, delete, publish or unpublish of a collection or Single as the server decides it, code access rules included. `useCan("update-posts")` is `false` for a role that holds `update-posts` when a code rule on Posts refuses that update, and `true` where the server allows an action no permission names. The entry editor's publish and unpublish, bulk publish and unpublish, publishing every language, adding to a release and restoring a version follow that answer. Until the server has answered about collections and Singles, such a slug answers `false`, and once it has, such a slug for a resource the answer does not name answers `false` except to a super-admin, so give a plugin permission that is not about a collection or Single an action other than those six (`export-reports`) to check it with `useCan`. Every other slug (a system resource such as `read-webhooks`, or a plugin's own permission such as `manage-seo`) is still answered from the permissions your roles hold. The server still enforces every request either way.

- [#2807](https://github.com/nextlyhq/nextly/pull/2807) [`9c7f145`](https://github.com/nextlyhq/nextly/commit/9c7f14539503957b0b728f9741199ca2af7ff81d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A plugin's dashboard widget can be drawn by its own component. A widget declared with `defineWidget` and `display: { component }` is now offered on the dashboard. The admin draws its frame and its loading, no-permission and error states, and hands the component the props its declaration types: `WidgetProps` (data, settings, size, refreshing, retry). If the component throws while drawing, that card alone shows its error, with Retry.

  `@nextlyhq/plugin-sdk/admin` now exports the widget kit, the parts core's own cards are drawn from: `CardSkeleton`, `CardEmpty`, `CardUnavailable`, `CardError`, `CardFigure`, `cardNumber`, `cardChange`, `GroupsChart` and `OverTimeChart`. They read the card's size and the admin's theme, so a plugin card matches core's in light and dark. `defineWidget` and the `WidgetProps`, `WidgetRenderSize` and `WidgetData` types are exported from `@nextlyhq/plugin-sdk`, and the types from `./widgets` too. All of it is `@experimental`.

  Import the kit only through `@nextlyhq/plugin-sdk/admin`. If a second copy of the admin is loaded, development warns about it.

- [#2816](https://github.com/nextlyhq/nextly/pull/2816) [`b0017eb`](https://github.com/nextlyhq/nextly/commit/b0017ebc05f5bb9e55d3d6414877481b6771ef22) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard widget whose Collection setting defaults to a collection the reader may not read no longer names that collection in the admin's workspace data. The default is left out for that reader, as the dashboard already leaves out their cards that rely on it. The widget is still offered for the collections they may read; a card they add from it is set to one of those before it saves.

## 0.0.2-alpha.71

### Patch Changes

- [#2756](https://github.com/nextlyhq/nextly/pull/2756) [`709babb`](https://github.com/nextlyhq/nextly/commit/709babbdce0f78b957e71b974178d4f34b20f657) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A production server (`next build` and `next start`) now serves a file uploaded to Nextly's default local-disk storage as soon as the upload finishes, at the same `/uploads/...` URL `next dev` gives it. Before, Next.js answered 404 for it until the server restarted, because `next start` serves only the files `public/` held when it started. A route at `src/app/uploads/[...path]/route.ts`, built on the new `nextly/api/uploads` export, serves the rest: it streams files, answers `Range` requests for video and audio, sends `ETag` and caching headers, sets `nosniff` and a script-blocking policy on SVGs, and answers 404 for any path outside the storage folder and whenever cloud storage holds media. The local adapter's check that a path stays inside its folder no longer accepts a sibling folder whose name starts with the folder's own, such as `public/uploads-private` beside `public/uploads`.

  **Before you upgrade:** projects don't ship the uploads route yet, so an app keeps the old behaviour until it has one. Add `src/app/uploads/[...path]/route.ts` (or `app/uploads/[...path]/route.ts` without a `src/` folder) exporting `GET` and `HEAD` from `createUploadsHandlers({ config })` in `nextly/api/uploads`, as shown in [Media & Storage](https://nextlyhq.com/docs/guides/media-storage#how-local-uploads-are-served). Until then, a production server logs a warning naming the file the first time an upload would be unreachable.

- [#2765](https://github.com/nextlyhq/nextly/pull/2765) [`ed1b2f1`](https://github.com/nextlyhq/nextly/commit/ed1b2f19f440dc02dcc12e2d2940f74cc44fdaae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Security: zod moves to 4.6.7 and DOMPurify to 3.4.17.
  - zod before 4.6.6 could run out of memory validating a very large array against an array schema without a length limit (GHSA-mrhx-c7xc-m3w5). Every package that validates input with zod gets the fixed version.
  - DOMPurify before 3.4.17 had sanitizer bypasses in its `SAFE_FOR_TEMPLATES`, DOM-output and `IN_PLACE` modes (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr). Nextly's SVG upload sanitizer uses none of those modes, so it was not affected; the floor still rises, so no install can resolve an affected version.

## 0.0.2-alpha.70

### Patch Changes

- [#2728](https://github.com/nextlyhq/nextly/pull/2728) [`7138012`](https://github.com/nextlyhq/nextly/commit/71380124cdbf3b3bf0c2964a0fac3b27902a41ce) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Two refusals that aren't about permission now say why, and stay 403 `FORBIDDEN`.

  A change or delete of a collection, Single or component defined in code, made from anywhere but its code, reads "This collection is defined in code, so it can't be changed here." (or "deleted", or "Single", or "component"). An autosave where the collection or Single doesn't autosave reads "Autosave is turned off for this collection." (or "this Single"). Both used to read "You don't have permission to perform this action.", which sent people looking for a permission that wouldn't help.

  One status changes. The admin's schema routes checked the lock themselves and answered a thing defined in code with a 500 internal error: changing a Single's schema, previewing or applying a schema change to a collection, Single or component, and deleting a Single. They now answer 403 with the same sentence.

  Refusals for want of permission are unchanged: they never say which check refused.

- [#2734](https://github.com/nextlyhq/nextly/pull/2734) [`d5263f6`](https://github.com/nextlyhq/nextly/commit/d5263f6a8a54b8669e18b17d145c1f47600025c8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Creating a user with roles takes the super-admin lock before it writes the account, the same order as every other change to who is a super-admin. Run at the same moment as such a change, a role deletion for instance, it could otherwise deadlock on MySQL and fail with a retryable `409`.

- [#2751](https://github.com/nextlyhq/nextly/pull/2751) [`edceef5`](https://github.com/nextlyhq/nextly/commit/edceef5b8619ba45d221168598d2809d270a5dbe) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - **Security: an anonymous create, update or delete now needs a rule that allows it.** A
  checked write with no signed-in caller (the Direct API with `overrideAccess: false` and no
  `user`, or a plugin service call made `{ as: "public" }`, as a `public: true` route makes
  one) used to be allowed on a collection or Single whose `access` named no rule for that
  write. It is now refused. Reads keep the public default, publishing still needs a signed-in
  user, and the admin's REST API is unchanged.

  If you take anonymous writes on purpose, say so in the collection's `access`, for example a
  public form-like collection: `access: { create: () => true }`. The form builder's
  submissions already declare `create: true` and keep working.

  A plugin's `deleteEntryInTransaction` made `{ as: "system" }` is now trusted, as its other
  `{ as: "system" }` writes are; it was judged as an anonymous caller.

- [#2743](https://github.com/nextlyhq/nextly/pull/2743) [`dab8664`](https://github.com/nextlyhq/nextly/commit/dab86644383813c1685536bc28e157ebbc33e82b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's built-in emails (welcome, password reset, email verification) and the default layout's footer now meet WCAG AA contrast: the small print under each button is darker on the card, and the footer line and links paragraph are darker on the page. Installs that never edited these templates get the new colours on their next boot; an edited template keeps its own.

- [#2679](https://github.com/nextlyhq/nextly/pull/2679) [`869482c`](https://github.com/nextlyhq/nextly/commit/869482c1e1954ceacc2a3d01e32293c2433f626d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A code access rule now allows only by returning `true`. A rule that returns `null`, `undefined`, a string or any other value refuses, as `false` does, for every caller and at every way in. Before, a visitor was refused only by `false`, so `null` and `undefined` let one through, and a signed-in user was let in by any truthy value. Return `true` to allow.

  `ctx.caller.can` in a plugin route and `nextly.access.check` now return a boolean. Before, a rule's own answer could come back as it was, `null` or a string included.

  For this release, each request refused this way that a rule allowed before is logged once, naming the collection or Single, the action and the kind of caller, so a rule that relied on the old reading can be found and changed.

- [#2757](https://github.com/nextlyhq/nextly/pull/2757) [`6c7904f`](https://github.com/nextlyhq/nextly/commit/6c7904fb69712c1533808bba36b53e47e8e66bde) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A route handler's error now answers as that error on a host whose function bundle lacks part of `next/navigation`. Nextly loads Next's `unstable_rethrow` lazily, which file tracing cannot follow, and on such a bundle (seen on Vercel with Next 16.4.3) loading it failed for every error a handler caught: a signed-out caller's 401, for one, became a 500, so the admin stopped working for anyone signed out. Where it cannot be loaded, Nextly now makes the same check from the errors' digests, so `redirect()` and `notFound()` still pass through and every other error gets its own response.

- [#2750](https://github.com/nextlyhq/nextly/pull/2750) [`0eb828f`](https://github.com/nextlyhq/nextly/commit/0eb828f0536e250c74f90bae15680b414b93ba1a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - nextly's route handler, boot and role and user services no longer load the service registry or every core service just by being imported. They load them when they first register or build services, so a module that needs one service loads far fewer. The services barrel no longer re-exports the dispatcher; the root `nextly` entry exports the same names as before.

- [#2737](https://github.com/nextlyhq/nextly/pull/2737) [`ab13109`](https://github.com/nextlyhq/nextly/commit/ab13109fc0575745678f482dac04dd8c43e73d61) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Asking nextly's DI container for a service no longer loads every service registration. `getService` and `isServicesRegistered` read the container without importing the registry, so code that only looks services up loads far fewer modules. The root `nextly` entry exports the same names as before.

## 0.0.2-alpha.69

### Patch Changes

- [#2365](https://github.com/nextlyhq/nextly/pull/2365) [`6093742`](https://github.com/nextlyhq/nextly/commit/6093742e0971d0c0f00251cd9c6b47e640946259) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A batch save that cannot record its history now keeps the versions it would have pruned. When the history table is missing (an install not yet migrated), a batch update with `stopOnError: false` no longer commits a held edit or removes older versions with no record of it: the whole batch rolls back.

- [#2581](https://github.com/nextlyhq/nextly/pull/2581) [`a0d926a`](https://github.com/nextlyhq/nextly/commit/a0d926ab9cc9b78b9683492e10f00974e88c72e9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A card's settings sheet keeps a change where the reader is, shows the card beside the form, and reopens on what is stored after Cancel.
  - **Done** while customising holds the change with the dashboard's other unsaved changes and closes the sheet. At rest it saves the change at once: the sheet stays open while saving, closes when the save lands, and says why in place when it does not.
  - **A live preview** draws the card as the form's values would, with the dashboard's own renderer, beside the form on a wide screen and above it on a narrow one. A change that alters what the card asks, such as its number of rows, is asked once for the preview alone after the values settle. The card keeps its own answer until Done.
  - **Cancel** now discards the change. The sheet used to reopen on the value the reader cancelled, although nothing had been saved: the form was given the sheet's own starting values rather than a copy, and wrote into them.
  - **A quick setting** whose new answer the card could not load is announced as saved, with the card still showing its earlier data, rather than not announced at all.

- [#2375](https://github.com/nextlyhq/nextly/pull/2375) [`eb09f42`](https://github.com/nextlyhq/nextly/commit/eb09f42e9e5a1a29933ea355250cbacd16690ede) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An API key is refused while the person who created it is deactivated, and
  works again once they are reactivated. The instance that deactivates the
  person refuses the key at once, and every other instance within ten seconds,
  the bound that already applies to that person's sessions. An administrator
  setting the person's password does not stop their keys.

- [#2660](https://github.com/nextlyhq/nextly/pull/2660) [`792d1d5`](https://github.com/nextlyhq/nextly/commit/792d1d5fcdaf7ad18459e975905e4f027c7a42c3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A declared widget's card is now held to what its display draws for the card's own settings, not only the starting ones, so a query function that writes a different operation for a setting a reader chose fails that card alone rather than drawing an answer it misreads. And the read decisions a declared widget's data function needs, for collections the batch did not name in advance, now take the same bounded turns as the rest of the batch's, instead of starting all at once.

- [#2630](https://github.com/nextlyhq/nextly/pull/2630) [`351231c`](https://github.com/nextlyhq/nextly/commit/351231c3c53a3eee71aacb871f5378fe40c4e6f4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget declared with `defineWidget` and drawn by a core display (`metric`, `list`, `table` and the others) now has its cards answered on the server, as the person asking, and drawn in the admin, in the widget's own words when it has nothing to show. A widget drawn by its own component (`display: { component }`) is checked at startup but not offered yet: the admin does not yet hand a component the props its declaration types, and development says so once per widget.
  - **A card is asked for by its id**, and core builds its data from the widget's declaration: its `data` function run with the card's settings, the person and the batch's one instant, or its query written from the settings. Only a card the reader was handed is answered; every other card gets the one "unavailable" answer. While the dashboard is being customised, a card is asked with the settings it is drawn with.
  - **Reads are the person's.** A data function's `services.count` and `services.find` read as the person asking, through the same check a card's own query passes, and read nothing once the card has given up. Options a plain JavaScript caller passes beside them (`user`, `as`, `overrideAccess`) are never read.
  - **`WidgetDataInput` gains `now`** (`@experimental`): the batch's one instant, so every card asking for the last 30 days asks for the same days. `ResolverOptions` gains the same `now` (`@experimental`).
  - **`WidgetResult` gains `{ op: "data", data }`**, a declared widget's own data for its own component, and a slot may carry `empty: true`, the verdict of the widget's declared empty test. The admin then draws the declared empty message and action, whose link is only ever a path under the admin.
  - **Definitions gain `serverData`, `allowedWidths`, `defaultWidth`, `allowsSeveral`, `sketch` and `empty`.** Core publishes these for a declared widget. `registerWidget` refuses `serverData`, and an empty state's action is withheld from a reader without its permission.
  - **Default dashboards** never place a declared widget; it is offered in the add panel instead.

- [#2349](https://github.com/nextlyhq/nextly/pull/2349) [`e2afec9`](https://github.com/nextlyhq/nextly/commit/e2afec941dd8a984e06d0ab2e52feb070c50b699) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting media no longer removes a file another media item still refers to, however the other item refers to it: as its original, through one of its image sizes, as its thumbnail, or under another spelling of the same path. Two items can share a stored file after an import that copies a record, or on a storage adapter that keys files by their content. A crop keeps such files too, including when its write fails.
  - When the database cannot be read to check this, nothing is removed and the delete or crop still succeeds; the log names the item whose files were left.
  - Failure logs from media cleanup no longer show credential query parameters (`X-Amz-Credential=…`, `token=…`) wherever they appear in a storage error, nor URLs written without a scheme.

- [#2379](https://github.com/nextlyhq/nextly/pull/2379) [`077631c`](https://github.com/nextlyhq/nextly/commit/077631c22da693101a81a003d9b2b2c337ca17e3) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Deleting a staff user now erases every email delivery record that names them, under every address they used, and any record written for them afterwards is written erased. Another person at the same address keeps their records.

- [#2665](https://github.com/nextlyhq/nextly/pull/2665) [`931faf8`](https://github.com/nextlyhq/nextly/commit/931faf87dd200e35a28621d7cbfbcae3621a4daa) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A chart's dismissed tooltip stays dismissed until the pointer moves. Escape hides a hovered tooltip on a dashboard chart, but the bar under a pointer that had not moved could bring a tooltip straight back, because hiding the tooltip uncovered that bar and the browser reported it as entered. Now only a move of the pointer, or of the keyboard's point, shows a tooltip again.

- [#2451](https://github.com/nextlyhq/nextly/pull/2451) [`1462411`](https://github.com/nextlyhq/nextly/commit/1462411ac6e5e7a212f08fadf3916d9571ec952e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An email the provider fails or refuses now says whether sending it again can
  help: `nextly.email` and a plugin's `ctx.services.email` return `failure` with `retryable`, the provider's status where it gave one, and a
  short reason, and list any recipients the provider refused. A send refused before
  any provider is reached (a bad recipient, a provider named but not found, a missing template) still
  throws, as before. Form Builder logs a
  notification that was not sent as failed instead of sent, and no longer writes
  recipient addresses into its logs.

- [#2364](https://github.com/nextlyhq/nextly/pull/2364) [`9b80400`](https://github.com/nextlyhq/nextly/commit/9b80400d8d2c6be833a58321b0c9dceb4b92c942) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Several processes starting Nextly against one fresh database at once, as `next build`'s workers and a fleet of instances do, now seed each default row once without reporting the ones another process wrote first. The process that lost the race used to log the duplicate as a warning or an error with a stack trace (an email template, a role preset, a plugin's role), report the whole permission step as failed and skip the plugin roles that wait for it, or fail its sync of the code-defined user fields. A row another process wrote is now taken as seeded and logged at debug; any other failure is still reported as before. The same holds for a Single's default document, which its first read creates: concurrent first reads, such as a fresh build's pages, used to fail every read but one with a `UNIQUE constraint failed` error logged at error level, and each now gets the one document that was stored. On PostgreSQL and SQLite, a permission another process created at the same moment was also reported as created under an id that was never stored, so a grant made for it could point at no permission: the permission is now read back and reported as found.

- [#2467](https://github.com/nextlyhq/nextly/pull/2467) [`8755798`](https://github.com/nextlyhq/nextly/commit/8755798b874ef429603dd8f3f25f33965b7cb023) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A send can now carry an `idempotencyKey`, and the email then goes out once on
  every provider: on `nextly.email.send` and `sendWithTemplate`, the same two on a
  plugin's `ctx.services.email`. A repeat of a send
  that succeeded returns its result with `repeat: true` and sends nothing; a
  repeat after a failure sends again; the same key with a different message is
  refused. Keys are scoped to their caller, so two plugins never share one, and
  Resend is also handed a key derived from the caller's.

  Nextly stores a keyed digest of each key in a new `email_send_claims` table and
  a new `key_digest` column of `email_deliveries`, never the key or an address,
  and erasing a person clears the digest from every record of their sends.
  `nextly migrate` and boot add both on all three databases, and rewrite no row.
  Sends without a key are unchanged.

- [#2441](https://github.com/nextlyhq/nextly/pull/2441) [`9937cc5`](https://github.com/nextlyhq/nextly/commit/9937cc57ff633689753cfbfbf9158f8528e728e6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A document-lock claim is now judged as an update of that document is. Claiming or renewing a lock asks the same question a REST update of the document asks, so an API key must hold the update grant and pass the collection's or Single's own `update` rule. Releasing a claim still needs the grant alone, since its claim token fences it. Sessions are judged as before.

- [#2458](https://github.com/nextlyhq/nextly/pull/2458) [`253cd89`](https://github.com/nextlyhq/nextly/commit/253cd8963766b2fa023e3ed0445fec966e7f7f19) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A column narrowed to `varchar(N)` is judged by the values it holds, and `nextly migrate` runs in strict mode on MySQL.

  On MySQL, Single and field-group tables made before their tables came from the schema pipeline hold a `text` field as `TEXT`, where the schema declares `VARCHAR(255)`. Every `db:sync` and dev reload asked to narrow them in a terminal, and failed without one.
  - `db:sync`, the dev reload and an admin schema save now count the stored values longer than N before narrowing a string column to `varchar(N)`. When there are none, the change loses nothing and applies without a prompt. When there are some, the apply stops before any DDL and names the table, the column and the number of rows; shorten those values, or give the field a type that holds them, and apply again.
  - `nextly migrate`, `migrate:down`, `migrate:resolve` and plugin migrations run each migration not marked `-- nextly:no-transaction` on MySQL with `STRICT_ALL_TABLES` added to the session's mode, and puts the session's mode back afterwards. A file that would cut a value short — such as the `MODIFY COLUMN … varchar(255)` that `migrate:create` writes after `migrate:baseline` adopts one of these tables — now fails with "Data too long" at that statement, which changes nothing (schema statements before it in the same file stay applied, as MySQL commits them), where a server without strict mode used to truncate the value with only a warning. A hand-written migration that relied on MySQL's non-strict coercion now fails the same way.
  - The MySQL adapter's `transaction()` takes a new `strictSqlMode` option, which does this for any transaction. PostgreSQL and SQLite ignore it.

- [#2371](https://github.com/nextlyhq/nextly/pull/2371) [`d986b28`](https://github.com/nextlyhq/nextly/commit/d986b28b02bb07481ca8bb995cdc3fe268443866) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A past version now reads in the editor's own layout with its changes marked. One comparison bar above it says which version is shown, what it is compared with (the version before it in its language) and how many fields changed, with Previous and Next change. Each changed field is marked with what changed; unchanged fields fold behind "Show N unchanged fields". While a version is shown, Back to current and Restore… replace Save and Publish in the title bar, and on a phone they sit in a bar at the bottom. The banner above a past version is gone.

  The admin's unused localStorage autosave and draft recovery (`useAutoSave`, `useDraftRecovery`, `DraftRecoveryDialog`) are removed. Nothing called them since autosave moved to the server, and none was exported from the package.

- [#2384](https://github.com/nextlyhq/nextly/pull/2384) [`92852f7`](https://github.com/nextlyhq/nextly/commit/92852f70d1a3d4556138f062a158a4341932e3c4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A person's standing is read again as soon as the change that deactivates
  them, or sets their password, commits, however long that change's
  transaction stays open, on every database.

- [#2272](https://github.com/nextlyhq/nextly/pull/2272) [`ab73264`](https://github.com/nextlyhq/nextly/commit/ab73264679dcc9c00017247f7984cec5c605ff97) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A project gets the release of Nextly its create-nextly-app belongs to.
  - A new project declares `nextly` and every `@nextlyhq/*` package at exactly the CLI's version, from any template, so the templates, the agent guide and the skills match what is installed. npm's `latest` tag no longer decides anything, and the registry is not asked.
  - The blog template is downloaded at the CLI's own release tag instead of `main`. If GitHub has no template for that release, the run stops and names `--branch`; if GitHub cannot be reached, it names `--local-template`. A branch name with a `/` now downloads too.
  - Adding Nextly to an existing app installs its packages at exactly that version, recorded exactly, after the packages they require alongside them, so pnpm with strict peers accepts the install. An app that already has a Nextly package at another version stops before anything is written or installed, and is told what to set: one declared as a range or at another version in any dependency field, or one it loads at another version, from its own `node_modules` or a workspace folder above it.
  - `--branch` no longer defaults to `main`: given, it takes the template from that branch, and the packages from the `alpha` tag, as `--local-template` does. `--use-yalc` still links local builds.

  A project made before this release is not changed by it, and keeps the versions it declares. Before adding Nextly to an existing app, set every Nextly package it has to exactly the CLI's version.

- [#2433](https://github.com/nextlyhq/nextly/pull/2433) [`f74d122`](https://github.com/nextlyhq/nextly/commit/f74d12202f34bc09699f02263f0b5dd0a7635962) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A new project created outside a workspace records the pnpm or Yarn version that created it as `packageManager`, so Corepack installs with that version instead of its own default.
  Adding Nextly to an existing app records it too, but only when the app chooses no package manager yet and isn't part of a workspace.

- [#2550](https://github.com/nextlyhq/nextly/pull/2550) [`8c4d300`](https://github.com/nextlyhq/nextly/commit/8c4d300d6c879b31386631d6cc170126d2b97fe0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Publishing or unpublishing every language of a collection entry now clears its cached pages even when the request fails after the change is saved, and is reported saved only once a transaction around it has committed.

- [#2707](https://github.com/nextlyhq/nextly/pull/2707) [`5352b69`](https://github.com/nextlyhq/nextly/commit/5352b69f053346997f73e5002b3059c1b3048199) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A refusal now says what was refused, in the site's own words.

  A refused request's `error.message` names the action and the thing as the site names them: "You can't edit this post.", "You can't create posts.", "You can't edit Site Settings.", "You can't see API keys." The thing is a collection's label (one entry of it where the request names one), a Single's label, or a system resource in words. It never names a permission as stored (`update-posts`), a role, a rule or which check refused, and never repeats a slug the site does not know, so a URL cannot make a refusal echo it. The REST route gate, the Direct API, plugin services and the routes built on them answer this way.

  Which check refused, and on what grant, is logged on the server at `info` (`[nextly] Refused a request`, with the reason and the request id the caller was answered with), and never sent.

  A request that is not signed in, or whose session has expired, or whose API key is not valid, is answered "Authentication required." in every case; the code still tells an expired session (`TOKEN_EXPIRED`) apart, so the admin refreshes it as before.

  One status changes. The standalone route handlers exported from `nextly/api/*` now answer a request presenting an API key while the key service is unavailable with 503 `SERVICE_UNAVAILABLE`, as the main REST handler already did; they answered 403. Every other refusal keeps its status.

  A client that matched the old wording ("You do not have permission to …", "Access denied: …") reads `error.code` instead, which is unchanged.

- [#2285](https://github.com/nextlyhq/nextly/pull/2285) [`6f2d0bd`](https://github.com/nextlyhq/nextly/commit/6f2d0bd90c2b5d2aaee5e1c95375deb28b0350d3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Add a calendar read for releases. `GET /api/releases/calendar` and
  `nextly.releases.calendar()` take a window of days (`from` and `to`, at most
  six weeks) in a named time zone and answer every day of it with the complete
  count of its releases by state and its first three releases in time order, so
  a calendar's "+N more" is always true. Days follow the zone's own clock,
  daylight saving included: a release at 23:30 in New York is on the next day in
  London. The list gains a day filter (`day` and `timezone` over REST,
  `day: { date, timezone }` from the Direct API) that returns one such day in
  full, paged, in the same order. A published release is on the day it went out,
  any other release on the day of its scheduled time. Both are experimental.

  The releases table gains two indexes, on `scheduled_at` and on `published_at`,
  which the calendar and the day filter read by. `nextly migrate` adds them to
  an existing database. Index only, no data change.

- [#2562](https://github.com/nextlyhq/nextly/pull/2562) [`7183036`](https://github.com/nextlyhq/nextly/commit/718303681cf811dbf54044abf46dfb40a172c716) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A renamed collection or Single keeps its history, who may use it and where its webhooks go: its versions, pins, "last looked at" markers, content events, release membership and each release's history of its documents, schema events, activity, archived translations, permissions (with every role's grants of them), live webhook filters, webhook events not yet sent and the webhook recording choice move to the new slug in the same transaction as the rename, instead of staying behind for the next entity under the old slug. A renamed Single's document reads its new slug, and content cached under either slug is refreshed. A rename onto a slug that still holds an earlier entity's records, or onto one longer than 50 characters, is refused, and document locks, preview links and kept permission answers end with the old slug, as do any an earlier entity left under the new one.

- [#2443](https://github.com/nextlyhq/nextly/pull/2443) [`30d4944`](https://github.com/nextlyhq/nextly/commit/30d494491d61cd52fd1c6afe4b0f3755de220ff1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A request now waits a bounded time for a database connection on every dialect, and past the bound fails instead of waiting without end, as "database busy" where the error reaches the request boundary (see "Where it shows" below).
  - **The setting:** `pool.connectionTimeoutMs`, default 15 seconds (20 on Neon, from the PostgreSQL adapter's provider defaults), with the same meaning on PostgreSQL, MySQL and SQLite. `0` waits without limit.
  - **Where it shows:** route handlers, server actions, sign-in and the REST dispatcher answer `DATABASE_BUSY`. Collection and Single entry reads and writes answer `DATABASE_BUSY` too. A few entry paths still answer 500 `INTERNAL_ERROR` when it is busy: publishing every language of a Single, duplicating an entry, and a read whose locale, component or media step is the one that waits.
  - **The error:** `DATABASE_BUSY`, status 503, with `data.retryAfterSeconds` of 5 and a `Retry-After: 5` header on REST. The statement or transaction that waited did not run. Anything the request committed before it stays committed, so a request that writes in several steps is safe to repeat only where those steps are. A collection or Single write, or a registration, that committed and then hit a busy database in a later step answers that the change was saved, without a retry hint.
  - **PostgreSQL:** the timing is unchanged; the pool already gave up after 15 seconds. What changes is the answer: it was a 500 `INTERNAL_ERROR`, and is now `DATABASE_BUSY`.
  - **MySQL (behaviour change):** a request that found every connection in use used to wait in mysql2's queue without limit. It now fails after `pool.connectionTimeoutMs`, unless you raise it. The time a new connection gets to open (`connectTimeout`) also moves from 10 to 15 seconds, so it matches PostgreSQL; a connection that cannot open in time is still a connection error, not `DATABASE_BUSY`.
  - **SQLite:** a transaction waits at most `pool.connectionTimeoutMs` for the one connection behind the transactions ahead of it. A write blocked by another process holding the database file past `busyTimeout` (`SQLITE_BUSY`) is now `DATABASE_BUSY` too, where it was a 409 `CONFLICT`. `SQLITE_LOCKED` stays a `CONFLICT`.
  - **Retry-After:** it is now set for any error carrying `data.retryAfterSeconds`, not only `RATE_LIMITED`.
  - **For adapter authors:** the adapters raise the busy error with the code `NEXTLY_POOL_WAIT_TIMEOUT`, exported from `@nextlyhq/adapter-drizzle/types` as `POOL_WAIT_TIMEOUT_CODE`, with `poolWaitTimeoutError()` to raise it.

  See [When the database is busy](https://nextlyhq.com/docs/guides/deployment#when-the-database-is-busy) in the production guide.

- [#2107](https://github.com/nextlyhq/nextly/pull/2107) [`1b96481`](https://github.com/nextlyhq/nextly/commit/1b96481ecaed98c780a26c0134acf515af7d3fe4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Password-reset and email-verification links now act only on the account they
  were issued for, and only while it still holds the address they were sent to.
  Each link records its account (a new `user_id` column on
  `password_reset_tokens` and `email_verification_tokens`, with a foreign key to
  `users`). Changing an account's address revokes its links, so one sent to the
  old address stays dead even after the account moves back. Deleting an account
  removes its links, whatever address they went to. Someone later given an
  address is never reset or verified by a link sent to an earlier holder.

  Issuing a link, following one, changing an address and deleting an account
  each hold the account's row for their transaction, so a link issued or
  followed while the account moves or is deleted is either revoked afterwards
  or refused. Following a link now checks it, applies it and spends it in one
  transaction, so two redemptions of one reset link cannot both set a password.

  `nextly migrate` adds the column and removes every outstanding password reset
  link: a reset link may have been given any lifetime, and its stored times
  cannot show reliably when it was issued. It ties each outstanding email
  verification link to the account holding its address when that account was
  created and last changed before the link was issued, so those links keep
  working. A verification link whose account was created or changed at or after the
  time it was issued (on MySQL and SQLite, which store whole seconds, also in the
  same second) is removed, since it may have been sent to an
  earlier holder of the address, and so are expired links and links to an
  address no account holds. Their owners request a new link.

- [#2403](https://github.com/nextlyhq/nextly/pull/2403) [`2f498a6`](https://github.com/nextlyhq/nextly/commit/2f498a64fd2efab509ebb433e566fe8ff4e881dd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Editing a role (its name, its permissions or its child roles) works on SQLite. The edit ran in a transaction the SQLite driver refuses for asynchronous work, so it failed there with a server error before changing anything, while PostgreSQL and MySQL were unaffected.

- [#2496](https://github.com/nextlyhq/nextly/pull/2496) [`837c7b1`](https://github.com/nextlyhq/nextly/commit/837c7b149a3eb0c50db1a451521b1ec54293d54f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A collection or Single write, or a registration, that saved and then failed answers that the change was saved, without a retry hint, and the admin retries a failed write only when the server refused it before running it, so a saved change is no longer made twice.

- [#2594](https://github.com/nextlyhq/nextly/pull/2594) [`1ebd31b`](https://github.com/nextlyhq/nextly/commit/1ebd31b8ae3f25cbd15ca53d160699ccbd6646b4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Looking up a collection's schema no longer writes to the console. Every query against a collection resolved its schema through a lookup that logged three lines, one of them the name of every registered collection, so a busy app wrote thousands of identical lines to its server log per burst of requests. A lookup that has to build the schema, or finds none, still logs as before.

- [#2288](https://github.com/nextlyhq/nextly/pull/2288) [`934cef1`](https://github.com/nextlyhq/nextly/commit/934cef1fe8534e89c6222e1b0734d21ccd1147af) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Unsaved work gets a recovery point after a slow save. A save slower than the
  autosave debounce let the edit's recording fire while recording was off, where
  it was refused, and nothing asked again; when recording comes back on and the
  editor still holds unsaved changes, a recording is now asked for again.

- [#2359](https://github.com/nextlyhq/nextly/pull/2359) [`ea23a3b`](https://github.com/nextlyhq/nextly/commit/ea23a3b46f007185ffdbc23d04df772a173876f9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A value a unique custom user field already holds for another user is now refused with a conflict (`DUPLICATE`), when creating or updating a user, and a refused update changes nothing: the account's other fields, its roles and its custom fields are written together or not at all. Before, creating such a user took the refusal for a missing table: it created the user without any custom fields and stopped writing custom fields for the rest of the process, and an update logged it and carried on. On MySQL, a unique field of a plugin type stored as text with no `maxLength` is now a `VARCHAR(255)` column carrying its unique index, as a built-in text field is, rather than a TEXT column (which MySQL cannot index without a key length) that stopped `nextly migrate`. A value longer than such a column holds is refused, naming the field, before it is written: before, it failed at the database and was taken for a missing table. An install where that column is already TEXT keeps it, with every value whole: `nextly migrate` stops, naming the field, until the column is changed to `VARCHAR(255)` or `unique` is removed. A plugin type stored as long text or JSON cannot be unique: the config is refused at the field, as a textarea's is, including when the plugin declaring the type is in the same config.

- [#2681](https://github.com/nextlyhq/nextly/pull/2681) [`b26f715`](https://github.com/nextlyhq/nextly/commit/b26f715539d18e513c28923d53771c4a12f43034) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A user's roles and permissions are now read once and kept in memory until a role or permission changes, in place of the separate per-answer caches. Every change that affects access retires what was kept, in every instance sharing the database, so the next request reads afresh: editing a role's permissions, assigning or removing a role, changing role inheritance, deleting a role, deactivating or deleting a user, and a role assignment expiring. A request that asks about a user again reads only the role version, and a request that asks several permissions reads the user's roles once.

  Permission answers are no longer stored in the `user_permission_cache` table, and the `userPermissionCache` schema export is deprecated; the table is removed in a later release. `PERMISSION_CACHE_ENABLED`, `PERMISSION_CACHE_TTL_SECONDS` and `PERMISSION_CACHE_MEMORY_SIZE` no longer change how access is cached, and a warning says so when one is set. `PERMISSION_CACHE_ENABLED=false` still tells Nextly that no instance reads the stored answers, so they are not emptied when access changes.

- [#2429](https://github.com/nextlyhq/nextly/pull/2429) [`7afab03`](https://github.com/nextlyhq/nextly/commit/7afab0353cf4d198f9c439904118904fa57f6ba4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Direct API call made as a user (`overrideAccess: false`), a plugin service call made `as: "user"`, and a page render now each look up the caller's roles and permissions once, however many rows, field rules and permission checks they read. That covers every Direct API method and namespace method, and both collection and Single routes, including the reads their `render` and `buildMetadata` make. A 50-entry list read through the Direct API or a plugin service costs the same access queries as a 1-entry list. A call made inside a request shares that request's lookups.

- [#2420](https://github.com/nextlyhq/nextly/pull/2420) [`fa80fb9`](https://github.com/nextlyhq/nextly/commit/fa80fb930a1663ddd6ba6b109a30351f85fea39f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A request now looks up its caller's roles, permissions and super-admin authority once, however many gates, rules and rows ask about them. A list read whose collection has field-level read rules no longer repeats those lookups for every row it returns; a 50-entry list costs the same access queries as a 1-entry list. Any role or permission change the request makes is seen by its later checks. Work outside a request, such as a job, looks the caller up as before.

- [#2471](https://github.com/nextlyhq/nextly/pull/2471) [`6b5d7e1`](https://github.com/nextlyhq/nextly/commit/6b5d7e14c10499002a7fe6fab1c72a86b3efa668) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every access rule may be `true`, `false` or a function: a collection's `create`, `read`, `update`, `delete`, `publish` and `unpublish`; a Single's `read`, `update`, `publish` and `unpublish`; and a field's `create`, `read` and `update`, in a collection, a Single or a field group. On a collection's or a Single's own fields, a field rule written as `false` now withholds the field from every checked read, and keeps it from being written by a checked write, like a function returning `false`. A checked call is one made with `overrideAccess: false`, as every REST and admin request is. Trusted server code, the Direct API's default `overrideAccess: true`, skips field rules, whether they are written as booleans or as functions.

  **Breaking at startup:** an `access` key that its kind doesn't have now stops an app from starting when the collection, Single or field group is defined with `defineCollection`, `defineSingle` or `defineFieldGroup`, and fails `nextly build`. Entities written as plain objects, and those the Schema Builder stores, are not checked. Before, such a key was accepted in silence and governed nothing: the operation it meant to rule fell back to stored permissions.

  The keys each kind accepts:
  - A collection: `create`, `read`, `update`, `delete`, `publish`, `unpublish`.
  - A Single: `read`, `update`, `publish`, `unpublish`. A Single has no `create` or `delete`, so a Single carrying either now fails.
  - A field, in a collection, a Single or a field group: `create`, `read`, `update`.

  Any other key, such as a misspelt `reed` or a Single's `delete`, is refused when the collection, Single or field group is defined, with `ACCESS_KEY_UNKNOWN` naming the key, where it sits, and the keys that kind accepts. To fix it, remove the key, or correct its spelling if it was meant to be one of the keys above. A field's `access` must also be an object whose rules are functions or booleans; any other value is refused at definition in the same way.

- [#2456](https://github.com/nextlyhq/nextly/pull/2456) [`73498e1`](https://github.com/nextlyhq/nextly/commit/73498e184a7b8511c2d8176b86367d29d0a7bd4f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every access rule is told the languages it judges.

  A collection's, a Single's and a field's rule now get `locale`, the one
  language the operation is in, and `locales`, every language it involves:
  - a read or a write in one language gets that language; a read with an
    unknown or missing `?locale=` is judged as the default it resolves to, and
    a write naming an unknown language is judged as the default and then
    refused with 400; a read's
    `locales` also lists each language a missing value falls back to, in the
    order it tries them; a bulk or transactional create or update writes the
    default language, and gets it; a duplicate gets the default language and
    each it falls back to, since it copies what a read of the source shows;
  - a read that also reads each language's translation state
    (`?translation-status=1`, or a `_translated` filter) gets every configured
    language, keeping its own as `locale`, and so does an autosave, or a
    working-draft discard, naming a language the site does not configure; a
    bulk update by query, whose filter may choose rows by any language, gets
    every configured language too;
  - a read of every translation (`locale=all`), a write to every language
    (`locale=*`), and an operation on the whole entry (a delete, a bulk
    delete, publishing or unpublishing every language, a release)
    get every configured language, with no single `locale`;
  - content a collection or Single stores the same in every language (it is
    not localized and has no localized field group) gets every configured
    language, with no single `locale`, whatever `?locale=` names;
  - a site with no languages gets none.

  So a rule can answer by language, such as
  `update: ({ locales }) => !locales.includes("fr")`, and a rule that limits
  someone to some languages refuses an operation that reaches beyond them.
  Write language rules as restrictions like that one, not as admissions by
  inclusion (`locales.includes("fr")`): where the languages an operation
  involves can't be known exactly, such as an operation that names none or a
  collection built in the admin, the rule is told every configured language,
  which a restriction refuses and an admission would allow. Restrict with
  `locales`, not `locale`: `locale` is absent for an operation on every
  language, and leaves out the languages a read falls back to.

  The REST route gate is told the same languages as the service gate, from the
  request's `?locale=` for an operation on one language's content (a history
  list filtered to one language among them), the default for a bulk write, and
  every language for any other. It reads them from the parameters the request
  is dispatched with, so a language named twice is judged as dispatched.

  A collection preview link names no language, so minting or opening one asks
  the read rule in every language: a collection whose read rule closes any
  language can't mint entry previews until the preview path binds the link's
  language.

  A rule that does not read `locale` or `locales` answers as before. Code that
  builds a rule's context by hand, such as a unit test of a rule, now gives
  `locales` too: `[]` where the site has no languages.

- [#2169](https://github.com/nextlyhq/nextly/pull/2169) [`121d24d`](https://github.com/nextlyhq/nextly/commit/121d24d41d4259cf4f34d603b41163c2bde7e3d0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The PostgreSQL and MySQL adapters can now tell a test harness when a statement
  escapes an open transaction: a query or connection taken from the pool while
  the same flow's transaction already holds its own connection, which runs
  outside that transaction and is kept when it rolls back. Nextly's own
  integration suites fail on such a statement. Nothing changes in a running
  application; with no harness listening, the check is a single property read.

- [#2053](https://github.com/nextlyhq/nextly/pull/2053) [`be9b841`](https://github.com/nextlyhq/nextly/commit/be9b841a592e5c3af967939d1365628648ecdfaf) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The admin's build-mode comment names what its `NODE_ENV` fold decides — the
  error screens' technical-details box, the caught error's message and stack
  trace, stays out of what production users are served — and leaves whether the
  development reload stream opens to the running server's answer. The
  route-table comment keeps the rule and the runtime answers without the record
  of what an older published bundle did. The settings-sync component's
  explanation of its sibling shape is stated once, on the component, where the
  layout points at it, and the component's file is named after what it exports.

- [#2667](https://github.com/nextlyhq/nextly/pull/2667) [`8081dde`](https://github.com/nextlyhq/nextly/commit/8081ddeae66019d3a78d08285983a106d044295e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin` builds its declarations with oxc, from the type annotations in its own source. Its published types and JavaScript are unchanged.

- [#2651](https://github.com/nextlyhq/nextly/pull/2651) [`0ab320c`](https://github.com/nextlyhq/nextly/commit/0ab320ca3ec011a1e1a7496fc24de27ba845738c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin`'s feature components declare their own types: each export states what it returns and accepts, so its published declarations no longer depend on inference. What the components render and accept is unchanged.

- [#2688](https://github.com/nextlyhq/nextly/pull/2688) [`57c99aa`](https://github.com/nextlyhq/nextly/commit/57c99aaa176af1313475751d16fdea448c5dbf9f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard a new reader is given is now the agreed one: Needs attention, Create, Recently edited, Recent activity, Content, Upcoming releases and Team, in that order, each at its agreed width and offered only within its agreed widths.
  - **Each card only when it has something to show.** Create needs a collection the reader may create in; Needs attention needs something it counts that the reader may read; Upcoming releases needs a release the reader may read; Content needs a collection or a Single the reader may see. Four new widget conditions say so: `create:available`, `attention:readable`, `releases:present` and `content:present`. Each condition's reads happen at most once per request.
  - **One Content card, `core/content`,** lists both collections (with their entries and drafts) and Singles. It replaces the Collections and Singles cards. A saved Collections, Singles or per-Single card becomes Content, at the first one's place, and the per-Single cards are no longer offered.
  - **`system:content` answers Singles too,** after the collections, each row saying its `kind`.
  - **Saved dashboards convert** through one retirement map, which now also covers ids minted per Single (`single/<slug>-status`).
  - **New, `@experimental`:** `ReleasesService.anyReadable`, whether a release exists that a caller may read, one row read through the list's own rules.

- [#2486](https://github.com/nextlyhq/nextly/pull/2486) [`19a3503`](https://github.com/nextlyhq/nextly/commit/19a350331b7187a4d7e54b44ff62165ddee96803) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An access check whose role or permission read fails now refuses, instead of judging the caller as holding no roles or permissions.
  - **Code-defined access rules** (collection and Single `access`, and field-level `access`) are handed the caller's roles and permissions. When those could not be read, a rule was handed empty lists. It is now not run: the request is refused with `DATABASE_BUSY` (503, retryable) when the read waited out `pool.connectionTimeoutMs`, and an internal error otherwise. A field rule whose caller's grants cannot be read is denied.
  - **`listRoleSlugsForUser` and `listEffectiveGrants`** throw a `NextlyError` when the read fails, where they returned an empty list. A caller with no roles or permissions still gets an empty list.

- [#2729](https://github.com/nextlyhq/nextly/pull/2729) [`15256dc`](https://github.com/nextlyhq/nextly/commit/15256dcd74685c63da46dfca52968726ce2bed4e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A request with an API key on a server that has just started no longer answers 503; it waits for Nextly to start, as a signed-in request does.

- [#2425](https://github.com/nextlyhq/nextly/pull/2425) [`39d7239`](https://github.com/nextlyhq/nextly/commit/39d72393bc3e2d6f36359c6f6b4c5aab24c1138d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Saving an entry or a Single in the admin keeps a related item or upload inside a field group or a dynamic zone that the editor may not read, or that no longer exists. The editor sees it as a "Restricted or missing item" with its id, which can be removed but not opened, as at the top level; before, a save removed such links. A read at `depth=0` now returns a to-many relationship inside a field group as an array of ids, as for every other field, rather than as its stored JSON text when the field's name is camelCase.

- [#2389](https://github.com/nextlyhq/nextly/pull/2389) [`608e1f0`](https://github.com/nextlyhq/nextly/commit/608e1f003a8661b28de2582aa3f3132890744824) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Saving an entry or a Single in the admin keeps a related item or upload the editor may not read, or one that no longer exists. The edit page shows it as a "Restricted or missing item" with its id, which can be removed but not opened; before, a save removed such links. Populated reads are unchanged.

- [#2556](https://github.com/nextlyhq/nextly/pull/2556) [`ebec922`](https://github.com/nextlyhq/nextly/commit/ebec922f4d318ea887d4127812874b81fc817419) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Code and plugins can now queue an email (`@experimental`):
  `nextly.email.queue` and `queueWithTemplate`, and the same two on a plugin's
  `ctx.services.email`, take every option `send` and `sendWithTemplate` take.
  A queued email is stored, sent right away, and retried through the job queue
  when the provider fails temporarily, with backoff for up to about three hours
  (15 attempts); a failure that is not temporary fails it at once. Every attempt
  sends with the caller's `idempotencyKey`, or with a key of the queued email's
  own, so a retry after a lost response is not delivered twice where the provider
  takes a key. A template is rendered at each attempt.

  A plugin can pass its transaction as `tx`: the email is then stored in that
  transaction, exists only if it commits, and is attempted once it has. An email
  stored but never attempted, because the process stopped, is sent the next time
  the jobs trigger (`/api/jobs/run`) runs, and the server log warns at startup
  and on each queued send when a queued email is more than 15 minutes past due
  because the trigger isn't running.

  The message is held in a new `email_queue` table, sealed under `NEXTLY_SECRET`;
  the job carries only its id. `nextly migrate` and boot add the table on all
  three databases. Sends that are not queued are unchanged.

- [#2102](https://github.com/nextlyhq/nextly/pull/2102) [`4ab4263`](https://github.com/nextlyhq/nextly/commit/4ab4263de5def601bd949f75f11f04451b44bd88) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An email sent to several `to` addresses now reaches every one of them, through
  `nextly.email` and a plugin's `ctx.services.email`;
  before, only the first address received it. `from` and a new `replyTo` take
  effect on every way of sending.

- [#2353](https://github.com/nextlyhq/nextly/pull/2353) [`c271a3f`](https://github.com/nextlyhq/nextly/commit/c271a3f91ebde9ea9df03aa35abc8cae8bb28141) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Sign-in and the other auth routes, for a client whose address cannot be resolved, now count a request body larger than the limiter reads among the bodies being read until its handler has finished with it. The limiter stops reading such a body early and the handler reads the rest, which the client could hold open, so these bodies escaped the bound on how many are read at once. A request the limit refuses still gives its place back at once.

- [#2355](https://github.com/nextlyhq/nextly/pull/2355) [`4a357ed`](https://github.com/nextlyhq/nextly/commit/4a357ed62671a9b04cf2702d54ff8be5664df45f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly plugins install` and `nextly plugins uninstall` wait for the event
  handlers a plugin's `onInstall` or `onUninstall` set off, and now for the
  follow-up events those handlers emit in turn, before shutting the runtime
  down. A producer a plugin started in `init()` is not waited for, so it never
  holds the command open.

  When that work is still running after 30 seconds, the command now stops
  instead of carrying on. An uninstall stops before any DOWN migration drops the
  plugin's tables, which that work may still be reading, and the plugin stays
  `uninstalling`, so running the command again finishes it. Before, it warned
  and dropped the tables anyway.

- [#2338](https://github.com/nextlyhq/nextly/pull/2338) [`07211e7`](https://github.com/nextlyhq/nextly/commit/07211e7ffc16cdf79c8c9025b65ea8deac803de7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly plugins install` and `nextly plugins uninstall` now let the event
  handlers a plugin's `onInstall` or `onUninstall` set off finish before they
  shut the runtime down. Emitting an event doesn't wait for its handlers, so
  another plugin's handler (removing what it kept about each account an
  uninstall reports deleted, for instance) could be stopped part way. The
  uninstall's DOWN migrations then dropped the tables that handler was still
  working through, leaving its cleanup unfinished.

- [#2636](https://github.com/nextlyhq/nextly/pull/2636) [`3c65a6f`](https://github.com/nextlyhq/nextly/commit/3c65a6f17409dd4689a696e66fa34b4aa9bd642c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/blocks-engine` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2638](https://github.com/nextlyhq/nextly/pull/2638) [`c56257a`](https://github.com/nextlyhq/nextly/commit/c56257a0d8c05b0e0c6e9230c605b40b40e66d4b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/blocks-react` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2662](https://github.com/nextlyhq/nextly/pull/2662) [`71aadd1`](https://github.com/nextlyhq/nextly/commit/71aadd171b1e8da7c0675a792250545355127ac1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A tenant's brand colours no longer make a dashboard chart unreadable. Where branding sets the chart colours, the admin checks each against the card, a bar's track and the tooltip, in light and in dark, and moves the lightness of one below 3:1 until it reads, keeping the brand's hue and never refusing it. The chart colours are now written per mode. `@nextlyhq/ui/color` gains `readableOn` (`@experimental`), the adjustment itself, with the target ratio as a parameter.

- [#2676](https://github.com/nextlyhq/nextly/pull/2676) [`9b73b41`](https://github.com/nextlyhq/nextly/commit/9b73b41f19751dce06a4c35475b5e9479f8d3ca7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The adjusted brand chart colours now reach the chart. The server-rendered branding stylesheet sits later on the page and wrote the unadjusted colours at the same specificity, so it won; the admin's per-mode chart rules now outrank it. The content status widget draws its Published segment and dot in the brand's chart slot, held to 3:1 on the card, rather than in the brand's primary as given.

- [#2604](https://github.com/nextlyhq/nextly/pull/2604) [`f7652e0`](https://github.com/nextlyhq/nextly/commit/f7652e025ea2e6d15ec48ccf11e6411a2de063f1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/admin`, `@nextlyhq/ui` and `@nextlyhq/builder` build with tsdown, which completes the move from tsup. What they publish is unchanged: the same entry points, exports conditions and declarations. The plugin template that `create-nextly-app` scaffolds now builds with tsdown too, through a `tsdown.config.ts` in place of the tsup config. A plugin project now declares `engines.node` as `^22.18.0 || ^24.11.0 || >=26.0.0`, where both tsdown and Vitest run, and `create-nextly-app --template plugin` refuses to scaffold on an older Node, with a message naming the floor.

- [#2627](https://github.com/nextlyhq/nextly/pull/2627) [`f0e0e52`](https://github.com/nextlyhq/nextly/commit/f0e0e52c56f12f1a77171246be490151b7082cae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/builder` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2334](https://github.com/nextlyhq/nextly/pull/2334) [`85a2094`](https://github.com/nextlyhq/nextly/commit/85a20949d94cebddfd83978a574e18963a0e3b3f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A translated field named with capitals in a Schema Builder collection (`subTitle`) takes writes in every language straight after the collection is created or the field is added. The Builder stores field names lowercased, and the database's columns are named from the stored name, but the tables the running process reads and writes through were built from the name as typed, so every write in a language other than the default one failed with an unknown column until a restart. They are now built from the stored names, as a restart builds them. Nothing stored was wrong, so existing installs need no change.

- [#2564](https://github.com/nextlyhq/nextly/pull/2564) [`a477920`](https://github.com/nextlyhq/nextly/commit/a47792062aa683cbe6ed7fdf0578fca38b011804) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Reading an entry or a page of entries now makes fewer round trips to the database. A read looked up its collection's registry row several times, each a query of its own. The row is now read once and reused for up to a second, so a read of one entry sends 4 statements instead of 11, and a page of entries 5 instead of 13. That is a few milliseconds off every read on PostgreSQL and MySQL.

  Reads return exactly what they did before. A change to a collection made in this process is seen at once. Changes to a collection made elsewhere (another instance, `nextly migrate`, a direct database write) reach every instance within a second. A read inside a transaction always goes to the database.

- [#2626](https://github.com/nextlyhq/nextly/pull/2626) [`f87bbaf`](https://github.com/nextlyhq/nextly/commit/f87bbaffbac9d73be96daccf32d1ea4cf2d60ac2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Nextly does not support Next.js Cache Components yet, so it keeps it off. `create-next-app` 16.4 turns Cache Components on by default (`cacheComponents: true` with `partialPrefetching: true`).
  - A project `create-nextly-app` creates sets `cacheComponents: false` in its `next.config`, with a comment saying why.
  - When `create-nextly-app` adds Nextly to an existing app, it turns Cache Components off in that app's config and removes `partialPrefetching`, which Next.js accepts only with Cache Components on. Its report says what it changed and why. A setting it cannot read safely is left as it was, with what to change by hand.
  - `withNextly()` and Nextly's start print a warning when Cache Components is on, with how to turn it off. They don't refuse: an app with it on is untested with Nextly, not known to be broken. The start check reads the setting from the app's `instrumentation.ts`, which now passes `cacheComponents: process.env.__NEXT_CACHE_COMPONENTS` to `createRegister`; `createRegister` takes it as an optional second argument.

  Why, and the plan to support Cache Components before Next.js 17: https://nextlyhq.com/docs/getting-started/installation#cache-components

- [#2545](https://github.com/nextlyhq/nextly/pull/2545) [`6fe78db`](https://github.com/nextlyhq/nextly/commit/6fe78db7cd987c0a0a068869f4e65b8819b9b259) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin route's `ctx.caller.can()`, the held permission that decides a dashboard widget's `requiredPermission` and a document lock's release, and the schema builder's collection list now ask the one access decision. Every answer they give is unchanged: where one still answers differently from the decision, it keeps its answer through a named difference, so a later change can remove each one on its own.

  The schema builder's collection list now reads the caller's access once for the whole list, rather than once for each collection.

- [#2483](https://github.com/nextlyhq/nextly/pull/2483) [`3e60c59`](https://github.com/nextlyhq/nextly/commit/3e60c595b6878e6762a014952c73b6e959b8b258) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A card's quick setting (a `select` or `checkbox` its widget marks `quick`) is drawn in its header and offered in a new card menu at rest, and a change there is saved at once for the reader. Only that card is asked again, and the change is announced once the card shows it. Settings saved outside customise mode are now kept for a reader who has never arranged their dashboard, who goes on following the default. Changing one card's settings no longer reloads every card on the dashboard.

- [#2434](https://github.com/nextlyhq/nextly/pull/2434) [`17ac818`](https://github.com/nextlyhq/nextly/commit/17ac8187d0f3b71ec5d74a45239f86ab69636dc6) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card's settings sheet can now draw Collection, Filter, Sort and Group by settings, offering only the collections and fields the reader may read, for widgets whose card query is built from them. Registered widgets cannot declare these settings yet: a registered widget's query applies only `limit`, so registration refuses them, as before. A stored choice the reader can no longer make opens at its default, with a line saying so, and "Reset to defaults" leaves a card's Collection as it is. A widget may mark one setting as quick; the mark is validated now, and the card header that shows it comes later. The workspace payload gains `widgetSources`, and widget source fields gain an optional `groupable: false` mark. New experimental type exports on `nextly/config`: `AnyWidgetSetting`, `ContentSetting` and `PublishedContentSource`.

- [#2478](https://github.com/nextlyhq/nextly/pull/2478) [`04fd52f`](https://github.com/nextlyhq/nextly/commit/04fd52f8e04aa4df65307e937931569623dee2bf) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard chart is reachable by keyboard and pointer. It takes one tab stop; the arrow keys move through its bars or intervals, a polite live region reads the current point, and a tooltip shows it. Escape dismisses the tooltip wherever focus is, and a tooltip stays while the pointer is over it.

- [#2455](https://github.com/nextlyhq/nextly/pull/2455) [`0bae677`](https://github.com/nextlyhq/nextly/commit/0bae677b51ca396cfe844c89cbd351191e0e425d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The collection access gate now asks the one access decision, keeping every answer it gives today. Where today's gate still differs from that decision, a named deviation keeps today's answer, so nothing a caller is allowed or refused changes.

- [#2656](https://github.com/nextlyhq/nextly/pull/2656) [`2347689`](https://github.com/nextlyhq/nextly/commit/234768906066d12310820cb128960771a6fd8ad3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-commerce` and `@nextlyhq/plugin-accounts` build their declarations with oxc under `isolatedDeclarations`, from the type annotations in their own source. Their published types and JavaScript are unchanged. `nextly migrate:create --plugin` now writes the migrations index with its type stated (`PluginMigration[]`), so a plugin built the same way can publish it.

- [#2405](https://github.com/nextlyhq/nextly/pull/2405) [`5f9ee97`](https://github.com/nextlyhq/nextly/commit/5f9ee9760dbf9af6180fb6bb492b74f5ca606df0) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A component's many-to-many now reads back as the list of ids it was saved with on every dialect. Before, PostgreSQL returned the list as a string, SQLite returned it as an undecoded JSON string, and MySQL refused a save of more than one id. The column is now the JSON list column a `hasMany` relationship uses (`jsonb` on PostgreSQL, `json` on MySQL, `text` on SQLite), on every route that creates a component table. A single stored id reads as a one-item list.

  Existing installs: a PostgreSQL component table holding the many-to-many as `uuid` or `text`, or a MySQL one holding it as `varchar(36)`, is offered a one-time conversion to the JSON list column on its next schema apply, and `migrate:create` writes the same conversion into a migration file. Every stored id is kept: a bare id becomes a one-item list, a PostgreSQL array literal becomes the list it holds, and a JSON list stays as it is. On PostgreSQL a value that cannot be read (a malformed array literal) refuses the conversion before anything changes. A generated DOWN reads each list back as its id, and refuses a row holding more than one id rather than drop any. Until the conversion is accepted, saves to such a column may be refused. SQLite needs no conversion.

- [#2166](https://github.com/nextlyhq/nextly/pull/2166) [`314a592`](https://github.com/nextlyhq/nextly/commit/314a592648b8f60f53c6ae5ce58e3ba7b5023803) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A component's many-to-many column is text on PostgreSQL on every creation route, so the schema planner proposes no type change between them.

  Compatibility: a Postgres component table already created with uuid gets a one-time uuid-to-text change on its next preview. Converting existing data is a follow-up for Mobeen; this release does not convert it.

- [#2506](https://github.com/nextlyhq/nextly/pull/2506) [`65ecd20`](https://github.com/nextlyhq/nextly/commit/65ecd204302f6ee6a68ccc3345b5edf8d20bccc1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component held in a group or repeater of another component is now validated against its own fields on every write, its own `validate` included; until now nothing judged it, so existing content that fails it is refused on its next save or publish.
  A component placed directly in another component's fields is not stored where the outer component is stored on its own (at the top level of a collection or Single, or under rows, tabs, collapsibles or an unnamed group), and since alpha.67 a value for it there was dropped without a word. Where the outer component is held in a named group or a repeater, its whole value, the directly placed component included, is stored there and validated. Where it is not stored, now:
  - the admin no longer shows such a field in its forms;
  - a write that carries a value for one is refused with `NOT_STORED` (only an empty value, `null`, `{}` or `[]`, passes);
  - `defineConfig` warns about each such field;
  - the Schema Builder no longer offers one there, and names any an existing field group holds.
    Put such a component in a group or repeater instead, where it's stored and validated.

- [#2388](https://github.com/nextlyhq/nextly/pull/2388) [`cc30a93`](https://github.com/nextlyhq/nextly/commit/cc30a93e2fe4b39c90ce81434804ee269600e29e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test, more of what Nextly writes to the console is masked of email addresses: post-commit hook failures and rejected forgot-password redirects (now written through `consoleLogger`, so with its `[WARN]`/`[ERROR]` prefix), failed user searches, and the default auth and database loggers. Addresses written with combining marks (Devanagari, for example) and punycode labels in upper case are masked too.

- [#2669](https://github.com/nextlyhq/nextly/pull/2669) [`2ed4941`](https://github.com/nextlyhq/nextly/commit/2ed49414abf78ce3d1d3edb54fd9b69cafc9350f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Content card counts only the collections it shows, and shows every collection it counts.
  - `system:content` takes the page of collections first, in slug order, and counts only that page, so an install with many collections no longer counts every one of them on each dashboard load to show fifty.
  - The card draws every collection in the answer: those the navigation lists in its order, then any it does not. Past a hundred collections the two lists cover different collections, and a counted one used to be dropped.

- [#2713](https://github.com/nextlyhq/nextly/pull/2713) [`8266c7e`](https://github.com/nextlyhq/nextly/commit/8266c7ed1aee084b253171d21759783f92baea0b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Count card in the add panel, and content widgets that ask only what they draw.
  - **The add panel's Content group is shown.** It lists Count once for each collection the reader may read, and its rows carry the widget's category, so a search by category finds them.
  - **A card set to a collection names it** in its title ("Count: Posts"), and Count names it in its number's accessible name, so two cards for different collections can be told apart.
  - **Count's Retry** asks a failed card again.
  - **A custom card's cells:**
    - A cell may declare `drawnFrom`, the narrowest tier that draws it. The admin asks only the cells a card's tier draws, and asks the rest when the card widens.
    - A cell's `when` is judged by the collection that cell reads once the settings apply.
    - Each cell is keyed by its declared query, so changing one card's settings asks that card again alone.
    - The settings preview asks the cells under the sheet's values.
  - **A component's settings are the ones its query was asked with.** A stored Filter, Sort or Group by that the query set aside is not handed on. `effectiveWidgetSettings` gives that reading, and `KnobField` is exported beside `KnobContext`.
  - **Registration refuses:**
    - a custom card declaring both a query and cells;
    - a widget offered per collection with no Collection setting;
    - an `offered` value outside its closed list (`"per-collection"`, `"on-request"`);
    - a content setting that no cell's source lets a knob drive.
  - **A timeseries with `until`** draws its intervals up to that boundary, where its rows end.
  - **Whether a caller has a release to read** is asked once per batch, not once per collection.

  All of it is `@experimental` while the content widgets are built.

- [#2722](https://github.com/nextlyhq/nextly/pull/2722) [`fecf9b4`](https://github.com/nextlyhq/nextly/commit/fecf9b407955a200c25f19a451c8d2e55e371519) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A contributed widget's text setting is now held to its `maxLength` when the dashboard layout is saved. Before, only widgets in the registry were checked, so a direct layout write could store text of any length on a widget a plugin contributed through its manifest. The settings sheet already refused it. The bound now comes from either channel, and where a registration and a contribution share an id it follows the admin's rule: the registration's settings wherever it states any, else the contribution's.

- [#2378](https://github.com/nextlyhq/nextly/pull/2378) [`6daef10`](https://github.com/nextlyhq/nextly/commit/6daef102908020fce0a160a98ecc6ede37128f7c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Core's welcome, password-reset and email-verification emails now name the staff user on their delivery records, so deleting the user can erase them under any address. `person` on `nextly.email.send`, `sendWithTemplate` and a plugin's `ctx.services.email` accepts a staff user as `{ kind: "staff", id }` (experimental).

- [#2358](https://github.com/nextlyhq/nextly/pull/2358) [`a167d97`](https://github.com/nextlyhq/nextly/commit/a167d97d3f2bab21e920818c36ea903372d44c15) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Core's own rate limits now count in the limit store the site selected with
  `rateLimit.store`: the sign-in limit, the limits plugin routes ask for, the REST
  API limit and each API key's limit. On `"database"`, every instance of the site
  counts one budget, where each used to count its own.
  - **Keys are stored only as keyed hashes in the selected store.** Client
    addresses, account ids and API key ids no longer reach the memory store, the
    database store or an app's `LimitStore` as given. An app's store of the
    earlier `RateLimitStore` contract still receives them as before.
  - **Counts roll in 32 buckets per window.** An attempt counts for one window
    from when it was made, and can be forgotten up to 1/32 of the window early.
    The sign-in limit used to slide exactly, and the REST limit reset its whole
    window at once.
  - **An app's store of the earlier `RateLimitStore` contract keeps serving
    core's own limits**, as before.

  **A store outage after a good start now refuses core's sign-in requests**
  (`503`, "Please try again shortly."), on core's `/auth/*` endpoints and on plugin
  routes with `rateLimit: "auth"`, while the REST API, API key and other plugin
  route limits let requests through. A store call that takes more than 2 seconds
  counts as an outage, and a call that never settles stops holding a place after
  20 seconds, so once the store answers again its limits count again without a
  restart. Each outage is logged once when it begins and once when the store
  answers again. Before, a store failure failed the request. With an
  app's own store, an outage stops staff sign-in until the store answers, so
  monitor that store.

  **Existing installs see one new production warning**, until they select the
  database store (`rateLimit.store: "database"`) or say they run one instance
  (`rateLimit.singleInstance: true`). With only a store of the earlier contract,
  the warning says that plugin limits count in memory.

  The memory store holds at most 100,000 live entries (`rateLimit.maxEntries`).
  When it is full and nothing has expired, a new key is answered as
  unavailable, so a sign-in from a new address is refused and an API request is
  let through.

- [#2692](https://github.com/nextlyhq/nextly/pull/2692) [`2a41378`](https://github.com/nextlyhq/nextly/commit/2a41378438ea02d32f85072d0c65fb418df4875b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Count card, and the content settings that let one widget read the collection each card is set to.
  - **Count** (`core/count`) states how many entries a collection holds. From medium width it adds the published and draft split, and what scheduled releases will publish; at large width, the last 30 days against the 30 before. Each part links to the list that holds exactly it.
  - **Offered per collection:** a widget may declare `offered: "per-collection"`. It is then never placed on the default dashboard, and any number of its cards may be placed, each starting with its collection.
  - **Its query may name no source** when a Collection setting supplies one. A custom card may declare several keyed reads (`cells`), each answered on its own, and handed to its component as `cells`.
  - **Content settings reach the card's query:** Filter (joined with any condition the widget declares), Sort, Group by and a Date range (`since`), each on a collection source. A stored Filter, Sort or Group by naming a field the reader may no longer use is asked with its default instead.
  - **Widget queries** take `since` and `until` (spans from a closed list, measured in whole UTC days or months from the batch's one instant). On a collection source, they take the entry list's workflow conditions `_pendingChange` and `_inRelease` at the top level. A release condition is answered "not available" for a reader with no release to read.

  All of it is `@experimental` while the content widgets are built.

- [#2640](https://github.com/nextlyhq/nextly/pull/2640) [`faa31d0`](https://github.com/nextlyhq/nextly/commit/faa31d0ed53ccd22363a8fe2485efa8b413fad79) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `create-nextly-app` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2438](https://github.com/nextlyhq/nextly/pull/2438) [`aa707be`](https://github.com/nextlyhq/nextly/commit/aa707be11d4809934155d0268a1856a1f1dde0f4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Add widget now opens a panel beside the dashboard. It lists every widget you may add in core's groups (Overview, Team, Plugins), with the cards you removed first so they can be put back where they were. You can search it by name, description, category, group or plugin (a removed card by its name or by its Removed section's text), and add several cards in one visit: each new card goes to the end of the dashboard and is ringed so you can see where it landed. A one-card widget already placed shows as on the dashboard. At the card limit, adding is turned off and putting a removed card back still works. The panel announces search counts and each card it adds. When it closes, focus goes to the last card added, or back to Add widget.

  The layout read now gives each widget the panel offers a `rank`, its place in that order, so the panel can list a placed widget where it would be offered.

- [#2528](https://github.com/nextlyhq/nextly/pull/2528) [`e0f9d63`](https://github.com/nextlyhq/nextly/commit/e0f9d630aa4fb3c9f7c225e308299eadc1801117) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard cards now arrive one at a time. A card whose data is slow, or fails, no longer holds back the cards that read other sources.
  - `POST /api/dashboard/query` streams its answer when the request sends `Accept: application/x-ndjson`: one `{"index", "slot"}` line per card, written as each settles. Cards one source answers with a single shared call arrive together, as that call ends. Each line is the slot exactly as the JSON answer holds it, with its dates formatted the same way. A request without that header gets the same JSON answer as before. Both responses now send `Vary: Accept`. Anything that fails the whole batch (authentication, the body, the caller) still answers with the usual error before the stream starts. If the reader leaves mid-stream, the cards still running are told to stop through their signal.
  - The admin dashboard asks for the stream and draws each card as its slot arrives. A refresh keeps each card's numbers until its new answer lands, and only the cards still waiting show as loading.
  - The "is there content" check behind the `content:empty` condition and the onboarding "first entry" step now counts at most 8 collections at once and stops at the first one with an entry. It has a 5-second budget. When the budget runs out it answers "unknown", which is never read as empty: the empty-install cards are not offered, and the first-entry step stays open. Counts already running when it stops cannot be cancelled; they finish and are ignored.

- [#2301](https://github.com/nextlyhq/nextly/pull/2301) [`eba8f00`](https://github.com/nextlyhq/nextly/commit/eba8f009d577d652c8abe44861405b9eed5c77f7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard card lays itself out by its own width, small, medium or large, never by the
  window's. A card below 340 px is small and from 700 px large, and the dashboard predicts each
  card's tier from its own width and the card's span before the first query, so each card asks
  only for what its tier draws.
  - A list or table card draws three rows, titles only, when small; its number of items with a
    line of detail when medium; and a table with a heading per column when large. When its answer
    holds more rows than it draws, it says "More exist", and for a list from one collection that
    is a link to the collection's list view with the card's filter and sort.
  - A breakdown draws its 3, 5 or 8 largest groups and says how many more there are, or that more
    exist when the answer itself was cut short.
  - An over-time card shows the latest value and the total over its range when small, dates its
    line's two ends when medium, and adds dates between them when large.
  - The Create card offers 2, 3 or 6 shortcuts and the rest in a More menu; the Team card shows
    the number of people alone when small; the Collections and Singles tiles take as many columns
    as the card fits.
  - A card whose width grows into a tier that draws more asks again on its own; a card that
    shrinks asks nothing. Nothing in a card is clipped and nothing scrolls inside it.
  - The entry list honours a `sort` in its address for a column its sort menu can order by.

- [#2367](https://github.com/nextlyhq/nextly/pull/2367) [`e7887fc`](https://github.com/nextlyhq/nextly/commit/e7887fcfa433361bc2b16f2545c8458defbdc5c3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard charts show their values and colour their groups. A chart over time labels its value axis at zero and its highest value on medium and large cards, circles its latest point at every size and labels its value from medium up, and names several series in a legend. A chart of groups orders its groups by count, ties by label in the admin's locale, before a card's size cuts them, and colours each bar by its group's value, so a status is the same colour on every card. Each chart's text alternative states its range, total, latest and highest values, or its groups, total and the group with the most, saying when counts are lower bounds. The light theme's third chart colour is a step darker, so every chart colour holds 3:1 on a bar's track and on a tooltip as well as on the card.

- [#2696](https://github.com/nextlyhq/nextly/pull/2696) [`e586815`](https://github.com/nextlyhq/nextly/commit/e586815a6bbc701e25ee7b41d5f0fbb696fb9558) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Needs attention and Create cards are offered exactly when they would have something to show, and the Content card's rows always say what they are.
  - **Needs attention** is offered on content it could count: a collection or Single with a published source, or releases. A reader whose only collection is mid-migration, and who may not read releases, is no longer given a card that can only say "not available".
  - **Create** is offered only when it would offer a collection: one the reader may create in that does not turn creating off (`admin.disableCreate`, as form submissions do). A site whose only writable collection is form submissions no longer gets an empty Create card.
  - **`system:content`** keeps each row's `kind` whatever a query selects, so a collection and a Single that share a slug always stay apart.

- [#2508](https://github.com/nextlyhq/nextly/pull/2508) [`f3dd57c`](https://github.com/nextlyhq/nextly/commit/f3dd57c8d5ec8ccf160f9541c26a1d4546d3924b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - On the dashboard, a keyboard drag cut short when the dashboard narrows to one column now leaves focus on that card's menu, where the move goes on, instead of on the page. Resetting the dashboard to its default also clears the outline on the card placed last, so a card the default reuses no longer looks freshly placed.

- [#2480](https://github.com/nextlyhq/nextly/pull/2480) [`ddc8279`](https://github.com/nextlyhq/nextly/commit/ddc82790509b6a9f6ce98d9f9f1a7e0562204e9e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Dashboard cards are now dragged by their handle with a drop line, and the dashboard can be customized on phones. While a card is held, the other cards stay where they are, the held card dims, and a line shows where it will land: beside the card it will follow, or across the dashboard where it will start a row. The order changes once, on release. The keyboard works the same way: Space or Enter picks a card up, the arrow keys move it one place at a time, Space or Enter puts it down, and Escape cancels. Each step is announced, and so is the move with both positions. A moved, resized, added or restored card is outlined until the next change, and without animation for anyone who asks for reduced motion. Customize is now offered at every width. Where the dashboard shows one column, the handles are hidden and the card menu moves, resizes and removes cards, and the bar fits a phone. A drag in progress when the dashboard narrows to one column is cancelled, and says so.

  In the add panel, a removed card is found by its widget's description, category, group and plugin, as the widget's own row is, and each visit to the panel starts with nothing announced from the last one.

- [#2700](https://github.com/nextlyhq/nextly/pull/2700) [`0962243`](https://github.com/nextlyhq/nextly/commit/09622434a9c0acae1c672b50f1261af9688eb4b2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A reader can put a Note on their dashboard: Markdown of their own, private to their layout, drawn read-only with no HTML and links held to http, https and mailto. Widget settings gain an experimental `textarea` type with a `maxLength` counted in characters (code points) by one counter, `textLength` on `nextly/config`, used by the settings sheet and the layout write alike. `offered` gains an experimental `"on-request"`: a card added from the add panel only, never placed by default. A dashboard over its size limit is told "This dashboard is full: remove a card or shorten a Note".

- [#2472](https://github.com/nextlyhq/nextly/pull/2472) [`ee72728`](https://github.com/nextlyhq/nextly/commit/ee72728b45efb2d250095ff295891fc741d59b23) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The "database busy" code core reads is now held in core, so the error module reached from every client-safe entry no longer imports the database adapter, and the admin's browser bundle no longer reaches a database package. The code is unchanged, and a test holds it equal to the adapters'.

- [#2598](https://github.com/nextlyhq/nextly/pull/2598) [`bc33333`](https://github.com/nextlyhq/nextly/commit/bc333335bd1cccf149305ee89e8bda2775db82db) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Filtering by a date works on SQLite. A filter on `createdAt`, `updatedAt` or a date field of the collection itself with an ISO 8601 value used to answer 500 on SQLite, the admin's Created and Updated filters on every list among them. It now narrows the list and its count, as it does on PostgreSQL and MySQL. A bound with a fraction of a second is compared exactly on SQLite, which used to floor it to the second. On PostgreSQL, an instant written with an offset other than `Z` is compared as the instant it names, where its offset used to be dropped.

  A date is compared with an instant with its offset (`2026-09-01T09:00:00Z`) or a calendar date (`2026-09-01`, the start of that day in UTC), read the same way on every database. Any other value, including a time with no offset, is now refused with a 400 validation error (`FILTER_INVALID_OPERAND` in its field errors) on every database, where PostgreSQL and MySQL used to pass it to the database to interpret.

- [#2536](https://github.com/nextlyhq/nextly/pull/2536) [`4735e39`](https://github.com/nextlyhq/nextly/commit/4735e39396103dc3ffd3b909db160764cd4b404a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Experimental: a workflow definition can now be declared in code and attached to collections and Singles. This release only declares, validates, registers and types a definition. Nothing enforces it yet: content is not tracked through stages, no step can be taken, and publishing works exactly as before.

  `defineWorkflow`, from `nextly/config` or `nextly`, declares:
  - stages, one or more of them allowing publishing, but never the first, nor one the system moves content to without an approval;
  - steps between stages, of kind `submit`, `approve`, `request-changes` or `move`;
  - settings kept for later use: what an edit to approved content does, where the next draft starts, where removed stages go and whether approvals stand.

  `reviewWorkflow()` is a ready-made Drafting → In review → Approved definition. Each definition is checked when declared. An error names its place and the known names, for example ``steps[1].to: `aproved` is not a stage. Known stages: drafting, inReview, approved.``. A misspelt stage in a step fails to compile.

  The `workflow` option on a collection or Single attaches a definition. It needs `status: true` and drafts enabled. An attachment that cannot keep a draft beside the live version is refused at boot, before anything is written, on hot reload, and in `nextly build` and `generate:types`. The refusal says which condition is missing.

  Each attached workflow is registered with:
  - a definition hash: sha256 of its structure, which labels and attachments don't change;
  - the path of its `nextly.config.ts`.

  `generate:types` and `nextly build` add a `<Name>WorkflowStage` and `<Name>WorkflowStep` union for each attached collection and Single, and a `workflows` entry in `Config`.

  An internal, never-exported `defineWorkflow` for content states in `lib/content-states` is renamed `defineContentStates`.

- [#2300](https://github.com/nextlyhq/nextly/pull/2300) [`f5b1fff`](https://github.com/nextlyhq/nextly/commit/f5b1fff7a6bd2cf91b134580dfc869c0c6ae6ff2) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Deleting a media item now removes every file stored for it: the original, the thumbnail made at upload, and every image size, on local disk, S3, Vercel Blob and UploadThing.

  **Privacy note.** Until this release, deleting a media item left its upload-time thumbnail stored, on local disk under `public/uploads` and on S3 and Vercel Blob, where it stayed publicly reachable at its old URL. (UploadThing was not affected.) To find those thumbnails, run `npx nextly media orphans`: it lists them by stored path and changes nothing, and you remove them by hand from the folder, bucket or dashboard they are in. Run it again with `--apply` to have it remove the ones whose place shows they are media's: it asks about each batch of files just before removing it, keeps any an item has come to refer to, and stops if it cannot check. On S3 it matches keys as written, so `/media/...` or `media//...` keys are never taken for `media/...` ones. Run it from the project's own directory to remove files: with `--cwd` naming another project, `--apply` refuses, since the database settings were read before it. It lists a file as left behind only under a `prefix` the media collection has to itself, one no other collection on any storage shares, contains, sits inside or begins. Without one, as by default, another collection or upload can store a file of the same form in the same place, so it lists what it finds there as files nothing shows are media's, and names any collection that shares media's place: check those with more care. The command looks only under media's prefix as it is now set, so run it before you give media a prefix: the thumbnails earlier deletes left stay where they were, outside it. It looks only at the storage the media collection uses now. If your site used another adapter, bucket or folder before, point the media storage at that one and run the command there too. The command leaves out thumbnails stored in the last hour, which may belong to an upload still in progress: if you deleted, before upgrading, an item uploaded less than an hour before you run it, run it again an hour later. On UploadThing, whose apps can hold other uploaders' files, it lists what it finds by file key and uploaded name: remove the ones that are yours from the UploadThing dashboard. Run it again after a delete whose log names a file it could not remove, or whose process stopped before it finished.
  - Deleting a folder with its contents removes every file of every item in it and in its subfolders, once their records are gone. It removed none before.
  - A file the storage refuses to remove is logged with its path and the media item, so it can be found.
  - `@nextlyhq/storage-uploadthing`: a delete UploadThing refuses (an outage, a refused token, a rate limit) now fails, so it is retried and logged like any other, rather than read as done while the file stays stored. A file already gone is still not an error.
  - A crop inside a plugin's `ctx.db.transaction` on SQLite removes the sizes it replaced once that transaction commits. They were kept before, stored indefinitely.
  - A crop or rotation whose new sizes include `thumbnail` removes the thumbnail made at upload, which nothing refers to any more.
  - A crop on SQLite saves its regenerated sizes. It failed before, because the sizes were written as an object the driver cannot store.
  - A delete and a crop of the same item at once leave no file of the item behind, and two crops at once leave no file behind that nothing refers to.
  - Storage adapters can now list their files (`list()`, optional). `@nextlyhq/storage-s3`, `@nextlyhq/storage-vercel-blob` and `@nextlyhq/storage-uploadthing` implement it; an adapter without it is reported as one that cannot be searched.

- [#2381](https://github.com/nextlyhq/nextly/pull/2381) [`95253ee`](https://github.com/nextlyhq/nextly/commit/95253eef08315de3dcf1f5d4082937035250c7a6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A read at `depth=0` returns stored ids for a Single's upload fields and for many-to-many fields kept in a junction table, as it already did for every other relationship. A Single's uploads were populated at every depth, and a junction field had no value at `depth=0`. Populated reads are unchanged.

- [#2435](https://github.com/nextlyhq/nextly/pull/2435) [`1204813`](https://github.com/nextlyhq/nextly/commit/12048134ef5ce6d583104fff959f47a700750cfa) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Who may read, change and revoke API keys follows the permission, not the key's owner, in the admin, the REST routes and the Direct API alike.
  - Anyone who may read keys (`read-api-keys`, or `update-api-keys`) sees every key, not only their own. A key still shows only its prefix after it is created, so none can be copied.
  - A key's owner (name and email) is shown only to someone who may also read users. A person always sees themselves on their own keys, and the admin's key list says "Hidden" for an owner it may not show.
  - `update-api-keys` renames any key, and `delete-api-keys` (or `update-api-keys`) revokes any key. Creating a key is still only for yourself.
  - The dashboard's key count covers every key, as the list does.

  The Direct API's `apiKeys` namespace now honours `overrideAccess: false`, set on the call or on the instance, and judges its `user` by these same rules. It is now on `await getNextly()`'s instance too, as on the module-level `nextly`.
  - Making or changing keys as an API key is refused.
  - A checked call that names no `user` is refused with `AUTH_REQUIRED`.
  - A call that names a different `user` is judged as that person, not by the instance's API key.

  Compatibility: over REST, a person holding `read-api-keys` but not super-admin now lists every key where they listed only their own. A holder of `update-api-keys` or `delete-api-keys` can now change or revoke keys they do not own, where before they got 404. Through the Direct API, only calls that ask to be checked change; trusted calls, the default, behave as before.

- [#2453](https://github.com/nextlyhq/nextly/pull/2453) [`12cf1d5`](https://github.com/nextlyhq/nextly/commit/12cf1d5cce974443a71f10d8ba09bda7442d1cc9) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API's role, permission and field-group writes honour `overrideAccess: false`, set on the call or on the instance, as the REST routes do. `nextly.roles.create`, `update`, `delete` and `setPermissions`, `nextly.permissions.create` and `delete`, and `nextly.fieldGroups.create`, `update` and `delete` ask the permission the matching route asks:
  - roles: `create-roles`, `update-roles` (also for `setPermissions`) or `delete-roles`;
  - permissions: their own action, or `manage-permissions`;
  - field groups: their own action on `settings`, or `manage-settings`.

  A super-admin passes. An API key is judged by its own grants. A checked call that names no `user` is refused with `AUTH_REQUIRED`.

  Compatibility: only calls that ask to be checked change. Trusted calls, the default, behave as before.

- [#2531](https://github.com/nextlyhq/nextly/pull/2531) [`7a9bede`](https://github.com/nextlyhq/nextly/commit/7a9bedee5552e908c144d2a6b274312bc7eeac7c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API's user and role writes (`users.create`, `users.update`, `users.delete`, and `roles.create`, `roles.update`, `roles.delete`) now honour `overrideAccess: false`, set on the call or on the instance. Each is checked as the named caller against the same permission the matching REST route asks for, and refused with `FORBIDDEN` when the caller lacks it, before anything is written. A checked call that names no user is refused with `AUTH_REQUIRED`. A role change made this way follows the same super-admin rule as REST: only a super-admin may give anyone a role that is, or inherits, super-admin. An API key is judged by its own grants. Trusted calls, the default, are unchanged.

- [#2417](https://github.com/nextlyhq/nextly/pull/2417) [`a9f0549`](https://github.com/nextlyhq/nextly/commit/a9f0549fee970670432f3230a5a6ac38604dca91) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Mod+S now runs the editor's Save action, so the shortcut always saves the way
  the Save button does. Two cases change. On a Single with Draft/Published, Mod+S
  used to save without naming a status; it now saves a draft, or stores changes
  to a published Single the way Save changes does. Creating an entry, Mod+S now
  saves a draft, as the Save draft button does, instead of saving with no status.

  Submitting the full-page entry or Single form with Enter now saves the way Mod+S
  does: a draft, or the change to a published document. It never publishes,
  even where Publish is the leading button; before, it saved without naming a
  status. Whether Enter submits in a given field is unchanged.

  `useDocumentStatus()` now reports the document's status inside the full-page
  entry editor, including from a plugin's document view. It returned `null`
  there before; the quick-edit modal and the Single editor already reported it.

  The header's save indicator now reports the document's save; recovery points move into its tooltip. A new entry shows 'Unsaved changes' once edited.

  After a save, an entry or Single shows what the server stored, such as a trimmed title or a rewritten page layout, rather than what was sent. Anything typed while the save was in flight stays on screen, still unsaved. A save that sent a link the editor cannot see keeps showing the form as sent, so the link is not dropped from the next save.

  The Page Builder's screen now offers the document's Save and Publish (or Save draft) in its own top bar, the same actions the editor's header offers. And a passage still being typed in the builder is finished before any save, whether it was started from the keyboard, a button or a menu; before, only Mod+S finished it. Once its page is saved, the builder shows it as saved, and leaving no longer warns, until it is edited again. Its Save and Publish wait for a change the page depends on that is still being written, as the header's do, instead of ignoring the press.

  A failed save's Retry belongs to the document and language it failed in: switching language, or to another document, clears it, so it can never store or publish a different translation. The Discard draft confirmation can no longer be dismissed while the discard runs. Confirming it twice before the dialog updates discards once. After a save, the editor stops offering a recovery point from before it. A save waits for every change the page depends on, including one started while it waits, and says so if changes keep arriving. A change that failed to save names itself and where to make it again, rather than offering a Retry that would fail the same way. For plugins, `useDocumentActions().run("delete")` now resolves once the delete is answered, with what it came to, and `useDocumentActions()` reports `storedAt`, when the document was last stored in this session.

- [#2400](https://github.com/nextlyhq/nextly/pull/2400) [`335a798`](https://github.com/nextlyhq/nextly/commit/335a798226437d449f6ca027895162a052c1f488) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test, the log lines written by Nextly's collection, relationship, media, auth, schema and other domain services are masked of email addresses: they now go through the service's logger, or `consoleLogger`, rather than straight to the console, with errors and values as fields. A line `consoleLogger` writes without fields no longer carries an empty trailing argument.

- [#2374](https://github.com/nextlyhq/nextly/pull/2374) [`90d0ac7`](https://github.com/nextlyhq/nextly/commit/90d0ac7130ba37624d0d13f4375f8be86ee3c2e1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test (an unset `NODE_ENV` included), email addresses that Nextly logs through its loggers, `consoleLogger` and a `logger` the app passes it included, are masked to their first character and domain (`j***@example.com`), and the log transport leaves message bodies out. Search production logs by domain and first character instead of the full address.

- [#2474](https://github.com/nextlyhq/nextly/pull/2474) [`26f098e`](https://github.com/nextlyhq/nextly/commit/26f098e10c3837e5e7ac4227166ff202d40a13a4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Emails can carry the site's brand without editing HTML. Brand settings (a logo and its width, an accent colour, the background and content colours, a font from an email-safe list, and footer text and links) are stored by core and read by `GET` and `PATCH /api/email-templates/brand`, which take the permissions to read and to update email templates. Core's default layout is now written in them, the buttons of core's built-in emails take the accent, and every layout and template can read them as the `brand` variable (`brand.html` holds the logo, footer and link markup they make). A background or content colour a site chooses is kept in dark mode too, where the default layout used to swap in fixed dark colours.

  Nothing changes for an existing site until someone changes a setting: each setting starts from what the default layout showed, which renders every email byte for byte as before. On upgrade, the default layout and built-in emails still as core shipped them move to the new versions; ones a site edited stay as they are, as do the site's own layouts. `GET /api/email-templates/brand` says which emails the settings reach and why the others are not reached. In a layout's data, `brand` is always the settings: a send's own `brand` value still reaches the template body, but no longer a layout, and a template whose send supplies no `brand` reads the settings. The settings are also always available as `nextly_brand`, which core's built-in emails read, so a send carrying a `brand` of its own changes nothing in them; a send's own `nextly_brand` value is ignored. A template kept on the engine before Liquid now writes HTML marked as trusted unescaped, as Liquid does.

- [#2566](https://github.com/nextlyhq/nextly/pull/2566) [`bf8f378`](https://github.com/nextlyhq/nextly/commit/bf8f378f76fc91e077b835cab89df74fa7bdc789) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The email brand settings table is named `email_brand`, like the other email tables.

- [#2568](https://github.com/nextlyhq/nextly/pull/2568) [`029919b`](https://github.com/nextlyhq/nextly/commit/029919b1f708a2211552f8ef350a9bf4edfc5af8) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every part of an email that holds Liquid is now edited in a code editor that reads it: the subject, preview text, From, Reply-To, and the HTML and plain-text bodies.
  - **Completion:** typing inside `{{ }}` or `{% %}` offers the email's variables, their properties from the sample data, and the Liquid tags and filters an email can use. Tags and filters an email can't use aren't offered.
  - **Problems as you type:** an unclosed tag or an unknown filter is named at its line, with the parser the server renders with, so a template that would fail to send says so before you save. The body lists its problems under the editor; each envelope field shows its own.
  - **Inserting a variable** from the chips goes in at the cursor of the body you're editing.
  - **Sample data** in the Data panel is edited in the same code editor, which checks the JSON.

  The editor loads when a workbench first shows it, so the rest of the admin doesn't load it.

- [#2552](https://github.com/nextlyhq/nextly/pull/2552) [`c385099`](https://github.com/nextlyhq/nextly/commit/c385099ca7d12c1ab346a0078df2a06516eb3938) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template editor lists the value its save handler reads as that handler's dependency, so admin lint passes again. No change in behaviour: a save still returns to Design for layouts and partials, and to Messages otherwise.

- [#2534](https://github.com/nextlyhq/nextly/pull/2534) [`9d3f54b`](https://github.com/nextlyhq/nextly/commit/9d3f54bc82d800730d8d258ca61275ed9766ebd5) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Email has one hub in the admin, entered from the main navigation, with Messages, Design and Sending as tabs across the top. The email pages under Settings redirect to their place in it, so bookmarks and links keep working. Messages lists every email grouped by owner, with what sends it and its state (default, customised, update available, off, or kept as before), with search, owner and state filters, a create dialog, and cards at phone width. Design lists the layouts, and Sending holds the providers. Each tab shows to anyone who may read what it shows, and each change only with the permission the server checks for it, so a reader who may only look sees the lists without actions. A form's notification links to its email in the hub. The templates list now reports `keptOnOldEngine` for each template.

- [#2570](https://github.com/nextlyhq/nextly/pull/2570) [`f1cfb4c`](https://github.com/nextlyhq/nextly/commit/f1cfb4c68dbbd96dd197268f3681e460f066ecab) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Sending an email no longer reads the template engine state or the brand settings from the database each time: each instance keeps both in memory, loaded at boot and updated at once by its own changes, and reads them again at most every 30 seconds outside a transaction. On a site with several instances, a template confirmed as Liquid or a brand change made on one instance can take up to 30 seconds to reach the others; until then they send as before. A send inside a transaction never reads either on another connection.

- [#2567](https://github.com/nextlyhq/nextly/pull/2567) [`de47354`](https://github.com/nextlyhq/nextly/commit/de47354d0e00feaae67b283b9f13add525d2179b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - **Breaking:** `POST /admin/api/email/send` and
  `POST /admin/api/email/send-with-template` are removed, with their package
  exports `nextly/api/email-send` and `nextly/api/email-send-template`. Any
  signed-in user or API key could call them and choose the recipient, so anyone
  with access could send email as the site.

  To send email, call `nextly.email.send()` or `nextly.email.sendWithTemplate()`
  from server code. To send from a browser or another service, add a route of your
  own that checks who may send, and to whom, before it calls them.

  The admin's **Send test** on an email template keeps working. It now sends the
  saved template only to the signed-in user's own address, and it has no recipient
  field. It needs the `update-email-templates` permission and refuses API keys.

- [#2473](https://github.com/nextlyhq/nextly/pull/2473) [`e773453`](https://github.com/nextlyhq/nextly/commit/e773453f843ea536854c420a2051657b5921ed26) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin can say which engine each email template it contributes was written for, with `engine: "liquid" | "legacy"` on `contributes.emailTemplates` (experimental). A `"legacy"` template renders exactly as the `{{variable}}` engine did before Liquid, whatever Liquid-like text it holds, so an older template carrying `{% … %}` or a `|` as literal text keeps sending what it always sent. A `"liquid"` template, or one that declares nothing, renders as Liquid; an undeclared template Liquid can't read still renders as before. A template that names any other engine, or is declared `"liquid"` with text Liquid can't read, is not registered at startup, and an error naming the plugin and the template is logged.

  Each startup also checks the engine of every template that follows its owner's version, including one a plugin has just taken over. A change of declaration takes effect at the next start, and so does a template whose switch to Liquid did not finish after its owner's update (a database error between the two writes).

- [#2106](https://github.com/nextlyhq/nextly/pull/2106) [`f64216c`](https://github.com/nextlyhq/nextly/commit/f64216c7fc6f90d09e11d1468bf4d7154b47c9a0) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every email template now has an owner: Nextly for its built-in templates and
  layouts, a plugin for the templates it contributes, or the site for the ones it
  makes. Records from the Direct API and REST carry `owner`, `overridden`,
  `ownerChanged`, `setInCode` and `description`.

  An owner's template follows the owner. Plugin and core templates used to be
  inserted once and never touched again, so a plugin could not ship a fix to its
  own email. Now each boot stores the owner's current version, unless the site
  has overridden the template. An override keeps the site's version and a copy of
  the owner's version it started from; when the owner later changes, the
  template reports `ownerChanged`, and `compare` lists each change on its own,
  with the site's lines beside it and a `review` token. `applyUpdate` takes that
  token and a choice per change (keep the site's lines, use the owner's, or use
  edited text) and applies them together, refusing once anything it compared
  has moved, returning what it replaced so `undoUpdate` can put it back. `reset`
  returns the template to its owner's version. Changing an owned template's
  subject, preheader, HTML, plain text, description or declared variables
  through `update` overrides it, so an
  edit is never overwritten at the next boot. New REST routes:
  `PATCH /api/email-templates/:id/override`, `/reset`, `/apply-update` and
  `/undo-update`, and `GET /api/email-templates/:id/compare`.

  A send now uses the site's override first, then the site's code version from
  `email.templates` in `defineConfig()`, then the owner's version. Before this,
  a stored template always won, so a configured `email.templates` function was
  never used on a new installation. Whichever version sends, the stored
  template's provider, From, Reply-To and attachments apply.

  Nothing an existing site sends changes on upgrade. A stored core or plugin
  template that differs from its owner's version is kept as an override. A site
  that configures `email.templates` keeps sending the stored template it sends
  today, as its override, until it is reset. One exception: a site that sends its
  `email.templates` version because it deactivated the stored template now sends
  it with that stored template's provider, From, Reply-To and attachments, where
  it had set them. Templates of a plugin that is no
  longer installed are kept and can be deleted. Core's templates and an installed
  plugin's can no longer be deleted (the delete used to be undone at the next
  boot); reset them instead. A template's name and whether a layout wraps it are
  the site's and are kept. Declared variables and descriptions are taken from
  the owner at the upgrade: they never change what is sent (a missing required
  variable only logs a warning), and stored declarations are mostly an earlier
  release's.

  `contributes.emailTemplates` entries accept an optional `description`.

  `EmailTemplateRecord` gains required fields (`owner`, `overridden`,
  `ownerChanged`, `setInCode`, `description`). Code that builds one itself, such
  as a test fixture or a mock of the template service, needs to set them.

- [#2373](https://github.com/nextlyhq/nextly/pull/2373) [`ef95bb2`](https://github.com/nextlyhq/nextly/commit/ef95bb2d78ea44b94c5e2fc08a7c3268d1090b5f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Email templates now render with Liquid (LiquidJS), so a template can loop over
  a list, branch on a value, and format text, numbers and dates with filters.
  Today's `{{variable}}` and `{{a.b}}` are Liquid, and every existing template
  renders as before, but for line breaks in a subject (below).

  Escaping is not up to the template author. Every value written into HTML is
  escaped as before; no filter that skips escaping is available, and the tags
  that would write a value unescaped (`echo`, `liquid`, `cycle`) or load a file
  (`include`, `render`, `layout`, `block`) are refused. HTML is written as it is
  only when code marks it with `markHtml()`, exported from `nextly` with
  `TrustedHtml` and `EmailTemplateData` (experimental). Only code marks HTML,
  and only markup it built itself: never a value from a request, a form, a
  stored row or another plugin. Nothing parsed from JSON or a stored row can
  carry the mark. A render is limited in
  template size, time and memory, and stops with an error naming the limit. A
  Liquid template's subject has its line breaks removed, so a subject value
  holding a newline sends as one line; a template kept on the previous engine
  renders its subject as before.

  A stored template that holds text the previous engine sent as written, and
  Liquid would read differently (a `{% … %}`, a filter, `{{0}}`, or text Liquid
  cannot parse), keeps the previous rendering. It is recorded at the first boot
  on this version and stays that way, through edits to its other fields, until
  its flagged text is changed and it is confirmed as Liquid.

  Saving a template Liquid cannot read is refused, naming the field and the line.
  A send whose stored template cannot be rendered fails before any provider is
  called, and is not retryable.

  The Direct API's `sendWithTemplate` variables and `preview` data accept any
  value, lists and objects included, where they were typed as strings.

- [#2475](https://github.com/nextlyhq/nextly/pull/2475) [`ba637bb`](https://github.com/nextlyhq/nextly/commit/ba637bb0ba63aa0099ddf76a26426ae0d3464bd7) Thanks [@faisal-rx](https://github.com/faisal-rx)! - An email template's Reply-To and the display name of its From can now follow
  the send's variables: a Reply-To of `{{ customer.email }}` answers the person
  an order is about, and a From of `{{ shopName }} <orders@shop.example>` names
  the shop. The From address stays fixed: a variable in it is refused on save. A
  send whose rendered Reply-To is not an address fails before any provider is
  asked, as not retryable, naming the Reply-To; one that renders empty sets no
  Reply-To. The send's own `from` and `replyTo` still win over the
  template's, and a From or Reply-To that uses no variables is sent exactly as
  before.

  Templates can copy fixed addresses on every send: `cc` and `bcc` on a
  template are added after the send's own copies, leaving out any address the
  send already reaches. Only fixed addresses are accepted, never variables. They
  can be set through the REST routes, the standalone `nextly/api/email-templates`
  handlers and the Direct API, and a change to them is recorded in the activity
  log by field name only.

  A template's owner can mark it as carrying a secret (`carriesSecret` on
  records). Such a template refuses `cc` and `bcc` on save, and sends none
  even when they are stored on it some other way. Core marks its password reset,
  email verification and welcome emails; the accounts plugin marks its
  verification, reset and address-change emails. The mark is the owner's and
  cannot be changed from the admin or the API.

  Core's templates and layout, and the accounts plugin's templates, now say
  when each is sent (`description`).

  `contributes.emailTemplates` entries accept an optional `carriesSecret` and
  `replyTo` (both `@experimental`). A plugin should mark every template that
  carries a sign-in, reset or verification link or code.

  `EmailTemplateRecord` gains required fields (`cc`, `bcc`,
  `carriesSecret`). Code that builds one itself, such as a test fixture or a
  mock of the template service, needs to set them. `email_templates` gains the
  nullable columns `cc`, `bcc` and `carries_secret`, added in place on every
  dialect. Nothing an existing site sends changes on upgrade.

- [#2554](https://github.com/nextlyhq/nextly/pull/2554) [`487ae9e`](https://github.com/nextlyhq/nextly/commit/487ae9e7a0ad9991401e5c762993061dd79c2ac2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The email workbench is laid out beside its preview at every width:
  - **Desktop:** the content column and the preview share the width, and you can drag between them to resize. Data and Details open in a side sheet that makes room beside the preview rather than covering it.
  - **Tablet:** the two panes are equal, and an open sheet takes the content's place.
  - **Phone:** Edit, Preview, Data and Details are tabs, with Save and Send test in a bar at the bottom.

  An inbox strip above the fields shows the email as an inbox lists it.

  An owner's email (Nextly's, or an installed plugin's) shows its subject, preview text and body read-only until you override it. Its settings stay yours to change. From the workbench you can:
  - override an email;
  - reset it to its owner's version, and undo the reset;
  - review an owner's update change by change, keeping your lines or using theirs, and undo the review.

  Details now also holds the email's description and its Cc and Bcc. An email that carries a secret never has Cc or Bcc.

- [#2559](https://github.com/nextlyhq/nextly/pull/2559) [`46c5b1b`](https://github.com/nextlyhq/nextly/commit/46c5b1bcc45d09ad8e4126424bd300895ea7fd29) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Reading a collection or a Single through `canReadEntity` is decided by the one access decision. No answer changes: a key is judged on its own scope, a declared read rule still decides alone for a signed-in user, and without the access-control service a signed-in user is still refused.

- [#2488](https://github.com/nextlyhq/nextly/pull/2488) [`365e525`](https://github.com/nextlyhq/nextly/commit/365e525a92ca6388ccb7a7f448c3d7c057bead1f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A request that waits out `pool.connectionTimeoutMs` now answers `DATABASE_BUSY` (503, with `Retry-After`) on the auth routes and on collection and Single entry reads and writes too, where it answered a 500 or a 503 without the retry hint.

- [#2440](https://github.com/nextlyhq/nextly/pull/2440) [`a338bed`](https://github.com/nextlyhq/nextly/commit/a338bed44ab42779dc9f29f4bbe3b69870734220) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every access rule is handed one context, and a permission is spelled one way.

  A collection's, a Single's and a field's rule now receive the same
  `AccessRuleContext` (`AccessControlContext` is the same type, and a field's
  `AccessFunction` takes it too). It holds everything each kind of rule read
  before: `user`, `roles`, `permissions`, `principal`, `operation` and
  `collection`, as a collection rule read them, and `req`, `id` and `data`, as a
  field rule read them. A collection rule now also gets `req`, a field rule now
  also gets `user`, `operation` and `collection`, and every rule gets `target`,
  `{ kind, slug }`: a `"collection"`, a `"single"`, or, for a field rule, the
  `"component"` the field belongs to. A rule written against either earlier shape
  reads what it read.

  `permissions` is now spelled as the Roles screen, the database and a route's
  `requiredPermission` spell it: `update-posts`. A rule that checks that spelling
  allows; until now it was handed `posts:update` and refused. A permission whose
  stored slug is custom, such as `manage-api-keys`, is handed as stored.

  The earlier spelling, `posts:update`, is still in the list for this release,
  after the new one, so a rule that looks a permission up keeps its answer. A
  rule that reads the list's order, its length or its first entry sees the new
  entries, which come first, and each permission twice. A rule that checks it
  with `includes`, `indexOf` or `lastIndexOf` is warned once, naming the spelling
  to write instead. It stops being accepted in a later release: change
  ``permissions.includes(`${collection}:${operation}`)`` to
  ``permissions.includes(`${operation}-${collection}`)``.

  Code that builds a context by hand, such as a unit test of a rule, now has to
  give `req` and `target` as well. The Form Builder's default rules and the blog
  template's `hasPermission` check the new spelling.

- [#2360](https://github.com/nextlyhq/nextly/pull/2360) [`d9de03a`](https://github.com/nextlyhq/nextly/commit/d9de03a872b39862a400088250733f7fd9e1f5fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A failed save in the entry editor, full-page or quick-edit, no longer wipes what you typed. The save writes your changes into its cache before the request and puts the stored entry back when the request fails, and the form reset itself to that stored entry, so every unsaved edit was lost. When the same entry arrives again, the form now takes its values only in the fields you have not changed, and keeps what you typed, the errors shown and the form's submitted state: after a failure, your edits stay on screen, still unsaved, with the error the server reported, ready to save again. A colleague's newer working draft shows in the fields you left alone. Another entry, another language, a new version saved elsewhere, or a working draft appearing or going still replaces the form, as before.

- [#2590](https://github.com/nextlyhq/nextly/pull/2590) [`8594515`](https://github.com/nextlyhq/nextly/commit/8594515396ddb95cd261719cd94206f82d09af0c) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A field group's settings save that removes a translated field while it adds a nested field group is now refused before anything changes, as the collection and Single settings saves already refuse it (`TRANSLATED_FIELD_REMOVED_BESIDE_ADDED`). A nested field group stores its rows in its own table, so the save's own check saw no column added beside the removed one and let it through, and the removed field's translations column was dropped with every language's value. Rename or remove one translated field and save, then add the others.

- [#2520](https://github.com/nextlyhq/nextly/pull/2520) [`267dc3a`](https://github.com/nextlyhq/nextly/commit/267dc3ac89866d51d82384c1965fc6a11a2e5808) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A field group's field rules now decide its fields on every live read: a list, a read by id, a Single read, a populated related row and a create's or update's response withhold a field inside a field group that the reader may not read, in every shape a field group is stored (single, repeatable, a dynamic zone, inside a group field), as they withhold the collection's or Single's own fields and as history reads already did. Trusted server code (`overrideAccess`) still reads every field.

- [#2572](https://github.com/nextlyhq/nextly/pull/2572) [`4ae14b6`](https://github.com/nextlyhq/nextly/commit/4ae14b6dbf5e4a784bc439b67e5cb61f33c1aa96) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A field group's field rules now decide its fields on every write, as the collection's or Single's own field rules decide theirs: a create, an update (over REST, the Direct API, inside a caller's transaction and in a bulk create), a Single update, the publish of a held draft and the restore of a version. On create a field the writer may not set is not stored. On update it keeps its stored value: an instance sent with its id is judged as an update and keeps what it held, and one sent without an id is a new instance, judged as a create. A field group inside a group or repeater keeps its stored values the same way. A publish whose pending change edits a field-group field the publisher may not write is refused, naming the field, as one editing the entry's own field is. Trusted server code (`overrideAccess`) still writes every field.

  A field rule that refuses an update to a collection's or Single's own field nested in a group keeps that field's stored value, as a refused top-level field does.

  A scoped API key's limits now apply to a Single's own field rules on update, as they already did to a collection's: the key is judged by its own grants, not by its owner's.

- [#2351](https://github.com/nextlyhq/nextly/pull/2351) [`edc1bcc`](https://github.com/nextlyhq/nextly/commit/edc1bcc5934236801d6e75f589eb47ed146c07aa) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **In production, creating the first administrator needs a one-time setup token.**
  Until an install has an administrator, whoever reached `/admin/setup` first
  could create one. Now, in production, setup asks for a token:
  - **Generated:** a production start on an install with no administrator prints
    one line beginning `[nextly] SETUP TOKEN`, with the token and the setup
    address. It is valid for 24 hours and for one setup, and only its digest is
    stored.
  - **Your own:** set `NEXTLY_SETUP_TOKEN` (at least 43 characters, 16 of them
    distinct). `nextly setup-token --generate` prints a suitable value. A weaker
    value keeps setup closed, and the start says so.
  - **Replace it:** `nextly setup-token`, run against the install's database,
    replaces the generated token and prints the new one.

  The admin's setup form asks for the token when it is needed. A valid token
  completes setup whatever the sign-in rate limit holds, and wrong ones count
  against it. Setups racing with the token create exactly one administrator.
  Development is unchanged.

  Upgrading: an empty production install needs the token on its next start (the
  log line and the setup form say where it is). Automation that creates the first
  administrator over HTTP in production sets `NEXTLY_SETUP_TOKEN`. Installs that
  already have an administrator see no change. No migration is needed.

  A new command, `nextly users:create-admin`, creates an install's first
  administrator from the command line, in the database its environment names,
  with no setup token: whoever can run it already holds the database
  credentials. It takes `--email` and `--name`, or asks for them at a terminal,
  and the password from `NEXTLY_ADMIN_PASSWORD` or a prompt that does not echo
  it, never from an argument; the password meets setup's strength rules. It
  refuses, creating nothing, once the install has an administrator or when an
  account already uses the email given, and still
  creates one over an install whose only accounts are role-less self-registered
  ones.

- [#2697](https://github.com/nextlyhq/nextly/pull/2697) [`059c534`](https://github.com/nextlyhq/nextly/commit/059c534e64c09482192f1acd52f31aa5d294890a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's setup checklist and its sample-content offer are now one Get started card, first and full width, drawn while a step this reader could take is waiting.
  - **One card.** It offers, in order, Create a collection, Add your first entry, Fill in each Single (the first five, then a control for the rest) and Invite a teammate, each only to someone who could finish it, with "x of y done". Create a collection is offered only where the schema builder is on, so a production site, where the builder is off by default, is never shown a step it cannot complete. Single and invite steps can be skipped and restored. The sample-content offer is made inside the first-entry step.
  - **Its steps travel in the layout read.** `GET /api/dashboard/layout` answers `getStarted: { drawn, answer }`, from the same computation that decides whether the card is drawn. `?getStarted=1` also answers them for a removed card, as the admin asks while restoring one.
  - **Per person, on the server.** Skips and whether the reader acted on the card are kept in the card's settings. A dismissed card is listed under Removed and comes back with its progress and skips. Once every step is done or skipped, the card says "You're all set" to a reader who acted on it, and leaves anyone else's dashboard quietly.
  - **Not known is its own answer.** When setup cannot be checked, the card says so and offers Retry, and never shows a step as waiting on that basis. A step whose own check failed or ran out of time is no longer offered as "not known": nobody knows whether the reader could finish it, so the whole answer is not known instead. The step work also stops at the deadline rather than running on.
  - **Saved dashboards convert.** A saved "Set up your project" card and sample-content card become one Get started card, with the first one's id and place, removed if either was. The retirement map gains a `removed: "any"` rule for this; every other retirement keeps "removed only if all were".
  - **Deprecated, kept for one release:** `GET /api/dashboard/onboarding`, `ONBOARDING_STEPS` (unchanged) and the admin's `OnboardingChecklist` export, which the dashboard no longer draws.
  - **New, `@experimental`, from `nextly/config`:** `GET_STARTED_WIDGET_ID`, `GET_STARTED_STEP_KINDS`, `GET_STARTED_SKIPPABLE_KINDS` and the `GetStartedAnswer`, `GetStartedStep`, `GetStartedStepKind` and `GetStartedStepStatus` types.
  - **A known limit:** on MySQL and SQLite, a Single first saved in the same second it was created is known to be filled in only from the activity trail, so once retention prunes that row (90 days by default) its step reads as waiting again. It never reads as done when it was not.

- [#2541](https://github.com/nextlyhq/nextly/pull/2541) [`b49cf66`](https://github.com/nextlyhq/nextly/commit/b49cf665972622e5b3f8200a8bf5fc5c0866428b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Setup that can't be checked no longer reads as an empty install. The dashboard's setup steps are now one server-side answer, on which the setup checklist and its condition are both based.
  - When the collections registry can't be read, the "is there content" check now answers "unknown" rather than "no content". So `content:empty` no longer holds on a registry failure, and an established site is no longer offered the empty-install cards.
  - `onboarding:incomplete` now holds while setup can't be checked, and when its own check fails, so the setup card stays visible to say so instead of disappearing as if setup were finished.
  - The setup steps are decided in one place: create a collection, add a first entry, fill in each Single the reader may edit, and invite a teammate. Each is offered only to someone who could finish it.
    - A Single counts as filled in once the activity trail has recorded a save of it since the Single was registered, so a Single deleted and made again under its slug isn't ticked by the earlier one's saves. For a Single saved before the trail recorded saves, a stored document changed after it was created counts.
    - Inviting counts once the site has a second account, which includes a pending invitation.
    - The whole answer is held to the content check's 5-second budget. A step not answered by then reads as not known, never as done.
    - The existing checklist and `GET /api/dashboard/onboarding` read their steps from this answer.
  - `GET /api/dashboard/onboarding` also returns `unknown: true` when setup can't be checked, and the existing checklist then says its progress is unavailable instead of drawing every row ticked. The field is additive: `steps` is unchanged, and a client that ignores `unknown` behaves as before.

- [#2498](https://github.com/nextlyhq/nextly/pull/2498) [`7fac9e1`](https://github.com/nextlyhq/nextly/commit/7fac9e19d0dec109bc0662492c5a276ae16b6ff7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard batch that asks one widget source several queries now isolates each of them.
  - An SEO issues card whose filter the source refuses only as it reads the answer, such as `contains` on the issue, now fails that card alone. Before, it failed every SEO card in the same batch.
  - A plugin widget source whose `resolveMany` is written with method syntax, delegating to `this.resolve`, now keeps its receiver. Before, it failed every grouped batch.
  - The `widget-source-asked-several` log line now says whether the source's many-query resolver actually answered, as decided when the batch runs.

- [#2447](https://github.com/nextlyhq/nextly/pull/2447) [`6d665de`](https://github.com/nextlyhq/nextly/commit/6d665de80ca512ae3eeb946bcf027400680dd39d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component field's own `validate` now runs on every write for a component at the top level, inside a group or repeater, inside a component held in one, or inside a group or repeater of another component; until now it never ran, so existing content that fails it is refused on its next save or publish.
  A held edit to a published Single or collection entry is validated when saved, as its publish would be; publishing a held Single shows component validators the value without its internal type tag; a Single whose localized component is only virtual keeps its drafts; and held drafts record nested components' types for restore.

- [#2329](https://github.com/nextlyhq/nextly/pull/2329) [`b792cd5`](https://github.com/nextlyhq/nextly/commit/b792cd5d5b833e2b79211e02cd2b6f8bfcc05460) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - History opens beside the document, in the document panel's place, so the editor stays as it was, unsaved words included. On a narrow window it opens as a page of its own. The panel and the version chosen in it are kept in the page's address, so a reload or a shared link opens the same version, and Back closes the panel.

  Showing a version marks it seen for the signed-in person, which is where a comparison since they last looked starts. The compare dialog is gone: a comparison opens on its own page from the version being shown, against the version before it or against the current one.

- [#2493](https://github.com/nextlyhq/nextly/pull/2493) [`9a6c604`](https://github.com/nextlyhq/nextly/commit/9a6c604f19eb3071494321538bd4c1f102542666) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - In the admin's version history, a publish that shipped several languages is now pinned as the current publish in each of those languages' views (as that publish, with no version to open, in a language whose own version it did not record), and an older save of one of them is no longer pinned as its current draft. Changing the language view returns the document to its current state when the version being previewed is no longer shown.

- [#2442](https://github.com/nextlyhq/nextly/pull/2442) [`a605100`](https://github.com/nextlyhq/nextly/commit/a605100b4865d92c079a3472b7a5a952281dcd3d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A document's version history and content events now ask its read rules and hooks about each language they return. A read naming a language the reader may not read the document in answers not found. A read naming none returns only the languages they may read, plus versions and events about the whole document, and an event that involved several languages lists only the readable ones. Version history also no longer refuses a valid read when an `afterRead` hook leaves `id` out of its output.

- [#2500](https://github.com/nextlyhq/nextly/pull/2500) [`dfb4e5c`](https://github.com/nextlyhq/nextly/commit/dfb4e5c8acef8f0fa2bb17eb1c9bba5fb96f619e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A comparison of two versions now marks each change inline by default, removed text struck through and added text underlined, each in colour, with side by side as a choice each person keeps. The comparison page says how many fields changed, folds the unchanged ones behind "Show N unchanged fields", and moves between changes with Previous and Next, by keyboard as well. Fields are named with their place ("SEO › Meta title"), a setting reads Off or On, a moved block reads "Moved from 2 to 4", a removed field says it is no longer in the content type, system fields wait behind "Show system fields", and an image shows its alt text. A held draft of a document without languages now compares with its earlier saves.

- [#2462](https://github.com/nextlyhq/nextly/pull/2462) [`8459ee8`](https://github.com/nextlyhq/nextly/commit/8459ee8c2c513f4dcfd34c207edd3abd57f6e992) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The admin's version history now tells what happened to a document. It shows a timeline under day headings: each save, publish and restore, with named versions labelled, and each unpublish and discarded draft, with who did each, and a marker where retention removed versions. Saves fold under the publish that included them. For a document with drafts, the current draft and the currently published version are pinned at the top. For a localized document, the list opens on the language being edited and its shared fields, and can switch to all languages. Filters show everything, publishes, named versions or events. Each of the newest twelve versions in the list, and each save folded under them, names the content fields it changed from the version before it. For a collection entry, a publish or unpublish now records the version it produced, and publishing a held draft records its move from draft.

- [#2502](https://github.com/nextlyhq/nextly/pull/2502) [`6d7bfee`](https://github.com/nextlyhq/nextly/commit/6d7bfeeb030ab532170875d6ee8da9dcb635dad4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - History shows each language its own versions. When one save publishes several languages, the other languages' views show that publish as an event rather than as a version you can open, and pin it as what is currently published there, with no version to open, unless that language has published again since. Previewing, comparing or restoring from a language's view no longer offers another language's versions.

- [#2331](https://github.com/nextlyhq/nextly/pull/2331) [`affdf1b`](https://github.com/nextlyhq/nextly/commit/affdf1b1001804dc0c13aad51f10a7ec4fc605ce) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A user field declared hidden (`admin.hidden`) is hidden on the user screen again. The previous release moved the hidden check from the field's wrapper into the entry form's renderer, and the user screen draws the wrapper itself, so its hidden fields showed and could be edited.

- [#2428](https://github.com/nextlyhq/nextly/pull/2428) [`ee4dfaf`](https://github.com/nextlyhq/nextly/commit/ee4dfaf7265537af7ac281efc4a6d8adbd63994c) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The API key form says plainly when its viewer can no longer create keys, as when that permission is taken away while the form is open, instead of saying the chosen role allows too much.

  Compatibility: a role-based key whose role allows more than its creator may do is now refused with the code `API_KEY_ROLE_ABOVE_CREATOR`, by `POST /admin/api/api-keys` and by the experimental `GET /admin/api/api-keys/abilities`. It was `FORBIDDEN`. The status (403) and the message are unchanged. A caller who may not create keys at all still receives `FORBIDDEN`. A client that matched `FORBIDDEN` to detect the role case should match the new code.

- [#2704](https://github.com/nextlyhq/nextly/pull/2704) [`c4bbfca`](https://github.com/nextlyhq/nextly/commit/c4bbfca1277ded326bd931bc6498ddce88671af5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - On MySQL, two changes to the site's language list made at the same moment on a site with no list stored yet both apply: the one that lost the race is run again from what the other stored, as on PostgreSQL and SQLite, instead of failing with a database deadlock.

- [#2622](https://github.com/nextlyhq/nextly/pull/2622) [`a8676af`](https://github.com/nextlyhq/nextly/commit/a8676aff9fa5bce30d6a99a7ff37808a7e6e5898) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The last active super-admin is kept on every route. Removing the inheritance they depend on, replacing a role's `childRoleIds`, or deleting a role is refused when it would leave no active super-admin, as deleting, deactivating or taking the role from them already is. Every active super-admin counts, whether they hold the role itself or one that inherits it, as long as their assignment has no expiry.

  Only a super-admin can take super-admin authority away from someone, by any role change: replacing their roles, unassigning a role, removing a role's inheritance, replacing its `childRoleIds`, or deleting the role. Anyone else is refused with `403`, including an API key made by a super-admin. Server code with no request caller is unaffected.

  Creating a user with roles takes the same locks in the same order as deleting a role, so the two no longer deadlock when they run at once, which aborted one of them with a retryable `409`.

- [#2644](https://github.com/nextlyhq/nextly/pull/2644) [`bb006c8`](https://github.com/nextlyhq/nextly/commit/bb006c84c8cd2778a5cfdcaa040c258a3286cb8d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The storage adapters, the database adapters, `@nextlyhq/telemetry`, `@nextlyhq/plugin-mcp` and `@nextlyhq/plugin-seo` build their declarations with oxc under `isolatedDeclarations`. Their JavaScript and published types are unchanged; the database adapters' declarations now keep the `override` modifier on overridden members.

- [#2538](https://github.com/nextlyhq/nextly/pull/2538) [`e9482a8`](https://github.com/nextlyhq/nextly/commit/e9482a85d77fa0f93a5178be27aee20a9f7c877d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A collection's list can now be filtered to the entries waiting to publish, through two reserved conditions in `where` (experimental):
  - `_pendingChange: true` keeps entries whose draft holds changes not yet published.
  - `_inRelease: { scheduledBefore }` keeps entries a scheduled release will publish after now and no later than that instant. `_inRelease: true` drops the upper bound.

  An entry is kept once, however many of its languages or releases hold it. Only the languages the read is judged for count: a read in one language, with its fallbacks, is not answered from a draft or release member in a language it was not judged for. A trusted read considers every language. A release's unpublish members are not counted. Neither is a release past its time, or one not scheduled.

  Each condition works in the JSON and the bracket form of `?where=`, beside any other condition at the top level of the filter. It is refused inside `and` or `or` (`FILTER_MISPLACED_KEY`), and for any value but those above (`FILTER_INVALID_OPERAND`). `_inRelease` also needs the right to read content releases. A caller without it is refused exactly as for a condition that does not exist, so the filter reveals nothing about what releases hold. The same refusal applies to a bulk update or delete selected by `_inRelease`, before any entry is written. The list's total and the count endpoint count the same entries the list returns.

  The admin's entry list keeps these conditions, and the language filter, at the top level of a filter it receives in its address, when its own status and date filters are added.

- [#2342](https://github.com/nextlyhq/nextly/pull/2342) [`7ae13a2`](https://github.com/nextlyhq/nextly/commit/7ae13a2f136a0af465cdb23eae30384ae9d05e1c) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The blocks engine can now answer, before an edit, the lock questions a save
  answers after it. `lockBreaksIn` lists every lock break in a document, naming
  the block, the slot, the lock and what changed. `lockRefusal` names the break
  an edit would add that the document did not already have. A layout stored
  before locks were enforced still opens and can be edited, while a new break is
  refused, including any further change to the blocks of a slot already broken.

  `planRepair` plans the repair of a document that breaks a lock, as steps a
  preview can show and the document confirming them would store. A block a
  locked slot may not hold moves to just after the outermost block whose lock
  applies, missing starting blocks are added, and a block's design inside a
  `contentOnly` slot is put back as it started. No authored block is lost, and
  each keeps its id. The planner runs as a list of rules, so a later rule extends
  the repair rather than replacing it. A break the lock rule cannot repair, such
  as a block its nesting rule allows nowhere else, is left as it is and named in
  the plan's `remaining`. All three are `@experimental` until the editor that
  uses them ships.

  A lock fault from `compositionFaults` now carries `lock`: the block whose slot
  is locked, the slot, the lock and what changed. An editor can then word a break
  a placement reaches inside a component, and tell a break an edit adds from one
  the page already had. Other faults are unchanged.

- [#2470](https://github.com/nextlyhq/nextly/pull/2470) [`e884620`](https://github.com/nextlyhq/nextly/commit/e884620a69128c40f0d40e80af7f5a414337da8b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `markHtml`, `TrustedHtml` and `EmailTemplateData` are re-exported from `@nextlyhq/plugin-sdk`, experimental, so a plugin can mark HTML its own code built through the package it builds against. Only code marks HTML, never text it didn't build.

- [#2513](https://github.com/nextlyhq/nextly/pull/2513) [`897065d`](https://github.com/nextlyhq/nextly/commit/897065d021fa09b2e4bb48e10f612d44c237cf95) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Reading media and users through `canReadSystemResource` is decided by the one access decision. No answer changes: a key is judged on its own scope, a super-admin passes, and without the access-control service a signed-in user is still refused.

- [#2391](https://github.com/nextlyhq/nextly/pull/2391) [`7377561`](https://github.com/nextlyhq/nextly/commit/7377561052980129cdd1d5743d8e288fddf901c3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly media orphans --apply` stops before a batch of removals when any media item has come to have a thumbnail whose stored location cannot be worked out from its record, as the listing does, so a file such an item refers to under a renamed URL is never removed. On Vercel Blob, thumbnails under a prefix written with its trailing slash (`media/`) are found again.

- [#2320](https://github.com/nextlyhq/nextly/pull/2320) [`2b51910`](https://github.com/nextlyhq/nextly/commit/2b51910ee545052c28a5ecba42d4542d131205eb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Media stored on local disk now shows on any host and port. Reads return a medium's URL, its variants' URLs and media reached through a relationship or a Single as the storage wrote them: the local adapter's `baseUrl` followed by the file's path, `/uploads/...` by default. They used to be rewritten onto `NEXT_PUBLIC_APP_URL`, which a new project sets to `http://localhost:3000`, so images broke on any other port, a LAN or tunnel address, and preview deployments. To serve uploads from another origin, give `localStorage()` an absolute `baseUrl`. S3, Vercel Blob and UploadThing URLs are unchanged.
  - **If your code relied on an absolute local URL** (an email, a feed, JSON-LD, an app on another origin reading the API), make it absolute with the new, experimental `toPublicMediaUrl(url, { baseUrl })` from `nextly`. It resolves against the `baseUrl` you pass, else `NEXT_PUBLIC_APP_URL`. With neither set, development warns and returns the path, and production logs an error and returns `null`: it never guesses a host. Or set `localStorage({ baseUrl })` to an absolute URL.
  - Open Graph and Twitter images from `buildMetadata` stay relative and resolve against your root layout's `metadataBase`, as canonical links already do. A block page's derived Open Graph image (`@nextlyhq/blocks-react/next`) resolves the same way.
  - The blog template's JSON-LD makes its article image absolute on the site's own URL.

- [#2361](https://github.com/nextlyhq/nextly/pull/2361) [`2dcc39a`](https://github.com/nextlyhq/nextly/commit/2dcc39a2a6b033958a984f02ae9ef154c9c77874) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A local storage `baseUrl` written without its leading slash (`uploads`) serves media again: its stored URLs (`uploads/...`) are read from the site's root, as they were before media URLs began following the storage's own base, so an image in the admin resolves to `/uploads/...` rather than a path under the page it is on. In the media library, **Copy URL** copies an absolute URL again: a local file's path is made absolute on the admin's own origin, and a cloud storage URL is copied as it is.

- [#2461](https://github.com/nextlyhq/nextly/pull/2461) [`b62f245`](https://github.com/nextlyhq/nextly/commit/b62f24516976aecb0b75d8e8b1ea47334131365d) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Media writes are checked when the caller asks to be checked.

  A Direct API `media` write (`upload`, `update`, `delete`, `bulkDelete`, `folders.create`) made by an instance or a call with `overrideAccess: false` now needs `create-media`, `update-media` or `delete-media`, the permission the REST media routes ask, and a checked call that names no user is refused as unauthenticated. Inside a request authenticated with an API key, a checked call that names a user but no key is refused as ambiguous: pass the key's scope, or call trusted. Trusted writes are unchanged, except that a write now records an instance-level `user` as a folder's creator and a file's uploader. A trusted `media.folders.create` that names no user still fails, as before, because a folder's creator must be a user.

  `ctx.services.media` writes take `ServiceOpts` where they took a `RequestContext`, as `ctx.services.collections` does. A write made as a person (`{ user }` or `{ as: "user", user }`) is judged as REST judges that person, `{ as: "public" }` is refused as unauthenticated, and no options or `{ as: "system" }` stays trusted. A checked write records its caller as the actor and refuses an `actor` naming someone else.

  Passing a `RequestContext` to a `ctx.services.media` write is deprecated. It is still accepted and read as `ServiceOpts`: its `user` is now checked as that user, whatever its `overrideAccess` says, and its `role` and `permissions` are ignored, because a person's roles are read from their account. A context with no `user` stays trusted, and a key scope it carries (`authenticatedScope`) is still used, as on `ctx.services.collections`.

  On the plugin services that take `ServiceOpts` (`ctx.services.collections` and `ctx.services.media`), `{ as: "system", user }` stays trusted and now keeps the user, so the write is attributed to them: a folder records them as its creator, and collection hooks are handed them. The user is for attribution only: no role lookup runs for it, so hooks on such a call see the user with no roles.

- [#2319](https://github.com/nextlyhq/nextly/pull/2319) [`aefa10b`](https://github.com/nextlyhq/nextly/commit/aefa10b422b36e409425c14516ac00ad137ae824) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly migrate` now creates the table a project's user fields are stored in (`user_ext`), with a column for each field defined in the config or in the admin, and adds the column for a field defined since. A database set up by `migrate` alone, as production databases are, had no such table until something ran `next dev` against it, so every read of a user field failed with "no such table". On SQLite the table was never created at all, at boot either: the statements that create it were sent through a call SQLite's driver doesn't have, and the failure was taken for "already exists". An existing database gains the table on its next `nextly migrate`. A user field declared `unique` now gets its unique index (on MySQL, a unique text field without `maxLength` is stored as `varchar(255)` so it can be indexed). `migrate` fails, naming the statement, when it cannot create the table, a column or an index for a reason other than its already existing; on MySQL, a unique text field created as TEXT before this release now fails that way, and changing the column to `varchar(255)` lets its index be made. With no config file found, `migrate` leaves the user fields alone rather than deleting the definitions of the fields the config declares.

- [#2634](https://github.com/nextlyhq/nextly/pull/2634) [`070c448`](https://github.com/nextlyhq/nextly/commit/070c4485ad03d350b22e7ed20c5863cfe6de4d73) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard has a Needs attention card, in place of Unpublished changes. It shows what is waiting for the reader, each as a link to exactly what it counts:
  - entries with unpublished changes, per collection, and each Single with them;
  - entries a scheduled release will publish in the next 7 days, per collection;
  - overdue releases, linking to the Releases list's overdue filter.

  Only kinds with something waiting are shown, and "All clear" when there are none. A kind the reader may not read is left out entirely, and a reader who may read none of them sees the card as not available. Counts stop at 99 per collection, and at 20 collections per kind, and then read "99+" or "N+". A small card shows the total and a short link per kind, a medium one a row per kind, and a large one each kind per collection.

  A saved dashboard's Unpublished changes card becomes the Needs attention card, keeping its place, or merges into a Needs attention card the dashboard already holds.

  Compatibility:
  - `CoreWidgetId` no longer includes `"core/pending-edits"`. A plugin naming it in `instead` or `alternatives` should name `"core/needs-attention"`.
  - A grouped widget result's buckets may carry `atLeast: true`, saying that bucket's count is a floor. Additive: a reader that ignores it reads every bucket as before.
  - New, experimental: the `system:attention` widget source, and `nextly/attention-keys`, the kinds and bucket keys its answer uses.

- [#2666](https://github.com/nextlyhq/nextly/pull/2666) [`6c95bd8`](https://github.com/nextlyhq/nextly/commit/6c95bd8c4d93d5a54e5e37fb01df024361c48815) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Needs attention card links to exactly what it counted. A grouped widget answer may carry `asOf`, the instant it was computed at, and the card measures its "publishing this week" link from that instant and the source's own window (`ATTENTION_DUE_WINDOW_MS`, from `nextly/attention-keys`) rather than the browser's clock. A Single's part key may carry the language its pending change was counted in, and its link opens that language.

  A kind whose lists were only partly read, with nothing found in those that were, now reads "Not all checked" rather than being left off the card, so the card never says all clear about lists it did not read. The source caps its per-collection parts at the widget limit and marks the answer `truncated` when more exist, and the small card links a spread kind's two largest lists before saying how many more there are.

- [#2537](https://github.com/nextlyhq/nextly/pull/2537) [`eee467e`](https://github.com/nextlyhq/nextly/commit/eee467e3400d6f10a475fdafb84f213cde9d1e7e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component placed directly in another component is shown in the admin again where the outer component is held in a named group or a repeater. There its value is stored, so it can be edited, and a required one can be filled. It's still left out, and not required, where the outer component is stored on its own (at the top level, or under rows, tabs, collapsibles or an unnamed group), and a value for it there is refused with `NOT_STORED`.

- [#2490](https://github.com/nextlyhq/nextly/pull/2490) [`a3da6e2`](https://github.com/nextlyhq/nextly/commit/a3da6e23260c77aa8ee382e0abe1e38546ede400) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component held inside a group or repeater, or inside a component held in one, is now validated against its own fields on every write, its own `validate` included; until now nothing judged it, so existing content that fails it is refused on its next save or publish. A component held in a group or repeater of another component is validated the same way; one placed directly in another component's fields is stored and validated where the outer component is held in a named group or a repeater, and elsewhere isn't stored, and a write that carries a value for it is refused with `NOT_STORED`.
  A held Single's first draft records the type of every component it holds, including those it didn't change, so a restore after a retarget stays correct.

- [#2345](https://github.com/nextlyhq/nextly/pull/2345) [`d4e1357`](https://github.com/nextlyhq/nextly/commit/d4e1357bfc120ff945c4a8e9f1726781c0a9cbf0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - New projects get the skills for coding agents again. `create-nextly-app` writes its bundled skills into a project only when they name the project's exact `nextly` release, and 0.0.2-alpha.68 shipped skills still naming 0.0.2-alpha.67, so a project made with it got none and was told so. Each release now stamps the skills with its own version when it is cut, and refuses to publish skills that name another release.

- [#2617](https://github.com/nextlyhq/nextly/pull/2617) [`2495e84`](https://github.com/nextlyhq/nextly/commit/2495e84503d2a31f96370e0d235e90837f7636b3) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Move to Next.js 16.4.1 or later and sharp 0.35.5 or later. Next.js releases before 16.4.1 (and before 15.5.28 on the 15 line) carry two critical advisories that allow unauthenticated remote code execution, and sharp before 0.35.5 carries the librsvg vulnerability one of them depends on:
  - [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) (critical): remote code execution in `use cache` functions returning typed arrays, Next.js 16.0.0 to 16.4.0, fixed in 16.4.1.
  - [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) (critical): remote code execution in Image Optimization when SVG files are used, fixed in Next.js 15.5.28 and 16.4.1, and by sharp 0.35.5 or later.
  - [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) (high): the librsvg vulnerability in sharp before 0.35.5.
  - [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) (high): denial of service in the App Router through Server Actions, fixed in Next.js 15.5.28 and 16.4.1.

  Every package that declares a peer on `next` now asks for `^15.5.28 || ^16.4.1`, and `nextly`'s optional peer on `sharp` asks for `^0.35.5`, so a project on an affected version sees a peer warning when it installs. Next.js 14 is no longer supported: no 14.x release fixes GHSA-2464-fhr4-w9xw. To upgrade, run `pnpm add next@latest sharp@latest` (or your package manager's equivalent).

- [#2606](https://github.com/nextlyhq/nextly/pull/2606) [`859d13a`](https://github.com/nextlyhq/nextly/commit/859d13aa0b549f88b7b5583d1947799a1a5cd6cc) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Projects scaffolded by `create-nextly-app` now ask for React `^19.3.1`, the version Nextly is built and tested with. They already get the newest Next.js at scaffold time. Inside the repository, the playground and the packages build and test on Next.js 16.4.2 and React 19.3.1. What the packages accept from an app is not changed by this release note: `next` is `^15.5.28 || ^16.4.1`, raised separately for the October security advisories, and React is 18 or 19 (`@nextlyhq/blocks-react`, `@nextlyhq/builder` and `@nextlyhq/plugin-page-builder` need React 19).

- [#2672](https://github.com/nextlyhq/nextly/pull/2672) [`b248448`](https://github.com/nextlyhq/nextly/commit/b24844852dce69d88a4305ca2f709591139c865b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly`'s published declarations are now written by the TypeScript compiler's own command line and then bundled by tsdown, instead of through tsdown's TypeScript plugin. What `nextly` publishes is unchanged: the same entry points, the same JavaScript, and declarations of the same meaning (one union is printed with its members in a different order). For contributors, `pnpm dev` still keeps `nextly`'s declarations current while it watches, now through the same two steps as `pnpm build`.

- [#2416](https://github.com/nextlyhq/nextly/pull/2416) [`bf1a301`](https://github.com/nextlyhq/nextly/commit/bf1a301660d5937bc9e2c842313467fa1db17741) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Nextly no longer writes `payload-types.ts`. Since 0.0.2-alpha.67 the generated types go to `nextly-types.ts`, and for those releases a project still holding a generated `payload-types.ts` had it turned into a one-line re-export of the new file. That bridge is gone: when the types path is left at its default, the generator writes only `nextly-types.ts` and leaves any `payload-types.ts` as it is, saying what to do.
  - **The re-export alpha.67 or alpha.68 wrote** keeps compiling. Change imports of `payload-types` to `nextly-types`, then delete it.
  - **A `payload-types.ts` an earlier version generated**, from a project that skipped those releases, is no longer turned into a re-export. Unless it was generated with `--no-declare`, it declares `module "nextly"` as `nextly-types.ts` does, so the two clash and TypeScript may use the old types. Delete it and change imports of `payload-types` to `nextly-types`.

  To keep the old name, set `typescript.outputFile` to it.

- [#2603](https://github.com/nextlyhq/nextly/pull/2603) [`28db6e8`](https://github.com/nextlyhq/nextly/commit/28db6e859aad30b5e031087f123f761b4affcdd7) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Node 20 is no longer supported. Every package now requires Node `^22.12.0` or `>=24.0.0`, and Node 24 LTS is the recommended version. Node 20 reached end of life in April 2026, and the test and build tools Nextly moves to next need 22.12 or later, so installing on Node 20 now warns about the engine range. Upgrade Node before you upgrade Nextly; nothing else in your project has to change. Configs compiled by the CLI now target Node 22, and apps and plugins created with `create-nextly-app` declare `@types/node` `^22`.

- [#2386](https://github.com/nextlyhq/nextly/pull/2386) [`a478b9d`](https://github.com/nextlyhq/nextly/commit/a478b9d46541130398709db1d9d2fd65ae031e0f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal: adds the building blocks of a single access decision — one caller shape, a decision that judges a caller, an action and a collection or Single the same way for every kind of caller, and a per-request memo of whole-target decisions. Nothing calls them yet, so no access answer changes.

- [#2620](https://github.com/nextlyhq/nextly/pull/2620) [`6190765`](https://github.com/nextlyhq/nextly/commit/6190765c9dec57f6dee058f6b43c523360aba879) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A widget's data function is typed to receive the batch's `scope`, and a card's data and a widget's `example` are held to one rule.
  - **`WidgetDataInput` gains `scope`** (`@experimental`): the same per-batch scope core's own sources share work through, so two cards needing one scan can ask for it under one key and run it once. An addition to what a data function is handed; nothing a widget declares changes.
  - **One rule for a card's data:** a value must reach the browser as itself and, for one of core's displays, have the shape that display draws, checked in that order. Startup's check of a declaration's `example` now asks this rule. No startup verdict changes: an example holding NaN, an infinity or an `undefined` array item was refused before, in the same words.

- [#2445](https://github.com/nextlyhq/nextly/pull/2445) [`ac210a9`](https://github.com/nextlyhq/nextly/commit/ac210a99bde5ae2bdda09147c7c31053e8c7a9f2) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The shared permission cache now works on MySQL: its writes used syntax only PostgreSQL and SQLite accept, so every write failed silently and each permission check recomputed. A stored grant now reads back as one on every dialect, and a role or role assignment taken away is seen by the next request on MySQL too, where a retirement made late in a second could keep the old answer until the next one.

- [#2641](https://github.com/nextlyhq/nextly/pull/2641) [`e7ff551`](https://github.com/nextlyhq/nextly/commit/e7ff551d2ba66c418849ab7170b9c59a93c3e8c9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-form-builder` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2469](https://github.com/nextlyhq/nextly/pull/2469) [`a4cc703`](https://github.com/nextlyhq/nextly/commit/a4cc703f008b15eb038bd67941a397f60acc8378) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A plugin's history writes are checked when it says who it acts for.

  `ctx.services.versions`' `setLabel`, `deleteWorkingDraft` and `autosave` take a new, optional trailing `ServiceOpts`. Existing calls, which pass none, are unchanged and stay trusted, as does `{ as: "system" }`. A write made as a person (`{ user }` or `{ as: "user", user }`) is judged as the REST history routes judge that person: it needs `update-<collection>` (or the Single's), then the document must be one they can read, refused as not found when it is not, and one they may update. An autosave also needs the entity's autosave to be on. `{ as: "public" }` and a plugin-defined person are refused as unauthenticated.

  On a checked write the person is the author, as on REST. Naming a version with no `by` records them as the one who named it, and an autosave with no `createdBy` is filed under them. A `by` or `createdBy` naming anyone else is refused, and nothing is written. The name recorded is the caller's own, never one the plugin passes. A label set for an API key records no namer, because a plugin does not know the key's own id, and naming the key's owner would put a person against a change they did not make. A page's history has no REST write to be judged as, so a checked write to it is refused. A checked label is refused, as not found, when the caller may not read the version's own language, as on REST. A checked label hands back its version as the caller may read it, with fields their read rules withhold left out. A checked discard goes through the same discard as REST, which holds the document while it removes the draft and records the discard in its history; one made with an API key is refused, because a plugin cannot name the key that would be recorded. A checked autosave made with an API key is refused for the same reason: filed under the key's owner, it would overwrite that person's own unsaved work.

  Every plugin autosave, checked or trusted, is now stored the way REST's autosave stores one, a list of rows included: without password values, and refused when the fields that say which values are passwords cannot be read. The snapshot the plugin passes is not changed.

  `CollectionsHandler`, its entry service and `SingleEntryService` gain `discardWorkingDraftCounted`, which discards as `discardWorkingDraft` does and answers how many drafts it removed. `discardWorkingDraft` keeps its signature on each.

- [#2463](https://github.com/nextlyhq/nextly/pull/2463) [`e2081f0`](https://github.com/nextlyhq/nextly/commit/e2081f0053ee966c2c8381e166ae7ffbf5a3aa97) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `nextly migrate` now checks every plugin's migration history before it changes
  anything, the core tables included, and refuses — naming the plugin and the
  migration — when:
  - a plugin lists its migrations in an order other than the order of their
    names, which is the order they run in (also refused wherever the
    configuration loads, so such a list stops the app from starting, not only
    `nextly migrate`);
  - a migration the database records as applied has been edited, removed or
    renamed;
  - a migration that has not run is ordered before one that has.

  Lists written by `nextly migrate:create --plugin` are already in name order,
  so only a list edited by hand is affected: list the migrations in name order,
  restore the applied migration, or give a new migration a name that sorts after
  the applied ones. A migration rolled back by hand from the middle of a plugin's
  history is refused the same way until the migrations after it are rolled back
  with `nextly migrate:down --plugin`; then run `nextly migrate`.
  `nextly migrate:resolve --applied` does not take plugin migrations.

  A plugin migration whose run was stopped after its statements committed — on
  MySQL, which commits schema statements as they run, or one marked to run
  outside a transaction — is now recorded as applied on the next run when its
  statements are exactly the schema change `nextly migrate:create --plugin`
  writes for it and the database stands at its result.
  Before, it was refused until `nextly migrate:resolve --failed-cleanup`. A
  migration that also changes rows, whose result is its starting point, or
  whose statements were written or edited by hand, is still refused, with the
  same advice.

  A drift refusal now names the column, check or foreign key it found different,
  where it used to say only the kind of change.

- [#2653](https://github.com/nextlyhq/nextly/pull/2653) [`9c111af`](https://github.com/nextlyhq/nextly/commit/9c111af9b554bea634e0f51f0f1ac38be777dbf4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-page-builder` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2599](https://github.com/nextlyhq/nextly/pull/2599) [`e03de7d`](https://github.com/nextlyhq/nextly/commit/e03de7de38e053129a4158f53d72d024f9e26e89) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A new plugin from `create-nextly-app` gets Vitest 5 (`vitest ^5.0.5`) instead of Vitest 4, with `vite` declared beside it (Yarn installs no peers, so `yarn test` could not load Vite without it).

  Vitest 5 needs Node 22.12 or later, so the plugin's `package.json` now says so in `engines` (`^22.12.0 || ^24.0.0 || >=26.0.0`).

  In a test written for Vitest 4, check for these:
  - `expect(promise).resolves` or `.rejects` that isn't awaited now fails the test.
  - Mock call history is cleared before every test (`clearMocks` is on by default).
  - `vi.mock` and `vi.hoisted` inside a function or block now throw.

  The full list is in Vitest's migration guide: https://vitest.dev/guide/migration

- [#2647](https://github.com/nextlyhq/nextly/pull/2647) [`0295a2e`](https://github.com/nextlyhq/nextly/commit/0295a2e6f8b78393db17121bf90a69016293cb6e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/plugin-sdk`'s declarations are written by oxc from its own annotations, and are the same as before. `Secret` still redacts itself under `util.inspect` and `console.log`. Plugin migrations generated by `nextly migrate:create --plugin` now end `satisfies PluginMigration as PluginMigration`, so a module's declaration is its type; what a migration contains, and its checksum, are unchanged.

- [#2419](https://github.com/nextlyhq/nextly/pull/2419) [`d9b2d6a`](https://github.com/nextlyhq/nextly/commit/d9b2d6a0f0ee5fe64683c1a73b97795e2319b2f8) Thanks [@aqib-rx](https://github.com/aqib-rx)! - `nextly plugins uninstall` now refuses to run its DOWN migrations when the
  plugin's `onUninstall` replaced one of the tables they drop by renaming it
  away and creating another under its name. Before, only
  the name was checked, so the approved drop took the replacement, and the
  original table and its rows survived under the other name while the plugin
  was recorded uninstalled. Each table is now identified by what the database
  keeps for it (its oid on PostgreSQL, its creation time on MySQL, its root page
  on SQLite), read before the hook's boot and again after the hook. On MySQL the
  creation time has one-second resolution and changes on any `ALTER TABLE`, so a
  hook that alters one of those tables is refused, and a replacement created
  within the same second as its original is not detected. On SQLite, where a root page can
  be given to a new table, a hook that changes the schema at all is refused
  too. The refusal comes after `onUninstall` has run but before any DOWN
  migration, so no table is dropped and every module is still recorded as
  applied. A table whose identity can't be read is refused before the hook
  runs.

  A disabled plugin's transform that moves a field into another group or tab
  keeps that field's access rule even when the collection has an index with the
  same name as the field. Only fields are now matched by name.

- [#2340](https://github.com/nextlyhq/nextly/pull/2340) [`b9790cd`](https://github.com/nextlyhq/nextly/commit/b9790cdad91ba9020909df6ac9d1a556557912a8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly plugins install --all` installs every enabled plugin in your config, in
  dependency order, and stops at the first that fails. A disabled plugin is
  skipped and named. It is what a fresh database needs before its first
  production boot, which refuses a configured plugin no install has recorded.
  `nextly plugins install <name>` is unchanged.

  A production boot no longer requires a disabled plugin (`enabled: false`) to be installed. Before, a config that disabled a plugin could never boot in production, because the install refuses a disabled plugin. A disabled plugin's tables still exist, since its schema still applies, but its `onInstall` runs only once it is enabled and installed; the boot then requires that install like any other. A disabled plugin that was uninstalled, or whose uninstall stopped part way, is still refused.

- [#2565](https://github.com/nextlyhq/nextly/pull/2565) [`64bac79`](https://github.com/nextlyhq/nextly/commit/64bac79797c136cf2f4c0d152a3b1bb6811883f6) Thanks [@faisal-rx](https://github.com/faisal-rx)! - What a read that populates relationships shows its caller is decided by the one access decision. No answer changes: a key is judged on its own stored scope, a declared read rule still decides alone for a signed-in user, a visitor keeps the public default and media, and a row the caller could not read by name is still withheld.

- [#2390](https://github.com/nextlyhq/nextly/pull/2390) [`1dcec94`](https://github.com/nextlyhq/nextly/commit/1dcec943fdd6845ef54744dd50b3c5eba487ac0a) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Preview links are now recorded one by one. A document's live links can be listed, with who made each, when it ends and how many times it was opened, and any one of them can be revoked, which ends it on its next opening and in any session it already opened. All of one entry's or Single's links can also be revoked at once. Sharing, listing and revoking a document's links all need the same permission: being able to share a preview of that document. The list, revoke-one and per-document revoke-all endpoints are `@experimental`. Run `nextly migrate` after upgrading to create the `nextly_preview_links` table; until then, sharing a new link is refused with that remedy. Links made before the upgrade keep working until they expire, and both revoke-alls still end them.

- [#2540](https://github.com/nextlyhq/nextly/pull/2540) [`0058669`](https://github.com/nextlyhq/nextly/commit/0058669a5083274e200d81aba9c881e7bb7e4a10) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A preview link's sharer is judged in the language the link is to. When an entry's link names a language, the sharer's read and edit of the entry are asked in that language when the link is made and every time it is opened, so a read rule that closes another language no longer stops the link from being minted; a link naming no language is asked in every language, as before. A Single's link now asks its sharer in its language at every open too, not only when it is made. An entry link for one language no longer answers for another translation of the entry. A preview link is still honoured only by the preview render: REST, the admin, the Direct API and plugin routes judge a request that carries one as its sender.

- [#2726](https://github.com/nextlyhq/nextly/pull/2726) [`4205cec`](https://github.com/nextlyhq/nextly/commit/4205cec2836c02fd4b9419aab0fcaeff0a23c35a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A collection publish whose pending change edits a field the publisher may not write, inside a group the publisher sends with the publish, is refused again and the pending change is kept. The field gate keeps that protected value at what the live row holds, so the publish had read the change as no change at all, published, and deleted the draft with the edit in it. A protected value the pending change adds inside such a group is refused the same way. A publish that sends a group with a protected child at its live value, where the pending change left that child alone, now publishes rather than being refused.

- [#2512](https://github.com/nextlyhq/nextly/pull/2512) [`4beae2b`](https://github.com/nextlyhq/nextly/commit/4beae2b80b9a5bcee4d4f7448ea9909dda378725) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Publishing a language's pending change no longer puts back a shared value that someone else published after the change began. A pending change records the version it began from when the document's last 25 versions still hold one with the live shared values. One without such a base, which includes every pending change begun before this release, is refused while any shared field it holds differs from the live value, its own edits included. Taking the live values replaces those edits in the fields the caller may write; a field the caller may not write, or a shared part of a translated component, keeps its edit to be copied by hand, and the change stays unpublishable until it is. When a shared field's live value has moved on since, the publish is refused with a 409 that names the field (fields the caller can't read are counted, not named), and nothing changes. Taking the live values for the pending change brings it up to date, and the next publish goes through. The refusal's data is `{ reason, fields, hiddenCount? }`, exported as `SharedFieldsConflictPublicData` from `nextly/errors`; `reason` is `shared-fields-out-of-date` here. When every language of a Single is published together, the later edit's value is kept for a shared field two languages both changed. When version history can no longer show which edit was later, that publish is refused instead, with the reason `shared-edits-unordered`, and publishing one language at a time settles it.

  Publishing a language's pending change no longer puts back a shared component or a shared many-to-many relation that someone else published after the change began. These are now checked against the change's base like the shared columns: an out-of-date one is named in the 409, and taking the live values brings it up to date. Components are compared by content, so a publish that only rewrote a component's rows doesn't refuse anyone. A component whose values are kept per language is judged by its shared parts: its instances and the sub-fields it marks shared. Publishing every language refuses with the reason `shared-edits-unmergeable` when more than one language is pending and any of them changed such a component's shared parts, since each language's copy would write over the others'; publishing one language at a time settles it. Taking the live values is also available over REST, at `POST …/versions/working-draft/take-live?locale=` for a collection entry and a Single, and in the admin: a publish refused over out-of-date shared fields offers "Take the live values" on the refusal itself, keeping the editor's own edits.

- [#2372](https://github.com/nextlyhq/nextly/pull/2372) [`9bb7abe`](https://github.com/nextlyhq/nextly/commit/9bb7abea38f8c33eb4c5c9ea770b768d3216a590) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A subject's content events can now be read: a document's, or a release's, filtered by kind and part, newest first, page by page. All `@experimental`.
  - REST: `GET /collections/{slug}/entries/{id}/events`, `GET /singles/{slug}/events`, and `GET /content-events?subject=collection|single|release&slug=&id=` for releases and deleted documents. Each takes `?kind=`, `?part=`, `?limit=` (1 to 100) and `?before=` (the last item's id).
  - Direct API: `nextly.contentEvents.list({ subject, kinds, parts, limit, before })`.
  - Plugins: `ctx.services.versions.listEvents(subject, query, opts)`.

  A caller reads a document's events when it may read the document, through the same check as its version history. A deleted document's events are read by whoever may read its collection or Single. Where its read rule is a function, only a super-admin signed in reads them; where read hooks may narrow its reads, only trusted server code does, since neither can be asked about a row that is gone. A release's events are read with release read authority. A refusal answers not found. Each read shows one life of a document id: a document deleted and made again under the same id does not mix its two histories.

- [#2619](https://github.com/nextlyhq/nextly/pull/2619) [`276d4ab`](https://github.com/nextlyhq/nextly/commit/276d4aba2d48771abde2bc5524fe40c613358fff) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Recent activity card is now an ordinary framed card, answered by a new `system:activity` widget source through the dashboard's batch request, the same way the other cards are.
  - `system:activity` makes the same read as `GET /api/dashboard/activity`, through the same service call: the same per-row read check, the same grouping of repeated saves, the same row limit. The card and the endpoint show a reader the same rows. The source refuses any query field it doesn't answer (a filter, a sort, a status).
  - The card has a "Number of items" setting (1 to 25, 5 by default) and draws the rows its size allows. When there are more, it says "More exist", like the other list cards. With nothing to show, it uses the standard empty state.
  - A custom widget can ask to be sized like core's lists, with `sizedQuery: true` (experimental) on a widget whose query is a list: the dashboard then asks it the rows its size draws and one more, so it can say more exist. The Recent activity card does this. A custom widget that doesn't is asked exactly its declared query, as before.
  - `WidgetComponentProps` gains an optional `query` (experimental), the query the card asked with its reader's settings applied, and an optional `onRetry` (experimental), the Retry a framed card's error offers, which a custom card can now offer on its own error.
  - Recent activity now leaves out collections kept off the dashboard (internal, or hidden from the admin's navigation, such as the page builder's patterns and layouts), for every reader, super-admins included. This is the rule the dashboard's other cards and its 24-hour activity count already apply. If the collections registry can't be read, the feed shows no rows rather than risk showing a hidden collection's, as the count shows none.
  - The activity read applies one row limit for every caller: 5 by default, at most 50.
    - `GET /api/dashboard/activity` already clamped to 1–50 with 5 by default, so it's unchanged, `?limit=0` and a non-number still answering the default.
    - A direct caller of the activity service that passes no limit now gets 5 rows instead of 10.
  - `RecentActivity` (the section reading the endpoint) and `useRecentActivity` stay exported, deprecated; the dashboard no longer uses them.

- [#2597](https://github.com/nextlyhq/nextly/pull/2597) [`365a5e7`](https://github.com/nextlyhq/nextly/commit/365a5e70b3e40cc7bec459eda24d9f594b47619a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recent activity shows one person's repeated saves of one document as one row with a count: "updated Site style · 12 times", at the latest save's time. The activity trail still keeps every save as its own row; only the feed groups them.
  - A save joins the row before it when it is the same person's update of the same entry or Single, made within 10 minutes of the next later save in the row. A long editing session stays one row.
  - A row someone can't see doesn't split a group for them, so the grouping never hints that something happened in between.
  - Creates, deletes, settings changes, and any save that published or unpublished stay rows of their own, even a save that also edited fields.
  - A page of the feed always ends after a whole group. The activity service's result carries `next`, a position strictly after the oldest save of the last row shown, and `getRecentActivity` takes it back as `before`. `offset` still counts rows of the trail, not of the feed.
  - Each feed row carries `count`, `countAtLeast` (true when the read stopped inside the group, drawn as "N+") and `firstCreatedAt`. These are additive response fields. The "changes in the last 24 hours" figure still counts every save.
  - Until a Single's saves record which fields they changed, publishing a Single isn't told apart from saving it, so it can join that Single's group.

- [#2501](https://github.com/nextlyhq/nextly/pull/2501) [`2fc555e`](https://github.com/nextlyhq/nextly/commit/2fc555ecc72b84a602e13c4886046902ea8bbb52) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's "Changes (24h)" figure now counts only the changes the reader may see. It is counted by the same check as Recent activity, so a change to a document the reader may not open is no longer counted, for collections and Singles alike. On a busy install the count stops after reading the latest 1,000 changes, and the figure reads what it found with a `+`; `/stats` says so with a new `recentChanges24hAtLeast: true`.

- [#2733](https://github.com/nextlyhq/nextly/pull/2733) [`acc0b50`](https://github.com/nextlyhq/nextly/commit/acc0b5083301c6011fa7ab9251c6b6805b65fde0) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recent entries and Over time, two content widgets offered from a collection's group of the add panel.
  - **Recent entries** (`core/recent-entries`) lists a collection's entries changed most recently, every row a link to its entry, with a "View all" link to the collection's list under the card's Filter and Sort. Small lists titles; medium adds each row's status and when it was updated; large is a table. Its Collection setting declares `rows: "titled"`: the card asks each row's title field, its status where the collection has a lifecycle, and `updatedAt`, and a collection naming no title is not offered it.
  - **Over time** (`core/over-time`) draws how many entries a collection gained in each interval of its Date range, its quick setting: 7 or 30 days by day, 90 days by ISO week, 12 months by month. Every interval the range overlaps is drawn, the first counting only what falls inside the range. Chart style draws it as a line or as bars.
  - **Widget queries** take `range` on a timeseries (`"7d"`, `"30d"`, `"90d"`, `"12m"`): the server derives the interval, the intervals drawn and the range's first instant. A query sending `range` with `since`, `until` or `interval` is refused.
  - **Published collection sources** carry `titleField` where the reader is offered that field, and the knobs' context offers `sourceOf`.
  - **Cells cards:** a setting only a cell source's filters would apply is refused at registration, as is a contributed custom card declaring both a query and cells; a card first drawn below every cell's tier asks for its cells once it widens.

  All of it is `@experimental` while the content widgets are built.

- [#2693](https://github.com/nextlyhq/nextly/pull/2693) [`18e57b7`](https://github.com/nextlyhq/nextly/commit/18e57b7ed6e2f08ae40f72bde7d6f9b74f8e33da) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recently edited draws each row as a link to its document: titled "Untitled" when it has none, and from medium up its collection, who saved it, when and its status. An empty card names the span the trail keeps ("No edits in the last 90 days"), from an optional, experimental `window` on a list answer; a span under a day is not stated. A publish of pending edits takes the row from the person who made them only when its own request changed something they had not.

- [#2678](https://github.com/nextlyhq/nextly/pull/2678) [`a4f8978`](https://github.com/nextlyhq/nextly/commit/a4f89781a2513c179dedcc2049726b85e1154f1a) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Recently edited now lists the entries and Singles most recently saved, newest first, one row per document at its latest save the reader may see, across every collection they may read. It reads the activity trail, the same one Recent activity reads, through a new source, `system:recent-edits`, and each row carries the document's status now and whether it has changes not yet published. A publish or an unpublish on its own is not a save, and a promotion of pending edits keeps the editor's row.
  - **The trail says when a write published.** Every path that can publish an entry or a Single marks its row `published: true`, so a promotion of pending edits, which leaves the status published, is no longer read as a save, and Recent activity keeps it out of a run of saves.
  - **A Single's save names the fields it changed**, compared by value as an entry's are, on every install.
  - **No id where a title belongs.** A save of an untitled entry stores no title, instead of the entry's id.
  - **`WidgetSource` gains `filters`** (`@experimental`): the card settings a source narrows by rather than being replaced by. `system:recent-edits` takes `collection` and `onlyMine` as top-level `where` keys, and query validation admits exactly those.

- [#2686](https://github.com/nextlyhq/nextly/pull/2686) [`3241734`](https://github.com/nextlyhq/nextly/commit/3241734af409a5ae641b9faeddf495d5beb6e4ce) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Every refusal is answered in the error body every other error already uses.

  A request the REST route gate, the media routes, the admin's workspace and sidebar routes, an API key's budget, the REST rate limit, the sign-in rate limit or the exported `auth/guards` helpers refuse is now answered as `{ "error": { "code", "message", "requestId" } }`, with `Content-Type: application/problem+json` and the request id also in `x-request-id`, as every other error is. The status, and the message, are unchanged. Headers such as `Retry-After` and `X-RateLimit-*` stay headers; a limit's retry hint is also in `error.data.retryAfterSeconds`.

  **Upgrading:**
  - A client that read a refusal's `data.error`, `data.message` or `data.code` reads `error.message` and `error.code`.
  - The REST rate limit's and the sign-in rate limit's code is now `RATE_LIMITED`, the code every other limit answers with; it was `RATE_LIMIT_EXCEEDED`. `error.retryAfter` is now `error.data.retryAfterSeconds`.
  - `createJsonErrorResponse` from `auth/guards` returns the same body, so a route built on `requirePermission` or `requireApiKey` answers as the rest of the API does. Pass the request as its second argument to answer with the request's own id; without it a new id is made.
  - A public media URL that serves no file answers its 404 with the same body rather than an empty one.

- [#2276](https://github.com/nextlyhq/nextly/pull/2276) [`b273c12`](https://github.com/nextlyhq/nextly/commit/b273c12f05826b65e4eda55cdbf822a3c3f19f2e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard widget whose component the admin can't load no longer draws an empty card: in development the generated
  component map is rewritten, and in production the admin refuses, naming the widget and the command to run.
  Apps opt in by calling `checkAdminComponents` (from `nextly/runtime`, experimental) in their admin layout; see the admin UI docs.

- [#2099](https://github.com/nextlyhq/nextly/pull/2099) [`a1ecead`](https://github.com/nextlyhq/nextly/commit/a1ecead9094a3fbe9633324ba7d3a7f24076bf5e) Thanks [@aqib-rx](https://github.com/aqib-rx)! - App tables can no longer be named `accounts` or `sessions`. Those are retired auth table names, and `db.schema.extend` now refuses them with a message naming the reserved name.

- [#2171](https://github.com/nextlyhq/nextly/pull/2171) [`33ab4ae`](https://github.com/nextlyhq/nextly/commit/33ab4ae8caf02ebf30da1120314fcb9526ba2ab7) Thanks [@aqib-rx](https://github.com/aqib-rx)! - A migration can no longer change another owner's table, column, index or constraint in a form the guard cannot read. A column or constraint the same migration adds to a table may be changed later in that migration, and is no longer refused as the other owner's. An ALTER TABLE that names an index, and MariaDB's ALTER KEY on another owner's index, are refused.

- [#2304](https://github.com/nextlyhq/nextly/pull/2304) [`0a95cd3`](https://github.com/nextlyhq/nextly/commit/0a95cd31a189372fca42cb1c3ffea686b593f2bd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - **Self-registration is now off by default.** The registration route refuses
  every sign-up, creating no account and sending no email, unless the app turns
  it on with `auth.allowRegistration: true` in its Nextly config.

  Upgrading: an app whose users sign themselves up must add
  `auth: { allowRegistration: true }`, or registration answers 403 "Registration
  is not open." An account already registered and awaiting verification can
  still complete it by its link. No migration is needed.

  **A registered account never becomes the install's first administrator.**
  Until now, whoever created the first account on an empty install, through
  registration included, was made Super Admin. Now a registered account never
  is. An account the app provisions itself (its admin or its own server code)
  becomes the administrator only when it is the install's very first account;
  once any account exists, a sign-up included, an account the app creates is
  never promoted. Setup creates the administrator whenever nobody holds the
  Super Admin role, so a role-less account registered first never blocks it. Two
  accounts provisioned at once on an empty install leave exactly one
  administrator, on every database; before, both could become Super Admin.

  **Setup stays open until someone holds the Super Admin role**, rather than
  closing at the first account, so the owner can still create the administrator
  after a stranger has registered. An install that has accounts but where nobody
  holds Super Admin now reports setup as open: give one of its accounts the role
  before upgrading. An administrator whose authority comes through a role that
  inherits Super Admin counts as one. Setup never takes over an existing account:
  an address that already has one, such as a sign-up, is refused.

  Setups racing on an empty install make exactly one administrator: the others
  are answered that setup is complete, and create no account.

  **For code that builds the auth router's dependencies itself** (`AuthRouterDeps`
  from `nextly/auth`): `getUserCount` is replaced by `hasAdministrator`, which
  answers whether anyone holds Super Admin; `allowRegistration` is added; and
  `createSuperAdmin` may resolve to `null` when another setup made the
  administrator first. Apps that use Nextly's own route handlers need no change.

  Creating the Super Admin role from two requests at once no longer fails on
  MySQL with a duplicate. On MySQL, creating it next to an existing role that
  already has the name "Super Admin" no longer turns that role into the
  administrator role; it is refused, as on PostgreSQL and SQLite.

- [#2518](https://github.com/nextlyhq/nextly/pull/2518) [`54b2069`](https://github.com/nextlyhq/nextly/commit/54b2069484280349e8b2ad5748452bf8fba8d5cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Releases calendar's day counts, today's date and the day list's Today label are now drawn in colours that stay readable under any brand colour.

  A release's readiness report now counts a link to a deleted document under every field it is linked from, so each field's total is right.

- [#2510](https://github.com/nextlyhq/nextly/pull/2510) [`8eaa797`](https://github.com/nextlyhq/nextly/commit/8eaa797fe5c4fc2ed1e342ae36a67c4185353245) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Releases calendar now shows every day's complete count, with a "+N more" that opens the day's full list, and puts a release on the day it actually went out; it marks today, offers a time-zone choice that decides which day a release falls on, and works by keyboard alone. The Releases list's Scheduled badge is now drawn in the neutral colour, so it stays readable under any brand colour.

- [#2394](https://github.com/nextlyhq/nextly/pull/2394) [`0d773a3`](https://github.com/nextlyhq/nextly/commit/0d773a3769e48a6963cb42f536c312a6968d358f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A scheduled release is now stopped as soon as a hard problem appears, not at its time, so no reader is shown the effect of a release that cannot run. Saving or deleting one of its documents, changing a user's roles or a role's grants or slug, deactivating a user or changing their email or name, changing a collection's or Single's schema, and a registered check source's signal each check the scheduled releases holding what they changed, including one whose time has passed and which no job pass has run yet. A soft problem never stops a release. What these events do not report (a role expiring at a set time, a user deleted, a collection changed through the collection dispatcher's metadata path, changes made outside Nextly's writes, access rules changed in code) is still stopped by the job pass at the release's time.

  Whichever way a release stops, its owner is given one `releases.stopped` notice, recorded with the stop: once per stop, and again if it is rescheduled and stops again. A hard check source outside core must now declare a `signal`, which replaces the unread `stopsEarly` field.

- [#2495](https://github.com/nextlyhq/nextly/pull/2495) [`05b07bd`](https://github.com/nextlyhq/nextly/commit/05b07bd764147af3b7bfb5603fb7482a1c951c31) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now keeps its own history in the record of content events. Each release operation records an event, with the release as its subject, in the same transaction as the change: created, documents added, removed or switched between going live and coming down, scheduled, rescheduled, Publish now, started, published, stopped, cancelled, renamed, description changed and deleted. Each names who acted: the person, an API key by its own id and name (never the person who owns the key), or the system for the run and its stops. Read it with `GET /api/content-events?subject=release&id=<id>` or `nextly.contentEvents.list({ subject: { kind: "release", id } })`.

  A cancelled release that was scheduled can now be deleted when its history shows it never began publishing: one scheduled and cancelled before its moment goes, while one that started publishing (stopped part-way, or cancelled mid-run) is still kept with `was-scheduled`. A release created before this version has no recorded history and keeps the earlier rule. **Compatibility:** a Direct API call to a release write that forwards an API key's `authenticatedScope` must now pass the key's `apiKeyId` with it, so the change can name the key; one without it is refused with `INVALID_INPUT` before anything is written. REST requests carry the key's id already. All of this is experimental until the releases redesign is complete.

- [#2503](https://github.com/nextlyhq/nextly/pull/2503) [`63f1af9`](https://github.com/nextlyhq/nextly/commit/63f1af9797855ad8fb7f970d232929b8b7a32c4d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release's history lists only the documents the reader may read, as the release's document list does: an event about a document the reader may not read is left out, while events about the release itself stay whole. A page of it scans a bounded stretch of history and answers where it stopped in a new optional `meta.nextBefore`, the `before` to pass for the next page, so it can come back short or empty while more remains. A run's write of a release document takes the release's lock and is refused when the document is no longer in the release, so a document whose release was deleted, or which was taken out of its release, while the run was writing it is left as it was. A person's name in a release's history is read under their account's lock, so a deleted account's name is erased from it like the rest of their events.

  Publish now on a release already due now records its `release-publish-now` event, and refuses an API key's scope passed without its `apiKeyId` before running anything, as Publish now on any other release does. The `committed` delete refusal now says that a cancelled release that never began publishing can then be deleted. All of this is experimental until the releases redesign is complete.

- [#2509](https://github.com/nextlyhq/nextly/pull/2509) [`d11cf5f`](https://github.com/nextlyhq/nextly/commit/d11cf5f7f854c9fd9b6174155a8283d9656e3906) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release reader who may not read a linked document now gets a count, never a
  classification, for links to it: the same one hidden count whether the linked
  document is live, a draft, coming down or no longer there. This is decided
  before anything else is said of the link. A link to a document that no longer
  exists is now reported as deleted only to a trusted caller.

- [#2393](https://github.com/nextlyhq/nextly/pull/2393) [`4ec73b9`](https://github.com/nextlyhq/nextly/commit/4ec73b9768f16fc58fcca5e562177b8b8e2f40fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release pass that the host ends part-way, at a serverless function's time limit for
  example, now makes progress on the next pass. Each document's write records, in the same
  transaction, that its release member was applied for the release as it stands, so the next
  pass writes only the documents still to go and settles their releases, and hooks and outbox
  events no longer run twice for the documents already written. Rescheduling, cancelling or
  otherwise changing a release voids those records, so its documents are written again.

  Whether a refused write counted is now decided by that record rather than by reading the
  document back: a release whose author may no longer publish a document is no longer marked
  published because the document already read as live, and a read hook that rewrites `status`
  changes nothing. `nextly migrate` and boot add one nullable column, `applied_revision`, to
  `nextly_release_members` on every dialect; no row is rewritten. It is internal: release
  members returned by the Direct API and REST do not include it.

  Compatibility: `applyDueReleases`, exported from the package root, is experimental, and its
  dependency ports change. A custom `repository` passed to it must now provide
  `isMemberApplied(memberId, revision)`, return `appliedRevision` on the rows from
  `listMembersOf`, and replace `markReleasePublished(id, at)` with
  `markReleasesPublished(entries, at)`, which settles a whole component of releases, each fenced on
  its planned `{ revision, scheduledAt }`, or none of them; custom `mutations` no longer provide
  `applied`, and their `publish` and `unpublish` receive a `receipt`. The built-in drain job (`createReleasesDrainJob`) needs no
  change.

- [#2459](https://github.com/nextlyhq/nextly/pull/2459) [`8462f9e`](https://github.com/nextlyhq/nextly/commit/8462f9e899f9318b0e7a46eade35199ebc4d7ca1) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now shows each reader only the documents they may read. Its members, its problems, what blocks it, a scheduling refusal and the search for the releases holding a document name only documents the reader could open in that collection's own list. The rest are counted by collection, as in "2 documents you can't view · posts", with no title, id or field. The counts and the readiness still describe the whole release, so a release blocked by a document the reader cannot see still reads as blocked, and the admin's schedule dialog says why instead of offering a schedule the server would refuse.

  New, experimental: `nextly.releases.membersOf` and `nextly.releases.blockersOf` return the readable documents with the rest counted in `hidden`; `readiness` and `readinessOf` answers carry `hidden`; REST list answers for a release's members and blockers carry `meta.hidden`, omitted when nothing is hidden.

  Compatibility, for plugin authors: `nextly.releases.listMembers` and `blockingReasons`, called acting for a user (`overrideAccess: false`), now return only the documents that user may read, and `find({ containing })` answers as if a document the user may not read were in no release. Trusted calls (the default `overrideAccess: true`) see every document as before. Code that needs the full count for a user should read `membersOf` or `blockersOf` and add `hidden`; code that must act on every document should call as a trusted caller.

- [#2460](https://github.com/nextlyhq/nextly/pull/2460) [`19b8619`](https://github.com/nextlyhq/nextly/commit/19b86192976409e9fa030444770b6139079dcc25) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A release now notes, for each document going live, the documents it links
  to through its relationship and upload fields (field groups and blocks
  included) that will not be live at the release's moment: drafts nothing
  publishes by then, documents a release takes down by then (another release, or this one), and
  documents that no longer exist (named as deleted only to a trusted caller). It is a soft problem, `UNPUBLISHED_LINK`, in
  the release's readiness, and never stops scheduling, Publish now or the run.
  Adding a document to a release answers with the same links as
  `unpublishedLinks` (experimental), so a client can offer to add them too. A
  link from a document the caller may not read is only counted, and so is every
  link to a document the caller may not read, whatever that document is (live, a
  draft, coming down or deleted); one in a field the caller may not view names
  neither the field nor the document.
  Files in the media library are never reported, and links inside rich text
  are not checked yet.

  `nextly.releases.addMember` now returns the member with `unpublishedLinks`
  beside it; the member's own fields are unchanged.

- [#2418](https://github.com/nextlyhq/nextly/pull/2418) [`1ddc8b2`](https://github.com/nextlyhq/nextly/commit/1ddc8b28d9e593b501d619593d78d9602291d6cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The Releases list is now a table with four tabs, Upcoming, Needs attention, Drafts and Done, each showing how many releases it holds; every release is in exactly one of them. The list pages like the other admin tables ("Showing 1–25 of N", page buttons and rows per page), and its search looks at titles and descriptions across every page, not only the rows on screen. The tab is kept in the address, so `?tab=attention&reason=overdue` opens Needs attention narrowed to overdue releases.

  Each row shows when the release runs, with how far away that is ("in 3 days"); how many documents it holds and what it does with them ("5 go live, 1 comes down"); how many are ready, with a bar and a count of those that need a fix; its state, with an icon and a word, so a stopped or overdue release is never told apart by colour alone; its owner; and a menu of the actions the reader may take (schedule or reschedule, publish now, cancel, delete). A release holding a single document is marked as one, and a switch hides them. Each tab says what it holds when it is empty, and with no release at all the list explains what a release is.

  Times are shown in the reader's own time zone. Where a release was scheduled in a zone whose clock reads differently, the time there is shown too, labelled as scheduled: "Fri, Oct 16, 2026 10:00 PM your time · Sat, Oct 17, 2026 7:00 AM Asia/Karachi (as scheduled)".

  The releases API gains two reads for a page of releases at once, both experimental. Each release on the REST list now carries `memberCounts` (`total`, `goLive`, `comeDown`), read for the whole page in one query; from the Direct API, `nextly.releases.memberCounts({ releaseIds })`. `GET /api/releases/readiness?ids=…` and `nextly.releases.readinessOf({ releaseIds })` answer up to 50 releases' readiness in one request, each exactly as the single read answers it and under the same permission; a release holding more documents than the limit comes back unchecked, and more than 50 ids are refused with a 400. The admin list uses them, so a page's rows cost two requests in all, rather than two per row.

  Each release on the REST list also carries `owner` (experimental): an id and a name, nothing else, read for the whole page in one query and named by the same rule as version authors. An owner whose account was deleted is `null`, and the admin table reads "Owner unavailable" for them.

- [#2437](https://github.com/nextlyhq/nextly/pull/2437) [`f7cc26c`](https://github.com/nextlyhq/nextly/commit/f7cc26c02e832bd9fb25e4464bac2e7332cb08f1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Outside development and test, Nextly no longer writes to the console directly anywhere but its command-line output: boot, service registration, the REST dispatchers and route handlers, runtime, storage, middleware, the event and filter registries and the seeders now log through `consoleLogger` or the logger in hand, so their lines are masked of email addresses and carry its `[INFO]`/`[WARN]`/`[ERROR]`/`[DEBUG]` prefix.

- [#2370](https://github.com/nextlyhq/nextly/pull/2370) [`1e156b6`](https://github.com/nextlyhq/nextly/commit/1e156b6e55c8eafb2a467cc7f6791b606c9deaa8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A translated field renamed in the Schema Builder keeps every language's value, for a collection, a Single or a field group.
  - Renamed while it stays translated, its values move with it when it is the only field removed and the only field added in the save, with a compatible type: the translations table renames its column, where it used to drop the old column and add an empty one.
  - Renamed and made shared in the same change, the default language's value becomes the shared value and the other languages are written to the localization archive under the new name, restorable with `nextly i18n:restore`.
  - The schema dialog lists the rename as one, on the translations table, and keeps the values when it is chosen.
  - A rename that also changes how the field is stored (its length, its precision, or its type to a compatible one) is refused before anything runs, naming the two saves that work: rename it and save, then change its storage. A change to an incompatible type is not a rename, and neither are several translated fields renamed in one save or a rename saved with another field added: a save that removes a translated field while it adds another is refused before anything changes, naming the two saves that work: rename or remove one translated field and save, then add or change the others. A schema dialog answer that chose to drop and add still drops the old column, with every language's value.
  - A translated field renamed in the same change that turns translation off is refused before anything runs: rename it and save, then turn translation off.
  - Renamed and made shared, the field is judged under its new name before anything runs: a Required or Unique setting is refused, and an archive that cannot take the other languages stops the change with nothing altered.
  - A save that stopped after renaming the column finishes when it is saved again, rather than failing on the column it already renamed, whether the field stays translated or becomes shared, and so does a save that moved a field to shared and stopped before it was recorded.
  - The schema dialog's answer is checked against the rename the server offered, before anything changes: a change that offers a rename but does not say whether the field was renamed or replaced is refused, naming the field, rather than read as a replacement that deletes its translations. An answer for a rename the server did not offer is ignored.
  - A translated field renamed in code is not carried over yet; its old column keeps its values rather than being dropped.

- [#2602](https://github.com/nextlyhq/nextly/pull/2602) [`d7036b3`](https://github.com/nextlyhq/nextly/commit/d7036b3a1549b8ab5e5984e72f3b59e1f99389cd) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The repository lints with oxlint and its type-aware rules (oxlint-tsgolint) instead of ESLint. Nothing published changes: the packages lose their own `lint` scripts and ESLint dev dependencies, and two release-readiness checks in the core package derive the collection's status with a type guard rather than a cast. `@nextlyhq/eslint-plugin` stays an ESLint plugin, and projects scaffolded by `create-nextly-app` keep their ESLint setup.

- [#2533](https://github.com/nextlyhq/nextly/pull/2533) [`b77393f`](https://github.com/nextlyhq/nextly/commit/b77393f764cb7f6ba4a9b8f8ba60125f87d45154) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A component placed directly in another component, when marked required, no longer stops the outer component from being created or saved. Such a field is never stored or shown in the admin, so it is no longer validated as required. A value for such a field that holds only an `id` is now refused like any other value.

- [#2643](https://github.com/nextlyhq/nextly/pull/2643) [`b753cdf`](https://github.com/nextlyhq/nextly/commit/b753cdf257672b32d0cd55ca8d992d154765663f) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard's Team, Content, Create and Upcoming releases cards each do what their name says, answered as the person reading them.
  - **Team** is offered only to someone who may read people and may add or change them, and it now links to Users.
    - A new `system:team` source answers the number of people, and the number of roles for a reader who may see roles. Without that grant there is no roles figure at all, rather than a zero.
    - The source asks the same rule the card is offered on, so a reader the card isn't for is answered as if the source didn't exist.
  - **Widget permission gates** take a third form, `{ allOf: [...] }` (experimental), beside a slug and an any-of array. Every entry must hold, and each entry is a slug or an any-of array. One level only; an empty `allOf`, an empty entry or anything else is refused when the widget is defined. A slug and an array mean exactly what they meant before.
  - **Content** shows each collection's entries and its drafts, counted as the reader, through a new `system:content` source. The dashboard's draft/published summary is now the sum of those same rows.
  - **Create** no longer offers a shortcut for a collection only a machine creates in (`admin.disableCreate`, as form submissions declare).
  - **Upcoming releases** links to Releases, and shows the reader's releases that need attention above the upcoming ones, at every size: "1 stopped · 2 overdue", each part linking to the Releases list filtered to that reason.
    - `system:releases` sends those counts as rows of their own (`kind: "attention"`) only to a query whose `select` names `reason`. Any other query, including one with no `select`, is answered exactly as before.
  - The exported `ContentStatsGrid` no longer draws invented trend lines, sparklines or "this week" figures beside its real numbers.

- [#2719](https://github.com/nextlyhq/nextly/pull/2719) [`ca39fa1`](https://github.com/nextlyhq/nextly/commit/ca39fa15db5d1305851d28d64dfa9e21b3cb5080) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal groundwork for the roles screen's per-collection access levels, with no change to what anyone may do. The admin gains the mapping between the levels the roles screen will offer (No access, Can view, Can edit, Can publish) and permissions; nothing uses it yet. In `nextly`, the rule for which built-in resources' legacy `manage` permission still counts as read, create, update and delete moves into a module of its own, unchanged.

- [#2612](https://github.com/nextlyhq/nextly/pull/2612) [`69f8bff`](https://github.com/nextlyhq/nextly/commit/69f8bff0e40a639945887073684edeffe9368ba1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - `hasRole`, `hasAnyRole`, `hasAllRoles`, `requireRole`, `requireAnyRole`, `requireAllRoles`, `checkCollectionAccess`, `checkPermission`, `authenticateApiKey` and the `AuthContext` type exported from `nextly/auth` are deprecated, and are removed in the next release. Each warns once, the first time it is called.

  The role checks compare a user's role ids with role names, so they never match a role by its name. Check a permission instead with `nextly.access.check({ userId, resource, operation })`, which asks the same access decision every route uses, or use `isSuperAdmin(userId)`. In place of `checkPermission` and `checkCollectionAccess`, use `nextly.access.check` for a signed-in user. For an API key, check the key's own permissions, which `nextly.access.checkApiKey({ rawKey })` returns: `nextly.access.check` judges the user who made the key, not the key's narrower scope. If you passed `checkCollectionAccess` an `evaluateCodeAccess`, keep running that collection rule too: like `checkCollectionAccess`, `checkApiKey` runs no rule of its own. In place of `authenticateApiKey`, use `nextly.access.checkApiKey({ rawKey })`, which authenticates the key and returns its permissions and roles; like `authenticateApiKey`, it applies no rate limit of its own.

  The instance `getNextly()` returns now declares `access.checkApiKey`, which it already had at runtime, so the advice above compiles.

- [#2720](https://github.com/nextlyhq/nextly/pull/2720) [`73271b2`](https://github.com/nextlyhq/nextly/commit/73271b216227f92a023a4ecd99c165cc84ad7a99) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A new admin endpoint, `GET /api/roles/screen`, tells the roles screen what to show for each collection and Single: its label, the plugin that contributes it (or none), and the access operations whose code-defined `access` declares a rule. It lists exactly the registered collections and Singles, and is refused without the `read-roles` permission, as the role list is. The roles screen uses it to set one access level per entity in a later release.

- [#2523](https://github.com/nextlyhq/nextly/pull/2523) [`2f904e5`](https://github.com/nextlyhq/nextly/commit/2f904e581f116ea95eb1c21421492eb82f67032f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The REST route gates (`requirePermission`, `requireCollectionAccess` and a plugin route's `requiredPermission`, and `requireAnyPermission`) now ask the one access decision. Every answer they give is unchanged: where a gate still answers differently from the decision, it keeps its answer through a named difference, so a later change can remove each one on its own.

- [#2357](https://github.com/nextlyhq/nextly/pull/2357) [`59f29f4`](https://github.com/nextlyhq/nextly/commit/59f29f445d1b2a26e34fe7e844165c6d07b9dc7d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Save draft, Publish and the document's menu stay inside the editor when the preview pane narrows it. With the divider near its narrowest on a desktop screen, they ran past the editor's left edge, where Save draft sat behind the navigation; they now wrap within the editor, as the header's other controls do.

- [#2702](https://github.com/nextlyhq/nextly/pull/2702) [`08bf5b7`](https://github.com/nextlyhq/nextly/commit/08bf5b77b8c7c172bf7c3bf98b8dcfd885f55f38) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Saved count and health cards are now Count cards. A dashboard that holds a collection's count card, its health card, or both shows one Count card set to that collection, at the first card's place and the widest width Count allows. A Count card already set to that collection takes them in.

  This happens as each layout is read, for that reader, and rewrites no stored row. A card whose collection the reader may not read stays as it was, withheld, and converts once they may read it. A card for a deleted collection is kept and shows as not available.

  Three dashboard conditions are also corrected:
  - Create is no longer offered while it cannot be told which collections turn creating off. The collection definitions it needs come from the read every dashboard request already makes, rather than a second read of every definition.
  - The onboarding step and the Create card now share one create decision per collection.
  - Needs attention is offered on a readable Single whether or not it has a widget source.

- [#2368](https://github.com/nextlyhq/nextly/pull/2368) [`599eb46`](https://github.com/nextlyhq/nextly/commit/599eb465889e254f2d3fceabd70a264844ebbf71) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Turning translation on for an existing collection, Single or field group through its schema dialog works again, keeping every entry's values as the default language's. The schema apply moved the values into the companion before dropping the main columns, and the enable's own step then tried to add the same columns and failed, after the main columns were gone and with the entity still recorded as untranslated. The enable now takes the columns the apply moved, and the ones already on the companion, as done, so the values move once. Saving again finishes an entity an earlier attempt left in that state.

- [#2404](https://github.com/nextlyhq/nextly/pull/2404) [`6d93a0e`](https://github.com/nextlyhq/nextly/commit/6d93a0eeada2f79611ddfea76201cd1624741281) Thanks [@aqib-rx](https://github.com/aqib-rx)! - The schema guard that stops a migration changing another owner's tables now also refuses: on PostgreSQL, an `ALTER TABLE` or `TRUNCATE` without `ONLY`, or a `DROP TABLE`, that would reach a table inheriting from the one named (or a partition of it) that another owner holds, read from the database's catalog; `ALTER TYPE ... CASCADE`; a name looked up again after an earlier statement in the same migration dropped or renamed what it named; and, on MySQL and MariaDB, the `WAIT n` / `NOWAIT` and `IF EXISTS` spellings, `CONVERT TABLE ... TO PARTITION`, `CREATE OR REPLACE INDEX`, and a clause it cannot read (such as `CONVERT TO CHARACTER SET`) on a table another owner has a column, index or constraint on. A full plugin uninstall on PostgreSQL whose DOWN migrations hold an `INSERT`, `UPDATE` or `DELETE` is refused before anything runs, since a trigger may change tables. A column added earlier in the same migration is credited for a later change only when written `ADD COLUMN` or with a quoted name, outside any routine body.

- [#2466](https://github.com/nextlyhq/nextly/pull/2466) [`5157ca4`](https://github.com/nextlyhq/nextly/commit/5157ca47d804174e6d87271f4de922e72255d0b3) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The schema builder's collection list (`GET /admin/api/collections/schema`) pages through the collections its caller may see. Each page but the last is full, and `total`, `totalPages` and `hasNext` count every collection the caller may see.

  Changed answer: before, the list was paged first and then narrowed to what the caller may see. A page could come back short, and `total` counted only that page, so `hasNext` was always `false`. Which collections a caller is shown is unchanged.

- [#2369](https://github.com/nextlyhq/nextly/pull/2369) [`6a9a974`](https://github.com/nextlyhq/nextly/commit/6a9a974de6072bcfa15adca3e4e7eeff6225b387) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Seeding a role on a first start now takes only a name or slug conflict as another process having created it, and logs that at debug only, including the warning the role service used to print first. Any other failure is reported, even when the role exists afterwards, so a role saved without its permissions is no longer counted as seeded. A code-defined user-field sync that lost a race on a duplicate now runs once more from the stored rows, so the rest of its changes, a new maxLength say, are written rather than rolled back with the losing insert.

- [#2563](https://github.com/nextlyhq/nextly/pull/2563) [`2acbb54`](https://github.com/nextlyhq/nextly/commit/2acbb5402d3a5768ff56157979bff0f14844b205) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The email template "send test" route now raises a typed internal error when the email service is not set up, like the other email routes. No change in behaviour: the caller still gets the same generic internal error.

- [#2589](https://github.com/nextlyhq/nextly/pull/2589) [`5e7f557`](https://github.com/nextlyhq/nextly/commit/5e7f557b15a77fdce12f6ff195698b636a002b6b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `nextly`, the database adapters, the storage adapters, the plugins, the plugin SDK, `@nextlyhq/blocks-engine`, `@nextlyhq/blocks-react` and `create-nextly-app` are now built with tsdown instead of tsup. Every entry point exports the same names, and its types describe the same API.

  What a reader of `dist` sees change:
  - `nextly`'s type declarations are `.d.mts` files beside the `.mjs` files they describe, rather than `.d.ts`. Imports resolve through the `exports` map as before, so no import changes.
  - The declarations of `nextly/route-path`, `nextly/field-catalog`, `nextly/widget-gate`, `nextly/widget-result`, `nextly/document-lock` and `nextly/translation-filter-states` sit beside their modules (for example `dist/runtime/routing/slug-param.d.mts`), and the `exports` map points there.
  - Shared code is split into chunks with different names, and file-level comments at the top of a source file are no longer copied into the declarations. Comments on each declaration are kept, so editor hovers read the same.

- [#2426](https://github.com/nextlyhq/nextly/pull/2426) [`61a82a6`](https://github.com/nextlyhq/nextly/commit/61a82a67a8a6caba3c3c37aaf0b66136fa9162d9) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Setup now ends the client's upload of a body it stops reading, too large or too slow, instead of leaving the connection open after it has answered.

- [#2423](https://github.com/nextlyhq/nextly/pull/2423) [`54f4ad9`](https://github.com/nextlyhq/nextly/commit/54f4ad9ebc091c0b25702ff29ca1735e7d772dcd) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin's preview control now opens a share popover. Choose how long a link works (1 hour, 1 day, 3 days or 7 days), then create and copy it in one step. The popover lists the page's live links, with who made each, when it ends and how many times it was opened, and lets you revoke any one of them, or all of them after a confirmation. Links made before this version show as one row that can only be revoked together. On a phone, the popover opens from the document's menu.

  A preview shows related items and uploads as the person who shared it would see them, as it already did for the draft's own fields.

- [#2330](https://github.com/nextlyhq/nextly/pull/2330) [`f4808ec`](https://github.com/nextlyhq/nextly/commit/f4808ecd358ad0e7b36431e93f84f5112242589d) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A shared field that becomes translated keeps its value, as the default language's translation, for a collection, a Single or a field group.
  - The Schema Builder's settings save lost the value: a Single's dropped it with the shared column, and a collection's left that column behind, so a Required field refused every later entry. The value now moves to the default language's row before the shared column is removed.
  - The schema dialogs asked to confirm the shared column's removal as a loss, and lost the value when it was confirmed, and so did code-first sync (`next dev`, a config reload, `db:sync`) once the drop was confirmed at the prompt. The schema apply now moves the value itself, after its questions are answered and before the drop, so a cancelled apply changes nothing and a repeated one finishes the change.
  - `nextly migrate:create` planned the change as the whole entity becoming translated, and the migration failed on the existing translations table. It now writes one file that adds the translated column, copies each value and removes the shared column; `nextly migrate:down` makes the field shared again with the default language's value, archives the other languages, and makes a Required field required again once its values are back.
  - A field whose type, length or precision changes in the same change is refused, naming the two saves that work, since its value would be copied into a column of the new shape.

- [#2336](https://github.com/nextlyhq/nextly/pull/2336) [`a24683d`](https://github.com/nextlyhq/nextly/commit/a24683d1e12c836a5d8fcf13d569924e90d5b6ae) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Sign-in and the other auth routes, for a client whose address cannot be resolved, now read at most as many request bodies at once as the shared ceiling admits. A body was read before the request counted against anything, so a client could hold any number of slow bodies open below the ceiling. A request past that number is refused with a 429 before any of its body is read, and the refusal spends no budget and no ceiling place.

- [#2615](https://github.com/nextlyhq/nextly/pull/2615) [`8a5c589`](https://github.com/nextlyhq/nextly/commit/8a5c58971e3ad87e55363075bafe4724d010b549) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Single call made while serving a request that arrived on an API key, which names no key scope of its own, is now judged as that key, as a collection call already was. Before, it was judged as the person who made the key, so a call such as a hook's Direct API read or update of a Single could do what the key's owner may rather than what the key may. A call that names its own key scope is judged by it, as before.

- [#2519](https://github.com/nextlyhq/nextly/pull/2519) [`754ecd9`](https://github.com/nextlyhq/nextly/commit/754ecd9b218d161d36f67031c74108791d9329be) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Single access gate now asks the one access decision, as the collection gate does, keeping every answer it gives today. The code rules apps declare are also kept where that decision can read them with or without the access-control service. Nothing a caller is allowed or refused changes.

- [#2382](https://github.com/nextlyhq/nextly/pull/2382) [`ece8953`](https://github.com/nextlyhq/nextly/commit/ece8953da2db8f1bc5071dfb0a8ab78317ecb8b1) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A Single's preview link now also re-checks, on each render, that the person who shared it may still read the Single, as it already re-checked that they may still edit it. A sharer whose read access is withdrawn by a custom rule no longer has their link serve the draft.

- [#2337](https://github.com/nextlyhq/nextly/pull/2337) [`c3e5354`](https://github.com/nextlyhq/nextly/commit/c3e5354368b77ea1789d6926c498301901715cb4) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A Single's schema save applies whole or fails whole on PostgreSQL and SQLite, and says why on every database, as a collection's save does.
  - A change the value the Single holds cannot take (a text field narrowed below it, a field made unique over a repeated value) is refused before any statement runs, naming the field. PostgreSQL used to cut a longer value to fit.
  - The migration runs in one transaction on PostgreSQL and SQLite. A statement the database refuses fails the save with the reason and the Single keeps the fields it had, where it used to be recorded as a failed migration beside the new fields. On MySQL, which commits each schema statement, the refusal says how many statements ran, and saving again finishes the change.

- [#2476](https://github.com/nextlyhq/nextly/pull/2476) [`25688d9`](https://github.com/nextlyhq/nextly/commit/25688d9443e9287612171256bffce534ed756256) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Each save of a Single by a person or an API key is now recorded in the activity trail, in the same transaction as the save and whether or not webhooks or audit are on: a save, a held draft edit, a publish or unpublish (one row, however many languages it moves) and publishing every language each record one update, and an autosave records nothing. Recent activity heads a Single's row by its label and shows it only to someone who may read that Single. Hidden and internal Singles are left out of Recent activity and the 24-hour figure, judged by what each row is about, so a hidden Single no longer removes the rows of a collection with the same slug. Each entry in the dashboard's activity response now carries `subjectKind`: `collection`, `single` or `settings`, or `null` for an older row.

- [#2356](https://github.com/nextlyhq/nextly/pull/2356) [`308bdd9`](https://github.com/nextlyhq/nextly/commit/308bdd9bb4a370cfa7bd1f48de0f03399a9c4768) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Turning Unique off for a Single field in the same Schema Builder save that renames it now drops its unique index on MySQL when the save is repeated after a refusal. MySQL commits each schema statement, so a rename can land before a later statement is refused, and the field's unique index keeps the name it was created under. The repeated save looked for the index under the field's new name, found none, and left it enforcing uniqueness the field no longer declared. The save now asks the table which unique index covers the column.

- [#2561](https://github.com/nextlyhq/nextly/pull/2561) [`96d7fd2`](https://github.com/nextlyhq/nextly/commit/96d7fd2b8b667ebf42cb62573149bf1cf8ff8b37) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A site's content languages can now be stored and changed through the API when the configuration does not declare them; the admin has no screen for them yet. `GET /api/languages` lists them in the list envelope (`{ items, meta }`, with `meta.lockedByConfig` saying whether the configuration locks them), and `POST /api/languages` adds, renames, reorders or removes one, or makes another the default. Reading needs the settings read or manage permission; changing needs update or manage.
  - Codes are stored in canonical BCP 47 form and must be unique whatever their letter case. `all`, `none` and `*` are refused, since they select languages rather than name one. Labels are stored without surrounding spaces, and a label that is only spaces is refused.
  - A removed language is kept, inactive: its content stays, other languages' fallback lists skip it, and adding it back restores it. The default language cannot be removed; make another the default first.
  - Making another language the default shows first how many translations each language holds (`?defaultPreview=<code>`), must be confirmed, moves no data, and is refused while the current default has pending changes.
  - Fallback lists that loop through other languages are now refused, in the configuration as well as through the API. **A configuration with such a loop no longer boots.** The error names the loop, for example: `localization fallback lists loop: fr → es → fr. A language may fall back through others, but never back to itself.` To fix it, remove one of the codes the error names from the `fallbackLocale` list that leads back. In the example, take `fr` out of `es`'s list, or `es` out of `fr`'s. A language left without a list falls back to the default language.
  - A `localization` block in the configuration still declares and locks the list. The API shows it and refuses every change.
  - A site that never adds a language is unchanged: nothing is stored, and the admin shows no language controls while a site has one language.
  - A language added on one server reaches the others within a second. Each request keeps one list from start to end, and so does each Direct API call, form submission, field-group change and plugin service call, so a worker or script that serves no requests also sees a language added elsewhere. A call made inside another keeps the enclosing call's list.
  - The stored list is read at boot before any plugin's `init` runs, so plugin code writing content at startup sees the site's languages.
  - Two changes to the list made at the same moment run one after the other, so neither is lost to other servers and the site never ends up with two default languages. A default change checks for pending changes again just before it is written.

- [#2406](https://github.com/nextlyhq/nextly/pull/2406) [`18c16c8`](https://github.com/nextlyhq/nextly/commit/18c16c8ddf28a1c0170258a981a7057cfeda6649) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - Staff passwords are judged by length and a common-passwords list, not character classes: at least 8 characters (configurable up to 15 via `auth.minPasswordLength`), refused when on the shipped list of 3,000 common passwords, counting characters rather than code units so short astral strings are refused too. A password longer than the serving digester reads whole — 72 UTF-8 bytes for the default bcrypt — is refused instead of silently truncated, at registration, reset, change, invite acceptance, the forced first-sign-in change, and administrator-set passwords alike. Stored passwords are re-judged by nobody: an account whose password predates the rule still signs in with it. An app supplying its own `PasswordHasher` must declare its reach contract (`reach: number | "unbounded"` or a `validate` function) or the server refuses to start, naming the digester.

- [#2449](https://github.com/nextlyhq/nextly/pull/2449) [`a44f6e4`](https://github.com/nextlyhq/nextly/commit/a44f6e4a23a8dde2393abcba9ac31e935702b6f4) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The standalone email-template handlers (`nextly/api/email-templates` and `nextly/api/email-templates-detail`) now accept a template's `description` on create and update (`null` clears it on update), and return it on every read, as the catch-all REST routes and the Direct API already do. A description that is neither text nor `null` is refused with a validation error.

- [#2421](https://github.com/nextlyhq/nextly/pull/2421) [`a24cdb0`](https://github.com/nextlyhq/nextly/commit/a24cdb057f935ee33c7a270a6e4e4ece4883f732) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A person's standing is read again as soon as the change that deactivates
  them, or sets their password, commits, even when Nextly's services are
  registered again (a configuration change, a reload in development) while
  that change's transaction is open.

- [#2709](https://github.com/nextlyhq/nextly/pull/2709) [`73c32ec`](https://github.com/nextlyhq/nextly/commit/73c32ece3ae36139aff7a40c2a35679d5fde412f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Only a super-admin can delete or deactivate the account of a super-admin while another super-admin remains. An admin who may delete or change users but is not a super-admin, and every API key, is refused with `403`, as removing the role already is. Server code with no request caller is unaffected, and the last active super-admin stays protected from everyone.

  A change to an account or a role is judged by the ids as stored.

- [#2450](https://github.com/nextlyhq/nextly/pull/2450) [`0a5c11b`](https://github.com/nextlyhq/nextly/commit/0a5c11b1ed565aa2e2a71e787320f5c3cfe1480e) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The super-admin assignment rule now applies to every role change requested through Nextly's REST routes. There, only a super-admin can assign the super-admin role or a role that inherits it, create or update a user with such a role, or make a role inherit one, whether by adding inheritance or through `childRoleIds` when a role is created or updated, and an API key cannot, whoever made it. Server code such as a seed or the CLI is unaffected.

  A role created through `POST /api/roles` can no longer be marked `isSystem: true`. That request now answers 400. System roles are the ones Nextly seeds itself.

  Assigning a role through `POST /api/users/:id/roles` now answers with what happened: `404` for a user or role that doesn't exist, `409` for a role already held, and `400` for an `expiresAt` that isn't an ISO date and time. A user created with roles is created with all of them or not at all.

- [#2571](https://github.com/nextlyhq/nextly/pull/2571) [`f95635e`](https://github.com/nextlyhq/nextly/commit/f95635eae3884a39c0d814c7a65ea10b9425179f) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The Direct API's reads of users, roles and permissions, media and field groups are checked when the call asks to be.

  With `overrideAccess: false`, on the instance or on the call, each read asks the grant REST's route asks for the same read, before it reads anything:
  - `users.find`, `users.findOne` and `users.findByID`: `read-users`.
  - `roles.find` and `roles.findByID`: `read-roles`; `roles.getPermissions`: `read-roles` or `read-permissions`.
  - `permissions.find`: `read-roles`, which the role form needs; `permissions.findByID`: `read-roles` or `read-permissions`.
  - `media.find`, `media.findByID` and `media.folders.list`: `read-media`, as the admin's media routes ask.
  - `fieldGroups.find` and `fieldGroups.findBySlug`: a named user and no grant, as REST serves field groups to any signed-in caller.

  A checked call that names no user is refused as unauthenticated, and a key's scope (`actor`) is judged on its own grants. Inside a request made with an API key, a checked media read that names a person and no key is refused, as a media write is. A read that is refused throws, `disableErrors` included. Trusted calls, the default, are unchanged.

- [#2448](https://github.com/nextlyhq/nextly/pull/2448) [`c90ea6d`](https://github.com/nextlyhq/nextly/commit/c90ea6d2e1fa05cc2171f568efde16eb4417cf89) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The types the template ownership methods take and return are now exported from
  `nextly`, so code calling `nextly.emailTemplates.override`, `reset`, `compare`,
  `applyUpdate` and `undoUpdate` can name them: `OverrideEmailTemplateArgs`,
  `ResetEmailTemplateArgs`, `CompareEmailTemplateArgs`,
  `ApplyEmailTemplateUpdateArgs`, `UndoEmailTemplateUpdateArgs`,
  `EmailTemplateComparison` and `OwnerUpdateUndo`, with the types their fields
  are built from, `EmailTemplateVersion`, `OwnerChange` and `OwnerChangeChoice`.
  They are `@experimental`, as the methods are.

- [#2526](https://github.com/nextlyhq/nextly/pull/2526) [`2e4f252`](https://github.com/nextlyhq/nextly/commit/2e4f252151fe8e14a3f437e610074d0bf67fba10) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - An email template whose Reply-To uses variables now sends it only when it renders to exactly one address, display name allowed. One that renders to several addresses fails before any provider is asked, as one that renders to something that is not an address already did. A Reply-To without variables, and a send's own `replyTo`, are unchanged.

- [#2377](https://github.com/nextlyhq/nextly/pull/2377) [`69e42b4`](https://github.com/nextlyhq/nextly/commit/69e42b4d7ed85350d049ef366b5c0a168c3bcf01) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Testing: `createTestNextly` instances booted one after another in the same test file now each answer REST requests such as `GET /api/users` from their own database. Before, every instance after the first was served by the first one's closed database connection and answered 500.

- [#2465](https://github.com/nextlyhq/nextly/pull/2465) [`a1adee6`](https://github.com/nextlyhq/nextly/commit/a1adee6f1cc5e676947259b6123c40af51f6794b) Thanks [@faisal-rx](https://github.com/faisal-rx)! - A REST request's authenticated caller now travels in request context instead of in route params, and every REST handler builds the user its access rules are judged on in one place. That user now carries the token's verified claims on every route: a rule that decides on a claim, such as a tenant, now sees it on version history, Single writes and collection writes too, as it already did on collection and Single reads and through the Direct API. Reserved identity names sent in a query string are still dropped before dispatch.

- [#2601](https://github.com/nextlyhq/nextly/pull/2601) [`208049c`](https://github.com/nextlyhq/nextly/commit/208049c9012248b939e1a489d4dfd4157194202e) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Customising the dashboard no longer makes React warn that an effect's dependency list "changed size between renders" when the dashboard narrows to one column or widens again. The drag context now keeps the same sensors at every width; a drag still cannot start at one column, where no card draws a handle and each card's drag is turned off.

- [#2397](https://github.com/nextlyhq/nextly/pull/2397) [`c843077`](https://github.com/nextlyhq/nextly/commit/c8430771063aa13110c9fda92eed16181544a249) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The dashboard no longer jumps while it loads. It draws no card until it knows
  which cards this person has, rather than drawing the declared set and
  redrawing theirs over it, and each loading card holds the place of the body
  that will replace it: the same lines, laid out as the card will draw them at
  its width, with its freshness line held. An empty or short list closes up once.

- [#2387](https://github.com/nextlyhq/nextly/pull/2387) [`d5b2cef`](https://github.com/nextlyhq/nextly/commit/d5b2cefbc75eb13de43bcaacbcdd74314d095a24) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The API key form describes each type in plain words, including that a
  read-only or full-access key follows its creator's permissions as they
  change, and shows what the key will be able to do before it is created, as
  the server answers it for the chosen type or role. The key list shows each
  key's owner beside its expiry and last use, and a key's last use now
  advances when a request uses it.

  New, and experimental while the form settles: `GET
/admin/api/api-keys/abilities?tokenType=…&roleId=…` answers that summary,
  session-only and behind the permission to create keys. Each key's metadata
  gains an `owner` field, which an API key sees only if it may read users.

- [#2624](https://github.com/nextlyhq/nextly/pull/2624) [`cc045e7`](https://github.com/nextlyhq/nextly/commit/cc045e75799e2136326031951a4d6f3c0aff8aae) Thanks [@faisal-rx](https://github.com/faisal-rx)! - The admin can now ask the server what you may do. An experimental `GET /me/capabilities` answers, for every collection and Single, which of read, create, update, delete, publish and unpublish you are allowed — decided by the same gate a REST request meets, so a collection's code access rule is reflected as well as the permissions your roles hold. A publish or unpublish is allowed only where you may also update, as a publish is sent as an update. It is answered for the signed-in person, or for the API key when a key makes the request, is never stored, says when it stops holding, and takes a `?locale=` to judge a rule that answers by language. `GET /me/permissions` is unchanged.

- [#2399](https://github.com/nextlyhq/nextly/pull/2399) [`9c5f185`](https://github.com/nextlyhq/nextly/commit/9c5f18518ab09c3413af925f8deea6689bac20be) Thanks [@aqib-rx](https://github.com/aqib-rx)! - An entity transform judges a plugin named `code` like any other plugin: another plugin transforming its entities needs `code` in `dependsOn`, and may not remove or change the storage of its fields. A plugin named `code` can also no longer contribute an entity under the slug of an app entity of another kind. A transform that restates the owner's table settings in an equivalent form is now accepted: an explicit `status: false` or `localized: false` where the owner left it unset, or a `dbName` that names the default table the entity is already stored in (`dc_orders` for `orders`). A setting that changes the table, or turns a status column or localization on or off, is still refused.

- [#2529](https://github.com/nextlyhq/nextly/pull/2529) [`095e254`](https://github.com/nextlyhq/nextly/commit/095e25438ab0cdb3b406025dc1539cf8989decba) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A Schema Builder save that removes a translated field while it adds another field, with no rename decided for them, is now refused before anything changes. Two renames in one save, a rename beside a new field, and a rename to another type were each read as a removal and an addition, which dropped the removed field's translations column and every language's value with it, and no step of the save asked about it. The refusal (`TRANSLATED_FIELD_REMOVED_BESIDE_ADDED`) names each such field and the two saves that work: rename or remove one translated field and save, then add or change the others. A schema dialog's explicit "drop and add" answer still goes through, as the admin chose it.

  The settings save that turns translation on is refused the same way for a field that becomes translated, a rename included: turning translation on keeps a field's value only under the name it already has, so the removed field's value was deleted from the main table and its replacement started empty. Turn translation on with the fields as they are, then rename or add. The schema dialogs already ask for that drop to be confirmed, and still apply it once it is.

- [#2650](https://github.com/nextlyhq/nextly/pull/2650) [`7b0ea38`](https://github.com/nextlyhq/nextly/commit/7b0ea3899ef6c74eb4c8504de26e1a3c51301529) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - The packages' TypeScript configs now state the settings whose defaults change in TypeScript 7: `types` in each package, `rootDir` in admin, and `noUncheckedSideEffectImports` and `libReplacement: false` in the shared base. They type-check the same way on 5.9 and 7. The published JavaScript is unchanged, and so are the published types; a few of nextly's and admin's declaration unions list their members in another order.

- [#2623](https://github.com/nextlyhq/nextly/pull/2623) [`09e77c9`](https://github.com/nextlyhq/nextly/commit/09e77c98206e32abed563cbb3f3c0bc20c2d13fb) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - `@nextlyhq/ui` builds its declarations with oxc under `isolatedDeclarations`, from the type annotations in its own source. The published types and JavaScript are unchanged.

- [#2616](https://github.com/nextlyhq/nextly/pull/2616) [`5984c90`](https://github.com/nextlyhq/nextly/commit/5984c90bdea3cb2b1b5d061f0cc584c91ceb22cd) Thanks [@faisal-rx](https://github.com/faisal-rx)! - Internal clean-up of the access-permission helpers: two functions no code called are removed. Nothing a user can import or observe changes.

- [#2402](https://github.com/nextlyhq/nextly/pull/2402) [`807076d`](https://github.com/nextlyhq/nextly/commit/807076ddaeba266bfd7922cf609927365a59c871) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Every version in a document's history now names who wrote it, records its status truthfully, and survives a concurrent write taking its number.
  - **Who wrote it.** A version is named from the record of content events: a person by name, an API key by its own name (not its owner's), and a seed, a plugin acting as the system or any other system write as "System". A history entry's `author` gains a `kind` (`person`, `apiKey`, `principal`, `system`, `agent`). For the system its `id` is null. Versions recorded before content events fall back to the stored user id, as before.
  - **Its status.** Without the Draft/Published lifecycle, a document's own `status` is recorded as it is (an "archived" document's version says "archived"), never as "published". A document with no status still records "published". A select or radio `status` field may not have an option longer than 32 characters (refused when the collection or Single is defined). A longer free-text status records its first 31 characters and "…", keeps the whole value in the version's snapshot, and is logged once per collection.
  - **Its number.** When two writes to one document capture a version at the same moment, the later one now takes the next number instead of failing. Only the version insert repeats, never the write or its hooks: in a savepoint on PostgreSQL and SQLite, and with a locking re-read on MySQL.

- [#2485](https://github.com/nextlyhq/nextly/pull/2485) [`343e49b`](https://github.com/nextlyhq/nextly/commit/343e49b16cf8d2370c90ce775b6eb3bc0bc24c71) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A dashboard batch does a source's shared work once. A widget source may answer several of its queries in one call (`resolveMany`, one answer or one error per query, by position) and share work across its queries in one batch through `opts.scope`, kept per source, per batch and per caller. A grouped result can say its counts are floors (`atLeast`), drawn as "N+". The SEO plugin answers its card's five cells from one scan and can group its issues by kind. Both additions are `@experimental`.

- [#2673](https://github.com/nextlyhq/nextly/pull/2673) [`c91bdc9`](https://github.com/nextlyhq/nextly/commit/c91bdc904bbad97816bfba5808b669cebf221c1b) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A registered widget may declare a Collection setting, and its card reads the collection the reader chooses. The collection becomes the card's query source in place of the one the widget declares, and the reader's access to it is judged as for any source a query names.

  Registration still refuses a Filter, Sort or Group by setting on a registered widget (`WIDGET_CONTENT_SETTING_NOT_DRAWN`), since nothing yet carries those into its query.

- [#2350](https://github.com/nextlyhq/nextly/pull/2350) [`e3e14dd`](https://github.com/nextlyhq/nextly/commit/e3e14dd6fd523d710c88cdfb107a39f1211d9fd8) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A declared widget's widths now use core's words (`quarter`, `third`, `half`, `twoThirds`, `full`). Its Collection, Filter, Sort and Group by settings follow core's setting rules, and a list or table query must name the fields it shows.
  `defineWidget()` also refuses a component path read from a `string` variable and data keyed by a symbol, which would otherwise reach the admin wrong.

- [#2511](https://github.com/nextlyhq/nextly/pull/2511) [`2aab43a`](https://github.com/nextlyhq/nextly/commit/2aab43a3456a89e1d223955b779e714937771c73) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - A site's generated admin component map now checks, at compile time, that each widget component it registers takes its own widget's props, with nothing annotated by the plugin or the site. A component registered under another widget's path fails the site's build.

  To make that possible, `definePlugin` and `defineConfig` keep their widgets' types. Both are now generic, and nothing changes at run time:
  - **`definePlugin`** infers the widgets of `contributes.dashboard`, and `rename()` keeps them. A plugin with no dashboard, or with untyped widgets, has today's type.
  - **`PluginDefinition` and `PluginContributions`** take an optional type parameter, defaulting to today's type. Every existing use means what it did, and a typed plugin still goes wherever a `PluginDefinition` does.
  - **`defineConfig`** keeps each plugin's type, and its return type records the widgets they declare. An untyped (plain JavaScript) plugin compiles as before, and does not turn the check off for the typed plugins beside it.
  - **New types:** `DeclaredComponentMap` and `WidgetsOf`, exported from `nextly`, which the generated map uses.

  **One deliberate change:** in a plugin whose widgets are typed, `contributes.dashboard.suggest` and the keys of `alternatives` are now checked against the plugin's own widget ids when it compiles. A misspelt id, or a `string[]` variable, that compiled before now fails to compile. Startup already refused a misspelt id. To migrate, write the ids as literals, or type the array as `(typeof widgets)[number]["id"][]`.

  A plugin whose factory annotates its return type as `PluginDefinition` keeps today's unchecked type, until it returns `PluginDefinition<typeof widgets[number]>` instead.

- [#2344](https://github.com/nextlyhq/nextly/pull/2344) [`a6c613d`](https://github.com/nextlyhq/nextly/commit/a6c613d8639d35c58e80e445df648e1278ed1528) Thanks [@nextly-agent](https://github.com/apps/nextly-agent)! - Upgrading requires running `nextly migrate` before content can be saved:
  every save now records its history, and until the record's table exists a
  save is refused with "The database needs updating before content can be
  saved. Run `nextly migrate`." rather than written without its history.

  A document's writes now record its history in the record of content events,
  each in the write's own transaction and with who made it, for collections and
  Singles alike: its creation, each save that recorded a version, a restore
  (naming the version it came from), each publish and unpublish, a version
  being named, its working draft being discarded, its deletion, and a
  retention pass that removed older versions. A publish or unpublish is one
  event per kind naming the languages it moved, and publishing every language
  is one event. A person is recorded by the name the request carried, an API
  key by its own name, and the system (a Single created on its first read, or
  retention) by none. A save that changed nothing records no event. Events are
  written whatever a collection's webhook settings.

  `versions.setLabel` takes an optional fourth argument, who named the version,
  which records the name in the document's history in the same transaction.
