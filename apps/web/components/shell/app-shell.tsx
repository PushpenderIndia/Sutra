'use client';
import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useShell } from '@/lib/shell';
import { useIsMobile } from '@/lib/use-media-query';

const CHAT_WIDTH = 360;

/**
 * The one screen: `header` on top, `children` (tab nav + content) on the left, `chat` on the
 * right. On desktop the chat is a resizable, collapsible panel (360px by default); on mobile
 * it is a bottom sheet behind a floating button.
 */
export function AppShell({
  header,
  chat,
  children,
}: {
  header: React.ReactNode;
  chat: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('chat');
  const mobile = useIsMobile();
  const { chatOpen, setChatOpen } = useShell();
  const panel = usePanelRef();
  const [sheetOpen, setSheetOpen] = useState(false);
  const width = useRef(CHAT_WIDTH);

  useEffect(() => {
    const p = panel.current;
    if (!p || p.isCollapsed() === !chatOpen) return;
    if (chatOpen) p.resize(width.current);
    else p.collapse();
  }, [chatOpen, panel]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {header}
      {mobile ? (
        <>
          <main id="main" className="min-h-0 flex-1 overflow-y-auto pb-16">
            {children}
          </main>
          <Button
            size="lg"
            className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
            onClick={() => setSheetOpen(true)}
          >
            <MessageCircle aria-hidden />
            {t('open')}
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom" className="h-[85dvh] gap-0 rounded-t-2xl p-0">
              <SheetTitle className="sr-only">{t('title')}</SheetTitle>
              <SheetDescription className="sr-only">{t('description')}</SheetDescription>
              {chat}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="content-panel" minSize={480}>
            <main id="main" className="h-full overflow-y-auto">
              {children}
            </main>
          </ResizablePanel>
          <ResizableHandle withHandle aria-label={t('resize')} />
          <ResizablePanel
            id="chat-panel"
            panelRef={panel}
            defaultSize={chatOpen ? CHAT_WIDTH : 0}
            minSize={300}
            maxSize={560}
            collapsible
            collapsedSize={0}
            onResize={(size) => {
              const open = size.inPixels > 0;
              if (open) width.current = size.inPixels;
              if (open !== useShell.getState().chatOpen) setChatOpen(open);
            }}
          >
            <aside aria-label={t('title')} className="h-full border-l bg-sidebar">
              {chat}
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
