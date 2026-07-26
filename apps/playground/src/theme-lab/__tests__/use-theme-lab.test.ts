// @vitest-environment jsdom
//
// The rest of this package's tests run under vitest's default "node"
// environment (see vitest.config.ts) because a fixture elsewhere asserts a
// module throws when it detects a browser-like `window` global. This suite
// needs the opposite: readSelection/writeSelection use `localStorage`, which
// plain node doesn't provide, so it opts into jsdom for just this file.
import { describe, expect, it, beforeEach } from "vitest";

import {
  readSelection,
  writeSelection,
  DEFAULT_SELECTION,
} from "../use-theme-lab";

describe("theme lab selection", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the mono control", () => {
    expect(readSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("round-trips a selection", () => {
    writeSelection({
      theme: "sand",
      layout: "right-panel",
      density: "compact",
    });
    expect(readSelection()).toEqual({
      theme: "sand",
      layout: "right-panel",
      density: "compact",
    });
  });

  it("falls back to mono for an unknown theme id", () => {
    writeSelection({
      theme: "deleted",
      layout: "rail-panel",
      density: "default",
    });
    expect(readSelection().theme).toBe("mono");
  });

  it("falls back on corrupt stored json", () => {
    localStorage.setItem("nextly-theme-lab", "{not json");
    expect(readSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("recognises a tweakcn preset id as known", () => {
    writeSelection({
      theme: "tweakcn-vercel",
      layout: "rail-panel",
      density: "default",
    });
    expect(readSelection().theme).toBe("tweakcn-vercel");
  });
});
