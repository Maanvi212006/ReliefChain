const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");
const {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateRaisedAmount,
  setContractAddress,
} = require("../controllers/campaignController");

// Public
router.get("/", getCampaigns);
router.get("/:id", getCampaignById);

// NGO submits campaign with image + NGO doc
router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "ngoDocument", maxCount: 1 },
  ]),
  createCampaign
);

// Called internally (by blockchain listener or deploy script)
router.patch("/:id/raised", updateRaisedAmount);
router.patch("/:id/contract", setContractAddress);

module.exports = router;
