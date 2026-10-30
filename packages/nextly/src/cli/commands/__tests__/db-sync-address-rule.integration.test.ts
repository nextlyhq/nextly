/**
 * `nextly db:sync` and its `--watch` mode create the configuration's entities, so each judges a new
 * address by the one rule before it reads or writes any schema, as a start does. A refused address
 * leaves no table and no registry row behind, and the refusal names the address and the reason.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: vi.fn(async () => loaded.result),
}));

import { text } from "../../../config";
import { describeError } from "../../../errors";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import { judgeAddress } from "../../../shared/address-rule";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { LoadConfigResult } from "../../utils/config-loader";
import { runDbSync } from "../db-sync";
import { createDebouncedSync } from "../dev-watcher";

import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "./helpers/sqlite-sync-target";

let dir: string;
let target: SqliteSyncTarget | undefined;
let previousDialect: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-address-"));
  previousDialect = process.env.DB_DIALECT;
  process.env.DB_DIALECT = "sqlite";
  clearCachedSnapshot();
});

afterEach(async () => {
  await target?.adapter.disconnect();
  target = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/** A configuration declaring one collection under `slug`, as the loader hands it over. */
function configWith(slug: string): LoadConfigResult {
  return {
    config: {
      collections: [{ slug, fields: [text({ name: "title" })] }],
      singles: [],
      fieldGroups: [],
    },
  } as unknown as LoadConfigResult;
}

describe("db:sync --watch judges a new address", () => {
  it.each(["cascade", "admin", "posts-"])(
    "refuses '%s' with the rule's reason, writing nothing",
    async address => {
      target = await openSqliteSyncTarget(dir);
      const error = vi.fn();
      const context = {
        ...target.context,
        logger: { ...target.context.logger, error },
      };
      const sync = createDebouncedSync(target.cli, target.options, context);

      sync(configWith(address));
      await vi.waitFor(() => expect(error).toHaveBeenCalled(), {
        timeout: 10_000,
      });

      const logged = error.mock.calls.map(([line]) => String(line)).join("\n");
      expect(logged).toContain(judgeAddress("collection", address)?.message);
      expect(
        await target.adapter.tableExists(`dc_${address.replace(/-/g, "_")}`)
      ).toBe(false);
      const rows = await target.adapter.select<{ slug: string }>(
        "dynamic_collections",
        { columns: ["slug"] }
      );
      expect(rows.map(row => row.slug)).not.toContain(address);
    }
  );
});

describe("db:sync judges a new address", () => {
  it("refuses 'cascade' with the rule's reason, writing nothing", async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
    // The validated environment is cached from its first read, so the command would otherwise
    // connect to whatever database an earlier test configured.
    _resetEnvCache();
    loaded.result = configWith("cascade");
    const error = vi.fn();
    let thrown: unknown;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      target = await openSqliteSyncTarget(dir);
      await runDbSync(
        { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
        {
          ...target.context,
          logger: { ...target.context.logger, error },
        }
      ).catch((err: unknown) => {
        thrown = err;
      });

      // The command prints a failure through `describeError`, so that is what the user reads.
      expect(describeError(thrown)).toContain(
        judgeAddress("collection", "cascade")?.message
      );
      expect(await target.adapter.tableExists("dc_cascade")).toBe(false);
    } finally {
      exit.mockRestore();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      _resetEnvCache();
    }
  });
});
