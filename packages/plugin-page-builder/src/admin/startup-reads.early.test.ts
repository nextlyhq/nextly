/**
 * The builder's start-up read sent as the admin loads, at an address that
 * opens the builder, before anyone asks: nothing is handed out until the
 * first editor to open with the same reads claims it as its person's, and
 * that editor then sends nothing of its own. An editor asking other reads,
 * or opening after the answer's moment, sends its own; and a person signing
 * out drops it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: vi.fn(),
}));

import {
  forgetStartedReads,
  readStarted,
  STARTED_READ_HANDOFF_MS,
  startBuilderReads,
  startEarlyBuilderReads,
  type AskStartup,
} from "./startup-reads";

afterEach(() => forgetStartedReads());

function startup(answers: Record<string, { status: number; body?: unknown }>) {
  let sent = 0;
  const ask: AskStartup = async () => {
    sent += 1;
    return answers;
  };
  return { ask, sent: () => sent };
}

const route = (body: unknown) => vi.fn(async () => body);

describe("the builder's start-up read, sent as the admin loads", () => {
  it("is claimed by the first editor with the same reads, which sends nothing", async () => {
    const early = startup({ "/site/style": { status: 200, body: { a: 1 } } });
    const own = startup({ "/site/style": { status: 200, body: { a: 2 } } });
    startEarlyBuilderReads(["/site/style"], early.ask);
    startBuilderReads("ada", ["/site/style"], own.ask);
    const style = route({ a: 3 });

    expect(await readStarted("/site/style", style, "ada")).toEqual({ a: 1 });
    expect(early.sent()).toBe(1);
    expect(own.sent()).toBe(0);
    expect(style).not.toHaveBeenCalled();
  });

  it("hands nothing out before an editor claims it", async () => {
    const early = startup({ "/site/style": { status: 200, body: { a: 1 } } });
    startEarlyBuilderReads(["/site/style"], early.ask);
    const style = route({ a: 3 });

    expect(await readStarted("/site/style", style)).toEqual({ a: 3 });
    expect(await readStarted("/site/style", style, "ada")).toEqual({ a: 3 });
    expect(style).toHaveBeenCalledTimes(2);
  });

  it("is not claimed by an editor asking other reads, which sends its own", async () => {
    const early = startup({ "/site/style": { status: 200, body: { a: 1 } } });
    const own = startup({
      "/site/style?locale=es": { status: 200, body: { a: 2 } },
    });
    startEarlyBuilderReads(["/site/style"], early.ask);
    startBuilderReads("ada", ["/site/style?locale=es"], own.ask);

    expect(own.sent()).toBe(1);
    expect(
      await readStarted("/site/style?locale=es", route({ a: 3 }), "ada")
    ).toEqual({ a: 2 });
  });

  it("is not claimed once its moment has passed", async () => {
    let clock = 1_000;
    const now = () => clock;
    const early = startup({ "/site/style": { status: 200, body: { a: 1 } } });
    const own = startup({ "/site/style": { status: 200, body: { a: 2 } } });
    startEarlyBuilderReads(["/site/style"], early.ask, now);
    await Promise.resolve();
    await Promise.resolve();
    clock += STARTED_READ_HANDOFF_MS + 1;
    startBuilderReads("ada", ["/site/style"], own.ask, now);

    expect(own.sent()).toBe(1);
  });

  it("is dropped when nobody is signed in", async () => {
    const early = startup({ "/site/style": { status: 200, body: { a: 1 } } });
    startEarlyBuilderReads(["/site/style"], early.ask);
    startBuilderReads(null, ["/site/style"], early.ask);
    const own = startup({ "/site/style": { status: 200, body: { a: 2 } } });
    startBuilderReads("ada", ["/site/style"], own.ask);

    expect(own.sent()).toBe(1);
  });

  it("is sent once however often the admin asks", () => {
    const early = startup({});
    startEarlyBuilderReads(["/site/style"], early.ask);
    startEarlyBuilderReads(["/site/style"], early.ask);
    expect(early.sent()).toBe(1);
  });
});
