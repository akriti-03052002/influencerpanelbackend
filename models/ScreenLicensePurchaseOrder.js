const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   SCREEN LICENSE PURCHASE ORDER
   One immutable row per bulk license purchase by a Reseller
   partner. Mirrors CustomerPayment's discipline: server-computed
   amount snapshot, never trust the frontend, status flips from
   "created" to "paid"/"failed" only via the Razorpay webhook (see
   razorpayWebhookController's "reseller_license_purchase" branch)
   or the browser's own /verify call as a UX shortcut — the webhook
   remains authoritative either way.

   Never edited after creation. Every additional purchase is a new
   row — the original order is never modified to add more licenses.
============================================================ */

const ScreenLicensePurchaseOrderSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    quantity: {
      type: Number,
      required: true,
      min: 1
    },

    // Snapshotted from ResellerPricingPlan at order-creation time — a
    // later change to the partner's rate/mode never touches this record.
    pricing: {
      standardUnitPrice: { type: Number, required: true },
      pricingMode: { type: String, enum: ["discount_percent", "fixed_price"], required: true },
      wholesaleDiscountPercent: { type: Number },
      fixedUnitPrice: { type: Number },
      unitPrice: { type: Number, required: true },
      subtotal: { type: Number, required: true },
      taxRatePercent: { type: Number, required: true },
      taxAmount: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      totalAmount: { type: Number, required: true },
      currency: { type: String, default: "INR" }
    },

    pricingPlanId: {
      type: ObjectId,
      ref: "ResellerPricingPlan"
    },

    razorpay: {
      orderId: { type: String, index: true, unique: true, sparse: true },
      paymentId: { type: String, index: true, sparse: true },
      signature: { type: String, select: false },
      method: { type: String, default: "" },
      failureCode: { type: String, default: "" },
      failureReason: { type: String, default: "" }
    },

    status: {
      type: String,
      enum: ["created", "paid", "failed"],
      default: "created",
      index: true
    },

    orderStatus: {
      type: String,
      enum: ["pending", "completed", "payment_failed"],
      default: "pending"
    },

    // Atomic claim guard — mirrors CustomerPayment.commissionGenerated —
    // stops a retried webhook from adding purchased licenses twice.
    licensesApplied: {
      type: Boolean,
      default: false
    },

    orderCode: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = model("ScreenLicensePurchaseOrder", ScreenLicensePurchaseOrderSchema);
