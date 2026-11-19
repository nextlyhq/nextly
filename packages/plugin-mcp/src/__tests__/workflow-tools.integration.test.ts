/**
 * The review tools, called as an agent calls them: over the endpoint, with an API key, on every
 * configured dialect.
 *
 * - Each tool answers for the key that called it, judged by the key's own grants and never its
 *   owner's (the owner here is the install's super-admin, so every key is narrower than it).
 * - A document, or a language of it, the key may not read is answered as though it did not
 *   exist, by every tool.
 * - A submit moves only what the key may submit, names the key in the history, and approves
 *   nothing.
 * - The prose of every answer is a constant: data, comments and labels arrive only as
 *   `structuredContent`.
 *
 * The plausible broken tool: one that calls the service as the system (and so reads what its
 * key may not), one that answers as the key's owner, one that interpolates stored text into its
 * prose, and one that lets a raw error reach the agent.
 */
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  bearer,
  bootReview,
  callTool,
  dataOf,
  draft,
  keyGranting,
  refusalOf,
  textOf,
  type Handlers,
  type PartState,
} from "./helpers";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A document's review state, as `get_review_state` answers it. */
interface Review {
  workflow: { slug: string } | null;
  parts: PartState[];
}

/** A workflow's definition, as `get_workflow` answers it. */
interface Definition {
  workflow: {
    slug: string;
    label: string;
    stages: { name: string }[];
    steps: Record<string, unknown>[];
  } | null;
}

/** One step out of a part's stage, by name. */
const stepOf = (part: PartState | undefined, name: string) =>
  part?.steps.find(step => step.name === name);

describe.each(getConfiguredTestDialects())("the review tools (%s)", dialect => {
  let handlers: Handlers;
  let handle: TestNextly;

  async function boot() {
    const booted = await bootReview(dialect);
    current = booted.handle;
    handle = booted.handle;
    handlers = booted.handlers;
  }

  /** A key's headers, holding exactly the permissions named. */
  async function key(label: string, slugs: string[]) {
    const minted = await keyGranting(handle, label, slugs);
    return { headers: bearer(minted.key), id: minted.id };
  }

  describe("get_workflow", () => {
    it("M1: tells a key that may read the collection its workflow's stages and steps, and nothing else", async () => {
      await boot();
      const reader = await key("reader", ["read-posts"]);

      const body = await callTool<Definition>(
        handlers,
        reader.headers,
        "get_workflow",
        { collection: "posts" }
      );
      const { workflow } = dataOf(body);

      expect(workflow).toMatchObject({
        slug: "editorial",
        label: "Editorial",
      });
      expect(workflow?.stages.map(stage => stage.name)).toEqual([
        "writing",
        "legal",
        "hold",
        "cleared",
      ]);
      expect(workflow?.steps.find(step => step.name === "send")).toEqual({
        name: "send",
        label: "Send to legal",
        kind: "submit",
        from: ["writing"],
        to: "legal",
        primary: true,
      });
      // What else the workflow is attached to, who may take its steps, and its settings are not
      // its definition.
      for (const kept of ["collections", "singles", "grantable", "grants"]) {
        expect(JSON.stringify(body.result?.structuredContent)).not.toContain(
          `"${kept}"`
        );
      }
      // The prose is the tool's own sentence: no label of the install's reaches it.
      expect(textOf(body).length).toBeGreaterThan(0);
      expect(textOf(body)).not.toContain("Legal check");
      expect(textOf(body)).not.toContain("Editorial");
    });

    it("M2: answers a collection the key may not read, and one that does not exist, alike: not found", async () => {
      await boot();
      const reader = await key("letters", ["read-letters"]);

      const posts = refusalOf(
        await callTool(handlers, reader.headers, "get_workflow", {
          collection: "posts",
        })
      );
      const missing = refusalOf(
        await callTool(handlers, reader.headers, "get_workflow", {
          collection: "nope",
        })
      );

      expect(posts.code).toBe("NOT_FOUND");
      expect(missing).toEqual(posts);
      // The control: the same key is told the workflow of what it may read.
      expect(
        dataOf(
          await callTool<Definition>(handlers, reader.headers, "get_workflow", {
            collection: "letters",
          })
        ).workflow?.slug
      ).toBe("editorial");
    });
  });

  describe("get_review_state", () => {
    it("M3: marks the submit step a key holding update may take, with what a submit must say it saw", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const writer = await key("writer", ["read-posts", "update-posts"]);

      const review = dataOf(
        await callTool<Review>(handlers, writer.headers, "get_review_state", {
          document: post,
        })
      );
      const en = review.parts.find(part => part.part === "en");

      expect(review.workflow).toMatchObject({ slug: "editorial" });
      expect(en).toMatchObject({
        stage: "writing",
        revision: 0,
        version: expect.any(String),
      });
      expect(stepOf(en, "send")).toMatchObject({ mayTake: true });
    });

    it("M4: marks the submit step a read-only key may not take", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const reader = await key("reader", ["read-posts"]);

      const review = dataOf(
        await callTool<Review>(handlers, reader.headers, "get_review_state", {
          document: post,
        })
      );
      const en = review.parts.find(part => part.part === "en");

      expect(en).toMatchObject({ stage: "writing" });
      // The owner may send; the key may not, whoever minted it.
      expect(stepOf(en, "send")).toMatchObject({ mayTake: false });
    });
  });
});
