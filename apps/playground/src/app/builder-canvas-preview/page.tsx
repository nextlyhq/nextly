import { notFound } from "next/navigation";

import { BuilderCanvasPreviewHarness } from "./harness";

/**
 * A harness route for the canvas's PREVIEW compile.
 *
 * The editor canvas is not an iframe, so viewport breakpoints are emitted as
 * container queries against a named box and the box's own width decides them.
 * Nothing below a browser can check that: jsdom ships no `CSS` object, evaluates
 * no container query, and reports every element as zero-sized — so a stylesheet
 * that is correct and a box that establishes no container produce exactly the
 * same green.
 *
 * Separate from `/builder-canvas`, whose fixture deliberately carries no
 * breakpoints so that no drop coordinate depends on the canvas's width. A tier
 * added there would sit underneath every pointer test on that route.
 *
 * Same env gate as the other harness routes, for the reason theirs give: a
 * dev-only route under `src/app/` is otherwise reachable in `pnpm dev:app` and
 * indistinguishable from product.
 */
export default async function BuilderCanvasPreviewHarnessRoute() {
  if (process.env.NEXTLY_E2E_CANVAS_HARNESS !== "1") notFound();

  return <BuilderCanvasPreviewHarness />;
}
