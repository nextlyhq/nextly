/**
 * Previewing a value while the pointer is still down, and committing once.
 *
 * A scrub is two different operations wearing one gesture. Dragging must show
 * the result immediately and cost nothing per frame; releasing must produce a
 * single undoable edit. Doing both through the document would recompile a
 * stylesheet on every pointer move and push an undo entry for each — so the
 * drag writes CSS and only the release writes the document.
 *
 * **The preview is compiled, not formatted.** `compileStyleValues` is the same
 * function the published stylesheet is emitted through, so a token reference
 * becomes the same `var()`, a composite expands to the same logical properties,
 * and a value the compiler refuses produces no declarations here either. Writing
 * `${property}: ${value}` by hand would be a second emission path, and the two
 * would disagree exactly where emission is interesting.
 *
 * **A refused value never reaches the screen.** The compiler validates before it
 * writes, so the preview and the commit accept exactly the same values — by
 * construction rather than by both remembering to check.
 *
 * **The rule sits at the compiler's own specificity and wins on ORDER.** It is
 * anchored to `PAGE_ROOT_SELECTOR`, which is where the override contract lives;
 * spelling a stronger selector here would quietly raise that contract for the
 * duration of a drag, so the preview would land where the committed value will
 * not. The consequence for the host is that the element holding this text must
 * come AFTER the compiled sheet — later of two equals wins — and removing it on
 * commit reveals the real rule underneath with no visible change.
 *
 * @module style-scrub
 */

import {
  compileStyleValues,
  PAGE_ROOT_SELECTOR,
  type Declaration,
  type StyleValue,
  type ValidationIssue,
} from "@nextlyhq/blocks-engine";

import type { StyleAddress, StyleWrite } from "./style-values";
import { styleWriteOp } from "./style-values";

/** The node a scrub is previewing against. */
export interface ScrubTarget {
  readonly nodeId: string;
  /**
   * The class the compiler emitted for this node.
   *
   * Supplied rather than derived from the id. `nodeClassName` cannot see a hash
   * collision — only `nodeClassNames`, which reads the whole document, can — so
   * a target that hashed the id itself would preview against the wrong node on
   * exactly the documents where the compiler had already disambiguated.
   */
  readonly nodeClass: string;
  readonly address: StyleAddress;
}

/** CSS for the value under the pointer, or the reasons it was refused. */
export type ScrubPreview =
  | { readonly ok: true; readonly css: string }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * The rule text for one node's declarations, one rule per declaration.
 *
 * Deliberately NOT grouped by descendant. The compiler groups because it
 * serializes a whole document and a stable, compact sheet matters there; a
 * preview carries the declarations of a single leaf, which share one selector
 * anyway, and separate rules at equal specificity cascade identically to one
 * merged rule. Repeating the grouping here would be a second copy of a function
 * the engine already has, kept in step by nothing.
 */
function ruleText(
  nodeClass: string,
  declarations: readonly Declaration[]
): string {
  return declarations
    .map(declaration => {
      const descendant =
        declaration.descendant === undefined
          ? ""
          : ` ${declaration.descendant}`;
      return (
        `${PAGE_ROOT_SELECTOR} .${nodeClass}${descendant} ` +
        `{ ${declaration.property}: ${declaration.value} }`
      );
    })
    .join("\n");
}

/**
 * The stylesheet text that shows `value` without touching the document.
 *
 * Only the scrubbed property is compiled. Everything else the node carries
 * still comes from the sheet underneath, so a preview of one side of a margin
 * does not restate — and cannot accidentally drop — the other three.
 */
export function scrubPreviewCss(
  target: ScrubTarget,
  value: StyleValue
): ScrubPreview {
  const { property, path } = target.address;
  const compiled = compileStyleValues(
    { [property]: valueAtPath(path, value) },
    ""
  );
  // The compiler reports only what it REFUSED, and refuses the whole map when
  // it cannot check it. So anything reported means this value is not one the
  // published page would carry, and previewing it would show the author a
  // result they cannot keep.
  if (compiled.warnings.length > 0) {
    return { ok: false, issues: compiled.warnings };
  }
  if (compiled.declarations.length === 0) {
    return { ok: false, issues: [] };
  }
  return { ok: true, css: ruleText(target.nodeClass, compiled.declarations) };
}

/**
 * A value wrapped in the containers its path names.
 *
 * A control scrubbing one side of a margin holds a length and an address; the
 * compiler takes the property's whole value. Building the containers here keeps
 * the preview compiling the same shape the commit will store.
 */
function valueAtPath(path: readonly string[], value: StyleValue): StyleValue {
  let wrapped = value;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    wrapped = { [path[index]]: wrapped };
  }
  return wrapped;
}

/**
 * The single op that ends a scrub.
 *
 * Separate from the preview and deliberately not derived from it: the preview
 * is CSS the canvas throws away, and the commit is a document edit. Passing one
 * through the other would make the stored value a function of a string that was
 * built for display.
 */
export function scrubCommitOp(
  target: ScrubTarget,
  styles: Parameters<typeof styleWriteOp>[1],
  value: StyleValue
): StyleWrite {
  return styleWriteOp(target.nodeId, styles, target.address, value);
}
