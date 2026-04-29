// F10 PR 3 — production notifier factory.
//
// Creates the default channel set wired to stdout + the project's
// `.nextly/logs/migrations.log`. Production pipeline-construction
// sites import this rather than wiring channels themselves so the
// channel list stays declared in one place.
//
// Lazy-singleton: the same notifier instance is returned across calls
// in the same process. The per-channel state (NDJSON's `dirEnsured`,
// `disabled`) needs to persist between applies — recreating the
// channel each call would re-trigger mkdir on every apply and lose
// the self-disable safeguard after the first failure.

import { join } from "node:path";

import type { Notifier } from "./types.js";
import { createNotifier } from "./dispatcher.js";
import { TerminalChannel } from "./channels/terminal.js";
import { NDJSONChannel } from "./channels/ndjson.js";

let cached: Notifier | null = null;

export function getProductionNotifier(): Notifier {
  if (cached) return cached;
  cached = createNotifier({
    channels: [
      new TerminalChannel(),
      new NDJSONChannel({
        filePath: join(process.cwd(), ".nextly", "logs", "migrations.log"),
      }),
    ],
    logger: {
      warn: msg => console.warn(msg),
    },
  });
  return cached;
}

// Test seam — only used by tests that need to reset cached state
// between scenarios. Production code should never call this.
export function _resetProductionNotifierForTests(): void {
  cached = null;
}
