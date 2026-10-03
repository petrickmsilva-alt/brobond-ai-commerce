import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Termos de Serviço",
  description: `Termos de Serviço do ${APP_NAME}.`,
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-surface-950 px-6 py-12 text-white">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-brand-300 hover:text-brand-200">← Voltar para {APP_NAME}</Link>
        <p className="mt-12 text-sm font-semibold uppercase tracking-[0.2em] text-brand-300">Documento legal</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Termos de Serviço</h1>
        <p className="mt-4 text-sm text-white/50">Última atualização: 3 de outubro de 2026</p>
        <div className="mt-12 space-y-8 text-[15px] leading-7 text-white/70">
          <section><h2 className="text-xl font-semibold text-white">1. Aceitação</h2><p className="mt-3">Ao criar uma conta ou utilizar a plataforma {APP_NAME}, você concorda com estes Termos. Se estiver aceitando em nome de uma empresa, declara ter autoridade para vinculá-la.</p></section>
          <section><h2 className="text-xl font-semibold text-white">2. O serviço</h2><p className="mt-3">A {APP_NAME} oferece ferramentas para gestão de catálogo, creators, campanhas e comércio social. Podemos evoluir funcionalidades, comunicar mudanças relevantes e manter os dados conforme a nossa Política de Privacidade.</p></section>
          <section><h2 className="text-xl font-semibold text-white">3. Conta e uso aceitável</h2><p className="mt-3">Você é responsável por manter suas credenciais seguras e pelas informações inseridas. É proibido usar o serviço para atividades ilegais, fraude, abuso de APIs, tentativa de acesso não autorizado ou violação de direitos de terceiros.</p></section>
          <section><h2 className="text-xl font-semibold text-white">4. Conteúdo e integrações</h2><p className="mt-3">Você mantém os direitos sobre seu conteúdo e concede apenas as permissões necessárias para prestarmos o serviço. Integrações de terceiros, incluindo redes sociais e marketplaces, também estão sujeitas aos termos desses terceiros.</p></section>
          <section><h2 className="text-xl font-semibold text-white">5. Disponibilidade e responsabilidade</h2><p className="mt-3">Trabalhamos para manter a plataforma disponível e segura, mas o serviço é fornecido conforme disponível. Na medida permitida pela lei, não garantimos resultados comerciais específicos nem respondemos por falhas de serviços de terceiros.</p></section>
          <section><h2 className="text-xl font-semibold text-white">6. Encerramento e contato</h2><p className="mt-3">Podemos suspender contas que violem estes Termos. Você pode encerrar sua conta a qualquer momento. Para dúvidas ou solicitações legais, entre em contato pelo canal oficial disponível na sua conta.</p></section>
          <p className="border-t border-white/10 pt-6 text-white/50">Ao continuar usando a plataforma, você confirma que leu e compreendeu estes Termos.</p>
        </div>
      </article>
    </main>
  );
}
