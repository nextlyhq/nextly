// The two axes a breakpoint can respond to, in the order their rules are written.
//
// A page can be responsive to the viewport and to a container at the same time, and both sets of
// rules are emitted at one specificity. So which axis is written LAST is the whole of the rule for
// which one wins, and it is not derivable from anything else: it is a choice, made once.
//
// Container last, because a container query describes the space a block was actually given, which
// is the more local fact. A block placed in a narrow sidebar should lay out for that sidebar even
// on a wide screen, and reversing these would let the viewport rule overrule it.
//
// Stated here rather than inline in the emitter, so the precedence is a fact about the document
// model that can be read without reading the loop that walks it.

/** The breakpoint axes, ordered so a later axis overrides an earlier one. */
export const BREAKPOINT_AXES = ["viewport", "container"] as const;

/** Which axis a breakpoint responds to. */
export type BreakpointAxis = (typeof BREAKPOINT_AXES)[number];
