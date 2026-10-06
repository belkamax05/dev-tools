import { useMemo } from 'react';
import type PickerItem from '../../../types/PickerItem';
import filterPickerItems from '../../../utils/picker/filterPickerItems';

/** Memoised search over the rows of one picker level. */
const useCommandFilter = (items: PickerItem[], query: string): PickerItem[] =>
  useMemo(() => filterPickerItems(items, query), [items, query]);

export default useCommandFilter;
