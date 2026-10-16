'use client';
import { ArrowUp, MousePointerClick, PanelRightClose, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { type Selection, useSelection } from '@/lib/selection';
import { useShell } from '@/lib/shell';
import { useIsMobile } from '@/lib/use-media-query';

export type ChatContext = Pick<Selection, 'tab' | 'selectedIds'>;

/**
 * The chat sidebar frame: header, the current tab + selection as context, a message area and
 * a composer. PR 16 plugs in the copilot via `onSend` (and renders its messages as
 * `children`); until then the composer is disabled and suggestions are shown.
 */
export function ChatPanel({
  onSend,
  children,
}: {
  onSend?: (text: string, context: ChatContext) => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('chat');
  const tabs = useTranslations('tabs');
  const { tab, selectedIds } = useSelection();
  const setChatOpen = useShell((s) => s.setChatOpen);
  const mobile = useIsMobile();
  const [text, setText] = useState('');
  const ready = Boolean(onSend);

  function send(value = text) {
    if (!onSend || !value.trim()) return;
    onSend(value.trim(), { tab, selectedIds });
    setText('');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Sparkles aria-hidden className="size-4 text-saffron-ink" />
        <h2 className="font-medium">{t('title')}</h2>
        {!ready && (
          <Badge variant="outline" className="text-muted-foreground">
            {t('soon')}
          </Badge>
        )}
        {!mobile && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={t('collapse')}
            onClick={() => setChatOpen(false)}
          >
            <PanelRightClose />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {children ?? (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="text-base font-medium">{t('welcome')}</p>
              <p className="text-muted-foreground">{t('intro')}</p>
            </div>
            {tab && (
              <ul className="flex flex-col gap-2" aria-label={t('suggestions')}>
                {(['s1', 's2', 's3'] as const).map((key) => {
                  const prompt = t(`prompts.${tab}.${key}`);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        disabled={!ready}
                        onClick={() => send(prompt)}
                        className="w-full rounded-lg border bg-card px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-card"
                      >
                        {prompt}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <form
        className="flex shrink-0 flex-col gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span>{t('context')}</span>
          {tab && <Badge variant="secondary">{tabs(tab)}</Badge>}
          {selectedIds.length > 0 ? (
            <Badge className="bg-saffron/15 text-saffron-ink">
              <MousePointerClick aria-hidden />
              {t('selected', { count: selectedIds.length })}
            </Badge>
          ) : (
            <span>{t('nothingSelected')}</span>
          )}
        </div>
        <InputGroup>
          <InputGroupTextarea
            aria-label={t('placeholder')}
            placeholder={ready ? t('placeholder') : t('placeholderSoon')}
            disabled={!ready}
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-full"
              aria-label={t('send')}
              disabled={!ready || !text.trim()}
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
