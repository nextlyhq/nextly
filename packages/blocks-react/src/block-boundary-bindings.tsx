/**
 * What a block boundary threads to each block beside the page context: the
 * page's bound values and how a list item's bindings are filled, what the
 * render decided about conditioned blocks, which of a list's nodes draw, and
 * the rules a list serves beside the first item that shows a decided block.
 *
 * @module block-boundary-bindings
 */
import type {
  BindingFieldShape,
  BindingRun,
  BlockNode,
  BoundValues,
  ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";

import { fillItemBindings } from "./blocks/list-batch";
import type { PageContext, PageIssue } from "./context";
import { styleTextForInjection } from "./styles";
import { conditionAllows, itemFields } from "./visibility";

/**
 * What the boundary needs to hand each block its bound values, and to fill a
 * list item's bindings while the list draws it.
 */
export interface BoundaryBindings {
  /** The render's binding pass, shared with the page's. */
  readonly run: BindingRun;
  /** What the page's pass filled, by node id. */
  readonly bound: ReadonlyMap<string, BoundValues>;
  /** Where a list item's binding and condition problems go, once each. */
  readonly report: (issues: readonly PageIssue[]) => void;
}

/**
 * What a render decided about its conditioned blocks, threaded to every
 * boundary whether or not the page has bindings to fill: a page drawn with
 * list data and no bindings still decides its items' conditions, and still
 * serves the rules of the blocks they show.
 */
export interface BoundaryConditions {
  /**
   * The blocks whose visibility conditions held for the page's entry, by id,
   * as the route decided them once it read the entry. Carried here, beside
   * the context rather than on it, as everything a render threads down is.
   */
  readonly held?: ReadonlySet<string>;
  /** Where a list item's condition problems go, once each. */
  readonly report?: (issues: readonly PageIssue[]) => void;
  /**
   * The rules of each block a list's item decides, with those of every block
   * inside it, by the decided block's id, held out of the page's sheet: a
   * list serves them beside the first instance it draws, so a block no item
   * shows publishes none of them.
   */
  readonly itemRules?: ReadonlyMap<string, string>;
  /** The decided blocks whose rules this render already served, by id. */
  readonly itemRulesServed?: Set<string>;
  /** What an editor draws in place of a block a list's item hides. */
  readonly hiddenAs?: ItemHiddenAs;
}

/**
 * What an editor draws in place of a block a list's item hides: the node to
 * draw there, or nothing to draw nothing. Told the item, so what it draws can
 * say why that item hides the block.
 *
 * @experimental
 */
export type ItemHiddenAs = (
  node: BlockNode,
  item: HidingItem
) => BlockNode | undefined;

/**
 * The list item that hides a block: its values, the collection its entries
 * come from (absent for a named query's row), and the fields its conditions
 * were judged by, as the public reads them (absent where none are known, so
 * they failed closed).
 *
 * @experimental
 */
export interface HidingItem {
  readonly values: Readonly<Record<string, unknown>>;
  readonly collection: string | undefined;
  readonly fields: readonly BindingFieldShape[] | undefined;
}

interface DrawnNode {
  readonly node: BlockNode;
  /** False for what an editor draws in place of a hidden block. */
  readonly shown: boolean;
}

/**
 * The nodes a list draws, each as its conditions allow: shown, or, where an
 * item hides it and the render was told what to draw instead, that in its
 * place. Without that, a hidden block is simply left out.
 */
export function drawnNodes(
  nodes: readonly BlockNode[],
  context: PageContext,
  conditions: BoundaryConditions | undefined
): DrawnNode[] {
  const decided = {
    ...(conditions?.held === undefined ? {} : { held: conditions.held }),
    ...(conditions?.report === undefined ? {} : { report: conditions.report }),
  };
  const { item } = context;
  const hiddenAs = item === undefined ? undefined : conditions?.hiddenAs;
  const hiding: HidingItem | undefined =
    item === undefined
      ? undefined
      : {
          values: item,
          collection:
            context.itemSource === "" ? undefined : context.itemSource,
          // The very fields the item's conditions were just judged by, a
          // named query's own row schema among them, so what is drawn in
          // the block's place says what that judgement found.
          fields: itemFields(context),
        };
  return nodes.flatMap((node): DrawnNode[] => {
    if (conditionAllows(node, context, decided)) return [{ node, shown: true }];
    const instead = hiding === undefined ? undefined : hiddenAs?.(node, hiding);
    return instead === undefined ? [] : [{ node: instead, shown: false }];
  });
}

/**
 * The rules of a block a list's item decides, once per render, beside the
 * first instance drawn. Inline, after the page's own sheet, so the cascade
 * reads them in the order a stored sheet would have held them.
 */
export function itemRulesFor(
  id: string,
  conditions: BoundaryConditions | undefined
): ReactNode {
  const rules = conditions?.itemRules?.get(id);
  const served = conditions?.itemRulesServed;
  if (rules === undefined || served === undefined || served.has(id)) {
    return null;
  }
  served.add(id);
  return (
    <style
      data-nx-item-rules={id}
      dangerouslySetInnerHTML={{ __html: styleTextForInjection(rules) }}
    />
  );
}

/**
 * A node with its list item's bindings filled, and what every bound prop of
 * it holds.
 *
 * The page's bindings were filled before rendering began; an item's can only
 * be filled here, where the item being drawn is on the context. A node with no
 * item binding comes back as it is.
 */
export function withItemBindings(
  node: ResolvedBlockNode,
  context: PageContext,
  bindings: BoundaryBindings | undefined
): { node: ResolvedBlockNode; bound: BoundValues | undefined } {
  if (bindings === undefined) return { node, bound: undefined };
  const fromPage = bindings.bound.get(node.id);
  // The one fill a list's read-ahead also asks, so it reads ahead for the
  // props each entry draws with.
  const filled = fillItemBindings(node, context, bindings.run);
  if (filled.issues.length > 0) bindings.report(filled.issues);
  if (filled.bound === undefined) return { node, bound: fromPage };
  return {
    node: { ...node, props: filled.props },
    bound: { ...fromPage, ...filled.bound },
  };
}

/**
 * The `bound` render argument, present only for a block with a bound prop, so
 * a block with none is called exactly as it was before bindings existed.
 */
export function boundArgument(bound: BoundValues | undefined): {
  bound?: BoundValues;
} {
  return bound === undefined ? {} : { bound };
}
