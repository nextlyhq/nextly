/**
 * The composition four admin surfaces already build by hand.
 *
 * `APIPlayground`, `PreviewSplit`, `TranslationPanes` and the page builder's
 * shell each assemble the same three ingredients — suppress the admin's
 * furniture, put a bar on top, split the body with a draggable handle — and
 * each assembles them differently. This component is that composition named
 * once, with the regions declared rather than arranged ad hoc.
 *
 * The email template editor is its first consumer. The other four are
 * deliberately NOT converted here: migrating every caller in the change that
 * extracts a primitive is how a reviewable diff stops being reviewable.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressedChrome,
} from "../ChromeSuppression";

import { ImmersiveShell } from "./ImmersiveShell";

afterEach(cleanup);

/** Reports what the provider currently hides, so a test can read it. */
function ChromeProbe() {
  const hidden = useSuppressedChrome();
  return <span data-testid="hidden">{[...hidden].sort().join(",")}</span>;
}

function renderShell(
  props: Partial<Parameters<typeof ImmersiveShell>[0]> = {}
) {
  return render(
    <ChromeSuppressionProvider>
      <ChromeProbe />
      <ImmersiveShell
        bar={<h1>Welcome Email</h1>}
        primary={<div>the body being authored</div>}
        secondary={<div>what it will look like</div>}
        splitLabel="Editor and preview"
        {...props}
      />
    </ChromeSuppressionProvider>
  );
}

describe("ImmersiveShell", () => {
  it("renders the regions it was given", () => {
    renderShell({ band: <div>envelope</div> });

    expect(screen.getByText("Welcome Email")).toBeDefined();
    expect(screen.getByText("envelope")).toBeDefined();
    expect(screen.getByText("the body being authored")).toBeDefined();
    expect(screen.getByText("what it will look like")).toBeDefined();
  });

  it("omits the optional regions rather than rendering empty containers", () => {
    renderShell();

    expect(screen.queryByTestId("shell-band")).toBeNull();
    expect(screen.queryByTestId("shell-drawer")).toBeNull();
    expect(screen.queryByTestId("shell-inspector")).toBeNull();
  });

  it("asks for the chrome layers it was given", () => {
    renderShell({ suppress: ["subSidebar", "pageFrame"] });

    expect(screen.getByTestId("hidden").textContent).toBe(
      "pageFrame,subSidebar"
    );
  });

  it("releases the chrome when it unmounts", () => {
    const view = renderShell({ suppress: ["subSidebar", "pageFrame"] });
    expect(screen.getByTestId("hidden").textContent).toBe(
      "pageFrame,subSidebar"
    );

    // Re-render with the shell gone but the provider and probe still mounted:
    // unmounting the whole tree would remove the probe too, and prove nothing.
    view.rerender(
      <ChromeSuppressionProvider>
        <ChromeProbe />
      </ChromeSuppressionProvider>
    );

    expect(screen.getByTestId("hidden").textContent).toBe("");
  });

  it("hides nothing when asked to suppress nothing", () => {
    renderShell();

    expect(screen.getByTestId("hidden").textContent).toBe("");
  });

  it("names the split for a keyboard user, since a separator without a name announces only a number", () => {
    renderShell();

    expect(
      screen.getByRole("separator", { name: "Editor and preview" })
    ).toBeDefined();
  });

  it("keeps the secondary region mounted while the inspector is open", () => {
    // The inspector OVERLAYS rather than displaces, so the code being edited
    // never reflows when a setting changes. jsdom cannot observe stacking
    // order, so the assertion is on RETENTION — displacing would unmount or
    // replace the region — and the overlay's own positioning is a style
    // contract asserted separately below.
    renderShell({ inspector: <div>settings</div> });

    expect(screen.getByText("settings")).toBeDefined();
    expect(screen.getByText("what it will look like")).toBeDefined();
    expect(screen.getByText("the body being authored")).toBeDefined();
  });

  it("scopes the inspector to the secondary pane, not the whole shell", () => {
    /*
     * Containment is the discriminating assertion. `absolute` alone passes
     * whether the overlay is positioned against the secondary pane or against
     * the shell's outer box — and against the outer box it spans the bar and
     * the drawer too, so a right-hand inspector covers the save and exit
     * controls. Being a DESCENDANT of the secondary region is true of exactly
     * one of those, and the nearest positioned ancestor is what decides it.
     */
    renderShell({ inspector: <div>settings</div> });

    const secondary = screen.getByTestId("shell-secondary");
    const inspector = screen.getByTestId("shell-inspector");

    expect(secondary.contains(inspector)).toBe(true);
    expect(screen.getByTestId("shell-bar").contains(inspector)).toBe(false);
    // The containing block itself: without `relative` here the overlay resolves
    // against some ancestor further out while still being a descendant, so
    // containment alone is necessary and not sufficient.
    expect(secondary.className).toContain("relative");
    expect(inspector.className).toContain("absolute");
  });

  it("refuses the primary rail to a surface with no way back", () => {
    /*
     * The rail is the admin's entire navigation. `bar` is a ReactNode and may
     * carry no exit at all, so the presence of the slot proves nothing; the
     * resolver withholds `primaryRail` from a request whose `canExit` is false,
     * and this asserts the shell answers that question from the affordance.
     */
    renderShell({ suppress: ["primaryRail", "pageFrame"] });

    expect(screen.getByTestId("hidden").textContent).toBe("pageFrame");
  });

  it("grants the primary rail once it renders an exit", () => {
    // The positive control for the test above: without it, a shell that
    // withheld the rail unconditionally would pass just as well.
    renderShell({ suppress: ["primaryRail", "pageFrame"], onExit: () => {} });

    expect(screen.getByTestId("hidden").textContent).toBe(
      "pageFrame,primaryRail"
    );
  });

  it("renders the exit control it derives that grant from", () => {
    const onExit = vi.fn();
    renderShell({ onExit, exitLabel: "Back to templates" });

    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("renders no exit control when it was given no way back", () => {
    renderShell();

    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("stacks the panes when asked to, for a viewport too narrow to split", () => {
    renderShell({ orientation: "vertical" });

    // The separator carries the orientation the library derived, and it is what
    // a screen reader announces. A stacked group separates along the horizontal.
    expect(
      screen
        .getByRole("separator", { name: "Editor and preview" })
        .getAttribute("aria-orientation")
    ).toBe("horizontal");
  });

  it("renders the drawer when given one", () => {
    renderShell({ drawer: <div>sample data</div> });

    expect(screen.getByTestId("shell-drawer")).toBeDefined();
    expect(screen.getByText("sample data")).toBeDefined();
  });

  it("persists on the SETTLED event, never on every frame of the drag", () => {
    /*
     * The two handler names differ by one letter and by a write per frame:
     * `onLayoutChange` fires continuously while the pointer moves,
     * `onLayoutChanged` once the drag settles. jsdom computes no layout, so a
     * synthesised drag would exercise the library rather than this wiring, and
     * a mock that is never called cannot tell the two apart — it stays green
     * under both. Reading the source is the only instrument that can see which
     * name is used, and the property is worth a guard because the kit's own
     * docblock names it as easy to get wrong in both directions.
     */
    // Repo-relative from the package root vitest runs in, matching
    // `layout/__tests__/content-measure-wiring.test.ts`.
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/layout/immersive-shell/ImmersiveShell.tsx"
      ),
      "utf8"
    );

    // Positive control FIRST. `not.toMatch` is satisfied by an empty string, so
    // a path that resolved to nothing would certify the property without having
    // read the file.
    expect(source).toContain("ResizablePanelGroup");
    expect(source).toContain("onLayoutChanged");
    expect(source).not.toMatch(/onLayoutChange[^d]/);
  });
});
