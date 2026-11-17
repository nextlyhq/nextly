/**
 * The forms plugin as a form provider: the page builder's Form block lists
 * its forms, draws one from its description, and hands each native form post
 * to it here.
 *
 * Every rule about the plugin's forms stays here and in the code it calls:
 * which forms exist and are open, how answers are checked, stored and
 * emailed, the spam checks and the one-response rules. `accept` calls the
 * same `submitForm` the plugin's JSON address calls, with the visitor's
 * request, so a post through the page builder is judged exactly as one sent
 * to `/api/forms/<slug>/submit`.
 *
 * Neither package imports the other: the contract's types come from
 * `@nextlyhq/plugin-sdk/blocks`, and the provider is registered through the
 * page builder's `forms` service, from the plugin's `init`.
 *
 * @module form-provider/provider
 */
import type {
  FormAcceptResult,
  FormAccess,
  FormAfterSending,
  FormDescription,
  FormFieldDescription,
  FormListing,
  FormPost,
  FormProvider,
  FormUnavailable,
} from "@nextlyhq/plugin-sdk/blocks";
import { formAvailability, trustedClientIp, type PluginContext } from "nextly";

import { publicBotCheck } from "../handlers/bot-check";
import { submitForm } from "../handlers/submit-form";
import type {
  AnyFormField,
  FormSettings,
  ResolvedFormBuilderConfig,
} from "../types";
import { formAvailabilityNow } from "../utils/form-closing";
import { normalizeFormSettings } from "../utils/form-settings";

import { BOT_CHECK_SCRIPT_PATH } from "./bot-check-script";
import { describeField } from "./describe-fields";

/** The provider's id, stored in every Form block that picks one of its forms. */
export const FORMS_PROVIDER_ID = "forms";

/** What authors read: "Fields … come from Forms." */
const FORMS_PROVIDER_LABEL = "Forms";

/** The words a form's button says when its author wrote none. */
const DEFAULT_SUBMIT_TEXT = "Submit";

/** Where Nextly's handler is mounted in a scaffolded project. */
const API_MOUNT = "/admin/api";

/** The plugin's own name, under which its routes are served. */
const PLUGIN_NAME = "@nextlyhq/plugin-form-builder";

/** A form row, as the forms collection stores one. */
interface FormRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly slug?: unknown;
  readonly status?: unknown;
  readonly closedMessage?: unknown;
  readonly fields?: unknown;
  readonly settings?: unknown;
}

/** What the provider needs of the plugin it belongs to. */
export interface FormsProviderParts {
  readonly config: ResolvedFormBuilderConfig;
  /** The plugin's context from `init`, once the plugin has started. */
  readonly context: () => PluginContext;
}

/** The forms and submissions collections, under the names this site installed them. */
function slugsOf(parts: FormsProviderParts): {
  forms: string;
  submissions: string;
} {
  const { config } = parts;
  const self = parts.context().self;
  const forms = config.formOverrides.slug;
  const submissions = config.formSubmissionOverrides.slug;
  return {
    forms: self.collections[forms] ?? forms,
    submissions: self.collections[submissions] ?? submissions,
  };
}

/** The plugin's config with its collections under this site's names. */
function installedConfig(parts: FormsProviderParts): ResolvedFormBuilderConfig {
  const slugs = slugsOf(parts);
  return {
    ...parts.config,
    formOverrides: { ...parts.config.formOverrides, slug: slugs.forms },
    formSubmissionOverrides: {
      ...parts.config.formSubmissionOverrides,
      slug: slugs.submissions,
    },
  };
}

/** Text, or `undefined` where there is none. */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * A message the plugin stores as HTML, as the plain words the Form block
 * draws: its tags removed and its spacing collapsed.
 */
function plainWords(html: string | undefined): string | undefined {
  if (html === undefined) return undefined;
  const plain = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return plain === "" ? undefined : plain;
}

/** One form by its id, read as `access` says, or `undefined`. */
async function formById(
  parts: FormsProviderParts,
  ref: string,
  access: FormAccess,
  locale?: string
): Promise<FormRow | undefined> {
  if (ref === "") return undefined;
  const result = await parts.context().services.collections.listEntries(
    slugsOf(parts).forms,
    {
      where: { id: { equals: ref } },
      pagination: { limit: 1 },
      ...(locale === undefined ? {} : { locale }),
    },
    access
  );
  const row = result.data?.[0] as FormRow | undefined;
  // Compared again exactly: a database may compare text loosely.
  return row !== undefined && String(row.id) === ref ? row : undefined;
}

/** Whether `row` takes answers now, as the JSON address judges it. */
async function availabilityOf(parts: FormsProviderParts, row: FormRow) {
  const settings = normalizeFormSettings(row.settings);
  const formId = typeof row.id === "string" ? row.id : undefined;
  const taken =
    settings.submissionLimit === undefined || formId === undefined
      ? undefined
      : await parts
          .context()
          .services.ownCollections.count(slugsOf(parts).submissions, {
            where: {
              form: { equals: formId },
              status: { not_equals: "spam" },
            },
          });
  return formAvailabilityNow(row, settings, {
    now: new Date(),
    taken,
  });
}

/** What the form shows once a send is accepted, by its own setting. */
function afterSendingOf(settings: FormSettings): FormAfterSending {
  if (settings.confirmationType === "redirect") {
    const href = textOf(settings.redirectUrl);
    if (href !== undefined) return { kind: "page", href };
  }
  // A picked page is resolved when a send is accepted, in the visitor's
  // language; until then it is named by no address.
  if (settings.confirmationType === "relationship") {
    return { kind: "page", href: "" };
  }
  return {
    kind: "message",
    message:
      plainWords(textOf(settings.successMessage)) ??
      "Thank you for your submission!",
  };
}

/** The described fields, with the bot check's hidden answer where it has one. */
function describedFields(
  parts: FormsProviderParts,
  row: FormRow
): { fields: FormFieldDescription[]; botCheck: boolean } {
  const stored = Array.isArray(row.fields)
    ? (row.fields as AnyFormField[])
    : [];
  const fields = stored.flatMap(field => {
    const described = describeField(field);
    return described === undefined ? [] : [described];
  });
  const check = publicBotCheck(row.settings, parts.config.spamProtection);
  if (check === undefined || check === null) return { fields, botCheck: false };
  // The answer the bot check's widget fills in, posted with the form. The
  // plugin's own script draws the widget; the block never reads these.
  fields.push({
    name: check.field,
    label: "Bot check",
    kind: "hidden",
    provider: {
      "forms-bot-check": String(check.provider),
      "forms-site-key": String(check.siteKey),
    },
  });
  return { fields, botCheck: true };
}

/** The listing's state of a form: draft, published, or closed now. */
async function stateOf(
  parts: FormsProviderParts,
  row: FormRow
): Promise<FormListing["state"]> {
  if (row.status === "draft") return "draft";
  if (row.status === "closed") return "closed";
  const availability = await availabilityOf(parts, row);
  return availability.kind === "closed" ? "closed" : "published";
}

/** A post's answers as the plugin's JSON address takes a submission's `data`. */
function submittedData(
  fields: readonly FormFieldDescription[],
  answers: FormPost["answers"]
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const values = (answers.get(field.name) ?? []).filter(
      value => value !== ""
    );
    if (values.length === 0) continue;
    if (field.kind === "checkbox" && field.options === undefined) {
      // A ticked box, as the plugin reads one.
      data[field.name] = "on";
    } else if (field.kind === "checkbox") {
      data[field.name] = values;
    } else {
      // The last one sent: a widget filling the answer writes after the page's
      // own empty input.
      data[field.name] = values[values.length - 1];
    }
  }
  return data;
}

/** The forms plugin's provider, over its own config and its started context. */
export function formsProvider(parts: FormsProviderParts): FormProvider {
  const describe = async (
    ref: string,
    options: { readonly access: FormAccess; readonly locale?: string }
  ): Promise<FormDescription | FormUnavailable> => {
    const row = await formById(parts, ref, options.access, options.locale);
    // A draft reaches the public as no form at all, as at the JSON address.
    const byStatus = formAvailability(row);
    if (row === undefined) return { unavailable: "missing" };
    if (options.access.as === "public") {
      if (byStatus.kind === "absent") return { unavailable: "missing" };
      const availability = await availabilityOf(parts, row);
      if (availability.kind === "closed") {
        const message = plainWords(textOf(availability.message));
        return {
          unavailable: "closed",
          ...(message === undefined ? {} : { message }),
        };
      }
    }
    const settings = normalizeFormSettings(row.settings);
    const { fields, botCheck } = describedFields(parts, row);
    return {
      ref,
      title: textOf(row.name) ?? textOf(row.slug) ?? ref,
      fields,
      submitText: textOf(settings.submitButtonText) ?? DEFAULT_SUBMIT_TEXT,
      afterSending: afterSendingOf(settings),
      encoding: fields.some(field => field.kind === "file")
        ? "multipart"
        : "urlencoded",
      ...(botCheck
        ? {
            script: {
              module: `${API_MOUNT}/plugins/${PLUGIN_NAME}${BOT_CHECK_SCRIPT_PATH}`,
              reason: "Draws the form's bot check.",
            },
          }
        : {}),
    };
  };

  return {
    id: FORMS_PROVIDER_ID,
    label: FORMS_PROVIDER_LABEL,
    async list(access) {
      const result = await parts
        .context()
        .services.collections.listEntries(
          slugsOf(parts).forms,
          { pagination: { limit: 200 } },
          access
        );
      const rows = (result.data ?? []) as FormRow[];
      const forms = slugsOf(parts).forms;
      return await Promise.all(
        rows.map(async row => {
          const id = String(row.id);
          return {
            ref: id,
            title: textOf(row.name) ?? textOf(row.slug) ?? id,
            state: await stateOf(parts, row),
            editHref: `/admin/collections/${encodeURIComponent(forms)}/${encodeURIComponent(id)}`,
          };
        })
      );
    },
    describe,
    async accept(ref, post): Promise<FormAcceptResult> {
      const described = await describe(ref, {
        access: { as: "public" },
        ...(post.locale === undefined ? {} : { locale: post.locale }),
      });
      if ("unavailable" in described) {
        return described.unavailable === "closed"
          ? { kind: "closed" }
          : { kind: "failed" };
      }
      const row = await formById(parts, ref, { as: "public" }, post.locale);
      const slug = textOf(row?.slug);
      if (slug === undefined) return { kind: "failed" };
      const { request } = post;
      const result = await submitForm(
        {
          formSlug: slug,
          data: submittedData(described.fields, post.answers),
          request,
          metadata: {
            ipAddress: trustedClientIp(request) ?? undefined,
            userAgent: request.headers.get("user-agent") ?? undefined,
            page: request.headers.get("referer") ?? undefined,
          },
          access: { as: "public" },
          ...(post.locale === undefined ? {} : { locale: post.locale }),
        },
        { pluginContext: parts.context(), pluginConfig: installedConfig(parts) }
      );
      switch (result.outcome) {
        case "accepted":
          return result.redirect === undefined
            ? { kind: "sent" }
            : {
                kind: "sent",
                afterSending: { kind: "page", href: result.redirect },
              };
        case "invalid":
          return {
            kind: "invalid",
            issues: Object.entries(result.validationErrors ?? {}).map(
              ([field, message]) => ({ field, message })
            ),
          };
        // A second answer to a one-response form: this form takes no more
        // answers from this visitor.
        case "closed":
        case "duplicate":
          return { kind: "closed" };
        default:
          return { kind: "failed" };
      }
    },
  };
}
