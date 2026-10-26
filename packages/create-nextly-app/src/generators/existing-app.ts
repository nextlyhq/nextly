import type { DatabaseConfig, ProjectInfo, ProjectType } from "../types";

import { generateAdminPage } from "./admin";
import { generateConfig } from "./config";
import type { GeneratedFiles } from "./generated-files";
import { generateInstrumentation } from "./instrumentation";
import {
  generateMediaRoutes,
  generateUploadsRoute,
  type MediaRouteTemplates,
} from "./media-routes";
import {
  cacheComponentsFiles,
  nextConfigFiles,
  patchNextConfig,
  turnOffCacheComponents,
} from "./next-config";
import { generateRoutes } from "./routes";
import { generateTypesDirectory } from "./types";

/**
 * Everything adding Nextly to an existing app writes, except its env files,
 * and what each step did, for the one report the run ends with.
 *
 * The templates are read by the caller before anything is installed, so a
 * template folder missing a route stops the run with the app untouched.
 *
 * No step replaces a file the app already has: each writes only where nothing
 * is, and says what it left alone and why. The Next config is the one file
 * extended here, by its own rules.
 */
export async function generateIntoExistingApp(
  cwd: string,
  projectType: ProjectType,
  projectInfo: ProjectInfo,
  database: DatabaseConfig,
  templates: MediaRouteTemplates
): Promise<GeneratedFiles[]> {
  return [
    await generateConfig(cwd, projectType, projectInfo),
    await generateRoutes(cwd, projectInfo),
    await generateAdminPage(cwd, projectInfo),
    await generateMediaRoutes(cwd, projectInfo, templates),
    await generateUploadsRoute(cwd, projectInfo, templates),
    await generateInstrumentation(cwd, projectInfo),
    await generateTypesDirectory(cwd, projectInfo),
    nextConfigFiles(await patchNextConfig(cwd, database)),
    // After the packages, so it reads the config that step left.
    cacheComponentsFiles(await turnOffCacheComponents(cwd)),
  ];
}
