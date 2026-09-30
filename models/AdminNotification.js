const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   ADMIN NOTIFICATION
   Something an influencer did that an admin should look at (new
   sign-up, KYC upload, bank details, social account, post/reel,
   invoice). Shared by every admin; each admin's read state is kept
   in readBy so one admin reading it doesn't clear it for the others.
============================================================ */

const AdminNotificationSchema = new Schema(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    // Admin panel path to open, e.g. "/admin/partners/<id>".
    link: { type: String, default: "" },
    partnerId: { type: ObjectId, ref: "Partner", index: true },
    readBy: [{ type: ObjectId, ref: "User" }]
  },
  { timestamps: true }
);

AdminNotificationSchema.index({ createdAt: -1 });

module.exports = model("AdminNotification", AdminNotificationSchema);
