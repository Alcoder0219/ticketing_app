import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { requireAuth } from '../auth/middleware.js';
import { isCloudinaryEnabled, destroyByUrl } from '../config/cloudinary.js';
import { cloudinaryUploadSingle } from './cloudinaryStorage.js';

export const storageRouter = Router();

const ROOT = path.resolve(process.cwd(), env.storageDir);
fs.mkdirSync(ROOT, { recursive: true });

function safeJoin(bucket: string, objectPath: string): string {
  const target = path.resolve(ROOT, bucket, objectPath);
  const base = path.resolve(ROOT, bucket);
  if (!target.startsWith(base)) throw new Error('Invalid path');
  return target;
}

function isCloudinaryUrl(value: string): boolean {
  return /res\.cloudinary\.com/.test(value);
}

// Resolve the on-disk relative path from either a raw "<path>" string or a full
// local storage URL (".../storage/v1/object/public|sign/<bucket>/<path>").
function localRelPath(value: string): string {
  const m = value.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/([^?]+)/);
  if (m) return decodeURIComponent(m[1]);
  return value.replace(/^\/+/, '');
}

// Local-disk uploader (fallback used only when Cloudinary is not configured).
const localUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// Pick the upload middleware once, based on whether Cloudinary credentials exist.
const uploadMiddleware = isCloudinaryEnabled ? cloudinaryUploadSingle : localUpload.single('file');

// ── Upload: POST /storage/v1/object/:bucket/*  (file in `file` field) ─────────
// With Cloudinary enabled the file streams straight to Cloudinary and we return its
// `secure_url` as `data.path` — so callers persist ONLY the URL in MongoDB (no
// buffer/base64/binary ever touches the database). Falls back to local disk if the
// CLOUDINARY_* env vars are not set.
storageRouter.post('/object/:bucket/*', requireAuth, uploadMiddleware, (req, res) => {
  try {
    const bucket = req.params.bucket;
    const objectPath = (req.params as any)[0] ?? '';
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (isCloudinaryEnabled) {
      // multer-storage-cloudinary sets file.path -> secure_url, file.filename -> public_id.
      const secureUrl = (req.file as any).path as string;
      return res.json({
        data: { path: secureUrl, fullPath: secureUrl, publicUrl: secureUrl },
        error: null,
      });
    }

    const dest = safeJoin(bucket, objectPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, req.file.buffer);
    return res.json({ data: { path: objectPath, fullPath: `${bucket}/${objectPath}` }, error: null });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ── Public read: GET /storage/v1/object/public/:bucket/* ──────────────────────
storageRouter.get('/object/public/:bucket/*', (req, res) => {
  serveFile(req.params.bucket, (req.params as any)[0], res);
});

// ── Issue a signed URL: POST /storage/v1/object/sign/:bucket/*  { expiresIn } ─
storageRouter.post('/object/sign/:bucket/*', requireAuth, (req, res) => {
  const bucket = req.params.bucket;
  const objectPath = (req.params as any)[0] ?? '';
  const expiresIn = Number(req.body?.expiresIn ?? 3600);
  const token = jwt.sign({ bucket, objectPath }, env.jwtSecret, { expiresIn });
  const signedUrl = `${env.publicBaseUrl}/storage/v1/object/sign/${bucket}/${encodeURIComponent(
    objectPath,
  )}?token=${token}`;
  return res.json({ data: { signedUrl }, error: null });
});

// ── Signed read: GET /storage/v1/object/sign/:bucket/*?token= ─────────────────
storageRouter.get('/object/sign/:bucket/*', (req, res) => {
  try {
    const token = String(req.query.token ?? '');
    const payload = jwt.verify(token, env.jwtSecret) as { bucket: string; objectPath: string };
    if (payload.bucket !== req.params.bucket) throw new Error('bucket mismatch');
    serveFile(payload.bucket, payload.objectPath, res);
  } catch {
    res.status(401).json({ error: 'Invalid or expired signed URL' });
  }
});

// ── Remove: DELETE /storage/v1/object/:bucket  { paths: string[] } ────────────
// `paths` may contain Cloudinary secure_urls (new uploads) or legacy local paths.
// Cloudinary URLs are destroyed via the SDK; anything else is removed from disk.
// This powers the update flow (delete old → upload new) and record-delete cleanup.
storageRouter.delete('/object/:bucket', requireAuth, async (req, res) => {
  const bucket = req.params.bucket;
  const paths: string[] = req.body?.paths ?? [];
  for (const p of paths) {
    try {
      if (isCloudinaryUrl(p)) {
        await destroyByUrl(p);
      } else {
        fs.rmSync(safeJoin(bucket, localRelPath(p)), { force: true });
      }
    } catch {
      /* best-effort: never let cleanup failure break the request */
    }
  }
  return res.json({ data: paths.map((p) => ({ name: p })), error: null });
});

function serveFile(bucket: string, objectPath: string, res: import('express').Response) {
  try {
    const file = safeJoin(bucket, decodeURIComponent(objectPath));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    return res.sendFile(file);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }
}
