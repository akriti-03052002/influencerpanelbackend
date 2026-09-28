const express = require("express");
const router = express.Router();
const { startConnection } = require("../controller/partnerSocialController");

router.get("/:platform/start", startConnection);

module.exports = router;
