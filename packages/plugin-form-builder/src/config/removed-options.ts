/**
 * Options the plugin has removed, and the one place that says so when a form
 * config still sets one.
 *
 * Both public ways into a code-defined form, `applyFormDefaults` (through
 * `createFormConfig`) and `validateFormConfig`, call this, so a config is
 * told whichever it goes through. A JavaScript config, or one written before
 * the removal, gets no type error, and without this would lose what it set
 * without a word.
 *
 * @module config/removed-options
 */

import type { FormConfig } from "../types";

/** Forms already told, so a config passing through both entry points hears it once. */
const warned = new Set<string>();

/**
 * Say so when a form config still sets `notifications.webhooks`.
 *
 * The plugin sends no webhooks of its own: a submission reaches other systems
 * through Nextly's `form.submission.created` webhook, so the option sends
 * nothing and the config is told what to use instead.
 */
export function warnIfWebhooksConfigured(config: FormConfig): void {
  const notifications: unknown = config.notifications;
  if (typeof notifications !== "object" || notifications === null) return;
  if (!("webhooks" in notifications) || warned.has(config.slug)) return;
  warned.add(config.slug);
  console.warn(
    `[form-builder] Form "${config.slug}" sets notifications.webhooks, which the Form Builder no longer reads, so those webhooks are not sent. Subscribe an endpoint to Nextly's form.submission.created webhook instead: https://nextlyhq.com/docs/plugins/form-builder#webhooks`
  );
}
