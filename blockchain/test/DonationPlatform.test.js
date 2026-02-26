const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");

describe("CampaignFactory + Campaign", function () {
  let factory, admin, ngo, donor1, donor2, stranger;

  const FEE           = 2;
  const TARGET        = ethers.parseEther("10");
  const DONATE_SMALL  = ethers.parseEther("3");
  const DONATE_FULL   = ethers.parseEther("10");

  beforeEach(async () => {
    [admin, ngo, donor1, donor2, stranger] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("CampaignFactory");
    factory = await Factory.deploy(FEE);
    await factory.waitForDeployment();
  });

  // ── Helper ──────────────────────────────────────────────────────────────────
  async function deployAndActivate(days = 30) {
    const deadline = (await time.latest()) + days * 86400;
    const tx = await factory.connect(admin).deployCampaign(
      "Flood Relief", ngo.address, TARGET, deadline
    );
    const receipt = await tx.wait();
    const iface   = factory.interface;
    const log     = receipt.logs
      .map(l => { try { return iface.parseLog(l); } catch { return null; } })
      .find(e => e?.name === "CampaignDeployed");

    const campaignId      = log.args.campaignId;
    const campaignAddress = log.args.campaignAddress;

    await factory.connect(admin).activateCampaign(campaignId);
    const campaign = await ethers.getContractAt("Campaign", campaignAddress);
    return { campaignId, campaignAddress, campaign };
  }

  // ── CampaignFactory ─────────────────────────────────────────────────────────
  describe("CampaignFactory", () => {
    it("Sets correct owner and fee", async () => {
      expect(await factory.owner()).to.equal(admin.address);
      expect(await factory.platformFeePercent()).to.equal(FEE);
    });

    it("Rejects fee > 10%", async () => {
      const F = await ethers.getContractFactory("CampaignFactory");
      await expect(F.deploy(11)).to.be.revertedWith("Factory: fee too high");
    });

    it("Deploys a campaign and emits CampaignDeployed", async () => {
      const deadline = (await time.latest()) + 86400;
      await expect(
        factory.connect(admin).deployCampaign("Test", ngo.address, TARGET, deadline)
      )
        .to.emit(factory, "CampaignDeployed")
        .withArgs(1n, expect.anything, ngo.address, "Test");

      expect(await factory.getTotalCampaigns()).to.equal(1);
    });

    it("Non-owner cannot deploy", async () => {
      const deadline = (await time.latest()) + 86400;
      await expect(
        factory.connect(stranger).deployCampaign("Fake", ngo.address, TARGET, deadline)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Can update platform fee", async () => {
      await expect(factory.connect(admin).updatePlatformFee(5))
        .to.emit(factory, "PlatformFeeUpdated").withArgs(FEE, 5);
      expect(await factory.platformFeePercent()).to.equal(5);
    });

    it("Pause stops new deployments", async () => {
      await factory.connect(admin).pause();
      const deadline = (await time.latest()) + 86400;
      await expect(
        factory.connect(admin).deployCampaign("Test", ngo.address, TARGET, deadline)
      ).to.be.revertedWithCustomError(factory, "EnforcedPause");
    });

    it("getCampaignDetails returns correct data", async () => {
      const { campaignId } = await deployAndActivate();
      const details = await factory.getCampaignDetails(campaignId);
      expect(details.title).to.equal("Flood Relief");
      expect(details.ngoWallet).to.equal(ngo.address);
    });
  });

  // ── Campaign ────────────────────────────────────────────────────────────────
  describe("Campaign — donate()", () => {
    it("Donor can donate to active campaign", async () => {
      const { campaign } = await deployAndActivate();
      await expect(
        campaign.connect(donor1).donate({ value: DONATE_SMALL })
      )
        .to.emit(campaign, "DonationReceived")
        .withArgs(donor1.address, DONATE_SMALL, DONATE_SMALL);

      expect(await campaign.getDonorAmount(donor1.address)).to.equal(DONATE_SMALL);
      expect(await campaign.raisedAmount()).to.equal(DONATE_SMALL);
    });

    it("Multiple donors tracked correctly", async () => {
      const { campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });
      await campaign.connect(donor2).donate({ value: DONATE_SMALL });

      const donors = await campaign.getAllDonors();
      expect(donors).to.include(donor1.address);
      expect(donors).to.include(donor2.address);
      expect(await campaign.raisedAmount()).to.equal(DONATE_SMALL * 2n);
    });

    it("Rejects zero donation", async () => {
      const { campaign } = await deployAndActivate();
      await expect(
        campaign.connect(donor1).donate({ value: 0 })
      ).to.be.revertedWith("Campaign: donation must be > 0");
    });

    it("Rejects donation to PENDING campaign", async () => {
      const deadline = (await time.latest()) + 86400;
      const tx = await factory.deployCampaign("Pending", ngo.address, TARGET, deadline);
      const receipt = await tx.wait();
      const log = receipt.logs
        .map(l => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find(e => e?.name === "CampaignDeployed");
      const campaign = await ethers.getContractAt("Campaign", log.args.campaignAddress);

      await expect(
        campaign.connect(donor1).donate({ value: DONATE_SMALL })
      ).to.be.revertedWith("Campaign: not active");
    });

    it("Rejects donation after deadline", async () => {
      const { campaign } = await deployAndActivate(0.001); // ~86s deadline
      await time.increase(200);
      await expect(
        campaign.connect(donor1).donate({ value: DONATE_SMALL })
      ).to.be.revertedWith("Campaign: deadline passed");
    });
  });

  describe("Campaign — withdraw()", () => {
    it("NGO withdraws with fee deduction after deadline", async () => {
      const { campaign } = await deployAndActivate(0.001);
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });
      await time.increase(200);

      const ngoBefore   = await ethers.provider.getBalance(ngo.address);
      const adminBefore = await ethers.provider.getBalance(admin.address);

      const tx      = await campaign.connect(ngo).withdraw();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * tx.gasPrice;

      const ngoAfter   = await ethers.provider.getBalance(ngo.address);
      const adminAfter = await ethers.provider.getBalance(admin.address);

      const fee    = (DONATE_SMALL * 2n) / 100n;       // 2%
      const payout = DONATE_SMALL - fee;

      expect(ngoAfter   - ngoBefore + gasCost).to.equal(payout);
      expect(adminAfter - adminBefore).to.equal(fee);
    });

    it("NGO withdraws early when target reached", async () => {
      const { campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: DONATE_FULL });
      await expect(campaign.connect(ngo).withdraw()).to.not.be.reverted;
    });

    it("Non-NGO cannot withdraw", async () => {
      const { campaign } = await deployAndActivate(0.001);
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });
      await time.increase(200);
      await expect(campaign.connect(stranger).withdraw())
        .to.be.revertedWith("Campaign: caller is not NGO wallet");
    });

    it("Cannot withdraw twice", async () => {
      const { campaign } = await deployAndActivate(0.001);
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });
      await time.increase(200);
      await campaign.connect(ngo).withdraw();
      await expect(campaign.connect(ngo).withdraw())
        .to.be.revertedWith("Campaign: not active");
    });
  });

  describe("Campaign — revoke() + claimRefund()", () => {
    it("Admin revokes, donors can claim refund", async () => {
      const { campaignId, campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });

      await factory.connect(admin).revokeCampaign(campaignId, "Fraudulent NGO detected");

      const before = await ethers.provider.getBalance(donor1.address);
      const tx     = await campaign.connect(donor1).claimRefund();
      const r      = await tx.wait();
      const gas    = r.gasUsed * tx.gasPrice;
      const after  = await ethers.provider.getBalance(donor1.address);

      expect(after - before + gas).to.equal(DONATE_SMALL);
      await expect(tx).to.emit(campaign, "RefundClaimed").withArgs(donor1.address, DONATE_SMALL);
    });

    it("Cannot refund from active campaign", async () => {
      const { campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });
      await expect(campaign.connect(donor1).claimRefund())
        .to.be.revertedWith("Campaign: not revoked");
    });

    it("Cannot double-refund", async () => {
      const { campaignId, campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: DONATE_SMALL });
      await factory.connect(admin).revokeCampaign(campaignId, "Fraud");
      await campaign.connect(donor1).claimRefund();
      await expect(campaign.connect(donor1).claimRefund())
        .to.be.revertedWith("Campaign: nothing to refund");
    });
  });

  // ── DonationLib ─────────────────────────────────────────────────────────────
  describe("DonationLib math via Campaign", () => {
    it("progressPercent is correct at 50%", async () => {
      const { campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: ethers.parseEther("5") });
      const details = await campaign.getDetails();
      expect(details[6]).to.equal(50n); // progressPercent
    });

    it("progressPercent caps at 100 when overfunded", async () => {
      const { campaign } = await deployAndActivate();
      await campaign.connect(donor1).donate({ value: ethers.parseEther("15") }); // > target
      const details = await campaign.getDetails();
      expect(details[6]).to.equal(100n);
    });
  });
});
