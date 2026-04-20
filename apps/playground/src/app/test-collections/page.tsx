"use client";

import { useState, useEffect } from "react";

type FieldType =
  | "text"
  | "string"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "email"
  | "password"
  | "richtext"
  | "json"
  | "relation";
type RelationType = "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
type OnDeleteAction = "cascade" | "set null" | "restrict" | "no action";
type OnUpdateAction = "cascade" | "set null" | "restrict" | "no action";

type Field = {
  name: string;
  label?: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  private?: boolean;
  default?: string;
  options?: {
    variant?: "short" | "long";
    format?: "float" | "integer" | "datetime" | "date" | "time";
    relationType?: RelationType;
    target?: string;
    targetLabelField?: string;
    onDelete?: OnDeleteAction;
    onUpdate?: OnUpdateAction;
    junctionTable?: string;
  };
  validation?: {
    minLength?: number;
    maxLength?: number;
    regex?: string;
    min?: number;
    max?: number;
  };
};

type Collection = {
  id: string;
  name: string;
  label: string;
  tableName: string;
  description?: string;
  icon?: string;
  schemaDefinition: {
    fields: Field[];
  };
};

export default function TestCollectionsPage() {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [fields, setFields] = useState<Field[]>([
    { name: "title", type: "string", required: true, unique: false },
  ]);

  // Edit mode state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editFields, setEditFields] = useState<Field[]>([]);

  const [showAdvanced, setShowAdvanced] = useState<Record<number, boolean>>({});
  const [showEditAdvanced, setShowEditAdvanced] = useState<
    Record<number, boolean>
  >({});

  const addField = () => {
    setFields([
      ...fields,
      {
        name: "",
        type: "string",
        required: false,
        unique: false,
        private: false,
      },
    ]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<Field>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    setFields(updated);
  };

  const addEditField = () => {
    setEditFields([
      ...editFields,
      {
        name: "",
        type: "string",
        required: false,
        unique: false,
        private: false,
      },
    ]);
  };

  const removeEditField = (index: number) => {
    setEditFields(editFields.filter((_, i) => i !== index));
  };

  const updateEditField = (index: number, updates: Partial<Field>) => {
    const updated = [...editFields];
    updated[index] = { ...updated[index], ...updates };
    setEditFields(updated);
  };

  const startEdit = (collection: Collection) => {
    setEditingId(collection.id);
    setEditLabel(collection.label);
    setEditDescription(collection.description || "");
    setEditFields([...collection.schemaDefinition.fields]);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
    setEditDescription("");
    setEditFields([]);
    setShowEditAdvanced({});
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const emptyFields = fields.filter(f => !f.name.trim());
    if (emptyFields.length > 0) {
      setMessage("❌ Error: All fields must have a name");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/admin/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          label,
          description: description || undefined,
          fields: fields.map(f => ({
            ...f,
            options:
              Object.keys(f.options || {}).length > 0 ? f.options : undefined,
            validation:
              Object.keys(f.validation || {}).length > 0
                ? f.validation
                : undefined,
          })),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setMessage(
          `✅ ${result.data?.message || "Collection created successfully!"}`
        );
        setName("");
        setLabel("");
        setDescription("");
        setFields([
          { name: "title", type: "string", required: true, unique: false },
        ]);
        setShowAdvanced({});
        loadCollections();
      } else {
        setMessage(
          `Error: ${result.error || result.data?.error || "Failed to create collection"}`
        );
      }
    } catch (error) {
      setMessage(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (collectionName: string) => {
    setLoading(true);
    setMessage("");

    const emptyFields = editFields.filter(f => !f.name.trim());
    if (emptyFields.length > 0) {
      setMessage("Error: All fields must have a name");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/admin/api/collections/${collectionName}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel,
          description: editDescription || undefined,
          fields: editFields.map(f => ({
            ...f,
            options:
              Object.keys(f.options || {}).length > 0 ? f.options : undefined,
            validation:
              Object.keys(f.validation || {}).length > 0
                ? f.validation
                : undefined,
          })),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setMessage(
          `✅ ${result.data?.message || "Collection updated successfully!"}`
        );
        cancelEdit();
        loadCollections();
      } else {
        setMessage(
          `Error: ${result.error || result.data?.error || "Failed to update collection"}`
        );
      }
    } catch (error) {
      setMessage(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (collectionName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the "${collectionName}" collection? This will also delete all its data.`
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/admin/api/collections/${collectionName}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (response.ok) {
        setMessage(`✅ Collection "${collectionName}" deleted successfully!`);
        loadCollections();
      } else {
        setMessage(`Error: ${result.error || "Failed to delete collection"}`);
      }
    } catch (error) {
      setMessage(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setLoading(false);
    }
  };

  const loadCollections = async () => {
    try {
      const response = await fetch("/admin/api/collections");
      const result = await response.json();

      if (result.data?.data) {
        setCollections(result.data.data);
      }
    } catch (error) {
      console.error("Failed to load collections:", error);
    }
  };

  // Load collections on mount
  useEffect(() => {
    loadCollections();
  }, []);

  const renderFieldEditor = (
    field: Field,
    index: number,
    updateFn: (index: number, updates: Partial<Field>) => void,
    removeFn: (index: number) => void,
    fieldsArray: Field[],
    isEdit: boolean = false
  ) => {
    const advancedKey = isEdit ? showEditAdvanced : showAdvanced;
    const setAdvancedKey = isEdit ? setShowEditAdvanced : setShowAdvanced;
    const showAdv = advancedKey[index] || false;

    return (
      <div
        key={index}
        style={{
          padding: "16px",
          border: "1px solid #ddd",
          borderRadius: "6px",
          background: "#f9f9f9",
          marginBottom: "12px",
        }}
      >
        {/* Basic Fields */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 180px 60px 60px 60px 40px",
            gap: "10px",
            marginBottom: "10px",
          }}
        >
          <input
            type="text"
            placeholder="Field Name (e.g., title)"
            value={field.name}
            onChange={e => updateFn(index, { name: e.target.value })}
            style={{
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          />

          <input
            type="text"
            placeholder="Label (e.g., Product Title)"
            value={field.label || ""}
            onChange={e => updateFn(index, { label: e.target.value })}
            style={{
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          />

          <select
            value={field.type}
            onChange={e =>
              updateFn(index, { type: e.target.value as FieldType })
            }
            style={{
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          >
            <option value="string">String</option>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="decimal">Decimal</option>
            <option value="boolean">Boolean</option>
            <option value="date">Date</option>
            <option value="email">Email</option>
            <option value="password">Password</option>
            <option value="richtext">Rich Text</option>
            <option value="json">JSON</option>
            <option value="relation">Relation</option>
          </select>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={field.required}
              onChange={e => updateFn(index, { required: e.target.checked })}
            />
            Required
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={field.unique}
              onChange={e => updateFn(index, { unique: e.target.checked })}
            />
            Unique
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={field.private || false}
              onChange={e => updateFn(index, { private: e.target.checked })}
            />
            Private
          </label>

          <button
            type="button"
            onClick={() => removeFn(index)}
            disabled={fieldsArray.length === 1}
            style={{
              padding: "8px",
              background: fieldsArray.length === 1 ? "#ccc" : "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: fieldsArray.length === 1 ? "not-allowed" : "pointer",
            }}
          >
            ×
          </button>
        </div>

        {/* Advanced Options Toggle */}
        <button
          type="button"
          onClick={() => setAdvancedKey({ ...advancedKey, [index]: !showAdv })}
          style={{
            padding: "6px 12px",
            background: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
            marginBottom: showAdv ? "10px" : "0",
          }}
        >
          {showAdv ? "Hide" : "Show"} Advanced Options
        </button>

        {/* Advanced Options */}
        {showAdv && (
          <div
            style={{
              marginTop: "10px",
              padding: "12px",
              background: "white",
              borderRadius: "4px",
              border: "1px solid #ddd",
            }}
          >
            {/* Default Value */}
            <div style={{ marginBottom: "10px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                Default Value
              </label>
              <input
                type="text"
                placeholder="Default value"
                value={field.default || ""}
                onChange={e => updateFn(index, { default: e.target.value })}
                style={{
                  width: "100%",
                  padding: "6px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                }}
              />
            </div>

            {/* Options based on type */}
            {field.type === "text" && (
              <div style={{ marginBottom: "10px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "4px",
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  Text Variant
                </label>
                <select
                  value={field.options?.variant || "long"}
                  onChange={e =>
                    updateFn(index, {
                      options: {
                        ...field.options,
                        variant: e.target.value as "short" | "long",
                      },
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "6px",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                >
                  <option value="short">Short (VARCHAR)</option>
                  <option value="long">Long (TEXT)</option>
                </select>
              </div>
            )}

            {field.type === "number" && (
              <div style={{ marginBottom: "10px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "4px",
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  Number Format
                </label>
                <select
                  value={field.options?.format || "integer"}
                  onChange={e =>
                    updateFn(index, {
                      options: {
                        ...field.options,
                        format: e.target.value as "integer" | "float",
                      },
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "6px",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                >
                  <option value="integer">Integer</option>
                  <option value="float">Float (Decimal)</option>
                </select>
              </div>
            )}

            {field.type === "date" && (
              <div style={{ marginBottom: "10px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "4px",
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  Date Format
                </label>
                <select
                  value={field.options?.format || "datetime"}
                  onChange={e =>
                    updateFn(index, {
                      options: {
                        ...field.options,
                        format: e.target.value as "datetime" | "date" | "time",
                      },
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "6px",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                >
                  <option value="datetime">Date & Time</option>
                  <option value="date">Date Only</option>
                  <option value="time">Time Only</option>
                </select>
              </div>
            )}

            {field.type === "relation" && (
              <>
                <div style={{ marginBottom: "10px" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    Relation Type *
                  </label>
                  <select
                    value={field.options?.relationType || "manyToOne"}
                    onChange={e =>
                      updateFn(index, {
                        options: {
                          ...field.options,
                          relationType: e.target.value as RelationType,
                        },
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  >
                    <option value="oneToOne">One-to-One</option>
                    <option value="oneToMany">One-to-Many</option>
                    <option value="manyToOne">Many-to-One (default)</option>
                    <option value="manyToMany">Many-to-Many</option>
                  </select>
                  <small style={{ color: "#666", fontSize: "11px" }}>
                    {field.options?.relationType === "oneToOne" &&
                      "Each record relates to exactly one other record"}
                    {field.options?.relationType === "oneToMany" &&
                      "One record can have many related records"}
                    {(!field.options?.relationType ||
                      field.options?.relationType === "manyToOne") &&
                      "Many records can relate to one record (most common)"}
                    {field.options?.relationType === "manyToMany" &&
                      "Creates a junction table for many-to-many relationships"}
                  </small>
                </div>
                <div style={{ marginBottom: "10px" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    Target Collection *
                  </label>
                  <select
                    value={field.options?.target || ""}
                    onChange={e =>
                      updateFn(index, {
                        options: { ...field.options, target: e.target.value },
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      background: "white",
                    }}
                  >
                    <option value="">Select a collection...</option>
                    {collections.map(col => (
                      <option key={col.id} value={col.name}>
                        {col.label} ({col.name})
                      </option>
                    ))}
                  </select>
                  <small style={{ color: "#666", fontSize: "11px" }}>
                    Select which collection this field relates to
                  </small>
                </div>
                <div style={{ marginBottom: "10px" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    Target Label Field
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., name, title"
                    value={field.options?.targetLabelField || ""}
                    onChange={e =>
                      updateFn(index, {
                        options: {
                          ...field.options,
                          targetLabelField: e.target.value,
                        },
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  />
                  <small style={{ color: "#666", fontSize: "11px" }}>
                    Field to display in UI (optional)
                  </small>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      On Delete
                    </label>
                    <select
                      value={field.options?.onDelete || "set null"}
                      onChange={e =>
                        updateFn(index, {
                          options: {
                            ...field.options,
                            onDelete: e.target.value as OnDeleteAction,
                          },
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    >
                      <option value="cascade">Cascade</option>
                      <option value="set null">Set Null (default)</option>
                      <option value="restrict">Restrict</option>
                      <option value="no action">No Action</option>
                    </select>
                    <small style={{ color: "#666", fontSize: "11px" }}>
                      What happens when target is deleted
                    </small>
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      On Update
                    </label>
                    <select
                      value={field.options?.onUpdate || "no action"}
                      onChange={e =>
                        updateFn(index, {
                          options: {
                            ...field.options,
                            onUpdate: e.target.value as OnUpdateAction,
                          },
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    >
                      <option value="cascade">Cascade</option>
                      <option value="set null">Set Null</option>
                      <option value="restrict">Restrict</option>
                      <option value="no action">No Action (default)</option>
                    </select>
                    <small style={{ color: "#666", fontSize: "11px" }}>
                      What happens when target ID changes
                    </small>
                  </div>
                </div>

                {field.options?.relationType === "manyToMany" && (
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      Junction Table Name (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-generated if empty"
                      value={field.options?.junctionTable || ""}
                      onChange={e =>
                        updateFn(index, {
                          options: {
                            ...field.options,
                            junctionTable: e.target.value,
                          },
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    />
                    <small style={{ color: "#666", fontSize: "11px" }}>
                      Custom name for the join table (auto-generated if empty)
                    </small>
                  </div>
                )}

                <div
                  style={{
                    marginTop: "10px",
                    padding: "10px",
                    background: "#e7f3ff",
                    border: "1px solid #b3d9ff",
                    borderRadius: "4px",
                    fontSize: "12px",
                  }}
                >
                  <strong>💡 Tips:</strong>
                  <ul style={{ margin: "5px 0", paddingLeft: "20px" }}>
                    {field.options?.relationType === "oneToOne" && (
                      <li>
                        Enable &quot;Unique&quot; checkbox for one-to-one
                        relationships
                      </li>
                    )}
                    {field.options?.relationType === "manyToMany" && (
                      <li>
                        Many-to-many creates a junction table automatically
                      </li>
                    )}
                    <li>
                      Use &quot;cascade&quot; to auto-delete when parent is
                      removed
                    </li>
                    <li>
                      Use &quot;set null&quot; to keep record but clear the
                      reference
                    </li>
                  </ul>
                </div>
              </>
            )}

            {/* Validation Options */}
            {(field.type === "string" ||
              field.type === "text" ||
              field.type === "email" ||
              field.type === "password") && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      Min Length
                    </label>
                    <input
                      type="number"
                      placeholder="Min length"
                      value={field.validation?.minLength || ""}
                      onChange={e =>
                        updateFn(index, {
                          validation: {
                            ...field.validation,
                            minLength: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          },
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      Max Length
                    </label>
                    <input
                      type="number"
                      placeholder="Max length"
                      value={field.validation?.maxLength || ""}
                      onChange={e =>
                        updateFn(index, {
                          validation: {
                            ...field.validation,
                            maxLength: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          },
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    Regex Pattern
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., ^[A-Za-z0-9]+$"
                    value={field.validation?.regex || ""}
                    onChange={e =>
                      updateFn(index, {
                        validation: {
                          ...field.validation,
                          regex: e.target.value,
                        },
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </>
            )}

            {(field.type === "number" || field.type === "decimal") && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    Min Value
                  </label>
                  <input
                    type="number"
                    placeholder="Min value"
                    value={field.validation?.min ?? ""}
                    onChange={e =>
                      updateFn(index, {
                        validation: {
                          ...field.validation,
                          min: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    Max Value
                  </label>
                  <input
                    type="number"
                    placeholder="Max value"
                    value={field.validation?.max ?? ""}
                    onChange={e =>
                      updateFn(index, {
                        validation: {
                          ...field.validation,
                          max: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "20px",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <h1
        style={{ marginBottom: "30px", fontSize: "32px", fontWeight: "bold" }}
      >
        Test Dynamic Collections
      </h1>

      <button
        onClick={loadCollections}
        style={{
          marginBottom: "20px",
          padding: "10px 20px",
          background: "#17a2b8",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          fontWeight: "600",
        }}
      >
        Reload Collections
      </button>

      {message && (
        <div
          style={{
            padding: "12px",
            marginBottom: "20px",
            background: message.includes("✅") ? "#d4edda" : "#f8d7da",
            border: `1px solid ${message.includes("✅") ? "#c3e6cb" : "#f5c6cb"}`,
            borderRadius: "6px",
            color: message.includes("✅") ? "#155724" : "#721c24",
          }}
        >
          {message}
        </div>
      )}

      {/* Create Collection Form */}
      <div
        style={{
          background: "white",
          padding: "24px",
          borderRadius: "8px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          marginBottom: "30px",
        }}
      >
        <h2
          style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px" }}
        >
          Create New Collection
        </h2>

        <form onSubmit={handleCreate}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "5px",
                  fontWeight: "bold",
                  fontSize: "14px",
                }}
              >
                Collection Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="e.g., products"
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              />
              <small style={{ color: "#666" }}>
                lowercase, e.g., &quot;products&quot;
              </small>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "5px",
                  fontWeight: "bold",
                  fontSize: "14px",
                }}
              >
                Label *
              </label>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                required
                placeholder="e.g., Products"
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              />
              <small style={{ color: "#666" }}>
                display name, e.g., &quot;Products&quot;
              </small>
            </div>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "5px",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <label style={{ fontWeight: "bold", fontSize: "16px" }}>
                Fields
              </label>
              <button
                type="button"
                onClick={addField}
                style={{
                  padding: "8px 16px",
                  background: "#28a745",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "600",
                }}
              >
                + Add Field
              </button>
            </div>

            {fields.map((field, index) =>
              renderFieldEditor(
                field,
                index,
                updateField,
                removeField,
                fields,
                false
              )
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "12px 24px",
              background: loading ? "#ccc" : "#007bff",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: "600",
              fontSize: "16px",
            }}
          >
            {loading ? "Creating..." : "Create Collection"}
          </button>
        </form>
      </div>

      {/* Collections List */}
      <div>
        <h2
          style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}
        >
          Existing Collections ({collections.length})
        </h2>

        {collections.length === 0 ? (
          <p style={{ color: "#666" }}>No collections yet. Create one above!</p>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {collections.map(col => (
              <div
                key={col.id}
                style={{
                  background: "white",
                  padding: "20px",
                  borderRadius: "8px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                }}
              >
                {editingId === col.id ? (
                  /* Edit Mode */
                  <>
                    <div style={{ marginBottom: "16px" }}>
                      <input
                        type="text"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "10px",
                          fontSize: "18px",
                          fontWeight: "bold",
                          border: "1px solid #ddd",
                          borderRadius: "4px",
                          marginBottom: "8px",
                        }}
                      />
                      <textarea
                        value={editDescription}
                        onChange={e => setEditDescription(e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        style={{
                          width: "100%",
                          padding: "8px",
                          border: "1px solid #ddd",
                          borderRadius: "4px",
                          fontFamily: "inherit",
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "12px",
                        }}
                      >
                        <label style={{ fontWeight: "bold" }}>Fields</label>
                        <button
                          onClick={addEditField}
                          style={{
                            padding: "6px 12px",
                            background: "#28a745",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "13px",
                          }}
                        >
                          + Add Field
                        </button>
                      </div>

                      {editFields.map((field, index) =>
                        renderFieldEditor(
                          field,
                          index,
                          updateEditField,
                          removeEditField,
                          editFields,
                          true
                        )
                      )}

                      <div
                        style={{
                          fontSize: "13px",
                          padding: "10px",
                          background: "#fff3cd",
                          border: "1px solid #ffc107",
                          borderRadius: "4px",
                          marginTop: "10px",
                        }}
                      >
                        <strong>Important:</strong> Database changes apply
                        immediately, but restart the app to reload TypeScript
                        types.
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        onClick={() => handleUpdate(col.name)}
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
                        {loading ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        onClick={cancelEdit}
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
                  </>
                ) : (
                  /* View Mode */
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "12px",
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            fontSize: "20px",
                            fontWeight: "bold",
                            marginBottom: "4px",
                          }}
                        >
                          {col.label}
                        </h3>
                        <div
                          style={{
                            fontSize: "13px",
                            color: "#666",
                            marginBottom: "4px",
                          }}
                        >
                          <code
                            style={{
                              background: "#f4f4f4",
                              padding: "2px 6px",
                              borderRadius: "3px",
                            }}
                          >
                            {col.tableName}
                          </code>
                        </div>
                        {col.description && (
                          <div
                            style={{
                              fontSize: "14px",
                              color: "#495057",
                              marginTop: "8px",
                              fontStyle: "italic",
                            }}
                          >
                            &quot;{col.description}&quot;
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => startEdit(col)}
                          style={{
                            padding: "8px 16px",
                            background: "#ffc107",
                            color: "#000",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "600",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(col.name)}
                          style={{
                            padding: "8px 16px",
                            background: "#dc3545",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "600",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div>
                      <strong style={{ fontSize: "14px" }}>
                        Fields ({col.schemaDefinition.fields.length}):
                      </strong>
                      <div
                        style={{
                          marginTop: "8px",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                        }}
                      >
                        {col.schemaDefinition.fields.map(field => (
                          <span
                            key={field.name}
                            style={{
                              padding: "6px 12px",
                              background:
                                field.type === "relation"
                                  ? "#e3f2fd"
                                  : "#e9ecef",
                              borderRadius: "16px",
                              fontSize: "13px",
                              border:
                                field.type === "relation"
                                  ? "1px solid #90caf9"
                                  : "1px solid #dee2e6",
                            }}
                          >
                            <strong>{field.label || field.name}</strong>{" "}
                            <code
                              style={{
                                background: "#fff",
                                padding: "2px 6px",
                                borderRadius: "3px",
                                fontSize: "11px",
                              }}
                            >
                              {field.type}
                            </code>
                            {field.type === "relation" &&
                              field.options?.relationType && (
                                <span
                                  style={{ fontSize: "10px", color: "#1976d2" }}
                                >
                                  {" "}
                                  ({field.options.relationType} →{" "}
                                  {field.options.target})
                                </span>
                              )}
                            {field.required && (
                              <span style={{ color: "#dc3545" }}> *</span>
                            )}
                            {field.unique && (
                              <span style={{ color: "#17a2b8" }}> U</span>
                            )}
                            {field.private && (
                              <span style={{ color: "#6c757d" }}> 🔒</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
