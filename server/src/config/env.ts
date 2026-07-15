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
