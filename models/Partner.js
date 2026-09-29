const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const { PARTNER_TYPES, PARTNER_STATUS, VERIFICATION_STATUS } = require("../config/constant");

/* ============================================================
   PARTNER
============================================================ */

const PartnerSchema = new Schema(
  {
    /* BASIC IDENTITY */
    partnerCode: {
      type: String,
      unique: true,
      index: true,
      uppercase: true
    },

    partnerType: {
      type: String,
      enum: PARTNER_TYPES,
      required: true
    },

    /* BUSINESS INFORMATION */
    legalEntity: {
      // Not required at registration anymore — only phone/email/type/password
      // are collected up front (see partnerAuthController.registerPartner and
      // adminPartnerController.createPartner). The partner fills this in from
      // their Profile page afterward; until then dashboards/controllers treat
      // a blank businessName as "profile incomplete".
      businessName: {
        type: String,
        default: "",
        trim: true
      },
      legalName: {
        type: String,
        default: ""
      },
      entityType: {
        type: String,
        enum: [
          "proprietorship",
          "partnership",
          "llp",
          "private_limited",
          "public_limited",
          "individual",
          "other"
        ]
      },
      website: {
        type: String,
        default: ""
      },
      industry: {
        type: String,
        default: ""
      }
    },

    /* PRIMARY CONTACT */
    primaryContact: {
      name: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
      },
      phone: {
        type: String,
        default: ""
      },
      designation: {
        type: String,
        default: ""
      }
    },

    /* ADDRESS */
    address: {
      country: { type: String, default: "India" },
      state: { type: String, default: "" },
      city: { type: String, default: "" },
      addressLine1: { type: String, default: "" },
      addressLine2: { type: String, default: "" },
      pincode: { type: String, default: "" }
    },

    socialAccounts: [{
      platform: {
        type: String,
        enum: ["instagram", "youtube", "facebook"],
        required: true
      },
      accountId: { type: String, required: true, trim: true },
      username: { type: String, default: "", trim: true },
      followers: { type: Number, min: 0, default: 0 },
      connected: { type: Boolean, default: false },
      source: { type: String, enum: ["manual", "oauth"], default: "manual" },
      reviewStatus: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
      submittedAt: { type: Date, default: Date.now },
      reviewedBy: { type: ObjectId, ref: "User" },
      reviewedAt: { type: Date },
      rejectionReason: { type: String, default: "" },
      // What SPOTX pays for content from THIS account — each platform has its
      // own reach, so each gets its own price. 0 = that type isn't paid.
      paymentRates: {
        post: { type: Number, min: 0, default: 0 },
        reel: { type: Number, min: 0, default: 0 },
        currency: { type: String, default: "INR", uppercase: true, trim: true },
        updatedBy: { type: ObjectId, ref: "User" },
        updatedAt: { type: Date }
      },
      lastSyncedAt: { type: Date },
      // Why the last automatic refresh failed (e.g. the influencer revoked
      // access) — cleared on the next successful sync.
      syncError: { type: String, default: "" },
      accessTokenEncrypted: { type: String, select: false },
      // YouTube only: Google's long-lived key for minting new access tokens.
      refreshTokenEncrypted: { type: String, select: false },
      // When the stored token stops working; unset for tokens that don't
      // expire (Facebook Page tokens).
      tokenExpiresAt: { type: Date }
    }],

    /* VERIFICATION STATUS */
    verification: {
      overallStatus: {
        type: String,
        enum: VERIFICATION_STATUS,
        default: "not_submitted"
      },
      verifiedBy: {
        type: ObjectId,
        ref: "User"
      },
      verifiedAt: {
        type: Date
      },
      rejectionReason: {
        type: String,
        default: ""
      }
    },

    /* DASHBOARD AGGREGATES */
    stats: {
      referredScreens: { type: Number, default: 0 },
      activeScreens: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      totalCommission: { type: Number, default: 0 },
      pendingCommission: { type: Number, default: 0 },
      approvedCommission: { type: Number, default: 0 },
      paidCommission: { type: Number, default: 0 }
    },

    /* SPOTX INTERNAL OWNER */
    owner: {
      salesUserId: {
        type: ObjectId,
        ref: "User"
      }
    },

    /* STATUS */
    status: {
      type: String,
      enum: PARTNER_STATUS,
      default: "draft",
      index: true
    }
  },
  {
    timestamps: true
  }
);

PartnerSchema.index({ partnerType: 1, status: 1 });

module.exports = model("Partner", PartnerSchema);