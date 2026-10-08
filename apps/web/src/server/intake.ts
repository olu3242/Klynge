import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_LONG_EDGE = 2576;
export type AcceptedMime = "image/png" | "image/jpeg" | "image/webp";

export interface ProcessedImage {
  /** Re-encoded bytes: metadata (EXIF/GPS/XMP/ICC text) stripped, oriented, ≤ MAX_LONG_EDGE. */
  bytes: Buffer;
  mime: AcceptedMime;
  width: number;
  height: number;
  /** Content hash of the processed image (deterministic chart id). */
  sha256: string;
}

export class IntakeError extends Error {
  override readonly name = "IntakeError";
  readonly code: "TOO_LARGE" | "EMPTY" | "UNSUPPORTED_TYPE" | "CORRUPT";
  constructor(code: IntakeError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** Detect the real format from magic bytes — the declared MIME type and file name are never trusted. */
export function sniffMime(b: Uint8Array): AcceptedMime | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/**
 * Intake pipeline: size cap → magic-byte type check → decode → auto-orient → downscale → re-encode
 * WITHOUT metadata. The raw upload is never stored or logged.
 */
export async function processUpload(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new IntakeError("EMPTY", "Empty upload");
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new IntakeError("TOO_LARGE", `Upload exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  const mime = sniffMime(input);
  if (!mime) throw new IntakeError("UNSUPPORTED_TYPE", "Only PNG, JPG and WebP images are accepted");
  try {
    let img = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true });
    img = mime === "image/png" ? img.png() : mime === "image/jpeg" ? img.jpeg({ quality: 90 }) : img.webp({ quality: 90 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    return { bytes: data, mime, width: info.width, height: info.height, sha256: createHash("sha256").update(data).digest("hex") };
  } catch {
    throw new IntakeError("CORRUPT", "The image could not be decoded");
  }
}
