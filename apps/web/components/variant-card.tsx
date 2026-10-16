'use client';
import type { Locale } from '@sutra/domain';
import { Crown, ExternalLink, Eye, Pencil, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { editVariant, previewVariant } from '@/actions/campaigns';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CampaignView } from '@/lib/data/campaigns';
import { percent } from '@/lib/format';
import { cn } from '@/lib/utils';

type Variant = CampaignView['steps'][number]['variants'][number];

interface Preview {
  locale: Locale;
  subject: string;
  body: string;
  personalizationSource?: string;
  contact?: { name: string };
}

/**
 * One A/B variant card: subject, body, the A/B hypothesis and the single dimension under test, plus
 * a locale switcher, an inline editor, and a sample-contact preview that renders the real email with
 * a grounded, cited personalisation line.
 */
export function VariantCard({
  campaignId,
  stepIndex,
  variant,
  locales,
  onChanged,
}: {
  campaignId: string;
  stepIndex: number;
  variant: Variant;
  locales: Locale[];
  onChanged: () => void;
}) {
  const t = useTranslations('campaigns');
  const languages = new Intl.DisplayNames([useLocale()], { type: 'language' });
  const [view, setView] = useState<Locale>('en');
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, start] = useTransition();

  // The template shown for the selected locale (English is the source; others are translations).
  const shown =
    view === 'en' ? { subject: variant.subject, body: variant.body } : variant.translations[view];

  const runPreview = (locale: Locale) => {
    start(async () => {
      const res = await previewVariant({ campaignId, stepIndex, variantId: variant.id, locale });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPreview(res.data);
    });
  };

  const switchLocale = (locale: Locale) => {
    setView(locale);
    setPreview(null);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-secondary font-semibold">
          {variant.letter}
        </span>
        <Badge variant="outline">{t(`dimensions.${variant.dimension}`)}</Badge>
        {variant.origin === 'optimizer' && (
          <Sparkles aria-label={t('optimizer')} className="size-3.5 text-saffron-ink" />
        )}
        {variant.winner && <Crown aria-label={t('winner')} className="size-3.5 text-saffron-ink" />}
        <StatusBadge status={variant.status} />
        {variant.flags.length > 0 && (
          <Badge variant="destructive" title={variant.flags.join('\n')}>
            {t('flagged', { count: variant.flags.length })}
          </Badge>
        )}
      </div>

      {editing ? (
        <VariantEditor
          variant={variant}
          view={view}
          campaignId={campaignId}
          stepIndex={stepIndex}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{variant.hypothesis}</p>
          <div className="flex flex-col gap-1">
            <p className="font-medium">{(preview ?? shown)?.subject}</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {(preview ?? shown)?.body ?? t('noTranslation')}
            </p>
          </div>
          {preview?.personalizationSource && (
            <a
              href={preview.personalizationSource}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-info"
            >
              <ExternalLink className="size-3" />
              {t('personalizationSource')}
            </a>
          )}
        </>
      )}

      {/* Locale switcher — preview the Bahasa / other translations. */}
      {locales.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {(['en', ...locales] as Locale[]).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={view === l ? 'secondary' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => switchLocale(l)}
            >
              {languages.of(l) ?? l}
            </Button>
          ))}
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => runPreview(view)}>
            <Eye className="size-3.5" />
            {preview?.contact ? t('previewFor', { name: preview.contact.name }) : t('preview')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            {t('edit')}
          </Button>
        </div>
      )}

      <dl
        className={cn(
          'grid grid-cols-4 gap-2 border-t pt-2 text-center text-xs',
          variant.stats.sent === 0 && 'text-muted-foreground',
        )}
      >
        <Stat label={t('sent')} value={variant.stats.sent} />
        <Stat label={t('opens')} value={`≈${variant.stats.opens}`} />
        <Stat label={t('clicks')} value={variant.stats.clicks} />
        <Stat
          label={t('replyRate')}
          value={percent(variant.stats.replies, variant.stats.sent)}
          hint={
            variant.stats.sent > 0
              ? t('band', {
                  low: Math.round(variant.replyBand.low * 100),
                  high: Math.round(variant.replyBand.high * 100),
                })
              : undefined
          }
        />
      </dl>

      {/* Bandit analysis: P(best) and current traffic share, honest about small samples. */}
      {variant.status === 'active' && (
        <div className="flex flex-col gap-1 text-xs">
          {variant.enoughData ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('pBest')}</span>
                <span className="font-medium tabular-nums">{Math.round(variant.pBest * 100)}%</span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={Math.round(variant.pBest * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('pBest')}
              >
                <div
                  className="h-full rounded-full bg-saffron-ink"
                  style={{ width: `${Math.round(variant.pBest * 100)}%` }}
                />
              </div>
              <span className="text-muted-foreground">
                {t('trafficShare', { share: Math.round(variant.trafficShare * 100) })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('notEnoughData')}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex flex-col">
      <dd className="font-medium tabular-nums">{value}</dd>
      <dt className="text-muted-foreground">{label}</dt>
      {hint && <dd className="text-[10px] text-muted-foreground tabular-nums">{hint}</dd>}
    </div>
  );
}

function VariantEditor({
  variant,
  view,
  campaignId,
  stepIndex,
  onDone,
  onCancel,
}: {
  variant: Variant;
  view: Locale;
  campaignId: string;
  stepIndex: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('campaigns');
  const current =
    view === 'en' ? { subject: variant.subject, body: variant.body } : variant.translations[view];
  const [subject, setSubject] = useState(current?.subject ?? '');
  const [body, setBody] = useState(current?.body ?? '');
  const [pending, start] = useTransition();

  const save = () => {
    start(async () => {
      const res = await editVariant({
        campaignId,
        stepIndex,
        variantId: variant.id,
        subject,
        body,
        ...(view !== 'en' && { locale: view }),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onDone();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
      <p className="text-xs text-muted-foreground">{t('mergeHint')}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
