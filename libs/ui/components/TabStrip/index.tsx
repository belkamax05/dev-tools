import type { ClickableTabProps } from '../ClickableTab';
import ClickableTab from '../ClickableTab';
import Box from '../Box';

export interface TabDefinition<Id extends string = string> {
  id: Id;
  /**
   * What a shrunken tab is reduced to.
   *
   * If you use an emoji here, pick one whose base codepoint is East Asian Width
   * *Wide* and which carries no U+FE0F variation selector. Ink measures a row
   * with `string-width` and then writes it as one string; the terminal decides
   * for itself how many cells each glyph eats, and where the two disagree
   * everything after the glyph slides — the box border at the end of the row
   * lands a column off the one above it. Emoji that are only emoji by request
   * (⌨️ ⚙️ ℹ️ 🛠️) are Width=Neutral underneath, so `string-width` counts the
   * VS16 and says 2 while a terminal without an emoji font for them draws 1.
   * Padding cannot paper over the gap: a space adds a column to the measurement
   * and to the render alike.
   */
  icon: string;
  /** The spelled-out form, icon included, kept as one literal string. */
  label: string;
}

export interface TabStripProps<Id extends string = string> {
  tabs: readonly TabDefinition<Id>[];
  active: Id;
  /** Draw every tab at full width with its name, rather than shrinking the closed ones. */
  fullWidth?: boolean;
  onSelect: (id: Id) => void;
}

/**
 * The row of tabs across the top of an app.
 *
 * `fullWidth` off is the interesting mode: only the open tab spells itself out
 * and the rest shrink to their number and icon, which buys the open tab the
 * width the others were spending on names you are not currently looking at.
 */
export const TabStrip = <Id extends string = string>({
  tabs,
  active,
  fullWidth = false,
  onSelect,
}: TabStripProps<Id>) => (
  <Box flexDirection="row" width="100%">
    {tabs.map((tab, index) => {
      const props: ClickableTabProps = {
        label: tab.label,
        icon: tab.icon,
        index,
        isActive: tab.id === active,
        compact: !fullWidth,
        onSelect: () => onSelect(tab.id),
      };
      return <ClickableTab key={tab.id} {...props} />;
    })}
  </Box>
);

export default TabStrip;
