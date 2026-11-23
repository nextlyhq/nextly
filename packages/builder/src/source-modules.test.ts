/**
 * A module's path beneath `src` reads the same on every platform, so the
 * guards' lists (`canvas/canvas.tsx`) match on Windows as they do elsewhere.
 */
import { posix, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { modulePath } from "./source-modules";

describe("a module's path beneath src", () => {
  it("is written with / from a Windows path", () => {
    expect(
      modulePath(
        "D:\\a\\nextly\\packages\\builder\\src",
        "D:\\a\\nextly\\packages\\builder\\src\\canvas\\geometry-dom.ts",
        win32.relative,
        win32.sep
      )
    ).toBe("canvas/geometry-dom.ts");
  });

  it("is unchanged from a POSIX path", () => {
    expect(
      modulePath(
        "/work/nextly/packages/builder/src",
        "/work/nextly/packages/builder/src/canvas/geometry-dom.ts",
        posix.relative,
        posix.sep
      )
    ).toBe("canvas/geometry-dom.ts");
  });

  it("keeps a file directly beneath src as its bare name", () => {
    expect(
      modulePath(
        "C:\\src",
        "C:\\src\\chrome-tooltip.tsx",
        win32.relative,
        win32.sep
      )
    ).toBe("chrome-tooltip.tsx");
  });
});
