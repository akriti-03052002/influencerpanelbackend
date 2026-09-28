const mongoose = require("mongoose");
const { Partner, InfluencerContentSubmission } = require("../models/Index");
const normalizeContentUrl = require("../utils/normalizeContentUrl");
const { syncStaleAccounts } = require("../services/socialSync");

const PLATFORMS = {
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.watch"]
};

const validateContentUrl = (value, platform) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return PLATFORMS[platform]?.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) || false;
};

const requireInfluencer = (req, res) => {
  if (req.partner.partnerType !== "influencer") {
    res.status(403).json({ success: false, message: "This feature is only available to influencer partners." });
    return false;
  }
  return true;
};

const listAccounts = async (req, res) => {
  if (!requireInfluencer(req, res)) return;
  // Connected accounts refresh their follower count on their own using the
  // stored token — the influencer only logs in once.
  const synced = await syncStaleAccounts(req.partner);
  const partner = synced ? await Partner.findById(req.partner._id).select("socialAccounts") : req.partner;
  const accounts = (partner.socialAccounts || []).map((account) => ({
    _id: account._id,
    platform: account.platform,
    accountId: account.accountId,
    username: account.username,
    followers: account.followers,
    connected: Boolean(account.connected),
    source: account.source,
    lastSyncedAt: account.lastSyncedAt,
    syncError: account.syncError || "",
    reviewStatus: account.reviewStatus || "pending",
    submittedAt: account.submittedAt || account.createdAt,
    reviewedAt: account.reviewedAt,
    rejectionReason: account.rejectionReason || ""
  }));
  return res.json({ success: true, data: accounts });
};

const submitAccount = async (req, res) => {
  try {
    if (!requireInfluencer(req, res)) return;
    const platform = String(req.body.platform || "").toLowerCase();
    const accountId = String(req.body.accountId || "").trim().replace(/^@/, "");
    const followers = Number(req.body.followers);
    const supportedPlatforms = Object.keys(PLATFORMS);

    if (!supportedPlatforms.includes(platform)) {
      return res.status(400).json({ success: false, message: "Select a supported social media platform." });
    }
    if (!accountId || accountId.length > 120) {
      return res.status(400).json({ success: false, message: "Enter a valid account ID or handle (up to 120 characters)." });
    }
    if (!Number.isSafeInteger(followers) || followers < 0) {
      return res.status(400).json({ success: false, message: "Follower count must be a non-negative whole number." });
    }

    const existing = req.partner.socialAccounts.find((account) =>
      account.platform === platform && account.accountId.toLowerCase() === accountId.toLowerCase()
    );
    if (existing && existing.reviewStatus !== "rejected") {
      return res.status(409).json({ success: false, message: "This account has already been submitted for review." });
    }

    let submittedAccount;
    if (existing) {
      existing.username = accountId;
      existing.followers = followers;
      existing.source = "manual";
      existing.reviewStatus = "pending";
      existing.submittedAt = new Date();
      existing.reviewedBy = undefined;
      existing.reviewedAt = undefined;
      existing.rejectionReason = "";
      submittedAccount = existing;
    } else {
      submittedAccount = req.partner.socialAccounts.create({
        platform,
        accountId,
        username: accountId,
        followers,
        connected: false,
        source: "manual",
        reviewStatus: "pending",
        submittedAt: new Date()
      });
      req.partner.socialAccounts.push(submittedAccount);
    }
    await req.partner.save();

    return res.status(201).json({
      success: true,
      message: "Social account submitted for admin review.",
      data: submittedAccount
    });
  } catch (error) {
    console.error("submitAccount error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong submitting the social account." });
  }
};

const listSubmissions = async (req, res) => {
  if (!requireInfluencer(req, res)) return;
  const submissions = await InfluencerContentSubmission.find({ partnerId: req.partner._id }).sort({ createdAt: -1 });
  return res.json({ success: true, data: submissions });
};

const submitContent = async (req, res) => {
  try {
    if (!requireInfluencer(req, res)) return;
    const { socialAccountId, contentType } = req.body;
    const url = String(req.body.url || "").trim();
    if (!mongoose.Types.ObjectId.isValid(socialAccountId)) {
      return res.status(400).json({ success: false, message: "Select a valid social account." });
    }
    if (!["post", "reel"].includes(contentType)) {
      return res.status(400).json({ success: false, message: "Content type must be post or reel." });
    }

    const account = req.partner.socialAccounts.id(socialAccountId);
    if (!account || account.reviewStatus !== "verified") {
      return res.status(400).json({ success: false, message: "Select a social account verified by an admin." });
    }
    if (!validateContentUrl(url, account.platform)) {
      return res.status(400).json({
        success: false,
        message: `Enter a secure public URL from ${account.platform === "youtube" ? "youtube.com or youtu.be" : `${account.platform}.com`}.`
      });
    }

    const normalizedUrl = normalizeContentUrl(url);
    const duplicate = await InfluencerContentSubmission.exists({ normalizedUrl });
    if (duplicate) {
      return res.status(409).json({ success: false, message: "This post or reel URL has already been submitted." });
    }

    const submission = await InfluencerContentSubmission.create({
      partnerId: req.partner._id,
      socialAccountId: account._id,
      platform: account.platform,
      contentType,
      url,
      normalizedUrl
    });
    return res.status(201).json({ success: true, message: "Post/reel submitted for review.", data: submission });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This post or reel URL has already been submitted." });
    }
    console.error("submitContent error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong submitting the post or reel." });
  }
};

module.exports = { listAccounts, submitAccount, listSubmissions, submitContent };
