/**
 * Who may change SEO: the permissions the plugin declares, and the one way
 * every route, rule and screen asks them.
 *
 * - `manage-seo` is site-wide SEO: the settings (crawler choices among them),
 *   redirects, their imports and the log of addresses not found. The
 *   settings are a Single, which core also asks its own read or update
 *   permission of. The redirects and the log are kept by the plugin, which
 *   writes them as the system while their collections answer no one through
 *   the API, so `manage-seo` alone decides who reads and changes them.
 * - `check-seo` runs the check of what search engines received, which
 *   fetches the site's own pages from the server.
 * - `edit-seo-<type>`, declared only where the site turns `pagePermissions`
 *   on, is changing the SEO of one content type's pages, beside the
 *   permission to update them. Without it a role that can edit a page keeps
 *   every other part of the page and loses only its SEO.
 *
 * A super-admin passes every route's permission check, and is granted each
 * permission a plugin declares as it is seeded, which is what the SEO
 * group's field rule reads.
 *
 * @module permissions
 */
import {
  NextlyError,
  type PluginPermission,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

/** The heading the plugin's permissions are filed under on the role screen. */
const GROUP = "SEO";

/** Site-wide SEO: settings, redirects, imports and addresses not found. */
const MANAGE = { action: "manage", resource: "seo" } as const;

/** Checking what search engines received for one of the site's pages. */
const CHECK = { action: "check", resource: "seo" } as const;

/** The site-wide SEO permission, as the role screen and a rule spell it. */
export const MANAGE_SEO_PERMISSION: string = `${MANAGE.action}-${MANAGE.resource}`;

/** The permission that runs the check, as the role screen spells it. */
export const CHECK_SEO_PERMISSION: string = `${CHECK.action}-${CHECK.resource}`;

/** The plugin's own permissions a route asks by name. */
export type SeoPermission = "manage" | "check";

const ASKED: Record<
  SeoPermission,
  { readonly action: string; readonly resource: string }
> = { manage: MANAGE, check: CHECK };

/** The parts of the page SEO permission of the content type `slug`. */
function pageSeo(slug: string): { action: string; resource: string } {
  return { action: "edit", resource: `seo-${slug}` };
}

/** The permission to change the SEO of `slug`'s pages, as a rule reads it. */
function pageSeoPermission(slug: string): string {
  const { action, resource } = pageSeo(slug);
  return `${action}-${resource}`;
}

/**
 * Every permission the plugin declares: the site-wide two, and, where the
 * site asks for them, one per content type SEO is added to.
 */
export function seoPermissionDeclarations(setup: {
  /** The collections and Singles the `seo` group is added to. */
  types: readonly string[];
  pagePermissions: boolean;
}): PluginPermission[] {
  const declared: PluginPermission[] = [
    {
      ...MANAGE,
      label: "Manage site-wide SEO",
      description:
        "Change the SEO settings, redirects and their imports, and see the addresses people asked for that do not exist. The settings also need their own read or update permission.",
      group: GROUP,
    },
    {
      ...CHECK,
      label: "Check what search engines received",
      description:
        "Fetch one of the site's own pages as search engines and social networks do, and compare what they received with what Nextly holds.",
      group: GROUP,
    },
  ];
  if (!setup.pagePermissions) return declared;
  for (const slug of new Set(setup.types)) {
    declared.push({
      ...pageSeo(slug),
      label: `Change SEO of ${slug}`,
      description: `Change the SEO of ${slug}, beside the permission to update it. A role without it can edit everything else on those pages.`,
      group: GROUP,
    });
  }
  return declared;
}

/** The part of an access rule's context the plugin's rules read. */
interface RuleCaller {
  readonly permissions?: readonly string[];
  readonly target?: { readonly slug: string };
}

/** A collection or Single rule: the caller holds site-wide SEO. */
export function holdsManageSeo(context: RuleCaller): boolean {
  return context.permissions?.includes(MANAGE_SEO_PERMISSION) === true;
}

/**
 * The `seo` group's create and update rule, where page SEO has its own
 * permission: the caller holds it for the content type the field is on.
 * Anyone else's SEO is taken out of the write, so the stored SEO stays as it
 * was and the rest of the page is saved.
 */
export function holdsPageSeo(context: RuleCaller): boolean {
  const slug = context.target?.slug;
  if (slug === undefined) return false;
  return context.permissions?.includes(pageSeoPermission(slug)) === true;
}

/**
 * Whether the caller of a route holds one of the plugin's own permissions.
 * False for a request with no signed-in caller. Asked by every route of
 * site-wide SEO and by the check; a route of another part of the plugin
 * that changes site-wide SEO asks `"manage"` here.
 */
export async function seoCan(
  ctx: PluginRouteContext,
  permission: SeoPermission
): Promise<boolean> {
  const caller = ctx.caller;
  if (caller === null || caller === undefined) return false;
  const { action, resource } = ASKED[permission];
  return caller.can(action, resource);
}

/**
 * Whether the caller may change the SEO of `slug`'s pages, where the site
 * gives page SEO its own permission; always, where it does not, since then
 * the page's own update permission decides. Says nothing about the page
 * itself, which its update is judged on.
 */
export async function mayChangePageSeo(
  ctx: PluginRouteContext,
  slug: string,
  pagePermissions: boolean
): Promise<boolean> {
  if (!pagePermissions) return true;
  const caller = ctx.caller;
  if (caller === null || caller === undefined) return false;
  const { action, resource } = pageSeo(slug);
  return caller.can(action, resource);
}

/** Refuses a caller who does not hold `permission`: a plain refusal, never data. */
async function requireSeo(
  ctx: PluginRouteContext,
  permission: SeoPermission
): Promise<void> {
  if (ctx.user === null || ctx.caller === null) {
    throw NextlyError.authRequired();
  }
  if (!(await seoCan(ctx, permission))) {
    throw NextlyError.forbidden({
      logContext: { reason: "seo-permission-missing", permission },
    });
  }
}

/**
 * A route of site-wide SEO: asked for `manage-seo` before its handler runs,
 * beside the permission the route declares for its own action.
 */
export function siteWide(route: PluginRoute): PluginRoute {
  const { handler } = route;
  return {
    ...route,
    handler: async (req, ctx) => {
      await requireSeo(ctx, "manage");
      return handler(req, ctx);
    },
  };
}
