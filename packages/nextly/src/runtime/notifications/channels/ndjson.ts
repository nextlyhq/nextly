// F10 PR 3 — NDJSONChannel.
//
// Appends one JSON line per event to the configured file. Creates the
// parent directory on first write. On EACCES / ENOSPC the channel
// self-disables and emits one warn line — no spam — so a misconfigured
// log path doesn't drown the operator's terminal. Operator restarts
// the dev server after fixing the underlying cause.

import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  MigrationNotificationEvent,
  NotificationChannel,
} from "../types";

interface NDJSONChannelOpts {
  filePath: string;
  logger?: { warn?: (msg: string) => void };
}

export class NDJSONChannel implements NotificationChannel {
  readonly name = "ndjson";
  private readonly filePath: string;
  private readonly logger: { warn?: (msg: string) => void };
  private dirEnsured = false;
  private disabled = false;

  constructor(opts: NDJSONChannelOpts) {
    this.filePath = opts.filePath;
    this.logger = opts.logger ?? {};
  }

  async write(event: MigrationNotificationEvent): Promise<void> {
    if (this.disabled) return;
    try {
      if (!this.dirEnsured) {
        await mkdir(dirname(this.filePath), { recursive: true });
        this.dirEnsured = true;
      }
      const line = `${JSON.stringify(event)}\n`;
      await appendFile(this.filePath, line, { encoding: "utf8" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(
        `[notifications] ndjson channel disabled (${msg}). Restart the dev server after fixing the underlying cause.`
      );
      this.disabled = true;
      // Do not rethrow — the dispatcher's per-channel try/catch is a
      // paranoid backup; this channel's own self-disable is the
      // primary safeguard against repeat-warn spam.
    }
  }
}
