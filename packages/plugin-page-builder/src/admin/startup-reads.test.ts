/**
 * The builder's start-up read on the editor's side: a read's first ask as
 * the builder opens takes its start-up answer and sends nothing, and every
 * other ask (a second one, one for another person, one long after, one the
 * start-up read could not answer) asks its route.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: vi.fn(),
}));

import {
  forgetStartedReads,
  holdStartedReads,
  readStarted,
  STARTED_READ_HANDOFF_MS,
  startBuilderReads,
  type AskStartup,
} from "./startup-reads";

afterEach(() => forgetStartedReads());

/** A start-up request answering `reads`, counted. */
function startup(answers: Record<string, { status: number; body?: unknown }>): {
  ask: AskStartup;
  sent: () => number;
} {
  let sent = 0;
  return {
    ask: async () => {
      sent += 1;
      return answers;
    },
    sent: () => sent,
  };
}

/** A route read, counted. */
function route(body: unknown) {
  return vi.fn(async () => body);
}

describe("the builder's start-up read, in the editor", () => {
  it("hands each read its answer once, and sends nothing for it", async () => {
    const { ask, sent } = startup({
      "/site/style": { status: 200, body: { sections: 1 } },
      "/capability": { status: 200, body: { mayCreate: true } },
    });
    startBuilderReads("ada", ["/site/style", "/capability"], ask);
    const style = route({ sections: 2 });
    const capability = route({ mayCreate: false });

    expect(await readStarted("/site/style", style, "ada")).toEqual({
      sections: 1,
    });
    expect(await readStarted("/capability", capability, "ada")).toEqual({
      mayCreate: true,
    });
    expect(style).not.toHaveBeenCalled();
    expect(capability).not.toHaveBeenCalled();
    expect(sent()).toBe(1);

    // Asked again (a refetch, a later mount): its route, as always.
    expect(await readStarted("/site/style", style, "ada")).toEqual({
      sections: 2,
    });
    expect(style).toHaveBeenCalledTimes(1);
  });

  it("hands the answer to the next ask when the ask that took it was given up", async () => {
    const { ask } = startup({
      "/site/style": { status: 200, body: { sections: 1 } },
    });
    startBuilderReads("ada", ["/site/style"], ask);
    const style = route({ sections: 2 });
    // A read its cache gave up as it began (a mount undone at once).
    const gaveUp = new AbortController();
    const first = readStarted(
      "/site/style",
      style,
      undefined,
      Date.now,
      gaveUp.signal
    );
    gaveUp.abort();
    await first;
    expect(await readStarted("/site/style", style)).toEqual({ sections: 1 });
    expect(style).not.toHaveBeenCalled();
  });

  it("sends one start-up request however often the editor renders as it opens", () => {
    const { ask, sent } = startup({});
    startBuilderReads("ada", ["/a", "/b"], ask);
    startBuilderReads("ada", ["/b", "/a"], ask);
    expect(sent()).toBe(1);
  });

  it("never hands one person's answer to another", async () => {
    const { ask } = startup({ "/capability": { status: 200, body: "ada's" } });
    startBuilderReads("ada", ["/capability"], ask);
    const read = route("grace's");
    expect(await readStarted("/capability", read, "grace")).toBe("grace's");
    expect(await readStarted("/capability", read, null)).toBe("grace's");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("starts nothing for a person nobody knows, and drops what was read for anyone", async () => {
    const { ask, sent } = startup({
      "/capability": { status: 200, body: "ada's" },
    });
    startBuilderReads("ada", ["/capability"], ask);
    startBuilderReads(null, ["/capability"], ask);
    expect(sent()).toBe(1);
    const read = route("the route's");
    expect(await readStarted("/capability", read)).toBe("the route's");
  });

  it("asks a read's route when the start-up read refused it, failed on it, or failed", async () => {
    const { ask } = startup({
      "/layouts/choices": { status: 403 },
      "/named-queries": { status: 500 },
    });
    startBuilderReads("ada", ["/layouts/choices", "/named-queries"], ask);
    const choices = route("from the route");
    const queries = route("from the route");
    expect(await readStarted("/layouts/choices", choices, "ada")).toBe(
      "from the route"
    );
    expect(await readStarted("/named-queries", queries, "ada")).toBe(
      "from the route"
    );

    forgetStartedReads();
    startBuilderReads("ada", ["/site/style"], async () => {
      throw new Error("offline");
    });
    const style = route("from the route");
    expect(await readStarted("/site/style", style, "ada")).toBe(
      "from the route"
    );
    expect(style).toHaveBeenCalledTimes(1);
  });

  it("asks a read's route when it was not one of the start-up reads", async () => {
    const { ask } = startup({
      "/library/components": { status: 200, body: 1 },
    });
    startBuilderReads("ada", ["/library/components"], ask);
    const french = route(2);
    expect(
      await readStarted("/library/components?locale=fr", french, "ada")
    ).toBe(2);
  });

  it("hands nothing to a first ask made long after the builder opened", async () => {
    let clock = 1_000;
    const now = () => clock;
    const { ask } = startup({
      "/capability": { status: 200, body: "opening" },
    });
    startBuilderReads("ada", ["/capability"], ask, now);
    // Settled: the answer arrived at 1000.
    await readStarted("/other", async () => undefined, "ada", now);
    await Promise.resolve();
    clock += STARTED_READ_HANDOFF_MS + 1;
    const read = route("now");
    expect(await readStarted("/capability", read, "ada", now)).toBe("now");
  });

  it("starts again for a new opening once the last one handed its answers out", async () => {
    let clock = 0;
    const now = () => clock;
    const { ask, sent } = startup({});
    startBuilderReads("ada", ["/capability"], ask, now);
    await Promise.resolve();
    await Promise.resolve();
    clock += STARTED_READ_HANDOFF_MS + 1;
    startBuilderReads("ada", ["/capability"], ask, now);
    expect(sent()).toBe(2);
  });

  it("drops what it read once the last editor that sent it closes", async () => {
    vi.useFakeTimers();
    try {
      const { ask } = startup({ "/capability": { status: 200, body: "kept" } });
      const first = holdStartedReads();
      startBuilderReads("ada", ["/capability"], ask);
      // Undone and done again at once, as a development build mounts.
      first();
      const second = holdStartedReads();
      await vi.runAllTimersAsync();
      expect(await readStarted("/capability", route("route"), "ada")).toBe(
        "kept"
      );
      startBuilderReads("ada", ["/site/style"], startup({}).ask);
      second();
      await vi.runAllTimersAsync();
      const read = route("route");
      expect(await readStarted("/site/style", read, "ada")).toBe("route");
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
