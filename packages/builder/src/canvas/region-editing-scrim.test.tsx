// @vitest-environment jsdom

/**
 * The dim over the rest of the page while a region is edited in place: drawn
 * by the chrome over the canvas, never on the page, hidden from assistive
 * technology, and a press on it changes nothing but asks for Done to pulse.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Canvas } from "./canvas";
import { dimmedAround, RegionEditingScrim } from "./region-editing-scrim";

afterEach(cleanup);

const page: BlockDocument = { formatVersion: 1, kind: "page", nodes: [] };
const sheet = { breakpoints: { viewport: [], container: [] } };

function renderWith(scrim: React.ReactNode, onSelect = vi.fn()) {
  render(
    <Canvas
      document={page}
      siteStyles={sheet as never}
      render={{ styleContext: sheet } as never}
      onSelect={onSelect}
      overlay={scrim}
    />
  );
  return onSelect;
}

function dims(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".nx-region-scrim__dim"));
}

describe("the dim over the page", () => {
  it("draws nothing while no region is edited", () => {
    renderWith(<RegionEditingScrim area={undefined} onPress={vi.fn()} />);
    expect(dims()).toHaveLength(0);
  });

  it("dims the rest of the canvas, hidden from assistive technology", () => {
    renderWith(<RegionEditingScrim area="header" onPress={vi.fn()} />);
    expect(dims().length).toBeGreaterThan(0);
    for (const dim of dims()) {
      expect(dim.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("pulses Done on a press, and selects nothing on the page", () => {
    const onPress = vi.fn();
    const onSelect = renderWith(
      <RegionEditingScrim area="header" onPress={onPress} />
    );
    const [dim] = dims();
    if (dim === undefined) throw new Error("no dim drawn");
    fireEvent.pointerDown(dim);
    fireEvent.click(dim);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("what is dimmed around the region", () => {
  const whole = { x: 0, y: 0, width: 800, height: 2000 };

  it("dims below a header and above a footer, the full width", () => {
    expect(
      dimmedAround(whole, { x: 0, y: 0, width: 800, height: 120 })
    ).toEqual([{ x: 0, y: 120, width: 800, height: 1880 }]);
    expect(
      dimmedAround(whole, { x: 0, y: 1800, width: 800, height: 200 })
    ).toEqual([{ x: 0, y: 0, width: 800, height: 1800 }]);
  });

  it("dims above and below a region in between", () => {
    expect(
      dimmedAround(whole, { x: 0, y: 100, width: 800, height: 50 })
    ).toEqual([
      { x: 0, y: 0, width: 800, height: 100 },
      { x: 0, y: 150, width: 800, height: 1850 },
    ]);
  });

  it("dims everything while the region is not drawn", () => {
    expect(dimmedAround(whole, undefined)).toEqual([whole]);
  });
});
