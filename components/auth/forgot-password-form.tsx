"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Mail, MailCheck } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { requestPasswordResetAction } from "@/app/forgot-password/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/motion";

/**
 * "Esqueci minha senha" — step 1 of §6 (email → token → nova senha).
 *
 * NO USER ENUMERATION
 * -------------------
 * The confirmation copy is deliberately conditional-free: "se existir uma
 * conta com esse email, enviamos um link". The server returns the same result
 * for a known and an unknown address, and this component shows the same screen
 * either way — so the form cannot be used to discover which emails have
 * accounts.
 *
 * DEV CONVENIENCE: outside production the action returns the raw token so the
 * flow can be walked end-to-end without an email provider. The link below only
 * renders when that token is present, which in production it never is.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [ttl, setTtl] = useState(30);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    const result = await requestPasswordResetAction(values);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    setDevToken(result.devToken ?? null);
    setTtl(result.expiresInMinutes);
    setSent(true);
  }

  if (sent) {
    return (
      <FadeIn>
        <div role="status" className="text-center">
          <span
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-400/25 bg-brand-500/15 text-brand-300"
          >
            <MailCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-white">Verifique seu email</h2>
          <p className="mx-auto mt-2 max-w-sm text-balance text-sm leading-relaxed text-white/55">
            Se existir uma conta com esse email, enviamos um link para redefinir sua senha. O link
            expira em {ttl} minutos.
          </p>

          {devToken && (
            <div className="mt-6 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] p-4 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                Ambiente de desenvolvimento
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/55">
                Nenhum provedor de email está configurado, então o link aparece aqui. Em produção
                ele é enviado exclusivamente por email.
              </p>
              <Link
                href={`/reset-password?token=${encodeURIComponent(devToken)}`}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-300 underline-offset-4 hover:underline"
              >
                Abrir link de redefinição
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          <Link
            href="/login"
            className="mt-7 inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            Voltar para o login
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="email" className="block text-xs font-medium text-white/70">
          Email corporativo
        </label>
        <div className="relative">
          <Mail
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
          />
          <Input
            id="email"
            type="email"
            placeholder="voce@brobond.ai"
            autoComplete="email"
            autoFocus
            className="h-11 pl-10"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
        </div>
        {errors.email && (
          <p id="email-error" className="flex items-center gap-1.5 text-xs text-red-300">
            <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {errors.email.message}
          </p>
        )}
      </div>

      {formError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-300"
        >
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {isSubmitting ? "Enviando…" : "Enviar link de recuperação"}
      </Button>

      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 text-xs font-medium text-white/45 transition-colors hover:text-white"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        Voltar para o login
      </Link>
    </form>
  );
}
