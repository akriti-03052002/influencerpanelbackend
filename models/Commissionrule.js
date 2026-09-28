const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const { COMMISSION_TYPES, PARTNER_TYPES } = require("../config/constant");

/* ============================================================
   COMMISSION RULE
   Defines HOW a partner earns commission.
============================================================ */

const CommissionRuleSchema = new Schema(
  {
    // Which partner type this rule is for.
    partnerType: {
      type: String,
      enum: PARTNER_TYPES,
      index: true
    },

    // Optional recurring rule layered on top of a partner's base
    // commission (e.g. Affiliate's "10% for 6 months" add-on). Applied
    // at the admin's discretion, not automatically.
    isAddOn: {
      type: Boolean,
      default: false
    },

    name: {
      type: String,
      required: true
    },

    /* COMMISSION TYPE */
    commissionType: {
      type: String,
      enum: COMMISSION_TYPES,
      required: true
    },

    /* PERCENTAGE — Example: 15% */
    rate: {
      type: Number,
      default: 0
    },

    /* FIXED DEAL — Example: ₹10,000 per deal */
    fixedAmount: {
      type: Number,
      default: 0
    },

    /* PER SCREEN — Example: ₹500 per screen */
    perScreenAmount: {
      type: Number,
      default: 0
    },

    /* HYBRID */
    hybrid: {
      percentageRate: { type: Number, default: 0 },
      fixedAmount: { type: Number, default: 0 },
      perScreenAmount: { type: Number, default: 0 }
    },

    /* WHAT IS COMMISSION CALCULATED ON? */
    calculationBase: {
      type: String,
      enum: [
        "invoice_total",
        "subscription_value",
        "net_revenue",
        "first_payment",
        "screen_count"
      ],
      default: "net_revenue"
    },

    /* RECURRING COMMISSION */
    recurring: {
      enabled: { type: Boolean, default: false },
      durationType: {
        type: String,
        enum: ["months", "years", "lifetime", "none"],
        default: "none"
      },
      duration: { type: Number, default: 0 }
    },

    /* SETTLEMENT */
    minimumSettlementAmount: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    }
  },
  {
    timestamps: true
  }
);

module.exports = model("CommissionRule", CommissionRuleSchema);