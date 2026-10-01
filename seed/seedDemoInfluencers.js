/**
 * Seeds demo Influencer partners (the only partner type the app currently
 * allows — see config/constant.js PARTNER_TYPES) plus a demo admin login,
 * so the Social Media / Post & Reel screens on both the partner and admin
 * side have something to show.
 *
 * Covers every state the UI branches on: active + fully verified,
 * pending verification, and rejected partners; verified / pending /
 * rejected social accounts; approved / pending / rejected post & reel
 * submissions; KYC docs, bank accounts, notifications and activity log
 * entries.
 *
 * Bypasses the email-OTP registration flow (this is a script, not the
 * public API). KYC document records point at placeholder object keys —
 * there's no real file behind them, so "view document" will 404.
 *
 * Idempotent: every record hangs off a partner whose email ends in
 * DEMO_DOMAIN; a rerun deletes those partners' data and recreates it.
 *
 * Run: node seed/seedDemoInfluencers.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const {
  Partner,
  PartnerUser,
  PartnerDocument,
  PartnerBankAccount,
  PartnerActivity,
  PartnerNotification,
  User,
  InfluencerContentSubmission,
  PartnerCommission,
  PartnerSettlement
} = require("../models/Index");
const { recordContentPayment } = require("../services/contentPayment");
const { attachPartnerAgreement } = require("../services/generatePartnerAgreement");
const { encrypt, maskAccountNumber, maskIfsc } = require("../utils/encryption");
const { ROLE_PERMISSIONS } = require("../config/roles");
const normalizeContentUrl = require("../utils/normalizeContentUrl");

const DEMO_DOMAIN = "influencer.demo";
const DEMO_PASSWORD = "Influencer@123";
const ADMIN_EMAIL = "demo.admin@spotx.in";
const ADMIN_PASSWORD = "Admin@12345";

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const INFLUENCERS = [
  {
    key: "ananya",
    name: "Ananya Iyer",
    phone: "+91 9820011223",
    address: { state: "Karnataka", city: "Bengaluru", addressLine1: "14 Indiranagar 2nd Stage", pincode: "560038" },
    status: "active",
    kyc: "verified",
    bank: { holder: "Ananya Iyer", bank: "HDFC Bank", account: "50100234567812", ifsc: "HDFC0001234", status: "verified" },
    joined: 120,
    accounts: [
      { platform: "instagram", accountId: "ananya.creates", followers: 185400, reviewStatus: "verified", rates: { post: 8000, reel: 15000 } },
      { platform: "youtube", accountId: "AnanyaCreatesVlogs", followers: 92300, reviewStatus: "verified", rates: { post: 6000, reel: 10000 } }
    ],
    posts: [
      { acc: 0, type: "reel", url: "https://www.instagram.com/reel/DmoAnanya01/", status: "approved", age: 60 },
      { acc: 0, type: "post", url: "https://www.instagram.com/p/DmoAnanya02/", status: "approved", age: 45 },
      { acc: 1, type: "reel", url: "https://www.youtube.com/shorts/DmoAnanya03", status: "approved", age: 30 },
      { acc: 0, type: "reel", url: "https://www.instagram.com/reel/DmoAnanya04/", status: "pending", age: 3 },
      { acc: 1, type: "post", url: "https://www.youtube.com/watch?v=DmoAnanya05", status: "pending", age: 1 },
      { acc: 0, type: "post", url: "https://www.instagram.com/p/DmoAnanya06/", status: "rejected", age: 20, note: "SPOTX branding not visible in the post." }
    ]
  },
  {
    key: "kabir",
    name: "Kabir Malhotra",
    phone: "+91 9810098765",
    address: { state: "Delhi", city: "New Delhi", addressLine1: "B-42 Hauz Khas", pincode: "110016" },
    status: "active",
    kyc: "verified",
    bank: { holder: "Kabir Malhotra", bank: "ICICI Bank", account: "001201556677", ifsc: "ICIC0000012", status: "verified" },
    joined: 90,
    accounts: [
      { platform: "instagram", accountId: "kabir.eats", followers: 421800, reviewStatus: "verified", rates: { post: 15000, reel: 28000 } },
      { platform: "facebook", accountId: "KabirEatsOfficial", followers: 60500, reviewStatus: "pending" }
    ],
    posts: [
      { acc: 0, type: "reel", url: "https://www.instagram.com/reel/DmoKabir01/", status: "approved", age: 40 },
      { acc: 0, type: "reel", url: "https://www.instagram.com/reel/DmoKabir02/", status: "approved", age: 18 },
      { acc: 0, type: "post", url: "https://www.instagram.com/p/DmoKabir03/", status: "pending", age: 2 }
    ]
  },
  {
    key: "vikram",
    name: "Vikram Rao",
    phone: "+91 9000456789",
    address: { state: "Telangana", city: "Hyderabad", addressLine1: "Plot 7, Jubilee Hills", pincode: "500033" },
    status: "active",
    kyc: "verified",
    bank: { holder: "Vikram Rao", bank: "State Bank of India", account: "38765432109", ifsc: "SBIN0004567", status: "verified" },
    joined: 75,
    accounts: [
      { platform: "youtube", accountId: "TechWithVikram", followers: 1240000, reviewStatus: "verified", rates: { post: 25000, reel: 40000 } },
      { platform: "instagram", accountId: "techwithvikram_fake", followers: 5000, reviewStatus: "rejected", reason: "Handle does not match the verified YouTube channel owner." }
    ],
    posts: [
      { acc: 0, type: "post", url: "https://www.youtube.com/watch?v=DmoVikram01", status: "approved", age: 25 },
      { acc: 0, type: "reel", url: "https://youtu.be/DmoVikram02", status: "pending", age: 4 }
    ]
  },
  {
    key: "meera",
    name: "Meera Nair",
    phone: "+91 9447012345",
    address: { state: "Kerala", city: "Kochi", addressLine1: "", pincode: "" },
    status: "pending_verification",
    kyc: "pending",
    bank: { holder: "Meera Nair", bank: "Federal Bank", account: "14560100098765", ifsc: "FDRL0001456", status: "pending" },
    joined: 6,
    accounts: [
      { platform: "instagram", accountId: "meera.travels", followers: 34200, reviewStatus: "pending" }
    ],
    posts: []
  },
  {
    key: "sana",
    name: "Sana Qureshi",
    phone: "+91 9930087654",
    address: { state: "Maharashtra", city: "Mumbai", addressLine1: "21 Bandra West", pincode: "400050" },
    status: "rejected",
    kyc: "rejected",
    bank: null,
    joined: 15,
    rejectionReason: "PAN card image is blurry — please upload a clear scan.",
    accounts: [
      { platform: "instagram", accountId: "sana.style.diaries", followers: 12800, reviewStatus: "rejected", reason: "Follower count could not be verified." }
    ],
    posts: []
  }
];

const emailFor = (key) => `${key}@${DEMO_DOMAIN}`;

const wipeExistingDemo = async () => {
  const demoPartners = await Partner.find({ "primaryContact.email": new RegExp(`@${DEMO_DOMAIN.replace(".", "\\.")}$`) }, "_id");
  const ids = demoPartners.map((p) => p._id);
  if (ids.length === 0) return;

  await Promise.all([
    PartnerUser.deleteMany({ partnerId: { $in: ids } }),
    PartnerDocument.deleteMany({ partnerId: { $in: ids } }),
    PartnerBankAccount.deleteMany({ partnerId: { $in: ids } }),
    PartnerActivity.deleteMany({ partnerId: { $in: ids } }),
    PartnerNotification.deleteMany({ partnerId: { $in: ids } }),
    InfluencerContentSubmission.deleteMany({ partnerId: { $in: ids } }),
    PartnerCommission.deleteMany({ partnerId: { $in: ids } }),
    PartnerSettlement.deleteMany({ partnerId: { $in: ids } })
  ]);
  await Partner.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${ids.length} existing demo influencer partner(s) and their data.`);
};

const seedAdmin = async () => {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await User.findOneAndUpdate(
    { email: ADMIN_EMAIL },
    { $set: { name: "Demo Admin", passwordHash, role: "super_admin", status: "active" } },
    { upsert: true, new: true }
  );
  return admin;
};

const seedInfluencer = async (spec, admin, passwordHash, index) => {
  const email = emailFor(spec.key);
  const joinedAt = daysAgo(spec.joined);
  const verified = spec.status === "active";

  const reviewedFor = (status) => (status === "pending" ? {} : { reviewedBy: admin._id, reviewedAt: daysAgo(Math.max(1, spec.joined - 3)) });

  const approvedPosts = spec.posts.filter((p) => p.status === "approved");
  // Each account has its own price, so earnings follow the account a post came from.
  const rateFor = (p) => spec.accounts[p.acc].rates?.[p.type] || 0;
  const approvedEarnings = approvedPosts.reduce((sum, p) => sum + rateFor(p), 0);

  const partner = await Partner.create({
    partnerCode: `PTN-DEMO${String(index + 1).padStart(3, "0")}`,
    partnerType: "influencer",
    legalEntity: { legalName: spec.name },
    primaryContact: { name: spec.name, email, phone: spec.phone, designation: "Creator" },
    address: { country: "India", ...spec.address },
    socialAccounts: spec.accounts.map((a) => ({
      platform: a.platform,
      accountId: a.accountId,
      username: a.accountId,
      followers: a.followers,
      connected: false,
      source: "manual",
      reviewStatus: a.reviewStatus,
      submittedAt: daysAgo(Math.max(1, spec.joined - 2)),
      rejectionReason: a.reason || "",
      ...(a.rates ? { paymentRates: { ...a.rates, currency: "INR", updatedBy: admin._id, updatedAt: daysAgo(spec.joined - 5) } } : {}),
      ...reviewedFor(a.reviewStatus)
    })),
    verification: {
      overallStatus: spec.kyc,
      ...(verified ? { verifiedBy: admin._id, verifiedAt: daysAgo(spec.joined - 4) } : {}),
      rejectionReason: spec.rejectionReason || ""
    },
    stats: {
      totalCommission: approvedEarnings,
      approvedCommission: approvedEarnings,
      pendingCommission: approvedEarnings
    },
    status: spec.status
  });
  // Backdate so dashboards/lists show a realistic join date.
  await Partner.collection.updateOne({ _id: partner._id }, { $set: { createdAt: joinedAt } });

  const user = await PartnerUser.create({
    partnerId: partner._id,
    name: spec.name,
    email,
    phone: spec.phone,
    role: "owner",
    permissions: ROLE_PERMISSIONS.owner,
    auth: { provider: "email", passwordHash, lastLoginAt: daysAgo(1) },
    status: "active"
  });

  // KYC documents (influencers only need PAN + cancelled cheque).
  const docStatus = spec.kyc === "verified" ? "verified" : spec.kyc === "rejected" ? "rejected" : "pending";
  const docs = await PartnerDocument.insertMany(
    ["pan_card", "cancelled_cheque"]
      .filter((type) => spec.bank || type === "pan_card")
      .map((type) => ({
        partnerId: partner._id,
        documentType: type,
        documentNumber: type === "pan_card" ? `ABCPD${1000 + index}K` : "",
        file: { objectKey: `demo/${spec.key}/${type}.pdf`, originalName: `${type}.pdf`, mimeType: "application/pdf", size: 184320 },
        verification: {
          status: docStatus,
          rejectionReason: docStatus === "rejected" ? spec.rejectionReason : "",
          ...(docStatus !== "pending" ? { verifiedBy: admin._id, verifiedAt: daysAgo(spec.joined - 4) } : {})
        }
      }))
  );

  if (spec.bank) {
    const bankVerified = spec.bank.status === "verified";
    await PartnerBankAccount.create({
      partnerId: partner._id,
      accountHolderName: spec.bank.holder,
      bankName: spec.bank.bank,
      accountNumberEncrypted: encrypt(spec.bank.account),
      accountNumberLast4: maskAccountNumber(spec.bank.account),
      ifscEncrypted: encrypt(spec.bank.ifsc),
      ifscMasked: maskIfsc(spec.bank.ifsc),
      accountType: "savings",
      cancelledChequeDocumentId: docs.find((d) => d.documentType === "cancelled_cheque")?._id,
      verification: {
        status: spec.bank.status,
        ...(bankVerified ? { verifiedBy: admin._id, verifiedAt: daysAgo(spec.joined - 4) } : {})
      },
      razorpayCheck: bankVerified
        ? { paymentStatus: "captured", method: "netbanking", matchedBankName: spec.bank.bank, nameMatchStatus: "matched", completedAt: daysAgo(spec.joined - 3) }
        : { paymentStatus: "not_initiated" },
      commissionEligibility: bankVerified ? "eligible" : "not_eligible",
      security: { encryptedAt: new Date(), keyVersion: "v1" }
    });
  }

  // Post & reel submissions.
  const submissions = [];
  for (const p of spec.posts) {
    const account = partner.socialAccounts[p.acc];
    const approved = p.status === "approved";
    // eslint-disable-next-line no-await-in-loop
    const sub = await InfluencerContentSubmission.create({
      partnerId: partner._id,
      socialAccountId: account._id,
      platform: account.platform,
      contentType: p.type,
      url: p.url,
      normalizedUrl: normalizeContentUrl(p.url),
      status: p.status,
      payment: approved
        ? { amount: rateFor(p), currency: "INR", status: "approved" }
        : { amount: 0, currency: "INR", status: "not_assigned" },
      ownershipConfirmed: true,
      reviewNote: p.note || "",
      ...(p.status !== "pending" ? { reviewedBy: admin._id, reviewedAt: daysAgo(Math.max(0, p.age - 1)) } : {})
    });
    await InfluencerContentSubmission.collection.updateOne({ _id: sub._id }, { $set: { createdAt: daysAgo(p.age) } });
    submissions.push({ sub, spec: p });
    // Approved content is owed money — put it on the earnings ledger so it
    // shows up in Settlements. Stats were already set above.
    // eslint-disable-next-line no-await-in-loop
    if (approved) await recordContentPayment(sub, { accountLabel: account.username || account.accountId, updateStats: false });
  }

  // Activity log.
  const activities = [
    { activityType: "status_changed", performedBy: { type: "partner_user", userId: user._id }, description: "Partner registered", at: spec.joined },
    { activityType: "document_uploaded", performedBy: { type: "partner_user", userId: user._id }, description: "Uploaded PAN card", at: spec.joined - 1 }
  ];
  if (verified) {
    activities.push(
      { activityType: "document_verified", performedBy: { type: "spotx_user", userId: admin._id }, description: "KYC documents verified", at: spec.joined - 4 },
      { activityType: "status_changed", performedBy: { type: "spotx_user", userId: admin._id }, description: "Partner activated", at: spec.joined - 4 }
    );
  }
  if (spec.status === "rejected") {
    activities.push({ activityType: "status_changed", performedBy: { type: "spotx_user", userId: admin._id }, description: `Partner rejected: ${spec.rejectionReason}`, at: spec.joined - 3 });
  }
  activities.push({ activityType: "login", performedBy: { type: "partner_user", userId: user._id }, description: "Logged in", at: 1 });

  const insertedActivities = await PartnerActivity.insertMany(
    activities.map(({ at, ...a }) => ({ partnerId: partner._id, ...a }))
  );
  await Promise.all(insertedActivities.map((a, i) =>
    PartnerActivity.collection.updateOne({ _id: a._id }, { $set: { createdAt: daysAgo(activities[i].at) } })
  ));

  // Notifications.
  const notifications = [];
  if (verified) {
    notifications.push({ type: "partner_verified", title: "You're verified!", message: "Your KYC and bank account are verified. You can now submit posts and reels.", read: true, at: spec.joined - 4 });
  } else if (spec.status === "rejected") {
    notifications.push({ type: "partner_rejected", title: "Verification rejected", message: spec.rejectionReason, read: false, at: spec.joined - 3 });
  } else {
    notifications.push({ type: "kyc_pending", title: "Documents under review", message: "SPOTX is reviewing your KYC documents. This usually takes 1–2 business days.", read: false, at: 2 });
  }
  for (const a of spec.accounts) {
    if (a.reviewStatus === "verified") notifications.push({ type: "social_account_verified", title: "Social account verified", message: `Your ${a.platform} account @${a.accountId} was verified.`, read: true, at: spec.joined - 5 });
    if (a.reviewStatus === "rejected") notifications.push({ type: "social_account_rejected", title: "Social account rejected", message: `@${a.accountId}: ${a.reason}`, read: false, at: 5 });
  }
  for (const { sub, spec: p } of submissions) {
    if (p.status === "approved") notifications.push({ type: "content_approved", title: `${p.type === "reel" ? "Reel" : "Post"} approved`, message: `Your ${p.type} was approved — ₹${sub.payment.amount.toLocaleString("en-IN")} added to your earnings.`, read: p.age > 20, at: Math.max(0, p.age - 1), entity: { type: "InfluencerContentSubmission", entityId: sub._id } });
    if (p.status === "rejected") notifications.push({ type: "content_rejected", title: `${p.type === "reel" ? "Reel" : "Post"} rejected`, message: p.note, read: false, at: Math.max(0, p.age - 1), entity: { type: "InfluencerContentSubmission", entityId: sub._id } });
  }

  const insertedNotifications = await PartnerNotification.insertMany(
    notifications.map(({ at, read, ...n }) => ({ partnerId: partner._id, partnerUserId: user._id, read, ...(read ? { readAt: daysAgo(Math.max(0, at - 1)) } : {}), ...n }))
  );
  await Promise.all(insertedNotifications.map((n, i) =>
    PartnerNotification.collection.updateOne({ _id: n._id }, { $set: { createdAt: daysAgo(notifications[i].at) } })
  ));

  // Verified influencers get their agreement on activation — same here.
  if (verified) await attachPartnerAgreement(await Partner.findById(partner._id), admin._id);

  return { email, status: spec.status, accounts: spec.accounts.length, posts: spec.posts.length };
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  await wipeExistingDemo();
  const admin = await seedAdmin();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const summary = [];
  for (const [i, spec] of INFLUENCERS.entries()) {
    // eslint-disable-next-line no-await-in-loop
    summary.push(await seedInfluencer(spec, admin, passwordHash, i));
  }

  console.log("\n===================================");
  console.log("DEMO LOGINS");
  console.log("===================================");
  console.log(`Admin:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}   (/admin/login)`);
  console.log(`Partner password (all): ${DEMO_PASSWORD}      (/partner/login)`);
  console.table(summary);

  process.exit(0);
};

run().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
