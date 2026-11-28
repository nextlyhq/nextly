/**
 * The route behind the settings screen's AI files card: the groups of pages
 * llms.txt lists, which the card's list of sections offers, and the first
 * lines of llms.txt as the choices being edited would write it, before they
 * are saved or llms.txt is switched on. For someone holding `manage-seo`,
 * who edits them; it reads only what the public may read, as the file does.
 *
 * @module settings/ai-files-route
 */
import {
  NextlyError,
  type PluginContext,
  type PluginRoute,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import {
  llmsGroupsOf,
  llmsTxtOf,
  type AiOutputsConfig,
} from "../outputs/ai-outputs";
import { siteOriginFor } from "../outputs/site-origin";
import { MANAGE_SEO_PERMISSION } from "../permissions";

import {
  AI_FILES_PREVIEW_ROUTE_PATH,
  PREVIEW_LINES,
  type AiFiles,
  type AiFilesPreviewBody,
} from "./ai-files";
import { aiFilesStoredProblem, storedAiFilesOf } from "./ai-files-stored";

/** What the screen sends: the choices as it holds them, stored form. */
const PREVIEW_BODY = z.object({ aiFiles: z.unknown().optional() }).strict();

/** The choices the request sends, checked by the stored value's rule, or a refusal. */
async function choicesOf(req: Request): Promise<AiFiles | undefined> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  const parsed = PREVIEW_BODY.safeParse(raw);
  const problem = parsed.success
    ? aiFilesStoredProblem(parsed.data.aiFiles)
    : "The request body is not one this route accepts.";
  if (!parsed.success || problem !== null) {
    throw NextlyError.invalidInput({
      message: problem ?? "The request body is not one this route accepts.",
      logContext: { reason: "seo-ai-files-preview-body" },
    });
  }
  return storedAiFilesOf(parsed.data.aiFiles);
}

/**
 * The preview of llms.txt at the site's origin with `aiFiles`, and its
 * groups: the site's rules as saved, with llms.txt switched on and the
 * choices sent in place of the saved ones.
 */
export async function aiFilesPreview(
  ctx: PluginContext,
  requestOrigin: string,
  aiFiles: AiFiles | undefined,
  config: AiOutputsConfig
): Promise<AiFilesPreviewBody> {
  const origin =
    (await siteOriginFor(requestOrigin, ctx, config)) ?? requestOrigin;
  const saved = await config.readRules(ctx, undefined);
  const { aiFiles: _saved, ...rules } = saved;
  const file =
    (await llmsTxtOf(ctx, origin, config, {
      ...rules,
      llmsTxt: true,
      ...(aiFiles === undefined ? {} : { aiFiles }),
    })) ?? "";
  const lines = file.replace(/\n$/, "").split("\n");
  return {
    groups: await llmsGroupsOf(ctx, origin, config, aiFiles),
    preview: lines.slice(0, PREVIEW_LINES).join("\n"),
    lines: lines.length,
  };
}

/** The preview's route. */
export function aiFilesPreviewRoute(config: AiOutputsConfig): PluginRoute {
  return {
    method: "POST",
    path: AI_FILES_PREVIEW_ROUTE_PATH,
    requiredPermission: MANAGE_SEO_PERMISSION,
    handler: async (req, ctx) =>
      Response.json(
        await aiFilesPreview(
          ctx,
          new URL(req.url).origin,
          await choicesOf(req),
          config
        )
      ),
  };
}
