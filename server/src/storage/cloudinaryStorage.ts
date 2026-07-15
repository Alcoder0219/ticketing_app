// Reusable Cloudinary upload middleware for the generic storage endpoint.
//
// A single HTTP endpoint (POST /storage/v1/object/:bucket/*) serves every module,
// so validation is driven by a per-bucket policy table rather than one global rule.
// This lets us enforce the "images only, 5 MB" requirement on the image buckets
// WITHOUT breaking buckets that legitimately carry other content (voice notes and
// arbitrary attachments in `ticket-attachments`, videos in `tutorial-videos`).
import type { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { cloudinary, CLOUDINARY_ROOT_FOLDER } from '../config/cloudinary.js';

const MB = 1024 * 1024;

/** Allowed MIME types for the strict image buckets (requirement #9). */
const IMAGE_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

type ResourceType = 'image' | 'video' | 'raw' | 'auto';

type BucketPolicy = {
  resourceType: ResourceType;
  maxBytes: number;
  /** Allowed MIME types; `null` means "no restriction" (any file allowed). */
  allowedMime: string[] | null;
};

// Known buckets and their upload rules. Unknown buckets use DEFAULT_POLICY.
const POLICIES: Record<string, BucketPolicy> = {
  'profile-pictures': { resourceType: 'image', maxBytes: 5 * MB, allowedMime: IMAGE_MIME },
  'ticket-resolution-photos': { resourceType: 'image', maxBytes: 5 * MB, allowedMime: IMAGE_MIME },
  'tutorial-thumbnails': { resourceType: 'image', maxBytes: 5 * MB, allowedMime: IMAGE_MIME },
  // Mixed content: images, voice notes (audio/webm) and arbitrary files — keep working.
  'ticket-attachments': { resourceType: 'auto', maxBytes: 25 * MB, allowedMime: null },
  // Tutorial videos are large; let Cloudinary treat them as video assets.
  'tutorial-videos': { resourceType: 'video', maxBytes: 200 * MB, allowedMime: null },
};

const DEFAULT_POLICY: BucketPolicy = { resourceType: 'auto', maxBytes: 25 * MB, allowedMime: null };

export function policyFor(bucket: string): BucketPolicy {
  return POLICIES[bucket] ?? DEFAULT_POLICY;
}

/** Strip the file extension so Cloudinary stores a clean public_id. */
function stripExt(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

/** Build a multer instance configured to stream a single file to Cloudinary. */
function buildUploader(bucket: string) {
  const policy = policyFor(bucket);

  const storage = new CloudinaryStorage({
    cloudinary,
    params: (req: Request, file) => {
      // The object path requested by the client (the `*` route param), e.g.
      // "<userId>/avatar-1699999999.png" — reused as the public_id so uploads stay
      // organised and predictable inside ticketing-app/<bucket>/...
      const objectPath = (req.params as Record<string, string>)[0] ?? '';
      const publicId = stripExt(objectPath) || `${bucket}-${file.originalname}`;
      return {
        folder: `${CLOUDINARY_ROOT_FOLDER}/${bucket}`,
        public_id: publicId,
        resource_type: policy.resourceType,
      };
    },
  });

  return multer({
    storage,
    limits: { fileSize: policy.maxBytes },
    fileFilter: (_req, file, cb) => {
      if (policy.allowedMime && !policy.allowedMime.includes(file.mimetype)) {
        const err = new Error(
          `Unsupported file type "${file.mimetype}". Allowed: ${policy.allowedMime.join(', ')}.`,
        );
        (err as any).status = 400;
        return cb(err);
      }
      cb(null, true);
    },
  });
}

/**
 * Express middleware: selects the correct uploader for :bucket, streams the `file`
 * field to Cloudinary, and converts multer/validation failures into clean 400s
 * (requirement #10). On success, req.file.path holds the Cloudinary secure_url.
 */
export function cloudinaryUploadSingle(req: Request, res: Response, next: NextFunction) {
  const bucket = req.params.bucket;
  const uploader = buildUploader(bucket).single('file');

  uploader(req, res, (err: unknown) => {
    if (!err) return next();

    if (err instanceof MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File too large. Maximum size for "${bucket}" is ${Math.round(
              policyFor(bucket).maxBytes / MB,
            )} MB.`
          : err.message;
      return res.status(400).json({ error: msg });
    }

    const status = (err as any)?.status ?? 400;
    return res.status(status).json({ error: (err as Error).message ?? 'Upload failed' });
  });
}
