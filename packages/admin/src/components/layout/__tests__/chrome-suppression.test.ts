import { describe, expect, it } from "vitest";

import {
  resolveSuppressedChrome,
  type ChromeSuppressionRequest,
} from "../lib/chrome-suppression";

const immersive: ChromeSuppressionRequest = {
  layers: [
    "primaryRail",
    "subSidebar",
    "documentSidebar",
    "header",
    "pageFrame",
  ],
  canExit: true,
};

describe("resolveSuppressedChrome", () => {
  it("hides nothing while no surface is asking", () => {
    expect(resolveSuppressedChrome([]).size).toBe(0);
  });

  it("grants every layer to a requester that can be left", () => {
    const hidden = resolveSuppressedChrome([immersive]);
    // Asserted by membership rather than by size: a resolver that returned a
    // different set of four would satisfy a count.
    expect([...hidden].sort()).toEqual([
      "documentSidebar",
      "header",
      "pageFrame",
      "primaryRail",
      "subSidebar",
    ]);
  });

  it("grants the page frame to a surface with no way back", () => {
    // The floor covers the navigation rail ONLY. An embedded mount still gets
    // its padding dropped — it is inside a form that provides the way out, so
    // withholding the frame would leave it boxed for no safety benefit.
    const hidden = resolveSuppressedChrome([
      { layers: ["pageFrame", "primaryRail"], canExit: false },
    ]);
    expect(hidden.has("pageFrame")).toBe(true);
    expect(hidden.has("primaryRail")).toBe(false);
  });

  it("withholds the primary rail from a requester with no way back", () => {
    const hidden = resolveSuppressedChrome([
      { layers: ["primaryRail", "subSidebar", "header"], canExit: false },
    ]);
    expect(hidden.has("primaryRail")).toBe(false);
    // The rest of the request is still honoured — the floor is one layer, not a
    // refusal of the whole request.
    expect(hidden.has("subSidebar")).toBe(true);
    expect(hidden.has("header")).toBe(true);
  });

  it("does not let an exitless request borrow another request's rail grant", () => {
    // Both mounted at once. The union must not promote the exitless one: a
    // per-LAYER floor would grant the rail here, because some request had an
    // exit, which is the bug this asserts against.
    const hidden = resolveSuppressedChrome([
      { layers: ["subSidebar"], canExit: true },
      { layers: ["primaryRail"], canExit: false },
    ]);
    expect(hidden.has("primaryRail")).toBe(false);
    expect(hidden.has("subSidebar")).toBe(true);
  });

  it("union-merges so one surface cannot un-hide another's chrome", () => {
    const hidden = resolveSuppressedChrome([
      { layers: ["header"], canExit: true },
      { layers: ["subSidebar"], canExit: true },
    ]);
    expect(hidden.has("header")).toBe(true);
    expect(hidden.has("subSidebar")).toBe(true);
  });

  it("hides nothing again once the asking surface has released", () => {
    // Release is modelled as the request leaving the collection, which is what
    // unmounting does. Asserted because a resolver that memoised into a
    // module-level set would pass every test above and never restore chrome.
    const mounted = new Set<ChromeSuppressionRequest>([immersive]);
    // Asserted by membership rather than by a count, which goes stale the moment
    // a layer is added and then reads as a real failure.
    expect([...resolveSuppressedChrome(mounted)].sort()).toEqual(
      [...immersive.layers].sort()
    );
    mounted.delete(immersive);
    expect([...resolveSuppressedChrome(mounted)]).toEqual([]);
  });
});
