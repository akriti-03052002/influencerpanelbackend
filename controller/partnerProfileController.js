const { Partner } = require("../models/Index");
const { getRequiredDocumentTypes } = require("../utils/partnerVerification");

/* ============================================================
   PARTNER PROFILE
============================================================ */

const getProfile = async (req, res) => {
  return res.json({
    success: true,
    data: {
      partner: req.partner,
      user: req.partnerUser,
      requiredDocumentTypes: getRequiredDocumentTypes(req.partner.partnerType),
      profileComplete: Boolean(req.partner.legalEntity.businessName)
    }
  });
};

const updateProfile = async (req, res) => {
  try {
    const {
      businessName, legalName,
      contactName, phone, designation,
      country, state, city, addressLine1, addressLine2, pincode,
      socialAccounts
    } = req.body;

    // Loaded with the stored social tokens so rebuilding socialAccounts below
    // doesn't silently disconnect accounts linked through Instagram/Facebook.
    const partner = await Partner.findById(req.partner._id).select("+socialAccounts.accessTokenEncrypted +socialAccounts.refreshTokenEncrypted");

    if (businessName) partner.legalEntity.businessName = businessName;
    if (legalName !== undefined) partner.legalEntity.legalName = legalName;

    if (contactName) partner.primaryContact.name = contactName;
    if (phone !== undefined) partner.primaryContact.phone = phone;
    if (designation !== undefined) partner.primaryContact.designation = designation;

    if (country !== undefined) partner.address.country = country;
    if (state !== undefined) partner.address.state = state;
    if (city !== undefined) partner.address.city = city;
    if (addressLine1 !== undefined) partner.address.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) partner.address.addressLine2 = addressLine2;
    if (pincode !== undefined) partner.address.pincode = pincode;

    if (socialAccounts !== undefined) {
      if (!Array.isArray(socialAccounts)) {
        return res.status(400).json({ success: false, message: "Social accounts must be an array." });
      }

      const validPlatforms = new Set(["instagram", "youtube", "facebook"]);
      const seenPlatforms = new Set();
      for (const account of socialAccounts) {
        if (!validPlatforms.has(account.platform) || !account.accountId?.trim()) {
          return res.status(400).json({ success: false, message: "Each social account needs a supported platform and account ID." });
        }
        if (seenPlatforms.has(account.platform)) {
          return res.status(400).json({ success: false, message: "Only one account per social platform can be added." });
        }
        if (!Number.isFinite(Number(account.followers)) || Number(account.followers) < 0) {
          return res.status(400).json({ success: false, message: "Follower count must be a non-negative number." });
        }
        seenPlatforms.add(account.platform);
      }

      partner.socialAccounts = socialAccounts.map((account) => {
        const accountId = account.accountId.trim();
        const existing = partner.socialAccounts.find((item) => item.platform === account.platform && item.accountId === accountId);
        // A connected account keeps its synced data, token and review status;
        // its follower count comes from the platform, not this form.
        if (existing?.connected) return existing;
        if (existing) {
          existing.username = account.username?.trim() || "";
          existing.followers = Number(account.followers);
          return existing;
        }
        return {
          platform: account.platform,
          accountId,
          username: account.username?.trim() || "",
          followers: Number(account.followers),
          connected: false
        };
      });
    }

    await partner.save();

    // Re-read so the stored social tokens selected above never reach the client.
    const saved = await Partner.findById(partner._id);
    return res.json({ success: true, message: "Profile updated.", data: saved });
  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong updating your profile." });
  }
};

module.exports = { getProfile, updateProfile };
