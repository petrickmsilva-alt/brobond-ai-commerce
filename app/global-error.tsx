"use client";

import { useEffect } from "react";

/**
 * Global error boundary (PR010.2 §8) — the last line of defence.
 *
 * This one replaces the ROOT LAYOUT itself, so it fires only when the layout
 * or a provider above every page throws. Because the layout is gone, this
 * component must render its own `<html>` and `<body>`, and it cannot rely on
 * the app's CSS being applied — hence the inline styles. Importing the design
 * system here would risk failing for the very reason the boundary triggered.
 *
 * It is deliberately dependency-free: no `next/link`, no shared component, no
 * icon library. Everything it needs is inlined.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app.global-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0f",
          color: "rgba(255,255,255,0.95)",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            Não foi possível carregar a aplicação
          </h1>
          <p
            style={{
              marginTop: "12px",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            Ocorreu um erro crítico. Recarregue a página — se o problema continuar, informe o ID
            abaixo ao suporte.
          </p>

          <code
            style={{
              display: "inline-block",
              marginTop: "20px",
              padding: "8px 14px",
              borderRadius: "16px",
              border: "1px solid rgba(255,255,255,0.08)",
              backgroundColor: "rgba(255,255,255,0.03)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              color: "rgba(255,255,255,0.7)",
              userSelect: "all",
            }}
          >
            {error.digest ?? "sem-id"}
          </code>

          <div
            style={{
              marginTop: "28px",
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                height: "40px",
                padding: "0 20px",
                borderRadius: "16px",
                border: "none",
                background: "linear-gradient(to bottom, #6366f1, #4f46e5)",
                color: "#fff",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Recarregar
            </button>
            {/* A plain anchor on purpose: this boundary replaces the root
                layout, so the Next.js router may not be mounted. A full
                document navigation is the only reliable way out. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                height: "40px",
                padding: "0 20px",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.85)",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Voltar para a home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
