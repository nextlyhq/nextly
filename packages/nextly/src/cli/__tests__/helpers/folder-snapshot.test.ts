/**
 * The snapshot a "changes nothing" test compares before and after a dry run:
 * it must notice a file written, edited or removed anywhere in the project,
 * and nothing under `node_modules`, which the project only links to.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { folderSnapshot } from "./folder-snapshot";

describe("folderSnapshot", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true });
  });

  function project(): string {
    const dir = mkdtempSync(join(tmpdir(), "folder-snapshot-"));
    made.push(dir);
    mkdirSync(join(dir, "src/collections"), { recursive: true });
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    writeFileSync(join(dir, "src/collections/posts.ts"), "export {};\n");
    return dir;
  }

  it("is equal for a folder nothing touched", () => {
    const dir = project();
    expect(folderSnapshot(dir)).toEqual(folderSnapshot(dir));
  });

  it("differs when a file is written, edited or removed", () => {
    const dir = project();
    const before = folderSnapshot(dir);

    writeFileSync(join(dir, "src/types.ts"), "export {};\n");
    expect(folderSnapshot(dir)).not.toEqual(before);
    rmSync(join(dir, "src/types.ts"));
    expect(folderSnapshot(dir)).toEqual(before);

    writeFileSync(join(dir, "nextly.config.ts"), "export default { a: 1 };\n");
    expect(folderSnapshot(dir)).not.toEqual(before);
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");

    rmSync(join(dir, "src/collections/posts.ts"));
    expect(folderSnapshot(dir)).not.toEqual(before);
  });

  it("notices an empty folder created", () => {
    const dir = project();
    const before = folderSnapshot(dir);
    mkdirSync(join(dir, "src/lib"));
    expect(folderSnapshot(dir)).not.toEqual(before);
  });

  it("leaves node_modules out", () => {
    const dir = project();
    const before = folderSnapshot(dir);
    mkdirSync(join(dir, "node_modules/.cache"), { recursive: true });
    writeFileSync(join(dir, "node_modules/.cache/x.mjs"), "x");
    expect(folderSnapshot(dir)).toEqual(before);
  });
});
