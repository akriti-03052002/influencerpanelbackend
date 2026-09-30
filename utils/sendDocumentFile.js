const { PartnerDocument } = require("../models/Index");
const { sendStoredFile } = require("./fileStorage");

/**
 * Sends a PartnerDocument's file from wherever it's stored (Cloudinary or
 * disk). For a system-generated PDF (the agreement) whose stored file can't
 * be found, falls back to the copy kept in the database.
 */
const sendDocumentFile = async (res, document) => {
  if (await sendStoredFile(res, document.file)) return undefined;

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
