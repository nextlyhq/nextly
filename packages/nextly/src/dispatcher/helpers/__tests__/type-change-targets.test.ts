/**
 * What the Schema Builder's type picker is told about a saved field: each other type blocked, and
 * why, or marked by what the change can do to the field's values, from the conversion rules.
 */
import { describe, expect, it } from "vitest";

import { FIELD_TYPE_CATALOG } from "../../../collections/fields/catalog";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { typeChangeTargets } from "../type-change-targets";

const CANDIDATES = FIELD_TYPE_CATALOG.map(entry => entry.type);

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "the type picker's targets for a saved field (%s)",
  dialect => {
    const targetsOf = (field: Partial<FieldDefinition>) =>
      new Map(
        typeChangeTargets({
          field: { name: "f", ...field } as FieldDefinition,
          candidates: CANDIDATES,
          dialect,
          builtBy: "collection",
        }).map(target => [target.type, target])
      );

    it("a text field: other text keeps, a number may lose, a group is blocked", () => {
      const targets = targetsOf({ type: "text" });
      expect(targets.has("text")).toBe(false);
      expect(targets.get("textarea")).toMatchObject({
        blocked: null,
        outcome: "keeps",
      });
      expect(targets.get("number")).toMatchObject({
        blocked: null,
        outcome: "may-lose",
      });
      expect(targets.get("group")).toMatchObject({
        blocked: "container",
        outcome: null,
      });
    });

    it("a number field: written as text converts", () => {
      expect(targetsOf({ type: "number" }).get("text")).toMatchObject({
        blocked: null,
        outcome: "converts",
      });
    });

    it("a saved group: every type unavailable", () => {
      const targets = targetsOf({ type: "group", fields: [] });
      for (const target of targets.values()) {
        expect(target.blocked, target.type).not.toBeNull();
      }
    });
  }
);
