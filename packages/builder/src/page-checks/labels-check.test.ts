/**
 * The labels check: a form field with no label, and an embed with no
 * title for screen readers. Called over stored documents with no DOM.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { LABELS_CHECK } from "./labels-check";
import { runPageChecks } from "./page-checks";

function block(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props, ...extra };
}

function findings(...nodes: BlockNode[]) {
  const document: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  return runPageChecks({ document }, [LABELS_CHECK]).findings;
}

describe("the labels check", () => {
  it("passes a form whose fields are labelled, and an embed with a title", () => {
    expect(
      findings(
        block("f", "core/form", {
          fields: [
            { label: "Your email", type: "email" },
            { label: "Message", type: "textarea" },
          ],
        }),
        block("e", "core/embed", {
          src: "https://example.com/v",
          title: "A demo",
        })
      )
    ).toEqual([]);
  });

  it("flags each form field with no label, opening the fields", () => {
    expect(
      findings(
        block("f", "core/form", {
          fields: [
            { label: "Name", type: "text" },
            { label: " ", name: "email", type: "email" },
            { type: "tel" },
          ],
        })
      )
    ).toEqual([
      expect.objectContaining({
        group: "accessibility",
        nodeId: "f",
        part: "field-1",
        what: "Form field 2 has no label",
        fix: { tab: "content", id: "fields" },
      }),
      expect.objectContaining({
        nodeId: "f",
        part: "field-2",
        what: "Form field 3 has no label",
      }),
    ]);
  });

  it("leaves the block's own fields alone while it draws a picked form", () => {
    // The picked form's provider draws its own fields; the block's are unused.
    const own = { fields: [{ label: "", type: "text" }] };
    expect(
      findings(
        block("f", "core/form", {
          ...own,
          form: { provider: "forms", ref: "contact" },
        })
      )
    ).toEqual([]);
    // The page builder's own provider is the block's own fields.
    expect(
      findings(
        block("g", "core/form", { ...own, form: { provider: "simple" } })
      )
    ).toHaveLength(1);
  });

  it("reads a form's fields that are not a list as none", () => {
    expect(findings(block("f", "core/form", { fields: "broken" }))).toEqual([]);
  });

  it("flags an embed with no title, opening its screen reader label", () => {
    expect(
      findings(
        block("e", "core/embed", { src: "https://example.com/v", title: "" })
      )
    ).toEqual([
      expect.objectContaining({
        nodeId: "e",
        what: "Embed has no title",
        fix: { tab: "content", id: "title" },
      }),
    ]);
  });

  it("leaves an embed with nothing to show yet, or a bound title", () => {
    expect(
      findings(
        block("e", "core/embed", { title: "" }),
        block(
          "g",
          "core/embed",
          { src: "https://x.test", title: "" },
          {
            bindings: { title: { source: "entry", path: "title" } as never },
          }
        )
      )
    ).toEqual([]);
  });
});
