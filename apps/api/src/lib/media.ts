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

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'];
