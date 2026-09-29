const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { SettlementSetting, PartnerDocument } = require("../models/Index");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "partners");
const LOGO_PATH = path.join(__dirname, "..", "assets", "spotx-logo.png");
const LOGO_ASPECT = 789 / 307; // actual pixel dimensions of assets/spotx-logo.png

const BRAND_RED = "#EC2027";
const BRAND_BLACK = "#121212";
const CHARCOAL = "#2D2D2D";
const MUTED = "#666666";
const FAINT = "#999999";

const formatPercent = (n) => `${n}%`;
const formatMoney = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * What the influencer is paid, straight from the per-post / per-reel rates
 * an admin sets on the partner (see adminSocialMediaController) — the same
 * amounts credited when each submission is approved.
 */
const describePaymentTerms = (partner) => {
  const rates = partner.influencerPaymentRates;
  if (!rates || (!rates.post && !rates.reel)) {
    return "Payment rates for this Partner have not been set yet. SPOTX will set per-post and per-reel rates before any payment becomes payable, and this Agreement will be reissued to reflect them.";
  }
  return `The Partner earns ${formatMoney(rates.post)} for each approved post and ${formatMoney(rates.reel)} for each approved reel promoting SPOTX, submitted through the SPOTX Partner Panel.`;
};

const SCOPE_BY_PARTNER_TYPE = {
  vendor: "The Partner will refer and onboard end-customers who subscribe to the SPOTX platform, either by registering customers directly on the Partner's behalf or by sharing the Partner's unique customer referral code. Each registered customer receives a 30-day free trial before conversion to a paid subscription.",
  affiliate: "The Partner will refer prospective customers and leads to SPOTX in exchange for the commission described in Section 5 below.",
  influencer: "The Partner will promote SPOTX to its audience through posts and reels on its verified social media accounts, in exchange for the payment described in the Payment Terms section below.",
  referral: "The Partner will make bona fide introductions of prospective customers to SPOTX in exchange for a referral fee as described in Section 5 below.",
  agency: "The Partner will represent and refer SPOTX's platform to its own client base under the arrangement configured in the SPOTX Partner Panel.",
  technology: "The Partner will integrate, bundle, or otherwise technically collaborate with SPOTX's platform under the arrangement configured in the SPOTX Partner Panel.",
  strategic: "The Partner will collaborate with SPOTX under a strategic partnership arrangement as configured in the SPOTX Partner Panel."
};

const ENTITY_TYPE_LABEL = {
  proprietorship: "Sole Proprietorship",
  partnership: "Partnership Firm",
  llp: "Limited Liability Partnership",
  private_limited: "Private Limited Company",
  public_limited: "Public Limited Company",
  individual: "Individual",
  other: "Other Business Entity"
};

const formatAddress = (address) => {
  if (!address) return "[Address not on file]";
  const parts = [address.addressLine1, address.addressLine2, address.city, address.state, address.pincode, address.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "[Address not on file]";
};

/**
 * Renders the full multi-section partner agreement PDF to disk and returns
 * file metadata in the same shape partnerDocumentController.uploadDocument
 * produces, so the caller can save it as a normal PartnerDocument row.
 */
const generatePartnerAgreementFile = async (partner) => {
  const partnerDir = path.join(UPLOAD_ROOT, String(partner._id));
  fs.mkdirSync(partnerDir, { recursive: true });

  const filename = `partner-agreement-${Date.now()}.pdf`;
  const filePath = path.join(partnerDir, filename);

  const settlementSetting = await SettlementSetting.findOne({ partnerId: partner._id });

  const effectiveDate = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  const agreementRef = `SPX-AGR-${partner.partnerCode}`;
  const partnerTypeLabel = partner.partnerType.charAt(0).toUpperCase() + partner.partnerType.slice(1);

  const settlementCadence = settlementSetting
    ? settlementSetting.settlementType.charAt(0).toUpperCase() + settlementSetting.settlementType.slice(1)
    : "Monthly";
  const tdsNote = settlementSetting?.tax?.tdsEnabled
    ? ` Tax will be deducted at source at ${formatPercent(settlementSetting.tax.tdsRate)} as applicable under Indian tax law.`
    : " Applicable taxes, including tax deducted at source, will be withheld as required under Indian law.";

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    let sectionNumber = 0;
    const heading = (title) => {
      sectionNumber += 1;
      doc.moveDown(0.9);
      doc.fontSize(12).fillColor(BRAND_BLACK).font("Helvetica-Bold").text(`${sectionNumber}. ${title}`);
      doc.moveDown(0.3);
      doc.font("Helvetica");
    };
    const body = (text) => {
      doc.fontSize(10).fillColor(CHARCOAL).text(text, { align: "justify", lineGap: 3 });
    };
    const bullet = (text) => {
      doc.fontSize(10).fillColor(CHARCOAL).text(`•  ${text}`, { align: "left", lineGap: 3, indent: 10 });
    };

    // ---- Letterhead ----
    // The source logo's "Spot" wordmark is white-on-transparent — invisible
    // on a white page unless backed by a dark badge, same fix Logo.jsx uses
    // on the web (a light background would swallow it otherwise).
    if (fs.existsSync(LOGO_PATH)) {
      const logoHeight = 28;
      const logoWidth = logoHeight * LOGO_ASPECT;
      const padding = 12;
      const badgeX = 56;
      const badgeY = doc.y;

      doc.roundedRect(badgeX, badgeY, logoWidth + padding * 2, logoHeight + padding * 2, 6).fill(BRAND_BLACK);
      doc.image(LOGO_PATH, badgeX + padding, badgeY + padding, { height: logoHeight, width: logoWidth });
      doc.y = badgeY + logoHeight + padding * 2 + 10;
    } else {
      doc.fontSize(22).fillColor(BRAND_RED).font("Helvetica-Bold").text("SPOT", { continued: true });
      doc.fillColor(BRAND_BLACK).text("X");
      doc.font("Helvetica");
      doc.moveDown(0.2);
    }
    doc.fontSize(16).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("Partner Agreement");
    doc.font("Helvetica");
    doc.moveDown(0.15);
    doc.fontSize(9).fillColor(MUTED).text(`Reference: ${agreementRef}    |    Effective Date: ${effectiveDate}`);
    doc.moveDown(0.6);
    doc.strokeColor("#E5E5E5").lineWidth(1).moveTo(56, doc.y).lineTo(539, doc.y).stroke();

    // ---- Preamble ----
    doc.moveDown(0.8);
    body(
      `This Partner Agreement ("Agreement") is entered into as of ${effectiveDate}, by and between SPOTX ("SPOTX" or the ` +
      `"Company"), an enterprise digital signage platform operator [Registered Office Address to be inserted], and the ` +
      `partner identified below ("Partner"). SPOTX and the Partner are individually a "Party" and together the "Parties".`
    );

    // ---- Parties ----
    heading("Parties");
    doc.fontSize(10).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("The Partner");
    doc.font("Helvetica").fillColor(CHARCOAL);
    doc.text(`Business / Trade Name: ${partner.legalEntity.businessName}`);
    if (partner.legalEntity.legalName) doc.text(`Registered Legal Name: ${partner.legalEntity.legalName}`);
    doc.text(`Entity Type: ${ENTITY_TYPE_LABEL[partner.legalEntity.entityType] || "Not specified"}`);
    doc.text(`Partner Code: ${partner.partnerCode}`);
    doc.text(`Partner Category: ${partnerTypeLabel} Partner`);
    doc.text(`Registered / Business Address: ${formatAddress(partner.address)}`);
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("Authorized Representative");
    doc.font("Helvetica").fillColor(CHARCOAL);
    doc.text(`Name: ${partner.primaryContact.name}${partner.primaryContact.designation ? ` (${partner.primaryContact.designation})` : ""}`);
    doc.text(`Email: ${partner.primaryContact.email}`);
    if (partner.primaryContact.phone) doc.text(`Phone: ${partner.primaryContact.phone}`);

    // ---- Background ----
    heading("Background");
    body(
      "SPOTX operates an enterprise-grade digital signage platform that enables businesses to manage content, monitor " +
      "screens, schedule campaigns, and track performance across their screen network from a single dashboard. The " +
      "Partner wishes to participate in the SPOTX Partner Program in the capacity described below, and SPOTX is " +
      "willing to grant such participation on the terms of this Agreement."
    );

    // ---- Scope ----
    heading("Scope of Partnership");
    body(SCOPE_BY_PARTNER_TYPE[partner.partnerType] || "The scope of this partnership is as configured for the Partner in the SPOTX Partner Panel.");

    // ---- Onboarding & Verification ----
    heading("Onboarding & Verification");
    body(
      "This Agreement, and the Partner's ability to use the referral, sales, and payout features of the SPOTX Partner " +
      "Panel, is conditioned on SPOTX's verification of the Partner's KYC documents and bank account details. The " +
      "Partner represents and warrants that all information and documents submitted for this purpose are true, " +
      "accurate, and not misleading. SPOTX reserves the right to suspend or reject the Partner's account if this is " +
      "found not to be the case."
    );

    // ---- Payment Terms ----
    heading("Payment Terms");
    body(describePaymentTerms(partner));
    doc.moveDown(0.4);
    body(
      `A payment is recorded when SPOTX approves a submitted post or reel, and becomes eligible for settlement ` +
      `after SPOTX's internal review. Settlements are processed on a ${settlementCadence.toLowerCase()} basis to the ` +
      `bank account verified by the Partner in the SPOTX Partner Panel.${tdsNote} SPOTX reserves the right to hold or ` +
      `reverse any payment connected to content that is subsequently removed, misrepresented, or found to be fraudulent.`
    );

    // ---- Term & Termination ----
    heading("Term & Termination");
    body(
      "This Agreement commences on the Effective Date and continues until terminated by either Party. Either Party " +
      "may terminate this Agreement for convenience upon thirty (30) days' prior written notice to the other Party. " +
      "SPOTX may suspend or terminate this Agreement immediately upon written notice if the Partner breaches this " +
      "Agreement, provides false information, or engages in fraudulent or unlawful conduct. Termination does not " +
      "affect payment already earned for content approved prior to the effective date of termination, which remains " +
      "payable per the settlement terms above."
    );

    // ---- Confidentiality ----
    heading("Confidentiality");
    body(
      "Each Party agrees to keep confidential all non-public business, technical, financial, and customer information " +
      "disclosed by the other Party in connection with this Agreement, and to use such information solely to perform " +
      "its obligations under this Agreement. This obligation survives termination of this Agreement."
    );

    // ---- Intellectual Property ----
    heading("Intellectual Property");
    body(
      "SPOTX retains all right, title, and interest in and to its platform, software, trademarks, and brand assets. " +
      "The Partner is granted a limited, non-exclusive, non-transferable right to use SPOTX's name and marks solely " +
      "for marketing SPOTX to prospective customers under this Agreement, in accordance with SPOTX's brand " +
      "guidelines, and such right terminates automatically upon termination of this Agreement."
    );

    // ---- Data Protection & Compliance ----
    heading("Data Protection & Compliance");
    body(
      "Each Party will comply with applicable law in performing its obligations under this Agreement, including " +
      "applicable data protection law when handling personal information of prospective or registered customers. " +
      "The Partner will not misrepresent SPOTX's products, pricing, or terms to any prospective customer."
    );

    // ---- Limitation of Liability ----
    heading("Limitation of Liability");
    body(
      "Neither Party will be liable to the other for any indirect, incidental, or consequential damages arising out " +
      "of this Agreement. Each Party's total liability under this Agreement is limited to the amounts " +
      "actually paid or payable to the Partner in the twelve (12) months preceding the event giving rise to the claim."
    );

    // ---- Governing Law ----
    heading("Governing Law & Dispute Resolution");
    body(
      "This Agreement is governed by the laws of India. The Parties will first attempt to resolve any dispute arising " +
      "out of this Agreement through good-faith discussion, failing which the dispute will be subject to the " +
      "exclusive jurisdiction of the competent courts in India."
    );

    // ---- Notices ----
    heading("Notices");
    body(
      `Notices under this Agreement will be sent to the Partner at ${partner.primaryContact.email} and will be deemed ` +
      "delivered when sent. SPOTX may also notify the Partner in-app via the SPOTX Partner Panel."
    );

    // ---- Entire Agreement ----
    heading("Entire Agreement");
    body(
      "This Agreement, generated by the SPOTX Partner Panel upon verification of the Partner's account, reflects the " +
      "commercial terms configured for the Partner as of the Effective Date and constitutes the entire understanding " +
      "between the Parties regarding the subject matter herein. Any amendment to the payment rates or " +
      "scope described above will be reflected in a reissued version of this Agreement."
    );

    // ---- Acknowledgement / signature block ----
    doc.moveDown(1.2);
    doc.strokeColor("#E5E5E5").lineWidth(1).moveTo(56, doc.y).lineTo(539, doc.y).stroke();
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor(FAINT).text(
      "This document is generated automatically by the SPOTX Partner Panel upon successful verification of the " +
      "Partner's KYC documents and bank account, and stands as the record of agreed commercial terms between the " +
      "Parties from that point forward. Where a separately signed master agreement exists between the Parties, that " +
      "document takes precedence over this one.",
      { align: "justify", lineGap: 2 }
    );

    doc.moveDown(1.2);
    const colY = doc.y;
    doc.fontSize(9).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("For SPOTX", 56, colY);
    doc.font("Helvetica").fillColor(CHARCOAL).fontSize(9);
    doc.text("Authorized Signatory", 56, colY + 14);
    doc.text(`Verified on: ${effectiveDate}`, 56, colY + 28);

    doc.fontSize(9).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("For the Partner", 300, colY);
    doc.font("Helvetica").fillColor(CHARCOAL).fontSize(9);
    doc.text(partner.primaryContact.name, 300, colY + 14);
    doc.text(partner.legalEntity.businessName, 300, colY + 28);

    // ---- Footer: page numbers on every page ----
    // Writing inside the bottom margin makes pdfkit think the content
    // overflows and silently appends a new blank page to fit it — zeroing
    // the margin for this one write avoids that.
    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i += 1) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(8).fillColor(FAINT).text(
        `${agreementRef}  ·  Page ${i + 1} of ${pageRange.count}`,
        56,
        doc.page.height - 40,
        { width: doc.page.width - 112, align: "center" }
      );
      doc.page.margins.bottom = bottomMargin;
    }

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  const { size } = fs.statSync(filePath);

  return {
    objectKey: path.join(String(partner._id), filename),
    originalName: "SPOTX Partner Agreement.pdf",
    mimeType: "application/pdf",
    size
  };
};

/**
 * Generates the agreement and files it as a normal PartnerDocument, already
 * verified (SPOTX generated it, there's nothing for a reviewer to approve).
 * Idempotent — a partner never gets a second one.
 */
const attachPartnerAgreement = async (partner, adminUserId) => {
  const existing = await PartnerDocument.findOne({ partnerId: partner._id, documentType: "partner_agreement" });
  if (existing) return existing;

  const file = await generatePartnerAgreementFile(partner);

  return PartnerDocument.create({
    partnerId: partner._id,
    documentType: "partner_agreement",
    file,
    verification: {
      status: "verified",
      verifiedBy: adminUserId,
      verifiedAt: new Date()
    }
  });
};

module.exports = { generatePartnerAgreementFile, attachPartnerAgreement };
