/**
 * The site's Proxy: every request it matches is handed to the handlers the
 * site's plugins contribute (`contributes.proxy`) before the page is served.
 *
 * `config` stays a literal here: Next.js reads the matcher from this file
 * without running it. Built files and optimized images are left out, since no
 * handler has anything to say about them.
 */
import { createNextlyProxy } from "nextly/runtime";

import nextlyConfig from "../nextly.config";

export const proxy = createNextlyProxy(nextlyConfig);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
