const express = require("express");
const router = express.Router();

const { getPricingPlan, updatePricingPlan, getBillingConfig, updateBillingConfig } = require("../controller/adminResellerConfigController");
const { getDashboard, getPartnerDetail, runBillingNow, checkNotifications, adjustInventory } = require("../controller/adminResellerController");

// Mounted at /api/admin/reseller behind adminAuthMiddleware (see index.js)
// — same separate admin auth as every other admin route, no change to
// any other admin route group.
router.get("/dashboard", getDashboard);
router.post("/run-billing", runBillingNow);
router.post("/check-notifications", checkNotifications);

router.get("/partners/:id", getPartnerDetail);
router.get("/partners/:id/pricing-plan", getPricingPlan);
router.put("/partners/:id/pricing-plan", updatePricingPlan);
router.get("/partners/:id/billing-config", getBillingConfig);
router.put("/partners/:id/billing-config", updateBillingConfig);
router.post("/partners/:id/adjust-inventory", adjustInventory);

module.exports = router;
