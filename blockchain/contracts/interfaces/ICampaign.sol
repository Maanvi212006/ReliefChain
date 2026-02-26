// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ICampaign
 * @notice Interface that every Campaign contract must implement.
 *         Frontend and backend use this ABI to interact with any campaign.
 */
interface ICampaign {

    // ── Enums ────────────────────────────────────────────────────────────────
    enum Status { PENDING, ACTIVE, COMPLETED, REVOKED }

    // ── Events ───────────────────────────────────────────────────────────────
    event DonationReceived(address indexed donor, uint256 amount, uint256 totalRaised);
    event FundsWithdrawn(address indexed ngoWallet, uint256 amount, uint256 fee);
    event CampaignRevoked(address indexed admin, string reason);
    event RefundClaimed(address indexed donor, uint256 amount);

    // ── Core Functions ────────────────────────────────────────────────────────
    function donate() external payable;
    function withdraw() external;
    function revoke(string calldata reason) external;
    function claimRefund() external;

    // ── View Functions ────────────────────────────────────────────────────────
    function getDetails() external view returns (
        string  memory title,
        address ngoWallet,
        uint256 targetAmount,
        uint256 raisedAmount,
        uint256 deadline,
        uint8   status,
        uint256 progressPercent,
        uint256 donorCount
    );

    function getDonorAmount(address donor) external view returns (uint256);
    function getAllDonors()  external view returns (address[] memory);
    function isActive()      external view returns (bool);
}

