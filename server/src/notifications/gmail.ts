import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { GoogleAuth, JWT, OAuth2Client } from 'google-auth-library';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

import { env } from '../config/env.js';

/**
 * Gmail API transport — service account + Workspace domain-wide delegation.
 *
 * Ported from the GatePass backend (`services/gmail.service.js`) so both
 * applications send through the SAME service account, the SAME delegation grant
 * and the SAME `gmail.send` scope. Nothing new has to be authorised in Google
 * Workspace for this app to start sending.
 *
 * LAYERING. This file is the transport and nothing else: it authenticates,
 * builds a MIME message and hands it to Gmail. It contains no ticketing wording
 * and no workflow ever calls the Gmail SDK directly.
 *
 *     ticket event  →  service.ts  →  templates.ts  →  this transport  →  Gmail
 *
 * Two credential modes, in priority order:
 *
 *   1. EXPLICIT KEY  — GMAIL_SERVICE_ACCOUNT_EMAIL + PRIVATE_KEY, or a JSON key
 *      file for local dev. Signs the delegated assertion locally. Identical to
 *      GatePass.
 *   2. KEYLESS / ADC — the Cloud Run attached service account signs its own
 *      delegated assertion through the IAM Credentials API (`signJwt`). No
 *      private key exists anywhere. This is the preferred production path and
 *      is selected automatically when no explicit key is configured.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const IAM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Never let a key, token or assertion reach the logs. */
const REDACTED = '[redacted]';

/**
 * Strips anything credential-shaped out of an error before it is logged.
 *
 * Google's token endpoint echoes the signed assertion back inside the failure
 * message — e.g. "Invalid signature for token: eyJhbGciOi...". A keyword filter
 * misses that, because the word there is "token", not "access_token". The JWT
 * SHAPE itself is matched rather than any label that happens to precede it.
 */
export function safeErrorMessage(error: any): string {
  const raw = error?.response?.data?.error_description || error?.message || String(error);
  return String(raw)
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, REDACTED)
    .replace(
      /\b(assertion|access[_-]?token|id[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|token)\b\s*[:=]\s*["']?[\w.\-+/=]+/gi,
      `$1: ${REDACTED}`,
    )
    .replace(/\bya29\.[\w.\-]+/g, REDACTED)
    .slice(0, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential resolution
// ─────────────────────────────────────────────────────────────────────────────

type CredentialSource = 'env' | 'file' | 'adc';

interface ExplicitCredentials {
  clientEmail: string;
  privateKey: string;
  source: 'env' | 'file';
}

let cachedExplicit: ExplicitCredentials | null | undefined; // undefined = not yet resolved

/** Explicit key material, if configured. `null` means "use ADC instead". */
function resolveExplicitCredentials(): ExplicitCredentials | null {
  if (cachedExplicit !== undefined) return cachedExplicit;

  const { serviceAccountEmail, serviceAccountPrivateKey, serviceAccountKeyPath } = env.gmail;

  // 1. Environment variables / Secret Manager (Cloud Run).
  if (serviceAccountEmail && serviceAccountPrivateKey) {
    cachedExplicit = {
      clientEmail: serviceAccountEmail,
      privateKey: serviceAccountPrivateKey,
      source: 'env',
    };
    return cachedExplicit;
  }

  // 2. JSON key file (local development only).
  if (serviceAccountKeyPath) {
    const resolved = path.isAbsolute(serviceAccountKeyPath)
      ? serviceAccountKeyPath
      : path.resolve(process.cwd(), serviceAccountKeyPath);
    if (!fs.existsSync(resolved)) {
      console.warn(`[gmail] key file not found at ${resolved}`); // path only, never contents
      cachedExplicit = null;
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      if (!parsed.client_email || !parsed.private_key) {
        console.error('[gmail] key file is missing client_email or private_key');
        cachedExplicit = null;
        return null;
      }
      cachedExplicit = {
        clientEmail: parsed.client_email,
        privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
        source: 'file',
      };
      console.log(`[gmail] credentials loaded from ${resolved} (${parsed.client_email})`);
      return cachedExplicit;
    } catch (error: any) {
      console.error(`[gmail] could not read the key file: ${error.message}`);
      cachedExplicit = null;
      return null;
    }
  }

  cachedExplicit = null;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth clients
// ─────────────────────────────────────────────────────────────────────────────

let cachedGmail: any = null;
let cachedJwt: JWT | null = null;
let cachedSource: CredentialSource | null = null;

/** Access token minted through ADC + IAM signJwt, with its expiry. */
let adcToken: { value: string; expiresAt: number } | null = null;

/**
 * Keyless domain-wide delegation.
 *
 * ADC alone cannot impersonate a Workspace user — you cannot set `subject` on
 * the metadata-server credentials. The supported keyless route is to have the
 * attached service account sign its OWN delegated assertion through the IAM
 * Credentials API, then exchange that assertion for an access token.
 *
 * Requires, on the attached service account:
 *   • roles/iam.serviceAccountTokenCreator on ITSELF
 *   • the IAM Service Account Credentials API enabled
 *   • the existing Workspace domain-wide-delegation grant for gmail.send
 */
async function getAdcAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 60s of slack so a token never expires mid-request.
  if (adcToken && adcToken.expiresAt - 60 > now) return adcToken.value;

  const auth = new GoogleAuth({ scopes: [IAM_SCOPE] });
  const client = await auth.getClient();
  const creds = await auth.getCredentials();
  const saEmail = creds.client_email;
  if (!saEmail) {
    throw new Error(
      'Application Default Credentials did not expose a service-account email. ' +
        'On Cloud Run, attach a service account; locally, set GMAIL_SERVICE_ACCOUNT_KEY_PATH.',
    );
  }

  const payload = JSON.stringify({
    iss: saEmail,
    sub: env.gmail.impersonateUser, // the Workspace user being impersonated
    scope: env.gmail.scopes.join(' '),
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  });

  const iam = google.iamcredentials({ version: 'v1', auth: client as any });
  const { data } = await iam.projects.serviceAccounts.signJwt({
    name: `projects/-/serviceAccounts/${saEmail}`,
    requestBody: { payload },
  });
  if (!data.signedJwt) throw new Error('IAM Credentials signJwt returned no assertion.');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: data.signedJwt,
    }),
  });
  const body: any = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(body?.error_description || body?.error || 'token exchange failed');
  }

  adcToken = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return adcToken.value;
}

/** Builds (once) the Gmail binding for whichever credential mode applies. */
async function getGmailClient(): Promise<any> {
  if (cachedGmail) return cachedGmail;

  const explicit = resolveExplicitCredentials();

  if (explicit) {
    // A PEM that still carries literal \n is normalised on the way in; this
    // catches a key mangled some other way, before Google returns an opaque
    // "DECODER routines::unsupported" that says nothing useful.
    if (!explicit.privateKey.includes('BEGIN') || !explicit.privateKey.includes('\n')) {
      throw new Error(
        'The Gmail private key does not look like a PEM. Supply the full key including the ' +
          'BEGIN/END lines (escaped \\n is handled automatically), or point ' +
          'GMAIL_SERVICE_ACCOUNT_KEY_PATH at the downloaded JSON.',
      );
    }
    cachedJwt = new JWT({
      email: explicit.clientEmail,
      key: explicit.privateKey,
      scopes: env.gmail.scopes,
      subject: env.gmail.impersonateUser, // domain-wide delegation
    });
    cachedSource = explicit.source;
    cachedGmail = google.gmail({ version: 'v1', auth: cachedJwt });
    return cachedGmail;
  }

  // Keyless: an OAuth2 client whose token is refreshed from ADC + signJwt.
  const oauth = new OAuth2Client();
  oauth.setCredentials({ access_token: await getAdcAccessToken() });
  cachedSource = 'adc';
  cachedGmail = google.gmail({ version: 'v1', auth: oauth });
  (cachedGmail as any).__oauth = oauth;
  return cachedGmail;
}

/** Where the credentials came from — never the values. */
export function credentialSource(): CredentialSource | null {
  if (cachedSource) return cachedSource;
  const explicit = resolveExplicitCredentials();
  return explicit ? explicit.source : null;
}

/** Drops cached clients and credentials. Useful after a config change. */
export function resetGmailClient() {
  cachedGmail = null;
  cachedJwt = null;
  cachedExplicit = undefined;
  cachedSource = null;
  adcToken = null;
}

/** Which required settings are missing — for diagnostics, never values. */
export function missingGmailConfig(): string[] {
  const missing: string[] = [];
  if (!env.gmail.enabled) missing.push('GMAIL_ENABLED');
  if (!env.gmail.impersonateUser) missing.push('GMAIL_IMPERSONATE_USER');
  return missing;
}

/**
 * True when the transport is switched on and has an impersonation target.
 * Credentials are NOT probed here: ADC is resolved lazily at send time, so a
 * Cloud Run deployment with no explicit key is still "enabled".
 */
export function isEmailEnabled(): boolean {
  return Boolean(env.gmail.enabled && env.gmail.impersonateUser);
}

/**
 * Confirms a delegated token can be minted, without sending anything. This is
 * the call that fails loudly when domain-wide delegation is not authorised for
 * the client ID / scope.
 */
export async function verifyGmailAuth(): Promise<Record<string, unknown>> {
  const missing = missingGmailConfig();
  if (missing.length) return { ok: false, configured: false, missing };
  try {
    await getGmailClient();
    if (cachedJwt) await cachedJwt.authorize(); // token held in the client, never returned
    else await getAdcAccessToken();
    return {
      ok: true,
      configured: true,
      impersonating: env.gmail.impersonateUser,
      credentialSource: credentialSource(),
      scopes: env.gmail.scopes,
      from: env.gmail.from,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error(`[gmail] auth verification failed: ${message}`);
    return { ok: false, configured: true, error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message building + send
// ─────────────────────────────────────────────────────────────────────────────

function asAddressList(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  const list = (Array.isArray(value) ? value : String(value).split(','))
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  return list.length ? list.join(', ') : undefined;
}

/** Crude but dependency-free HTML → text for the multipart fallback. */
export function htmlToText(html: string): string {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface SendOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  messageId?: string;
  error?: string;
  to?: string;
}

/** Renders an RFC 2822 message and base64url-encodes it for the Gmail API. */
async function buildRawMessage(opts: SendOptions): Promise<string> {
  const mail = new MailComposer({
    from: opts.from,
    to: asAddressList(opts.to),
    subject: opts.subject,
    html: opts.html || undefined,
    // Plain-text fallback so a text-only client never receives an empty body.
    text: opts.text || (opts.html ? htmlToText(opts.html) : undefined),
    headers: opts.headers,
  });
  const message = await mail.compile().build();
  return message.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sends one email through Gmail.
 *
 * NEVER THROWS. Email is a side effect of a business action — a failed
 * notification must not roll back the ticket that triggered it. Callers get
 * `{ ok, skipped?, messageId?, error? }` and can safely ignore it.
 */
export async function sendEmail(opts: SendOptions): Promise<SendResult> {
  const recipients = asAddressList(opts.to);

  if (!recipients) {
    console.warn('[gmail] send skipped — no recipient supplied');
    return { ok: false, skipped: true, reason: 'NO_RECIPIENT' };
  }

  if (!isEmailEnabled()) {
    // Not an error: the normal state in dev and before the Cloud Run variables
    // are set. Logged so the intent is still visible.
    console.log(`[gmail] disabled — would have sent "${opts.subject}" to ${recipients}`);
    return { ok: false, skipped: true, reason: 'DISABLED', to: recipients };
  }

  try {
    const gmail = await getGmailClient();

    // Keyless mode: refresh the ADC-derived token before each send (cached
    // internally, so this is a no-op until it is close to expiry).
    if (cachedSource === 'adc' && (gmail as any).__oauth) {
      (gmail as any).__oauth.setCredentials({ access_token: await getAdcAccessToken() });
    }

    const raw = await buildRawMessage({ ...opts, from: opts.from || env.gmail.from });
    const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

    console.log(`[gmail] sent "${opts.subject}" → ${recipients} id=${data.id}`);
    return { ok: true, messageId: data.id ?? undefined, to: recipients };
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error(`[gmail] failed to send "${opts.subject}" to ${recipients}: ${message}`);
    return { ok: false, error: message, to: recipients };
  }
}
