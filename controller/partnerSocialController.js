const crypto = require("crypto");
const { Partner } = require("../models/Index");
const { encrypt } = require("../utils/encryption");

const FRONTEND_URL = process.env.CLIENT_URL || "http://localhost:5183";
const META_VERSION = process.env.META_GRAPH_VERSION || "v21.0";

const config = {
  // Instagram API with Instagram Login: the creator signs in with their
  // Instagram username/password directly — no Facebook Page needed. Uses the
  // separate "Instagram app ID/secret" from the Meta app's Instagram use case.
  instagram: {
    clientId: process.env.INSTAGRAM_APP_ID,
    clientSecret: process.env.INSTAGRAM_APP_SECRET,
    authUrl: "https://www.instagram.com/oauth/authorize",
    scope: "instagram_business_basic"
  },
  facebook: {
    clientId: process.env.META_APP_ID,
    clientSecret: process.env.META_APP_SECRET,
    authUrl: `https://www.facebook.com/${META_VERSION}/dialog/oauth`,
    scope: "pages_show_list,pages_read_engagement"
  },
  youtube: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "https://www.googleapis.com/auth/youtube.readonly"
  }
};

const allowedOrigins = () => (process.env.CLIENT_URLS || process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// The frontend that started the connect flow, if it's one we accept (any
// http(s) origin when CLIENT_URLS=*) — so the influencer lands back on the
// same frontend instead of always CLIENT_URL.
const pickReturnOrigin = (value) => {
  let origin;
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    origin = url.origin;
  } catch {
    return undefined;
  }
  const allowed = allowedOrigins();
  return allowed.includes("*") || allowed.includes(origin) ? origin : undefined;
};

const redirectUri = (platform) => `${process.env.API_PUBLIC_URL || "http://localhost:5000"}/api/partner/social/${platform}/callback`;

const startConnection = (req, res) => {
  const platform = req.params.platform;
  const provider = config[platform];
  if (!provider) return res.status(400).json({ success: false, message: "Unsupported social platform." });
  if (!provider.clientId || !provider.clientSecret) {
    return res.status(503).json({ success: false, message: `${platform} OAuth is not configured yet. Add the developer app credentials to backend/.env.` });
  }

  const state = jwtState({ partnerId: req.partner._id.toString(), platform, returnTo: pickReturnOrigin(req.query.returnTo) });
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri(platform),
    response_type: "code",
    state
  });
  // Business-type Meta apps use Facebook Login for Business, where the
  // permissions live in a login configuration instead of a scope list.
  if (platform === "facebook" && process.env.META_LOGIN_CONFIG_ID) {
    params.set("config_id", process.env.META_LOGIN_CONFIG_ID);
  } else {
    params.set("scope", provider.scope);
  }
  if (platform === "youtube") params.set("access_type", "offline");
  return res.json({ success: true, url: `${provider.authUrl}?${params.toString()}` });
};

const jwtState = (payload) => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const readState = (state) => {
  const [body, signature] = String(state || "").split(".");
  const expected = crypto.createHmac("sha256", process.env.JWT_SECRET).update(body || "").digest("base64url");
  if (!body || signature !== expected) throw new Error("Invalid OAuth state.");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) throw new Error("OAuth state expired.");
  return payload;
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error_description || "Social provider request failed.");
  return data;
};

const callback = async (req, res) => {
  let frontendUrl = FRONTEND_URL;
  try {
    // Read the state first so even a cancelled login goes back to the
    // frontend that started it.
    let state;
    try {
      state = readState(req.query.state);
      frontendUrl = state.returnTo || FRONTEND_URL;
    } catch (stateError) {
      if (!req.query.error) throw stateError;
    }
    if (req.query.error) throw new Error(req.query.error_description || "Connection was cancelled.");
    const platform = state.platform;
    const provider = config[platform];
    const tokenParams = new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: redirectUri(platform),
      code: req.query.code,
      grant_type: "authorization_code"
    });
    const tokenUrl = {
      youtube: "https://oauth2.googleapis.com/token",
      instagram: "https://api.instagram.com/oauth/access_token",
      facebook: `https://graph.facebook.com/${META_VERSION}/oauth/access_token`
    }[platform];
    const token = await fetchJson(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tokenParams });
    // Instagram sometimes wraps the token response in a data array.
    let accessToken = token.access_token || token.data?.[0]?.access_token;
    let account;

    if (platform === "instagram") {
      // Swap the 1-hour token for a 60-day one so it stays usable for syncing.
      const longLived = await fetchJson(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(provider.clientSecret)}&access_token=${encodeURIComponent(accessToken)}`);
      accessToken = longLived.access_token || accessToken;
      const data = await fetchJson(`https://graph.instagram.com/${META_VERSION}/me?fields=user_id,username,account_type,followers_count&access_token=${encodeURIComponent(accessToken)}`);
      account = { accountId: data.user_id || data.id, username: data.username || "", followers: Number(data.followers_count || 0) };
    } else if (platform === "youtube") {
      const data = await fetchJson(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const item = data.items?.[0];
      if (!item) throw new Error("No YouTube channel was found for this account.");
      account = { accountId: item.id, username: item.snippet?.title || "", followers: Number(item.statistics?.subscriberCount || 0) };
    } else {
      // A user token's /me is the person, not their Page — Pages live
      // under /me/accounts.
      const data = await fetchJson(`https://graph.facebook.com/${META_VERSION}/me/accounts?fields=id,name,followers_count,fan_count&access_token=${encodeURIComponent(accessToken)}`);
      const page = (data.data || [])[0];
      if (!page) throw new Error("No Facebook Page was found. Create a Page (or allow access to it when connecting) and try again.");
      account = { accountId: page.id, username: page.name || "", followers: Number(page.followers_count ?? page.fan_count ?? 0) };
    }

    const partner = await Partner.findById(state.partnerId);
    if (!partner) throw new Error("Influencer account not found.");
    partner.socialAccounts = (partner.socialAccounts || []).filter((item) =>
      item.platform !== platform || (!item.connected && item.source !== "oauth")
    );
    partner.socialAccounts.push({
      platform,
      ...account,
      connected: true,
      source: "oauth",
      reviewStatus: "pending",
      submittedAt: new Date(),
      lastSyncedAt: new Date(),
      accessTokenEncrypted: encrypt(accessToken)
    });
    await partner.save();
    return res.redirect(`${frontendUrl}/partner/social-media?social=connected&platform=${platform}`);
  } catch (error) {
    console.error("social OAuth callback error:", error);
    return res.redirect(`${frontendUrl}/partner/social-media?social=error&message=${encodeURIComponent(error.message)}`);
  }
};

module.exports = { startConnection, callback };
