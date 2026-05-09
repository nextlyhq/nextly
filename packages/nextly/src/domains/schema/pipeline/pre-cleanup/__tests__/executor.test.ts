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
