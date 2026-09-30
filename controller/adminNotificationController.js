const mongoose = require("mongoose");
const AdminNotification = require("../models/AdminNotification");
const { Partner, InfluencerContentSubmission } = require("../models/Index");

/* ============================================================
   ADMIN — NOTIFICATIONS ("what's new" bell)
============================================================ */

const listNotifications = async (req, res) => {
  const adminId = req.adminUser._id;
  const [notifications, unreadCount, pendingPosts, pendingAccounts] = await Promise.all([
    AdminNotification.find().sort({ createdAt: -1 }).limit(30).lean(),
    AdminNotification.countDocuments({ readBy: { $ne: adminId } }),
    // Live counts of what's still waiting, independent of read state — a
    // read notification doesn't mean the post was reviewed.
    InfluencerContentSubmission.countDocuments({ status: "pending" }),
    Partner.aggregate([
      { $match: { partnerType: "influencer" } },
      { $unwind: "$socialAccounts" },
      { $match: { "socialAccounts.reviewStatus": "pending" } },
      { $count: "n" }
    ]).then((rows) => rows[0]?.n || 0)
  ]);

  return res.json({
    success: true,
    data: {
      unreadCount,
      pending: { posts: pendingPosts, accounts: pendingAccounts },
      notifications: notifications.map(({ readBy, ...n }) => ({
        ...n,
        read: (readBy || []).some((id) => String(id) === String(adminId))
      }))
    }
  });
};

const markRead = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid notification." });
  }
  await AdminNotification.updateOne({ _id: req.params.id }, { $addToSet: { readBy: req.adminUser._id } });
  return res.json({ success: true });
};

const markAllRead = async (req, res) => {
  await AdminNotification.updateMany({ readBy: { $ne: req.adminUser._id } }, { $addToSet: { readBy: req.adminUser._id } });
  return res.json({ success: true });
};

module.exports = { listNotifications, markRead, markAllRead };
