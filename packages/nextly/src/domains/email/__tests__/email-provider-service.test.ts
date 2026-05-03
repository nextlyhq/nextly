/**
 * Tests for EmailProviderService — focused on the bugs fixed:
 *
 * 1. testProvider() falls back to provider.fromEmail when no testEmail is given
 * 2. updateProvider() does NOT wipe stored configuration when called without
 *    a configuration key (regression guard for the edit-page Bug 1 fix)
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import type { Logger } from "../../../services/shared";
import { EmailProviderService } from "../services/email-provider-service";

// ── Mock env BEFORE any service imports touch it ───────────────────────────
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!", // 36 chars
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

// ── Mock adapter send so no real network calls occur ──────────────────────
const mockAdapterSend = vi.hoisted(() => vi.fn());

vi.mock("../services/providers/resend-provider", () => ({
  createResendProvider: vi.fn(() => ({ send: mockAdapterSend })),
}));

vi.mock("../services/providers/smtp-provider", () => ({
  createSmtpProvider: vi.fn(() => ({ send: mockAdapterSend })),
}));

vi.mock("../services/providers/sendlayer-provider", () => ({
  createSendLayerProvider: vi.fn(() => ({ send: mockAdapterSend })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAdapter(db: ReturnType<typeof drizzle>): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as DrizzleAdapter;
}

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createInMemoryDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS email_providers (
      id            TEXT    PRIMARY KEY,
      name          TEXT    NOT NULL,
      type          TEXT    NOT NULL,
      from_email    TEXT    NOT NULL,
      from_name     TEXT,
      configuration TEXT    NOT NULL,
      is_default    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS ep_type_idx       ON email_providers(type);
    CREATE INDEX IF NOT EXISTS ep_default_idx    ON email_providers(is_default);
    CREATE INDEX IF NOT EXISTS ep_active_idx     ON email_providers(is_active);
    CREATE INDEX IF NOT EXISTS ep_created_at_idx ON email_providers(created_at);
  `);
  const db = drizzle(sqlite, { schema: { emailProvidersSqlite } });
  return { sqlite, db };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("EmailProviderService", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;

  beforeEach(() => {
    mockAdapterSend.mockReset();
    const { sqlite: s, db } = createInMemoryDb();
    sqlite = s;
    service = new EmailProviderService(makeAdapter(db), logger);
  });

  afterEach(() => {
    sqlite.close();
  });

  // ── testProvider() ───────────────────────────────────────────────────────

  describe("testProvider()", () => {
    it("sends to the supplied testEmail when provided", async () => {
      mockAdapterSend.mockResolvedValue({ success: true, messageId: "mid1" });

      const provider = await service.createProvider({
        name: "Resend Test",
        type: "resend",
        fromEmail: "noreply@example.com",
        fromName: "App",
        configuration: { apiKey: "re_test_key" },
        isDefault: false,
        isActive: true,
      });

      await service.testProvider(provider.id, "custom@test.com");

      const callArgs = mockAdapterSend.mock.calls[0][0];
      expect(callArgs.to).toBe("custom@test.com");
    });

    it("falls back to provider.fromEmail when no testEmail argument is given", async () => {
      mockAdapterSend.mockResolvedValue({ success: true, messageId: "mid2" });

      const provider = await service.createProvider({
        name: "Resend No-Email",
        type: "resend",
        fromEmail: "noreply@example.com",
        fromName: null,
        configuration: { apiKey: "re_test_key" },
        isDefault: false,
        isActive: true,
      });

      // No testEmail argument → must fall back to provider.fromEmail
      const result = await service.testProvider(provider.id);

      expect(result.success).toBe(true);
      const callArgs = mockAdapterSend.mock.calls[0][0];
      expect(callArgs.to).toBe("noreply@example.com");
    });

    it("returns success:false and does NOT call the adapter when the provider is inactive", async () => {
      const provider = await service.createProvider({
        name: "Inactive",
        type: "resend",
        fromEmail: "noreply@example.com",
        fromName: null,
        configuration: { apiKey: "re_key" },
        isDefault: false,
        isActive: false,
      });

      const result = await service.testProvider(provider.id);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/inactive/i);
      expect(mockAdapterSend).not.toHaveBeenCalled();
    });
  });

  // ── updateProvider() — configuration is preserved when omitted ───────────

  describe("updateProvider() — configuration preservation", () => {
    it("preserves stored configuration when no configuration key is in the update payload", async () => {
      const provider = await service.createProvider({
        name: "Resend Preserve",
        type: "resend",
        fromEmail: "from@example.com",
        fromName: null,
        configuration: { apiKey: "re_original_key" },
        isDefault: false,
        isActive: true,
      });

      // Update only the name — no configuration key (mirrors the fixed edit page)
      await service.updateProvider(provider.id, {
        name: "Resend Preserve (renamed)",
      });

      const updated = await service.getProviderDecrypted(provider.id);
      expect(updated.name).toBe("Resend Preserve (renamed)");
      expect(updated.configuration).toMatchObject({
        apiKey: "re_original_key",
      });
    });

    it("overwrites configuration when a new non-empty configuration is provided", async () => {
      const provider = await service.createProvider({
        name: "Resend Overwrite",
        type: "resend",
        fromEmail: "from@example.com",
        fromName: null,
        configuration: { apiKey: "re_old_key" },
        isDefault: false,
        isActive: true,
      });

      await service.updateProvider(provider.id, {
        configuration: { apiKey: "re_new_key" },
      });

      const updated = await service.getProviderDecrypted(provider.id);
      expect(updated.configuration).toMatchObject({ apiKey: "re_new_key" });
    });
  });
});
