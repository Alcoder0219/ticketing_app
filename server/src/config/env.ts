import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:8080,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/aum_dacro_ticketing'),

  jwtSecret: required('JWT_SECRET', 'change-me-to-a-long-random-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  storageDir: process.env.STORAGE_DIR ?? 'uploads',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000',

  /** Where the *frontend* lives — used to build "View Ticket" links in emails. */
  appBaseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),

  /**
   * Gmail API transport — service account + Workspace domain-wide delegation.
   *
   * Variable names deliberately mirror the GatePass backend so the SAME service
   * account and the SAME domain-wide-delegation grant serve both applications;
   * no new Google Workspace configuration is required.
   *
   * Credentials resolve in this order:
   *   1. GMAIL_SERVICE_ACCOUNT_EMAIL + GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY  (env/Secret Manager)
   *   2. GMAIL_SERVICE_ACCOUNT_KEY_PATH                                   (local dev JSON)
   *   3. Application Default Credentials — the Cloud Run attached service
   *      account, signing the delegated assertion through the IAM Credentials
   *      API. No private key anywhere. This is the preferred production path.
   */
  gmail: {
    enabled: process.env.GMAIL_ENABLED === 'true',
    serviceAccountEmail: process.env.GMAIL_SERVICE_ACCOUNT_EMAIL || '',
    // Secret managers and shell env vars carry the PEM with literal backslash-n;
    // the Google JWT client rejects that with an opaque DECODER error.
    serviceAccountPrivateKey: (process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(
      /\\n/g,
      '\n',
    ),
    serviceAccountKeyPath: process.env.GMAIL_SERVICE_ACCOUNT_KEY_PATH || '',
    /** The Workspace user the service account impersonates. */
    impersonateUser: process.env.GMAIL_IMPERSONATE_USER || 'alert@amsonsgroup.net',
    /** Minimum scope for sending. Do not widen without a reason. */
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    /**
     * Sender. MUST match impersonateUser (or be a verified alias) — Gmail
     * rewrites or rejects a From it has not authorised. Only the display name
     * is free text.
     */
    from: process.env.EMAIL_FROM || process.env.GMAIL_FROM || 'Amsons Group Support <alert@amsonsgroup.net>',
  },

  // Cloudinary (server-side only; api secret never leaves the backend)
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? '',

  // optional integrations
  lovableApiKey: process.env.LOVABLE_API_KEY ?? '',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  googleSheetsId: process.env.GOOGLE_SHEETS_ID ?? '',

  // migration
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};
