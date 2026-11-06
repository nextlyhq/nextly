/**
 * The default expiry hand-off keeps what a request could not expire, once per
 * tag, until an out-of-request path drains it, and never grows without bound.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  expiryHandoff,
  isPendingExpiryHandoff,
  PendingExpiryHandoff,
  setExpiryHandoff,
  takePendingExpiries,
} from "../expiry-handoff";

afterEach(() => setExpiryHandoff(null));

describe("the default expiry hand-off", () => {
  it("keeps each handed-off tag once, and gives them up when drained", () => {
    expiryHandoff().handOff(["nextly:posts", "nextly:posts:id:1"], "down");
    expiryHandoff().handOff(["nextly:posts"], "down");

    expect(takePendingExpiries().sort()).toEqual([
      "nextly:posts",
      "nextly:posts:id:1",
    ]);
    expect(takePendingExpiries()).toEqual([]);
  });

  it("stops keeping tags past its bound", () => {
    const handoff = new PendingExpiryHandoff();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    handoff.handOff(
      Array.from({ length: 10_001 }, (_, i) => `t${i}`),
      "down"
    );

    expect(handoff.take()).toHaveLength(10_000);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("is replaced by an installed out-of-request path, and restored by null", () => {
    const installed = { handOff: vi.fn() };
    setExpiryHandoff(installed);
    expiryHandoff().handOff(["nextly:posts"], "down");

    expect(installed.handOff).toHaveBeenCalledWith(["nextly:posts"], "down");
    expect(takePendingExpiries()).toEqual([]);

    setExpiryHandoff(null);
    expect(expiryHandoff()).toBeInstanceOf(PendingExpiryHandoff);
  });
});

/*
 * A bundled or hot-reloaded copy of this module has its own class, so the
 * default it installs is not an instance of this copy's. It is recognised by
 * its brand, so a flush through either copy drains what it holds.
 */
describe("the default hand-off across module copies", () => {
  it("drains a default another copy of the module installed", () => {
    const fromAnotherCopy = {
      [Symbol.for("nextly/PendingExpiryHandoff")]: true,
      held: ["nextly:posts:id:9"],
      handOff(tags: string[]) {
        this.held.push(...tags);
      },
      take() {
        const tags = this.held;
        this.held = [];
        return tags;
      },
    };
    setExpiryHandoff(fromAnotherCopy);

    expect(isPendingExpiryHandoff(fromAnotherCopy)).toBe(true);
    expect(fromAnotherCopy instanceof PendingExpiryHandoff).toBe(false);
    expect(takePendingExpiries()).toEqual(["nextly:posts:id:9"]);
  });

  it("does not take an installed hand-off that only looks like one", () => {
    const installed = { handOff: () => undefined, take: () => ["leaked"] };
    setExpiryHandoff(installed);
    expect(isPendingExpiryHandoff(installed)).toBe(false);
    expect(takePendingExpiries()).toEqual([]);
  });
});
