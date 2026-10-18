import { BusinessProfiles, Icps, WorkspaceSettings } from '@sutra/db';
import type {
  BusinessProfile,
  BusinessProfileDoc,
  CrawlResult,
  Icp,
  IcpDoc,
  Id,
  WebResearchResult,
} from '@sutra/domain';
import { workspaceName } from '@sutra/domain';
import type { NodeContext, NodeResult } from '../pipeline/define.ts';
import { recordStep } from '../pipeline/recorder.ts';
import { untrusted } from '../prompts/base.ts';
import { runAgent } from '../run.ts';
import { profilerDeps } from './deps.ts';

const nextProfileVersion = async (workspaceId: Id) =>
  ((await BusinessProfiles.find(workspaceId, {}, { sort: { version: -1 }, limit: 1 }))[0]
    ?.version ?? 0) + 1;
const nextIcpVersion = async (workspaceId: Id) =>
  ((await Icps.find(workspaceId, {}, { sort: { version: -1 }, limit: 1 }))[0]?.version ?? 0) + 1;

/** Saves a profile as a new draft version; the Business tab shows the latest version. */
export async function saveProfileVersion(
  workspaceId: Id,
  profile: BusinessProfile,
): Promise<BusinessProfileDoc> {
  return BusinessProfiles.create(workspaceId, {
    ...profile,
    status: 'draft',
    version: await nextProfileVersion(workspaceId),
  });
}

/** Saves an ICP as a new draft version. */
export async function saveIcpVersion(workspaceId: Id, value: Icp): Promise<IcpDoc> {
  return Icps.create(workspaceId, {
    ...value,
    status: 'draft',
    version: await nextIcpVersion(workspaceId),
  });
}

const crawlToText = (crawl: CrawlResult): string => {
  const pages = crawl.pages
    .map((p) =>
      [`## ${p.title} — ${p.url}`, p.description, p.headings.join(' · '), p.text]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
  return crawl.logos.length ? `${pages}\n\nCustomer logos: ${crawl.logos.join(', ')}` : pages;
};

const researchToText = (research: WebResearchResult): string =>
  research.findings.map((f) => `- ${f.text} (${f.sourceUrl})`).join('\n') ||
  '(no external findings)';

/**
 * The `profiler` pipeline node: crawl → web research → write profile → build ICP, saving the
 * profile and ICP as they are produced so the Business tab fills in progressively. The run then
 * pauses at the human checkpoint until the user confirms.
 */
export async function runProfiler(ctx: NodeContext): Promise<NodeResult> {
  const { workspaceId, runId } = ctx;
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  const website = settings?.website;
  if (!website) throw new Error('No website configured for this workspace; cannot build a profile');
  const deps = profilerDeps(settings?.demoMode ?? true);

  const crawl = await recordStep(
    'crawler',
    () => deps.crawler.crawl(website),
    (c) => `${c.pages.length} pages${c.usedFallback ? ' (fallback)' : ''}`,
  );
  const research = await recordStep(
    'webResearch',
    () =>
      deps.researcher.research({
        name: workspaceName(website),
        website,
        summary: crawl.pages[0]?.description ?? crawl.pages[0]?.text.slice(0, 200) ?? '',
      }),
    (r) => `${r.findings.length} findings`,
  );

  const profileInput = [
    `Company website: ${website}`,
    `Crawled pages:\n${untrusted(crawlToText(crawl), 'crawl')}`,
    `Web research:\n${untrusted(researchToText(research), 'research')}`,
  ].join('\n\n');
  const { output: profile } = await runAgent({
    agent: deps.profileWriter,
    workspaceId,
    sessionKey: `profiler:profile:${runId}`,
    input: profileInput,
    state: { website },
  });
  await saveProfileVersion(workspaceId, profile);

  const { output: icpValue } = await runAgent({
    agent: deps.icpBuilder,
    workspaceId,
    sessionKey: `profiler:icp:${runId}`,
    input: `Business profile:\n${JSON.stringify(profile, null, 2)}`,
  });
  await saveIcpVersion(workspaceId, icpValue);

  return { summary: profile.name };
}
