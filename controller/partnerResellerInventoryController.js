const ResellerInventory = require("../models/ResellerInventory");
const LicenseTransaction = require("../models/LicenseTransaction");
const { getOrCreateInventory } = require("../services/resellerInventory");

/* ============================================================
   PARTNER — RESELLER INVENTORY (READ-ONLY)
   Scoped to req.partner._id throughout, same as every other
   partner-facing controller. Inventory is only ever written by
   services/resellerInventory.js — this controller never mutates it.
============================================================ */

const getInventory = async (req, res) => {
  try {
    const inventory = await getOrCreateInventory(req.partner._id);
    return res.json({ success: true, data: inventory });
  } catch (error) {
    console.error("getInventory error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading your inventory." });
  }
};

const listTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 25);

    const [transactions, total] = await Promise.all([
      LicenseTransaction.find({ partnerId: req.partner._id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      LicenseTransaction.countDocuments({ partnerId: req.partner._id })
    ]);

    return res.json({ success: true, data: transactions, pagination: { page, limit, total } });
  } catch (error) {
    console.error("listTransactions error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading transaction history." });
  }
};

module.exports = { getInventory, listTransactions };
