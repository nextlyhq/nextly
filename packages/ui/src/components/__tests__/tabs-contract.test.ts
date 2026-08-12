/**
 * No call site may repaint the tab indicator.
 *
 * `Tabs` is an underline control: the active state is a 2px bottom border on the
 * trigger, and the trigger is square so that border runs flush to its edges. The
 * primitive already applies the border, both state colours, the hover colour and
 * the focus ring — so a call site that restates any of them owns a second copy
 * of one appearance, and the copies drift the moment either changes.
 *
 * That is not hypothetical. Before this test, `plugin-form-builder` set
 * `border-b-0` on the list, restated the trigger's entire class string, and then
 * drove the active colour from React state through an inline
 * `style={{ borderBottomColor }}` — so its tabs were the same component with a
 * different appearance, which is exactly what a shared primitive exists to
 * prevent.
 *
 * Scanned rather than typed, and the reason is worth stating: `cn()` merges
 * through tailwind-merge, so a later class legitimately overrides an earlier
 * one. That is what makes the primitive extensible for layout, and it is also
 * what makes the indicator overridable. No type can distinguish "layout class"
 * from "indicator class" at the call site, so the boundary has to be checked
 * rather than declared.
 *
 * LAYOUT overrides stay allowed on purpose. Nine call sites pass things like
 * `justify-start`, `grid-cols-2`, `h-8`, `overflow-x-auto` and `gap-0`, and they
 * are correct — a tab strip in a dialog is a different shape from one in a
 * sheet. Only the indicator is closed.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../..");
const PACKAGES = resolve(REPO, "packages");

/** The primitive itself declares the contract; it is not a call site. */
const PRIMITIVE = resolve(PACKAGES, "ui/src/components/tabs.tsx");

/**
 * What a call site may not do to a `TabsList` or `TabsTrigger`.
 *
 * Each pattern is a way of taking the indicator over rather than positioning it.
 * `border-b-*` covers both removing the underline (`border-b-0`) and redrawing
 * it; the inline-style and `borderBottom*` patterns cover doing it in JS, which
 * is how the real violation escaped a class-based reading.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /<Tabs(?:List|Trigger)[^>]*\bborder-b-[^\s"'}]+/,
    why: "sets its own bottom border — the underline IS the active state, and the primitive draws it",
  },
  {
    pattern: /<Tabs(?:List|Trigger)[^>]*\brounded-[^\s"'}]+/,
    why: "sets a corner — tabs are square so the underline stays flush, pinned by radius-tier-contract",
  },
  {
    pattern: /<Tabs(?:List|Trigger)[^>]*\bstyle=/,
    why: "styles the tab inline, which no class-based override can be reasoned about alongside",
  },
  {
    pattern: /borderBottomColor|borderBottomWidth|borderBottom:/,
    why: "drives the underline from JS instead of the primitive's data-[state=active]",
  },
];

/** Every `.tsx` under `packages/`, excluding build output and the primitive. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (entry.endsWith(".tsx") && full !== PRIMITIVE) {
      found.push(full);
    }
  }
  return found;
}

/** A line that is only a comment documents; it does not style. */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

interface Violation {
  file: string;
  line: number;
  why: string;
}

function violations(): Violation[] {
  const found: Violation[] = [];
  for (const file of sourceFiles(PACKAGES)) {
    const source = readFileSync(file, "utf8");
    // Cheap reject first: most files never mention tabs at all.
    if (!source.includes("<TabsList") && !source.includes("<TabsTrigger")) {
      continue;
    }
    source.split("\n").forEach((line, index) => {
      if (isComment(line)) return;
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) {
          found.push({
            file: file.replace(`${REPO}/`, ""),
            line: index + 1,
            why,
          });
        }
      }
    });
  }
  return found;
}

describe("the tab indicator contract", () => {
  it("finds files to check, so a clean result means conforming and not unscanned", () => {
    // The instrument control. Every assertion below is "nothing was found",
    // which a broken path, a wrong extension or an over-eager skip would also
    // produce — and it would read as compliance.
    const scanned = sourceFiles(PACKAGES).filter(file => {
      const source = readFileSync(file, "utf8");
      return source.includes("<TabsList") || source.includes("<TabsTrigger");
    });
    expect(scanned.length).toBeGreaterThan(5);
  });

  it("is not satisfied by a call site that repaints the indicator", () => {
    // The positive control: the patterns must actually match the shape they
    // describe. Without this, a regex that can never match anything passes the
    // suite while checking nothing.
    const sample = `<TabsTrigger value="x" style={{ borderBottomColor: "red" }} className="border-b-2">`;
    const matched = FORBIDDEN.filter(({ pattern }) => pattern.test(sample));
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it("no call site overrides the tab indicator", () => {
    const found = violations();
    expect(
      found.map(v => `${v.file}:${v.line} — ${v.why}`),
      "these call sites take over the tab indicator instead of letting the " +
        "primitive draw it. Pass layout classes only; if a surface genuinely " +
        "needs a different indicator, change `packages/ui/src/components/tabs.tsx` " +
        "so every surface changes with it."
    ).toEqual([]);
  });
});
