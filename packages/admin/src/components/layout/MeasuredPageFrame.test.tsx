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
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressAdminChrome,
} from "./ChromeSuppression";

import { CONTENT_PAGE_MEASURE } from "./content-measure";
import { PageContainer } from "./page-container";

import { MeasuredPageFrame } from "./MeasuredPageFrame";

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
      <MeasuredPageFrame breadcrumbs={<nav>trail</nav>}>
        {children}
      </MeasuredPageFrame>
    </ChromeSuppressionProvider>
  );
}

describe("MeasuredPageFrame", () => {
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
      "var(--nx-measure-wide)"
    );
    // The control for the line above: asserting only that SOME measure is set
    // would pass on a frame that had silently kept the settings measure.
    expect(container.style.getPropertyValue("--nx-shell-measure")).not.toBe(
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

  it("frames content that renders no trail", () => {
    // The default entry form carries its own header chrome and passes no
    // breadcrumbs. The slot still renders, so this caller and the custom-view
    // caller reconcile identically — a slot that appeared only sometimes would
    // shift the content's position and remount it.
    render(
      <ChromeSuppressionProvider>
        <MeasuredPageFrame>
          <p>default form</p>
        </MeasuredPageFrame>
      </ChromeSuppressionProvider>
    );

    expect(screen.getByText("default form")).toBeDefined();
    const container = screen.getByTestId("page-container");
    expect(container.className).toContain("nx-page-shell");

    // The slot stays in the tree so both callers reconcile the same way, but
    // it reserves no space: a margin around nothing pushes this editor down by
    // the height of a breadcrumb it never renders.
    const trail = container.firstElementChild;
    expect(trail?.childNodes.length).toBe(0);
    expect(trail?.className).toBe("");
  });

  it("drops the frame for a takeover field inside the default form", () => {
    // `BlocksField` asks from INSIDE the form rather than as a registered
    // view, so the default branch has to honour the request too. A page that
    // declared a measure without honouring it would hand the page builder a
    // 56rem column to work in.
    function FormWithTakeoverField() {
      useSuppressAdminChrome({ layers: ["pageFrame"], canExit: false });
      return <p>builder canvas</p>;
    }

    render(
      <ChromeSuppressionProvider>
        <MeasuredPageFrame>
          <FormWithTakeoverField />
        </MeasuredPageFrame>
      </ChromeSuppressionProvider>
    );

    expect(screen.getByText("builder canvas")).toBeDefined();
    expect(screen.getByTestId("page-container").className).toContain(
      "contents"
    );
  });

  it("reserves no space for a null trail either", () => {
    // `null` is the other way a caller says "no trail" — a conditional that
    // renders nothing yields it, and a strict `undefined` check would give
    // that caller the 24px gap this slot exists to avoid.
    render(
      <ChromeSuppressionProvider>
        <MeasuredPageFrame breadcrumbs={null}>
          <p>body</p>
        </MeasuredPageFrame>
      </ChromeSuppressionProvider>
    );

    const trail = screen.getByTestId("page-container").firstElementChild;
    expect(trail?.className).toBe("");
  });
});

describe("the content measure is declared once", () => {
  it("renders whatever the shared constant says, not a literal of its own", () => {
    // Reading the constant back is what makes this a wiring test rather than a
    // restatement: change `CONTENT_PAGE_MEASURE` and this follows, while a
    // frame that had drifted back to its own literal fails here.
    render(
      <ChromeSuppressionProvider>
        <MeasuredPageFrame>
          <p>body</p>
        </MeasuredPageFrame>
      </ChromeSuppressionProvider>
    );
    const framed = screen.getByTestId("page-container");

    cleanup();
    render(
      <PageContainer width={CONTENT_PAGE_MEASURE}>reference</PageContainer>
    );
    const reference = screen.getByTestId("page-container");

    // A page's loading skeleton reaches the container directly while its loaded
    // state reaches it through the frame. The two must resolve to one measure,
    // or every field moves sideways when the data arrives.
    expect(framed.style.getPropertyValue("--nx-shell-measure")).toBe(
      reference.style.getPropertyValue("--nx-shell-measure")
    );
    expect(reference.style.getPropertyValue("--nx-shell-measure")).not.toBe("");
  });
});
