import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getInstanceBaseUrl, INSTANCE_PATHS, openExternalUrl } from './url';

const { mockBrowserOpen } = vi.hoisted(() => ({
  mockBrowserOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: mockBrowserOpen },
}));

describe('getInstanceBaseUrl', () => {
  it('prepends https:// when no scheme is present', () => {
    expect(getInstanceBaseUrl('speleodb.org')).toBe('https://speleodb.org');
  });

  it('preserves explicit https://', () => {
    expect(getInstanceBaseUrl('https://speleodb.org')).toBe('https://speleodb.org');
  });

  it('allows explicit loopback HTTP only for development', () => {
    expect(getInstanceBaseUrl('http://localhost:8000', true)).toBe('http://localhost:8000');
    expect(getInstanceBaseUrl('http://localhost:8000', false)).toBe('https://localhost:8000');
  });

  it('upgrades remote HTTP instances to HTTPS', () => {
    expect(getInstanceBaseUrl('http://speleodb.org', true)).toBe('https://speleodb.org');
  });

  it('rejects non-HTTP schemes and embedded credentials', () => {
    expect(() => getInstanceBaseUrl('javascript://alert', true)).toThrow(/HTTP/);
    expect(() => getInstanceBaseUrl('https://user:pass@speleodb.org', true)).toThrow(/credentials/);
  });

  it('trims whitespace', () => {
    expect(getInstanceBaseUrl('  speleodb.org  ')).toBe('https://speleodb.org');
  });

  it('strips trailing slashes', () => {
    expect(getInstanceBaseUrl('https://speleodb.org/')).toBe('https://speleodb.org');
    expect(getInstanceBaseUrl('https://speleodb.org///')).toBe('https://speleodb.org');
  });
});

describe('INSTANCE_PATHS', () => {
  it('exposes signup and password-reset paths', () => {
    expect(INSTANCE_PATHS.SIGNUP).toBe('/signup/');
    expect(INSTANCE_PATHS.PASSWORD_RESET).toBe('/account/password/reset/');
  });
});

describe('openExternalUrl', () => {
  beforeEach(() => {
    mockBrowserOpen.mockClear();
  });

  it('delegates to Browser.open with the given URL', async () => {
    await openExternalUrl('https://speleodb.org/signup/');
    expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://speleodb.org/signup/' });
  });

  it('is called exactly once per invocation', async () => {
    await openExternalUrl('https://example.com');
    expect(mockBrowserOpen).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe external schemes and embedded credentials', async () => {
    await expect(openExternalUrl('http://example.com')).rejects.toThrow(/HTTPS/);
    await expect(openExternalUrl('https://user:pass@example.com')).rejects.toThrow(/credentials/);
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow(/HTTP/);
    expect(mockBrowserOpen).not.toHaveBeenCalled();
  });
});
