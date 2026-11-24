/**
 * What a bulk workflow move says when it is done (R-11): how many moved, and each refusal named with
 * its reason ("3 moved; 2 refused: no permission to submit Pricing FAQ").
 */
import { describe, expect, it, vi } from "vitest";

import {
  bulkMoveSummary,
  bulkMoveSteps,
  DOCUMENTS_PER_MOVE,
  inBatches,
} from "../bulk-workflow-moves";

describe("bulkMoveSummary", () => {
  it("counts what moved and names each refusal with its reason", () => {
    expect(
      bulkMoveSummary("submit", {
        moved: 3,
        refused: [
          { title: "Pricing FAQ", reason: "no permission to submit" },
          { title: "Launch notes", reason: "already in review" },
        ],
      })
    ).toEqual({
      head: "3 moved; 2 refused.",
      refusals: [
        "Pricing FAQ: no permission to submit.",
        "Launch notes: already in review.",
      ],
    });
  });

  it("says how many were never sent, and why, when a request was not answered", () => {
    expect(
      bulkMoveSummary("submit", {
        moved: 200,
        refused: [{ title: "Pricing FAQ", reason: "already in review" }],
        unsent: { count: 250, reason: "The server could not be reached" },
      })
    ).toEqual({
      head: "200 moved; 1 refused; 250 not sent.",
      refusals: [
        "Pricing FAQ: already in review.",
        "Not sent: The server could not be reached.",
      ],
    });
  });

  it("says assigned and sent back for those moves, and nothing refused when none was", () => {
    expect(bulkMoveSummary("assign", { moved: 2, refused: [] })).toEqual({
      head: "2 assigned.",
      refusals: [],
    });
    expect(bulkMoveSummary("sendBack", { moved: 1, refused: [] })).toEqual({
      head: "1 sent back.",
      refusals: [],
    });
  });
});

describe("bulkMoveSteps", () => {
  const step = (
    name: string,
    kind: "submit" | "approve" | "request-changes" | "move"
  ) => ({
    name,
    label: name,
    kind,
  });

  it("names the one step of each kind a list may take in bulk, never an approval", () => {
    expect(
      bulkMoveSteps([
        step("submit", "submit"),
        step("clear", "approve"),
        step("send-back", "request-changes"),
      ])
    ).toEqual({ submit: "submit", sendBack: "send-back" });
  });

  it("leaves a kind to each document where the workflow has more than one step of it", () => {
    expect(
      bulkMoveSteps([
        step("submit-legal", "submit"),
        step("submit-copy", "submit"),
        step("send-back", "request-changes"),
      ])
    ).toEqual({ sendBack: "send-back" });
  });

  it("says when the one submit step needs a comment, which the list then asks for", () => {
    expect(
      bulkMoveSteps([
        { ...step("submit", "submit"), commentRequired: true },
        step("send-back", "request-changes"),
      ])
    ).toEqual({
      submit: "submit",
      submitNeedsComment: true,
      sendBack: "send-back",
    });
  });

  it("offers no step move where the workflow has none of either kind", () => {
    expect(bulkMoveSteps([step("clear", "approve")])).toEqual({});
  });

  describe("inBatches", () => {
    it("sends items in requests of the given size and joins their answers", async () => {
      const sent: number[][] = [];
      const answer = await inBatches(
        Array.from({ length: 450 }, (_, n) => n),
        DOCUMENTS_PER_MOVE,
        batch => {
          sent.push(batch);
          return Promise.resolve({
            items: batch.filter(n => n % 100 !== 0).map(n => ({ id: n })),
            errors: batch
              .filter(n => n % 100 === 0)
              .map(n => ({ id: String(n), code: "X", message: "Refused" })),
          });
        }
      );
      expect(sent.map(batch => batch.length)).toEqual([200, 200, 50]);
      expect(answer.items).toHaveLength(445);
      expect(answer.errors.map(each => ("id" in each ? each.id : ""))).toEqual([
        "0",
        "100",
        "200",
        "300",
        "400",
      ]);
    });

    it("keeps the answers of the requests before one that fails, and says how many were not sent", async () => {
      const sent: number[][] = [];
      const failure = new Error("offline");
      const answer = await inBatches(
        Array.from({ length: 450 }, (_, n) => n),
        DOCUMENTS_PER_MOVE,
        batch => {
          sent.push(batch);
          return sent.length === 2
            ? Promise.reject(failure)
            : Promise.resolve({
                items: batch.map(n => ({ id: n })),
                errors: [],
              });
        }
      );
      // The first request's moves stand and are reported; nothing after the failure is sent.
      expect(sent.map(batch => batch.length)).toEqual([200, 200]);
      expect(answer.items).toHaveLength(200);
      expect(answer.stopped).toEqual({ reason: failure, unsent: 250 });
    });

    it("counts what was not sent in documents where each document's parts are sent apart", async () => {
      // Ten documents of two parts each, four parts a request: the second request fails, so
      // parts 4 to 19 (documents 2 to 9) were not sent. Counted as parts it would claim 16 of
      // the 10 documents selected.
      const parts = Array.from({ length: 20 }, (_, n) => ({
        document: `doc-${Math.floor(n / 2)}`,
        part: n % 2 === 0 ? null : "es",
      }));
      let requests = 0;
      const answer = await inBatches(
        parts,
        4,
        batch => {
          requests += 1;
          return requests === 2
            ? Promise.reject(new Error("offline"))
            : Promise.resolve({ items: batch, errors: [] });
        },
        part => part.document
      );
      expect(answer.stopped?.unsent).toBe(8);
    });

    it("sends nothing for nothing", async () => {
      const send = vi.fn();
      expect(await inBatches([], 200, send)).toEqual({ items: [], errors: [] });
      expect(send).not.toHaveBeenCalled();
    });
  });
});
