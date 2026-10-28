/**
 * What taking the live values reports is judged by the caller's field read
 * rules, once, against the live document as it is: the judgement of one list
 * of fields must not change the document the other list is judged against,
 * nor the live document the caller goes on to use.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../shared/lib/field-level-registry";

import { takenLiveValues, wholeWritableFields } from "./shared-publish-base";

afterEach(() => clearFieldFunctions());

/** Whether a group value still holds its protected `secret`. */
function holdsSecret(data: Record<string, unknown> | undefined): boolean {
  const details = data?.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "secret" in (details as Record<string, unknown>)
  );
}

describe("takenLiveValues", () => {
  it("judges a field whose rule reads a protected nested value against the whole live document", async () => {
    registerFieldFunctions("single", "site", [
      {
        name: "details",
        type: "group",
        fields: [
          { name: "label" },
          // Never readable.
          { name: "secret", access: { read: () => false } },
        ],
      },
      // Readable only while the details hold no secret.
      {
        name: "score",
        access: {
          read: ({ data }: { data?: Record<string, unknown> }) =>
            !holdsSecret(data),
        },
      },
    ]);
    const live = { details: { label: "Shop", secret: "s" }, score: 7 };

    const reported = await takenLiveValues(
      {
        kind: "single",
        slug: "site",
        overrideAccess: false,
        grants: () => Promise.resolve({ permissions: [], roles: [] }),
      },
      { taken: ["details"], remaining: ["score"], live }
    );

    // The score is hidden, as a read of this document hides it.
    expect(reported).toEqual({
      taken: ["details"],
      outOfDate: [],
      hiddenOutOfDate: 1,
    });
    // And the live document is untouched.
    expect(live).toEqual({ details: { label: "Shop", secret: "s" }, score: 7 });
  });
});

/**
 * Field write rules as a caller's: each judges the whole document it is shown,
 * and a field it refuses is removed, as the real rules remove what they refuse.
 */
function rulesOf(
  rules: Record<string, (document: Record<string, unknown>) => boolean>
): (data: Record<string, unknown>) => Promise<void> {
  return async data => {
    const shown = { ...data };
    for (const [name, allows] of Object.entries(rules)) {
      if (name in data && !allows(shown)) delete data[name];
    }
  };
}

const never = () => false;
const whenOpen = (sibling: string) => (document: Record<string, unknown>) =>
  document[sibling] === "open";

/**
 * Which out-of-date fields may be taken, judged on the document taking them
 * would leave: the pending change with the taken fields' live values over it.
 * Every field taken must pass on that one document, and a field left out only
 * because of a sibling that is itself left behind is judged again without it.
 */
describe("wholeWritableFields", () => {
  it.each<{
    label: string;
    rules: Record<string, (document: Record<string, unknown>) => boolean>;
    live: Record<string, unknown>;
    pending: Record<string, unknown>;
    taken: string[];
  }>([
    {
      label: "takes every field no rule refuses",
      rules: {},
      live: { a: 1, b: 2 },
      pending: { a: 0, b: 0 },
      taken: ["a", "b"],
    },
    {
      label: "leaves a field the caller may never write",
      rules: { gate: never },
      live: { gate: "open" },
      pending: { gate: "closed" },
      taken: [],
    },
    {
      label:
        "leaves a field allowed only beside a sibling's live value, when that sibling is left behind",
      rules: { gate: never, fee: whenOpen("gate") },
      live: { gate: "open", fee: 20 },
      pending: { gate: "closed", fee: 5 },
      taken: [],
    },
    {
      label:
        "takes a field refused beside a sibling's live value, once that sibling is left behind and the change's own value allows it",
      rules: { gate: never, fee: whenOpen("gate") },
      live: { gate: "closed", fee: 20 },
      pending: { gate: "open", fee: 5 },
      taken: ["fee"],
    },
    {
      label: "takes a field allowed by a sibling that is taken with it",
      rules: { fee: whenOpen("gate") },
      live: { gate: "open", fee: 20 },
      pending: { gate: "closed", fee: 5 },
      taken: ["gate", "fee"],
    },
    {
      label: "follows a chain: each field taken once what it reads is settled",
      rules: { a: never, b: whenOpen("a"), c: whenOpen("b") },
      live: { a: "closed", b: "open", c: 1 },
      pending: { a: "open", b: "closed", c: 0 },
      taken: ["b", "c"],
    },
  ])("$label", async ({ rules, live, pending, taken }) => {
    const names = Object.keys(live);
    const result = await wholeWritableFields(
      names,
      live,
      pending,
      rulesOf(rules)
    );
    expect(result).toEqual(taken);

    // Whatever is taken passes every rule on the document it leaves.
    const left = {
      ...pending,
      ...Object.fromEntries(result.map(name => [name, live[name]])),
    };
    const judged = structuredClone(left);
    await rulesOf(rules)(judged);
    for (const name of result) expect(judged).toHaveProperty(name);
  });
});
