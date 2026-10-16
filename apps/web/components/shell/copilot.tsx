'use client';
import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { type ChatContext, ChatPanel } from '@/components/shell/chat-panel';
import { Button } from '@/components/ui/button';
import { useSelection } from '@/lib/selection';
import { cn } from '@/lib/utils';

interface ToolResult {
  id: string;
  tool: string;
  result: unknown;
}
interface Pending {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  hint?: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  results: ToolResult[];
  pending?: Pending;
  error?: boolean;
}

type Frame =
  | { type: 'token'; text: string }
  | { type: 'result'; tool: string; result: unknown }
  | { type: 'confirm'; callId: string; tool: string; args: Record<string, unknown>; hint?: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

const uid = () => Math.random().toString(36).slice(2);

/** Reads an SSE body and calls `onFrame` for each `data:` line. */
async function readStream(body: ReadableStream<Uint8Array>, onFrame: (f: Frame) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (data) onFrame(JSON.parse(data) as Frame);
    }
  }
}

/** Companies/leads a read tool returned, so the user can jump to and select them in the main view. */
function selectableRows(result: unknown): { id: string; name: string }[] {
  if (!result || typeof result !== 'object') return [];
  const prospects = (result as { prospects?: unknown }).prospects;
  if (!Array.isArray(prospects)) return [];
  return prospects
    .filter(
      (p): p is { id: string; name: string } => Boolean(p) && typeof p === 'object' && 'id' in p,
    )
    .slice(0, 8)
    .map((p) => ({ id: String(p.id), name: String((p as { name?: unknown }).name ?? p.id) }));
}

/**
 * The chat copilot: streams the agent's answers, shows a confirm card before any mutation runs, and
 * renders read-tool results with links that select rows in the open tab. It is context-aware — every
 * turn carries the active tab and the selected ids, so "why is this a fit?" needs no row named.
 */
export function Copilot() {
  const t = useTranslations('chat');
  const router = useRouter();
  const select = useSelection((s) => s.select);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const streamingId = useRef<string | null>(null);

  const patch = useCallback((id: string, fn: (m: Message) => Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const consume = useCallback(
    async (body: BodyInit, assistantId: string) => {
      streamingId.current = assistantId;
      setBusy(true);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        if (!res.ok || !res.body) {
          patch(assistantId, (m) => ({ ...m, content: t('errorGeneric'), error: true }));
          return;
        }
        await readStream(res.body, (f) => {
          if (f.type === 'token')
            patch(assistantId, (m) => ({ ...m, content: m.content + f.text }));
          else if (f.type === 'result')
            patch(assistantId, (m) => ({
              ...m,
              results: [...m.results, { id: uid(), tool: f.tool, result: f.result }],
            }));
          else if (f.type === 'confirm')
            patch(assistantId, (m) => ({
              ...m,
              pending: { callId: f.callId, tool: f.tool, args: f.args, hint: f.hint },
            }));
          else if (f.type === 'error')
            patch(assistantId, (m) => ({ ...m, content: f.error, error: true }));
        });
      } catch {
        patch(assistantId, (m) => ({ ...m, content: t('errorGeneric'), error: true }));
      } finally {
        setBusy(false);
        streamingId.current = null;
      }
    },
    [patch, t],
  );

  const send = useCallback(
    (text: string, context: ChatContext) => {
      if (busy) return;
      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'user', content: text, results: [] },
        { id: assistantId, role: 'assistant', content: '', results: [] },
      ]);
      const campaignId = context.tab === 'campaigns' ? context.selectedIds[0] : undefined;
      void consume(
        JSON.stringify({
          message: text,
          context: { tab: context.tab, selection: context.selectedIds, campaignId },
        }),
        assistantId,
      );
    },
    [busy, consume],
  );

  const decide = useCallback(
    (message: Message, confirmed: boolean) => {
      if (busy || !message.pending) return;
      const { callId } = message.pending;
      patch(message.id, (m) => ({ ...m, pending: undefined }));
      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', results: [] },
      ]);
      void consume(
        JSON.stringify({ confirm: { callId, confirmed }, context: { selection: [] } }),
        assistantId,
      );
    },
    [busy, consume, patch],
  );

  const jumpTo = useCallback(
    (tab: string, id: string) => {
      select([id]);
      router.push(`/${tab}`);
    },
    [router, select],
  );

  return (
    <ChatPanel onSend={send}>
      {messages.length === 0 ? undefined : (
        <ul className="flex flex-col gap-3" aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={cn('flex flex-col gap-2', m.role === 'user' && 'items-end')}>
              {(m.content || m.role === 'user') && (
                <div
                  className={cn(
                    'max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : m.error
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted',
                  )}
                >
                  {m.content ||
                    (m.id === streamingId.current ? (
                      <Loader2 aria-label={t('thinking')} className="size-4 animate-spin" />
                    ) : null)}
                </div>
              )}

              {m.results.map((r) => {
                const rows = selectableRows(r.result);
                return (
                  <div key={r.id} className="w-full rounded-lg border bg-card p-2 text-xs">
                    <p className="mb-1 font-medium text-muted-foreground">{r.tool}</p>
                    {rows.length > 0 ? (
                      <ul className="flex flex-wrap gap-1">
                        {rows.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => jumpTo('prospects', row.id)}
                              className="rounded-md border px-2 py-0.5 hover:bg-accent"
                            >
                              {row.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
                        {JSON.stringify(r.result, null, 1).slice(0, 600)}
                      </pre>
                    )}
                  </div>
                );
              })}

              {m.pending && (
                <div className="w-full rounded-lg border border-saffron/40 bg-saffron/10 p-3 text-sm">
                  <p className="font-medium">{m.pending.hint ?? t('confirmPrompt')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.pending.tool}
                    {Object.keys(m.pending.args).length > 0 &&
                      ` · ${JSON.stringify(m.pending.args).slice(0, 160)}`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => decide(m, true)}>
                      <Check aria-hidden /> {t('confirm')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => decide(m, false)}
                    >
                      <X aria-hidden /> {t('cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </ChatPanel>
  );
}
