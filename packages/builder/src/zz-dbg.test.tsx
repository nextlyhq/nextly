// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { InsertPanel } from "./insert-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

describe("dbg", () => {
  it("what the effect can see", () => {
    clearBlocks();
    registerBlocks(
      Array.from({ length: 3 }, (_, i) => ({
        version: 1,
        description: `Block ${i}.`,
        example: { props: {} },
        render: () => null,
        name: `acme/b${i}`,
        editor: { label: `B${i}`, category: "Layout" },
      })) as never,
      { source: "acme" }
    );
    render(
      <InsertPanel
        editor={
          {
            document: { formatVersion: 1, kind: "page", nodes: [] },
            selectedId: null,
            apply: vi.fn(() => ({})),
            select: vi.fn(),
          } as never
        }
      />
    );
    const list = document.querySelector("[cmdk-list]");
    console.log("list found:", !!list);
    const items = Array.from(document.querySelectorAll("[cmdk-item]"));
    console.log("items:", items.length);
    for (const i of items.slice(0, 3)) {
      console.log(
        "  item attrs:",
        JSON.stringify({
          ariaSelected: i.getAttribute("aria-selected"),
          dataValue: i.getAttribute("data-value"),
          label: i.getAttribute("aria-label"),
          inList: !!list?.contains(i),
        })
      );
    }
    console.log(
      "selector match inside list:",
      !!list?.querySelector('[cmdk-item][aria-selected="true"]')
    );
    console.log(
      "strip BEFORE:",
      document.querySelector(".nx-insert-panel__describes")?.textContent
    );
    fireEvent.pointerMove(screen.getByRole("option", { name: "B2" }));
    console.log(
      "after pointerMove B2 -> selected:",
      JSON.stringify(
        Array.from(document.querySelectorAll("[cmdk-item]"))
          .find(i => i.getAttribute("aria-selected") === "true")
          ?.getAttribute("aria-label")
      ),
      "| strip:",
      document.querySelector(".nx-insert-panel__describes")?.textContent
    );
    const input = screen.getByPlaceholderText("Search blocks");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    console.log(
      "after ArrowDown -> selected:",
      JSON.stringify(
        Array.from(document.querySelectorAll("[cmdk-item]"))
          .find(i => i.getAttribute("aria-selected") === "true")
          ?.getAttribute("aria-label")
      ),
      "| strip:",
      document.querySelector(".nx-insert-panel__describes")?.textContent
    );
    expect(true).toBe(true);
  });
});
