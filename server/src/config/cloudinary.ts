// Central Cloudinary configuration + reusable helpers.
//
// The API secret lives ONLY here (server-side) and is never sent to the client.
// If the three CLOUDINARY_* env vars are not all present we stay disabled and the
// storage layer transparently falls back to local-disk storage, so nothing breaks
// before real credentials are configured.
import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

export const isCloudinaryEnabled = Boolean(
  env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret,
);

if (isCloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
}

export { cloudinary };

/** Root folder under which every bucket's assets are organised in Cloudinary. */
export const CLOUDINARY_ROOT_FOLDER = 'ticketing-app';

export type ParsedCloudinaryUrl = {
  publicId: string;
  resourceType: 'image' | 'video' | 'raw';
};

/**
 * Extract the `public_id` (including its folder path) and `resource_type` from a
 * Cloudinary delivery URL so the asset can be destroyed. Returns null for URLs
 * that are not Cloudinary-hosted (e.g. legacy local-disk URLs), which the caller
 * treats as "nothing to delete on Cloudinary".
 *
 * Example:
 *   https://res.cloudinary.com/demo/image/upload/v1699/ticketing-app/profile-pictures/u1/avatar.jpg
 *   -> { resourceType: 'image', publicId: 'ticketing-app/profile-pictures/u1/avatar' }
 */
export function parseCloudinaryUrl(url: string): ParsedCloudinaryUrl | null {
  if (!url || !/res\.cloudinary\.com/.test(url)) return null;
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean); // [cloud, resource, 'upload', ...rest]
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx === -1) return null;

    const resourceType = (parts[uploadIdx - 1] as ParsedCloudinaryUrl['resourceType']) ?? 'image';

    // Everything after 'upload', dropping a leading version segment (v1234567890).
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
    if (rest.length === 0) return null;

    let publicId = rest.join('/');
    // For image/video the stored public_id has no extension; for raw it does.
    if (resourceType !== 'raw') publicId = publicId.replace(/\.[^/.]+$/, '');

    return { publicId: decodeURIComponent(publicId), resourceType };
  } catch {
    return null;
  }
}

/**
 * Delete a Cloudinary asset given its delivery URL. No-op (resolves false) when the
 * URL is not a Cloudinary URL or Cloudinary is disabled. Never throws — deletion is
 * best-effort so it can't block the primary request.
 */
export async function destroyByUrl(url: string): Promise<boolean> {
  if (!isCloudinaryEnabled) return false;
  const parsed = parseCloudinaryUrl(url);
  if (!parsed) return false;
  try {
    await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType });
    return true;
  } catch {
    return false;
  }
}
