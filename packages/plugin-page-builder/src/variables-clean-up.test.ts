/**
 * "Clean up unused…" on the server: each variable asked about is judged and
 * removed on its own, so one found in use is kept, named with why, and never
 * holds back or rolls back the others.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { VARIABLE_CLEAN_UP_ROUTE_PATH } from "./library-contract";
import { cleanUpVariables, type CleanUpEach } from "./variables-clean-up";

const post = (body: unknown) =>
  new Request(`http://local${VARIABLE_CLEAN_UP_ROUTE_PATH}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

async function refusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

const NAMES = new Map([
  ["t-spare", "Spare"],
  ["t-accent", "Accent"],
  ["t-other", "Other"],
]);

/** The clean-up's removal of one variable, refusing those in `refusals`. */
function eachOf(
  refusals: Readonly<Record<string, unknown>> = {}
): CleanUpEach & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    names: async () => NAMES,
    remove: vi.fn(async (id: string) => {
      if (Object.hasOwn(refusals, id)) throw refusals[id];
      removed.push(id);
      // What the removal took, and the section as its write left it.
      return {
        taken: [{ id, entry: { id }, at: 0, orderAt: null }],
        section: { tokens: [], after: [...removed] },
      };
    }),
  };
}

const inUse = (message: string) =>
  NextlyError.validation({
    errors: [{ path: "t-accent", code: "IN_USE", message }],
  });

describe("cleaning up unused variables", () => {
  it("removes each variable on its own, in the order asked", async () => {
    const each = eachOf();
    const response = await cleanUpVariables(
      post({ ids: ["t-spare", "t-other"] }),
      each
    );
    expect(each.remove).toHaveBeenNthCalledWith(1, "t-spare");
    expect(each.remove).toHaveBeenNthCalledWith(2, "t-other");
    expect(each.removed).toEqual(["t-spare", "t-other"]);
    expect(await response.json()).toEqual({
      message: "2 variables were removed.",
      item: {
        removed: ["t-spare", "t-other"],
        kept: [],
        // What each took out, in turn, and the section the last one left.
        taken: [
          { id: "t-spare", entry: { id: "t-spare" }, at: 0, orderAt: null },
          { id: "t-other", entry: { id: "t-other" }, at: 0, orderAt: null },
        ],
        section: { tokens: [], after: ["t-spare", "t-other"] },
      },
    });
  });

  it("keeps one found in use, named with where it is used, and removes the rest", async () => {
    const each = eachOf({
      "t-accent": inUse("Accent is used on 1 document."),
    });
    const response = await cleanUpVariables(
      post({ ids: ["t-spare", "t-accent", "t-other"] }),
      each
    );
    // The refusal of one is no refusal of the next.
    expect(each.removed).toEqual(["t-spare", "t-other"]);
    expect(await response.json()).toMatchObject({
      message: "2 variables were removed. 1 was kept, as it is in use.",
      item: {
        removed: ["t-spare", "t-other"],
        kept: [
          {
            id: "t-accent",
            name: "Accent",
            reason: "Accent is used on 1 document.",
          },
        ],
      },
    });
  });

  it("says a refusal in its own words, without the single removal's opening", async () => {
    const each = eachOf({
      "t-accent": NextlyError.conflict({
        reason: "state",
        message:
          "Nothing was removed. Some pages haven't been counted yet, so no variable can be removed.",
      }),
      "t-other": NextlyError.validation({
        errors: [
          { path: "", code: "IN_USE", message: "Other is used on Home." },
        ],
      }),
    });
    const response = await cleanUpVariables(
      post({ ids: ["t-accent", "t-other"] }),
      each
    );
    expect(await response.json()).toMatchObject({
      item: {
        removed: [],
        kept: [
          {
            id: "t-accent",
            reason:
              "Some pages haven't been counted yet, so no variable can be removed.",
          },
          { id: "t-other", name: "Other", reason: "Other is used on Home." },
        ],
      },
    });
  });

  it("names a variable the site does not store by its id", async () => {
    const each = eachOf({
      "t-made-up": NextlyError.conflict({
        reason: "state",
        message: "Nothing was removed. It can't be removed.",
      }),
    });
    const response = await cleanUpVariables(post({ ids: ["t-made-up"] }), each);
    expect(await response.json()).toMatchObject({
      item: { kept: [{ id: "t-made-up", name: "t-made-up" }] },
    });
  });

  it("passes over a variable already gone, as neither removed nor kept", async () => {
    const each = eachOf({
      "t-spare": NextlyError.notFound({ message: "There is no variable." }),
    });
    const response = await cleanUpVariables(
      post({ ids: ["t-spare", "t-other"] }),
      each
    );
    expect(await response.json()).toMatchObject({
      message: "1 variable was removed.",
      item: { removed: ["t-other"], kept: [] },
    });
  });

  it("asks about each variable once, however often it is named", async () => {
    const each = eachOf();
    await cleanUpVariables(post({ ids: ["t-spare", "t-spare"] }), each);
    expect(each.remove).toHaveBeenCalledTimes(1);
  });

  it("stops at a failure that is no refusal, still saying what it removed, and keeps the rest", async () => {
    const broken = new Error("the database went away");
    const failed = vi.fn();
    const each = { ...eachOf({ "t-accent": broken }), failed };
    const response = await cleanUpVariables(
      post({ ids: ["t-spare", "t-accent", "t-other"] }),
      each
    );
    // Said where the site's operators read it, not swallowed.
    expect(failed).toHaveBeenCalledWith("t-accent", broken);
    // Nothing asked after the failure.
    expect(each.removed).toEqual(["t-spare"]);
    expect(each.remove).toHaveBeenCalledTimes(2);
    const unfinished = "It could not be removed just now. Try again.";
    expect(await response.json()).toMatchObject({
      item: {
        removed: ["t-spare"],
        taken: [{ id: "t-spare" }],
        section: { after: ["t-spare"] },
        kept: [
          { id: "t-accent", name: "Accent", reason: unfinished },
          { id: "t-other", name: "Other", reason: unfinished },
        ],
      },
    });
  });

  it("answers no section when nothing was removed", async () => {
    const each = eachOf({ "t-spare": inUse("Spare is used on Home.") });
    const response = await cleanUpVariables(post({ ids: ["t-spare"] }), each);
    const { item } = (await response.json()) as { item: object };
    expect(item).toMatchObject({ removed: [], taken: [] });
    expect(item).not.toHaveProperty("section");
  });

  it("refuses a body that does not name variables, removing nothing", async () => {
    const each = eachOf();
    for (const body of [
      {},
      { ids: [] },
      { ids: ["t-spare"], extra: 1 },
      { ids: Array.from({ length: 51 }, (_, at) => `t-${at}`) },
    ]) {
      expect(await refusal(cleanUpVariables(post(body), each))).toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expect(each.remove).not.toHaveBeenCalled();
  });
});
