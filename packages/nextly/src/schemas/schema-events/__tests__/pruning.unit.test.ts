/**
 * @module schemas/schema-events/__tests__/pruning.unit
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect } from "vitest";

import { selectPrunableEventIds, PRUNABLE_EVENT_TYPES } from "../pruning";

const baseRow = {
  id: "x",
  eventType: "dev_push" as const,
  startedAt: new Date("2026-01-01T00:00:00Z"),
  supersededEventIds: null as string[] | null,
  supersededBy: null as string | null,
};

describe("selectPrunableEventIds", () => {
  const now = new Date("2026-02-01T00:00:00Z"); // 31 days later

  it("never prunes file_apply or core_apply rows", () => {
    const rows = [
      { ...baseRow, id: "a", eventType: "file_apply" as const },
      { ...baseRow, id: "b", eventType: "core_apply" as const },
    ];
    expect(selectPrunableEventIds(rows, { retentionDays: 30, now })).toEqual([]);
  });

  it("prunes dev_push/ui_save/db_sync older than retentionDays", () => {
    const rows = [{ ...baseRow, id: "old", eventType: "dev_push" as const }];
    expect(selectPrunableEventIds(rows, { retentionDays: 30, now })).toEqual([
      "old",
    ]);
  });

  it("keeps rows within retention window", () => {
    const recent = {
      ...baseRow,
      id: "new",
      startedAt: new Date("2026-01-25T00:00:00Z"),
    };
    expect(selectPrunableEventIds([recent], { retentionDays: 30, now })).toEqual(
      []
    );
  });

  it("never prunes a row referenced by another row's superseded_event_ids (guard §4.3.2)", () => {
    const consumed = {
      ...baseRow,
      id: "consumed",
      eventType: "dev_push" as const,
    };
    const consumer = {
      ...baseRow,
      id: "file",
      eventType: "file_apply" as const,
      supersededEventIds: ["consumed"],
    };
    expect(
      selectPrunableEventIds([consumed, consumer], { retentionDays: 30, now })
    ).toEqual([]);
  });

  it("retentionDays=0 means never prune", () => {
    const rows = [{ ...baseRow, id: "old", eventType: "dev_push" as const }];
    expect(selectPrunableEventIds(rows, { retentionDays: 0, now })).toEqual([]);
  });

  it("exposes the prunable event-type allowlist", () => {
    expect([...PRUNABLE_EVENT_TYPES].sort()).toEqual([
      "db_sync",
      "dev_push",
      "ui_save",
    ]);
  });
});
