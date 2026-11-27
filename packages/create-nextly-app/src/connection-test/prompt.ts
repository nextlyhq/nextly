/**
 * The connection test in a terminal: run when the person continues from the
 * connection-string question, and on a failure, offer to try again, change
 * the string, go back to the database question, or (for a missing database
 * on this machine) create it. The question itself belongs to the flow that
 * asks it; this is the piece it calls.
 */
import * as p from "@clack/prompts";

import { createDatabase } from "./create-database";
import { connectedLine, testConnection } from "./test-connection";
import type { Connect, Connected, ServerDialect } from "./types";

/** The words under the connection-string question. */
export const TESTED_BEFORE_CREATING =
  "Continue tests the connection before anything is created.";

export type AfterFailure = "create" | "retry" | "change" | "back";

/** What the piece needs from the terminal. Clack's by default; tests give their own. */
export interface ConnectionPromptIO {
  choose(
    message: string,
    options: { value: AfterFailure; label: string }[]
  ): Promise<AfterFailure | undefined>;
  /** A new connection string, masked as it is typed; undefined when cancelled. */
  askString(message: string): Promise<string | undefined>;
  connected(line: string): void;
  warn(line: string): void;
  failed(line: string): void;
}

const LABELS: Record<ServerDialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
};

export const clackIO: ConnectionPromptIO = {
  async choose(message, options) {
    const answer = await p.select({ message, options });
    return p.isCancel(answer) ? undefined : answer;
  },
  async askString(message) {
    const answer = await p.password({ message, mask: "*" });
    return p.isCancel(answer) ? undefined : answer;
  },
  connected: line => p.log.success(line),
  warn: line => p.log.warn(line),
  failed: line => p.log.error(line),
};

export type ConnectionOutcome =
  | { outcome: "connected"; url: string; result: Connected }
  | { outcome: "back" }
  | { outcome: "cancel" };

/**
 * Tests `url` until it connects, the person goes back to the database
 * question, or cancels. The string is never shown: a changed one is asked
 * for masked, and every message names only the server and the database.
 */
export async function connectInteractively(
  dialect: ServerDialect,
  url: string,
  { io = clackIO, connect }: { io?: ConnectionPromptIO; connect?: Connect } = {}
): Promise<ConnectionOutcome> {
  let current = url;
  for (;;) {
    const result = await testConnection(dialect, current, connect);
    if (result.ok) {
      io.connected(connectedLine(result));
      if (result.variantWarning) io.warn(result.variantWarning);
      return { outcome: "connected", url: current, result };
    }
    io.failed(result.message);

    const options: { value: AfterFailure; label: string }[] = [];
    if (result.canCreate && result.database) {
      options.push({
        value: "create",
        label: `Create "${result.database}" on this machine`,
      });
    }
    options.push(
      { value: "retry", label: "Try again" },
      { value: "change", label: "Change the connection string" },
      { value: "back", label: "Back to the database question" }
    );
    const choice = await io.choose("What now?", options);
    if (choice === undefined) return { outcome: "cancel" };
    if (choice === "back") return { outcome: "back" };
    if (choice === "create") {
      const problem = await createDatabase(dialect, current, connect);
      if (problem) io.failed(problem);
      continue;
    }
    if (choice === "change") {
      const next = await io.askString(
        `${LABELS[dialect]} connection string (hidden)`
      );
      if (next === undefined) return { outcome: "cancel" };
      if (next.trim()) current = next.trim();
    }
  }
}
