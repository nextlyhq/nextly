import { describe, expect, it, vi } from "vitest";

import {
  DEPLOY_BUILD_MARKERS,
  TEST_RUNNER_MARKERS,
  openSiteUsage,
  resolveSiteUsage,
} from "../index.js";

import { SITE_ID, startReceiver, watchConnections } from "./usage-helpers.js";

// A running site's rules: the switch and a person's variables turn it off, a
// test runner or CI keeps it off, and a hosting platform's markers never do.
// Every case passes its environment explicitly: the test process itself runs
// under Vitest, which the guard rightly treats as a test run.

describe("the site guard", () => {
  it("is on with the switch on and nothing set", () => {
    expect(resolveSiteUsage({ env: {}, switchOn: true })).toEqual({
      on: true,
      reason: null,
    });
  });

  it("is off with the switch off", () => {
    expect(resolveSiteUsage({ env: {}, switchOn: false })).toEqual({
      on: false,
      reason: "switch-off",
    });
  });

  it.each([
    ["DO_NOT_TRACK", "1"],
    ["DO_NOT_TRACK", "true"],
    ["NEXTLY_TELEMETRY_DISABLED", "1"],
    ["NEXTLY_TELEMETRY_DISABLED", "true"],
  ])("is off with %s=%s, naming the variable", (name, value) => {
    expect(
      resolveSiteUsage({ env: { [name]: value }, switchOn: true })
    ).toEqual({ on: false, reason: name });
  });

  it("names the variable over the switch when both say no", () => {
    expect(
      resolveSiteUsage({ env: { DO_NOT_TRACK: "1" }, switchOn: false })
    ).toEqual({ on: false, reason: "DO_NOT_TRACK" });
  });

  const hostVariables = Object.values(DEPLOY_BUILD_MARKERS).flat();
  it.each(hostVariables)("stays on with the host marker %s set", name => {
    expect(resolveSiteUsage({ env: { [name]: "1" }, switchOn: true })).toEqual({
      on: true,
      reason: null,
    });
  });

  it("stays on with every host marker set at once", () => {
    const env = Object.fromEntries(hostVariables.map(name => [name, "1"]));
    expect(resolveSiteUsage({ env, switchOn: true }).on).toBe(true);
  });

  it("is off with NODE_ENV=test", () => {
    expect(
      resolveSiteUsage({ env: { NODE_ENV: "test" }, switchOn: true })
    ).toEqual({ on: false, reason: "test-runner" });
  });

  it.each(TEST_RUNNER_MARKERS)("is off with the test runner's %s", name => {
    expect(resolveSiteUsage({ env: { [name]: "1" }, switchOn: true })).toEqual({
      on: false,
      reason: "test-runner",
    });
  });

  it("is off under Node's own test runner", () => {
    expect(
      resolveSiteUsage({
        env: { NODE_TEST_CONTEXT: "child-v8" },
        switchOn: true,
      })
    ).toEqual({ on: false, reason: "test-runner" });
  });

  it("is off with CI set while the server runs", () => {
    expect(resolveSiteUsage({ env: { CI: "true" }, switchOn: true })).toEqual({
      on: false,
      reason: "ci",
    });
  });

  it("stays on in production mode", () => {
    expect(
      resolveSiteUsage({ env: { NODE_ENV: "production" }, switchOn: true }).on
    ).toBe(true);
  });
});

describe("a site that is off opens no connection", () => {
  async function run(env: Record<string, string>, switchOn: boolean) {
    const receiver = await startReceiver();
    const connections = watchConnections();
    const fetchSpy = vi.fn(globalThis.fetch);
    try {
      const session = openSiteUsage({
        nextlyVersion: "1.2.3",
        siteId: SITE_ID,
        role: "production",
        switchOn,
        env,
        endpoint: receiver.endpoint,
        fetch: fetchSpy,
      });
      session.capture("first_collection_created", {});
      await session.flush();
      return {
        received: receiver.bodies.length,
        connections: connections.count(),
        fetches: fetchSpy.mock.calls.length,
      };
    } finally {
      connections.stop();
      await receiver.close();
    }
  }

  it("on a host, with the switch on: one request reaches the receiver", async () => {
    const result = await run({ VERCEL: "1" }, true);
    expect(result).toMatchObject({ received: 1, fetches: 1 });
    expect(result.connections).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["the switch off", {}, false],
    ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }, true],
    ["NEXTLY_TELEMETRY_DISABLED", { NEXTLY_TELEMETRY_DISABLED: "1" }, true],
    ["a test runner", { NODE_ENV: "test" }, true],
    ["CI", { CI: "1" }, true],
  ] as const)("%s: nothing reaches the network", async (_n, env, switchOn) => {
    expect(await run({ ...env }, switchOn)).toEqual({
      received: 0,
      connections: 0,
      fetches: 0,
    });
  });
});
