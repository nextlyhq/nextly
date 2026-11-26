/**
 * No retired word reaches an author in the builder, the Page Builder plugin
 * or the admin.
 *
 * The editor says one word per idea. Each idea's word is in the builder's
 * glossary, and every other word for it is retired there with the rule that
 * finds it (`packages/builder/src/glossary/retired-words.ts`). This reads the
 * shown text of the three packages, the way `retired-words.mjs` describes,
 * and fails on any retired word that is neither:
 *
 * - in a place listed below, where the word names another idea or the text
 *   is code, each with why; or
 * - in `retired-words-pending.json`, the texts shown today that a rename is
 *   still to change, by file and exact text.
 *
 * Both lists only shrink: a listed text that no longer appears fails, so a
 * rename removes its own entries, and a place that no longer holds the word
 * fails too. A new screen that uses a retired word fails here.
 *
 * @module retired-words.test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BRITISH_SPELLINGS,
  RETIRED_WORDS,
} from "../packages/builder/src/glossary/retired-words.ts";
import {
  ADD_PANEL_WORDS,
  POSITION_WORDS,
} from "../packages/builder/src/glossary/words.ts";

import {
  SCANNED,
  findRetired,
  retiredIn,
  shippedFiles,
  shownTexts,
  stalePending,
  staleAllowed,
  unlisted,
  repoPath,
} from "./retired-words.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The texts still to rename, by file. */
const PENDING = JSON.parse(
  readFileSync(join(ROOT, "scripts/retired-words-pending.json"), "utf8")
);

/**
 * Places where a retired word names another idea, or where the text is code
 * held in a string. A folder ends in "/". Each says why.
 */
const ALLOWED = [
  {
    place: "packages/builder/src/glossary/retired-words.ts",
    rules: ["grey", "behaviour"],
    why: "The list of retired words has to spell them to find them.",
  },
  {
    place: "packages/builder/src/canvas/canvas-frame-sheet.ts",
    rules: ["space-between"],
    why: "The canvas frame's own stylesheet, CSS held in a string.",
  },
  {
    place: "packages/plugin-page-builder/src/site-code/",
    rules: ["element"],
    why: "The site's own code: its checker speaks of HTML elements, and its bootstrap is a script held in a string.",
  },
  {
    place:
      "packages/plugin-page-builder/src/admin/editor/site-code-settings.tsx",
    rules: ["element"],
    why: "The site's own code box, counting the HTML elements its code holds.",
  },
  {
    place: "packages/plugin-page-builder/src/site-style-record.ts",
    rules: ["token", "breakpoint", "viewport"],
    why: "The stored style record's checks, which name its stored keys (tokens, breakpoints, viewport) for a developer writing it.",
  },
  {
    place: "packages/plugin-page-builder/src/starter-pages/",
    rules: ["look"],
    why: "Sample copy written onto a starter's pages: the site's content, not the editor's words.",
  },
  ...[
    "packages/admin/src/components/features/auth-accept-invite/",
    "packages/admin/src/components/features/auth-reset-password/",
    "packages/admin/src/components/features/auth-setup/",
    "packages/admin/src/components/features/auth-verify-email/",
    "packages/admin/src/components/features/api-keys/",
    "packages/admin/src/components/features/dashboard/SystemHealthCard.tsx",
  ].map(place => ({
    place,
    rules: ["token"],
    why: "A sign-in or API credential, another idea than a design variable.",
  })),
  {
    place: "packages/admin/src/components/shared/search-bar/inert-classes.ts",
    rules: ["token"],
    why: "A development warning to the developer passing SearchBar its classes.",
  },
  ...[
    "packages/admin/src/components/features/entries/fields/FieldWrapper.tsx",
    "packages/admin/src/components/features/settings/SettingsRow.tsx",
    "packages/admin/src/lib/forms/label-landing.ts",
  ].map(place => ({
    place,
    rules: ["element"],
    why: "A development-only message to the developer of a form control, about the HTML element a label names.",
  })),
  {
    place:
      "packages/admin/src/components/features/widgets/preview/preview-findings.tsx",
    rules: ["element"],
    why: "A widget preview's accessibility findings, counted in the HTML elements the checker reports.",
  },
];

/**
 * One text per retired word that must fail, in a builder file, so a rule
 * that stops matching fails here.
 */
const FAILS = {
  token: "Import design tokens…",
  breakpoint: "Edit breakpoints",
  bind: "Unbind, keep the text",
  insert: "Insert a block",
  inspector: "Inspector",
  "header-footer-set": "New header & footer set",
  look: "Keep the look on this block only",
  element: "How solid the element is",
  logical: "Space inside, per logical side.",
  viewport: "Fixed to the viewport",
  "normal-flow": "Normal flow",
  "layer-order": "Layer order",
  "space-between": "Space between blocks",
  "component-fields": "Feature card · {…} fields",
  "page-data": "Page data: {…} of {…}",
  "bare-template": "Templates",
  ...Object.fromEntries(
    Object.keys(BRITISH_SPELLINGS).map(british => [
      british,
      `${british[0].toUpperCase()}${british.slice(1)}`,
    ])
  ),
};

/**
 * Texts that keep a retired word's letters but not its idea, and must pass
 * in every scanned package.
 */
const PASSES = [
  "Space between paragraphs",
  "Space between the blocks inside",
  "Set a width for the header",
  "Look for a block",
  "A tab that looks empty",
  "Collection templates",
  "Its template is linked to every entry",
  "Color",
  "Center",
  "Gray",
  "Behavior",
  "Customize",
  "Emphasis",
  "Upper bound",
  "Adds a field to the form",
];

const BUILDER_FILE = "packages/builder/src/probe.tsx";
const ADMIN_FILE = "packages/admin/src/probe.tsx";

describe("the retired words", () => {
  const findings = findRetired(ROOT, RETIRED_WORDS);

  it("reads the files it claims to", () => {
    const files = SCANNED.flatMap(folder =>
      shippedFiles(join(ROOT, folder))
    ).map(file => repoPath(ROOT, file));
    expect(files).toEqual(
      expect.arrayContaining([
        "packages/builder/src/editor-words.ts",
        "packages/builder/src/shell/shell-top-bar.tsx",
        "packages/plugin-page-builder/src/admin/editor/settings-dialog.tsx",
        "packages/admin/src/components/features/api-keys/CreateApiKeyForm.tsx",
      ])
    );
    // Test code, fixtures and migrations are never read as shown text.
    expect(
      files.filter(file =>
        /\.test\.|\.fixture\.|\/__tests__\/|\/migrations\//.test(file)
      )
    ).toEqual([]);
  });

  it("are said nowhere but the places allowed and the texts still to rename", () => {
    expect(unlisted(findings, PENDING, ALLOWED)).toEqual([]);
  });

  it("list nothing still to rename that no longer appears", () => {
    expect(stalePending(findings, PENDING)).toEqual([]);
  });

  it("allow no place that no longer says the word", () => {
    expect(staleAllowed(findings, ALLOWED)).toEqual([]);
  });

  it("have a failing text for every rule", () => {
    expect(Object.keys(FAILS).sort()).toEqual(
      RETIRED_WORDS.map(rule => rule.id).sort()
    );
  });

  it.each(Object.entries(FAILS))("finds %s", (id, text) => {
    expect(retiredIn(text, BUILDER_FILE, RETIRED_WORDS)).toContain(id);
  });

  it.each(PASSES)("passes %s", text => {
    expect(retiredIn(text, BUILDER_FILE, RETIRED_WORDS)).toEqual([]);
    expect(retiredIn(text, ADMIN_FILE, RETIRED_WORDS)).toEqual([]);
  });

  it("keeps a builder-only word to the builder and the plugin", () => {
    // A bare "Templates" is retired inside the builder; the admin's own
    // email templates keep the word.
    expect(retiredIn("Templates", ADMIN_FILE, RETIRED_WORDS)).toEqual([]);
    expect(
      retiredIn(
        "Templates",
        "packages/plugin-page-builder/src/probe.tsx",
        RETIRED_WORDS
      )
    ).toEqual(["bare-template"]);
  });

  it("reads shown text, tooltips, placeholders and accessible names, not code, search keywords or logs", () => {
    const texts = shownTexts(
      [
        // Comments are never shown.
        "// Insert a block",
        // Code names: a literal type, an object key, a lone lower-case name,
        // an attribute only code reads.
        'type Kind = "breakpoint";',
        'const ids = { "design token": 1, kind: "token" };',
        'const C = () => <div className="inspector panel" data-x="a token" />;',
        // Search keywords, under a key or in a constant so named.
        'const entry = { label: "Gap", keywords: ["space between", "insert"] };',
        'const SYNONYMS = [["z-index", "layer order"]];',
        // Logs, by their call or their package tag.
        'console.warn("the token could not be read");',
        'args.logger.error("the breakpoint was missing");',
        'deps.warn("[page-builder] the default header & footer set was made");',
        // Shown: a string, template text, an element's line, a tooltip, a
        // placeholder and an accessible name.
        'const a = "Insert a block";',
        "const b = `Edit ${n} breakpoints`;",
        "const D = () => <p>Unbind {field} now</p>;",
        'const E = () => <button title="Inspector" aria-label="Design tokens" />;',
        'const F = () => <input placeholder="Paste a token" />;',
        'const G = () => <input aria-label="viewport" name="viewport" />;',
      ].join("\n"),
      "probe.tsx"
    );
    expect(
      texts.filter(
        text => retiredIn(text, BUILDER_FILE, RETIRED_WORDS).length > 0
      )
    ).toEqual([
      "Insert a block",
      "Edit {…} breakpoints",
      "Unbind {…} now",
      "Inspector",
      "Design tokens",
      "Paste a token",
      "viewport",
    ]);
  });

  it("fails a listed text that no longer appears, so the list only shrinks", () => {
    const shown = [
      {
        file: "packages/builder/src/a.tsx",
        text: "Insert a block",
        rule: "insert",
      },
    ];
    const listed = {
      "packages/builder/src/a.tsx": ["Insert a block", "Edit breakpoints"],
    };
    expect(stalePending(shown, listed)).toEqual([
      "packages/builder/src/a.tsx: Edit breakpoints",
    ]);
    // And a text neither listed nor allowed is a finding.
    expect(
      unlisted(
        [
          ...shown,
          {
            file: "packages/builder/src/b.tsx",
            text: "Inspector",
            rule: "inspector",
          },
        ],
        listed,
        []
      )
    ).toEqual([
      {
        file: "packages/builder/src/b.tsx",
        text: "Inspector",
        rule: "inspector",
      },
    ]);
  });

  it("allows a place only for the words it names", () => {
    const shown = [
      {
        file: "packages/admin/src/auth/x.tsx",
        text: "Setup token",
        rule: "token",
      },
      { file: "packages/admin/src/auth/x.tsx", text: "Insert", rule: "insert" },
    ];
    const allowed = [{ place: "packages/admin/src/auth/", rules: ["token"] }];
    expect(unlisted(shown, {}, allowed)).toEqual([shown[1]]);
    expect(
      staleAllowed(shown, [
        ...allowed,
        { place: "packages/admin/src/other/", rules: ["token"] },
      ])
    ).toEqual(["packages/admin/src/other/ (token)"]);
  });
});

/**
 * The glossary's words that are drawn today, each in the file that draws
 * it. A rename that changes the glossary and not its place, or the place and
 * not the glossary, fails here; a place switched to read the glossary still
 * passes, since it then draws the same word.
 */
const DRAWN_TODAY = [
  ...[
    POSITION_WORDS.relative,
    POSITION_WORDS.absolute,
    POSITION_WORDS.sticky,
  ].map(word => ({
    word,
    file: "packages/builder/src/inspector/style-inspector/style-keyword-labels.ts",
  })),
  {
    word: ADD_PANEL_WORDS.collectionTemplates,
    file: "packages/plugin-page-builder/src/overview/admin-panel.ts",
  },
];

describe("the glossary's words", () => {
  it.each(DRAWN_TODAY.map(drawn => [drawn.word, drawn]))(
    "says %s where it is drawn",
    (_word, { word, file }) => {
      const shown = shownTexts(readFileSync(join(ROOT, file), "utf8"), file);
      expect(shown, `${file} says ${word}`).toContain(word);
    }
  );
});
