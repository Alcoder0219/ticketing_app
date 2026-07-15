// Storage client mirroring supabase.storage.from(bucket).{upload,createSignedUrl,getPublicUrl,remove,list}.
import { apiBase, getToken } from './http';

function objectPath(bucket: string, path: string) {
  return `${apiBase()}/storage/v1/object/${bucket}/${path.replace(/^\/+/, '')}`;
}

class BucketClient {
  constructor(private bucket: string) {}

  async upload(
    path: string,
    file: File | Blob,
    _opts?: { upsert?: boolean; contentType?: string; cacheControl?: string },
  ) {
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const resp = await fetch(objectPath(this.bucket, path), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { data: null, error: { message: body?.error ?? 'Upload failed' } };
    return { data: body.data ?? { path }, error: null };
  }

  async createSignedUrl(path: string, expiresIn: number) {
    const token = getToken();
    const resp = await fetch(
      `${apiBase()}/storage/v1/object/sign/${this.bucket}/${path.replace(/^\/+/, '')}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ expiresIn }),
      },
    );
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { data: null, error: { message: body?.error ?? 'Sign failed' } };
    return { data: body.data, error: null };
  }

  getPublicUrl(path: string) {
    // New uploads return an absolute Cloudinary secure_url from the server; pass it
    // through unchanged. Legacy local uploads return a relative object path, which we
    // resolve to the server's public-read URL (keeps existing stored images working).
    const publicUrl = /^https?:\/\//i.test(path)
      ? path
      : `${apiBase()}/storage/v1/object/public/${this.bucket}/${path.replace(/^\/+/, '')}`;
    return { data: { publicUrl } };
  }

  async remove(paths: string[]) {
    const token = getToken();
    const resp = await fetch(`${apiBase()}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ paths }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { data: null, error: { message: body?.error ?? 'Remove failed' } };
    return { data: body.data, error: null };
  }
}

export const storageClient = {
  from(bucket: string) {
    return new BucketClient(bucket);
  },
};
