const { Partner, Customer, PartnerDocument, PartnerBankAccount, PartnerCommission, PartnerSettlement } = require("../models/Index");

/* ============================================================
   ADMIN — CROSS-CUTTING KPI AGGREGATION
   Read-only rollups for the admin dashboard, sourced entirely
   from existing collections — no new stat fields.
============================================================ */

const groupCounts = (rows) => rows.reduce((acc, r) => ({ ...acc, [r._id || "unknown"]: r.count }), {});

const getKpis = async (req, res) => {
  const [
    totalPartners, activePartners, partnersByType, partnersByStatus,
    totalCustomers, customersBySubStatus,
    documentsByStatus, bankAccountsByStatus, commissionsByStatus, settlementsByStatus,
    commissionTotals, paidPayouts
  ] = await Promise.all([
    Partner.countDocuments(),
    Partner.countDocuments({ status: "active" }),
    Partner.aggregate([{ $group: { _id: "$partnerType", count: { $sum: 1 } } }]),
    Partner.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Customer.countDocuments(),
    Customer.aggregate([{ $group: { _id: "$subscription.status", count: { $sum: 1 } } }]),
    PartnerDocument.aggregate([{ $group: { _id: "$verification.status", count: { $sum: 1 } } }]),
    PartnerBankAccount.aggregate([{ $group: { _id: "$verification.status", count: { $sum: 1 } } }]),
    PartnerCommission.aggregate([{ $group: { _id: "$settlement.status", count: { $sum: 1 } } }]),
    PartnerSettlement.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    PartnerCommission.aggregate([{ $group: { _id: null, total: { $sum: "$calculation.netCommission" } } }]),
    PartnerSettlement.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount.net" } } }])
  ]);

  return res.json({
    success: true,
    data: {
      totalPartners,
      activePartners,
      partnersByType: groupCounts(partnersByType),
      partnersByStatus: groupCounts(partnersByStatus),
      totalCustomers,
      customersBySubscriptionStatus: groupCounts(customersBySubStatus),
      documentsByStatus: groupCounts(documentsByStatus),
      bankAccountsByStatus: groupCounts(bankAccountsByStatus),
      commissionsByStatus: groupCounts(commissionsByStatus),
      settlementsByStatus: groupCounts(settlementsByStatus),
      totalCommissionGenerated: commissionTotals[0]?.total || 0,
      totalPayoutsPaid: paidPayouts[0]?.total || 0
    }
  });
};

module.exports = { getKpis };
