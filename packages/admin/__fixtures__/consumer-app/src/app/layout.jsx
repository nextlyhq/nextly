/** The root layout every Next.js app needs, and nothing else. */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
