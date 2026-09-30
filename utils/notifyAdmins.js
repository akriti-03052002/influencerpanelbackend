const AdminNotification = require("../models/AdminNotification");

/**
 * Records something an influencer did for the admin notification bell.
 * Never throws — a failed notification must not fail the influencer's
 * actual request (their upload/submission is already saved by then).
 */
const notifyAdmins = async ({ type, title, message = "", link = "", partner, entityId }) => {
  try {
    const name = partner?.legalEntity?.businessName || partner?.primaryContact?.name || "An influencer";
    await AdminNotification.create({
      type,
      title,
      message: message.replace("{name}", name),
      link,
      partnerId: partner?._id,
      entityId
    });
  } catch (error) {
    console.error("notifyAdmins failed:", error.message);
  }
};

const PLATFORM_LABEL = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
const platformLabel = (platform) => PLATFORM_LABEL[platform] || platform;
// "an Instagram", "a YouTube", "a Facebook".
const withArticle = (word) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

module.exports = notifyAdmins;
module.exports.platformLabel = platformLabel;
module.exports.withArticle = withArticle;
