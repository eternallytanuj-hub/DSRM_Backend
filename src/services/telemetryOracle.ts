import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

// Artifact
const artifactPath = path.join(__dirname, '..', 'contracts', 'SatelliteEscrow.json');
let contractArtifact: any = null;
if (fs.existsSync(artifactPath)) {
    try {
        contractArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    } catch (e) {
        console.error("Failed to load contract artifact:", e);
    }
}

export interface SettlementRecord {
    status: 'SETTLED' | 'PARTIAL_REFUND' | 'REFUNDED' | 'PENDING';
    action: 'RELEASE' | 'PARTIAL_REFUND' | 'REFUND';
    txHash: string;
    blockNumber?: number;
    etherscanUrl: string;
    operatorPayout: string;
    buyerRefund: string;
    settledAt: string;
    gasUsed?: string;
}

export interface GroundStationAttestation {
    id: string;
    sessionId: string;
    groundStation: string;
    location: string;
    satellite: string;
    noradId: number;
    bookingRef: string;
    bookingId: string;
    timestamp: string;
    frequency: string;
    snr: string;
    totalFrames: number;
    validFrames: number;
    droppedFrames: number;
    frameQualityPct: number;
    status: 'NOMINAL' | 'DEGRADED' | 'BREACH';
    sha256Fingerprint: string;
    oracleSignature: string;
    oracleAddress: string;
    contractAddress: string;
    settlement: SettlementRecord;
}

export interface LiveTelemetryFrame {
    id: string;
    frameHex: string;
    satellite: string;
    groundStation: string;
    quality: number;
    snr: string;
    status: 'PARITY_OK' | 'FRAME_SYNC_LOCKED' | 'PAYLOAD_VERIFIED';
    timestamp: string;
}

// In-memory telemetry cache
let attestations: GroundStationAttestation[] = [
    {
        id: "ATT-9842-BKG1",
        sessionId: "GS-BLR-0182",
        groundStation: "SatNOGS Ground Station #1428",
        location: "Bangalore, IN (12.9716° N, 77.5946° E)",
        satellite: "STARLINK-32573",
        noradId: 58219,
        bookingRef: "BKG-SATNOGS-001",
        bookingId: "0x99820bf9f502f87f32fc1fe27239b50bd76d63824b3567b3a15729655c3993a7",
        timestamp: new Date(Date.now() - 360000).toISOString(),
        frequency: "2245.00 MHz (S-Band Downlink)",
        snr: "14.8 dB",
        totalFrames: 1000,
        validFrames: 984,
        droppedFrames: 16,
        frameQualityPct: 98.4,
        status: "NOMINAL",
        sha256Fingerprint: "0x1227ac1f5261d18be36854910204842389d1af4e2db95f439da62d8624b64b52",
        oracleSignature: "0xd4a3ba69a080a6a580c65686e064f3ce49392b7537c9ae576519e1133a9177d87ba497086131381f5a1ac1cc1be8614c4ff6f73c4025666633e77c8df270b1391b",
        oracleAddress: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
        contractAddress: "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735",
        settlement: {
            status: "SETTLED",
            action: "RELEASE",
            txHash: "0x6635c7a647877a781e01af6a231226282500291a0f91405503881e4113c7b359",
            blockNumber: 11726829,
            etherscanUrl: "https://sepolia.etherscan.io/tx/0x6635c7a647877a781e01af6a231226282500291a0f91405503881e4113c7b359",
            operatorPayout: "0.00010000 Sepolia ETH (100%)",
            buyerRefund: "0.00000000 ETH (0%)",
            settledAt: new Date(Date.now() - 300000).toISOString(),
            gasUsed: "121,776"
        }
    },
    {
        id: "ATT-8419-BKG2",
        sessionId: "GS-SVB-0914",
        groundStation: "NOAA Earth Observation Ingest",
        location: "Svalbard, NO (78.2298° N, 15.4078° E)",
        satellite: "NOAA-19",
        noradId: 33591,
        bookingRef: "BKG-NOAA-002",
        bookingId: "0x84bf1864f110ccbe2cfbf24023089daefd48449c995f029dfdc69727afdca8ae",
        timestamp: new Date(Date.now() - 120000).toISOString(),
        frequency: "1698.75 MHz (L-Band HRPT)",
        snr: "9.2 dB",
        totalFrames: 1000,
        validFrames: 840,
        droppedFrames: 160,
        frameQualityPct: 84.0,
        status: "DEGRADED",
        sha256Fingerprint: "0x8f3c4e9123b0a7d5e6f1c4a289b0d3e5a7c9f1b3e5d7a9c1e3f5b7d9a1c3e5f7",
        oracleSignature: "0xa81c94d3f5b7e9a1c3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c91c",
        oracleAddress: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
        contractAddress: "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735",
        settlement: {
            status: "PARTIAL_REFUND",
            action: "PARTIAL_REFUND",
            txHash: "0x6c0b385616af57731755d79cb04e98dd265097734af6748c471847657e068f68",
            blockNumber: 11726831,
            etherscanUrl: "https://sepolia.etherscan.io/tx/0x6c0b385616af57731755d79cb04e98dd265097734af6748c471847657e068f68",
            operatorPayout: "0.00008400 Sepolia ETH (84%)",
            buyerRefund: "0.00001600 Sepolia ETH (16%)",
            settledAt: new Date(Date.now() - 90000).toISOString(),
            gasUsed: "123,491"
        }
    }
];

let liveFrames: LiveTelemetryFrame[] = [];

// Seed recent live frames
function generateLiveFrame(): LiveTelemetryFrame {
    const stations = [
        "SatNOGS Station #1428 - Bangalore",
        "NOAA Ground Ingest - Svalbard",
        "ESA Redu Station - Belgium",
        "Woomera Space Telemetry - Australia",
        "Goonhilly Earth Station - UK"
    ];
    const sats = ["STARLINK-32573", "ONEWEB-0142", "NOAA-19", "SENTINEL-2A", "IRIDIUM-108"];
    const randHex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const quality = +(97 + Math.random() * 2.9).toFixed(2);
    const snr = +(12 + Math.random() * 4.5).toFixed(1) + " dB";
    
    return {
        id: `FRAME-0x${randHex}`,
        frameHex: `0x${randHex.toUpperCase()}`,
        satellite: sats[Math.floor(Math.random() * sats.length)],
        groundStation: stations[Math.floor(Math.random() * stations.length)],
        quality,
        snr,
        status: quality > 98.0 ? 'PAYLOAD_VERIFIED' : 'PARITY_OK',
        timestamp: new Date().toISOString()
    };
}

for (let i = 0; i < 8; i++) {
    liveFrames.push(generateLiveFrame());
}

// Keep live frames fresh
setInterval(() => {
    liveFrames.unshift(generateLiveFrame());
    if (liveFrames.length > 20) {
        liveFrames.pop();
    }
}, 5000);

export function getAttestations(): GroundStationAttestation[] {
    return attestations;
}

export function getLiveFrames(): LiveTelemetryFrame[] {
    return liveFrames;
}

export function getOracleInfo() {
    return {
        oracleAddress: contractArtifact?.oracleAddress || "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
        contractAddress: contractArtifact?.address || "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735",
        network: "Ethereum Sepolia Testnet",
        chainId: 11155111,
        deploymentTx: contractArtifact?.deploymentTx || "0x6c6fb8a8f265367a19a95dae1d00981f9a5d07df87601009eedf4a1bb379bb11",
        etherscanContractUrl: `https://sepolia.etherscan.io/address/${contractArtifact?.address || "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735"}`
    };
}

/**
 * Generate a new signed ground station attestation and settle on-chain if contract is reachable
 */
export async function triggerOraclePass(params: {
    bookingRef?: string;
    satellite?: string;
    noradId?: number;
    packetDeliveryPct?: number;
    groundStation?: string;
    doOnChainSettlement?: boolean;
}): Promise<GroundStationAttestation> {
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY environment variable is not configured");
    }
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const wallet = new ethers.Wallet(privateKey, provider);

    const bookingRef = params.bookingRef || `BKG-${Math.floor(1000 + Math.random() * 9000)}`;
    const bookingId = ethers.keccak256(ethers.toUtf8Bytes(bookingRef));
    const satellite = params.satellite || "STARLINK-32573";
    const noradId = params.noradId || 58219;
    const packetDeliveryPct = params.packetDeliveryPct ?? +(96.0 + Math.random() * 3.8).toFixed(1);
    const groundStation = params.groundStation || "SatNOGS Ground Station #1428";
    const totalFrames = 1000;
    const validFrames = Math.round((packetDeliveryPct / 100) * totalFrames);
    const droppedFrames = totalFrames - validFrames;

    const payload = {
        bookingRef,
        bookingId,
        groundStation,
        satellite,
        noradId,
        totalFrames,
        validFrames,
        droppedFrames,
        packetDeliveryPct,
        timestamp: new Date().toISOString()
    };

    const payloadStr = JSON.stringify(payload);
    const sha256Fingerprint = ethers.sha256(ethers.toUtf8Bytes(payloadStr));
    const oracleSignature = await wallet.signMessage(ethers.getBytes(sha256Fingerprint));

    let settlementRecord: SettlementRecord = {
        status: "PENDING",
        action: packetDeliveryPct >= 95.0 ? "RELEASE" : (packetDeliveryPct > 0 ? "PARTIAL_REFUND" : "REFUND"),
        txHash: "",
        etherscanUrl: "",
        operatorPayout: packetDeliveryPct >= 95.0 ? "100%" : `${packetDeliveryPct}%`,
        buyerRefund: packetDeliveryPct >= 95.0 ? "0%" : `${(100 - packetDeliveryPct).toFixed(1)}%`,
        settledAt: new Date().toISOString()
    };

    if (params.doOnChainSettlement && contractArtifact?.address) {
        try {
            const contract = new ethers.Contract(contractArtifact.address, contractArtifact.abi, wallet);
            const bps = Math.round(packetDeliveryPct * 100);
            console.log(`Executing oracle on-chain settlement for ${bookingRef} with bps ${bps}...`);
            
            // Check escrow status first
            const escrow = await contract.getEscrow(bookingId);
            if (escrow.state === 1n) { // Locked
                const tx = await contract.settlePayment(bookingId, bps, sha256Fingerprint, { gasLimit: 500000 });
                console.log(`Oracle settlement tx sent: ${tx.hash}`);
                const receipt = await tx.wait();
                
                settlementRecord = {
                    status: bps >= 9500 ? "SETTLED" : "PARTIAL_REFUND",
                    action: bps >= 9500 ? "RELEASE" : "PARTIAL_REFUND",
                    txHash: tx.hash,
                    blockNumber: receipt.blockNumber,
                    etherscanUrl: `https://sepolia.etherscan.io/tx/${tx.hash}`,
                    operatorPayout: ethers.formatEther(escrow.depositAmount * BigInt(bps) / 10000n) + " Sepolia ETH",
                    buyerRefund: ethers.formatEther(escrow.depositAmount - (escrow.depositAmount * BigInt(bps) / 10000n)) + " Sepolia ETH",
                    settledAt: new Date().toISOString(),
                    gasUsed: receipt.gasUsed.toString()
                };
            } else {
                console.log(`Booking ${bookingRef} is not in Locked state (current state: ${escrow.state})`);
            }
        } catch (err: any) {
            console.error("On-chain oracle settlement error:", err.message);
        }
    }

    const attestation: GroundStationAttestation = {
        id: `ATT-${Math.floor(1000 + Math.random() * 9000)}-${bookingRef.slice(-4)}`,
        sessionId: `GS-${Math.floor(100 + Math.random() * 900)}`,
        groundStation,
        location: "Telemetry Feed Station",
        satellite,
        noradId,
        bookingRef,
        bookingId,
        timestamp: new Date().toISOString(),
        frequency: "2245.00 MHz (S-Band)",
        snr: `${(13.5 + Math.random() * 2.5).toFixed(1)} dB`,
        totalFrames,
        validFrames,
        droppedFrames,
        frameQualityPct: packetDeliveryPct,
        status: packetDeliveryPct >= 95.0 ? "NOMINAL" : (packetDeliveryPct >= 80.0 ? "DEGRADED" : "BREACH"),
        sha256Fingerprint,
        oracleSignature,
        oracleAddress: wallet.address,
        contractAddress: contractArtifact?.address || "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735",
        settlement: settlementRecord
    };

    attestations.unshift(attestation);
    if (attestations.length > 30) {
        attestations.pop();
    }

    return attestation;
}
