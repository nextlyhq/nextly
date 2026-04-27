// What: chokidar-backed file watcher with debounce and content-hash dedupe.
// Why: editors fire 2-4 fs events per save (atomic write via tempfile, rename,
// fsync). A bare chokidar listener runs our schema-change pipeline once per
// event, causing duplicate work and spurious prompts. Debounce collapses the
// burst to one event. Content hash then dedupes edits that re-write the exact
// same bytes (format-on-save, touch, timestamp-only changes) so we do not
// prompt the user on non-changes.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import chokidar, { type FSWatcher } from "chokidar";

export interface FileWatcherOptions {
  path: string;
  debounceMs?: number;
  onChange: (contentHash: string) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastHash: string | null = null;

  constructor(private opts: FileWatcherOptions) {}

  async start(): Promise<void> {
    // Hash the file up-front. Any save that writes these exact bytes again
    // (common with editors that reformat on save then rewrite unchanged) will
    // be skipped downstream by the hash comparison in fire().
    this.lastHash = await this.computeHash();

    this.watcher = chokidar.watch(this.opts.path, {
      // Ignore the synthetic "initial add" event; we already hashed the file.
      ignoreInitial: true,
      // Await write finish so we don't fire on a partial rename step.
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher.on("change", () => this.schedule());
    this.watcher.on("add", () => this.schedule());
    this.watcher.on("error", err => {
      if (this.opts.onError) this.opts.onError(err);
    });
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const delay = this.opts.debounceMs ?? 500;
    this.debounceTimer = setTimeout(() => {
      void this.fire();
    }, delay);
  }

  private async fire(): Promise<void> {
    this.debounceTimer = null;
    try {
      const hash = await this.computeHash();
      if (hash === this.lastHash) {
        // Content unchanged despite fs event (format-on-save, touch, etc.).
        return;
      }
      this.lastHash = hash;
      await this.opts.onChange(hash);
    } catch (err) {
      if (this.opts.onError) this.opts.onError(err);
    }
  }

  private async computeHash(): Promise<string> {
    const content = await readFile(this.opts.path, "utf8");
    return createHash("sha256").update(content).digest("hex");
  }
}
