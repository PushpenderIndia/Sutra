import 'server-only';
import { hasRole, type Id, type Role, topRole } from '@sutra/domain';
import { headers as requestHeaders } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { auth, type Session } from '@/lib/auth';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_WORKSPACE'
  | 'FORBIDDEN'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'ERROR';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NO_WORKSPACE: 403,
  FORBIDDEN: 403,
  INVALID: 400,
  NOT_FOUND: 404,
  ERROR: 500,
};

/** Thrown by handlers (or the guard) for an error the caller should see. */
export class AppError extends Error {
  override name = 'AppError';
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type Result<O> = { ok: true; data: O } | { ok: false; code: ErrorCode; error: string };

export type UserContext = { user: Session['user']; headers: Headers };
export type Context = UserContext & { workspaceId: Id; role: Role };

/** Session → active workspace → role. Throws `AppError` on any failure. */
async function authenticate(
  headers: Headers,
  required?: Role | false,
): Promise<Context | UserContext> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
  if (required === false) return { user: session.user, headers };

  const member = await auth.api.getActiveMember({ headers }).catch(() => null);
  const role = member && topRole(member.role);
  if (!member || !role) throw new AppError('NO_WORKSPACE', 'Choose a workspace first');
  if (required && !hasRole(role, required)) {
    throw new AppError('FORBIDDEN', `Only a workspace ${required} or above can do this`);
  }
  return { user: session.user, headers, workspaceId: member.organizationId, role };
}

async function run<I extends z.ZodType, C, O>(
  headers: Headers,
  required: Role | false | undefined,
  input: I,
  raw: unknown,
  handler: (ctx: C, data: z.infer<I>) => Promise<O>,
): Promise<Result<O>> {
  try {
    const ctx = (await authenticate(headers, required)) as C;
    const parsed = input.safeParse(raw instanceof FormData ? Object.fromEntries(raw) : raw);
    if (!parsed.success) {
      throw new AppError('INVALID', parsed.error.issues.map((i) => i.message).join('. '));
    }
    return { ok: true, data: await handler(ctx, parsed.data) };
  } catch (error) {
    unstable_rethrow(error); // redirect(), notFound()
    if (error instanceof AppError) return { ok: false, code: error.code, error: error.message };
    console.error(error);
    return { ok: false, code: 'ERROR', error: 'Something went wrong' };
  }
}

/**
 * A Server Action that also carries its Zod input schema and minimum role, so a single definition
 * can be both called from the UI and exposed to the chat copilot as a tool (PR 16) with the same
 * parameters and the same auth guard.
 */
export type Action<I extends z.ZodType, O> = ((
  data: z.input<I> | FormData,
) => Promise<Result<O>>) & {
  readonly input: I;
  readonly role: Role | undefined;
};

/**
 * The only way to define a Server Action: session → active workspace → role → Zod-parsed input
 * → handler, with every failure returned as a `Result` instead of thrown. Every action is
 * workspace-scoped; `opts.role` is the minimum role (default `member`).
 */
export function action<I extends z.ZodType, O>(
  input: I,
  handler: (ctx: Context, data: z.infer<I>) => Promise<O>,
  opts: { role?: Role } = {},
): Action<I, O> {
  const fn = async (data: z.input<I> | FormData): Promise<Result<O>> =>
    run(await requestHeaders(), opts.role, input, data, handler);
  return Object.assign(fn, { input, role: opts.role });
}

/** A Server Action for a signed-in user who may not have a workspace yet (onboarding). */
export function userAction<I extends z.ZodType, O>(
  input: I,
  handler: (ctx: UserContext, data: z.infer<I>) => Promise<O>,
) {
  return async (data: z.input<I> | FormData): Promise<Result<O>> =>
    run(await requestHeaders(), false, input, data, handler);
}

/**
 * `action()` for route handlers. Input is the dynamic route params plus the query string (GET,
 * HEAD) or the JSON body; the result is JSON (or the handler's own `Response`), errors map to
 * HTTP statuses.
 */
export function route<I extends z.ZodType, O>(
  input: I,
  handler: (ctx: Context, data: z.infer<I>) => Promise<O>,
  opts: { role?: Role } = {},
) {
  return async (
    request: Request,
    segment?: { params?: Promise<Record<string, string | string[]>> },
  ): Promise<Response> => {
    const body = ['GET', 'HEAD'].includes(request.method)
      ? Object.fromEntries(new URL(request.url).searchParams)
      : await request.json().catch(() => undefined);
    const params = await segment?.params;
    const raw = params ? { ...(body as object), ...params } : body;
    const result = await run(request.headers, opts.role, input, raw, handler);
    if (!result.ok)
      return Response.json(
        { error: result.error, code: result.code },
        { status: STATUS[result.code] },
      );
    return result.data instanceof Response ? result.data : Response.json(result.data ?? null);
  };
}
