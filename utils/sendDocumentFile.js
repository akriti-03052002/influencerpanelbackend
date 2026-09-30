const path = require("path");
const fs = require("fs");
const { PartnerDocument } = require("../models/Index");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "partners");

/**
 * Sends a PartnerDocument's file. Serves it from disk when it's there; for a
 * system-generated PDF (the agreement) whose file was lost with the server's
 * disk, falls back to the copy stored in the database.
 */
const sendDocumentFile = async (res, document) => {
  const filePath = path.join(UPLOAD_ROOT, document.file.objectKey);
  if (fs.existsSync(filePath)) return res.download(filePath, document.file.originalName);

  const stored = await PartnerDocument.findById(document._id).select("+generatedPdf").lean();
  if (stored?.generatedPdf) {
    const pdf = Buffer.from(stored.generatedPdf.buffer || stored.generatedPdf);
    res.setHeader("Content-Type", document.file.mimeType || "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(document.file.originalName || "document.pdf")}"`);
    return res.send(pdf);
  }

  return res.status(404).json({ success: false, message: "File not found on server." });
};

module.exports = sendDocumentFile;
