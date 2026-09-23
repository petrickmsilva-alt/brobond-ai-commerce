"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Phone,
  UserRound,
} from "lucide-react";
import { signupFormSchema, type SignupInput } from "@/lib/validations/auth";
import { signupAction } from "@/app/signup/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PasswordStrength } from "@/components/auth/password-strength";
import { cn } from "@/lib/utils";
import { focusRing, focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * Self-signup form (PR010.4 §3 · §8).
 *
 * REAL-TIME VALIDATION (§3)
 * -------------------------
 * `mode: "onChange"` with `reValidateMode: "onChange"` means a field is judged
 * as it is typed, not after a failed submit. Combined with the shared Zod
 * schema, the feedback a user gets while typing is the SAME rule the server
 * will apply — the form can never promise something the action then rejects.
 *
 * ERRORS BELONG TO FIELDS (§8)
 * ----------------------------
 * Both sources of truth render in the same place, under the input:
 *
 *   - client-side Zod errors (`errors.<field>.message`), and
 *   - server-side `fieldErrors` returned by the action, replayed onto the form
 *     with `setError()`.
 *
 * So "Email já utilizado" — which only the database can know — appears under
 * the email input, exactly like "Senha muito curta" does. The banner at the
 * bottom is a `role="alert"` summary for assistive tech; it never carries a
 * message that has no home.
 *
 * SECURITY: the password is sent to a server action over the same origin and
 * hashed there. No secret exists in this bundle, and there is no `role` field
 * for a client to tamper with — ADMIN is decided server-side.
 */

export interface SignupFormProps {
  /** Sanitised post-signup destination resolved from `?next=` by the page. */
  next?: string | null;
}

/**
 * The form's own value shape.
 *
 * `acceptTerms` is `z.literal(true)` in the schema — which is exactly the rule
 * we want (an unchecked box is a validation error with its own message, §8) —
 * but it makes the *input* type `true`, and a checkbox legitimately starts at
 * `false`. So the component works in `boolean` and lets the resolver be the
 * one that objects, which is where that objection belongs.
 */
type FormValues = Omit<SignupInput, "acceptTerms"> & { acceptTerms: boolean };

export function SignupForm({ next = null }: SignupFormProps) {
  const router = useRouter();
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting, touchedFields, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(signupFormSchema) as never,
    // §3 — validação em tempo real.
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      company: "",
      whatsapp: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
      next,
    },
  });

  const password = watch("password") ?? "";

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await signupAction({ ...values, next });

    if (!result.ok) {
      // §8 — replay every server-side field error onto its own input, so the
      // user reads "Email já utilizado" under the email box rather than a
      // generic sentence at the bottom of the form.
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const message = messages?.[0];
          if (!message) continue;
          setError(field as keyof FormValues, { type: "server", message });
        }
      }
      setFormError(result.error);
      return;
    }

    // §4 — already signed in by the action; go straight to the dashboard.
    router.push(result.redirectTo);
    router.refresh();
  });

  /** A field that is valid AND has been filled earns a quiet green check. */
  function isValid(field: keyof FormValues): boolean {
    return Boolean(dirtyFields[field] && !errors[field]);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="name"
          label="Nome completo"
          icon={UserRound}
          error={errors.name?.message}
          valid={isValid("name")}
          inputProps={{
            placeholder: "Ana Ribeiro",
            autoComplete: "name",
            autoFocus: true,
            ...register("name"),
          }}
        />

        <Field
          id="company"
          label="Empresa"
          icon={Building2}
          hint="Será o nome do seu workspace."
          error={errors.company?.message}
          valid={isValid("company")}
          inputProps={{
            placeholder: "Brobond Commerce",
            autoComplete: "organization",
            ...register("company"),
          }}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="whatsapp"
          label="WhatsApp"
          icon={Phone}
          error={errors.whatsapp?.message}
          valid={isValid("whatsapp")}
          inputProps={{
            type: "tel",
            inputMode: "tel",
            placeholder: "(11) 98888-7777",
            autoComplete: "tel",
            ...register("whatsapp"),
          }}
        />

        <Field
          id="email"
          label="Email corporativo"
          icon={Mail}
          error={errors.email?.message}
          valid={isValid("email")}
          inputProps={{
            type: "email",
            placeholder: "voce@empresa.com",
            autoComplete: "email",
            ...register("email"),
          }}
        />
      </div>

      {/* Password ------------------------------------------------------- */}
      <div className="space-y-2">
        <label
          htmlFor="password"
          className="flex items-baseline gap-2 text-xs font-medium text-white/70"
        >
          <Lock aria-hidden className="h-3.5 w-3.5 text-white/30" />
          Senha
        </label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Mínimo de 8 caracteres"
            autoComplete="new-password"
            className="h-11 pr-11"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          <RevealButton
            shown={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            label="senha"
          />
        </div>
        {password && <PasswordStrength password={password} />}
        <FieldError id="password-error" message={errors.password?.message} />
      </div>

      {/* Confirm password ----------------------------------------------- */}
      <div className="space-y-2">
        <label
          htmlFor="confirmPassword"
          className="flex items-baseline gap-2 text-xs font-medium text-white/70"
        >
          <Lock aria-hidden className="h-3.5 w-3.5 text-white/30" />
          Confirmar senha
        </label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showConfirm ? "text" : "password"}
            placeholder="Repita a senha"
            autoComplete="new-password"
            className="h-11 pr-11"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
            {...register("confirmPassword")}
          />
          <RevealButton
            shown={showConfirm}
            onToggle={() => setShowConfirm((value) => !value)}
            label="confirmação de senha"
          />
        </div>
        <FieldError id="confirmPassword-error" message={errors.confirmPassword?.message} />
      </div>

      {/* Terms ----------------------------------------------------------- */}
      <div className="space-y-2">
        <label
          htmlFor="acceptTerms"
          className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-white/60"
        >
          <input
            id="acceptTerms"
            type="checkbox"
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-surface-900 accent-brand-500",
              focusRing,
            )}
            aria-invalid={errors.acceptTerms ? true : undefined}
            aria-describedby={errors.acceptTerms ? "acceptTerms-error" : undefined}
            {...register("acceptTerms")}
          />
          <span>
            Li e aceito os{" "}
            <Link
              href="/terms"
              className="font-medium text-brand-300 underline-offset-4 hover:underline"
            >
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link
              href="/privacy"
              className="font-medium text-brand-300 underline-offset-4 hover:underline"
            >
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
        <FieldError id="acceptTerms-error" message={errors.acceptTerms?.message} />
      </div>

      {/* §8 — a SUMMARY for assistive tech, never the only thing shown. */}
      {formError && (
        <p
          role="alert"
          data-testid="signup-form-error"
          className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-300"
        >
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {isSubmitting ? "Criando sua conta…" : "Criar conta"}
        {!isSubmitting && <ArrowRight aria-hidden className="h-4 w-4" />}
      </Button>

      <p className="text-center text-[11px] leading-relaxed text-white/30">
        Você será o administrador do workspace e poderá convidar seu time depois.
      </p>

      {/* Referenced so `touchedFields` participates in the render and the
          green checks update as the user moves through the form. */}
      <span hidden aria-hidden>
        {Object.keys(touchedFields).length}
      </span>
    </form>
  );
}

/** Labelled input row with a leading icon — the shared field of this form. */
function Field({
  id,
  label,
  icon: Icon,
  hint,
  error,
  valid,
  inputProps,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  hint?: string;
  error?: string;
  valid?: boolean;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="flex items-baseline gap-2 text-xs font-medium text-white/70">
        <Icon aria-hidden className="h-3.5 w-3.5 text-white/30" />
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          className="h-11 pr-9"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...inputProps}
        />
        {valid && !error && (
          <CheckCircle2
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400"
          />
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[11px] leading-relaxed text-white/30">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** §8 — the one place a field-level message is rendered. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} data-field-error className="flex items-center gap-1.5 text-xs text-red-300">
      <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

function RevealButton({
  shown,
  onToggle,
  label,
}: {
  shown: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? `Ocultar ${label}` : `Mostrar ${label}`}
      aria-pressed={shown}
      className={cn(
        "absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/40",
        "transition-colors hover:bg-white/[0.06] hover:text-white/70",
        focusRingRaised,
      )}
    >
      {shown ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
    </button>
  );
}
