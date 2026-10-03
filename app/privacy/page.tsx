import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Política de Privacidade do ${APP_NAME}.`,
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-surface-950 px-6 py-12 text-white">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-brand-300 hover:text-brand-200">← Voltar para {APP_NAME}</Link>
        <p className="mt-12 text-sm font-semibold uppercase tracking-[0.2em] text-brand-300">Documento legal</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Política de Privacidade</h1>
        <p className="mt-4 text-sm text-white/50">Última atualização: 3 de outubro de 2026</p>
        <div className="mt-12 space-y-8 text-[15px] leading-7 text-white/70">
          <section><h2 className="text-xl font-semibold text-white">1. Quem somos</h2><p className="mt-3">Esta Política explica como a {APP_NAME} coleta, usa, armazena e protege dados pessoais quando você utiliza nossa plataforma de comércio social.</p></section>
          <section><h2 className="text-xl font-semibold text-white">2. Dados que coletamos</h2><p className="mt-3">Podemos coletar dados de cadastro e contato, informações da organização, dados de uso e segurança, além de dados necessários para integrações que você autoriza. Não vendemos dados pessoais.</p></section>
          <section><h2 className="text-xl font-semibold text-white">3. Como usamos os dados</h2><p className="mt-3">Usamos os dados para fornecer e proteger o serviço, autenticar usuários, sincronizar integrações, melhorar a experiência, cumprir obrigações legais e comunicar informações importantes sobre a conta.</p></section>
          <section><h2 className="text-xl font-semibold text-white">4. Compartilhamento</h2><p className="mt-3">Compartilhamos dados somente quando necessário para operar o serviço, com provedores que atuam sob nossas instruções, com integrações escolhidas por você, ou para cumprir obrigação legal. Exigimos medidas de segurança compatíveis com a finalidade.</p></section>
          <section><h2 className="text-xl font-semibold text-white">5. Retenção e segurança</h2><p className="mt-3">Mantemos os dados pelo tempo necessário às finalidades desta Política e às obrigações legais. Aplicamos controles técnicos e organizacionais, embora nenhum sistema conectado à internet seja absolutamente seguro.</p></section>
          <section><h2 className="text-xl font-semibold text-white">6. Seus direitos</h2><p className="mt-3">Você pode solicitar confirmação, acesso, correção, exclusão, portabilidade ou informações sobre o tratamento, conforme a legislação aplicável. Use o canal de suporte da sua conta para fazer uma solicitação.</p></section>
          <p className="border-t border-white/10 pt-6 text-white/50">Esta Política pode ser atualizada para refletir mudanças legais ou no serviço. Publicaremos a versão vigente nesta página.</p>
        </div>
      </article>
    </main>
  );
}
