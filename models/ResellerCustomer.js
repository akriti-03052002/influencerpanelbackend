const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   RESELLER CUSTOMER
   A Reseller partner's own end customer — pays the Reseller
   directly for a bundled screen+software product, never SPOTX.
   Deliberately separate from Customer.js (the Vendor's direct
   SPOTX-billed customer): different money flow, and no trial
   state exists here at all. A ResellerCustomer's subscription (to
   the Reseller, on the Reseller's own terms) begins the moment
   their screen is activated — see CustomerAllocation.activatedAt.
============================================================ */

const ResellerCustomerSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    businessDetails: {
      companyName: { type: String, required: true, trim: true },
      gstin: { type: String, default: "", trim: true, uppercase: true }
    },

    contactDetails: {
      name: { type: String, default: "" },
      email: { type: String, default: "", lowercase: true, trim: true },
      phone: { type: String, default: "" }
    },

    // No "trial" value in this enum — see file header.
    status: {
      type: String,
      enum: ["pending", "allocated", "pending_activation", "active", "suspended", "cancelled"],
      default: "pending"
    }
  },
  {
    timestamps: true
  }
);

ResellerCustomerSchema.index({ partnerId: 1, createdAt: -1 });

module.exports = model("ResellerCustomer", ResellerCustomerSchema);
