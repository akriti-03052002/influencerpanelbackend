const ResellerInvoice = require("../models/ResellerInvoice");
const { applyPaidInvoice } = require("../services/resellerInvoicePaymentFulfillment");
const { createOrder, verifyPaymentSignature, fetchPaymentById } = require("../utils/razorpay");
const { getRazorpayCredentials } = require("../utils/paymentGatewayConfig");

/* ============================================================
   PARTNER — RESELLER BILLING
   Lists ResellerInvoice records (SPOTX -> Reseller) and pays one
   via Razorpay. No PDF/GST document generated here — the
   Reseller's GST/business documents are submitted once at KYC
   (RESELLER_COMPLETE_PLAN.md B15 item 4).
============================================================ */

const listInvoices = async (req, res) => {
  try {
    const invoices = await ResellerInvoice.find({ partnerId: req.partner._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: invoices });
  } catch (error) {
    console.error("listInvoices error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading invoices." });
  }
};

const getInvoice = async (req, res) => {
  try {
    const invoice = await ResellerInvoice.findOne({ _id: req.params.id, partnerId: req.partner._id });
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found." });
    return res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("getInvoice error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the invoice." });
  }
};

const createInvoicePaymentOrder = async (req, res) => {
  try {
    const invoice = await ResellerInvoice.findOne({ _id: req.params.id, partnerId: req.partner._id });
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found." });

    if (invoice.paymentStatus === "paid") {
      return res.status(400).json({ success: false, message: "This invoice is already paid." });
    }

    const razorpayOrder = await createOrder({
      amountInRupees: invoice.total,
      receipt: `resellerinv_${invoice._id}`,
      notes: {
        purpose: "reseller_invoice_payment",
        partnerId: String(req.partner._id),
        invoiceId: String(invoice._id)
      }
    });

    invoice.razorpay.orderId = razorpayOrder.id;
    await invoice.save();

    const { keyId } = await getRazorpayCredentials();

    return res.json({
      success: true,
      data: { razorpayOrderId: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, keyId }
    });
  } catch (error) {
    console.error("createInvoicePaymentOrder error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong starting the payment." });
  }
};

const verifyInvoicePayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const invoice = await ResellerInvoice.findOne({ _id: req.params.id, partnerId: req.partner._id });
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found." });

    const isValidSignature = await verifyPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature
    });

    if (!isValidSignature) {
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }

    const payment = await fetchPaymentById(razorpayPaymentId);
    if (payment.status !== "captured" || payment.amount !== Math.round(invoice.total * 100)) {
      return res.status(400).json({ success: false, message: "Payment could not be verified against the invoice amount." });
    }

    await applyPaidInvoice(invoice._id, { razorpayPaymentId });

    const updated = await ResellerInvoice.findById(invoice._id);
    return res.json({ success: true, message: "Payment confirmed.", data: updated });
  } catch (error) {
    console.error("verifyInvoicePayment error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong verifying the payment." });
  }
};

module.exports = { listInvoices, getInvoice, createInvoicePaymentOrder, verifyInvoicePayment };
