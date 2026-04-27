// Tests for the chokidar-backed FileWatcher used by the wrapper CLI.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileWatcher } from "./file-watcher.js";

// Sleep helper keyed on real time since chokidar uses the real fs event loop.
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("FileWatcher", () => {
  let tmpRoot: string;
  let watcher: FileWatcher | null = null;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "nextly-fw-"));
  });

  afterEach(async () => {
    if (watcher) await watcher.stop();
    watcher = null;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("fires onChange once after the debounce when the file changes", async () => {
    const file = join(tmpRoot, "nextly.config.ts");
    await writeFile(file, "initial");

    const onChange = vi.fn();
    watcher = new FileWatcher({ path: file, debounceMs: 100, onChange });
    await watcher.start();

    // Small delay to ensure chokidar is fully ready before writing.
    await sleep(200);
    await writeFile(file, "changed");
    await sleep(500);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it("skips writes that produce identical content (hash dedupe)", async () => {
    const file = join(tmpRoot, "nextly.config.ts");
    await writeFile(file, "same");

    const onChange = vi.fn();
    watcher = new FileWatcher({ path: file, debounceMs: 100, onChange });
    await watcher.start();
    await sleep(200);

    // Rewrite with identical content - editors doing format-on-save often do this.
    await writeFile(file, "same");
    await sleep(500);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("batches rapid consecutive writes into a single onChange call", async () => {
    const file = join(tmpRoot, "nextly.config.ts");
    await writeFile(file, "a");

    const onChange = vi.fn();
    watcher = new FileWatcher({ path: file, debounceMs: 150, onChange });
    await watcher.start();
    await sleep(200);

    await writeFile(file, "b");
    await sleep(20);
    await writeFile(file, "c");
    await sleep(20);
    await writeFile(file, "d");
    await sleep(500);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
