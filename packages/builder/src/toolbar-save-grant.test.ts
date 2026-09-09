/**
 * The save verb, refused for a reason the author can read.
 *
 * The property under test is that the GRANT is asked about at all, and that its
 * refusal reaches every surface. A test asserting only "disabled when
 * mayCreatePattern is false" would also pass against an implementation that
 * disabled the verb for the wrong reason, so each case here reads the REASON
 * back — that string is the only explanation an author gets, and there is
 * nothing on the canvas that would otherwise say why.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { toolbarActions } from "./toolbar-actions";

/**
 * The document shape the planner accepts, built the way `toolbar-actions.test`
 * builds it. A hand-rolled one is refused for its own reasons — measured — and
 * a fixture the planner rejects never reaches the grant at all, so every
 * "enabled" assertion below would be testing the refusal it did not intend.
 */
function node(id: string, type = "acme/heading"): BlockNode {
  return { id, type, version: 1, props: {} } as BlockNode;
}
const document: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [node("a"), node("b")],
} as BlockDocument;

function save(ids: readonly string[], mayCreate?: boolean) {
  return toolbarActions(document, ids[0], ids, undefined, mayCreate).find(
    a => a.id === "save-as-pattern"
  );
}

describe("save as pattern, and the grant behind it", () => {
  it("is offered when the caller may create", () => {
    expect(save(["a"], true)).toMatchObject({ enabled: true });
  });

  it("is refused WITH A REASON when the caller may not", () => {
    expect(save(["a"], false)).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("permission"),
    });
  });

  it("names the OPERATION refused, not one of the grants it needs", () => {
    // Saving takes more than one grant — the pattern is stored and published in
    // the same act — so a message naming any single one is wrong for somebody.
    // An author who may create a pattern but not publish it, told they cannot
    // "create", would ask for the grant they already hold.
    const reason = (save(["a"], false) as { reason: string }).reason;
    expect(reason).toMatch(/save/i);
    expect(reason).not.toMatch(/create/i);
  });

  it("refuses a multi-block selection on the same grant", () => {
    // The set path builds its verbs separately, so a grant threaded through one
    // and not the other leaves the toolbar refusing a single block and offering
    // the same save for two.
    expect(save(["a", "b"], false)).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("permission"),
    });
    expect(save(["a", "b"], true)).toMatchObject({ enabled: true });
  });

  it("is offered when nothing was said, so an unasked question never hides it", () => {
    // The permissive default. A caller that has not adopted the parameter — and
    // the editor itself, while the read is in flight — must keep the answer it
    // had, because a wrong refusal hides a feature the author holds and only
    // the late failure is lost by being wrong the other way.
    expect(save(["a"])).toMatchObject({ enabled: true });
    expect(save(["a", "b"])).toMatchObject({ enabled: true });
  });
});
