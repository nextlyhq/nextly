// @vitest-environment jsdom

/**
 * The band drawn where an area has no region: the host's sentence, its two
 * ways to fill the area or who to ask, the menu opened from the button's own
 * place, a press that stays the band's, and the canvas drawing it in the
 * region's place but never while a region is edited.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegionsAround } from "./canvas-layout-parts";
import {
  EMPTY_REGION_ATTRIBUTE,
  EmptyRegionBand,
  type EmptyRegionBandProps,
} from "./canvas-regions";

afterEach(cleanup);

const SENTENCE =
  "No header yet. Pages on this site show no header until you add one.";

function band(
  over: Partial<{ onCreate: () => void; onUse: () => void }> = {}
): EmptyRegionBandProps {
  return {
    sentence: SENTENCE,
    actions: {
      create: "Create a header",
      onCreate: over.onCreate ?? vi.fn(),
      use: "Use a component",
      onUse: over.onUse ?? vi.fn(),
    },
  };
}

describe("the band where an area has no region", () => {
  it("says why, and offers both ways to fill it", () => {
    const onCreate = vi.fn();
    const onUse = vi.fn();
    render(<EmptyRegionBand area="header" band={band({ onCreate, onUse })} />);
    const group = screen.getByRole("group", { name: "Site header" });
    expect(group.getAttribute(EMPTY_REGION_ATTRIBUTE)).toBe("header");
    expect(group.textContent).toContain(SENTENCE);
    fireEvent.click(screen.getByRole("button", { name: "Create a header" }));
    expect(onCreate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /^Use a component/ }));
    // From the button's own place, where the host opens the menu.
    expect(onUse).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
    );
  });

  it("tells someone who may not fill it who can, with no buttons", () => {
    render(
      <EmptyRegionBand
        area="footer"
        band={{
          sentence: "No footer yet.",
          actions: { ask: "Ask someone who can change the site's footer." },
        }}
      />
    );
    const group = screen.getByRole("group", { name: "Site footer" });
    expect(group.textContent).toContain(
      "Ask someone who can change the site's footer."
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("waits on both buttons while a choice is being written", () => {
    const given = band();
    render(
      <EmptyRegionBand
        area="header"
        band={
          {
            ...given,
            actions: { ...given.actions, busy: true },
          } as EmptyRegionBandProps
        }
      />
    );
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("keeps a press its own, so the canvas selects nothing", () => {
    const canvasClick = vi.fn();
    render(
      <div onClick={canvasClick} onPointerDown={canvasClick}>
        <EmptyRegionBand area="header" band={band()} />
      </div>
    );
    const group = screen.getByRole("group", { name: "Site header" });
    fireEvent.pointerDown(group);
    fireEvent.click(group);
    expect(canvasClick).not.toHaveBeenCalled();
  });
});

describe("the canvas around the page", () => {
  const page = <p>The page</p>;

  it("draws a band in an empty area's place, around the page", () => {
    render(
      <RegionsAround
        drawn={undefined}
        rendered={undefined}
        environment={undefined}
        selection={{}}
        editing={undefined}
        bands={{ header: band() }}
      >
        {page}
      </RegionsAround>
    );
    const group = screen.getByRole("group", { name: "Site header" });
    // Before the page, where the header would be.
    expect(
      group.compareDocumentPosition(screen.getByText("The page")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Site footer" })).toBeNull();
  });

  it("draws no band while a region is edited in place", () => {
    render(
      <RegionsAround
        drawn={undefined}
        rendered={undefined}
        environment={undefined}
        selection={{}}
        editing={{
          area: "footer",
          document: { formatVersion: 1, kind: "component", nodes: [] },
          definitions: new Map(),
        }}
        bands={{ header: band() }}
      >
        {page}
      </RegionsAround>
    );
    expect(screen.queryByRole("group", { name: "Site header" })).toBeNull();
  });

  it("draws the page alone with no band given", () => {
    render(
      <RegionsAround
        drawn={undefined}
        rendered={undefined}
        environment={undefined}
        selection={{}}
        editing={undefined}
      >
        {page}
      </RegionsAround>
    );
    expect(screen.queryAllByRole("group")).toEqual([]);
  });
});
