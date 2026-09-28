const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const { RESELLER_BILLING_CYCLES } = require("../config/constant");

/* ============================================================
   RESELLER INVOICE
   SPOTX's bill to a Reseller partner — the reverse money direction
   from PartnerSettlement (which is SPOTX paying a partner). Billed
   strictly on purchasedLicenseSnapshot (total purchased licenses at
   generation time), never on active/allocated/registered counts —
   see services/resellerBilling.js. Immutable once generated;
   corrections are separate adjustment entries, not edits.
============================================================ */

const ResellerInvoiceSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    invoiceNumber: {
      type: String,
      required: true,
      unique: true
    },

    billingCycle: {
      type: String,
      enum: RESELLER_BILLING_CYCLES,
      required: true
    },

    billingPeriodStart: { type: Date, required: true },
    billingPeriodEnd: { type: Date, required: true },

    purchasedLicenseSnapshot: { type: Number, required: true },

    standardUnitPriceSnapshot: { type: Number, required: true },
    pricingModeSnapshot: { type: String, enum: ["discount_percent", "fixed_price"], required: true },
    wholesaleDiscountPercentSnapshot: { type: Number },
    fixedUnitPriceSnapshot: { type: Number },
    unitPriceSnapshot: { type: Number, required: true },

    // 1 monthly, 3 quarterly, 12 yearly.
    cycleMultiplier: { type: Number, required: true },

    subtotal: { type: Number, required: true },
    taxRatePercent: { type: Number, required: true },
    taxAmount: { type: Number, required: true },
    total: { type: Number, required: true },

    dueDate: { type: Date, required: true },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "overdue"],
      default: "pending",
      index: true
    },

    razorpay: {
      orderId: { type: String, index: true, sparse: true },
      paymentId: { type: String, index: true, sparse: true }
    },

    paidAt: { type: Date }
  },
  {
    timestamps: true
  }
);

// Prevents a duplicate invoice for the same partner/period if the
// billing job (manual today, scheduled later) runs twice.
ResellerInvoiceSchema.index({ partnerId: 1, billingPeriodStart: 1, billingPeriodEnd: 1 }, { unique: true });

module.exports = model("ResellerInvoice", ResellerInvoiceSchema);
