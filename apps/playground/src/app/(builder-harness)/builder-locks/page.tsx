import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BuilderLocksHarness } from "./harness";

/** A title of its own, so the page is named in a tab and to assistive tech. */
export const metadata: Metadata = { title: "Builder locks harness" };

/**
 * A harness route for the editor inside locked areas.
 *
 * The lock rules are judged by the engine and refused by the editor's store,
 * and both have unit tests. What only a browser can show is the author's side:
 * that a drag, an insert, a keyboard move and a toolbar action inside a locked
 * area are refused before they happen, in words; that a block locked to its
 * content shows its other settings read-only; and that a stored break offers a
 * repair that keeps every block. No core block declares a lock, so the locked
 * blocks are registered here, for this route only, rather than contributed by
 * a test plugin every playground run would then carry.
 *
 * `?seed=broken` opens a page stored before its locks were enforced, for the
 * repair. Any other value opens the page as inserting places its blocks.
 *
 * Gated like `/builder-canvas`, by the same flag: a dev-only route under
 * `src/app/` is otherwise reachable in `pnpm dev:app` and indistinguishable
 * from product.
 */
export default function BuilderLocksHarnessRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NEXTLY_E2E_CANVAS_HARNESS !== "1") notFound();

  // Read beneath a Suspense boundary: the query is request data, and under
  // Cache Components a route that reads it above one cannot prerender its
  // shell.
  return (
    <Suspense fallback={null}>
      <SeededHarness searchParams={searchParams} />
    </Suspense>
  );
}

async function SeededHarness({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { seed } = await searchParams;
  return <BuilderLocksHarness seed={seed === "broken" ? "broken" : "placed"} />;
}
