/**
 * The editor's unbind plan route: the page is read as the caller before
 * anything is planned, only an unbind is planned, and the plan is the one
 * decision's, made against the document the editor sends.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import type { planUnbind } from "./unbind-kept";
import {
  answerUnbindPlan,
  unbindPlanRequestOf,
  type UnbindPlanReads,
} from "./unbind-plan-route";

const document = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Own" },
      bindings: { text: { $bind: "title" } },
    },
  ],
};

const body = (over: Record<string, unknown> = {}) => ({
  page: { collection: "pages", id: "p1", locale: "en" },
  document,
  action: { kind: "unbind-prop", nodeId: "h", prop: "text" },
  ...over,
});

const PLANNED = {
  kept: { set: { text: "Spring sale" } },
  answer: {
    kept: "visitor" as const,
    value: "Spring sale",
    reason: "The prop keeps what visitors saw.",
  },
};

function reads(page: Record<string, unknown> | null): UnbindPlanReads & {
  readonly plan: ReturnType<typeof vi.fn<typeof planUnbind>>;
} {
  return {
    readPage: vi.fn(async () => page),
    plan: vi.fn<typeof planUnbind>(async () => PLANNED),
  };
}

describe("the editor's unbind plan", () => {
  it("plans the editor's own document, as a visitor's value by default", async () => {
    const r = reads({ id: "p1" });
    const answer = await answerUnbindPlan(unbindPlanRequestOf(body()), r);
    expect(answer).toEqual(PLANNED);
    expect(r.plan).toHaveBeenCalledWith(
      { collection: "pages", id: "p1", locale: "en" },
      document,
      "h",
      "text",
      "visitor"
    );
  });

  it("names a template's collection, read from the page as the caller reads it", async () => {
    const r = reads({ id: "p1", collection: "posts" });
    await answerUnbindPlan(
      unbindPlanRequestOf(
        body({
          action: {
            kind: "unbind-prop",
            nodeId: "h",
            prop: "text",
            keep: { entry: "e7" },
          },
        })
      ),
      r
    );
    expect(r.plan).toHaveBeenCalledWith(
      expect.objectContaining({ templateTarget: "posts" }),
      document,
      "h",
      "text",
      { entry: "e7" }
    );
  });

  it("plans a Single's page against the Single itself", async () => {
    const r = reads({ id: "home" });
    await answerUnbindPlan(
      unbindPlanRequestOf(body({ page: { single: "home", locale: "en" } })),
      r
    );
    expect(r.readPage).toHaveBeenCalledWith({ single: "home", locale: "en" });
    expect(r.plan).toHaveBeenCalledWith(
      { collection: "home", id: "home", kind: "single", locale: "en" },
      document,
      "h",
      "text",
      "visitor"
    );
  });

  it("plans nothing for a page the caller may not read", async () => {
    const r = reads(null);
    await expect(
      answerUnbindPlan(unbindPlanRequestOf(body()), r)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(r.plan).not.toHaveBeenCalled();
  });

  it("judges the document by the site's own limits", () => {
    // Two blocks: within the defaults, past a site allowing one.
    const two = {
      ...document,
      nodes: [...document.nodes, { ...document.nodes[0], id: "h2" }],
    };
    expect(() => unbindPlanRequestOf(body({ document: two }))).not.toThrow();
    expect(() =>
      unbindPlanRequestOf(body({ document: two }), {
        ...DEFAULT_LIMITS,
        maxNodes: 1,
      })
    ).toThrow(/larger than a page may be/);
  });

  it("refuses anything but an unbind, and a body that is no document", () => {
    expect(() =>
      unbindPlanRequestOf(
        body({
          action: {
            kind: "bind-prop",
            nodeId: "h",
            prop: "text",
            binding: { $bind: "title" },
          },
        })
      )
    ).toThrow(/Only an unbind/);
    expect(() => unbindPlanRequestOf(body({ document: "nodes" }))).toThrow(
      /not a document/
    );
    expect(() =>
      unbindPlanRequestOf(body({ action: { kind: "unbind-prop" } }))
    ).toThrow();
  });
});
