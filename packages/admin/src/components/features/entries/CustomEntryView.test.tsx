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
    expect(screen.getByText("trail")).toBeDefined();
    // The measure is the page's. A view that set its own would sit inside this
    // container's inset and add a second one to it.
    expect(container.className).toContain("nx-page-shell");
    expect(container.style.getPropertyValue("--nx-shell-measure")).toBe(
      "var(--nx-measure-form)"
    );
  });

  it("drops the frame and the trail for a view that took the window", () => {
    renderIn(<ImmersiveView />);

    expect(screen.getByText("immersive body")).toBeDefined();
    // Both, not just the container: suppressing the frame while leaving a
    // breadcrumb above the view is the half-done state that reads as a bug.
    expect(screen.queryByTestId("page-container")).toBeNull();
    expect(screen.queryByText("trail")).toBeNull();
  });
});
