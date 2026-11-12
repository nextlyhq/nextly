/**
 * Bottom sheets are built on the Radix Sheet (the dialog primitive), with the
 * grab strip in `sheet.tsx`: no drawer library joins it. Read from the
 * lockfile, so a library arriving through any workspace package, directly or
 * as a dependency of a dependency, is caught.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const LOCKFILE = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../pnpm-lock.yaml"
);

/** Libraries that bring their own drawer or bottom sheet. */
const DRAWER_LIBRARIES = [
  "vaul",
  "react-modal-sheet",
  "react-spring-bottom-sheet",
  "@gorhom/bottom-sheet",
  "react-sheet-slide",
  "@silk-hq/components",
];

/** Every package name the lockfile resolves, from its `packages:` section. */
function lockedPackageNames(lockfile: string): Set<string> {
  // The lockfile holds two YAML documents: the first pins the package manager
  // itself, and the last `packages:` is the workspace's resolved list.
  const section = lockfile
    .split(/^packages:$/m)
    .at(-1)
    ?.split(/^snapshots:$/m)[0];
  const names = new Set<string>();
  for (const match of (section ?? "").matchAll(
    /^ {2}'?((?:@[^/\s']+\/)?[^@\s']+)@/gm
  )) {
    names.add(match[1]);
  }
  return names;
}

describe("the bottom sheets' dependencies", () => {
  it("include no drawer library", () => {
    const names = lockedPackageNames(readFileSync(LOCKFILE, "utf8"));
    // A parse that found nothing would pass for the wrong reason.
    expect(names.has("react-dom")).toBe(true);
    expect(names.has("@radix-ui/react-dialog")).toBe(true);
    expect(DRAWER_LIBRARIES.filter(name => names.has(name))).toEqual([]);
  });

  it("would catch one, scoped or not", () => {
    const names = lockedPackageNames(
      "packages:\n\n  vaul@1.1.2:\n    resolution: {}\n\n  '@gorhom/bottom-sheet@5.0.0':\n    resolution: {}\n\nsnapshots:\n"
    );
    expect(DRAWER_LIBRARIES.filter(name => names.has(name))).toEqual([
      "vaul",
      "@gorhom/bottom-sheet",
    ]);
  });
});
