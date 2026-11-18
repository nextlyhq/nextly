/**
 * A response to a request that names a language by its older spelling (`?locale=pt_BR` on a site
 * configuring `pt-BR`) says so: it is served as the standard code for one release, and the
 * response carries `Deprecation: true` and a `Warning` naming the code to send instead, so a
 * client can move before the older spelling stops being accepted.
 *
 * @module api/language-code-deprecation
 */
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import { requestedCodeAlias } from "../domains/i18n/resolve-locale";
import { carryDatesFormatted } from "../shared/lib/dates-formatted";

/**
 * `response`, with the deprecation headers where `request` named a language by its older
 * spelling; otherwise `response` itself.
 */
export function withLanguageCodeDeprecation(
  request: Request,
  response: Response,
  localization: SanitizedLocalizationConfig | undefined
): Response {
  if (!localization) return response;
  const named = new URL(request.url).searchParams.get("locale") ?? undefined;
  const alias = requestedCodeAlias(localization, named);
  if (!alias) return response;
  const headers = new Headers(response.headers);
  headers.set("Deprecation", "true");
  headers.set(
    "Warning",
    `299 - "The language code \\"${alias.requested}\\" is read as \\"${alias.standard}\\". Send \\"${alias.standard}\\": the older spelling is accepted for one release."`
  );
  // A copy of the response: whether its dates are formatted goes with it.
  return carryDatesFormatted(
    response,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  );
}
