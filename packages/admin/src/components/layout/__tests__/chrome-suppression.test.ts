import { describe, expect, it } from "vitest";

import {
  resolveSuppressedChrome,
  type ChromeSuppressionRequest,
} from "../lib/chrome-suppression";

const immersive: ChromeSuppressionRequest = {
  layers: ["primaryRail", "subSidebar", "documentSidebar", "header"],
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
      "primaryRail",
      "subSidebar",
    ]);
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
    expect(resolveSuppressedChrome(mounted).size).toBe(4);
    mounted.delete(immersive);
    expect(resolveSuppressedChrome(mounted).size).toBe(0);
  });
});
