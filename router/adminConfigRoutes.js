const express = require("express");
const router = express.Router();

const {
  listSettlementSettings, upsertSettlementSetting,
  getPaymentGatewaySettings, updatePaymentGatewaySettings
} = require("../controller/adminConfigController");
const requireAdminRole = require("../middleware/requireAdminRole");

router.get("/settlement-settings", requireAdminRole("finance"), listSettlementSettings);
router.put("/settlement-settings", requireAdminRole("finance"), upsertSettlementSetting);

router.get("/payment-gateway", requireAdminRole("finance"), getPaymentGatewaySettings);
router.put("/payment-gateway", requireAdminRole("finance"), updatePaymentGatewaySettings);

module.exports = router;
