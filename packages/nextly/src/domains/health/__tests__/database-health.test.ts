/**
 * The database line's rules: when a connection is exposed (production, and a
 * database on another machine), and what an exposed connection asks of a
 * reader: a danger when it is not encrypted, a warning when whether it is
 * could not be read, and nothing otherwise. Every combination is tried, and
 * an adapter whose read fails or that cannot be asked.
 */

import type { ConnectionInspection } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { connectionAttention, readDatabaseHealth } from "../database-health";

const ENCRYPTIONS: ConnectionInspection["encryption"][] = [
  "encrypted",
  "unencrypted",
  "unknown",
  "not-applicable",
];

/** An adapter whose read answers `inspection`. */
const answering = (inspection: ConnectionInspection) => ({
  dialect: "postgresql" as const,
  inspectConnection: () => Promise.resolve(inspection),
});

describe("readDatabaseHealth", () => {
  it("carries the adapter's read, and is exposed only in production to another machine", async () => {
    const remote = answering({
      encryption: "unencrypted",
      local: false,
      serverVersion: "17.2",
      roundTripMs: 4,
    });
    expect(await readDatabaseHealth(remote, true)).toEqual({
      dialect: "postgresql",
      serverVersion: "17.2",
      roundTripMs: 4,
      encryption: "unencrypted",
      exposed: true,
    });
    expect((await readDatabaseHealth(remote, false)).exposed).toBe(false);
    const local = answering({ encryption: "unencrypted", local: true });
    expect((await readDatabaseHealth(local, true)).exposed).toBe(false);
  });

  it("is unknown and remote when the read throws or the adapter cannot be asked", async () => {
    const throwing = {
      dialect: "mysql" as const,
      inspectConnection: () => Promise.reject(new Error("refused")),
    };
    expect(await readDatabaseHealth(throwing, true)).toEqual({
      dialect: "mysql",
      encryption: "unknown",
      exposed: true,
    });
    expect(await readDatabaseHealth({ dialect: "mysql" }, true)).toEqual({
      dialect: "mysql",
      encryption: "unknown",
      exposed: true,
    });
  });
});

describe("connectionAttention", () => {
  it("asks nothing of a connection that is not exposed, whatever it is", () => {
    for (const encryption of ENCRYPTIONS) {
      expect(connectionAttention({ encryption, exposed: false })).toBe(
        undefined
      );
    }
  });

  it("is a danger for an exposed connection that is not encrypted", () => {
    expect(
      connectionAttention({ encryption: "unencrypted", exposed: true })
    ).toBe("unencrypted");
  });

  it("is a warning for an exposed connection whose encryption could not be read", () => {
    expect(connectionAttention({ encryption: "unknown", exposed: true })).toBe(
      "unchecked"
    );
  });

  it("asks nothing of an exposed connection that is encrypted, or has nothing to encrypt", () => {
    expect(
      connectionAttention({ encryption: "encrypted", exposed: true })
    ).toBe(undefined);
    expect(
      connectionAttention({ encryption: "not-applicable", exposed: true })
    ).toBe(undefined);
  });
});
