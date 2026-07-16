/**
 * Admin Media API — permission-gated management surface.
 *
 * The admin's session cookie is scoped to `/admin`, so it reaches here but not
 * the public `/api/media`. Every operation is checked against a media
 * permission (read/create/update/delete-media) and the acting identity is
 * taken from the session/API key, never a request field. This is the only
 * place media can be uploaded, edited, moved or deleted.
 *
 * Supported (all gated):
 * - GET/POST/PATCH/DELETE /admin/api/media/*  (files, folders, bulk delete)
 */

import { createMediaHandlers } from "nextly/api/media-handlers";

import nextlyConfig from "../../../../../../nextly.config";

const handlers = createMediaHandlers({
  config: nextlyConfig,
  requireAuth: true,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
