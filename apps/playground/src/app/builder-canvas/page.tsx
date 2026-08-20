import { notFound } from "next/navigation";

import { BuilderCanvasHarness } from "./harness";

/**
 * A harness route for the canvas itself.
 *
 * The canvas's guarantees are about POINTER MOTION — a press that travels far
 * enough becomes a drag, a target that stops switching under jitter, an
 * indicator that leads the pointer into a gap — and none of them is checkable
 * from a unit test. `useCanvasDrag` reads live `clientX`/`clientY` off real
 * `pointermove` events and keys both its activation and its switch hysteresis on
 * ACCUMULATED TRAVEL, so a test that sets a position rather than moving through
 * one exercises none of the machinery and passes against a canvas that is broken
 * for a real user. jsdom cannot help either: it reports every element as
 * zero-sized, and every drop decision here is a statement about rectangles.
 *
 * Separate from `/builder-shell`, which stays inert. That route's slots are
 * markers by decision — its docblock says anything interactive there would test
 * the harness rather than the shell — and its suite measures the shell's
 * geometry against those markers. A live canvas inside that box would be a
 * moving, scrolling surface in the middle of what those tests measure.
 *
 * Same env gate as the shell harness and the style fixture, for the same reason
 * those have one: a dev-only route under `src/app/` is otherwise reachable in
 * `pnpm dev:app` and indistinguishable from product. That exact shape once put a
 * test-double plugin into a contributor's real plugins list.
 */
export default async function BuilderCanvasHarnessRoute() {
  if (process.env.NEXTLY_E2E_CANVAS_HARNESS !== "1") notFound();

  return <BuilderCanvasHarness />;
}
