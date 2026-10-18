'use client';
import { useState } from 'react';
import { deleteWorkspace } from '@/actions/workspace';
import { useWorkspace } from '@/lib/auth-client';

/**
 * Owner-only danger zone: permanently deletes the workspace and all of its data. The button is
 * armed only once the owner types the workspace name exactly, so it can't be clicked by accident.
 * On success the action redirects, so control returns here only on failure.
 */
export function DeleteWorkspace() {
  const { workspace } = useWorkspace();
  const name = workspace?.name ?? '';
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const armed = name.length > 0 && confirm.trim() === name;

  async function onDelete() {
    if (!armed || pending) return;
    setPending(true);
    setError(undefined);
    const result = await deleteWorkspace({});
    if (result && !result.ok) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-red-200 p-5 dark:border-red-900/60">
      <h2 className="font-semibold text-red-700 dark:text-red-400">Delete workspace</h2>
      <p className="text-sm text-neutral-500">
        Permanently deletes <strong>{name || 'this workspace'}</strong> and everything in it —
        companies, contacts, campaigns, messages, replies and settings. This cannot be undone. Type{' '}
        <strong>{name}</strong> to confirm.
      </p>
      <input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={name}
        aria-label="Type the workspace name to confirm"
        className="w-full max-w-sm rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div>
        <button
          type="button"
          onClick={onDelete}
          disabled={!armed || pending}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Deleting…' : 'Delete this workspace'}
        </button>
      </div>
    </section>
  );
}
