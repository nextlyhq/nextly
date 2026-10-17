import type { DatabaseConfig, ProjectInfo, ProjectType } from "../types";

import { generateAdminPage } from "./admin";
import { generateConfig } from "./config";
import type { GeneratedFiles } from "./generated-files";
import { generateInstrumentation } from "./instrumentation";
import { generateMediaRoutes } from "./media-routes";
import { nextConfigFiles, patchNextConfig } from "./next-config";
import { generateRoutes } from "./routes";
import { generateTypesDirectory } from "./types";

/**
 * Everything adding Nextly to an existing app writes, except its env files,
 * and what each step did, for the one report the run ends with.
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
  templatesDir: string
): Promise<GeneratedFiles[]> {
  return [
    await generateConfig(cwd, projectType, projectInfo),
    await generateRoutes(cwd, projectInfo),
    await generateAdminPage(cwd, projectInfo),
    await generateMediaRoutes(cwd, projectInfo, templatesDir),
    await generateInstrumentation(cwd, projectInfo),
    await generateTypesDirectory(cwd, projectInfo),
    nextConfigFiles(await patchNextConfig(cwd, database)),
  ];
}
