import type { ChainStep } from '../chain';

/**
 * A one-shot trigger armed for later: send this step once the steps before it finish. Held in
 * memory only — an app restart forgets every one, so nothing fires that nobody is watching.
 */
export interface AutoTrigger {
  stepId: string;
  label: string;
  /** Bound to the branch and env it was armed on — it never fires for any other. */
  branch: string;
  env: string;
  armedAt: number;
  /** The env was protected and its name was typed when arming: the confirmation to send with. */
  protectedEnv?: string;
}

export type AutoDecision =
  | { kind: 'wait'; reason: string }
  | { kind: 'fire' }
  | { kind: 'drop'; reason: string };

export const autoKey = (auto: Pick<AutoTrigger, 'stepId' | 'branch' | 'env'>) =>
  `${auto.branch}\u0000${auto.env}\u0000${auto.stepId}`;

/** Every step before `stepId` — its `after` steps and theirs, all the way up. */
export const ancestorsOf = (chain: readonly ChainStep[], stepId: string): ChainStep[] => {
  const byId = new Map(chain.map((entry) => [entry.step.id, entry]));
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const parent of byId.get(id)?.step.after ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      walk(parent);
    }
  };
  walk(stepId);
  return chain.filter((entry) => seen.has(entry.step.id));
};

/** Steps before it that are on their way: running now, or armed to run themselves. */
const pendingAncestors = (
  chain: readonly ChainStep[],
  stepId: string,
  armed: ReadonlySet<string>,
) =>
  ancestorsOf(chain, stepId).filter(
    (entry) => entry.status.state === 'running' || armed.has(entry.step.id),
  );

/**
 * States a step may be armed in: behind (never ran, stale), waiting on a step before it that has
 * no result yet (`blocked` — the very step being chained), failed last time (a retry), or done —
 * up to date only against the result a step before it is about to replace.
 */
const ARMABLE: ReadonlySet<string> = new Set(['none', 'stale', 'blocked', 'failed', 'done']);

/**
 * Can this step be armed: it is not running and something before it is running — or armed
 * itself, so a whole tail can be queued behind one build, each sent once the one before succeeds.
 * Every step after a running one qualifies, however far down and whatever it reads now.
 */
export const canArm = (
  chain: readonly ChainStep[],
  entry: ChainStep,
  armed: ReadonlySet<string> = new Set(),
) => ARMABLE.has(entry.status.state) && pendingAncestors(chain, entry.step.id, armed).length > 0;

/**
 * What an armed trigger does on this evaluation of its chain. It waits while anything before it
 * is still on its way, fires once every step it waits on succeeded (done), and is dropped — never
 * sent — when the chain went anywhere else: a step before it failed, it ran or caught up by other
 * means. A step before it that is itself armed (a retry of a failed one) is not counted as failed.
 */
export const decideAuto = (
  chain: readonly ChainStep[],
  stepId: string,
  armed: ReadonlySet<string> = new Set(),
): AutoDecision => {
  const entry = chain.find((item) => item.step.id === stepId);
  if (!entry) return { kind: 'drop', reason: 'the step is no longer in this chain' };
  const { state } = entry.status;
  if (state === 'running') return { kind: 'drop', reason: 'it is already running' };
  const ancestors = ancestorsOf(chain, stepId);
  const broken = ancestors.find(
    (item) =>
      !armed.has(item.step.id) &&
      ['failed', 'error', 'offline', 'missing'].includes(item.status.state),
  );
  if (broken) return { kind: 'drop', reason: `${broken.step.label} is ${broken.status.state}` };
  const pending = pendingAncestors(chain, stepId, armed);
  if (pending.length)
    return {
      kind: 'wait',
      reason: `waiting on ${pending.map((item) => item.step.label).join(', ')}`,
    };
  //? Armed while it read done against the old result: the new one decides
  if (state === 'done') return { kind: 'drop', reason: 'it is already up to date' };
  //? Every step it waits on succeeded: its turn — whether it reads stale or still blocked
  const parents = (entry.step.after ?? []).map((id) => chain.find((item) => item.step.id === id));
  if (entry.recommended || parents.every((parent) => parent?.status.state === 'done'))
    return { kind: 'fire' };
  return { kind: 'drop', reason: 'the steps before it finished, but it is not next to run' };
};

// --- time left ---------------------------------------------------------------------------------

/** How long the step usually takes: the median of its recent successful runs. */
export const typicalDurationMs = (entry: ChainStep): number | undefined => {
  const durations = (entry.status.runs ?? [])
    .filter((run) => run.state === 'success' && run.durationMs && run.durationMs > 0)
    .slice(0, 10)
    .map((run) => run.durationMs as number)
    .sort((a, b) => a - b);
  if (!durations.length) return undefined;
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2
    ? durations[middle]
    : ((durations[middle - 1] as number) + (durations[middle] as number)) / 2;
};

export interface AutoEstimate {
  /** From now until it is sent: when the last step before it finishes. */
  startsInMs: number;
  /** From now until it finishes itself. */
  finishesInMs: number;
  /** False when a step on its way had no past run to go by — the times are a lower bound. */
  known: boolean;
}

/**
 * When each step on its way finishes, from now. A running step has its usual time minus what it
 * has run; an armed (or just sent) one starts when the last step before it ends — steps side by
 * side start together, so the longest of them is what the next one waits for, never their sum —
 * and then takes its usual time. Any other step is not coming: it adds nothing.
 */
export const estimateAutos = (
  chain: readonly ChainStep[],
  armed: ReadonlySet<string>,
  now: number = Date.now(),
): Record<string, AutoEstimate> => {
  const byId = new Map(chain.map((entry) => [entry.step.id, entry]));
  const memo = new Map<string, AutoEstimate>();
  const estimate = (id: string): AutoEstimate => {
    const cached = memo.get(id);
    if (cached) return cached;
    const entry = byId.get(id);
    let result: AutoEstimate = { startsInMs: 0, finishesInMs: 0, known: true };
    if (entry?.status.state === 'running') {
      const typical = typicalDurationMs(entry);
      const run = entry.status.runs?.find((item) => item.state === 'running');
      const elapsed = run?.at ? now - run.at : (run?.durationMs ?? 0);
      result = {
        startsInMs: 0,
        //? Past its usual time: due any moment, not negative
        finishesInMs: typical === undefined ? 0 : Math.max(0, typical - elapsed),
        known: typical !== undefined,
      };
    } else if (entry && armed.has(id)) {
      const parents = (entry.step.after ?? []).map(estimate);
      const startsInMs = Math.max(0, ...parents.map((parent) => parent.finishesInMs));
      const typical = typicalDurationMs(entry);
      result = {
        startsInMs,
        finishesInMs: startsInMs + (typical ?? 0),
        known: typical !== undefined && parents.every((parent) => parent.known),
      };
    }
    memo.set(id, result);
    return result;
  };
  return Object.fromEntries([...armed].map((id) => [id, estimate(id)]));
};

/** "~12m", "~45s"; "≥" when part of it had nothing to go by. */
export const formatEstimate = (ms: number, known: boolean) => {
  const text =
    ms < 60_000
      ? `${Math.max(1, Math.round(ms / 1000))}s`
      : ms < 3_600_000
        ? `${Math.round(ms / 60_000)}m`
        : `${Math.floor(ms / 3_600_000)}h${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`;
  return `${known ? '~' : '≥'}${text}`;
};
