/**
 * Form Notifications Tab
 *
 * Email integration configuration panel for form submissions.
 * Allows selecting existing email providers and templates for notifications.
 *
 * @module admin/components/builder/FormNotificationsTab
 * @since 0.1.0
 */

"use client";

import { Button, Input } from "@revnixhq/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useFormBuilder,
  createNotification,
  type FormNotification,
} from "../../context/FormBuilderContext";

// ============================================================================
// Types
// ============================================================================

interface ProviderOption {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

interface TemplateOption {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

// ============================================================================
// API helpers
// ============================================================================

async function fetchProviders(): Promise<ProviderOption[]> {
  try {
    const res = await fetch("/admin/api/email-providers?pageSize=100&page=1", {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data?.data as ProviderOption[]) ?? [];
  } catch {
    return [];
  }
}

async function fetchTemplates(): Promise<TemplateOption[]> {
  try {
    const res = await fetch("/admin/api/email-templates", {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data?.data as TemplateOption[]) ?? [];
  } catch {
    return [];
  }
}

// ============================================================================
// Integration Card
// ============================================================================

interface IntegrationCardProps {
  notification: FormNotification;
  providerName: string;
  onEdit: () => void;
  onDelete: () => void;
}

function IntegrationCard({
  notification,
  providerName,
  onEdit,
  onDelete,
}: IntegrationCardProps) {
  return (
    <div
      className={`form-integration-card ${!notification.enabled ? "form-integration-card--disabled" : ""}`}
    >
      <div className="form-integration-card-left">
        <div className="form-integration-card-info">
          <span className="form-integration-card-name">
            {notification.name}
          </span>
          <span className="form-integration-provider-badge">
            Provider: {providerName}
          </span>
        </div>
      </div>
      <div className="form-integration-card-actions">
        <button
          type="button"
          className="form-integration-btn form-integration-btn--edit"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="form-integration-btn form-integration-btn--delete"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Integration Modal
// ============================================================================

interface IntegrationModalProps {
  initial: FormNotification;
  providers: ProviderOption[];
  templates: TemplateOption[];
  fields: { name: string; label: string }[];
  isEditing: boolean;
  onSave: (notification: FormNotification) => void;
  onCancel: () => void;
}

function IntegrationModal({
  initial,
  providers,
  templates,
  fields,
  isEditing,
  onSave,
  onCancel,
}: IntegrationModalProps) {
  const [form, setForm] = useState<FormNotification>(initial);
  const [newCc, setNewCc] = useState("");
  const [newBcc, setNewBcc] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  const update = useCallback(
    <K extends keyof FormNotification>(key: K, value: FormNotification[K]) => {
      setForm(prev => ({ ...prev, [key]: value }));
    },
    []
  );

  const addCc = useCallback(() => {
    const email = newCc.trim();
    if (!email) return;
    setForm(prev => ({ ...prev, cc: [...prev.cc, email] }));
    setNewCc("");
  }, [newCc]);

  const removeCc = useCallback((index: number) => {
    setForm(prev => ({ ...prev, cc: prev.cc.filter((_, i) => i !== index) }));
  }, []);

  const addBcc = useCallback(() => {
    const email = newBcc.trim();
    if (!email) return;
    setForm(prev => ({ ...prev, bcc: [...prev.bcc, email] }));
    setNewBcc("");
  }, [newBcc]);

  const removeBcc = useCallback((index: number) => {
    setForm(prev => ({ ...prev, bcc: prev.bcc.filter((_, i) => i !== index) }));
  }, []);

  const handleSubmit = useCallback(() => {
    onSave(form);
  }, [form, onSave]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        onCancel();
      }
    },
    [onCancel]
  );

  const defaultProvider = providers.find(p => p.isDefault);
  const defaultLabel = defaultProvider
    ? `System Default (${defaultProvider.name})`
    : "System Default";

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div className="bg-background rounded-xl border border-border shadow-md w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <h3 className="text-lg font-semibold text-foreground">
            {isEditing ? "Edit Email Integration" : "Add Email Integration"}
          </h3>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Integration Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Integration Name
            </label>
            <Input
              type="text"
              value={form.name}
              onChange={e => update("name", e.target.value)}
              placeholder="e.g. Admin Notification"
            />
          </div>

          {/* Email Provider & Template */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Email Provider
              </label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.providerId ?? ""}
                onChange={e =>
                  update("providerId", e.target.value || undefined)
                }
              >
                <option value="">{defaultLabel}</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Email Template
              </label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.templateSlug ?? ""}
                onChange={e =>
                  update("templateSlug", e.target.value || undefined)
                }
              >
                <option value="">Select an email template</option>
                {templates
                  .filter(t => t.isActive)
                  .map(t => (
                    <option key={t.id} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Sender Email */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Sender Email
            </label>
            <Input
              type="email"
              value={form.senderEmail ?? ""}
              onChange={e => update("senderEmail", e.target.value || undefined)}
              placeholder="noreply@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the provider&apos;s default configured address.
            </p>
          </div>

          {/* Recipient Configuration */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Recipient Type
                </label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.recipientType}
                  onChange={e =>
                    update(
                      "recipientType",
                      e.target.value as "static" | "field"
                    )
                  }
                >
                  <option value="static">Static Email Address</option>
                  <option value="field">Email from Form Field</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  {form.recipientType === "field"
                    ? "Target Email Field"
                    : "Recipient Email"}
                </label>
                {form.recipientType === "field" ? (
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={form.to}
                    onChange={e => update("to", e.target.value)}
                  >
                    <option value="">Select a field</option>
                    {fields.map(f => (
                      <option key={f.name} value={`{{${f.name}}}`}>
                        {f.label} ({`{{${f.name}}}`})
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    type="email"
                    value={form.to}
                    onChange={e => update("to", e.target.value)}
                    placeholder="admin@example.com"
                  />
                )}
              </div>
            </div>

            {/* CC Recipients */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                CC Recipients (Optional)
              </label>
              {form.cc.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.cc.map((email, i) => (
                    <div
                      key={i}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium border border-border"
                    >
                      <span>{email}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground hover:bg-background rounded-full p-0.5"
                        onClick={() => removeCc(i)}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  value={newCc}
                  onChange={e => setNewCc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCc();
                    }
                  }}
                  placeholder="cc@example.com"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCc}
                  className="shrink-0 px-3"
                >
                  Add CC
                </Button>
              </div>
            </div>

            {/* BCC Recipients */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                BCC Recipients (Optional)
              </label>
              {form.bcc.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.bcc.map((email, i) => (
                    <div
                      key={i}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium border border-border"
                    >
                      <span>{email}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground hover:bg-background rounded-full p-0.5"
                        onClick={() => removeBcc(i)}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  value={newBcc}
                  onChange={e => setNewBcc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBcc();
                    }
                  }}
                  placeholder="bcc@example.com"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addBcc}
                  className="shrink-0 px-3"
                >
                  Add BCC
                </Button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-foreground">
                Enable Integration
              </label>
              <p className="text-xs text-muted-foreground">
                Toggle to turn on/off without removing.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.enabled}
                onChange={e => update("enabled", e.target.checked)}
              />
              <div className="w-9 h-5 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary border border-border"></div>
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-end gap-3 rounded-b-xl">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {isEditing ? "Save Changes" : "Add Integration"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FormNotificationsTab - Email integrations configuration
 *
 * Allows users to configure email integrations that trigger when a form is
 * submitted. Each integration references an existing email provider and
 * template rather than duplicating provider credentials.
 */
export function FormNotificationsTab() {
  const {
    notifications,
    fields,
    addNotification,
    updateNotification,
    deleteNotification,
  } = useFormBuilder();

  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [modalState, setModalState] = useState<{
    open: boolean;
    editing: FormNotification | null;
  }>({ open: false, editing: null });

  useEffect(() => {
    void fetchProviders().then(setProviders);
    void fetchTemplates().then(setTemplates);
  }, []);

  const fieldList = fields.map(f => ({ name: f.name, label: f.label }));

  const openAddModal = useCallback(() => {
    setModalState({ open: true, editing: null });
  }, []);

  const openEditModal = useCallback((notification: FormNotification) => {
    setModalState({ open: true, editing: notification });
  }, []);

  const closeModal = useCallback(() => {
    setModalState({ open: false, editing: null });
  }, []);

  const handleSave = useCallback(
    (notification: FormNotification) => {
      if (modalState.editing) {
        updateNotification(notification.id, notification);
      } else {
        addNotification(notification);
      }
      closeModal();
    },
    [modalState.editing, addNotification, updateNotification, closeModal]
  );

  const getProviderName = useCallback(
    (providerId?: string) => {
      if (!providerId) {
        const def = providers.find(p => p.isDefault);
        return def ? `${def.name} (Default)` : "System Default";
      }
      return providers.find(p => p.id === providerId)?.name ?? "Unknown";
    },
    [providers]
  );

  const initialNotification = modalState.editing ?? createNotification();

  return (
    <div className="form-notifications-tab">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
        <div>
          <h3 className="text-xl font-semibold text-foreground">
            Email Integrations
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure email notifications sent when someone submits this form.
          </p>
        </div>
        <Button type="button" onClick={openAddModal}>
          + Add Integration
        </Button>
      </div>

      {/* List */}
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 mt-6 border-2 border-dashed border-border rounded-md bg-muted/20">
          <div className="flex items-center justify-center w-12 h-12 rounded-md border border-border bg-background mb-4 text-primary">
            <svg
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="Mm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
          <p className="text-base font-medium text-foreground mb-1">
            No email integrations yet
          </p>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
            Add an email integration to notify recipients when someone submits
            this form.
          </p>
          <Button type="button" onClick={openAddModal}>
            + Add Integration
          </Button>
        </div>
      ) : (
        <div className="form-notifications-list">
          {notifications.map(notification => (
            <IntegrationCard
              key={notification.id}
              notification={notification}
              providerName={getProviderName(notification.providerId)}
              onEdit={() => openEditModal(notification)}
              onDelete={() => deleteNotification(notification.id)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalState.open && (
        <IntegrationModal
          initial={initialNotification}
          providers={providers}
          templates={templates}
          fields={fieldList}
          isEditing={!!modalState.editing}
          onSave={handleSave}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}

export default FormNotificationsTab;
