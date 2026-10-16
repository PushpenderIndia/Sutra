'use client';
import {
  type BusinessProfileDoc,
  businessProfile,
  type IcpDoc,
  icp as icpSchema,
} from '@sutra/domain';
import { ExternalLink, Quote } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { confirmProfile, saveIcp, saveProfile } from '@/actions/business';
import { Checkpoint } from '@/components/checkpoint';
import { EditableCard } from '@/components/editable-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Result } from '@/lib/action';

const companyFields = businessProfile.pick({
  oneLiner: true,
  toneOfVoice: true,
  differentiators: true,
});
const targetingFields = icpSchema.pick({
  buyingSignals: true,
  disqualifiers: true,
  rationale: true,
});

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <li key={i}>
          <Badge variant="secondary">{i}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/** Checkpoint 1 plus the editable profile, ICP and personas. */
export function BusinessView({ profile, icp }: { profile: BusinessProfileDoc; icp?: IcpDoc }) {
  const t = useTranslations('business');
  const router = useRouter();
  const regions = new Intl.DisplayNames([useLocale()], { type: 'region' });

  /** Awaits a save/confirm action, surfaces any error and refreshes the server-rendered tab. */
  const run = async <O,>(action: Promise<Result<O>>) => {
    const result = await action;
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    router.refresh();
  };

  return (
    <>
      <PageHeader
        title={profile.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={profile.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              {host(profile.website)}
              <ExternalLink aria-hidden className="size-3" />
            </a>
            <span aria-hidden>·</span>
            {t('version', { version: profile.version })}
            <StatusBadge status={profile.status} />
          </span>
        }
      />
      <Checkpoint
        title={t('checkpoint')}
        summary={t('checkpointHint')}
        confirmed={profile.status === 'confirmed'}
        onConfirm={() => run(confirmProfile({}))}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <EditableCard
          title={t('company')}
          schema={companyFields}
          value={profile}
          onSave={(value) => run(saveProfile(value))}
          labels={{
            oneLiner: t('oneLiner'),
            toneOfVoice: t('tone'),
            differentiators: t('differentiators'),
          }}
        >
          <dl className="flex flex-col gap-4">
            <Term label={t('oneLiner')}>
              <p className="text-base text-pretty">{profile.oneLiner}</p>
            </Term>
            <Term label={t('geographies')}>
              <Chips items={profile.geographies.map((c) => regions.of(c) ?? c)} />
            </Term>
            <Term label={t('differentiators')}>
              <Chips items={profile.differentiators} />
            </Term>
            <Term label={t('tone')}>
              <p>{profile.toneOfVoice}</p>
            </Term>
          </dl>
        </EditableCard>

        <Card>
          <CardHeader>
            <CardTitle>{t('offerings')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {profile.offerings.map((o) => (
                <li key={o.name} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex items-center gap-2 font-medium">
                    {o.name}
                    {o.pricingHint && <Badge variant="outline">{o.pricingHint}</Badge>}
                  </span>
                  <span className="text-muted-foreground">{o.description}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('proof')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {profile.proofPoints.map((p) => (
                <li key={p.text} className="flex gap-2">
                  <Quote aria-hidden className="mt-0.5 size-3.5 shrink-0 text-saffron-ink" />
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {p.text}
                  </a>
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-4">
              <Term label={t('customers')}>
                <Chips items={profile.customers.map((c) => c.name)} />
              </Term>
              {profile.competitors.length > 0 && (
                <Term label={t('competitors')}>
                  <Chips items={profile.competitors.map((c) => c.name)} />
                </Term>
              )}
            </dl>
          </CardContent>
        </Card>

        {icp && (
          <Card>
            <CardHeader>
              <CardTitle>{t('icp')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Term label={t('industries')}>
                  <Chips items={icp.firmographics.industries} />
                </Term>
                <Term label={t('countries')}>
                  <Chips items={icp.firmographics.countries.map((c) => regions.of(c) ?? c)} />
                </Term>
                <Term label={t('sizes')}>
                  <Chips items={icp.firmographics.sizes.map((s) => t('employees', { size: s }))} />
                </Term>
                <Term label={t('keywords')}>
                  <Chips items={icp.firmographics.keywords} />
                </Term>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      {icp && (
        <>
          <section aria-labelledby="personas" className="flex flex-col gap-3">
            <h2 id="personas" className="text-base font-semibold">
              {t('personas')}
            </h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {icp.personas.map((p) => (
                <li key={p.title}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle>{p.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="grid gap-4 sm:grid-cols-3">
                        <Term label={t('pains')}>
                          <ul className="list-disc space-y-1 pl-4">
                            {p.pains.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        </Term>
                        <Term label={t('goals')}>
                          <ul className="list-disc space-y-1 pl-4">
                            {p.goals.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        </Term>
                        <Term label={t('objections')}>
                          <ul className="list-disc space-y-1 pl-4">
                            {p.objections.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        </Term>
                      </dl>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
          <EditableCard
            title={t('targeting')}
            schema={targetingFields}
            value={icp}
            onSave={(value) => run(saveIcp(value))}
            labels={{
              buyingSignals: t('signals'),
              disqualifiers: t('disqualifiers'),
              rationale: t('rationale'),
            }}
          >
            <dl className="grid gap-4 md:grid-cols-3">
              <Term label={t('signals')}>
                <Chips items={icp.buyingSignals} />
              </Term>
              <Term label={t('disqualifiers')}>
                <Chips items={icp.disqualifiers} />
              </Term>
              <Term label={t('rationale')}>
                <p className="text-pretty">{icp.rationale}</p>
              </Term>
            </dl>
          </EditableCard>
        </>
      )}
    </>
  );
}
