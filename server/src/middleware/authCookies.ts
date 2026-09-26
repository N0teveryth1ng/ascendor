export const SESSION_COOKIE = 'forge_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CookieHeader {
  headers: { cookie?: string };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function sessionToken(req: CookieHeader): string | undefined {
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}
