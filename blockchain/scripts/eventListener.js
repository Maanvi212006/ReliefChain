/**
 * scripts/eventListener.js
 * Listens to CampaignFactory + individual Campaign events on Polygon.
 * Syncs DonationReceived events to your Express / Django backend.
 *
 * Run with PM2 in production:
 *   pm2 start scripts/eventListener.js --name "blockchain-listener"
 */

require("dotenv").config();
const { ethers } = require("ethers");
const axios      = require("axios");
const fs         = require("fs");
const path       = require("path");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
const NETWORK     = process.env.NETWORK     || "mumbai";

// Polygon uses WebSocket for real-time events
const WS_URL = NETWORK === "polygon"
  ? process.env.POLYGON_WS_URL
  : process.env.MUMBAI_WS_URL;

if (!WS_URL) {
  console.error("❌ Set MUMBAI_WS_URL or POLYGON_WS_URL in your .env");
  process.exit(1);
}

async function main() {
  const configPath = path.join(__dirname, `../config/deployment.${NETWORK}.json`);
  const { factoryAddress, factoryAbi, campaignAbi } = JSON.parse(
    fs.readFileSync(configPath)
  );

  const provider = new ethers.WebSocketProvider(WS_URL);
  const factory  = new ethers.Contract(factoryAddress, factoryAbi, provider);

  console.log("🎧 Blockchain Event Listener — Polygon", NETWORK.toUpperCase());
  console.log(`   Factory  : ${factoryAddress}`);
  console.log(`   Backend  : ${BACKEND_URL}\n`);

  // ── Track active campaign contracts in memory ──────────────────────────────
  const activeCampaigns = new Map(); // address → Contract instance

  function watchCampaign(campaignAddress) {
    if (activeCampaigns.has(campaignAddress)) return;
    const campaign = new ethers.Contract(campaignAddress, campaignAbi, provider);
    activeCampaigns.set(campaignAddress, campaign);
    console.log(`👁️  Watching campaign: ${campaignAddress}`);

    // DonationReceived → sync to backend DB
    campaign.on("DonationReceived", async (donor, amount, totalRaised, event) => {
      const amountMATIC = ethers.formatEther(amount);
      console.log(`\n💰 Donation | ${campaignAddress}`);
      console.log(`   Donor  : ${donor}`);
      console.log(`   Amount : ${amountMATIC} MATIC`);
      console.log(`   TxHash : ${event.log.transactionHash}`);

      try {
        await axios.post(`${BACKEND_URL}/api/donations`, {
          campaignAddress,
          donorWallet:  donor,
          amount:       amountMATIC,
          txHash:       event.log.transactionHash,
          blockNumber:  event.log.blockNumber,
          network:      NETWORK,
        });
        console.log(`   ✅ Synced to backend`);
      } catch (e) {
        console.error(`   ❌ Backend sync failed:`, e.response?.data || e.message);
      }
    });

    campaign.on("FundsWithdrawn", (ngoWallet, amount, fee) => {
      console.log(`\n🏦 Withdrawn | ${campaignAddress}`);
      console.log(`   NGO    : ${ngoWallet}`);
      console.log(`   Amount : ${ethers.formatEther(amount)} MATIC`);
      console.log(`   Fee    : ${ethers.formatEther(fee)} MATIC`);
    });

    campaign.on("CampaignRevoked", (adminAddr, reason) => {
      console.warn(`\n🚫 Revoked | ${campaignAddress}`);
      console.warn(`   Admin  : ${adminAddr}`);
      console.warn(`   Reason : ${reason}`);
    });

    campaign.on("RefundClaimed", (donor, amount) => {
      console.log(`\n↩️  Refund | ${campaignAddress} | ${ethers.formatEther(amount)} MATIC → ${donor}`);
    });
  }

  // ── Factory events ─────────────────────────────────────────────────────────
  factory.on("CampaignDeployed", (campaignId, campaignAddress, ngoWallet, title) => {
    console.log(`\n📋 New Campaign Deployed`);
    console.log(`   ID      : #${campaignId}`);
    console.log(`   Address : ${campaignAddress}`);
    console.log(`   Title   : ${title}`);
    watchCampaign(campaignAddress);
  });

  factory.on("CampaignActivated", (campaignId, campaignAddress) => {
    console.log(`\n✅ Activated | #${campaignId} | ${campaignAddress}`);
  });

  // ── Load already-deployed campaigns on startup ─────────────────────────────
  console.log("🔄 Loading existing campaigns...");
  try {
    const all = await factory.getAllCampaigns();
    all.forEach(addr => watchCampaign(addr));
    console.log(`   Watching ${all.length} existing campaign(s)\n`);
  } catch (e) {
    console.warn("⚠️  Could not load existing campaigns:", e.message);
  }

  provider.on("error", err => console.error("Provider error:", err));
  process.on("SIGINT",  () => { console.log("\nShutting down..."); process.exit(0); });
  process.on("SIGTERM", () => { console.log("\nShutting down..."); process.exit(0); });

  console.log("✅ Listening for events...\n");
}

main().catch(e => { console.error(e); process.exit(1); });
