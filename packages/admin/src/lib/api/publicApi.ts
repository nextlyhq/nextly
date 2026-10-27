import { fetcher } from "./fetcher";

export const publicApi = {
  get: <T>(path: string, options = {}): Promise<T> =>
    fetcher<T>(path, options, false),
  post: <T>(path: string, body: unknown, options = {}): Promise<T> =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
      false
    ),
};
