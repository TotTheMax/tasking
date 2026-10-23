const CREDENTIAL_PAIR_RE =
  /(Bearer|Basic|token|api[_-]?key|secret|password)(\s*[:=]\s*|\s+)([A-Za-z0-9\-_.~+/=]{8,})/gi;
const LONG_TOKEN_RE = /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,}(?![A-Za-z0-9+/=_-])/g;

export function redactSecrets(text: string): string {
  return text
    .replace(CREDENTIAL_PAIR_RE, (_match, label: string, sep: string) => `${label}${sep}***`)
    .replace(LONG_TOKEN_RE, "***");
}
