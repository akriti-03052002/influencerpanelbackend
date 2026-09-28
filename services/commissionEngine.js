const { CommissionRule, PartnerCommission, Partner, PartnerNotification, PartnerBankAccount } = require("../models/Index");
const logActivity = require("../utils/logActivity");
const { getActiveCommissionAssignment } = require("../utils/partnerCommissionResolver");

// No commission is created — not held, not pending, nothing — for a
// partner whose payout bank account hasn't cleared both the automated
// Razorpay check and the admin's final review (see
// adminBankController.verifyBankAccount, the only place this flips to
// "eligible"). Settlement-holding (utils/settlementHold.js) is a separate,
// later concern about *paying out* already-generated commission — this is
// about not generating it in the first place.
const assertCommissionEligible = async (partner) => {
  const bankAccount = await PartnerBankAccount.findOne({ partnerId: partner._id });
  if (!bankAccount || bankAccount.commissionEligibility !== "eligible") {
    throw new Error("This partner's bank account isn't verified and commission-eligible yet — verify it before marking payments received.");
  }
};

/* ============================================================
   COMMISSION ENGINE
   Picks the active CommissionRule for the partner's type (falls
   back to a generic rule with no partnerType), computes the
   commission, writes the ledger row, and bumps the partner's
   cached stats.

   KNOWN LIMITATION: for commissionType starting with "recurring_",
   this only creates the FIRST cycle. There's no scheduler yet to
   auto-generate renewal cycles (cycleNumber 2, 3, ...) — that
   would need a cron job, which is out of scope for this pass.
============================================================ */

const computeGrossCommission = (rule, revenue, screenCount) => {
  switch (rule.commissionType) {
    case "percentage":
    case "recurring_percentage":
      return (revenue * (rule.rate || 0)) / 100;

    case "fixed_per_deal":
    case "recurring_fixed":
      return rule.fixedAmount || 0;

    case "fixed_per_screen":
      return (rule.perScreenAmount || 0) * (screenCount || 0);

    case "hybrid": {
      const percentPart = (revenue * (rule.hybrid?.percentageRate || 0)) / 100;
      const fixedPart = rule.hybrid?.fixedAmount || 0;
      const screenPart = (rule.hybrid?.perScreenAmount || 0) * (screenCount || 0);
      return percentPart + fixedPart + screenPart;
    }

    default:
      return 0;
  }
};

const computeExpiryFromRecurring = (rule) => {
  if (!rule.recurring?.enabled || !rule.recurring.duration) return undefined;

  const expiry = new Date();
  if (rule.recurring.durationType === "months") expiry.setMonth(expiry.getMonth() + rule.recurring.duration);
  else if (rule.recurring.durationType === "years") expiry.setFullYear(expiry.getFullYear() + rule.recurring.duration);
  else return undefined;

  return expiry;
};

// A vendor-specific PartnerCommissionAssignment (admin-set custom
// commission) always wins over the shared rules — see
// utils/partnerCommissionResolver.js. Non-vendor partner types never
// have one, so this is a no-op for them.
const findRuleForPartner = async (partner) => {
  const assignment = await getActiveCommissionAssignment(partner._id);
  if (assignment) return assignment;

  const typeRule = await CommissionRule.findOne({ partnerType: partner.partnerType, isAddOn: { $ne: true }, status: "active" });
  if (typeRule) return typeRule;

  return CommissionRule.findOne({
    status: "active",
    isAddOn: { $ne: true },
    $or: [{ partnerType: null }, { partnerType: { $exists: false } }]
  });
};

const createCommissionRow = async ({ partner, customerId, rule, revenue, screenCount, cycleNumber, parentCommissionId }) => {
  const grossCommission = computeGrossCommission(rule, revenue, screenCount);
  const isRecurring = rule.recurring?.enabled && rule.commissionType.startsWith("recurring_");

  // rule may be a PartnerCommissionAssignment instead of a CommissionRule
  // (see findRuleForPartner) — commissionRuleId's ref only resolves
  // CommissionRule documents, so it's left unset rather than pointing at
  // the wrong collection; the actual terms used are already captured
  // in full below under `calculation`.
  const commission = await PartnerCommission.create({
    partnerId: partner._id,
    customerId: customerId || undefined,
    commissionRuleId: rule.constructor?.modelName === "CommissionRule" ? rule._id : undefined,
    transaction: { revenue, screenCount, currency: "INR" },
    calculation: {
      commissionType: rule.commissionType,
      rate: rule.rate || 0,
      fixedAmount: rule.fixedAmount || 0,
      grossCommission,
      deductions: 0,
      netCommission: grossCommission
    },
    recurring: {
      isRecurring,
      cycleNumber: cycleNumber || 1,
      parentCommissionId: parentCommissionId || undefined,
      expiresAt: computeExpiryFromRecurring(rule)
    },
    settlement: {
      eligibleAt: new Date(),
      status: "pending"
    }
  });

  partner.stats.totalCommission += grossCommission;
  partner.stats.pendingCommission += grossCommission;

  return { commission };
};

/* ============================================================
   Vendor-only path: fires whenever a Customer's subscription is
   paid — either an admin marking it via adminCustomerController.
   markCustomerPaid, or the customer's own Razorpay checkout (see
   services/customerPaymentFulfillment.applyPaidCustomerPayment;
   adminUser is undefined there since no admin is involved). This is the "core
   growth engine" Vendor model in practice — lifetime-recurring %
   of subscription per active screen — but since there's no
   scheduler, each payment cycle is a manual/self-service action
   rather than an automatic renewal. cycleNumber counts prior
   commissions against this customer so recurring rules read
   correctly in reporting even without a cron.
============================================================ */
const generateCommissionForCustomerPayment = async ({ customer, revenue, screenCount, req, adminUser }) => {
  const partner = await Partner.findById(customer.partnerId);

  if (!partner) {
    throw new Error("Partner not found for this customer.");
  }

  await assertCommissionEligible(partner);

  const rule = await findRuleForPartner(partner);

  if (!rule) {
    throw new Error(
      "No active commission rule matches this partner's type, and no generic fallback rule exists. Create one before marking payment received."
    );
  }

  const priorCycles = await PartnerCommission.countDocuments({ customerId: customer._id });

  partner.stats.totalRevenue += revenue;

  const { commission } = await createCommissionRow({
    partner,
    customerId: customer._id,
    rule,
    revenue,
    screenCount,
    cycleNumber: priorCycles + 1
  });

  await partner.save();

  await logActivity({
    partnerId: partner._id,
    performedByType: adminUser ? "spotx_user" : "system",
    performedByUserId: adminUser?._id,
    activityType: "commission_created",
    entityType: "PartnerCommission",
    entityId: commission._id,
    description: `Commission of ${commission.calculation.netCommission.toFixed(2)} generated for ${customer.companyName}'s payment.`,
    req
  });

  await PartnerNotification.create({
    partnerId: partner._id,
    type: "commission_created",
    title: "Commission earned",
    message: `You earned ${commission.calculation.netCommission.toFixed(2)} commission for ${customer.companyName}'s payment.`,
    entity: { type: "PartnerCommission", entityId: commission._id }
  });

  return { commission };
};

module.exports = { generateCommissionForCustomerPayment };
