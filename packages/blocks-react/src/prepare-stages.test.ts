/**
 * The stages contract, which is invisible from the type.
 *
 * A caller decides whether a stored stylesheet still describes the tree that
 * renders by comparing stages with `!==`. That works only because each pass
 * returns the document it was GIVEN when it had nothing to remove.
 *
 * If any pass starts allocating unconditionally — a defensive clone, a
 * `structuredClone` added for safety, a `map` that always builds a new array —
 * every comparison becomes permanently true, every document reads as repaired,
 * and a repaired document with no compile context has its whole sheet withheld.
 * Every page silently loses its stylesheet, on the happy path, with no error.
 *
 * These assertions are by REFERENCE on purpose. A value comparison passes
 * straight through that regression, which is the only one worth guarding here.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import {
  prepareDocumentForRead,
  prepareDocumentReadStages,
} from "./prepare-document";
import { createBlockResolver } from "./resolver";

const resolver = createBlockResolver(coreBlocks);

/** A document nothing in the pipeline has anything to do to. */
function untouchedDocument(): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      { id: "a", type: "core/heading", version: 1, props: { text: "Real" } },
    ],
  };
}

describe("read stages keep reference identity when a pass changes nothing", () => {
  it("returns the same object for every stage of an untouched document", () => {
    const document = untouchedDocument();
    const stages = prepareDocumentReadStages(document, { resolver });

    expect(stages).not.toBeNull();
    if (stages === null) return;

    // Identity, on exactly the boundaries a caller COMPARES. `page-renderer`
    // asks `sanitized !== document`, `gated !== migrated`, `deduped !== gated`
    // and `prepared`-vs-`deduped`; those four are the contract.
    expect(stages.sanitized).toBe(document);
    expect(stages.gated).toBe(stages.migrated);
    expect(stages.deduped).toBe(stages.gated);
    expect(stages.prepared).toBe(stages.deduped);

    // `migrated` is deliberately NOT asserted against `sanitized`.
    // `migrateDocument` allocates unconditionally — measured, not assumed — so
    // the identity claim is FALSE across that boundary. It is also unused: no
    // caller compares those two, because a migration that rewrote nothing still
    // says nothing about whether the stored sheet describes the tree. Asserting
    // it would fail today, and asserting it loosely (`toEqual`) would pretend a
    // guarantee the pipeline does not offer.
    expect(stages.migrated).not.toBe(stages.sanitized);
  });

  it("returns a DIFFERENT object for the stage whose pass removed something", () => {
    // The positive control. Without it the test above would pass on a pipeline
    // that returned its input unconditionally — which would report every
    // document as unrepaired and publish rules for markup that is gone, the
    // opposite failure and the worse one.
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "a", type: "core/heading", version: 1, props: { text: "Real" } },
        // Unregistered, so the placeholder pass drops it.
        { id: "b", type: "plugin/unregistered", version: 1, props: {} },
      ],
    };

    const stages = prepareDocumentReadStages(document, { resolver });
    expect(stages).not.toBeNull();
    if (stages === null) return;

    expect(stages.deduped).toBe(stages.gated);
    expect(stages.prepared).not.toBe(stages.deduped);
  });
});

describe("the narrow view is derived, not recomputed", () => {
  it("returns the prepared stage for a document that survives", () => {
    const document = untouchedDocument();

    // Value equality is all two separate invocations can show — `migrateDocument`
    // allocates on every run — so this does NOT prove the narrow view is derived
    // rather than hand-copied. It is here to catch the two disagreeing, which a
    // copy would eventually do; the derivation itself is enforced structurally,
    // by `prepareDocumentForRead` being one line that reads `.prepared`.
    expect(prepareDocumentForRead(document, { resolver })).toEqual(
      prepareDocumentReadStages(document, { resolver })?.prepared
    );
  });

  it("differs from the stages view exactly where the reading policy differs", () => {
    // The one behaviour that separates them, and the reason the narrow view is
    // not simply `.prepared`: a document whose every node resolves to a
    // placeholder is UNREADABLE to a visitor who wanted its content, but the
    // renderer must still walk it to draw the markers. So the pipeline reports
    // stages with an empty `prepared` tree and the reading view answers `null`.
    const allPlaceholders: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "a", type: "plugin/unregistered", version: 1, props: {} },
        { id: "b", type: "plugin/also-unknown", version: 1, props: {} },
      ],
    };

    const stages = prepareDocumentReadStages(allPlaceholders, { resolver });
    expect(stages).not.toBeNull();
    expect(stages?.prepared.nodes).toEqual([]);
    expect(stages?.deduped.nodes).toHaveLength(2);

    expect(prepareDocumentForRead(allPlaceholders, { resolver })).toBeNull();
  });

  it("agrees with the stages view on an unreadable envelope", () => {
    const wrongVersion = {
      formatVersion: 99,
      kind: "page",
      nodes: [],
    } as unknown as BlockDocument;

    expect(prepareDocumentForRead(wrongVersion, { resolver })).toBeNull();
    expect(prepareDocumentReadStages(wrongVersion, { resolver })).toBeNull();
  });
});
