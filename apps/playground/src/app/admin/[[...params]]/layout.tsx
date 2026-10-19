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
  // Before any admin page: the generated component map must hold every
  // dashboard widget's component, as in an app's admin.
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
