import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import { describe, expect, it } from "vitest";

import { SITE_STYLE_SLUG } from "./site-style-storage";
import {
  chooseSpacingMode,
  type SpacingModeRouteContext,
} from "./spacing-mode-route";

/** A context whose database refuses every use, so a refusal is proved first. */
function context(
  caller: SpacingModeRouteContext["caller"]
): SpacingModeRouteContext {
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error("the database was reached");
      },
    }
  ) as PluginDatabase;
  return {
    self: { singles: { [SITE_STYLE_SLUG]: "renamed-style" } },
    caller,
    db: untouched,
    dialect: "sqlite",
  };
}

/** A request whose body records that it was read. */
function request(): { req: Request; read: () => boolean } {
  let read = false;
  const req = {
    text: () => {
      read = true;
      return Promise.resolve(JSON.stringify({ mode: "classic" }));
    },
  } as unknown as Request;
  return { req, read: () => read };
}

describe("chooseSpacingMode", () => {
  it("refuses a caller who may not update the RESOLVED Site Style slug, before reading the body", async () => {
    const asked: string[] = [];
    const { req, read } = request();
    await expect(
      chooseSpacingMode(
        req,
        context({
          can: (action, resource) => {
            asked.push(`${action}:${resource}`);
            return Promise.resolve(false);
          },
        })
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(asked).toEqual(["update:renamed-style"]);
    expect(read()).toBe(false);
  });

  it("refuses an unidentified caller", async () => {
    const { req, read } = request();
    await expect(chooseSpacingMode(req, context(null))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(read()).toBe(false);
  });
});
