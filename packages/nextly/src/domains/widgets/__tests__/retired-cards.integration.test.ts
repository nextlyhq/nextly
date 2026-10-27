/**
 * A stored dashboard holding every retired card, converted on the way back out of the database,
 * on every configured dialect: each card becomes its successor, cards that become the same card
 * merge, and no other card is lost.
 *
 * @module domains/widgets/__tests__/retired-cards.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { WidgetLayoutService } from "../../../services/widgets/widget-layout-service";
import type { WidgetPlacement } from "../layout";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const card = (
  id: string,
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement => ({
  id,
  widgetId,
  width: "full",
  removed: false,
  ...patch,
});

describe.each(getConfiguredTestDialects())(
  "a stored layout of retired cards (%s)",
  (dialect: TestDialect) => {
    it("converts every retired card, merges only what becomes one card, and loses no other", async () => {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      const service = new WidgetLayoutService(current.adapter, silent);
      const stored = [
        card("pending", "core/pending-edits", { width: "quarter" }),
        card("cols", "core/collections", { width: "half" }),
        card("team", "core/team", { width: "third" }),
        card("sing", "core/singles", { removed: true }),
        card("home", "single/home-status", { config: { limit: 3 } }),
        card("attention", "core/needs-attention", { width: "twoThirds" }),
      ];
      await service.saveLayout("user", "dd-user", stored, 0);

      const read = await service.getLayout("user", "dd-user");
      expect(read.unreadable).toBe(false);
      // Six cards become three: Collections, Singles and the per-Single card are one Content
      // card at the first one's place, at the widest width Content allows; Unpublished changes
      // merges into the Needs attention card the layout held, which keeps its own place and
      // width; Team is untouched.
      expect(read.layout?.placements).toEqual([
        card("cols", "core/content", { width: "full" }),
        card("team", "core/team", { width: "third" }),
        card("attention", "core/needs-attention", { width: "twoThirds" }),
      ]);
    });
  }
);
