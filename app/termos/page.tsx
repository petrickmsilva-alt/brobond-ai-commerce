import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";
import { PRIVACY_ROUTE } from "@/lib/auth-routes";

/**
 * Terms of Service (`/termos`).
 *
 * Required by TikTok's App Review Guidelines (Terms of Service URL must
 * resolve and be visible on the Web/Desktop URL) and by the TikTok
 * "URL properties" ownership check, which can only verify a URL that exists.
 *
 * Operating entity: Brobond Wear LTDA (CNPJ 52.426.369/0001-64), contact
 * brobondwear@gmail.com — supplied directly by the business owner.
 */
export const metadata: Metadata = {
  title: "Termos de Serviço",
  description: `Termos de Serviço do ${APP_NAME}.`,
};

export default function TermsPage() {
  return (
    <LegalPage title="Termos de Serviço" updatedAt="3 de outubro de 2026">
      <p>
        Estes Termos de Serviço (&quot;Termos&quot;) regem o uso da plataforma{" "}
        {APP_NAME} (&quot;{APP_SHORT_NAME}&quot;, &quot;nós&quot;), operada por{" "}
        <strong>Brobond Wear LTDA</strong>, inscrita no CNPJ sob o nº{" "}
        <strong>52.426.369/0001-64</strong>. Ao criar uma conta ou utilizar o{" "}
        {APP_SHORT_NAME}, você concorda integralmente com estes Termos.
      </p>

      <LegalSection heading="1. Descrição do serviço">
        <p>
          O {APP_SHORT_NAME} é um sistema de gestão de comércio social que permite a
          lojistas centralizar catálogo de produtos, conectar contas de canais de
          venda e divulgação (incluindo o TikTok Shop via API oficial), gerenciar um
          roster de creators, orquestrar campanhas e acompanhar pedidos e métricas em
          um único painel.
        </p>
      </LegalSection>

      <LegalSection heading="2. Contas e elegibilidade">
        <p>
          Para usar o {APP_SHORT_NAME} você precisa criar uma conta com informações
          verdadeiras e completas e ser legalmente capaz de celebrar contratos. Você é
          responsável por manter a confidencialidade das suas credenciais e por toda
          atividade realizada na sua conta.
        </p>
      </LegalSection>

      <LegalSection heading="3. Conexão com contas de terceiros (ex.: TikTok Shop)">
        <p>
          Ao conectar uma conta do TikTok Shop (ou outro canal suportado), você
          autoriza o {APP_SHORT_NAME} a acessar, por meio de API oficial e protocolo
          OAuth, os dados necessários para sincronizar produtos, pedidos e creators
          associados àquela conta. Essa autorização pode ser revogada a qualquer
          momento, tanto pelo painel do {APP_SHORT_NAME} quanto diretamente nas
          configurações da conta do TikTok Shop. O uso dessas integrações também está
          sujeito aos termos e políticas da própria TikTok.
        </p>
      </LegalSection>

      <LegalSection heading="4. Uso aceitável">
        <p>Ao usar o {APP_SHORT_NAME}, você concorda em não:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Violar leis aplicáveis ou direitos de terceiros;</li>
          <li>
            Tentar contornar controles de segurança, autenticação ou isolamento entre
            organizações (multi-tenant) da plataforma;
          </li>
          <li>Extrair dados em massa para finalidades não autorizadas;</li>
          <li>
            Usar as integrações com o TikTok Shop de forma incompatível com os termos
            de desenvolvedor do TikTok.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Propriedade intelectual">
        <p>
          O {APP_SHORT_NAME}, sua marca, interface e código-fonte pertencem a{" "}
          <strong>Brobond Wear LTDA</strong> ou a seus licenciadores. Os dados
          que você insere ou sincroniza (produtos, pedidos, creators) continuam sendo
          de sua propriedade.
        </p>
      </LegalSection>

      <LegalSection heading="6. Disponibilidade e alterações do serviço">
        <p>
          Podemos alterar, suspender ou descontinuar funcionalidades do{" "}
          {APP_SHORT_NAME} a qualquer momento, inclusive em razão de mudanças nas APIs
          de terceiros (como a API do TikTok Shop). Envidaremos esforços razoáveis
          para comunicar alterações relevantes com antecedência.
        </p>
      </LegalSection>

      <LegalSection heading="7. Limitação de responsabilidade">
        <p>
          Na máxima extensão permitida por lei, o {APP_SHORT_NAME} é fornecido
          &quot;como está&quot;, sem garantias de que estará livre de erros ou
          interrupções. Não nos responsabilizamos por indisponibilidades de
          plataformas de terceiros integradas (ex.: TikTok Shop) fora do nosso
          controle.
        </p>
      </LegalSection>

      <LegalSection heading="8. Encerramento de conta">
        <p>
          Você pode encerrar sua conta a qualquer momento. Podemos suspender ou
          encerrar contas que violem estes Termos, mediante aviso quando possível.
        </p>
      </LegalSection>

      <LegalSection heading="9. Alterações destes Termos">
        <p>
          Podemos atualizar estes Termos periodicamente. A versão vigente estará
          sempre disponível nesta página, com a data de atualização indicada no topo.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contato">
        <p>
          Dúvidas sobre estes Termos podem ser enviadas para{" "}
          <strong>brobondwear@gmail.com</strong>.
        </p>
      </LegalSection>

      <p className="pt-4 text-xs text-white/40">
        Veja também a nossa{" "}
        <Link href={PRIVACY_ROUTE} className="text-brand-300 underline underline-offset-2">
          Política de Privacidade
        </Link>
        .
      </p>
    </LegalPage>
  );
}
