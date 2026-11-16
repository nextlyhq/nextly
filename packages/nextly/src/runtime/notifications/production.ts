// F10 PR 3 — production notifier factory.
//
// Creates the default channel set wired to stdout + the project's
// `.nextly/logs/migrations.log`, below the root services were registered
// with (`setMigrationLogRoot`). Production pipeline-construction
// sites import this rather than wiring channels themselves so the
// channel list stays declared in one place.
//
// Lazy-singleton per log file: the same notifier instance is returned
// across calls in the same process for one root. The per-channel state (NDJSON's `dirEnsured`,
// `disabled`) needs to persist between applies — recreating the
// channel each call would re-trigger mkdir on every apply and lose
// the self-disable safeguard after the first failure.

import { join } from "node:path";

import { consoleLogger } from "../../shared/types";

import { NDJSONChannel } from "./channels/ndjson";
import { TerminalChannel } from "./channels/terminal";
import { createNotifier } from "./dispatcher";
import type { Notifier } from "./types";

/**
 * The folder the log is kept below, as `registerServices` resolved it: the
 * app's root, which is the working directory unless a `basePath` is given.
 * Unset before any registration, when the working directory stands in.
 */
let logRoot: string | undefined;

/** One notifier per log file, so a channel's state persists between applies. */
const cached = new Map<string, Notifier>();

/**
 * Keep the migration log below `root` from now on: the `basePath` services
 * were registered with. A test harness instance gives each its own folder,
 * so its log never lands in the package under test.
 */
export function setMigrationLogRoot(root: string | undefined): void {
  logRoot = root;
}

export function getProductionNotifier(): Notifier {
  const filePath = join(
    logRoot ?? process.cwd(),
    ".nextly",
    "logs",
    "migrations.log"
  );
  const known = cached.get(filePath);
  if (known) return known;
  const made = createNotifier({
    channels: [new TerminalChannel(), new NDJSONChannel({ filePath })],
    logger: {
      warn: msg => consoleLogger.warn(msg),
    },
  });
  cached.set(filePath, made);
  return made;
}

// Test seam — only used by tests that need to reset cached state
// between scenarios. Production code should never call this.
export function _resetProductionNotifierForTests(): void {
  cached.clear();
  logRoot = undefined;
}
