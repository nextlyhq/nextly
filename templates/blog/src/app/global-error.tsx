"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <h2 className="text-2xl font-bold">A critical error occurred</h2>
        <p className="mt-2 text-neutral-600">
          The application crashed at the root level.
        </p>
        <button
          onClick={() => reset()}
          className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Reset Application
        </button>
      </body>
    </html>
  );
}
