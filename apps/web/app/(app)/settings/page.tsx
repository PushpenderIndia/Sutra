import { isDemoMode, Mailboxes } from '@sutra/db';
import { hasRole } from '@sutra/domain';
import { type CheckStatus, type DnsCheck, deliverability, FAKE_USER } from '@sutra/mail';
import { requireWorkspace } from '@/lib/workspace';
import { ConnectMailbox } from './connect-mailbox';
import { DeleteWorkspace } from './delete-workspace';

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
  const { workspaceId, role } = await requireWorkspace();
  const demo = await isDemoMode(workspaceId);
  // In live mode the sending address is the connected Gmail (never the demo `fake` mailbox).
  const mailbox = demo
    ? null
    : await Mailboxes.findOne(workspaceId, { userId: { $ne: FAKE_USER } });
  const dns = mailbox ? await deliverability(mailbox.email) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="font-semibold">Mailbox</h2>
        {demo ? (
          <p className="text-sm text-neutral-500">
            Demo mode: sends, opens, clicks and replies are simulated. Nothing leaves Sutra. Switch
            to live mode from the top bar to send real email, then connect your Gmail here.
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
      {hasRole(role, 'owner') && <DeleteWorkspace />}
    </main>
  );
}
