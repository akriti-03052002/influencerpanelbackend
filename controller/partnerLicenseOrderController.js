const ScreenLicensePurchaseOrder = require("../models/ScreenLicensePurchaseOrder");
const { computeOrderPricing } = require("../services/resellerPricing");
const { applyPaidLicenseOrder } = require("../services/resellerLicenseOrderFulfillment");
const { createOrder, verifyPaymentSignature, fetchPaymentById } = require("../utils/razorpay");
const { getRazorpayCredentials } = require("../utils/paymentGatewayConfig");

/* ============================================================
   PARTNER — SCREEN LICENSE PURCHASE ORDERS (RESELLER)
   Quantity is the only thing ever trusted from the client — every
   price figure is computed server-side from ResellerPricingPlan
   (RESELLER_COMPLETE_PLAN.md B10). The Razorpay webhook is the
   authoritative fulfillment path; /verify here is only an
   immediate-UX shortcut that calls the exact same idempotent
   fulfillment function.
============================================================ */

let orderCounter = 0;
const nextOrderCode = async () => {
  const count = await ScreenLicensePurchaseOrder.countDocuments();
  orderCounter = Math.max(orderCounter, count) + 1;
  return `RP-LIC-${String(orderCounter).padStart(5, "0")}`;
};

const createLicenseOrder = async (req, res) => {
  try {
    const quantity = parseInt(req.body.quantity, 10);

    if (!quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: "Enter a valid quantity." });
    }

    const { plan, pricing } = await computeOrderPricing({ partnerId: req.partner._id, quantity });

    if (plan.minPurchaseQty && quantity < plan.minPurchaseQty) {
      return res.status(400).json({
        success: false,
        message: `Minimum purchase quantity is ${plan.minPurchaseQty} licenses.`
      });
    }

    const orderCode = await nextOrderCode();

    const purchaseOrder = await ScreenLicensePurchaseOrder.create({
      partnerId: req.partner._id,
      quantity,
      pricing,
      pricingPlanId: plan._id,
      status: "created",
      orderStatus: "pending",
      orderCode
    });

    const razorpayOrder = await createOrder({
      amountInRupees: pricing.totalAmount,
      receipt: `resellerlic_${purchaseOrder._id}`,
      notes: {
        purpose: "reseller_license_purchase",
        partnerId: String(req.partner._id),
        purchaseOrderId: String(purchaseOrder._id)
      }
    });

    purchaseOrder.razorpay.orderId = razorpayOrder.id;
    await purchaseOrder.save();

    const { keyId } = await getRazorpayCredentials();

    return res.status(201).json({
      success: true,
      data: {
        purchaseOrder,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId
      }
    });
  } catch (error) {
    console.error("createLicenseOrder error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong creating the purchase order." });
  }
};

// Immediate UX confirmation right after Razorpay Checkout succeeds in the
// browser — the webhook remains authoritative if this call never lands.
const verifyLicenseOrder = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const purchaseOrder = await ScreenLicensePurchaseOrder.findOne({ _id: req.params.id, partnerId: req.partner._id });
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    const isValidSignature = await verifyPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature
    });

    if (!isValidSignature) {
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }

    const payment = await fetchPaymentById(razorpayPaymentId);
    if (payment.status !== "captured" || payment.amount !== Math.round(purchaseOrder.pricing.totalAmount * 100)) {
      return res.status(400).json({ success: false, message: "Payment could not be verified against the order amount." });
    }

    await applyPaidLicenseOrder(purchaseOrder._id, { razorpayPaymentId, method: payment.method });

    const updated = await ScreenLicensePurchaseOrder.findById(purchaseOrder._id);
    return res.json({ success: true, message: "Purchase confirmed. Licenses added to your inventory.", data: updated });
  } catch (error) {
    console.error("verifyLicenseOrder error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong verifying the payment." });
  }
};

const listLicenseOrders = async (req, res) => {
  try {
    const orders = await ScreenLicensePurchaseOrder.find({ partnerId: req.partner._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: orders });
  } catch (error) {
    console.error("listLicenseOrders error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading purchase orders." });
  }
};

const getLicenseOrder = async (req, res) => {
  try {
    const order = await ScreenLicensePurchaseOrder.findOne({ _id: req.params.id, partnerId: req.partner._id });
    if (!order) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }
    return res.json({ success: true, data: order });
  } catch (error) {
    console.error("getLicenseOrder error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the purchase order." });
  }
};

module.exports = { createLicenseOrder, verifyLicenseOrder, listLicenseOrders, getLicenseOrder };
