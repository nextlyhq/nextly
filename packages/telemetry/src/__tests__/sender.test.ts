import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openSiteUsage,
  openToolsUsage,
  type ToolsUsageOptions,
} from "../index.js";

import {
  MACHINE_ID,
  SITE_ID,
  recordingFetch,
  startReceiver,
  type Receiver,
} from "./usage-helpers.js";

// The sender: what one request carries, what it drops, and that the end of a
// run never waits more than 2 seconds or prints anything, whatever the
// network does.

function cliSession(extra: Partial<ToolsUsageOptions> = {}) {
  return openToolsUsage({
    source: "cli",
    nextlyVersion: "1.2.3",
    distinctId: MACHINE_ID,
    machineEnabled: true,
    env: {},
    ...extra,
  });
}

const run = { command: "schema pull", alias: false, role: "local" } as const;

interface Batch {
  project: string;
  batch: {
    event: string;
    distinct_id: string;
    timestamp: string;
    properties: Record<string, unknown>;
  }[];
}

describe("what the sender sends", () => {
  it("posts PostHog's batch format to the ingest address's batch path", async () => {
    const receiver = await startReceiver();
    try {
      const session = cliSession({ endpoint: receiver.endpoint });
      session.capture("command_run", { ...run, exit_code: 0, duration_ms: 40 });
      await session.flush();
      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0]?.path).toBe("/batch/");
      const body = receiver.bodies[0] as Batch;
      expect(body.project).toBe("production");
      expect(body.batch).toHaveLength(1);
      expect(body.batch[0]).toMatchObject({
        event: "command_run",
        distinct_id: MACHINE_ID,
        properties: {
          command: "schema pull",
          exit_code: 0,
          // The id inside the properties too, as the batch endpoint reads it.
          distinct_id: MACHINE_ID,
          $process_person_profile: false,
        },
      });
      expect(Number.isNaN(Date.parse(body.batch[0]?.timestamp ?? ""))).toBe(
        false
      );
    } finally {
      await receiver.close();
    }
  });

  it("sends the production ingest address by default", async () => {
    const recorder = recordingFetch();
    const session = cliSession({ fetch: recorder.fetch });
    session.capture("command_run", run);
    await session.flush();
    expect(recorder.calls[0]?.url).toBe(
      "https://telemetry.nextlyhq.com/batch/"
    );
  });

  it("carries no project token, in the body or the headers", async () => {
    const recorder = recordingFetch();
    const session = cliSession({ fetch: recorder.fetch });
    session.capture("command_run", run);
    await session.flush();
    const call = recorder.calls[0];
    const text = JSON.stringify(call);
    expect(text).not.toMatch(/phc_/);
    expect(call?.body).not.toHaveProperty("api_key");
    expect(Object.keys(call?.headers ?? {})).toEqual(["content-type"]);
  });

  it("marks the test project with NEXTLY_TELEMETRY_PROJECT=test", async () => {
    const recorder = recordingFetch();
    const session = cliSession({
      fetch: recorder.fetch,
      env: { NEXTLY_TELEMETRY_PROJECT: "test" },
    });
    session.capture("command_run", run);
    await session.flush();
    expect((recorder.calls[0]?.body as Batch).project).toBe("test");
  });

  it("drops a property the catalog does not list, and keeps the event", async () => {
    const recorder = recordingFetch();
    const session = cliSession({ fetch: recorder.fetch });
    // A property the types refuse, as plain JavaScript or a cast could pass it.
    const widened = {
      ...run,
      flags_count: 3,
      project_id: "1f2e",
    } as typeof run;
    session.capture("command_run", widened);
    await session.flush();
    const properties = (recorder.calls[0]?.body as Batch).batch[0]?.properties;
    expect(properties).toMatchObject({ command: "schema pull" });
    expect(properties).not.toHaveProperty("flags_count");
    expect(properties).not.toHaveProperty("project_id");
  });

  it("drops an optional property whose value is not allowed", async () => {
    const recorder = recordingFetch();
    const session = cliSession({ fetch: recorder.fetch });
    session.capture("command_run", {
      ...run,
      error_code: "could not connect to db at 10.0.0.4",
    });
    await session.flush();
    const properties = (recorder.calls[0]?.body as Batch).batch[0]?.properties;
    expect(properties).toMatchObject({ command: "schema pull" });
    expect(properties).not.toHaveProperty("error_code");
  });

  it("drops the whole event when a required value is not allowed", async () => {
    const recorder = recordingFetch();
    const session = cliSession({ fetch: recorder.fetch });
    session.capture("command_run", { ...run, command: "/home/me/app" });
    session.capture("command_run", run);
    await session.flush();
    const events = (recorder.calls[0]?.body as Batch).batch;
    expect(events.map(e => e.properties.command)).toEqual(["schema pull"]);
  });

  it("sends nothing at all when every event was dropped", async () => {
    const recorder = recordingFetch();
    const session = cliSession({ fetch: recorder.fetch });
    session.capture("command_run", { ...run, role: "prod" as "local" });
    await session.flush();
    expect(recorder.calls).toHaveLength(0);
  });

  it("sends the tools' events only under a machine id, and a site's only under a site id", async () => {
    const recorder = recordingFetch();
    // Each session given the other kind of random id.
    const cli = cliSession({ fetch: recorder.fetch, distinctId: SITE_ID });
    cli.capture("command_run", run);
    await cli.flush();
    const site = openSiteUsage({
      nextlyVersion: "1.2.3",
      siteId: MACHINE_ID,
      role: "local",
      switchOn: true,
      env: {},
      fetch: recorder.fetch,
    });
    site.capture("first_collection_created", {});
    await site.flush();
    expect(recorder.calls).toHaveLength(0);
  });

  it("sends a list as it was checked, whatever the caller does to it after", async () => {
    const recorder = recordingFetch();
    const session = openToolsUsage({
      source: "installer",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env: {},
      fetch: recorder.fetch,
    });
    const features: string[] = ["seo"];
    session.capture("install_step", {
      section: "features",
      features: features as "seo"[],
    });
    // Changed between capture and flush: a path, and a toJSON on the list.
    features[0] = "/home/someone/project";
    Object.defineProperty(features, "toJSON", {
      value: () => ["/home/someone/project"],
    });
    await session.flush();
    const sent = (recorder.calls[0]?.body as Batch).batch[0]?.properties;
    expect(sent?.features).toEqual(["seo"]);
  });

  it("refuses a list with a hole in it", async () => {
    const recorder = recordingFetch();
    const session = openToolsUsage({
      source: "installer",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env: {},
      fetch: recorder.fetch,
    });
    // ["seo", <hole>]: `every` would skip the hole, which JSON sends as null.
    const sparse: ("seo" | "forms")[] = ["seo"];
    sparse.length = 2;
    session.capture("install_step", { section: "features", features: sparse });
    await session.flush();
    const sent = (recorder.calls[0]?.body as Batch).batch[0]?.properties;
    expect(sent).toMatchObject({ section: "features" });
    expect(sent).not.toHaveProperty("features");
  });

  it("drops an agent's name beside a person's run", async () => {
    const recorder = recordingFetch();
    const site = openSiteUsage({
      nextlyVersion: "1.2.3",
      siteId: SITE_ID,
      role: "local",
      switchOn: true,
      env: {},
      fetch: recorder.fetch,
    });
    site.capture("admin_first_opened", {
      heard_from: "friend",
      run_by: "person",
      agent: "codex",
    });
    site.capture("admin_first_opened", {
      heard_from: "not_asked",
      run_by: "agent",
      agent: "codex",
    });
    await site.flush();
    const [person, agent] = (recorder.calls[0]?.body as Batch).batch;
    expect(person?.properties).toMatchObject({ run_by: "person" });
    expect(person?.properties).not.toHaveProperty("agent");
    expect(agent?.properties).toMatchObject({
      run_by: "agent",
      agent: "codex",
    });
  });

  it("sends nothing under an id that is not a random id", async () => {
    const recorder = recordingFetch();
    const session = cliSession({
      fetch: recorder.fetch,
      distinctId: "someone@example.com",
    });
    session.capture("command_run", run);
    await session.flush();
    expect(recorder.calls).toHaveLength(0);
  });
});

describe("the end of a run", () => {
  // Every way a message could reach the terminal. Inside a test worker the
  // console does not write through the two streams, so it is watched too.
  let outputs: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    outputs = [
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
      ...(["log", "info", "warn", "error", "debug"] as const).map(method =>
        vi.spyOn(console, method)
      ),
    ];
  });
  afterEach(() => {
    for (const spy of outputs) spy.mockRestore();
  });
  const expectSilence = () => {
    for (const spy of outputs) expect(spy).not.toHaveBeenCalled();
  };

  it("returns within 2 seconds from a receiver that never answers, saying nothing", async () => {
    const receiver: Receiver = await startReceiver({ silent: true });
    try {
      const session = cliSession({ endpoint: receiver.endpoint });
      session.capture("command_run", run);
      const started = performance.now();
      await session.flush();
      const elapsed = performance.now() - started;
      // The request did reach it: the wait was for an answer, not a connection.
      expect(receiver.bodies).toHaveLength(1);
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(elapsed).toBeLessThan(2400);
      expectSilence();
    } finally {
      await receiver.close();
    }
  }, 10_000);

  it("waits at most 2 seconds across all of a run's flushes", async () => {
    const receiver: Receiver = await startReceiver({ silent: true });
    try {
      const session = cliSession({ endpoint: receiver.endpoint });
      const started = performance.now();
      session.capture("command_run", run);
      await session.flush();
      session.capture("command_run", { ...run, exit_code: 0 });
      await session.flush();
      session.capture("command_run", { ...run, exit_code: 1 });
      await session.flush();
      expect(performance.now() - started).toBeLessThan(2400);
      // The first request reached the address; once it had used the run's
      // time without an answer, the later flushes sent nothing.
      expect(receiver.bodies).toHaveLength(1);
      expectSilence();
    } finally {
      await receiver.close();
    }
  }, 15_000);

  it("caps a longer budget at 2 seconds", async () => {
    const receiver: Receiver = await startReceiver({ silent: true });
    try {
      const session = cliSession({
        endpoint: receiver.endpoint,
        timeoutMs: 60_000,
      });
      session.capture("command_run", run);
      const started = performance.now();
      await session.flush();
      expect(performance.now() - started).toBeLessThan(2400);
    } finally {
      await receiver.close();
    }
  }, 10_000);

  it("returns at once, saying nothing, when nothing listens at the address", async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>(resolve => closed.close(() => resolve()));

    const session = cliSession({ endpoint: `http://127.0.0.1:${port}/` });
    session.capture("command_run", run);
    const started = performance.now();
    await expect(session.flush()).resolves.toBeUndefined();
    expect(performance.now() - started).toBeLessThan(2000);
    expectSilence();
  });

  it("returns, saying nothing, with no network at all", async () => {
    const offline = vi.fn(() =>
      Promise.reject(new TypeError("fetch failed: getaddrinfo ENOTFOUND"))
    );
    const session = cliSession({ fetch: offline as unknown as typeof fetch });
    session.capture("command_run", run);
    await expect(session.flush()).resolves.toBeUndefined();
    expect(offline).toHaveBeenCalledTimes(1);
    expectSilence();
  });

  it("returns, saying nothing, when fetch throws before it starts", async () => {
    const broken = vi.fn(() => {
      throw new Error("no fetch here");
    });
    const session = cliSession({ fetch: broken as unknown as typeof fetch });
    session.capture("command_run", run);
    await expect(session.flush()).resolves.toBeUndefined();
    expect(broken).toHaveBeenCalledTimes(1);
    expectSilence();
  });
});
