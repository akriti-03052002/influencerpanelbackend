const ResellerInvoice = require("../models/ResellerInvoice");
const logActivity = require("../utils/logActivity");

/* ============================================================
   RESELLER INVOICE PAYMENT FULFILLMENT
   Same atomic-claim discipline as resellerLicenseOrderFulfillment —
   shared by /verify and the webhook. Paying an invoice never
   touches ResellerInventory; the purchased-license count this
   invoice was billed on is already frozen in
   purchasedLicenseSnapshot regardless of payment outcome.
============================================================ */

const applyPaidInvoice = async (invoiceId, { razorpayPaymentId } = {}) => {
  const invoice = await ResellerInvoice.findOneAndUpdate(
    { _id: invoiceId, paymentStatus: { $in: ["pending", "overdue", "failed"] } },
    {
      $set: {
        paymentStatus: "paid",
        paidAt: new Date(),
        "razorpay.paymentId": razorpayPaymentId
      }
    },
    { new: true }
  );

  if (!invoice) return null;

  await logActivity({
    partnerId: invoice.partnerId,
    performedByType: "system",
    activityType: "reseller_payment_success",
    entityType: "ResellerInvoice",
    entityId: invoice._id,
    description: `Invoice ${invoice.invoiceNumber} paid — ${invoice.total}.`
  });

  return invoice;
};

const markInvoicePaymentFailed = async (invoiceId) => {
  const invoice = await ResellerInvoice.findOneAndUpdate(
    { _id: invoiceId, paymentStatus: { $ne: "paid" } },
    { $set: { paymentStatus: "failed" } },
    { new: true }
  );

  if (invoice) {
    await logActivity({
      partnerId: invoice.partnerId,
      performedByType: "system",
      activityType: "reseller_payment_failed",
      entityType: "ResellerInvoice",
      entityId: invoice._id,
      description: `Payment attempt failed for invoice ${invoice.invoiceNumber}.`
    });
  }

  return invoice;
};

module.exports = { applyPaidInvoice, markInvoicePaymentFailed };
