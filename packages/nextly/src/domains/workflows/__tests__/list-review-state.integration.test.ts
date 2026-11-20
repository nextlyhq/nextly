/**
 * A collection list's rows carry each one's review state when the read asks for it
 * (`reviewState: true`): each part where it stands, as the document's own review read places it
 * (stage, its label and colour, assignee, whom it waits for, when it is due, and the revision and
 * version a move names as seen), read for the whole page at once. Only a reader the list admits
 * as someone gets it: a visitor's rows carry no review key at all, and a read that does not ask
 * gets none. On every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import { defineCollection, text } from "../../../config";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { workflowDefinitionHash } from "../hash";

import {
  bootSteps,
  entry,
  partOf,
  person,
  publishedPastReview,
  saveIn,
  seedState,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);

/** The fields of a part the list's review state and the document's review read both name. */
const SHARED_FIELDS = [
  "part",
  "stage",
  "stageLabel",
  "stageColour",
  "assignee",
  "waitingFor",
  "dueAt",
  "revision",
  "version",
] as const;

type Doc = Record<string, unknown>;

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** Notices anyone may read, under a workflow: a visitor lists their published ones. */
const notices = defineCollection({
  slug: "notices",
  status: true,
  versions: { drafts: true },
  workflow: editorial,
  access: { read: () => true },
  fields: [text({ name: "title" })],
});

/** One part, keeping only the fields both reads name. */
function shared(part: Doc): Doc {
  return Object.fromEntries(SHARED_FIELDS.map(key => [key, part[key] ?? null]));
}

describe.each(getConfiguredTestDialects())(
  "a list's review state (%s)",
  dialect => {
    it("gives each row's parts where the document's own review read places them", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // Never moved: every part where its content puts it.
      const fresh = await entry(t, "posts");
      // Its English part in Legal check, assigned to Sam; its Spanish part stranded.
      const moved = await entry(t, "posts");
      await seedState(t, partOf("posts", moved, "en"), "legal", {
        definitionHash: HASH,
        assignee: { kind: "user", id: "sam" },
      });
      await seedState(t, partOf("posts", moved, "es"), "gone", {
        definitionHash: HASH,
      });
      // Live in both languages with nothing unpublished: no part has a stage.
      const live = await entry(t, "posts");
      await saveIn(t, "posts", live, "en", {
        title: "Hello",
        status: "published",
      });
      await saveIn(t, "posts", live, "es", {
        title: "Hola",
        status: "published",
      });

      const listed = await t.nextly.find({
        collection: "posts",
        status: "all",
        overrideAccess: false,
        user: { id: "sam" },
        locale: "all",
        reviewState: true,
      } as never);
      const rows = listed.items as Doc[];
      expect(rows.map(row => String(row.id)).sort()).toEqual(
        [fresh, moved, live].sort()
      );
      for (const row of rows) {
        const review = (await t.nextly.workflows.reviewState({
          document: { collection: "posts", id: String(row.id) },
        })) as unknown as { parts: Doc[] };
        const listedParts = ((row._review as { parts: Doc[] }).parts ?? [])
          .map(shared)
          .sort((a, b) => String(a.part).localeCompare(String(b.part)));
        const readParts = review.parts
          .map(shared)
          .sort((a, b) => String(a.part).localeCompare(String(b.part)));
        expect(listedParts, String(row.id)).toEqual(readParts);
      }
    });

    it("gives a visitor's rows, and a read that does not ask, no review key at all", async () => {
      t = await bootSteps(dialect, undefined, {
        collections: [notices],
        seedPublic: true,
      });
      await person(t, "sam", [["read", "notices"]]);
      const id = await entry(t, "notices");
      await (
        t.getService("collectionsHandler") as CollectionsHandler
      ).updateEntry(
        { collectionName: "notices", entryId: id, overrideAccess: true },
        { ...publishedPastReview({ status: "published" }), _overwrite: true }
      );

      // A visitor, over REST with no credentials, asking for the review state: the Public role
      // may read notices.
      await grantPublic(t, ["read-notices"]);
      const path = ["collections", "notices", "entries"];
      const response = await createDynamicHandlers().GET(
        new Request(`http://localhost/api/${path.join("/")}?reviewState=true`, {
          headers: { origin: "http://localhost" },
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const visitor = (await response.json()) as { items?: Doc[] };
      expect(response.status).toBe(200);
      expect(visitor.items).toHaveLength(1);
      expect(visitor.items?.[0]).not.toHaveProperty("_review");

      const unasked = await t.nextly.find({
        collection: "notices",
        status: "all",
        overrideAccess: false,
        user: { id: "sam" },
      } as never);
      expect(unasked.items).toHaveLength(1);
      expect(unasked.items[0]).not.toHaveProperty("_review");

      // The same reader asking gets it: the key's absence above is the visitor's, not the row's.
      const asked = await t.nextly.find({
        collection: "notices",
        status: "all",
        overrideAccess: false,
        user: { id: "sam" },
        reviewState: true,
      } as never);
      expect(asked.items[0]).toHaveProperty("_review");
    });
  }
);
