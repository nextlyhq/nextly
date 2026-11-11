// The health check's connection read on SQLite: a file on this machine, with no network
// connection to encrypt, so encryption is not applicable, never "unknown" or a warning. The
// library's version and a round trip are read from the open database; before it is open, both
// are left out.

import { describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

describe("SQLite inspectConnection", () => {
  it("answers not applicable and local, with the library's version once open", async () => {
    const adapter = createSqliteAdapter({ memory: true });
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "not-applicable",
      local: true,
    });
    await adapter.connect();
    try {
      expect(await adapter.inspectConnection()).toEqual({
        encryption: "not-applicable",
        local: true,
        serverVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        roundTripMs: expect.any(Number),
      });
    } finally {
      await adapter.disconnect();
    }
  });
});
