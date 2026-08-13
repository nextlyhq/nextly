/**
 * A plugin's admin slug, from core.
 *
 * The admin addresses a plugin by the slug core derives when it namespaces
 * that plugin's admin routes and looks up host `pluginOverrides`. Those have
 * to be the same string: a table row linking to a slug the server derives
 * differently is a dead link, and the two would agree on the day they were
 * written and drift silently afterwards.
 *
 * Exported under the admin's own name so call sites read locally, but there is
 * one implementation and it lives in core.
 *
 * @module lib/plugins/plugin-slug
 */
export { pluginAdminSlug as pluginSlug } from "nextly/config";
