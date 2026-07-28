/**
 * robots.txt — served at /robots.txt.
 *
 * Built with Nextly's `nextlyRobots` helper, which keeps the admin panel
 * (`/admin`) and API (`/api`) out of the index on a path boundary (so
 * similarly-prefixed content like `/administration` is not swallowed) and
 * points crawlers at the sitemap.
 */

import { nextlyRobots } from "nextly/runtime";

import { absoluteUrl } from "@/lib/site-url";

export default nextlyRobots({ sitemap: absoluteUrl("/sitemap.xml") });
