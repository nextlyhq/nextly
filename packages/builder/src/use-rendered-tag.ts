/**
 * The element the selected node is drawn as, re-read after every commit.
 *
 * Its own module because the panel that USES the answer is not the component
 * that should hold the hook: `StyleInspectorPanel` already carries every style
 * control, and the reader that decides which of them shows a value has no
 * business also owning a subscription to the canvas. The inspector wrapper owns
 * it and passes the answer down, which is the same shape `cascade`,
 * `breakpoints` and `liveBreakpoints` already take — resolved by the wrapper,
 * consumed by the panel.
 *
 * @module use-rendered-tag
 */
import * as React from "react";

import type { EditorState } from "./editor-state";
import { observeRenderedTree } from "./rendered-tree";
import { renderedTagOf } from "./style-subject";

/**
 * OBSERVED rather than merely re-read on a dependency change, because the
 * question is about the DOM and the DOM moves for reasons no prop captures.
 *
 * Three ways it moves, and only the first is a dependency:
 *
 * A block's level changes, so an `h2` becomes an `h1` — that is `document`. The
 * canvas mounts, which happens only once styles have loaded while the inspector
 * stays mounted throughout — that is why this takes the ELEMENT and not a ref,
 * since a ref is not reactive and an effect listing one would read `null` on its
 * first run and never be told otherwise. And a block whose `render` returns a
 * PROMISE commits its Suspense fallback first and its resolved root later,
 * changing nothing at all in this list — the marked element does not exist when
 * the effect runs, and an async block resolving to a heading would report its
 * size as unset forever.
 *
 * Observing the rendered tree answers all three, so the dependency list is a
 * scheduling detail rather than a claim about correctness. WHAT counts as the
 * tree changing lives in `rendered-tree`, shared with the canvas's own marker
 * walk: both ask one question, and two answers to it drift.
 *
 * Read AFTER a commit rather than during a render: the canvas and the inspector
 * re-render together, so while a render body runs the DOM still holds the
 * previous tag.
 */
export function useRenderedTag(
  canvasRoot: HTMLElement | null | undefined,
  selectedId: string | null,
  document: EditorState["document"]
): string | undefined {
  const [tag, setTag] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    // Compared before setting, here and in the observer, or a canvas that
    // mutates on every keystroke re-renders the inspector on every keystroke.
    const read = () => {
      const next = renderedTagOf(canvasRoot, selectedId);
      setTag(current => (current === next ? current : next));
    };
    read();

    if (canvasRoot == null) return;
    return observeRenderedTree(canvasRoot, read);
  }, [canvasRoot, selectedId, document]);
  return tag;
}
