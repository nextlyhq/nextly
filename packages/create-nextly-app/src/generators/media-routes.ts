import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";
import { resolveTemplatePath } from "../utils/template";

import type { GeneratedFiles } from "./generated-files";

/**
 * The routes an existing app receives, as the base template's app directory
 * holds them. They are read from the template rather than kept as strings
 * here, so an app Nextly is added to gets the same files a new project does:
 *
 * - the admin's media route, `admin/api/media/...`, where the admin uploads,
 *   lists and deletes media, every request checked against the signed-in
 *   caller's media permissions (`requireAuth: true` in the template);
 * - the public media route, `api/media/...`, which serves reads only;
 * - the health check.
 */
const ROUTES = [
  {
    path: "admin/api/media/[[...path]]/route.ts",
    importsConfig: true,
    adminNeedsIt: true,
  },
  {
    path: "api/media/[[...path]]/route.ts",
    importsConfig: true,
    adminNeedsIt: false,
  },
  { path: "api/health/route.ts", importsConfig: false, adminNeedsIt: false },
] as const;

/**
 * The import that brings in the Nextly config: the template spells it through
 * the `@nextly-config` alias or a path relative to its own layout, neither of
 * which an existing app is guaranteed to resolve.
 */
const CONFIG_IMPORT =
  /(import\s+\w+\s+from\s+")([^"]*(?:@nextly-config|nextly\.config))(";)/;

const LEFT_AS_IT_IS = "already exists; left as it is";

/**
 * Why a route the admin calls was left as it was. The admin's media library
 * needs Nextly's handler at that path, so the report carries the route the
 * project would have received, for the developer to put there by hand.
 */
const ADMIN_NEEDS_IT = `${LEFT_AS_IT_IS}. The admin's media library needs Nextly's route here: replace or merge it with the content below`;

/**
 * Write the media and health routes into an existing app, from the template
 * in `templatesDir` (the CLI's bundled templates by default).
 *
 * A file the project already has is never replaced: it is reported as
 * skipped, exactly as it was. Every route is read and prepared before any is
 * written, so a template whose route no longer imports the config is refused
 * with nothing written.
 */
export async function generateMediaRoutes(
  cwd: string,
  projectInfo: ProjectInfo,
  templatesDir: string = resolveTemplatePath()
): Promise<GeneratedFiles> {
  const prepared = await Promise.all(
    ROUTES.map(route => prepareRoute(cwd, projectInfo, templatesDir, route))
  );
  const result: GeneratedFiles = { written: [], changed: [], skipped: [] };
  for (const route of prepared) {
    await writeIfAbsent(cwd, route, result);
  }
  return result;
}

/** A route ready to write: where it goes, its text, and whether the admin depends on it. */
interface PreparedRoute {
  target: string;
  text: string;
  adminNeedsIt: boolean;
}

/** One route's destination in the project and its text, with the config import made relative. */
async function prepareRoute(
  cwd: string,
  projectInfo: ProjectInfo,
  templatesDir: string,
  route: (typeof ROUTES)[number]
): Promise<PreparedRoute> {
  const source = path.join(templatesDir, "base", "src", "app", route.path);
  const text = await fs.readFile(source, "utf-8");
  const target = path.join(cwd, projectInfo.appDir, route.path);
  return {
    target,
    text: route.importsConfig
      ? withRelativeConfigImport(text, cwd, target, route.path)
      : text,
    adminNeedsIt: route.adminNeedsIt,
  };
}

/**
 * The route's text with its config import pointing at the project's
 * `nextly.config` by a path relative to where the route is written, so it
 * resolves with or without a `src/` folder and with no import alias at all.
 */
function withRelativeConfigImport(
  text: string,
  cwd: string,
  target: string,
  routePath: string
): string {
  if (!CONFIG_IMPORT.test(text)) {
    throw new Error(
      `The template's ${routePath} does not import the Nextly config, so no route that finds it can be written.`
    );
  }
  const specifier = toPosix(
    path.relative(path.dirname(target), path.join(cwd, "nextly.config"))
  );
  return text.replace(
    CONFIG_IMPORT,
    (_match, head: string, _old: string, tail: string) =>
      `${head}${specifier}${tail}`
  );
}

/**
 * Write a route only where nothing is: an existing file is reported as
 * skipped. The write itself refuses an existing path too (`wx`), so a file
 * that appears between the check and the write is not replaced either.
 */
async function writeIfAbsent(
  cwd: string,
  { target, text, adminNeedsIt }: PreparedRoute,
  result: GeneratedFiles
): Promise<void> {
  const relative = toPosix(path.relative(cwd, target));
  if (await fs.pathExists(target)) {
    result.skipped.push(
      adminNeedsIt
        ? { path: relative, why: ADMIN_NEEDS_IT, toAdd: text }
        : { path: relative, why: LEFT_AS_IT_IS }
    );
    return;
  }
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, text, { encoding: "utf-8", flag: "wx" });
  result.written.push(relative);
}

/** A path in `/` form, as an import specifier and the report both spell it. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
