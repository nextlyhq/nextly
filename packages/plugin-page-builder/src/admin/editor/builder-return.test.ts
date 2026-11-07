// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  centreWhileSettling,
  claimBuilderReturn,
  rememberBuilderReturn,
} from "./builder-return";

const page = { kind: "collection", slug: "pages", documentId: "p1" } as const;

describe("returning from the Page Builder to the field it was open on", () => {
  it("is found by the row's id, not by where the row now stands", () => {
    // Opened on the row whose id is `row-b`, then the rows were reordered:
    // `row-b` is now first and `row-a` stands where `row-b` stood. Each field
    // asks by its own address, which names its row's id, so the return goes
    // to `row-b`'s field and not to the one now at its old position.
    rememberBuilderReturn(page, "sections.row-b.body");

    expect(claimBuilderReturn(page, "sections.row-a.body")).toBe(false);
    expect(claimBuilderReturn(page, "sections.row-b.body")).toBe(true);
  });

  it("is taken once, so a second render does not move the focus again", () => {
    rememberBuilderReturn(page, "hero.body");

    expect(claimBuilderReturn(page, "hero.body")).toBe(true);
    expect(claimBuilderReturn(page, "hero.body")).toBe(false);
  });

  it("belongs to the document it was left from", () => {
    // The same field path on another page is not the field the author left.
    rememberBuilderReturn(page, "layout");

    expect(
      claimBuilderReturn(
        { kind: "collection", slug: "pages", documentId: "p2" },
        "layout"
      )
    ).toBe(false);
    expect(
      claimBuilderReturn({ kind: "single", slug: "pages" }, "layout")
    ).toBe(false);
    expect(claimBuilderReturn(page, "layout")).toBe(true);
  });

  it("remembers nothing outside a document", () => {
    rememberBuilderReturn(null, "layout");

    expect(claimBuilderReturn(page, "layout")).toBe(false);
  });
});

describe("keeping the returned-to field centred while the form settles", () => {
  /** Frames run by hand, and a clock moved by hand. */
  function frames() {
    let queued: FrameRequestCallback | null = null;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      queued = run;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      queued = null;
    });
    return {
      tick(ms: number) {
        now += ms;
        const run = queued;
        queued = null;
        run?.(now);
      },
      pending: () => queued !== null,
    };
  }

  /** A field whose place on screen the test sets, recording each centring. */
  function field() {
    const element = document.createElement("div");
    const at = { top: 400 };
    const centred: number[] = [];
    element.getBoundingClientRect = () => ({ top: at.top }) as DOMRect;
    element.scrollIntoView = () => {
      centred.push(at.top);
      at.top = 400;
    };
    return { element, at, centred };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("centres it again when content above moves it, and not otherwise", () => {
    const clock = frames();
    const { element, at, centred } = field();
    centreWhileSettling(element, 1500);
    expect(centred).toHaveLength(1);

    clock.tick(16);
    expect(centred).toHaveLength(1);
    // A preview above finishes drawing and shrinks: the field moves up.
    at.top = 140;
    clock.tick(16);
    expect(centred).toEqual([400, 140]);
  });

  it("stops at the author's own scroll, and after the settling time", () => {
    const clock = frames();
    const { element, at, centred } = field();
    centreWhileSettling(element, 1500);
    window.dispatchEvent(new Event("wheel"));
    at.top = 140;
    clock.tick(16);
    expect(centred).toHaveLength(1);
    expect(clock.pending()).toBe(false);

    const second = field();
    centreWhileSettling(second.element, 1500);
    clock.tick(2000);
    second.at.top = 140;
    clock.tick(16);
    expect(second.centred).toHaveLength(1);
  });
});
