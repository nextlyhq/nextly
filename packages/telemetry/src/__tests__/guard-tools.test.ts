import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CI_MARKERS,
  DEPLOY_BUILD_MARKERS,
  openToolsUsage,
  resolveToolsUsage,
} from "../index.js";

import {
  MACHINE_ID,
  recordingFetch,
  startReceiver,
  watchConnections,
} from "./usage-helpers.js";

// The installer's and the CLI's off rules: a person's "no", CI and deploy
// builds turn usage data off; no terminal, Docker and production mode do not.

// If the new path ever consulted the old Docker check, this would turn it on.
vi.mock("../environment.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../environment.js")>()),
  detectIsDocker: () => true,
}));

const on = { env: {}, machineEnabled: true };

describe("the tools' guard: each off rule", () => {
  it.each(["1", "true", "TRUE", " true "])("DO_NOT_TRACK=%j is off", value => {
    expect(resolveToolsUsage({ ...on, env: { DO_NOT_TRACK: value } })).toEqual({
      on: false,
      reason: "DO_NOT_TRACK",
      personSaidNo: true,
    });
  });

  it.each(["1", "true"])("NEXTLY_TELEMETRY_DISABLED=%j is off", value => {
    expect(
      resolveToolsUsage({ ...on, env: { NEXTLY_TELEMETRY_DISABLED: value } })
    ).toEqual({
      on: false,
      reason: "NEXTLY_TELEMETRY_DISABLED",
      personSaidNo: true,
    });
  });

  it.each(["0", "false", "", "yes"])(
    "a person's variable set to %j is not a no",
    value => {
      const decision = resolveToolsUsage({
        ...on,
        env: { DO_NOT_TRACK: value, NEXTLY_TELEMETRY_DISABLED: value },
      });
      expect(decision.on).toBe(true);
    }
  );

  it("the machine's own setting off is off", () => {
    expect(resolveToolsUsage({ env: {}, machineEnabled: false })).toEqual({
      on: false,
      reason: "machine-setting",
      personSaidNo: true,
    });
  });

  const ciVariables = Object.values(CI_MARKERS).flat();
  it.each(ciVariables)("CI marker %s is off, and not a person's no", name => {
    expect(resolveToolsUsage({ ...on, env: { [name]: "1" } })).toEqual({
      on: false,
      reason: "ci",
      personSaidNo: false,
    });
  });

  it("CI=false is not CI", () => {
    expect(resolveToolsUsage({ ...on, env: { CI: "false" } }).on).toBe(true);
  });

  const deployVariables = Object.values(DEPLOY_BUILD_MARKERS).flat();
  it.each(deployVariables)(
    "deploy-build marker %s is off, and not a person's no",
    name => {
      expect(resolveToolsUsage({ ...on, env: { [name]: "1" } })).toEqual({
        on: false,
        reason: "deploy-build",
        personSaidNo: false,
      });
    }
  );

  it("names Vercel, Netlify and Render as deploy builds", () => {
    expect(Object.keys(DEPLOY_BUILD_MARKERS)).toEqual(
      expect.arrayContaining(["Vercel", "Netlify", "Render"])
    );
  });

  it("is on with nothing set", () => {
    expect(resolveToolsUsage(on)).toEqual({
      on: true,
      reason: null,
      personSaidNo: false,
    });
  });
});

describe("the tools' guard when rules disagree", () => {
  it("one person's variable says no while the other says yes: off", () => {
    expect(
      resolveToolsUsage({
        ...on,
        env: { DO_NOT_TRACK: "0", NEXTLY_TELEMETRY_DISABLED: "true" },
      })
    ).toMatchObject({ on: false, reason: "NEXTLY_TELEMETRY_DISABLED" });
  });

  it("CI and a person's no together: the person's no is the reason", () => {
    expect(
      resolveToolsUsage({ env: { CI: "1" }, machineEnabled: false })
    ).toEqual({ on: false, reason: "machine-setting", personSaidNo: true });
  });

  it("a deploy build and DO_NOT_TRACK together: still a person's no", () => {
    expect(
      resolveToolsUsage({ ...on, env: { VERCEL: "1", DO_NOT_TRACK: "1" } })
    ).toEqual({ on: false, reason: "DO_NOT_TRACK", personSaidNo: true });
  });
});

describe("runs the old rules left out are counted", () => {
  const originalArgv = process.argv;
  const originalIsTty = process.stdout.isTTY;
  afterEach(() => {
    process.argv = originalArgv;
    process.stdout.isTTY = originalIsTty;
  });

  function sendOne(env: Record<string, string>) {
    const recorder = recordingFetch();
    const session = openToolsUsage({
      source: "cli",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env,
      fetch: recorder.fetch,
    });
    session.capture("command_run", {
      command: "schema pull",
      alias: false,
      role: "local",
    });
    return { session, recorder };
  }

  it("with no terminal", async () => {
    process.stdout.isTTY = false;
    const { session, recorder } = sendOne({});
    expect(session.decision.on).toBe(true);
    await session.flush();
    expect(recorder.calls).toHaveLength(1);
  });

  it("inside Docker", async () => {
    const { session, recorder } = sendOne({});
    expect(session.decision.on).toBe(true);
    await session.flush();
    expect(recorder.calls).toHaveLength(1);
  });

  it("with NODE_ENV=production", async () => {
    const { session, recorder } = sendOne({ NODE_ENV: "production" });
    expect(session.decision.on).toBe(true);
    await session.flush();
    expect(recorder.calls).toHaveLength(1);
  });

  it("with --mode production", async () => {
    process.argv = [...originalArgv, "--mode", "production"];
    const { session, recorder } = sendOne({});
    expect(session.decision.on).toBe(true);
    await session.flush();
    expect(recorder.calls).toHaveLength(1);
  });
});

describe("off means no connection at all", () => {
  const offCases: [string, Record<string, string>, boolean][] = [
    ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }, true],
    ["NEXTLY_TELEMETRY_DISABLED", { NEXTLY_TELEMETRY_DISABLED: "true" }, true],
    ["the machine's setting", {}, false],
    ["CI", { CI: "true" }, true],
    ["a deploy build", { NETLIFY: "true" }, true],
  ];

  async function run(env: Record<string, string>, machineEnabled: boolean) {
    const receiver = await startReceiver();
    const connections = watchConnections();
    const fetchSpy = vi.fn(globalThis.fetch);
    try {
      const session = openToolsUsage({
        source: "installer",
        nextlyVersion: "1.2.3",
        distinctId: MACHINE_ID,
        machineEnabled,
        env,
        endpoint: receiver.endpoint,
        fetch: fetchSpy,
      });
      session.capture("install_started", {
        from: "quickstart",
        terminal: true,
      });
      await session.flush();
      return {
        decision: session.decision,
        received: receiver.bodies.length,
        connections: connections.count(),
        fetches: fetchSpy.mock.calls.length,
      };
    } finally {
      connections.stop();
      await receiver.close();
    }
  }

  it("the receiver and the network spy see the one request when on", async () => {
    const result = await run({}, true);
    expect(result).toMatchObject({ received: 1, fetches: 1 });
    expect(result.connections).toBeGreaterThanOrEqual(1);
  });

  it.each(offCases)(
    "%s: the receiver stays empty and no connection opens",
    async (_name, env, machineEnabled) => {
      const result = await run(env, machineEnabled);
      expect(result.decision.on).toBe(false);
      expect(result).toMatchObject({ received: 0, connections: 0, fetches: 0 });
    }
  );
});
