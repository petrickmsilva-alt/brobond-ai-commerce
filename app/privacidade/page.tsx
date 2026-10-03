import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";
import { TERMS_ROUTE } from "@/lib/auth-routes";

/**
 * Privacy Policy (`/privacidade`).
 *
 * Required by TikTok's App Review Guidelines (Privacy Policy URL must
 * resolve and be visible on the Web/Desktop URL) and by the TikTok
 * "URL properties" ownership check, which can only verify a URL that exists.
 * It also describes, specifically, the data touched by the TikTok Shop
 * connector (`modules/connectors/tiktok`) — OAuth tokens, products, orders,
 * creators — since that is the integration under review.
 *
 * Operating entity: Brobond Wear LTDA (CNPJ 52.426.369/0001-64), contact
 * brobondwear@gmail.com — supplied directly by the business owner.
 */
export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Política de Privacidade do ${APP_NAME}.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade" updatedAt="3 de outubro de 2026">
      <p>
        Esta Política de Privacidade descreve como {APP_NAME} (&quot;
        {APP_SHORT_NAME}&quot;, &quot;nós&quot;), operado por{" "}
        <strong>Brobond Wear LTDA</strong>, CNPJ{" "}
        <strong>52.426.369/0001-64</strong>, coleta, usa, armazena e protege dados
        pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº
        13.709/2018).
      </p>

      <LegalSection heading="1. Dados que coletamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Dados de cadastro:</strong> nome, e-mail e organização informados
            ao criar uma conta.
          </li>
          <li>
            <strong>Dados de canais conectados:</strong> quando você conecta uma conta
            do TikTok Shop (ou outro canal suportado) via OAuth oficial, armazenamos a
            identidade da loja e um token de acesso — sempre criptografado em repouso
            — necessário para sincronizar catálogo, pedidos e creators.
          </li>
          <li>
            <strong>Dados operacionais sincronizados:</strong> produtos, pedidos,
            creators e métricas de campanha trazidos das integrações que você ativa.
          </li>
          <li>
            <strong>Dados de uso:</strong> registros técnicos (logs de auditoria,
            acessos) usados para segurança e suporte.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. Como usamos os dados">
        <p>Usamos os dados coletados para:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Operar e manter a sua conta e o seu workspace;</li>
          <li>
            Sincronizar e exibir produtos, pedidos e creators das plataformas
            conectadas (ex.: TikTok Shop);
          </li>
          <li>Gerar relatórios, recomendações de campanhas e analytics;</li>
          <li>Prevenir fraude e garantir a segurança da plataforma;</li>
          <li>Cumprir obrigações legais e contratuais.</li>
        </ul>
        <p>
          Não vendemos dados pessoais a terceiros. Tokens de acesso a canais
          conectados nunca são expostos a componentes do lado do cliente nem incluídos
          em respostas de API — permanecem apenas no backend, criptografados.
        </p>
      </LegalSection>

      <LegalSection heading="3. Compartilhamento de dados">
        <p>
          Compartilhamos dados apenas com: (a) as próprias plataformas que você opta
          por conectar, na medida necessária para operar a integração (ex.: chamadas à
          API oficial do TikTok Shop); (b) provedores de infraestrutura que processam
          dados em nosso nome, sob obrigações de confidencialidade; (c) autoridades,
          quando exigido por lei.
        </p>
      </LegalSection>

      <LegalSection heading="4. Retenção e exclusão">
        <p>
          Mantemos os dados enquanto sua conta estiver ativa ou conforme necessário
          para cumprir obrigações legais. Ao desconectar um canal (ex.: TikTok Shop)
          ou encerrar sua conta, os tokens de acesso associados são revogados e
          removidos; dados operacionais já sincronizados podem ser retidos por um
          período adicional para fins de auditoria, salvo solicitação de exclusão.
        </p>
      </LegalSection>

      <LegalSection heading="5. Segurança">
        <p>
          Adotamos controles técnicos e organizacionais, incluindo isolamento de dados
          por organização (multi-tenant), controle de acesso baseado em papéis (RBAC),
          criptografia de credenciais sensíveis em repouso, trilha de auditoria para
          ações sensíveis e autenticação de sessão segura.
        </p>
      </LegalSection>

      <LegalSection heading="6. Seus direitos (LGPD)">
        <p>
          Você pode solicitar confirmação de tratamento, acesso, correção,
          portabilidade, anonimização ou exclusão dos seus dados pessoais, bem como
          revogar consentimentos e desconectar integrações de terceiros a qualquer
          momento, entrando em contato pelo canal abaixo.
        </p>
      </LegalSection>

      <LegalSection heading="7. Cookies">
        <p>
          Usamos cookies estritamente necessários para manter sua sessão autenticada.
          Não usamos cookies de rastreamento publicitário de terceiros.
        </p>
      </LegalSection>

      <LegalSection heading="8. Integrações do TikTok">
        <p>
          A integração com o TikTok Shop usa exclusivamente a API oficial do TikTok
          Shop Partner Center, com autenticação OAuth. Os dados obtidos (identidade da
          loja, produtos, pedidos, creators) são usados apenas para operar as
          funcionalidades que você solicitou dentro do {APP_SHORT_NAME} e são tratados
          conforme os termos de desenvolvedor e as políticas de dados do TikTok.
        </p>
      </LegalSection>

      <LegalSection heading="9. Alterações desta política">
        <p>
          Podemos atualizar esta Política periodicamente. A versão vigente estará
          sempre disponível nesta página, com a data de atualização indicada no topo.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contato / Encarregado de dados (DPO)">
        <p>
          Para exercer seus direitos ou tirar dúvidas sobre esta política, contate{" "}
          <strong>brobondwear@gmail.com</strong>.
        </p>
      </LegalSection>

      <p className="pt-4 text-xs text-white/40">
        Veja também os nossos{" "}
        <Link href={TERMS_ROUTE} className="text-brand-300 underline underline-offset-2">
          Termos de Serviço
        </Link>
        .
      </p>
    </LegalPage>
  );
}
