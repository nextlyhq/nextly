/**
 * The Drizzle-transaction recorder (`recordEventInTx`) is the seam that lets
 * services running through `BaseService.withTransaction` (the auth/user service,
 * plugin write paths) append an outbox event atomically — without the adapter's
 * positional TransactionContext. These pin the row mapping, the per-dialect
 * table selection, and that the payload rides as an object (the json codec
 * serializes it) carrying no secret.
 */
import { describe, expect, it, vi } from "vitest";

import { webhookTables } from "../../../schemas/webhooks";
import { recordEventInTx, type DrizzleEventTx } from "../record-event";
import type { WebhookEvent } from "../types";

function makeEnvelope(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt_1",
    type: "user.created",
    specversion: "1",
    timestamp: "2026-07-30T00:00:00.000Z",
    resource: { kind: "user", id: "u1" },
    data: { id: "u1", email: "a@example.com", name: "Ada", roles: [] },
    previous: null,
    changedFields: [],
    actor: { type: "system" },
    ...overrides,
  };
}

/** A DrizzleEventTx double that captures the table and row passed to insert. */
function fakeTx(): {
  tx: DrizzleEventTx;
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
} {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { tx: { insert }, insert, values };
}

describe("recordEventInTx", () => {
  it("maps the envelope onto the nextly_events Drizzle row", async () => {
    const { tx, insert, values } = fakeTx();

    await recordEventInTx(tx, "sqlite", { envelope: makeEnvelope() });

    expect(insert).toHaveBeenCalledWith(webhookTables("sqlite").nextlyEvents);
    const row = values.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      id: "evt_1",
      type: "user.created",
      resourceKind: "user",
      resourceCollection: null,
      resourceId: "u1",
      actorType: "system",
      actorId: null,
    });
    // The payload is the envelope OBJECT (not a pre-stringified column value):
    // the json/jsonb codec serializes it per dialect.
    expect(row.payload).toEqual(makeEnvelope());
  });

  it("carries no secret in the recorded payload", async () => {
    const { tx, values } = fakeTx();
    await recordEventInTx(tx, "sqlite", {
      envelope: makeEnvelope({
        data: { id: "u1", email: "a@example.com", name: "Ada", roles: [] },
      }),
    });
    const row = values.mock.calls[0][0] as { payload: unknown };
    expect(JSON.stringify(row.payload)).not.toMatch(
      /password|passwordHash|token/i
    );
  });

  it("selects the requested dialect's event table", async () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const { tx, insert } = fakeTx();
      await recordEventInTx(tx, dialect, { envelope: makeEnvelope() });
      expect(insert).toHaveBeenCalledWith(webhookTables(dialect).nextlyEvents);
    }
  });
});
