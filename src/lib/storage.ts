import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Logos en DigitalOcean Spaces (API compatible con S3).
 * Variables: SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION (ej. nyc3)
 * Opcional: SPACES_CDN_URL (ej. https://mi-bucket.nyc3.cdn.digitaloceanspaces.com)
 */
export function storageConfigured() {
  return Boolean(
    process.env.SPACES_KEY && process.env.SPACES_SECRET && process.env.SPACES_BUCKET && process.env.SPACES_REGION,
  );
}

let client: S3Client | null = null;
function s3() {
  const region = process.env.SPACES_REGION!;
  client ??= new S3Client({
    region: "us-east-1", // requerido por el SDK; Spaces usa el endpoint
    endpoint: `https://${region}.digitaloceanspaces.com`,
    forcePathStyle: false,
    credentials: { accessKeyId: process.env.SPACES_KEY!, secretAccessKey: process.env.SPACES_SECRET! },
  });
  return client;
}

/** Sube un archivo público y devuelve su URL. */
export async function uploadPublicFile(key: string, body: Uint8Array, contentType: string) {
  const bucket = process.env.SPACES_BUCKET!;
  const region = process.env.SPACES_REGION!;
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  const base = (process.env.SPACES_CDN_URL || `https://${bucket}.${region}.digitaloceanspaces.com`).replace(/\/$/, "");
  return `${base}/${key}`;
}
