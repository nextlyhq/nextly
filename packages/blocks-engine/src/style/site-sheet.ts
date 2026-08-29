// The stylesheet a whole site shares, compiled once.
//
// A page's own sheet carries what only that page knows: its settings and each node's own values.
// Everything above that — the design tokens, the self-hosted fonts, the named classes, the block
// types' defaults — is the same bytes on every page of the site. Inlining it per page repeats it
// on every request; compiling it once gives one cacheable artifact addressed by its content.
//
// The tiers here are emitted by `compilePageCss`, not by a second emitter written beside it. That
// is the load-bearing choice. The site sheet and a page's sheet have to agree exactly about what
// a class or a block default looks like — one specificity, one order, one set of bytes — and two
// emitters agree only until someone edits one of them. Feeding the page compiler a document that
// uses every type and styles nothing keeps the guarantee structural rather than remembered.
//
// @module style/site-sheet

import type { BlockDocument, BreakpointSet, NodeStyles } from "../document";
import type { ValidationIssue } from "../validation";

import { compilePageCss } from "./compile-page";
import type { MayFetchUrl } from "./css-value";
import type { NamedClass } from "./named-class";
import { hashId } from "./node-class";
import type { FontFaceDef, SiteTokenSet } from "./site-tokens";
import { emitFontFaces, emitTokenBlocks } from "./site-tokens";

/** Everything the shared sheet is built from. All of it is site configuration, not document content. */
export interface SiteSheetInput {
  /** The site's design tokens, emitted as custom properties. */
  tokens?: SiteTokenSet;
  /** Self-hosted font faces. Remote sources are refused by `validateFontFace`, not here. */
  fonts?: readonly FontFaceDef[];
  /** The named-class library, emitted in library order. */
  classes?: readonly NamedClass[];
  /** Each block type's default look, keyed by type. */
  blockBases?: Readonly<Record<string, NodeStyles>>;
  /** The site's breakpoints, which decide the at-rules every tier is emitted under. */
  breakpoints: BreakpointSet;
  /** The custom-property prefix tokens are written under. */
  tokenPrefix?: string;
  /**
   * Which hosts this site will fetch from.
   *
   * The class and block-default tiers are emitted VERBATIM into every page of
   * the site, and a declaration is a fetching surface: one stored
   * `background-image: url(...)` is a request every visitor of every page
   * makes. A page's own sheet is compiled with this policy already; without it
   * here, the two sheets judged the same value differently, and the site sheet
   * is emitted FIRST — a page sheet that merely omits a declaration cannot
   * retract one.
   *
   * Left undefined, no host question is asked and the compile behaves as it
   * did before this existed. That is unasked rather than allowed: an empty
   * allowlist would be the opposite answer.
   *
   * No `fetchPolicyId` counterpart, unlike the page compile. That stamp exists
   * so a reader can tell whether a STORED sheet was compiled under other
   * rules; this artifact is compiled per render and addressed by the hash of
   * its own bytes, so a policy that changes what is emitted changes the hash
   * and cannot be mistaken for the old sheet.
   */
  mayFetchUrl?: MayFetchUrl;
  /**
   * Emit viewport breakpoints as container queries against this container, for
   * a surface previewing the page in a resizable box.
   *
   * Carried so this tier answers the breakpoint question the same way the page
   * tier does. See {@link BreakpointContextOptions.previewContainer}.
   */
  previewContainer?: string;
  /**
   * Emit each interaction state so a previewing surface can force one.
   *
   * Carried through for the same reason `previewContainer` is: a named class
   * and a block-type default are compiled HERE, not with the page, so an editor
   * that asked the page compile for forceable states and not this one gets a
   * selected block whose hover appearance comes from a class showing nothing at
   * all. The tiers split across two sheets; the option must not.
   */
  previewStates?: boolean;
}

/** The shared sheet and the name it is addressed by. */
export interface SiteSheetArtifact {
  css: string;
  /**
   * A stable name for these exact bytes.
   *
   * Same input, same hash, on every machine and every run: it is computed from the emitted CSS
   * rather than from the inputs, so a change that does not alter a single byte of output does not
   * invalidate a cache, and one that does cannot fail to.
   *
   * Not a cryptographic digest, and not used as one. A collision would serve a stale sheet, which
   * is a caching fault rather than a safety one, and 53 bits is far past what a site's lifetime
   * of revisions can reach.
   */
  contentHash: string;
  /** What was left out of the sheet, and why. */
  warnings: ValidationIssue[];
}

/**
 * The selector site tokens are declared on.
 *
 * `:root` rather than the page root, because tokens are read by everything on the document —
 * including admin surfaces and any markup outside a compiled page — and a custom property is
 * inherited from wherever it is declared. Scoping them to the page root would leave a token
 * unreadable to anything the compiler did not write.
 */
const TOKEN_SELECTOR = ":root";

/**
 * A document that uses every block type and styles nothing itself.
 *
 * `compilePageCss` emits a type's default only for a type present in the document, which is right
 * for a page and wrong for a site sheet: the sheet is shared, so it carries every default the
 * caller supplied. One styleless node per type says exactly that, and contributes no rules of its
 * own — a node with no `styles` and no `visibility` emits nothing.
 */
function documentUsingEveryType(
  blockBases: Readonly<Record<string, NodeStyles>>
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: Object.keys(blockBases)
      .sort()
      .map((type, index) => ({
        id: `site-sheet-${index}`,
        type,
        version: 1,
        props: {},
      })),
  } as unknown as BlockDocument;
}

/**
 * Compile the stylesheet every page of a site shares.
 *
 * Order is the cascade, so it is fixed: font faces, then tokens, then the block-type defaults,
 * then the named classes. A page's own sheet is appended after this one, which is what lets a
 * node's own value beat a class and a class beat a block default.
 */
export function compileSiteSheet(input: SiteSheetInput): SiteSheetArtifact {
  const warnings: ValidationIssue[] = [];
  const blocks: string[] = [];

  const fonts = emitFontFaces(input.fonts ?? []);
  warnings.push(...fonts.issues);
  if (fonts.css !== "") blocks.push(fonts.css);

  // ONE prefix, used to declare the custom properties and to reference them.
  //
  // The two halves read it from different places — `emitTokenBlocks` from the token set, the
  // style compiler from its context — and a site that set one and not the other declared
  // `--site-color-primary` while its pages asked for `var(--brand-color-primary)`. Nothing
  // errors: the reference resolves to nothing and the value silently does not apply. Deriving it
  // once here is what makes that impossible rather than merely unlikely.
  const tokenPrefix = input.tokenPrefix ?? input.tokens?.prefix;

  if (input.tokens !== undefined) {
    const tokens = emitTokenBlocks(
      {
        ...input.tokens,
        ...(tokenPrefix === undefined ? {} : { prefix: tokenPrefix }),
      },
      TOKEN_SELECTOR
    );
    warnings.push(...tokens.issues);
    if (tokens.css !== "") blocks.push(tokens.css);
  }

  const blockBases = input.blockBases ?? {};
  const tiers = compilePageCss(documentUsingEveryType(blockBases), {
    breakpoints: input.breakpoints,
    blockBases,
    namedClasses: input.classes ?? [],
    ...(tokenPrefix === undefined ? {} : { tokenPrefix }),
    ...(input.mayFetchUrl === undefined
      ? {}
      : { mayFetchUrl: input.mayFetchUrl }),
    // The SAME breakpoint emission the page tier uses. Compiled without it, the
    // shared classes and block defaults answer the published question while the
    // node-local declarations beside them answer the preview one — so a
    // container-axis rule from this sheet can match a real authored container
    // while the node's own rule at that breakpoint is aimed at a name nothing
    // carries. One document, two answers to one breakpoint.
    ...(input.previewContainer === undefined
      ? {}
      : { previewContainer: input.previewContainer }),
    ...(input.previewStates === true ? { previewStates: true } : {}),
  });
  warnings.push(...tiers.warnings);
  if (tiers.css !== "") blocks.push(tiers.css);

  const css = blocks.join("\n");
  return { css, contentHash: hashId(css), warnings };
}
