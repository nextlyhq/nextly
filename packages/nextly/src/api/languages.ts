/**
 * The site's content languages, for Settings.
 *
 * `GET /api/languages` lists them, removed ones included, and says whether the configuration
 * locks them; `?defaultPreview=<code>` says instead what making that language the default would
 * touch. `POST /api/languages` makes one change, named by `kind`, and answers with the list after
 * it; making another language the default must be `confirmed`. Reading needs the settings `read` or `manage` permission, changing needs `update` or
 * `manage`, as the rest of Settings does.
 *
 * @module api/languages
 */
import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import type { LanguageSettingsService } from "../domains/i18n/services/language-settings-service";
import { getCachedNextly } from "../init";

import { readJsonBody } from "./read-json-body";
import { respondData, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function languageSettings(): Promise<LanguageSettingsService> {
  await getCachedNextly();
  return container.get<LanguageSettingsService>("languageSettingsService");
}

const code = z.string().min(1).max(20);
const label = z.string().min(1).max(255);
const direction = z.enum(["ltr", "rtl"]);
const fallback = z.array(code).max(20);

/** One change, named by `kind`. Codes are checked further, and made canonical, by the service. */
const changeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add"),
    code,
    label,
    direction: direction.optional(),
    fallback: fallback.optional(),
  }),
  z.object({
    kind: z.literal("update"),
    code,
    label: label.optional(),
    direction: direction.optional(),
    fallback: fallback.optional(),
  }),
  z.object({
    kind: z.literal("reorder"),
    codes: z.array(code).min(1).max(200),
  }),
  z.object({ kind: z.literal("remove"), code }),
  // Confirmed explicitly: the admin has seen what the change touches (`?defaultPreview=`).
  z.object({ kind: z.literal("setDefault"), code, confirmed: z.literal(true) }),
]);

/** Refuses a caller holding neither `action` nor `manage` on settings, as the rest of Settings does. */
async function requireSettings(
  req: Request,
  action: "read" | "update"
): Promise<void> {
  const authResult = await requireAnyPermission(req, [
    { action, resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);
}

export const getLanguages = withErrorHandler(async (req: Request) => {
  await requireSettings(req, "read");
  const settings = await languageSettings();
  // `?defaultPreview=fr`: what making `fr` the default would touch, shown before it is confirmed.
  const preview = new URL(req.url).searchParams.get("defaultPreview");
  if (preview !== null) {
    return respondData({ ...(await settings.previewDefaultChange(preview)) });
  }
  return respondData({ ...(await settings.list()) });
});

export const changeLanguages = withErrorHandler(async (req: Request) => {
  await requireSettings(req, "update");
  const parsed = changeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  const list = await (await languageSettings()).change(parsed.data);
  return respondMutation("Languages saved.", { ...list });
});
