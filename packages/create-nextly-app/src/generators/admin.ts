import type { ProjectInfo } from "../types";

import type { GeneratedFiles } from "./generated-files";
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
 * Generate the layout template with the correct relative import path
 * to nextly.config based on whether the project uses a src/ directory.
 *
 * With src/:    src/app/admin/[[...params]]/layout.tsx → ../../../../nextly.config
 * Without src:  app/admin/[[...params]]/layout.tsx     → ../../../nextly.config
 */
function getAdminLayoutTemplate(srcDir: boolean): string {
  const configImportPath = srcDir
    ? "../../../../nextly.config"
    : "../../../nextly.config";

  return `import { getBrandingCss } from "nextly/config";

import config from "${configImportPath}";

const brandingCss = getBrandingCss(config.admin?.branding);

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      {children}
    </>
  );
}
`;
}

/**
 * Generate the admin panel page and layout.
 * Uses [[...params]] to match the expected route pattern.
 */
export async function generateAdminPage(
  cwd: string,
  projectInfo: ProjectInfo
): Promise<GeneratedFiles> {
  const files = nothingYet();
  const adminDir = `${projectInfo.appDir}/admin/[[...params]]`;
  // The page and its layout are judged one by one: a layout the app has is
  // kept even when the page is missing.
  const layout = getAdminLayoutTemplate(projectInfo.srcDir);
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
