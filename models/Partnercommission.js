const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const { COMMISSION_TYPES } = require("../config/constant");

/* ============================================================
   COMMISSION LEDGER
   Every commission earned should become an immutable-ish
   financial record.
============================================================ */

const PartnerCommissionSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    // The approved post/reel this payment is for. Unique so approving can
    // never create two payments for the same piece of content.
    submissionId: {
      type: ObjectId,
      ref: "InfluencerContentSubmission",
      unique: true,
      sparse: true
    },

    // Human-readable line shown in settlements, e.g. "Instagram reel · @handle".
    description: { type: String, default: "" },

    /* TRANSACTION */
    transaction: {
      invoiceNumber: { type: String, default: "" },
      revenue: { type: Number, default: 0 },
      screenCount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" }
    },

    /* COMMISSION CALCULATION */
    calculation: {
      commissionType: {
        type: String,
        enum: COMMISSION_TYPES
      },
      rate: { type: Number, default: 0 },
      fixedAmount: { type: Number, default: 0 },
      grossCommission: { type: Number, required: true },
      deductions: { type: Number, default: 0 },
      netCommission: { type: Number, required: true }
    },

    /* RECURRING COMMISSION */
    recurring: {
      isRecurring: { type: Boolean, default: false },
      cycleNumber: { type: Number, default: 1 },
      parentCommissionId: { type: ObjectId, ref: "PartnerCommission" },
      nextCommissionDate: Date,
      expiresAt: Date
    },

    /* SETTLEMENT STATUS */
    settlement: {
      eligibleAt: Date,
      settlementId: { type: ObjectId, ref: "PartnerSettlement" },
      status: {
        type: String,
        enum: ["pending", "approved", "eligible", "settled", "cancelled"],
        default: "pending"
      }
    }
  },
  {
    timestamps: true
  }
);

PartnerCommissionSchema.index({
  partnerId: 1,
  "settlement.status": 1,
  createdAt: -1
});

module.exports = model("PartnerCommission", PartnerCommissionSchema);