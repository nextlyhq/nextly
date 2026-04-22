import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

// Plugin-side admin imports. Every scaffold ships @revnixhq/plugin-form-builder
// as a dependency (see template.ts and installers/dependencies.ts). These three
// lines register the plugin's custom admin field components and load its CSS so
// the Forms collection's drag-and-drop field builder and Submissions filter UI
// render correctly. Without them, the Forms sidebar item still shows but the
// builder falls back to plain JSON/text inputs. Mirror any future plugin-X the
// CLI installs by default (keep in sync with TEMPLATE_PLUGIN_PACKAGES).
const ADMIN_PAGE_TEMPLATE = `"use client";

import "@revnixhq/admin/style.css";
import "@revnixhq/plugin-form-builder/admin";
import "@revnixhq/plugin-form-builder/styles/builder.css";
import "@revnixhq/plugin-form-builder/styles/submissions-filter.css";
import { RootLayout, QueryProvider, ErrorBoundary } from "@revnixhq/admin";

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

  return `import { getBrandingCss } from "@revnixhq/nextly/config";

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
): Promise<void> {
  const adminDir = path.join(cwd, projectInfo.appDir, "admin", "[[...params]]");
  const pagePath = path.join(adminDir, "page.tsx");
  const layoutPath = path.join(adminDir, "layout.tsx");

  if (await fs.pathExists(pagePath)) {
    throw new Error(
      "Admin page already exists at admin/[[...params]]/page.tsx"
    );
  }

  await fs.ensureDir(adminDir);
  await fs.writeFile(pagePath, ADMIN_PAGE_TEMPLATE, "utf-8");
  await fs.writeFile(
    layoutPath,
    getAdminLayoutTemplate(projectInfo.srcDir),
    "utf-8"
  );
}
