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
 *   still to change, by file and exact text, once per time each is shown.
 *
 * Both lists only shrink. A listed text that is no longer shown fails, so a
 * rename removes its own entries; a place that no longer holds the word
 * fails; and the pending list's size is pinned, so a new text cannot join it
 * without the pin changing in review. A new screen that uses a retired word
 * fails here.
 *
 * @module retired-words.test
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
  SCREEN_SIZE_WORDS,
  SIZE_WORDS,
} from "../packages/builder/src/glossary/words.ts";

import {
  SCANNED,
  findRetired,
  repoPath,
  retiredIn,
  shippedFiles,
  shownTexts,
  staleAllowed,
  stalePending,
  unlisted,
} from "./retired-words.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The texts still to rename, by file, once per time each is shown. */
const PENDING = JSON.parse(
  readFileSync(join(ROOT, "scripts/retired-words-pending.json"), "utf8")
);

/**
 * How many texts are still to rename. A rename lowers it; raising it means a
 * new text joined the list instead of being written in the glossary's words,
 * which review should refuse.
 */
const PENDING_COUNT = 531;

/**
 * Places where a retired word names another idea, or where the text is code
 * held in a string. A folder ends in "/". Each says why.
 */
const ALLOWED = [
  {
    place: "packages/builder/src/glossary/retired-words.ts",
    rules: ["colour", "grey", "behaviour"],
    why: "The list of retired words has to spell them to find them.",
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
    rules: ["token", "breakpoint", "viewport", "colour"],
    why: "The stored style record's checks, read by a developer writing the record, which name its stored keys (tokens, breakpoints, viewport, colour values).",
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
  {
    place: "packages/admin/src/lib/forms/label-landing.ts",
    rules: ["element"],
    why: "A development-only check, which tells the developer of a form control which HTML element its label names.",
  },
  {
    place:
      "packages/admin/src/components/features/widgets/preview/preview-findings.tsx",
    rules: ["element"],
    why: "A widget preview's accessibility findings, counted in the HTML elements the checker reports.",
  },
];

/**
 * Texts that must fail, in a builder file, for every rule and every way a
 * rule finds its word, so a branch that stops matching fails here.
 */
const FAILS = {
  token: ["Import design tokens…", "A token needs a name."],
  breakpoint: ["Edit breakpoints", "Add breakpoint"],
  bind: [
    "Bind {…} to a field",
    "Unbind, keep the text",
    "{…}: bound to {…}",
    "Bound heading",
    "Unbound. {…}",
    "Bindings to fix",
  ],
  insert: ["Insert a block", "Press to read · lift to insert"],
  inspector: ["Inspector", "Canvas and inspector"],
  "header-footer-set": [
    "New header & footer set",
    "Header & footer sets",
    "A site can have more than one set of a header and footer.",
    "Give the header & footer set a name.",
    "Header sets",
  ],
  look: [
    "Keep the look on this block only",
    "A look for {…} blocks",
    "Default · every {…} starts from this look; other looks are laid on top",
    "{…} look",
    "Button look",
    "by {…}'s built-in look",
    "Rename look",
    "Looks",
    "Image look",
    "Feature card looks",
  ],
  element: ["How solid the element is"],
  logical: ["Space inside, per logical side."],
  viewport: ["Fixed to the viewport"],
  "normal-flow": ["Normal flow"],
  "layer-order": ["Layer order"],
  "space-between": [
    "Space between",
    "Space between blocks",
    "Space between the columns",
  ],
  "component-fields": [
    "This component has no fields to change on this page.",
    "Checking which fields this component’s published version uses…",
    "Feature card · {…} fields",
  ],
  "page-data": ["Page data: {…} of {…}", "Over the page data limit"],
  "bare-template": ["Templates", "Template"],
  ...Object.fromEntries(
    Object.keys(BRITISH_SPELLINGS).map(british => [
      british,
      [`${british[0].toUpperCase()}${british.slice(1)}`],
    ])
  ),
  colour: ["Colours", "colour", "Recently coloured", "Colourless"],
  grey: ["Grey", "Greyscale"],
  customise: ["Customised", "Customiser", "customisable"],
  recognise: ["recognise", "Recognisable"],
};

/** Where a rule finds its word only on certain screens: a text and its place. */
const FAILS_IN_PLACE = [
  {
    rule: "header-footer-set",
    file: "packages/plugin-page-builder/src/admin/editor/editor-top-bar.tsx",
    texts: [
      "Untitled set",
      "Make another set the default before deleting it.",
      "No {…} in this set",
      "Also used by {…} and {…} other sets",
      "{…} is this set's own {…} now.",
      "Sets",
    ],
  },
  {
    rule: "component-fields",
    file: "packages/builder/src/inspector/component-fields-panel.tsx",
    texts: ["No fields yet", "Remove field", "Field", "Give the field a name."],
  },
  {
    rule: "fields-tab",
    file: "packages/plugin-page-builder/src/admin/editor/settings-dialog.tsx",
    texts: ["Fields"],
  },
];

/**
 * Texts that keep a retired word's letters but not its idea, and must pass
 * in every scanned package.
 */
const PASSES = [
  "Space between paragraphs",
  "Space between the blocks inside",
  "Set a width for the header",
  "The header sets the page title",
  "A set of screen sizes",
  "Look for a block",
  "A tab that looks empty",
  "This looks fine",
  "Which looks best?",
  "Choose Copy style on the block that looks right.",
  "Collection templates",
  "Its template is linked to every entry",
  "Color",
  "Center",
  "Gray",
  "Behavior",
  "Customize",
  "Emphasis",
  "Upper bound on width",
  "Adds a field to the form",
  "This form has 3 fields",
  "Fields",
  "Have a look",
  "Take a look at it",
  "One look tells you",
  "The block looks as it does now",
  "Button looks off",
  "The image looks sharp",
  "The footer sets its own color",
  "The value is bound by its parent",
  "The space between the paragraphs of rich text.",
  "The space between columns, and between gallery images.",
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
        "packages/blocks-engine/src/style/site-tokens.ts",
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

  it("list nothing still to rename that is no longer shown", () => {
    expect(stalePending(findings, PENDING)).toEqual([]);
  });

  it("list no more texts still to rename than the pin", () => {
    expect(Object.values(PENDING).flat()).toHaveLength(PENDING_COUNT);
  });

  it("allow no place that no longer says the word", () => {
    expect(staleAllowed(findings, ALLOWED)).toEqual([]);
  });

  it("have a failing text for every rule", () => {
    expect(
      [
        ...new Set([
          ...Object.keys(FAILS),
          ...FAILS_IN_PLACE.map(({ rule }) => rule),
        ]),
      ].sort()
    ).toEqual(RETIRED_WORDS.map(rule => rule.id).sort());
  });

  it.each(
    Object.entries(FAILS).flatMap(([id, texts]) =>
      texts.map(text => [id, text])
    )
  )("finds %s in %s", (id, text) => {
    expect(retiredIn(text, BUILDER_FILE, RETIRED_WORDS)).toContain(id);
  });

  it.each(
    FAILS_IN_PLACE.flatMap(({ rule, file, texts }) =>
      texts.map(text => [rule, text, file])
    )
  )("finds %s in %s on its own screen", (rule, text, file) => {
    expect(retiredIn(text, file, RETIRED_WORDS)).toContain(rule);
    // The same text elsewhere names another idea.
    expect(retiredIn(text, ADMIN_FILE, RETIRED_WORDS)).not.toContain(rule);
  });

  it("keeps a content field's words on a component's own screens", () => {
    const file = "packages/builder/src/inspector/instance-inspector-panel.tsx";
    for (const text of ["Connect to a field", "Connected to {…} field"]) {
      expect(retiredIn(text, file, RETIRED_WORDS)).not.toContain(
        "component-fields"
      );
    }
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

  it("reads shown text, tooltips, placeholders and accessible names", () => {
    const texts = shownTexts(
      [
        'const a = "Insert a block";',
        "const b = `Edit ${n} breakpoints`;",
        "const C = () => <p>Unbind {field} now</p>;",
        'const D = () => <button title="Inspector" aria-label="Design tokens" />;',
        'const E = () => <input placeholder="Paste a token" />;',
        // A lone lower-case word where it is shown: a shown attribute or key,
        // one whose name ends in a shown word, or a branch of a choice in an
        // element's text or a shown template.
        'const F = () => <input aria-label="viewport" name="viewport" />;',
        'const G = { emptyText: "inspector", ariaLabel: "breakpoints" };',
        'const H = () => <p>{n === 1 ? "colour" : "colours"}</p>;',
        'const I = `Remove ${name || "breakpoint"}`;',
        'const J = () => <Row name={x ?? "Layer order"} value="Insert a row" />;',
        // A choice in a template made only of the spaces between words, and
        // a word handed to a helper in a shown template.
        'const K = `${n} ${n === 1 ? "colour" : "colours"}`;',
        'const L = `Remove ${pluralise(n, "breakpoint")}`;',
        // A tag-like prefix is still read where a value is shown.
        'const M = { label: "[Beta] Insert a block" };',
        // A phrase running through an inline element is one line.
        "const N = () => <p>Normal <b>flow</b> here</p>;",
        // So does one running through a string or a choice's branch in it,
        // each branch read once beside the text around it.
        'const O = () => <p>Normal {"flow"}</p>;',
        'const P = () => <p>Page {kind === "data" ? "data" : "content"}</p>;',
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
      "inspector",
      "breakpoints",
      "colour",
      "colours",
      "breakpoint",
      "Layer order",
      "Insert a row",
      "colour",
      "colours",
      "breakpoint",
      "[Beta] Insert a block",
      "Normal flow here",
      "Normal flow",
      "Page data",
    ]);
  });

  it("counts the text around a choice once per showing, and each branch's own word", () => {
    // One file of three elements, in a folder of its own: the fixed text's
    // word ("Insert") is one finding however many branches the choice has,
    // a branch's word ("Inspector") is a finding of its own, and a branch
    // that only joins the text around it ("Page data") is found.
    const root = mkdtempSync(join(tmpdir(), "retired-words-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(
        join(root, "src/probe.tsx"),
        [
          'const A = () => <p>Insert {a ? "one" : "two"} here</p>;',
          'const B = () => <p>Open {b ? "Inspector" : "Layers"} now</p>;',
          'const C = () => <p>Page {k ? "data" : "content"}</p>;',
        ].join("\n")
      );
      expect(findRetired(root, RETIRED_WORDS, ["src"])).toEqual([
        { file: "src/probe.tsx", text: "Insert one here", rules: ["insert"] },
        {
          file: "src/probe.tsx",
          text: "Open Inspector now",
          rules: ["inspector"],
        },
        { file: "src/probe.tsx", text: "Page data", rules: ["page-data"] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a lone word anywhere in a words module, but not its codes or comparisons", () => {
    const source = [
      'export const LOSS = { color: "colour", size: "size" };',
      'const CODES = ["binding-prop-missing"];',
      'const pick = (s) => (s === "tokens" ? 1 : 2);',
    ].join("\n");
    expect(shownTexts(source, "packages/builder/src/editor-words.ts")).toEqual([
      "colour",
      "size",
    ]);
    expect(shownTexts(source, "packages/builder/src/probe.ts")).toEqual([]);
    // The list of retired words holds rules, not words.
    expect(
      shownTexts(source, "packages/builder/src/glossary/retired-words.ts")
    ).toEqual([]);
  });

  it("never reads code, search keywords, logs or comments as shown text", () => {
    const texts = shownTexts(
      [
        "// Insert a block",
        // Code: a literal type, an object key, an attribute only code reads,
        // a stylesheet held in a string.
        'type Kind = "Edit breakpoints";',
        'const ids = { "Design tokens": 1 };',
        'const C = () => <div className="Inspector panel" data-x="A token" />;',
        'const sheet = "body { margin: 0; color: grey; justify-content: space-between; }";',
        // Search keywords, under a key or in a constant so named.
        'const entry = { label: "Gap", keywords: ["Space between", "Insert"] };',
        'const SYNONYMS = [["z-index", "Layer order"]];',
        // Logs, by their call, their package tag, or a development check's
        // remedies.
        'console.warn("The token could not be read");',
        'args.logger.error("The breakpoint was missing");',
        'devWarnOnce(true, "The Inspector has no width");',
        'deps.warn("[page-builder] the default header & footer set was made");',
        "const message = `[Nextly] The label names no element`;",
        'check({ remedies: { absent: "Wrap the element in FormControl." } });',
        // A code template's branches: an address, a class name.
        'const url = `/api/${t ? "tokens" : "fonts"}/list`;',
        'const cls = `nx-${on ? "inspector" : "panel"}`;',
      ].join("\n"),
      "probe.tsx"
    );
    expect(
      texts.filter(
        text => retiredIn(text, BUILDER_FILE, RETIRED_WORDS).length > 0
      )
    ).toEqual([]);
    // Positive control: the same file still yields its one shown text.
    expect(texts).toEqual(["Gap"]);
  });

  it("fails a listed text that is no longer shown, so the list only shrinks", () => {
    const shown = [
      {
        file: "packages/builder/src/a.tsx",
        text: "Insert a block",
        rules: ["insert"],
      },
    ];
    const listed = {
      "packages/builder/src/a.tsx": ["Insert a block", "Edit breakpoints"],
    };
    expect(stalePending(shown, listed)).toEqual([
      "packages/builder/src/a.tsx: Edit breakpoints",
    ]);
    // A text neither listed nor allowed is a finding.
    const inspector = {
      file: "packages/builder/src/b.tsx",
      text: "Inspector",
      rules: ["inspector"],
    };
    expect(unlisted([...shown, inspector], listed, [])).toEqual([inspector]);
  });

  it("counts a listed text once per showing", () => {
    const once = {
      file: "packages/builder/src/a.tsx",
      text: "Inspector",
      rules: ["inspector"],
    };
    const listed = { "packages/builder/src/a.tsx": ["Inspector"] };
    // Shown a second time: the second showing is a finding.
    expect(unlisted([once, once], listed, [])).toEqual([once]);
    // Listed twice and shown once: the extra entry is stale.
    expect(
      stalePending([once], {
        "packages/builder/src/a.tsx": ["Inspector", "Inspector"],
      })
    ).toEqual(["packages/builder/src/a.tsx: Inspector"]);
  });

  it("allows a place only for the words it names", () => {
    const token = {
      file: "packages/admin/src/auth/x.tsx",
      text: "Setup token",
      rules: ["token"],
    };
    const insert = {
      file: "packages/admin/src/auth/x.tsx",
      text: "Insert",
      rules: ["insert"],
    };
    const allowed = [{ place: "packages/admin/src/auth/", rules: ["token"] }];
    expect(unlisted([token, insert], {}, allowed)).toEqual([insert]);
    expect(
      staleAllowed(
        [token, insert],
        [...allowed, { place: "packages/admin/src/other/", rules: ["token"] }]
      )
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
    word: SCREEN_SIZE_WORDS.desktop,
    file: "packages/builder/src/styles/breakpoints.ts",
  },
  {
    word: SCREEN_SIZE_WORDS.tablet,
    file: "packages/builder/src/shell/breakpoint-editor.tsx",
  },
  {
    word: SCREEN_SIZE_WORDS.mobile,
    file: "packages/builder/src/inspector/content/columns-layout-field.tsx",
  },
  {
    word: SIZE_WORDS.width,
    file: "packages/builder/src/inspector/style-inspector/content-width-control.tsx",
  },
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
