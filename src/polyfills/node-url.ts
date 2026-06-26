export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

export function domainToASCII(domain: string): string {
  return domain;
}

export function domainToUnicode(domain: string): string {
  return domain;
}

export default {
  URL,
  URLSearchParams,
  domainToASCII,
  domainToUnicode,
};
