"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { loginAction } from "@/app/login/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * Credentials login form (redesigned in PR010.1 — UI only).
 *
 * SECURITY — unchanged from PR000.2. The password is submitted to the
 * `loginAction` server action and verified server-side against a bcrypt
 * digest. No secret (AUTH_SECRET, DATABASE_URL, passwordHash) is ever present
 * in this client bundle, and the redirect target is still the hardcoded
 * `/dashboard` — never a value taken from the URL (no open redirect).
 *
 * ACCESSIBILITY: every field is labelled, errors are wired through
 * `aria-invalid` + `aria-describedby`, and the form-level error is an
 * `role="alert"` live region.
 *
 * MFA: the layout reserves the second-factor step (see `LoginPage`), but no
 * MFA logic ships here — enabling it is an auth-domain change, out of scope
 * for a UI/UX PR.
 */
export function LoginForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(data: LoginInput) {
    setSubmitting(true);
    setFormError(null);

    const result = await loginAction(data);

    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {/* Email */}
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

      {/* Password */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="block text-xs font-medium text-white/70">
            Senha
          </label>
          <a
            href="mailto:suporte@brobond.ai?subject=Recupera%C3%A7%C3%A3o%20de%20acesso"
            className={cn(
              "rounded text-xs font-medium text-brand-300 transition-colors hover:text-brand-200",
              focusRingRaised,
            )}
          >
            Esqueci minha senha
          </a>
        </div>

        <div className="relative">
          <Lock
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
          />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            autoComplete="current-password"
            className="h-11 pl-10 pr-11"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            className={cn(
              "absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/40",
              "transition-colors hover:bg-white/[0.06] hover:text-white/70",
              focusRingRaised,
            )}
          >
            {showPassword ? (
              <EyeOff aria-hidden className="h-4 w-4" />
            ) : (
              <Eye aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>

        {errors.password && (
          <p id="password-error" className="flex items-center gap-1.5 text-xs text-red-300">
            <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {errors.password.message}
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

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {submitting ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
