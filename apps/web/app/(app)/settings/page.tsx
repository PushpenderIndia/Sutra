import { env } from '@sutra/config';
import { Mailboxes } from '@sutra/db';
import { type CheckStatus, type DnsCheck, deliverability } from '@sutra/mail';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ConnectMailbox } from './connect-mailbox';

const BADGE: Record<CheckStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  missing: 'bg-red-100 text-red-800',
};

function Check({ name, check }: { name: string; check: DnsCheck }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`w-16 rounded px-2 py-0.5 text-center text-xs font-medium ${BADGE[check.status]}`}
      >
        {check.status}
      </span>
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-sm text-neutral-500">{check.hint}</p>
      </div>
    </li>
  );
}

/** Mailbox connection and the SPF / DKIM / DMARC setup checklist for the sender's domain. */
export default async function SettingsPage() {
  const session = await getSession();
  const workspaceId = session?.session.activeOrganizationId;
  if (!workspaceId) redirect('/onboarding');
  const mailbox = await Mailboxes.findOne(workspaceId, {});
  const dns = mailbox && !env.FAKE_MAIL ? await deliverability(mailbox.email) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="font-semibold">Mailbox</h2>
        {env.FAKE_MAIL ? (
          <p className="text-sm text-neutral-500">
            Demo mode: sends, opens, clicks and replies are simulated. Nothing leaves Sutra.
          </p>
        ) : mailbox ? (
          <>
            <p>
              Sending from <strong>{mailbox.email}</strong>
              {mailbox.watchExpiresAt ? ' · replies sync automatically' : ''}
            </p>
            <div>
              <ConnectMailbox label="Reconnect" />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Sutra sends from your own Gmail, so replies land in your inbox. It asks for permission
              to send and read mail, and to add meetings to your calendar.
            </p>
            <div>
              <ConnectMailbox />
            </div>
          </>
        )}
      </section>
      {dns && (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="font-semibold">Deliverability for {dns.domain}</h2>
          <ul className="flex flex-col gap-3">
            <Check name="SPF" check={dns.spf} />
            <Check name="DKIM" check={dns.dkim} />
            <Check name="DMARC" check={dns.dmarc} />
          </ul>
        </section>
      )}
    </main>
  );
}
