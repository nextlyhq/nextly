/**
 * A settings update made through `nextly.workflows.settings.update` passes on as the change only
 * what is not an option of the call: every option a call takes is left out, so none can reach
 * the change, which refuses a key it does not know.
 *
 * The plausible broken implementation keeps its own list of the options, which misses one the
 * call's type gains.
 */
import { describe, expect, it } from "vitest";

import { settingsChangeOf, type WorkflowCallArgs } from "../workflows";

/** Every option of a call, by name: the type requires each key, and no other. */
const EVERY_CALL_OPTION = {
  overrideAccess: true,
  trusted: true,
  enforceFieldAccess: true,
  fieldAccessUser: true,
  user: true,
  actor: true,
  req: true,
  context: true,
  request: true,
  showHiddenFields: true,
  disableErrors: true,
  disableTransaction: true,
  depth: true,
  richTextFormat: true,
  richTextStyles: true,
  overrideLock: true,
  forms: true,
  locale: true,
  fallbackLocale: true,
  principal: true,
  apiKeyId: true,
} as const satisfies Record<keyof WorkflowCallArgs, true>;

describe("a workflow settings update's change", () => {
  const change = {
    slug: "editorial",
    revision: 3,
    emails: { approved: false },
  };

  it.each(Object.keys(EVERY_CALL_OPTION))(
    "leaves out the call option %s",
    option => {
      expect(settingsChangeOf({ ...change, [option]: "set" })).toEqual(change);
    }
  );

  it("keeps every part of the change, which is the control", () => {
    expect(settingsChangeOf(change)).toEqual(change);
  });
});
