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
import { nothingYet, writeNew } from "./write-new";

// Existing-project installs scaffold a blank-equivalent setup: generateConfig
// only emits the blank template, so no plugins are registered and no plugin-
// side admin imports are needed. Templates that register plugins (e.g. blog)
// supply their own admin page that overlays this one via copyTemplate.
const ADMIN_PAGE_TEMPLATE = `"use client";

import "@nextlyhq/admin/style.css";
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
 * pointing at the project's `nextly.config` from where the layout is written.
 * One source with a new project's layout, so an app Nextly is added to gets
 * the same per-request admin.
 */
function adminLayout(
  cwd: string,
  adminDir: string,
  templates: MediaRouteTemplates
): string {
  const text = templates.get(ADMIN_LAYOUT.path);
  if (text === undefined) {
    throw new Error(
      `The templates read for this app hold no ${ADMIN_LAYOUT.path}, so Nextly's admin layout cannot be written.`
    );
  }
  return withRelativeConfigImport(
    text,
    cwd,
    path.join(cwd, adminDir, "layout.tsx"),
    ADMIN_LAYOUT.path
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
  const layout = adminLayout(cwd, adminDir, templates);
  // Where the app sets pageExtensions, Next.js would never serve page.tsx or
  // layout.tsx: each is reported under a name it would serve, which these
  // files, TypeScript with JSX, need to end in tsx, and neither is written.
  const pages = await appPageExtensions(cwd);
  if (pages.extensions !== "absent") {
    const { configName, extensions } = pages;
    for (const [name, text] of [
      ["page", ADMIN_PAGE_TEMPLATE],
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
    ["page.tsx", ADMIN_PAGE_TEMPLATE],
    ["layout.tsx", layout],
  ] as const) {
    await writeNew(cwd, `${adminDir}/${name}`, text, files, {
      why: `the app already has one; Nextly's admin needs its own ${name}, which is`,
      toAdd: text,
    });
  }
  return files;
}
