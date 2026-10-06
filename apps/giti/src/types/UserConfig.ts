export interface UserConfigRule {
  match: 'exact' | 'includes' | 'endsWith';
  value: string;
}

export interface UserConfig {
  email?: {
    rules: UserConfigRule[];
  };
}
