import type { HttpResult } from '../providers/types';

export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

export function buildHttpResult(
  status: number,
  headers: Record<string, string>,
  text: string,
): HttpResult {
  const normalizedHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalizedHeaders[name.toLowerCase()] = value;
  }

  const trimmed = text.trim();
  let json: unknown;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      json = undefined;
    }
  }

  return {
    status,
    headers: normalizedHeaders,
    text,
    json,
    challenge:
      (status === 403 || status === 503) &&
      (normalizedHeaders['cf-mitigated'] === 'challenge' || text.includes('Just a moment...')),
  };
}
