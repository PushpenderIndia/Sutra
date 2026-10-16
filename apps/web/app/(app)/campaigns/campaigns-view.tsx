'use client';
import type { Locale } from '@sutra/domain';
import {
  CalendarClock,
  Check,
  Eye,
  Lightbulb,
  Mail,
  Megaphone,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  Reply,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  approveCampaign,
  approveSuggestedVariant,
  pauseCampaign,
  regenerateVariants,
  rejectSuggestedVariant,
  resumeCampaign,
} from '@/actions/campaigns';
import { Checkpoint } from '@/components/checkpoint';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCards } from '@/components/stat-cards';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { VariantCard } from '@/components/variant-card';
import type { CampaignView, SuggestedVariant } from '@/lib/data/campaigns';
import { percent } from '@/lib/format';

type Step = CampaignView['steps'][number];
type Approval = CampaignView['approval'];

/** "Asia/Jakarta" 09:12 → "Jakarta 09:12 WIB" in that zone. */
function zoneTime(iso: string, timezone: string): string {
  const city = (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
  return `${city} ${time}`;
}

const sum = (c: CampaignView, k: keyof Step['variants'][number]['stats']) =>
  c.steps.reduce((n, s) => n + s.variants.reduce((m, v) => m + v.stats[k], 0), 0);

export function CampaignsView({ campaigns }: { campaigns: CampaignView[] }) {
  const t = useTranslations('campaigns');

  if (!campaigns.length) {
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <EmptyState icon={Megaphone} title={t('emptyTitle')} description={t('emptyHint')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {campaigns.map((c) => {
        const sent = sum(c, 'sent');
        return (
          <section key={c.id} aria-labelledby={`c-${c.id}`} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`c-${c.id}`} className="text-base font-semibold">
                {c.name}
              </h2>
              <StatusBadge status={c.status} />
              {c.persona && <Badge variant="outline">{c.persona}</Badge>}
              {c.suggested.length > 0 && (
                <Badge className="gap-1 bg-saffron text-saffron-ink">
                  <Sparkles className="size-3" />
                  {t('suggestedCount', { count: c.suggested.length })}
                </Badge>
              )}
              <CampaignControls id={c.id} status={c.status} />
            </div>
            <ApprovalPanel campaign={c} />
            {c.insights.length > 0 && <Insights items={c.insights} />}
            {c.suggested.length > 0 && (
              <SuggestedVariants campaignId={c.id} suggestions={c.suggested} />
            )}
            <StatCards
              label={c.name}
              items={[
                { key: 'sent', label: t('sent'), value: sent, icon: Send },
                {
                  key: 'opens',
                  label: t('opensApprox'),
                  value: `≈${sum(c, 'opens')}`,
                  icon: Eye,
                  tone: 'muted',
                  hint: t('opensHint'),
                },
                {
                  key: 'clicks',
                  label: t('clicks'),
                  value: sum(c, 'clicks'),
                  icon: MousePointerClick,
                  tone: 'info',
                  hint: percent(sum(c, 'clicks'), sent),
                },
                {
                  key: 'replies',
                  label: t('replies'),
                  value: sum(c, 'replies'),
                  icon: Reply,
                  tone: 'accent',
                  hint: t('rate', { rate: percent(sum(c, 'replies'), sent) }),
                },
              ]}
            />
            <ol className="flex flex-col gap-4">
              {c.steps.map((s) => (
                <StepBlock key={s.index} campaignId={c.id} step={s} locales={c.locales} />
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}

/**
 * Checkpoint 2 for one campaign: audience, the PR 10 compliance dry run, the timezone-aware schedule
 * preview, the warm-up ramp and the Gmail-connect prompt. "Approve" (owner/admin) stamps the content
 * hash and resumes the pipeline; nothing is sent until then.
 */
function ApprovalPanel({ campaign: c }: { campaign: CampaignView }) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [pending, start] = useTransition();
  const a: Approval = c.approval;
  const awaiting = c.status === 'draft' || c.status === 'pending_approval';
  const confirmed = !awaiting && a.pending === 0;

  const approve = () =>
    new Promise<void>((resolve) => {
      start(async () => {
        const res = await approveCampaign({ campaignId: c.id });
        if (!res.ok) toast.error(res.error);
        else {
          const { enrolled } = res.data;
          toast.success(enrolled ? t('approvedEnrolled', { count: enrolled }) : t('approved'));
          router.refresh();
        }
        resolve();
      });
    });

  return (
    <Checkpoint
      title={t('checkpoint')}
      confirmed={confirmed}
      confirmLabel={pending ? t('approving') : t('approve')}
      onConfirm={confirmed ? undefined : approve}
      summary={
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" aria-hidden />
            <Link href="/prospects" className="underline-offset-2 hover:underline">
              {t('audience', { count: a.audience })}
            </Link>
            <span className="text-muted-foreground">
              ·{' '}
              {t('sequenceSummary', {
                steps: c.steps.length,
                variants: c.steps.flatMap((s) => s.variants).length,
              })}
            </span>
          </span>
          {a.pending > 0 && <span>{t('pendingVariants', { count: a.pending })}</span>}
          {a.compliance && (
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
              {a.compliance.text}
            </span>
          )}
          {a.schedule && a.schedule.length > 0 && (
            <span className="inline-flex items-start gap-1.5">
              <CalendarClock className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
              <span>
                {a.schedule
                  .slice(0, 4)
                  .map((s) => zoneTime(s.first, s.timezone))
                  .join(' · ')}
                {a.warmup && a.warmup.length > 0 && (
                  <span className="text-muted-foreground">
                    {' — '}
                    {t('warmupRamp', {
                      today: a.warmup[0]?.cap ?? 0,
                      tomorrow: a.warmup[1]?.cap ?? 0,
                    })}
                  </span>
                )}
              </span>
            </span>
          )}
          {!a.mailboxConnected && (
            <span className="inline-flex items-center gap-1.5 text-saffron">
              <Mail className="size-3.5 shrink-0" aria-hidden />
              <Link href="/settings" className="underline-offset-2 hover:underline">
                {t('connectMailbox')}
              </Link>
            </span>
          )}
        </div>
      }
    />
  );
}

/** Pause / resume a running campaign (also available via chat). */
function CampaignControls({ id, status }: { id: string; status: CampaignView['status'] }) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [pending, start] = useTransition();
  if (status !== 'running' && status !== 'paused') return null;

  const toggle = () =>
    start(async () => {
      const res = await (status === 'running' ? pauseCampaign : resumeCampaign)({ campaignId: id });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  const Icon = status === 'running' ? Pause : Play;
  return (
    <Button
      size="sm"
      variant="outline"
      className="ml-auto h-7 px-2 text-xs"
      disabled={pending}
      onClick={toggle}
    >
      <Icon className="size-3.5" />
      {status === 'running' ? t('pause') : t('resume')}
    </Button>
  );
}

/** One step in the vertical timeline: its heading, the A | B variant cards, and regenerate. */
function StepBlock({
  campaignId,
  step,
  locales,
}: {
  campaignId: string;
  step: Step;
  locales: Locale[];
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const regenerate = () => {
    start(async () => {
      const res = await regenerateVariants({
        campaignId,
        stepIndex: step.index,
        note: note || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setNote(null);
      router.refresh();
    });
  };

  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-medium">
          {t('step', { n: step.index + 1 })}
          {step.intent && (
            <span className="text-muted-foreground"> · {t(`intents.${step.intent}`)}</span>
          )}
        </h3>
        <span className="text-xs text-muted-foreground">
          {step.delayDays ? t('delay', { days: step.delayDays }) : t('immediately')}
          {step.angle && ` · ${step.angle}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-xs"
          onClick={() => setNote((n) => (n === null ? '' : null))}
        >
          <RefreshCw className="size-3.5" />
          {t('regenerate')}
        </Button>
      </div>

      {note !== null && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('regenerateNote')}
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNote(null)}>
              {t('cancel')}
            </Button>
            <Button size="sm" disabled={pending} onClick={regenerate}>
              {pending ? t('regenerating') : t('regenerate')}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {step.variants.map((v) => (
          <VariantCard
            key={v.id}
            campaignId={campaignId}
            stepIndex={step.index}
            variant={v}
            locales={locales}
            onChanged={() => router.refresh()}
          />
        ))}
      </div>
    </li>
  );
}

/** The optimizer's insights for a campaign — each already cites the numbers behind it. */
function Insights({ items }: { items: CampaignView['insights'] }) {
  const t = useTranslations('campaigns');
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
      <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Lightbulb className="size-3.5 text-saffron-ink" aria-hidden />
        {t('insights')}
      </h3>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {items.map((insight) => (
          <li key={insight.text}>{insight.text}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The approval queue for optimizer-suggested challengers (PR 15). Each shows the current best arm vs
 * the challenger, the hypothesis, the data it is based on and the traffic it would get. Nothing here
 * has been sent — Approve (owner/admin) activates it so the bandit starts exploring; Reject drops it.
 */
function SuggestedVariants({
  campaignId,
  suggestions,
}: {
  campaignId: string;
  suggestions: SuggestedVariant[];
}) {
  const t = useTranslations('campaigns');
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-saffron/50 bg-saffron/5 p-3">
      <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-3.5 text-saffron-ink" aria-hidden />
        {t('suggestedCount', { count: suggestions.length })}
      </h3>
      <div className="flex flex-col gap-3">
        {suggestions.map((s) => (
          <Suggestion key={s.variantId} campaignId={campaignId} suggestion={s} />
        ))}
      </div>
    </div>
  );
}

function Suggestion({
  campaignId,
  suggestion: s,
}: {
  campaignId: string;
  suggestion: SuggestedVariant;
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [pending, start] = useTransition();

  const approve = () =>
    start(async () => {
      const res = await approveSuggestedVariant({
        campaignId,
        stepIndex: s.stepIndex,
        variantId: s.variantId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.tooManyArms) toast.error(t('tooManyArms'));
      else {
        toast.success(t('suggestionApproved'));
        router.refresh();
      }
    });

  const reject = () =>
    start(async () => {
      const res = await rejectSuggestedVariant({
        campaignId,
        stepIndex: s.stepIndex,
        variantId: s.variantId,
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(t('suggestionRejected'));
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t('step', { n: s.stepIndex + 1 })}</span>
        <Badge variant="outline">{t(`dimensions.${s.dimension}`)}</Badge>
        {s.flags.length > 0 && (
          <Badge variant="destructive" title={s.flags.join('\n')}>
            {t('flagged', { count: s.flags.length })}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{s.hypothesis}</p>

      <div className="grid gap-2 text-sm md:grid-cols-2">
        {s.best && (
          <div className="rounded-md border bg-muted/30 p-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('currentBest', { letter: s.best.letter })}
            </p>
            <p className="font-medium">{s.best.subject}</p>
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{s.best.body}</p>
          </div>
        )}
        <div className="rounded-md border border-saffron/50 p-2">
          <p className="text-xs font-medium text-saffron-ink">{t('challenger')}</p>
          <p className="font-medium">{s.subject}</p>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{s.body}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {s.best && t('basedOn', { sends: s.best.sends, replies: s.best.replies })}
        {' · '}
        {t('expectedShare', { share: Math.round(s.expectedShare * 100) })}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={approve}>
          <Check className="size-3.5" />
          {t('approveVariant')}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={reject}>
          <X className="size-3.5" />
          {t('rejectVariant')}
        </Button>
      </div>
    </div>
  );
}
