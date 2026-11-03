/**
 * The write path tells an old placement break from a new one by the stored
 * form the write changes: a draft-only save is measured against the draft
 * alone, so a break only the published form holds is not passed off as old.
 */
import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { blocksFieldType } from "./blocksField";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/linkbox",
        slots: { children: {} },
        contentModel: (props: { link?: string }) =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "acme/cta",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

const broken = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "box",
      type: "acme/linkbox",
      version: 1,
      props: { link: "/go" },
      slots: {
        children: [{ id: "cta", type: "acme/cta", version: 1, props: {} }],
      },
    },
  ],
};
const clean = { formatVersion: 1, kind: "page", nodes: [] };

/** A collection entry whose published form breaks the rule and draft does not. */
function write(): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    readStored: async target => ({
      kind: "value",
      value: target.form === "published" ? broken : clean,
    }),
  };
}

async function validate(data: Record<string, unknown>) {
  const field = blocksFieldType();
  return field.validate?.(broken, {
    path: "content",
    field: { name: "content", type: "blocks" },
    write: write(),
    data,
  } as never);
}

describe("old and new placement breaks, by the form a write changes", () => {
  it("refuses a draft save adding a break only the published form held", async () => {
    const result = await validate({});
    expect(
      Array.isArray(result) ? result.map(issue => issue.code) : result
    ).toEqual(["content-model"]);
  });

  it("keeps it on a publish, which changes the published form too", async () => {
    expect(await validate({ status: "published" })).toBe(true);
  });
});
