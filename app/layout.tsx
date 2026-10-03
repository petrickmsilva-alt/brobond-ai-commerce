import type { Metadata } from "next";
import { APP_DESCRIPTION } from "@/lib/constants";
import {
  TIKTOK_SITE_VERIFICATION_META_NAME,
  TIKTOK_SITE_VERIFICATION_SIGNATURE,
} from "@/lib/tiktok-site-verification";
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
  /**
   * Third-party domain-ownership proofs.
   *
   * `verification.other` renders `<meta name="..." content="...">` into the
   * `<head>` of EVERY page, which is what the TikTok Developers console's
   * meta-tag method looks for on the homepage. It is the third independent
   * proof alongside the signature file at `/tiktok<SIGNATURE>.txt` and the
   * extensionless route handler — see `lib/tiktok-site-verification.ts`.
   *
   * The `content` is the BARE signature, NOT the full
   * `tiktok-developers-site-verification=<signature>` token. Putting the
   * whole token in here is the usual way this check fails: the validator
   * compares `content` against the raw signature.
   */
  verification: {
    other: {
      [TIKTOK_SITE_VERIFICATION_META_NAME]: TIKTOK_SITE_VERIFICATION_SIGNATURE,
    },
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
