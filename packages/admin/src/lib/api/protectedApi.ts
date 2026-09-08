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
  // PUT, for a write whose result depends only on the body and not on how many
  // times it is sent. The rolling autosave row is the case that needed it: the
  // same snapshot sent twice must leave one recovery point, not two.
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
        // Whether a body was SUPPLIED, not whether it is truthy. `false`, `0`,
        // `""` and `null` are all valid JSON a caller may mean to send, and a
        // truthiness test dropped every one of them — so `delete` was the one
        // verb that silently disagreed with what the caller passed it. Measured
        // when this changed: no caller passes a body at all, so nothing that
        // exists today sends one where it did not before.
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      true
    ),
};
