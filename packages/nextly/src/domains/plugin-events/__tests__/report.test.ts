/**
 * The stuck-subscriber warnings, without a database: one read a pass however
 * many subscribers are stuck, and a held delivery whose subscriber is
 * registered again left out.
 *
 * @module domains/plugin-events/__tests__/report.test
 */
import { describe, expect, it, vi } from "vitest";

import { createStuckWarnings } from "../report";

/** The distinct (subscriber, status) pairs a read hands back. */
function stuckRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    subscriber: `@acme/s${i}:handler`,
    subscriberKey: `key-${i}`,
    status: i % 2 === 0 ? "held" : "failed",
  }));
}

describe("createStuckWarnings", () => {
  it("reads once a pass, however many subscribers are stuck", async () => {
    const select = vi.fn(async () => stuckRows(50));
    const count = vi.fn(async () => 0);
    const warn = vi.fn();
    await createStuckWarnings({ warn }).check(
      { select, count } as never,
      new Date(0),
      () => false
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(50);
  });

  it("leaves out a held delivery whose subscriber is registered again", async () => {
    const select = vi.fn(async () => [
      { subscriber: "@acme/back:award", subscriberKey: "k-back", status: "held" },
      {
        subscriber: "@acme/back:award",
        subscriberKey: "k-back",
        status: "failed",
      },
      { subscriber: "@acme/gone:award", subscriberKey: "k-gone", status: "held" },
    ]);
    const warned: string[] = [];
    await createStuckWarnings({
      warn: message => {
        warned.push(message);
      },
    }).check(
      { select } as never,
      new Date(0),
      subscriber => subscriber === "@acme/back:award"
    );
    // The returned subscriber is warned about for what ran out of attempts,
    // not for being away; the one still gone for being away.
    expect(warned).toHaveLength(2);
    const back = warned.find(line => line.includes('"@acme/back:award"'));
    expect(back).toContain("ran out of attempts");
    expect(back).not.toContain("not registered");
    const gone = warned.find(line => line.includes('"@acme/gone:award"'));
    expect(gone).toContain("not registered");
  });
});
