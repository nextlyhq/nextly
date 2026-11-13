/**
 * Boot-check every plugin page's startup reads
 * (`contributes.admin.pages[].startupReads`). Throws fail-fast.
 *
 * A read the startup request cannot carry would not fail anywhere a person
 * could see it: the prebuilt admin page leaves it out, and the page then
 * reads its data in a round of its own, a page that is slower than its
 * author meant with nothing to say why. So the mistake stops the process that
 * loaded the configuration, as a menu item naming a collection its plugin
 * does not contribute does (`validatePluginMenus`).
 *
 * @module plugins/validate-startup-reads
 */
import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";
import { carriedStartupRead, MAX_PAGE_STARTUP_READS } from "./startup-reads";

export function validatePluginStartupReads(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    for (const page of plugin.contributes?.admin?.pages ?? []) {
      const reads = page.startupReads ?? [];
      if (reads.length > MAX_PAGE_STARTUP_READS) {
        throw resolutionError(
          "page-startup-reads-too-many",
          `Plugin "${plugin.name}" declares ${reads.length} startup reads on ` +
            `its page "${page.path}"; a page may declare at most ` +
            `${MAX_PAGE_STARTUP_READS}. Keep the reads the page needs first.`,
          { plugin: plugin.name, page: page.path, count: reads.length }
        );
      }
      const refused = reads.find(
        read => carriedStartupRead(plugin.name, read) === null
      );
      if (refused !== undefined) {
        throw resolutionError(
          "page-startup-read-invalid",
          `Plugin "${plugin.name}" declares a startup read on its page ` +
            `"${page.path}" at "${refused.path}", which the admin's startup ` +
            `request cannot carry: name a route path starting with "/", ` +
            `of plain segments, with no ".." and at most 512 characters.`,
          { plugin: plugin.name, page: page.path, path: refused.path }
        );
      }
    }
  }
}
