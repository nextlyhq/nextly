/**
 * Local uploads, served at the URLs Nextly gives them.
 *
 * Nextly's default storage writes uploads to `public/uploads` and links them
 * as `/uploads/...`. `next start` serves only the files `public/` held when
 * it started, so without this route a file uploaded since answers 404 until
 * the server restarts. Next.js serves the files it has first; this answers
 * the rest, at the same URLs, and answers 404 when media is kept in cloud
 * storage instead.
 *
 * If you set `baseUrl` on local storage, move this folder to match it.
 */

import { createUploadsHandlers } from "nextly/api/uploads";

import config from "@nextly-config";

const handlers = createUploadsHandlers({ config });

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
