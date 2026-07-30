/**
 * A plugin field type reads its options from one flat view.
 *
 * Options may sit directly on the field or in the `pluginOptions` container.
 * Directly on the field is ergonomic and works only while the name differs from
 * every key the field schema declares — the manifest applies the built-in shape
 * to every field whatever its type, so an option called `options` is judged as
 * a select's choice array. The container is where a name core already uses can
 * mean something else, and the type is handed both merged so where an option
 * was stored is not something its author has to track.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { uiSchemaFieldSchema } from "../../../schemas/_zod/ui-schema";
import { detachedField } from "../detached-field";
import { pluginOptionContainer } from "../../../plugins/plugin-options";
import { pluginFieldOptionIssues } from "../plugin-field-options";

afterEach(() => {
  clearFieldTypes();
});

/** Records the options view its checks were given. */
function registerRecorder(): { seen: Record<string, unknown> | null } {
  const captured: { seen: Record<string, unknown> | null } = { seen: null };
  registerFieldType({
    type: "star-rating",
    storage: "number",
    component: "@acme/ratings/admin#StarRating",
    surfaces: ["entries", "singles", "components"],
    validateOptions(field) {
      captured.seen = field as unknown as Record<string, unknown>;
      return true;
    },
  });
  return captured;
}

describe("the plugin options container", () => {
  it("hands over an option stored directly on the field", () => {
    const captured = registerRecorder();
    pluginFieldOptionIssues({
      name: "score",
      type: "star-rating",
      ratingScale: { max: 5 },
    });

    expect(captured.seen?.ratingScale).toEqual({ max: 5 });
  });

  it("hands over an option stored in the container", () => {
    const captured = registerRecorder();
    pluginFieldOptionIssues({
      name: "score",
      type: "star-rating",
      pluginOptions: { ratingScale: { max: 5 } },
    });

    expect(captured.seen?.ratingScale).toEqual({ max: 5 });
  });

  it("gives the container a name the field schema already declares", () => {
    const captured = registerRecorder();
    pluginFieldOptionIssues({
      name: "score",
      type: "star-rating",
      options: [{ label: "Core", value: "core" }],
      pluginOptions: { options: { presets: ["a"] } },
    });

    // The type's own meaning wins on the instance it is handed; core keeps
    // reading the raw field, so nothing core does is affected.
    expect(captured.seen?.options).toEqual({ presets: ["a"] });
  });

  it("does not leave the container itself on the instance", () => {
    const captured = registerRecorder();
    pluginFieldOptionIssues({
      name: "score",
      type: "star-rating",
      pluginOptions: { ratingScale: { max: 5 } },
    });

    // One flat view: a type that had to check both places would be back where
    // it started.
    expect(captured.seen).not.toHaveProperty("pluginOptions");
  });

  it("refuses hasMany on a type whose storage holds one value", () => {
    registerRecorder();

    // Generation drops the flag to match the column and the validator reads it
    // as written, so accepting it left the two disagreeing about the same
    // field: a generated scalar the validator refused, and an array it accepted
    // that the column could not hold.
    const issues = pluginFieldOptionIssues({
      name: "score",
      type: "star-rating",
      hasMany: true,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("hasMany");
  });

  // The refusal above is specific to `hasMany`, so a declaration that simply
  // does not ask for a list has to stay accepted — otherwise every plugin field
  // would be refused by the same check.
  it("accepts a plugin field that does not ask for a list", () => {
    registerRecorder();

    expect(
      pluginFieldOptionIssues({ name: "score", type: "star-rating" })
    ).toEqual([]);
  });

  it("refuses a manifest field whose container uses a reserved name", () => {
    // The identity restatement would shadow these, so an option under either
    // name could never reach the type that declared it. Refused at the write
    // rather than silently dropped.
    const parsed = uiSchemaFieldSchema.safeParse({
      name: "score",
      type: "star-rating",
      pluginOptions: { type: "hijack" },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a container using any other name", () => {
    const parsed = uiSchemaFieldSchema.safeParse({
      name: "score",
      type: "star-rating",
      pluginOptions: { options: { presets: ["a"] }, ratingScale: { max: 5 } },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a container option named after a prototype member", () => {
    // `z.record` refuses an object carrying an own `constructor` key outright,
    // which would make this container unsavable for a name it is supposed to
    // accept — core never reads what is inside it.
    const parsed = uiSchemaFieldSchema.safeParse(
      JSON.parse(
        '{"name":"score","type":"star-rating","pluginOptions":{"constructor":{"shape":"star"}}}'
      )
    );

    expect(parsed.success).toBe(true);
  });

  it("keeps an option named __proto__ and the container's own prototype", () => {
    // A schema that rebuilt the container by assignment would take this key as
    // the copy's prototype: the option vanishes and the container stops being a
    // plain object, so every other option in it is dropped too.
    const parsed = uiSchemaFieldSchema.safeParse(
      JSON.parse(
        '{"name":"score","type":"star-rating","pluginOptions":{"__proto__":{"t":1},"ratingScale":{"max":5}}}'
      )
    );

    expect(parsed.success).toBe(true);
    const held = (parsed.success ? parsed.data.pluginOptions : {}) as object;
    expect(Object.prototype.hasOwnProperty.call(held, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(held)).toBe(Object.prototype);
  });

  it("refuses a container that is not an object", () => {
    const parsed = uiSchemaFieldSchema.safeParse({
      name: "score",
      type: "star-rating",
      pluginOptions: "nope",
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a reserved container key on a code-first declaration", () => {
    registerRecorder();

    // A code-first config never passes through the manifest schema, so the
    // refusal has to live on the path every declaration takes.
    const issues = pluginFieldOptionIssues({
      name: "score",
      type: "star-rating",
      pluginOptions: { type: "variant-a" },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("pluginOptions.type");
  });

  it("runs the reserved check even for a type declaring no rules of its own", () => {
    registerFieldType({
      type: "silent",
      storage: "number",
      component: "@acme/s/admin#Input",
      surfaces: ["entries", "singles", "components"],
    });

    const issues = pluginFieldOptionIssues({
      name: "n",
      type: "silent",
      pluginOptions: { name: "hijack" },
    });

    expect(issues).toHaveLength(1);
  });

  it("reads the container only as an own property", () => {
    const inherited = Object.create({
      pluginOptions: { ratingScale: { max: 99 } },
    }) as Record<string, unknown>;
    inherited.type = "star-rating";

    // Nothing in this field's own declaration put that there. The callers all
    // spread the field first, which strips it anyway, so this is the reader
    // agreeing with them rather than relying on them.
    expect(pluginOptionContainer(inherited)).toBeUndefined();
  });

  it("rejects a container that is an array or a class instance", () => {
    // Only a plain record can be folded, and every reader has to agree on that
    // or a field means different things on each side of a save.
    class Options {}
    expect(
      pluginOptionContainer({ type: "t", pluginOptions: ["ratingScale"] })
    ).toBeUndefined();
    expect(
      pluginOptionContainer({ type: "t", pluginOptions: new Options() })
    ).toBeUndefined();
  });

  it("cannot displace the guaranteed identity of the field", () => {
    const instance = detachedField({
      name: "score",
      type: "star-rating",
      pluginOptions: { type: "hijacked", name: "hijacked" },
    } as unknown as { name?: string; type: string });

    expect(instance.type).toBe("star-rating");
    expect(instance.name).toBe("score");
  });

  it("detaches what it folds, so a validator cannot reach the schema", () => {
    const scale = { max: 5 };
    const field = {
      name: "score",
      type: "star-rating",
      pluginOptions: { ratingScale: scale },
    } as unknown as { name?: string; type: string };

    const instance = detachedField(field) as unknown as {
      ratingScale: { max: number };
    };
    instance.ratingScale.max = 99;

    expect(scale.max).toBe(5);
  });
});
