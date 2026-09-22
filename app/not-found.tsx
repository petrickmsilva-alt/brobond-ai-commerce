import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="bg-premium-glow flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-brand-400">404</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">Página não encontrada</h1>
      <p className="mt-2 max-w-sm text-sm text-white/50">
        A página que você procura não existe ou foi movida.
      </p>
      <Link href="/dashboard" className="mt-6">
        <Button>Voltar ao Dashboard</Button>
      </Link>
    </div>
  );
}
