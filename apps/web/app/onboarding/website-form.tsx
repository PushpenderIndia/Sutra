'use client';
import { useActionState } from 'react';
import { createWorkspace } from '@/actions/workspace';

export function WebsiteForm() {
  const [result, submit, pending] = useActionState((_: unknown, form: FormData) => {
    form.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    return createWorkspace(form);
  }, null);
  return (
    <form action={submit} className="flex w-full max-w-md flex-col gap-3">
      <div className="flex gap-2">
        <input
          name="website"
          placeholder="acme.com"
          required
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {pending ? 'Starting…' : 'Start'}
        </button>
      </div>
      {result && !result.ok && <p className="text-sm text-red-600">{result.error}</p>}
    </form>
  );
}
