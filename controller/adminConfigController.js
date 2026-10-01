const mongoose = require("mongoose");
const { SettlementSetting, Partner, PartnerNotification } = require("../models/Index");
const { SETTLEMENT_TYPES } = require("../config/constant");
const { getMaskedSettings, updateSettings } = require("../utils/paymentGatewayConfig");

/* ============================================================
   ADMIN — SETTLEMENT SETTING / PAYMENT GATEWAY
   Plain CRUD for the configuration resources. Grouped in one
   file since each is a small, near-identical pattern.
============================================================ */

// ---- Settlement Settings ----

const listSettlementSettings = async (req, res) => {
  const filter = {};
  if (req.query.partnerId && mongoose.Types.ObjectId.isValid(req.query.partnerId)) filter.partnerId = req.query.partnerId;
  const settings = await SettlementSetting.find(filter).populate("partnerId", "partnerCode primaryContact.name");
  return res.json({ success: true, data: settings });
};

const describeSchedule = (setting) => {
  const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  if (setting.settlementType === "monthly") return `monthly, on day ${setting.settlementDay} of each month`;
  if (setting.settlementType === "quarterly") return `every quarter, on day ${setting.settlementDay}`;
  if (setting.settlementType === "threshold") return `whenever your approved earnings reach ${money(setting.minimumSettlementAmount)}`;
  return "manually by SPOTX";
};

// Only the schedule fields an admin actually sets — never status or other
// internal flags straight from the request body.
const upsertSettlementSetting = async (req, res) => {
  try {
    const { partnerId, settlementType, settlementDay, minimumSettlementAmount, tax } = req.body;

    if (!partnerId || !mongoose.Types.ObjectId.isValid(partnerId)) {
      return res.status(400).json({ success: false, message: "partnerId is required." });
    }
    if (!SETTLEMENT_TYPES.includes(settlementType)) {
      return res.status(400).json({ success: false, message: "Choose monthly, quarterly, threshold or manual." });
    }
    const day = Number(settlementDay);
    if (["monthly", "quarterly"].includes(settlementType) && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
      return res.status(400).json({ success: false, message: "Choose a settlement day between 1 and 31." });
    }
    const minimum = Number(minimumSettlementAmount || 0);
    if (!Number.isFinite(minimum) || minimum < 0 || (settlementType === "threshold" && minimum <= 0)) {
      return res.status(400).json({ success: false, message: "Enter the amount earnings must reach before a payout." });
    }
    const tdsEnabled = Boolean(tax?.tdsEnabled);
    const tdsRate = tdsEnabled ? Number(tax?.tdsRate) : 0;
    if (tdsEnabled && !(Number.isFinite(tdsRate) && tdsRate > 0 && tdsRate <= 30)) {
      return res.status(400).json({ success: false, message: "TDS rate must be between 0 and 30%." });
    }

    const partner = await Partner.findById(partnerId);
    if (!partner) return res.status(404).json({ success: false, message: "Influencer not found." });

    const update = {
      settlementType,
      settlementDay: ["monthly", "quarterly"].includes(settlementType) ? day : undefined,
      minimumSettlementAmount: settlementType === "threshold" ? minimum : 0,
      tax: { tdsEnabled, tdsRate }
    };
    const setting = await SettlementSetting.findOneAndUpdate(
      { partnerId },
      { $set: update, $setOnInsert: { partnerId } },
      { returnDocument: "after", upsert: true, runValidators: true }
    );

    await PartnerNotification.create({
      partnerId,
      type: "settlement_schedule_updated",
      title: "Your payout schedule was set",
      message: `SPOTX will pay your approved earnings ${describeSchedule(setting)}${tdsEnabled ? `, with ${tdsRate}% TDS deducted` : ""}.`,
      entity: { type: "SettlementSetting", entityId: setting._id }
    }).catch((notifyError) => console.error("upsertSettlementSetting: notification failed:", notifyError.message));

    return res.json({ success: true, message: "Payout schedule saved — the influencer was notified.", data: setting });
  } catch (error) {
    console.error("upsertSettlementSetting error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ---- Payment Gateway (Razorpay credentials) ----
// Never returns a decrypted secret — see utils/paymentGatewayConfig for
// exactly what's exposed vs kept write-only.

const getPaymentGatewaySettings = async (req, res) => {
  const settings = await getMaskedSettings();
  return res.json({ success: true, data: settings });
};

const updatePaymentGatewaySettings = async (req, res) => {
  try {
    const { razorpay } = req.body;
    await updateSettings({ razorpay }, req.adminUser._id);
    const settings = await getMaskedSettings();
    return res.json({ success: true, message: "Payment gateway settings saved.", data: settings });
  } catch (error) {
    console.error("updatePaymentGatewaySettings error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong saving these settings." });
  }
};

module.exports = {
  listSettlementSettings, upsertSettlementSetting,
  getPaymentGatewaySettings, updatePaymentGatewaySettings
};
