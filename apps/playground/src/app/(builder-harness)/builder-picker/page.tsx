import { notFound } from "next/navigation";

import { BuilderPickerHarness } from "./harness";

/**
 * A harness route for the in-place block picker opened at a fixed place.
 *
 * In the editor the picker opens at a fixed place from the canvas's add
 * controls; this route opens it the same way from a stand-in "+" at each
 * corner of the window, so a browser can check the picker stays fully on
 * screen wherever it opens, and that "Browse all" carries its place into the
 * Add panel. It mounts the real canvas, picker and panel, and decides
 * nothing they decide.
 *
 * Gated with the canvas harness, for the reason every harness route is: a
 * dev-only route under `src/app/` is otherwise reachable in `pnpm dev:app`
 * and indistinguishable from product.
 */
export default async function BuilderPickerHarnessRoute() {
  if (process.env.NEXTLY_E2E_CANVAS_HARNESS !== "1") notFound();

  return <BuilderPickerHarness />;
}
