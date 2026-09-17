const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const artifact = require('../src/contracts/SatelliteEscrow.json');

async function testPartialRefund() {
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY environment variable is required");
    }
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const wallet = new ethers.Wallet(privateKey, provider);

    const contract = new ethers.Contract(artifact.address, artifact.abi, wallet);

    const bookingRef = "BKG-NOAA-002";
    const bookingId = ethers.keccak256(ethers.toUtf8Bytes(bookingRef));
    console.log(`Testing partial refund booking: ${bookingRef} -> ${bookingId}`);

    const existing = await contract.getEscrow(bookingId);
    if (existing.state === 0n) {
        console.log("Depositing escrow for BKG-NOAA-002 (0.0001 Sepolia ETH)...");
        const now = Math.floor(Date.now() / 1000);
        const txDeposit = await contract.depositEscrow(
            bookingId,
            wallet.address,
            now - 200,
            now + 3600,
            "NOAA-19",
            { value: ethers.parseEther("0.0001"), gasLimit: 500000 }
        );
        console.log(`Deposit tx: ${txDeposit.hash}`);
        await txDeposit.wait();
        console.log("Deposit confirmed!");
    }

    // Simulate 84.0% packet delivery (packet loss due to atmospheric interference)
    const telemetryPayload = {
        bookingId: bookingRef,
        groundStation: "NOAA Earth Observation Ingest (Svalbard, NO)",
        satellite: "NOAA-19",
        frequency: "1698.75 MHz (L-Band HRPT)",
        totalFrames: 1000,
        validFrames: 840,
        packetDeliveryPct: 84.0,
        snr: "9.2 dB",
        timestamp: new Date().toISOString()
    };

    const payloadString = JSON.stringify(telemetryPayload);
    const fingerprint = ethers.sha256(ethers.toUtf8Bytes(payloadString));
    const signature = await wallet.signMessage(ethers.getBytes(fingerprint));

    console.log("Calling contract settlePayment (84.0% -> 8400 BPS - Partial Refund)...");
    const txSettle = await contract.settlePayment(bookingId, 8400, fingerprint, { gasLimit: 500000 });
    console.log(`Partial refund settlement tx sent: ${txSettle.hash}`);
    console.log(`Etherscan link: https://sepolia.etherscan.io/tx/${txSettle.hash}`);
    await txSettle.wait();
    console.log("Partial refund transaction confirmed on Sepolia!");

    const updated = await contract.getEscrow(bookingId);
    console.log("Updated escrow status:", updated.state.toString(), "(4 = PartiallySettled)");
    console.log("Released to operator:", ethers.formatEther(updated.releaseAmount), "ETH");
    console.log("Refunded to buyer:", ethers.formatEther(updated.refundAmount), "ETH");
}

testPartialRefund().catch(console.error);
