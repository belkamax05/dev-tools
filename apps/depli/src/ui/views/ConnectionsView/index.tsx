import { Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import { type ThemeColors, useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { copyToClipboard } from '@/dev-tools/utils/system/copyToClipboard';
import { openUrl } from '@/dev-tools/utils/system/openUrl';

import type {
  Capability,
  Connection,
  GuideLink,
  ProbeTone,
  Transport,
} from '../../../core/plugin';
import type { Provider } from '../../../core/registry';
import type { DepliData } from '../../useDepli';
import type { Session } from '../../types';

type Tone = 'ok' | 'warn' | 'error' | 'info';
type Probe = Connection['probes'][number];

export interface ConnectionsViewProps {
  data: DepliData;
  providers: Provider[];
  problems: string[];
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  /** True while a prompt here has the keyboard — the app's own keys stand down. */
  onCaptureInput: (captured: boolean) => void;
}

/** A row of the list: a provider's "first that works", one of its transports, or one choice. */
type Row =
  | { kind: 'auto'; provider: Provider }
  | { kind: 'transport'; provider: Provider; transport: Transport<any>; index: number }
  | {
      kind: 'choice';
      provider: Provider;
      transport: Transport<any>;
      /** Undefined: the transport's own default (ssh config decides). */
      choice?: string;
      label: string;
      detail?: string;
      tone?: ProbeTone;
    };

type TransportState = 'in-use' | 'ready' | 'failing' | 'planned' | 'disabled' | 'checking';

const STATE_LOOK: Record<TransportState, { glyph: string; text: string; role: keyof ThemeColors }> =
  {
    'in-use': { glyph: '●', text: 'in use', role: 'ok' },
    ready: { glyph: '✓', text: 'works · standby', role: 'text' },
    failing: { glyph: '✗', text: 'failing', role: 'error' },
    planned: { glyph: '·', text: 'planned', role: 'muted' },
    disabled: { glyph: '⊘', text: 'disabled', role: 'muted' },
    checking: { glyph: '…', text: 'checking', role: 'muted' },
  };

/** Switched off in depli.config.ts (`disabledTransports`) — listed greyed, never used. */
const isDisabled = (provider: Provider, transport: Transport<any>) =>
  Boolean(provider.disabled?.includes(transport.id));

const stateOf = (
  transport: Transport<any>,
  connection: Connection | undefined,
  provider: Provider,
): TransportState => {
  if (isDisabled(provider, transport)) return 'disabled';
  if (!connection) return 'checking';
  if (transport.planned) return 'planned';
  if (connection.transport === transport.id) return 'in-use';
  const probe = connection.probes.find((entry) => entry.transport === transport.id);
  return probe?.ok ? 'ready' : 'failing';
};

const toneColor = (colors: ThemeColors, tone?: ProbeTone) =>
  tone === 'ok'
    ? colors.ok
    : tone === 'warn'
      ? colors.warn
      : tone === 'error'
        ? colors.error
        : colors.text;

const choiceKey = (provider: string, transport: string, choice?: string) =>
  `${provider}:${transport}:${choice ?? '-'}`;

/** The transport whose guided setup the provider offers — the recommended one, when it has one. */
const setupOf = (provider: Provider) =>
  provider.transports.find((transport) => transport.recommended && transport.setup) ??
  provider.transports.find((transport) => transport.setup);

const hasCredentials = (provider: Provider) =>
  Boolean(setupOf(provider)?.setup?.inputs?.some((input) => input.secret));

/** The transport does less than another of the provider's — SSH beside the API. */
const isLimited = (provider: Provider, transport: Transport<any>) =>
  provider.transports.some(
    (other) =>
      !other.planned &&
      !isDisabled(provider, other) &&
      other.capabilities.some((capability) => !transport.capabilities.includes(capability)),
  );

/** Every capability any of the provider's transports has, in the order they first appear. */
const allCapabilities = (provider: Provider) => [
  ...new Set(provider.transports.flatMap((transport) => transport.capabilities)),
] as Capability[];

const Section = ({ title }: { title: string }) => {
  const colors = useColors();
  return (
    <Box marginTop={1}>
      <Text color={colors.heading} bold>
        {title.toUpperCase()}
      </Text>
      <Text color={colors.muted}> {'─'.repeat(Math.max(0, 40 - title.length))}</Text>
    </Box>
  );
};

/** What the transport can and cannot do, as chips — the gap is what a fallback costs. */
const CapabilityChips = ({ provider, transport }: { provider: Provider; transport: Transport<any> }) => {
  const colors = useColors();
  return (
    <Box flexWrap="wrap">
      <Box width={9} flexShrink={0}>
        <Text color={colors.muted}>can</Text>
      </Box>
      {allCapabilities(provider).map((capability) => {
        const has = transport.capabilities.includes(capability);
        return (
          <Box key={capability} marginRight={1}>
            <Text color={has ? colors.ok : colors.muted} strikethrough={!has}>
              {has ? '✓' : '·'} {capability}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

const Links = ({ links }: { links: GuideLink[] }) => (
  <Box flexDirection="column">
    {links.map((link) => (
      <LinkRow
        key={link.url}
        label="↗"
        labelWidth={2}
        value={`${link.label} — ${link.url}`}
        onOpen={() => openUrl(link.url)}
      />
    ))}
  </Box>
);

/** One probe in full: what it said, how it connected (or tried to), why it failed and the fix. */
const ProbeDetail = ({ probe, showGuide, transport }: {
  probe?: Probe;
  showGuide: boolean;
  transport: Transport<any>;
}) => {
  const colors = useColors();
  const guide = transport.guide;
  return (
    <Box flexDirection="column">
      {probe?.facts?.length ? (
        <>
          <Section title="How it connects" />
          {probe.facts.map((fact) => (
            <Box key={fact.label}>
              <Box width={9} flexShrink={0}>
                <Text color={colors.muted}>{fact.label}</Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={toneColor(colors, fact.tone)} wrap="wrap">
                  {fact.value}
                </Text>
              </Box>
            </Box>
          ))}
        </>
      ) : null}
      {probe && !probe.ok && probe.fix ? (
        <>
          <Section title="Why it fails · how to fix" />
          {probe.fix.why ? (
            <Text color={colors.warn} wrap="wrap">
              {probe.fix.why}
            </Text>
          ) : null}
          {probe.fix.steps.map((step, index) => (
            <Box key={step}>
              <Box width={3} flexShrink={0}>
                <Text color={colors.accent} bold>
                  {index + 1}.
                </Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={colors.text} wrap="wrap">
                  {step}
                </Text>
              </Box>
            </Box>
          ))}
          {probe.fix.links?.length ? <Links links={probe.fix.links} /> : null}
        </>
      ) : null}
      {guide && (showGuide || (probe && !probe.ok && !probe.fix)) ? (
        <>
          <Section title="Setup guide" />
          <Text color={colors.text} wrap="wrap">
            {guide.summary}
          </Text>
          {guide.steps.map((step, index) => (
            <Box key={step}>
              <Box width={3} flexShrink={0}>
                <Text color={colors.muted}>{index + 1}.</Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={colors.text} wrap="wrap">
                  {step}
                </Text>
              </Box>
            </Box>
          ))}
          {guide.links?.length ? <Links links={guide.links} /> : null}
        </>
      ) : guide ? (
        <Text color={colors.muted}>{'\n'}[g] setup guide</Text>
      ) : null}
    </Box>
  );
};

/**
 * Each provider and the ways depli can reach it: which one is in use and how exactly it
 * connects (the remote, the host, the SSH key, where the token comes from), why the others fail
 * and how to fix them, and a setup guide for each. Enter on a row decides what is used: the first
 * that works, one transport pinned, or one SSH key.
 */
export const ConnectionsView = ({
  data,
  providers,
  problems,
  session,
  notify,
  onCaptureInput,
}: ConnectionsViewProps) => {
  const colors = useColors();
  const [selectedId, setSelectedId] = useState(session.selected.connections);
  const prompt = usePrompt(onCaptureInput);
  const [showGuide, setShowGuide] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  //? Choices tested here, by choiceKey — the main probe only ever tries the one picked
  const [tests, setTests] = useState<Record<string, Probe | 'running'>>({});
  const testsRef = useRef(tests);
  testsRef.current = tests;
  //? Why a provider's guided setup cannot run here (gh missing…), by provider — asked once
  const [unavailable, setUnavailable] = useState<Record<string, string | undefined>>({});
  const askedUnavailable = useRef(new Set<string>());

  const items: PickItem<Row>[] = [];
  for (const provider of providers) {
    const connection = data.connections[provider.name];
    const preference = data.preferences[provider.name] ?? {};
    const selectedTransport = preference.transport ?? connection?.transport;
    const inUse = provider.transports.find((transport) => transport.id === connection?.transport);
    items.push({
      id: `${provider.name}:header`,
      label: `${provider.plugin.icon} ${provider.name}`,
      hint: `${provider.plugin.label} · ${connection ? (inUse ? `via ${inUse.id}${isLimited(provider, inUse) ? ' · limited' : ''}` : 'not connected') : '…'}`,
      hintColor: connection
        ? inUse
          ? isLimited(provider, inUse)
            ? colors.warn
            : colors.ok
          : colors.error
        : colors.muted,
      isHeader: true,
    });
    items.push({
      id: `${provider.name}:auto`,
      label: 'Auto — first that works',
      prefix: { text: preference.transport ? '○ ' : '◉ ', color: colors.accent },
      hint: preference.transport ? 'off' : inUse ? `→ ${inUse.id}` : '→ none works',
      hintColor: preference.transport ? colors.muted : inUse ? colors.ok : colors.error,
      value: { kind: 'auto', provider },
      indent: 1,
    });
    provider.transports.forEach((transport, index) => {
      const state = stateOf(transport, connection, provider);
      const look = STATE_LOOK[state];
      items.push({
        id: `${provider.name}:${transport.id}`,
        label: `${index + 1}. ${transport.label}${transport.recommended ? ' ★' : ''}`,
        tag: isLimited(provider, transport) ? 'limited' : undefined,
        //? Switched off in config: greyed, and the cursor passes it by — it cannot be picked
        disabled: state === 'disabled',
        prefix: {
          text:
            selectedTransport === transport.id && state !== 'disabled'
              ? '◉ '
              : transport.planned || state === 'disabled'
                ? '  '
                : '○ ',
          color: state === 'disabled' ? colors.muted : colors.accent,
        },
        hint: `${look.glyph} ${look.text}`,
        hintColor: colors[look.role] as string,
        value: { kind: 'transport', provider, transport, index },
        indent: 1,
      });
      const probe = connection?.probes.find((entry) => entry.transport === transport.id);
      if (!transport.choiceLabel || !probe?.choices) return;
      const picked = preference.choices?.[transport.id];
      const choices = [
        { id: undefined, label: 'ssh config decides', detail: undefined, tone: undefined },
        ...probe.choices,
      ];
      for (const choice of choices) {
        const tested =
          choice.id === picked ? probe : tests[choiceKey(provider.name, transport.id, choice.id)];
        items.push({
          id: `${provider.name}:${transport.id}:${choice.id ?? '-'}`,
          label: `${transport.choiceLabel.toLowerCase()}: ${choice.label}`,
          prefix: {
            text: selectedTransport === transport.id && choice.id === picked ? '◉ ' : '○ ',
            color: colors.accent,
          },
          hint:
            tested === 'running'
              ? '… testing'
              : tested
                ? tested.ok
                  ? '✓ works'
                  : '✗ fails'
                : choice.tone === 'warn'
                  ? '⚠ untested'
                  : 'untested',
          hintColor:
            tested === 'running' || !tested
              ? choice.tone === 'warn'
                ? colors.warn
                : colors.muted
              : tested.ok
                ? colors.ok
                : colors.error,
          value: {
            kind: 'choice',
            provider,
            transport,
            choice: choice.id,
            label: choice.label,
            detail: choice.detail,
            tone: choice.tone,
          },
          indent: 3,
        });
      }
    });
  }
  const selected = items.find((item) => item.id === selectedId)?.value;

  const test = (row: Extract<Row, { kind: 'choice' }>, force = false) => {
    const key = choiceKey(row.provider.name, row.transport.id, row.choice);
    if (!force && testsRef.current[key]) return;
    setTests((all) => ({ ...all, [key]: 'running' }));
    data
      .probeChoice(row.provider.name, row.transport.id, row.choice)
      .then((probe) => setTests((all) => ({ ...all, [key]: probe })));
  };

  //? A choice is tested as soon as the cursor lands on it — what you see is what it would do
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row id is the trigger
  useEffect(() => {
    setRevealedSecrets({});
    const setupTransport = selected && setupOf(selected.provider);
    if (setupTransport && selected && !askedUnavailable.current.has(selected.provider.name)) {
      const name = selected.provider.name;
      askedUnavailable.current.add(name);
      data
        .setupUnavailable(name, setupTransport.id)
        .then((why) => setUnavailable((all) => ({ ...all, [name]: why })));
    }
    if (selected?.kind !== 'choice') return;
    const picked = data.preferences[selected.provider.name]?.choices?.[selected.transport.id];
    if (selected.choice !== picked) test(selected);
  }, [selectedId]);

  const activate = (row: Row) => {
    const name = row.provider.name;
    const preference = data.preferences[name] ?? {};
    if (row.kind === 'auto') {
      data.setPreference(name, { ...preference, transport: undefined });
      notify(`${name}: the first transport that works`, 'ok');
    } else if (row.kind === 'transport') {
      if (row.transport.planned)
        return notify(`${row.transport.label} is not supported yet — nothing to pin`, 'warn');
      data.setPreference(name, { ...preference, transport: row.transport.id });
      notify(`${name}: always ${row.transport.label}, even when it fails`, 'ok');
    } else {
      const choices = { ...preference.choices };
      if (row.choice) choices[row.transport.id] = row.choice;
      else delete choices[row.transport.id];
      data.setPreference(name, { ...preference, choices });
      notify(
        `${name} ${row.transport.id}: ${row.choice ? `only ${row.label}` : 'ssh config decides'}`,
        'ok',
      );
    }
  };

  /** Whether the row is what is picked now — its Use button has nothing left to do. */
  const isPicked = (row: Row) => {
    const preference = data.preferences[row.provider.name] ?? {};
    if (row.kind === 'auto') return !preference.transport;
    if (row.kind === 'transport') return preference.transport === row.transport.id;
    return preference.choices?.[row.transport.id] === row.choice;
  };

  /** The mouse's Enter: the same action, as a button at the top of the detail. */
  const renderUseButton = (row: Row) => {
    const picked = isPicked(row);
    const planned = row.kind === 'transport' && row.transport.planned;
    const label =
      row.kind === 'auto'
        ? picked
          ? 'Auto is in use'
          : 'Use Auto — the first that works'
        : row.kind === 'transport'
          ? planned
            ? 'Not supported yet'
            : picked
              ? 'Pinned — always this one'
              : 'Pin — always use this one'
          : picked
            ? `Using ${row.choice ? 'only this key' : 'ssh config'}`
            : row.choice
              ? 'Use only this key'
              : 'Let ssh config decide';
    return (
      <Box marginBottom={1}>
        <ActionButton
          hotkey="Enter"
          label={label}
          isOn={picked}
          disabled={picked || planned}
          color={colors.accent}
          onPress={() => activate(row)}
        />
      </Box>
    );
  };

  /** Start a setup — asking its inputs in turn first (a user id, then a token), if it has any. */
  const startSetup = (provider: Provider) => {
    const transport = setupOf(provider);
    if (!transport?.setup) return;
    if (unavailable[provider.name]) return notify(unavailable[provider.name] ?? '', 'warn');
    const inputs = transport.setup.inputs ?? [];
    const context = data.setupContext(provider.name);
    const ask = (at: number, values: Record<string, string>) => {
      const input = inputs[at];
      if (!input) return data.startSetup(provider.name, transport.id, values);
      prompt.ask(
        `${input.label}:`,
        (value) => {
          if (!value.trim()) return notify(`${input.label} is needed — nothing was saved`, 'warn');
          ask(at + 1, { ...values, [input.id]: value });
        },
        { initial: (context && input.initial?.(context)) ?? '', secret: input.secret },
      );
    };
    ask(0, {});
  };

  const renderCredentials = (provider: Provider) => {
    const transport = setupOf(provider);
    const setup = transport?.setup;
    const context = data.setupContext(provider.name);
    if (!transport || !setup || !context || !hasCredentials(provider)) return null;
    const running =
      data.setup?.key === `${provider.name}:${transport.id}` ? data.setup.progress : undefined;
    const active = running && (running.state === 'running' || running.state === 'waiting');
    const why = unavailable[provider.name];
    const probe = data.connections[provider.name]?.probes.find(
      (entry) => entry.transport === transport.id,
    );
    const missing = setup.inputs?.some((input) => !input.initial?.(context)?.trim());
    const ready = !missing && !why && running?.state !== 'failed' && probe?.ok;
    const color = ready && !active ? colors.ok : colors.error;
    const links = setup.links?.(context) ?? [];
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color}
        paddingX={1}
        marginBottom={1}
      >
        <Text color={color} bold>
          {active
            ? '… Saving credentials'
            : ready
              ? '✓ API credentials verified'
              : '✗ API configuration required'}
        </Text>
        <Box marginTop={1}>
          <ActionButton
            hotkey="L"
            label={ready ? 'Update Jenkins API credentials' : 'Configure Jenkins API'}
            color={color}
            disabled={Boolean(active) || Boolean(why)}
            onPress={() => startSetup(provider)}
          />
        </Box>
        {why ? (
          <Text color={colors.error} wrap="wrap">
            {why}
          </Text>
        ) : null}
        {setup.inputs?.map((input) => {
          const value = input.initial?.(context) ?? '';
          const key = `${provider.name}:${transport.id}:${input.id}`;
          const revealed = revealedSecrets[key];
          return (
            <Box key={input.id} flexDirection="column" marginTop={1}>
              <Text color={colors.text} wrap="wrap">
                {input.label}: {value ? (input.secret && !revealed ? '••••••••' : value) : 'not set'}
              </Text>
              {input.secret ? (
                <Box>
                  <ActionButton
                    label={revealed ? 'Hide token' : 'Reveal token'}
                    disabled={!value}
                    onPress={() => setRevealedSecrets((all) => ({ ...all, [key]: !all[key] }))}
                  />
                  <ActionButton
                    label="Edit token"
                    disabled={Boolean(active) || Boolean(why)}
                    onPress={() => {
                      setRevealedSecrets({});
                      const values = Object.fromEntries(
                        (setup.inputs ?? []).map((field) => [
                          field.id,
                          field.initial?.(context) ?? '',
                        ]),
                      );
                      if (
                        (setup.inputs ?? []).some(
                          (field) => field.id !== input.id && !values[field.id],
                        )
                      ) {
                        startSetup(provider);
                        return;
                      }
                      prompt.ask(
                        input.label,
                        (next) => {
                          if (!next.trim())
                            return notify('A token is needed — nothing was saved', 'warn');
                          data.startSetup(provider.name, transport.id, {
                            ...values,
                            [input.id]: next,
                          });
                        },
                        { initial: value, secret: true },
                      );
                    }}
                  />
                </Box>
              ) : null}
            </Box>
          );
        })}
        {running ? (
          <Text color={running.state === 'failed' ? colors.error : colors.text} wrap="wrap">
            {running.message}
          </Text>
        ) : null}
        <Text color={colors.muted} wrap="wrap">
          Paste an API token or an op:// reference. Saving resolves references and checks the
          connection.
        </Text>
        {!ready || showGuide
          ? setup.steps.map((step) => (
              <Text key={step} color={colors.text} wrap="wrap">
                • {step}
              </Text>
            ))
          : null}
        {links.length ? <Links links={links} /> : null}
        <ProbeDetail probe={probe} showGuide={showGuide} transport={transport} />
      </Box>
    );
  };

  /**
   * The guided setup for the recommended way in — a sign-in run for the person, in the app — in a
   * frame of its own, so it reads as the one thing to do rather than more of the report.
   */
  const renderSetup = (provider: Provider) => {
    const transport = setupOf(provider);
    const setup = transport?.setup;
    if (!transport || !setup) return null;
    const running =
      data.setup?.key === `${provider.name}:${transport.id}` ? data.setup.progress : undefined;
    const active = running && (running.state === 'running' || running.state === 'waiting');
    const probe = data.connections[provider.name]?.probes.find(
      (entry) => entry.transport === transport.id,
    );
    const why = unavailable[provider.name];
    const context = data.setupContext(provider.name);
    const links = context && setup.links ? setup.links(context) : [];
    const steps = (
      <Box flexDirection="column" marginTop={1}>
        {setup.steps.map((step, index) => (
          <Box key={step}>
            <Box width={3} flexShrink={0}>
              <Text color={colors.accent} bold>
                {index + 1}.
              </Text>
            </Box>
            <Box flexShrink={1}>
              <Text color={colors.text} wrap="wrap">
                {step}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    );
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={probe?.ok ? colors.muted : colors.accent}
        paddingX={1}
        marginTop={1}
      >
        <Text color={colors.accent} bold>
          ⚙ {setup.label}
        </Text>

        {!active ? (
          <>
            <Text color={colors.muted} wrap="wrap">
              {setup.detail}
            </Text>
            {steps}
            {links.length ? <Links links={links} /> : null}
            {why ? (
              <Text color={colors.warn} wrap="wrap">
                ⚠ {why}
              </Text>
            ) : (
              <Box marginTop={1}>
                <ActionButton
                  hotkey="L"
                  label={probe?.ok ? `${setup.label} again` : setup.label}
                  color={colors.accent}
                  onPress={() => startSetup(provider)}
                />
              </Box>
            )}
          </>
        ) : null}
        {running ? (
          <Box flexDirection="column" marginTop={1}>
            <Text
              color={
                running.state === 'done'
                  ? colors.ok
                  : running.state === 'failed'
                    ? colors.error
                    : colors.text
              }
              wrap="wrap"
            >
              {running.state === 'done' ? '✓' : running.state === 'failed' ? '✗' : '…'}{' '}
              {running.message}
            </Text>
            {active && running.code ? (
              <>
                <Box marginTop={1}>
                  <Text color={colors.muted}>your code </Text>
                  <Text backgroundColor={colors.accent} color={colors.accentText} bold>
                    {` ${running.code} `}
                  </Text>
                </Box>
                <Box marginTop={1} flexWrap="wrap">
                  <Box marginRight={2}>
                    <ActionButton
                      hotkey="o"
                      label={`Open ${running.url?.replace(/^https?:\/\//, '') ?? 'page'}`}
                      color={colors.accent}
                      onPress={() => running.url && openUrl(running.url)}
                    />
                  </Box>
                  <Box marginRight={2}>
                    <ActionButton
                      hotkey="C"
                      label="Copy code"
                      onPress={() => {
                        if (running.code) copyToClipboard(running.code);
                        notify('Code copied', 'ok');
                      }}
                    />
                  </Box>
                  <ActionButton hotkey="X" label="Cancel" onPress={data.cancelSetup} />
                </Box>
                {steps}
              </>
            ) : active ? (
              <ActionButton hotkey="X" label="Cancel" onPress={data.cancelSetup} />
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  };

  /** The disclaimer: which way in is the recommended one, and what the others cannot do. */
  const renderRecommended = (provider: Provider, current?: Transport<any>) => {
    const best = provider.transports.find((transport) => transport.recommended);
    if (!best) return null;
    const connection = data.connections[provider.name];
    const bestInUse = connection?.transport === best.id;
    const fallbacks = provider.transports.filter(
      (transport) => transport !== best && !transport.planned,
    );
    if (current && current !== best && current.planned) return null;
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={bestInUse ? colors.ok : colors.warn}
        paddingX={1}
        marginBottom={1}
      >
        <Text color={bestInUse ? colors.ok : colors.warn} bold wrap="wrap">
          ★ Recommended: {best.label}
          {bestInUse ? ' — in use' : connection ? ' — not in use' : ''}
        </Text>
        <Text color={colors.text} wrap="wrap">
          It can do everything depli shows for {provider.plugin.label}: {best.capabilities.join(', ')}.
        </Text>
        {fallbacks.map((transport) => {
          const lacks = best.capabilities.filter((capability) => !transport.capabilities.includes(capability));
          return lacks.length ? (
            <Text key={transport.id} color={current === transport ? colors.warn : colors.muted} wrap="wrap">
              {current === transport ? '⚠ This one is limited' : `${transport.label} is limited`}: no {lacks.join(', ')} —
              only {transport.capabilities.join(', ')}.{' '}
              {isDisabled(provider, transport)
                ? 'Disabled for this project in depli.config.ts.'
                : 'Use it as a fallback.'}
            </Text>
          ) : null;
        })}
        {!bestInUse && best.setup && !hasCredentials(provider) && !unavailable[provider.name] ? (
          <Box marginTop={1}>
            <ActionButton
              hotkey="L"
              label={best.setup.label}
              color={colors.accent}
              onPress={() => startSetup(provider)}
            />
          </Box>
        ) : null}
      </Box>
    );
  };

  const firstLink = (): GuideLink | undefined => {
    if (!selected || selected.kind === 'auto') return undefined;
    const probe = probeFor(selected);
    return probe?.fix?.links?.[0] ?? selected.transport.guide?.links?.[0];
  };

  const probeFor = (row: Exclude<Row, { kind: 'auto' }>): Probe | undefined => {
    const connection = data.connections[row.provider.name];
    const main = connection?.probes.find((entry) => entry.transport === row.transport.id);
    if (row.kind === 'transport') return main;
    const picked = data.preferences[row.provider.name]?.choices?.[row.transport.id];
    if (row.choice === picked) return main;
    const tested = tests[choiceKey(row.provider.name, row.transport.id, row.choice)];
    return tested === 'running' ? undefined : tested;
  };

  const setupWaiting =
    data.setup && (data.setup.progress.state === 'running' || data.setup.progress.state === 'waiting')
      ? data.setup.progress
      : undefined;

  useInput((input, key) => {
    if (input === 'P') {
      setTests({});
      data.reprobe();
    } else if (input === 'g') setShowGuide((on) => !on);
    else if (input === 'T' && selected?.kind === 'choice') test(selected, true);
    else if (input === 'L' && selected) startSetup(selected.provider);
    else if (input === 'X' && setupWaiting) data.cancelSetup();
    else if (input === 'C' && setupWaiting?.code) {
      copyToClipboard(setupWaiting.code);
      notify('Code copied', 'ok');
    } else if (input === 'o' && setupWaiting?.url) openUrl(setupWaiting.url);
    else if (input === 'o') {
      const link = firstLink();
      if (link) {
        openUrl(link.url);
        notify(`Opened ${link.label}`, 'info');
      }
    }
  }, { isActive: !prompt.isOpen });

  const renderAuto = (provider: Provider) => {
    const connection = data.connections[provider.name];
    const preference = data.preferences[provider.name] ?? {};
    const usable = provider.transports.filter(
      (transport) => !transport.planned && !isDisabled(provider, transport),
    );
    const inUse = provider.transports.find((transport) => transport.id === connection?.transport);
    const capabilities = allCapabilities(provider);
    return (
      <Box flexDirection="column">
        <Text color={colors.text} wrap="wrap">
          depli can reach {provider.plugin.label} {usable.length === 1 ? 'one way' : `${usable.length} ways`}
          {usable.length > 1 ? ' — ' : ''}
          {usable.length > 1 ? (
            <Text color={colors.accent} bold>
              you need only one of them
            </Text>
          ) : null}
          . {preference.transport
            ? `Pinned to ${preference.transport}: it is used even when it fails. Use Auto to go back to the first that works.`
            : 'It tries them top to bottom and uses the first that works; the rest stand by as fallbacks. Enter (or the Pin button) on one pins it.'}
        </Text>
        <Box marginTop={1}>
          <Text color={connection ? (inUse ? colors.ok : colors.error) : colors.muted} bold>
            {connection
              ? inUse
                ? `● in use: ${inUse.label}`
                : preference.transport
                  ? `○ pinned ${preference.transport} fails — not connected`
                  : '○ none works — not connected'
              : '… checking'}
          </Text>
          {connection ? (
            <Text color={colors.muted}>
              {connection.probes.find((probe) => probe.transport === inUse?.id)?.identity
                ? ` · as ${connection.probes.find((probe) => probe.transport === inUse?.id)?.identity}`
                : ''}
              {` · checked ${new Date(connection.checkedAt).toLocaleTimeString()}`}
            </Text>
          ) : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {renderRecommended(provider)}
        </Box>
        {!hasCredentials(provider) && setupOf(provider) && data.connections[provider.name]?.transport !== setupOf(provider)?.id
          ? renderSetup(provider)
          : null}
        <Section title="Ways in, and what each can do" />
        <Box>
          <Box width={30} flexShrink={0}>
            <Text color={colors.muted}> </Text>
          </Box>
          {capabilities.map((capability) => (
            <Box key={capability} width={capability.length + 2} flexShrink={0}>
              <Text color={colors.muted}>{capability}</Text>
            </Box>
          ))}
        </Box>
        {provider.transports.map((transport, index) => {
          const look = STATE_LOOK[stateOf(transport, connection, provider)];
          return (
            <Box key={transport.id}>
              <Box width={30} flexShrink={0}>
                <Text color={colors[look.role] as string} wrap="truncate">
                  {look.glyph} {index + 1}. {transport.label}
                </Text>
              </Box>
              {capabilities.map((capability) => (
                <Box key={capability} width={capability.length + 2} flexShrink={0}>
                  <Text
                    color={
                      transport.capabilities.includes(capability) && !isDisabled(provider, transport)
                        ? colors.ok
                        : colors.muted
                    }
                  >
                    {transport.capabilities.includes(capability) ? '  ✓' : '  ·'}
                  </Text>
                </Box>
              ))}
            </Box>
          );
        })}
        <Box marginTop={1} flexWrap="wrap">
          {Object.entries(STATE_LOOK)
            .filter(([state]) => state !== 'checking')
            .map(([state, look]) => (
              <Box key={state} marginRight={2}>
                <Text color={colors[look.role] as string}>
                  {look.glyph} {look.text}
                </Text>
              </Box>
            ))}
          <Text color={colors.accent}>◉ what you picked</Text>
        </Box>
        {problems.map((problem) => (
          <Text key={problem} color={colors.error} wrap="wrap">
            ! {problem}
          </Text>
        ))}
      </Box>
    );
  };

  const renderTransport = (row: Extract<Row, { kind: 'transport' }>) => {
    const connection = data.connections[row.provider.name];
    const preference = data.preferences[row.provider.name] ?? {};
    const state = stateOf(row.transport, connection, row.provider);
    const look = STATE_LOOK[state];
    const probe = probeFor(row);
    const inUse = row.provider.transports.find((transport) => transport.id === connection?.transport);
    const role =
      state === 'in-use'
        ? `${preference.transport === row.transport.id ? 'pinned' : 'the first that works'} — this is what depli uses`
        : state === 'ready'
          ? `works, standing by — ${inUse?.label ?? 'another'} is used${preference.transport ? ' (pinned)' : ' (earlier in order)'}`
          : state === 'planned'
            ? 'not supported by depli yet — never used'
            : state === 'checking'
              ? 'probing…'
              : preference.transport === row.transport.id
                ? 'pinned but failing — nothing connected. Use Auto to fall back'
                : inUse
                  ? `not needed while ${inUse.label} works — fix it only to have a fallback`
                  : 'nothing else works either — fix this or another one';
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={colors[look.role] as string} bold>
            {look.glyph} {look.text.toUpperCase()}
          </Text>
          {probe?.identity ? <Text color={colors.text}> · as {probe.identity}</Text> : null}
        </Box>
        <Text color={colors.muted} wrap="wrap">
          {role}
        </Text>
        {probe && !(row.transport.setup && hasCredentials(row.provider)) ? (
          <Text color={probe.ok ? colors.text : colors.error} wrap="wrap">
            {probe.ok ? '✓' : '✗'} {probe.detail}
          </Text>
        ) : null}
        <CapabilityChips provider={row.provider} transport={row.transport} />
        {!row.transport.recommended ? (
          <Box marginTop={1} flexDirection="column">
            {renderRecommended(row.provider, row.transport)}
          </Box>
        ) : null}
        {row.transport.setup && !hasCredentials(row.provider) ? renderSetup(row.provider) : null}
        {row.transport.setup && hasCredentials(row.provider) ? null : (
          <ProbeDetail probe={probe} showGuide={showGuide} transport={row.transport} />
        )}
        {row.transport.choiceLabel && probe?.choices ? (
          <Text color={colors.muted} wrap="wrap">
            {'\n'}
            {row.transport.choiceLabel}s are listed under it — selecting one (click or ↑/↓) tests it, its Use button (or Enter) uses only that one.
          </Text>
        ) : null}
      </Box>
    );
  };

  const renderChoice = (row: Extract<Row, { kind: 'choice' }>) => {
    const preference = data.preferences[row.provider.name] ?? {};
    const picked = preference.choices?.[row.transport.id];
    const selectedTransport = preference.transport ?? data.connections[row.provider.name]?.transport;
    const inUse = selectedTransport === row.transport.id && row.choice === picked;
    const tested = tests[choiceKey(row.provider.name, row.transport.id, row.choice)];
    const probe = probeFor(row);
    return (
      <Box flexDirection="column">
        <Text color={colors.text} bold>
          {inUse ? '◉ in use for ' : '○ '}
          {row.transport.label}
          {inUse ? '' : ' — not in use'}
        </Text>
        <Text color={row.tone === 'warn' ? colors.warn : colors.muted} wrap="wrap">
          {row.choice ? row.detail : 'No key forced: ssh offers whatever ~/.ssh/config and the agent have, in its order, and GitHub takes the first it knows.'}
        </Text>
        {tested === 'running' ? (
          <Text color={colors.muted}>{'\n'}… testing with git ls-remote</Text>
        ) : probe ? (
          <Text color={probe.ok ? colors.ok : colors.error} wrap="wrap">
            {'\n'}
            {probe.ok ? '✓' : '✗'} {probe.detail}
          </Text>
        ) : null}
        <ProbeDetail probe={probe} showGuide={showGuide} transport={row.transport} />
      </Box>
    );
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {prompt.line ? <Box flexShrink={0}>{prompt.line}</Box> : null}
    <ListDetail
      title="Connections"
      isInputActive={!prompt.isOpen}
      items={items}
      emptyText="No providers — add some to depli.config.ts"
      detailTitle={
        !selected
          ? 'Connections'
          : selected.kind === 'auto'
            ? `${selected.provider.plugin.icon} ${selected.provider.plugin.label} — how depli connects`
            : selected.kind === 'transport'
              ? `${selected.provider.name} · ${selected.transport.label}`
              : `${selected.provider.name} · ${selected.transport.choiceLabel ?? 'choice'}: ${selected.label}`
      }
      activateLabel="use this"
      onActivate={(item) => item.value && activate(item.value)}
      //? A click selects (and tests a key), a click on the selected row uses it — the
      //? mouse's ↑/↓ then Enter; the Use button in the detail does it in one
      confirmClick
      hints={[
        { key: 'P', label: 'probe now', onPress: data.reprobe },
        ...(selected && setupOf(selected.provider) && !setupWaiting
          ? [{ key: 'L', label: 'sign in', onPress: () => startSetup(selected.provider) }]
          : []),
        ...(selected?.kind === 'choice'
          ? [{ key: 'T', label: 'test again', onPress: () => test(selected, true) }]
          : []),
        {
          key: 'g',
          label: showGuide ? 'hide guide' : 'setup guide',
          onPress: () => setShowGuide((on) => !on),
        },
        ...(firstLink()
          ? [{ key: 'o', label: 'open link', onPress: () => openUrl(firstLink()?.url ?? '') }]
          : []),
        { key: 'PgUp/PgDn · ⇧↑/↓ · wheel', label: 'scroll' },
      ]}
      initialSelectedId={session.selected.connections}
      onSelectionChange={(item) => {
        session.selected.connections = item?.id;
        setSelectedId(item?.id);
      }}
      renderDetail={(item) => {
        const row = item?.value;
        if (!row) return null;
        return (
          <Box flexDirection="column">
            {renderCredentials(row.provider)}
            {renderUseButton(row)}
            {row.kind === 'auto'
              ? renderAuto(row.provider)
              : row.kind === 'transport'
                ? renderTransport(row)
                : renderChoice(row)}
          </Box>
        );
      }}
    />
    </Box>
  );
};

export default ConnectionsView;
