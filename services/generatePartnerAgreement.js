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
// The PDF's built-in Helvetica has no ₹ glyph (it prints as "¹"), so use "Rs.".
const formatMoney = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;

const PLATFORM_LABEL = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };

/**
 * The influencer's social accounts that have agreed rates — straight from the
 * per-post / per-reel rates an admin sets on each account (see
 * adminSocialMediaController.updateRates). These are the same amounts credited
 * automatically when content from that account is approved, so the agreement
 * is the one place prices are stated; nothing is priced per post later.
 */
const pricedAccounts = (partner) =>
  (partner.socialAccounts || []).filter((a) => a.reviewStatus !== "rejected" && (a.paymentRates?.post || a.paymentRates?.reel));

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
 * Renders the full multi-section influencer agreement PDF to disk and returns
 * file metadata in the same shape partnerDocumentController.uploadDocument
 * produces, so the caller can save it as a normal PartnerDocument row.
 */
const generatePartnerAgreementFile = async (partner) => {
  const partnerDir = path.join(UPLOAD_ROOT, String(partner._id));
  fs.mkdirSync(partnerDir, { recursive: true });

  const filename = `influencer-agreement-${Date.now()}.pdf`;
  const filePath = path.join(partnerDir, filename);

  const settlementSetting = await SettlementSetting.findOne({ partnerId: partner._id });

  const effectiveDate = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  const agreementRef = `SPX-AGR-${partner.partnerCode}`;
  const influencerName = partner.legalEntity.businessName || partner.primaryContact.name;
  const accounts = pricedAccounts(partner);

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
    doc.fontSize(16).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("Influencer Agreement");
    doc.font("Helvetica");
    doc.moveDown(0.15);
    doc.fontSize(9).fillColor(MUTED).text(`Reference: ${agreementRef}    |    Effective Date: ${effectiveDate}`);
    doc.moveDown(0.6);
    doc.strokeColor("#E5E5E5").lineWidth(1).moveTo(56, doc.y).lineTo(539, doc.y).stroke();

    // ---- Preamble ----
    doc.moveDown(0.8);
    body(
      `This Influencer Agreement ("Agreement") is entered into as of ${effectiveDate}, by and between SPOTX ("SPOTX" or ` +
      `the "Company"), an enterprise digital signage platform operator [Registered Office Address to be inserted], and ` +
      `the content creator identified below ("Influencer"). SPOTX and the Influencer are individually a "Party" and ` +
      `together the "Parties".`
    );

    // ---- Parties ----
    heading("Parties");
    doc.fontSize(10).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("The Influencer");
    doc.font("Helvetica").fillColor(CHARCOAL);
    doc.text(`Name: ${partner.primaryContact.name}`);
    if (partner.legalEntity.businessName) doc.text(`Creator / Brand Name: ${partner.legalEntity.businessName}`);
    if (partner.legalEntity.legalName) doc.text(`Registered Legal Name: ${partner.legalEntity.legalName}`);
    if (partner.legalEntity.entityType) doc.text(`Entity Type: ${ENTITY_TYPE_LABEL[partner.legalEntity.entityType]}`);
    doc.text(`Influencer Code: ${partner.partnerCode}`);
    doc.text(`Address: ${formatAddress(partner.address)}`);
    doc.text(`Email: ${partner.primaryContact.email}`);
    if (partner.primaryContact.phone) doc.text(`Phone: ${partner.primaryContact.phone}`);

    // ---- Background ----
    heading("Background");
    body(
      "SPOTX operates an enterprise-grade digital signage platform that enables businesses to manage content, monitor " +
      "screens, schedule campaigns, and track performance across their screen network from a single dashboard. The " +
      "Influencer creates content for an audience on social media and wishes to promote SPOTX to that audience. SPOTX " +
      "is willing to pay the Influencer for approved promotional content on the terms of this Agreement."
    );

    // ---- Scope ----
    heading("Scope of Work");
    body(
      "The Influencer will create and publish posts and reels promoting SPOTX on the social media accounts listed in " +
      "the Payment Terms section below, and submit each published piece through the SPOTX Influencer Panel for review. " +
      "SPOTX reviews every submission and approves or rejects it; only approved content is paid. In creating content, " +
      "the Influencer will:"
    );
    doc.moveDown(0.3);
    bullet("publish only from social accounts that SPOTX has verified as belonging to the Influencer;");
    bullet("clearly disclose the paid nature of the content (for example \"#ad\" or the platform's paid-partnership label), in line with the ASCI Guidelines for Influencer Advertising in Digital Media;");
    bullet("represent SPOTX's products, features, and pricing accurately, and not make claims SPOTX has not approved;");
    bullet("keep follower and engagement figures genuine — no purchased followers, bots, or artificial engagement.");

    // ---- Onboarding & Verification ----
    heading("Onboarding & Verification");
    body(
      "This Agreement, and the Influencer's ability to submit content and receive payouts through the SPOTX Influencer " +
      "Panel, is conditioned on SPOTX's verification of the Influencer's KYC documents, bank account details, and " +
      "social media accounts. The Influencer represents and warrants that all information and documents submitted for " +
      "this purpose are true, accurate, and not misleading. SPOTX reserves the right to suspend or reject the " +
      "Influencer's account if this is found not to be the case."
    );

    // ---- Payment Terms ----
    heading("Payment Terms");
    if (accounts.length === 0) {
      body(
        "Payment rates for the Influencer's social accounts have not been set yet. SPOTX will agree per-post and " +
        "per-reel rates for each account before any content becomes payable, and this Agreement will be reissued to " +
        "state them."
      );
    } else {
      body(
        "The Influencer is paid a fixed amount for each approved piece of content, at the rate agreed below for the " +
        "social account it was published on. These rates apply to every approved post and reel from that account — " +
        "no separate price is set per piece of content."
      );
      doc.moveDown(0.3);
      for (const a of accounts) {
        const rates = [];
        if (a.paymentRates.post) rates.push(`${formatMoney(a.paymentRates.post)} per post`);
        if (a.paymentRates.reel) rates.push(`${formatMoney(a.paymentRates.reel)} per reel`);
        bullet(`${PLATFORM_LABEL[a.platform] || a.platform} — ${a.username || a.accountId}: ${rates.join(", ")}`);
      }
    }
    doc.moveDown(0.4);
    body(
      `A payment is recorded when SPOTX approves a submitted post or reel, and becomes eligible for settlement ` +
      `after SPOTX's internal review. Settlements are processed on a ${settlementCadence.toLowerCase()} basis to the ` +
      `bank account verified by the Influencer in the SPOTX Influencer Panel.${tdsNote} SPOTX reserves the right to ` +
      `hold or reverse any payment connected to content that is removed, misrepresented, or found to be fraudulent.`
    );

    // ---- Term & Termination ----
    heading("Term & Termination");
    body(
      "This Agreement commences on the Effective Date and continues until terminated by either Party. Either Party " +
      "may terminate this Agreement for convenience upon thirty (30) days' prior written notice to the other Party. " +
      "SPOTX may suspend or terminate this Agreement immediately upon written notice if the Influencer breaches this " +
      "Agreement, provides false information, or engages in fraudulent or unlawful conduct. Termination does not " +
      "affect payment already earned for content approved prior to the effective date of termination, which remains " +
      "payable per the settlement terms above."
    );

    // ---- Confidentiality ----
    heading("Confidentiality");
    body(
      "Each Party agrees to keep confidential all non-public business, technical, and financial information disclosed " +
      "by the other Party in connection with this Agreement, including the payment rates set out above, and to use such " +
      "information solely to perform its obligations under this Agreement. This obligation survives termination of " +
      "this Agreement."
    );

    // ---- Intellectual Property ----
    heading("Intellectual Property & Content Use");
    body(
      "SPOTX retains all right, title, and interest in and to its platform, software, trademarks, and brand assets. " +
      "The Influencer is granted a limited, non-exclusive, non-transferable right to use SPOTX's name and marks solely " +
      "in content created under this Agreement, in accordance with SPOTX's brand guidelines; this right ends " +
      "automatically when this Agreement ends. The Influencer retains ownership of the content it creates, and grants " +
      "SPOTX a non-exclusive right to share or link to approved content on SPOTX's own channels with credit to the " +
      "Influencer."
    );

    // ---- Compliance ----
    heading("Compliance");
    body(
      "Each Party will comply with applicable law in performing its obligations under this Agreement, including " +
      "consumer protection and advertising disclosure rules and each social media platform's own terms for branded " +
      "content. The Influencer is responsible for its own tax filings on payments received under this Agreement."
    );

    // ---- Limitation of Liability ----
    heading("Limitation of Liability");
    body(
      "Neither Party will be liable to the other for any indirect, incidental, or consequential damages arising out " +
      "of this Agreement. Each Party's total liability under this Agreement is limited to the amounts actually paid " +
      "or payable to the Influencer in the twelve (12) months preceding the event giving rise to the claim."
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
      `Notices under this Agreement will be sent to the Influencer at ${partner.primaryContact.email} and will be ` +
      "deemed delivered when sent. SPOTX may also notify the Influencer in-app via the SPOTX Influencer Panel."
    );

    // ---- Entire Agreement ----
    heading("Entire Agreement");
    body(
      "This Agreement, generated by the SPOTX Influencer Panel, reflects the terms configured for the Influencer as of " +
      "the Effective Date and constitutes the entire understanding between the Parties regarding the subject matter " +
      "herein. Whenever SPOTX changes the Influencer's payment rates, a reissued version of this Agreement stating " +
      "the new rates replaces this one for content approved after its effective date."
    );

    // ---- Acknowledgement / signature block ----
    doc.moveDown(1.2);
    doc.strokeColor("#E5E5E5").lineWidth(1).moveTo(56, doc.y).lineTo(539, doc.y).stroke();
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor(FAINT).text(
      "This document is generated automatically by the SPOTX Influencer Panel upon verification of the Influencer's " +
      "KYC documents and bank account, and is reissued whenever the agreed payment rates change. Where a separately " +
      "signed master agreement exists between the Parties, that document takes precedence over this one.",
      { align: "justify", lineGap: 2 }
    );

    doc.moveDown(1.2);
    const colY = doc.y;
    doc.fontSize(9).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("For SPOTX", 56, colY);
    doc.font("Helvetica").fillColor(CHARCOAL).fontSize(9);
    doc.text("Authorized Signatory", 56, colY + 14);
    doc.text(`Issued on: ${effectiveDate}`, 56, colY + 28);

    doc.fontSize(9).fillColor(BRAND_BLACK).font("Helvetica-Bold").text("For the Influencer", 300, colY);
    doc.font("Helvetica").fillColor(CHARCOAL).fontSize(9);
    doc.text(partner.primaryContact.name, 300, colY + 14);
    if (influencerName !== partner.primaryContact.name) doc.text(influencerName, 300, colY + 28);

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
    originalName: "SPOTX Influencer Agreement.pdf",
    mimeType: "application/pdf",
    size
  };
};

const createAgreementDocument = async (partner, adminUserId) => {
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

/**
 * Generates the agreement and files it as a normal PartnerDocument, already
 * verified (SPOTX generated it, there's nothing for a reviewer to approve).
 * Idempotent — activation never creates a second one.
 */
const attachPartnerAgreement = async (partner, adminUserId) => {
  const existing = await PartnerDocument.findOne({ partnerId: partner._id, documentType: "partner_agreement" });
  if (existing) return existing;
  return createAgreementDocument(partner, adminUserId);
};

/**
 * Issues a fresh agreement stating the influencer's current rates — called
 * whenever an admin changes an account's rates, so the agreement always shows
 * the prices every approved post/reel is paid at. Only once the influencer
 * already has an agreement (i.e. is verified); before that, activation issues
 * the first one with whatever rates exist by then. The admin and influencer
 * UIs show the latest agreement by createdAt, so older versions stay on
 * record without being deleted.
 */
const reissuePartnerAgreement = async (partner, adminUserId) => {
  const existing = await PartnerDocument.exists({ partnerId: partner._id, documentType: "partner_agreement" });
  if (!existing) return null;
  return createAgreementDocument(partner, adminUserId);
};

module.exports = { generatePartnerAgreementFile, attachPartnerAgreement, reissuePartnerAgreement };
