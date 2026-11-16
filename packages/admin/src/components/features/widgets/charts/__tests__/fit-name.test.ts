/**
 * A group's name fitted to its column in the font it is drawn in: whole when it fits, cut with
 * "…" when it does not, and whole where nothing can measure. Measured here with a stand-in canvas
 * whose every character is 7 px wide, so the cut is known.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** `fitName` from a fresh module, measuring with a canvas whose characters are each 7 px. */
async function withMeasure() {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {
          font: "",
          measureText: (text: string) => ({ width: [...text].length * 7 }),
        };
      }
    }
  );
  return (await import("../drawn/fit-name")).fitName;
}

describe("a group's name in its column", () => {
  it("is whole when it fits", async () => {
    const fitName = await withMeasure();
    // 9 characters, 63 px, in a 72 px column.
    expect(fitName("scheduled", 72, "12px Inter")).toBe("scheduled");
  });

  it("is cut with … to the column when it is longer", async () => {
    const fitName = await withMeasure();
    // 10 characters with "…" make 70 px, the most that fits in 72.
    expect(fitName("a long group name", 72, "12px Inter")).toBe("a long gr…");
  });

  it("is whole where nothing can measure, as in jsdom", async () => {
    const { fitName } = await import("../drawn/fit-name");
    expect(fitName("a long group name", 10, "12px Inter")).toBe(
      "a long group name"
    );
  });
});
