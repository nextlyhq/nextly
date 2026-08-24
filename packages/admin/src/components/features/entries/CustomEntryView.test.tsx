/**
 * The framed/immersive decision has ONE implementation, and both entry routes
 * reach it through this component.
 *
 * The two routes render the same registered view — create and edit resolve the
 * identical `components.Edit` path — so a copy of this decision in either route
 * is a copy that can disagree with the other. It did: a view that took the
 * window while editing a record was framed and capped at the form measure while
 * creating one.
 */
import { render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressAdminChrome,
} from "@admin/components/layout/ChromeSuppression";

import { CustomEntryView } from "./CustomEntryView";

/** A view that asks for the whole panel on mount, as an immersive plugin does. */
function ImmersiveView() {
  // `canExit` says whether the view offers its own way back. It is
  // required, and false is what an immersive editor with its own close
  // control reports — the value is irrelevant to the framing decision.
  useSuppressAdminChrome({ layers: ["pageFrame"], canExit: false });
  return <p>immersive body</p>;
}

function renderIn(children: React.ReactNode) {
  return render(
    <ChromeSuppressionProvider>
      <CustomEntryView breadcrumbs={<nav>trail</nav>}>
        {children}
      </CustomEntryView>
    </ChromeSuppressionProvider>
  );
}

describe("CustomEntryView", () => {
  it("frames a view that asked for nothing, and measures the page", () => {
    renderIn(<p>framed body</p>);

    const container = screen.getByTestId("page-container");
    expect(container).toBeDefined();
    expect(screen.getByText("trail").parentElement?.className).toContain(
      "mb-6"
    );
    // The measure is the page's. A view that set its own would sit inside this
    // container's inset and add a second one to it.
    expect(container.className).toContain("nx-page-shell");
    expect(container.className).not.toContain("contents");
    expect(container.style.getPropertyValue("--nx-shell-measure")).toBe(
      "var(--nx-measure-form)"
    );
  });

  it("neutralises the frame and the trail for a view that took the window", () => {
    renderIn(<ImmersiveView />);

    expect(screen.getByText("immersive body")).toBeDefined();

    // The container is still THERE — removing it would remount the view, which
    // the case below covers — but it stops laying anything out. `contents`
    // takes its box out of the flow, so its grid, padding and background no
    // longer apply and the view reaches every edge.
    const container = screen.getByTestId("page-container");
    expect(container.className).toContain("contents");

    // The trail goes with it. Suppressing the frame while leaving a breadcrumb
    // above the view is the half-done state that reads as a bug, and `hidden`
    // keeps it out of the accessibility tree as well as off the screen.
    const trail = screen.getByText("trail").parentElement;
    expect(trail?.className).toContain("hidden");
    expect(trail?.className).not.toContain("mb-6");
  });

  it("keeps the view mounted when it asks for the window", () => {
    // The request arrives from an effect, so the frame necessarily changes
    // AFTER the view has mounted. If that change replaces the subtree, the
    // plugin view unmounts and mounts again: its state initialisers rerun, its
    // data fetches fire twice, and anything it did on mount happens twice —
    // including asking for the window.
    let mounts = 0;

    function CountingImmersiveView() {
      useSuppressAdminChrome({ layers: ["pageFrame"], canExit: false });
      const [id] = useState(() => ++mounts);
      return <p>view {id}</p>;
    }

    renderIn(<CountingImmersiveView />);

    // Named rather than asserted through the DOM alone: the rendered text
    // would also read "view 1" if a second mount replaced the first.
    expect(mounts).toBe(1);
    expect(screen.getByText("view 1")).toBeDefined();
  });
});
