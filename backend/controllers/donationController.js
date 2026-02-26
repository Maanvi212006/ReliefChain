const Donation = require("../models/Donation");
const Campaign = require("../models/Campaign");

// @desc  Record a donation (called after on-chain tx confirmed)
// @route POST /api/donations
// @access Public
const recordDonation = async (req, res) => {
  try {
    const { campaignId, donorWallet, amount, txHash, blockNumber, network, message, isAnonymous } = req.body;

    // Prevent duplicate tx recording
    const exists = await Donation.findOne({ txHash });
    if (exists) {
      return res.status(409).json({ success: false, message: "Transaction already recorded" });
    }

    const donation = await Donation.create({
      campaignId, donorWallet, amount, txHash, blockNumber, network, message, isAnonymous,
    });

    // Update campaign raised amount
    await Campaign.findByIdAndUpdate(campaignId, { $inc: { raisedAmount: Number(amount) } });

    res.status(201).json({ success: true, data: donation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc  Get all donations for a campaign
// @route GET /api/donations/campaign/:campaignId
// @access Public
const getDonationsByCampaign = async (req, res) => {
  try {
    const donations = await Donation.find({ campaignId: req.params.campaignId })
      .sort({ createdAt: -1 });
    res.json({ success: true, count: donations.length, data: donations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get all donations by a wallet address (donor dashboard)
// @route GET /api/donations/donor/:walletAddress
// @access Public
const getDonationsByDonor = async (req, res) => {
  try {
    const donations = await Donation.find({ donorWallet: req.params.walletAddress })
      .populate("campaignId", "title image ngoName status")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: donations.length, data: donations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { recordDonation, getDonationsByCampaign, getDonationsByDonor };
