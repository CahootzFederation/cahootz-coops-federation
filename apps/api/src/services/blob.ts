import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { env } from '../env.js';

const VERCEL_BLOB_API_URL = 'https://blob.vercel-storage.com';

export interface UploadTokenResult {
  clientToken: string;
  pathname: string;
  uploadUrl: string;
}

function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return map[contentType] ?? 'bin';
}

export function generateFileKey(
  uploadType: 'profile' | 'store' | 'product' | 'post' | 'comment' | 'feedback' | 'offer',
  resourceId: string,
  filename: string
): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

  switch (uploadType) {
    case 'profile':
      return `profiles/${resourceId}/${timestamp}-${sanitizedFilename}`;
    case 'store':
      return `stores/${resourceId}/${timestamp}-${sanitizedFilename}`;
    case 'product':
      return `products/${resourceId}/${timestamp}-${sanitizedFilename}`;
    case 'post':
      return `posts/${resourceId}/${timestamp}-${sanitizedFilename}`;
    case 'comment':
      return `comments/${resourceId}/${timestamp}-${sanitizedFilename}`;
    case 'feedback':
      return `feedback/${resourceId}/${timestamp}-${sanitizedFilename}`;
    case 'offer':
      return `offers/${resourceId}/${timestamp}-${sanitizedFilename}`;
    default:
      return `uploads/${timestamp}-${sanitizedFilename}`;
  }
}

const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;

export async function generateUploadToken(
  pathname: string,
  contentType: string,
  maxSizeBytes: number = 10 * 1024 * 1024
): Promise<UploadTokenResult> {
  const clientToken = await generateClientTokenFromReadWriteToken({
    token: env.BLOB_READ_WRITE_TOKEN,
    pathname,
    maximumSizeInBytes: maxSizeBytes,
    allowedContentTypes: [contentType],
    addRandomSuffix: false,
    // A 100 MB post video on a slow phone connection can take well over five
    // minutes to send, and an expired token fails the whole post.
    validUntil: Date.now() + UPLOAD_TOKEN_TTL_MS,
  });

  const uploadUrl = `${VERCEL_BLOB_API_URL}/${encodeURIComponent(pathname)}`;

  return { clientToken, pathname, uploadUrl };
}

export async function generateBatchUploadTokens(
  count: number,
  prefix: string,
  contentType: string
): Promise<UploadTokenResult[]> {
  const results: UploadTokenResult[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = Date.now() + i;
    const randomId = Math.random().toString(36).substring(7);
    const ext = getExtensionFromContentType(contentType);
    const pathname = `${prefix}${timestamp}-${randomId}.${ext}`;
    results.push(await generateUploadToken(pathname, contentType));
  }

  return results;
}

export async function deleteBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (error) {
    console.error('Error deleting blob:', error);
  }
}

export { getExtensionFromContentType };
