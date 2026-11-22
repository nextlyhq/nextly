// @vitest-environment jsdom

/**
 * A Form placed inside a collection list, drawn once per entry.
 *
 * Every copy is the same node, so what tells the copies apart is the entry
 * each is drawn for: without it, the copies share every id, a label names the
 * first copy's control, and a send comes back to a fragment the first copy
 * answers, showing its message in the wrong place.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageContext, PageForms } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { FORM_POST_FIELDS } from "./form";
import { coreBlocks } from "./index";

const node = (id: string, type: string, extra: object = {}): BlockNode =>
  ({ id, type, version: 1, props: {}, ...extra }) as BlockNode;

const FORM = node("signup", "core/form", {
  version: 2,
  props: {
    fields: [
      { label: "Your email", type: "email", required: true },
      { label: "Note", type: "textarea" },
    ],
  },
});

const loop = (id: string, children: BlockNode[]): BlockNode =>
  node(id, "core/collection-loop", {
    props: { collection: "posts" },
    slots: { children },
  });

const FORMS: PageForms = {
  action: "/admin/api/plugins/@nextlyhq/plugin-page-builder/forms/send",
  document: "page:p1",
  returnTo: "/events",
  describe: () => Promise.reject(new Error("no provider in this test")),
};

const CONTEXT = {
  entry: null,
  forms: FORMS,
  data: {
    find: () =>
      Promise.resolve({
        items: [
          { id: "e1", title: "One" },
          { id: "e2", title: "Two" },
        ],
        total: 2,
      }),
  },
  resolveMedia: () => Promise.resolve(null),
  resolveEntryPath: () => Promise.resolve(null),
} as unknown as PageContext;

async function drawn(nodes: BlockNode[]): Promise<HTMLElement> {
  const document_: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document_}
      blocks={createBlockResolver(coreBlocks)}
      context={CONTEXT}
    />,
    {
      onError(error: unknown) {
        throw error;
      },
    }
  );
  await stream.allReady;
  const host = document.createElement("div");
  host.innerHTML = await new Response(stream).text();
  return host;
}

/** Each drawn form's sent item, its ids, and its labels' targets. */
function copiesIn(host: HTMLElement) {
  return Array.from(host.querySelectorAll("form")).map(form => ({
    item: form.querySelector<HTMLInputElement>(
      `input[name="${FORM_POST_FIELDS.item}"]`
    )?.value,
    ids: Array.from(form.querySelectorAll("[id]"), element => element.id),
    labelsReachHome: Array.from(
      form.querySelectorAll<HTMLLabelElement>("label[for]")
    ).every(label =>
      form.contains(host.querySelector(`[id="${label.htmlFor}"]`))
    ),
  }));
}

describe("a form drawn once per entry of a list", () => {
  it("is told apart by its entry in the item it sends and every id", async () => {
    const host = await drawn([loop("list", [FORM])]);
    const copies = copiesIn(host);
    // Must-be-found: the list drew one form per entry.
    expect(copies).toHaveLength(2);
    expect(copies.map(copy => copy.item)).toEqual(["0", "1"]);
    const ids = copies.flatMap(copy => copy.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(copies.every(copy => copy.labelsReachHome)).toBe(true);
    // The fragment the receiver sends a visitor of the second copy back to.
    const second = host.querySelectorAll("form")[1];
    expect(second?.querySelector('[id="form-signup-1-sent"]')).not.toBeNull();
  });

  it("is told apart in a list inside a list, by both entries", async () => {
    const host = await drawn([loop("outer", [loop("inner", [FORM])])]);
    const copies = copiesIn(host);
    expect(copies.map(copy => copy.item)).toEqual(["0-0", "0-1", "1-0", "1-1"]);
    const ids = copies.flatMap(copy => copy.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sends no item where it is drawn once, outside any list", async () => {
    const copies = copiesIn(await drawn([FORM]));
    expect(copies).toHaveLength(1);
    expect(copies[0]?.item).toBeUndefined();
    expect(copies[0]?.ids).toContain("form-signup-sent");
  });
});
