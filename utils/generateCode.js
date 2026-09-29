const crypto = require("crypto");

const randomSegment = (length) =>
  crypto.randomBytes(length).toString("hex").toUpperCase().slice(0, length);

const generatePartnerCode = () => "PTN-" + Date.now().toString().slice(-8);

const generateSettlementNumber = () => "STL-" + Date.now().toString().slice(-8) + "-" + randomSegment(3);

module.exports = {
  generatePartnerCode,
  generateSettlementNumber
};
