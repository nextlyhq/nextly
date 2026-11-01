/**
 * The SDK's root entry is server-safe: no module it imports, its own files followed
 * through, is marked `"use client"`. A Server Component that imports the root, to format a
 * figure or name a chart colour, would otherwise be handed a client reference it cannot call.
 *
 * Read from what each import RESOLVES to, the built entry a consumer loads, not from its name:
 * `@nextlyhq/ui` is a client module at its root and server-safe at `./format` and `./color`, and
 * only the file says which. The admin's entry is the control that the check can see a mark.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chartColour, formatChange, formatCount } from "@nextlyhq/ui/format";
import { describe, expect, it } from "vitest";

// Imported here rather than in a test: the root loads `nextly`, which takes longer than one
// test's budget to load the first time.
import {
  formatWidgetChange,
  formatWidgetNumber,
  widgetChartColour,
} from "./index";

const SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(SRC, "..");

/** Every specifier a source file imports or re-exports from, statically. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(match => match[1]);
}

/** The bare specifiers the root reaches, following its own relative files. */
function packageImportsOfRoot(): string[] {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith(".")) {
        visit(resolve(dirname(file), `${specifier}.ts`));
      } else {
        packages.add(specifier);
      }
    }
  };
  visit(join(SRC, "index.ts"));
  return [...packages].sort();
}

/** An exports entry's file for an ESM consumer. */
function importTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null) return undefined;
  const conditions = entry as Record<string, unknown>;
  return importTarget(conditions.import) ?? importTarget(conditions.default);
}

/** The built file a specifier resolves to, as this package's consumer loads it. */
function resolvedFile(specifier: string): string {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  const subpath = `.${specifier.slice(name.length)}`;
  const root = join(PACKAGE, "node_modules", name);
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  ) as {
    exports: string | Record<string, unknown>;
  };
  const target = importTarget(
    typeof manifest.exports === "string"
      ? subpath === "."
        ? manifest.exports
        : undefined
      : manifest.exports[subpath]
  );
  if (target === undefined) throw new Error(`${specifier} has no import entry`);
  const file = join(root, target);
  if (!existsSync(file)) {
    throw new Error(`${specifier} resolves to ${file}, which is not built`);
  }
  return file;
}

/** Whether a module's first statement is the `"use client"` directive. */
function isClientModule(file: string): boolean {
  return /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*["']use client["']/.test(
    readFileSync(file, "utf8")
  );
}

describe("the SDK's root entry", () => {
  const imported = packageImportsOfRoot();

  it("reaches the packages it re-exports from, the figure formatters' among them", () => {
    expect(imported).toEqual(
      expect.arrayContaining(["nextly", "@nextlyhq/ui/format"])
    );
  });

  it.each(imported)(
    'imports %s, which is not marked "use client"',
    specifier => {
      expect(isClientModule(resolvedFile(specifier))).toBe(false);
    }
  );

  it('CONTROL: the admin\'s entry, which the root must never import, is marked "use client"', () => {
    expect(isClientModule(resolvedFile("@nextlyhq/admin"))).toBe(true);
    expect(isClientModule(resolvedFile("@nextlyhq/ui"))).toBe(true);
  });
});

describe("the figure formatters and the chart colour", () => {
  it("are @nextlyhq/ui's own, so a figure reads the same wherever it is written", () => {
    expect(formatWidgetNumber).toBe(formatCount);
    expect(formatWidgetChange).toBe(formatChange);
    expect(widgetChartColour).toBe(chartColour);
  });

  it("write a floor as drawn, and name a slot's colour as its theme token", () => {
    expect(formatWidgetNumber(2000, { floor: true }).text).toBe("2,000+");
    expect(widgetChartColour(1)).toBe("var(--nx-chart-1)");
    expect(widgetChartColour(5)).toBe("var(--nx-chart-5)");
  });
});
