import type { TemplateTypeName } from "../interfaces/outreach.interface";

export interface OutreachTemplateDefinition {
  name: string;
  type: TemplateTypeName;
  content: string;
}

/** Canonical prompt-engine templates seeded per organization (3 + 2 + 2 + 1). */
export const OUTREACH_TEMPLATES: readonly OutreachTemplateDefinition[] = [
  {
    name: "Primeiro contato — oportunidade",
    type: "FIRST_CONTACT",
    content:
      "Olá, {{creatorName}}! Acompanhamos seu conteúdo sobre {{niche}} e adoramos seu trabalho. A {{campaignName}} tem tudo a ver com seu público. Gostaria de conhecer o {{productName}} e conversar sobre uma parceria inspirada em {{trendKeyword}}?",
  },
  {
    name: "Primeiro contato — conexão",
    type: "FIRST_CONTACT",
    content:
      "Oi, {{creatorName}}! Seu olhar para {{niche}} chamou nossa atenção. Estamos preparando a campanha {{campaignName}} para o {{productName}}, com foco em {{trendKeyword}}, e acreditamos que sua voz seria perfeita. Podemos conversar?",
  },
  {
    name: "Primeiro contato — direto",
    type: "FIRST_CONTACT",
    content:
      "Olá, {{creatorName}}! Temos uma oportunidade de parceria em {{niche}}: {{campaignName}}, apresentando {{productName}} no contexto de {{trendKeyword}}. Tem interesse em receber os detalhes?",
  },
  {
    name: "Follow-up — lembrete",
    type: "FOLLOW_UP",
    content:
      "Oi, {{creatorName}}! Passando para saber se conseguiu ver nossa proposta para a {{campaignName}} com o {{productName}}. A ideia de {{trendKeyword}} continua super alinhada ao seu conteúdo de {{niche}}.",
  },
  {
    name: "Follow-up — valor",
    type: "FOLLOW_UP",
    content:
      "Olá, {{creatorName}}! Queremos construir uma parceria que faça sentido para você e para sua audiência de {{niche}}. Posso compartilhar mais detalhes da {{campaignName}} e do {{productName}}?",
  },
  {
    name: "Negociação — condições",
    type: "NEGOTIATION",
    content:
      "Oi, {{creatorName}}! Obrigado pelo interesse na {{campaignName}}. Vamos alinhar formato, prazo e condições para apresentar o {{productName}} de forma autêntica ao seu público de {{niche}}?",
  },
  {
    name: "Negociação — próximos passos",
    type: "NEGOTIATION",
    content:
      "Olá, {{creatorName}}! Estamos animados para avançar com você na {{campaignName}}. O próximo passo é fechar os detalhes da entrega sobre {{productName}} e {{trendKeyword}}. Qual horário funciona melhor?",
  },
  {
    name: "Reengajamento — nova oportunidade",
    type: "REENGAGEMENT",
    content:
      "Oi, {{creatorName}}! Faz um tempo desde nossa última conversa. Surgiu uma nova oportunidade na {{campaignName}} com o {{productName}}, conectada a {{trendKeyword}} e ao seu nicho de {{niche}}. Vamos retomar?",
  },
] as const;

export const DEFAULT_OUTREACH_TEMPLATE = OUTREACH_TEMPLATES[0]!;
