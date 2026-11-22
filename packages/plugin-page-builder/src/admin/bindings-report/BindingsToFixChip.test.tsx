// @vitest-environment jsdom

/**
 * The editor's chip asks the report once as the builder opens: for the open
 * document. The whole report, read only for the "N more elsewhere" line in
 * the list the chip opens, is asked when the list opens.
 *
 * @module admin/bindings-report/BindingsToFixChip.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Each read the chip asked, by path, and whether it was enabled. */
const asked: Array<{ path: string; enabled: boolean }> = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  navigateTo: vi.fn(),
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
  usePluginRoute: ({
    path,
    enabled = true,
  }: {
    path: string;
    enabled?: boolean;
  }) => {
    asked.push({ path, enabled });
    const whole = !path.includes("document=");
    return {
      data: !enabled
        ? undefined
        : whole
          ? { items: [], meta: { bindings: 3 } }
          : {
              items: [
                {
                  documentKey: new URLSearchParams(
                    path.slice(path.indexOf("?"))
                  ).get("document"),
                  rows: [
                    {
                      nodeId: "n1",
                      blocksField: "body",
                      prop: "text",
                      binding: { source: "entry", path: "title" },
                      reason: "missing",
                    },
                  ],
                },
              ],
              meta: { bindings: 1 },
            },
      pending: false,
      error: null,
      refetch: vi.fn(),
      fetching: false,
    };
  },
}));

vi.mock("./words", () => ({
  changeSentence: () => "The field is gone. Visitors see the fallback.",
  visitorsSee: () => "the fallback",
  whatChanged: () => "the field is gone",
  whereBound: () => "Heading",
}));

import { BindingsToFixChip } from "./BindingsToFixChip";

afterEach(() => {
  cleanup();
  asked.length = 0;
});

function chip() {
  return render(
    <BindingsToFixChip
      editor={{ document: { nodes: {} }, select: vi.fn() }}
      field="body"
      canvas={null}
      requestPanel={vi.fn()}
    />
  );
}

/** The whole report's reads, as asked enabled. */
const wholeAsked = () =>
  asked.filter(read => !read.path.includes("document=") && read.enabled);

describe("the bindings to fix chip", () => {
  it("asks only the open document's bindings until its list is opened", () => {
    chip();
    expect(
      screen.getByRole("button", { name: /1 binding to fix/ })
    ).toBeTruthy();
    expect(
      asked.some(read => read.path.includes("document=") && read.enabled)
    ).toBe(true);
    expect(wholeAsked()).toEqual([]);
  });

  it("asks the whole report when its list opens, for the count elsewhere", async () => {
    chip();
    await userEvent.click(
      screen.getByRole("button", { name: /1 binding to fix/ })
    );
    expect(wholeAsked().length).toBeGreaterThan(0);
    expect(await screen.findByText("2 more elsewhere")).toBeTruthy();
  });
});
