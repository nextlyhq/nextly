/**
 * Local uploads, served at the URLs Nextly gives them.
 *
 * The playground stores media on local disk. `next start` serves only the
 * files `public/` held when it started, so this route serves those uploaded
 * since, at the same `/uploads/...` URLs; Next.js still serves the rest.
 */

import { createUploadsHandlers } from "nextly/api/uploads";

import nextlyConfig from "../../../../nextly.config";

const handlers = createUploadsHandlers({ config: nextlyConfig });

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
