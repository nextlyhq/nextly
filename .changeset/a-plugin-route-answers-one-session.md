---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

A plugin route's answer is private, and its body is left alone.

Two properties every contributed route needs and no plugin author could supply: both headers are internal to `nextly`, so a plugin wanting either would have to hardcode a private string. They are applied where every plugin response already converges.

**A plugin's JSON is no longer rewritten on its way out.** Every JSON response passes through the framework's timezone normalisation, which walks nested values and rewrites any string matching its ISO pattern BY VALUE, whatever the key is called. A plugin's body is whatever that plugin defined and the framework knows nothing about its shape — so a block prop or a description holding text like `2026-09-08T12:34Z` reached the browser already rewritten, and inserting then saving it persisted content the author never wrote. That is silent corruption of stored content, and it is the same reason a webhook delivery's captured text opts out: opaque text has to survive verbatim. A plugin that wants timestamps normalised can normalise them; a plugin whose text is altered has no way back to what it stored.

**An authenticated plugin route now says its answer belongs to one session.** Secure-by-default decides the auth; this is that rule reaching the cache. A route that required a session answers from that caller's own access, so a shared proxy could retain one authorized response and serve it to the next request without the authentication check running again. It is applied to the REFUSAL as well as the answer — a cached 401 replayed to a request that does carry a session is the same defect pointing the other way, and it is the direction that looks like a working gate. A `public: true` route is deliberately left cacheable: it serves the same bytes to everyone, and forcing `no-store` would throw away caching it is entitled to.

The headers are rebuilt rather than set in place, because a handler may return a response whose headers are immutable — one that came from `fetch`, say — and setting a header on that throws, turning a marking step into a 500.

**The privacy headers are MERGED into what the handler already said, not written over it.** Replacing `Vary` was the sharp edge: a response varying on `Accept-Language` became one varying only on `Cookie`, so a cache could answer a second language out of the first one's stored copy — the same session, the wrong representation. Existing fields are kept and `Cookie` is added, and `Vary: *` is left alone because it already means "vary on everything". `Cache-Control` keeps every directive that is orthogonal to privacy — `no-transform` still forbids a proxy rewriting the body whether or not a cache may store it — while the ones that contradict `no-store` (`public` and the freshness family) are dropped rather than left to be resolved by whichever rule a cache prefers.

**The internal markers no longer reach a client.** The response boundary returned early for a non-JSON body BEFORE removing them, and the only other place either marker comes off is downstream of that return — so a plugin answering with CSV or XML, which an export or a sitemap route does, carried an internal control header all the way out. They are now read first, removed unconditionally, and acted on afterwards; removing them before reading would silently turn every opt-out back on.

`withSessionCacheHeaders` moved to `api/response-shapes` and is re-exported from `routeHandler`, so every existing importer keeps its path. The values now have ONE definition that both the response-owning callers and the plugin dispatch read, rather than two that agree until someone edits one.
