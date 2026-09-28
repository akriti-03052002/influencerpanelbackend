const { PartnerCommission, PartnerNotification, Partner } = require("../models/Index");
const logActivity = require("../utils/logActivity");

/* ============================================================
   ADMIN — COMMISSION APPROVAL
============================================================ */

const listCommissions = async (req, res) => {
  const { status, partnerId } = req.query;

  const filter = {};
  if (status) filter["settlement.status"] = status;
  if (partnerId) filter.partnerId = partnerId;

  const commissions = await PartnerCommission.find(filter)
    .sort({ createdAt: -1 })
    .populate("partnerId", "partnerCode legalEntity.businessName");

  return res.json({ success: true, data: commissions });
};

const approveCommission = async (req, res) => {
  try {
    const commission = await PartnerCommission.findById(req.params.id);

    if (!commission) {
      return res.status(404).json({ success: false, message: "Commission not found." });
    }

    if (commission.settlement.status !== "pending") {
      return res.status(400).json({ success: false, message: `Commission is already ${commission.settlement.status}.` });
    }

    commission.settlement.status = "approved";
    await commission.save();

    await logActivity({
      partnerId: commission.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "commission_approved",
      entityType: "PartnerCommission",
      entityId: commission._id,
      description: `${req.adminUser.name} approved a commission.`,
      req
    });

    await PartnerNotification.create({
      partnerId: commission.partnerId,
      type: "commission_approved",
      title: "Commission approved",
      message: "One of your commissions was approved and is now eligible for settlement.",
      entity: { type: "PartnerCommission", entityId: commission._id }
    });

    return res.json({ success: true, message: "Commission approved.", data: commission });
  } catch (error) {
    console.error("approveCommission error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong approving the commission." });
  }
};

// "Hold" isn't its own settlement.status — it just keeps a commission out of
// the "approved" pool so it can't be swept into a settlement batch. Reverts
// an approved commission back to pending; the reason lives in the activity
// log since there's no dedicated field for it.
const holdCommission = async (req, res) => {
  try {
    const { reason } = req.body;
    const commission = await PartnerCommission.findById(req.params.id);

    if (!commission) {
      return res.status(404).json({ success: false, message: "Commission not found." });
    }

    if (commission.settlement.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: `Only an approved commission can be put on hold (this one is ${commission.settlement.status}).`
      });
    }

    commission.settlement.status = "pending";
    await commission.save();

    await logActivity({
      partnerId: commission.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "note",
      entityType: "PartnerCommission",
      entityId: commission._id,
      description: `${req.adminUser.name} put this commission on hold${reason ? `: ${reason}` : "."}`,
      req
    });

    return res.json({ success: true, message: "Commission put on hold.", data: commission });
  } catch (error) {
    console.error("holdCommission error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong holding the commission." });
  }
};

// Full reversal (e.g. the underlying customer payment was refunded). Can't
// touch a commission that's already bundled into a not-yet-paid settlement —
// that batch's totals would go stale — so those must be pulled out at the
// settlement level first.
const reverseCommission = async (req, res) => {
  try {
    const { reason } = req.body;
    const commission = await PartnerCommission.findById(req.params.id);

    if (!commission) {
      return res.status(404).json({ success: false, message: "Commission not found." });
    }

    if (commission.settlement.status === "cancelled") {
      return res.status(400).json({ success: false, message: "This commission is already cancelled." });
    }

    if (commission.settlement.status === "eligible") {
      return res.status(400).json({
        success: false,
        message: "This commission is already part of a pending settlement batch — remove it from that settlement first."
      });
    }

    const partner = await Partner.findById(commission.partnerId);
    const amount = commission.calculation.netCommission;

    if (commission.settlement.status === "settled") {
      partner.stats.paidCommission = Math.max(0, partner.stats.paidCommission - amount);
    } else {
      partner.stats.pendingCommission = Math.max(0, partner.stats.pendingCommission - amount);
    }
    partner.stats.totalCommission = Math.max(0, partner.stats.totalCommission - amount);
    await partner.save();

    commission.settlement.status = "cancelled";
    await commission.save();

    await logActivity({
      partnerId: commission.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "note",
      entityType: "PartnerCommission",
      entityId: commission._id,
      description: `${req.adminUser.name} reversed a commission of ${amount.toFixed(2)}${reason ? `: ${reason}` : "."}`,
      req
    });

    await PartnerNotification.create({
      partnerId: commission.partnerId,
      type: "commission_reversed",
      title: "Commission reversed",
      message: `A commission of ${amount.toFixed(2)} was reversed${reason ? `: ${reason}` : "."}`,
      entity: { type: "PartnerCommission", entityId: commission._id }
    });

    return res.json({ success: true, message: "Commission reversed.", data: commission });
  } catch (error) {
    console.error("reverseCommission error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong reversing the commission." });
  }
};

module.exports = { listCommissions, approveCommission, holdCommission, reverseCommission };
