/**
 * A simple form whose answers have nowhere to go: no "Send to" address and
 * no form picked from a provider, so what visitors send reaches no one. The
 * canvas says so over the block; the page's checks list it too, by the same
 * rule. Called over stored documents with no DOM.
 */
import type {
  AnyBlockDefinition,
  BlockDocument,
  BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { CORE_PAGE_CHECKS } from "./core-checks";
import { FORM_NOWHERE_CHECK } from "./form-nowhere-check";
import { runPageChecks } from "./page-checks";

/** The Form block as the check's list names it. */
const FORM = {
  name: "core/form",
  version: 1,
  editor: { label: "Form" },
  props: {},
  render: () => null,
} as unknown as AnyBlockDefinition;

function form(id: string, props: Record<string, unknown>): BlockNode {
  return { id, type: "core/form", version: 1, props };
}

function findingsOn(nodes: BlockNode[]) {
  const document: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  return runPageChecks(
    { document, blocks: type => (type === FORM.name ? FORM : undefined) },
    [FORM_NOWHERE_CHECK]
  ).findings;
}

describe("a simple form with nowhere to send answers", () => {
  it("is listed under Content and data, with its fix in Send to", () => {
    const [finding, ...rest] = findingsOn([form("f1", { submitText: "Send" })]);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      group: "content",
      nodeId: "f1",
      block: "Form",
      fix: { tab: "content", id: "action" },
    });
  });

  it("says what is wrong, why it matters and what to do, in plain words", () => {
    const [finding] = findingsOn([form("f1", { action: "  " })]);
    expect(finding?.what).toBe("Form answers have nowhere to go");
    expect(finding?.why).toBe(
      "Visitors can send the form, but their answers aren’t sent or saved anywhere."
    );
    expect(finding?.todo).toBe(
      "Add an address in Send to, or install the Forms plugin to save them."
    );
  });

  it("is found inside other blocks too, in page order", () => {
    const findings = findingsOn([
      {
        id: "section",
        type: "core/section",
        version: 1,
        props: {},
        slots: { children: [form("inner", {})] },
      },
      form("after", {}),
    ]);
    expect(findings.map(each => each.nodeId)).toEqual(["inner", "after"]);
  });

  it("is one of the builder's own checks", () => {
    expect(CORE_PAGE_CHECKS).toContain(FORM_NOWHERE_CHECK);
  });
});

describe("a form the check leaves alone", () => {
  it.each([
    ["sends its answers to an address", { action: "https://example.com/in" }],
    ["is a form picked from Forms", { form: { provider: "forms", ref: "7" } }],
  ])("%s", (_case, props) => {
    expect(findingsOn([form("f1", props)])).toEqual([]);
  });

  it("is listed again once its address is cleared", () => {
    expect(findingsOn([form("f1", { action: "/in" })])).toEqual([]);
    expect(findingsOn([form("f1", { action: "" })])).toHaveLength(1);
  });
});

describe("a simple form inside a placed component", () => {
  it("is listed on the placement that draws it", () => {
    const signup: BlockDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [form("inner", { action: "" })],
    };
    const placed: BlockNode = {
      id: "p1",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "signup" },
    };
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [placed],
    };
    const found = runPageChecks(
      {
        document,
        blocks: type => (type === FORM.name ? FORM : undefined),
        definitions: new Map([["signup", signup]]),
      },
      [FORM_NOWHERE_CHECK]
    ).findings;
    // The component's Form is drawn on the page, so the page lists it; the
    // finding sits on the placement, the block the author can select.
    expect(found).toEqual([
      expect.objectContaining({
        nodeId: "p1",
        what: "Form answers have nowhere to go",
      }),
    ]);
  });
});
