import { describe, expect, it } from "vitest";

import {
  issueHookExemptRead,
  readHooksWaived,
  type HookExemptRead,
} from "./hook-exempt-read";

describe("a hook-exempt read grant", () => {
  it("waives the hooks of exactly the collections it was issued for", () => {
    const grant = issueHookExemptRead(["ledger", "cursor"]);
    expect(readHooksWaived(grant, "ledger")).toBe(true);
    expect(readHooksWaived(grant, "cursor")).toBe(true);
    // A grant that reaches a read of another collection waives nothing there.
    expect(readHooksWaived(grant, "posts")).toBe(false);
  });

  it("is not forged by an object of the same shape", () => {
    // App code can build a context by hand; copying the shape must not work.
    const forged = { grant: "hook-exempt-read" } as HookExemptRead;
    issueHookExemptRead(["ledger"]);
    expect(readHooksWaived(forged, "ledger")).toBe(false);
  });

  it("waives nothing without a grant, or with one covering nothing", () => {
    expect(readHooksWaived(undefined, "ledger")).toBe(false);
    expect(readHooksWaived(issueHookExemptRead([]), "ledger")).toBe(false);
  });

  it("does not let one plugin's grant cover another's collections", () => {
    const mine = issueHookExemptRead(["mine"]);
    const theirs = issueHookExemptRead(["theirs"]);
    expect(readHooksWaived(mine, "theirs")).toBe(false);
    expect(readHooksWaived(theirs, "mine")).toBe(false);
  });
});
