const { Partner, PartnerNotification } = require("../models/Index");
const { isPartnerFullyVerified } = require("../utils/partnerVerification");
const { attachPartnerAgreement } = require("./generatePartnerAgreement");

/**
 * Called after a KYC document or the bank account gets verified. If the
 * partner is now fully verified — the required documents FOR THEIR TYPE
 * (see partnerVerification.js) plus a verified bank account — and hasn't
 * been activated yet, this activates them automatically. No separate manual
 * "set active" admin step required, since verification IS the gate.
 * Returns a truthy value only when it actually activated the partner.
 */
const autoActivatePartnerIfVerified = async (partnerId, adminUserId) => {
  const partner = await Partner.findById(partnerId);

  if (!partner || partner.status === "active") return null;

  const fullyVerified = await isPartnerFullyVerified(partnerId, partner.partnerType);
  if (!fullyVerified) return null;

  partner.status = "active";
  partner.verification.overallStatus = "verified";
  partner.verification.verifiedBy = adminUserId;
  partner.verification.verifiedAt = new Date();
  await partner.save();

  await attachPartnerAgreement(partner, adminUserId);

  await PartnerNotification.create({
    partnerId: partner._id,
    type: "account_verified",
    title: "Your account is fully verified",
    message: "Your documents and bank account are verified — you're now an active partner.",
    entity: { type: "Partner", entityId: partner._id }
  });

  return { activated: true };
};

module.exports = { autoActivatePartnerIfVerified };
