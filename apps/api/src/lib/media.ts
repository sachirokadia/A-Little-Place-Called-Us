import sharp from 'sharp';

// EXIF stripping: re-encoding through sharp drops EXIF/GPS/device
// metadata by default (no withMetadata call). Audio is passed through
// unchanged (no EXIF equivalent); video is not accepted in 1A.
export async function processUpload(buffer: Buffer, mimeType: string): Promise<{ data: Buffer; width: number | null; height: number | null }> {
  if (mimeType.startsWith('image/')) {
    const image = sharp(buffer);
    const meta = await image.metadata();
    const out = await image.toBuffer();
    return { data: out, width: meta.width ?? null, height: meta.height ?? null };
  }
  return { data: buffer, width: null, height: null };
}

// Display-size variant for the existing stream route only
// (?size=display): resize to at most 1200px on the longest side,
// aspect preserved, never enlarged, EXIF-stripped by the same
// re-encode. GIFs pass through byte-identical so animation is never
// broken; audio and unknown types are not resized. The stored
// original is never changed, and the caller must already have passed
// the stream route's auth/visibility checks before this is used.
export async function displayVariant(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === 'image/gif' || !mimeType.startsWith('image/')) return buffer;
  return sharp(buffer).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).toBuffer();
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'];
