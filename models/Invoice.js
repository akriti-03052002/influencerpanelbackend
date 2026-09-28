const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   INVOICE (minimal stub)
   Referenced by PartnerCommission.transaction.invoiceId. Not
   wired into a billing system yet — revenue is entered directly
   at payment time by the commission engine.
============================================================ */

const InvoiceSchema = new Schema(
  {
    customerId: {
      type: ObjectId,
      ref: "Customer",
      index: true
    },

    partnerId: {
      type: ObjectId,
      ref: "Partner",
      index: true
    },

    amount: {
      type: Number,
      default: 0
    },

    currency: {
      type: String,
      default: "INR"
    },

    status: {
      type: String,
      enum: ["draft", "issued", "paid", "void"],
      default: "draft"
    },

    issuedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

module.exports = model("Invoice", InvoiceSchema);
