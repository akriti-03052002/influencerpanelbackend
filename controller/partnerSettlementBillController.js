const { PartnerSettlement } = require("../models/Index");
const PartnerSettlementBill = require("../models/PartnerSettlementBill");
const { GST_RATE_PERCENT } = require("../config/constant");
const logActivity = require("../utils/logActivity");
const { storeUploadedFile } = require("../utils/fileStorage");
const notifyAdmins = require("../utils/notifyAdmins");
const { recordSettlementHistory } = require("../utils/settlementHistory");

/* ============================================================
   PARTNER — SETTLEMENT BILL SUBMISSION
   A GST-registered partner submits one bill per settlement batch (see
   utils/settlementHold.checkBillRequirement for who this applies to and
   what blocks payout without one). The bill amount is always
   server-computed off the settlement's own gross commission + the shared
   GST_RATE_PERCENT constant — never taken from the partner's input, same
   "never trust the client for money" rule as everywhere else Razorpay
   touches this app.
============================================================ */

const round2 = (n) => Math.round(n * 100) / 100;

const submitBill = async (req, res) => {
  try {
    const { billNumber, billDate } = req.body;
    // GSTIN only for GST-registered influencers; most individuals don't have one.
    const gstin = String(req.body.gstin || "").trim().toUpperCase();

    if (!billNumber || !billDate) {
      return res.status(400).json({ success: false, message: "Invoice number and invoice date are required." });
    }
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      return res.status(400).json({ success: false, message: "That GSTIN doesn't look right — it should be 15 characters, e.g. 29ABCDE1234F1Z5. Leave it empty if you aren't GST-registered." });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "A bill file is required." });
    }

    const settlement = await PartnerSettlement.findOne({ _id: req.params.id, partnerId: req.partner._id });

    if (!settlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    if (["paid", "cancelled"].includes(settlement.status)) {
      return res.status(400).json({ success: false, message: `A bill can't be submitted for a settlement that's already ${settlement.status}.` });
    }

    const existing = await PartnerSettlementBill.findOne({ settlementId: settlement._id });
    if (existing && existing.status !== "rejected") {
      return res.status(400).json({ success: false, message: `A bill has already been ${existing.status} for this settlement.` });
    }

    const commission = settlement.amount.gross;
    const gstAmount = gstin ? round2((commission * GST_RATE_PERCENT) / 100) : 0;
    const totalBillAmount = round2(commission + gstAmount);

    const billData = {
      partnerId: req.partner._id,
      settlementId: settlement._id,
      billNumber,
      billDate,
      gstin,
      amount: { commission, gstRatePercent: gstin ? GST_RATE_PERCENT : 0, gstAmount, totalBillAmount, currency: settlement.amount.currency },
      file: await storeUploadedFile(req.file, `partners/${req.partner._id}/bills`),
      status: "submitted",
      verifiedBy: undefined,
      verifiedAt: undefined,
      rejectionReason: ""
    };

    // Resubmitting after a rejection replaces the prior bill (unique index
    // on settlementId) rather than erroring or piling up duplicates.
    const bill = existing
      ? await PartnerSettlementBill.findOneAndUpdate({ _id: existing._id }, { $set: billData }, { returnDocument: "after" })
      : await PartnerSettlementBill.create(billData);

    await recordSettlementHistory(settlement, {
      action: "bill_submitted",
      amount: { net: 0, gst: gstAmount, total: totalBillAmount, currency: settlement.amount.currency },
      meta: { billNumber, gstin },
      byPartnerUser: req.partnerUser._id,
      req
    });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      // "document_uploaded" — the existing PartnerActivity.activityType enum
      // (a model, can't be extended) has no bill-specific value; this is the
      // closest accurate fit and is what document uploads elsewhere use too.
      activityType: "document_uploaded",
      entityType: "PartnerSettlement",
      entityId: settlement._id,
      description: `${req.partnerUser.name} submitted a bill (${billNumber}) for settlement ${settlement.settlementNumber}.`,
      req
    });

    await notifyAdmins({
      type: "bill_submitted",
      title: "Invoice to verify",
      message: `{name} sent invoice ${billNumber} for settlement ${settlement.settlementNumber} (₹${totalBillAmount.toLocaleString("en-IN")}).`,
      link: "/admin/settlements",
      partner: req.partner
    });

    return res.status(201).json({ success: true, message: "Invoice sent — SPOTX will verify it and then release your payment.", data: bill });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: "A bill already exists for this settlement." });
    }
    console.error("submitBill error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong submitting the bill." });
  }
};

const getBillForSettlement = async (req, res) => {
  const settlement = await PartnerSettlement.findOne({ _id: req.params.id, partnerId: req.partner._id });
  if (!settlement) {
    return res.status(404).json({ success: false, message: "Settlement not found." });
  }

  const bill = await PartnerSettlementBill.findOne({ settlementId: settlement._id });
  return res.json({ success: true, data: bill || null });
};

module.exports = { submitBill, getBillForSettlement };
