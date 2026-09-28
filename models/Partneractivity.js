const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   PARTNER ACTIVITY / AUDIT LOG
   Especially important for: bank details access, KYC verification,
   commission approval, settlement approval
============================================================ */

const PartnerActivitySchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    performedBy: {
      type: {
        type: String,
        enum: ["partner_user", "spotx_user", "system"],
        required: true
      },
      userId: {
        type: ObjectId
      }
    },

    activityType: {
      type: String,
      enum: [
        "login",

        "commission_created",
        "commission_approved",
        "commission_assigned",

        "settlement_created",
        "settlement_paid",
        "settlement_held",
        "settlement_released",
        "settlement_failed",
        "settlement_retried",

        "document_uploaded",
        "document_verified",

        "bank_details_accessed",

        "status_changed",

        "note",

        // Reseller-only activity types.
        "license_purchased",
        "license_allocated",
        "license_released",
        "license_adjusted",
        "screen_registered",
        "screen_activated",
        "screen_suspended",
        "screen_reactivated",
        "license_cancelled",
        "reseller_customer_created",
        "reseller_customer_cancelled",
        "reseller_invoice_generated",
        "reseller_payment_success",
        "reseller_payment_failed",
        "reseller_agreement_expiring"
      ],
      required: true
    },

    entity: {
      type: { type: String },
      entityId: { type: ObjectId }
    },

    description: {
      type: String,
      default: ""
    },

    metadata: {
      type: Schema.Types.Mixed
    },

    ipAddress: {
      type: String
    },

    userAgent: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

PartnerActivitySchema.index({ partnerId: 1, createdAt: -1 });

module.exports = model("PartnerActivity", PartnerActivitySchema);