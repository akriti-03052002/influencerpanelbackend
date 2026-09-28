const ResellerCustomer = require("../models/ResellerCustomer");
const logActivity = require("../utils/logActivity");

/* ============================================================
   PARTNER — RESELLER CUSTOMERS
   A Reseller's own end customers — distinct from Customer.js
   (Vendor's direct SPOTX-billed customer). No resale-price field
   exists anywhere on this or the allocation model — what the
   Reseller charges its customer is out of scope for this platform
   entirely (RESELLER_COMPLETE_PLAN.md B13).
============================================================ */

const listCustomers = async (req, res) => {
  try {
    const customers = await ResellerCustomer.find({ partnerId: req.partner._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: customers });
  } catch (error) {
    console.error("listCustomers (reseller) error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading customers." });
  }
};

const getCustomer = async (req, res) => {
  try {
    const customer = await ResellerCustomer.findOne({ _id: req.params.id, partnerId: req.partner._id });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }
    return res.json({ success: true, data: customer });
  } catch (error) {
    console.error("getCustomer (reseller) error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the customer." });
  }
};

const createCustomer = async (req, res) => {
  try {
    const { companyName, gstin, name, email, phone } = req.body;

    if (!companyName) {
      return res.status(400).json({ success: false, message: "Company name is required." });
    }

    const customer = await ResellerCustomer.create({
      partnerId: req.partner._id,
      businessDetails: { companyName, gstin: gstin || "" },
      contactDetails: { name: name || "", email: email || "", phone: phone || "" },
      status: "pending"
    });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "reseller_customer_created",
      entityType: "ResellerCustomer",
      entityId: customer._id,
      description: `${req.partnerUser.name} added ${companyName} as a customer.`,
      req
    });

    return res.status(201).json({ success: true, message: "Customer added.", data: customer });
  } catch (error) {
    console.error("createCustomer (reseller) error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong adding the customer." });
  }
};

module.exports = { listCustomers, getCustomer, createCustomer };
