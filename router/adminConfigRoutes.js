const express = require("express");
const router = express.Router();

const {
  listSettlementSettings, upsertSettlementSetting,
  getPaymentGatewaySettings, updatePaymentGatewaySettings
} = require("../controller/adminConfigController");
const { getTemplate, updateTemplate, resetTemplate, previewTemplate } = require("../controller/adminAgreementController");
const requireAdminRole = require("../middleware/requireAdminRole");

router.get("/settlement-settings", requireAdminRole("finance"), listSettlementSettings);
router.put("/settlement-settings", requireAdminRole("finance"), upsertSettlementSetting);

router.get("/payment-gateway", requireAdminRole("finance"), getPaymentGatewaySettings);
router.put("/payment-gateway", requireAdminRole("finance"), updatePaymentGatewaySettings);

// Influencer Agreement wording — anyone reviewing influencers can read and
// preview it; only a super admin can change it.
router.get("/agreement-template", requireAdminRole("kyc_reviewer", "finance"), getTemplate);
router.post("/agreement-template/preview", requireAdminRole("kyc_reviewer", "finance"), previewTemplate);
router.put("/agreement-template", requireAdminRole(), updateTemplate);
router.post("/agreement-template/reset", requireAdminRole(), resetTemplate);

module.exports = router;
