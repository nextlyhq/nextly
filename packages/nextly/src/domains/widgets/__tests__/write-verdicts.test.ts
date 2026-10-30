/**
 * The write decisions the dashboard's cards offer actions by: whether a reader
 * may create in a collection, and whether they may update a Single. Each asks
 * the gate a real write is judged by (`callerMayPerform`), for its own action
 * and slug, so a card never offers what the write would refuse.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callerMayPerform } = vi.hoisted(() => ({
  callerMayPerform:
    vi.fn<
      (
        scope: unknown,
        action: string,
        resource: string,
        user: unknown
      ) => Promise<boolean>
    >(),
}));
vi.mock("../../../auth/access/route-gate-adapters", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/access/route-gate-adapters")
  >()),
  callerMayPerform,
}));

import { createVerdict, updateVerdict } from "../reader-content";

const user = { id: "reader-1", roles: ["editor"] };

beforeEach(() => {
  vi.clearAllMocks();
  // A reader who may update "home" and nothing else.
  callerMayPerform.mockImplementation((_scope, action, resource) =>
    Promise.resolve(action === "update" && resource === "home")
  );
});

describe("the write decisions behind a card's actions", () => {
  it("asks the write's own gate whether the reader may update a Single", async () => {
    const mayUpdate = updateVerdict({ user });

    expect(await mayUpdate("home")).toBe(true);
    // 🔴 Readable is not updatable: the gate says no, and so does the verdict.
    expect(await mayUpdate("about")).toBe(false);
    expect(callerMayPerform).toHaveBeenCalledWith(
      undefined,
      "update",
      "about",
      user
    );
  });

  it("asks for creating, not updating, when deciding create", async () => {
    // The control: the same reader may not create in "home", so a verdict
    // that asked the wrong action would answer yes.
    expect(await createVerdict({ user })("home")).toBe(false);
    expect(callerMayPerform).toHaveBeenCalledWith(
      undefined,
      "create",
      "home",
      user
    );
  });
});
