/**
 * Which filter keys reach a component table, and every table each can reach.
 *
 * A dotted key whose head is a component field is compiled into an EXISTS
 * over the component's own table, so a guard on the entity's table never sees
 * the column it names. The read path judges these targets against each
 * component table's hidden columns; a target that lists fewer tables than the
 * field can hold leaves a dynamic zone's other tables unjudged.
 */
import { describe, expect, it } from "vitest";

import { filterKeys } from "../../../../shared/lib/filterable-fields";
import {
  componentFilterTargets,
  extractComponentFieldConditions,
} from "../query-operators";

const fields = [
  { name: "title", type: "text" },
  { name: "meta", type: "group" },
  { name: "seo", type: "component", component: "seo" },
  { name: "layout", type: "component", components: ["hero", "cta"] },
];

describe("componentFilterTargets", () => {
  it("lists every component key at any depth, with every table its field can hold", () => {
    const where = {
      title: { equals: "a" },
      "meta.note": { equals: "b" },
      and: [{ "seo.secretToken": { equals: "c" } }],
      or: [{ and: [{ "layout.secret_token.inner": { bogus: "d" } }] }],
    };

    expect(componentFilterTargets(filterKeys(where), fields)).toEqual([
      {
        key: "seo.secretToken",
        componentSlugs: ["seo"],
        componentFieldPath: "secretToken",
      },
      {
        key: "layout.secret_token.inner",
        componentSlugs: ["hero", "cta"],
        componentFieldPath: "secret_token.inner",
      },
    ]);
  });

  it("names the same tables the component predicate is built over", () => {
    const where = { "layout.secretToken": { equals: "x" } };
    const [target] = componentFilterTargets(filterKeys(where), fields);
    const { componentFilters } = extractComponentFieldConditions(where, fields);

    expect(target.componentSlugs).toEqual(componentFilters[0].componentSlugs);
    expect(target.componentFieldPath).toBe(
      componentFilters[0].componentFieldPath
    );
  });
});
