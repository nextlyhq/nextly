import { connection } from "next/server";
import { Suspense } from "react";
import { checkAdminComponents } from "nextly/runtime";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/generated/plugin-admin-components.generated";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <ForThisRequest>{children}</ForThisRequest>
    </Suspense>
  );
}

/**
 * The admin renders for each request, never from a cache another user's
 * request filled. Beneath the layout's Suspense boundary, so under Cache
 * Components the rest of the page still prerenders: request work outside a
 * boundary fails the build, in development too, where `checkAdminComponents`
 * boots nextly.
 */
async function ForThisRequest({ children }: { children: React.ReactNode }) {
  await connection();
  // In development, the generated component map is written again when it
  // falls behind the config, so a component the plugin under development
  // adds draws without a command. In production it does nothing.
  await checkAdminComponents({ config, registeredComponentPaths });
  return children;
}
