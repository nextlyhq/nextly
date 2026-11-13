/**
 * Each rule a publish of chosen parts is judged by, alone: the entry and the caller's refusals are
 * handed in as read, so each test sets up exactly the state its rule turns on. The plausible broken
 * implementations drop a rule, apply it to the wrong language or part, or move a part the request
 * refused.
 */
import { describe, expect, it } from "vitest";

import type { LifecycleParts } from "../all-locales-lifecycle";
import type { CollectionServiceResult } from "../collection-types";
import type { PublishGate } from "../publish-gate";
import {
  publishParts,
  type PartsField,
  type PartsReads,
  type PartsState,
  type PublishPartsRequest,
} from "../publish-parts";

const SLUG: PartsField = {
  name: "slug",
  label: "Slug",
  required: true,
  unique: true,
  translatable: true,
};
const TITLE: PartsField = {
  name: "title",
  label: "Title",
  required: true,
  unique: false,
  translatable: true,
};

function stateOf(overrides: Partial<PartsState> = {}): PartsState {
  return {
    configured: ["en", "es", "fr"],
    translated: true,
    defaultLocale: "en",
    sharedLive: true,
    languages: new Map(),
    fields: [],
    requireEveryLanguage: false,
    ...overrides,
  };
}

const OPEN_GATE: PublishGate = { refusals: () => Promise.resolve([]) };

/** Runs `request` against `reads`, recording each move the request makes. */
async function run(
  request: PublishPartsRequest,
  reads: Partial<PartsReads> & { state: PartsState },
  gate: PublishGate = OPEN_GATE
) {
  const moves: { direction: string; parts: LifecycleParts | undefined }[] = [];
  const result = await publishParts("entry-1", request, {
    reads: () =>
      Promise.resolve({
        languageRefusals: new Map(),
        sharedRefusal: null,
        ...reads,
      }),
    gate,
    collection: "posts",
    caller: { kind: "trusted" },
    move: (direction, parts) => {
      moves.push({ direction, parts });
      return Promise.resolve({
        success: true,
        statusCode: 200,
        message: "",
        data: { languages: [] },
      } satisfies CollectionServiceResult);
    },
  });
  const issues =
    (
      result as {
        publicData?: {
          errors?: { code: string; path: string; locale?: string }[];
        };
      }
    ).publicData?.errors ?? [];
  return { result, moves, issues };
}

const live = (values: Record<string, unknown> = {}) => ({ live: true, values });
const draft = (values: Record<string, unknown> = {}) => ({
  live: false,
  values,
});

describe("publishing chosen parts, rule by rule", () => {
  it("refuses a request that chooses nothing, and moves nothing", async () => {
    const { issues, moves } = await run(
      { direction: "publish", locales: [] },
      { state: stateOf() }
    );

    expect(issues.map(issue => issue.code)).toEqual(["NOTHING_CHOSEN"]);
    expect(moves).toEqual([]);
  });

  it("names every chosen language the site lacks or the caller may not move", async () => {
    const { issues, moves } = await run(
      { direction: "publish", locales: ["de", "es"] },
      {
        state: stateOf({
          languages: new Map([["es", draft({ title: "Hola" })]]),
        }),
        languageRefusals: new Map([["es", "Not allowed."]]),
      }
    );

    expect(issues.map(issue => [issue.code, issue.locale])).toEqual([
      ["UNKNOWN_LANGUAGE", "de"],
      ["FORBIDDEN", "es"],
    ]);
    expect(moves).toEqual([]);
  });

  it("refuses the shared part a first publish adds, and not one that stays as it is", async () => {
    const reads = {
      languages: new Map([["es", draft({ title: "Hola" })]]),
    };
    const first = await run(
      { direction: "publish", locales: ["es"] },
      { state: stateOf({ ...reads, sharedLive: false }), sharedRefusal: "No." }
    );
    const later = await run(
      { direction: "publish", locales: ["es"] },
      { state: stateOf({ ...reads, sharedLive: true }), sharedRefusal: "No." }
    );

    expect(first.issues.map(issue => [issue.code, issue.path])).toEqual([
      ["FORBIDDEN", "shared"],
    ]);
    expect(later.issues).toEqual([]);
    expect(later.moves).toEqual([
      {
        direction: "publish",
        parts: { locales: new Set(["es"]), shared: false },
      },
    ]);
  });

  it("refuses each part the gate holds back", async () => {
    const gate: PublishGate = {
      refusals: question =>
        Promise.resolve(
          question.parts
            .filter(part => part.kind === "shared")
            .map(part => ({ part, message: "Waiting." }))
        ),
    };
    const { issues } = await run(
      { direction: "publish", locales: ["es"], shared: true },
      {
        state: stateOf({
          languages: new Map([["es", draft({ title: "Hola" })]]),
        }),
      },
      gate
    );

    expect(issues.map(issue => [issue.code, issue.path])).toEqual([
      ["HELD", "shared"],
    ]);
  });

  it("keeps the shared part while a language not chosen is live, unless every language goes", async () => {
    const state = stateOf({
      languages: new Map([
        ["en", live()],
        ["es", live()],
      ]),
    });
    const some = await run(
      { direction: "unpublish", locales: ["en"], shared: true },
      { state }
    );
    const every = await run(
      { direction: "unpublish", locales: "all" },
      { state }
    );

    expect(some.issues.map(issue => issue.code)).toEqual([
      "LANGUAGES_STILL_LIVE",
    ]);
    expect(every.issues).toEqual([]);
  });

  it("refuses a language going live without its own unique value, but not the default language", async () => {
    const state = stateOf({
      sharedLive: false,
      fields: [SLUG],
      languages: new Map([
        ["en", draft({})],
        ["es", draft({})],
      ]),
    });
    const { issues } = await run(
      { direction: "publish", locales: ["en", "es"] },
      { state }
    );

    expect(issues.map(issue => [issue.code, issue.locale])).toEqual([
      ["UNIQUE_VALUE_REQUIRED_IN_LANGUAGE", "es"],
    ]);
  });

  it("refuses a language without its own required value only where every language must hold one", async () => {
    const languages = new Map([["es", draft({})]]);
    const required = await run(
      { direction: "publish", locales: ["es"] },
      {
        state: stateOf({
          fields: [TITLE],
          languages,
          requireEveryLanguage: true,
        }),
      }
    );
    const fallback = await run(
      { direction: "publish", locales: ["es"] },
      {
        state: stateOf({
          fields: [TITLE],
          languages,
          requireEveryLanguage: false,
        }),
      }
    );

    expect(required.issues.map(issue => [issue.code, issue.locale])).toEqual([
      ["REQUIRED_IN_LANGUAGE", "es"],
    ]);
    expect(fallback.issues).toEqual([]);
    expect(fallback.moves).toHaveLength(1);
  });

  it("does not judge a language already live again", async () => {
    const { issues } = await run(
      { direction: "publish", locales: ["es"] },
      {
        state: stateOf({
          fields: [SLUG],
          languages: new Map([["es", live({})]]),
        }),
      }
    );

    expect(issues).toEqual([]);
  });
});
