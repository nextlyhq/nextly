/**
 * The site's choices for its files for AI tools as the SEO settings store
 * them (`aiFiles`), parsed with zod where the value is written (the
 * Single's validation) and again where it is read (llms.txt, llms-full.txt
 * and the plain-text copies), so a value edited past the screen, or stored
 * before a rule existed, is ignored rather than written into a file.
 *
 * @module settings/ai-files-stored
 */
import { z } from "zod";

import {
  AI_FILES_LIMITS,
  extraSectionProblem,
  FULL_MB_CHOICES,
  folderProblem,
  headingProblem,
  keptFolder,
  prefixProblem,
  type AiFiles,
} from "./ai-files";

/** A refinement over one of the plain checks, which say why or null. */
const checkedBy =
  <T>(problem: (value: T) => string | null) =>
  (value: T, context: z.RefinementCtx): void => {
    const said = problem(value);
    if (said !== null) context.addIssue({ code: "custom", message: said });
  };

const key = z.string().min(1).max(300);

const group = z
  .object({
    key,
    heading: z.string().superRefine(checkedBy(headingProblem)).optional(),
    optional: z.literal(true).optional(),
    leftOut: z.literal(true).optional(),
  })
  .strict();

const extraSection = z
  .object({ heading: z.string(), links: z.string().max(50_000) })
  .strict()
  .superRefine(checkedBy(extraSectionProblem));

const fullContents = z.discriminatedUnion("include", [
  z.object({ include: z.literal("everything") }).strict(),
  z
    .object({
      include: z.literal("groups"),
      groups: z.array(key).min(1).max(AI_FILES_LIMITS.groups),
    })
    .strict(),
  z
    .object({
      include: z.literal("addresses"),
      prefixes: z
        .array(
          z
            .string()
            .superRefine(checkedBy(prefixProblem))
            .transform(prefix => prefix.trim())
        )
        .min(1)
        .max(AI_FILES_LIMITS.prefixes),
    })
    .strict(),
]);

const storedAiFiles: z.ZodType<AiFiles> = z
  .object({
    groups: z.array(group).max(AI_FILES_LIMITS.groups).optional(),
    extraSections: z
      .array(extraSection)
      .max(AI_FILES_LIMITS.extraSections)
      .optional(),
    fullContents: fullContents.optional(),
    fullMaxMegabytes: z
      .number()
      .refine(
        size => (FULL_MB_CHOICES as readonly number[]).includes(size),
        `llms-full.txt may hold ${FULL_MB_CHOICES.join(", ")} MB.`
      )
      .optional(),
    // Kept as the files name them, without slashes around: `/docs/` is
    // `docs`, whichever way it was written.
    folderFiles: z
      .array(
        z.string().superRefine(checkedBy(folderProblem)).transform(keptFolder)
      )
      .max(AI_FILES_LIMITS.folderFiles)
      .optional(),
    copyLeftOut: z
      .record(
        key,
        z.array(z.string().min(1).max(300)).max(AI_FILES_LIMITS.fieldsPerType)
      )
      .optional(),
  })
  .strict()
  .superRefine((files, context) => {
    const keys = new Set<string>();
    for (const { key: each } of files.groups ?? []) {
      if (keys.has(each)) {
        context.addIssue({
          code: "custom",
          message: `The section ${each} is listed twice.`,
        });
      }
      keys.add(each);
    }
  });

/** Why stored choices for the AI files are not ones the plugin reads; null when they are. */
export function aiFilesStoredProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = storedAiFiles.safeParse(value);
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ??
        "These choices for the AI files can't be saved.");
}

/**
 * The stored choices for the AI files, where they pass their rule; none
 * where nothing is stored or the value breaks it, so no file is shaped by a
 * half-trusted value.
 */
export function storedAiFilesOf(value: unknown): AiFiles | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = storedAiFiles.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
