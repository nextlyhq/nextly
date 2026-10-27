import { z } from "zod";

/** A name as the plugin keeps it: trimmed, and neither empty nor past its column. */
export const NAME: z.ZodString = z.string().trim().min(1).max(255);

/** An address as a visitor typed it, trimmed, and a valid one no longer than its column. */
export const ADDRESS: z.ZodPipe<z.ZodString, z.ZodEmail> = z
  .string()
  .trim()
  .pipe(z.email().max(320));
