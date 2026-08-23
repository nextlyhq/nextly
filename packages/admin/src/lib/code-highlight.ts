/**
 * How code looks, everywhere in the admin.
 *
 * One style rather than a light one and a dark one: `--nx-code-*` are
 * redeclared under `.dark` in `packages/ui/src/styles/theme.css`, so a colour
 * written as `var(--nx-code-string)` resolves at the element it paints and CSS
 * settles the mode. The alternative -- two highlight styles chosen by the
 * resolved theme -- keeps two palettes in step by hand, and renders light
 * inside a dark admin for the frame before the theme is known.
 *
 * The tag-to-token mapping is the vocabulary `rich-text-kit.ts` already uses
 * for Lexical, so the two engines colour the same construct alike: a property
 * name is a `function` colour in both, a boolean a `number` in both. Two
 * mappings that agree today would drift, and the drift would be silent because
 * each looks right beside its own editor.
 *
 * @module lib/code-highlight
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { Tag } from "@lezer/highlight";
import { tags as t } from "@lezer/highlight";

import type { CodeConstruct } from "./code-palette";
import { codeColor } from "./code-palette";

/**
 * The palette, as data.
 *
 * Exported so a test can assert that no entry names a literal colour and that
 * no declared token is left unreachable. Both are failures a rendered editor
 * shows only to someone who already knows what the right colour was.
 */
export const CODE_TAG_SPECS: readonly {
  tag: Tag | Tag[];
  construct: CodeConstruct;
  fontStyle?: string;
}[] = [
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    construct: "comment",
    fontStyle: "italic",
  },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
    construct: "keyword",
  },
  {
    // `boolean` and `constant` are number-coloured in rich-text-kit, and JSON's
    // `null` is the same kind of literal, so it travels with them rather than
    // with the keywords it parses beside.
    tag: [t.bool, t.null, t.atom, t.number, t.integer, t.float],
    construct: "number",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character],
    construct: "string",
  },
  {
    tag: [
      t.propertyName,
      t.attributeName,
      t.function(t.variableName),
      t.function(t.propertyName),
    ],
    construct: "function",
  },
  {
    tag: [
      t.operator,
      t.compareOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.definitionOperator,
    ],
    construct: "operator",
  },
  {
    tag: [
      t.punctuation,
      t.separator,
      t.bracket,
      t.brace,
      t.paren,
      t.squareBracket,
    ],
    construct: "punctuation",
  },
  {
    // `className` and `typeName` ride with the variables because rich-text-kit
    // colours Prism's `class` and `class-name` that way, and a type name is the
    // construct that engine already has an opinion about.
    tag: [
      t.variableName,
      t.definition(t.variableName),
      t.local(t.variableName),
      t.className,
      t.typeName,
    ],
    construct: "variable",
  },
  {
    // Comment-coloured, as rich-text-kit colours `namespace`: it qualifies the
    // name beside it rather than being the name, so it reads quieter.
    tag: [t.namespace],
    construct: "comment",
  },
  {
    // Markup only -- an element name and the brackets around it, which is what
    // Prism's `tag` means too.
    tag: [t.tagName, t.angleBracket],
    construct: "tag",
  },
  { tag: [t.deleted], construct: "deleted" },
  { tag: [t.inserted], construct: "inserted" },
];

/**
 * The tag palette, as a CodeMirror highlighter.
 *
 * Colours are resolved from the shared construct table at build time, so this
 * file records which lezer tags mean which construct and nothing about what a
 * construct is worth.
 */
export const nextlyHighlightStyle = HighlightStyle.define([
  ...CODE_TAG_SPECS.map(spec => ({
    tag: spec.tag,
    color: codeColor(spec.construct),
    ...(spec.fontStyle === undefined ? {} : { fontStyle: spec.fontStyle }),
  })),
  // A parse error is a fault rather than a construct, so it reads from the
  // admin's error token instead of the code palette.
  { tag: t.invalid, color: "var(--nx-destructive)" },
]);

/**
 * Registered WITHOUT `fallback`, which is what makes it win.
 *
 * `basicSetup` installs CodeMirror's `defaultHighlightStyle` as a fallback, and
 * a fallback applies only when no other highlighter is registered. So this one
 * takes precedence wherever both are present, and nothing has to switch
 * `basicSetup` off to get it.
 */
export const nextlyHighlighting = syntaxHighlighting(nextlyHighlightStyle);

export interface EditorChromeOptions {
  /** Editor font size in px. Defaults to 12, the admin's code size. */
  fontSize?: number;
  /**
   * Scroller padding.
   *
   * Omitted rather than defaulted when absent: a field editor sits inside a
   * bordered control that supplies its own inset, and forcing padding here
   * would double it.
   */
  padding?: string;
  /** Whether a gutter is shown, which changes only the inset the text needs. */
  showGutter?: boolean;
}

/**
 * Everything about an editor that is not a token colour: surface, gutter,
 * selection, cursor, font.
 *
 * Split from the highlighter because a read-only viewer and an editable field
 * want the same colours and different chrome. The background stays transparent
 * so the surrounding card decides the surface -- an editor that paints its own
 * would have to be told about every card it is dropped into.
 */
export function nextlyEditorChrome({
  fontSize = 12,
  padding,
  showGutter = false,
}: EditorChromeOptions = {}) {
  return EditorView.theme({
    "&": {
      fontSize: `${fontSize}px`,
      backgroundColor: "transparent",
      color: "var(--nx-code-fg)",
    },
    ".cm-scroller": {
      // The theme's mono stack, so code renders in the same face as every other
      // mono surface in the admin. The fallback covers a host that has not
      // loaded the theme.
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      ...(padding === undefined ? {} : { padding }),
    },
    ".cm-content": {
      caretColor: "var(--nx-foreground)",
    },
    ".cm-gutters": {
      borderRight:
        "1px solid color-mix(in srgb, var(--nx-border) 50%, transparent)",
      backgroundColor: "color-mix(in srgb, var(--nx-muted) 30%, transparent)",
      color: "color-mix(in srgb, var(--nx-muted-foreground) 50%, transparent)",
      padding: showGutter ? "0 4px" : "0",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--nx-accent) 10%, transparent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--nx-accent)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--nx-primary) 20%, transparent)",
    },
    // Selection is the one decoration `theme="none"` leaves actively wrong
    // rather than merely unstyled. The base theme picks between its `&light`
    // and `&dark` rules from `EditorView.darkTheme`, which only a bundled theme
    // sets -- so without one it stays light, and its pale fill lands under the
    // light-on-dark token colours in a dark admin.
    //
    // Answered with a token instead of by setting the facet: one rule then
    // serves both modes, which is the same reason there is one highlight style
    // rather than two.
    "::selection": {
      backgroundColor: "color-mix(in srgb, var(--nx-primary) 30%, transparent)",
    },
    ".cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--nx-primary) 25%, transparent)",
    },
    // The base theme raises its own specificity for the focused case, so this
    // has to match that shape to win rather than relying on precedence alone.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor:
          "color-mix(in srgb, var(--nx-primary) 35%, transparent)",
      },
    // Bracket matching replaces the token span rather than decorating it, so
    // the bracket under the caret arrives with no highlight class of its own.
    // Without a colour here it falls back to the editor's foreground and reads
    // as a different character from its own twin two lines down. Unscoped, so
    // it still holds while the editor is not focused.
    ".cm-matchingBracket": { color: codeColor("punctuation") },
    ".cm-nonmatchingBracket": { color: "var(--nx-destructive)" },
    // The fills are scoped exactly as `bracketMatching`'s own base theme scopes
    // them. It ships a hardcoded teal under `&.cm-focused`, and a bare
    // `.cm-matchingBracket` here loses to it on specificity however much
    // precedence this theme has over a base one.
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "color-mix(in srgb, var(--nx-primary) 22%, transparent)",
      outline:
        "1px solid color-mix(in srgb, var(--nx-primary) 45%, transparent)",
    },
    "&.cm-focused .cm-nonmatchingBracket": {
      backgroundColor:
        "color-mix(in srgb, var(--nx-destructive) 18%, transparent)",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--nx-warning) 30%, transparent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "color-mix(in srgb, var(--nx-warning) 50%, transparent)",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "var(--nx-foreground)",
    },
    // The base theme keys thirteen surfaces off `EditorView.darkTheme`, which
    // only a bundled theme sets -- so under `theme="none"` every one of them
    // stays on its light rule. Selection is the one people notice; the search
    // panel, the autocomplete popup and lint tooltips are the rest, and
    // `basicSetup` turns all three on.
    //
    // Enumerated rather than answered by setting the facet, because setting it
    // needs the resolved mode and would put back the branch this module exists
    // to remove. The list is closed rather than a guess: it is every `&light` /
    // `&dark` selector the base theme declares.
    ".cm-panels": {
      backgroundColor: "var(--nx-popover)",
      color: "var(--nx-popover-foreground)",
    },
    ".cm-panels-top": { borderBottom: "1px solid var(--nx-border)" },
    ".cm-panels-bottom": { borderTop: "1px solid var(--nx-border)" },
    ".cm-textfield": {
      backgroundColor: "var(--nx-background)",
      color: "var(--nx-foreground)",
      border: "1px solid var(--nx-input)",
      borderRadius: "var(--radius-sm)",
    },
    ".cm-button": {
      backgroundColor: "var(--nx-secondary)",
      color: "var(--nx-secondary-foreground)",
      backgroundImage: "none",
      border: "1px solid var(--nx-border)",
      borderRadius: "var(--radius-sm)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--nx-popover)",
      color: "var(--nx-popover-foreground)",
      border: "1px solid var(--nx-border)",
      borderRadius: "var(--radius-md)",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "var(--nx-border)",
      borderBottomColor: "var(--nx-border)",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: "var(--nx-popover)",
      borderBottomColor: "var(--nx-popover)",
    },
    ".cm-tooltip-section:not(:first-child)": {
      borderTop: "1px solid var(--nx-border)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--nx-accent)",
      color: "var(--nx-accent-foreground)",
    },
    ".cm-specialChar": { color: "var(--nx-destructive)" },
    "&.cm-focused": {
      // A ring rather than the base theme's hardcoded dotted outline, which is
      // off-token. It cannot be dropped: the wrappers these editors sit in draw
      // a static border and none of them carries a `focus-within` treatment, so
      // removing this leaves a keyboard user nothing but the caret to say which
      // control they are in.
      outline: "2px solid var(--nx-ring)",
      outlineOffset: "-2px",
    },
  });
}
