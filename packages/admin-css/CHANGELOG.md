# @nextlyhq/admin-css

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

## 0.0.2-alpha.36

### Patch Changes

- [#240](https://github.com/nextlyhq/nextly/pull/240) [`d349b9e`](https://github.com/nextlyhq/nextly/commit/d349b9e913ae6f958e4201b6481dfe83cc5cfa5a) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Third-party plugins can now style their admin UI.

  The admin stylesheet is precompiled and isolated, so utility classes that live only in an npm-installed plugin were silently dropped. This adds three layers, in order of preference: new `Stack`/`Grid`/`Stat` layout primitives alongside `Card` in the plugin UI kit; a curated, token-driven utility safelist that is always available with no build step; and, for anything beyond that, a per-plugin `admin.styles` stylesheet compiled with the new `nextly-build-admin-css` CLI (`@nextlyhq/admin-css`) and declared via `contributes.admin.styles`. Plugin styling stays scoped under `.nextly-admin` and token-driven (light and dark) by construction — the CLI refuses to emit a stylesheet that would leak into the host page or hardcode a color.
