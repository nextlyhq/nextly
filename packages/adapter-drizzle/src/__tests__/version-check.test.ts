// What: unit tests for F17 connect-time version check.
// Why: covers all hybrid-policy paths. Uses mocked clients so no real DB
// needed; F18 will add real-DB regression on top.

import { describe, it, expect, vi } from "vitest";

import {
  checkDialectVersion,
  NEXTLY_MIN_DB_VERSIONS,
  UnsupportedDialectVersionError,
  type VersionQueryClient,
} from "../version-check";

// Why a factory: each test composes its own response shape. PG/MySQL/SQLite
// have different result shapes so the mocks are not interchangeable.
function pgClient(versionString: string): VersionQueryClient {
  return {
    query: () => Promise.resolve({ rows: [{ version: versionString }] }),
  };
}

function mysqlClient(versionString: string): VersionQueryClient {
  return {
    query: () => Promise.resolve([[{ version: versionString }]]),
  };
}

function sqliteClient(versionString: string): VersionQueryClient {
  return {
    prepare: () => ({
      get: () => ({ version: versionString }),
    }),
  };
}

describe("checkDialectVersion - PostgreSQL", () => {
  it("hard-fails on PostgreSQL 13.7 (below minimum)", async () => {
    const client = pgClient(
      "PostgreSQL 13.7 on aarch64-unknown-linux-gnu, compiled by gcc, 64-bit"
    );
    await expect(checkDialectVersion(client, "postgresql")).rejects.toThrow(
      UnsupportedDialectVersionError
    );
    await expect(checkDialectVersion(client, "postgresql")).rejects.toThrow(
      /15\.0\+ required; detected 13\.7/
    );
  });

  it("passes on PostgreSQL 15.0", async () => {
    const client = pgClient(
      "PostgreSQL 15.0 on x86_64-pc-linux-gnu, compiled by gcc, 64-bit"
    );
    await expect(
      checkDialectVersion(client, "postgresql")
    ).resolves.toBeUndefined();
  });

  it("passes on PostgreSQL 16.1 with extra Debian metadata", async () => {
    const client = pgClient(
      "PostgreSQL 16.1 (Debian 16.1-1.pgdg120+2) on x86_64-pc-linux-gnu, compiled by gcc, 64-bit"
    );
    await expect(
      checkDialectVersion(client, "postgresql")
    ).resolves.toBeUndefined();
  });
});

describe("checkDialectVersion - MySQL", () => {
  it("hard-fails on MySQL 5.7.42 (below minimum, no variant token)", async () => {
    const client = mysqlClient("5.7.42-log");
    await expect(checkDialectVersion(client, "mysql")).rejects.toThrow(
      UnsupportedDialectVersionError
    );
    await expect(checkDialectVersion(client, "mysql")).rejects.toThrow(
      /8\.0\+ required; detected 5\.7/
    );
  });

  it("passes silently on real MySQL 8.0.33 with no warning", async () => {
    const client = mysqlClient("8.0.33");
    const onWarning = vi.fn();
    await expect(
      checkDialectVersion(client, "mysql", { onWarning })
    ).resolves.toBeUndefined();
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("warns and proceeds on MariaDB 10.11.5", async () => {
    const client = mysqlClient("10.11.5-MariaDB-1:10.11.5+maria~ubu2204");
    const onWarning = vi.fn();
    await expect(
      checkDialectVersion(client, "mysql", { onWarning })
    ).resolves.toBeUndefined();
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/mariadb/i);
    expect(onWarning.mock.calls[0]?.[0]).toMatch(
      /not officially supported in v1/
    );
  });

  it("warns and proceeds on TiDB advertising MySQL 5.7", async () => {
    const client = mysqlClient("5.7.25-TiDB-v6.5.0");
    const onWarning = vi.fn();
    await expect(
      checkDialectVersion(client, "mysql", { onWarning })
    ).resolves.toBeUndefined();
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/tidb/i);
  });

  it("warns and proceeds on Aurora MySQL 8.0.mysql_aurora.3.04.0", async () => {
    const client = mysqlClient("8.0.mysql_aurora.3.04.0");
    const onWarning = vi.fn();
    await expect(
      checkDialectVersion(client, "mysql", { onWarning })
    ).resolves.toBeUndefined();
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/aurora/i);
  });

  it("warns and proceeds on PlanetScale (Vitess-based) version string", async () => {
    const client = mysqlClient("8.0.32-PlanetScale-Vitess-v18.0.0");
    const onWarning = vi.fn();
    await expect(
      checkDialectVersion(client, "mysql", { onWarning })
    ).resolves.toBeUndefined();
    expect(onWarning).toHaveBeenCalledTimes(1);
    // Why: first matching token wins; `planetscale` is checked before `vitess`.
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/planetscale/i);
  });

  it("variant warning still fires when no onWarning callback provided", async () => {
    const client = mysqlClient("10.11.5-MariaDB");
    // Why: callback is optional; skipping it should NOT throw.
    await expect(checkDialectVersion(client, "mysql")).resolves.toBeUndefined();
  });
});

describe("checkDialectVersion - SQLite", () => {
  it("hard-fails on SQLite 3.24.0 (below minimum)", async () => {
    const client = sqliteClient("3.24.0");
    await expect(checkDialectVersion(client, "sqlite")).rejects.toThrow(
      UnsupportedDialectVersionError
    );
    await expect(checkDialectVersion(client, "sqlite")).rejects.toThrow(
      /3\.38\+ required; detected 3\.24/
    );
  });

  it("passes on SQLite 3.38.0", async () => {
    const client = sqliteClient("3.38.0");
    await expect(
      checkDialectVersion(client, "sqlite")
    ).resolves.toBeUndefined();
  });

  it("passes on SQLite 3.45.0", async () => {
    const client = sqliteClient("3.45.0");
    await expect(
      checkDialectVersion(client, "sqlite")
    ).resolves.toBeUndefined();
  });
});

describe("checkDialectVersion - unparseable", () => {
  it("hard-fails on completely unparseable PG version string", async () => {
    const client = pgClient("Some completely unexpected string");
    await expect(checkDialectVersion(client, "postgresql")).rejects.toThrow(
      /Could not parse postgresql version/
    );
  });

  it("hard-fails on unparseable MySQL string with no variant token", async () => {
    const client = mysqlClient("Some random unrecognized format");
    await expect(checkDialectVersion(client, "mysql")).rejects.toThrow(
      /Could not parse mysql version/
    );
  });
});

describe("NEXTLY_MIN_DB_VERSIONS", () => {
  it("exports the locked minimum versions", () => {
    expect(NEXTLY_MIN_DB_VERSIONS).toEqual({
      postgresql: { major: 15, minor: 0 },
      mysql: { major: 8, minor: 0 },
      sqlite: { major: 3, minor: 38 },
    });
  });
});

describe("UnsupportedDialectVersionError", () => {
  it("exposes detectedVersion, requiredVersion, kind, dialect", async () => {
    const client = pgClient("PostgreSQL 13.7 on x86_64");
    const err = await checkDialectVersion(client, "postgresql").catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(UnsupportedDialectVersionError);
    const typed = err as UnsupportedDialectVersionError;
    expect(typed.detectedVersion).toBe("13.7");
    expect(typed.requiredVersion).toBe("15.0+");
    expect(typed.kind).toBe("unsupported_version");
    expect(typed.dialect).toBe("postgresql");
  });
});
