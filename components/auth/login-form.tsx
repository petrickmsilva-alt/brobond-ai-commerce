"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { loginAction } from "@/app/login/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Credentials login form.
 *
 * The password is submitted to a server action and verified server-side
 * against a bcrypt digest. No secret (AUTH_SECRET, DATABASE_URL, passwordHash)
 * is ever present in this client bundle.
 */
export function LoginForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-xs font-medium text-white/60">
          Email
        </label>
        <Input
          id="email"
          type="email"
          placeholder="voce@brobond.ai"
          autoComplete="email"
          {...register("email")}
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-xs font-medium text-white/60">
          Senha
        </label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          {...register("password")}
        />
        {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
      </div>

      {formError && (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {formError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}
