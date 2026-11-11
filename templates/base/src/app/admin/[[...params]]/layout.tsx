import { connection } from "next/server";
import { Suspense } from "react";
import {
  ADMIN_BRANDING_ELEMENT_ID,
  adminBrandingJson,
  adminMetadataFor,
  getBrandingCss,
} from "nextly/config";

import config from "../../../../nextly.config";
import { registeredComponentPaths } from "../../../types/generated/plugin-admin-components.generated";

const brandingCss = getBrandingCss(config.admin?.branding);
// The configured logo, name and favicon, read by the admin before any request
// answers, so they are right from the first paint.
const brandingJson = adminBrandingJson(config.admin?.branding);

/**
 * The admin is never a page for search results: `noindex, nofollow` in the
 * head of the first HTML the server sends, whatever plugins the site runs,
 * and the configured favicon's link beside it.
 */
export const metadata = adminMetadataFor(config.admin?.branding);

/**
 * Prebuilt in production: the same page for every visitor, built once, with
 * no request-time work and nothing read from the database. Everything about
 * the person comes from the admin's own requests once it loads, so a CDN or
 * the browser may keep the page, and it is served while the server is still
 * starting.
 */
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
      {brandingJson && (
        <script
          type="application/json"
          id={ADMIN_BRANDING_ELEMENT_ID}
          dangerouslySetInnerHTML={{ __html: brandingJson }}
        />
      )}
      {process.env.NODE_ENV === "development" ? (
        <Suspense fallback={null}>
          <ComponentMapKeptCurrent>{children}</ComponentMapKeptCurrent>
        </Suspense>
      ) : (
        children
      )}
    </>
  );
}

/**
 * Development only: before any admin page, the generated component map is
 * written again when it falls behind the config. A production build serves
 * the map it was built with, so it drops this, and the page with it is
 * prebuilt. Beneath a Suspense boundary, as request work outside one fails a
 * Cache Components build, in development too. The check is loaded here, so a
 * production page never loads the runtime it lives in.
 */
async function ComponentMapKeptCurrent({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const { checkAdminComponents } = await import("nextly/runtime");
  await checkAdminComponents({ config, registeredComponentPaths });
  return children;
}
