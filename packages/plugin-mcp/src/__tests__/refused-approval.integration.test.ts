/**
 * An agent cannot approve, on every configured dialect, even with a key holding every grant an
 * approval needs.
 *
 * The part stands in Legal check, whose primary step (`clear`) approves and needs `sign-off`; the
 * key holds read, update and sign-off. So nothing about the key refuses the approval: what does is
 * that no tool offers one, and that the one tool that writes takes only a submit.
 *
 * The plausible broken server: one that registers a step-taking tool beside the reads, and a
 * submit that hands any named step to the service's general step-taking, which a key holding
 * `sign-off` would then pass for a move.
 */
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  bearer,
  bootReview,
  callTool,
  dataOf,
  draft,
  keyGranting,
  refusalOf,
  trustedPart,
  trustedSeen,
  trustedSend,
  type Handlers,
  type PartState,
} from "./helpers";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())("no tool approves (%s)", dialect => {
  let handle: TestNextly;
  let handlers: Handlers;

  /** A post whose English part stands in Legal check, and a key holding every grant. */
  async function inLegal() {
    const booted = await bootReview(dialect);
    current = booted.handle;
    handle = booted.handle;
    handlers = booted.handlers;
    const post = await draft(handle, "posts");
    await trustedSend(handle, post, ["en"]);
    const { key } = await keyGranting(handle, "signer", [
      "read-posts",
      "update-posts",
      "sign-off-posts",
    ]);
    const before = await trustedPart(handle, post, "en");
    expect(before?.stage).toBe("legal");
    return { post, headers: bearer(key), before };
  }

  it("(a) has no tool that approves, requests changes, takes a step or publishes", async () => {
    const { headers } = await inLegal();

    for (const name of [
      "approve",
      "take_workflow_step",
      "request_changes",
      "publish",
    ]) {
      const body = await callTool(handlers, headers, name, {});
      expect(body.error, name).toEqual({
        code: -32602,
        message: `Tool ${name} not found`,
      });
    }
  });

  it("(b) refuses an approval named to submit_for_review, and a move, moving nothing", async () => {
    const { post, headers, before } = await inLegal();
    const seen = await trustedSeen(handle, post, ["en"]);

    const asSubmit = (step: string) =>
      callTool(handlers, headers, "submit_for_review", {
        document: post,
        parts: ["en"],
        seen,
        comment: "x",
        step,
      });
    // `clear` approves; `park` is a move the key may take, so only its kind refuses it.
    const clear = refusalOf(await asSubmit("clear"));
    const park = refusalOf(await asSubmit("park"));

    for (const refusal of [clear, park]) {
      expect(refusal).toMatchObject({ code: "WORKFLOW_STEP_NOT_SUBMIT" });
    }
    const after = await trustedPart(handle, post, "en");
    expect(after).toMatchObject({
      stage: "legal",
      revision: before?.revision,
      approval: null,
    });
  });

  it("(c) leaves the part where it stood, unapproved, and tells the key it may not clear it", async () => {
    const { post, headers, before } = await inLegal();
    await callTool(handlers, headers, "submit_for_review", {
      document: post,
      parts: ["en"],
      seen: await trustedSeen(handle, post, ["en"]),
      comment: "x",
      step: "clear",
    });

    const review = dataOf(
      await callTool<{ parts: PartState[] }>(
        handlers,
        headers,
        "get_review_state",
        { document: post }
      )
    );
    const en = review.parts.find(part => part.part === "en");

    expect(en).toMatchObject({
      stage: "legal",
      approval: null,
      publishable: false,
      revision: before?.revision,
    });
    // An approval is a person's to give: a key holding sign-off still may not take it.
    expect(en?.steps.find(step => step.name === "clear")).toMatchObject({
      mayTake: false,
    });
  });
});
