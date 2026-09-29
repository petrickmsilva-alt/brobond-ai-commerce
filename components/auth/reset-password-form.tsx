"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { resetPasswordAction } from "@/app/forgot-password/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/motion";
import { PasswordStrength } from "@/components/auth/password-strength";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * "Nova senha" — step 3 of §6.
 *
 * The token arrives as a prop resolved server-side from the URL; it is never
 * read from `window.location` here. The server validates it a second time
 * inside the action, so a page that was left open past the 30-minute TTL
 * fails cleanly with "Este link expirou" instead of silently doing nothing.
 *
 * On success we do NOT auto-login: the user has just proven control of their
 * inbox, not of a session. They are sent to `/login` to authenticate with the
 * password they just set — which also confirms it works.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  const password = watch("password");

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    const result = await resetPasswordAction(values);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <FadeIn>
        <div role="status" className="text-center">
          <span
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/15 text-emerald-300"
          >
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-white">Senha redefinida</h2>
          <p className="mx-auto mt-2 max-w-sm text-balance text-sm leading-relaxed text-white/55">
            Sua senha foi atualizada com sucesso. Use-a para entrar na sua conta.
          </p>
          <Link href="/login" className="mt-7 inline-block">
            <Button size="lg">Ir para o login</Button>
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <input type="hidden" {...register("token")} />

      <div className="space-y-2">
        <label htmlFor="password" className="block text-xs font-medium text-white/70">
          Nova senha
        </label>
        <div className="relative">
          <Lock
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
          />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            autoComplete="new-password"
            autoFocus
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
        <PasswordStrength password={password ?? ""} />
      </div>

      <div className="space-y-2">
        <label htmlFor="confirmPassword" className="block text-xs font-medium text-white/70">
          Confirme a nova senha
        </label>
        <div className="relative">
          <ShieldCheck
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
          />
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            autoComplete="new-password"
            className="h-11 pl-10"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? "confirm-error" : undefined}
            {...register("confirmPassword")}
          />
        </div>
        {errors.confirmPassword && (
          <p id="confirm-error" className="flex items-center gap-1.5 text-xs text-red-300">
            <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {errors.confirmPassword.message}
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
        {isSubmitting ? "Redefinindo…" : "Redefinir senha"}
      </Button>
    </form>
  );
}
