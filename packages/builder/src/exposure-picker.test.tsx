// @vitest-environment jsdom
/**
 * The make-component picker: what it offers, what a pick hands back, and what
 * it refuses before the server would.
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  registryBlockSource,
  type BlockDocument,
  type BlockNode,
  type RequestedProperty,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExposurePicker } from "./exposure-picker";

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
        name: "acme/card",
        props: {
          title: { type: "text", role: "content" },
          tone: { type: "select", options: ["light", "dark"] },
          count: { type: "number" },
        },
      },
      {
        ...base,
        name: "acme/sealed",
        slots: {
          body: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const card = (id: string): BlockNode => ({
  id,
  type: "acme/card",
  version: 1,
  props: {},
});

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** The picker, controlled by a state of its own, with what it last handed back. */
function Harness({
  document,
  selectedIds,
  seen,
}: {
  document: BlockDocument;
  selectedIds: string[];
  seen: { value: readonly RequestedProperty[] };
}): React.JSX.Element {
  const [value, setValue] = React.useState<readonly RequestedProperty[]>([]);
  return (
    <ExposurePicker
      document={document}
      selectedIds={selectedIds}
      definitions={registryBlockSource()}
      value={value}
      onChange={next => {
        seen.value = next;
        setValue(next);
      }}
    />
  );
}

describe("the exposure picker", () => {
  it("offers the props a placement could set, and not the others", () => {
    const seen = { value: [] as readonly RequestedProperty[] };
    render(
      <Harness document={page([card("c1")])} selectedIds={["c1"]} seen={seen} />
    );

    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Tone")).toBeTruthy();
    expect(screen.queryByLabelText("Count")).toBeNull();
  });

  it("names each value by the property's own label, with no type beside it", () => {
    registerBlocks(
      [
        {
          ...base,
          name: "acme/box",
          props: {
            as: {
              label: "HTML tag",
              type: "select",
              options: ["div", "aside"],
            },
          },
        },
      ] as never,
      { source: "acme-box" }
    );
    const seen = { value: [] as readonly RequestedProperty[] };
    render(
      <Harness
        document={page([{ id: "b1", type: "acme/box", version: 1, props: {} }])}
        selectedIds={["b1"]}
        seen={seen}
      />
    );
    // "HTML tag", the block's word for it, never "As (Choice)".
    expect(screen.getByLabelText("HTML tag")).toBeTruthy();
    expect(screen.queryByLabelText("As")).toBeNull();
    expect(screen.queryByText("Choice")).toBeNull();
    fireEvent.click(screen.getByLabelText("HTML tag"));
    expect(seen.value[0]).toMatchObject({ label: "HTML tag", propPath: "as" });
  });

  it("hands back a nomination aimed at the page's node, with a minted id", () => {
    const seen = { value: [] as readonly RequestedProperty[] };
    render(
      <Harness document={page([card("c1")])} selectedIds={["c1"]} seen={seen} />
    );

    fireEvent.click(screen.getByLabelText("Title"));

    expect(seen.value).toEqual([
      {
        id: "title",
        label: "Title",
        nodeId: "c1",
        propPath: "title",
        type: "text",
      },
    ]);
    // Named once picked, under a name the author may change.
    const name = screen.getByLabelText(/Name pages see for Title/);
    fireEvent.change(name, { target: { value: "Headline" } });
    expect(seen.value[0]).toMatchObject({ id: "title", label: "Headline" });
  });

  it("mints a second id past the first when two blocks expose alike", () => {
    const seen = { value: [] as readonly RequestedProperty[] };
    render(
      <Harness
        document={page([card("c1"), card("c2")])}
        selectedIds={["c1", "c2"]}
        seen={seen}
      />
    );

    for (const box of screen.getAllByLabelText("Title")) fireEvent.click(box);

    expect(seen.value.map(entry => [entry.nodeId, entry.id])).toEqual([
      ["c1", "title"],
      ["c2", "title-2"],
    ]);
  });

  it("dims a non-content prop inside an area locked to its content, with the reason", () => {
    const seen = { value: [] as readonly RequestedProperty[] };
    const sealed: BlockNode = {
      id: "s1",
      type: "acme/sealed",
      version: 1,
      props: {},
      slots: { body: [card("c2")] },
    };
    render(
      <Harness document={page([sealed])} selectedIds={["s1"]} seen={seen} />
    );

    const tone = screen.getByLabelText("Tone");
    expect(tone.getAttribute("disabled")).not.toBeNull();
    // The reason is the box's own description, so it is read with it.
    const reason = document.getElementById(
      tone.getAttribute("aria-describedby") ?? ""
    );
    expect(reason?.textContent).toMatch(
      /locked to its content, and this isn’t content/
    );
    // Content inside the same area is still offered.
    expect(screen.getByLabelText("Title").getAttribute("disabled")).toBeNull();
  });

  it("says when nothing in the selection can change from one use to another", () => {
    const seen = { value: [] as readonly RequestedProperty[] };
    const bare: BlockNode = {
      id: "x",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "other" },
    };
    render(<Harness document={page([bare])} selectedIds={["x"]} seen={seen} />);

    expect(
      screen.getByText(
        /Nothing in this selection can change from one use to another/
      )
    ).toBeTruthy();
  });

  it("asks what each use can change, and says nothing of placements", () => {
    const seen = { value: [] as readonly RequestedProperty[] };
    render(
      <Harness document={page([card("c1")])} selectedIds={["c1"]} seen={seen} />
    );

    const group = screen.getByRole("group", {
      name: "What each use can change",
    });
    expect(group.textContent).toContain(
      "Anything left unticked looks the same everywhere it is used."
    );
    expect(group.textContent ?? "").not.toMatch(/placement|expos/i);
  });
});
