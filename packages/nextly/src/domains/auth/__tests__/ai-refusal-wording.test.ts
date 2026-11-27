/**
 * What a person reads when one of the three AI permissions refuses them: a
 * plain sentence naming what they can't do, worded as every other refusal
 * is, from the action and the resource's name.
 */
import { describe, expect, it } from "vitest";

import { refusalMessageFor } from "../../../auth/access/refusal-message";
import { AI_PERMISSIONS } from "../../ai/ai-contract";

describe("the AI permissions' refusals", () => {
  it.each([
    [AI_PERMISSIONS.use, "You can't use AI."],
    [AI_PERMISSIONS.bulk, "You can't run bulk AI jobs."],
    [AI_PERMISSIONS.manage, "You can't manage AI settings."],
  ])("%o reads %j", async ({ action, resource }, words) => {
    await expect(refusalMessageFor(action, resource)).resolves.toBe(words);
  });
});
