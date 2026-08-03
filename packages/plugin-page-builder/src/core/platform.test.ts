import { describe, expect, it } from "vitest";

import { composeTemplate } from "./templates";
import { makeNode } from "./tree";
import type { BlockDocument } from "./types";

const doc = (text: string): BlockDocument => ({
  version: 1,
  root: makeNode("core/container", {}, undefined, {
    default: [makeNode("core/heading", { text })],
  }),
});

describe("composeTemplate", () => {
  it("wraps page content with header and footer parts", () => {
    const out = composeTemplate(doc("Body"), {
      header: doc("Header"),
      footer: doc("Footer"),
    });
    const kids = out.root.slots!.default!;
    expect(kids.length).toBe(3);
    // header first, page middle, footer last
    expect(JSON.stringify(kids[0])).toContain("Header");
    expect(JSON.stringify(kids[1])).toContain("Body");
    expect(JSON.stringify(kids[2])).toContain("Footer");
  });

  it("works with no parts (just the page)", () => {
    const out = composeTemplate(doc("Only"));
    expect(out.root.slots!.default!.length).toBe(1);
  });
});
