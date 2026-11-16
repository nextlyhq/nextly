/**
 * Two options sharing one value are refused by every write of a field group's or a Single's
 * fields, judged where the dispatcher, the REST API and the Direct API all meet: the field-group
 * and Single metadata services. Refused with `DUPLICATE` and nothing stored; options each with a
 * value of their own are accepted.
 *
 * The field group's roads are the dispatcher's direct create and update, which run no payload
 * check of their own; the Single's are its direct create and the service's own schema update, as
 * the Direct API calls it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

let t: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await t?.destroy();
  t = undefined;
});

const choice = (second: string) => [
  {
    name: "kind",
    type: "select",
    options: [
      { label: "News", value: "news" },
      { label: "Review", value: second },
    ],
  },
];
const REPEATED = choice("news");
const DISTINCT = choice("review");

/** What a write raised, or undefined when it went through. */
async function refusalOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Whether `outcome` is the refusal of a repeated option value. */
function refusedForRepeat(outcome: unknown): boolean {
  const errors = (
    outcome as { publicData?: { errors?: Array<{ code?: string }> } }
  )?.publicData?.errors;
  return (errors ?? []).some(error => error.code === "DUPLICATE");
}

/** The second option's value as stored, or null with no such entity. */
const storedSecondValue = (
  record: { fields?: unknown } | null | undefined
): string | null =>
  (
    record?.fields as
      | Array<{ name: string; options?: Array<{ value: string }> }>
      | undefined
  )?.find(field => field.name === "kind")?.options?.[1]?.value ?? null;

for (const dialect of getConfiguredTestDialects()) {
  describe(`repeated option values on every writer — ${dialect}`, () => {
    beforeEach(async () => {
      // Development, where a create applies its table at once.
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({ dialect });
    });

    const app = () => t as TestNextly;
    const fieldGroup = (slug: string) =>
      app().getService("fieldGroupRegistryService").getComponentBySlug(slug);
    const single = (slug: string) =>
      app().getService("singleRegistryService").getSingleBySlug(slug);
    const createFieldGroup = (slug: string, fields: unknown[]) =>
      dispatchComponents("createComponent", {}, { slug, label: slug, fields });
    const createSingle = (slug: string, fields: unknown[]) =>
      dispatchSingles("createSingle", {}, { slug, label: slug, fields });

    it("refuses a field group's create, storing nothing", async () => {
      expect(
        refusedForRepeat(await refusalOf(createFieldGroup("rofg", REPEATED)))
      ).toBe(true);
      expect(await fieldGroup("rofg")).toBeNull();
    });

    it("refuses a field group's update, leaving its options as they were", async () => {
      await createFieldGroup("rofgup", DISTINCT);

      const refused = await refusalOf(
        dispatchComponents(
          "updateComponent",
          { slug: "rofgup" },
          { fields: REPEATED }
        )
      );

      expect(refusedForRepeat(refused)).toBe(true);
      expect(storedSecondValue(await fieldGroup("rofgup"))).toBe("review");
    });

    it("refuses a Single's create, storing nothing", async () => {
      expect(
        refusedForRepeat(await refusalOf(createSingle("rosg", REPEATED)))
      ).toBe(true);
      expect(await single("rosg")).toBeNull();
    });

    it("refuses a Single's schema update, leaving its options as they were", async () => {
      await createSingle("rosgup", DISTINCT);

      const existing = await single("rosgup");
      // The input the dispatcher's schema save hands the service, for a fields-only change.
      const refused = await refusalOf(
        app()
          .getService("singleMetadataService")
          .updateSingleSchema({
            slug: "rosgup",
            existing,
            updateData: { fields: REPEATED },
            fields: REPEATED,
            isLocalized: false,
            wasLocalized: false,
            localizedRequested: false,
            hasStatus: false,
            wasStatus: false,
            statusRequested: false,
          } as never)
      );

      expect(refusedForRepeat(refused), String(refused)).toBe(true);
      expect(storedSecondValue(await single("rosgup"))).toBe("review");
    });

    it("accepts options each with a value of their own", async () => {
      await createFieldGroup("rofgok", DISTINCT);
      await createSingle("rosgok", DISTINCT);

      expect(storedSecondValue(await fieldGroup("rofgok"))).toBe("review");
      expect(storedSecondValue(await single("rosgok"))).toBe("review");
    });
  });
}
