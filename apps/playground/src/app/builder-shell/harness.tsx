"use client";

import { BuilderShell, type LeftPanel } from "@nextlyhq/builder";
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
export function BuilderShellHarness() {
  return (
    <div style={{ height: "100vh" }}>
      <BuilderShell
        onExit={() => {
          // Recorded in the DOM rather than navigating: the assertion is that
          // the shell REPORTS the intent, and a real navigation would take the
          // test off the page it is measuring.
          document.body.setAttribute("data-shell-exited", "true");
        }}
        topBar={<span data-testid="top-bar-slot">Top bar slot</span>}
        breadcrumb={<span data-testid="breadcrumb-slot">Breadcrumb slot</span>}
        inspector={<div data-testid="inspector-slot">Inspector slot</div>}
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
