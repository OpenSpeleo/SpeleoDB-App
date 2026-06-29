import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INSTANCE_PATHS, openExternalUrl } from './url';

const { mockBrowserOpen } = vi.hoisted(() => ({
  mockBrowserOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: mockBrowserOpen },
}));

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
