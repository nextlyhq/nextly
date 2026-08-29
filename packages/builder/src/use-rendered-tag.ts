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
import { renderedTagOf } from "./style-subject";

/**
 * Takes the ELEMENT rather than a ref, which is what makes the dependency list
 * honest. A ref is not reactive: the canvas mounts only once styles have loaded
 * while the inspector stays mounted throughout, so an effect listing a ref reads
 * `null` on its first run and is never told otherwise — the tag would stay
 * unknown for the rest of the session, and a heading would report its size as
 * unset exactly as it did before any of this existed.
 *
 * Read AFTER a commit rather than during a render.
 *
 * The canvas and the inspector re-render together, so while a render body runs
 * the DOM still holds the PREVIOUS tag — an author switching a heading from
 * `h2` to `h1` would get the answer for `h2` until something else re-rendered.
 *
 * `document` is a dependency because the tag is a function of the node's props:
 * changing a heading's level changes what it renders without changing which
 * node is selected.
 */
export function useRenderedTag(
  canvasRoot: HTMLElement | null | undefined,
  selectedId: string | null,
  document: EditorState["document"]
): string | undefined {
  const [tag, setTag] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const next = renderedTagOf(canvasRoot, selectedId);
    // Compared before setting, or an effect that runs whenever the document
    // changes and sets unconditionally re-renders on every edit.
    setTag(current => (current === next ? current : next));
  }, [canvasRoot, selectedId, document]);
  return tag;
}
