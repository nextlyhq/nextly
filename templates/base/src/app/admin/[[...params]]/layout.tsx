import { getBrandingCss } from "nextly/config";
import { checkAdminComponents } from "nextly/next";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/generated/plugin-admin-components.generated";

const brandingCss = getBrandingCss(config.admin?.branding);

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Before any admin page: the generated component map must hold every
  // dashboard widget's component. In development it is written again when it
  // is out of date; in production a missing one stops the admin, naming it.
  await checkAdminComponents({ config, registeredComponentPaths });
  return (
    <>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      {children}
    </>
  );
}
