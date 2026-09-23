"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, ShieldCheck, UserRound } from "lucide-react";
import { acceptInvitationSchema, type AcceptInvitationInput } from "@/lib/validations/auth";
import { acceptInvitationAction } from "@/app/invite/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PasswordStrength } from "@/components/auth/password-strength";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * Invitation acceptance form (PR010.2 §7).
 *
 * FLOW: validar convite (done server-side, before this renders) → definir
 * senha → entrar automaticamente.
 *
 * WHAT IS *NOT* HERE, ON PURPOSE
 * ------------------------------
 * There is no role selector and no workspace selector. Both come from the
 * stored `Invitation` and are applied server-side, so an invitee cannot grant
 * themselves ADMIN or join a different tenant by tampering with the payload.
 * The email is displayed read-only for the same reason.
 */
export interface AcceptInvitationFormProps {
  token: string;
  email: string;
  defaultName?: string | null;
}

export function AcceptInvitationForm({ token, email, defaultName }: AcceptInvitationFormProps) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: {
      token,
      name: defaultName ?? "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password");

  async function onSubmit(values: AcceptInvitationInput) {
    setFormError(null);
    const result = await acceptInvitationAction(values);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    // §7 — "entrar automaticamente": the action already minted the session.
    router.push(result.redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <input type="hidden" {...register("token")} />

      {/* Email is fixed by the invitation — shown for confidence, not editable. */}
      <div className="space-y-2">
        <span className="block text-xs font-medium text-white/70">Email do convite</span>
        <div className="flex h-11 items-center rounded-xl border border-white/8 bg-white/[0.03] px-3.5 text-sm text-white/70">
          {email}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="name" className="block text-xs font-medium text-white/70">
          Seu nome
        </label>
        <div className="relative">
          <UserRound
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
          />
          <Input
            id="name"
            placeholder="Ana Ribeiro"
            autoComplete="name"
            className="h-11 pl-10"
            aria-invalid={errors.name ? true : undefined}
            {...register("name")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-xs font-medium text-white/70">
          Crie sua senha
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
          Confirme a senha
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
        {isSubmitting ? "Ativando acesso…" : "Ativar acesso e entrar"}
        {!isSubmitting && <ArrowRight aria-hidden className="h-4 w-4" />}
      </Button>
    </form>
  );
}
