/**
 * A collection whose fields carry a read rule offers no real records: a loader
 * reads as the system, so it would read past the rule. Wherever the rule sits,
 * whenever it was declared, and where nothing can be answered yet, the loader
 * is never called.
 *
 * Asked as the install's super-admin, whom the collection's own read decision
 * lets through everywhere, so a refusal here is the field-rule check's alone.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readAccessCaller } from "../../../auth/entity-read-access";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { registerFieldFunctions } from "../../../shared/lib/field-level-registry";
import { listSampleRecords, type SampleRecordCaller } from "../sample-records";

const ruled = () => text({ name: "note", access: { read: () => false } });
const number = () => text({ name: "number" });

const PLAIN = "sfr_plain";
const HOLDS_PLAIN_GROUP = "sfr_holds_plain_group";
const PLAIN_GROUP = "sfr-plain-group";

/** Each collection carrying a rule, by where it carries it. */
const RULED = [
  ["on a field", "sfr_own", [number(), ruled()]],
  ["in a group", "sfr_group", [group({ name: "details", fields: [ruled()] })]],
  [
    "in a repeater inside a group",
    "sfr_repeater",
    [
      group({
        name: "details",
        fields: [repeater({ name: "lines", fields: [ruled()] })],
      }),
    ],
  ],
  [
    "in a field group",
    "sfr_field_group",
    [fieldGroup({ name: "part", component: "sfr-inner" })],
  ],
  [
    "in a field group a field group holds",
    "sfr_nested",
    [fieldGroup({ name: "part", component: "sfr-outer" })],
  ],
  [
    "in a field group a repeater holds",
    "sfr_in_repeater",
    [
      repeater({
        name: "lines",
        fields: [fieldGroup({ name: "part", component: "sfr-inner" })],
      }),
    ],
  ],
] as const;

const registration = globalThis as unknown as {
  __nextly_isRegistered?: boolean;
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`real records and field read rules — ${dialect}`, () => {
    let t: TestNextly;
    let caller: SampleRecordCaller;
    let listed = 0;

    /** Whether the records of `collection` are offered, or how they were refused. */
    async function offered(collection: string): Promise<string> {
      return listSampleRecords(
        {
          label: "A record",
          reads: { collection },
          list: () => {
            listed++;
            return Promise.resolve([{ id: "1", label: "One" }]);
          },
          load: () => Promise.resolve({}),
        },
        caller
      ).then(
        () => "offered",
        (error: { code?: string }) => error.code ?? "no code"
      );
    }

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: PLAIN, fields: [number()] }),
          defineCollection({
            slug: HOLDS_PLAIN_GROUP,
            fields: [fieldGroup({ name: "part", component: PLAIN_GROUP })],
          }),
          ...RULED.map(([, slug, fields]) =>
            defineCollection({ slug, fields: [...fields] })
          ),
        ],
        singles: [
          defineSingle({ slug: "sfr_single", fields: [number(), ruled()] }),
        ],
        fieldGroups: [
          defineFieldGroup({ slug: PLAIN_GROUP, fields: [number()] }),
          defineFieldGroup({ slug: "sfr-inner", fields: [ruled()] }),
          defineFieldGroup({
            slug: "sfr-outer",
            fields: [fieldGroup({ name: "innerPart", component: "sfr-inner" })],
          }),
        ],
      });
      try {
        // The install's first account, which core makes super-admin.
        const owner = await t.nextly.users.create({
          email: "owner@field-rules.test",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        });
        const id = String((owner.item as { id: string | number }).id);
        caller = { readCaller: readAccessCaller({ user: { id } }), userId: id };
      } catch (error) {
        await t.destroy();
        throw error;
      }
    }, 120_000);

    beforeEach(() => {
      listed = 0;
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("offers the records of a collection with no field rule, and of one holding a field group with none", async () => {
      expect(await offered(PLAIN)).toBe("offered");
      expect(await offered(HOLDS_PLAIN_GROUP)).toBe("offered");
      expect(listed).toBe(2);
    });

    for (const [where, slug] of RULED) {
      it(`refuses a collection with a rule ${where}`, async () => {
        expect(await offered(slug)).toBe("FORBIDDEN");
        expect(listed).toBe(0);
      });
    }

    for (const [what, slug] of [
      ["a Single's slug", "sfr_single"],
      ["a slug naming nothing", "sfr_nothing"],
    ]) {
      it(`refuses ${what}, which is no collection, to super-admin too, with no field group carrying a rule`, async () => {
        // With no field group rule, no schema is read to find the collection.
        registerFieldFunctions("fieldGroup", "sfr-inner", [number()]);
        try {
          // The control: a collection is offered in the same state.
          expect(await offered(PLAIN)).toBe("offered");
          listed = 0;
          expect(await offered(slug)).toBe("FORBIDDEN");
          expect(listed).toBe(0);
        } finally {
          registerFieldFunctions("fieldGroup", "sfr-inner", [ruled()]);
        }
      });
    }

    it("follows a collection's rule added and removed after boot", async () => {
      registerFieldFunctions("collection", PLAIN, [ruled()]);
      try {
        expect(await offered(PLAIN)).toBe("FORBIDDEN");
        expect(listed).toBe(0);
      } finally {
        registerFieldFunctions("collection", PLAIN, [number()]);
      }
      expect(await offered(PLAIN)).toBe("offered");
    });

    it("follows a field group's rule added and removed after boot", async () => {
      registerFieldFunctions("fieldGroup", PLAIN_GROUP, [ruled()]);
      try {
        expect(await offered(HOLDS_PLAIN_GROUP)).toBe("FORBIDDEN");
        expect(listed).toBe(0);
      } finally {
        registerFieldFunctions("fieldGroup", PLAIN_GROUP, [number()]);
      }
      expect(await offered(HOLDS_PLAIN_GROUP)).toBe("offered");
    });

    it("refuses while the services are not registered, when no rule is known yet", async () => {
      registration.__nextly_isRegistered = false;
      try {
        expect(await offered(PLAIN)).toBe("FORBIDDEN");
        expect(listed).toBe(0);
      } finally {
        registration.__nextly_isRegistered = true;
      }
    });
  });
}
