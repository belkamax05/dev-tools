import systemConfig from '../../config/systemConfig';

const validateUser = (
  email: string,
  config?: typeof systemConfig,
): { isValid: boolean; errors?: string[] } => {
  const userConfig = (config || systemConfig).user;
  if (!userConfig?.email?.rules?.length) {
    return { isValid: true };
  }

  const rules = userConfig.email.rules;

  const isAtLeastOneMatch = rules.some((rule) => {
    switch (rule.match) {
      case 'exact':
        return email === rule.value;
      case 'includes':
        return email.includes(rule.value);
      case 'endsWith':
        return email.endsWith(rule.value);
    }
    return false;
  });

  if (!isAtLeastOneMatch) {
    return {
      isValid: false,
      errors: ['User email does not match any allowed patterns.'],
    };
  }

  return { isValid: true };
};

export default validateUser;
