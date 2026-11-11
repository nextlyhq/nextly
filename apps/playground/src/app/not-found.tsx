/**
 * The page for an address nothing on the site answers, worded as Next.js's
 * own, and the SEO plugin told which address was asked for, so it can be
 * listed under Redirects › Not found and given a redirect.
 *
 * The log is written beneath a Suspense boundary: reading the request's
 * headers makes that part dynamic, and under Cache Components dynamic work
 * outside a boundary fails the build. Where the SEO plugin is not on, or the
 * request did not pass through the site's Proxy, nothing is logged.
 */
import { logNotFound } from "@nextlyhq/plugin-seo";
import { headers } from "next/headers";
import { Suspense } from "react";

async function LogThisAddress(): Promise<null> {
  await logNotFound(await headers());
  return null;
}

export default function NotFound() {
  return (
    <main style={{ padding: "48px 16px", textAlign: "center" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>404</h1>
      <p style={{ marginTop: 8 }}>This page could not be found.</p>
      <Suspense fallback={null}>
        <LogThisAddress />
      </Suspense>
    </main>
  );
}
