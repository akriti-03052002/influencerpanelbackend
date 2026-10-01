const { PartnerDocument, PartnerBankAccount } = require("../models/Index");

/**
 * Which KYC documents are compulsory before a partner can be verified,
 * per partnerType. Business-entity types (Vendor, Agency,
 * Technology, Strategic) need full business KYC since they invoice SPOTX
 * and move real commercial volume. Individual-oriented types (Affiliate,
 * Influencer, Referral) are frequently a single person, not a registered
 * company — GST registration and MSME/Udyam registration usually don't
 * even apply to them, so requiring those would block legitimate signups.
 * PAN and a cancelled cheque stay required everywhere: PAN is universal
 * in India (individual or business), and a cheque is how anyone gets paid.
 *
 * This is the one place that decides what's compulsory — Documents.jsx
 * (partner-facing checklist) and this file's isPartnerFullyVerified
 * (the activation gate) both read from it, so they can never disagree.
 */
const REQUIRED_DOCUMENTS_BY_PARTNER_TYPE = {
  vendor: ["msme_udyam", "gst_certificate", "pan_card", "cancelled_cheque"],
  agency: ["msme_udyam", "gst_certificate", "pan_card", "cancelled_cheque"],
  technology: ["msme_udyam", "gst_certificate", "pan_card", "cancelled_cheque"],
  strategic: ["msme_udyam", "gst_certificate", "pan_card", "cancelled_cheque"],
  affiliate: ["pan_card", "cancelled_cheque"],
  influencer: ["pan_card", "cancelled_cheque"],
  referral: ["pan_card", "cancelled_cheque"]
};

const getRequiredDocumentTypes = (partnerType) =>
  REQUIRED_DOCUMENTS_BY_PARTNER_TYPE[partnerType] || REQUIRED_DOCUMENTS_BY_PARTNER_TYPE.vendor;

const isKycDocumentsVerified = async (partnerId, partnerType) => {
  const requiredTypes = getRequiredDocumentTypes(partnerType);

  const documents = await PartnerDocument.find({ partnerId, documentType: { $in: requiredTypes } });

  const verifiedTypes = new Set(
    documents.filter((d) => d.verification.status === "verified").map((d) => d.documentType)
  );

  return requiredTypes.every((type) => verifiedTypes.has(type));
};

const isPartnerFullyVerified = async (partnerId, partnerType) => {
  const [allDocsVerified, bankAccount] = await Promise.all([
    isKycDocumentsVerified(partnerId, partnerType),
    PartnerBankAccount.findOne({ partnerId })
  ]);

  const bankVerified = bankAccount?.verification?.status === "verified";

  return allDocsVerified && bankVerified;
};

/**
 * Registration only collects name, email and phone; the address is the one
 * thing filled in afterwards from Profile, so it's what "complete" hinges on.
 */
const isProfileComplete = (partner) => Boolean(partner?.address?.state && partner?.address?.city);

module.exports = {
  isProfileComplete,
  isPartnerFullyVerified,
  isKycDocumentsVerified,
  getRequiredDocumentTypes,
  REQUIRED_DOCUMENTS_BY_PARTNER_TYPE
};
