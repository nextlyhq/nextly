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

Let a site say which hosts its stylesheets may fetch from.

A stylesheet is a fetching surface. `background-image: url(...)` makes the browser request whatever it names, on every page the rule applies to, and until now the only limit on that was the scheme allowlist. That allowlist answers whether a URL is `http(s)` rather than `javascript:`; it has never had anything to say about WHICH host is reached. A value carrying no scheme at all can still name one, because `//cdn.example/a.png` inherits the page's protocol and nothing else, so a check reading "no scheme, therefore this origin" was wrong about exactly the case that reaches somewhere else. The comment saying so has been corrected, and it is no longer the only thing marking the gap.

`StyleCompileContext` now takes a `mayFetchUrl` predicate, forwarded to every URL a compile can emit. A PREDICATE rather than a list of patterns, so the engine holds no matching rules of its own and the caller keeps ONE answer for every channel it owns; which hosts a site trusts belongs to the site, not to the document format. Left undefined, nothing is asked and a compile behaves exactly as it did before, which is what every caller outside a configured site gets. The question is put last, to a value already known to be well formed, so a host rule is never the reason given for a value that was going to be refused anyway.

Coverage is proved rather than asserted. The test walks the catalog for every leaf that can carry a URL, places a refused host at each one and checks none reach the stylesheet, with an allowed host in the SAME position as the control — without it a compiler emitting nothing for that property would pass by writing no CSS at all. Deriving the positions from the catalog is the point: a written list is a snapshot, and the property added next month would not be in it while the suite still reported full coverage.

Two signatures grew a parameter and are now grouped rather than lengthened. `validateStyleValues` already took six positional arguments and `envelopeRules` ten, which is past where a call reads by position; a further optional would have sat beside one of a different type with nothing but that type to tell them apart, and a policy lost in a mis-slotted call leaves every URL in the document unasked about. `envelopeRules` takes a named object instead, so its arity goes down rather than up.
