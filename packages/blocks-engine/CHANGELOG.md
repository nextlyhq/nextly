# @nextlyhq/blocks-engine

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

- [#325](https://github.com/nextlyhq/nextly/pull/325) [`823950b`](https://github.com/nextlyhq/nextly/commit/823950baac1c7302a53b9ca799b6ff517a36b9d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` can now upgrade page documents when a block's schema changes. Blocks that were saved against an older version are automatically brought up to date, one version step at a time, so old pages keep working after a block is improved. If a step is missing or fails, that block keeps its last-good content and is marked so the page shows a placeholder for it instead of breaking, and the failure is reported to the caller.

- [#320](https://github.com/nextlyhq/nextly/pull/320) [`17819aa`](https://github.com/nextlyhq/nextly/commit/17819aaf1642b63c2bc7042e451eef9219275063) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New package `@nextlyhq/blocks-engine`: the foundation of the rebuilt page builder. It ships the stored document format (pages as a plain list of blocks with typed styles, data bindings, visibility rules, and locale-overlay support) plus the pure tree operations editors and tools build on. It is dependency-free and works in any JavaScript runtime, so page documents can be created and edited outside the admin too.

- [#324](https://github.com/nextlyhq/nextly/pull/324) [`a4c38ec`](https://github.com/nextlyhq/nextly/commit/a4c38ec6475299e1a6d2d6c39cb24326706f5474) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` now validates page documents and reports problems in a machine-readable form. Each issue carries a precise location in the document, a stable code, and a suggested fix, so tools and AI agents can pinpoint and repair exactly what is wrong. Validation runs in a strict mode (used when publishing, where unknown blocks or missing breakpoints are errors) or a forgiving mode (used when rendering, where those become warnings so a page still displays what it can).
