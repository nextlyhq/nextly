/**
 * The startup answer tells the admin what its device memory needs: whether
 * the site lets it remember, and the schema and permission versions it labels
 * what it keeps with.
 *
 * The versions come from the modules that own them, stood in for here, so
 * what is under test is that the answer carries each, and that the
 * permission version is sent as a hash that moves when the epoch does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const versions = vi.hoisted(() => ({
  schema: 12 as number | undefined,
  epoch: "gen-1:4",
  epochFails: false,
  trustworthy: true,
}));

vi.mock("../schema-version", () => ({
  servedSchemaVersion: async () => versions.schema,
}));

vi.mock("../../services/lib/rbac-epoch", () => ({
  refreshEpoch: async () => {
    if (versions.epochFails) throw new Error("epoch table unreadable");
    return versions.epoch;
  },
  epochIsTrustworthy: () => versions.trustworthy,
}));

const { handleStartupRequest } = await import("../startup-request");

const answer = async () =>
  new Response("{}", { headers: { "content-type": "application/json" } });

async function startupAnswer(): Promise<Response> {
  return handleStartupRequest(
    new Request("http://localhost/admin/api/startup?path=/auth/session"),
    answer
  );
}

beforeEach(() => {
  versions.schema = 12;
  versions.epoch = "gen-1:4";
  versions.epochFails = false;
  versions.trustworthy = true;
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the startup answer's device-memory headers", () => {
  it("says remembering is on by default", async () => {
    const response = await startupAnswer();
    expect(response.headers.get("X-Nextly-Device-Memory")).toBe("on");
  });

  it.each(["off", "OFF", " off "])(
    "says remembering is off where the site set it to %j",
    async value => {
      vi.stubEnv("NEXTLY_ADMIN_DEVICE_MEMORY", value);
      const response = await startupAnswer();
      expect(response.headers.get("X-Nextly-Device-Memory")).toBe("off");
    }
  );

  it("carries the schema version this copy serves", async () => {
    const response = await startupAnswer();
    expect(response.headers.get("X-Nextly-Schema-Version")).toBe("12");
  });

  it("carries the permission version as a hash that moves with the epoch", async () => {
    const before = (await startupAnswer()).headers.get(
      "X-Nextly-Permission-Version"
    );
    expect(before).toMatch(/^[\w-]{22}$/);
    expect(before).not.toContain("gen-1");

    versions.epoch = "gen-1:5";
    const after = (await startupAnswer()).headers.get(
      "X-Nextly-Permission-Version"
    );
    expect(after).toMatch(/^[\w-]{22}$/);
    expect(after).not.toBe(before);
  });

  it("leaves out the permission version while the epoch cannot be trusted", async () => {
    // The refresh answered (with this process's own value), but the shared
    // row did not: no other copy has seen the value, so it labels nothing.
    versions.trustworthy = false;
    const response = await startupAnswer();
    expect(response.status).toBe(200);
    expect(response.headers.has("X-Nextly-Permission-Version")).toBe(false);
    expect(response.headers.get("X-Nextly-Schema-Version")).toBe("12");
  });

  it("leaves out a version it cannot read, and still answers", async () => {
    versions.schema = undefined;
    versions.epochFails = true;
    const response = await startupAnswer();
    expect(response.status).toBe(200);
    expect(response.headers.has("X-Nextly-Schema-Version")).toBe(false);
    expect(response.headers.has("X-Nextly-Permission-Version")).toBe(false);
  });
});
