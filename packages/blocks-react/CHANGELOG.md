# @nextlyhq/blocks-react

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
