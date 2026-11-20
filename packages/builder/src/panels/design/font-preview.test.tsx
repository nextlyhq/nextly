// @vitest-environment jsdom

/**
 * Catalogue previews: loaded into the editor's own document only, from the
 * address the host built, under a name no site family can have, and only once
 * a row is on screen.
 */
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { previewFamily, usePreview } from "./font-preview";

let observed: Element[] = [];
let callback: IntersectionObserverCallback | undefined;

class FakeObserver {
  constructor(cb: IntersectionObserverCallback) {
    callback = cb;
  }
  observe(element: Element): void {
    observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const loads: Array<{ family: string; source: string }> = [];
let fail = false;

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: string
  ) {}
  load(): Promise<FakeFontFace> {
    loads.push({ family: this.family, source: this.source });
    return fail ? Promise.reject(new Error("blocked")) : Promise.resolve(this);
  }
}

const added: unknown[] = [];

beforeEach(() => {
  observed = [];
  callback = undefined;
  loads.length = 0;
  added.length = 0;
  fail = false;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    value: { add: (face: unknown) => added.push(face) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Row({ id, url }: { id: string; url: string }): React.JSX.Element {
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const loaded = usePreview(element, id, url);
  return (
    <span ref={setElement} data-loaded={loaded ? "yes" : "no"}>
      {id}
    </span>
  );
}

async function scrollIntoView(element: Element): Promise<void> {
  await act(async () => {
    callback?.(
      [
        {
          isIntersecting: true,
          target: element,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );
    await Promise.resolve();
  });
}

describe("catalogue previews", () => {
  it("names a preview so it can never stand in for a site family", () => {
    expect(previewFamily("inter")).toBe("nx-preview-inter");
  });

  it("loads nothing until the row is on screen", () => {
    render(<Row id="lora" url="https://cdn.example/lora.woff2" />);
    expect(observed).toHaveLength(1);
    expect(loads).toEqual([]);
  });

  it("loads the host's address into the editor's own document once on screen", async () => {
    const { container } = render(
      <Row id="lora" url="https://cdn.example/lora.woff2" />
    );
    const row = container.querySelector("span");
    if (row === null) throw new Error("no row");
    await scrollIntoView(row);
    expect(loads).toEqual([
      {
        family: "nx-preview-lora",
        source: 'url("https://cdn.example/lora.woff2")',
      },
    ]);
    expect(added).toHaveLength(1);
    expect(row.dataset.loaded).toBe("yes");
  });

  it("leaves a row in the admin font, silently, when its preview fails", async () => {
    fail = true;
    const { container } = render(
      <Row id="oswald" url="https://cdn.example/o.woff2" />
    );
    const row = container.querySelector("span");
    if (row === null) throw new Error("no row");
    await scrollIntoView(row);
    expect(row.dataset.loaded).toBe("no");
  });
});
