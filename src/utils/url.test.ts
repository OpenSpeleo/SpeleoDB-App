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

  it('preserves explicit http://', () => {
    expect(getInstanceBaseUrl('http://localhost:8000')).toBe('http://localhost:8000');
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
});
