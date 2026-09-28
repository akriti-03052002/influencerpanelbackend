const express = require("express");
const router = express.Router();

const requireResellerPartner = require("../middleware/requireResellerPartner");
const blockIfResellerPaymentRestricted = require("../middleware/blockIfResellerPaymentRestricted");
const requirePermission = require("../middleware/requirePermission");

const { getInventory, listTransactions } = require("../controller/partnerResellerInventoryController");
const { createLicenseOrder, verifyLicenseOrder, listLicenseOrders, getLicenseOrder } = require("../controller/partnerLicenseOrderController");
const { listCustomers, getCustomer, createCustomer } = require("../controller/partnerResellerCustomerController");
const {
  listAllocations, allocateLicenses, releaseLicenses, registerBundleDelivery,
  activateScreens, suspendCustomer, reactivateCustomer, cancelAllocation
} = require("../controller/partnerAllocationController");
const { listInvoices, getInvoice, createInvoicePaymentOrder, verifyInvoicePayment } = require("../controller/partnerResellerBillingController");

// Mounted at /api/partner/reseller under the same verifiedGuard as every
// other partner-facing route group (see index.js), plus this Reseller-
// only gate — no impact on any other partnerType's routes/files.
router.use(requireResellerPartner);

// Inventory
router.get("/inventory", requirePermission("reseller:inventory:view"), getInventory);
router.get("/inventory/transactions", requirePermission("reseller:inventory:view"), listTransactions);

// License purchase orders
router.post("/license-orders", requirePermission("reseller:license:purchase"), blockIfResellerPaymentRestricted, createLicenseOrder);
router.post("/license-orders/:id/verify", requirePermission("reseller:license:purchase"), verifyLicenseOrder);
router.get("/license-orders", requirePermission("reseller:license:purchase"), listLicenseOrders);
router.get("/license-orders/:id", requirePermission("reseller:license:purchase"), getLicenseOrder);

// Customers
router.get("/customers", requirePermission("reseller:customers:manage"), listCustomers);
router.get("/customers/:id", requirePermission("reseller:customers:manage"), getCustomer);
router.post("/customers", requirePermission("reseller:customers:manage"), createCustomer);

// Allocation lifecycle — release/suspend/reactivate/cancel stay open even
// when restricted (a partner can still manage down their own commitments
// and pay their way out — see blockIfResellerPaymentRestricted). Only
// actions that grow what the partner owes/promises are blocked.
router.get("/allocations", requirePermission("reseller:allocation:manage"), listAllocations);
router.post("/allocations", requirePermission("reseller:allocation:manage"), blockIfResellerPaymentRestricted, allocateLicenses);
router.post("/allocations/:id/release", requirePermission("reseller:allocation:manage"), releaseLicenses);
router.post("/allocations/:id/register", requirePermission("reseller:allocation:manage"), blockIfResellerPaymentRestricted, registerBundleDelivery);
router.post("/allocations/:id/activate", requirePermission("reseller:allocation:manage"), blockIfResellerPaymentRestricted, activateScreens);
router.post("/allocations/:id/suspend", requirePermission("reseller:allocation:manage"), suspendCustomer);
router.post("/allocations/:id/reactivate", requirePermission("reseller:allocation:manage"), reactivateCustomer);
router.post("/allocations/:id/cancel", requirePermission("reseller:allocation:manage"), cancelAllocation);

// Billing
router.get("/invoices", requirePermission("reseller:billing:view"), listInvoices);
router.get("/invoices/:id", requirePermission("reseller:billing:view"), getInvoice);
router.post("/invoices/:id/pay", requirePermission("reseller:billing:pay"), createInvoicePaymentOrder);
router.post("/invoices/:id/verify", requirePermission("reseller:billing:pay"), verifyInvoicePayment);

module.exports = router;
