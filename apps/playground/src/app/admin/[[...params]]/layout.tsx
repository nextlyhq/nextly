import { getBrandingCss } from "nextly/config";

import config from "../../../../nextly.config";
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
      {children}
    </AdminShell>
  );
}
