/**
 * When the rendered tree has changed, in one definition.
 *
 * The canvas draws a document React commits over time rather than all at once,
 * and two separate readers need to know when that drawing moved: the inspector,
 * which reads the element a node was drawn as, and the canvas itself, which
 * marks the selection and the interaction state onto those elements. Both ask
 * the same question, so both subscribe through here.
 *
 * A dependency list cannot answer it. A block whose `render` returns a promise
 * commits its Suspense fallback first and its resolved root later, and that
 * second commit changes no prop, no state and no id — `core/collection-loop`
 * awaits `data.find`, so this is an ordinary shipping block rather than an edge
 * case. A reader keyed on props alone sees the fallback, finds none of the
 * elements it was looking for, and never looks again.
 *
 * A plain function rather than a hook, because the two callers schedule
 * differently — one owns React state, the other writes to the DOM — and only
 * the subscription is common. Making it a hook would force one scheduling shape
 * onto both and put a spread dependency list in each.
 *
 * @module rendered-tree
 */
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

/**
 * What counts as the rendered tree changing.
 *
 * Structure, because that is how a resolved block arrives. The node id
 * ATTRIBUTE as well, because a node's id moving between elements changes which
 * element every reader here is talking about while adding and removing none.
 *
 * No other attribute, and that is load-bearing rather than economical. Both
 * callers WRITE to elements inside the tree they observe — the marker walk sets
 * the selection attribute and the state class — so an observer that watched
 * attributes broadly would be triggered by its own output and re-enter for as
 * long as the canvas is mounted. The node id is written by the renderer and by
 * nothing that reads it here, which is what makes it safe to watch.
 */
const RENDERED_TREE_MUTATIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributeFilter: [NODE_ID_ATTRIBUTE],
};

/**
 * Call `read` whenever the rendered tree under `root` changes.
 *
 * Returns the unsubscribe. Callers are expected to `read()` once themselves
 * first: an observer reports changes from the moment it is attached and says
 * nothing about the tree that is already there.
 *
 * `MutationObserver` is absent in some non-browser DOMs, and both callers are
 * useful without it — each still reads on the changes that ARE dependencies.
 * Guarded rather than assumed, because throwing here would take the editor down
 * on a surface that otherwise renders perfectly well.
 */
export function observeRenderedTree(
  root: Element,
  read: () => void
): () => void {
  if (typeof MutationObserver !== "function") return () => undefined;
  const observer = new MutationObserver(read);
  observer.observe(root, RENDERED_TREE_MUTATIONS);
  return () => {
    observer.disconnect();
  };
}
