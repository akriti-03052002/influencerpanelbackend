const CustomerAllocation = require("../models/CustomerAllocation");
const ResellerCustomer = require("../models/ResellerCustomer");
const Screen = require("../models/Screen");
const resellerInventory = require("../services/resellerInventory");
const logActivity = require("../utils/logActivity");

/* ============================================================
   PARTNER — CUSTOMER ALLOCATION (RESELLER)
   Allocate / release / register / activate / suspend / reactivate
   / cancel — each a distinct, separately-billed-irrelevant state
   transition (RESELLER_COMPLETE_PLAN.md A4). Every inventory-count
   change routes through services/resellerInventory.js; this
   controller only ever updates CustomerAllocation/ResellerCustomer/
   Screen status alongside it.
============================================================ */

const findAllocation = async (req) => {
  return CustomerAllocation.findOne({ _id: req.params.id, partnerId: req.partner._id });
};

const listAllocations = async (req, res) => {
  try {
    const allocations = await CustomerAllocation.find({ partnerId: req.partner._id })
      .populate("customerId", "businessDetails.companyName status")
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: allocations });
  } catch (error) {
    console.error("listAllocations error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading allocations." });
  }
};

const allocateLicenses = async (req, res) => {
  try {
    const { customerId, screens } = req.body;
    const quantity = parseInt(screens, 10);

    if (!customerId || !quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: "customerId and a valid screens quantity are required." });
    }

    const customer = await ResellerCustomer.findOne({ _id: customerId, partnerId: req.partner._id });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    await resellerInventory.allocate({
      partnerId: req.partner._id,
      customerId,
      quantity,
      createdBy: req.partnerUser._id
    });

    let allocation = await CustomerAllocation.findOne({ partnerId: req.partner._id, customerId, status: { $ne: "cancelled" } });

    if (allocation) {
      allocation.allocatedLicenses += quantity;
    } else {
      allocation = new CustomerAllocation({
        partnerId: req.partner._id,
        customerId,
        allocatedLicenses: quantity,
        status: "allocated"
      });
    }
    await allocation.save();

    // Backfill allocationId on the transaction just written, and keep the
    // customer status in step for the dashboard summary.
    if (customer.status === "pending") {
      customer.status = "allocated";
      await customer.save();
    }

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "license_allocated",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `${quantity} licenses allocated to ${customer.businessDetails.companyName}.`,
      req
    });

    return res.status(201).json({ success: true, message: "Licenses allocated.", data: allocation });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("allocateLicenses error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong allocating licenses." });
  }
};

const releaseLicenses = async (req, res) => {
  try {
    const allocation = await findAllocation(req);
    if (!allocation) return res.status(404).json({ success: false, message: "Allocation not found." });

    const quantity = parseInt(req.body.screens, 10);
    if (!quantity || quantity < 1 || quantity > allocation.allocatedLicenses) {
      return res.status(400).json({ success: false, message: "Enter a valid number of screens to release." });
    }

    await resellerInventory.release({
      partnerId: req.partner._id,
      customerId: allocation.customerId,
      allocationId: allocation._id,
      quantity,
      createdBy: req.partnerUser._id
    });

    allocation.allocatedLicenses -= quantity;
    allocation.registeredScreens = Math.min(allocation.registeredScreens, allocation.allocatedLicenses);
    allocation.activeScreens = Math.min(allocation.activeScreens, allocation.registeredScreens);
    allocation.suspendedScreens = Math.min(allocation.suspendedScreens, allocation.registeredScreens);
    await allocation.save();

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "license_released",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `${quantity} licenses released back to inventory.`,
      req
    });

    return res.json({ success: true, message: "Licenses released.", data: allocation });
  } catch (error) {
    console.error("releaseLicenses error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong releasing licenses." });
  }
};

// Records that the Reseller has delivered `screens` screen+software
// bundles (physical hardware sourced by the Reseller — not tracked here
// beyond a reference flag, see Screen.soldAsResellerBundle) to the
// customer, tied to their existing allocation.
const registerBundleDelivery = async (req, res) => {
  try {
    const allocation = await findAllocation(req);
    if (!allocation) return res.status(404).json({ success: false, message: "Allocation not found." });

    const quantity = parseInt(req.body.screens, 10);
    if (!quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: "Enter a valid number of screens." });
    }

    await resellerInventory.registerScreens({
      partnerId: req.partner._id,
      customerId: allocation.customerId,
      allocationId: allocation._id,
      quantity,
      createdBy: req.partnerUser._id
    });

    allocation.registeredScreens += quantity;
    if (allocation.status === "allocated") allocation.status = "pending_activation";
    await allocation.save();

    const screens = await Screen.insertMany(
      Array.from({ length: quantity }, () => ({
        customerId: allocation.customerId,
        name: "Reseller screen",
        allocationId: allocation._id,
        licenseStatus: "registered",
        soldAsResellerBundle: true,
        registeredAt: new Date()
      }))
    );

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "screen_registered",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `${quantity} screen+software bundles delivered and registered.`,
      req
    });

    return res.status(201).json({ success: true, message: "Bundle delivery recorded.", data: { allocation, screens } });
  } catch (error) {
    console.error("registerBundleDelivery error:", error);
    return res.status(400).json({ success: false, message: error.message || "Something went wrong registering the delivery." });
  }
};

const activateScreens = async (req, res) => {
  try {
    const allocation = await findAllocation(req);
    if (!allocation) return res.status(404).json({ success: false, message: "Allocation not found." });

    const quantity = parseInt(req.body.screens, 10);
    if (!quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: "Enter a valid number of screens to activate." });
    }

    await resellerInventory.activateScreens({
      partnerId: req.partner._id,
      customerId: allocation.customerId,
      allocationId: allocation._id,
      quantity,
      createdBy: req.partnerUser._id
    });

    allocation.activeScreens += quantity;
    const now = new Date();
    if (!allocation.activatedAt) allocation.activatedAt = now;
    allocation.status = "active";
    await allocation.save();

    await Screen.updateMany(
      { allocationId: allocation._id, licenseStatus: "registered" },
      { $set: { licenseStatus: "active", activatedAt: now } },
      { limit: quantity }
    );

    const customer = await ResellerCustomer.findByIdAndUpdate(allocation.customerId, { status: "active" });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "screen_activated",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `${quantity} screens activated for ${customer?.businessDetails?.companyName || "customer"} — subscription starts now, no trial.`,
      req
    });

    return res.json({ success: true, message: "Screens activated.", data: allocation });
  } catch (error) {
    console.error("activateScreens error:", error);
    return res.status(400).json({ success: false, message: error.message || "Something went wrong activating screens." });
  }
};

// Reseller-discretionary — intended for when their own customer stops
// paying THEM (RESELLER_COMPLETE_PLAN.md B15 item 2). SPOTX has no
// visibility into or approval role over this action.
const suspendCustomer = async (req, res) => {
  try {
    const allocation = await findAllocation(req);
    if (!allocation) return res.status(404).json({ success: false, message: "Allocation not found." });

    const quantity = req.body.screens ? parseInt(req.body.screens, 10) : allocation.activeScreens;

    await resellerInventory.suspendScreens({
      partnerId: req.partner._id,
      customerId: allocation.customerId,
      allocationId: allocation._id,
      quantity,
      createdBy: req.partnerUser._id
    });

    allocation.activeScreens -= Math.min(quantity, allocation.activeScreens);
    allocation.suspendedScreens += quantity;
    allocation.status = "suspended";
    await allocation.save();

    await Screen.updateMany(
      { allocationId: allocation._id, licenseStatus: "active" },
      { $set: { licenseStatus: "suspended", suspendedAt: new Date() } },
      { limit: quantity }
    );
    await ResellerCustomer.findByIdAndUpdate(allocation.customerId, { status: "suspended" });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "screen_suspended",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `Customer suspended by partner — ${quantity} screens paused. License remains reserved and billed.`,
      req
    });

    return res.json({ success: true, message: "Customer suspended.", data: allocation });
  } catch (error) {
    console.error("suspendCustomer error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong suspending the customer." });
  }
};

const reactivateCustomer = async (req, res) => {
  try {
    const allocation = await findAllocation(req);
    if (!allocation) return res.status(404).json({ success: false, message: "Allocation not found." });

    const quantity = req.body.screens ? parseInt(req.body.screens, 10) : allocation.suspendedScreens;

    await resellerInventory.reactivateScreens({
      partnerId: req.partner._id,
      customerId: allocation.customerId,
      allocationId: allocation._id,
      quantity,
      createdBy: req.partnerUser._id
    });

    allocation.suspendedScreens -= Math.min(quantity, allocation.suspendedScreens);
    allocation.activeScreens += quantity;
    allocation.status = "active";
    await allocation.save();

    await Screen.updateMany(
      { allocationId: allocation._id, licenseStatus: "suspended" },
      { $set: { licenseStatus: "active", suspendedAt: null } },
      { limit: quantity }
    );
    await ResellerCustomer.findByIdAndUpdate(allocation.customerId, { status: "active" });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "screen_reactivated",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `${quantity} screens reactivated.`,
      req
    });

    return res.json({ success: true, message: "Customer reactivated.", data: allocation });
  } catch (error) {
    console.error("reactivateCustomer error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong reactivating the customer." });
  }
};

const cancelAllocation = async (req, res) => {
  try {
    const allocation = await findAllocation(req);
    if (!allocation) return res.status(404).json({ success: false, message: "Allocation not found." });

    const quantity = allocation.allocatedLicenses;

    await resellerInventory.release({
      partnerId: req.partner._id,
      customerId: allocation.customerId,
      allocationId: allocation._id,
      quantity,
      type: "cancellation",
      createdBy: req.partnerUser._id
    });

    allocation.allocatedLicenses = 0;
    allocation.registeredScreens = 0;
    allocation.activeScreens = 0;
    allocation.suspendedScreens = 0;
    allocation.status = "cancelled";
    allocation.releasedAt = new Date();
    await allocation.save();

    await Screen.updateMany(
      { allocationId: allocation._id, licenseStatus: { $ne: "cancelled" } },
      { $set: { licenseStatus: "cancelled", cancelledAt: new Date() } }
    );
    await ResellerCustomer.findByIdAndUpdate(allocation.customerId, { status: "cancelled" });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "license_cancelled",
      entityType: "CustomerAllocation",
      entityId: allocation._id,
      description: `Allocation cancelled — ${quantity} licenses returned to inventory. Purchased licenses unaffected.`,
      req
    });

    return res.json({ success: true, message: "Allocation cancelled.", data: allocation });
  } catch (error) {
    console.error("cancelAllocation error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong cancelling the allocation." });
  }
};

module.exports = {
  listAllocations,
  allocateLicenses,
  releaseLicenses,
  registerBundleDelivery,
  activateScreens,
  suspendCustomer,
  reactivateCustomer,
  cancelAllocation
};
