/**
 * The site's content languages, for Settings.
 *
 * `GET /api/languages` lists them, removed ones included, and says whether the configuration
 * locks them. `POST /api/languages` makes one change, named by `kind`, and answers with the list
 * after it. Reading needs the settings `read` or `manage` permission, changing needs `update` or
 * `manage`, as the rest of Settings does.
 *
 * @module api/languages
 */
import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import type { LanguageSettingsService } from "../domains/i18n/services/language-settings-service";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";

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
  z.object({ kind: z.literal("setDefault"), code }),
]);

export const getLanguages = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "read", resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);
  const list = await (await languageSettings()).list();
  return respondData({ ...list });
});

export const changeLanguages = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "update", resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);
  const text = await req.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw NextlyError.validation({
      errors: [
        {
          path: "",
          code: "invalid_json",
          message: "Request body is not valid JSON.",
        },
      ],
    });
  }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  const list = await (await languageSettings()).change(parsed.data);
  return respondMutation("Languages saved.", { ...list });
});
