import { describe, expect, it } from "vitest";

import { passwordPacer } from "./pacer";

/** A clock whose time moves only when a check runs, and that records each wait. */
function fakeClock() {
  let now = 0;
  const waits: number[] = [];
  return {
    clock: { now: () => now, sleep: async (ms: number) => void waits.push(ms) },
    advance: (ms: number) => void (now += ms),
    waits,
  };
}

describe("passwordPacer", () => {
  it("waits as long as the checks it has timed, without checking", async () => {
    const { clock, advance, waits } = fakeClock();
    let checks = 0;
    const pacer = passwordPacer(
      {
        verify: async () => {
          checks += 1;
          advance(100);
          return false;
        },
      },
      clock
    );

    await pacer.prime();
    await pacer.waitAsLongAsACheck();
    expect(waits).toEqual([100]);
    expect(checks).toBe(1);
  });

  it("follows the checks' time as it changes", async () => {
    const { clock, advance } = fakeClock();
    let cost = 100;
    const pacer = passwordPacer(
      {
        verify: async () => {
          advance(cost);
          return true;
        },
      },
      clock
    );

    expect(await pacer.verify("p", "h")).toBe(true);
    cost = 200;
    await pacer.verify("p", "h");
    expect(pacer.estimateMs()).toBe(120);
  });
});
