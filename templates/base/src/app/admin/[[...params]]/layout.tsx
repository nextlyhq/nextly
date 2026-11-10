import { connection } from "next/server";
import { Suspense } from "react";
import { adminMetadata, getBrandingCss } from "nextly/config";
import { checkAdminComponents } from "nextly/runtime";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/generated/plugin-admin-components.generated";

const brandingCss = getBrandingCss(config.admin?.branding);

/**
 * The admin is never a page for search results: `noindex, nofollow` in the
 * head of the first HTML the server sends, whatever plugins the site runs.
 */
export const metadata = adminMetadata;

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
