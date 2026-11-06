/**
 * How a node's per-device visibility cascades across the site's breakpoints.
 *
 * ONE statement of the rule, because two places ask it and their answers have
 * to be one answer: the style compiler, which turns it into `display: none`
 * bands, and the editor, which shows each device's state and writes a hide
 * that stays on one device. Restated beside the compiler, the editor would
 * show a block visible on a device the published page hides it on.
 *
 * The rule: each axis starts visible at its widest context and reads its
 * contexts in cascade order, widest first. A boolean stored under a context
 * sets the state there and below, until a narrower context stores the other
 * boolean. Anything else stored under a context decides nothing, so the state
 * above carries through it. The two axes never mix: a container breakpoint
 * neither inherits from nor cancels a viewport one, because the two ask about
 * different boxes.
 *
 * @module style/visibility-cascade
 */
import type { BreakpointAxis } from "./breakpoint-axes";

/** What the cascade reads of a breakpoint context. */
export interface CascadeContext {
  readonly id: string;
  /** Absent reads as the viewport axis, which the base context belongs to. */
  readonly axis?: BreakpointAxis;
}

/**
 * Whether the node is visible at each context, in the order given.
 *
 * `contexts` must be in cascade order, as `breakpointContexts` returns them.
 * `devices` is read defensively: it reaches here from storage whether or not
 * anything validated it, and a value that is not a record decides nothing.
 */
export function visibilityCascade(
  devices: unknown,
  contexts: readonly CascadeContext[]
): boolean[] {
  const stored =
    typeof devices === "object" && devices !== null && !Array.isArray(devices)
      ? (devices as Readonly<Record<string, unknown>>)
      : {};
  const current: Record<BreakpointAxis, boolean> = {
    viewport: true,
    container: true,
  };
  return contexts.map(context => {
    const axis = context.axis ?? "viewport";
    // An own property only: a stored record is data, and an id such as
    // `constructor` must not read a prototype member as a stored value.
    const declared = Object.prototype.hasOwnProperty.call(stored, context.id)
      ? stored[context.id]
      : undefined;
    if (typeof declared === "boolean") current[axis] = declared;
    return current[axis];
  });
}
