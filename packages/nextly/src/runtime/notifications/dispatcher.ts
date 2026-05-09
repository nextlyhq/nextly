// F10 PR 3 — fan-out dispatcher.
//
// Iterates channels SEQUENTIALLY (so terminal output ordering matches
// NDJSON write ordering) and isolates per-channel failures behind
// try/catch. `notify()` itself NEVER throws — observability problems
// must not break the schema apply that triggered them.
//
// The pipeline depends on the `Notifier` interface, not on this
// concrete factory; tests can swap in a fake notifier via DI.

import type {
  MigrationNotificationEvent,
  NotificationChannel,
  Notifier,
} from "./types";

interface LoggerLike {
  warn?: (msg: string) => void;
}

export interface CreateNotifierOptions {
  channels: NotificationChannel[];
  logger?: LoggerLike;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === undefined) return "undefined";
  if (err === null) return "null";
  if (typeof err === "number" || typeof err === "boolean") {
    return String(err);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "[unstringifiable error]";
  }
}

export function createNotifier(opts: CreateNotifierOptions): Notifier {
  const { channels, logger } = opts;
  return {
    async notify(event: MigrationNotificationEvent): Promise<void> {
      for (const channel of channels) {
        try {
          await channel.write(event);
        } catch (err) {
          logger?.warn?.(
            `[notifications] ${channel.name} channel failed: ${describeError(err)}`
          );
        }
      }
    },
  };
}
