/**
 * Which direction a whole-document lifecycle move reports.
 *
 * @module domains/collections/services/__tests__/all-locales-lifecycle.test
 */
import { describe, expect, it } from "vitest";

import {
  PUBLISH_ALL_LOCALES,
  WITHDRAW_ALL_LOCALES,
  directionCommitted,
} from "../all-locales-lifecycle";

describe("directionCommitted", () => {
  it("reports a takedown when a hook kept a requested publish as a draft", () => {
    expect(directionCommitted("draft", PUBLISH_ALL_LOCALES)).toBe(
      WITHDRAW_ALL_LOCALES
    );
  });

  it("reports a publish when a hook kept a requested takedown live", () => {
    expect(directionCommitted("published", WITHDRAW_ALL_LOCALES)).toBe(
      PUBLISH_ALL_LOCALES
    );
  });

  it("reports the request when the document carries no lifecycle status", () => {
    expect(directionCommitted(undefined, PUBLISH_ALL_LOCALES)).toBe(
      PUBLISH_ALL_LOCALES
    );
  });
});
