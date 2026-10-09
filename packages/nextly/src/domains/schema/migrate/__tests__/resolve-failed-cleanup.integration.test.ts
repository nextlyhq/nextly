/**
 * `migrate:resolve --failed-cleanup` against the real ledger, on every
 * configured dialect: clearing a run of failed attempts changes only their
 * status, so each one still says when it ran, when it ended and why it
 * failed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { getSchemaEventsDdl } from "../../events/schema-events-ddl";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { resolveMigration } from "../resolve";

const FILENAME = "20261001_000001_cleanup.sql";

/** Whole seconds, which every dialect's timestamp column stores exactly. */
const at = (second: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, second));

const ATTEMPTS = [
  {
    startedAt: at(0),
    endedAt: at(5),
    errorCode: "NEXTLY_MIGRATION_APPLY_FAILED",
    errorMessage: "first attempt: duplicate key",
    note: "first attempt note",
  },
  {
    startedAt: at(10),
    endedAt: at(17),
    errorCode: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    errorMessage: "second attempt: statement 2 of 3 failed",
    note: null,
  },
] as const;

describe.each(getConfiguredTestDialects())(
  "migrate:resolve --failed-cleanup keeps each attempt's record (%s)",
  dialect => {
    let handle: TestNextly;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (!(await handle.adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await handle.adapter.executeQuery(statement);
        }
      }
    });

    afterEach(async () => {
      await handle?.destroy();
    });

    it("flips every failed attempt to rolled_back with its times and error intact", async () => {
      const repo = new SchemaEventsRepository(
        handle.adapter.getDrizzle(),
        dialect
      );
      const ids: string[] = [];
      for (const attempt of ATTEMPTS) {
        ids.push(
          await repo.insertEvent({
            eventType: "file_apply",
            status: "failed",
            source: "cli-migrate",
            filename: FILENAME,
            ...attempt,
          })
        );
      }

      const result = await resolveMigration({
        mode: "failed-cleanup",
        filename: FILENAME,
        dialect,
        repo,
        fileExists: () => Promise.resolve(true),
        loadTargetSnapshot: () => Promise.resolve(null),
        marksNoTransaction: () => Promise.resolve(false),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
      expect(result).toEqual({
        kind: "failed-cleanup",
        updatedIds: [...ids].reverse(),
      });

      const expectedNotes = [
        "first attempt note; manual-resolve",
        "manual-resolve",
      ];
      for (const [index, attempt] of ATTEMPTS.entries()) {
        const row = await repo.findById(ids[index]);
        expect(row).toMatchObject({
          status: "rolled_back",
          errorCode: attempt.errorCode,
          errorMessage: attempt.errorMessage,
          note: expectedNotes[index],
        });
        expect(new Date(row?.startedAt ?? 0).toISOString()).toBe(
          attempt.startedAt.toISOString()
        );
        expect(new Date(row?.endedAt ?? 0).toISOString()).toBe(
          attempt.endedAt.toISOString()
        );
      }
    });
  }
);
