import sysPaths from '../../config/sysPaths';
import type { UserIdentity } from '../../types/UserIdentity';
import getConfig from '../getConfig';
import validateUser from '../validateUser';

/**
 * Detect current git user
 */
const getCurrentUser = async (cwd = sysPaths.rootDir): Promise<UserIdentity> => {
  let email = 'unknown@example.com';
  let name = 'Unknown User';

  try {
    const gitEmail = await getConfig('user.email', cwd);
    const gitName = await getConfig('user.name', cwd);

    if (gitEmail) email = gitEmail;
    if (gitName) name = gitName;
  } catch (_error) {
    // Ignore error, use default
  }

  const { isValid, errors } = validateUser(email);

  return {
    email,
    name,
    id: (email === 'unknown@example.com' ? 'default' : email)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase(),
    isValid,
    validationErrors: errors,
  };
};

export default getCurrentUser;
