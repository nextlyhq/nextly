/**
 * Email Template Service
 *
 * CRUD operations for managing email templates stored in the
 * `email_templates` table, built-in template bootstrapping, layout
 * composition, and who owns each template.
 *
 * A layout is a first-class row with `kind = 'layout'` whose
 * `htmlContent` holds a `{{content}}` placeholder where a template
 * body is injected at send time.
 *
 * Every template has an owner: core, a plugin, or the site. An owner's
 * template follows the owner's current version until the site overrides it;
 * an override keeps the site's version and a copy of the owner's version it
 * started from, so the owner's later changes can be reviewed one by one, and
 * Reset returns it to the owner (`../template-ownership.ts`).
 *
 * @module services/email/email-template-service
 * @since 1.0.0
 */

import { createHash, randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, desc, isNull, sql, type Column } from "drizzle-orm";

import type { RequestActor } from "../../../auth/request-actor";
import { toDbError } from "../../../database/errors";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { maskingServiceLogger } from "../../../observability/mask-emails";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { emailTemplatesMysql } from "../../../schemas/email-templates/mysql";
import { emailTemplatesPg } from "../../../schemas/email-templates/postgres";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import type {
  EmailTemplateInsert,
  EmailTemplateRecord,
  EmailTemplateVariable,
  EmailTemplateVersion,
} from "../../../schemas/email-templates/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import { isMissingTable } from "../../field-groups/migration/session";
import { MetaService } from "../../meta";
import {
  BRAND_BINDING,
  EMAIL_SAFE_FONTS,
  resolveBrand,
  type BrandOverview,
  type BrandReach,
  type BrandSettings,
  type BrandSettingsUpdate,
} from "../brand-settings";
import {
  changedTemplateFields,
  recordTemplateActivity,
  type EmailTemplateActivityInput,
} from "../template-activity";
import { checkTemplateEnvelope, type SavedCopies } from "../template-envelope";
import {
  applyOwnerChoices,
  ownerChanges,
  type OwnerChange,
  type OwnerChangeChoice,
} from "../template-merge";
import {
  absentPluginFor,
  buildTemplateOwnerRegistry,
  carriesSecret,
  detailsOf,
  isOwnersVersion,
  isProtectedOwner,
  sendSource,
  ownerOf,
  ownershipFromConfig,
  sameStoredValue,
  sameVersion,
  storedOwner,
  versionDigest,
  versionOf,
  type KeptBase,
  type OwnedTemplate,
  type RegistryInput,
  type TemplateOwnerRegistry,
} from "../template-ownership";
import {
  SNAPSHOT_MAX_AGE_MS,
  transactionOpenInFlow,
} from "../transaction-flow";
import type { EmailConfig } from "../types";

import { EmailBrandStore } from "./email-brand-store";
import {
  LIQUID_FIELDS,
  oldEngineReasons,
  templateReadsVariable,
} from "./liquid-compat";
import { parseLiquid, writesOutput } from "./liquid-engine";
import {
  DEFAULT_APP_NAME,
  renderTemplate,
  type RenderedTemplate,
  type TemplateFields,
} from "./render-template";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_SLUG,
  EARLIER_BUILT_IN_VERSIONS,
  LAYOUT_CONTENT_PLACEHOLDER,
} from "./templates";

// ============================================================
// Constants
// ============================================================

/**
 * `nextly_meta` keys recording the switch to Liquid. One key marks that the
 * stored templates were read at the switch; each template kept on the old
 * engine has a key of its own holding a digest of its flagged text, which is
 * deleted when the template is confirmed as Liquid. A key per template keeps
 * every change a single-row write, with nothing to merge.
 */
const ENGINE_KEY_PREFIX = "email.templates.liquid.";
const LIQUID_ADOPTED_KEY = `${ENGINE_KEY_PREFIX}adoptedAt`;

const keptKey = (id: string) => `${ENGINE_KEY_PREFIX}kept.${id}`;
/**
 * A template saved as Liquid while the first boot on Liquid had not yet
 * recorded the switch. The switch leaves it as Liquid rather than judging its
 * loops and filters as text the previous engine wrote.
 */
const authoredKey = (id: string) => `${ENGINE_KEY_PREFIX}authored.${id}`;

/** Why a template is kept on the old engine, field by field. */
export interface OldEngineStatus {
  kept: boolean;
  reasons: Array<{ field: string; label: string; reason: string }>;
}

/** Legacy reserved slugs migrated into the unified layout row on boot. */
const LEGACY_HEADER_SLUG = "_email-header";
const LEGACY_FOOTER_SLUG = "_email-footer";

/** The fields an owner versions and an override replaces. */
const VERSION_FIELDS = [
  "subject",
  "htmlContent",
  "plainTextContent",
  "preheader",
] as const;

/** What an owner says about a template beside its version (see OwnerDetails). */
const DETAIL_FIELDS = ["description", "variables"] as const;

/** What a new template holds where its input leaves a field out. */
const NEW_TEMPLATE_DEFAULTS = {
  kind: "template" as const,
  plainTextContent: null,
  preheader: null,
  layoutId: null,
  fromOverride: null,
  replyTo: null,
  cc: null,
  bcc: null,
  variables: null,
  useLayout: true,
  isActive: true,
  providerId: null,
  attachments: null,
  description: null,
};

function orDefault<K extends keyof typeof NEW_TEMPLATE_DEFAULTS>(
  data: CreateEmailTemplateInput,
  key: K
):
  | NonNullable<CreateEmailTemplateInput[K]>
  | (typeof NEW_TEMPLATE_DEFAULTS)[K] {
  return data[key] ?? NEW_TEMPLATE_DEFAULTS[key];
}

/** The columns `updateTemplate` writes when given; the slug and kind are fixed once created. */
const UPDATABLE_FIELDS = [
  "name",
  "subject",
  "htmlContent",
  "plainTextContent",
  "preheader",
  "layoutId",
  "fromOverride",
  "replyTo",
  "cc",
  "bcc",
  "variables",
  "useLayout",
  "isActive",
  "providerId",
  "attachments",
  "description",
] as const satisfies ReadonlyArray<keyof UpdateEmailTemplateInput>;

/**
 * The columns an update writes: each field it gives, with the copies as
 * checked (trimmed, each address once) in place of the ones it gave.
 */
function updateColumns(
  data: UpdateEmailTemplateInput,
  copies: SavedCopies
): Record<string, unknown> {
  const columns: Record<string, unknown> = { updatedAt: new Date() };
  for (const field of UPDATABLE_FIELDS) {
    if (data[field] !== undefined) columns[field] = data[field];
  }
  if (copies.cc !== undefined) columns.cc = copies.cc;
  if (copies.bcc !== undefined) columns.bcc = copies.bcc;
  return columns;
}

/** The owner's current version and details, kept as an override's base. */
function keptBase(entry: OwnedTemplate): KeptBase {
  return { ...entry.version, details: detailsOf(entry.defaults) };
}

// ============================================================
// Input Types
// ============================================================

/**
 * Input for creating a new email template.
 * Extends EmailTemplateInsert (all required + optional fields).
 */
export type CreateEmailTemplateInput = EmailTemplateInsert;

/**
 * Input for updating an existing email template.
 * All fields are optional — only provided fields are updated.
 * Note: `slug` cannot be changed after creation.
 */
export type UpdateEmailTemplateInput = Partial<
  Omit<EmailTemplateInsert, "slug" | "kind">
>;

/** What the running site contributes to ownership: its plugins and its code. */
export interface TemplateOwnershipInput {
  /** Each running plugin, by name, with the templates it contributes. */
  plugins: ReadonlyArray<{
    name: string;
    templates: ReadonlyArray<PluginEmailTemplate>;
  }>;
  /** `email.templates` from `defineConfig()`. */
  codeTemplates?: EmailConfig["templates"];
}

/**
 * An overridden template beside its owner's current version. A type alias
 * rather than an interface so it carries an implicit index signature and can
 * be handed to the response helpers as it is.
 */
export type EmailTemplateComparison = {
  /** The owner's version the override started from. */
  base: EmailTemplateVersion;
  /** The owner's version now. */
  theirs: EmailTemplateVersion;
  /** The site's version now. */
  mine: EmailTemplateVersion;
  /** Each change the owner made since `base`, to review one by one. */
  changes: OwnerChange[];
  /**
   * Names the three versions this comparison was made from. Apply takes it
   * back and refuses once any of them moved, so a choice is never applied to
   * text the person didn't see.
   */
  review: string;
};

/** The refusal when a template moved on from the state an operation was based on. */
function changedSince(
  what: "reviewed" | "applied" | "saved",
  id: string,
  slug: string
): NextlyError {
  const publicMessage = {
    reviewed:
      "This template or its owner's version changed after it was compared. Compare it again, then choose.",
    applied:
      "This template changed after the update was applied, so it can't be undone. Review it again instead.",
    saved:
      "Someone saved this template at the same moment. Open it again to see their change.",
  }[what];
  return new NextlyError({
    code: "CONFLICT",
    publicMessage,
    logContext: { id, slug, reason: `template-changed-since-${what}` },
  });
}

/** The review token of a comparison (see EmailTemplateComparison.review). */
function reviewToken(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion
): string {
  return createHash("sha256")
    .update(JSON.stringify([base, theirs, mine].map(v => versionOf(v))))
    .digest("hex");
}

/** What an applied review replaced, so it can be undone. */
export interface OwnerUpdateUndo {
  /** The site's version before the review was applied. */
  version: EmailTemplateVersion;
  /** The owner's version the override was based on before. */
  base: EmailTemplateVersion;
  /**
   * Digests of the version the review produced and of the owner's version it
   * was rebased on. Undo only puts the old version back while the template
   * still holds exactly these, so a later edit, review or owner update is
   * never overwritten by an undo that was meant for an earlier state.
   */
  applied: string;
  appliedBase: string;
}

/** A stored row: the record's columns, with ownership as stored. */
type StoredTemplateRow = Omit<
  EmailTemplateRecord,
  "owner" | "overridden" | "ownerChanged" | "setInCode" | "carriesSecret"
> & {
  /** The owner's mark as last stored; see `carriesSecret` for what counts. */
  carriesSecret: boolean | null;
  ownerKind: string | null;
  ownerName: string | null;
  overridden: boolean | null;
  baseDigest: string | null;
  baseVersion: KeptBase | null;
};

// ============================================================
// Email Template Service
// ============================================================

/**
 * The layout a template is wrapped in: the one it names, when that is a
 * layout, otherwise the default one. How a record is found is the caller's;
 * the choice is made here only, for a send and for every report of one.
 */
async function chooseLayout(
  template: Pick<EmailTemplateRecord, "layoutId">,
  find: (
    id: string
  ) => Promise<EmailTemplateRecord | null> | EmailTemplateRecord | null,
  defaultLayout: () =>
    | Promise<EmailTemplateRecord | null>
    | EmailTemplateRecord
    | null
): Promise<EmailTemplateRecord | null> {
  const own = template.layoutId ? await find(template.layoutId) : null;
  return own?.kind === "layout" ? own : defaultLayout();
}

/** Whether any of a template's own fields reads `brand`. */
function textReadsBrand(
  template: Pick<
    TemplateFields,
    "subject" | "htmlContent" | "plainTextContent" | "preheader"
  >,
  legacy = false
): boolean {
  return LIQUID_FIELDS.some(([field]) =>
    readsBrand(template[field] ?? "", legacy)
  );
}

/** Whether a template's text reads the settings, under either name, on its engine. */
function readsBrand(source: string, legacy = false): boolean {
  return (
    templateReadsVariable(source, "brand", legacy) ||
    templateReadsVariable(source, BRAND_BINDING, legacy)
  );
}

/** Why the settings reach none of an email that has a stored version to send. */
function unreachedReason(
  reached: boolean,
  layout: EmailTemplateRecord | null
): BrandReach["reason"] {
  if (reached) return null;
  return layout ? "layoutWithoutBrand" : "noLayout";
}

/** Whether the site's code version comes before a stored row: unless the row is an override, or not yet given its owner. */
function prefersCode(
  row: Pick<StoredTemplateRow, "ownerKind" | "overridden">
): boolean {
  return row.ownerKind !== null && row.overridden !== true;
}

/**
 * How a read of the engine state is answered: from the instance's copy, for a
 * render; or from the table, for a decision that writes the state or reports
 * it (see engineStateFor).
 */
type EngineRead = "render" | "decide";

/** Union of all dialect-specific email_templates table definitions. */
type EmailTemplatesTable =
  | typeof emailTemplatesPg
  | typeof emailTemplatesMysql
  | typeof emailTemplatesSqlite;

export class EmailTemplateService extends BaseService {
  private emailTemplates: EmailTemplatesTable;

  /**
   * Product name a layout's `{{appName}}` falls back to.
   *
   * Held here because a preview must fill it exactly as a send does; without
   * it a configured installation previews its own layouts under the wrong
   * name, which is the defect this service used to have in a worse form.
   */
  private readonly appName: string;

  /**
   * Who owns what. Core's templates are known from the start; the running
   * plugins and the site's code are added by `configureOwnership`, which the
   * boot calls before seeding. Until then the registry is incomplete and the
   * boot reconciliation does not run (see `ensureBuiltInTemplates`).
   */
  private registry: TemplateOwnerRegistry;
  /** Where the switch to Liquid, and the templates kept off it, are recorded. */
  private readonly meta: MetaService;
  /**
   * The engine state as this instance last read it whole: whether the switch
   * is recorded, and the keys of the templates kept off it or saved as Liquid
   * before it. Every render answers from it, so a send makes no read of the
   * meta table, and none on another connection inside a caller's open
   * transaction. Read at the end of each boot, kept current by this
   * instance's own writes, and read again outside a transaction once it is
   * older than SNAPSHOT_MAX_AGE_MS, which is how long a change another
   * instance made can go unseen here.
   */
  private engineState: {
    adopted: boolean | null;
    keys: Set<string>;
    readAt: number;
  } | null = null;
  /**
   * Moved by every write of the engine state. A read of the table keeps what
   * it read only if no write moved this while it ran, so it can never undo a
   * write this instance made.
   */
  private engineGeneration = 0;
  /** The site's brand settings, which every layout reads as `brand`. */
  private readonly brandStore: EmailBrandStore;

  constructor(adapter: DrizzleAdapter, logger: Logger, appName?: string) {
    // Masked here whatever logger an app supplied: what this service logs,
    // a provider error quoting a recipient included, never carries a full
    // email address outside development and test.
    super(adapter, maskingServiceLogger(logger));

    this.appName = appName ?? DEFAULT_APP_NAME;
    this.registry = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      earlierBuiltIns: EARLIER_BUILT_IN_VERSIONS,
      plugins: [],
      complete: false,
    }).registry;
    this.meta = new MetaService(adapter, logger);
    this.brandStore = new EmailBrandStore(adapter, logger);

    switch (this.dialect) {
      case "postgresql":
        this.emailTemplates = emailTemplatesPg;
        break;
      case "mysql":
        this.emailTemplates = emailTemplatesMysql;
        break;
      case "sqlite":
        this.emailTemplates = emailTemplatesSqlite;
        break;
      default:
        // `this.dialect` is narrowed to `never` after the exhaustive switch;
        // String() coercion satisfies @typescript-eslint/restrict-template-expressions.
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  // ============================================================
  // Ownership
  // ============================================================

  /**
   * Register the running plugins' templates and the site's code templates.
   *
   * Core registers first, so a plugin cannot take over one of core's slugs;
   * between two plugins contributing one slug, the first keeps it. Each
   * ignored contribution is logged with both owners named.
   */
  configureOwnership(input: TemplateOwnershipInput): void {
    const built: RegistryInput = {
      builtIns: BUILT_IN_TEMPLATES,
      earlierBuiltIns: EARLIER_BUILT_IN_VERSIONS,
      plugins: input.plugins,
      codeTemplates: input.codeTemplates,
      complete: true,
    };
    const { registry, conflicts, refused } = buildTemplateOwnerRegistry(built);
    this.registry = registry;
    for (const refusal of refused) {
      this.logger.error(
        `Refused a plugin's email template: ${refusal.reason}`,
        {
          slug: refusal.slug,
          plugin: refusal.plugin,
          engine: String(refusal.engine),
        }
      );
    }
    for (const conflict of conflicts) {
      this.logger.warn(
        "Ignored a plugin's email template: another owner already has its slug",
        {
          slug: conflict.slug,
          keptBy: conflict.kept.kind === "plugin" ? conflict.kept.name : "core",
          ignoredFrom: conflict.ignored,
        }
      );
    }
  }

  /** A stored row as callers see it, with its owner and override state. */
  private toRecord(row: StoredTemplateRow): EmailTemplateRecord {
    const {
      ownerKind,
      ownerName,
      overridden: storedOverridden,
      baseDigest,
      baseVersion: _baseVersion,
      carriesSecret: storedMark,
      ...columns
    } = row;
    const owner = ownerOf(row.slug, { ownerKind, ownerName }, this.registry);
    const overridden = owner.kind !== "site" && storedOverridden === true;
    const entry = this.registry.owned.get(row.slug);
    return {
      ...columns,
      kind: columns.kind ?? "template",
      description: columns.description ?? null,
      cc: columns.cc ?? null,
      bcc: columns.bcc ?? null,
      owner,
      carriesSecret: carriesSecret(row.slug, storedMark, this.registry),
      overridden,
      ownerChanged: overridden && !!entry && baseDigest !== entry.digest,
      setInCode: this.registry.setInCode.has(row.slug),
    };
  }

  /** The registry entry an owned template follows, or a refusal naming why there is none. */
  private ownedEntry(record: EmailTemplateRecord): OwnedTemplate {
    const entry = this.registry.owned.get(record.slug);
    if (!entry || !isProtectedOwner(record.owner)) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          record.owner.kind === "site"
            ? "This template is your site's own, so it has no owner's version."
            : "This template's owner isn't running, so it has no current version.",
        logContext: { slug: record.slug, owner: record.owner },
      });
    }
    return entry;
  }

  // ============================================================
  // CRUD Methods
  // ============================================================

  /**
   * Record a template mutation without letting the trail decide the request.
   *
   * The write has already committed by the time this runs, so a failure to
   * record must not be reported to the caller as a failed mutation — that would
   * tell them the opposite of the truth. It must not be silent either: a trail
   * that quietly stops being written is indistinguishable from a system nobody
   * is changing, so the failure becomes a log line here.
   */
  private async recordActivity(
    input: EmailTemplateActivityInput
  ): Promise<void> {
    try {
      await recordTemplateActivity(input);
    } catch (error) {
      try {
        this.logger.error("Failed to record email template activity", {
          action: input.action,
          templateId: input.templateId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // A logger that throws must not take the mutation with it either.
      }
    }
  }

  /**
   * A layout row must contain exactly one `{{content}}` placeholder: zero
   * appends the body after the wrapper, and more than one drops the content
   * after the second marker when the layout is applied. Reject malformed
   * layouts at write time so rendering can rely on the invariant.
   */
  /**
   * In a Liquid layout, the body's marker must be an output Liquid writes:
   * inside `raw`, `comment` or `capture`, or quoted in a tag's argument, it
   * would be swapped for the body's slot and then never written, and every
   * email would go out without its body.
   */
  private assertMarkerOutput(kind: string, htmlContent: string): void {
    if (kind !== "layout") return;
    if (writesOutput(htmlContent, LAYOUT_CONTENT_PLACEHOLDER)) return;
    throw NextlyError.validation({
      errors: [
        {
          path: "htmlContent",
          code: "INVALID",
          message: `A layout's ${LAYOUT_CONTENT_PLACEHOLDER} placeholder must stand on its own where Liquid writes output, not inside {% raw %}, {% comment %} or {% capture %}, or in a tag's quoted text.`,
        },
      ],
      logContext: { kind },
    });
  }

  private assertLayoutMarker(kind: string, htmlContent: string): void {
    if (kind !== "layout") return;
    const markerCount =
      htmlContent.split(LAYOUT_CONTENT_PLACEHOLDER).length - 1;
    if (markerCount !== 1) {
      throw NextlyError.validation({
        errors: [
          {
            path: "htmlContent",
            code: "INVALID",
            message: `A layout must contain exactly one ${LAYOUT_CONTENT_PLACEHOLDER} placeholder (found ${markerCount}).`,
          },
        ],
        logContext: { kind, markerCount },
      });
    }
  }

  /**
   * A template kept on the old engine renders as it always did until it is
   * confirmed as Liquid, so saving it (its other fields, or its text) is not
   * judged by Liquid. Every other template must parse, and is recorded as
   * written in Liquid if the switch isn't recorded yet. Returns what to do
   * once the save is written: for a kept template, the re-check a confirmation
   * that overtook the save needs.
   */
  private async checkLiquidOnSave(
    existing: EmailTemplateRecord,
    data: LiquidFieldValues
  ): Promise<(saved: EmailTemplateRecord) => Promise<void>> {
    if (await this.keptOnOldEngine(existing)) {
      return saved => this.keepIfConfirmedUnderSave(saved);
    }
    this.assertLiquid(data);
    this.assertMarkerOutput(
      existing.kind,
      data.htmlContent ?? existing.htmlContent
    );
    await this.markAuthoredBeforeSwitch(existing.id);
    return () => Promise.resolve();
  }

  /**
   * A save checked while the template was kept, which a confirmation then
   * overtook: the confirmation read the template before this save landed, so
   * Liquid never checked what it wrote. If that text is anything Liquid would
   * read differently (the old engine's syntax, or text Liquid can't parse),
   * the template goes back to the old engine, where it renders as written.
   */
  private async keepIfConfirmedUnderSave(
    template: EmailTemplateRecord
  ): Promise<void> {
    if (await this.keptOnOldEngine(template)) return;
    if (
      oldEngineReasons(template).length === 0 &&
      this.readsAsLiquid(template)
    ) {
      return;
    }
    await this.markEngine(keptKey(template.id), flaggedDigests(template));
  }

  /** Whether every field Liquid renders parses. */
  private readsAsLiquid(fields: LiquidFieldValues): boolean {
    try {
      this.assertLiquid(fields);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Refuse a template Liquid can't read, naming the field and the line, so
   * nothing is stored that would fail every send.
   */
  private assertLiquid(fields: LiquidFieldValues): void {
    const errors = LIQUID_FIELDS.flatMap(([field, label]) => {
      const source = fields[field];
      if (!source) return [];
      const parsed = parseLiquid(
        source,
        field === "htmlContent" || field === "preheader" ? "html" : "text"
      );
      if (!("problem" in parsed)) return [];
      const { line, message } = parsed.problem;
      const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
      return [
        {
          path: field,
          code: "LIQUID_SYNTAX",
          message:
            line !== null
              ? `${label}, line ${line}: ${sentence}`
              : `${label}: ${sentence}`,
        },
      ];
    });
    if (errors.length > 0) {
      throw NextlyError.validation({
        errors,
        logContext: { fields: errors.map(error => error.path) },
      });
    }
  }

  // ============================================================
  // Liquid, and templates kept on the old engine
  // ============================================================

  /**
   * The engine state to answer from: the instance's copy, read again from the
   * table when it is missing or older than SNAPSHOT_MAX_AGE_MS, but never
   * inside a caller's open transaction, which the read would escape. Null
   * only inside one before any copy was read, when the caller reads the table.
   */
  private async engineSnapshot(): Promise<{
    adopted: boolean | null;
    keys: Set<string>;
  } | null> {
    const state = this.engineState;
    if (transactionOpenInFlow(this.adapter)) return state;
    if (!state || Date.now() - state.readAt > SNAPSHOT_MAX_AGE_MS) {
      await this.loadEngineState();
    }
    return this.engineState;
  }

  /**
   * The engine state a read in `mode` answers from, or null to read the
   * table. A render answers from the instance's copy (see engineSnapshot). A
   * decision that writes the engine state, or reports it to an editor, reads
   * the table, as it always has, except inside a caller's open transaction,
   * where it uses the copy rather than another connection.
   */
  private async engineStateFor(mode: EngineRead): Promise<{
    adopted: boolean | null;
    keys: Set<string>;
  } | null> {
    if (mode === "render") return this.engineSnapshot();
    return transactionOpenInFlow(this.adapter) ? this.engineState : null;
  }

  /** Whether an engine-state key is recorded (see engineState). */
  private async engineKeyPresent(
    key: string,
    mode: EngineRead = "decide"
  ): Promise<boolean> {
    const state = await this.engineStateFor(mode);
    if (state) return state.keys.has(key);
    return (await this.meta.getEntry(key)).present;
  }

  /** Record an engine-state key, unless it is recorded already. */
  private async markEngine(key: string, value: unknown): Promise<void> {
    await this.meta.insertIfAbsent(key, value);
    this.engineGeneration++;
    this.engineState?.keys.add(key);
    if (key === LIQUID_ADOPTED_KEY && this.engineState) {
      this.engineState.adopted = true;
    }
  }

  /** Remove an engine-state key. */
  private async unmarkEngine(key: string): Promise<void> {
    await this.meta.delete(key);
    this.engineGeneration++;
    this.engineState?.keys.delete(key);
  }

  /** Read the whole engine state into engineState (at the end of a boot). */
  private async loadEngineState(): Promise<void> {
    const started = this.engineGeneration;
    const readAt = Date.now();
    let all: Record<string, unknown>;
    try {
      all = await this.meta.getAll();
    } catch (error) {
      if (!isMissingTable(error, this.dialect)) throw error;
      // Nothing can be recorded without the table, which reads as null.
      if (this.engineGeneration === started) {
        this.engineState = { adopted: null, keys: new Set(), readAt };
      }
      return;
    }
    const keys = new Set(
      Object.keys(all).filter(key => key.startsWith(ENGINE_KEY_PREFIX))
    );
    if (this.engineGeneration !== started) return;
    this.engineState = { adopted: keys.has(LIQUID_ADOPTED_KEY), keys, readAt };
  }

  /**
   * Whether the switch to Liquid is recorded, or null where nothing can be
   * recorded (a database without the meta table).
   */
  private async liquidAdopted(
    mode: EngineRead = "decide"
  ): Promise<boolean | null> {
    const state = await this.engineStateFor(mode);
    if (state) return state.adopted;
    try {
      return (await this.meta.getEntry(LIQUID_ADOPTED_KEY)).present;
    } catch (error) {
      // Only a missing meta table means nothing can be recorded. Any other
      // failure is raised: reading it as "not switched yet" would render a
      // new Liquid template with the old engine.
      if (isMissingTable(error, this.dialect)) return null;
      throw error;
    }
  }

  /**
   * Whether a stored template renders with the old engine.
   *
   * Once the switch is recorded, only the templates it kept do. Before it is
   * (the first boot has not reached it yet), a template is judged by what it
   * holds, the same test the switch applies, so no stored email changes in
   * the meantime.
   */
  private async keptOnOldEngine(
    template: Pick<EmailTemplateRecord, "id"> & LiquidFieldValues,
    mode: EngineRead = "decide"
  ): Promise<boolean> {
    const adopted = await this.liquidAdopted(mode);
    if (adopted) {
      return this.engineKeyPresent(keptKey(template.id), mode);
    }
    if (adopted === false && (await this.authoredAsLiquid(template.id, mode))) {
      return false;
    }
    return oldEngineReasons(template).length > 0;
  }

  private async authoredAsLiquid(
    id: string,
    mode: EngineRead = "decide"
  ): Promise<boolean> {
    return this.engineKeyPresent(authoredKey(id), mode);
  }

  /**
   * Record that a template was saved as Liquid, when the switch isn't recorded
   * yet. Written before the template, so the switch never sees the row
   * without it.
   */
  private async markAuthoredBeforeSwitch(id: string): Promise<void> {
    if ((await this.liquidAdopted()) === false) {
      await this.markEngine(authoredKey(id), "1");
    }
  }

  /**
   * Record the switch to Liquid, once: every stored template that today's
   * engine would render differently as Liquid is kept on today's engine.
   * Templates created afterwards are Liquid. Each kept template is written
   * before the mark, so a boot interrupted part-way simply reads them again.
   */
  private async adoptLiquid(): Promise<void> {
    if ((await this.liquidAdopted()) !== false) return;
    const rows = (await this.db
      .select()
      .from(this.emailTemplates)) as EmailTemplateRecord[];
    const kept: string[] = [];
    for (const row of rows) {
      // Another instance may have recorded the switch meanwhile and seeded
      // Liquid templates since; its scan decided, so this one stops.
      if ((await this.liquidAdopted()) === true) return;
      if (
        oldEngineReasons(row).length > 0 &&
        !(await this.authoredAsLiquid(row.id))
      ) {
        await this.markEngine(keptKey(row.id), flaggedDigests(row));
        kept.push(row.id);
      }
    }
    await this.markEngine(LIQUID_ADOPTED_KEY, new Date().toISOString());
    if (kept.length > 0) {
      this.logger.info(
        `Kept ${kept.length} stored email template(s) on the previous engine; they render as before until confirmed as Liquid.`,
        { templateIds: kept }
      );
    }
  }

  /**
   * Which of these templates are kept on the old engine, answered for all of
   * them at once.
   *
   * The same decision as `keptOnOldEngine`, for a list: the switch and the
   * marks it left are read once rather than once per template, so a list of
   * any length costs two reads.
   */
  async keptOnOldEngineIds(
    templates: ReadonlyArray<
      Pick<EmailTemplateRecord, "id"> & LiquidFieldValues
    >
  ): Promise<Set<string>> {
    const kept = new Set<string>();
    if (templates.length === 0) return kept;
    // One read of the whole state answers both whether the switch is
    // recorded and which templates it kept. No meta table means nothing was
    // recorded, so every template is judged by what it holds.
    const state = await this.engineStateFor("decide");
    let recorded: Record<string, unknown>;
    let adopted: boolean | null;
    if (state) {
      recorded = Object.fromEntries([...state.keys].map(key => [key, true]));
      adopted = state.adopted;
    } else {
      try {
        recorded = await this.meta.getAll();
        adopted = Object.hasOwn(recorded, LIQUID_ADOPTED_KEY);
      } catch (error) {
        if (!isMissingTable(error, this.dialect)) throw error;
        recorded = {};
        adopted = null;
      }
    }
    const marked = (key: string) => Object.hasOwn(recorded, key);
    for (const template of templates) {
      if (adopted) {
        if (marked(keptKey(template.id))) kept.add(template.id);
      } else if (adopted === false && marked(authoredKey(template.id))) {
        continue;
      } else if (oldEngineReasons(template).length > 0) {
        kept.add(template.id);
      }
    }
    return kept;
  }

  /** Whether a template is kept on the old engine, and what in it is why. */
  async oldEngineStatus(id: string): Promise<OldEngineStatus> {
    const template = await this.getTemplate(id);
    const kept = await this.keptOnOldEngine(template);
    return { kept, reasons: kept ? oldEngineReasons(template) : [] };
  }

  /**
   * Read a template kept on the old engine as Liquid from now on.
   *
   * Only once what was flagged has changed, and only if Liquid can read every
   * field: a confirmation of unchanged text would quietly change what the
   * email says.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION when the flagged text is
   *   unchanged; VALIDATION_ERROR when Liquid can't read it
   */
  async confirmLiquid(
    id: string,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const template = await this.getTemplate(id);
    const flagged = await this.flaggedWhenKept(template);
    if (flagged === null) return template;
    this.assertNotDeclaredLegacy(template);
    // Every flagged field must have changed: an edit elsewhere leaves the
    // flagged text as it was, and reading it as Liquid would change the email.
    const unchanged = unchangedFlaggedFields(flagged, template);
    if (unchanged.length > 0) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: `Change the text that was flagged (${unchanged.join(", ")}) before reading this template as Liquid.`,
        logContext: { id, reason: "liquid-confirm-unchanged", unchanged },
      });
    }
    this.assertLiquid(template);
    // Saved while kept, a layout's marker was only checked as the old engine
    // splices it; as Liquid it must also be an output Liquid writes.
    this.assertMarkerOutput(template.kind, template.htmlContent);
    await this.releaseToLiquid(template, flagged);
    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: template.name,
      templateKind: template.kind,
      changedFields: ["readAsLiquid"],
      actor,
    });
    return template;
  }

  /**
   * A template following an owner that declares it was written for the
   * previous engine renders there: the owner says so, and the next boot
   * would put it back. Overriding it makes it the site's, to confirm.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION for such a template
   */
  private assertNotDeclaredLegacy(template: EmailTemplateRecord): void {
    if (template.overridden) return;
    if (this.registry.owned.get(template.slug)?.engine !== "legacy") return;
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "This template's owner says it was written for the previous engine. Override it to read it as Liquid.",
      logContext: { id: template.id, reason: "liquid-confirm-declared-legacy" },
    });
  }

  /**
   * The flagged text a kept template was recorded with, or null when it is
   * not kept.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION while the switch isn't
   *   recorded and the template would be kept by it
   */
  private async flaggedWhenKept(
    template: EmailTemplateRecord
  ): Promise<string | null> {
    const adopted = await this.liquidAdopted();
    if (adopted) {
      const entry = await this.meta.getEntry<string>(keptKey(template.id));
      return entry.present ? (entry.value ?? "") : null;
    }
    if (oldEngineReasons(template).length > 0) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "This template can't be switched to Liquid until the site has finished starting.",
        logContext: { id: template.id, reason: "liquid-state-not-recorded" },
      });
    }
    return null;
  }

  /**
   * Stop keeping a template on the old engine. A save that landed between
   * the checks and this was made while the template was still kept, so
   * Liquid never checked it: the switch is undone and refused.
   *
   * @throws NextlyError CONFLICT when a save overtook the confirmation
   */
  private async releaseToLiquid(
    template: EmailTemplateRecord,
    flagged: string
  ): Promise<void> {
    await this.unmarkEngine(keptKey(template.id));
    const after = await this.getTemplate(template.id);
    if (
      flaggedDigests(after) === flaggedDigests(template) &&
      this.readsAsLiquid(after)
    ) {
      return;
    }
    await this.markEngine(keptKey(template.id), flagged);
    throw new NextlyError({
      code: "CONFLICT",
      publicMessage:
        "This template was saved while it was being confirmed. Check it again, then confirm.",
      logContext: { id: template.id, reason: "liquid-confirm-raced" },
    });
  }

  /**
   * Render a stored template as a send does: wrapped in its layout, each of
   * the two on the engine it renders with.
   *
   * @throws NextlyError when the template cannot be rendered; retrying cannot
   *   fix it
   */
  async renderStored(
    template: EmailTemplateRecord,
    data: Record<string, unknown>,
    options?: { appName?: string }
  ): Promise<RenderedTemplate> {
    const layout = template.useLayout
      ? await this.getLayoutFor(template)
      : null;
    const legacy = await this.keptOnOldEngine(template, "render");
    return renderTemplate(
      { ...template, legacy },
      layout && {
        ...layout,
        legacy: await this.keptOnOldEngine(layout, "render"),
      },
      data,
      {
        appName: options?.appName ?? this.appName,
        brand: await this.brandFor({ ...template, legacy }, layout),
      }
    );
  }

  /**
   * The brand settings, for a render that can use them: one with a layout, a
   * layout rendering itself, or a template whose own text reads them. Nothing
   * is read for any other, so an email without them never waits on the table.
   */
  private async brandFor(
    template: Pick<
      TemplateFields,
      | "kind"
      | "subject"
      | "htmlContent"
      | "plainTextContent"
      | "preheader"
      | "legacy"
    >,
    layout: EmailTemplateRecord | null
  ): Promise<BrandSettings | undefined> {
    if (
      !layout &&
      template.kind !== "layout" &&
      !textReadsBrand(template, template.legacy)
    ) {
      return undefined;
    }
    return this.brandStore.read();
  }

  /**
   * Create a new email template. A template created here is the site's own.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if slug is reserved
   * @throws NextlyError DUPLICATE if slug already exists
   */
  async createTemplate(
    data: CreateEmailTemplateInput,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const kind = orDefault(data, "kind");
    this.assertLayoutMarker(kind, data.htmlContent);
    this.assertLiquid(data);
    this.assertMarkerOutput(kind, data.htmlContent);
    // A slug an owner declares carries that owner's mark, even before the
    // owner's row exists.
    const copies = checkTemplateEnvelope(data, {
      carriesSecret: carriesSecret(data.slug, null, this.registry),
    });
    const id = randomUUID();
    const now = new Date();
    await this.markAuthoredBeforeSwitch(id);

    const values = {
      id,
      name: data.name,
      slug: data.slug,
      kind,
      subject: data.subject,
      htmlContent: data.htmlContent,
      plainTextContent: orDefault(data, "plainTextContent"),
      preheader: orDefault(data, "preheader"),
      layoutId: orDefault(data, "layoutId"),
      fromOverride: orDefault(data, "fromOverride"),
      replyTo: orDefault(data, "replyTo"),
      cc: copies.cc ?? NEW_TEMPLATE_DEFAULTS.cc,
      bcc: copies.bcc ?? NEW_TEMPLATE_DEFAULTS.bcc,
      variables: orDefault(data, "variables"),
      useLayout: orDefault(data, "useLayout"),
      isActive: orDefault(data, "isActive"),
      providerId: orDefault(data, "providerId"),
      attachments: orDefault(data, "attachments"),
      description: orDefault(data, "description"),
      ...storedOwner({ kind: "site" }),
      overridden: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.db.insert(this.emailTemplates).values(values);
    } catch (error) {
      // Pattern B: surface unique-violation as DUPLICATE (409) so the admin UI
      // can show a friendly "slug already exists" message; everything else
      // flows through the default DB → NextlyError mapping. The driver throws
      // a raw error, so normalise via toDbError(dialect) before classifying.
      const dbErr = toDbError(this.dialect, error);
      if (dbErr.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { reason: "template-slug-conflict", slug: data.slug },
        });
      }
      throw NextlyError.fromDatabaseError(dbErr);
    }

    const created = await this.getTemplate(id);
    // Recorded after the insert commits, so a trail that cannot be written
    // never turns a template that exists into a reported failure.
    await this.recordActivity({
      action: "create",
      templateId: created.id,
      templateName: created.name,
      templateKind: created.kind,
      actor,
    });
    return created;
  }

  /** The stored row by id. */
  private async getRow(id: string): Promise<StoredTemplateRow> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.id, id))
      .limit(1);

    if (results.length === 0) {
      // Identifier (`id`) goes into logContext per spec §13.8. The factory
      // emits the canonical "Not found." public sentence.
      throw NextlyError.notFound({ logContext: { id } });
    }

    return results[0] as StoredTemplateRow;
  }

  /** The stored row by slug, or null. */
  private async getRowBySlug(slug: string): Promise<StoredTemplateRow | null> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.slug, slug))
      .limit(1);
    return (results[0] as StoredTemplateRow | undefined) ?? null;
  }

  /**
   * Get a single email template by ID.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async getTemplate(id: string): Promise<EmailTemplateRecord> {
    return this.toRecord(await this.getRow(id));
  }

  /**
   * Get a single email template by slug.
   *
   * Returns `null` if no template matches the slug.
   */
  async getTemplateBySlug(slug: string): Promise<EmailTemplateRecord | null> {
    const row = await this.getRowBySlug(slug);
    return row ? this.toRecord(row) : null;
  }

  /**
   * The template a send by slug should render, and whether the site's code
   * version (`email.templates`) takes its place.
   *
   * The order is the site's override, then the site's code, then the owner's
   * default. A stored row that is not overridden holds the owner's default, so
   * the code version wins over it; an override wins over the code. A row the
   * boot reconciliation has not reached yet is treated as it was before
   * ownership existed, when a stored row always won, so an existing site sends
   * what it sent until the reconciliation decides.
   */
  async resolveForSend(slug: string): Promise<{
    template: EmailTemplateRecord | null;
    preferCode: boolean;
  }> {
    const row = await this.getRowBySlug(slug);
    if (!row) return { template: null, preferCode: true };
    return {
      template: this.toRecord(row),
      preferCode: prefersCode(row),
    };
  }

  /**
   * List email templates, ordered by creation date (newest first).
   *
   * Returns every row including layouts (`kind = 'layout'`); callers
   * that want only message bodies filter by `kind === 'template'`.
   */
  async listTemplates(): Promise<EmailTemplateRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .orderBy(desc(this.emailTemplates.createdAt));

    return (results as StoredTemplateRow[]).map(row => this.toRecord(row));
  }

  /**
   * Update an existing email template.
   *
   * Template `slug` cannot be changed after creation. Changing what an owned
   * template says (its subject, preheader, HTML, plain text, description or
   * declared variables) overrides it,
   * as the explicit Override does: the change is the site's, and the owner's
   * later versions wait for review rather than overwriting it at the next
   * boot.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async updateTemplate(
    id: string,
    data: UpdateEmailTemplateInput,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const existing = await this.getRow(id);
    const record = this.toRecord(existing);

    // Validate the effective post-update row (a layout must keep exactly one
    // `{{content}}` marker). Kind is immutable on update, so use the existing
    // kind with the incoming html when provided.
    this.assertLayoutMarker(
      existing.kind,
      data.htmlContent ?? existing.htmlContent
    );
    // Before anything is recorded about the save: a refused envelope leaves
    // no trace.
    const updateData = updateColumns(
      data,
      checkTemplateEnvelope(data, { carriesSecret: record.carriesSecret })
    );
    const afterSave = await this.checkLiquidOnSave(record, data);

    const overriding = this.overridesOwner(existing, record, updateData);
    if (overriding) {
      // The owner's version as the base. A plugin that isn't running has no
      // version to read, so its template's version before this edit is the
      // base: if the plugin comes back, the edit stays as an override and its
      // changes since are offered for review.
      // A row the boot hasn't brought to its owner's current version yet (the
      // reconciliation runs in the background) is based on what it holds, so
      // the owner's changes since are still offered for review.
      const entry = this.registry.owned.get(record.slug);
      const current = entry && sameVersion(versionOf(existing), entry.version);
      const base: KeptBase =
        entry && current
          ? keptBase(entry)
          : { ...versionOf(existing), details: detailsOf(existing) };
      updateData.overridden = true;
      updateData.baseVersion = base;
      updateData.baseDigest =
        entry && current ? entry.digest : versionDigest(base);
    }

    try {
      await this.db
        .update(this.emailTemplates)
        .set(updateData)
        // Conditioned on the row as read: an override's base comes from it,
        // and a save in between must not be overwritten.
        .where(this.unchanged(existing));
    } catch (error) {
      // Default Pattern A: drizzle hands us the raw driver error, so normalise
      // through toDbError(dialect) first to get a DbError; fromDatabaseError
      // then produces a NextlyError with a generic public message and the
      // dialect-specific code stashed in logContext.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    await this.assertUpdated(id, updateData, record.slug);
    const updated = await this.getTemplate(id);
    await afterSave(updated);
    // Compared against the row as it was, so an update that submitted every
    // field but moved none produces no entry. `updatedAt` is excluded: it moves
    // on every write by definition and would make every no-op look like a
    // change. The kept base copy is internal bookkeeping, named by
    // `overridden` alone.
    const {
      updatedAt: _ignored,
      baseVersion: _base,
      baseDigest: _digest,
      ...touched
    } = updateData;
    await this.recordActivity({
      action: "update",
      templateId: updated.id,
      templateName: updated.name,
      templateKind: updated.kind,
      changedFields: changedTemplateFields({ ...existing }, touched),
      operation: overriding ? "override" : undefined,
      actor,
    });
    return updated;
  }

  /**
   * Whether an update makes an owned template the site's. An edit to what the
   * owner sets (its version, or what it says about the template) does: the
   * next boot would otherwise put the owner's back. Name, layout use and the
   * other settings are the site's anyway and change nothing here.
   */
  private overridesOwner(
    existing: StoredTemplateRow,
    record: EmailTemplateRecord,
    updateData: Record<string, unknown>
  ): boolean {
    if (record.owner.kind === "site" || record.overridden) return false;
    return [...VERSION_FIELDS, ...DETAIL_FIELDS].some(
      field =>
        updateData[field] !== undefined &&
        !sameStoredValue(updateData[field] ?? null, existing[field] ?? null)
    );
  }

  /**
   * Delete an email template.
   *
   * Core's templates and an installed plugin's cannot be deleted: their owner
   * would recreate them at the next boot, so a delete would quietly mean
   * Reset. The site's own templates, and those of a plugin that is no longer
   * installed, can be, and are not recreated. Custom layouts may be deleted —
   * templates referencing them fall back to the default layout. Idempotent —
   * returns successfully if the template doesn't exist.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if the template is owned by
   *   core or an installed plugin
   */
  async deleteTemplate(id: string, actor?: RequestActor | null): Promise<void> {
    let template: EmailTemplateRecord | null = null;
    try {
      template = await this.getTemplate(id);
    } catch (error) {
      // If template doesn't exist, consider it already deleted (idempotent).
      // Use NextlyError.isCode for cross-realm safe NOT_FOUND detection.
      if (NextlyError.isCode(error, "NOT_FOUND")) {
        this.logger.info(
          `Template ${id} not found during delete — already deleted`,
          { id }
        );
        return;
      }
      throw error;
    }

    if (
      isProtectedOwner(template.owner) ||
      template.slug === DEFAULT_LAYOUT_SLUG
    ) {
      // Spec §13.8: identifiers are operator-only. Public sentence is generic.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          template.kind === "layout"
            ? "This layout belongs to its owner and can't be deleted. Reset it to the owner's version instead."
            : "This template belongs to its owner and can't be deleted. Reset it to the owner's version instead.",
        logContext: { id, slug: template.slug, owner: template.owner },
      });
    }

    await this.db
      .delete(this.emailTemplates)
      .where(eq(this.emailTemplates.id, id));
    // A deleted template has nothing left to keep on the old engine.
    await this.unmarkEngine(keptKey(id)).catch(() => undefined);
    await this.unmarkEngine(authoredKey(id)).catch(() => undefined);

    // The name is read from the row fetched above: after the delete there is
    // nothing left to label the entry with, and an unlabelled row is the one
    // whose subject a reader can never recover.
    await this.recordActivity({
      action: "delete",
      templateId: id,
      templateName: template.name,
      templateKind: template.kind,
      actor,
    });
  }

  // ============================================================
  // Override, Reset and the owner's updates
  // ============================================================

  /**
   * Override an owned template: from now on it holds the site's version.
   *
   * The site's version starts from the owner's current one, or from
   * `options.version` where the caller supplies the starting text (an
   * override of a template set in code starts from what the code produced).
   * The owner's current version is kept, so its later changes can be reviewed
   * against it. Overriding a template that is already overridden changes
   * nothing.
   */
  async overrideTemplate(
    id: string,
    options?: { version?: Partial<EmailTemplateVersion> },
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    if (record.overridden) return record;

    const start: EmailTemplateVersion = {
      ...versionOf(row),
      // Only the fields given: an optional left undefined keeps the stored one.
      ...Object.fromEntries(
        Object.entries(options?.version ?? {}).filter(
          ([, v]) => v !== undefined
        )
      ),
    };
    this.assertLayoutMarker(row.kind, start.htmlContent);
    // As an edit's override: a row the boot hasn't brought to the owner's
    // current version is based on what it holds, so the owner's changes since
    // are still offered for review.
    const base = sameVersion(versionOf(row), entry.version)
      ? { version: keptBase(entry), digest: entry.digest }
      : {
          version: { ...versionOf(row), details: detailsOf(row) },
          digest: versionDigest(versionOf(row)),
        };

    // `start` carries every version field from the read, so a save in
    // between must not be overwritten.
    await this.writeSitesVersion(row, record, start, base.digest, {
      overridden: true,
      baseVersion: base.version,
    });

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: record.name,
      templateKind: record.kind,
      changedFields: [
        "overridden",
        ...changedTemplateFields({ ...versionOf(row) }, { ...start }),
      ],
      operation: "override",
      actor,
    });
    return this.getTemplate(id);
  }

  /**
   * Return an overridden template to its owner's current version and end the
   * override. For a template set in code, the code's version is what sends
   * once the override ends. Resetting one that is not overridden changes
   * nothing.
   */
  async resetTemplate(
    id: string,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    // Nothing to reset, unless the row still holds an earlier owner version
    // the background reconciliation hasn't reached: Reset brings it up to the
    // owner's current one now.
    if (
      !record.overridden &&
      row.ownerKind !== null &&
      sameVersion(versionOf(row), entry.version)
    ) {
      return record;
    }

    // The owner's version and details; the site's settings (name, layout use,
    // provider, From, Reply-To, attachments, active) stay as they are.
    // The owner too: a reset can land before the boot's backfill has written
    // it, and the send path reads the stored owner.
    const restored = {
      ...this.ownerColumns(entry),
      ...storedOwner(entry.owner),
    };
    // Conditioned on the row as read, as override, apply and undo are.
    await this.writeOwnersVersion(row, entry, {
      ...restored,
      overridden: false,
      baseVersion: null,
      baseDigest: null,
      updatedAt: new Date(),
    });
    await this.assertWritten(id, entry.version, null, record.slug);

    await this.recordActivity({
      action: "update",
      templateId: id,
      // The name is the site's and Reset keeps it, so the entry uses it.
      templateName: record.name,
      templateKind: record.kind,
      changedFields: [
        "overridden",
        ...changedTemplateFields({ ...row }, { ...restored }),
      ],
      operation: "reset",
      actor,
    });
    return this.getTemplate(id);
  }

  /**
   * What a review of an overridden template works from: the row, its owner's
   * entry, the base it is kept against and the site's version now.
   */
  private async reviewOf(id: string) {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    this.assertOverridden(record);
    return {
      row,
      record,
      entry,
      base: versionOf(row.baseVersion ?? entry.version),
      mine: versionOf(row),
    };
  }

  /**
   * An overridden template beside its owner's current version, with each
   * change the owner made since the override started.
   */
  async compareTemplate(id: string): Promise<EmailTemplateComparison> {
    const { entry, base, mine } = await this.reviewOf(id);
    return {
      base,
      // A copy: the registry's own version must not change with a caller's.
      theirs: versionOf(entry.version),
      mine,
      changes: ownerChanges(base, entry.version, mine),
      review: reviewToken(base, entry.version, mine),
    };
  }

  /**
   * Apply a review of the owner's update: each change keeps the site's
   * version, takes the owner's, or takes text the person wrote, all at once.
   * The override stays, now based on the owner's current version, so the same
   * changes are not offered again. Returns what it replaced, for Undo.
   *
   * `review` is the token of the comparison the choices were made on; a
   * template, base or owner's version that moved since is refused (CONFLICT).
   */
  async applyOwnerUpdate(
    id: string,
    choices: Readonly<Record<string, OwnerChangeChoice>>,
    review: string,
    actor?: RequestActor | null
  ): Promise<{ template: EmailTemplateRecord; undo: OwnerUpdateUndo }> {
    const { row, record, entry, base, mine } = await this.reviewOf(id);
    if (reviewToken(base, entry.version, mine) !== review) {
      throw changedSince("reviewed", id, record.slug);
    }
    const merged = applyOwnerChoices(base, entry.version, mine, choices);
    this.assertLayoutMarker(row.kind, merged.htmlContent);

    await this.writeSitesVersion(row, record, merged, entry.digest, {
      // Rebased on the owner's version; the details the site's copy is
      // compared against are a separate matter and carry over.
      baseVersion: {
        ...entry.version,
        details: row.baseVersion?.details ?? detailsOf(entry.defaults),
      },
    });

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: record.name,
      templateKind: record.kind,
      // The base moves even when every change keeps the site's lines, so the
      // entry always names it.
      changedFields: [
        ...changedTemplateFields({ ...mine }, { ...merged }),
        "baseVersion",
      ],
      operation: "apply-owner-update",
      actor,
    });
    return {
      template: await this.getTemplate(id),
      undo: {
        version: mine,
        base,
        applied: versionDigest(merged),
        appliedBase: entry.digest,
      },
    };
  }

  /**
   * Undo an applied review: put back the site's version and the base it had,
   * so the owner's update is offered again.
   */
  async undoOwnerUpdate(
    id: string,
    undo: OwnerUpdateUndo,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    this.ownedEntry(record);
    this.assertOverridden(record);
    if (
      versionDigest(versionOf(row)) !== undo.applied ||
      row.baseDigest !== undo.appliedBase
    ) {
      throw changedSince("applied", id, record.slug);
    }
    const version = versionOf(undo.version);
    const base = versionOf(undo.base);
    this.assertLayoutMarker(row.kind, version.htmlContent);

    await this.writeSitesVersion(row, record, version, versionDigest(base), {
      baseVersion: { ...base, details: row.baseVersion?.details },
    });

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: record.name,
      templateKind: record.kind,
      changedFields: [
        ...changedTemplateFields({ ...versionOf(row) }, { ...version }),
        "baseVersion",
      ],
      operation: "undo-owner-update",
      actor,
    });
    return this.getTemplate(id);
  }

  /**
   * The row as it was read, in what these writes depend on: its version, its
   * description, whether it is overridden and the base it is kept against. A
   * write conditioned on it doesn't apply when the site saved any of those in
   * between. Compared by value, the declared variables included.
   */
  private unchanged(row: StoredTemplateRow) {
    const t = this.emailTemplates;
    const same = (column: Column, value: string | boolean | null) =>
      value === null ? isNull(column) : eq(column, value);
    return and(
      eq(t.id, row.id),
      eq(t.subject, row.subject),
      eq(t.htmlContent, row.htmlContent),
      same(t.plainTextContent, row.plainTextContent ?? null),
      same(t.preheader, row.preheader ?? null),
      same(t.description, row.description ?? null),
      same(t.overridden, row.overridden ?? null),
      same(t.baseDigest, row.baseDigest ?? null),
      this.sameVariables(row.variables ?? null),
      // Every save moves it, to the second on SQLite and MySQL.
      row.updatedAt ? eq(t.updatedAt, row.updatedAt) : isNull(t.updatedAt)
    );
  }

  /**
   * The declared variables as read, compared by value: `jsonb` equality on
   * PostgreSQL, JSON equality on MySQL (the text cast to JSON), and the stored
   * text on SQLite, which drizzle writes with `JSON.stringify`.
   */
  private sameVariables(variables: EmailTemplateVariable[] | null) {
    const column = this.emailTemplates.variables;
    if (variables === null) return isNull(column);
    if (this.dialect === "mysql") {
      return sql`${column} = CAST(${JSON.stringify(variables)} AS JSON)`;
    }
    return eq(column, variables);
  }

  /**
   * Refuse (CONFLICT) when an update's conditioned write did not land: every
   * column it wrote must now hold what it wrote.
   */
  private async assertUpdated(
    id: string,
    written: Record<string, unknown>,
    slug: string
  ): Promise<void> {
    const after = (await this.getRow(id)) as unknown as Record<string, unknown>;
    const landed = Object.entries(written).every(
      ([column, value]) =>
        column === "updatedAt" ||
        sameStoredValue(after[column] ?? null, value ?? null)
    );
    if (!landed) throw changedSince("saved", id, slug);
  }

  /** Refuse (CONFLICT) when a conditioned write did not land: something saved the template first. */
  private async assertWritten(
    id: string,
    version: EmailTemplateVersion,
    baseDigest: string | null,
    slug: string
  ): Promise<void> {
    const after = await this.getRow(id);
    if (
      versionDigest(versionOf(after)) !== versionDigest(version) ||
      after.baseDigest !== baseDigest
    ) {
      throw changedSince("saved", id, slug);
    }
  }

  /**
   * Write a version the site chose (an override, an applied review, an undo),
   * conditioned on the row as read. Liquid judges it as it judges a save, and
   * the re-check a save needs runs once it is written.
   */
  private async writeSitesVersion(
    row: StoredTemplateRow,
    record: EmailTemplateRecord,
    version: EmailTemplateVersion,
    baseDigest: string,
    columns: Record<string, unknown>
  ): Promise<void> {
    const afterSave = await this.checkLiquidOnSave(record, version);
    await this.db
      .update(this.emailTemplates)
      .set({ ...version, ...columns, baseDigest, updatedAt: new Date() })
      .where(this.unchanged(row));
    await this.assertWritten(row.id, version, baseDigest, record.slug);
    await afterSave(await this.getTemplate(row.id));
  }

  /**
   * Write the owner's current version over a row (Reset, or a boot following
   * its owner), conditioned on the row as read, with the engine it renders
   * on. A version Liquid can't read is kept on the old engine before the
   * write, and that mark is taken back if the write fails or doesn't land. A
   * version Liquid reads is released to Liquid once the row holds it, so the
   * version before never renders as Liquid.
   *
   * @returns whether the row now holds the owner's version.
   */
  private async writeOwnersVersion(
    row: StoredTemplateRow,
    entry: OwnedTemplate,
    columns: Record<string, unknown>
  ): Promise<boolean> {
    const engine = await this.keepIfWrittenForOldEngine(row.id, entry);
    const undoKeep = () =>
      engine.created ? this.unmarkEngine(keptKey(row.id)) : Promise.resolve();
    try {
      await this.db
        .update(this.emailTemplates)
        .set(columns)
        .where(this.unchanged(row));
    } catch (error) {
      await undoKeep();
      throw error;
    }
    const after = await this.getRowBySlug(row.slug);
    if (!after || !sameVersion(versionOf(after), entry.version)) {
      await undoKeep();
      return false;
    }
    await this.settleOwnersEngine(
      after,
      entry,
      !sameVersion(versionOf(row), entry.version)
    );
    return true;
  }

  /**
   * Put a row that holds its owner's version on the engine that version was
   * written for, once the switch to Liquid is recorded. A version the owner
   * declares legacy, or (undeclared) one Liquid can't read, is kept on the
   * old engine. One Liquid reads is released to Liquid when the owner
   * declares it Liquid, when it has just replaced the version the mark was
   * recorded for, when the mark was recorded for a legacy declaration the
   * owner has since dropped, or when the mark names text the row no longer
   * holds (a release that failed after the owner's write). A mark the switch
   * recorded for text the row still holds stays: that template renders as it
   * always did.
   */
  private async settleOwnersEngine(
    row: StoredTemplateRow,
    entry: OwnedTemplate,
    replaced: boolean
  ): Promise<void> {
    if ((await this.liquidAdopted()) !== true) return;
    const key = keptKey(row.id);
    const mark = await this.meta.getEntry<string>(key);
    if (this.keepsOwnersVersion(entry)) {
      if (!mark.present) await this.markEngine(key, ownersMark(entry));
      return;
    }
    if (!mark.present) return;
    const recorded = mark.value ?? "";
    if (releasesOwnersMark(entry, replaced, recorded, row)) {
      await this.releaseOwnersVersion(row, entry, recorded);
    }
  }

  /**
   * Release a row holding its owner's version to Liquid. A site save that
   * landed meanwhile was checked while the template was kept, so Liquid never
   * read it: the mark goes back, as a confirmation overtaken by a save does.
   */
  private async releaseOwnersVersion(
    row: StoredTemplateRow,
    entry: OwnedTemplate,
    recorded: string
  ): Promise<void> {
    await this.unmarkEngine(keptKey(row.id));
    const after = await this.getRowBySlug(row.slug);
    if (
      after &&
      (after.overridden === true ||
        !sameVersion(versionOf(after), entry.version))
    ) {
      await this.markEngine(keptKey(row.id), recorded);
    }
  }

  /**
   * Settle the engine of a row a running owner has just taken, if it now
   * follows that owner's version (see settleOwnersEngine).
   */
  private async settleIfFollowing(
    slug: string,
    entry: OwnedTemplate
  ): Promise<void> {
    const after = await this.getRowBySlug(slug);
    if (
      after &&
      after.overridden !== true &&
      after.ownerKind === storedOwner(entry.owner).ownerKind &&
      sameVersion(versionOf(after), entry.version)
    ) {
      await this.settleOwnersEngine(after, entry, false);
    }
  }

  private assertOverridden(record: EmailTemplateRecord): void {
    if (record.overridden) return;
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "This template isn't overridden, so it already follows its owner's version.",
      logContext: { slug: record.slug },
    });
  }

  // ============================================================
  // Template Preview
  // ============================================================

  /**
   * Preview a saved template with sample data.
   *
   * Returns the narrower `{ subject, html }` its published callers expect,
   * DERIVED from the full render rather than composed separately. Composed
   * separately it silently dropped the preheader, left a layout's own
   * `{{year}}`/`{{appName}}` blank, and escaped a subject that is delivered as
   * plain text — so authors were shown something no recipient would receive.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async previewTemplate(
    id: string,
    sampleData: Record<string, unknown>
  ): Promise<{ subject: string; html: string }> {
    const template = await this.getTemplate(id);
    const { subject, html } = await this.renderStored(template, sampleData);
    return { subject, html };
  }

  /**
   * Render fields that may never have been saved.
   *
   * The authoring surface previews what is being typed, which the id-addressed
   * preview structurally cannot show: it reads the stored row, and during
   * creation there is no row at all. Resolving WHICH layout wraps the draft
   * still needs the database, so that half stays here while the composition is
   * the shared one — the saved and unsaved paths cannot drift apart.
   */
  async previewDraft(
    draft: TemplateFields &
      Pick<EmailTemplateRecord, "layoutId"> & { id?: string },
    sampleData: Record<string, unknown>
  ): Promise<RenderedTemplate> {
    const layout = draft.useLayout ? await this.getLayoutFor(draft) : null;
    // A draft of a saved template previews with that template's engine unless
    // the caller chose one, so a kept template's draft looks as it would send.
    const legacy =
      draft.legacy ??
      (draft.id
        ? await this.keptOnOldEngine({ ...draft, id: draft.id }, "render")
        : false);
    return renderTemplate(
      { ...draft, legacy },
      layout && {
        ...layout,
        legacy: await this.keptOnOldEngine(layout, "render"),
      },
      sampleData,
      {
        appName: this.appName,
        brand: await this.brandFor({ ...draft, legacy }, layout),
      }
    );
  }

  // ============================================================
  // Built-in Template Bootstrap and ownership reconciliation
  // ============================================================

  /**
   * Bring the stored templates in line with their owners. Idempotent, and run
   * at every boot.
   *
   * First folds any legacy `_email-header` / `_email-footer` rows into the
   * unified default layout. Then, once the running plugins and what the site's
   * code sets are known, every owned template is reconciled (see
   * `reconcileOwnedRow`) and every other template is given its owner. A boot
   * path that has not called `configureOwnership` reads them from the
   * registered config here; with no config to read, only missing built-ins are
   * created and stored rows are left exactly as they are: a row cannot be
   * judged against owners nobody has listed.
   */
  async ensureBuiltInTemplates(): Promise<void> {
    await this.reconcileStoredTemplates();
    await this.loadEngineState();
    await this.brandStore.load();
  }

  /** The reconciliation `ensureBuiltInTemplates` runs. */
  private async reconcileStoredTemplates(): Promise<void> {
    if (!this.registry.complete) this.configureOwnershipFromConfig();
    await this.migrateLegacyLayout();

    // The `kind` column is added to existing tables as nullable; rows that
    // predate it come back null. Backfill them to `template` (the default
    // layout is already tagged `layout` by the migration above).
    await this.db
      .update(this.emailTemplates)
      .set({ kind: "template" })
      .where(isNull(this.emailTemplates.kind));

    // Recorded once, at the first boot on Liquid, whether or not anything is
    // seeded, and before anything is: it judges the templates stored before
    // Liquid, and every owner's version written from here on is its current
    // one, which is Liquid unless Liquid can't read it.
    if (this.registry.complete) await this.adoptLiquid();

    const rows = (await this.db
      .select()
      .from(this.emailTemplates)) as StoredTemplateRow[];
    const bySlug = new Map(rows.map(row => [row.slug, row]));

    for (const entry of this.registry.owned.values()) {
      const row = bySlug.get(entry.slug);
      if (!row) {
        await this.insertOwned(entry);
      } else if (this.registry.complete) {
        await this.reconcileOwnedRow(row, entry);
        await this.followOwnerMark(row, entry);
      }
    }

    if (!this.registry.complete) return;
    for (const row of rows) {
      if (row.ownerKind !== null || this.registry.owned.has(row.slug)) continue;
      // Not owned by anything running: a known plugin's leftover, or the
      // site's own.
      const plugin = absentPluginFor(row.slug);
      await this.db
        .update(this.emailTemplates)
        .set({
          ...storedOwner(
            plugin ? { kind: "plugin", name: plugin } : { kind: "site" }
          ),
          // A slug alone can't prove a leftover is the plugin's unedited copy
          // (the site may have made one with that slug), so it is kept as an
          // override of itself: if the plugin returns, its version is offered
          // for review rather than written over the row.
          ...(plugin
            ? {
                overridden: true,
                baseVersion: { ...versionOf(row), details: detailsOf(row) },
                baseDigest: versionDigest(versionOf(row)),
              }
            : { overridden: false }),
        })
        // Conditioned on the row as read: an override saved in between stays.
        .where(this.unchanged(row));
    }
  }

  /**
   * Read ownership from the registered config, for a boot path that seeds
   * templates without calling `configureOwnership` first (a cold boot through
   * the request handlers). Leaves the registry incomplete when there is no
   * config to read, as in a bare service.
   */
  private configureOwnershipFromConfig(): void {
    let config: Parameters<typeof ownershipFromConfig>[0];
    try {
      config = getService("config");
    } catch {
      return;
    }
    this.configureOwnership(ownershipFromConfig(config));
  }

  /**
   * The columns an owner sets on a template it already has: its version and
   * kind, and what it says about the template. The name and whether a layout
   * wraps it are the site's settings once the template exists, as the
   * provider, From and the rest are.
   */
  private ownerColumns(entry: OwnedTemplate) {
    return {
      ...entry.version,
      kind: entry.defaults.kind ?? "template",
      ...detailsOf(entry.defaults),
    };
  }

  /** Create an owned template that has no row. */
  private async insertOwned(entry: OwnedTemplate): Promise<void> {
    const now = new Date();
    const t = entry.defaults;
    const id = randomUUID();
    // The engine choice first, then the row: if recording it fails, no row
    // is written and the next boot tries again.
    const { created } = await this.keepIfWrittenForOldEngine(id, entry);
    try {
      await this.db.insert(this.emailTemplates).values({
        id,
        slug: t.slug,
        name: t.name,
        useLayout: t.useLayout ?? true,
        ...this.ownerColumns(entry),
        layoutId: t.layoutId ?? null,
        fromOverride: t.fromOverride ?? null,
        replyTo: t.replyTo ?? null,
        isActive: t.isActive ?? true,
        providerId: t.providerId ?? null,
        attachments: t.attachments ?? null,
        carriesSecret: entry.carriesSecret,
        ...storedOwner(entry.owner),
        overridden: false,
        baseVersion: null,
        baseDigest: null,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.info(`Created email template: ${t.slug}`);
    } catch (error) {
      // No row has this id, so no engine choice may name it either: boots
      // that keep failing would otherwise pile them up.
      if (created) await this.unmarkEngine(keptKey(id));
      // Two first starts seed at once (several instances, or a dev server
      // beside a build): the one that loses hits the unique slug, and the row
      // it wanted is there. Any other failure is warned of, and seeding goes on.
      if (isUniqueViolation(error)) {
        this.logger.debug(
          `Email template "${t.slug}" was created by another process`
        );
        // That process may run another version of its owner: the row it
        // wrote is reconciled against this one's, as any stored row is.
        const row = await this.getRowBySlug(t.slug);
        if (row) {
          await this.reconcileOwnedRow(row, entry);
          await this.followOwnerMark(row, entry);
        }
        return;
      }
      this.logger.warn(`Failed to create email template "${t.slug}"`, {
        error,
      });
    }
  }

  /**
   * Reconcile one stored owned template with its owner. The name, layout use
   * and other settings are the site's and never change here.
   *
   * - **Not reconciled before**, or now owned by someone else: see
   *   `adoptOwner`.
   * - **Overridden**: the site's version stays; see `followOwnerDetails`.
   * - **Following its owner**: its version, kind and details are rewritten
   *   whenever the owner's move.
   */
  private async reconcileOwnedRow(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const owner = storedOwner(entry.owner);
    if (
      row.ownerKind !== owner.ownerKind ||
      row.ownerName !== owner.ownerName
    ) {
      await this.adoptOwner(row, entry);
    } else if (row.overridden === true) {
      await this.followOwnerDetails(row, entry);
    } else {
      await this.followOwner(row, entry);
    }
  }

  /**
   * A template the owner takes for the first time (an install that predates
   * ownership), or again (a plugin's template whose plugin runs again).
   *
   * A row that says something different from the owner's version keeps
   * saying it, as an override based on the owner's version, so no earlier
   * edit is lost. So does one the site's code sets on an install that
   * predates ownership, which keeps sending the stored template it sent until
   * Reset. Either way the owner's details are taken: stored declarations on an
   * install that predates ownership are mostly an older release's, and
   * neither declarations nor a description change what a send renders.
   */
  private async adoptOwner(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const firstTime = row.ownerKind === null;
    // A row holding one of the owner's earlier versions was never edited,
    // only not brought up to date, so it follows the owner too.
    const keepSitesVersion =
      !isOwnersVersion(entry, versionOf(row)) ||
      (firstTime && this.registry.setInCode.has(row.slug)) ||
      row.overridden === true;
    const owner = storedOwner(entry.owner);
    // Conditioned on the row as read: the boot runs in the background, and
    // an edit saved in between is the site's and stays.
    const where = this.unchanged(row);
    if (keepSitesVersion) {
      await this.db
        .update(this.emailTemplates)
        .set({
          ...owner,
          ...detailsOf(entry.defaults),
          overridden: true,
          baseVersion: {
            ...(row.baseVersion ?? entry.version),
            details: detailsOf(entry.defaults),
          },
          baseDigest: row.baseDigest ?? entry.digest,
        })
        .where(where);
      return;
    }
    await this.db
      .update(this.emailTemplates)
      .set({
        ...owner,
        ...this.ownerColumns(entry),
        overridden: false,
        baseVersion: null,
        baseDigest: null,
      })
      .where(where);
    // It now follows the owner, so it renders on the engine the owner's
    // version was written for.
    await this.settleIfFollowing(row.slug, entry);
  }

  /**
   * An overridden template keeps the site's version; whether the owner's
   * moved is read from the kept digest. Its details follow the owner while
   * the site's still equal the owner's as of the site's copy, removals
   * included; once the site has changed them, the site's stay.
   */
  private async followOwnerDetails(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const owners = detailsOf(entry.defaults);
    const kept = row.baseVersion?.details;
    // The site changed them: they stay.
    if (kept && !sameStoredValue(detailsOf(row), kept)) return;
    // Already the owner's, and recorded as such.
    if (kept && sameStoredValue(kept, owners)) return;
    await this.db
      .update(this.emailTemplates)
      .set({
        ...owners,
        updatedAt: new Date(),
        baseVersion: {
          ...versionOf(row.baseVersion ?? entry.version),
          details: owners,
        },
      })
      .where(this.unchanged(row));
  }

  /**
   * Store the owner's secret mark, overridden or not: it is the owner's to
   * declare, never the site's, and the stored copy is what a plugin that
   * stops running leaves its template with. Written on its own, leaving
   * `updatedAt` alone, so no save in between is refused for it.
   */
  private async followOwnerMark(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    if ((row.carriesSecret === true) === entry.carriesSecret) return;
    await this.db
      .update(this.emailTemplates)
      .set({ carriesSecret: entry.carriesSecret })
      .where(eq(this.emailTemplates.id, row.id));
  }

  /** A template following its owner: rewritten whenever the owner's version, kind or details move. */
  private async followOwner(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const wanted = this.ownerColumns(entry);
    const current = {
      ...versionOf(row),
      kind: row.kind ?? "template",
      ...detailsOf(row),
    };
    if (sameStoredValue(current, wanted)) {
      await this.settleOwnersEngine(row, entry, false);
      return;
    }
    const landed = await this.writeOwnersVersion(row, entry, {
      ...wanted,
      updatedAt: new Date(),
    });
    if (landed) {
      this.logger.info(
        `Updated email template to its owner's version: ${row.slug}`
      );
    }
  }

  /**
   * Whether an owner's version renders on the old engine: as the owner
   * declares, or, where it says nothing, when Liquid can't read it at all, as
   * a plugin's contribution published before Liquid may not.
   */
  private keepsOwnersVersion(entry: OwnedTemplate): boolean {
    if (entry.engine) return entry.engine === "legacy";
    return !this.readsAsLiquid(entry.version);
  }

  /**
   * Keep the template `id` on the old engine before its owner's version is
   * written, if that version renders there, so it never renders as Liquid.
   * Before the switch, the switch itself decides.
   *
   * @returns whether the template is recorded as kept, and whether this call
   *   recorded it (so only that call takes it back).
   */
  private async keepIfWrittenForOldEngine(
    id: string,
    entry: OwnedTemplate
  ): Promise<{ kept: boolean; created: boolean }> {
    if ((await this.liquidAdopted()) !== true) {
      return { kept: false, created: false };
    }
    if (!this.keepsOwnersVersion(entry)) return { kept: false, created: false };
    const key = keptKey(id);
    const present = (await this.meta.getEntry(key)).present;
    if (!present) await this.markEngine(key, ownersMark(entry));
    return { kept: true, created: !present };
  }

  // ============================================================
  // Layout Resolution
  // ============================================================

  /**
   * List all layout rows (`kind = 'layout'`), newest first.
   */
  async listLayouts(): Promise<EmailTemplateRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.kind, "layout"))
      .orderBy(desc(this.emailTemplates.createdAt));

    return (results as StoredTemplateRow[]).map(row => this.toRecord(row));
  }

  /**
   * Get the default layout row, or null if none exists yet.
   *
   * The default layout is uniquely identified by BOTH the `default-layout` slug
   * and `kind = 'layout'`. Matching the slug alone would let a regular template
   * named `default-layout` masquerade as the (undeletable) wrapper, and matching
   * any `kind = 'layout'` row would resolve an arbitrary custom layout as the
   * default and cause legacy migration to be skipped.
   */
  async getDefaultLayout(): Promise<EmailTemplateRecord | null> {
    const rows = await this.db
      .select()
      .from(this.emailTemplates)
      .where(
        and(
          eq(this.emailTemplates.slug, DEFAULT_LAYOUT_SLUG),
          eq(this.emailTemplates.kind, "layout")
        )
      )
      .limit(1);

    const row = rows[0] as StoredTemplateRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  /**
   * Resolve the layout that wraps a given template: its explicit
   * `layoutId` when set and valid, otherwise the default layout.
   * Returns null when no layout exists at all.
   */
  async getLayoutFor(
    template: Pick<EmailTemplateRecord, "layoutId">
  ): Promise<EmailTemplateRecord | null> {
    return chooseLayout(
      template,
      async id => {
        try {
          return await this.getTemplate(id);
        } catch (error) {
          if (!NextlyError.isCode(error, "NOT_FOUND")) throw error;
          return null;
        }
      },
      () => this.getDefaultLayout()
    );
  }

  // ============================================================
  // Brand settings
  // ============================================================

  /**
   * The brand settings, the starting value of each, the fonts they can use,
   * and which emails they reach.
   */
  async getBrand(): Promise<BrandOverview> {
    return {
      settings: await this.brandStore.read(),
      starting: resolveBrand(null),
      fonts: EMAIL_SAFE_FONTS.map(({ key, label, stack }) => ({
        key,
        label,
        stack,
      })),
      reach: await this.brandReach(),
    };
  }

  /**
   * Save a change to the brand settings, already parsed at the boundary, and
   * return them as they now are. Every email whose layout reads `brand`
   * looks different from its next render.
   */
  async updateBrand(change: BrandSettingsUpdate): Promise<BrandSettings> {
    const settings = await this.brandStore.update(change);
    this.logger.info("Saved the email brand settings", {
      changed: Object.keys(change),
    });
    return settings;
  }

  /**
   * Which emails the brand settings reach: each template that is not a
   * layout, with the layout a send wraps it in (as `getLayoutFor` chooses
   * it), and whether its own text or that layout reads `brand`. Read from
   * one query of the templates, so the answer costs the same however many
   * there are.
   */
  async brandReach(): Promise<BrandReach[]> {
    const rows = (await this.db
      .select()
      .from(this.emailTemplates)
      .orderBy(desc(this.emailTemplates.createdAt))) as StoredTemplateRow[];
    const records = rows.map(row => this.toRecord(row));
    const byId = new Map(records.map(record => [record.id, record]));
    const defaultLayout =
      records.find(
        record =>
          record.slug === DEFAULT_LAYOUT_SLUG && record.kind === "layout"
      ) ?? null;

    // Which of them render on the engine before Liquid, from one read.
    const kept = await this.keptOnOldEngineIds(records);

    const reach: BrandReach[] = [];
    for (const [i, row] of rows.entries()) {
      if (records[i].kind === "layout") continue;
      reach.push(
        await this.reachOf(row, records[i], {
          find: id => byId.get(id) ?? null,
          defaultLayout,
          kept,
        })
      );
    }
    return reach;
  }

  /** Whether the brand settings reach one email, and through what. */
  private async reachOf(
    row: StoredTemplateRow,
    template: EmailTemplateRecord,
    layouts: {
      find: (id: string) => EmailTemplateRecord | null;
      defaultLayout: EmailTemplateRecord | null;
      /** The ids of the templates kept on the engine before Liquid. */
      kept: ReadonlySet<string>;
    }
  ): Promise<BrandReach> {
    const base = {
      templateId: template.id,
      slug: template.slug,
      name: template.name,
    };
    // Whichever version a send of it uses, as the send decides.
    const source = sendSource({
      stored: template,
      preferCode: prefersCode(row),
      hasCode: this.registry.setInCode.has(template.slug),
    });
    if (source !== "stored") {
      // The code version has no stored layout, and an inactive template
      // with no code version is not sent at all.
      return {
        ...base,
        reached: false,
        reason: source === "code" ? "setInCode" : "inactive",
        via: { body: false, layout: false },
        layout: null,
      };
    }
    const layout = template.useLayout
      ? await chooseLayout(template, layouts.find, () => layouts.defaultLayout)
      : null;
    // The render gives the settings to the body (when its send supplies no
    // `brand`) and to the layout, so the email is reached through either.
    const via = {
      body: textReadsBrand(template, layouts.kept.has(template.id)),
      layout:
        layout !== null &&
        readsBrand(layout.htmlContent, layouts.kept.has(layout.id)),
    };
    const reached = via.body || via.layout;
    return {
      ...base,
      reached,
      reason: unreachedReason(reached, layout),
      via,
      layout: layout && {
        id: layout.id,
        slug: layout.slug,
        name: layout.name,
        overridden: layout.overridden,
      },
    };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Fold legacy `_email-header` / `_email-footer` rows into a single
   * default layout row (`header + {{content}} + footer`), preserving
   * any operator customisations, then delete the legacy rows.
   * Idempotent — a no-op once a layout row exists.
   */
  private async migrateLegacyLayout(): Promise<void> {
    const existingLayout = await this.getDefaultLayout();
    if (existingLayout) return;

    const [header, footer] = await Promise.all([
      this.getRowBySlug(LEGACY_HEADER_SLUG),
      this.getRowBySlug(LEGACY_FOOTER_SLUG),
    ]);
    if (!header && !footer) return;

    const wrapper = `${header?.htmlContent ?? ""}${LAYOUT_CONTENT_PLACEHOLDER}${footer?.htmlContent ?? ""}`;
    const now = new Date();

    // Idempotent + ordered: confirm the default layout exists (creating it only
    // when absent, so re-runs and concurrent bootstraps don't insert duplicates)
    // BEFORE removing the legacy rows, so a failure can never delete the legacy
    // content without a replacement layout in place. A single atomic transaction
    // isn't used because SQLite requires a synchronous transaction callback,
    // which is incompatible with these async queries across dialects. The row
    // is left unowned: the reconciliation compares it with core's layout and,
    // since it holds the site's header and footer, keeps it as an override.
    const existing = await this.getDefaultLayout();
    if (!existing) {
      await this.db.insert(this.emailTemplates).values({
        id: randomUUID(),
        name: "Default Layout",
        slug: DEFAULT_LAYOUT_SLUG,
        kind: "layout",
        subject: "",
        htmlContent: wrapper,
        plainTextContent: null,
        preheader: null,
        layoutId: null,
        fromOverride: null,
        replyTo: null,
        variables: null,
        useLayout: false,
        isActive: true,
        providerId: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (header) {
      await this.db
        .delete(this.emailTemplates)
        .where(eq(this.emailTemplates.id, header.id));
    }
    if (footer) {
      await this.db
        .delete(this.emailTemplates)
        .where(eq(this.emailTemplates.id, footer.id));
    }

    this.logger.info("Migrated legacy email layout rows into default layout.");
  }
}

/** The fields Liquid renders, as a template holds them. */
type LiquidFieldValues = {
  subject?: string | null;
  htmlContent?: string | null;
  plainTextContent?: string | null;
  preheader?: string | null;
};

/** A digest of one field's text, as kept for a template on the old engine. */
function fieldDigest(value: string | null | undefined): string {
  return createHash("sha256")
    .update(value ?? "")
    .digest("hex");
}

/**
 * What a template kept on the old engine records: a digest of each flagged
 * field, by field, so confirming can tell whether that text changed.
 */
function flaggedDigests(template: LiquidFieldValues): string {
  return JSON.stringify(
    Object.fromEntries(
      oldEngineReasons(template).map(({ field }) => [
        field,
        fieldDigest(template[field]),
      ])
    )
  );
}

/**
 * In a kept mark, the owner's declaration it was recorded for. A mark the
 * switch recorded has none, so dropping a declaration never releases one.
 */
const DECLARED = "declared";

/** The mark an owner's version is kept on the old engine with. */
function ownersMark(entry: OwnedTemplate): string {
  if (entry.engine !== "legacy") return flaggedDigests(entry.version);
  const digests = JSON.parse(flaggedDigests(entry.version)) as Record<
    string,
    string
  >;
  return JSON.stringify({ ...digests, [DECLARED]: "legacy" });
}

/**
 * Whether the kept mark of a row holding its owner's version, which Liquid
 * reads, goes (see EmailTemplateService.settleOwnersEngine).
 */
function releasesOwnersMark(
  entry: OwnedTemplate,
  replaced: boolean,
  recorded: string,
  row: LiquidFieldValues
): boolean {
  return (
    entry.engine === "liquid" ||
    replaced ||
    declaredLegacy(recorded) ||
    recordedForOtherText(recorded, row)
  );
}

/** Whether a kept mark was recorded for an owner's legacy declaration. */
function declaredLegacy(recorded: string): boolean {
  try {
    const mark = JSON.parse(recorded) as Record<string, unknown> | null;
    return mark?.[DECLARED] === "legacy";
  } catch {
    return false;
  }
}

/**
 * Whether a kept mark was recorded for text the template no longer holds: a
 * field it recorded reads differently now. Fields flagged only by a later
 * rule don't count, so a change to the rules never releases a template.
 */
function recordedForOtherText(
  recorded: string,
  template: LiquidFieldValues
): boolean {
  return recordedDigests(recorded).some(
    ([field, digest]) => digest !== fieldDigest(template[field])
  );
}

/** The field digests a kept mark recorded, for the fields Liquid renders. */
function recordedDigests(
  recorded: string
): Array<[keyof LiquidFieldValues, string]> {
  let digests: Record<string, unknown>;
  try {
    digests = JSON.parse(recorded) as Record<string, unknown>;
  } catch {
    return [];
  }
  return LIQUID_FIELDS.flatMap(([field]) => {
    const digest = digests?.[field];
    return typeof digest === "string" ? [[field, digest]] : [];
  });
}

/** The labels of the flagged fields whose text is as it was recorded. */
function unchangedFlaggedFields(
  recorded: string,
  template: LiquidFieldValues
): string[] {
  const unchanged = new Set(
    recordedDigests(recorded)
      .filter(([field, digest]) => digest === fieldDigest(template[field]))
      .map(([field]) => field)
  );
  return LIQUID_FIELDS.filter(([field]) => unchanged.has(field)).map(
    ([, label]) => label
  );
}
