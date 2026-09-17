const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const artifact = require('../src/contracts/SatelliteEscrow.json');

async function testRefund() {
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY environment variable is required");
    }
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Connected to Sepolia with wallet: ${wallet.address}`);
    const contract = new ethers.Contract(artifact.address, artifact.abi, wallet);

    const bookingRef = `BKG-REFUND-${Date.now().toString(36).toUpperCase()}`;
    const bookingId = ethers.keccak256(ethers.toUtf8Bytes(bookingRef));
    console.log(`Testing refund for booking: ${bookingRef} -> ${bookingId}`);

    // 1. Deposit micro-escrow
    const now = Math.floor(Date.now() / 1000);
    console.log("Depositing test escrow (0.00005 Sepolia ETH)...");
    const txDeposit = await contract.depositEscrow(
        bookingId,
        wallet.address,
        now - 300,
        now + 1800,
        "METEOSAT-TEST",
        { value: ethers.parseEther("0.00005"), gasLimit: 500000 }
    );
    console.log(`Deposit tx: ${txDeposit.hash}`);
    await txDeposit.wait();
    console.log("Deposit confirmed!");

    // 2. Oracle triggers refundBuyer
    console.log("Calling contract refundBuyer...");
    const txRefund = await contract.refundBuyer(
        bookingId,
        "Atmospheric blackout: complete frame sync failure",
        { gasLimit: 500000 }
    );
    console.log(`Refund tx sent: ${txRefund.hash}`);
    console.log(`Etherscan link: https://sepolia.etherscan.io/tx/${txRefund.hash}`);
    const receipt = await txRefund.wait();
    console.log(`Refund confirmed in block: ${receipt.blockNumber}`);

    const updated = await contract.getEscrow(bookingId);
    console.log("Updated escrow status:", updated.state.toString(), "(3 = Refunded)");
    console.log("Refunded amount:", ethers.formatEther(updated.refundAmount), "ETH");
}

testRefund().catch(console.error);
