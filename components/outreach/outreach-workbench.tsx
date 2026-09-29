"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Eye, Pencil, RefreshCw, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cancelMessageAction,
  generateMessageAction,
  regenerateMessageAction,
  scheduleMessageAction,
  updateMessageAction,
} from "@/app/dashboard/outreach/actions";

interface Choice {
  id: string;
  name: string;
}
interface MessageRow {
  id: string;
  creator: string;
  product: string;
  template: string;
  status: string;
  scheduledFor: string | null;
  generatedText: string;
}

interface Props {
  messages: MessageRow[];
  creators: Choice[];
  products: Choice[];
  campaigns: Choice[];
  templates: Choice[];
  canManage: boolean;
  canCancel: boolean;
}

function localDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";
}

export function OutreachWorkbench(props: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(props.messages.map((message) => [message.id, message.generatedText])),
  );
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setFeedback("");
    startTransition(async () => {
      const result = await task();
      setFeedback(result.ok ? "Ação concluída." : (result.error ?? "Erro inesperado."));
    });
  }

  return (
    <div className="space-y-4">
      {props.canManage && props.creators.length > 0 && props.templates.length > 0 && (
        <form
          className="grid gap-3 rounded-xl border border-surface-700 bg-surface-900/50 p-4 md:grid-cols-5"
          action={(formData) => run(() => generateMessageAction(Object.fromEntries(formData)))}
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
            name="templateId"
            className="rounded-lg border border-surface-700 bg-surface-900 px-3 text-sm"
            required
          >
            {props.templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Button disabled={pending}>Gerar mensagem</Button>
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
              {["Creator", "Produto", "Template", "Status", "Agendamento", "Ações"].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800">
            {props.messages.map((message) => (
              <tr key={message.id} className="align-top">
                <td className="px-4 py-3 font-medium text-white">{message.creator}</td>
                <td className="px-4 py-3 text-white/70">{message.product}</td>
                <td className="px-4 py-3 text-white/70">{message.template}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-brand-600/15 px-2 py-1 text-xs text-brand-200">
                    {message.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-white/60">{localDate(message.scheduledFor)}</td>
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
                    {props.canManage && ["DRAFT", "READY"].includes(message.status) && (
                      <Button size="sm" variant="ghost" onClick={() => setActive(message.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                    )}
                    {props.canManage && ["DRAFT", "READY"].includes(message.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const date = new Date(Date.now() + 86_400_000);
                          run(() => scheduleMessageAction({ id: message.id, scheduledFor: date }));
                        }}
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                        Agendar
                      </Button>
                    )}
                    {props.canCancel &&
                      ["DRAFT", "READY", "SCHEDULED"].includes(message.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(() => cancelMessageAction(message.id))}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancelar
                        </Button>
                      )}
                  </div>
                  {active === message.id && (
                    <div className="mt-3 w-[520px] max-w-[75vw] space-y-2 rounded-lg border border-surface-700 bg-surface-950 p-3">
                      <textarea
                        aria-label="Editor de mensagem"
                        readOnly={!props.canManage || !["DRAFT", "READY"].includes(message.status)}
                        value={drafts[message.id] ?? ""}
                        onChange={(event) =>
                          setDrafts({ ...drafts, [message.id]: event.target.value })
                        }
                        className="min-h-36 w-full resize-y rounded-lg border border-surface-700 bg-surface-900 p-3 text-sm text-white"
                      />
                      <div className="flex items-center justify-between text-xs text-white/40">
                        <span>Preview em tempo real</span>
                        <span>{(drafts[message.id] ?? "").length} caracteres</span>
                      </div>
                      {props.canManage && ["DRAFT", "READY"].includes(message.status) && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                updateMessageAction({
                                  id: message.id,
                                  generatedText: drafts[message.id],
                                }),
                              )
                            }
                          >
                            <Save className="h-3.5 w-3.5" />
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const result = await regenerateMessageAction(message.id);
                                if (result.ok && result.data)
                                  setDrafts({ ...drafts, [message.id]: result.data.text });
                                setFeedback(
                                  result.ok
                                    ? "Mensagem gerada novamente."
                                    : (result.error ?? "Erro."),
                                );
                              })
                            }
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Gerar novamente
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {props.messages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/40">
                  Nenhuma mensagem na outbox.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
