/**
 * form-builder HTTP route.
 *
 * Proves the flagship plugin CONTRIBUTES a real HTTP route and that it mounts
 * under the catch-all, secured by default — the canonical `contributes.routes`
 * example third-party authors copy. The 403-denied / 200-granted RBAC branches
 * are DB-backed and proven generically in the `nextly` package (route auth-matrix
 * + dispatch-auth unit tests); a plugin package only sees the public surface.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

const ROUTE_PARAMS = [
  "plugins",
  "@nextlyhq",
  "plugin-form-builder",
  "submissions",
  "export",
];

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("form-builder export route", () => {
  it("contributes the submissions export route", () => {
    const { plugin } = formBuilder();
    expect(plugin.contributes?.routes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/submissions/export",
        requiredPermission: "export-submissions",
      })
    );
  });

  it("lets whoever may read submissions read the fields a site added to them", () => {
    const { plugin } = formBuilder();
    const route = plugin.contributes?.routes?.find(
      each => each.path === "/submission-fields"
    );
    expect(route?.method).toBe("GET");
    // Asked of the collection as installed: renamed "leads", it is read-leads.
    const installedAs = (slug: string, action: string) =>
      `${action}-${slug === "form-submissions" ? "leads" : slug}`;
    const permission = route?.requiredPermission;
    expect(
      typeof permission === "function"
        ? permission({ collection: installedAs } as Parameters<
            typeof permission
          >[0])
        : permission
    ).toBe("read-leads");
  });

  it("mounts the route under the catch-all, secured by default (401 without a session)", async () => {
    current = await createTestNextly({ plugins: [formBuilder().plugin] });
    const handlers = createDynamicHandlers();
    const res = await handlers.GET(
      new Request(
        "http://localhost/api/plugins/@nextlyhq/plugin-form-builder/submissions/export"
      ),
      { params: Promise.resolve({ params: ROUTE_PARAMS }) }
    );
    expect(res.status).toBe(401);
  });
});
