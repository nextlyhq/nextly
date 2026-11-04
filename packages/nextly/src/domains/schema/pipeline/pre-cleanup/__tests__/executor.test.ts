// Unit tests for RealPreCleanupExecutor.

import { describe, it, expect, vi } from "vitest";

import type { NextlySchemaSnapshot } from "../../diff/types";
import { PromptCancelledError } from "../../prompt-dispatcher/errors";
import type { ClassifierEvent, Resolution } from "../../resolution/types";
import { RealPreCleanupExecutor } from "../executor";

const baseSnapshot: NextlySchemaSnapshot = {
  tables: [
    {
      name: "dc_users",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "email", type: "text", nullable: false },
      ],
    },
  ],
};

const notNullEvent: ClassifierEvent = {
  id: "add_not_null_with_nulls:dc_users.email",
  kind: "add_not_null_with_nulls",
  tableName: "dc_users",
  columnName: "email",
  nullCount: 3,
  tableRowCount: 47,
  applicableResolutions: [
    "provide_default",
    "make_optional",
    "delete_nonconforming",
    "abort",
  ],
};

describe("RealPreCleanupExecutor", () => {
  it("provide_default: runs UPDATE with bound value", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    const exec = new RealPreCleanupExecutor();
    await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [
        {
          kind: "provide_default",
          eventId: notNullEvent.id,
          value: "guest@example.com",
        },
      ],
      events: [notNullEvent],
      fields: [{ name: "email", type: "text" }],
      dialect: "postgresql",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("provide_default: rejects invalid value with INVALID_DEFAULT_FOR_TYPE", async () => {
    const exec = new RealPreCleanupExecutor();
    await expect(
      exec.execute({
        tx: { execute: vi.fn() },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          {
            kind: "provide_default",
            eventId: notNullEvent.id,
            value: 42, // invalid for text field
          },
        ],
        events: [notNullEvent],
        fields: [{ name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/INVALID_DEFAULT_FOR_TYPE/);
  });

  /** A Required column added over rows that have none, named as the table names it. */
  const addedOver = (columnName: string): ClassifierEvent => ({
    ...notNullEvent,
    id: `add_not_null_with_nulls:dc_users.${columnName}`,
    columnName,
  });

  /** Run one provide_default for `columnName` against these fields on this dialect. */
  const provide = (
    columnName: string,
    field: { name: string; type: string },
    value: unknown,
    dialect: "postgresql" | "mysql" | "sqlite"
  ) =>
    new RealPreCleanupExecutor().execute({
      // `execute` where the dialect's driver runs statements so, `run` on SQLite.
      tx: {
        execute: vi.fn().mockResolvedValue({ rowCount: 3 }),
        run: vi.fn().mockResolvedValue({ changes: 3 }),
      },
      desiredSnapshot: baseSnapshot,
      resolutions: [
        {
          kind: "provide_default",
          eventId: addedOver(columnName).id,
          value,
        },
      ],
      events: [addedOver(columnName)],
      fields: [field],
      dialect,
    });

  it("provide_default: judges a camelCase field's value by its type, found by its column", async () => {
    const itemCount = { name: "itemCount", type: "number" };
    await expect(
      provide("item_count", itemCount, 0, "postgresql")
    ).resolves.toBeDefined();
    // Found as a number, not passed as text: a string is refused.
    await expect(
      provide("item_count", itemCount, "abc", "postgresql")
    ).rejects.toThrow(/INVALID_DEFAULT_FOR_TYPE: item_count \(number\)/);
  });

  it("provide_default: takes on SQLite the 0/1 and epoch seconds its boolean and date columns store", async () => {
    const featured = { name: "isFeatured", type: "checkbox" };
    const published = { name: "publishedOn", type: "date" };
    await expect(
      provide("is_featured", featured, 0, "sqlite")
    ).resolves.toBeDefined();
    await expect(
      provide("published_on", published, 1_700_000_000, "sqlite")
    ).resolves.toBeDefined();
    // Elsewhere a boolean column takes a boolean, as a value typed in the schema dialog is.
    await expect(
      provide("is_featured", featured, 0, "postgresql")
    ).rejects.toThrow(/INVALID_DEFAULT_FOR_TYPE/);
    await expect(provide("is_featured", featured, 2, "sqlite")).rejects.toThrow(
      /INVALID_DEFAULT_FOR_TYPE/
    );
  });

  it("delete_nonconforming: runs DELETE", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    const exec = new RealPreCleanupExecutor();
    await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [{ kind: "delete_nonconforming", eventId: notNullEvent.id }],
      events: [notNullEvent],
      fields: [{ name: "email", type: "text" }],
      dialect: "postgresql",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("delete_nonconforming: throws DELETE_THRESHOLD_EXCEEDED above default 10000", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    const bigEvent: ClassifierEvent = {
      ...notNullEvent,
      nullCount: 10000,
    };
    await expect(
      exec.execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [{ kind: "delete_nonconforming", eventId: bigEvent.id }],
        events: [bigEvent],
        fields: [{ name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/DELETE_THRESHOLD_EXCEEDED/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("make_optional: runs no SQL, patches snapshot to nullable=true", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    const out = await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [{ kind: "make_optional", eventId: notNullEvent.id }],
      events: [notNullEvent],
      fields: [{ name: "email", type: "text" }],
      dialect: "postgresql",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(out.tables[0].columns[1].nullable).toBe(true);
  });

  it("abort: throws PromptCancelledError, runs no SQL", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    await expect(
      exec.execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [{ kind: "abort", eventId: notNullEvent.id }],
        events: [notNullEvent],
        fields: [{ name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(PromptCancelledError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns input snapshot unchanged when no resolutions", async () => {
    const exec = new RealPreCleanupExecutor();
    const out = await exec.execute({
      tx: { execute: vi.fn() },
      desiredSnapshot: baseSnapshot,
      resolutions: [],
      events: [],
      fields: [],
      dialect: "postgresql",
    });
    expect(out).toBe(baseSnapshot);
  });

  it("throws DUPLICATE_RESOLUTION_FOR_EVENT when same eventId has multiple resolutions", async () => {
    // Defense in depth: dispatcher contract is one resolution per event;
    // multiples mean ambiguous intent (e.g. UPDATE then DELETE on same col).
    const exec = new RealPreCleanupExecutor();
    await expect(
      exec.execute({
        tx: { execute: vi.fn() },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          {
            kind: "provide_default",
            eventId: notNullEvent.id,
            value: "x@y.com",
          },
          { kind: "delete_nonconforming", eventId: notNullEvent.id },
        ],
        events: [notNullEvent],
        fields: [{ name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/DUPLICATE_RESOLUTION_FOR_EVENT/);
  });

  it("ignores resolutions that don't match any known event id", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [
        {
          kind: "provide_default",
          eventId: "add_not_null_with_nulls:no.such",
          value: "x",
        },
      ],
      events: [],
      fields: [],
      dialect: "postgresql",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
