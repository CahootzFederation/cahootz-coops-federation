import { Router, Request, Response } from 'express';
import { generateUploadToken, generateBatchUploadTokens, generateFileKey, getExtensionFromContentType } from '../services/blob.js';

const router = Router();

const ALLOWED_UPLOAD_TYPES = ['profile', 'store', 'product', 'post', 'comment'] as const;
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
];
const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const POST_VIDEO_MAX_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * POST /api/upload/presigned
 * Generate a Vercel Blob client upload token for direct client-to-blob uploads.
 */
router.post('/presigned', async (req: Request, res: Response) => {
  try {
    const { filename, contentType, uploadType, resourceId } = req.body;

    if (!contentType || !uploadType) {
      return res.status(400).json({ success: false, error: 'Missing required fields: contentType, uploadType' });
    }

    if (!ALLOWED_UPLOAD_TYPES.includes(uploadType)) {
      return res.status(400).json({ success: false, error: `Invalid uploadType. Must be one of: ${ALLOWED_UPLOAD_TYPES.join(', ')}` });
    }

    if (!ALLOWED_MIMES.includes(contentType)) {
      return res.status(400).json({ success: false, error: `Invalid content type. Allowed: ${ALLOWED_MIMES.join(', ')}` });
    }

    const resolvedFilename = filename || `upload.${getExtensionFromContentType(contentType)}`;
    const pathname = generateFileKey(uploadType, resourceId || 'temp', resolvedFilename);
    const maxSizeBytes =
      uploadType === 'post' && contentType.startsWith('video/')
        ? POST_VIDEO_MAX_SIZE_BYTES
        : IMAGE_MAX_SIZE_BYTES;
    const { clientToken, uploadUrl } = await generateUploadToken(pathname, contentType, maxSizeBytes);

    return res.json({
      success: true,
      clientToken,
      pathname,
      uploadUrl,
      expiresIn: 300,
    });
  } catch (error) {
    console.error('❌ Upload token generation error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate upload token',
    });
  }
});

/**
 * POST /api/upload/presigned-batch
 * Generate multiple Vercel Blob client upload tokens for batch uploads.
 */
router.post('/presigned-batch', async (req: Request, res: Response) => {
  try {
    const { count, contentType, uploadType, resourceId } = req.body;

    if (!count || !contentType || !uploadType) {
      return res.status(400).json({ success: false, error: 'Missing required fields: count, contentType, uploadType' });
    }

    if (typeof count !== 'number' || count < 1 || count > 10) {
      return res.status(400).json({ success: false, error: 'Count must be a number between 1 and 10' });
    }

    if (!ALLOWED_UPLOAD_TYPES.includes(uploadType)) {
      return res.status(400).json({ success: false, error: `Invalid uploadType. Must be one of: ${ALLOWED_UPLOAD_TYPES.join(', ')}` });
    }

    const batchAllowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!batchAllowedMimes.includes(contentType)) {
      return res.status(400).json({ success: false, error: `Invalid content type for batch upload. Allowed: ${batchAllowedMimes.join(', ')}` });
    }

    const prefix = `${uploadType}s/${resourceId || 'temp'}/`;
    const uploads = await generateBatchUploadTokens(count, prefix, contentType);

    return res.json({
      success: true,
      uploads,
      expiresIn: 300,
    });
  } catch (error) {
    console.error('❌ Batch upload token generation error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate upload tokens',
    });
  }
});

export default router;
