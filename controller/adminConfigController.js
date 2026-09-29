const { SettlementSetting } = require("../models/Index");
const { getMaskedSettings, updateSettings } = require("../utils/paymentGatewayConfig");

/* ============================================================
   ADMIN — SETTLEMENT SETTING / PAYMENT GATEWAY
   Plain CRUD for the configuration resources. Grouped in one
   file since each is a small, near-identical pattern.
============================================================ */

// ---- Settlement Settings ----

const listSettlementSettings = async (req, res) => {
  const settings = await SettlementSetting.find().populate("partnerId", "partnerCode legalEntity.businessName");
  return res.json({ success: true, data: settings });
};

const upsertSettlementSetting = async (req, res) => {
  try {
    const { partnerId, ...rest } = req.body;

    if (!partnerId) {
      return res.status(400).json({ success: false, message: "partnerId is required." });
    }

    const setting = await SettlementSetting.findOneAndUpdate(
      { partnerId },
      { $set: rest, $setOnInsert: { partnerId } },
      { returnDocument: "after", upsert: true, runValidators: true }
    );

    return res.json({ success: true, message: "Settlement setting saved.", data: setting });
  } catch (error) {
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
