/**
 * The moves a change made in code may hold, to be asked about as a rename is: a field gone from
 * one place and one of the same name and type at another, in the same entity. Nothing is guessed
 * where the answer would be a different change.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { moveCandidates } from "../move-candidates";

const text = (name: string, type = "text") =>
  ({ name, label: name, type }) as FieldDefinition;
const group = (name: string, fields: FieldDefinition[]) =>
  ({ name, label: name, type: "group", fields }) as FieldDefinition;

describe("moveCandidates", () => {
  it("finds a field moved into a group, and one moved out", () => {
    expect(
      moveCandidates([text("title"), group("meta", [])], [group("meta", [text("title")])])
    ).toEqual([{ from: ["title"], to: ["meta", "title"] }]);
    expect(
      moveCandidates([group("meta", [text("title")])], [text("title"), group("meta", [])])
    ).toEqual([{ from: ["meta", "title"], to: ["title"] }]);
  });

  it("finds a move into a group added by the same change, and out of a group it removes", () => {
    expect(
      moveCandidates([text("title")], [group("meta", [text("title")])])
    ).toEqual([{ from: ["title"], to: ["meta", "title"] }]);
    expect(
      moveCandidates([group("meta", [text("title")])], [text("title")])
    ).toEqual([{ from: ["meta", "title"], to: ["title"] }]);
  });

  it("offers nothing for a field whose type changed, or that stayed where it was", () => {
    expect(
      moveCandidates([text("title"), group("meta", [])], [group("meta", [text("title", "textarea")])])
    ).toEqual([]);
    expect(moveCandidates([text("title")], [text("title")])).toEqual([]);
  });

  it("offers nothing where two places could be meant", () => {
    expect(
      moveCandidates(
        [text("title"), group("a", []), group("b", [])],
        [group("a", [text("title")]), group("b", [text("title")])]
      )
    ).toEqual([]);
  });

  it("offers nothing where two fields of that name left and one arrived", () => {
    expect(
      moveCandidates(
        [text("title"), group("a", [text("title")]), group("b", [])],
        [group("a", []), group("b", [text("title")])]
      )
    ).toEqual([]);
  });

  it("ends on a definition that holds itself", () => {
    const loop = group("loop", []);
    (loop as unknown as { fields: FieldDefinition[] }).fields.push(loop);
    expect(moveCandidates([loop], [loop])).toEqual([]);
  });

  it("sees a container used under two parents at both, so reordering them moves nothing", () => {
    const meta = group("meta", [text("title")]);
    const left = group("left", [meta]);
    const right = group("right", [meta]);
    expect(moveCandidates([left, right], [right, left])).toEqual([]);
  });

  it("takes a renamed group's fields for the rename, not as moves", () => {
    expect(
      moveCandidates([group("meta", [text("title")])], [group("info", [text("title")])])
    ).toEqual([]);
  });
});
