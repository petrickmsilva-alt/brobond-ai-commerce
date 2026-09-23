"use client";

import { useState, useTransition } from "react";
import { Braces, Eye, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateAiMessageAction,
  getAiMessageContextAction,
  type AiMessageContextActionResult,
} from "@/app/dashboard/ai/actions";
import { ContextAuditModal } from "@/components/ai/context-audit-modal";
import type { AiMessageTone } from "@/modules/ai/openai/prompts";

interface Choice {
  id: string;
  name: string;
}

interface GeneratedContent {
  title: string;
  message: string;
  hashtags: string[];
  cta: string;
}

interface MessageRow {
  id: string;
  creator: string;
  product: string;
  campaign: string;
  tone: string;
  promptVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  content: GeneratedContent;
}

interface Props {
  messages: MessageRow[];
  creators: Choice[];
  products: Choice[];
  campaigns: Choice[];
  tones: readonly AiMessageTone[];
  canGenerate: boolean;
}

const TONE_LABELS: Record<string, string> = {
  FRIENDLY: "Amigável",
  PREMIUM: "Premium",
  LUXURY: "Luxo",
  STREET: "Street",
  FITNESS: "Fitness",
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function AiWorkbench(props: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  // PR007.1 — AI Context Audit: "Ver contexto" modal state.
  const [contextAudit, setContextAudit] = useState<AiMessageContextActionResult | null>(null);
  const [contextPending, startContextTransition] = useTransition();

  function submit(formData: FormData) {
    setFeedback("");
    startTransition(async () => {
      const result = await generateAiMessageAction(Object.fromEntries(formData));
      if (result.ok && result.data) {
        setActive(result.data.id);
        setFeedback(
          result.data.cached
            ? "Conteúdo já existia para este contexto — reutilizado do cache."
            : "Mensagem gerada com sucesso.",
        );
      } else {
        setFeedback(result.error ?? "Erro inesperado.");
      }
    });
  }

  function openContextAudit(id: string) {
    setFeedback("");
    startContextTransition(async () => {
      const result = await getAiMessageContextAction(id);
      if (result.ok && result.data) {
        setContextAudit(result.data);
      } else {
        setFeedback(result.error ?? "Não foi possível carregar o contexto.");
      }
    });
  }

  const activeMessage = props.messages.find((message) => message.id === active) ?? null;

  return (
    <div className="space-y-4">
      {props.canGenerate &&
        props.creators.length > 0 &&
        props.products.length > 0 &&
        props.campaigns.length > 0 && (
          <form
            className="grid gap-3 rounded-xl border border-surface-700 bg-surface-900/50 p-4 md:grid-cols-5"
            action={submit}
          >
            <select
              name="creatorId"
              className="rounded-lg border border-surface-700 bg-surface-900 px-3 text-sm"
              required
            >
              {props.creators.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              name="productId"
              className="rounded-lg border border-surface-700 bg-surface-900 px-3 text-sm"
              required
            >
              {props.products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              name="campaignId"
              className="rounded-lg border border-surface-700 bg-surface-900 px-3 text-sm"
              required
            >
              {props.campaigns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              name="tone"
              className="rounded-lg border border-surface-700 bg-surface-900 px-3 text-sm"
              required
            >
              {props.tones.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABELS[tone] ?? tone}
                </option>
              ))}
            </select>
            <Button disabled={pending}>
              <Sparkles className="h-3.5 w-3.5" />
              Gerar mensagem
            </Button>
          </form>
        )}

      {feedback && (
        <p role="status" className="text-sm text-brand-200">
          {feedback}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-surface-700">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-surface-800 text-xs uppercase text-white/45">
            <tr>
              {["Creator", "Produto", "Campanha", "Tom", "Versão", "Tokens", "Data", "Ações"].map(
                (label) => (
                  <th key={label} className="px-4 py-3">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800">
            {props.messages.map((message) => (
              <tr key={message.id} className="align-top">
                <td className="px-4 py-3 font-medium text-white">{message.creator}</td>
                <td className="px-4 py-3 text-white/70">{message.product}</td>
                <td className="px-4 py-3 text-white/70">{message.campaign}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-brand-600/15 px-2 py-1 text-xs text-brand-200">
                    {TONE_LABELS[message.tone] ?? message.tone}
                  </span>
                </td>
                <td className="px-4 py-3 text-white/60">{message.promptVersion}</td>
                <td className="px-4 py-3 text-white/60">
                  {message.inputTokens + message.outputTokens}
                </td>
                <td className="px-4 py-3 text-white/60">{localDate(message.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActive(active === message.id ? null : message.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Visualizar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={contextPending}
                      onClick={() => openContextAudit(message.id)}
                    >
                      <Braces className="h-3.5 w-3.5" />
                      Ver contexto
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {props.messages.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-white/40">
                  Nenhuma mensagem gerada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeMessage && (
        <div className="space-y-3 rounded-xl border border-surface-700 bg-surface-950 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Prévia do conteúdo</h3>
            <span className="text-xs text-white/40">{activeMessage.model}</span>
          </div>
          <div>
            <p className="text-xs uppercase text-white/40">Título</p>
            <p className="text-white">{activeMessage.content.title}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-white/40">Mensagem</p>
            <p className="whitespace-pre-wrap text-white/80">{activeMessage.content.message}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-white/40">Hashtags</p>
            <p className="text-brand-200">{activeMessage.content.hashtags.join(" ")}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-white/40">CTA</p>
            <p className="text-white/80">{activeMessage.content.cta}</p>
          </div>
        </div>
      )}

      {contextAudit && (
        <ContextAuditModal data={contextAudit} onClose={() => setContextAudit(null)} />
      )}
    </div>
  );
}
