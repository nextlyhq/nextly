/**
 * Media API Routes (Catch-All Handler)
 *
 * This single route handles all media operations:
 *
 * Media Files:
 * - GET    /api/media                        - List media with pagination
 * - POST   /api/media                        - Upload new media file
 * - GET    /api/media/:id                    - Get media by ID
 * - PATCH  /api/media/:id                    - Update media metadata
 * - DELETE /api/media/:id                    - Delete media file
 * - PATCH  /api/media/:id/move               - Move media to folder
 *
 * Folders:
 * - GET    /api/media/folders                - List folders
 * - POST   /api/media/folders                - Create folder
 * - GET    /api/media/folders/:id            - Get folder by ID
 * - PATCH  /api/media/folders/:id            - Update folder
 * - DELETE /api/media/folders/:id            - Delete folder
 * - GET    /api/media/folders/:id/contents   - Get folder contents
 * - GET    /api/media/folders/root/contents  - Get root folder contents
 */

import { createMediaHandlers } from "@revnixhq/nextly/api/media-handlers";

import nextlyConfig from "../../../../../nextly.config";

// Pass config to ensure storage plugins work across all worker processes
const handlers = createMediaHandlers({ config: nextlyConfig });

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
