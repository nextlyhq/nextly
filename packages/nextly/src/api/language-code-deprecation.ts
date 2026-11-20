/**
 * A response to a request that names a language by its older spelling (`?locale=pt_BR` on a site
 * configuring `pt-BR`), as the language asked for or as the one to fall back to
 * (`?fallback-locale=pt_BR`), says so: it is served as the standard code for one release, and the
 * response carries `Deprecation: true` and a `Warning` naming the code to send instead, so a
 * client can move before the older spelling stops being accepted.
 *
 * @module api/language-code-deprecation
 */
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import { requestedCodeAlias } from "../domains/i18n/resolve-locale";
import { carryDatesFormatted } from "../shared/lib/dates-formatted";

/** The query parameters that name a language, each read as its configured code for one release. */
const LANGUAGE_PARAMETERS = ["locale", "fallback-locale"] as const;

/**
 * `response`, with the deprecation headers where `request` named a language by its older
 * spelling, in any parameter that names one; otherwise `response` itself.
 */
export function withLanguageCodeDeprecation(
  request: Request,
  response: Response,
  localization: SanitizedLocalizationConfig | undefined
): Response {
  if (!localization) return response;
  const query = new URL(request.url).searchParams;
  const aliases = LANGUAGE_PARAMETERS.flatMap(parameter => {
    const alias = requestedCodeAlias(
      localization,
      query.get(parameter) ?? undefined
    );
    return alias ? [alias] : [];
  });
  if (aliases.length === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Deprecation", "true");
  // One warning value per older spelling, as the header's list form allows.
  headers.set(
    "Warning",
    aliases
      .map(
        alias =>
          `299 - "The language code \\"${alias.requested}\\" is read as \\"${alias.standard}\\". Send \\"${alias.standard}\\": the older spelling is accepted for one release."`
      )
      .join(", ")
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
