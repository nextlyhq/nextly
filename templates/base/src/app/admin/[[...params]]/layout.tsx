import { connection } from "next/server";
import { Suspense } from "react";
import { getBrandingCss } from "nextly/config";
import { checkAdminComponents } from "nextly/runtime";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/generated/plugin-admin-components.generated";

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
      <Suspense fallback={null}>
        <ForThisRequest>{children}</ForThisRequest>
      </Suspense>
    </>
  );
}

/**
 * The admin renders for each request, never from a cache another user's
 * request filled. Beneath the layout's Suspense boundary, so under Cache
 * Components the shell above it still prerenders: request work outside a
 * boundary fails the build, in development too, where `checkAdminComponents`
 * boots nextly.
 */
async function ForThisRequest({ children }: { children: React.ReactNode }) {
  await connection();
  // In development, the generated component map is written again when it
  // falls behind the config, so a plugin added while `next dev` runs draws
  // its components without a command. In production it does nothing.
  await checkAdminComponents({ config, registeredComponentPaths });
  return children;
}
