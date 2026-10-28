import { connection } from "next/server";
import { getBrandingCss } from "nextly/config";

import config from "../../../../nextly.config";

const brandingCss = getBrandingCss(config.admin?.branding);

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The admin renders for each request, never from a cache another user's
  // request filled: under Cache Components a layout that reads no request data
  // would otherwise be prerendered once and served to everyone.
  await connection();
  return (
    <>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      {children}
    </>
  );
}
