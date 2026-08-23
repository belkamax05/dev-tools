import { Select } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

const VISIBLE_COUNT = 12;

export interface ScrollableSelectOption {
  label: string;
  value: string;
}

export interface ScrollableSelectProps {
  options: ScrollableSelectOption[];
  onChange: (value: string) => void;
  onHighlight?: (value: string) => void;
  highlightText?: string;
}

//? Wraps @inkjs/ui Select with ↑/↓ scroll indicators.
//? Tracks scroll position externally by mirroring useSelectState's window math,
//? since Select doesn't expose visibleFromIndex/visibleToIndex via props.
const ScrollableSelect = ({
  options,
  onChange,
  onHighlight,
  highlightText,
}: ScrollableSelectProps) => {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [visibleFrom, setVisibleFrom] = useState(0);

  const visibleTo = visibleFrom + VISIBLE_COUNT;
  const hasAbove = visibleFrom > 0;
  const hasBelow = visibleTo < options.length;

  const optionsKey = options.map((option) => `${option.label}:${option.value}`).join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: optionsKey is a serialized representation of options to avoid identity-based resetting
  useEffect(() => {
    setFocusedIndex(0);
    setVisibleFrom(0);
    const first = options[0];
    if (first) onHighlight?.(first.value);
  }, [optionsKey, onHighlight]);

  useInput((_input, key) => {
    if (key.downArrow && focusedIndex < options.length - 1) {
      const next = focusedIndex + 1;
      setFocusedIndex(next);
      if (next >= visibleTo) setVisibleFrom((from) => Math.min(from + 1, options.length - VISIBLE_COUNT));
      const option = options[next];
      if (option) onHighlight?.(option.value);
    }
    if (key.upArrow && focusedIndex > 0) {
      const prev = focusedIndex - 1;
      setFocusedIndex(prev);
      if (prev < visibleFrom) setVisibleFrom((from) => Math.max(0, from - 1));
      const option = options[prev];
      if (option) onHighlight?.(option.value);
    }
  });

  return (
    <Box flexDirection="column">
      {hasAbove && (
        <Box justifyContent="center">
          <Text dimColor>↑ {visibleFrom} above</Text>
        </Box>
      )}
      <Select
        options={options}
        visibleOptionCount={VISIBLE_COUNT}
        onChange={onChange}
        highlightText={highlightText}
      />
      {hasBelow && (
        <Box justifyContent="center">
          <Text dimColor>↓ {options.length - visibleTo} below</Text>
        </Box>
      )}
    </Box>
  );
};

export default ScrollableSelect;
