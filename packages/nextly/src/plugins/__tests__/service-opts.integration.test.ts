/**
 * D35 Unit C wiring — `ctx.services.collections` is ServiceOpts-wrapped.
 *
 * Proven via the `as:'user'`-with-no-user rejection, which the wrapper raises
 * BEFORE any create — so it doesn't depend on the harness create path (which has
 * an unrelated hook-wiring gap). If `ctx.services.collections` were the raw
 * facade, `{ as: 'user' }` would be treated as a RequestContext and would not
 * reject with INVALID_INPUT.
 */
import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../../plugins";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("ctx.services.collections ServiceOpts wiring (D35)", () => {
  it("as:'user' with no user rejects via the wrapper", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let services: any;
    const probe = definePlugin({
      name: "@acme/probe",
      version: "1.0.0",
      nextly: ">=0.0.1",
      init: ctx => {
        services = ctx.services;
      },
    });
    current = await createTestNextly({ plugins: [probe] });
    await expect(
      services.collections.createEntry("any", { x: 1 }, { as: "user" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
