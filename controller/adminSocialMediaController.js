const mongoose = require("mongoose");
const { Partner, InfluencerContentSubmission, PartnerNotification } = require("../models/Index");
const { reissuePartnerAgreement } = require("../services/generatePartnerAgreement");

const listAccounts = async (req, res) => {
  const partners = await Partner.find({
    partnerType: "influencer",
    "socialAccounts.0": { $exists: true }
  }).select("partnerCode legalEntity.businessName primaryContact socialAccounts");

  const accounts = partners.flatMap((partner) => (partner.socialAccounts || []).map((account) => ({
    _id: account._id,
    partnerId: partner._id,
    partnerName: partner.legalEntity?.businessName || partner.primaryContact?.name || "Influencer",
    partnerCode: partner.partnerCode,
    email: partner.primaryContact?.email,
    platform: account.platform,
    accountId: account.accountId,
    username: account.username,
    followers: account.followers,
    reviewStatus: account.reviewStatus || "pending",
    submittedAt: account.submittedAt,
    rejectionReason: account.rejectionReason || "",
    paymentRates: {
      post: account.paymentRates?.post || 0,
      reel: account.paymentRates?.reel || 0,
      currency: account.paymentRates?.currency || "INR"
    }
  })));
  return res.json({ success: true, data: accounts });
};

// Rates are per social account: the same influencer can have very different
// reach on each platform, so each account is priced on its own.
const updateRates = async (req, res) => {
  try {
    // A blank box means "this content type isn't paid on this account".
    const toRate = (value) => (value === "" || value === null || value === undefined ? 0 : Number(value));
    const post = toRate(req.body.post);
    const reel = toRate(req.body.reel);
    const currency = String(req.body.currency || "INR").trim().toUpperCase();

    const valid = (n) => Number.isFinite(n) && n >= 0 && n <= 100000000;
    if (!valid(post) || !valid(reel)) {
      return res.status(400).json({ success: false, message: "Rates must be between ₹0 and ₹10 crore." });
    }
    if (post === 0 && reel === 0) {
      return res.status(400).json({ success: false, message: "Enter a post rate, a reel rate, or both." });
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return res.status(400).json({ success: false, message: "Currency must be a valid three-letter code." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.partnerId) || !mongoose.Types.ObjectId.isValid(req.params.accountId)) {
      return res.status(400).json({ success: false, message: "Invalid social account." });
    }

    const paymentRates = { post, reel, currency, updatedBy: req.adminUser._id, updatedAt: new Date() };
    // Positional update so the account's stored login tokens are untouched.
    const result = await Partner.updateOne(
      { _id: req.params.partnerId, partnerType: "influencer", "socialAccounts._id": req.params.accountId },
      { $set: { "socialAccounts.$.paymentRates": paymentRates } }
    );

    if (!result.matchedCount) return res.status(404).json({ success: false, message: "Social account not found." });

    // The agreement is where the influencer's prices are stated, so a price
    // change reissues it. A failure here mustn't undo the saved rates.
    let agreementReissued = false;
    try {
      const partner = await Partner.findById(req.params.partnerId);
      const agreement = await reissuePartnerAgreement(partner, req.adminUser._id);
      if (agreement) {
        agreementReissued = true;
        await PartnerNotification.create({
          partnerId: partner._id,
          type: "partner_agreement_issued",
          title: "Your Influencer Agreement was updated",
          message: "SPOTX updated your payment rates. Your updated Influencer Agreement with the new rates is in Documents.",
          entity: { type: "PartnerDocument", entityId: agreement._id }
        });
      }
    } catch (agreementError) {
      console.error("updateRates: agreement reissue failed:", agreementError);
    }

    return res.json({
      success: true,
      message: agreementReissued
        ? "Payment rates updated — the influencer's agreement was reissued with the new rates."
        : "Payment rates updated for this account.",
      data: { post, reel, currency, agreementReissued }
    });
  } catch (error) {
    console.error("updateRates error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong updating payment rates." });
  }
};

const reviewAccount = async (req, res) => {
  try {
    const { decision, rejectionReason = "" } = req.body;
    if (!["verified", "rejected"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Choose verify or reject." });
    }
    if (decision === "rejected" && !String(rejectionReason).trim()) {
      return res.status(400).json({ success: false, message: "A reason is required when rejecting an account." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.partnerId)) {
      return res.status(400).json({ success: false, message: "Invalid influencer account." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.accountId)) {
      return res.status(400).json({ success: false, message: "Invalid social account." });
    }
    const partner = await Partner.findOne({ _id: req.params.partnerId, partnerType: "influencer" });
    const account = partner?.socialAccounts.id(req.params.accountId);
    if (!account) return res.status(404).json({ success: false, message: "Social account not found." });
    if (account.reviewStatus !== "pending") {
      return res.status(409).json({ success: false, message: "Only pending accounts can be reviewed." });
    }

    account.reviewStatus = decision;
    account.reviewedBy = req.adminUser._id;
    account.reviewedAt = new Date();
    account.rejectionReason = decision === "rejected" ? String(rejectionReason).trim() : "";
    await partner.save();
    return res.json({ success: true, message: `Social account ${decision}.`, data: { _id: account._id, reviewStatus: account.reviewStatus } });
  } catch (error) {
    console.error("reviewAccount error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong reviewing the social account." });
  }
};

const listSubmissions = async (req, res) => {
  const filter = {};
  if (req.query.status && ["pending", "approved", "rejected"].includes(req.query.status)) {
    filter.status = req.query.status;
  }
  const submissions = await InfluencerContentSubmission.find(filter)
    .sort({ createdAt: -1 })
    .populate("partnerId", "partnerCode legalEntity.businessName primaryContact");
  const data = await Promise.all(submissions.map(async (submission) => {
    const partner = submission.partnerId;
    const account = await Partner.findById(partner?._id).select("socialAccounts");
    const socialAccount = account?.socialAccounts.id(submission.socialAccountId);
    return {
      ...submission.toObject(),
      influencer: partner ? {
        _id: partner._id,
        partnerCode: partner.partnerCode,
        name: partner.legalEntity?.businessName || partner.primaryContact?.name || "Influencer",
        email: partner.primaryContact?.email
      } : null,
      socialAccount: socialAccount ? {
        platform: socialAccount.platform,
        accountId: socialAccount.accountId,
        username: socialAccount.username,
        followers: socialAccount.followers,
        reviewStatus: socialAccount.reviewStatus || "pending"
      } : null
    };
  }));
  return res.json({ success: true, data });
};

const reviewSubmission = async (req, res) => {
  try {
    const { decision, ownershipConfirmed, reviewNote = "" } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Choose approve or reject." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid submission." });
    }
    const submission = await InfluencerContentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ success: false, message: "Submission not found." });
    if (submission.status !== "pending") {
      return res.status(409).json({ success: false, message: "Only pending submissions can be reviewed." });
    }

    let account = null;
    if (decision === "approved") {
      const partner = await Partner.findById(submission.partnerId).select("socialAccounts");
      account = partner?.socialAccounts.id(submission.socialAccountId);
      // Paid at the rate of the account the content was posted from.
      const amount = Number(account?.paymentRates?.[submission.contentType]);
      if (!account || account.reviewStatus !== "verified" || account.platform !== submission.platform) {
        return res.status(409).json({ success: false, message: "The linked influencer account must be verified before approval." });
      }
      if (ownershipConfirmed !== true) {
        return res.status(400).json({ success: false, message: "Confirm that the submitted URL belongs to the selected influencer account." });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(409).json({ success: false, message: `Set a ${submission.contentType} rate for this ${account.platform} account before approving it.` });
      }
      submission.payment = { amount, currency: account.paymentRates.currency || "INR", status: "approved" };
      submission.ownershipConfirmed = true;
    } else {
      if (!String(reviewNote).trim()) {
        return res.status(400).json({ success: false, message: "A reason is required when rejecting a submission." });
      }
      submission.payment = { amount: 0, currency: "INR", status: "not_assigned" };
      submission.ownershipConfirmed = false;
    }

    submission.status = decision;
    submission.reviewNote = String(decision === "rejected" ? reviewNote : reviewNote || "").trim();
    submission.reviewedBy = req.adminUser._id;
    submission.reviewedAt = new Date();
    await submission.save();
    return res.json({ success: true, message: `Submission ${decision}.`, data: submission });
  } catch (error) {
    console.error("reviewSubmission error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong reviewing the submission." });
  }
};

module.exports = { listAccounts, reviewAccount, updateRates, listSubmissions, reviewSubmission };
