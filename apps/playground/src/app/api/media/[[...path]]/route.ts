/**
 * Public Media API — reads only.
 *
 * Media files are served to anonymous visitors, so GET stays public:
 * - GET /api/media                        - List media with pagination
 * - GET /api/media/:id                    - Get media by ID
 * - GET /api/media/folders                - List folders
 * - GET /api/media/folders/:id            - Get folder by ID
 * - GET /api/media/folders/:id/contents   - Get folder contents
 * - GET /api/media/folders/root/contents  - Get root folder contents
 *
 * Writes (upload / update / move / delete) are NOT served here — they require a
 * permission and are mounted, gated, at /admin/api/media. Only exporting GET
 * means any write verb to this public path is refused.
 */

import { createMediaHandlers } from "nextly/api/media-handlers";

import nextlyConfig from "../../../../../nextly.config";

// Pass config to ensure storage plugins work across all worker processes
const handlers = createMediaHandlers({ config: nextlyConfig });

export const GET = handlers.GET;
