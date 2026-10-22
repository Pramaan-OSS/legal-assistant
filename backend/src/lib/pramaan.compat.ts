// Product cancellation/report helpers absent from @pramaan/sdk 0.1.0.
import type { PramaanOptions, Job, OutcomeRun as SdkOutcomeRun, OutcomeRunStep as SdkOutcomeRunStep, OutcomeStepError as SdkOutcomeStepError, Requests as SdkRequests, WaitOptions as SdkWaitOptions, OutcomeRunOptions as SdkOutcomeRunOptions } from '@pramaan/sdk' with { 'resolution-mode': 'import' };
export type OutcomeRunOptions = SdkOutcomeRunOptions & { readonly signal?: AbortSignal };
type WaitOptions = SdkWaitOptions & { readonly signal?: AbortSignal };
type OutcomeStepError = Omit<SdkOutcomeStepError, 'effect'> & { readonly effect?: 'none' | 'unknown' };
type OutcomeRunStep = Omit<SdkOutcomeRunStep, 'errors'> & { readonly errors?: readonly OutcomeStepError[] };
export type OutcomeRun = Omit<SdkOutcomeRun, 'status' | 'error' | 'steps'> & {
  readonly status: SdkOutcomeRun['status'] | 'cancelled';
  readonly error?: OutcomeStepError & { readonly step?: string };
  readonly steps: readonly OutcomeRunStep[];
};
export type Requests = Omit<SdkRequests, 'auth.user.delete'> & { 'auth.user.delete': SdkRequests['auth.user.delete'] & { confirm: true } };
type Raw = Record<string, unknown>;
export async function createPramaan(options: PramaanOptions) {
  const { Pramaan, PramaanError } = await import('@pramaan/sdk');
  const client = new Pramaan(options);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const MIN_POLL_MS = 2_000, MAX_POLL_MS = 30_000, DEFAULT_WAIT_MS = 31 * 60_000;
function toOutcomeRun(body: unknown): OutcomeRun {
  const raw = (body ?? {}) as Raw;
  const cost = raw.cost as Raw | undefined;
  if (typeof raw.outcome !== "string" || typeof raw.status !== "string" || !cost) {
    throw new PramaanError("internal", "The API returned an unexpected run shape.");
  }
  return {
    outcome: raw.outcome,
    version: Number(raw.version ?? 1),
    plan: String(raw.plan),
    status: raw.status as OutcomeRun["status"],
    ...(typeof raw.completeness === "string"
      ? { completeness: raw.completeness as NonNullable<OutcomeRun["completeness"]> }
      : {}),
    ...("result" in raw ? { result: raw.result } : {}),
    evidence: (raw.evidence ?? {}) as Record<string, unknown>,
    missing: (raw.missing ?? []) as unknown[],
    steps: ((raw.steps ?? []) as Raw[]).map(
      (step): OutcomeRunStep => ({
        id: String(step.id),
        label: String(step.label),
        capability: String(step.capability),
        effectClass: step.effect_class as OutcomeRunStep["effectClass"],
        status: step.status as OutcomeRunStep["status"],
        calls: Number(step.calls ?? 0),
        effect: step.effect as OutcomeRunStep["effect"],
        ...(typeof step.reason === "string" ? { reason: step.reason } : {}),
        ...(Array.isArray(step.errors)
          ? { errors: step.errors as NonNullable<OutcomeRunStep["errors"]> }
          : {}),
      }),
    ),
    ...(raw.error ? { error: raw.error as NonNullable<OutcomeRun["error"]> } : {}),
    cost: {
      holdMicro: Number(cost.hold_micro ?? 0),
      chargedMicro: Number(cost.charged_micro ?? 0),
      capabilities: ((cost.capabilities ?? []) as Raw[]).map((row) => ({
        id: String(row.id),
        calls: Number(row.calls ?? 0),
        chargedMicro: Number(row.charged_micro ?? 0),
      })),
    },
  };
}

  const jobs = { ...client.jobs,
    wait: async (id: string, options: WaitOptions = {}): Promise<Job> => {
      const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_MS);
      let interval = Math.max(MIN_POLL_MS, options.intervalMs ?? MIN_POLL_MS);
      for (;;) {
        if (options.signal?.aborted) throw new Error("Job wait cancelled.");
        const job = await jobs.get(id);
        if (job.status !== "running") return job;
        if (Date.now() + interval > deadline) {
          throw new PramaanError("upstream_timeout", "The job is still running after timeoutMs.", {
            retryable: true,
          });
        }
        if (options.signal) {
          const signal = options.signal;
          let listener: (() => void) | undefined;
          const stopped = new Promise<never>((_resolve, reject) => { listener = () => reject(new Error('Job wait cancelled.')); signal.addEventListener('abort', listener, { once: true }); if (signal.aborted) listener(); });
          try { await Promise.race([sleep(interval), stopped]); }
          finally { if (listener) signal.removeEventListener('abort', listener); }
        } else await sleep(interval);
        interval = Math.min(Math.ceil(interval * 1.5), MAX_POLL_MS);
      }
    },
  };
  const outcomes = { ...client.outcomes, run: async (id: string, input: unknown, opts: OutcomeRunOptions = {}): Promise<OutcomeRun> => {
      if (opts.signal?.aborted) throw new PramaanError('conflict', 'Cancelled before starting.', { effect: 'none' });
      let unknownEffect = false;
      const starter = new Pramaan({ ...options, fetch: async (url, init) => {
        const response = await (options.fetch ?? fetch)(url, init);
        if (!response.ok) {
          const body = await response.clone().json().catch(() => undefined);
          unknownEffect = body?.error?.effect === 'unknown';
        }
        return response;
      } });
      let started;
      try { started = await starter.outcomes.start(id, input, opts); }
      catch (error) {
        if (unknownEffect && error && typeof error === 'object') Object.assign(error, { effect: 'unknown' });
        throw error;
      }
      if (!('id' in started)) return started as OutcomeRun;
      const jobId = started.id;
      let cancellation: Promise<Job> | undefined;
      const stop = () => { cancellation ??= jobs.cancel(jobId); void cancellation.catch(() => {}); };
      opts.signal?.addEventListener('abort', stop, { once: true });
      if (opts.signal?.aborted) stop();
      try {
        const job = await jobs.wait(jobId, { timeoutMs: 36 * 60_000, ...(opts.signal ? { signal: opts.signal } : {}) });
        if (job.result !== undefined) return toOutcomeRun(job.result);
        throw new PramaanError(job.error?.code ?? 'upstream_timeout', 'The run ended without a complete result. Check before retrying.', { effect: job.error?.effect });
      } catch (error) {
        if (opts.signal?.aborted) {
          const cancelled = await cancellation?.catch(() => undefined);
          if (cancelled?.result !== undefined) return toOutcomeRun(cancelled.result);
          throw Object.assign(new PramaanError('upstream_timeout', 'Cancellation requested. Check before retrying.'), { effect: 'unknown' });
        }
        throw error;
      } finally { opts.signal?.removeEventListener('abort', stop); }

  } };
  return Object.assign(client, { jobs, outcomes });
}
