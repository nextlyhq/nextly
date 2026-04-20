import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

// ============================================================
// Media Route Template (Single Catch-All)
// ============================================================

/**
 * Single catch-all handler for all media operations.
 */
/**
 * Generate the import path for nextly.config based on whether src/ directory is used.
 * - With src/: src/app/api/media/[[...path]]/route.ts → "../../../../../nextly.config"
 * - Without src/: app/api/media/[[...path]]/route.ts → "../../../../nextly.config"
 */
function getConfigImportPath(useSrcDir: boolean): string {
  return useSrcDir
    ? "../../../../../nextly.config"
    : "../../../../nextly.config";
}

const MEDIA_CATCH_ALL_TEMPLATE = (configImportPath: string) => `/**
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

import nextlyConfig from "${configImportPath}";

// Pass config to ensure storage plugins work across all worker processes
const handlers = createMediaHandlers({ config: nextlyConfig });

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
`;

const HEALTH_ROUTE_TEMPLATE = `/**
 * Health Check Endpoint
 *
 * GET /api/health - Check if the API is running
 */

export { GET, HEAD } from "@revnixhq/nextly/api/health";
`;

// ============================================================
// Generator Function
// ============================================================

/**
 * Generate the media API routes for Nextly.
 * Uses a single catch-all route pattern.
 *
 * Creates:
 * - /api/media/[[...path]]/route.ts - All media and folder operations
 * - /api/health/route.ts - Health check endpoint
 */
export async function generateMediaRoutes(
  cwd: string,
  projectInfo: ProjectInfo
): Promise<void> {
  const apiDir = path.join(cwd, projectInfo.appDir, "api");

  // Check if any media route already exists
  const mediaDir = path.join(apiDir, "media");
  if (await fs.pathExists(mediaDir)) {
    throw new Error(
      "Media API routes already exist at api/media. Please remove them first."
    );
  }

  // Generate the catch-all media route
  const mediaRoutePath = path.join(apiDir, "media", "[[...path]]", "route.ts");
  const configImportPath = getConfigImportPath(
    projectInfo.appDir.startsWith("src")
  );
  await fs.ensureDir(path.dirname(mediaRoutePath));
  await fs.writeFile(
    mediaRoutePath,
    MEDIA_CATCH_ALL_TEMPLATE(configImportPath),
    "utf-8"
  );

  // Generate health check route
  const healthRoutePath = path.join(apiDir, "health", "route.ts");
  await fs.ensureDir(path.dirname(healthRoutePath));
  await fs.writeFile(healthRoutePath, HEALTH_ROUTE_TEMPLATE, "utf-8");
}
