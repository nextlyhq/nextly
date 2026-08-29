"use client";

import { type LeftPanel } from "@nextlyhq/builder";
// The shell comes from its own entry: that is the one carrying `"use client"`,
// which is why the root barrel can stay callable from a Server Component.
import { BuilderShell } from "@nextlyhq/builder/shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
// The design system's sheet FIRST, then the editor's, which supplements it.
// `@nextlyhq/builder/styles.css` deliberately ships neither the `--nx-*` tokens
// nor the base reset, because the host already loads a sheet that owns both and
// a second copy would make the result depend on which one won. This route is
// that host: the playground's own `globals.css` says in as many words that it
// must not define the design-system tokens, so without this import the shell
// renders with its colours resolving to nothing — which is precisely what it
// was doing here.
import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

/**
 * The shell, with every slot filled by an inert marker a test can find.
 *
 * Split from the route so the route itself stays a server component and can
 * call `notFound()` before any of this reaches the client. A `"use client"`
 * route could still gate, but the gate would then ship to the browser along
 * with the harness it is meant to withhold.
 *
 * Slot contents are deliberately inert. Anything interactive here would be
 * testing the harness rather than the shell.
 */
export function BuilderShellHarness({
  containerWidth,
}: {
  /**
   * Constrain the shell's container without touching the window.
   *
   * Omitted, the shell fills the viewport as before. Supplied, it gets a box
   * narrower than the window — the arrangement that separates measuring the
   * container from measuring the viewport, which no viewport-sized harness
   * can distinguish.
   */
  containerWidth?: number;
}) {
  return (
    <div
      data-testid="shell-container"
      style={{
        height: "100vh",
        width: containerWidth === undefined ? undefined : containerWidth,
      }}
    >
      <BuilderShell
        onExit={() => {
          // Recorded in the DOM rather than navigating: the assertion is that
          // the shell REPORTS the intent, and a real navigation would take the
          // test off the page it is measuring.
          document.body.setAttribute("data-shell-exited", "true");
        }}
        topBar={<span data-testid="top-bar-slot">Top bar slot</span>}
        breadcrumb={<span data-testid="breadcrumb-slot">Breadcrumb slot</span>}
        inspector={
          <div data-testid="inspector-slot">
            Inspector slot
            {/*
             * The ONE interactive thing in this harness, and it earns the
             * exception the module docblock makes for inert slots.
             *
             * Where a portalled overlay LANDS is not decidable without one: it
             * leaves the DOM position it was opened from, so the question is
             * which container receives it and whether that container is inside
             * the subtree the shell hides. A marker cannot answer that, and
             * jsdom cannot either, since it computes no styles and would report
             * a clipped dropdown and a visible one identically.
             *
             * Deliberately at the BOTTOM of the inspector: the inspector
             * scrolls, so an overlay opened here is where clipping shows. One
             * opened mid-panel looks correct whether or not the container
             * escaped the scroll box.
             */}
            <div style={{ height: "150vh" }} aria-hidden />
            <Select>
              <SelectTrigger data-testid="overlay-trigger">
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent data-testid="overlay-content">
                <SelectItem value="a">First</SelectItem>
                <SelectItem value="b">Second</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        renderPanel={(panel: LeftPanel) => (
          <div data-testid="panel-slot" data-panel={panel}>
            {panel} slot
          </div>
        )}
      >
        <div data-testid="canvas-slot">Canvas slot</div>
      </BuilderShell>
    </div>
  );
}
