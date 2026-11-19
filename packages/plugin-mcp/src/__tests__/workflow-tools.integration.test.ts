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
  ownerOf,
  refusalOf,
  saveIn,
  textOf,
  trustedAssign,
  trustedPart,
  trustedSeen,
  trustedSend,
  type DocRef,
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

/** A page of what waits, as `list_waiting_for_review` answers it. */
interface Waiting {
  items: {
    document: { entryId: string };
    part: string | null;
    stage: string;
  }[];
  meta: { page: number; limit: number };
}

/** A submit's result, as `submit_for_review` answers it. */
interface Submitted {
  step: string;
  moved: { part: string | null; from: string; to: string }[];
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

    it("M5: answers a key that may update but not read the document as not found", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const updater = await key("updater", ["update-posts"]);

      const refusal = refusalOf(
        await callTool(handlers, updater.headers, "get_review_state", {
          document: post,
        })
      );

      expect(refusal.code).toBe("NOT_FOUND");
    });

    it("M6: leaves out a part in a language the key may not read", async () => {
      await boot();
      const letter = await draft(handle, "letters");
      await saveIn(handle, letter, "es");
      await trustedSend(handle, letter, ["en", "es"]);
      const writer = await key("letters", ["read-letters", "update-letters"]);

      const review = dataOf(
        await callTool<Review>(handlers, writer.headers, "get_review_state", {
          document: letter,
        })
      );
      const parts = review.parts.map(part => part.part);

      // The control: the trusted read holds both in legal, so the absence is the key's.
      expect((await trustedPart(handle, letter, "es"))?.stage).toBe("legal");
      expect(parts).toContain("en");
      expect(parts).not.toContain("es");
    });
  });

  describe("list_waiting_for_review", () => {
    it("M7: lists what waits for the key's owner, only where the key may read and take the step", async () => {
      await boot();
      const post = await draft(handle, "posts");
      await trustedAssign(handle, post, "en", await ownerOf(handle));
      const writer = await key("writer", ["read-posts", "update-posts"]);
      const reader = await key("reader", ["read-posts"]);
      const updater = await key("updater", ["update-posts"]);

      const forWriter = dataOf(
        await callTool<Waiting>(
          handlers,
          writer.headers,
          "list_waiting_for_review",
          {}
        )
      );
      const forReader = dataOf(
        await callTool<Waiting>(
          handlers,
          reader.headers,
          "list_waiting_for_review",
          {}
        )
      );
      const forUpdater = dataOf(
        await callTool<Waiting>(
          handlers,
          updater.headers,
          "list_waiting_for_review",
          {}
        )
      );

      expect(forWriter.items).toEqual([
        expect.objectContaining({
          document: expect.objectContaining({ entryId: post.id }),
          part: "en",
          stage: "writing",
        }),
      ]);
      expect(forWriter.meta).toMatchObject({ page: 1, limit: 20 });
      // Assigned to the owner, but the reader's key cannot take the stage's step, and the
      // updater's cannot read the document.
      expect(forReader.items).toEqual([]);
      expect(forUpdater.items).toEqual([]);
    });

    it("M8: leaves out a part in a language the key may not read", async () => {
      await boot();
      const letter = await draft(handle, "letters");
      await saveIn(handle, letter, "es");
      const owner = await ownerOf(handle);
      await trustedAssign(handle, letter, "en", owner);
      await trustedAssign(handle, letter, "es", owner);
      const writer = await key("letters", ["read-letters", "update-letters"]);

      const { items } = dataOf(
        await callTool<Waiting>(
          handlers,
          writer.headers,
          "list_waiting_for_review",
          {}
        )
      );
      const parts = items.map(item => item.part);

      expect(parts).toContain("en");
      expect(parts).not.toContain("es");
    });

    it("M9: refuses a page out of bounds as invalid input", async () => {
      await boot();
      const reader = await key("reader", ["read-posts"]);

      for (const page of [{ limit: 101 }, { page: 0 }, { limit: 0 }]) {
        const body = await callTool(
          handlers,
          reader.headers,
          "list_waiting_for_review",
          page
        );
        expect(body.error, JSON.stringify(body.error)).toBeUndefined();
        expect(body.result?.isError, JSON.stringify(page)).toBe(true);
        expect(textOf(body)).toMatch(/^Input validation error/);
      }
    });
  });

  describe("submit_for_review", () => {
    /** A submit of the English part, with what `get_review_state` told `headers`. */
    async function submitSeenBy(
      headers: Record<string, string>,
      post: DocRef,
      extra: Record<string, unknown> = {}
    ) {
      const review = dataOf(
        await callTool<Review>(handlers, headers, "get_review_state", {
          document: post,
        })
      );
      const en = review.parts.find(part => part.part === "en");
      return {
        document: post,
        parts: ["en"],
        seen: [{ part: "en", revision: en?.revision, version: en?.version }],
        comment: "Ready for legal",
        ...extra,
      };
    }

    it("M10: submits as the key, the step taken from the part's stage, and approves nothing", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const writer = await key("writer", ["read-posts", "update-posts"]);

      const body = await callTool<Submitted>(
        handlers,
        writer.headers,
        "submit_for_review",
        await submitSeenBy(writer.headers, post)
      );
      const result = dataOf(body);

      expect(result).toMatchObject({
        step: "send",
        moved: [{ part: "en", from: "writing", to: "legal" }],
      });
      // The comment is data: it is not put into the prose.
      expect(textOf(body)).not.toContain("Ready for legal");
      const review = dataOf(
        await callTool<Review>(handlers, writer.headers, "get_review_state", {
          document: post,
        })
      );
      const en = review.parts.find(part => part.part === "en");
      expect(en).toMatchObject({
        stage: "legal",
        publishable: false,
        approval: null,
      });
      expect(en?.lastMove).toMatchObject({
        actor: { kind: "apiKey", id: writer.id },
        comment: "Ready for legal",
      });
      // A date reaches the agent as an ISO string.
      expect(en?.lastMove?.at).toEqual(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    it("M11: holds a key to its own grants, not its owner's", async () => {
      await boot();
      const post = await draft(handle, "posts");
      // The owner may update posts; the key it minted may only read them.
      const reader = await key("reader", ["read-posts"]);
      const before = await trustedPart(handle, post, "en");

      const refusal = refusalOf(
        await callTool(
          handlers,
          reader.headers,
          "submit_for_review",
          await submitSeenBy(reader.headers, post)
        )
      );

      expect(refusal).toMatchObject({
        code: "FORBIDDEN",
        data: { reason: "no-permission", permission: "update-posts" },
      });
      expect(await trustedPart(handle, post, "en")).toMatchObject({
        stage: before?.stage,
        revision: before?.revision,
      });
    });

    it("M12: refuses a submit over a part that moved since the key read it", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const writer = await key("writer", ["read-posts", "update-posts"]);
      const input = await submitSeenBy(writer.headers, post);
      // Someone assigns the part after the agent read it: its revision moves on.
      await trustedAssign(handle, post, "en", await ownerOf(handle));
      const moved = await trustedPart(handle, post, "en");

      const refusal = refusalOf(
        await callTool(handlers, writer.headers, "submit_for_review", input)
      );

      expect(refusal).toMatchObject({
        code: "CONFLICT",
        data: expect.objectContaining({ reason: "stale" }),
      });
      expect(await trustedPart(handle, post, "en")).toMatchObject({
        stage: "writing",
        revision: moved?.revision,
      });
    });

    it("M13: answers a submit on a document the key may not read as not found, whatever the step", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const blind = await key("blind", ["update-posts", "sign-off-posts"]);
      const seen = await trustedSeen(handle, post, ["en"]);

      for (const step of ["send", "clear"]) {
        const refusal = refusalOf(
          await callTool(handlers, blind.headers, "submit_for_review", {
            document: post,
            parts: ["en"],
            seen,
            comment: "Ready for legal",
            step,
          })
        );
        // Never the refusal of a step that is not a submit: that would confirm the document.
        expect(refusal.code, step).toBe("NOT_FOUND");
      }
      expect((await trustedPart(handle, post, "en"))?.revision).toBe(0);
    });

    it("M14: submits a language only where the key may read the document in it", async () => {
      await boot();
      const letter = await draft(handle, "letters");
      await saveIn(handle, letter, "es");
      const writer = await key("letters", ["read-letters", "update-letters"]);
      const submit = async (part: string) =>
        callTool(handlers, writer.headers, "submit_for_review", {
          document: letter,
          parts: [part],
          seen: await trustedSeen(handle, letter, [part]),
          comment: "Ready for legal",
        });

      const spanish = refusalOf(await submit("es"));

      expect(spanish.code).toBe("NOT_FOUND");
      expect((await trustedPart(handle, letter, "es"))?.revision).toBe(0);
      // The control: the same key submits the English part of the same letter.
      expect(dataOf(await submit("en"))).toMatchObject({
        step: "send",
        moved: [{ part: "en", to: "legal" }],
      });
    });

    it("M15: refuses an input that names no comment, no part, every part, or a way past review", async () => {
      await boot();
      const post = await draft(handle, "posts");
      const writer = await key("writer", ["read-posts", "update-posts"]);
      const input = await submitSeenBy(writer.headers, post);
      // The same input with no comment at all, built without naming the dropped key.
      const withoutComment = Object.fromEntries(
        Object.entries(input).filter(([name]) => name !== "comment")
      );

      const changed: Record<string, unknown>[] = [
        { ...input, comment: "   " },
        withoutComment,
        { ...input, parts: [] },
        { ...input, parts: "all" },
        { ...input, withoutReview: true },
        { ...input, overrideAccess: true },
      ];
      for (const args of changed) {
        const body = await callTool(
          handlers,
          writer.headers,
          "submit_for_review",
          args
        );
        expect(body.error, JSON.stringify(body.error)).toBeUndefined();
        expect(body.result?.isError, JSON.stringify(args)).toBe(true);
        expect(textOf(body)).toMatch(/^Input validation error/);
      }
      expect(await trustedPart(handle, post, "en")).toMatchObject({
        stage: "writing",
        revision: 0,
      });
    });
  });
});
