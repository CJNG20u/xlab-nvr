import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage } from 'http';
import type { Express, NextFunction, Request, Response } from 'express';
import { DATA_DIR } from './storage.ts';

/**
 * xlab-nvr authentication
 *
 * - Single admin account, password hashed with scrypt (random salt, timing-safe compare).
 * - Opaque random session tokens in an HttpOnly + SameSite=Lax cookie. Only SHA-256 hashes of
 *   tokens are stored on disk, so a leaked auth.json cannot be replayed as a session.
 * - Cookies are sent automatically by <img>, <video>, EventSource and WebSocket, so snapshots,
 *   recordings, SSE and live streams are protected without any client-side token plumbing.
 * - Login/setup attempts are rate limited per client IP (plus a global cap).
 * - State-changing requests and WebSocket upgrades must come from the same origin.
 */

export const SESSION_COOKIE = 'xlab_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{3,64}$/;

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 5;
const MAX_ATTEMPTS_GLOBAL = 40;

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

interface StoredSession {
  id: string; // sha256 hex of the session token
  createdAt: number;
  expiresAt: number;
  userAgent: string;
}

interface AuthState {
  version: 1;
  username: string;
  passwordHash: string;
  sessions: StoredSession[];
}

export class AuthError extends Error {
  status: number;
  retryAfterSec?: number;
  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export function isAuthDisabled(): boolean {
  return process.env.NVR_AUTH_DISABLED === 'true';
}

function allowedOriginHosts(): string[] {
  return (process.env.NVR_ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      try {
        return new URL(v.includes('://') ? v : `https://${v}`).host.toLowerCase();
      } catch {
        return v.toLowerCase();
      }
    });
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

let state: AuthState | null = null;
let stateLoaded = false;

function loadState(): AuthState | null {
  if (stateLoaded) return state;
  stateLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as Partial<AuthState>;
    if (
      raw &&
      typeof raw.username === 'string' &&
      typeof raw.passwordHash === 'string' &&
      raw.passwordHash.startsWith('scrypt$')
    ) {
      state = {
        version: 1,
        username: raw.username,
        passwordHash: raw.passwordHash,
        sessions: Array.isArray(raw.sessions)
          ? raw.sessions.filter(
              (s): s is StoredSession =>
                !!s && typeof s.id === 'string' && typeof s.expiresAt === 'number'
            )
          : [],
      };
    }
  } catch {
    state = null;
  }
  return state;
}

function saveState(): void {
  if (!state) return;
  const tmpPath = `${AUTH_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, AUTH_FILE);
}

function pruneSessions(now = Date.now()): boolean {
  if (!state) return false;
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((s) => s.expiresAt > now);
  return state.sessions.length !== before;
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  try {
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualStrings(a: string, b: string): boolean {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );
}

export function validateUsername(value: unknown): string {
  if (typeof value !== 'string' || !USERNAME_PATTERN.test(value.trim())) {
    throw new AuthError(
      400,
      'Username must be 3-64 characters: letters, numbers, dot, dash, underscore or @.'
    );
  }
  return value.trim();
}

export function validateNewPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new AuthError(400, `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed window per IP + global)
// ---------------------------------------------------------------------------

interface AttemptWindow {
  count: number;
  windowStart: number;
}

const ipAttempts = new Map<string, AttemptWindow>();
const globalAttempts: AttemptWindow = { count: 0, windowStart: Date.now() };

function bumpWindow(win: AttemptWindow, limit: number, now: number): number {
  if (now - win.windowStart >= ATTEMPT_WINDOW_MS) {
    win.count = 0;
    win.windowStart = now;
  }
  if (win.count >= limit) {
    return Math.max(1, Math.ceil((win.windowStart + ATTEMPT_WINDOW_MS - now) / 1000));
  }
  win.count += 1;
  return 0;
}

/** Registers an attempt; throws 429 AuthError when the caller is over the limit. */
function registerAttempt(ip: string): void {
  const now = Date.now();

  if (ipAttempts.size > 5000) {
    for (const [key, win] of ipAttempts) {
      if (now - win.windowStart >= ATTEMPT_WINDOW_MS) ipAttempts.delete(key);
    }
  }

  let win = ipAttempts.get(ip);
  if (!win) {
    win = { count: 0, windowStart: now };
    ipAttempts.set(ip, win);
  }

  const retryIp = bumpWindow(win, MAX_ATTEMPTS_PER_IP, now);
  if (retryIp > 0) {
    throw new AuthError(429, 'Too many attempts. Try again later.', retryIp);
  }
  const retryGlobal = bumpWindow(globalAttempts, MAX_ATTEMPTS_GLOBAL, now);
  if (retryGlobal > 0) {
    win.count = Math.max(0, win.count - 1);
    throw new AuthError(429, 'Too many attempts. Try again later.', retryGlobal);
  }
}

function clearAttempts(ip: string): void {
  ipAttempts.delete(ip);
}

// ---------------------------------------------------------------------------
// Account + session operations
// ---------------------------------------------------------------------------

export function isSetupRequired(): boolean {
  return !loadState();
}

function createSession(userAgent: string): string {
  if (!state) throw new AuthError(500, 'Authentication is not initialised.');
  const now = Date.now();
  pruneSessions(now);
  const token = crypto.randomBytes(32).toString('base64url');
  state.sessions.push({
    id: sha256Hex(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    userAgent: userAgent.slice(0, 200),
  });
  if (state.sessions.length > MAX_SESSIONS) {
    state.sessions.sort((a, b) => a.createdAt - b.createdAt);
    state.sessions = state.sessions.slice(state.sessions.length - MAX_SESSIONS);
  }
  saveState();
  return token;
}

export async function createInitialAccount(
  usernameRaw: unknown,
  passwordRaw: unknown
): Promise<string> {
  if (loadState()) throw new AuthError(409, 'An account already exists. Sign in instead.');
  const username = validateUsername(usernameRaw);
  const password = validateNewPassword(passwordRaw);
  const passwordHash = await hashPassword(password);
  // Re-check after the async hash so two simultaneous setups cannot both succeed
  if (loadState()) throw new AuthError(409, 'An account already exists. Sign in instead.');
  state = { version: 1, username, passwordHash, sessions: [] };
  stateLoaded = true;
  saveState();
  return username;
}

/** Optional headless bootstrap: NVR_ADMIN_USER + NVR_ADMIN_PASSWORD (only used when no account exists). */
export async function seedAccountFromEnv(): Promise<void> {
  if (isAuthDisabled() || loadState()) return;
  const user = process.env.NVR_ADMIN_USER;
  const pass = process.env.NVR_ADMIN_PASSWORD;
  if (!user || !pass) return;
  try {
    await createInitialAccount(user, pass);
    console.info(`[auth] Admin account "${user.trim()}" created from environment variables.`);
  } catch (err) {
    console.error(
      `[auth] Could not create admin account from environment: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export async function loginWithPassword(
  usernameRaw: unknown,
  passwordRaw: unknown,
  ip: string,
  userAgent: string
): Promise<{ token: string; username: string }> {
  const current = loadState();
  if (!current) throw new AuthError(409, 'No account exists yet. Complete setup first.');

  registerAttempt(ip);

  const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';
  if (!username || !password || password.length > 1024) {
    throw new AuthError(401, 'Incorrect username or password.');
  }

  // Always run a full scrypt verification so response time doesn't reveal valid usernames
  const usernameOk = safeEqualStrings(username.toLowerCase(), current.username.toLowerCase());
  const passwordOk = await verifyPassword(password, usernameOk ? current.passwordHash : await getDummyHash());

  if (!usernameOk || !passwordOk) {
    console.warn(`[auth] Failed sign-in from ${ip}`);
    throw new AuthError(401, 'Incorrect username or password.');
  }

  clearAttempts(ip);
  const token = createSession(userAgent);
  return { token, username: current.username };
}

function lookupSession(token: string | undefined): StoredSession | null {
  if (!token || !state) return null;
  const id = sha256Hex(token);
  const now = Date.now();
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return null;
  if (session.expiresAt <= now) {
    pruneSessions(now);
    saveState();
    return null;
  }
  // Sliding renewal, persisted at most once per day
  if (session.expiresAt - now < SESSION_TTL_MS - RENEW_AFTER_MS) {
    session.expiresAt = now + SESSION_TTL_MS;
    saveState();
  }
  return session;
}

export function revokeSession(token: string | undefined): void {
  if (!token || !state) return;
  const id = sha256Hex(token);
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.sessions.length !== before) saveState();
}

export function revokeAllSessions(exceptToken?: string): number {
  if (!state) return 0;
  const keepId = exceptToken ? sha256Hex(exceptToken) : null;
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((s) => s.id === keepId);
  if (state.sessions.length !== before) saveState();
  return before - state.sessions.length;
}

export async function changePassword(
  sessionToken: string,
  currentPasswordRaw: unknown,
  newPasswordRaw: unknown,
  ip: string
): Promise<number> {
  if (!state) throw new AuthError(409, 'No account exists.');
  registerAttempt(ip);
  const currentPassword = typeof currentPasswordRaw === 'string' ? currentPasswordRaw : '';
  const newPassword = validateNewPassword(newPasswordRaw);

  if (!currentPassword || !(await verifyPassword(currentPassword, state.passwordHash))) {
    throw new AuthError(401, 'Current password is incorrect.');
  }
  clearAttempts(ip);
  state.passwordHash = await hashPassword(newPassword);
  const revoked = revokeAllSessions(sessionToken);
  saveState();
  return revoked;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || name in out) continue;
    out[name] = part.slice(idx + 1).trim();
  }
  return out;
}

export function getSessionToken(req: IncomingMessage): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || undefined;
}

export function isAuthenticatedRequest(req: IncomingMessage): boolean {
  if (isAuthDisabled()) return true;
  loadState();
  return lookupSession(getSessionToken(req)) !== null;
}

function headerFirst(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || '').split(',')[0].trim().toLowerCase();
}

/** True when the Origin header is absent (non-browser client) or matches this server's host. */
export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const candidates = [
    headerFirst(req.headers.host),
    headerFirst(req.headers['x-forwarded-host']),
    ...allowedOriginHosts(),
  ].filter(Boolean);
  return candidates.includes(originHost);
}

/** Used by the go2rtc WebSocket proxy: session required + same-origin. */
export function authorizeUpgrade(req: IncomingMessage): boolean {
  return isSameOriginRequest(req) && isAuthenticatedRequest(req);
}

function isSecureRequest(req: Request): boolean {
  return (
    req.secure ||
    headerFirst(req.headers['x-forwarded-proto']) === 'https' ||
    Boolean((req.socket as { encrypted?: boolean }).encrypted)
  );
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function sendAuthError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    if (err.retryAfterSec) res.setHeader('Retry-After', String(err.retryAfterSec));
    res.status(err.status).json({ error: err.message, code: err.status === 401 ? 'AUTH_FAILED' : undefined });
    return;
  }
  console.error('[auth] Unexpected error:', err);
  res.status(500).json({ error: 'Authentication error' });
}

// ---------------------------------------------------------------------------
// Express middleware + routes
// ---------------------------------------------------------------------------

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || isSameOriginRequest(req)) {
    next();
    return;
  }
  res.status(403).json({
    error: 'Cross-origin request blocked. If you use a reverse proxy, set NVR_ALLOWED_ORIGINS.',
  });
}

/** Express matches routes case-insensitively and decodes %-escapes, so the gate must too. */
function normalizeGuardPath(rawPath: string): string {
  let p = rawPath;
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep the raw path; guarding more than necessary is the safe direction
  }
  p = p.toLowerCase().replace(/\/{2,}/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
]);

/** Blocks unauthenticated access to /api, /recordings and /go2rtc. The login page assets stay public. */
export function authGate(req: Request, res: Response, next: NextFunction): void {
  if (isAuthDisabled()) {
    next();
    return;
  }
  const p = normalizeGuardPath(req.path);
  const guarded =
    p === '/api' ||
    p.startsWith('/api/') ||
    p === '/recordings' ||
    p.startsWith('/recordings/') ||
    p === '/go2rtc' ||
    p.startsWith('/go2rtc/');
  if (!guarded || PUBLIC_AUTH_PATHS.has(p) || isAuthenticatedRequest(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
}

export function registerAuthRoutes(app: Express): void {
  const buildStatus = (authenticated: boolean) => {
    const disabled = isAuthDisabled();
    return {
      authEnabled: !disabled,
      setupRequired: !disabled && isSetupRequired(),
      authenticated: disabled || authenticated,
      username: authenticated && !disabled ? loadState()?.username ?? null : null,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    };
  };

  app.get('/api/auth/status', (req: Request, res: Response) => {
    res.json(buildStatus(isAuthenticatedRequest(req)));
  });

  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    try {
      if (isAuthDisabled()) throw new AuthError(400, 'Authentication is disabled on this server.');
      const body = (req.body || {}) as { username?: unknown; password?: unknown };
      await createInitialAccount(body.username, body.password);
      const { token } = await loginWithPassword(
        body.username,
        body.password,
        clientIp(req),
        String(req.headers['user-agent'] || '')
      );
      setSessionCookie(req, res, token);
      res.json(buildStatus(true));
    } catch (err) {
      sendAuthError(res, err);
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      if (isAuthDisabled()) throw new AuthError(400, 'Authentication is disabled on this server.');
      const body = (req.body || {}) as { username?: unknown; password?: unknown };
      const { token } = await loginWithPassword(
        body.username,
        body.password,
        clientIp(req),
        String(req.headers['user-agent'] || '')
      );
      setSessionCookie(req, res, token);
      res.json(buildStatus(true));
    } catch (err) {
      sendAuthError(res, err);
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    revokeSession(getSessionToken(req));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-all', (req: Request, res: Response) => {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }
    const revoked = revokeAllSessions();
    clearSessionCookie(req, res);
    res.json({ ok: true, revoked });
  });

  app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    try {
      const token = getSessionToken(req);
      if (isAuthDisabled() || !token || !isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
        return;
      }
      const body = (req.body || {}) as { currentPassword?: unknown; newPassword?: unknown };
      const revoked = await changePassword(token, body.currentPassword, body.newPassword, clientIp(req));
      res.json({ ok: true, otherSessionsSignedOut: revoked });
    } catch (err) {
      sendAuthError(res, err);
    }
  });
}
