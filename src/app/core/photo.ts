/**
 * Shrinks a phone photo before upload: long edge at most 2400 px, JPEG at 85%.
 * Receipts stay sharp enough to read (the reader works up to about 2500 px) while a
 * 6 MB camera photo becomes a few hundred KB.
 */
export const MAX_LONG_EDGE = 2400;

export async function shrinkPhoto(file: Blob, maxLongEdge = MAX_LONG_EDGE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Formats the browser can't decode (e.g. HEIC outside Safari): send as-is if it's a type the server accepts.
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
    throw new Error('This photo format can’t be read here. Take the photo as JPEG, or take a screenshot of it.');
  }
  const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.85);
  });
}

/** Long edge after shrinking, for display and tests. */
export function scaledSize(width: number, height: number, maxLongEdge = MAX_LONG_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
