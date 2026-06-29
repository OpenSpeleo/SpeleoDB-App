import { describe, expect, it } from 'vitest';
import { getInstanceBaseUrl } from './instanceUrl';

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

  it('preserves an explicit origin port', () => {
    expect(getInstanceBaseUrl('https://speleodb.org:8443/')).toBe(
      'https://speleodb.org:8443',
    );
  });

  it.each([
    'https://speleodb.org/tenant',
    'https://speleodb.org/?tenant=one',
    'https://speleodb.org/#login',
  ])('rejects non-origin instance input %s', (instance) => {
    expect(() => getInstanceBaseUrl(instance)).toThrow(/origin URL/);
  });
});
