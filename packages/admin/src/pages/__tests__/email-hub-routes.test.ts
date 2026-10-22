/**
 * That the Email hub's routes RESOLVE, each to its page and behind the grants
 * that read what it shows, and that every URL the email pages had under
 * Settings resolves to the redirect and lands on the matching place in the
 * hub.
 *
 * Asked of the resolver, as a click asks it: a template that is declared but
 * not registered falls through to `NotFoundPage` while every constant reads as
 * intended.
 *
 * @module pages/__tests__/email-hub-routes.test
 */
import { describe, expect, it } from "vitest";

import {
  EMAIL_HUB_PERMISSIONS,
  EMAIL_PROVIDER_CREATE_PERMISSIONS,
  EMAIL_PROVIDER_READ_PERMISSIONS,
  EMAIL_PROVIDER_UPDATE_PERMISSIONS,
  EMAIL_TEMPLATE_CREATE_PERMISSIONS,
  EMAIL_TEMPLATE_READ_PERMISSIONS,
  EMAIL_TEMPLATE_UPDATE_PERMISSIONS,
} from "@admin/constants/email-hub";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

import EmailDesignPage from "../dashboard/email/design";
import EmailMessagesPage from "../dashboard/email/index";
import CreateEmailTemplatePage from "../dashboard/email/messages/create";
import EditEmailTemplatePage from "../dashboard/email/messages/edit/[id]";
import CreateEmailProviderPage from "../dashboard/email/sending/create";
import EditEmailProviderPage from "../dashboard/email/sending/edit/[id]";
import EmailProvidersPage from "../dashboard/email/sending/index";
import EmailSettingsRedirect, {
  emailHubPathFor,
} from "../dashboard/redirects/EmailSettingsRedirect";

const ID = "3f6c1d2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f";

describe("the Email hub's routes", () => {
  it.each([
    [ROUTES.EMAIL, EmailMessagesPage, EMAIL_HUB_PERMISSIONS],
    [ROUTES.EMAIL_DESIGN, EmailDesignPage, EMAIL_TEMPLATE_READ_PERMISSIONS],
    [ROUTES.EMAIL_SENDING, EmailProvidersPage, EMAIL_PROVIDER_READ_PERMISSIONS],
    [
      ROUTES.EMAIL_MESSAGES_CREATE,
      CreateEmailTemplatePage,
      EMAIL_TEMPLATE_CREATE_PERMISSIONS,
    ],
    [
      buildRoute(ROUTES.EMAIL_MESSAGES_EDIT, { id: ID }),
      EditEmailTemplatePage,
      EMAIL_TEMPLATE_UPDATE_PERMISSIONS,
    ],
    [
      ROUTES.EMAIL_SENDING_CREATE,
      CreateEmailProviderPage,
      EMAIL_PROVIDER_CREATE_PERMISSIONS,
    ],
    [
      buildRoute(ROUTES.EMAIL_SENDING_EDIT, { id: ID }),
      EditEmailProviderPage,
      EMAIL_PROVIDER_UPDATE_PERMISSIONS,
    ],
  ] as const)("resolves %s to its page, guarded", (path, page, grants) => {
    const resolved = resolveRoute(path, "");
    expect(resolved.Component).toBe(page);
    expect(resolved.requiredPermission).toEqual([...grants]);
  });

  it("lets a reader see a tab without the grant that changes it", () => {
    // The read grants open the lists; only the create and edit pages ask for
    // more. Before the hub every email page asked for the manage grant, so a
    // reader holding only the read grant could see nothing at all.
    for (const grant of ["read-email-templates", "read-email-providers"]) {
      expect(EMAIL_HUB_PERMISSIONS).toContain(grant);
    }
    expect(EMAIL_TEMPLATE_UPDATE_PERMISSIONS).not.toContain(
      "read-email-templates"
    );
    expect(EMAIL_PROVIDER_UPDATE_PERMISSIONS).not.toContain(
      "read-email-providers"
    );
  });

  it("does not let the create page be read as an edit id", () => {
    expect(resolveRoute(ROUTES.EMAIL_MESSAGES_CREATE, "").Component).toBe(
      CreateEmailTemplatePage
    );
    expect(resolveRoute(ROUTES.EMAIL_SENDING_CREATE, "").Component).toBe(
      CreateEmailProviderPage
    );
  });
});

describe("the old Settings email URLs", () => {
  const OLD: Array<[old: string, now: string]> = [
    [ROUTES.SETTINGS_EMAIL_TEMPLATES, ROUTES.EMAIL],
    [ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE, ROUTES.EMAIL_MESSAGES_CREATE],
    [
      buildRoute(ROUTES.SETTINGS_EMAIL_TEMPLATES_EDIT, { id: ID }),
      buildRoute(ROUTES.EMAIL_MESSAGES_EDIT, { id: ID }),
    ],
    [ROUTES.SETTINGS_EMAIL_PROVIDERS, ROUTES.EMAIL_SENDING],
    [ROUTES.SETTINGS_EMAIL_PROVIDERS_CREATE, ROUTES.EMAIL_SENDING_CREATE],
    [
      buildRoute(ROUTES.SETTINGS_EMAIL_PROVIDERS_EDIT, { id: ID }),
      buildRoute(ROUTES.EMAIL_SENDING_EDIT, { id: ID }),
    ],
  ];

  it.each(OLD)("resolves %s to the redirect, unguarded", old => {
    const resolved = resolveRoute(old, "");
    expect(resolved.Component).toBe(EmailSettingsRedirect);
    // The page it lands on is guarded; a guard here would refuse on a URL
    // that no longer means anything.
    expect(resolved.requiredPermission).toBeUndefined();
  });

  it.each(OLD)("sends %s to %s", (old, now) => {
    expect(emailHubPathFor(old)).toBe(now);
  });

  it("names nothing else", () => {
    expect(emailHubPathFor(ROUTES.SETTINGS)).toBeNull();
    expect(
      emailHubPathFor("/admin/settings/email-templates/other/1")
    ).toBeNull();
  });
});
