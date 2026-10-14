/**
 * A Direct API call made as a plugin-defined person: what reaches the
 * service, and each call refused before it runs.
 *
 * The person travels in a frame rather than an argument, so these tests read
 * the frame from inside the mocked service: the service is where every access
 * decision below it reads the person from.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// A plugin's services, as `nextly.plugins` hands them out.
const pluginServices = vi.hoisted(() => ({
  shop: {
    orders: {
      placeOrder: async (args: { principal: unknown }) =>
        args.principal !== undefined,
    },
  },
}));
vi.mock("../../plugins/services/plugin-services-registry", async original => ({
  ...(await original<
    typeof import("../../plugins/services/plugin-services-registry")
  >()),
  buildPluginServicesNamespace: () => pluginServices,
}));

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { currentPrincipal, runAsPrincipal } from "../../auth/principal-scope";
import { makePrincipal } from "../../plugins/principals/principal";
import type { Principal } from "../../plugins/principals/types";
import { Nextly as NextlyClass, requireNextly, type Nextly } from "../nextly";

import {
  resetMocks,
  setupTestNextly,
  type TestMocks,
} from "./helpers/test-setup";

const person = makePrincipal("accounts:account", "acc_1", { verified: true });

const KEY: AuthenticatedScope = {
  actorType: "apiKey",
  permissions: ["read-posts"],
};

const EMPTY_LIST = {
  success: true,
  statusCode: 200,
  message: "OK",
  data: { docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 },
};

describe("a Direct API call made as a person", () => {
  let nextly: Nextly;
  let mocks: TestMocks;
  let cleanup: () => void;
  /** What the service saw the last time it ran. */
  let seen: {
    principal: Principal | null;
    overrideAccess: unknown;
    user: unknown;
  } | null;

  beforeEach(() => {
    const setup = setupTestNextly();
    nextly = setup.nextly;
    mocks = setup.mocks;
    cleanup = setup.cleanup;
    resetMocks(mocks);
    seen = null;
    mocks.collectionsHandler.listEntries.mockImplementation(
      async (options: { overrideAccess?: unknown; user?: unknown }) => {
        seen = {
          principal: currentPrincipal(),
          overrideAccess: options.overrideAccess,
          user: options.user,
        };
        return EMPTY_LIST;
      }
    );
  });

  afterAll(() => {
    cleanup?.();
  });

  it("reaches the service as the person, under access rules, with no user", async () => {
    // The instance default is `overrideAccess: true`; a person's call replaces
    // it rather than inheriting it.
    await nextly.find({ collection: "posts", principal: person });
    expect(seen).toEqual({
      principal: person,
      overrideAccess: false,
      user: undefined,
    });
  });

  it("reaches a Single read as the person too", async () => {
    let principal: Principal | null = null;
    mocks.singleEntryService.get.mockImplementation(async () => {
      principal = currentPrincipal();
      return { success: true, statusCode: 200, data: { id: "s1" } };
    });
    await nextly.findSingle({ slug: "settings", principal: person });
    expect(principal).toBe(person);
  });

  it("runs as no person when it names none, even inside a person's call", async () => {
    // A hook's own call inside a person's operation is judged as what it says
    // it is, not as the person the outer operation was made as.
    await runAsPrincipal(person, () =>
      nextly.find({ collection: "posts", overrideAccess: false })
    );
    expect(seen?.principal).toBeNull();
  });

  it("runs an operation that cannot run as a person as no person, even inside a person's call", async () => {
    // A hook's call to `forms` inside a person's operation reaches the same
    // collection service, and must not be judged as the person there: the
    // operation cannot be made as one.
    await runAsPrincipal(person, () =>
      nextly.forms.findBySlug({ slug: "contact", disableErrors: true })
    );
    expect(mocks.collectionsHandler.listEntries).toHaveBeenCalled();
    expect(seen?.principal).toBeNull();
  });

  it.each([
    ["sets overrideAccess: true", { overrideAccess: true }],
    ["sets trusted", { trusted: () => true }],
    ["names a staff user", { user: { id: "u1" } }],
    ["names a fieldAccessUser", { fieldAccessUser: { id: "u1" } }],
    ["names an API key", { actor: KEY }],
    ["sets frameworkFilter", { frameworkFilter: true as const }],
  ])("is refused, and runs nothing, when it %s", async (_label, extra) => {
    await expect(
      nextly.find({ collection: "posts", principal: person, ...extra })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.collectionsHandler.listEntries).not.toHaveBeenCalled();
  });

  it.each([
    ["a person built by hand", { ...person }],
    ["null", null],
  ])("is refused when it names %s", async (_label, principal) => {
    await expect(
      nextly.find({
        collection: "posts",
        principal: principal as unknown as Principal,
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.collectionsHandler.listEntries).not.toHaveBeenCalled();
  });

  it("is refused on a count that sets frameworkFilter", async () => {
    // A count answers 0 or 1 for a guessed value, so an exempted where on a
    // field the person may not read would tell them what it holds.
    await expect(
      nextly.count({
        collection: "posts",
        principal: person,
        frameworkFilter: true,
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.collectionsHandler.countEntries).not.toHaveBeenCalled();
  });

  it("runs as the person with overrideAccess: false said outright", async () => {
    // The control for the refusal of `true`: the setting itself is not what
    // is refused.
    await nextly.find({
      collection: "posts",
      principal: person,
      overrideAccess: false,
    });
    expect(seen?.principal).toBe(person);
  });

  it("is refused on an operation that cannot run as a person", async () => {
    // Typed out of reach, so this is a JavaScript caller's mistake. Ignored,
    // the media read would run as the server.
    const media = nextly.media as unknown as {
      find(args: Record<string, unknown>): Promise<unknown>;
    };
    await expect(media.find({ principal: person })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it.each([
    ["roles.create", (n: Nextly) => n.roles],
    ["apiKeys.create", (n: Nextly) => n.apiKeys],
    ["users.delete", (n: Nextly) => n.users],
  ])("refuses %s named with a person", async (label, pick) => {
    // Operations that never read their options through a shared helper: a
    // person ignored there would run a privileged operation as the server.
    const method = label.split(".")[1] as string;
    const namespace = pick(nextly) as unknown as Record<
      string,
      (args: Record<string, unknown>) => Promise<unknown>
    >;
    await expect(
      namespace[method]!({ id: "x", principal: person })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses register named with a person", async () => {
    const register = nextly.register as unknown as (
      args: Record<string, unknown>
    ) => Promise<unknown>;
    await expect(
      register({ email: "a@x.com", password: "pw", principal: person })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses an operation that cannot run as a person even inside that person's call", async () => {
    // A hook running for the person forwarding the same person on.
    const users = nextly.users as unknown as {
      delete(args: Record<string, unknown>): Promise<unknown>;
    };
    await expect(
      runAsPrincipal(person, () =>
        users.delete({ id: "u1", principal: person })
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a nested namespace named with a person", async () => {
    // `media.folders` is a namespace inside a namespace.
    const folders = (
      nextly.media as unknown as {
        folders: { create(args: Record<string, unknown>): Promise<unknown> };
      }
    ).folders;
    await expect(
      folders.create({ name: "x", principal: person })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a person as an instance default, which every call would ignore", () => {
    // Ignored, the default would leave each call running as the server under
    // the instance's `overrideAccess: true`.
    expect(
      () =>
        new NextlyClass({
          principal: person,
        } as unknown as ConstructorParameters<typeof NextlyClass>[0])
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("refuses a person as a requireNextly default, before any instance is reused", () => {
    expect(() =>
      requireNextly({ principal: person } as unknown as Parameters<
        typeof requireNextly
      >[0])
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("hands an operation the instance's default context as it was given", () => {
    // The settings are not a namespace: a helper held in them is not wrapped.
    const helper = () => "kept";
    const instance = new NextlyClass({ context: { helper } } as never);
    const config = (
      instance as unknown as { defaultConfig: { context: { helper: unknown } } }
    ).defaultConfig;
    expect(config.context.helper).toBe(helper);
  });

  it("leaves a plugin's own services alone", async () => {
    // A service is the plugin's code; `{ principal }` there is its own
    // argument, not a request to run as a person.
    const plugins = (nextly as unknown as { plugins: typeof pluginServices })
      .plugins;
    await expect(
      plugins.shop.orders.placeOrder({ principal: person })
    ).resolves.toBe(true);
  });
});
