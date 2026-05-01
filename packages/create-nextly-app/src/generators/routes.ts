import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

const API_ROUTE_TEMPLATE = `// Imported from \`@revnixhq/nextly/runtime\` (not the package root) so the
// Next.js-coupled handler factory stays out of Node-only code paths
// like the CLI and config loaders. See task 24 stage 1 for context.
import { createDynamicHandlers } from "@revnixhq/nextly/runtime";

const handlers = createDynamicHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
`;

/**
 * Generate the API route handler for Nextly.
 * Creates the catch-all route at /admin/api/[[...params]]/route.ts
 */
export async function generateRoutes(
  cwd: string,
  projectInfo: ProjectInfo
): Promise<void> {
  const routePath = path.join(
    cwd,
    projectInfo.appDir,
    "admin",
    "api",
    "[[...params]]",
    "route.ts"
  );

  // Check if route already exists
  if (await fs.pathExists(routePath)) {
    throw new Error(
      "API route already exists at admin/api/[[...params]]/route.ts"
    );
  }

  await fs.ensureDir(path.dirname(routePath));
  await fs.writeFile(routePath, API_ROUTE_TEMPLATE, "utf-8");
}
