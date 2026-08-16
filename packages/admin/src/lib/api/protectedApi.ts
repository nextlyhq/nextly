import { fetcher } from "./fetcher";

export const protectedApi = {
  get: <T>(path: string, options = {}) => fetcher<T>(path, options, true),
  post: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
      true
    ),
  // For writes that replace a resource outright, where repeating the request
  // leaves the same single row rather than adding another.
  put: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "PUT",
        body: JSON.stringify(body),
      },
      true
    ),
  patch: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "PATCH",
        body: JSON.stringify(body),
      },
      true
    ),
  delete: <T>(path: string, body?: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "DELETE",
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      true
    ),
};
