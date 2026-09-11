/**
 * `collections:present` and `singles:present` against a real instance.
 *
 * What the pure tests in `conditions.test.ts` cannot ask is whether each
 * evaluator reaches the right REGISTRY and applies the reader's permission to
 * it. Both answer from the registries' own readable listing -- what the
 * management cards they gate list -- and each can be wrong in a way that
 * returns a plausible boolean. An evaluator reading the wrong registry answers
 * `false` on every install, and `false` is also the right answer for the
 * empty one.
 *
 * So every case here has a must-differ partner: an install that answers `true`
 * beside one that answers `false`, and a readable entity beside an unreadable
 * one under the same reader.
 *
 * @module domains/widgets/__tests__/conditions-present.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionWidgets } from "../collection-widgets";
import { evaluateConditions } from "../conditions";
import type { WidgetCondition } from "../lifecycle";
import { listSources } from "../sources";

/** An admin: may read everything a code rule does not refuse. */
const admin: ReadCaller = {
  user: { id: "admin-1", roles: ["admin"] },
};

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const readable = { read: () => true, create: () => true, update: () => true };
/** Refused to everyone, by code. The reader-scoping control. */
const refused = { read: () => false, create: () => true, update: () => true };

async function boot(options: {
  collections?: Parameters<typeof defineCollection>[0][];
  singles?: Parameters<typeof defineSingle>[0][];
}): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: (options.collections ?? []).map(defineCollection),
    singles: (options.singles ?? []).map(defineSingle),
  });
  current = t;
  // The same call the layout endpoint makes before resolving anything. Boot
  // does not publish the sources, and both halves read them.
  await refreshCollectionWidgets();
  return t;
}

async function holds(condition: WidgetCondition): Promise<boolean> {
  const verdicts = await evaluateConditions(new Set([condition]), admin);
  return verdicts.get(condition) === true;
}

describe("collections:present against a real instance", () => {
  it("holds while there is a collection the reader may read, even an empty one", async () => {
    // EMPTY on purpose. This is the case that separates the condition from
    // `content:empty`: a collection with no rows is still something to list.
    await boot({
      collections: [
        { slug: "notes", access: readable, fields: [text({ name: "title" })] },
      ],
    });
    expect(await holds("collections:present")).toBe(true);
  });

  it("does NOT hold when the only collection is one the reader may not read", async () => {
    // 🔴 The reader-scoping control. An evaluator reading the registry without
    // the permission filter answers `true` here, and offers a card that opens
    // onto a refusal.
    await boot({
      collections: [
        { slug: "secrets", access: refused, fields: [text({ name: "title" })] },
      ],
    });
    expect(await holds("collections:present")).toBe(false);
  });

  it("holds for a collection whose migration is still pending, which the card lists", async () => {
    // 🔴 A pending or failed migration label withholds the collection's
    // widget SOURCE, and derived from the sources this condition answered
    // "no collections" for exactly the install whose one collection needed
    // attention -- while the collections card it gates lists registry rows
    // and would have shown it. The source is withheld (the control), and the
    // condition holds regardless.
    const t = await boot({
      collections: [
        { slug: "notes", access: readable, fields: [text({ name: "title" })] },
      ],
    });
    await (
      t.getService("collectionRegistryService") as {
        updateMigrationStatus: (slug: string, status: string) => Promise<void>;
      }
    ).updateMigrationStatus("notes", "pending");
    await refreshCollectionWidgets();
    expect(listSources().some(source => source.id === "collection:notes")).toBe(
      false
    );

    expect(await holds("collections:present")).toBe(true);
  });

  it("is not moved by a single", async () => {
    // The two registries are separate questions. A single must not make the
    // collections card appear, or the card would list nothing.
    await boot({
      singles: [
        { slug: "homepage", access: readable, fields: [text({ name: "h" })] },
      ],
    });
    expect(await holds("collections:present")).toBe(false);
  });
});

describe("singles:present against a real instance", () => {
  it("holds while there is a single the reader may read", async () => {
    await boot({
      singles: [
        { slug: "homepage", access: readable, fields: [text({ name: "h" })] },
      ],
    });
    expect(await holds("singles:present")).toBe(true);
  });

  it("does NOT hold when the only single is one the reader may not read", async () => {
    // The same control as the collections, and it has to be asked separately:
    // singles resolve their own code rules, so a permission filter that worked
    // for collections proves nothing about this registry.
    await boot({
      singles: [
        { slug: "private", access: refused, fields: [text({ name: "h" })] },
      ],
    });
    expect(await holds("singles:present")).toBe(false);
  });

  it("holds for a single whose migration is still pending, which the card lists", async () => {
    // The same property of the other registry: the singles card lists what
    // the singles list endpoint answers, and that listing carries no
    // migration filter. The withheld source is the control.
    const t = await boot({
      singles: [
        { slug: "homepage", access: readable, fields: [text({ name: "h" })] },
      ],
    });
    await (
      t.getService("singleRegistryService") as {
        updateMigrationStatus: (slug: string, status: string) => Promise<void>;
      }
    ).updateMigrationStatus("homepage", "pending");
    await refreshCollectionWidgets();
    expect(listSources().some(source => source.id === "single:homepage")).toBe(
      false
    );

    expect(await holds("singles:present")).toBe(true);
  });

  it("is not moved by a collection", async () => {
    // The registry control: this is what shows the singles half reads the
    // singles registry rather than every registry. A collection is present,
    // and the answer still moves only with singles.
    await boot({
      collections: [
        { slug: "notes", access: readable, fields: [text({ name: "title" })] },
      ],
    });
    expect(await holds("singles:present")).toBe(false);
  });
});
