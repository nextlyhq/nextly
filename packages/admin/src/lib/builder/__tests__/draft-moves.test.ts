/**
 * The saved fields a draft moves into or out of a group, as a save sends them: each by its path as
 * saved and its path in the draft, read from the draft's pending changes. A move among a field's
 * own siblings is no move here, and a field moved and also renamed or retyped is held back.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";

import {
  draftMovesOf,
  movesHints,
  previewWithMoves,
  refusedMovesOf,
} from "../draft-moves";
import { pendingChanges } from "../pending-changes";

const text = (id: string, overrides: Partial<BuilderField> = {}) =>
  ({ id, name: id, label: id, type: "text", ...overrides }) as BuilderField;

const group = (id: string, fields: BuilderField[]) =>
  text(id, { type: "group", fields });

const saved = [
  text("title"),
  text("summary"),
  group("address", [text("street"), text("city")]),
  group("billing", [text("iban")]),
];

const movesOf = (current: BuilderField[]) =>
  draftMovesOf(pendingChanges(saved, current)).moves.map(m => ({
    from: m.from,
    to: m.to,
  }));

describe("the moves a draft makes", () => {
  it("names a field moved into a group by both paths", () => {
    const current = [
      text("title"),
      group("address", [text("street"), text("city"), text("summary")]),
      group("billing", [text("iban")]),
    ];
    expect(movesOf(current)).toEqual([
      { from: ["summary"], to: ["address", "summary"] },
    ]);
  });

  it("names a field moved out of a group", () => {
    const current = [
      text("title"),
      text("summary"),
      text("street"),
      group("address", [text("city")]),
      group("billing", [text("iban")]),
    ];
    expect(movesOf(current)).toEqual([
      { from: ["address", "street"], to: ["street"] },
    ]);
  });

  it("names a field moved between two groups", () => {
    const current = [
      text("title"),
      text("summary"),
      group("address", [text("city")]),
      group("billing", [text("iban"), text("street")]),
    ];
    expect(movesOf(current)).toEqual([
      { from: ["address", "street"], to: ["billing", "street"] },
    ]);
  });

  it("names a field moved into a group nested in another by every holder", () => {
    const nested = [
      text("title"),
      group("address", [group("geo", [text("lat")])]),
    ];
    const current = [
      group("address", [group("geo", [text("lat"), text("title")])]),
    ];
    expect(
      draftMovesOf(pendingChanges(nested, current)).moves.map(m => m.to)
    ).toEqual([["address", "geo", "title"]]);
  });

  it("names the group it moves into by the draft's name for it", () => {
    const current = [
      text("title"),
      {
        ...group("address", [text("street"), text("city"), text("summary")]),
        name: "location",
      },
      group("billing", [text("iban")]),
    ];
    expect(movesOf(current)).toEqual([
      { from: ["summary"], to: ["location", "summary"] },
    ]);
  });

  it("makes no move of a field reordered among its siblings", () => {
    const current = [
      text("summary"),
      text("title"),
      group("address", [text("city"), text("street")]),
      group("billing", [text("iban")]),
    ];
    expect(movesOf(current)).toEqual([]);
  });

  it("holds back a field moved and renamed in the same draft", () => {
    const current = [
      text("title"),
      group("address", [
        text("street"),
        text("city"),
        text("summary", { name: "abstract" }),
      ]),
      group("billing", [text("iban")]),
    ];
    const { moves, withOtherChange } = draftMovesOf(
      pendingChanges(saved, current)
    );
    expect(moves).toEqual([]);
    expect(withOtherChange).toEqual(["summary"]);
  });

  it("sends no hints for a draft that moves nothing", () => {
    expect(movesHints([])).toBeUndefined();
    expect(
      movesHints([
        { label: "summary", from: ["summary"], to: ["a", "summary"] },
      ])
    ).toEqual({ moves: [{ from: ["summary"], to: ["a", "summary"] }] });
  });
});

const base: SchemaPreviewResponse = {
  hasChanges: true,
  hasDestructiveChanges: true,
  classification: "destructive",
  changes: {
    added: [],
    removed: [
      {
        name: "summary",
        type: "text",
        rowCount: 3,
        classification: "destructive",
      },
    ],
    changed: [],
    unchanged: [],
  },
  warnings: [],
  interactiveFields: [],
  ddlPreview: [],
  schemaVersion: 2,
  renamed: [],
};

describe("the review of a save with moves", () => {
  it("does not read a field moved into a group as a removed column", () => {
    const reviewed = previewWithMoves(base, [
      { label: "summary", from: ["summary"], to: ["address", "summary"] },
    ]);
    expect(reviewed.changes.removed).toEqual([]);
    expect(reviewed.hasDestructiveChanges).toBe(false);
    expect(reviewed.classification).toBe("safe");
  });

  it("keeps a removal no move accounts for", () => {
    const reviewed = previewWithMoves(base, [
      { label: "street", from: ["address", "street"], to: ["street"] },
    ]);
    expect(reviewed.changes.removed.map(r => r.name)).toEqual(["summary"]);
    expect(reviewed.classification).toBe("destructive");
  });

  it("has changes to apply for a move no column shows", () => {
    const unchanged = {
      ...base,
      hasChanges: false,
      hasDestructiveChanges: false,
      classification: "safe" as const,
      changes: { ...base.changes, removed: [] },
    };
    expect(
      previewWithMoves(unchanged, [
        {
          label: "street",
          from: ["address", "street"],
          to: ["billing", "street"],
        },
      ]).hasChanges
    ).toBe(true);
  });
});

describe("the server's refusal of a move", () => {
  const moves = [
    {
      fieldId: "f-summary",
      label: "Summary",
      from: ["summary"],
      to: ["address", "summary"],
    },
  ];
  const refusal = (
    errors: { path?: string; code?: string; message?: string }[]
  ) =>
    parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          requestId: "req_x",
          data: { errors },
        },
      },
      400
    );

  it("marks the moved field, by the path it moves to, with the message as written", () => {
    const refused = refusedMovesOf(
      refusal([
        {
          path: "address.summary",
          code: "FIELD_MOVE_REFUSED",
          message: "Summary cannot move yet.",
        },
      ]),
      moves
    );
    expect([...refused]).toEqual([["f-summary", "Summary cannot move yet."]]);
  });

  it("marks no field for another kind of refusal, a path no move names, or a failed request", () => {
    const refused = refusedMovesOf(
      refusal([
        { path: "address.summary", code: "REQUIRED", message: "Needed." },
        {
          path: "billing.summary",
          code: "FIELD_MOVE_REFUSED",
          message: "Not this one.",
        },
      ]),
      moves
    );
    expect(refused.size).toBe(0);
    expect(refusedMovesOf(new TypeError("Failed to fetch"), moves).size).toBe(
      0
    );
  });
});
