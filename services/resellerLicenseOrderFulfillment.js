const ScreenLicensePurchaseOrder = require("../models/ScreenLicensePurchaseOrder");
const resellerInventory = require("./resellerInventory");
const logActivity = require("../utils/logActivity");

/* ============================================================
   RESELLER LICENSE ORDER FULFILLMENT
   Shared by both the browser's own /verify call (immediate UX
   confirmation) and the Razorpay webhook (authoritative safety
   net) — same "verify twice, apply once" discipline as
   services/customerPaymentFulfillment.js. The atomic
   status:"created"->"paid" claim below is what stops a retried
   webhook (or a race between webhook and /verify) from adding
   purchased licenses twice.
============================================================ */

const applyPaidLicenseOrder = async (orderId, { razorpayPaymentId, method } = {}) => {
  // Atomic claim — only the caller that flips status first gets to apply
  // the licenses; a second caller (retried webhook, or webhook racing
  // the browser's /verify) finds no matching document and no-ops.
  const order = await ScreenLicensePurchaseOrder.findOneAndUpdate(
    { _id: orderId, status: "created" },
    {
      $set: {
        status: "paid",
        orderStatus: "completed",
        "razorpay.paymentId": razorpayPaymentId,
        "razorpay.method": method || ""
      }
    },
    { new: true }
  );

  if (!order) {
    // Already applied (or never existed) — safe no-op, mirrors
    // CustomerPayment's commissionGenerated guard.
    return null;
  }

  await resellerInventory.applyPurchase({
    partnerId: order.partnerId,
    quantity: order.quantity,
    purchaseOrderId: order._id
  });

  order.licensesApplied = true;
  await order.save();

  await logActivity({
    partnerId: order.partnerId,
    performedByType: "system",
    activityType: "license_purchased",
    entityType: "ScreenLicensePurchaseOrder",
    entityId: order._id,
    description: `${order.quantity} screen licenses purchased (order ${order.orderCode || order._id}).`
  });

  return order;
};

const markLicenseOrderFailed = async (orderId, { failureCode, failureReason } = {}) => {
  return ScreenLicensePurchaseOrder.findOneAndUpdate(
    { _id: orderId, status: "created" },
    {
      $set: {
        status: "failed",
        orderStatus: "payment_failed",
        "razorpay.failureCode": failureCode || "",
        "razorpay.failureReason": failureReason || "Payment failed."
      }
    },
    { new: true }
  );
};

module.exports = { applyPaidLicenseOrder, markLicenseOrderFailed };
