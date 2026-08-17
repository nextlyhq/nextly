import { notFound } from "next/navigation";

import { BuilderShellHarness } from "./harness";

/**
 * A harness route for the editor shell's layout.
 *
 * The shell's guarantees are geometric — panel widths inside their bounds, the
 * canvas keeping its floor, widths surviving a reload, focus moving between
 * regions — and none of them is checkable from a unit test: jsdom reports every
 * element as zero-sized and applies no stylesheet, so an assertion about a
 * width passes whatever the CSS does. They need a real browser, which needs a
 * real route.
 *
 * Deliberately a HARNESS rather than the eventual editor. The shell's real host
 * is the page-builder plugin's admin route, and that route needs an inserter, a
 * layers tree and an inspector that do not exist yet. Waiting for them would
 * mean shipping the shell unverified; testing through a harness verifies the
 * shell itself, with the slots filled by markers a test can find. When the real
 * host exists this route stays, because it keeps testing the shell rather than
 * the editor built on it.
 *
 * The slot contents are intentionally inert. Anything interactive here would be
 * testing the harness.
 */
export default async function BuilderShellHarnessRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // GATED, for the reason the style-fixture plugin had to be: a dev-only route
  // under `src/app/` is always reachable in `pnpm dev:app` and indistinguishable
  // from product. That exact shape put a test-double plugin into a
  // contributor's real plugins list. Same env-var gate as
  // `NEXTLY_E2E_STYLE_FIXTURE`, so the two are recognisable as one convention.
  if (process.env.NEXTLY_E2E_SHELL_HARNESS !== "1") notFound();

  /*
   * An optional CONTAINER width, so a test can give the shell a narrow box
   * inside a wide window.
   *
   * That combination is the one the shell used to get wrong and the one no
   * viewport-sized harness can express: it sizes to its container, so a wide
   * window around a narrow column is precisely where measuring the window
   * reports "fits" while the layout is being compressed past its minimums.
   *
   * Read on the SERVER and passed down, so the first client render already has
   * it — resolving it in the browser instead would render full-width once and
   * narrow afterwards, which is a hydration mismatch and also hides the very
   * first measurement the test is about.
   */
  const raw = (await searchParams).container;
  const parsed = Number(typeof raw === "string" ? raw : "");
  const container = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;

  return <BuilderShellHarness containerWidth={container} />;
}
