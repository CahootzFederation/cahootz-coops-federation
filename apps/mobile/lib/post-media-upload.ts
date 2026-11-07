import * as Sentry from '@sentry/react-native';

import { api, type CommonsPostMedia } from './api';
import { ApiError } from './friendly-error';
import { mapWithConcurrency, withRetry } from './upload-queue';

export type PendingPostMedia = {
  uri: string;
  fileName?: string | null;
  mimeType: string;
  mediaType: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
};

// Two at a time: a big video doesn't share the connection with every photo
// (which could outlast its upload token), and photos still move in parallel.
const UPLOAD_CONCURRENCY = 2;

/** A file that's too big or the wrong type won't upload on a second try. */
function isRetryableUploadError(error: unknown) {
  if (!(error instanceof ApiError)) return true; // network failures
  return error.code !== 'PAYLOAD_TOO_LARGE' && error.code !== 'BAD_REQUEST' && error.httpStatus !== 413;
}

/**
 * Uploads a post's photos and videos, two at a time, retrying each failed
 * file once with a fresh upload token. Results keep the attachments' order.
 */
export function uploadPostMedia(resourceId: string, media: readonly PendingPostMedia[]): Promise<CommonsPostMedia[]> {
  return mapWithConcurrency(media, UPLOAD_CONCURRENCY, (item) =>
    withRetry(
      () =>
        api.uploadCommonsPostMedia({
          coopId: resourceId,
          uri: item.uri,
          fileName: item.fileName,
          mimeType: item.mimeType,
          mediaType: item.mediaType,
          width: item.width,
          height: item.height,
          durationMs: item.durationMs,
          sizeBytes: item.sizeBytes,
        }),
      { retries: 1, shouldRetry: isRetryableUploadError },
    ),
  );
}

/**
 * Sends a failed post to Sentry. The app catches these to show Retry, so
 * Sentry never sees them on its own. Includes what was being posted (counts,
 * types and sizes, never the text or files) and which step failed.
 */
export function reportPostFailure(
  error: unknown,
  context: { stage: 'upload' | 'save'; destination: string; media: readonly PendingPostMedia[] },
) {
  const videos = context.media.filter((item) => item.mediaType === 'video');
  Sentry.captureException(error, {
    tags: {
      area: 'post-publish',
      stage: context.stage,
      destination: context.destination,
      has_video: videos.length > 0 ? 'yes' : 'no',
    },
    extra: {
      mediaCount: context.media.length,
      imageCount: context.media.length - videos.length,
      videoCount: videos.length,
      media: context.media.map((item) => ({
        type: item.mimeType,
        sizeBytes: item.sizeBytes ?? null,
        durationMs: item.durationMs ?? null,
      })),
      httpStatus: error instanceof ApiError ? error.httpStatus : undefined,
      code: error instanceof ApiError ? error.code : undefined,
    },
  });
}
