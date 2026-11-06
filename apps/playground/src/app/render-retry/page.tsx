import { notFound } from "next/navigation";
import { Suspense } from "react";

/**
 * A harness route whose server render fails on its first load, for the browser
 * test of an error boundary's `retry()`.
 *
 * The templates' error boundaries call `retry()`, which fetches the segment
 * again and re-renders it, rather than `reset()`, which re-renders what already
 * failed. A built template gives a test no handle on a server failure: its
 * pages are stored renders that read no database. So this route fails on
 * purpose, beneath an `error.tsx` written the same way, and the test proves
 * `retry()` brings the content back without a reload.
 *
 * Gated like the builder harness routes: a test-only route under `src/app/` is
 * otherwise reachable in `pnpm dev:app` and indistinguishable from product.
 */
export default function RenderRetryHarnessRoute({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  if (process.env.NEXTLY_E2E_RETRY_HARNESS !== "1") notFound();

  // The id is read at request time, so it is read beneath a boundary and the
  // rest of the route stays a static shell.
  return (
    <Suspense fallback={null}>
      <FailsOnce searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Ids whose first load has already failed. Held by the server process, so the
 * second render of an id, which is what `retry()` asks for, succeeds.
 */
const failedOnce = new Set<string>();

async function FailsOnce({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) notFound();
  if (!failedOnce.has(id)) {
    failedOnce.add(id);
    throw new Error("The render-retry harness fails an id's first load.");
  }
  return <p data-testid="render-retry-loaded">Loaded {id}</p>;
}
