/**
 * How the plugin offers the form receiver: one public POST route, the send
 * limit it counts under, and the `forms` service.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import {
  EDITOR_FORM_ROUTE_PATH,
  EDITOR_FORMS_ROUTE_PATH,
} from "./editor-forms-contract";
import { FORM_SERVICE } from "./providers";
import { FORM_SEND_RULE } from "./receiver";
import { FORM_RECEIVER_PATH, FORM_SEND_LIMITS } from "./route";

describe("the plugin's form receiver", () => {
  const contributes = pageBuilder().contributes;

  it("is one public POST route, never cached", () => {
    const routes = (contributes?.routes ?? []).filter(
      route => route.path === FORM_RECEIVER_PATH
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      method: "POST",
      public: true,
      noStore: true,
    });
    // Public waives sign-in only: no permission and no other gate is mixed in.
    expect(routes[0]).not.toHaveProperty("requiredPermission");
  });

  it("is the only public route the plugin has", () => {
    expect(
      (contributes?.routes ?? [])
        .filter(route => route.public === true)
        .map(route => `${route.method} ${route.path}`)
    ).toEqual([`POST ${FORM_RECEIVER_PATH}`]);
  });

  it("declares its send limit, so the plugin's limiter exists", () => {
    expect(contributes?.limits).toEqual(FORM_SEND_LIMITS);
    expect(Object.keys(FORM_SEND_LIMITS)).toEqual([FORM_SEND_RULE]);
  });

  it("offers the forms service beside the plugin's others", () => {
    expect(Object.keys(contributes?.services ?? {})).toContain(FORM_SERVICE);
    // The blocks service is still there: the spread kept every other.
    expect(Object.keys(contributes?.services ?? {})).toContain("blocks");
  });
});

describe("the editor's form routes", () => {
  const routes = pageBuilder().contributes?.routes ?? [];

  it.each([EDITOR_FORMS_ROUTE_PATH, EDITOR_FORM_ROUTE_PATH])(
    "%s is one signed-in GET, judged as its caller",
    path => {
      const declared = routes.filter(route => route.path === path);
      expect(declared).toHaveLength(1);
      expect(declared[0]).toMatchObject({ method: "GET", checksAccess: true });
      expect(declared[0]).not.toHaveProperty("public");
    }
  );
});
