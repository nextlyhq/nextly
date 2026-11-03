/**
 * Searching a row for the blocks values no fixed path reaches: every real
 * blocks document is judged, and a record that merely has a `nodes` array is
 * searched through rather than taken for one.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  stillReferences,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { HostStep, StoredForm } from "./contract";
import { scannedOutcomes } from "./scan";

const form: StoredForm = {
  host: { kind: "collection", slug: "notes", id: "n1", path: [] },
  form: "published",
};

/**
 * Says a value would change only when it certainly places the component, so
 * these tests see which values the search reaches and nothing else: a value
 * it cannot read answers unchanged here, unlike the real step.
 */
const step: HostStep = doc =>
  // Stored text is decoded, as the real step decodes it.
  stillReferences(typeof doc === "string" ? JSON.parse(doc) : doc, "card") ===
  "yes"
    ? { kind: "rewritten", value: doc }
    : { kind: "unchanged" };

const placing = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "card" },
    },
  ],
};

describe("scanning a row for blocks values", () => {
  it("searches through a record that only has a nodes array", async () => {
    const row = { rows: [{ nodes: [], body: placing }] };

    expect(await scannedOutcomes(step, row, form)).toBe("unaddressable");
  });

  it("finds a blocks document stored as text", async () => {
    const row = { rows: [{ body: JSON.stringify(placing) }] };

    expect(await scannedOutcomes(step, row, form)).toBe("unaddressable");
  });

  it("hands a value claiming a format this version cannot read to the step", async () => {
    const judged: unknown[] = [];
    const row = { rows: [{ body: { ...placing, formatVersion: 999 } }] };

    await scannedOutcomes(
      doc => {
        judged.push(doc);
        return { kind: "unchanged" };
      },
      row,
      form
    );

    expect(judged).toEqual([{ ...placing, formatVersion: 999 }]);
  });

  it("CONTROL: a row with no copy is unchanged", async () => {
    const row = { rows: [{ nodes: [], body: { ...placing, nodes: [] } }] };

    expect(await scannedOutcomes(step, row, form)).toBe("unchanged");
  });

  it("hands a document-shaped value with no format version to the step", async () => {
    const judged: unknown[] = [];
    const malformed = { kind: "page", nodes: placing.nodes };

    await scannedOutcomes(
      doc => {
        judged.push(doc);
        return { kind: "unchanged" };
      },
      { rows: [{ body: malformed }] },
      form
    );

    expect(judged).toEqual([malformed]);
  });

  it("leaves out the paths that have hosts of their own", async () => {
    const row = {
      content: placing,
      rows: [{ body: { ...placing, nodes: [] } }],
    };

    expect(await scannedOutcomes(step, row, form, [["content"]])).toBe(
      "unchanged"
    );
    // CONTROL: the same row, nothing left out.
    expect(await scannedOutcomes(step, row, form)).toBe("unaddressable");
  });
});
