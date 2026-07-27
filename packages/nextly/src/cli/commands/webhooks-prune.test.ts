/**
 * Unit coverage for the `nextly webhooks:prune` glue. The pruning engine itself
 * is covered by `domains/webhooks/prune.test.ts` and the retention integration
 * suite; here we pin the one branch unique to the command — a disabled retention
 * policy must short-circuit before opening a database connection.
 *
 * @module cli/commands/webhooks-prune.test
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandContext } from "../program";

import { runWebhooksPruneCommand } from "./webhooks-prune";

vi.mock("../utils/adapter", () => ({
  validateDatabaseEnv: vi.fn(() => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "memory",
  })),
  createAdapter: vi.fn(),
}));

vi.mock("../utils/config-loader", () => ({
  loadConfig: vi.fn(async () => ({ config: { webhookRetention: null } })),
}));

import { createAdapter } from "../utils/adapter";

function fakeContext(): CommandContext {
  const logger = {
    header: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
  return { logger } as unknown as CommandContext;
}

describe("runWebhooksPruneCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits without connecting when retention is disabled", async () => {
    const context = fakeContext();

    await runWebhooksPruneCommand({}, context);

    expect(createAdapter).not.toHaveBeenCalled();
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("disabled")
    );
  });
});
