/**
 * The one namer of the people an event keeps by id: a takeover's displaced
 * holder and the person an overwrite replaced, named by one lookup, and
 * nothing else named or changed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { peopleById } = vi.hoisted(() => ({ peopleById: vi.fn() }));
vi.mock("../../versions/author-hydration", () => ({ peopleById }));

import { nameEventPeople } from "../named-event-people";

const takeover = (fromId: string) => ({
  kind: "taken-over",
  payload: { fromId },
});
const overwrite = (replaced: Record<string, unknown> | null) => ({
  kind: "overwritten",
  payload: { given: replaced ? "stale" : "none", replaced },
});

beforeEach(() => {
  peopleById.mockReset();
  peopleById.mockResolvedValue(
    new Map([
      ["u-ana", { kind: "person", id: "u-ana", name: "Ana" }],
      ["u-ben", { kind: "person", id: "u-ben", name: "Ben" }],
      ["u-noname", { kind: "person", id: "u-noname", name: null }],
    ])
  );
});

describe("naming the people events keep by id", () => {
  it("names a takeover's holder and an overwrite's replaced person in one lookup", async () => {
    const named = await nameEventPeople([
      takeover("u-ana"),
      overwrite({ kind: "person", id: "u-ben", principalKind: null }),
    ]);

    expect(named[0].payload).toMatchObject({
      fromId: "u-ana",
      fromName: "Ana",
    });
    expect(named[1].payload).toMatchObject({ replacedName: "Ben" });
    expect(peopleById).toHaveBeenCalledTimes(1);
    expect(peopleById).toHaveBeenCalledWith(["u-ana", "u-ben"]);
  });

  it("names nobody for a person with no name or no account any more", async () => {
    const [noName, gone] = await nameEventPeople([
      overwrite({ kind: "person", id: "u-noname", principalKind: null }),
      overwrite({ kind: "person", id: "u-gone", principalKind: null }),
    ]);

    expect(noName.payload).toMatchObject({ replacedName: null });
    expect(gone.payload).toMatchObject({ replacedName: null });
  });

  it("looks up no one for an overwrite that replaced a key, a member or nobody", async () => {
    const events = [
      overwrite({ kind: "apiKey", id: "k1", principalKind: null }),
      overwrite({ kind: "principal", id: null, principalKind: "customer" }),
      overwrite(null),
      { kind: "saved", payload: null },
    ];

    const named = await nameEventPeople(events);

    // A key's id is not a person's: looking it up could name a user who
    // happens to share it.
    expect(peopleById).not.toHaveBeenCalled();
    expect(named).toEqual(events);
  });
});
