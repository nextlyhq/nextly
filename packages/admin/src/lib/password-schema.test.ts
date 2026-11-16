import { describe, expect, it, vi } from "vitest";

// Held open so the test can read the rule before the list has arrived.
const list = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>(resolve => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock("../../../nextly/src/plugins/security/common-passwords", async () => {
  await list.arrived;
  return { COMMON_PASSWORDS: ["correcthorse"] };
});

import { passwordSchema } from "./password-schema";

describe("the common-password rule while its list is on the way", () => {
  it("checks the other rules until the list arrives, then the list as well", async () => {
    // The list has not arrived, so only the rules that need nothing fetched
    // can fail: the server still refuses a listed password on the write.
    expect(passwordSchema.safeParse("correcthorse").success).toBe(true);
    expect(passwordSchema.safeParse("short").success).toBe(false);

    list.release();
    await vi.dynamicImportSettled();

    const verdict = passwordSchema.safeParse("CorrectHorse");
    expect(verdict.success).toBe(false);
    expect(verdict.error?.issues.map(issue => issue.message)).toEqual([
      "This password is too common.",
    ]);
    expect(passwordSchema.safeParse("correctbattery").success).toBe(true);
  });
});
