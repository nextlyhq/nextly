import { connection } from "next/server";
import { Suspense } from "react";
import { getBrandingCss } from "nextly/config";

import config from "../../../../nextly.config";

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
 * Components the shell above it still prerenders.
 */
async function ForThisRequest({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
