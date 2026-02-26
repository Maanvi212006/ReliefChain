const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    donorWallet: { type: String, required: true },      // MetaMask wallet address
    amount: { type: Number, required: true },            // in ETH/MATIC
    txHash: { type: String, required: true, unique: true }, // blockchain tx hash
    blockNumber: { type: Number },
    network: { type: String, default: "polygon-mumbai" },
    message: { type: String, default: "" },              // optional donor message
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Donation", donationSchema);


