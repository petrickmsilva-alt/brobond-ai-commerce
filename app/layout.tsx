import type { Metadata } from "next";
import { APP_DESCRIPTION } from "@/lib/constants";
import "@/styles/globals.css";

/**
 * Global metadata — browser-tab brand signature.
 *
 * `title.template` is inherited by EVERY nested segment that exports a plain
 * `title` string, so a page only declares what it is ("Conectores",
 * "Mercado Livre — Conectores", "TikTok Shop") and Next.js appends the brand
 * automatically. No screen can ship an unbranded tab, and no page has to
 * repeat the brand by hand (which would render it twice).
 *
 * `title.default` covers the segments that export no title at all — the
 * landing page and the error / not-found boundaries.
 *
 * Note: a nested page that needs to opt out would have to use
 * `title: { absolute: "…" }`; `tests/metadata-title-template.test.ts` pins
 * that none does.
 */
export const metadata: Metadata = {
  title: {
    template: "%s | Brobond Wear",
    default: "Brobond Wear — Hub Multicanal",
  },
  description: APP_DESCRIPTION,
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
