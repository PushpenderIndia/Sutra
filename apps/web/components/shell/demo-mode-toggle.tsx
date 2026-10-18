'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { setDemoMode } from '@/actions/workspace';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Top-bar demo/live switch for the active workspace. Admins (and owners) get a button that opens a
 * confirmation before flipping the mode; everyone else sees a read-only badge. Switching to live
 * runs real prospecting and sends real email, so the confirmation spells out the consequence.
 */
export function DemoModeToggle({ demoMode, canToggle }: { demoMode: boolean; canToggle: boolean }) {
  const t = useTranslations('shell');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const target = !demoMode; // the mode we would switch to

  async function confirm() {
    setPending(true);
    const result = await setDemoMode({ demoMode: target });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.success(target ? t('nowDemo') : t('nowLive'));
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  const badge = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        demoMode
          ? 'border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-400'
          : 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-400'
      }`}
    >
      <span className={`size-1.5 rounded-full ${demoMode ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      {demoMode ? t('demo') : t('live')}
    </span>
  );

  if (!canToggle) {
    return (
      <span className="hidden shrink-0 sm:inline-flex" title={t('onlyAdmins')}>
        {badge}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('switchMode')}
        onClick={() => setOpen(true)}
        className="hidden shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:inline-flex"
      >
        {badge}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target ? t('toDemoTitle') : t('toLiveTitle')}</DialogTitle>
            <DialogDescription>{target ? t('toDemoDesc') : t('toLiveDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
