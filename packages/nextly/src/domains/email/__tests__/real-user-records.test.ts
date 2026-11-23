/**
 * Core's real user for its emails to a person: a user that is gone answers
 * null, which the route answers as not found; any other failure is the
 * server's, and is never answered as a gone record.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors";

const findById = vi.hoisted(() => vi.fn());

vi.mock("../../../di/service-access", () => ({
  getService: () => ({ findById }),
}));

import { realUserRecords } from "../real-user-records";

afterEach(() => findById.mockReset());

describe("core's real user", () => {
  it("fills the name and address of the user it loads", async () => {
    findById.mockResolvedValue({ id: "u-1", name: "Ada", email: "a@x.test" });
    await expect(realUserRecords.load("u-1")).resolves.toEqual({
      userName: "Ada",
      userEmail: "a@x.test",
    });
  });

  it("answers null for a user that is gone, or an id no user can have", async () => {
    findById.mockRejectedValueOnce(NextlyError.notFound());
    await expect(realUserRecords.load("gone")).resolves.toBeNull();
    findById.mockRejectedValueOnce(
      NextlyError.validation({
        errors: [{ path: "userId", code: "INVALID", message: "Not an id." }],
      })
    );
    await expect(realUserRecords.load("not-an-id")).resolves.toBeNull();
  });

  it("lets any other failure through, rather than calling the user gone", async () => {
    const outage = new Error("connection refused");
    findById.mockRejectedValue(outage);
    await expect(realUserRecords.load("u-1")).rejects.toBe(outage);
  });
});
