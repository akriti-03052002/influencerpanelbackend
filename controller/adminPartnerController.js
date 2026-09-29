const bcrypt = require("bcryptjs");

const { Partner, PartnerDocument, PartnerBankAccount, PartnerUser, PartnerNotification } = require("../models/Index");
const { generatePartnerCode } = require("../utils/generateCode");
const { ROLE_PERMISSIONS } = require("../config/roles");
const logActivity = require("../utils/logActivity");
const { attachPartnerAgreement } = require("../services/generatePartnerAgreement");
const { getRequiredDocumentTypes } = require("../utils/partnerVerification");
const { sendMail } = require("../utils/mailer");
const { holdSettlementsForPartner } = require("../utils/settlementHold");

/* ============================================================
   ADMIN — PARTNER MANAGEMENT
============================================================ */

// Method 2 from the spec: an admin onboards a partner on their behalf
// (no self-registration) — same minimal fields as partnerAuthController.
// registerPartner (type, name, email, phone). The admin
// types the partner's login password directly here rather than the partner
// picking their own via a set-password link — the plaintext password is
// emailed to them once below (the only place it's ever available, before
// it's hashed), and they can change it any time afterwards via the
// existing forgot/reset password flow. Business name, legal details,
// address, KYC docs and bank all get filled in later from the partner's
// own Profile page.
const createPartner = async (req, res) => {
  try {
    const { partnerType, contactName, email, phone, password } = req.body;

    if (!partnerType || !contactName || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Partner type, name, email, phone and password are required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const existingUser = await PartnerUser.findOne({ email: email.toLowerCase().trim() });

    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const partnerCode = generatePartnerCode();

    const partner = await Partner.create({
      partnerCode,
      partnerType,
      primaryContact: { name: contactName, email: email.toLowerCase().trim(), phone },
      verification: { overallStatus: "not_submitted" },
      status: "draft",
      owner: { salesUserId: req.adminUser._id }
    });

    // Admin sets the partner's login password directly — no reset-link
    // email, since partners don't get a self-serve password flow.
    const passwordHash = await bcrypt.hash(password, 12);

    const partnerUser = await PartnerUser.create({
      partnerId: partner._id,
      name: contactName,
      email: email.toLowerCase().trim(),
      phone,
      role: "owner",
      permissions: ROLE_PERMISSIONS.owner,
      status: "active",
      auth: {
        provider: "email",
        passwordHash
      }
    });

    const loginUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/partner/login`;

    // The password is only ever available here, in plaintext, before it's
    // hashed above — this is the one place it can be handed to the partner.
    // They can change it any time afterwards via the existing forgot/reset
    // password flow (partnerAuthController.forgotPassword/resetPassword).
    await sendMail({
      to: partnerUser.email,
      subject: "You've been added as a SPOTX Partner",
      text: `${req.adminUser.name} created a SPOTX Partner account for you.\n\nLogin email: ${partnerUser.email}\nPassword: ${password}\n\nLog in here: ${loginUrl}\n\nYou can change this password any time from the login page's "Forgot password" link.`,
      html: `
        <p>${req.adminUser.name} created a SPOTX Partner account for you.</p>
        <p><strong>Login email:</strong> ${partnerUser.email}<br/>
        <strong>Password:</strong> ${password}</p>
        <p><a href="${loginUrl}">Log in to SPOTX Partner Panel</a></p>
        <p>You can change this password any time from the login page's "Forgot password" link.</p>
        <p>Once you're in, complete your business profile and KYC details to get verified.</p>
      `
    });

    await logActivity({
      partnerId: partner._id,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "status_changed",
      entityType: "Partner",
      entityId: partner._id,
      description: `${req.adminUser.name} created this partner account directly.`,
      req
    });

    return res.status(201).json({
      success: true,
      message: `Partner created. ${partnerUser.email} can now log in with the password you set.`,
      data: { partner }
    });
  } catch (error) {
    console.error("createPartner error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong creating the partner." });
  }
};

const listPartners = async (req, res) => {
  const { status, partnerType, search } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (partnerType) filter.partnerType = partnerType;
  if (search) {
    filter.$or = [
      { "legalEntity.businessName": { $regex: search, $options: "i" } },
      { partnerCode: { $regex: search, $options: "i" } },
      { "primaryContact.email": { $regex: search, $options: "i" } }
    ];
  }

  const partners = await Partner.find(filter).sort({ createdAt: -1 });

  return res.json({ success: true, data: partners });
};

const getPartner = async (req, res) => {
  const partner = await Partner.findById(req.params.id);

  if (!partner) {
    return res.status(404).json({ success: false, message: "Partner not found." });
  }

  const [documents, bankAccount, team] = await Promise.all([
    PartnerDocument.find({ partnerId: partner._id }).sort({ createdAt: -1 }),
    PartnerBankAccount.findOne({ partnerId: partner._id }),
    PartnerUser.find({ partnerId: partner._id })
  ]);

  return res.json({
    success: true,
    data: {
      partner,
      documents,
      requiredDocumentTypes: getRequiredDocumentTypes(partner.partnerType),
      bankAccount: bankAccount
        ? {
            id: bankAccount._id,
            accountHolderName: bankAccount.accountHolderName,
            bankName: bankAccount.bankName,
            accountNumberLast4: bankAccount.accountNumberLast4,
            ifscMasked: bankAccount.ifscMasked,
            verification: bankAccount.verification,
            razorpayCheck: bankAccount.razorpayCheck,
            commissionEligibility: bankAccount.commissionEligibility
          }
        : null,
      team
    }
  });
};

const updatePartnerStatus = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const validStatuses = ["draft", "pending_verification", "under_review", "active", "suspended", "rejected", "inactive"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }

    const partner = await Partner.findById(req.params.id);

    if (!partner) {
      return res.status(404).json({ success: false, message: "Partner not found." });
    }

    partner.status = status;

    if (status === "active") {
      partner.verification.overallStatus = "verified";
      partner.verification.verifiedBy = req.adminUser._id;
      partner.verification.verifiedAt = new Date();
    }

    if (status === "rejected") {
      partner.verification.overallStatus = "rejected";
      partner.verification.rejectionReason = rejectionReason || "";
    }

    await partner.save();

    // Commission stays recorded — only the payout is paused. Reactivating
    // the partner later doesn't auto-release these; the release endpoint's
    // objective check (partner must be active again) already gates it, and
    // an admin still confirms each one on the way back out.
    if (status === "suspended") {
      await holdSettlementsForPartner(partner._id, {
        code: "partner_suspended",
        reason: "Partner account was suspended.",
        byUserId: req.adminUser._id,
        req
      });
    }

    if (status === "under_review") {
      await holdSettlementsForPartner(partner._id, {
        code: "compliance_review",
        reason: "Partner account is under compliance review.",
        byUserId: req.adminUser._id,
        req
      });
    }

    if (status === "active") {
      await attachPartnerAgreement(partner, req.adminUser._id);
    }

    if (status === "rejected") {
      await PartnerNotification.create({
        partnerId: partner._id,
        type: "partner_rejected",
        title: "Your partner account was rejected",
        message: rejectionReason
          ? `Your partner account was rejected: ${rejectionReason}`
          : "Your partner account was rejected. Contact SPOTX support for details.",
        entity: { type: "Partner", entityId: partner._id }
      });
    }

    await logActivity({
      partnerId: partner._id,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "status_changed",
      entityType: "Partner",
      entityId: partner._id,
      description: `${req.adminUser.name} changed partner status to ${status}.`,
      req
    });

    return res.json({ success: true, message: "Partner status updated.", data: partner });
  } catch (error) {
    console.error("updatePartnerStatus error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong updating the partner." });
  }
};

module.exports = {
  createPartner, listPartners, getPartner, updatePartnerStatus
};
