const mongoose = require("mongoose");
const AdminNotification = require("../models/AdminNotification");

/* ============================================================
   ADMIN — NOTIFICATIONS ("what's new" bell)
============================================================ */

const listNotifications = async (req, res) => {
  const adminId = req.adminUser._id;
  const [notifications, unreadCount] = await Promise.all([
    AdminNotification.find().sort({ createdAt: -1 }).limit(30).lean(),
    AdminNotification.countDocuments({ readBy: { $ne: adminId } })
  ]);

  return res.json({
    success: true,
    data: {
      unreadCount,
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
