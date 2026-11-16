/**
 * A container's own content width, as the page compile writes it: one
 * declaration of {@link CONTENT_WIDTH_PROPERTY} in the node's own rule, read
 * from the width the node stores under {@link CONTENT_WIDTH_PROP}.
 *
 * The site sheet's content-width rule reads the property in place of the
 * site's width, and its reset sets it to the site's width on every element of
 * the page (`emitContentWidth`). A custom property inherits, so that reset is
 * what keeps a container's own width to the container: a boxed block inside a
 * container boxed to 1400px still boxes to the site width.
 *
 * Written by the page compile rather than by a renderer, so the engine stays
 * the one writer of a page's CSS: the width is anchored, scoped, held out of
 * the sheet with a gated node and named under the site's token prefix exactly
 * as the node's styles are.
 *
 * @module style/content-width
 */
import type { BlockNode } from "../document";
import { isTokenRef } from "../document-styles";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { checkDimensionValue } from "./css-value-dimensions";
import { isTokenName, tokenCustomProperty } from "./declarations";
import type { CssRule } from "./serialize";
import { pushBoundedWarning, type WarningAllowance } from "./warning-allowance";

/**
 * The custom property the site sheet's content-width rule reads in place of
 * the site's content width.
 *
 * @experimental
 */
export const CONTENT_WIDTH_PROPERTY = "--nx-content-width";

/**
 * The prop a container stores its own content width in: a length or a
 * percentage (`"1400px"`, `"90%"`, `"min(1400px, 100%)"`), or a site variable
 * (`{ $token: "content.wide" }`). Named here, beside the class a contained
 * block wears, because the page compile reads it: a renderer declaring the
 * prop and this compiler reading a literal of its own would be one contract
 * with two spellings.
 *
 * @experimental
 */
export const CONTENT_WIDTH_PROP = "contentWidth";

/**
 * The site variable a node's own content width names, or `undefined` where it
 * names none: for every reader that tracks which variables a page uses (the
 * usage index, an export's references, an import's remapping), so a variable
 * used only here is never counted unused.
 *
 * @experimental
 */
export function contentWidthTokenOf(node: unknown): string | undefined {
  if (!isPlainRecord(node)) return undefined;
  const props: unknown = node.props;
  if (!isPlainRecord(props)) return undefined;
  const stored = props[CONTENT_WIDTH_PROP];
  return isTokenRef(stored) ? stored.$token : undefined;
}

/** The CSS functions a width may be written with. */
const WIDTH_FUNCTIONS = ["calc", "min", "max", "clamp"];

/** Where a node's own width is compiled: its rule's selector and its pointer. */
export interface ContentWidthPlace {
  readonly selector: string;
  readonly path: string;
  readonly tokenPrefix: string;
  readonly warnings: ValidationIssue[];
  readonly warningAllowance: WarningAllowance;
}

/**
 * The CSS a stored width is written as, or a reason it is none. A variable is
 * written as every other token reference is, `var(<prefix><name>)`; one the
 * site has since removed leaves the property invalid, so the content-width
 * rule falls back to the site's width rather than to nothing.
 */
function widthText(
  stored: unknown,
  tokenPrefix: string
): { text: string } | { refused: string } {
  if (isTokenRef(stored)) {
    if (!isTokenName(stored.$token)) {
      return {
        refused: `"${describeValue(stored.$token)}" is not a design-token name`,
      };
    }
    if (stored.times !== undefined) {
      return { refused: "a content width cannot scale its variable" };
    }
    return { text: `var(${tokenCustomProperty(stored.$token, tokenPrefix)})` };
  }
  if (typeof stored === "string") {
    const refused = checkDimensionValue(stored, {
      allowPercentage: true,
      functions: WIDTH_FUNCTIONS,
    });
    if (refused === null) return { text: stored.trim() };
  }
  return { refused: `${describeValue(stored)} is not a width` };
}

/**
 * The rule that gives one node its own content width, or none where it stores
 * none. A stored value that is not a width writes nothing and says so.
 */
export function contentWidthRules(
  node: BlockNode,
  place: ContentWidthPlace
): CssRule[] {
  const props: unknown = node.props;
  if (!isPlainRecord(props)) return [];
  const stored = props[CONTENT_WIDTH_PROP];
  if (stored === undefined || stored === null || stored === "") return [];
  const width = widthText(stored, place.tokenPrefix);
  if ("refused" in width) {
    pushBoundedWarning(place.warningAllowance, place.warnings, {
      path: pointer(pointer(place.path, "props"), CONTENT_WIDTH_PROP),
      code: "invalid-style-value",
      severity: "warning",
      message: `The content width ${width.refused}, so the site's content width applies.`,
      suggestion: 'Use a length such as "1400px", or a site variable.',
    });
    return [];
  }
  return [
    {
      selector: place.selector,
      declarations: [{ property: CONTENT_WIDTH_PROPERTY, value: width.text }],
    },
  ];
}
