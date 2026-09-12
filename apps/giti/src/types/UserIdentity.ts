export interface UserIdentity {
  email: string;
  name: string;
  id: string; // URL-safe normalized email or username
  isValid: boolean;
  validationErrors?: string[];
}
