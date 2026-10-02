import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { GitHubRepo, RepoLink } from '../../core/repoLinks';

/**
 * A GitHub repository's feature links, under a bookmark of it in the detail pane: a button each,
 * clickable and carrying its key. Nothing is drawn for a repository with every link switched off.
 *
 * Buttons rather than a `Toolbar`: the panel's frame already sets them apart, and a toolbar's
 * divider line inside it would only be noise.
 */
export const RepoPanel = ({
  repo,
  links,
  onOpen,
}: {
  repo: GitHubRepo;
  links: RepoLink[];
  onOpen: (link: RepoLink) => void;
}) => {
  const colors = useColors();
  if (!links.length) return null;
  return (
    <Panel title="GitHub" badge={`${repo.owner}/${repo.name}`} color={colors.muted}>
      <Box flexDirection="row" flexWrap="wrap">
        {links.map((link) => (
          <ActionButton
            key={link.id}
            hotkey={link.hotkey}
            label={link.label}
            color={colors.text}
            onPress={() => onOpen(link)}
          />
        ))}
      </Box>
    </Panel>
  );
};

export default RepoPanel;
