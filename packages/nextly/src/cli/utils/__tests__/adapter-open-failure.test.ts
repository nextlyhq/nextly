/**
 * Every command opens its database through `createCliAdapter`, so it is where a failure to open
 * one gets its code: the adapter's package missing, the connection refused, or an error that
 * already has a code of its own, kept as it is.
 *
 * @module cli/utils/__tests__/adapter-open-failure.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import { toCliError } from "../../errors/from-thrown";

const createAdapter = vi.fn();
const installRegistryResolver = vi.fn();

vi.mock("../../../database/factory", () => ({
  createAdapter: (...args: unknown[]) => createAdapter(...args),
}));
vi.mock("../registry-resolver", () => ({
  installRegistryResolver: (...args: unknown[]) =>
    installRegistryResolver(...args),
}));

const { createCliAdapter } = await import("../adapter");

const open = () =>
  createCliAdapter({
    dialect: "postgresql",
    databaseUrl: "postgres://localhost:5432/app",
  });

afterEach(() => {
  createAdapter.mockReset();
  installRegistryResolver.mockReset();
});

describe("a database that cannot be opened", () => {
  it("is DATABASE_UNREACHABLE when the connection fails, with the driver's reason", async () => {
    createAdapter.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );
    await expect(open()).rejects.toMatchObject({
      code: "DATABASE_UNREACHABLE",
      why: "connect ECONNREFUSED 127.0.0.1:5432",
    });
  });

  it("is DATABASE_ADAPTER_MISSING when the adapter's package cannot be loaded", async () => {
    // The factory's own wording for a package it could not import.
    createAdapter.mockRejectedValue(
      new Error(
        'Failed to load database adapter for "postgresql". Make sure @nextlyhq/adapter-postgres is installed'
      )
    );
    await expect(open()).rejects.toMatchObject({
      code: "DATABASE_ADAPTER_MISSING",
    });
  });

  it("is DATABASE_VERSION_UNSUPPORTED when the server is older than Nextly supports", async () => {
    // As the adapters' version check throws it: by kind, with both versions.
    createAdapter.mockRejectedValue(
      Object.assign(new Error("PostgreSQL 12.4 is not supported."), {
        kind: "unsupported_version",
        detectedVersion: "12.4",
        requiredVersion: "15",
      })
    );
    await expect(open()).rejects.toMatchObject({
      code: "DATABASE_VERSION_UNSUPPORTED",
      what: "The PostgreSQL server is version 12.4, older than Nextly supports.",
    });
  });

  it("keeps an error that already has its code", async () => {
    const refusal = new NextlyError({
      code: "NEXTLY_POSTGRES_SCHEMA_MOVED",
      publicMessage:
        'db.postgres.schema is "cms", but this database\'s Nextly installation is in "public".',
    });
    createAdapter.mockRejectedValue(refusal);
    await expect(open()).rejects.toBe(refusal);
  });
});

describe("a database that opened, whose tables cannot be loaded", () => {
  const failure = new TypeError("Cannot read properties of undefined");

  /** An open whose tables fail, with a disconnect that answers as `disconnect` does. */
  async function opened(disconnect: () => Promise<void>): Promise<unknown> {
    createAdapter.mockResolvedValue({ disconnect });
    installRegistryResolver.mockImplementation(() => {
      throw failure;
    });
    return open().catch((error: unknown) => error);
  }

  it("is given up, and the command ends on the tables' own error, not on a failed connection", async () => {
    let closed = false;
    // Takes a turn, as ending a pool does: the open must wait for it.
    const disconnect = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      closed = true;
    });

    const error = await opened(disconnect);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(closed).toBe(true);
    expect(error).toBe(failure);
    const shown = toCliError(error);
    expect(shown.code).toBe("UNEXPECTED_ERROR");
    expect(`${shown.what} ${shown.why}`).toContain(failure.message);
  });

  it("ends on the tables' own error when giving it up fails too", async () => {
    const error = await opened(async () => {
      throw new Error("already closed");
    });

    expect(error).toBe(failure);
  });
});
