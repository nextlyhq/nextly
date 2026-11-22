/**
 * Offering the plugin's forms to the page builder, from the plugin's `init`:
 * its provider registered through the page builder's cross-plugin `forms`
 * service. Without the page builder installed there is no such service, and
 * nothing happens.
 *
 * @module form-provider/register
 */
import type { FormProviderService } from "@nextlyhq/plugin-sdk/blocks";
import type { PluginContext } from "nextly";

import type { ResolvedFormBuilderConfig } from "../types";

import { formsProvider } from "./provider";

/** The page builder's plugin name and the service it offers form providers under. */
const PAGE_BUILDER = "@nextlyhq/plugin-page-builder";
const FORM_SERVICE = "forms";

/** The page builder's `forms` service, where this site offers one. */
function formService(context: PluginContext): FormProviderService | undefined {
  // Read defensively: a context built by hand, as a host's own tests build
  // one, may offer no plugins' services at all.
  const plugins = context.services?.plugins as
    | Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>
    | undefined;
  const service: unknown = plugins?.[PAGE_BUILDER]?.[FORM_SERVICE];
  return typeof service === "object" &&
    service !== null &&
    typeof (service as { register?: unknown }).register === "function"
    ? (service as FormProviderService)
    : undefined;
}

/** Register the plugin's provider with the page builder, if it is installed. */
export function registerFormProvider(
  context: PluginContext,
  config: ResolvedFormBuilderConfig
): void {
  formService(context)?.register(
    formsProvider({ config, context: () => context })
  );
}
