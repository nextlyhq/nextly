/**
 * Every file and folder under a project, each file by a hash of its content,
 * for the tests that hold a dry run to changing nothing in the project folder.
 * `node_modules` is left out: a test project only links it, and a run may
 * write its own cache there.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** `dir`'s contents as path (relative, "/"-separated) → content hash, or "dir". */
export function folderSnapshot(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(at, entry.name);
      const key = relative(dir, path).split("\\").join("/");
      if (entry.isDirectory()) {
        snapshot[key] = "dir";
        walk(path);
      } else {
        snapshot[key] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
      }
    }
  };
  walk(dir);
  return snapshot;
}
