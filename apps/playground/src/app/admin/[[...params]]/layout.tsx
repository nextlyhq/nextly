import { connection } from "next/server";
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
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The admin renders for each request, never from a cache another user's
  // request filled: under Cache Components a layout that reads no request data
  // would otherwise be prerendered once and served to everyone.
  await connection();
  // Before any admin page, as in an app's admin: in development, the generated
  // component map is written again when it falls behind the config.
  await checkAdminComponents({ config, registeredComponentPaths });
  return (
    <AdminShell>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      {children}
    </AdminShell>
  );
}
