"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  UserRound,
} from "lucide-react";
import { accessRequestSchema } from "@/lib/validations/auth";
import { requestAccessAction } from "@/app/request-access/actions";
import { REQUEST_ACCESS_SUCCESS_ROUTE } from "@/lib/auth-routes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

/**
 * Public access-request form (PR010.2 §5 · PR010.3 §1).
 *
 * Fields: Nome · Empresa · Email · Telefone · Mensagem.
 *
 * ON SUCCESS THE FORM IS LEFT BEHIND (PR010.3 §1): the browser is navigated to
 * `/request-access/success` with `router.replace`, so the confirmation is a
 * real page — shareable, refreshable — and the populated form is dropped from
 * the history stack ("nunca retornar para o formulário": the back button
 * cannot resurrect it either). An inline success card would still live at
 * `/request-access`, one refresh away from a duplicate submit.
 *
 * SECURITY: this posts to a server action that writes one inert
 * `AccessRequest` row — no password, no role, no tenant, no session.
 * Submitting it grants nothing; an ADMIN must still send an invitation.
 */

type FormValues = {
  name: string;
  company: string;
  email: string;
  whatsapp: string;
  message: string;
};

export function RequestAccessForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // The schema transforms empty strings to `null`; the resolver only needs
    // it for validation, so the input type stays a plain string form.
    resolver: zodResolver(accessRequestSchema) as never,
    defaultValues: { name: "", company: "", email: "", whatsapp: "", message: "" },
  });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const result = await requestAccessAction(values);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    // PR010.3 §1 — replace (not push): the confirmation page replaces the
    // form in the history stack, so "back" can never land on a populated
    // form again.
    router.replace(REQUEST_ACCESS_SUCCESS_ROUTE);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Field
        id="name"
        label="Nome completo"
        icon={UserRound}
        error={errors.name?.message}
        inputProps={{
          placeholder: "Ana Ribeiro",
          autoComplete: "name",
          ...register("name"),
        }}
      />

      <Field
        id="company"
        label="Empresa"
        icon={Building2}
        error={errors.company?.message}
        inputProps={{
          placeholder: "Brobond Comércio",
          autoComplete: "organization",
          ...register("company"),
        }}
      />

      <Field
        id="email"
        label="Email corporativo"
        icon={Mail}
        error={errors.email?.message}
        inputProps={{
          type: "email",
          placeholder: "voce@empresa.com",
          autoComplete: "email",
          ...register("email"),
        }}
      />

      <Field
        id="whatsapp"
        label="Telefone"
        optional
        icon={Phone}
        error={errors.whatsapp?.message}
        inputProps={{
          type: "tel",
          placeholder: "+55 11 90000-0000",
          autoComplete: "tel",
          ...register("whatsapp"),
        }}
      />

      {/* Message — textarea, so it gets its own markup. */}
      <div className="space-y-2">
        <label
          htmlFor="message"
          className="flex items-baseline gap-2 text-xs font-medium text-white/70"
        >
          <MessageSquare aria-hidden className="h-3.5 w-3.5 text-white/30" />
          Mensagem
          <span className="text-[10px] font-normal text-white/30">opcional</span>
        </label>
        <textarea
          id="message"
          rows={4}
          placeholder="Conte brevemente sobre sua operação e o que você espera da plataforma."
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "message-error" : undefined}
          className={cn(
            "w-full resize-y rounded-xl border border-white/10 bg-surface-900/80 px-3.5 py-2.5 text-sm text-white",
            "placeholder:text-white/35 transition-[border-color,box-shadow] duration-150",
            "hover:border-white/16 focus-visible:border-brand-400/60",
            "aria-[invalid=true]:border-red-400/50",
            focusRing,
          )}
          {...register("message")}
        />
        {errors.message && (
          <p id="message-error" className="flex items-center gap-1.5 text-xs text-red-300">
            <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {errors.message.message}
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
        {isSubmitting ? "Enviando…" : "Solicitar acesso"}
        {!isSubmitting && <ArrowRight aria-hidden className="h-4 w-4" />}
      </Button>

      <p className="text-center text-[11px] leading-relaxed text-white/30">
        Ao enviar, você concorda que entremos em contato sobre seu pedido de acesso.
      </p>
    </form>
  );
}

/** Labelled input row with a leading icon — the shared field of this form. */
function Field({
  id,
  label,
  icon: Icon,
  error,
  optional,
  inputProps,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  error?: string;
  optional?: boolean;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="flex items-baseline gap-2 text-xs font-medium text-white/70">
        <Icon aria-hidden className="h-3.5 w-3.5 text-white/30" />
        {label}
        {optional && <span className="text-[10px] font-normal text-white/30">opcional</span>}
      </label>
      <Input
        id={id}
        className="h-11"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...inputProps}
      />
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-xs text-red-300">
          <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
