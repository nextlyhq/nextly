/**
 * What the root layout's `@/nextly/cached-read` import compiles to with Cache
 * Components off (`NEXTLY_PLAYGROUND_CACHE_COMPONENTS=0`): `next.config.ts`
 * points it here, because Next.js refuses to compile the `"use cache"`
 * function in `cached-read.ts` with Cache Components off. It registers no
 * read function, so Nextly caches reads with `unstable_cache`, as the caching
 * guide tells an app with Cache Components off to. It still starts Nextly, as
 * `cached-read.ts` does, so the one import does that whatever the setting.
 */
import { getNextly } from "nextly";

import config from "../../nextly.config";

// Starts Nextly as the root layout loads, so a read made before any page has
// started it, such as the root layout's `<SiteCode>` on `/_not-found` while
// `next build` prerenders, finds it starting and waits for it: nothing else
// starts Nextly in a build's prerender workers. A failed start (the database
// down, say) is caught here so it is not an unhandled rejection; the next
// read waits for or retries the start, and reports it.
void getNextly({ config }).catch(() => undefined);
