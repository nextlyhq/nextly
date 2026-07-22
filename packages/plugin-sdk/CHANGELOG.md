# @nextlyhq/plugin-sdk

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

- Updated dependencies [[`091ec3a`](https://github.com/nextlyhq/nextly/commit/091ec3a39f3c01621c8a01dfea61b05a7ae689f4), [`6126db4`](https://github.com/nextlyhq/nextly/commit/6126db4a7ef4afd9ba07146e604168d28d8d22e9), [`a763b82`](https://github.com/nextlyhq/nextly/commit/a763b82f7d1d95c518e14f9c9fac48a51e5d2a80), [`fe6734f`](https://github.com/nextlyhq/nextly/commit/fe6734fec8772d8cf012598f8abce839dbc29945), [`37c221f`](https://github.com/nextlyhq/nextly/commit/37c221f9159745d9fd70f7e004c54011d561bbe6), [`7811af8`](https://github.com/nextlyhq/nextly/commit/7811af8c1a031b982d728aa1e895c089c14852fd), [`9c94444`](https://github.com/nextlyhq/nextly/commit/9c94444250edd830f90f2ce7a91f7473aa423799), [`72b0fdf`](https://github.com/nextlyhq/nextly/commit/72b0fdff56e56189390fd82326df2c601d4f7c6a), [`32a0475`](https://github.com/nextlyhq/nextly/commit/32a04754d3e017052643abc3084431574106ee0e), [`4647ac7`](https://github.com/nextlyhq/nextly/commit/4647ac7ef3d712d82cf62d1868d73e4b0bcc88e5), [`89649f8`](https://github.com/nextlyhq/nextly/commit/89649f87de815ce7aa69453c0a6e88534fa3d871), [`ec7eeb1`](https://github.com/nextlyhq/nextly/commit/ec7eeb1e68d055a8c88904ab824e7335603fe48b), [`37495ce`](https://github.com/nextlyhq/nextly/commit/37495ce22a197862e3d57d2762bf3b7815111550), [`a4576e8`](https://github.com/nextlyhq/nextly/commit/a4576e8256d367e6ed46e5accdbc7b88d181a18b), [`deb3806`](https://github.com/nextlyhq/nextly/commit/deb38068116dcb1fc586e2f95d889b448fc73ae1), [`55c1eb6`](https://github.com/nextlyhq/nextly/commit/55c1eb63d4eae9318b2b43e268c8afe521740158), [`d398b16`](https://github.com/nextlyhq/nextly/commit/d398b163b7df0007db753c4beaedcfc99220f030), [`7e74c6e`](https://github.com/nextlyhq/nextly/commit/7e74c6efab9847c93a72b3aa7c21662642a038ba), [`79ae48a`](https://github.com/nextlyhq/nextly/commit/79ae48a46c68827a152ca86033adf0c125de22cc), [`d13ec0e`](https://github.com/nextlyhq/nextly/commit/d13ec0e60249b8e511beabf7612bacf995c60dc9)]:
  - @nextlyhq/admin@0.0.2-alpha.39
  - nextly@0.0.2-alpha.39

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

- Updated dependencies [[`a302fec`](https://github.com/nextlyhq/nextly/commit/a302fec09fdd22f59763ce91cfbbfcca0f5fc3c7), [`1104b2f`](https://github.com/nextlyhq/nextly/commit/1104b2fe83ab6a7d940ec38f83bc6c40f6d1817c), [`1f0a3e6`](https://github.com/nextlyhq/nextly/commit/1f0a3e6da323d4a3c5d31e8e7fc8fc9f0c97daca), [`7a46bd2`](https://github.com/nextlyhq/nextly/commit/7a46bd2757900bc0b7676ecc0171f7a0f74d7f30), [`40fc723`](https://github.com/nextlyhq/nextly/commit/40fc723578f49759310804536a3cacfc51353935), [`93a432c`](https://github.com/nextlyhq/nextly/commit/93a432cfff275f423f545ccc8d21324b55c1f3cd), [`7c93a64`](https://github.com/nextlyhq/nextly/commit/7c93a642495f0b5d04fc2b7a71a755cacfda8ec6), [`c092cb0`](https://github.com/nextlyhq/nextly/commit/c092cb0a92023b62e88d9db5f057b368b28329ee), [`cac7062`](https://github.com/nextlyhq/nextly/commit/cac706295f4e0ac42f8f77ee854cdcc645e9e4a1), [`b5ecec8`](https://github.com/nextlyhq/nextly/commit/b5ecec8b14844dc8f7a2d643ae2e693df03d49cc), [`aa5a663`](https://github.com/nextlyhq/nextly/commit/aa5a6637d70fb1697be7925e7b8dea510984349a)]:
  - @nextlyhq/admin@0.0.2-alpha.38
  - nextly@0.0.2-alpha.38

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

- Updated dependencies [[`14c88c8`](https://github.com/nextlyhq/nextly/commit/14c88c8982a9bc7c6526289103888193263cb20c), [`dbb4675`](https://github.com/nextlyhq/nextly/commit/dbb46757081a5d68b33ffaead8e621bbbff6e262)]:
  - @nextlyhq/admin@0.0.2-alpha.37
  - nextly@0.0.2-alpha.37

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

- Updated dependencies [[`9647453`](https://github.com/nextlyhq/nextly/commit/96474535bd096f61131f9e5853bc8a24e7f84fc2), [`79709b8`](https://github.com/nextlyhq/nextly/commit/79709b8f91cabd9815f9e61f3db8310da07f48d3), [`dd3be32`](https://github.com/nextlyhq/nextly/commit/dd3be329eab4347805258be7549234e7017a7757), [`37ee3d5`](https://github.com/nextlyhq/nextly/commit/37ee3d54395afbe96e04d02a00d6329127f4c2af), [`564bd03`](https://github.com/nextlyhq/nextly/commit/564bd03e6ea0285bfc2f8c8b94e31b0ad93a89d8), [`972a725`](https://github.com/nextlyhq/nextly/commit/972a7257b071851d2c985ed475936f7d0745c234), [`b61b09c`](https://github.com/nextlyhq/nextly/commit/b61b09c9707e0dfb25f741b6d633271017cb37d4), [`dffdb4c`](https://github.com/nextlyhq/nextly/commit/dffdb4c671ba9f3287a68e23d7c61f4341bafb55), [`0d31e01`](https://github.com/nextlyhq/nextly/commit/0d31e0154491270e896704f1c60444c9bbba8346), [`3cd0d84`](https://github.com/nextlyhq/nextly/commit/3cd0d8404278003cc38e79c3ee45e3ce97f68902), [`e9e5f7b`](https://github.com/nextlyhq/nextly/commit/e9e5f7bcb5cd2d29fa8c32ffa34edd6910293364), [`85ef8f0`](https://github.com/nextlyhq/nextly/commit/85ef8f0170f92128195198e49255d7b54e614fe1), [`9c41e35`](https://github.com/nextlyhq/nextly/commit/9c41e356ae7ee371bbd675315785c3107299ed91), [`d349b9e`](https://github.com/nextlyhq/nextly/commit/d349b9e913ae6f958e4201b6481dfe83cc5cfa5a), [`6f39d5a`](https://github.com/nextlyhq/nextly/commit/6f39d5a2cedd07f9bd4dd0d71fdef95a9adc2aff), [`2ece35b`](https://github.com/nextlyhq/nextly/commit/2ece35bd89b5b8232637da998af9194d94e158d3), [`30c2b57`](https://github.com/nextlyhq/nextly/commit/30c2b57829827bc682b47a354cacc3fd90a212ba), [`a7fd33d`](https://github.com/nextlyhq/nextly/commit/a7fd33d61c3365d912ec9cd91b4e1ead15c9e5d0), [`4e8f80d`](https://github.com/nextlyhq/nextly/commit/4e8f80d0c0ceb7e17fd935f353495a66112a111e), [`38af42b`](https://github.com/nextlyhq/nextly/commit/38af42b22d9f1e6de6e4770abb199a9d4ed300db), [`585384d`](https://github.com/nextlyhq/nextly/commit/585384ddc8944f4d08c6f59cd42096e0ad3745fa), [`2d9165c`](https://github.com/nextlyhq/nextly/commit/2d9165cbde2128925d89b800acf77c1861a567eb), [`2f1c981`](https://github.com/nextlyhq/nextly/commit/2f1c98199b06843b381758f1dacea061b29b2d41), [`f988a69`](https://github.com/nextlyhq/nextly/commit/f988a691a95a2371833b8ba424a7da3402668f5c), [`e6074bc`](https://github.com/nextlyhq/nextly/commit/e6074bc9f21a048717fa239270d2bd9bebc68429), [`d96bf6a`](https://github.com/nextlyhq/nextly/commit/d96bf6abb9ff94c3463d5da1d32339a8718b0f2c), [`3086cf4`](https://github.com/nextlyhq/nextly/commit/3086cf4953a3be251d527ef8dadc73f07fbe7796), [`7fcdd89`](https://github.com/nextlyhq/nextly/commit/7fcdd89188acb342e536a88a7bdc187b128aa85e), [`0566849`](https://github.com/nextlyhq/nextly/commit/05668498f248a3d4e5ff754a2c0c045507b75fc0), [`71843e4`](https://github.com/nextlyhq/nextly/commit/71843e4047e8b90650da4631d94e4e0e7d155131), [`24b5c85`](https://github.com/nextlyhq/nextly/commit/24b5c856c13c4c3984fe7d6fe7d4975c6ddd139e), [`f29d765`](https://github.com/nextlyhq/nextly/commit/f29d7655565c76eeb7b2bd88581659e71b0ec120)]:
  - @nextlyhq/admin@0.0.2-alpha.36
  - nextly@0.0.2-alpha.36

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

- Updated dependencies [[`cfd0d83`](https://github.com/nextlyhq/nextly/commit/cfd0d83bafd79efeee715f0c4e396bafc6d43acf), [`2b3b072`](https://github.com/nextlyhq/nextly/commit/2b3b0729ee4e5aa2501356bc1bf0640f5cd8697b), [`b4e6294`](https://github.com/nextlyhq/nextly/commit/b4e6294d9c8c37dbb646c26b8e3fe701860ae00c), [`1ed808c`](https://github.com/nextlyhq/nextly/commit/1ed808c6a8b9c2eeffe7ae3a2c675f7d911cbb88), [`a704e1a`](https://github.com/nextlyhq/nextly/commit/a704e1a4b824d5b6cfb06ff1519f0f24921a8c0f), [`8cc095b`](https://github.com/nextlyhq/nextly/commit/8cc095b7554bd0b0c6d8dc583666a318e0438b16), [`5241bb2`](https://github.com/nextlyhq/nextly/commit/5241bb289c81f45e80169d56de5607a56f6f8577), [`eb6751a`](https://github.com/nextlyhq/nextly/commit/eb6751a156b940108f6df1b109d58ac252e1abaa), [`4aa9a61`](https://github.com/nextlyhq/nextly/commit/4aa9a61dce555b30da7d1b13608184d9fe4a8e86), [`2fb740f`](https://github.com/nextlyhq/nextly/commit/2fb740fd609049f2dc90f6439a772e73367d5c1b), [`3213d3f`](https://github.com/nextlyhq/nextly/commit/3213d3fcfebeb61c1e37987efab19725fb274275), [`9e60f5c`](https://github.com/nextlyhq/nextly/commit/9e60f5c070d0b82c25808afbf8e726e17ab6d743), [`f9fc1af`](https://github.com/nextlyhq/nextly/commit/f9fc1aff1a808bca3727cb7eecd6292aef05b391), [`23f4897`](https://github.com/nextlyhq/nextly/commit/23f489760a0cea9b23f442e357e998a78c897e41), [`f8e3270`](https://github.com/nextlyhq/nextly/commit/f8e32704b155aa5af9dbad157854d79bc81d4c9a), [`edcb2d8`](https://github.com/nextlyhq/nextly/commit/edcb2d8ee4fa5e25c4c23cd3f6fcd2eefa6f0336), [`e836d9a`](https://github.com/nextlyhq/nextly/commit/e836d9a6348a1ba23879115d90d14c1a24599142), [`fb14ec8`](https://github.com/nextlyhq/nextly/commit/fb14ec87c308b8122ebd4405cf65d044ea82ab7b), [`adcaa08`](https://github.com/nextlyhq/nextly/commit/adcaa08697846fd647e6bec5b22372ab9d2604d5), [`dacef90`](https://github.com/nextlyhq/nextly/commit/dacef90f0b3bdb944d1bf8aca68b59da4dccfeb8), [`f5426ed`](https://github.com/nextlyhq/nextly/commit/f5426ed147f901daea37df14417fb71a65637d06), [`89a5e8a`](https://github.com/nextlyhq/nextly/commit/89a5e8aca0fc3dc9d402241f222b72f71d619338), [`cc3903b`](https://github.com/nextlyhq/nextly/commit/cc3903ba6f0749306219d1fd483847179eedf70a), [`55d8eb8`](https://github.com/nextlyhq/nextly/commit/55d8eb8cf5f9c8d9d47d51ed5665334a00fe9431), [`1a2214b`](https://github.com/nextlyhq/nextly/commit/1a2214be62e50cd747cd831c909fc2e108bbab65), [`f4c95c1`](https://github.com/nextlyhq/nextly/commit/f4c95c144f01c7007f126e554e9226cc7e8655f1)]:
  - @nextlyhq/admin@0.0.2-alpha.35
  - nextly@0.0.2-alpha.35

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

- Updated dependencies [[`bc714c2`](https://github.com/nextlyhq/nextly/commit/bc714c293a167f3ddcb10a11dbf738876f55c84b), [`d9a2da5`](https://github.com/nextlyhq/nextly/commit/d9a2da5923cf512d5a201d96af915306c188e6b0), [`3e67673`](https://github.com/nextlyhq/nextly/commit/3e676739b53f47f6a837c08faef654fdf76cdd1b), [`fd0aa70`](https://github.com/nextlyhq/nextly/commit/fd0aa706eb1ae4ed485e0337919b020d49181ccb), [`f90fd3d`](https://github.com/nextlyhq/nextly/commit/f90fd3dd75b06e0d5818ffacfe79d0bd7db21575), [`2b725ea`](https://github.com/nextlyhq/nextly/commit/2b725eab34613b4b49be6975ad2fb3add81ee29d)]:
  - @nextlyhq/admin@0.0.2-alpha.34
  - nextly@0.0.2-alpha.34

## 0.0.2-alpha.33

### Patch Changes

- [#154](https://github.com/nextlyhq/nextly/pull/154) [`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Add editable page-level custom CSS with live preview in the page builder editor

- Updated dependencies [[`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf)]:
  - @nextlyhq/admin@0.0.2-alpha.33
  - nextly@0.0.2-alpha.33

## 0.0.2-alpha.32

### Patch Changes

- Fix installation of the plugin in fresh apps: internal `@nextlyhq/*` peer dependencies now use the `workspace:*` protocol, so each published version's peers are rewritten to the versions released alongside it instead of a hard-coded (and stale) pin. Previously `npm install @nextlyhq/plugin-page-builder` / `nextly add` failed with `ERESOLVE` because the published peers demanded an older core version than the one installed.

- Updated dependencies []:
  - @nextlyhq/admin@0.0.2-alpha.32
  - nextly@0.0.2-alpha.32

## 0.0.2-alpha.31

### Patch Changes

- [#150](https://github.com/nextlyhq/nextly/pull/150) [`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Per-entry editor choice + the generic, plugin-agnostic platform hooks that power it. A collection or single can offer a per-entry **Default / Page Builder** toggle, and turning it on shows a visual canvas instead of the normal fields — delivered entirely through reusable extension points, with no page-builder-specific code in core or admin.
  - **Plugin field types round-trip to production.** `ui-schema.json` (the committable schema manifest) now accepts plugin-contributed field types, and the CLI registers `contributes.fieldTypes` before generating migrations — so a plugin field type resolves to its declared storage column and survives to production. Previously a UI-created plugin field was downgraded to `json` in the manifest, so the real type was lost outside dev.
  - **`layout: "takeover"` field-type flag.** A plugin field type can declare that, when a field of that type is active, the entry/single form collapses to just that field plus the field that controls its `admin.condition` — hiding the rest. Generic: it keys off field-type metadata (`branding.plugins[].fieldTypes[].layout`) and the existing condition evaluator, so any plugin field type can opt in.
  - **`contributes.admin.schemaBuilderSlot`.** Plugins can render a control above the field list in the collection/single schema builders, receiving `{ fields, setFields, disabled, context }` to add builder-time behavior (e.g. an editor-choice toggle) without core knowing the plugin.
  - **`contributes.admin.entryFormToolbarSlot`.** Plugins can render a control in the entry/single form header toolbar, reading and writing form state via react-hook-form — for form-level controls like a mode toggle.
  - **Managed (hidden) fields.** A field marked `admin.hidden` is kept out of the schema-builder "Your fields" list and out of the entry-form body while its value still lives in the form state — used for plugin plumbing that's driven by a toolbar control rather than shown as a field.

  `@nextlyhq/plugin-page-builder` is the first consumer of all of the above and is published through the same release: it registers a `page-builder` field type with `layout: "takeover"`, contributes the "Use Page Builder" schema-builder toggle and the per-entry Default / Page Builder form-toolbar toggle, ships the visual block editor (drag-and-drop canvas, inspector, responsive preview, query loop), and works for both code-first (`withPageBuilder()`) and UI-created collections and singles. Packaging: declares `sideEffects` so its admin components register from a plain side-effect import, with pinned peer versions for clean installs.

- Updated dependencies [[`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05)]:
  - @nextlyhq/admin@0.0.2-alpha.31
  - nextly@0.0.2-alpha.31

## 0.0.2-alpha.30

### Patch Changes

- [#145](https://github.com/nextlyhq/nextly/pull/145) [`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The API reference was not correctly specified in the `useEffect` dependency array. It was set as `[api]`, whereas it should have been `[api.public]`.

- Updated dependencies [[`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5)]:
  - @nextlyhq/admin@0.0.2-alpha.30
  - nextly@0.0.2-alpha.30

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

- Updated dependencies [[`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa)]:
  - @nextlyhq/admin@0.0.2-alpha.29
  - nextly@0.0.2-alpha.29
