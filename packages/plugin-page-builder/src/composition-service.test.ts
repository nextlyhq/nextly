/**
 * The composition service's first question: whether anyone is asking.
 *
 * A route is authenticated before its handler runs. The service is called
 * from code that may serve a public route, so it asks the same question
 * itself, before it reads the request or asks anything of the site. Each
 * call here hands it a request it would refuse as malformed: a service that
 * read the request first would answer with that validation error instead.
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { compositionService } from "./composition-service";

/** A plugin context no call may reach: every read through it fails loudly. */
const unreachable = new Proxy(
  {},
  {
    get(_target, name) {
      throw new Error(`the service read ctx.${String(name)}`);
    },
    ownKeys() {
      return [];
    },
  }
) as PluginContext;

const nobody = { user: null, caller: null };

async function refusal(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("the call was not refused");
}

describe("a call with no signed-in caller", () => {
  const service = compositionService(unreachable, {});

  it("is refused before its request is read, by every method", async () => {
    const malformed = { not: "a request" } as never;
    for (const call of [
      () => service.manifest(nobody, { locale: "x".repeat(99) }),
      () => service.pageAction(nobody, malformed),
      () => service.definitionAction(nobody, "", malformed),
    ]) {
      const error = await refusal(call);
      expect(NextlyError.isForbidden(error), String(error)).toBe(true);
    }
  });
});
