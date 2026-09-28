const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const { RESELLER_BILLING_CYCLES } = require("../config/constant");

/* ============================================================
   RESELLER BILLING CONFIG
   One record per Reseller partner — how and when SPOTX bills them,
   set by superadmin from their signed agreement. billingMetric is
   fixed to "purchased" — SPOTX always bills on total purchased
   licenses, never on active/allocated/registered usage
   (RESELLER_COMPLETE_PLAN.md correction #1). billingCycle is
   explicitly NOT compulsorily monthly.

   Defaults below follow standard recurring-billing/dunning
   practice (RESELLER_COMPLETE_PLAN.md B15 item 6):
     Net 7 due date, a reminder 3 days before due, retries at
     day 1/3/5 past due, then 3 grace days before restriction —
     8 days total from due date to restriction. Configurable per
     partner, not hard-coded as a system-wide rule.
============================================================ */

const ResellerBillingConfigSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      unique: true,
      index: true
    },

    // Fixed — never anything else. Kept as an explicit field (rather than
    // just an implicit constant) so every downstream billing read makes
    // the invariant visible rather than assumed.
    billingMetric: {
      type: String,
      enum: ["purchased"],
      default: "purchased",
      required: true
    },

    billingCycle: {
      type: String,
      enum: RESELLER_BILLING_CYCLES,
      required: true,
      default: "monthly"
    },

    billingStartRule: {
      type: String,
      enum: ["on_first_purchase", "fixed_day_of_month"],
      default: "on_first_purchase"
    },

    // Applies only to licenses purchased mid-cycle.
    prorationRule: {
      type: String,
      enum: ["none", "daily_proration"],
      default: "daily_proration"
    },

    dueDays: { type: Number, default: 7 },

    dueDateReminderDaysBefore: { type: Number, default: 3 },

    lowInventoryNotificationThresholdPercent: { type: Number, default: 10 },

    retrySchedule: [
      {
        dayOffset: { type: Number, required: true }
      }
    ],

    gracePeriodDays: { type: Number, default: 3 },

    // Triggers an admin-facing alert (RESELLER_AGREEMENT_EXPIRING audit
    // entry) as this date approaches — does not itself suspend or change
    // the partner. A SPOTX admin contacts the Reseller and applies the
    // outcome (renew/upgrade/suspend) manually via existing partner-
    // status controls (RESELLER_COMPLETE_PLAN.md B15 item 3).
    agreementEndDate: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

ResellerBillingConfigSchema.path("retrySchedule").default(() => [
  { dayOffset: 1 },
  { dayOffset: 3 },
  { dayOffset: 5 }
]);

module.exports = model("ResellerBillingConfig", ResellerBillingConfigSchema);
