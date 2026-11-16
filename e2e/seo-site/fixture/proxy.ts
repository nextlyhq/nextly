/**
 * The site's Proxy, as the SEO plugin's guide wires it: redirects and Gone
 * addresses are answered here, before a page is served.
 */
import { createNextlyProxy } from "nextly/runtime";

import nextlyConfig from "./nextly.config";

export const proxy = createNextlyProxy(nextlyConfig);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
