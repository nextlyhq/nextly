"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  FieldShell,
  FormLayout,
  Input,
  Skeleton,
  Switch,
} from "@nextlyhq/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { AlertTriangle } from "@admin/components/icons";
import {
  Form,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import { SettingsRow } from "../SettingsRow";
import { SettingsSection } from "../SettingsSection";

import { configFieldPath, ProviderConfigFields } from "./ProviderConfigFields";
import { ProviderTypePicker } from "./ProviderTypePicker";
import {
  buildProviderSchema,
  defaultFormValues,
  emptyConfiguration,
  formValuesToPayload,
  missingDeclaredFields,
  providerToFormValues,
  type EmailProviderPayload,
  type ProviderFormValues,
} from "./schemas/emailProviderSchema";

// ============================================================
// Form id used by external buttons (e.g. SettingsLayout.actions)
// to submit this form via the `form` attribute.
// ============================================================

export const EMAIL_PROVIDER_FORM_ID = "email-provider-form";

/**
 * Whether a stored provider's type is absent from the catalog this server
 * registered — its plugin was removed while the record survived.
 *
 * Exported because the page that renders the Update button is not the
 * component that renders the form, and both have to reach the same answer. A
 * page deciding it separately is how the form comes to say the settings cannot
 * be edited while the button beside it still submits them.
 *
 * Only meaningful once the catalog has settled: while it is loading, every
 * type looks unregistered. Callers gate on their own loading state, exactly as
 * the form does before it uses this.
 */
export function isUnregisteredProviderType(
  providerType: string | undefined,
  descriptors: EmailProviderDescriptor[]
): boolean {
  if (providerType === undefined) return false;
  return !descriptors.some(entry => entry.type === providerType);
}

/** What the provider catalog can be used for right now. */
export type EmailCatalogState = "loading" | "unavailable" | "stale" | "ready";

/**
 * Which of those four states the catalog is in.
 *
 * A failed request has two outcomes calling for opposite responses. With
 * nothing cached there is no catalog at all, and a surface built from it would
 * render an empty picker — which reads as "this installation has no provider
 * types" rather than "the list could not be loaded". With descriptors already
 * in hand the failure is a refresh that did not land: every one of them still
 * renders and still validates, so withdrawing the page would discard whatever
 * had been typed to fix nothing.
 *
 * The two are answered here rather than at each surface for the same reason
 * `isUnregisteredProviderType` is: the form and the page framing it must reach
 * one answer. A surface deciding separately is how an enabled Update comes to
 * sit under a notice saying the settings cannot be edited.
 *
 * Loading outranks failure so a retry in flight reads as loading rather than
 * as the error it has not yet cleared.
 */
export function emailCatalogState({
  loading,
  failed,
  descriptors,
}: {
  loading?: boolean;
  /** Whether the request for the catalog failed. */
  failed: boolean;
  /** Whatever descriptors are in hand, cached ones included. */
  descriptors: EmailProviderDescriptor[];
}): EmailCatalogState {
  if (loading === true) return "loading";
  if (!failed) return "ready";
  return descriptors.length > 0 ? "stale" : "unavailable";
}

/**
 * What a record HELD, as the key for "has this form already got it".
 *
 * The fields hydration reads, serialised. A timestamp would be the obvious
 * key and is not a sound one: MySQL stores `updated_at` as `datetime` with no
 * fractional seconds, so two writes inside the same second come back
 * indistinguishable — and the second would be taken for the version already on
 * screen, leaving stale values that the next save writes back.
 *
 * Comparing what the record contains has no precision to lose, and answers the
 * question actually being asked: is anything here different from what this
 * form was built from?
 */
function recordRevision(provider: EmailProviderRecord): string {
  return JSON.stringify([
    provider.name,
    provider.type,
    provider.fromEmail,
    provider.fromName,
    provider.isDefault,
    provider.isActive,
    provider.configuration,
  ]);
}

// ============================================================
// EmailProviderForm Component
// ============================================================

export interface EmailProviderFormProps {
  mode: "create" | "edit";
  provider?: EmailProviderRecord;
  /** The provider catalog this server registered. */
  descriptors: EmailProviderDescriptor[];
  descriptorsLoading?: boolean;
  descriptorsError?: Error | null;
  isPending: boolean;
  /**
   * Receives the finished payload, not raw form values.
   *
   * Deciding which credentials to omit needs the descriptor and the stored
   * configuration, and this component is the one that holds both. Handing that
   * job to each page would put the same provider-shaped logic back in two
   * places — which is what the hardcoded form did.
   */
  onSubmit: (payload: EmailProviderPayload) => void;
}

/**
 * The email provider form, rendered from server-supplied descriptors.
 *
 * It knows about no provider in particular. Which types exist, which fields
 * each takes, which of those are credentials and what bounds they carry all
 * arrive from the registry, so a provider contributed by a plugin is
 * configurable here without this file changing.
 */
export function EmailProviderForm({
  mode,
  provider,
  descriptors,
  descriptorsLoading,
  descriptorsError,
  isPending,
  onSubmit,
}: EmailProviderFormProps) {
  const isEdit = mode === "edit";

  // In edit mode the stored type wins, even before the catalog arrives, so the
  // form never briefly renders as a different provider. In create mode the
  // first registered type is the initial selection.
  const initialType = provider?.type ?? descriptors[0]?.type ?? "";

  const initialDescriptor = useMemo(
    () => descriptors.find(entry => entry.type === initialType),
    [descriptors, initialType]
  );

  // The schema depends on the selected provider, and the selection lives in the
  // form, so the resolver cannot be a plain value handed to `useForm` — it
  // would freeze at whichever provider was selected first. Indirecting through
  // a ref keeps one stable resolver identity that always validates against the
  // provider currently on screen.
  const resolverRef = useRef(
    zodResolver(buildProviderSchema(initialDescriptor, provider?.configuration))
  );
  const resolver = useCallback<Resolver<ProviderFormValues>>(
    (values, context, options) => resolverRef.current(values, context, options),
    []
  );

  const form = useForm<ProviderFormValues>({
    resolver,
    defaultValues: provider
      ? providerToFormValues(provider, initialDescriptor)
      : defaultFormValues(initialDescriptor),
  });

  const selectedType = form.watch("type");
  const selectedDescriptor = useMemo(
    () => descriptors.find(entry => entry.type === selectedType),
    [descriptors, selectedType]
  );

  // The configuration half of the schema is this provider's and nothing
  // else's, so it is rebuilt whenever the selection changes.
  // The stored configuration travels with it, and ONLY while the type is
  // unchanged: across a type change it belongs to the previous provider, so a
  // legacy choice from that one must not keep validating here.
  resolverRef.current = useMemo(
    () =>
      zodResolver(
        buildProviderSchema(
          selectedDescriptor,
          provider && provider.type === selectedType
            ? provider.configuration
            : undefined
        )
      ),
    [selectedDescriptor, provider, selectedType]
  );

  // Which record this form has already been populated from, and whether the
  // catalog had a descriptor for it at the time. Hydration happens ONCE per
  // provider, not on every change to its inputs — but a hydration that had no
  // descriptor filled in none of the configuration, so it is not finished.
  const hydratedFor = useRef<{
    id: string;
    hadDescriptor: boolean;
    /** What the record HELD when it filled the form, not when it was written. */
    revision: string;
  } | null>(null);

  // Repopulate once the record and the catalog have both arrived: both are
  // fetched, and whichever lands second decides which fields can be filled in.
  //
  // Guarded on the provider's identity rather than run on every `descriptors`
  // change. The catalog refetches on mount and on window focus, so an unguarded
  // reset would discard whatever the operator had typed the moment they
  // switched tabs and came back — and a deployment adding an UNRELATED provider
  // would do it while the form sat open.
  useEffect(() => {
    if (!provider || !isEdit) return;
    const descriptor = descriptors.find(entry => entry.type === provider.type);
    // Waits for the descriptor when the catalog has not arrived yet: hydrating
    // without one would fill the form from the record alone and then never run
    // again, leaving every configuration field empty.
    if (!descriptor && descriptors.length === 0) return;

    const hydrated = hydratedFor.current;
    if (hydrated?.id === provider.id) {
      // The same record, but a NEWER version of it: the detail query refetches
      // on focus, so a change made elsewhere arrives while this form sits
      // open. Holding the old values would send them back on the next save and
      // revert that change, from an edit that never touched those fields.
      //
      // `keepDirtyValues` is what makes reconciling safe: fields the operator
      // has touched keep what they typed, and everything else takes the
      // server's newer value. A plain reset here would discard their work,
      // which is what the identity guard exists to prevent.
      const revision = recordRevision(provider);
      if (hydrated.revision !== revision) {
        hydratedFor.current = {
          id: provider.id,
          hadDescriptor: descriptor !== undefined,
          revision,
        };

        // Which provider the configuration on screen was built for, read from
        // the form rather than remembered beside it. The form already holds
        // the answer, and a remembered copy is a second one that drifts.
        const typeBefore = form.getValues("type");
        const held = form.getValues("configuration");

        const next = providerToFormValues(provider, descriptor);
        form.reset(next, { keepDirtyValues: true });

        // A configuration belongs to the type it was built for, so whichever
        // side owns the type owns the configuration with it.
        const typeOnScreen = form.getValues("type");
        if (typeOnScreen !== provider.type) {
          // The operator picked a different type and has not saved it, so
          // their choice survived the reset as a dirty value. The record's
          // configuration describes a provider the form is no longer showing:
          // keeping it submits an SMTP host to a Resend payload -- stored as
          // an undeclared key by a permissive parser, or refused outright by a
          // stricter one, on every save from then on. The reset above has
          // already applied it to every field nobody typed into, so the
          // configuration on screen is put back as it was.
          //
          // `setValue`, so the baseline keeps holding the record's own
          // configuration and what is restored keeps DIFFERING from it. A
          // `resetField` here would make these values the baseline, and the
          // moment the record moved to the type already on screen the two
          // would agree, no branch would restore anything, and the next
          // reconcile would replace an edit still in progress.
          form.setValue("configuration", held, { shouldDirty: true });
        } else if (typeBefore !== provider.type) {
          // The record moved to another type while the form sat open and
          // nobody here had chosen one, so the record's configuration is the
          // right one now. It has to stop being DIRTY as well as change value:
          // `shouldDirty: false` leaves an existing mark standing, and the next
          // reconcile's `keepDirtyValues` would then preserve this now-stale
          // value in place of the server's newer one.
          form.resetField("configuration", {
            defaultValue: next.configuration,
          });
        }
        return;
      }

      // Nothing a later catalog can offer while it still has no descriptor.
      if (!descriptor) return;

      if (!hydrated.hadDescriptor) {
        // The catalog answered "not registered" when this form opened and
        // answers otherwise now: the plugin was reinstalled while the tab sat
        // open. The configuration half was filled from a descriptor that did
        // not exist, so its fields are empty while the form is editable again —
        // a required credential reads as missing, and an optional blank submits
        // as a deliberate removal of what is stored.
        hydratedFor.current = {
          id: provider.id,
          hadDescriptor: true,
          revision: recordRevision(provider),
        };
        // Only the configuration is replaced, and through `resetField` rather
        // than a whole-form reset. The identity fields were filled from the
        // record and belong to whoever has the form open.
        form.resetField("configuration", {
          defaultValue: providerToFormValues(provider, descriptor)
            .configuration,
        });
        return;
      }

      return;
    }

    hydratedFor.current = {
      id: provider.id,
      hadDescriptor: descriptor !== undefined,
      revision: recordRevision(provider),
    };
    form.reset(providerToFormValues(provider, descriptor));
  }, [provider, isEdit, descriptors, form]);

  // Give every field the SELECTED provider declares a value, whether or not
  // the form has been anywhere near a record.
  //
  // The catalog refetches on mount and on window focus, so a deployment that
  // adds a configuration field to a provider type already in use arrives while
  // forms are open. Nothing about the RECORD changed, so no amount of
  // reconciling against one reaches this: a create form has no record to
  // reconcile against, and an edit form carrying an unsaved type change is
  // showing a provider its record is not. Both would leave the new field
  // holding nothing while its control renders an empty state — a switch
  // drawing a position the payload does not carry.
  //
  // The record supplies starting values only while it describes the provider
  // on screen; otherwise the descriptor's own defaults do, exactly as they
  // would in a form opened now. Field names are shared across providers, so
  // seeding from a record of another type would carry its setting into a form
  // where nobody chose it.
  //
  // Written one path at a time, and only where the form holds nothing, so a
  // descriptor that RENAMES a field rather than adding one cannot arrive at an
  // occupied path and overwrite work in progress.
  useEffect(() => {
    if (!selectedDescriptor) return;
    const source =
      provider && provider.type === selectedType ? provider : undefined;
    for (const missing of missingDeclaredFields(
      form.getValues("configuration"),
      source,
      selectedDescriptor
    )) {
      form.resetField(configFieldPath(missing.field), {
        defaultValue: missing.value,
      });
    }
  }, [selectedDescriptor, selectedType, provider, form]);

  // Select the first registered provider once the catalog arrives. The form is
  // built before the request finishes, so without this a newly added provider
  // opens with nothing selected and no configuration fields at all. Guarded on
  // the type still being empty, so it can never overwrite a real choice.
  useEffect(() => {
    if (isEdit || descriptors.length === 0) return;

    // A selection the catalog no longer offers is as unusable as no selection.
    // The catalog refetches on mount and on focus, so a create form left open
    // across a deployment that removed the chosen plugin keeps a type nothing
    // can render: `selectedDescriptor` is undefined, the configuration section
    // disappears, and submitting sends a type the server will refuse. Guarded
    // on the CURRENT type being unusable rather than merely empty, so a real
    // choice that is still registered is never overwritten.
    const current = form.getValues("type");
    if (current !== "" && !isUnregisteredProviderType(current, descriptors)) {
      return;
    }

    // The IDENTITY half is kept. Only the type and its configuration are
    // unusable; the name, sender address and switches are the operator's own
    // work and have nothing to do with which plugin is installed. Discarding
    // them turns a catalog refresh into lost typing.
    // Written field by field rather than through a whole-form reset, which
    // would make every current value the new baseline and clear the dirty
    // marks on the identity fields this is deliberately keeping.
    const next = defaultFormValues(descriptors[0]);
    form.resetField("type", { defaultValue: next.type });
    form.resetField("configuration", { defaultValue: next.configuration });
  }, [isEdit, descriptors, form]);

  // Replace the configuration when the provider type changes. The two
  // providers have different shapes, so carrying values across is leftover
  // rather than a partial edit — and the server discards them for the same
  // reason.
  const handleValidSubmit = useCallback(
    (values: ProviderFormValues) => {
      // The stored configuration is only a fair comparison while the type is
      // unchanged. Across a type change it belongs to the previous provider,
      // and the server replaces it wholesale for the same reason.
      const stored =
        provider && provider.type === values.type
          ? provider.configuration
          : undefined;
      onSubmit(formValuesToPayload(values, selectedDescriptor, stored));
    },
    [onSubmit, provider, selectedDescriptor]
  );

  const handleTypeChange = useCallback(
    (type: string) => {
      const next = descriptors.find(entry => entry.type === type);
      // Coming BACK to the type the record is stored as restores what the
      // record holds, rather than a blank form. Blanking it would leave the
      // original type selected with its credential gone: a required one could
      // not be saved without retyping a secret nobody meant to change, and an
      // optional one would read as a deliberate removal.
      const configuration =
        provider && provider.type === type
          ? providerToFormValues(provider, next).configuration
          : emptyConfiguration(next);

      // The type is the operator's own edit, so it is marked DIRTY: a refetch
      // reconciles with `keepDirtyValues`, which keeps only what is marked,
      // and an unmarked selection is silently replaced by the record's. Coming
      // back to the stored type marks nothing, because there is then nothing
      // to preserve.
      form.setValue("type", type, { shouldDirty: true });
      // The configuration is DERIVED from that choice rather than typed, so it
      // becomes the new baseline instead: nothing here is work to protect, and
      // leaving it marked would preserve it over the record's own values on
      // every later reconcile.
      //
      // Both written field by field. A whole-form reset would make every
      // current value the new baseline, clearing the dirty marks on the
      // identity fields — and a rename in progress would then be overwritten
      // by the next refetch with nothing on screen to say so.
      form.resetField("configuration", { defaultValue: configuration });
    },
    [descriptors, form, provider]
  );

  const catalog = emailCatalogState({
    loading: descriptorsLoading,
    failed: descriptorsError !== null && descriptorsError !== undefined,
    descriptors,
  });

  if (catalog === "loading") {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </div>
    );
  }

  // Fatal only when there is nothing to render FROM. A failed fetch with no
  // catalog would otherwise show an empty picker, which reads as "this
  // installation has no email providers".
  if (catalog === "unavailable") {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the list of available provider types, so this form
          cannot be shown. Reload the page to try again.
        </AlertDescription>
      </Alert>
    );
  }

  // A stored provider whose type is no longer registered — its plugin was
  // removed. The record is kept and readable; editing it would mean rendering
  // fields nothing can validate, so the form says what happened instead.
  const isUnknownStoredType =
    isEdit &&
    provider !== undefined &&
    isUnregisteredProviderType(provider.type, descriptors);

  // The catalog is refetched on mount and on window focus, so a form left open
  // over a blip fails a fetch it never asked for while holding descriptors
  // that still render and still validate. Replacing the form would discard
  // whatever had been typed to fix a problem that costs nothing here, so this
  // says so and stays out of the way.
  const staleCatalog = catalog === "stale";

  return (
    <Form {...form}>
      {/* The Update/Test Connection/Cancel buttons live in the page that
          renders this form (they submit via the `EMAIL_PROVIDER_FORM_ID`
          attribute), so there is no action bar for this component to own —
          only the measure moves to FormLayout. */}
      <FormLayout>
        {staleCatalog && (
          <Alert className="mb-6">
            <AlertDescription>
              The list of provider types could not be refreshed, so this form is
              using the version it loaded with. Your changes are safe; reload
              once you have saved if a provider seems to be missing.
            </AlertDescription>
          </Alert>
        )}
        <form
          id={EMAIL_PROVIDER_FORM_ID}
          onSubmit={e => {
            // Refused here as well as on the button. Every field is disabled in
            // this state, so the payload could only ever be an empty
            // configuration, which the server would reject as an unsupported
            // provider — an error contradicting the notice above it. A disabled
            // button is a UI affordance; this is the rule.
            if (isUnknownStoredType) {
              e.preventDefault();
              return;
            }
            void form.handleSubmit(handleValidSubmit)(e);
          }}
          className="space-y-6"
          aria-busy={isPending}
        >
          {isUnknownStoredType && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    This provider is stored as{" "}
                    <code className="font-mono">{provider.type}</code>, which is
                    not registered on this server. Its settings cannot be edited
                    and it cannot send until the package that provides it is
                    installed again. Deleting it here is safe.
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Section: Provider Identity ─────────────────────────── */}
          <SettingsSection label="Provider Identity">
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Provider Name"
                  description="A friendly name to identify this email provider."
                  error={fieldState.error?.message}
                >
                  <Input
                    placeholder="e.g. Production SMTP, Resend Primary"
                    autoFocus={!isEdit}
                    disabled={isPending || isUnknownStoredType}
                    {...field}
                  />
                </FieldShell>
              )}
            />

            {/* Not a FieldShell candidate: ProviderTypePicker is a row of
                independently-focusable cards (like a RadioGroup), not one
                control an id can attach to. Left as its original SettingsRow
                so the label still reads over the picker. */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem className="m-0">
                  <SettingsRow
                    label="Provider Type"
                    description="Select the provider type to match your configuration."
                  >
                    <ProviderTypePicker
                      descriptors={descriptors}
                      value={field.value}
                      // Locked along with the rest when the stored type is not
                      // registered: the notice above says the settings cannot be
                      // edited, and a live picker would make that false by
                      // letting an orphaned record be converted while every
                      // other field stays disabled.
                      disabled={isPending || isUnknownStoredType}
                      onChange={type => {
                        field.onChange(type);
                        handleTypeChange(type);
                      }}
                    />
                    <FormMessage className="mt-1.5" />
                  </SettingsRow>
                </FormItem>
              )}
            />
          </SettingsSection>

          {/* ── Section: Provider-specific configuration ───────────── */}
          {selectedDescriptor && (
            <ProviderConfigFields
              descriptor={selectedDescriptor}
              control={form.control}
              disabled={isPending}
              // Only while the type is unchanged, on the same reasoning the
              // submit path uses: across a type change the stored configuration
              // belongs to the previous provider, so none of these fields has
              // anything stored behind it.
              storedConfiguration={
                provider && provider.type === selectedType
                  ? provider.configuration
                  : undefined
              }
              recordId={provider?.id}
            />
          )}

          {/* ── Section: Sender Information ────────────────────────── */}
          <SettingsSection label="Sender Information">
            <FormField
              control={form.control}
              name="fromEmail"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="From Email"
                  description={
                    // Three independent parts, composed rather than nested.
                    // A provider can require a verified sender without
                    // publishing documentation, and it can publish
                    // documentation without requiring one — a self-hosted relay
                    // is the second. Nesting the link inside the warning made
                    // it unreachable for exactly those providers, which is the
                    // case the descriptor-driven form exists to serve.
                    <span className="flex items-start gap-1.5">
                      {selectedDescriptor?.capabilities
                        ?.requiresVerifiedSender && (
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning-600 dark:text-warning-500" />
                      )}
                      <span>
                        {selectedDescriptor?.capabilities
                          ?.requiresVerifiedSender ? (
                          <>
                            Must be an address on a{" "}
                            <strong>verified domain</strong> in your{" "}
                            {selectedDescriptor.label} account.{" "}
                          </>
                        ) : (
                          <>Default sender email address. </>
                        )}
                        {/* The provider's own exception to that rule, when it
                            has one. Resend's shared testing address works
                            before any domain is verified, and omitting it makes
                            a usable configuration look impossible. */}
                        {selectedDescriptor?.senderGuidance && (
                          <>{selectedDescriptor.senderGuidance} </>
                        )}
                        {selectedDescriptor?.docsUrl && (
                          <a
                            href={selectedDescriptor.docsUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-2"
                          >
                            Provider documentation
                          </a>
                        )}
                      </span>
                    </span>
                  }
                  error={fieldState.error?.message}
                >
                  <Input
                    type="email"
                    placeholder="noreply@example.com"
                    disabled={isPending || isUnknownStoredType}
                    {...field}
                  />
                </FieldShell>
              )}
            />

            <FormField
              control={form.control}
              name="fromName"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="From Name"
                  description='Display name shown in the email "From" field. Optional.'
                  error={fieldState.error?.message}
                >
                  <Input
                    placeholder="My App"
                    disabled={isPending || isUnknownStoredType}
                    {...field}
                  />
                </FieldShell>
              )}
            />
          </SettingsSection>

          {/* ── Section: Defaults ──────────────────────────────────── */}
          <SettingsSection label="Defaults">
            <FormField
              control={form.control}
              name="isDefault"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Set as Default Provider"
                  description="When enabled, this provider will be used to send all transactional emails unless a specific provider is requested."
                  error={fieldState.error?.message}
                >
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isPending || isUnknownStoredType}
                  />
                </FieldShell>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Active"
                  description="Inactive providers are kept but never used to send. Turn off to pause a provider without deleting it."
                  error={fieldState.error?.message}
                >
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isPending || isUnknownStoredType}
                  />
                </FieldShell>
              )}
            />
          </SettingsSection>
        </form>
      </FormLayout>
    </Form>
  );
}
