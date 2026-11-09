const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { HttpError } = require('./http');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 10 * 60;

async function prepareImage(file) {
  if (!file?.buffer || !['image/jpeg', 'image/png'].includes(file.mimetype)) {
    throw new HttpError(400, 'JPG or PNG image required');
  }

  try {
    const image = sharp(file.buffer, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!['jpeg', 'png'].includes(metadata.format)) {
      throw new HttpError(400, 'JPG or PNG image required');
    }
    // Re-encoding applies EXIF orientation and removes source metadata, including GPS.
    const buffer = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'image too large');
    return buffer;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid image');
  }
}

function createStorage(supabase, bucketName, supabaseUrl) {
  const bucket = supabase.storage.from(bucketName);
  const storageOrigin = new URL(supabaseUrl);
  const signedPathPrefix = `/storage/v1/object/sign/${encodeURIComponent(bucketName)}/`;

  function signedImageTarget(signedUrl) {
    const url = new URL(signedUrl, storageOrigin);
    if (url.origin !== storageOrigin.origin ||
        !url.pathname.startsWith(signedPathPrefix) ||
        !url.searchParams.get('token')) {
      throw new HttpError(502, 'invalid image storage URL');
    }
    return `${url.pathname}${url.search}`;
  }

  return {
    async upload(userId, buffer) {
      const path = `${userId}/${randomUUID()}.jpg`;
      const { error } = await bucket.upload(path, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) throw new HttpError(502, 'image storage unavailable');
      return path;
    },

    // A stored photo's bytes, for the photo check run again by staff.
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new HttpError(502, 'image storage unavailable');
      return Buffer.from(await data.arrayBuffer());
    },

    async remove(path) {
      const { error } = await bucket.remove([path]);
      if (error) console.error('Could not remove unused image', error);
    },

    async downloadSignedImage(target) {
      if (typeof target !== 'string' || target.length > 4096 ||
          !target.startsWith(signedPathPrefix)) {
        throw new HttpError(400, 'invalid image URL');
      }
      let url;
      try {
        url = new URL(target, storageOrigin);
      } catch (_) {
        throw new HttpError(400, 'invalid image URL');
      }
      if (url.origin !== storageOrigin.origin ||
          !url.pathname.startsWith(signedPathPrefix) ||
          !url.searchParams.get('token')) {
        throw new HttpError(400, 'invalid image URL');
      }
      let response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(12000),
        });
      } catch (_) {
        throw new HttpError(502, 'image storage unavailable');
      }
      if (!response.ok) {
        throw new HttpError(response.status === 404 || response.status === 401 ||
          response.status === 403 ? 404 : 502, 'image unavailable');
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength > MAX_IMAGE_BYTES) {
        await response.body?.cancel();
        throw new HttpError(502, 'image too large');
      }
      const image = Buffer.from(await response.arrayBuffer());
      if (image.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'image too large');
      return image;
    },

    async withSignedImages(rows) {
      if (!rows.length) return [];
      const paths = rows.map((row) => row.image_path);
      const signed = new Map();

      const chunks = [];
      for (let offset = 0; offset < paths.length; offset += 100) {
        chunks.push(paths.slice(offset, offset + 100));
      }
      const results = await Promise.all(chunks.map((chunk) =>
        bucket.createSignedUrls(chunk, SIGNED_URL_SECONDS)
      ));
      for (let index = 0; index < results.length; index += 1) {
        const { data, error } = results[index];
        if (error || !data || data.length !== chunks[index].length) {
          throw new HttpError(502, 'image storage unavailable');
        }
        for (const item of data) {
          if (item.error || !item.signedUrl) throw new HttpError(502, 'image storage unavailable');
          const target = signedImageTarget(item.signedUrl);
          signed.set(item.path, `/api/images?target=${encodeURIComponent(target)}`);
        }
      }

      return rows.map(({ image_path: imagePath, ...rest }) => {
        const imageUrl = signed.get(imagePath);
        if (!imageUrl) throw new HttpError(502, 'image storage unavailable');
        return { ...rest, image_url: imageUrl };
      });
    },
  };
}

module.exports = { prepareImage, createStorage, MAX_IMAGE_BYTES };
