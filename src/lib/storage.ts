import { supabase } from "@/integrations/api/client";
import { useEffect, useState } from "react";

/**
 * Extract bucket + storage path from either:
 *  - a stored public URL like ".../storage/v1/object/public/<bucket>/<path>"
 *  - a stored signed URL like ".../storage/v1/object/sign/<bucket>/<path>?token=..."
 *  - or a raw "<bucket>/<path>" / "<path>" string.
 */
function parseStorageRef(value: string, fallbackBucket?: string): { bucket: string; path: string } | null {
  if (!value) return null;
  try {
    const m = value.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch {}
  if (fallbackBucket) return { bucket: fallbackBucket, path: value.replace(/^\/+/, "") };
  return null;
}

const cache = new Map<string, { url: string; exp: number }>();
const TTL_SECONDS = 3600;

export async function getSignedFileUrl(value: string, fallbackBucket?: string): Promise<string> {
  if (!value) return value;
  // Absolute URLs that aren't this server's local storage (e.g. Cloudinary secure_urls)
  // are already publicly deliverable — return them as-is instead of trying to sign them.
  if (/^https?:\/\//i.test(value) && !value.includes('/storage/v1/object/')) return value;
  const ref = parseStorageRef(value, fallbackBucket);
  if (!ref) return value;
  const key = `${ref.bucket}/${ref.path}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = cache.get(key);
  if (cached && cached.exp - 60 > now) return cached.url;
  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, TTL_SECONDS);
  if (error || !data?.signedUrl) return value;
  cache.set(key, { url: data.signedUrl, exp: now + TTL_SECONDS });
  return data.signedUrl;
}

export function useSignedUrl(value: string | null | undefined, fallbackBucket?: string): string {
  const [url, setUrl] = useState<string>(value ?? "");
  useEffect(() => {
    let cancelled = false;
    if (!value) { setUrl(""); return; }
    getSignedFileUrl(value, fallbackBucket).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [value, fallbackBucket]);
  return url;
}
