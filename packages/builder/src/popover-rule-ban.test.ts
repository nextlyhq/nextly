/**
 * Every popup the builder and the Page Builder's editor open is the builder's
 * own (`popups/builder-popover`), and this is what says so.
 *
 * The general popover moves itself whenever its content changes size, which
 * is a popup jumping under the author's pointer. The builder's piece holds a
 * popup where it opened; a popup built straight on the general one would jump
 * again, with nothing to show for it until someone used it. So this refuses
 * the general popover's content anywhere in the builder's or the editor's
 * shipped source, outside the one piece that wraps it.
 *
 * Found by what is IMPORTED, not by a file, prop or tag name: the general
 * popover's content from `@nextlyhq/ui` (or Radix's own popover) under any
 * local name, a namespace member read off either module, and a re-export of
 * it. Read from the AST, so a comment naming it is not a finding.
 *
 * ⚠️ Bounded: a binding taken apart from a namespace object after import
 * (`const { PopoverContent } = ui`) walks past it. It catches the spellings
 * an import is written in.
 *
 * Which kinds of popup it covers: popovers (`PopoverContent`), which are
 * where content changes while open. Menus, selects and tooltips are not
 * popovers and keep their own placement.
 *
 * @module popover-rule-ban.test
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";
import type { Node as AstNode } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { TEST_MODULE, collectModules, modulePath } from "./source-modules";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(SRC_DIR, "..", "..");
/** The Page Builder plugin's admin code, where its editor lives. */
const EDITOR_DIR = join(PACKAGES, "plugin-page-builder", "src", "admin");

/** The one file allowed to build on the general popover: the piece itself. */
const THE_PIECE = "builder/src/popups/builder-popover.tsx";

/** What each popover module calls its content, by the name it exports. */
const GENERAL_CONTENT = (source: string): readonly string[] => {
  if (source === "@nextlyhq/ui" || source.startsWith("@nextlyhq/ui/")) {
    return ["PopoverContent"];
  }
  if (source === "@radix-ui/react-popover")
    return ["Content", "PopoverContent"];
  return [];
};

/** The name an import or export specifier spells, quoted or not. */
function nameOf(node: AstNode | null | undefined): string | null {
  if (node === null || node === undefined) return null;
  if (node.type === "Identifier") return node.name;
  return literalText(node);
}

/** A file's path beneath `packages`, with "/" as the lists here write it. */
const fromPackages = (file: string): string =>
  modulePath(PACKAGES, file, relative, sep);

/**
 * Every use of the general popover's content in a source text: each import,
 * re-export or namespace member read, as `<module>: <name>`.
 */
function generalPopovers(text: string, file: string): string[] {
  const found: string[] = [];
  /** Namespace bindings of a popover module, by local name. */
  const namespaces = new Map<string, string>();
  const program = parseSource(text, file).program;

  walk(program, (node: AstNode) => {
    if (node.type === "ImportDeclaration") {
      const source = literalText(node.source) ?? "";
      const names = GENERAL_CONTENT(source);
      if (names.length === 0) return;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          namespaces.set(specifier.local.name, source);
        } else if (specifier.type === "ImportSpecifier") {
          const imported = nameOf(specifier.imported);
          if (imported !== null && names.includes(imported)) {
            found.push(`${source}: ${imported}`);
          }
        }
      }
      return;
    }
    if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const source = literalText(node.source) ?? "";
      const names = GENERAL_CONTENT(source);
      if (names.length === 0) return;
      if (node.type === "ExportAllDeclaration") {
        found.push(`${source}: *`);
        return;
      }
      for (const specifier of node.specifiers) {
        const local = nameOf(specifier.local);
        if (local !== null && names.includes(local)) {
          found.push(`${source}: ${local}`);
        }
      }
    }
  });

  if (namespaces.size === 0) return found;
  // A second pass, so a member read above its import is still seen.
  walk(program, (node: AstNode) => {
    const read =
      node.type === "MemberExpression"
        ? {
            object: node.object,
            property: node.property,
            computed: node.computed,
          }
        : node.type === "JSXMemberExpression"
          ? { object: node.object, property: node.property, computed: false }
          : null;
    if (read === null) return;
    const object =
      read.object.type === "Identifier" || read.object.type === "JSXIdentifier"
        ? read.object.name
        : null;
    const source = object === null ? undefined : namespaces.get(object);
    if (source === undefined) return;
    const property = read.computed
      ? literalText(read.property)
      : read.property.type === "Identifier" ||
          read.property.type === "JSXIdentifier"
        ? read.property.name
        : null;
    if (property !== null && GENERAL_CONTENT(source).includes(property)) {
      found.push(`${source}: ${object}.${property}`);
    }
  });
  return found;
}

/** The shipped modules under a directory, by the shared rule. */
function productFiles(dir: string): string[] {
  return collectModules(
    dir,
    at => readdirSync(at, { withFileTypes: true }),
    join
  ).filter(file => !TEST_MODULE.test(file));
}

describe("every builder and editor popup holds where it opened", () => {
  const files = [...productFiles(SRC_DIR), ...productFiles(EDITOR_DIR)];
  const paths = files.map(fromPackages);

  it("reads the files it claims to", () => {
    // By membership rather than by count: popups the builder and the editor
    // open, in each tree, so a walk reduced to one tree is seen.
    expect(paths).toEqual(
      expect.arrayContaining([
        THE_PIECE,
        "builder/src/panels/design/site-text-panel.tsx",
        "builder/src/panels/design/variable-row.tsx",
        "builder/src/inspector/style-inspector/spacing-side-popover.tsx",
        "builder/src/panels/add/insert-picker-body.tsx",
        "plugin-page-builder/src/admin/header-footer-menu.tsx",
        "plugin-page-builder/src/admin/editor/use-a-component.tsx",
      ])
    );
  });

  it("finds the general popover only inside the builder's piece", () => {
    const offenders = files.flatMap(file =>
      generalPopovers(readFileSync(file, "utf8"), file).map(
        use => `${fromPackages(file)}: ${use}`
      )
    );
    expect(offenders.filter(line => !line.startsWith(`${THE_PIECE}:`))).toEqual(
      []
    );
    // The piece is seen too: a scan that saw nothing would pass the line above.
    expect(offenders).toEqual([`${THE_PIECE}: @nextlyhq/ui: PopoverContent`]);
  });

  it("sees the general popover however it is imported", () => {
    const probe = (source: string): string[] =>
      generalPopovers(source, "probe.tsx");

    expect(probe('import { PopoverContent } from "@nextlyhq/ui";')).toEqual([
      "@nextlyhq/ui: PopoverContent",
    ]);
    // Renamed, so a tag of any name is found by what it is.
    expect(
      probe('import { PopoverContent as Panel } from "@nextlyhq/ui";')
    ).toEqual(["@nextlyhq/ui: PopoverContent"]);
    expect(
      probe('import { "PopoverContent" as P } from "@nextlyhq/ui";')
    ).toEqual(["@nextlyhq/ui: PopoverContent"]);
    expect(
      probe(
        'import * as Ui from "@nextlyhq/ui"; const x = <Ui.PopoverContent />;'
      )
    ).toEqual(["@nextlyhq/ui: Ui.PopoverContent"]);
    expect(
      probe(
        'import * as Ui from "@nextlyhq/ui"; const C = Ui["PopoverContent"];'
      )
    ).toEqual(["@nextlyhq/ui: Ui.PopoverContent"]);
    expect(
      probe('import * as P from "@radix-ui/react-popover"; <P.Content />;')
    ).toEqual(["@radix-ui/react-popover: P.Content"]);
    expect(probe('import { Content } from "@radix-ui/react-popover";')).toEqual(
      ["@radix-ui/react-popover: Content"]
    );
    expect(probe('export { PopoverContent } from "@nextlyhq/ui";')).toEqual([
      "@nextlyhq/ui: PopoverContent",
    ]);
  });

  it("leaves the rest of the popover, and other modules, alone", () => {
    const probe = (source: string): string[] =>
      generalPopovers(source, "probe.tsx");

    expect(
      probe(
        'import { Popover, PopoverAnchor, PopoverTrigger } from "@nextlyhq/ui";'
      )
    ).toEqual([]);
    expect(
      probe(
        'import { BuilderPopoverContent } from "../popups/builder-popover";'
      )
    ).toEqual([]);
    expect(probe('import { PopoverContent } from "./elsewhere";')).toEqual([]);
    // A comment naming it is not a use of it.
    expect(probe("// PopoverContent from @nextlyhq/ui moves itself")).toEqual(
      []
    );
    expect(
      probe('import * as Ui from "@nextlyhq/ui"; <Ui.Popover />;')
    ).toEqual([]);
  });
});
