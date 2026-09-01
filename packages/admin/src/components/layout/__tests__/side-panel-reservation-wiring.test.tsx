/**
 * The seam the resolver test cannot reach: whether a claim made by a panel
 * rendered deep in the page arrives at the layout, and whether closing that
 * panel releases it.
 *
 * Worth a file of its own because a correct resolver says nothing about the
 * wiring. A provider that never registered, registered once and cached, or
 * removed by value rather than by identity leaves every resolver test green
 * while the page is indented for a panel that closed — or not indented for one
 * that is open, which is the defect this exists to prevent.
 *
 * @module components/layout/__tests__/side-panel-reservation-wiring.test
 */
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  SidePanelReservationProvider,
  useReservedInlineEnd,
  useReserveSidePanel,
} from "../SidePanelReservation";

/**
 * Stands in for the layout's content column: it reports the indent it would
 * apply. Read out as text so the assertion is on a value a RENDER received,
 * which is what the layout consumes.
 */
function ColumnProbe() {
  return <div data-testid="reserved">{String(useReservedInlineEnd())}</div>;
}

function Panel({ width }: { width: number | null }) {
  useReserveSidePanel(width);
  return <div>panel</div>;
}

const reserved = () => screen.getByTestId("reserved").textContent;

describe("a panel's claim on the layout", () => {
  it("reserves nothing while no panel is open", () => {
    render(
      <SidePanelReservationProvider>
        <ColumnProbe />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("0");
  });

  it("arrives at the layout from a child", () => {
    render(
      <SidePanelReservationProvider>
        <ColumnProbe />
        <Panel width={480} />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("480");
  });

  it("is released when the panel unmounts", () => {
    // The half that fails silently: a claim that outlives its panel leaves a
    // permanent empty strip down the page with nothing on screen to explain it.
    const { rerender } = render(
      <SidePanelReservationProvider>
        <ColumnProbe />
        <Panel width={480} />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("480");

    rerender(
      <SidePanelReservationProvider>
        <ColumnProbe />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("0");
  });

  it("is released when the panel closes without unmounting", () => {
    /*
     * How the history panel behaves: it stays mounted with the document header
     * and passes null while closed. A hook that only released on unmount would
     * pass the case above and indent the page forever after the first open.
     */
    const { rerender } = render(
      <SidePanelReservationProvider>
        <ColumnProbe />
        <Panel width={480} />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("480");

    rerender(
      <SidePanelReservationProvider>
        <ColumnProbe />
        <Panel width={null} />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("0");
  });

  it("keeps the surviving claim when one of two identical panels closes", () => {
    /*
     * Identity removal, not value removal. Two panels of the same width produce
     * equal objects, so a provider filtering by value releases BOTH when one
     * closes — and the page loses its indent while a panel is still on screen,
     * which is exactly the overlap being prevented.
     */
    const { rerender } = render(
      <SidePanelReservationProvider>
        <ColumnProbe />
        <Panel width={480} />
        <Panel width={480} />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("480");

    rerender(
      <SidePanelReservationProvider>
        <ColumnProbe />
        <Panel width={480} />
      </SidePanelReservationProvider>
    );
    expect(reserved()).toBe("480");
  });
});
