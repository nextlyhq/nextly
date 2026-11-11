/**
 * The durable subscribers registered in this process: each named, within its
 * plugin, by a name that stays the same across restarts, so a delivery owed
 * to it reaches it again whatever else was added or reordered.
 *
 * @module domains/plugin-events/__tests__/subscribers.test
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  createDurableSubscribers,
  DURABLE_SUBSCRIBER_GRACE_MS,
} from "../subscribers";

const noop = () => undefined;

describe("durable subscribers", () => {
  it("keys a subscriber by its plugin and name, and lists an event's subscribers in order", () => {
    const subscribers = createDurableSubscribers();
    const award = () => "award";
    const receipt = () => "receipt";
    subscribers.register("@acme/loyalty", "acme-orders.paid", "award", award);
    subscribers.register("@acme/email", "acme-orders.paid", "receipt", receipt);
    subscribers.register("@acme/email", "acme-orders.refunded", "notice", noop);

    expect(
      subscribers.forEvent("acme-orders.paid").map(entry => entry.key)
    ).toEqual(["@acme/loyalty:award", "@acme/email:receipt"]);
    expect(subscribers.handlerOf("@acme/email:receipt")).toBe(receipt);
    expect(subscribers.handlerOf("@acme/email:gone")).toBeUndefined();
    expect(subscribers.forEvent("acme-orders.shipped")).toEqual([]);
  });

  it("refuses a malformed name, and a name the plugin already uses", () => {
    const subscribers = createDurableSubscribers();
    subscribers.register("@acme/email", "acme-orders.paid", "receipt", noop);
    for (const name of ["", "Receipt", "has space", "a:b", "x".repeat(65)]) {
      expect(() =>
        subscribers.register("@acme/email", "acme-orders.paid", name, noop)
      ).toThrow(NextlyError);
    }
    // Unique within the plugin, whichever event: the name is what a pending
    // delivery is owed to.
    expect(() =>
      subscribers.register(
        "@acme/email",
        "acme-orders.refunded",
        "receipt",
        noop
      )
    ).toThrow(NextlyError);
    // Another plugin may use the same name: it is another subscriber.
    expect(() =>
      subscribers.register("@acme/loyalty", "acme-orders.paid", "receipt", noop)
    ).not.toThrow();
  });

  it("drops a plugin's subscribers when it is torn down, keeping the others", () => {
    const subscribers = createDurableSubscribers();
    subscribers.register("@acme/loyalty", "acme-orders.paid", "award", noop);
    subscribers.register("@acme/email", "acme-orders.paid", "receipt", noop);
    subscribers.removeOwner("@acme/email");
    expect(
      subscribers.forEvent("acme-orders.paid").map(entry => entry.key)
    ).toEqual(["@acme/loyalty:award"]);
    expect(subscribers.handlerOf("@acme/email:receipt")).toBeUndefined();
    // Once torn down, its names are free again, as on a reload.
    expect(() =>
      subscribers.register("@acme/email", "acme-orders.paid", "receipt", noop)
    ).not.toThrow();
  });

  it("keeps a torn-down plugin's subscribers owed, without running them, until they register again or the grace ends", () => {
    let clock = 0;
    const subscribers = createDurableSubscribers({ now: () => clock });
    subscribers.register("@acme/loyalty", "acme-orders.paid", "award", noop);
    subscribers.register("@acme/email", "acme-orders.paid", "receipt", noop);
    subscribers.register("@acme/email", "acme-orders.paid", "notice", noop);
    const keys = () =>
      subscribers.forEvent("acme-orders.paid").map(entry => entry.key);

    // Torn down for a re-registration: an event dispatched before the plugin
    // registers again still owes its subscribers, or it would be finished
    // without them for good. Their handlers are gone, so nothing runs them.
    subscribers.retireOwner("@acme/email");
    expect(keys()).toEqual([
      "@acme/loyalty:award",
      "@acme/email:receipt",
      "@acme/email:notice",
    ]);
    expect(subscribers.handlerOf("@acme/email:receipt")).toBeUndefined();
    expect(subscribers.isRetired("@acme/email:receipt")).toBe(true);
    expect(subscribers.isRetired("@acme/loyalty:award")).toBe(false);
    expect(subscribers.isRetired("@acme/email:gone")).toBe(false);

    // Registered again under the same name: the new handler is the one.
    const receipt = () => "receipt";
    subscribers.register("@acme/email", "acme-orders.paid", "receipt", receipt);
    expect(subscribers.handlerOf("@acme/email:receipt")).toBe(receipt);
    expect(() =>
      subscribers.register("@acme/email", "acme-orders.paid", "receipt", noop)
    ).toThrow(NextlyError);

    // One never registered again is owed no new event once the grace ends.
    clock += DURABLE_SUBSCRIBER_GRACE_MS - 1;
    expect(keys()).toContain("@acme/email:notice");
    clock += 1;
    expect(keys()).toEqual(["@acme/loyalty:award", "@acme/email:receipt"]);
    expect(subscribers.isRetired("@acme/email:notice")).toBe(false);
  });
});
