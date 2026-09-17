const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const artifact = require('../src/contracts/SatelliteEscrow.json');

async function testSettlement() {
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY environment variable is required");
    }
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Connected to Sepolia with oracle wallet: ${wallet.address}`);
    const contract = new ethers.Contract(artifact.address, artifact.abi, wallet);

    // 1. Create a booking ID
    const bookingRef = "BKG-SATNOGS-001";
    const bookingId = ethers.keccak256(ethers.toUtf8Bytes(bookingRef));
    console.log(`Testing booking: ${bookingRef} -> ${bookingId}`);

    // Check if already exists
    const existing = await contract.getEscrow(bookingId);
    if (existing.state === 0n) { // Inactive
        console.log("Depositing test escrow (0.0001 Sepolia ETH)...");
        const now = Math.floor(Date.now() / 1000);
        const txDeposit = await contract.depositEscrow(
            bookingId,
            wallet.address,
            now - 300,
            now + 3600,
            "STARLINK-32573",
            { value: ethers.parseEther("0.0001"), gasLimit: 500000 }
        );
        console.log(`Deposit tx: ${txDeposit.hash}`);
        await txDeposit.wait();
        console.log("Deposit confirmed!");
    } else {
        console.log(`Escrow already in state ${existing.state}`);
    }

    // 2. Simulate Oracle Attestation
    const telemetryPayload = {
        bookingId: bookingRef,
        groundStation: "SatNOGS Ground Station #1428 - Bangalore",
        satellite: "STARLINK-32573",
        frequency: "2245.00 MHz (S-Band)",
        totalFrames: 1000,
        validFrames: 984,
        packetDeliveryPct: 98.4,
        snr: "14.8 dB",
        timestamp: new Date().toISOString()
    };

    const payloadString = JSON.stringify(telemetryPayload);
    const fingerprint = ethers.sha256(ethers.toUtf8Bytes(payloadString));
    const signature = await wallet.signMessage(ethers.getBytes(fingerprint));
    console.log(`Telemetry SHA-256 fingerprint: ${fingerprint}`);
    console.log(`Oracle ECDSA Signature: ${signature}`);

    // 3. Settle on-chain via settlePayment
    console.log("Calling contract settlePayment (98.4% -> 9840 BPS)...");
    const txSettle = await contract.settlePayment(bookingId, 9840, fingerprint, { gasLimit: 500000 });
    console.log(`Settlement tx sent: ${txSettle.hash}`);
    console.log(`Etherscan link: https://sepolia.etherscan.io/tx/${txSettle.hash}`);
    await txSettle.wait();
    console.log("Settlement transaction confirmed on Sepolia!");

    // Check updated state
    const updated = await contract.getEscrow(bookingId);
    console.log("Updated escrow status:", updated.state.toString());
    console.log("Released amount:", ethers.formatEther(updated.releaseAmount), "ETH");
    console.log("Refunded amount:", ethers.formatEther(updated.refundAmount), "ETH");
}

testSettlement().catch(console.error);
