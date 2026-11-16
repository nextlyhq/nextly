/**
 * Next.js's page for every address no route matches, logging each one to the
 * SEO plugin's not-found log as the plugin's guide shows.
 */
// Its own document, outside the root layout, so it registers the read too.
import "../nextly/cached-read";
import { logNotFound } from "@nextlyhq/plugin-seo";
import { headers } from "next/headers";
import { after } from "next/server";
import { Suspense } from "react";

/**
 * Reads the request and logs it once the page is sent. Inside `<Suspense>`,
 * so under Cache Components the page's shell is still made at build time and
 * only this part waits for the request.
 */
async function LogNotFound() {
  const requestHeaders = await headers();
  after(() => logNotFound(requestHeaders));
  return null;
}

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <h1>Page not found</h1>
        <Suspense fallback={null}>
          <LogNotFound />
        </Suspense>
      </body>
    </html>
  );
}
