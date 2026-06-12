import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

beforeEach(() => {
  // form-builder's init guards against duplicate hook registration in dev mode
  // via a globalThis flag; clear it so each boot re-registers the hook.
  delete (globalThis as Record<string, unknown>)[
    "__formBuilder_afterCreate_form-submissions"
  ];
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("form-builder on the reshaped PluginContext (R4 / D46)", () => {
  it("boots via createTestNextly and registers its afterCreate hook (uses ctx.logger)", async () => {
    const { plugin } = formBuilder();

    // init() reads ctx.logger and ctx.hooks — booting without throwing proves
    // the plugin works against the P1-reshaped context.
    current = await createTestNextly({ plugins: [plugin] });

    expect(current.hooks.hasHooks("afterCreate", "form-submissions")).toBe(
      true
    );
  });
});
