---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Refuse an unknown URL scheme in a block's attributes instead of naming the dangerous ones.

The guard every block prop that reaches an `href` or a `src` passes through was a BLOCKLIST: `javascript:`, `vbscript:` and `data:` were named and refused, and everything else was allowed. So `blob:` was allowed — and a `blob:` document runs in the origin that created it, which is the page's own. So were `filesystem:`, `about:`, `view-source:`, and whatever a browser ships next. A blocklist has to predict every dangerous scheme and misses the one nobody had heard of when it was written, which is the same reason the style compiler and the remote-host policy are both allowlists.

Four schemes are accepted now: `http` and `https` for a destination, `mailto` and `tel` for the two that open an app rather than a page and are the ordinary content of a contact button. A value carrying no scheme is untouched, so `/about`, `a.png`, `#top` and `//cdn.example/a.png` all still work — which hosts may be REACHED is a separate question, asked of the host policy by the blocks that fetch rather than of a list of schemes.

These are the same four the rich-text sanitizer already allows, and that is deliberate rather than a coincidence: it answers this identical question for stored rich text, and two surfaces of one product disagreeing about which schemes are safe is how a value refused inside a link body becomes acceptable in a button beside it. The admin's link editor keeps accepting a wider set for what an author may TYPE, because that is an input affordance and not the boundary.

The scheme is read from the value as the browser's parser will read it, and through the ENGINE's normalisation rather than a second copy of the rules — two spellings of one algorithm disagreeing is how a scheme hides from a check while still navigating. Tab, LF and CR are removed wherever they appear because the parser removes them; leading control characters and spaces are trimmed because the parser trims them.

An interior space is deliberately NOT removed, because the parser does not remove one either — it percent-encodes it. `hero image:1.png` is an ordinary relative path to a file whose name holds a space, and collapsing that to `heroimage:1.png` would invent a scheme nobody wrote and refuse the path. A control character still sitting inside the value after normalisation refuses it outright instead: one never appears in a URL anybody meant, since it has to be percent-encoded to survive, and its only use here is to split a scheme so a reader sees none where a browser may still see one.

The value returned is still the original trimmed string, so a legitimate URL is never silently rewritten.
