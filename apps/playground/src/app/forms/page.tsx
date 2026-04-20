"use client";

/**
 * Forms Demo Page
 *
 * Demonstrates the Form Builder plugin end-to-end:
 * 1. Fetching forms from the API
 * 2. Rendering forms dynamically
 * 3. Submitting form data
 * 4. Displaying success/error states
 */

import { useCallback, useEffect, useState } from "react";

// ============================================================================
// Types
// ============================================================================

interface FormField {
  type: string;
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  rows?: number;
  countryField?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

interface Form {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status?: "draft" | "published" | "closed"; // Optional since public API only returns published
  fields: FormField[];
  settings?: {
    submitButtonText?: string;
    successMessage?: string;
    confirmationType?: string;
    redirectUrl?: string;
  };
  closedMessage?: string;
}

// ============================================================================
// Country/State Data (subset for demo)
// ============================================================================

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "JP", name: "Japan" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "PK", name: "Pakistan" },
];

const STATES: Record<string, Array<{ code: string; name: string }>> = {
  US: [
    { code: "CA", name: "California" },
    { code: "NY", name: "New York" },
    { code: "TX", name: "Texas" },
    { code: "FL", name: "Florida" },
    { code: "WA", name: "Washington" },
  ],
  CA: [
    { code: "ON", name: "Ontario" },
    { code: "QC", name: "Quebec" },
    { code: "BC", name: "British Columbia" },
    { code: "AB", name: "Alberta" },
  ],
  PK: [
    { code: "PB", name: "Punjab" },
    { code: "SD", name: "Sindh" },
    { code: "KP", name: "Khyber Pakhtunkhwa" },
    { code: "BL", name: "Balochistan" },
  ],
};

// ============================================================================
// Form Field Renderer
// ============================================================================

interface FieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  formData: Record<string, unknown>;
  error?: string;
}

function FieldRenderer({
  field,
  value,
  onChange,
  formData,
  error,
}: FieldRendererProps) {
  const inputClassName = `w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    error ? "border-red-500" : "border-gray-300"
  }`;

  switch (field.type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input
            type={field.type === "phone" ? "tel" : field.type}
            name={field.name}
            value={(value as string) || ""}
            onChange={e => onChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            className={inputClassName}
            minLength={field.validation?.minLength}
            maxLength={field.validation?.maxLength}
          />
          {field.helpText && (
            <p className="mt-1 text-sm text-gray-500">{field.helpText}</p>
          )}
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "number":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input
            type="number"
            name={field.name}
            value={(value as number) ?? ""}
            onChange={e => onChange(field.name, e.target.valueAsNumber || "")}
            placeholder={field.placeholder}
            required={field.required}
            className={inputClassName}
            min={field.validation?.min}
            max={field.validation?.max}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "textarea":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <textarea
            name={field.name}
            value={(value as string) || ""}
            onChange={e => onChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            className={inputClassName}
            rows={field.rows || 4}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "select":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <select
            name={field.name}
            value={(value as string) || ""}
            onChange={e => onChange(field.name, e.target.value)}
            required={field.required}
            className={inputClassName}
          >
            <option value="">Select an option...</option>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "checkbox":
      return (
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name={field.name}
              checked={(value as boolean) || false}
              onChange={e => onChange(field.name, e.target.checked)}
              required={field.required}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </span>
          </label>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "checkbox-group":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <div className="space-y-2">
            {field.options?.map(opt => {
              const values = (value as string[]) || [];
              return (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={values.includes(opt.value)}
                    onChange={e => {
                      if (e.target.checked) {
                        onChange(field.name, [...values, opt.value]);
                      } else {
                        onChange(
                          field.name,
                          values.filter(v => v !== opt.value)
                        );
                      }
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              );
            })}
          </div>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "radio":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <div className="space-y-2">
            {field.options?.map(opt => (
              <label
                key={opt.value}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name={field.name}
                  value={opt.value}
                  checked={(value as string) === opt.value}
                  onChange={e => onChange(field.name, e.target.value)}
                  required={field.required}
                  className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "date":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input
            type="date"
            name={field.name}
            value={(value as string) || ""}
            onChange={e => onChange(field.name, e.target.value)}
            required={field.required}
            className={inputClassName}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "country":
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <select
            name={field.name}
            value={(value as string) || ""}
            onChange={e => onChange(field.name, e.target.value)}
            required={field.required}
            className={inputClassName}
          >
            <option value="">Select a country...</option>
            {COUNTRIES.map(country => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    case "state":
      const countryValue = field.countryField
        ? (formData[field.countryField] as string)
        : "";
      const states = countryValue ? STATES[countryValue] || [] : [];

      if (states.length === 0) {
        return null; // Hide state field if no states for selected country
      }

      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <select
            name={field.name}
            value={(value as string) || ""}
            onChange={e => onChange(field.name, e.target.value)}
            required={field.required}
            className={inputClassName}
          >
            <option value="">Select a state...</option>
            {states.map(state => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      );

    default:
      return (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-700">
            Unsupported field type: {field.type} ({field.name})
          </p>
        </div>
      );
  }
}

// ============================================================================
// Form Component
// ============================================================================

interface FormRendererProps {
  form: Form;
  onSuccess?: () => void;
}

function FormRenderer({ form, onSuccess }: FormRendererProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleChange = useCallback((name: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitResult(null);
    setErrors({});

    // Basic validation
    const newErrors: Record<string, string> = {};
    for (const field of form.fields) {
      if (field.required) {
        const value = formData[field.name];
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
          newErrors[field.name] = `${field.label} is required`;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      // Use the unified admin API endpoint for form submissions
      const response = await fetch(`/admin/api/forms/${form.slug}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: formData,
        }),
      });

      const response_data = await response.json();
      // Handle unified API response format: { data: { success, message, ... } }
      const result = response_data.data || response_data;

      if (response.ok && result.success) {
        setSubmitResult({ success: true, message: result.message });
        setFormData({});
        onSuccess?.();
      } else {
        // Handle validation errors
        if (result.errors) {
          setErrors(result.errors);
          setSubmitResult({
            success: false,
            message: "Please fix the errors below",
          });
        } else {
          setSubmitResult({
            success: false,
            message: result.message || result.error || "Failed to submit form",
          });
        }
      }
    } catch (error) {
      setSubmitResult({
        success: false,
        message: "An error occurred while submitting the form",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Note: Public API only returns published forms, so this check is mainly for
  // when using the admin API directly or if status is included in the response
  if (form.status === "closed") {
    return (
      <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
        <p className="text-gray-600">
          {form.closedMessage ||
            "This form is no longer accepting submissions."}
        </p>
      </div>
    );
  }

  if (submitResult?.success) {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center">
        <div className="text-4xl mb-3">✓</div>
        <h3 className="text-lg font-semibold text-green-800 mb-2">Success!</h3>
        <p className="text-green-700">{submitResult.message}</p>
        <button
          type="button"
          onClick={() => setSubmitResult(null)}
          className="mt-4 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          Submit Another Response
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {submitResult && !submitResult.success && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{submitResult.message}</p>
        </div>
      )}

      {form.fields.map(field => (
        <FieldRenderer
          key={field.name}
          field={field}
          value={formData[field.name]}
          onChange={handleChange}
          formData={formData}
          error={errors[field.name]}
        />
      ))}

      <div className="mt-6">
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3 px-4 rounded-lg font-medium text-white transition-colors ${
            isSubmitting
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {isSubmitting
            ? "Submitting..."
            : form.settings?.submitButtonText || "Submit"}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Forms List Component
// ============================================================================

interface FormsListProps {
  forms: Form[];
  selectedForm: Form | null;
  onSelectForm: (form: Form) => void;
}

function FormsList({ forms, selectedForm, onSelectForm }: FormsListProps) {
  return (
    <div className="space-y-2">
      {forms.map(form => (
        <button
          key={form.id}
          onClick={() => onSelectForm(form)}
          className={`w-full text-left p-4 rounded-lg border transition-colors ${
            selectedForm?.id === form.id
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">{form.name}</h3>
              <p className="text-sm text-gray-500">/{form.slug}</p>
            </div>
            {form.status && (
              <span
                className={`px-2 py-1 text-xs rounded-full ${
                  form.status === "published"
                    ? "bg-green-100 text-green-700"
                    : form.status === "draft"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-700"
                }`}
              >
                {form.status}
              </span>
            )}
          </div>
          {form.description && (
            <p className="mt-1 text-sm text-gray-500">{form.description}</p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            {form.fields.length} field{form.fields.length !== 1 ? "s" : ""}
          </p>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function FormsPage() {
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);

  const fetchForms = useCallback(async () => {
    try {
      setIsLoading(true);
      // Use the unified admin API endpoint
      const response = await fetch("/admin/api/forms");
      if (response.ok) {
        const result = await response.json();
        // Handle the unified API response format
        const data = result.data;
        if (data?.success) {
          setForms(data.data?.docs || []);
          setError(null);
        } else {
          setError(data?.message || "Failed to fetch forms");
        }
      } else {
        setError("Failed to fetch forms");
      }
    } catch (err) {
      setError("Failed to connect to API");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const seedForms = async () => {
    setIsSeeding(true);
    try {
      // Create demo forms via admin API
      const contactForm = {
        name: "Contact Us",
        slug: "contact",
        status: "published",
        description: "Get in touch with us",
        fields: [
          { type: "text", name: "name", label: "Name", required: true },
          { type: "email", name: "email", label: "Email", required: true },
          {
            type: "textarea",
            name: "message",
            label: "Message",
            required: true,
            rows: 4,
          },
        ],
        settings: {
          submitButtonText: "Send Message",
          successMessage: "Thank you for contacting us!",
        },
      };

      await fetch("/admin/api/collections/forms/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });

      await fetchForms();
    } catch (err) {
      console.error("Failed to seed forms:", err);
    } finally {
      setIsSeeding(false);
    }
  };

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Form Builder Demo
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Test the form builder plugin with Contact and Register forms
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={seedForms}
                disabled={isSeeding}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isSeeding
                    ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {isSeeding ? "Creating..." : "Create Demo Forms"}
              </button>
              <a
                href="/admin/collections/forms"
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Open Admin
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
            <p className="mt-2 text-gray-500">Loading forms...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={fetchForms}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : forms.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <div className="text-4xl mb-3">📋</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No Forms Found
            </h2>
            <p className="text-gray-500 mb-4">
              Click the button below to create demo Contact and Register forms.
            </p>
            <button
              onClick={seedForms}
              disabled={isSeeding}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              {isSeeding ? "Creating Forms..." : "Create Demo Forms"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Forms List */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Available Forms ({forms.length})
                </h2>
                <FormsList
                  forms={forms}
                  selectedForm={selectedForm}
                  onSelectForm={setSelectedForm}
                />
              </div>
            </div>

            {/* Selected Form */}
            <div className="lg:col-span-2">
              {selectedForm ? (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <div className="mb-6 pb-4 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-900">
                      {selectedForm.name}
                    </h2>
                    {selectedForm.description && (
                      <p className="mt-1 text-gray-500">
                        {selectedForm.description}
                      </p>
                    )}
                  </div>
                  <FormRenderer form={selectedForm} />
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                  <div className="text-4xl mb-3">👈</div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Select a Form
                  </h2>
                  <p className="text-gray-500">
                    Choose a form from the list to preview and test it.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submissions Section */}
        {forms.length > 0 && (
          <div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                View Submissions
              </h2>
              <a
                href="/admin/collections/form-submissions"
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                View All in Admin →
              </a>
            </div>
            <p className="text-gray-500 text-sm">
              After submitting forms above, you can view all submissions in the
              admin panel. Each submission includes the form data, timestamp,
              and status.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <p>Form Builder Plugin Demo - Nextly CMS</p>
            <div className="flex gap-4">
              <a href="/admin" className="hover:text-gray-700">
                Admin Panel
              </a>
              <a href="/" className="hover:text-gray-700">
                Home
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
