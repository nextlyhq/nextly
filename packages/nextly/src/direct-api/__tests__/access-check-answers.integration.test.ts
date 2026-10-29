/**
 * What `nextly.access.check` answers: may this signed-in user perform this
 * operation on this resource?
 *
 * - With no user named, never.
 * - A super-admin may do anything.
 * - Where the collection or Single declares a rule for the operation, the
 *   user needs the permission first, and then the rule decides: `true`
 *   allows; `false` or a throw refuses; a filter allows a read, since the
 *   user may read the entries it matches, and refuses a write.
 * - Where no rule is declared, the permission alone answers, on a system
 *   resource as on a collection.
 *
 * Each person holds exactly the grants named, so an answer read from the
 * wrong permission is told apart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  grantTo,
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type { AccessOperation } from "../../services/access/types";

/** A rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;

/** A rule that throws, which refuses. */
const throwing = () => {
  throw new Error("this rule fails");
};

const OPEN = "acchk_open_notes";
const RULE_TRUE = "acchk_rule_true";
const RULE_FALSE = "acchk_rule_false";
const RULE_FILTER = "acchk_rule_filter";
const RULE_THROWS = "acchk_rule_throws";
const READ_FILTER = "acchk_read_filter";
const BANNER = "acchk-banner";

describe.each(getConfiguredTestDialects())(
  "nextly.access.check (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    const check = (
      userId: string,
      operation: AccessOperation,
      resource: string
    ) => t.nextly.access.check({ userId, operation, resource });

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({ slug: OPEN, fields: [text({ name: "title" })] }),
          defineCollection({
            slug: RULE_TRUE,
            access: { update: answering(true) },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: RULE_FALSE,
            access: { update: answering(false) },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: RULE_FILTER,
            access: { update: answering({ title: { equals: "mine" } }) },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: RULE_THROWS,
            access: { update: throwing },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: READ_FILTER,
            access: { read: answering({ title: { equals: "mine" } }) },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: BANNER,
            access: { read: answering(true), update: answering(false) },
            fields: [text({ name: "message" })],
          }),
        ],
      });
      await superAdminUser(t, "acchk-super");
      await userWhoMay(t, "acchk-notes-writer", "update", [OPEN]);
      await userWhoMay(t, "acchk-ruled-writer", "update", [
        RULE_TRUE,
        RULE_FALSE,
        RULE_FILTER,
        RULE_THROWS,
      ]);
      await grantTo(t, "acchk-ruled-writer", "read", [READ_FILTER]);
      await userWhoMay(t, "acchk-banner-editor", "update", [BANNER]);
      await grantTo(t, "acchk-banner-editor", "read", [BANNER]);
      await userWhoMay(t, "acchk-settings-updater", "update", ["settings"]);
      await userWhoMay(t, "acchk-settings-manager", "manage", ["settings"]);
      // Holds a read only, on every resource above: a refusal of a change is
      // for want of that change's permission, not of any grant.
      await userWhoMay(t, "acchk-reader", "read", [
        OPEN,
        RULE_TRUE,
        RULE_FILTER,
        "settings",
      ]);
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("refuses a check naming no user", async () => {
      expect(await check("", "update", OPEN)).toBe(false);
      expect(await check("", "read", BANNER)).toBe(false);
    });

    it("allows a super-admin anything, whatever a rule says", async () => {
      expect(await check("acchk-super", "update", OPEN)).toBe(true);
      expect(await check("acchk-super", "update", RULE_FALSE)).toBe(true);
      expect(await check("acchk-super", "update", BANNER)).toBe(true);
      expect(await check("acchk-super", "delete", "settings")).toBe(true);
    });

    it("answers by the permission where no rule is declared", async () => {
      expect(await check("acchk-notes-writer", "update", OPEN)).toBe(true);
      expect(await check("acchk-notes-writer", "delete", OPEN)).toBe(false);
      expect(await check("acchk-reader", "update", OPEN)).toBe(false);
      expect(await check("acchk-reader", "read", OPEN)).toBe(true);
    });

    it("allows where the rule answers true, and only for a holder of the permission", async () => {
      expect(await check("acchk-ruled-writer", "update", RULE_TRUE)).toBe(true);
      // The permission first: a rule only narrows it.
      expect(await check("acchk-reader", "update", RULE_TRUE)).toBe(false);
    });

    it("refuses where the rule answers false or throws", async () => {
      expect(await check("acchk-ruled-writer", "update", RULE_FALSE)).toBe(
        false
      );
      expect(await check("acchk-ruled-writer", "update", RULE_THROWS)).toBe(
        false
      );
    });

    it("a write whose rule answers a filter is refused", async () => {
      // A write applies no rule's filter, so a filter does not allow it.
      expect(await check("acchk-ruled-writer", "update", RULE_FILTER)).toBe(
        false
      );
    });

    it("allows a read whose rule answers a filter: the user may read some entries", async () => {
      // A read in the user's context applies the filter and returns the
      // entries it matches, so the user may read some.
      expect(await check("acchk-ruled-writer", "read", READ_FILTER)).toBe(true);
      // The control: the same user, without the permission, is refused too,
      // and a holder of a rule that allows reads it.
      expect(await check("acchk-reader", "read", READ_FILTER)).toBe(false);
      expect(await check("acchk-banner-editor", "read", BANNER)).toBe(true);
    });

    it("asks a Single's rule as a collection's", async () => {
      expect(await check("acchk-banner-editor", "read", BANNER)).toBe(true);
      expect(await check("acchk-banner-editor", "update", BANNER)).toBe(false);
      expect(await check("acchk-reader", "read", BANNER)).toBe(false);
    });

    it("answers a system resource by its own permission", async () => {
      expect(await check("acchk-settings-updater", "update", "settings")).toBe(
        true
      );
      expect(await check("acchk-settings-updater", "delete", "settings")).toBe(
        false
      );
      expect(await check("acchk-reader", "update", "settings")).toBe(false);
      expect(await check("acchk-reader", "read", "settings")).toBe(true);
    });

    it("manage-settings alone gives neither update nor read on settings", async () => {
      // `manage-settings` is retired and counts as no plain permission, as at
      // every route gate: `nextly upgrade` converts a role still holding it.
      expect(await check("acchk-settings-manager", "update", "settings")).toBe(
        false
      );
      expect(await check("acchk-settings-manager", "read", "settings")).toBe(
        false
      );
    });
  }
);
