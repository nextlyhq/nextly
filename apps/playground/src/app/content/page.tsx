"use client";

import { useState, useEffect } from "react";

type FieldDefinition = {
  name: string;
  type:
    | "string"
    | "text"
    | "number"
    | "decimal"
    | "boolean"
    | "date"
    | "relation";
  required?: boolean;
  unique?: boolean;
  options?: {
    relationType?: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
    target?: string;
    targetLabelField?: string;
  };
};

type Collection = {
  id: string;
  name: string;
  label: string;
  description?: string;
  tableName: string;
  schemaDefinition: {
    fields: FieldDefinition[];
  };
  createdAt: string;
  updatedAt: string;
};

type Entry = {
  id: string;
  [key: string]:
    | string
    | number
    | boolean
    | null
    | Record<string, unknown>
    | Array<Record<string, unknown>>;
};

export default function ContentPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] =
    useState<Collection | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<
    Record<string, string | number | boolean | null | string[]>
  >({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [relatedEntries, setRelatedEntries] = useState<Record<string, Entry[]>>(
    {}
  );

  useEffect(() => {
    // void: useEffect callback intentionally fires-and-forgets the async load.
    void loadCollections();
  }, []);

  const loadCollections = async () => {
    try {
      const response = await fetch("/admin/api/collections");
      const result = await response.json();
      if (Array.isArray(result.items)) {
        setCollections(result.items);
      }
    } catch (error) {
      console.error("Failed to load collections:", error);
    }
  };

  const loadEntries = async (collectionName: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/admin/api/collections/${collectionName}/entries`
      );
      const result = await response.json();
      if (Array.isArray(result.items)) {
        setEntries(result.items);
      } else {
        setEntries([]);
      }
    } catch (error) {
      console.error("Failed to load entries:", error);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCollectionClick = (collection: Collection) => {
    setSelectedCollection(collection);
    setEntries([]);
    setShowForm(false);
    setFormData({});
    setMessage("");
    // void: click handler intentionally fires-and-forgets the async load.
    void loadEntries(collection.name);
  };

  const loadRelatedEntries = async (collectionName: string) => {
    try {
      const response = await fetch(
        `/admin/api/collections/${collectionName}/entries`
      );
      const result = await response.json();
      if (Array.isArray(result.items)) {
        return result.items;
      }
      return [];
    } catch (error) {
      console.error(`Failed to load ${collectionName} entries:`, error);
      return [];
    }
  };

  const handleCreateNew = async () => {
    setShowForm(true);
    setFormData({});
    setMessage("");

    // Load entries for relation fields
    if (selectedCollection) {
      const relationFields = selectedCollection.schemaDefinition.fields.filter(
        f => f.type === "relation" && f.options?.target
      );

      const relatedData: Record<string, Entry[]> = {};
      for (const field of relationFields) {
        if (field.options?.target) {
          const entries = await loadRelatedEntries(field.options.target);
          relatedData[field.options.target] = entries;
        }
      }
      setRelatedEntries(relatedData);
    }
  };

  const handleFieldChange = (
    fieldName: string,
    value: string | string[],
    fieldType: string
  ) => {
    let processedValue: string | number | boolean | null | string[] = value;

    if (fieldType === "number" || fieldType === "decimal") {
      processedValue = value === "" ? null : Number(value);
    } else if (fieldType === "boolean") {
      processedValue = value === "true";
    } else if (fieldType === "date") {
      processedValue = value === "" ? null : value;
    } else if (fieldType === "relation") {
      // Keep as-is (string for oneToOne/manyToOne, string[] for manyToMany)
      processedValue = value;
    }

    setFormData(prev => ({
      ...prev,
      [fieldName]: processedValue,
    }));
  };

  const handleManyToManyToggle = (fieldName: string, entryId: string) => {
    const current = (formData[fieldName] as string[]) || [];
    const updated = current.includes(entryId)
      ? current.filter(id => id !== entryId)
      : [...current, entryId];

    setFormData(prev => ({
      ...prev,
      [fieldName]: updated,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCollection) return;

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/admin/api/collections/${selectedCollection.name}/entries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        }
      );

      const result = await response.json();

      if (response.ok) {
        setMessage("Entry created successfully!");
        setShowForm(false);
        setFormData({});
        // void: post-submit refresh is fire-and-forget; UI already updated.
        void loadEntries(selectedCollection.name);
      } else {
        const message = result?.error?.message ?? "Failed to create entry";
        setMessage(`Error: ${message}`);
      }
    } catch (error) {
      setMessage(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!selectedCollection) return;
    if (!confirm("Are you sure you want to delete this entry?")) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/admin/api/collections/${selectedCollection.name}/entries/${entryId}`,
        {
          method: "DELETE",
        }
      );

      const result = await response.json();

      if (response.ok) {
        setMessage("Entry deleted successfully!");
        // void: post-delete refresh is fire-and-forget; UI already updated.
        void loadEntries(selectedCollection.name);
      } else {
        const message = result?.error?.message ?? "Failed to delete entry";
        setMessage(`Error: ${message}`);
      }
    } catch (error) {
      setMessage(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setLoading(false);
    }
  };

  const renderFormField = (field: FieldDefinition) => {
    const rawValue = formData[field.name];
    const value =
      typeof rawValue === "string" || typeof rawValue === "number"
        ? String(rawValue)
        : "";
    const boolValue =
      typeof rawValue === "boolean" ? (rawValue ? "true" : "false") : "";

    switch (field.type) {
      case "relation":
        return renderRelationField(field);

      case "text":
        return (
          <textarea
            value={value}
            onChange={e =>
              handleFieldChange(field.name, e.target.value, field.type)
            }
            required={field.required}
            style={{
              width: "100%",
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
              minHeight: "100px",
              fontFamily: "inherit",
            }}
          />
        );

      case "boolean":
        return (
          <select
            value={boolValue}
            onChange={e =>
              handleFieldChange(field.name, e.target.value, field.type)
            }
            required={field.required}
            style={{
              width: "100%",
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          >
            <option value="">Select...</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );

      case "date":
        return (
          <input
            type="datetime-local"
            value={value}
            onChange={e =>
              handleFieldChange(field.name, e.target.value, field.type)
            }
            required={field.required}
            style={{
              width: "100%",
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          />
        );

      case "number":
      case "decimal":
        return (
          <input
            type="number"
            step={field.type === "decimal" ? "0.01" : "1"}
            value={value}
            onChange={e =>
              handleFieldChange(field.name, e.target.value, field.type)
            }
            required={field.required}
            style={{
              width: "100%",
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          />
        );

      default: // string
        return (
          <input
            type="text"
            value={value}
            onChange={e =>
              handleFieldChange(field.name, e.target.value, field.type)
            }
            required={field.required}
            style={{
              width: "100%",
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          />
        );
    }
  };

  // Helper function to get the best label for an entry.
  // Only stringifies primitive scalar values to avoid '[object Object]'
  // output on relation/array fields (no-base-to-string).
  const stringifyScalar = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    // Inline typeof checks so TS narrows `v` to a primitive before String().
    if (typeof v === "string") return v;
    if (
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint"
    ) {
      return String(v);
    }
    return null;
  };

  const getEntryLabel = (
    entry: Record<string, unknown>,
    preferredField?: string
  ): string => {
    // If preferred field is specified and exists, use it
    if (preferredField) {
      const preferred = stringifyScalar(entry[preferredField]);
      if (preferred) return preferred;
    }

    // Priority order for label fields
    const labelPriority = [
      "name",
      "title",
      "label",
      "email",
      "slug",
      "username",
    ];

    for (const field of labelPriority) {
      const candidate = stringifyScalar(entry[field]);
      if (candidate) return candidate;
    }

    // Fallback to ID
    return stringifyScalar(entry.id) ?? "Unknown";
  };

  const renderRelationField = (field: FieldDefinition) => {
    const relationType = field.options?.relationType || "manyToOne";
    const targetCollection = field.options?.target;
    const targetLabelField = field.options?.targetLabelField;

    if (!targetCollection) {
      return (
        <div style={{ color: "#999" }}>No target collection specified</div>
      );
    }

    const availableEntries = relatedEntries[targetCollection] || [];

    if (relationType === "manyToMany") {
      // Multi-select checkboxes for many-to-many
      const selectedIds = (formData[field.name] as string[]) || [];

      return (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: "4px",
            padding: "12px",
            maxHeight: "200px",
            overflowY: "auto",
            background: "#f9f9f9",
          }}
        >
          {availableEntries.length === 0 ? (
            <div style={{ color: "#999", fontSize: "14px" }}>
              No {targetCollection} entries available
            </div>
          ) : (
            availableEntries.map(entry => {
              // Extract actual ID from expanded data or use entry.id
              const entryId =
                typeof entry.id === "object" &&
                entry.id !== null &&
                "id" in entry.id
                  ? ((entry.id as Record<string, unknown>).id as string)
                  : entry.id;
              const displayLabel = getEntryLabel(entry, targetLabelField);

              return (
                <label
                  key={entryId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px",
                    cursor: "pointer",
                    borderRadius: "4px",
                    marginBottom: "4px",
                    background: selectedIds.includes(entryId)
                      ? "#e3f2fd"
                      : "white",
                    border: `1px solid ${selectedIds.includes(entryId) ? "#90caf9" : "#ddd"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(entryId)}
                    onChange={() => handleManyToManyToggle(field.name, entryId)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "14px" }}>{displayLabel}</span>
                  {displayLabel !== entryId && (
                    <span style={{ fontSize: "11px", color: "#999" }}>
                      ({entryId})
                    </span>
                  )}
                </label>
              );
            })
          )}
        </div>
      );
    } else {
      // Single select dropdown for oneToOne, manyToOne, oneToMany
      const selectedValue = (formData[field.name] as string) || "";

      return (
        <select
          value={selectedValue}
          onChange={e =>
            handleFieldChange(field.name, e.target.value, field.type)
          }
          required={field.required}
          style={{
            width: "100%",
            padding: "8px",
            border: "1px solid #ddd",
            borderRadius: "4px",
          }}
        >
          <option value="">Select {targetCollection}...</option>
          {availableEntries.map(entry => {
            // Extract actual ID from expanded data or use entry.id
            const entryId =
              typeof entry.id === "object" &&
              entry.id !== null &&
              "id" in entry.id
                ? ((entry.id as Record<string, unknown>).id as string)
                : entry.id;
            const displayLabel = getEntryLabel(entry, targetLabelField);

            return (
              <option key={entryId} value={entryId}>
                {displayLabel}
              </option>
            );
          })}
        </select>
      );
    }
  };

  const formatValue = (
    value:
      | string
      | number
      | boolean
      | null
      | undefined
      | Record<string, unknown>
      | Array<Record<string, unknown>>,
    fieldType: string
  ): React.ReactNode => {
    if (value === null || value === undefined) return "-";

    if (fieldType === "boolean") {
      return value ? "✓" : "✗";
    }

    if (
      fieldType === "date" &&
      (typeof value === "string" || typeof value === "number")
    ) {
      return new Date(value).toLocaleString();
    }

    // Handle relation fields
    if (fieldType === "relation") {
      // Single relation object
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        // Only stringify scalar label/id to avoid '[object Object]'.
        return stringifyScalar(value.label) ?? stringifyScalar(value.id) ?? "-";
      }

      // Many-to-many array of relations
      if (Array.isArray(value)) {
        if (value.length === 0) return "-";
        return value
          .map(v => stringifyScalar(v.label) ?? stringifyScalar(v.id) ?? "")
          .filter(Boolean)
          .join(", ");
      }

      // Fallback - value is a primitive here per the type union.
      return stringifyScalar(value) ?? "-";
    }

    return stringifyScalar(value) ?? "-";
  };

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "20px",
        maxWidth: "1400px",
        margin: "0 auto",
      }}
    >
      <h1
        style={{ marginBottom: "30px", fontSize: "32px", fontWeight: "bold" }}
      >
        Content Management
      </h1>

      <div style={{ display: "flex", gap: "20px" }}>
        {/* Collections Sidebar */}
        <div
          style={{
            width: "300px",
            background: "#f8f9fa",
            padding: "20px",
            borderRadius: "8px",
            height: "fit-content",
          }}
        >
          <h2
            style={{
              fontSize: "20px",
              marginBottom: "15px",
              fontWeight: "600",
            }}
          >
            Collections
          </h2>

          {collections.length === 0 ? (
            <p style={{ color: "#666", fontSize: "14px" }}>
              No collections yet
            </p>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {collections.map(col => (
                <button
                  key={col.id}
                  onClick={() => handleCollectionClick(col)}
                  style={{
                    padding: "12px 16px",
                    background:
                      selectedCollection?.id === col.id ? "#007bff" : "white",
                    color: selectedCollection?.id === col.id ? "white" : "#333",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ fontWeight: "600", marginBottom: "4px" }}>
                    {col.label}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      opacity: selectedCollection?.id === col.id ? 0.9 : 0.6,
                    }}
                  >
                    {col.schemaDefinition.fields.length} fields
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1 }}>
          {!selectedCollection ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                background: "#f8f9fa",
                borderRadius: "8px",
              }}
            >
              <h2
                style={{
                  fontSize: "24px",
                  color: "#666",
                  marginBottom: "10px",
                }}
              >
                Select a collection to manage content
              </h2>
              <p style={{ color: "#999" }}>
                Choose a collection from the sidebar to view and create entries
              </p>
            </div>
          ) : (
            <div>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "20px",
                }}
              >
                <div>
                  <h2
                    style={{
                      fontSize: "28px",
                      fontWeight: "bold",
                      marginBottom: "4px",
                    }}
                  >
                    {selectedCollection.label}
                  </h2>
                  {selectedCollection.description && (
                    <p style={{ color: "#666", fontSize: "14px" }}>
                      {selectedCollection.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    // Wrap async handler so onClick gets a void return.
                    void handleCreateNew();
                  }}
                  disabled={loading}
                  style={{
                    padding: "10px 20px",
                    background: loading ? "#ccc" : "#28a745",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: loading ? "not-allowed" : "pointer",
                    fontWeight: "600",
                  }}
                >
                  Create New
                </button>
              </div>

              {/* Message */}
              {message && (
                <div
                  style={{
                    padding: "12px",
                    background: message.includes("✅") ? "#d4edda" : "#f8d7da",
                    border: `1px solid ${message.includes("✅") ? "#c3e6cb" : "#f5c6cb"}`,
                    borderRadius: "6px",
                    marginBottom: "20px",
                  }}
                >
                  {message}
                </div>
              )}

              {/* Create Form */}
              {showForm && (
                <div
                  style={{
                    background: "white",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    padding: "20px",
                    marginBottom: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "20px",
                    }}
                  >
                    <h3 style={{ fontSize: "20px", fontWeight: "600" }}>
                      Create New Entry
                    </h3>
                    <button
                      onClick={() => setShowForm(false)}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "24px",
                        cursor: "pointer",
                        color: "#999",
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <form
                    onSubmit={e => {
                      // Wrap async handler so onSubmit gets a void return.
                      void handleSubmit(e);
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                      }}
                    >
                      {selectedCollection.schemaDefinition.fields.map(field => (
                        <div key={field.name}>
                          <label
                            style={{
                              display: "block",
                              marginBottom: "6px",
                              fontWeight: "600",
                              fontSize: "14px",
                            }}
                          >
                            {field.name.charAt(0).toUpperCase() +
                              field.name.slice(1)}
                            {field.required && (
                              <span style={{ color: "red" }}> *</span>
                            )}
                            <span
                              style={{
                                marginLeft: "8px",
                                fontSize: "12px",
                                color: "#666",
                                fontWeight: "normal",
                              }}
                            >
                              ({field.type})
                            </span>
                          </label>
                          {renderFormField(field)}
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        marginTop: "20px",
                        display: "flex",
                        gap: "10px",
                      }}
                    >
                      <button
                        type="submit"
                        disabled={loading}
                        style={{
                          padding: "10px 20px",
                          background: loading ? "#ccc" : "#007bff",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          cursor: loading ? "not-allowed" : "pointer",
                          fontWeight: "600",
                        }}
                      >
                        {loading ? "Creating..." : "Create Entry"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowForm(false)}
                        disabled={loading}
                        style={{
                          padding: "10px 20px",
                          background: "white",
                          color: "#333",
                          border: "1px solid #ddd",
                          borderRadius: "6px",
                          cursor: loading ? "not-allowed" : "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Entries Table */}
              <div
                style={{
                  background: "white",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "16px 20px",
                    background: "#f8f9fa",
                    borderBottom: "1px solid #ddd",
                    fontWeight: "600",
                  }}
                >
                  Entries ({entries.length})
                </div>

                {loading && !showForm ? (
                  <div
                    style={{
                      padding: "40px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    Loading entries...
                  </div>
                ) : entries.length === 0 ? (
                  <div
                    style={{
                      padding: "40px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    No entries yet. Click &quot;Create New&quot; to add one.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr style={{ background: "#f8f9fa" }}>
                          {selectedCollection.schemaDefinition.fields.map(
                            field => (
                              <th
                                key={field.name}
                                style={{
                                  padding: "12px",
                                  textAlign: "left",
                                  borderBottom: "2px solid #ddd",
                                  fontWeight: "600",
                                  fontSize: "14px",
                                }}
                              >
                                {field.name.charAt(0).toUpperCase() +
                                  field.name.slice(1)}
                              </th>
                            )
                          )}
                          <th
                            style={{
                              padding: "12px",
                              textAlign: "left",
                              borderBottom: "2px solid #ddd",
                              fontWeight: "600",
                              fontSize: "14px",
                              width: "120px",
                            }}
                          >
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map(entry => (
                          <tr
                            key={entry.id}
                            style={{ borderBottom: "1px solid #eee" }}
                          >
                            {selectedCollection.schemaDefinition.fields.map(
                              field => (
                                <td
                                  key={field.name}
                                  style={{
                                    padding: "12px",
                                    fontSize: "14px",
                                  }}
                                >
                                  {formatValue(entry[field.name], field.type)}
                                </td>
                              )
                            )}
                            <td style={{ padding: "12px" }}>
                              <button
                                onClick={() => {
                                  // Wrap async handler so onClick gets a void return.
                                  void handleDeleteEntry(entry.id);
                                }}
                                disabled={loading}
                                style={{
                                  padding: "6px 12px",
                                  background: loading ? "#ccc" : "#dc3545",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "4px",
                                  cursor: loading ? "not-allowed" : "pointer",
                                  fontSize: "12px",
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
