import { toDbError, type DbErrorKind } from "@nextly/database/errors";
import { env } from "@nextly/lib/env";

type ServiceErrorResult = {
  success: false;
  statusCode: number;
  message: string;
  data: null;
};

export type MessageOverrides = Partial<
  Record<DbErrorKind | "constraint", string>
> & {
  defaultMessage: string;
};

export function mapKindToStatus(kind: DbErrorKind): number {
  switch (kind) {
    case "unique-violation":
      return 409;
    case "fk-violation":
      return 409;
    case "not-null-violation":
      return 400;
    case "syntax":
      return 400;
    case "timeout":
      return 503;
    case "deadlock":
    case "serialization-failure":
    case "connection-lost":
      return 503;
    case "constraint":
      return 409;
    case "internal":
    default:
      return 500;
  }
}

function selectMessage(
  kind: DbErrorKind,
  overrides: MessageOverrides,
  fallback: string
): string {
  return (
    overrides[kind] ||
    (kind === "constraint" ? overrides["constraint"] : undefined) ||
    overrides.defaultMessage ||
    fallback
  );
}

export function mapDbErrorToServiceError(
  error: unknown,
  messages: MessageOverrides
): ServiceErrorResult {
  const dbErr = toDbError(env.DB_DIALECT, error);
  const statusCode = mapKindToStatus(dbErr.kind);
  let message = selectMessage(
    dbErr.kind,
    messages,
    dbErr.message || messages.defaultMessage
  );

  // For not-null violations, include the original DB error message which
  // contains the column name. "Missing required field" alone is unhelpful
  // for debugging. The DB error message says something like:
  // "NOT NULL constraint failed: dc_authors.title"
  if (dbErr.kind === "not-null-violation" && dbErr.message) {
    // Extract column name from DB error message if possible
    // SQLite: "NOT NULL constraint failed: table.column"
    // PostgreSQL: 'null value in column "column" violates not-null constraint'
    const columnMatch =
      dbErr.message.match(/\.(\w+)$/) || // SQLite: table.column
      dbErr.message.match(/column "(\w+)"/); // PostgreSQL
    if (columnMatch) {
      message = `${message}: "${columnMatch[1]}" cannot be empty`;
    } else {
      message = `${message} (${dbErr.message})`;
    }
  }

  // In development, include the actual error for debugging
  if (process.env.NODE_ENV === "development" && dbErr.kind === "internal") {
    const originalError =
      error instanceof Error ? error.message : String(error);
    message = `${message} (Dev: ${originalError})`;
  }

  return {
    success: false,
    statusCode,
    message,
    data: null,
  };
}
