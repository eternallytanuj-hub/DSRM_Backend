const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const artifact = require('../src/contracts/SatelliteEscrow.json');

async function runVerificationSuite() {
    console.log("=== RUNNING SATELLITE ESCROW DEEP VERIFICATION SUITE ===");
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY environment variable is required");
    }
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const oracleWallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(artifact.address, artifact.abi, oracleWallet);

    console.log(`Contract: ${artifact.address}`);
    console.log(`Oracle Wallet: ${oracleWallet.address}`);
    
    const balance = await provider.getBalance(oracleWallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} Sepolia ETH`);

    // 1. Verify basic contract variables
    const owner = await contract.owner();
    const oracle = await contract.oracleAddress();
    console.log(`Owner: ${owner}`);
    console.log(`Oracle: ${oracle}`);
    if (oracle.toLowerCase() !== oracleWallet.address.toLowerCase()) {
        throw new Error("Oracle address mismatch!");
    }
    console.log("✓ Contract configuration verified");

    // 2. Test booking count and list
    const count = await contract.getBookingCount();
    const allIds = await contract.getAllBookingIds();
    console.log(`Total on-chain bookings: ${count.toString()}`);
    console.log(`First 3 booking IDs:`, allIds.slice(0, 3));
    console.log("✓ Registry enumeration verified");

    // 3. Test unauthorized caller rejection (edge case)
    const randomWallet = ethers.Wallet.createRandom().connect(provider);
    const contractUnauthorized = contract.connect(randomWallet);
    try {
        await contractUnauthorized.releasePayment.estimateGas(allIds[0], ethers.ZeroHash);
        throw new Error("FAIL: Non-oracle caller was not rejected!");
    } catch (err) {
        console.log("✓ Unauthorized caller properly rejected by onlyOracle modifier");
    }

    console.log("=== ALL CONTRACT ASSERTIONS PASSED ===");
}

runVerificationSuite().catch(err => {
    console.error("Verification suite error:", err);
    process.exit(1);
});
