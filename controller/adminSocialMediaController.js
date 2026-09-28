const mongoose = require("mongoose");
const { Partner, InfluencerContentSubmission } = require("../models/Index");

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
    rejectionReason: account.rejectionReason || ""
    , paymentRates: partner.influencerPaymentRates || { post: 0, reel: 0, currency: "INR" }
  })));
  return res.json({ success: true, data: accounts });
};

const updateRates = async (req, res) => {
  try {
    const post = Number(req.body.post);
    const reel = Number(req.body.reel);
    const currency = String(req.body.currency || "INR").trim().toUpperCase();

    if (!Number.isFinite(post) || post <= 0 || post > 100000000 ||
        !Number.isFinite(reel) || reel <= 0 || reel > 100000000) {
      return res.status(400).json({ success: false, message: "Post and reel rates must both be greater than zero and no more than ₹10 crore." });
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return res.status(400).json({ success: false, message: "Currency must be a valid three-letter code." });
    }

    const partner = await Partner.findOneAndUpdate(
      { _id: req.params.partnerId, partnerType: "influencer" },
      { influencerPaymentRates: { post, reel, currency, updatedBy: req.adminUser._id, updatedAt: new Date() } },
      { new: true, runValidators: true }
    ).select("influencerPaymentRates");

    if (!partner) return res.status(404).json({ success: false, message: "Influencer not found." });
    return res.json({ success: true, message: "Influencer payment rates updated.", data: partner.influencerPaymentRates });
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
      const partner = await Partner.findById(submission.partnerId).select("socialAccounts influencerPaymentRates");
      account = partner?.socialAccounts.id(submission.socialAccountId);
      const amount = Number(partner?.influencerPaymentRates?.[submission.contentType]);
      if (!account || account.reviewStatus !== "verified" || account.platform !== submission.platform) {
        return res.status(409).json({ success: false, message: "The linked influencer account must be verified before approval." });
      }
      if (ownershipConfirmed !== true) {
        return res.status(400).json({ success: false, message: "Confirm that the submitted URL belongs to the selected influencer account." });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(409).json({ success: false, message: "Set this influencer's post and reel rates before approving content." });
      }
      submission.payment = { amount, currency: partner.influencerPaymentRates.currency || "INR", status: "approved" };
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
