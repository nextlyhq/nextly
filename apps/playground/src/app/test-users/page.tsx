"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MethodId =
  | "find"
  | "findOne"
  | "findByID"
  | "create"
  | "update"
  | "delete"
  | "login"
  | "findGlobals";

interface MethodDef {
  id: MethodId;
  signature: string;
  description: string;
  httpMethod: "GET" | "POST" | "DELETE";
  color: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  textarea?: boolean;
}

// ---------------------------------------------------------------------------
// Method definitions
// ---------------------------------------------------------------------------

const METHODS: MethodDef[] = [
  {
    id: "find",
    signature: "users.find(args?)",
    description:
      "List users with optional pagination, search, and sorting. Returns docs[] + pagination.",
    httpMethod: "GET",
    color: "#28a745",
    fields: [
      { key: "limit", label: "limit", placeholder: "10" },
      { key: "page", label: "page", placeholder: "1" },
      {
        key: "search",
        label: "search",
        placeholder: "alice (searches name & email)",
      },
      {
        key: "sortBy",
        label: "sortBy",
        placeholder: "createdAt | name | email",
      },
    ],
  },
  {
    id: "findOne",
    signature: "users.findOne(args?)",
    description:
      "Find the first user matching the given filters. Returns a single user or null.",
    httpMethod: "GET",
    color: "#17a2b8",
    fields: [
      {
        key: "search",
        label: "search",
        placeholder: "alice@example.com (name or email)",
      },
    ],
  },
  {
    id: "findByID",
    signature: "users.findByID({ id })",
    description:
      "Find a specific user by their exact ID. Returns a single user.",
    httpMethod: "GET",
    color: "#007bff",
    fields: [
      {
        key: "id",
        label: "id",
        placeholder: "user-uuid-here",
        required: true,
      },
    ],
  },
  {
    id: "create",
    signature: "users.create({ email, password, data? })",
    description: "Create a new user. email and password are required.",
    httpMethod: "POST",
    color: "#6f42c1",
    fields: [
      {
        key: "email",
        label: "email",
        placeholder: "new@example.com",
        required: true,
      },
      {
        key: "password",
        label: "password",
        placeholder: "secret123",
        required: true,
      },
      {
        key: "data",
        label: "data (JSON)",
        placeholder: '{ "name": "Alice" }',
        textarea: true,
      },
    ],
  },
  {
    id: "update",
    signature: "users.update({ id, data })",
    description:
      "Update an existing user by ID. Provide only the fields to change.",
    httpMethod: "POST",
    color: "#fd7e14",
    fields: [
      {
        key: "id",
        label: "id",
        placeholder: "user-uuid-here",
        required: true,
      },
      {
        key: "data",
        label: "data (JSON)",
        placeholder: '{ "name": "Updated Name" }',
        textarea: true,
        required: true,
      },
    ],
  },
  {
    id: "delete",
    signature: "users.delete({ id })",
    description: "Permanently delete a user by ID.",
    httpMethod: "DELETE",
    color: "#dc3545",
    fields: [
      {
        key: "id",
        label: "id",
        placeholder: "user-uuid-here",
        required: true,
      },
    ],
  },
  {
    id: "findGlobals",
    signature: "findGlobals(args?)",
    description:
      "List all Single/Global type definitions with optional filtering by source, search, and pagination.",
    httpMethod: "GET",
    color: "#20c997",
    fields: [
      {
        key: "source",
        label: "source",
        placeholder: "code | ui | built-in",
      },
      {
        key: "search",
        label: "search",
        placeholder: "settings (slug or label)",
      },
      { key: "limit", label: "limit", placeholder: "20" },
      { key: "offset", label: "offset", placeholder: "0" },
    ],
  },
  {
    id: "login",
    signature: "login({ email, password })",
    description:
      "Authenticate a user and return a signed JWT token compatible with getSession().",
    httpMethod: "POST",
    color: "#e83e8c",
    fields: [
      {
        key: "email",
        label: "email",
        placeholder: "user@example.com",
        required: true,
      },
      {
        key: "password",
        label: "password",
        placeholder: "secret123",
        required: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TestUsersPage() {
  const [activeMethod, setActiveMethod] = useState<MethodId | null>(null);
  const [fieldValues, setFieldValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const getField = (methodId: MethodId, key: string) =>
    fieldValues[methodId]?.[key] ?? "";

  const setField = (methodId: MethodId, key: string, value: string) => {
    setFieldValues(prev => ({
      ...prev,
      [methodId]: { ...(prev[methodId] ?? {}), [key]: value },
    }));
  };

  const runMethod = async (method: MethodDef) => {
    setActiveMethod(method.id);
    setLoading(true);
    setResponse(null);
    setError(null);

    try {
      const vals = fieldValues[method.id] ?? {};

      if (method.httpMethod === "GET") {
        const params = new URLSearchParams({ action: method.id });
        for (const f of method.fields) {
          const v = vals[f.key]?.trim();
          if (v) params.set(f.key, v);
        }
        const res = await fetch(`/api/test-users?${params}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Request failed");
        setResponse(json.data);
      } else if (method.httpMethod === "POST") {
        let body: Record<string, unknown>;

        if (method.id === "create") {
          let parsedData: Record<string, unknown> = {};
          const rawData = vals["data"]?.trim();
          if (rawData) {
            try {
              parsedData = JSON.parse(rawData);
            } catch {
              throw new Error("data field must be valid JSON");
            }
          }
          body = {
            email: vals["email"] ?? "",
            password: vals["password"] ?? "",
            data: parsedData,
          };
        } else if (method.id === "login") {
          body = {
            email: vals["email"] ?? "",
            password: vals["password"] ?? "",
          };
        } else {
          // update
          let parsedData: Record<string, unknown> = {};
          const rawData = vals["data"]?.trim();
          if (rawData) {
            try {
              parsedData = JSON.parse(rawData);
            } catch {
              throw new Error("data field must be valid JSON");
            }
          }
          body = { data: parsedData };
        }

        const idParam = vals["id"]?.trim();
        const params = new URLSearchParams({ action: method.id });
        if (idParam) params.set("id", idParam);

        const res = await fetch(`/api/test-users?${params}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Request failed");
        setResponse(json.data);
      } else if (method.httpMethod === "DELETE") {
        const id = vals["id"]?.trim();
        if (!id) throw new Error("id is required");
        const res = await fetch(
          `/api/test-users?id=${encodeURIComponent(id)}`,
          {
            method: "DELETE",
          }
        );
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Request failed");
        setResponse(json.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const activeMethodDef = METHODS.find(m => m.id === activeMethod);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Left panel — method list                                            */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          width: "420px",
          minWidth: "360px",
          background: "#f8f9fa",
          borderRight: "1px solid #dee2e6",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "20px 20px 12px",
            borderBottom: "1px solid #dee2e6",
            background: "#fff",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
            Direct API — Users
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#6c757d" }}>
            Click Run to invoke a user method and inspect the response.
          </p>
        </div>

        <div
          style={{
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {METHODS.map(method => (
            <MethodCard
              key={method.id}
              method={method}
              isActive={activeMethod === method.id}
              loading={loading && activeMethod === method.id}
              getField={key => getField(method.id, key)}
              setField={(key, val) => setField(method.id, key, val)}
              onRun={() => runMethod(method)}
            />
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Right panel — response                                              */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          background: "#1e1e1e",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #333",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          {activeMethodDef ? (
            <>
              <HttpBadge method={activeMethodDef.httpMethod} />
              <code
                style={{
                  color: "#e2e8f0",
                  fontSize: "14px",
                  fontFamily: "monospace",
                }}
              >
                {activeMethodDef.signature}
              </code>
            </>
          ) : (
            <span style={{ color: "#6c757d", fontSize: "14px" }}>
              Select a method and click Run to see the response
            </span>
          )}

          {loading && (
            <span
              style={{ color: "#ffc107", fontSize: "13px", marginLeft: "auto" }}
            >
              Loading…
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "20px", overflow: "auto" }}>
          {error && (
            <div
              style={{
                background: "#2d1b1b",
                border: "1px solid #8b1a1a",
                borderRadius: "6px",
                padding: "14px 16px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  color: "#f87171",
                  fontWeight: 600,
                  marginBottom: "4px",
                }}
              >
                Error
              </div>
              <div
                style={{
                  color: "#fca5a5",
                  fontSize: "14px",
                  fontFamily: "monospace",
                }}
              >
                {error}
              </div>
            </div>
          )}

          {response !== null && !error && (
            <pre
              style={{
                margin: 0,
                color: "#d4d4d4",
                fontSize: "13px",
                lineHeight: "1.6",
                fontFamily:
                  "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(response, null, 2)}
            </pre>
          )}

          {response === null && !error && !loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#4b5563",
                fontSize: "15px",
              }}
            >
              Response will appear here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HttpBadge({ method }: { method: "GET" | "POST" | "DELETE" }) {
  const colors: Record<string, { bg: string; text: string }> = {
    GET: { bg: "#166534", text: "#86efac" },
    POST: { bg: "#1e3a5f", text: "#93c5fd" },
    DELETE: { bg: "#7f1d1d", text: "#fca5a5" },
  };
  const { bg, text } = colors[method];
  return (
    <span
      style={{
        background: bg,
        color: text,
        fontSize: "11px",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: "4px",
        fontFamily: "monospace",
        letterSpacing: "0.05em",
      }}
    >
      {method}
    </span>
  );
}

function MethodCard({
  method,
  isActive,
  loading,
  getField,
  setField,
  onRun,
}: {
  method: MethodDef;
  isActive: boolean;
  loading: boolean;
  getField: (key: string) => string;
  setField: (key: string, val: string) => void;
  onRun: () => void;
}) {
  return (
    <div
      style={{
        background: "white",
        border: `2px solid ${isActive ? method.color : "#dee2e6"}`,
        borderRadius: "8px",
        padding: "14px 16px",
        transition: "border-color 0.15s",
      }}
    >
      {/* Method header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "10px",
          marginBottom: "8px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <code
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: method.color,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            {method.signature}
          </code>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "12px",
              color: "#6c757d",
              lineHeight: "1.5",
            }}
          >
            {method.description}
          </p>
        </div>

        <button
          onClick={onRun}
          disabled={loading}
          style={{
            flexShrink: 0,
            padding: "6px 14px",
            background: loading ? "#adb5bd" : method.color,
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {/* Input fields */}
      {method.fields.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            borderTop: "1px solid #f0f0f0",
            paddingTop: "10px",
          }}
        >
          {method.fields.map(f => (
            <div
              key={f.key}
              style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}
            >
              <label
                style={{
                  width: "72px",
                  flexShrink: 0,
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#495057",
                  paddingTop: f.textarea ? "6px" : "7px",
                  fontFamily: "monospace",
                }}
              >
                {f.label}
                {f.required && <span style={{ color: "#dc3545" }}> *</span>}
              </label>
              {f.textarea ? (
                <textarea
                  value={getField(f.key)}
                  onChange={e => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={3}
                  style={{
                    flex: 1,
                    fontSize: "12px",
                    padding: "5px 8px",
                    border: "1px solid #ced4da",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    resize: "vertical",
                  }}
                />
              ) : (
                <input
                  type="text"
                  value={getField(f.key)}
                  onChange={e => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  style={{
                    flex: 1,
                    fontSize: "12px",
                    padding: "5px 8px",
                    border: "1px solid #ced4da",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
