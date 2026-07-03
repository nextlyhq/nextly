import { describe, expect, it } from "vitest";

import { contentDefaults, narrowContentFields } from "./contentFields";

describe("narrowContentFields", () => {
  it("keeps valid entries and fills label/bindable defaults", () => {
    const fields = narrowContentFields([
      { name: "text", type: "text" },
      { name: "level", type: "select", label: "Level", bindable: true },
    ]);
    expect(fields).toEqual([
      {
        name: "text",
        type: "text",
        label: "text",
        default: undefined,
        options: undefined,
        placeholder: undefined,
        bindable: false,
      },
      {
        name: "level",
        type: "select",
        label: "Level",
        default: undefined,
        options: undefined,
        placeholder: undefined,
        bindable: true,
      },
    ]);
  });

  it("drops entries missing a valid name or type", () => {
    const fields = narrowContentFields([
      { label: "no name" },
      { name: "bad", type: "wysiwyg" },
      { name: "ok", type: "text" },
      42,
      null,
    ]);
    expect(fields.map(f => f.name)).toEqual(["ok"]);
  });

  it("returns [] for undefined", () => {
    expect(narrowContentFields(undefined)).toEqual([]);
  });
});

describe("contentDefaults", () => {
  it("builds a defaults object honoring explicit and type defaults", () => {
    const fields = narrowContentFields([
      { name: "text", type: "text", default: "Hi" },
      { name: "level", type: "select", default: "h1" },
      { name: "open", type: "boolean" },
      { name: "count", type: "number" },
    ]);
    expect(contentDefaults(fields)).toEqual({
      text: "Hi",
      level: "h1",
      open: false,
      count: 0,
    });
  });
});
