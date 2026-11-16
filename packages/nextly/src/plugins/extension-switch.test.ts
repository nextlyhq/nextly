import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXTENSION_SWITCH_SERVICE,
  extensionFieldsOf,
  switchedOffExtensions,
  withheldFieldsOf,
} from "./extension-switch";
import { publishConfiguredExtensions } from "./extended-types";
import type { PluginDefinition } from "./plugin-context";
import {
  clearPluginServices,
  registerPluginService,
} from "./services/plugin-services-registry";

const plugin = (name: string): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: "*",
});

afterEach(() => {
  clearPluginServices();
  publishConfiguredExtensions(new Map());
});

describe("switchedOffExtensions", () => {
  it("asks each plugin's switch which types its field is off on", async () => {
    registerPluginService("@acme/notes", EXTENSION_SWITCH_SERVICE, () => ({
      switchedOff: (field: string) =>
        field === "notes" ? [{ kind: "collection", slug: "logs" }] : [],
    }));
    const off = await switchedOffExtensions([plugin("@acme/notes")], {
      "@acme/notes": ["notes", "other"],
    });
    expect(off.get("@acme/notes")?.get("notes")).toEqual(
      new Set(["collection:logs"])
    );
    expect(off.get("@acme/notes")?.get("other")).toEqual(new Set());
  });

  it("switches nothing off for a plugin with no switch", async () => {
    const off = await switchedOffExtensions([plugin("@acme/plain")], {
      "@acme/plain": ["notes"],
    });
    expect(off.get("@acme/plain")).toBeUndefined();
  });

  it("switches nothing off when a switch fails, and says so", async () => {
    const warn = vi.fn();
    registerPluginService("@acme/notes", EXTENSION_SWITCH_SERVICE, () => ({
      switchedOff: () => Promise.reject(new Error("settings unreadable")),
    }));
    const off = await switchedOffExtensions(
      [plugin("@acme/notes")],
      { "@acme/notes": ["notes"] },
      { warn }
    );
    expect(off.get("@acme/notes")).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("switches nothing off when a switch cannot even be built, and says so", async () => {
    const warn = vi.fn();
    registerPluginService("@acme/notes", EXTENSION_SWITCH_SERVICE, () => {
      throw new Error("no settings yet");
    });
    const off = await switchedOffExtensions(
      [plugin("@acme/notes")],
      { "@acme/notes": ["notes"] },
      { warn }
    );
    expect(off.get("@acme/notes")).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("withheldFieldsOf", () => {
  it("names, per type, the fields a plugin added there and switched off", async () => {
    publishConfiguredExtensions(
      new Map([
        ["collection:logs", new Map([["notes", "@acme/notes"]])],
        ["collection:posts", new Map([["notes", "@acme/notes"]])],
      ])
    );
    registerPluginService("@acme/notes", EXTENSION_SWITCH_SERVICE, () => ({
      switchedOff: () => [
        { kind: "collection", slug: "logs" },
        // Never given the field, so there is nothing to withhold.
        { kind: "collection", slug: "users" },
      ],
    }));
    const off = await switchedOffExtensions([plugin("@acme/notes")], {
      "@acme/notes": ["notes"],
    });
    expect(withheldFieldsOf(off)).toEqual({ "collection:logs": ["notes"] });
  });
});

describe("extensionFieldsOf", () => {
  it("names each field a plugin's extend adds, but never a required one", () => {
    expect(
      extensionFieldsOf(
        [
          {
            ...plugin("@acme/notes"),
            contributes: {
              extend: [
                {
                  target: { every: ["collection"] },
                  fields: [
                    { name: "notes", type: "text" },
                    // Required: a page that drew it nowhere could not be saved.
                    { name: "code", type: "text", required: true },
                    // A group holding a required field: hiding the group
                    // would leave that field unreachable.
                    {
                      name: "address",
                      type: "group",
                      fields: [
                        { name: "street", type: "text" },
                        { name: "city", type: "text", required: true },
                      ],
                    } as never,
                    // A list that must hold a row, required or not.
                    {
                      name: "steps",
                      type: "repeater",
                      minRows: 1,
                      fields: [{ name: "step", type: "text" }],
                    } as never,
                    // Required too, spelled the way validation spells it.
                    {
                      name: "sku",
                      type: "text",
                      validation: { required: true },
                    } as never,
                  ],
                },
              ],
            },
          },
        ],
        "switchable"
      )
    ).toEqual({ "@acme/notes": ["notes"] });
  });

  it("keeps a name whose any declaration holds a required field", () => {
    expect(
      extensionFieldsOf(
        [
          {
            ...plugin("@acme/notes"),
            contributes: {
              extend: [
                {
                  target: ["posts"],
                  fields: [{ name: "notes", type: "text" }],
                },
                {
                  target: ["orders"],
                  fields: [{ name: "notes", type: "text", required: true }],
                },
              ],
            },
          },
        ],
        "switchable"
      )
    ).toEqual({});
  });
});
