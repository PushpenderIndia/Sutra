'use client';
import type {
  campaignStatus,
  companyStatus,
  contactStatus,
  enrollmentStatus,
  fit,
  messageStatus,
  pipelineNodeStatus,
  pipelineRunStatus,
  profileStatus,
  replyIntent,
  variantStatus,
} from '@sutra/domain';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { TONES, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

/** Every status (and reply intent / fit) value in the domain. */
export type AnyStatus = z.infer<
  | typeof contactStatus
  | typeof campaignStatus
  | typeof variantStatus
  | typeof enrollmentStatus
  | typeof messageStatus
  | typeof companyStatus
  | typeof profileStatus
  | typeof pipelineRunStatus
  | typeof pipelineNodeStatus
  | typeof replyIntent
  | typeof fit
>;

/** One map for every status enum: the same word always has the same colour. */
export const STATUS_TONE: Record<AnyStatus, Tone> = {
  new: 'info',
  excluded: 'muted',
  contacted: 'neutral',
  engaged: 'info',
  interested: 'success',
  not_now: 'warning',
  not_interested: 'danger',
  meeting_booked: 'accent',
  suppressed: 'muted',
  draft: 'muted',
  pending_approval: 'warning',
  approved: 'info',
  running: 'accent',
  paused: 'warning',
  done: 'success',
  active: 'success',
  rejected: 'danger',
  retired: 'muted',
  stopped: 'muted',
  completed: 'success',
  queued: 'neutral',
  sent: 'info',
  failed: 'danger',
  bounced: 'danger',
  cancelled: 'muted',
  received: 'success',
  confirmed: 'success',
  enriched: 'info',
  scored: 'success',
  disqualified: 'danger',
  waiting_human: 'warning',
  skipped: 'muted',
  meeting_request: 'accent',
  question: 'info',
  objection: 'warning',
  unsubscribe: 'danger',
  out_of_office: 'muted',
  wrong_person: 'muted',
  referral: 'info',
  other: 'neutral',
  strong: 'success',
  medium: 'warning',
  weak: 'muted',
};

export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
  const t = useTranslations('status');
  return (
    <Badge className={cn('font-medium', TONES[STATUS_TONE[status]].badge, className)}>
      {t(status)}
    </Badge>
  );
}
