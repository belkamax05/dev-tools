import type { Env, PlanFix } from '../../core/plugin';
import { type JenkinsOptions, jenkinsGet, jobPath } from './api';

export interface ParamDefinition {
  name: string;
  type: string;
  /** A choice parameter's options. Active Choices (cascade) parameters have none here. */
  choices?: string[];
  defaultParameterValue?: { value?: unknown };
}

/** A job's parameters as Jenkins defines them now — what a request will be checked against. */
export const jobParameters = async (
  options: JenkinsOptions,
  env: Env,
  job: string,
): Promise<ParamDefinition[]> => {
  const data = await jenkinsGet<{
    property?: Array<{ parameterDefinitions?: ParamDefinition[] }>;
  }>(
    options,
    env,
    jobPath(job),
    'property[parameterDefinitions[name,type,choices,defaultParameterValue[value]]]',
  );
  return (data.property ?? []).flatMap((property) => property.parameterDefinitions ?? []);
};

/**
 * What Jenkins would do with these parameters, before sending them: a choice parameter refuses
 * a value outside its list (Jenkins answers 500 and starts nothing) — a blocker; a parameter
 * the job does not have is ignored, and one not sent takes the job's default — warnings, since
 * a default is not what the plan says.
 */
export const checkParams = (
  params: Record<string, string>,
  definitions: readonly ParamDefinition[],
  job: string,
): { blockers: string[]; warnings: string[]; fixes: PlanFix[] } => {
  const blockers: string[] = [];
  const fixes: PlanFix[] = [];
  const warnings: string[] = [];
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const [name, value] of Object.entries(params)) {
    const definition = byName.get(name);
    if (!definition) {
      warnings.push(`${name} is not a parameter of ${job} — Jenkins ignores it`);
      continue;
    }
    if (definition.choices?.length && !definition.choices.includes(value)) {
      blockers.push(
        `${name}=${value} is not one of ${job}'s choices (${definition.choices.join(', ')}) — Jenkins refuses it`,
      );
      fixes.push({
        id: `add-choice:${name}`,
        label: `Add ${value} to ${job}'s ${name}`,
        detail: `Edits ${job} on Jenkins, for everyone: ${name} gets ${value} beside ${definition.choices.join(', ')}. A pipeline that defines its own parameters rewrites the list when it next runs, so the addition may last one build.`,
      });
    }
  }
  for (const definition of definitions) {
    if (definition.name in params) continue;
    const fallback = definition.defaultParameterValue?.value;
    warnings.push(
      `${definition.name} is not sent — Jenkins uses its default${fallback === undefined || fallback === '' ? '' : ` (${String(fallback)})`}`,
    );
  }
  return { blockers, warnings, fixes };
};

/**
 * The reason inside a Jenkins error page — e.g. "Illegal choice for parameter CODE_BRANCH: …" —
 * rather than the bare status. Undefined when the page says nothing recognisable.
 */
export const jenkinsErrorText = (body: string): string | undefined => {
  const text = body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const reason =
    lines.find((line) =>
      /illegal choice|not a valid|is not allowed|nothing is submitted/i.test(line),
    ) ?? lines.find((line) => /\b\w+(Exception|Error):\s*\S/.test(line));
  return reason?.replace(/^[\w.$]+(Exception|Error):\s*/, '').slice(0, 300);
};

const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * A job's config.xml with `value` added to the choice parameter `param`'s list — or undefined
 * when there is no such choice parameter, and the same text when the value is already listed.
 * Only that parameter's `<a class="string-array">` is touched.
 */
export const addChoice = (xml: string, param: string, value: string): string | undefined => {
  const block = new RegExp(
    `(<hudson\\.model\\.ChoiceParameterDefinition>\\s*<name>${param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</name>[\\s\\S]*?<a class="string-array">)([\\s\\S]*?)(\\s*</a>)`,
  );
  const match = block.exec(xml);
  if (!match) return undefined;
  const [, head = '', list = '', tail = ''] = match;
  if (list.includes(`<string>${escapeXml(value)}</string>`)) return xml;
  const indent = list.match(/\n(\s*)<string>/)?.[1] ?? '              ';
  return xml.replace(block, `${head}${list}\n${indent}<string>${escapeXml(value)}</string>${tail}`);
};
