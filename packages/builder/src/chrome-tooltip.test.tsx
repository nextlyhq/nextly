// @vitest-environment jsdom

/**
 * The editor chrome's tooltip: it closes as the pointer moves onto the canvas
 * frame, stays for keyboard focus, opens below its control, and is the one
 * tooltip the builder's chrome draws.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { moduleSpecifierRefs } from "@nextlyhq/module-specifiers";
import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TooltipProvider } from "@nextlyhq/ui";
import type { Node as AstNode } from "oxc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChromeTooltip } from "./chrome-tooltip";
import { TEST_MODULE, collectModules } from "./source-modules";

afterEach(cleanup);

function renderTip(): HTMLElement {
  render(
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip content="Reset">
        <button type="button">reset</button>
      </ChromeTooltip>
    </TooltipProvider>
  );
  return screen.getByRole("button", { name: "reset" });
}

/** A frame the pointer can move into, as the canvas is. */
function enterFrame(): void {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  fireEvent.pointerOver(frame);
  frame.remove();
}

describe("ChromeTooltip", () => {
  it("closes a pointer-opened tooltip when the pointer moves into a frame", () => {
    vi.useFakeTimers();
    try {
      const button = renderTip();
      fireEvent.pointerMove(button, { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("tooltip").textContent).toBe("Reset");

      enterFrame();

      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes when the pointer enters a frame inside the document its control is in", () => {
    // The shell can itself be drawn in a frame: the canvas frame's events then
    // reach that inner document, never the outer one.
    const host = document.createElement("iframe");
    document.body.append(host);
    const inner = host.contentDocument;
    if (inner === null) throw new Error("the host frame has no document");
    const container = inner.createElement("div");
    inner.body.append(container);
    vi.useFakeTimers();
    try {
      render(
        <TooltipProvider delayDuration={300}>
          <ChromeTooltip content="Reset">
            <button type="button">reset</button>
          </ChromeTooltip>
        </TooltipProvider>,
        { container }
      );
      const button = inner.querySelector("button");
      if (button === null) throw new Error("no trigger rendered");
      fireEvent.pointerMove(button, { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole("tooltip")).not.toBeNull();

      const canvas = inner.createElement("iframe");
      inner.body.append(canvas);
      fireEvent.pointerOver(canvas);

      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
      host.remove();
    }
  });

  it("keeps a keyboard-focused control's tooltip when the pointer moves into a frame", async () => {
    const button = renderTip();
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => button.focus());
    expect(button.matches(":focus-visible")).toBe(true);
    await screen.findByRole("tooltip");

    enterFrame();

    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("opens below its control unless told otherwise", async () => {
    // Above, it covered the value of the row before.
    const button = renderTip();
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => button.focus());
    await screen.findByRole("tooltip");
    const content = document.querySelector("[data-side]");
    expect(content?.getAttribute("data-side")).toBe("bottom");
  });
});

/**
 * Bounded, as every source scan is: it takes every way a module loads
 * `@nextlyhq/ui` from the repository's own specifier reader, and a module that
 * loads it some other way, through a variable holding the specifier or a
 * second package that re-exports the parts, walks past it. It catches the
 * import a new control reaches for without thinking, which is the one that
 * stuck over the canvas.
 */
describe("the builder's chrome tooltips", () => {
  const SRC_DIR = dirname(fileURLToPath(import.meta.url));
  const PARTS = new Set(["Tooltip", "TooltipTrigger", "TooltipContent"]);

  /** A module-export name's text, an identifier or a string literal. */
  function nameOf(node: AstNode): string {
    if (node.type === "Identifier") return node.name;
    return node.type === "Literal" ? String(node.value) : "";
  }

  /**
   * Every tooltip part a module reaches from `@nextlyhq/ui`. Named imports and
   * named re-exports are read by name. Any other way the module loads it, as
   * the repository's own reader finds them (a namespace import, `export *`,
   * `import()`, `require()`, `import x = require()`, a JSDoc import), reaches
   * the parts by property where no scan can follow, so it counts as reaching
   * them all.
   */
  function partsImported(text: string, file: string): string[] {
    const found: string[] = [];
    let byName = 0;
    walk(parseSource(text, file).program, (node: AstNode) => {
      if (
        (node.type !== "ImportDeclaration" &&
          node.type !== "ExportNamedDeclaration") ||
        node.source?.value !== "@nextlyhq/ui"
      ) {
        return;
      }
      // A type-only declaration draws nothing: `import type` and `export type`
      // reach no tooltip at runtime, and the reader below does not count them.
      const kind =
        node.type === "ImportDeclaration" ? node.importKind : node.exportKind;
      if (kind === "type") return;
      const specifiers = node.specifiers ?? [];
      if (specifiers.some(one => one.type === "ImportNamespaceSpecifier")) {
        return;
      }
      byName += 1;
      for (const specifier of specifiers) {
        const typeOnly =
          (specifier.type === "ImportSpecifier" &&
            specifier.importKind === "type") ||
          (specifier.type === "ExportSpecifier" &&
            specifier.exportKind === "type");
        if (typeOnly) continue;
        const name =
          specifier.type === "ImportSpecifier"
            ? nameOf(specifier.imported)
            : specifier.type === "ExportSpecifier"
              ? nameOf(specifier.local)
              : "";
        if (PARTS.has(name)) found.push(name);
      }
    });
    // Every runtime load the repository's reader finds; type-only references
    // (`typeof import()`, `import type * as`) erase at build and draw nothing.
    const loads = moduleSpecifierRefs(text, file).filter(
      ref => ref.specifier === "@nextlyhq/ui" && !ref.typeOnly
    ).length;
    if (loads > byName) found.push("loaded another way");
    return found;
  }

  const files = collectModules(
    SRC_DIR,
    at => readdirSync(at, { withFileTypes: true }),
    join
  ).filter(file => !TEST_MODULE.test(file));
  const importers = files
    .filter(file => partsImported(readFileSync(file, "utf8"), file).length > 0)
    .map(file => relative(SRC_DIR, file));

  it("are drawn by ChromeTooltip alone", () => {
    expect(importers).toEqual(["chrome-tooltip.tsx"]);
  });

  it("reads the files it claims to", () => {
    // The positive control: a scan that read nothing would also find no
    // other importer.
    expect(importers).toContain("chrome-tooltip.tsx");
    expect(files.map(file => relative(SRC_DIR, file))).toEqual(
      expect.arrayContaining(["editor-rail.tsx", "icon-choice-field.tsx"])
    );
  });
});
