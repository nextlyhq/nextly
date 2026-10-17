import { checkAdminComponents } from "nextly/runtime";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/generated/plugin-admin-components.generated";

// Before any admin page: the generated component map must hold your plugin's
// dashboard widget components. `next dev` rewrites it when it falls behind.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await checkAdminComponents({ config, registeredComponentPaths });
  return children;
}
