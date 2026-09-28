const Partner = require("../models/Partner");
const ResellerInventory = require("../models/ResellerInventory");
const ResellerBillingConfig = require("../models/ResellerBillingConfig");
const ResellerInvoice = require("../models/ResellerInvoice");
const { getOrCreatePricingPlan } = require("./resellerPricing");
const logActivity = require("../utils/logActivity");

/* ============================================================
   RESELLER BILLING
   Generates a ResellerInvoice billed strictly on
   totalPurchasedLicenses — never active/allocated/registered
   counts (RESELLER_COMPLETE_PLAN.md correction #1). Manual for
   this release: triggered by an admin action
   (adminResellerController.runBillingNow), not a scheduler — see
   B12 item 1. Idempotent via ResellerInvoice's unique
   (partnerId, billingPeriodStart, billingPeriodEnd) index, so the
   same service can be wired to a cron job later with zero change
   to this logic.
============================================================ */

const CYCLE_MULTIPLIER = { monthly: 1, quarterly: 3, yearly: 12 };
const CYCLE_DAYS = { monthly: 30, quarterly: 90, yearly: 365 };

let invoiceCounter = 0;
const generateInvoiceNumber = async () => {
  const count = await ResellerInvoice.countDocuments();
  invoiceCounter = Math.max(invoiceCounter, count) + 1;
  return `INV-RP-${String(invoiceCounter).padStart(5, "0")}`;
};

// billingPeriodEnd is anchored to the start of the current day (not raw
// `now`) specifically so two admin clicks of "Run Billing Now" on the
// same day compute the IDENTICAL period and collide on
// ResellerInvoice's unique (partnerId, billingPeriodStart,
// billingPeriodEnd) index — a millisecond-precise `now` would never
// collide with itself on a second run, silently duplicating invoices.
const resolveBillingPeriod = (config, now = new Date()) => {
  const days = CYCLE_DAYS[config.billingCycle];
  const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const billingPeriodStart = new Date(billingPeriodEnd.getTime() - days * 24 * 60 * 60 * 1000);
  return { billingPeriodStart, billingPeriodEnd };
};

/* Generates (or returns the existing) invoice for one partner's current
   billing period. Never mutates purchased-license counts — billing only
   reads inventory, it does not change it. */
const generateInvoiceForPartner = async (partnerId, { now = new Date(), performedByUserId } = {}) => {
  const [inventory, config, plan] = await Promise.all([
    ResellerInventory.findOne({ partnerId }),
    ResellerBillingConfig.findOne({ partnerId }),
    getOrCreatePricingPlan(partnerId)
  ]);

  if (!inventory) {
    throw new Error("This partner has no purchased licenses yet — nothing to bill.");
  }

  const billingConfig = config || (await ResellerBillingConfig.create({ partnerId }));
  const { billingPeriodStart, billingPeriodEnd } = resolveBillingPeriod(billingConfig, now);

  const existing = await ResellerInvoice.findOne({ partnerId, billingPeriodStart, billingPeriodEnd });
  if (existing) return existing;

  const purchasedLicenseSnapshot = inventory.totalPurchasedLicenses;
  const cycleMultiplier = CYCLE_MULTIPLIER[billingConfig.billingCycle];
  const unitPriceSnapshot = plan.effectivePricePerScreen;

  const subtotal = purchasedLicenseSnapshot * unitPriceSnapshot * cycleMultiplier;
  const taxAmount = (subtotal * plan.taxRatePercent) / 100;
  const total = subtotal + taxAmount;

  const dueDate = new Date(billingPeriodEnd.getTime() + billingConfig.dueDays * 24 * 60 * 60 * 1000);

  const invoiceNumber = await generateInvoiceNumber();

  const invoice = await ResellerInvoice.create({
    partnerId,
    invoiceNumber,
    billingCycle: billingConfig.billingCycle,
    billingPeriodStart,
    billingPeriodEnd,
    purchasedLicenseSnapshot,
    standardUnitPriceSnapshot: plan.standardPricePerScreen,
    pricingModeSnapshot: plan.pricingMode,
    wholesaleDiscountPercentSnapshot: plan.pricingMode === "discount_percent" ? plan.wholesaleDiscountPercent : undefined,
    fixedUnitPriceSnapshot: plan.pricingMode === "fixed_price" ? plan.fixedPricePerScreen : undefined,
    unitPriceSnapshot,
    cycleMultiplier,
    subtotal,
    taxRatePercent: plan.taxRatePercent,
    taxAmount,
    total,
    dueDate,
    paymentStatus: "pending"
  });

  await logActivity({
    partnerId,
    performedByType: performedByUserId ? "spotx_user" : "system",
    performedByUserId,
    activityType: "reseller_invoice_generated",
    entityType: "ResellerInvoice",
    entityId: invoice._id,
    description: `Invoice ${invoiceNumber} generated for ${purchasedLicenseSnapshot} purchased licenses (${billingConfig.billingCycle}).`
  });

  return invoice;
};

/* Admin-triggered "Run Reseller Billing Now" — generates invoices for
   every reseller partner whose config exists (or defaults to one on
   first run). Idempotent per partner via the unique period index. */
const runBillingForAllPartners = async ({ performedByUserId, now = new Date() } = {}) => {
  const partners = await Partner.find({ partnerType: "reseller", status: "active" }).select("_id");

  const results = [];
  for (const partner of partners) {
    try {
      const invoice = await generateInvoiceForPartner(partner._id, { now, performedByUserId });
      results.push({ partnerId: partner._id, invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber });
    } catch (error) {
      results.push({ partnerId: partner._id, error: error.message });
    }
  }

  return results;
};

// Flips pending/failed invoices past their dueDate to "overdue" — read by
// enforcement logic (see partnerVerification-style status gating, B12
// item 7: panel-access restriction only) to decide whether a partner's
// new allocate/register/activate/purchase actions should be blocked.
// Manual trigger for now, same as everything else in this file.
const markOverdueInvoices = async () => {
  const result = await ResellerInvoice.updateMany(
    { paymentStatus: { $in: ["pending", "failed"] }, dueDate: { $lt: new Date() } },
    { $set: { paymentStatus: "overdue" } }
  );
  return result.modifiedCount || 0;
};

module.exports = { generateInvoiceForPartner, runBillingForAllPartners, markOverdueInvoices, CYCLE_MULTIPLIER };
