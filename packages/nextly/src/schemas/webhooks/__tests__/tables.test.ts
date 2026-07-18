import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, it, expect } from "vitest";

import { getDialectTables } from "../../../database/index";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { nextlyWebhookDeliveries } from "../postgres";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];
const WEBHOOK_TABLES = [
  "nextly_events",
  "nextly_webhooks",
  "nextly_webhook_deliveries",
];

// The webhook system tables must be registered as first-class managed tables so
// the introspect-diff pipeline creates them on boot, exactly like the other
// core system tables (api_keys, audit_log, nextly_schema_events).
describe("webhook system tables", () => {
  it("registers all three tables in CORE_TABLE_NAMES", () => {
    for (const name of WEBHOOK_TABLES) {
      expect(CORE_TABLE_NAMES).toContain(name);
    }
  });

  for (const dialect of DIALECTS) {
    it(`includes the three webhook tables in getCoreSchema(${dialect})`, () => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      for (const name of WEBHOOK_TABLES) {
        expect(names).toContain(name);
      }
    });
  }

  for (const dialect of DIALECTS) {
    it(`exports the webhook tables from the ${dialect} dialect bundle`, () => {
      // getCoreSchema registration is not enough: freshPushSchema creates a
      // fresh database from getDialectTables (the flat bundle), so the tables
      // must be present there too or they never materialize on first boot.
      const tables = getDialectTables(dialect) as Record<string, unknown>;
      for (const key of [
        "nextlyEvents",
        "nextlyWebhooks",
        "nextlyWebhookDeliveries",
      ]) {
        expect(tables[key]).toBeDefined();
      }
    });
  }

  it("gives the delivery ledger its retry/lease columns (sqlite)", () => {
    // Guards against a column being dropped from one dialect: the drain relies
    // on status + next_attempt_at, and the fallback claim relies on the lease.
    const deliveries = getCoreSchema("sqlite").tables.find(
      t => t.name === "nextly_webhook_deliveries"
    );
    const cols = deliveries?.columns.map(c => c.name) ?? [];
    for (const col of [
      "status",
      "attempt_count",
      "next_attempt_at",
      "locked_by",
      "locked_until",
      "webhook_id",
      "event_id",
    ]) {
      expect(cols).toContain(col);
    }
  });

  it("enforces one delivery per (webhook, event) with a unique index", () => {
    // The DB constraint is what makes capture idempotent: fan-out and retry
    // insert with ON CONFLICT DO NOTHING, so a duplicate can never double-send.
    const { indexes } = getTableConfig(nextlyWebhookDeliveries);
    const unique = indexes.find(i => i.config.unique);
    expect(unique).toBeDefined();
    expect(
      unique?.config.columns.map(c => (c as { name: string }).name)
    ).toEqual(["webhook_id", "event_id"]);
  });

  it("stores the full envelope on the event ledger (postgres)", () => {
    const events = getCoreSchema("postgresql").tables.find(
      t => t.name === "nextly_events"
    );
    const cols = events?.columns.map(c => c.name) ?? [];
    for (const col of ["id", "type", "payload", "resource_kind"]) {
      expect(cols).toContain(col);
    }
  });

  for (const dialect of DIALECTS) {
    it(`gives the event ledger a fanned_out_at drain marker (${dialect})`, () => {
      // The drain's fan-out pass claims events by fanned_out_at IS NULL, so the
      // column must exist on every dialect.
      const events = getCoreSchema(dialect).tables.find(
        t => t.name === "nextly_events"
      );
      const cols = events?.columns.map(c => c.name) ?? [];
      expect(cols).toContain("fanned_out_at");
    });
  }
});
