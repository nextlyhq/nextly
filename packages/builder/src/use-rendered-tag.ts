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
  canvasRoot: { readonly current: HTMLElement | null } | undefined,
  selectedId: string | null,
  document: EditorState["document"]
): string | undefined {
  const [tag, setTag] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const next = renderedTagOf(canvasRoot?.current, selectedId);
    // Compared before setting, or an effect that runs on every commit and sets
    // unconditionally re-renders on every commit.
    setTag(current => (current === next ? current : next));
  }, [canvasRoot, selectedId, document]);
  return tag;
}
