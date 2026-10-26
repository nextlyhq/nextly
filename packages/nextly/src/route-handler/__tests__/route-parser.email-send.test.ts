/**
 * The admin API's email sending: only the template test send is left.
 *
 * `POST /email/send` and `/email/send-with-template` let any signed-in caller
 * or API key choose the recipient, so they are gone; an unmatched route is the
 * empty object, which the caller turns into a 404. The test send that took
 * their place goes to the caller's own address, and is a PATCH so that the
 * email-templates gate, which takes its permission from the method, asks for
 * `update-email-templates`. Asking where a test would go is a GET, so reading
 * templates is enough. A kept template's engine is read over GET, and reading
 * it as Liquid, which changes how it sends, needs the update permission. The
 * gate is replaced by a fake that admits a caller holding one of the
 * permissions it is asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => new Set<string>());

vi.mock("../../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../../auth/middleware")>();
  return {
    ...actual,
    requireAnyPermission: vi.fn(
      async (
        _req: Request,
        wanted: Array<{ action: string; resource: string }>
      ) =>
        wanted.some(({ action, resource }) =>
          granted.has(`${action}-${resource}`)
        )
          ? { userId: "ana", userEmail: "ana@x.test", authMethod: "session" }
          : { statusCode: 403, error: "Forbidden" }
    ),
  };
});

import { _resolveAuthorizationForTest as resolveAuthorization } from "../../routeHandler";
import { parseRestRoute } from "../route-parser";

const SEND_TEST = ["email-templates", "t1", "send-test"];

/**
 * Whether a caller holding exactly `grants` may make this request; by default
 * a template's test send.
 */
async function admits(
  grants: string[],
  path: string[] = SEND_TEST,
  httpMethod = "PATCH"
): Promise<boolean> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  const route = parseRestRoute(path, httpMethod);
  const result = await resolveAuthorization(
    new Request(`http://localhost/api/${path.join("/")}`, {
      method: httpMethod,
    }),
    route.service as string,
    route.method as string,
    route.operation as string,
    route.routeParams,
    httpMethod
  );
  return !("statusCode" in result);
}

describe("the removed email send routes", () => {
  it("routes neither POST /email/send nor /email/send-with-template", () => {
    expect(parseRestRoute(["email", "send"], "POST")).toEqual({});
    expect(parseRestRoute(["email", "send-with-template"], "POST")).toEqual({});
  });

  it("still routes templates and providers, each to its own service", () => {
    // The positive control: the email prefixes still parse, so the refusals
    // above are the routes being absent, and nothing is routed as `email`.
    expect(parseRestRoute(["email-templates"], "GET")).toMatchObject({
      service: "emailTemplates",
    });
    expect(parseRestRoute(["email-templates", "t1"], "PATCH")).toMatchObject({
      service: "emailTemplates",
      routeParams: { templateId: "t1" },
    });
    expect(parseRestRoute(["email-providers"], "GET")).toMatchObject({
      service: "emailProviders",
    });
    expect(
      parseRestRoute(["email-providers", "p1", "test"], "POST")
    ).toMatchObject({ service: "emailProviders" });
  });
});

describe("a template's test send", () => {
  beforeEach(() => granted.clear());

  it("is routed over PATCH, by the template's id", () => {
    expect(parseRestRoute(SEND_TEST, "PATCH")).toMatchObject({
      service: "emailTemplates",
      method: "sendTestTemplate",
      routeParams: { templateId: "t1" },
    });
  });

  it("is not routed over any other method", () => {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      expect(parseRestRoute(SEND_TEST, method)).not.toMatchObject({
        method: "sendTestTemplate",
      });
    }
  });

  it("says where it would go over GET, to a caller who may read templates", async () => {
    expect(parseRestRoute(SEND_TEST, "GET")).toMatchObject({
      service: "emailTemplates",
      method: "testSendTarget",
      routeParams: { templateId: "t1" },
    });
    expect(await admits(["read-email-templates"], SEND_TEST, "GET")).toBe(true);
    expect(await admits([], SEND_TEST, "GET")).toBe(false);
  });

  it("admits a caller who may update templates, or manage them", async () => {
    expect(await admits(["update-email-templates"])).toBe(true);
    expect(await admits(["manage-email-templates"])).toBe(true);
  });

  it("refuses a caller who may only read or create templates", async () => {
    expect(await admits([])).toBe(false);
    expect(await admits(["read-email-templates"])).toBe(false);
    expect(await admits(["create-email-templates"])).toBe(false);
  });
});

describe("a kept template's engine", () => {
  const ENGINE = ["email-templates", "t1", "engine"];
  const READ_AS_LIQUID = ["email-templates", "t1", "read-as-liquid"];

  it("is read over GET, by a caller who may read templates", async () => {
    expect(parseRestRoute(ENGINE, "GET")).toMatchObject({
      service: "emailTemplates",
      method: "templateEngine",
      routeParams: { templateId: "t1" },
    });
    expect(parseRestRoute(ENGINE, "PATCH")).not.toMatchObject({
      method: "templateEngine",
    });
    expect(await admits(["read-email-templates"], ENGINE, "GET")).toBe(true);
    expect(await admits([], ENGINE, "GET")).toBe(false);
  });

  it("is switched to Liquid over PATCH, only by a caller who may update templates", async () => {
    expect(parseRestRoute(READ_AS_LIQUID, "PATCH")).toMatchObject({
      service: "emailTemplates",
      method: "readAsLiquid",
      routeParams: { templateId: "t1" },
    });
    for (const method of ["GET", "POST"]) {
      expect(parseRestRoute(READ_AS_LIQUID, method)).not.toMatchObject({
        method: "readAsLiquid",
      });
    }
    expect(await admits(["update-email-templates"], READ_AS_LIQUID)).toBe(true);
    expect(await admits(["read-email-templates"], READ_AS_LIQUID)).toBe(false);
    expect(await admits(["create-email-templates"], READ_AS_LIQUID)).toBe(
      false
    );
  });
});
