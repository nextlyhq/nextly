// Unit tests for BrowserPromptDispatcher. The dispatcher is a pure
// function under the hood — given (candidates, pre-attached resolutions),
// produce confirmedRenames. No I/O.

import { describe, expect, it, vi } from "vitest";

import type { RenameCandidate } from "../../pushschema-pipeline-interfaces.js";
import { BrowserPromptDispatcher } from "../browser.js";

function candidate(
  tableName: string,
  fromColumn: string,
  toColumn: string,
  typesCompatible = true
): RenameCandidate {
  return {
    tableName,
    fromColumn,
    toColumn,
    fromType: "text",
    toType: "text",
    typesCompatible,
    defaultSuggestion: typesCompatible ? "rename" : "drop_and_add",
  };
}

describe("BrowserPromptDispatcher", () => {
  it("returns empty confirmedRenames when there are no candidates", async () => {
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "summary",
        choice: "rename",
      },
    ]);
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [],
      classification: "safe",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([]);
    expect(result.resolutions).toEqual([]);
    expect(result.proceed).toBe(true);
  });

  it("confirms a rename when the resolution matches a candidate", async () => {
    const candidates = [candidate("dc_posts", "body", "summary")];
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "summary",
        choice: "rename",
      },
    ]);
    const result = await dispatcher.dispatch({
      candidates,
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([candidates[0]]);
  });

  it("does NOT confirm a candidate marked drop_and_add", async () => {
    const candidates = [candidate("dc_posts", "body", "summary")];
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "summary",
        choice: "drop_and_add",
      },
    ]);
    const result = await dispatcher.dispatch({
      candidates,
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([]);
  });

  it("does NOT confirm candidates with no matching resolution (defaults to drop_and_add)", async () => {
    const candidates = [candidate("dc_posts", "body", "summary")];
    const dispatcher = new BrowserPromptDispatcher([]);
    const result = await dispatcher.dispatch({
      candidates,
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([]);
  });

  it("ignores resolutions for unrelated candidates (orphan resolutions)", async () => {
    const candidates = [candidate("dc_posts", "body", "summary")];
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_users",
        fromColumn: "phone",
        toColumn: "contact",
        choice: "rename",
      },
    ]);
    const result = await dispatcher.dispatch({
      candidates,
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([]);
  });

  it("warns when a candidate has no matching resolution at all (sibling-table drift safety)", async () => {
    const candidates = [
      candidate("dc_users", "phone", "contact"), // no resolution at all
    ];
    const dispatcher = new BrowserPromptDispatcher([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await dispatcher.dispatch({
        candidates,
        events: [],
        classification: "interactive",
        channel: "browser",
      });
      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls[0]?.[0] as string;
      expect(msg).toContain("BrowserPromptDispatcher");
      expect(msg).toContain("phone -> contact on dc_users");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does NOT warn when every candidate has a known resolution (even drop_and_add)", async () => {
    const candidates = [candidate("dc_posts", "body", "summary")];
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "summary",
        choice: "drop_and_add",
      },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await dispatcher.dispatch({
        candidates,
        events: [],
        classification: "interactive",
        channel: "browser",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("filters Cartesian candidates down to the user's selected rename per drop", async () => {
    // Drop body, add either summary OR excerpt — pipeline will emit two
    // candidates per drop. The user picked summary in the dialog.
    const c1 = candidate("dc_posts", "body", "summary");
    const c2 = candidate("dc_posts", "body", "excerpt");
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "summary",
        choice: "rename",
      },
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "excerpt",
        choice: "drop_and_add",
      },
    ]);
    const result = await dispatcher.dispatch({
      candidates: [c1, c2],
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([c1]);
  });

  it("handles multi-table renames independently", async () => {
    const cPosts = candidate("dc_posts", "body", "summary");
    const cUsers = candidate("dc_users", "phone", "contact");
    const dispatcher = new BrowserPromptDispatcher([
      {
        tableName: "dc_posts",
        fromColumn: "body",
        toColumn: "summary",
        choice: "rename",
      },
      {
        tableName: "dc_users",
        fromColumn: "phone",
        toColumn: "contact",
        choice: "rename",
      },
    ]);
    const result = await dispatcher.dispatch({
      candidates: [cPosts, cUsers],
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([cPosts, cUsers]);
  });
});
