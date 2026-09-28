const express = require("express");
const router = express.Router();

const {
  createPartner, listPartners, getPartner, updatePartnerStatus,
  assignCustomCommission, getCommissionAssignment
} = require("../controller/adminPartnerController");
const { uploadDocumentForPartner } = require("../controller/adminDocumentController");
const requireAdminRole = require("../middleware/requireAdminRole");
const { uploadDocumentAsAdmin } = require("../middleware/upload");

router.post("/", requireAdminRole("kyc_reviewer"), createPartner);
router.get("/", requireAdminRole("kyc_reviewer", "finance"), listPartners);
router.get("/:id", requireAdminRole("kyc_reviewer", "finance"), getPartner);
router.patch("/:id/status", requireAdminRole("kyc_reviewer"), updatePartnerStatus);
router.get("/:id/commission-assignment", requireAdminRole("kyc_reviewer", "finance"), getCommissionAssignment);
router.post("/:id/commission-assignment", requireAdminRole("kyc_reviewer"), assignCustomCommission);
router.post("/:id/documents", requireAdminRole("kyc_reviewer"), uploadDocumentAsAdmin.single("file"), uploadDocumentForPartner);

module.exports = router;
