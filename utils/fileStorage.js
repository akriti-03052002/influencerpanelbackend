const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const cloudinary = require("cloudinary").v2;

/* ============================================================
   FILE STORAGE
   Uploaded KYC documents, settlement bills and generated agreements
   are stored in Cloudinary when CLOUDINARY_* is configured, so they
   survive the server's disk being wiped on a redeploy. Without it
   (e.g. local development) files stay on disk as before.

   Files are uploaded as private "raw" assets: they have no public
   URL, and are only ever fetched by this backend with a short-lived
   signed link, then streamed to the signed-in user.
============================================================ */

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "partners");
const ROOT_FOLDER = process.env.CLOUDINARY_FOLDER || "influencer-panel";

const isCloudinaryConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

let configured = false;
const client = () => {
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
    configured = true;
  }
  return cloudinary;
};

const UPLOAD_OPTIONS = { resource_type: "raw", type: "private", overwrite: false };

// "partners/<id>/bills" + "1700000-123.pdf" -> "influencer-panel/partners/<id>/bills/1700000-123.pdf"
const publicIdFor = (subfolder, filename) => [ROOT_FOLDER, subfolder, filename].join("/").replace(/\\/g, "/");

/**
 * Stores a file multer just wrote to disk. Returns the `file` shape saved
 * on PartnerDocument / PartnerSettlementBill. With Cloudinary, the local
 * copy is removed once uploaded.
 */
const storeUploadedFile = async (multerFile, subfolder) => {
  const meta = { originalName: multerFile.originalname, mimeType: multerFile.mimetype, size: multerFile.size };

  if (!isCloudinaryConfigured()) {
    return { storageProvider: "private_storage", objectKey: path.relative(UPLOAD_ROOT, multerFile.path), ...meta };
  }

  const result = await client().uploader.upload(multerFile.path, {
    ...UPLOAD_OPTIONS,
    public_id: publicIdFor(subfolder, multerFile.filename)
  });
  fs.promises.unlink(multerFile.path).catch(() => {});
  return { storageProvider: "cloudinary", objectKey: result.public_id, ...meta };
};

/** Stores a generated file (e.g. the agreement PDF) from memory. */
const storeBuffer = async (buffer, { subfolder, filename, originalName, mimeType }) => {
  const meta = { originalName, mimeType, size: buffer.length };

  if (!isCloudinaryConfigured()) {
    const dir = path.join(UPLOAD_ROOT, subfolder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);
    return { storageProvider: "private_storage", objectKey: path.join(subfolder, filename), ...meta };
  }

  const result = await new Promise((resolve, reject) => {
    const stream = client().uploader.upload_stream(
      { ...UPLOAD_OPTIONS, public_id: publicIdFor(`partners/${subfolder}`, filename) },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded))
    );
    Readable.from(buffer).pipe(stream);
  });
  return { storageProvider: "cloudinary", objectKey: result.public_id, ...meta };
};

/**
 * Streams a stored file to the client as a download. Returns false when the
 * file can't be found, so the caller can try a fallback or send a 404.
 */
const sendStoredFile = async (res, file) => {
  const disposition = `attachment; filename="${encodeURIComponent(file.originalName || "document")}"`;

  if (file.storageProvider === "cloudinary") {
    if (!isCloudinaryConfigured()) return false;
    const url = client().utils.private_download_url(file.objectKey, "", {
      resource_type: "raw",
      type: "private",
      expires_at: Math.floor(Date.now() / 1000) + 60
    });
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`sendStoredFile: Cloudinary returned ${response.status} for ${file.objectKey}`);
      return false;
    }
    res.setHeader("Content-Type", file.mimeType || response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition", disposition);
    res.send(Buffer.from(await response.arrayBuffer()));
    return true;
  }

  const filePath = path.join(UPLOAD_ROOT, file.objectKey);
  if (!fs.existsSync(filePath)) return false;
  res.download(filePath, file.originalName);
  return true;
};

module.exports = { isCloudinaryConfigured, storeUploadedFile, storeBuffer, sendStoredFile, UPLOAD_ROOT };
