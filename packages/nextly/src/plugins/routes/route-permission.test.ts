/**
 * A route's permission follows its plugin's resolved names.
 *
 * The rename is the whole reason this exists: a plugin's collection can be
 * renamed by the host, and a permission slug spells the collection. A fixed
 * slug therefore demands a grant seeded under a different name on exactly the
 * installs that renamed it — which is why `plugin-page-builder`'s save route
 * shipped with no permission at all.
 *
 * @module plugins/routes/route-permission.test
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { permissionSlug } from "../../schemas/_zod/rbac";
import type { PluginSelf } from "../self";

import {
  resolveRoutePermission,
  routePermissionScope,
} from "./route-permission";

/** A plugin whose `patterns` collection the host renamed. */
const renamed: PluginSelf = {
  name: "@acme/builder",
  collections: { patterns: "acme_patterns" },
  singles: { settings: "acme_settings" },
};

/** The same plugin on an install that renamed nothing. */
const asDeclared: PluginSelf = {
  name: "@acme/builder",
  collections: { patterns: "patterns" },
  singles: { settings: "settings" },
};

describe("a route's required permission", () => {
  it("names the collection the host actually has", () => {
    const scope = routePermissionScope(renamed);
    // The point of the whole mechanism: the demanded grant moved with the
    // collection. A fixed `"create-patterns"` would name a permission this
    // install never seeded.
    expect(scope.collection("patterns", "create")).toBe("create-acme_patterns");
    expect(scope.single("settings", "update")).toBe("update-acme_settings");
  });

  it("is the same slug core seeds, not a second spelling of it", () => {
    // The composer must agree with `permissionSlug` exactly. A compose here and
    // a compose there is how a demanded grant and a seeded grant come to differ
    // by a character, and the route is then callable by nobody.
    const scope = routePermissionScope(renamed);
    expect(scope.collection("patterns", "create")).toBe(
      permissionSlug("create", "acme_patterns")
    );
  });

  it("falls back to the declared name for a collection the plugin does not own", () => {
    const scope = routePermissionScope(asDeclared);
    expect(scope.collection("posts", "read")).toBe("read-posts");
  });

  it("passes a fixed slug through untouched", () => {
    // A permission the plugin declared itself cannot be renamed by a host, so
    // the string form stays exactly what it says.
    expect(resolveRoutePermission("export-submissions", renamed)).toBe(
      "export-submissions"
    );
  });

  it("answers undefined when a route requires no permission", () => {
    expect(resolveRoutePermission(undefined, renamed)).toBeUndefined();
  });

  it("runs a resolver against the plugin's own names", () => {
    expect(
      resolveRoutePermission(
        ({ collection }) => collection("patterns", "create"),
        renamed
      )
    ).toBe("create-acme_patterns");
  });

  it("tells a resolver which plugin it is resolving for", () => {
    expect(resolveRoutePermission(scope => scope.plugin, renamed)).toBe(
      "@acme/builder"
    );
  });

  it("does not inherit a slug for a collection named after an Object member", () => {
    // A plugin may legitimately own a collection called `constructor`, and a
    // plain lookup answers with the inherited FUNCTION rather than undefined —
    // so `??` never fires and the permission names
    // `function Object() { [native code] }`. Built here as an ordinary object
    // on purpose: `resolvePluginSelf` now returns null-prototype maps, and this
    // asserts the composer is safe against the ones it does not build.
    const handBuilt: PluginSelf = {
      name: "@acme/builder",
      collections: { patterns: "patterns" },
      singles: {},
    };
    const scope = routePermissionScope(handBuilt);
    expect(scope.collection("constructor", "read")).toBe("read-constructor");
    expect(scope.single("toString", "update")).toBe("update-toString");
  });

  it("refuses an empty slug rather than reporting no permission", () => {
    // The quiet twin of a throw. The dispatcher reads the answer for
    // truthiness, and `undefined` means "this route requires no permission" —
    // so an empty string would drop the check and admit every authenticated
    // caller. Both the resolver form and the declared form.
    // Asserted as a `NextlyError` rather than on the message text: the message
    // is a log line and not a contract, while the TYPE is what stops the API
    // layer reporting a plugin misconfiguration as a bare 500.
    for (const empty of [() => "", () => "   ", ""] as const) {
      expect(() => resolveRoutePermission(empty, renamed)).toThrow(NextlyError);
    }
  });

  it("lets a throwing resolver throw, so the caller can refuse", () => {
    // NOT swallowed into `undefined`. That value means "this route requires no
    // permission", so returning it here would turn a gate that could not be
    // computed into a route with no gate — the failure opening the door it was
    // written to close. The dispatcher turns this throw into a refusal.
    expect(() =>
      resolveRoutePermission(() => {
        throw new Error("resolver blew up");
      }, renamed)
    ).toThrow("resolver blew up");
  });
});
