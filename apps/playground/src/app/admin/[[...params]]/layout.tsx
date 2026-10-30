import { connection } from "next/server";
import { Suspense } from "react";
import { getBrandingCss } from "nextly/config";
import { checkAdminComponents } from "nextly/runtime";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/plugin-admin-components.generated";
import { AdminShell } from "../../admin-shell";

const brandingCss = getBrandingCss(config.admin?.branding);

/**
 * The panel's own shell, mounted here rather than at the app root so the public
 * routes beside it are not charged for a client runtime they never use.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminShell>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      <Suspense fallback={null}>
        <ForThisRequest>{children}</ForThisRequest>
      </Suspense>
    </AdminShell>
  );
}

/**
 * What the admin does for each request, beneath the layout's Suspense boundary
 * so the shell above it prerenders. Under Cache Components, request work
 * outside a boundary fails the build, in development too, where
 * `checkAdminComponents` boots nextly.
 */
async function ForThisRequest({ children }: { children: React.ReactNode }) {
  // Never from a cache another user's request filled.
  await connection();
  // Before any admin page, as in an app's admin: in development, the generated
  // component map is written again when it falls behind the config.
  await checkAdminComponents({ config, registeredComponentPaths });
  return children;
}
