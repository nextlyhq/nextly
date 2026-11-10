/**
 * What the root layout's `@/nextly/cached-read` import compiles to with Cache
 * Components off (`NEXTLY_PLAYGROUND_CACHE_COMPONENTS=0`): `next.config.ts`
 * points it here, because Next.js refuses to compile the `"use cache"`
 * function in `cached-read.ts` with Cache Components off. It registers no
 * read function, so Nextly caches reads with `unstable_cache`, as the caching
 * guide tells an app with Cache Components off to. It still tells Nextly how to
 * start when a read finds it not started, as `cached-read.ts` does, so the one
 * import does that whatever the setting.
 */
import { getNextly, registerNextlyStart } from "nextly";

import config from "../../nextly.config";

// Tells Nextly how this app starts it, for a read that finds it not started,
// such as the root layout's `<SiteCode>` on `/_not-found` while `next build`
// prerenders, where nothing else starts it. Nothing starts here: a page that
// calls `getNextly` first is the start that counts. An app that passes
// `getNextly` more than its config passes the same options here.
registerNextlyStart(() => getNextly({ config }));
