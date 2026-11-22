/**
 * Whether a block's output has the one root element the format asks for, and
 * the reason given when it doesn't: output that draws nothing, a root that
 * is a component or a built-in rather than a host element, and the warning
 * for a root that can't carry the node's attributes.
 *
 * @module block-boundary-root-checks
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { isValidElement, type ReactNode } from "react";

import {
  isAllowedAttribute,
  storedDecoration,
} from "./block-boundary-attributes";
import { createsNoHostElement } from "./renderable";

/**
 * Whether this value is one this renderer can see draws nothing.
 *
 * Answers ONLY for output this renderer owns, and that limit is the design
 * rather than an omission. `normalizeRenderable` materialises an iterable a
 * block returns into a fresh array, so what arrives here is the very object
 * React will render and no author code runs to produce it.
 *
 * The set of primitives is exact rather than a nullish check: `false` is what
 * the ordinary conditional form `enabled && <div />` yields when disabled, and
 * an empty string is what a cleared text value becomes. `0` is deliberately
 * absent — React renders it as the character zero, which is real output with no
 * element to carry the node's fields.
 *
 * An array is walked BY INDEX, which is how React reads one. Following an
 * array's own `Symbol.iterator` would answer a question React never asks, and a
 * custom one can disagree with the indexed contents.
 *
 * Anything reached through an element the block built is NOT judged here. Its
 * children, its props and any iterator inside it belong to the author and are
 * read again by React after this returns, so nothing read from them can be
 * relied on. A block that draws nothing from such a root declares it instead.
 */
function rendersNothing(output: unknown, budget = { left: 10_000 }): boolean {
  // A LIST this renderer owns. `normalizeRenderable` materialises an iterable a
  // block returns into a fresh array, so this walks the very object React will
  // render and no author code runs to produce it.
  //
  // Arrays only, and only owned ones. The array's own `Symbol.iterator` is not
  // used — React renders an array by its indexed contents, and following a
  // custom iterator would answer a question React never asks.
  if (Array.isArray(output)) {
    for (let index = 0; index < output.length; index += 1) {
      // Refusing when the budget runs out answers "it draws", which is the safe
      // direction: it keeps the node's fields refused rather than silently
      // accepting output nobody counted.
      if (budget.left-- <= 0) return false;
      if (!rendersNothing(output[index], budget)) return false;
    }
    return true;
  }
  return (
    output === null ||
    output === undefined ||
    typeof output === "boolean" ||
    output === ""
  );
}

/**
 * Why a node's root-level fields cannot reach the element the block returned.
 *
 * `cssId` and `attributes` are DOM props and only a host element has a DOM root
 * to put them on. A block whose root is a fragment, `StrictMode`, `Suspense` or
 * `Activity` renders no element of its own, so React drops the props — without
 * throwing, and in production without saying anything. What is lost is an
 * anchor target, a `label for=`, an `#id` selector: navigation and styling that
 * silently stop working, on a page that otherwise looks correct.
 *
 * So the combination is refused rather than half-applied. It is only reachable
 * when the document actually asked for those fields, so an ordinary block
 * returning a fragment is untouched.
 */
export function nodeRootReason(
  output: ReactNode,
  node: BlockNode,
  /**
   * Whether the block DECLARED that these props draw nothing.
   *
   * The sound channel, and now the only one that covers a wrapper. It is
   * computed from the node's props — data this renderer already holds — rather
   * than by inspecting a structure the block handed back and still controls.
   * That distinction is the whole point: an inspected structure is re-read by
   * React afterwards, and every accessor, proxy trap and custom iterator in it
   * can answer differently the second time.
   */
  declaresNothing: boolean,
  /**
   * How the output was classified, read ONCE by the caller.
   *
   * Passed in rather than read again here. The warning above asks the same
   * question of the same value, and a second reading is a second chance for an
   * author-controlled accessor to answer differently — which for this policy
   * means throwing on a path with no guard over it, taking the page instead of
   * producing the placeholder this function exists to produce.
   */
  shape: RootShape
): string | null {
  const hasCssId = typeof node.cssId === "string";
  const attributes = node.attributes;
  // Counted by what would actually be WRITTEN, not by what is stored. The
  // render path drops names outside the allowlist and non-string values, so a
  // node whose only attributes are `style` or an `onClick` loses nothing by
  // having no DOM root — refusing it would placeholder a working block over
  // fields that were never going to appear.
  const hasAttributes =
    typeof attributes === "object" &&
    attributes !== null &&
    !Array.isArray(attributes) &&
    Object.entries(attributes).some(
      ([name, value]) => isAllowedAttribute(name) && typeof value === "string"
    );
  // The "never quote this" mark, read as the element's attributes are
  // assembled, so the guard and the render agree on whether there is one.
  const marked = storedDecoration(node).nosnippet;
  if (!hasCssId && !hasAttributes && !marked) return null;
  // Rendering NOTHING is a decision, not a failure, and the two must not share
  // an answer. `core/image` with no usable source returns null on purpose —
  // an `<img>` with no `src` re-requests the current page in some browsers —
  // and an author who set an anchor on it has lost the anchor either way. The
  // difference is that a placeholder ALSO reports a working block as broken,
  // and in production that is an invisible marker nobody ever sees.
  //
  // So a block may legitimately render nothing. That is a contract for every
  // block, including ones written outside this package, rather than a special
  // case for the two here that need it today.
  //
  // Every value React draws as nothing counts, not just the nullish pair.
  // `render: () => enabled && <div />` yields `false` when disabled and is the
  // ordinary way to write a conditional block; `""` reaches the same place from
  // a cleared text value. Verified against React 19: `null`, `undefined`,
  // `false`, `true` and `""` all render empty, while `0` renders "0" and is
  // therefore real output with a root.
  // Two ways to be exempt, and neither reads anything the block can change
  // between now and React's own read.
  //
  // The block SAYS so, from its props. Or the output is a value this renderer
  // OWNS: a primitive React draws as nothing, or an array the normalizer
  // materialised, walked by index exactly as React walks it.
  //
  // Deliberately NOT by opening what the block returned. A wrapper's children, a
  // provider's `value`, an element's `key` and `ref`, an iterable's iterator —
  // every one of them is author-controllable, and React reads them AGAIN after
  // this returns. An exemption granted on a reading React need not repeat is one
  // the author can invalidate afterwards, so it is not granted at all. A block
  // that legitimately draws nothing from a wrapper root says so through
  // `rendersNothing`, which is computed from props and cannot vary.
  if (declaresNothing || rendersNothing(output)) return null;
  const noRoot = noHostRootReason(shape);
  if (noRoot === null) return null;
  const named = hasCssId
    ? "`cssId`"
    : hasAttributes
      ? "attributes"
      : "the `nosnippet` mark";
  // A primitive or a list, on the other hand, is real output with no single
  // element to carry the fields, so it loses them anyway — silently, and with
  // the same broken anchors as a wrapper root. The format says a block renders
  // a single element for these to target.
  return `a node carrying ${named} whose block ${noRoot}, so there is no DOM root to put them on`;
}

/**
 * Why this output gives the node no single host element, or `null` when it does.
 *
 * The SHAPE question alone, separated from what the document asked for, because
 * two readers need it and they must not answer it apart: the placeholder above
 * decides whether root fields can land, and the warning below tells a block
 * author their block does not conform at all. A second copy would let the two
 * disagree about the same output.
 *
 * Asked of what the boundary RECEIVED, never of what a definition predicts.
 * A prediction is a second model of a thing this function already knows
 * first-hand, and the two drift; the artifact is the only witness.
 */
function noHostRootReason(shape: RootShape): string | null {
  switch (shape) {
    case "host":
      return null;
    case "none":
      return "returned no element";
    case "builtin":
    case "component":
      return "returned a wrapper rather than an element";
  }
}

/**
 * What KIND of root a block's output gives the node.
 *
 * The classification itself, held ONCE, because two policies read it and must
 * not classify apart. The placeholder above decides whether root fields can
 * land; the warning below decides whether to tell an author their block is
 * broken. Those are different questions with opposite safe directions — each
 * says which, beside itself — but they are the same READING, and a second copy
 * of the reading is where recognising another wrapper kind updates one answer
 * and leaves the other behind.
 *
 * Asked of what the boundary RECEIVED, never of what a definition predicts. A
 * prediction is a second model of something this already knows first-hand, and
 * the two drift; the artifact is the only witness.
 */
type RootShape = "host" | "component" | "builtin" | "none";

function rootShapeOf(output: ReactNode): RootShape {
  if (!isValidElement(output)) return "none";
  // A string type is a host element, and the only shape that HAS a root.
  if (typeof output.type === "string") return "host";
  /*
   * React's own wrappers — a fragment, a suspense boundary, a context provider
   * or consumer — create no element of their own, so none of them is a root the
   * generated class can be attached to. Whether the block forwarded that class
   * to a child is a separate question, and not one this classification answers.
   *
   * ASKED rather than restated. `renderable.ts` already separates those from
   * `memo`, `forwardRef` and `lazy`, which wrap a component that may well
   * render a host element and forward the class to it; a second reading of the
   * same tags here is where the two would come to disagree.
   */
  if (createsNoHostElement(output.type)) return "builtin";
  /*
   * Everything else is a COMPONENT, which cannot be called broken: it may
   * render a host element and forward `className`, and only calling it would
   * say. That is deliberate under-reporting, and the cheaper error for a
   * diagnostic — a warning that is sometimes false is one people learn to
   * scroll past.
   */
  return "component";
}

/**
 * {@link rootShapeOf} with a floor under it, called ONCE per block root.
 *
 * The classification touches `output.type` and the tag on the type object, both
 * author-controlled, and both readable more than once with different answers: a
 * getter that counts, a proxy that flips. Reproduced against React 19 with a
 * context-tagged type whose `$$typeof` accessor throws on its seventh read —
 * the read the placeholder path made, which had no guard, so the throw left
 * this package entirely and the stream never settled. Not "the page shows an
 * error": nothing resolved at all.
 *
 * So the reading happens here, once, and both policies are handed the result.
 * `unreadable` is a real answer rather than an exception, and the caller turns
 * it into the placeholder every other unusable output already gets — the same
 * direction `isRenderableElementType` takes for a type React would refuse:
 * refusing something valid shows up as a placeholder, accepting something
 * invalid takes the page.
 */
export function readRootShape(output: ReactNode): RootShape | "unreadable" {
  try {
    return rootShapeOf(output);
  } catch {
    return "unreadable";
  }
}

/**
 * Why this output is DEFINITELY not the single element the contract asks for,
 * or `null` when it might be.
 *
 * Deliberately NARROWER than {@link noHostRootReason}, and the difference is
 * the point rather than a duplication of it. That one asks whether the renderer
 * may attach root fields, and answers no for a component root because it cannot
 * know the component forwards them — conservative in the direction of refusing,
 * which is right when an anchor is at stake.
 *
 * This one asks whether to tell an author their block is broken, where the safe
 * direction is the opposite. A component that renders one host element and
 * forwards `className` is a legitimate shape whose compiled styles DO apply, so
 * warning about it would be false, and a diagnostic that is sometimes false is
 * one people learn to scroll past. Only shapes with no root element of their
 * own are named: no element, or a wrapper.
 *
 * Naming a shape is not a claim that its styles are lost. A wrapper root can
 * still forward the class to a child, and the warning above says so — what it
 * reports is the shape, which is outside the contract whatever the block did
 * with the class.
 */
function brokenRootReason(shape: RootShape): string | null {
  switch (shape) {
    // A COMPONENT is not broken: one that renders a host element and forwards
    // `className` gets its compiled styles applied. The placeholder still
    // refuses to attach root fields to it, not being able to know that — which
    // is the one place these two policies part company.
    case "host":
    case "component":
      return null;
    case "none":
      return "returned no element";
    case "builtin":
      return "returned a wrapper rather than an element";
  }
}

/**
 * Tells a BLOCK AUTHOR, in development, that their block does not conform.
 *
 * `BlockRenderArgs.className` states the contract every block is handed: "The
 * generated class the block MUST place on its own root element. Blocks render a
 * single element and never wrap it, so styles target that element." A block
 * returning a Fragment, a list or a primitive gives that class no root element
 * to sit on — it is already outside the contract, and nothing said so.
 *
 * NOT "its styles never apply", which is the stronger claim and is false for
 * one real shape: a wrapper whose child takes the class renders it into the
 * DOM, and the compiled CSS then matches normally. What that block loses is the
 * node's ROOT FIELDS, which `withNodeAttributes` attaches and have nowhere to go — so the
 * warning is right and the diagnosis has to be the narrower one.
 *
 * The only signal today arrives through the placeholder above, which fires when
 * a DOCUMENT asks for `cssId` or an attribute. That blames the wrong party at
 * the wrong time: a page author sets an anchor and watches the block vanish,
 * having done nothing wrong, while the block author never hears about it. This
 * fires on the first render instead, whether or not anyone asked for anything.
 *
 * NOT deduplicated by type. A module-scoped set would either couple one test's
 * warning to another's or need a reset API exported for tests to call, and this
 * fires only for a block that is already broken — which in development is one
 * or two instances on screen, not a page full. If that stops being true,
 * deduplicating is a change with its own reset rather than hidden state added
 * to this one.
 *
 * A warning is not an EXEMPTION, which is why reading the output here is safe
 * where granting one from it would not be: nothing about the render changes,
 * so a reading React need not repeat can at worst produce a wrong message.
 */
export function warnNoHostRoot(
  output: ReactNode,
  node: BlockNode,
  declaresNothing: boolean,
  /** How the output was classified, read once by the caller. */
  shape: RootShape
): void {
  /*
   * Speaks only where the environment is POSITIVELY identified as one a
   * developer is watching. Read at render rather than module scope, so a
   * consumer's bundler can inline it per build and a test can exercise several
   * environments in one process.
   *
   * Everything else stays silent, which is the opposite of how the placeholder
   * reads the same signal and deliberately so: a placeholder is a visible box
   * on a block that is already broken, while this is an undeduplicated line on
   * every render of every affected block. Unable to tell, a diagnostic says
   * nothing.
   *
   * Being unable to tell has more than one shape, which is what a check for
   * `process === undefined` missed. This renderer runs anywhere React does: an
   * Edge or Worker runtime need not define `process`, a standalone SSR host can
   * expose a partial shim with no `NODE_ENV`, and a deployment may name its
   * environment something this does not recognise. Asking which environments
   * may speak covers all of them at once; asking which must stay quiet is a
   * list, and a list falls behind toward noise in production.
   *
   * The cost is a bare harness that sets no `NODE_ENV` hearing nothing. For an
   * advisory diagnostic that is the cheaper error: a miss costs the report,
   * while a false one in production teaches everyone to filter the message.
   */
  try {
    /*
     * Read INSIDE the guard, because reading it is itself author-exposed. A
     * standalone SSR host supplies its own `process`, and `env` can be a
     * throwing getter or a proxy — so `process.env?.NODE_ENV` raises before a
     * `try` placed after it ever begins. The synchronous call to
     * `checkedOutput` sits PAST the try that contains `render`, as the comment
     * at that call site says, so a raise here does not become a placeholder: it
     * takes the page. An advisory diagnostic aborting the render is the exact
     * thing this function promises not to do.
     *
     * Failing to read it lands in the catch below and says nothing, which is
     * the same answer the checks below give any environment that cannot be
     * positively identified. Unable to tell, a diagnostic stays quiet.
     */
    const environment =
      typeof process === "undefined" ? undefined : process.env?.NODE_ENV;
    if (environment !== "development" && environment !== "test") return;
    // Rendering nothing is a DECISION, not a violation — the same exemption the
    // placeholder grants, asked the same way.
    if (declaresNothing || rendersNothing(output)) return;
    const broken = brokenRootReason(shape);
    if (broken === null) return;
    /*
     * Says what is CERTAIN and nothing more. The class is handed to the block
     * rather than attached by the boundary, so a wrapper root that forwards it to a child
     * — `({ className }) => <><div className={className} /></>` — does get its
     * compiled styles, on a page whose DOM carries the class. Telling that
     * author their styles do not apply sends them hunting a failure that is not
     * there, and a diagnostic people find wrong once is one they stop reading.
     *
     * What IS certain either way: the shape is outside the contract, the node
     * has no root element of its own, and its root fields therefore have
     * nowhere to go. The style consequence is stated as the condition it
     * actually is.
     */
    console.warn(
      `[nextly] Block "${node.type}" ${broken}. Blocks render a single element and never wrap it: with no root element of its own, this block's styles apply only where the block itself placed the class, and setting an id or an attribute on the node will replace it with a placeholder.`
    );
  } catch {
    /*
     * A DIAGNOSTIC must never be the thing that fails the page, and this call
     * sits past the try block that contains `render`.
     *
     * It no longer covers the CLASSIFICATION, which was the exposure it was
     * written for: that is read once by {@link readRootShape}, under its own
     * floor, and arrives here as a value. What it covers now is the environment
     * read above, `rendersNothing` over an array this renderer materialised,
     * and the `console` call itself.
     */
  }
}
