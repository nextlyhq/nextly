/**
 * That a declared workflow actually reaches the read.
 *
 * Every other test in this change asserts one link of the chain — the
 * validator, the resolver, the predicate. This asserts the chain: a collection
 * declares states, the registry records them, and a read of that collection is
 * bounded by those states rather than by the default pair. A machinery that is
 * individually correct and unconnected passes all the others.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineWorkflow } from "../../../../lib/content-states";
import { resolveStatusFilter } from "../../../../lib/status-filter";
import {
  clearCollectionWorkflows,
  registerCollectionWorkflow,
  workflowForCollection,
} from "../collection-workflows";

const EDITORIAL = defineWorkflow({
  name: "editorial",
  states: [
    { name: "draft", label: "Draft", isPublic: false },
    { name: "in_review", label: "In legal review", isPublic: false },
    { name: "live", label: "Live", isPublic: true },
  ],
});

/** What an untrusted caller sees of this collection, with nothing asked for. */
const publicRead = (slug: string) =>
  resolveStatusFilter({
    collectionHasStatus: true,
    overrideAccess: false,
    workflow: workflowForCollection(slug),
  });

/** What a caller asking for unpublished work sees. */
const draftRead = (slug: string) =>
  resolveStatusFilter({
    collectionHasStatus: true,
    overrideAccess: false,
    explicit: "draft",
    workflow: workflowForCollection(slug),
  });

describe("a collection's declared workflow", () => {
  afterEach(() => {
    clearCollectionWorkflows();
  });

  it("bounds a public read to the states IT calls public", () => {
    registerCollectionWorkflow("articles", EDITORIAL);
    expect(publicRead("articles")).toEqual({
      values: ["live"],
      isPublicRead: true,
    });
  });

  it("keeps a document in review OUT of a public read", () => {
    // The property the whole change exists for, stated as the exclusion rather
    // than as the inclusion: a state the workflow does not publish must not be
    // in the set a public read filters by.
    registerCollectionWorkflow("articles", EDITORIAL);
    expect(publicRead("articles")?.values).not.toContain("in_review");
    expect(publicRead("articles")?.values).not.toContain("draft");
  });

  it("shows in-review work to a caller asking for unpublished work", () => {
    // The other half. A drafts view that showed only the state literally named
    // `draft` would hide the queue this workflow exists to create.
    registerCollectionWorkflow("articles", EDITORIAL);
    expect(draftRead("articles")).toEqual({
      values: ["draft", "in_review"],
      isPublicRead: false,
    });
  });

  it("leaves a collection that declared nothing on the default pair", () => {
    // The control, and the safe fallback: an unregistered collection answers
    // exactly as it did before workflows existed.
    expect(publicRead("unregistered")).toEqual({
      values: ["published"],
      isPublicRead: true,
    });
    expect(draftRead("unregistered")).toEqual({
      values: ["draft"],
      isPublicRead: false,
    });
  });

  it("does not leak one collection's workflow to another", () => {
    // A registry keyed by slug that answered for every slug would pass every
    // case above while making one collection's states everyone's.
    registerCollectionWorkflow("articles", EDITORIAL);
    expect(publicRead("products")?.values).toEqual(["published"]);
  });

  it("replaces a registration rather than accumulating one", () => {
    // A reload of the config is the same collection saying something new. Left
    // to accumulate, the old states would go on answering after the
    // declaration changed.
    registerCollectionWorkflow("articles", EDITORIAL);
    registerCollectionWorkflow(
      "articles",
      defineWorkflow({
        name: "simple",
        states: [
          { name: "draft", isPublic: false },
          { name: "published", isPublic: true },
        ],
      })
    );
    expect(publicRead("articles")?.values).toEqual(["published"]);
  });
});
