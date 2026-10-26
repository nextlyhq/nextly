/**
 * Plugin email templates: the boot check that each contribution is one
 * template.
 *
 * A template is written in HTML or in blocks, never both or neither, and its
 * blocks pass the written rules. Without this check the owner registry would
 * refuse such a template with a log line, and the site would start without
 * it: a send naming its slug would fail long after the mistake was made.
 * Refused here, the boot names the plugin and the template.
 *
 * @module plugins/validate-email-templates
 */
import { contributionProblem } from "../domains/email/written/contribution";

import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";

/** Refuse a plugin email template that is not one template. */
export function assertEmailTemplates(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    // Disabled plugins are skipped, as the other contribution checks skip
    // them: a template nobody is running cannot fail a send.
    if (plugin.enabled === false) continue;
    for (const template of plugin.contributes?.emailTemplates ?? []) {
      const problem = contributionProblem(template);
      if (problem === null) continue;
      throw resolutionError(
        "plugin-email-template-invalid",
        `Plugin "${plugin.name}" contributes the email template "${template.slug}", which ${problem}.`,
        { plugin: plugin.name, slug: template.slug }
      );
    }
  }
}
