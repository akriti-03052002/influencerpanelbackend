const Partner = require("../models/Partner");
const ResellerInventory = require("../models/ResellerInventory");
const ResellerCustomer = require("../models/ResellerCustomer");
const ResellerInvoice = require("../models/ResellerInvoice");
const { runBillingForAllPartners, markOverdueInvoices } = require("../services/resellerBilling");
const { runResellerNotificationChecks } = require("../services/resellerNotifications");
const resellerInventory = require("../services/resellerInventory");
const logActivity = require("../utils/logActivity");

/* ============================================================
   ADMIN — RESELLER (CROSS-PARTNER DASHBOARD + DETAIL + BILLING RUN)
============================================================ */

const getDashboard = async (req, res) => {
  try {
    const partners = await Partner.find({ partnerType: "reseller" }).select("_id status");
    const partnerIds = partners.map((p) => p._id);

    const inventories = await ResellerInventory.find({ partnerId: { $in: partnerIds } });

    const totals = inventories.reduce(
      (acc, inv) => {
        acc.totalPurchased += inv.totalPurchasedLicenses;
        acc.totalAllocated += inv.totalAllocatedLicenses;
        acc.totalActive += inv.totalActiveScreens;
        acc.totalAvailable += Math.max(0, inv.totalPurchasedLicenses - inv.totalAllocatedLicenses);
        return acc;
      },
      { totalPurchased: 0, totalAllocated: 0, totalActive: 0, totalAvailable: 0 }
    );

    const [pendingInvoices, overdueInvoices, failedInvoices] = await Promise.all([
      ResellerInvoice.countDocuments({ partnerId: { $in: partnerIds }, paymentStatus: "pending" }),
      ResellerInvoice.countDocuments({ partnerId: { $in: partnerIds }, paymentStatus: "overdue" }),
      ResellerInvoice.countDocuments({ partnerId: { $in: partnerIds }, paymentStatus: "failed" })
    ]);

    return res.json({
      success: true,
      data: {
        totalPartners: partners.length,
        suspendedPartners: partners.filter((p) => p.status === "suspended").length,
        ...totals,
        pendingInvoices,
        overdueInvoices,
        failedInvoices
      }
    });
  } catch (error) {
    console.error("getDashboard (reseller) error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the dashboard." });
  }
};

const getPartnerDetail = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner || partner.partnerType !== "reseller") {
      return res.status(404).json({ success: false, message: "Reseller partner not found." });
    }

    const [inventory, customerCounts, invoices] = await Promise.all([
      resellerInventory.getOrCreateInventory(partner._id),
      ResellerCustomer.aggregate([
        { $match: { partnerId: partner._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      ResellerInvoice.find({ partnerId: partner._id }).sort({ createdAt: -1 }).limit(12)
    ]);

    return res.json({
      success: true,
      data: {
        partner,
        inventory,
        customerCounts: customerCounts.reduce((acc, c) => ({ ...acc, [c._id]: c.count }), {}),
        invoices
      }
    });
  } catch (error) {
    console.error("getPartnerDetail (reseller) error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the partner." });
  }
};

// Manual for this release — see RESELLER_COMPLETE_PLAN.md B12 item 1.
// Idempotent per partner/period via ResellerInvoice's unique index, so
// wiring this to a scheduler later is a matter of calling the same
// service from a cron trigger.
const runBillingNow = async (req, res) => {
  try {
    const results = await runBillingForAllPartners({ performedByUserId: req.adminUser._id });
    // Overdue-marking + due-date reminders/low-inventory alerts are
    // cheapest to check right after billing runs, since that's exactly
    // when new invoices/updated balances exist — the endpoint below also
    // runs these standalone for days no billing run happens.
    const overdueMarked = await markOverdueInvoices();
    const notifications = await runResellerNotificationChecks();
    return res.json({ success: true, message: "Reseller billing run complete.", data: { results, overdueMarked, notifications } });
  } catch (error) {
    console.error("runBillingNow error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong running the billing job." });
  }
};

// Standalone trigger for overdue-marking + the three notification checks
// (due-date reminders, low-inventory alerts, agreement-expiring flags) —
// useful on days no billing run happens. No scheduler exists yet (see
// B12 item 1), so this is an admin-clicked action for now.
const checkNotifications = async (req, res) => {
  try {
    const overdueMarked = await markOverdueInvoices();
    const notifications = await runResellerNotificationChecks();
    return res.json({ success: true, message: "Notification checks complete.", data: { overdueMarked, ...notifications } });
  } catch (error) {
    console.error("checkNotifications error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong running notification checks." });
  }
};

// Superadmin-only manual inventory correction, always logged with a
// reason and applied through the same invariant-guarded service as
// every other inventory mutation — never a direct write.
const adjustInventory = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner || partner.partnerType !== "reseller") {
      return res.status(404).json({ success: false, message: "Reseller partner not found." });
    }

    const { quantity, reason } = req.body;
    if (!quantity || !reason) {
      return res.status(400).json({ success: false, message: "quantity and reason are both required." });
    }

    const inventory = await resellerInventory.adjust({
      partnerId: partner._id,
      quantity: parseInt(quantity, 10),
      reason,
      createdBy: req.adminUser._id
    });

    await logActivity({
      partnerId: partner._id,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "license_adjusted",
      entityType: "ResellerInventory",
      entityId: inventory._id,
      description: `Manual inventory adjustment: ${quantity > 0 ? "+" : ""}${quantity} licenses — ${reason}`,
      req
    });

    return res.json({ success: true, message: "Inventory adjusted.", data: inventory });
  } catch (error) {
    console.error("adjustInventory error:", error);
    return res.status(400).json({ success: false, message: error.message || "Something went wrong adjusting inventory." });
  }
};

module.exports = { getDashboard, getPartnerDetail, runBillingNow, checkNotifications, adjustInventory };
