// Unit tests for BrowserPromptDispatcher. The dispatcher is a pure
// function under the hood — given (candidates, pre-attached resolutions),
// produce confirmedRenames. No I/O.

import { describe, expect, it, vi } from "vitest";

import type { RenameCandidate } from "../../pushschema-pipeline-interfaces";
import { BrowserPromptDispatcher } from "../browser";

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

  it("does NOT confirm a candidate marked drop_and_add, but still proceeds (explicit choice acknowledges the drop)", async () => {
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
    expect(result.proceed).toBe(true);
  });

  it("fails closed on a rename candidate with no resolution (would drop as drop_and_add)", async () => {
    // A drop+add pair with no rename resolution destroys the from-column's
    // data; its destructive_drop event is filtered upstream, so an unresolved
    // candidate must itself fail the apply closed.
    const candidates = [candidate("dc_posts", "body", "summary")];
    const dispatcher = new BrowserPromptDispatcher([]);
    const result = await dispatcher.dispatch({
      candidates,
      events: [],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.confirmedRenames).toEqual([]);
    expect(result.proceed).toBe(false);
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
      const result = await dispatcher.dispatch({
        candidates,
        events: [],
        classification: "interactive",
        channel: "browser",
      });
      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls[0]?.[0] as string;
      expect(msg).toContain("BrowserPromptDispatcher");
      expect(msg).toContain("phone -> contact on dc_users");
      // A drifted sibling drop is unacknowledged, so the apply fails closed.
      expect(result.proceed).toBe(false);
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

  it("F5 PR 6: passes through eventResolutions for matching events", async () => {
    const dispatcher = new BrowserPromptDispatcher(
      [],
      [
        {
          kind: "provide_default",
          eventId: "add_not_null_with_nulls:dc_users.email",
          value: "guest@example.com",
        },
      ]
    );
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [
        {
          id: "add_not_null_with_nulls:dc_users.email",
          kind: "add_not_null_with_nulls",
          tableName: "dc_users",
          columnName: "email",
          nullCount: 3,
          tableRowCount: 47,
          applicableResolutions: ["provide_default", "make_optional", "abort"],
        },
      ],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).toEqual({
      kind: "provide_default",
      eventId: "add_not_null_with_nulls:dc_users.email",
      value: "guest@example.com",
    });
    expect(result.proceed).toBe(true);
  });

  it("F5 PR 6: translates legacy field resolutions to typed Resolution[] using events on the user's table", async () => {
    const dispatcher = new BrowserPromptDispatcher([], [], {
      tableName: "dc_users",
      byFieldName: {
        email: { action: "provide_default", value: "guest@example.com" },
        phone: { action: "mark_nullable" },
        archived: { action: "cancel" },
      },
    });
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [
        {
          id: "add_not_null_with_nulls:dc_users.email",
          kind: "add_not_null_with_nulls",
          tableName: "dc_users",
          columnName: "email",
          nullCount: 3,
          tableRowCount: 47,
          applicableResolutions: ["provide_default", "make_optional", "abort"],
        },
        {
          id: "add_required_field_no_default:dc_users.phone",
          kind: "add_required_field_no_default",
          tableName: "dc_users",
          columnName: "phone",
          tableRowCount: 47,
          applicableResolutions: ["provide_default", "make_optional", "abort"],
        },
        {
          id: "add_not_null_with_nulls:dc_users.archived",
          kind: "add_not_null_with_nulls",
          tableName: "dc_users",
          columnName: "archived",
          nullCount: 1,
          tableRowCount: 47,
          applicableResolutions: ["provide_default", "make_optional", "abort"],
        },
      ],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.resolutions).toHaveLength(3);
    expect(result.resolutions).toContainEqual({
      kind: "provide_default",
      eventId: "add_not_null_with_nulls:dc_users.email",
      value: "guest@example.com",
    });
    expect(result.resolutions).toContainEqual({
      kind: "make_optional",
      eventId: "add_required_field_no_default:dc_users.phone",
    });
    expect(result.resolutions).toContainEqual({
      kind: "abort",
      eventId: "add_not_null_with_nulls:dc_users.archived",
    });
  });

  it("F5 PR 6: legacy fields without a matching pipeline event are dropped silently", async () => {
    const dispatcher = new BrowserPromptDispatcher([], [], {
      tableName: "dc_users",
      byFieldName: {
        unrelated: { action: "provide_default", value: "x" },
      },
    });
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [],
      classification: "safe",
      channel: "browser",
    });
    expect(result.resolutions).toEqual([]);
  });

  it("F5 PR 6: typed eventResolutions take priority over legacy for same eventId", async () => {
    const event = {
      id: "add_not_null_with_nulls:dc_users.email",
      kind: "add_not_null_with_nulls" as const,
      tableName: "dc_users",
      columnName: "email",
      nullCount: 3,
      tableRowCount: 47,
      applicableResolutions: [
        "provide_default" as const,
        "make_optional" as const,
        "abort" as const,
      ],
    };
    const dispatcher = new BrowserPromptDispatcher(
      [],
      [{ kind: "make_optional", eventId: event.id }],
      {
        tableName: "dc_users",
        byFieldName: { email: { action: "provide_default", value: "x" } },
      }
    );
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [event],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).toEqual({
      kind: "make_optional",
      eventId: event.id,
    });
  });

  it("F5 PR 6: drops eventResolutions whose eventId is not in pipeline events (stale payload safety)", async () => {
    const dispatcher = new BrowserPromptDispatcher(
      [],
      [
        {
          kind: "provide_default",
          eventId: "add_not_null_with_nulls:no.such",
          value: "x",
        },
      ]
    );
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [],
      classification: "safe",
      channel: "browser",
    });
    expect(result.resolutions).toEqual([]);
  });

  // A column drop destroys the data in that column. The classifier emits one
  // destructive_drop event per such column; the dispatcher must refuse to
  // proceed unless the client explicitly acknowledged that specific drop, so
  // the coarse request-level `confirmed` flag cannot silently authorize data
  // loss from a buggy client or an agent.
  const dropEvent = (tableName: string, columnName: string) =>
    ({
      id: `destructive_drop:${tableName}.${columnName}`,
      kind: "destructive_drop" as const,
      tableName,
      columnName,
      columnType: "text",
      tableRowCount: 5,
      applicableResolutions: ["confirm_drop" as const, "abort" as const],
    }) as const;

  it("fails closed on a destructive_drop with no acknowledgment", async () => {
    const dispatcher = new BrowserPromptDispatcher([]);
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [dropEvent("dc_posts", "body")],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(false);
  });

  it("proceeds on a destructive_drop with a typed confirm_drop resolution", async () => {
    const ev = dropEvent("dc_posts", "body");
    const dispatcher = new BrowserPromptDispatcher(
      [],
      [{ kind: "confirm_drop", eventId: ev.id }]
    );
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [ev],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(true);
    expect(result.resolutions).toContainEqual({
      kind: "confirm_drop",
      eventId: ev.id,
    });
  });

  it("proceeds when confirm_drop arrives via the legacy per-field channel", async () => {
    const ev = dropEvent("dc_posts", "body");
    const dispatcher = new BrowserPromptDispatcher([], [], {
      tableName: "dc_posts",
      byFieldName: { body: { action: "confirm_drop" } },
    });
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [ev],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(true);
    expect(result.resolutions).toContainEqual({
      kind: "confirm_drop",
      eventId: ev.id,
    });
  });

  it("fails closed when only some of several destructive_drops are acknowledged", async () => {
    const e1 = dropEvent("dc_posts", "body");
    const e2 = dropEvent("dc_posts", "legacy");
    const dispatcher = new BrowserPromptDispatcher(
      [],
      [{ kind: "confirm_drop", eventId: e1.id }]
    );
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [e1, e2],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(false);
  });

  it("fails closed when a destructive_drop carries both confirm_drop and abort", async () => {
    // Conflicting resolutions must not run the drop: abort wins so the column
    // is never dropped-then-rolled-back after the DDL has already committed.
    const ev = dropEvent("dc_posts", "body");
    const dispatcher = new BrowserPromptDispatcher(
      [],
      [
        { kind: "confirm_drop", eventId: ev.id },
        { kind: "abort", eventId: ev.id },
      ]
    );
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [ev],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(false);
  });

  it("fails closed when a destructive_drop is aborted (legacy cancel)", async () => {
    const ev = dropEvent("dc_posts", "body");
    const dispatcher = new BrowserPromptDispatcher([], [], {
      tableName: "dc_posts",
      byFieldName: { body: { action: "cancel" } },
    });
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [ev],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(false);
  });

  it("still proceeds when there are no destructive_drop events", async () => {
    const dispatcher = new BrowserPromptDispatcher([]);
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [
        {
          id: "add_not_null_with_nulls:dc_users.email",
          kind: "add_not_null_with_nulls",
          tableName: "dc_users",
          columnName: "email",
          nullCount: 0,
          tableRowCount: 5,
          applicableResolutions: ["provide_default", "make_optional", "abort"],
        },
      ],
      classification: "interactive",
      channel: "browser",
    });
    expect(result.proceed).toBe(true);
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
