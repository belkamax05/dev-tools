import { singleQuote as quote } from '@/dev-tools/utils/process/shellQuote';

import type { TriggerPlan } from '../plugin';

/**
 * A plan as a curl command to run by hand — auth as variable names (`shellAuth`), never values,
 * so the copy is safe to paste anywhere. Copying sends nothing.
 */
export const planToCurl = (plan: TriggerPlan): string =>
  [
    `curl -X ${plan.method}`,
    ...(plan.shellAuth ? [plan.shellAuth] : []),
    ...Object.entries(plan.params).map(
      ([key, value]) => `--data-urlencode ${quote(`${key}=${value}`)}`,
    ),
    quote(plan.url),
  ].join(' \\\n  ');
