"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, Input, Skeleton, Switch } from "@nextlyhq/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { AlertTriangle } from "@admin/components/icons";
import {
  Form,
  FormControl,
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

import { ProviderConfigFields } from "./ProviderConfigFields";
import { ProviderTypePicker } from "./ProviderTypePicker";
import {
  buildProviderSchema,
  defaultFormValues,
  emptyConfiguration,
  formValuesToPayload,
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
    zodResolver(buildProviderSchema(initialDescriptor))
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
  resolverRef.current = useMemo(
    () => zodResolver(buildProviderSchema(selectedDescriptor)),
    [selectedDescriptor]
  );

  // Which record this form has already been populated from. Hydration happens
  // ONCE per provider, not on every change to its inputs.
  const hydratedFor = useRef<string | null>(null);

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
    if (hydratedFor.current === provider.id) return;

    hydratedFor.current = provider.id;
    form.reset(providerToFormValues(provider, descriptor));
  }, [provider, isEdit, descriptors, form]);

  // Select the first registered provider once the catalog arrives. The form is
  // built before the request finishes, so without this a newly added provider
  // opens with nothing selected and no configuration fields at all. Guarded on
  // the type still being empty, so it can never overwrite a real choice.
  useEffect(() => {
    if (isEdit || descriptors.length === 0) return;
    if (form.getValues("type") !== "") return;
    form.reset(defaultFormValues(descriptors[0]));
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
      form.reset({
        ...form.getValues(),
        type,
        // Coming BACK to the type the record is stored as restores what the
        // record holds, rather than a blank form. Blanking it would leave the
        // original type selected with its credential gone: a required one
        // could not be saved without retyping a secret nobody meant to change,
        // and an optional one would read as a deliberate removal.
        configuration:
          provider && provider.type === type
            ? providerToFormValues(provider, next).configuration
            : emptyConfiguration(next),
      });
    },
    [descriptors, form, provider]
  );

  if (descriptorsLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </div>
    );
  }

  // A failed catalog fetch is reported rather than rendered as an empty picker,
  // which would read as "this installation has no email providers".
  if (descriptorsError) {
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

  return (
    <Form {...form}>
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
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="Provider Name"
                  description="A friendly name to identify this email provider."
                >
                  <FormControl>
                    <Input
                      placeholder="e.g. Production SMTP, Resend Primary"
                      autoFocus={!isEdit}
                      disabled={isPending || isUnknownStoredType}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />

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
          />
        )}

        {/* ── Section: Sender Information ────────────────────────── */}
        <SettingsSection label="Sender Information">
          <FormField
            control={form.control}
            name="fromEmail"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
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
                >
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="noreply@example.com"
                      disabled={isPending || isUnknownStoredType}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="fromName"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="From Name"
                  description='Display name shown in the email "From" field. Optional.'
                >
                  <FormControl>
                    <Input
                      placeholder="My App"
                      disabled={isPending || isUnknownStoredType}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>

        {/* ── Section: Defaults ──────────────────────────────────── */}
        <SettingsSection label="Defaults">
          <FormField
            control={form.control}
            name="isDefault"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="Set as Default Provider"
                  description="When enabled, this provider will be used to send all transactional emails unless a specific provider is requested."
                >
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending || isUnknownStoredType}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="Active"
                  description="Inactive providers are kept but never used to send. Turn off to pause a provider without deleting it."
                >
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending || isUnknownStoredType}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>
      </form>
    </Form>
  );
}
