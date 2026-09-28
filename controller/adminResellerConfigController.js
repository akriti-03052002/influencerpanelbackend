const ResellerPricingPlan = require("../models/ResellerPricingPlan");
const ResellerBillingConfig = require("../models/ResellerBillingConfig");
const Partner = require("../models/Partner");
const { getOrCreatePricingPlan } = require("../services/resellerPricing");
const logActivity = require("../utils/logActivity");

/* ============================================================
   ADMIN — RESELLER PRICING & BILLING CONFIG
   Superadmin-only, per partner. A Reseller partner can never edit
   any of this from the partner panel — pricingMode, rate, and
   billingCycle are all set here, per the partner's signed
   agreement (RESELLER_COMPLETE_PLAN.md B12 item 5).
============================================================ */

const getPricingPlan = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner || partner.partnerType !== "reseller") {
      return res.status(404).json({ success: false, message: "Reseller partner not found." });
    }

    const plan = await getOrCreatePricingPlan(partner._id);
    return res.json({ success: true, data: plan });
  } catch (error) {
    console.error("getPricingPlan error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the pricing plan." });
  }
};

const updatePricingPlan = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner || partner.partnerType !== "reseller") {
      return res.status(404).json({ success: false, message: "Reseller partner not found." });
    }

    const {
      standardPricePerScreen, pricingMode, wholesaleDiscountPercent, fixedPricePerScreen,
      minPurchaseQty, bulkTiers, bulkTierBasis, taxRatePercent
    } = req.body;

    if (pricingMode && !["discount_percent", "fixed_price"].includes(pricingMode)) {
      return res.status(400).json({ success: false, message: "Invalid pricing mode." });
    }

    let plan = await ResellerPricingPlan.findOne({ partnerId: partner._id });
    if (!plan) plan = new ResellerPricingPlan({ partnerId: partner._id });

    if (standardPricePerScreen !== undefined) plan.standardPricePerScreen = standardPricePerScreen;
    if (pricingMode !== undefined) plan.pricingMode = pricingMode;
    if (wholesaleDiscountPercent !== undefined) plan.wholesaleDiscountPercent = wholesaleDiscountPercent;
    if (fixedPricePerScreen !== undefined) plan.fixedPricePerScreen = fixedPricePerScreen;
    if (minPurchaseQty !== undefined) plan.minPurchaseQty = minPurchaseQty;
    if (bulkTiers !== undefined) plan.bulkTiers = bulkTiers;
    if (bulkTierBasis !== undefined) plan.bulkTierBasis = bulkTierBasis;
    if (taxRatePercent !== undefined) plan.taxRatePercent = taxRatePercent;

    // effectivePricePerScreen is recomputed by the model's pre-save hook,
    // but we save explicitly here to run it before responding.
    await plan.save();

    await logActivity({
      partnerId: partner._id,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "note",
      entityType: "ResellerPricingPlan",
      entityId: plan._id,
      description: `Pricing plan updated — ${plan.pricingMode} mode, effective rate ${plan.effectivePricePerScreen}/screen.`,
      req
    });

    return res.json({ success: true, message: "Pricing plan updated.", data: plan });
  } catch (error) {
    console.error("updatePricingPlan error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong updating the pricing plan." });
  }
};

const getBillingConfig = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner || partner.partnerType !== "reseller") {
      return res.status(404).json({ success: false, message: "Reseller partner not found." });
    }

    let config = await ResellerBillingConfig.findOne({ partnerId: partner._id });
    if (!config) config = await ResellerBillingConfig.create({ partnerId: partner._id });

    return res.json({ success: true, data: config });
  } catch (error) {
    console.error("getBillingConfig error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the billing config." });
  }
};

const updateBillingConfig = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner || partner.partnerType !== "reseller") {
      return res.status(404).json({ success: false, message: "Reseller partner not found." });
    }

    const {
      billingCycle, billingStartRule, prorationRule, dueDays,
      dueDateReminderDaysBefore, lowInventoryNotificationThresholdPercent,
      retrySchedule, gracePeriodDays, agreementEndDate
    } = req.body;

    let config = await ResellerBillingConfig.findOne({ partnerId: partner._id });
    if (!config) config = new ResellerBillingConfig({ partnerId: partner._id });

    if (billingCycle !== undefined) config.billingCycle = billingCycle;
    if (billingStartRule !== undefined) config.billingStartRule = billingStartRule;
    if (prorationRule !== undefined) config.prorationRule = prorationRule;
    if (dueDays !== undefined) config.dueDays = dueDays;
    if (dueDateReminderDaysBefore !== undefined) config.dueDateReminderDaysBefore = dueDateReminderDaysBefore;
    if (lowInventoryNotificationThresholdPercent !== undefined) config.lowInventoryNotificationThresholdPercent = lowInventoryNotificationThresholdPercent;
    if (retrySchedule !== undefined) config.retrySchedule = retrySchedule;
    if (gracePeriodDays !== undefined) config.gracePeriodDays = gracePeriodDays;
    if (agreementEndDate !== undefined) config.agreementEndDate = agreementEndDate;

    await config.save();

    await logActivity({
      partnerId: partner._id,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "note",
      entityType: "ResellerBillingConfig",
      entityId: config._id,
      description: `Billing config updated — cycle: ${config.billingCycle}.`,
      req
    });

    return res.json({ success: true, message: "Billing config updated.", data: config });
  } catch (error) {
    console.error("updateBillingConfig error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong updating the billing config." });
  }
};

module.exports = { getPricingPlan, updatePricingPlan, getBillingConfig, updateBillingConfig };
