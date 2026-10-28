/**
 * The default expiry hand-off keeps what a request could not expire, once per
 * tag, until an out-of-request path drains it, and never grows without bound.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  expiryHandoff,
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
