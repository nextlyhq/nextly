/**
 * Which element a container preset (Section, Box) renders as its root, for an
 * editor saying what the page will hold, such as whether an attribute a
 * search engine reads only on some elements will be read. Asked of the same
 * rule the render functions draw with.
 *
 * @module blocks/container-root
 */
import { rootTagOf } from "./container";

/**
 * The element a container preset renders its root as, from its stored props:
 * `"a"` while a linkable preset is linked, else its tag, and `"div"` for a
 * tag it may not render.
 *
 * @experimental
 */
export function containerRootTag(
  props: Readonly<Record<string, unknown>>,
  linkable: boolean
): string {
  return rootTagOf(props, linkable);
}
