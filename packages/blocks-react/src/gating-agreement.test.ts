/**
 * The compiler and the renderer must agree about which nodes are gated.
 *
 * Two components decide this from different packages: `compilePageCss` decides whether a node's
 * rules leave the main sheet, and `pruneHiddenNodes` decides whether the node reaches the markup.
 * They now share one predicate, but they apply it over different structures — a flat walk with
 * inherited state on one side, a recursive tree filter on the other — so sharing the predicate is
 * not by itself proof that the two answers match.
 *
 * The invariant that matters is one sentence: **anything `pruneHiddenNodes` removes must have its
 * rules held out of the main sheet.** Where the compiler's notion of "gated" is NARROWER than the
 * renderer's notion of "removed", the difference is a leak — the node's markup is withheld while
 * its colours, fonts and `url(...)` are served to everyone.
 *
 * That divergence has now happened three times, each invisible until looked for: empty condition
 * groups, unreadable `visibility` shapes, and descendants of a gated ancestor. Each was found
 * individually. This asserts the property instead, across a corpus of shapes, so a fourth is caught
 * by a failing test rather than by a reviewer noticing.
 *
 * It is the direction that matters, not equality. The compiler holding back MORE than the renderer
 * removes costs a node its styling and is a bug, but not a leak; the reverse publishes content
 * meant to be hidden and cannot be taken back.
 *
 * WHAT THIS DOES NOT COVER, stated because the gap is not obvious. Measured by reverting each of
 * the three historical divergences in turn: the subtree one fails two rows here, and the
 * malformed-shape one fails NONE. That is correct rather than a hole in the corpus. Since both
 * sides now call one `isConditionGated`, changing what it decides moves them TOGETHER — the
 * renderer stops pruning exactly what the compiler stops gating, so they still agree and nothing
 * leaks. A policy change to the shared predicate is therefore not detectable here, and does not
 * need to be: it is what the single definition already makes safe. What remains detectable, and
 * what this exists for, is the two sides applying that predicate over DIFFERENT STRUCTURES — a
 * flat walk with inherited state against a recursive tree filter. Every divergence that survived
 * unification was of that kind.
 *
 * The fail-closed policy itself is covered where it belongs, in the engine's own gated-node tests.
 *
 * THE PER-FIXTURE POSITIVE CONTROL IS LOAD-BEARING, not setup. Every node must emit its colour
 * SOMEWHERE before the leak assertions run. Without it a fixture that reaches no mechanism — a
 * wrong field name, a shape the compiler skips — satisfies "no removed node's rules are in the
 * sheet" by emitting nothing at all, and reports clean. That is not hypothetical: it is how the
 * empty-group defect was nearly dismissed as unreproducible, and how an early probe of this same
 * feature read clean against a stale `dist`. Do not remove it as redundant.
 */
import { compilePageCss, type BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { pruneHiddenNodes } from "./visibility";

const PRED = { field: "tier", op: "eq", value: "vip" };

const styled = (
  id: string,
  colour: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  styles: { base: { base: { color: colour } } },
  ...extra,
});

const page = (nodes: unknown[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as unknown as BlockDocument;

/** Every id still in the tree after pruning. */
function survivingIds(document: BlockDocument): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      const record = node as { id: string; slots?: Record<string, unknown[]> };
      ids.add(record.id);
      for (const children of Object.values(record.slots ?? {})) {
        walk(children);
      }
    }
  };
  walk(pruneHiddenNodes(document).nodes);
  return ids;
}

/**
 * Documents spanning every shape the two sides have disagreed about, plus the ordinary ones.
 *
 * Each carries a distinguishable colour per node so a rule can be traced back to the node that
 * authored it without depending on class naming.
 */
const CORPUS: [string, BlockDocument][] = [
  ["no visibility at all", page([styled("a", "#aa0001")])],
  [
    "an empty conditions array",
    page([styled("a", "#aa0002", { visibility: { conditions: [] } })]),
  ],
  [
    "one empty group",
    page([styled("a", "#aa0003", { visibility: { conditions: [[]] } })]),
  ],
  [
    "an empty group beside a real one",
    page([
      styled("a", "#aa0004", { visibility: { conditions: [[], [PRED]] } }),
    ]),
  ],
  [
    "a real predicate",
    page([styled("a", "#aa0005", { visibility: { conditions: [[PRED]] } })]),
  ],
  [
    "conditions that are not a list",
    page([styled("a", "#aa0006", { visibility: { conditions: "vip" } })]),
  ],
  [
    "an envelope that is a string",
    page([styled("a", "#aa0007", { visibility: "hidden" })]),
  ],
  [
    "an envelope that is an array",
    page([styled("a", "#aa0008", { visibility: ["tier"] })]),
  ],
  [
    "a gated parent with an unconditional child",
    page([
      styled("a", "#aa0009", {
        visibility: { conditions: [[PRED]] },
        slots: { default: [styled("child", "#aa0010")] },
      }),
    ]),
  ],
  [
    "a gated GRANDPARENT two levels up",
    page([
      styled("a", "#aa0011", {
        visibility: { conditions: [[PRED]] },
        slots: {
          default: [
            styled("mid", "#aa0012", {
              slots: { default: [styled("leaf", "#aa0013")] },
            }),
          ],
        },
      }),
    ]),
  ],
  [
    "an unconditional parent with a gated child",
    page([
      styled("a", "#aa0014", {
        slots: {
          default: [
            styled("child", "#aa0015", {
              visibility: { conditions: [[PRED]] },
            }),
          ],
        },
      }),
    ]),
  ],
  [
    "a gated node beside an unconditional one",
    page([
      styled("a", "#aa0016", { visibility: { conditions: [[PRED]] } }),
      styled("b", "#aa0017"),
    ]),
  ],
  [
    "per-breakpoint hiding, which is NOT a condition",
    page([
      styled("a", "#aa0018", { visibility: { devices: { tablet: false } } }),
    ]),
  ],
];

describe("what the compiler holds back and what the renderer removes", () => {
  const compile = (document: BlockDocument) =>
    compilePageCss(document, {
      breakpoints: {
        viewport: [{ id: "base", label: "Base" }],
        container: [],
      },
    } as never);

  it.each(CORPUS)(
    "%s: no removed node's rules reach the main sheet",
    (_label, document) => {
      const surviving = survivingIds(document);
      const { css, gated } = compile(document);

      const colours = new Map<string, string>();
      const collect = (nodes: readonly unknown[]): void => {
        for (const node of nodes) {
          const record = node as {
            id: string;
            styles?: { base?: { base?: { color?: string } } };
            slots?: Record<string, unknown[]>;
          };
          const colour = record.styles?.base?.base?.color;
          if (colour !== undefined) colours.set(record.id, colour);
          for (const children of Object.values(record.slots ?? {})) {
            collect(children);
          }
        }
      };
      collect(document.nodes);

      // A positive control for the whole corpus: every fixture must actually emit its colour
      // SOMEWHERE, or a row that reaches no mechanism would satisfy every assertion below.
      for (const [id, colour] of colours) {
        const anywhere =
          css.includes(colour) ||
          Object.values(gated ?? {}).some(rules => rules.includes(colour));
        expect(anywhere, `${id} emitted no rule at all`).toBe(true);
      }

      for (const [id, colour] of colours) {
        if (surviving.has(id)) continue;
        // The leak: this node's markup was withheld, so its rules must not be in the sheet that
        // ships to everyone.
        expect(
          css.includes(colour),
          `removed node ${id} still has its rules in the main sheet`
        ).toBe(false);
      }
    }
  );
});
