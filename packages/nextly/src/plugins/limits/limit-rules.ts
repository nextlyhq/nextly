/**
 * Checking the limit rules plugins declare, once, at start.
 *
 * A rule outside its bounds would otherwise be found by the first request
 * that reserves on it, as an error inside the work it was meant to guard.
 *
 * @module plugins/limits/limit-rules
 */
import { limitRuleProblem } from "../../domains/limits/limit-rules";
import type { PluginDefinition } from "../plugin-context";
import { resolutionError } from "../resolution-error";

/**
 * Refuse to start on a limit rule outside the documented bounds, naming the
 * plugin and the rule. A disabled plugin is not checked: nothing reserves on
 * its rules.
 *
 * @throws {NextlyError} `PLUGIN_RESOLUTION_ERROR`, reason `limit-rule-invalid`
 */
export function assertLimitRules(plugins: readonly PluginDefinition[]): void {
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const [name, rule] of Object.entries(
      plugin.contributes?.limits ?? {}
    )) {
      const problem = limitRuleProblem(name, rule);
      if (problem === undefined) continue;
      throw resolutionError(
        "limit-rule-invalid",
        `Plugin "${plugin.name}" declares the limit rule "${name}", which must ${problem}.`,
        { plugin: plugin.name, rule: name, problem }
      );
    }
  }
}
