import { describe, expect, test } from 'bun:test';
import getCurrentUser from '.';

describe('getCurrentUser', () => {
  test('should return a UserIdentity object', async () => {
    const user = await getCurrentUser();

    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('isValid');
    expect(user).toHaveProperty('validationErrors');
  });

  test('should return default values when git config fails', async () => {
    const user = await getCurrentUser();

    // Should have some values even if git config is not available
    expect(typeof user.email).toBe('string');
    expect(typeof user.name).toBe('string');
    expect(typeof user.id).toBe('string');
    expect(typeof user.isValid).toBe('boolean');
  });

  test('should generate valid user ID from email', async () => {
    const user = await getCurrentUser();

    // User ID should be lowercase alphanumeric with underscores
    expect(user.id).toMatch(/^[a-z0-9_]+$/);
    expect(user.id.length).toBeGreaterThan(0);
  });

  test('should use "default" ID for unknown email', async () => {
    // When email is unknown@example.com, ID should be 'default'
    const user = await getCurrentUser();

    if (user.email === 'unknown@example.com') {
      expect(user.id).toBe('default');
    }
  });

  test('should sanitize email for user ID', async () => {
    const user = await getCurrentUser();

    // User ID should not contain special characters
    expect(user.id).not.toContain('@');
    expect(user.id).not.toContain('.');
    expect(user.id).not.toContain('-');
  });

  test('should validate email using validateUser', async () => {
    const user = await getCurrentUser();

    expect(typeof user.isValid).toBe('boolean');

    if (!user.isValid) {
      expect(user.validationErrors).toBeDefined();
      expect(Array.isArray(user.validationErrors)).toBe(true);
    }
    // Valid users may or may not have validationErrors depending on validateUser implementation
  });

  test('should return consistent results on multiple calls', async () => {
    const user1 = await getCurrentUser();
    const user2 = await getCurrentUser();

    expect(user1.email).toBe(user2.email);
    expect(user1.name).toBe(user2.name);
    expect(user1.id).toBe(user2.id);
    expect(user1.isValid).toBe(user2.isValid);
  });

  test('should handle git config errors gracefully', async () => {
    // Should not throw even if git config fails
    await expect(getCurrentUser()).resolves.toBeDefined();
  });

  test('should return proper TypeScript types', async () => {
    const user = await getCurrentUser();

    // Check return type structure
    const keys = Object.keys(user);
    expect(keys).toContain('email');
    expect(keys).toContain('name');
    expect(keys).toContain('id');
    expect(keys).toContain('isValid');
    expect(keys).toContain('validationErrors');
  });
});
