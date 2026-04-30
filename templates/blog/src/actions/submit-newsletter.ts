"use server";

/**
 * Server Action: submit the newsletter signup form.
 *
 * Writes a row into the form-builder plugin's `form-submissions`
 * collection, referencing the `newsletter` form seeded in
 * `seed/nextly.seed.ts`. Returns a structured result the client
 * component uses to decide whether to show a success or error state.
 *
 * Does not send an email itself. The form-builder plugin handles email
 * notifications from the admin UI (Form Settings -> Notifications).
 * If you want a transactional welcome email on signup, wire it up via
 * a `form-submissions` `afterChange` hook instead of doing it here.
 */

// Use project-local wrapper so getNextly() bootstraps with the
// nextly.config.ts collections list (forms, form-submissions, etc.).
// See src/lib/nextly.ts.
import { getNextly } from "@/lib/nextly";

export interface NewsletterResult {
  ok: boolean;
  error?: string;
}

export async function submitNewsletter(
  formData: FormData
): Promise<NewsletterResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  // Minimal validation - the plugin will also validate server-side.
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  try {
    const nextly = await getNextly();

    // Look up the Newsletter form by slug. Missing form = seed didn't
    // run or the user removed it. Report a clear error.
    const forms = await nextly.find({
      collection: "forms",
      where: { slug: { equals: "newsletter" } },
      limit: 1,
      depth: 0,
    });
    if (forms.totalDocs === 0) {
      return {
        ok: false,
        error:
          "Newsletter form not configured. Create one in /admin/collections/forms.",
      };
    }
    const formId = forms.docs[0].id as string;

    await nextly.create({
      collection: "form-submissions",
      data: {
        form: formId,
        submissionData: [
          { field: "name", value: name },
          { field: "email", value: email },
        ],
      },
    });

    return { ok: true };
  } catch (err) {
    console.error("[newsletter] submission failed:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
