import path from "path";

import type { ProjectInfo } from "../types";

import type { GeneratedFiles } from "./generated-files";
import {
  ADMIN_LAYOUT,
  withRelativeConfigImport,
  type MediaRouteTemplates,
} from "./media-routes";
import {
  TSX_FILE,
  appPageExtensions,
  pageExtensionsSkip,
} from "./page-extensions";
import { typesOutputFolder } from "./types";
import { nothingYet, writeNew } from "./write-new";

/**
 * The generated component map's two files, by the name a module imports them
 * as: the list the layout reads, and the map the page loads to register the
 * components.
 */
const COMPONENT_LIST = "plugin-admin-components.generated";
const COMPONENT_MAP = "plugin-admin-imports.generated";

/** How the file at `target` imports `name` from the app's generated types folder. */
function generatedImport(
  cwd: string,
  target: string,
  projectInfo: ProjectInfo,
  name: string
): string {
  const relative = path
    .relative(
      path.dirname(target),
      path.join(cwd, typesOutputFolder(projectInfo), name)
    )
    .split(path.sep)
    .join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

// Existing-project installs scaffold a blank-equivalent setup: generateConfig
// only emits the blank template, so no plugins are registered yet. The page
// still loads the component map, empty until then, so a plugin added later
// registers its components once `next dev` rewrites the map. Templates that
// register plugins (e.g. blog) supply their own admin page that overlays this
// one via copyTemplate.
const adminPageTemplate = (componentMap: string) => `"use client";

import "@nextlyhq/admin/style.css";
import "${componentMap}";
import { RootLayout, QueryProvider, ErrorBoundary } from "@nextlyhq/admin";

export default function AdminPage() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error("Admin error:", error, errorInfo);
      }}
    >
      <QueryProvider>
        <RootLayout />
      </QueryProvider>
    </ErrorBoundary>
  );
}
`;

/**
 * The admin layout, as the base template holds it, with its config import
 * pointing at the project's `nextly.config`, and its component-list import at
 * the app's generated types folder, from where the layout is written. One
 * source with a new project's layout, so an app Nextly is added to gets the
 * same per-request admin.
 */
function adminLayout(
  cwd: string,
  adminDir: string,
  projectInfo: ProjectInfo,
  templates: MediaRouteTemplates
): string {
  const text = templates.get(ADMIN_LAYOUT.path);
  if (text === undefined) {
    throw new Error(
      `The templates read for this app hold no ${ADMIN_LAYOUT.path}, so Nextly's admin layout cannot be written.`
    );
  }
  const target = path.join(cwd, adminDir, "layout.tsx");
  return withRelativeConfigImport(text, cwd, target, ADMIN_LAYOUT.path).replace(
    new RegExp(`"[^"]*/${COMPONENT_LIST.replaceAll(".", "\\.")}"`),
    `"${generatedImport(cwd, target, projectInfo, COMPONENT_LIST)}"`
  );
}

/**
 * Generate the admin panel page and layout.
 * Uses [[...params]] to match the expected route pattern.
 */
export async function generateAdminPage(
  cwd: string,
  projectInfo: ProjectInfo,
  templates: MediaRouteTemplates
): Promise<GeneratedFiles> {
  const files = nothingYet();
  const adminDir = `${projectInfo.appDir}/admin/[[...params]]`;
  // The page and its layout are judged one by one: a layout the app has is
  // kept even when the page is missing.
  const layout = adminLayout(cwd, adminDir, projectInfo, templates);
  const page = adminPageTemplate(
    generatedImport(
      cwd,
      path.join(cwd, adminDir, "page.tsx"),
      projectInfo,
      COMPONENT_MAP
    )
  );
  // Where the app sets pageExtensions, Next.js would never serve page.tsx or
  // layout.tsx: each is reported under a name it would serve, which these
  // files, TypeScript with JSX, need to end in tsx, and neither is written.
  const pages = await appPageExtensions(cwd);
  if (pages.extensions !== "absent") {
    const { configName, extensions } = pages;
    for (const [name, text] of [
      ["page", page],
      ["layout", layout],
    ] as const) {
      files.skipped.push(
        pageExtensionsSkip(
          `${adminDir}/${name}`,
          text,
          { configName, extensions },
          TSX_FILE
        )
      );
    }
    return files;
  }
  for (const [name, text] of [
    ["page.tsx", page],
    ["layout.tsx", layout],
  ] as const) {
    await writeNew(cwd, `${adminDir}/${name}`, text, files, {
      why: `the app already has one; Nextly's admin needs its own ${name}, which is`,
      toAdd: text,
    });
  }
  return files;
}
