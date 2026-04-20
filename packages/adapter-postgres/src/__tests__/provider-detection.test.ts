// Tests for PostgreSQL provider auto-detection.
// Detects Neon, Supabase, or standard PG from DATABASE_URL pattern
// and applies appropriate connection defaults.
import { describe, it, expect } from "vitest";

import { detectPostgresProvider, getProviderDefaults } from "../provider";

describe("detectPostgresProvider", () => {
  it("detects standard PostgreSQL for localhost", () => {
    expect(
      detectPostgresProvider(
        "postgresql://postgres:postgres@localhost:5432/nextly"
      )
    ).toBe("standard");
  });

  it("detects standard PostgreSQL for Docker", () => {
    expect(
      detectPostgresProvider("postgresql://postgres:postgres@127.0.0.1:5432/db")
    ).toBe("standard");
  });

  it("detects Neon from URL", () => {
    expect(
      detectPostgresProvider(
        "postgresql://user:pass@ep-cool-darkness-123.us-east-2.aws.neon.tech/db"
      )
    ).toBe("neon");
  });

  it("detects Neon pooler URL", () => {
    expect(
      detectPostgresProvider(
        "postgresql://user:pass@ep-cool-darkness-123-pooler.us-east-2.aws.neon.tech/db"
      )
    ).toBe("neon");
  });

  it("detects Supabase pooler URL", () => {
    expect(
      detectPostgresProvider(
        "postgresql://postgres.abcdef:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
      )
    ).toBe("supabase");
  });

  it("detects Supabase direct connection", () => {
    expect(
      detectPostgresProvider(
        "postgresql://postgres:pass@db.abcdef.supabase.co:5432/postgres"
      )
    ).toBe("supabase");
  });

  it("returns standard for unknown hosts", () => {
    expect(
      detectPostgresProvider(
        "postgresql://user:pass@my-custom-db.example.com/db"
      )
    ).toBe("standard");
  });

  it("respects explicit provider override", () => {
    expect(detectPostgresProvider("postgresql://localhost/db", "neon")).toBe(
      "neon"
    );
  });

  it("respects explicit supabase override", () => {
    expect(
      detectPostgresProvider("postgresql://localhost/db", "supabase")
    ).toBe("supabase");
  });

  it("ignores invalid override", () => {
    expect(
      detectPostgresProvider(
        "postgresql://user:pass@ep-test.neon.tech/db",
        "invalid"
      )
    ).toBe("neon");
  });
});

describe("getProviderDefaults", () => {
  it("returns standard defaults", () => {
    const defaults = getProviderDefaults("standard");
    expect(defaults.ssl).toBe(false);
    expect(defaults.poolMax).toBe(10);
    expect(defaults.retryAttempts).toBe(3);
  });

  it("returns Neon defaults with SSL and more retries", () => {
    const defaults = getProviderDefaults("neon");
    expect(defaults.ssl).toBe(true);
    expect(defaults.poolMax).toBe(5);
    expect(defaults.connectionTimeoutMs).toBe(20000);
    expect(defaults.retryAttempts).toBe(5);
  });

  it("returns Supabase defaults with SSL", () => {
    const defaults = getProviderDefaults("supabase");
    expect(defaults.ssl).toBe(true);
    expect(defaults.poolMax).toBe(5);
    expect(defaults.retryAttempts).toBe(3);
  });
});
