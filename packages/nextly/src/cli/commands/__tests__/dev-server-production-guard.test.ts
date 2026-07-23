/**
 * Production guard in performAutoSync: when NODE_ENV=production and pending
 * schema changes exist, the guard refuses to auto-apply and prints guidance
 * pointing users at the migration workflow. Every `nextly <command>` the
 * guidance references must be a real registered CLI command — otherwise the
 * user is told to run a command that exits with "unknown command".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { CollectionSyncResultWithValidation } from "../../../services/collections/collection-sync-service";
import { createProgram } from "../../program";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import type { Logger } from "../../utils/logger";
import type { ResolvedDevOptions } from "../db-sync";
import { performAutoSync } from "../dev-server";

/**
 * Capture-only Logger: records every info/error/warn line so assertions can
 * inspect the guidance text. All rendering-only members are no-ops.
 */
function createCaptureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (message: string): void => {
    lines.push(message);
  };
  const logger: Logger = {
    debug: record,
    info: record,
    warn: record,
    error: record,
    success: record,
    newline: () => undefined,
    divider: () => undefined,
    header: record,
    item: record,
    keyValue: () => undefined,
    table: () => undefined,
    spinner: (message: string) => {
      record(message);
      return { stop: () => undefined };
    },
    setOptions: () => undefined,
    getOptions: () => ({}),
  };
  return { logger, lines };
}

/**
 * The production guard runs before any config/adapter access, so these
 * parameters are never dereferenced on the asserted path. The double cast is
 * confined to fixtures for that reason: building a real adapter or a full
 * sanitized config would require a live database connection.
 */
const unusedConfig = {} as unknown as LoadConfigResult["config"];
const unusedAdapter = {} as unknown as CLIDatabaseAdapter;

function buildSyncResult(): CollectionSyncResultWithValidation {
  return {
    sync: { created: ["posts"], updated: [], unchanged: [], errors: [] },
    generatedSchemas: [],
    generatedZodSchemas: [],
    removedCollections: [],
    warnings: [],
    durationMs: 0,
    relationshipValidation: { valid: true, errors: [], warnings: [] },
  };
}

describe("performAutoSync production guard", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("suggests only CLI commands that are actually registered", async () => {
    const { logger, lines } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const options: ResolvedDevOptions = {};

    // The guard terminates the process; throwing from the spy keeps the test
    // process alive while still stopping performAutoSync at the exit call.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit(${String(code)})`);
      });

    await expect(
      performAutoSync(
        unusedConfig,
        unusedAdapter,
        buildSyncResult(),
        options,
        context
      )
    ).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);

    // Registered command names (plus aliases) form the set of valid
    // suggestions; `nextly <anything else>` fails with "unknown command".
    const program = createProgram();
    const registered = new Set<string>();
    for (const command of program.commands) {
      registered.add(command.name());
      for (const alias of command.aliases()) {
        registered.add(alias);
      }
    }

    // Every backtick-quoted `nextly <command>` in the guidance must exist.
    const output = lines.join("\n");
    const suggested = [...output.matchAll(/`nextly ([a-z0-9:_-]+)/g)].map(
      match => match[1]
    );
    expect(suggested.length).toBeGreaterThan(0);
    for (const name of suggested) {
      expect(
        registered,
        `\`nextly ${name}\` is not a registered command`
      ).toContain(name);
    }
  });
});
