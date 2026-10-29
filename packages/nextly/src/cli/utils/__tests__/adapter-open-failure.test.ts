/**
 * Every command opens its database through `createCliAdapter`, so it is where a failure to open
 * one gets its code: the adapter's package missing, the connection refused, or an error that
 * already has a code of its own, kept as it is.
 *
 * @module cli/utils/__tests__/adapter-open-failure.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

const createAdapterFromEnv = vi.fn();

vi.mock("../../../database/factory", () => ({
  createAdapterFromEnv: (...args: unknown[]) => createAdapterFromEnv(...args),
}));

const { createCliAdapter } = await import("../adapter");

const open = () =>
  createCliAdapter({
    dialect: "postgresql",
    databaseUrl: "postgres://localhost:5432/app",
  });

afterEach(() => {
  createAdapterFromEnv.mockReset();
});

describe("a database that cannot be opened", () => {
  it("is DATABASE_UNREACHABLE when the connection fails, with the driver's reason", async () => {
    createAdapterFromEnv.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );
    await expect(open()).rejects.toMatchObject({
      code: "DATABASE_UNREACHABLE",
      why: "connect ECONNREFUSED 127.0.0.1:5432",
    });
  });

  it("is DATABASE_ADAPTER_MISSING when the adapter's package cannot be loaded", async () => {
    // The factory's own wording for a package it could not import.
    createAdapterFromEnv.mockRejectedValue(
      new Error(
        'Failed to load database adapter for "postgresql". Make sure @nextlyhq/adapter-postgres is installed'
      )
    );
    await expect(open()).rejects.toMatchObject({
      code: "DATABASE_ADAPTER_MISSING",
    });
  });

  it("keeps an error that already has its code", async () => {
    const refusal = new NextlyError({
      code: "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED",
      publicMessage: "The PostgreSQL schema `cms` is not supported yet.",
    });
    createAdapterFromEnv.mockRejectedValue(refusal);
    await expect(open()).rejects.toBe(refusal);
  });
});
