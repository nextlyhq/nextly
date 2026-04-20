"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MethodId = "changePassword" | "forgotPassword" | "resetPassword";

interface MethodDef {
  id: MethodId;
  signature: string;
  description: string;
  color: string;
  fields: FieldDef[];
  note?: string;
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: "text" | "password" | "checkbox";
}

// ---------------------------------------------------------------------------
// Method definitions
// ---------------------------------------------------------------------------

const METHODS: MethodDef[] = [
  {
    id: "forgotPassword",
    signature: "forgotPassword({ email, disableEmail?, expiration? })",
    description:
      "Request a password reset token. Set disableEmail=true to skip sending the email and receive the token directly in the response (useful for testing).",
    color: "#fd7e14",
    note: "Tip: set disableEmail to true to get the token in the response without sending an email.",
    fields: [
      {
        key: "email",
        label: "email",
        placeholder: "user@example.com",
        required: true,
      },
      {
        key: "disableEmail",
        label: "disableEmail",
        placeholder: "true",
        type: "checkbox",
      },
      {
        key: "expiration",
        label: "expiration",
        placeholder: "3600 (seconds, default 1h)",
      },
    ],
  },
  {
    id: "resetPassword",
    signature: "resetPassword({ token, password })",
    description:
      "Reset the password using the token from forgotPassword. After success, you can login with the new password.",
    color: "#6f42c1",
    fields: [
      {
        key: "token",
        label: "token",
        placeholder: "paste-reset-token-here",
        required: true,
      },
      {
        key: "password",
        label: "new password",
        placeholder: "newSecurePassword456!",
        required: true,
        type: "password",
      },
    ],
  },
  {
    id: "changePassword",
    signature: "changePassword({ user: { id }, currentPassword, newPassword })",
    description:
      "Change a user's password when already authenticated. Requires the user ID (from login or session) plus both old and new passwords.",
    color: "#28a745",
    note: "Get the user ID from the login response at /test-users.",
    fields: [
      {
        key: "userId",
        label: "userId",
        placeholder: "user-uuid-here",
        required: true,
      },
      {
        key: "currentPassword",
        label: "current pwd",
        placeholder: "currentPassword123",
        required: true,
        type: "password",
      },
      {
        key: "newPassword",
        label: "new pwd",
        placeholder: "newSecurePassword456!",
        required: true,
        type: "password",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TestAuthPage() {
  const [activeMethod, setActiveMethod] = useState<MethodId | null>(null);
  const [fieldValues, setFieldValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [checkboxValues, setCheckboxValues] = useState<
    Record<string, Record<string, boolean>>
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

  const getCheckbox = (methodId: MethodId, key: string) =>
    checkboxValues[methodId]?.[key] ?? false;

  const setCheckbox = (methodId: MethodId, key: string, value: boolean) => {
    setCheckboxValues(prev => ({
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
      const checks = checkboxValues[method.id] ?? {};

      let body: Record<string, unknown>;

      switch (method.id) {
        case "forgotPassword": {
          body = {
            email: vals["email"]?.trim() ?? "",
            disableEmail: checks["disableEmail"] ?? false,
            ...(vals["expiration"]?.trim() && {
              expiration: Number(vals["expiration"].trim()),
            }),
          };
          break;
        }

        case "resetPassword": {
          body = {
            token: vals["token"]?.trim() ?? "",
            password: vals["password"] ?? "",
          };
          break;
        }

        case "changePassword": {
          body = {
            userId: vals["userId"]?.trim() ?? "",
            currentPassword: vals["currentPassword"] ?? "",
            newPassword: vals["newPassword"] ?? "",
          };
          break;
        }

        default:
          throw new Error(`Unknown method: ${method.id}`);
      }

      const params = new URLSearchParams({ action: method.id });
      const res = await fetch(`/api/test-auth?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Request failed");
      setResponse(json.data);
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
          width: "460px",
          minWidth: "380px",
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
            Direct API — Auth / Passwords
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#6c757d" }}>
            Test the full password reset flow: <strong>forgotPassword</strong> →{" "}
            <strong>resetPassword</strong>, or use{" "}
            <strong>changePassword</strong> when logged in.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#adb5bd" }}>
            Go to{" "}
            <a href="/test-users" style={{ color: "#007bff" }}>
              /test-users
            </a>{" "}
            to login and obtain a user ID.
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
              getCheckbox={key => getCheckbox(method.id, key)}
              setCheckbox={(key, val) => setCheckbox(method.id, key, val)}
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
              <span
                style={{
                  background: "#1e3a5f",
                  color: "#93c5fd",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                  letterSpacing: "0.05em",
                }}
              >
                POST
              </span>
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
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: "16px",
                color: "#4b5563",
              }}
            >
              <div style={{ fontSize: "15px" }}>Response will appear here</div>
              <div
                style={{
                  background: "#262626",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  padding: "16px 20px",
                  maxWidth: "420px",
                  fontSize: "13px",
                  lineHeight: "1.8",
                  color: "#9ca3af",
                }}
              >
                <strong
                  style={{
                    color: "#d1d5db",
                    display: "block",
                    marginBottom: "8px",
                  }}
                >
                  Suggested test flow:
                </strong>
                <ol style={{ margin: 0, paddingLeft: "20px" }}>
                  <li>
                    Run <code style={{ color: "#fbbf24" }}>forgotPassword</code>{" "}
                    with{" "}
                    <code style={{ color: "#86efac" }}>
                      disableEmail = true
                    </code>{" "}
                    — copy the <code style={{ color: "#86efac" }}>token</code>{" "}
                    from the response.
                  </li>
                  <li>
                    Run <code style={{ color: "#fbbf24" }}>resetPassword</code>{" "}
                    with the token + new password.
                  </li>
                  <li>
                    Go to{" "}
                    <a href="/test-users" style={{ color: "#60a5fa" }}>
                      /test-users
                    </a>{" "}
                    and use <code style={{ color: "#fbbf24" }}>login</code> with
                    the new password to verify.
                  </li>
                  <li>
                    Optionally use{" "}
                    <code style={{ color: "#fbbf24" }}>changePassword</code>{" "}
                    with the userId from login to change it again.
                  </li>
                </ol>
              </div>
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

function MethodCard({
  method,
  isActive,
  loading,
  getField,
  setField,
  getCheckbox,
  setCheckbox,
  onRun,
}: {
  method: MethodDef;
  isActive: boolean;
  loading: boolean;
  getField: (key: string) => string;
  setField: (key: string, val: string) => void;
  getCheckbox: (key: string) => boolean;
  setCheckbox: (key: string, val: boolean) => void;
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
          {method.note && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "11px",
                color: "#856404",
                background: "#fff3cd",
                border: "1px solid #ffc107",
                borderRadius: "4px",
                padding: "4px 8px",
                lineHeight: "1.4",
              }}
            >
              {method.note}
            </p>
          )}
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
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <label
                style={{
                  width: "88px",
                  flexShrink: 0,
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#495057",
                  fontFamily: "monospace",
                }}
              >
                {f.label}
                {f.required && <span style={{ color: "#dc3545" }}> *</span>}
              </label>
              {f.type === "checkbox" ? (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer",
                    fontSize: "12px",
                    color: "#495057",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={getCheckbox(f.key)}
                    onChange={e => setCheckbox(f.key, e.target.checked)}
                    style={{ width: "14px", height: "14px", cursor: "pointer" }}
                  />
                  <span>
                    {getCheckbox(f.key)
                      ? "true (skip email)"
                      : "false (send email)"}
                  </span>
                </label>
              ) : (
                <input
                  type={f.type === "password" ? "text" : "text"}
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
