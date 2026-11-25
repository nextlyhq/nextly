// `GET …/translation-units` and `POST …/suggestions/{id}/accept` and `/dismiss`, of a collection
// entry and of a Single. The units are a read of the document, and deciding about a suggestion an
// update of it; each route ends at its action, and answers to its own verb alone.

import { describe, expect, it } from "vitest";

import {
  COLLECTION_ENTRY_METHODS,
  SINGLE_DOCUMENT_METHODS,
} from "../../routeHandler";
import { parseRestRoute } from "../route-parser";

const DOCUMENTS = [
  {
    path: ["collections", "posts", "entries", "p1"],
    service: "collections",
    params: { collectionName: "posts", entryId: "p1" },
    admitted: COLLECTION_ENTRY_METHODS,
    units: "getEntryTranslationUnits",
    accept: "acceptEntrySuggestion",
    dismiss: "dismissEntrySuggestion",
  },
  {
    path: ["singles", "banner"],
    service: "singles",
    params: { slug: "banner" },
    admitted: SINGLE_DOCUMENT_METHODS,
    units: "getSingleTranslationUnits",
    accept: "acceptSingleSuggestion",
    dismiss: "dismissSingleSuggestion",
  },
];

describe.each(DOCUMENTS)(
  "a translated document's units, of $service",
  ({ path, service, params, admitted, units, accept, dismiss }) => {
    it("are read as a read of the document", () => {
      expect(
        parseRestRoute([...path, "translation-units"], "GET")
      ).toMatchObject({
        service,
        method: units,
        operation: "single",
        routeParams: params,
      });
    });

    it.each([
      ["accept", accept],
      ["dismiss", dismiss],
    ])("%s a suggestion as an update of the document", (decision, method) => {
      expect(
        parseRestRoute([...path, "suggestions", "s1", decision], "POST")
      ).toMatchObject({
        service,
        method,
        operation: "update",
        routeParams: { ...params, suggestionId: "s1" },
      });
    });

    it("names the suggestion by the path alone", () => {
      const { routeParams } = parseRestRoute(
        [...path, "suggestions", "s1", "accept"],
        "POST",
        new URLSearchParams({ suggestionId: "another" })
      );
      expect(routeParams?.suggestionId).toBe("s1");
    });

    it("are admitted on the document's own permissions, never a definition's", () => {
      for (const method of [units, accept, dismiss]) {
        expect(admitted.has(method), method).toBe(true);
      }
    });

    it.each([
      ["POST", ["translation-units"]],
      ["GET", ["suggestions", "s1", "accept"]],
      ["PATCH", ["suggestions", "s1", "accept"]],
      ["DELETE", ["suggestions", "s1", "dismiss"]],
      // Another verb's action, and no action at all.
      ["POST", ["suggestions", "s1", "submit"]],
      ["POST", ["suggestions", "s1"]],
      ["POST", ["suggestions"]],
      ["POST", ["suggestions", "", "accept"]],
      // One segment spelling several, and a name every object has.
      ["POST", ["suggestions/accept"]],
      ["POST", ["suggestions", "s1", "constructor"]],
      // Past the action.
      ["GET", ["translation-units", "extra"]],
      ["POST", ["suggestions", "s1", "accept", "extra"]],
      ["POST", ["suggestions", "s1", "dismiss", "extra"]],
    ])("claims nothing for %s %j", (verb, rest) => {
      const { method } = parseRestRoute([...path, ...rest], verb);
      expect([units, accept, dismiss]).not.toContain(method);
    });
  }
);
