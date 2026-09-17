const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function compileContract() {
    console.log("Compiling SatelliteEscrow.sol...");
    const contractPath = path.join(__dirname, '..', 'contracts', 'SatelliteEscrow.sol');
    const source = fs.readFileSync(contractPath, 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'SatelliteEscrow.sol': {
                content: source,
            },
        },
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
        let hasError = false;
        output.errors.forEach((err) => {
            if (err.severity === 'error') {
                console.error(err.formattedMessage);
                hasError = true;
            } else {
                console.warn(err.formattedMessage);
            }
        });
        if (hasError) {
            throw new Error("Compilation failed");
        }
    }

    const contract = output.contracts['SatelliteEscrow.sol']['SatelliteEscrow'];
    const abi = contract.abi;
    const bytecode = contract.evm.bytecode.object;

    console.log("Compilation successful!");
    return { abi, bytecode };
}

async function main() {
    const { abi, bytecode } = await compileContract();

    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("DEPLOYER_PRIVATE_KEY environment variable is required");
    }
    const rpcUrls = [
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://1rpc.io/sepolia',
        'https://rpc2.sepolia.org',
        'https://rpc.sepolia.org'
    ];

    let provider = null;
    for (const rpc of rpcUrls) {
        try {
            const p = new ethers.JsonRpcProvider(rpc);
            const net = await p.getNetwork();
            console.log(`Connected to Sepolia via ${rpc}, chainId: ${net.chainId}`);
            provider = p;
            break;
        } catch (e) {
            console.warn(`RPC ${rpc} failed, trying next...`);
        }
    }

    if (!provider) {
        throw new Error("Failed to connect to any Sepolia RPC");
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Deployer: ${wallet.address}`);
    console.log(`Balance: ${ethers.formatEther(balance)} Sepolia ETH`);

    if (balance === 0n) {
        throw new Error("Deployer has 0 balance!");
    }

    // Deploy contract
    console.log("Deploying SatelliteEscrow...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    // Oracle address is the deployer wallet (acting as oracle relayer)
    const oracleAddress = wallet.address;
    const contract = await factory.deploy(oracleAddress, {
        gasLimit: 3000000
    });

    console.log(`Deployment transaction sent: ${contract.deploymentTransaction().hash}`);
    console.log("Waiting for confirmation on Sepolia...");
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    console.log(`>>> SatelliteEscrow deployed successfully at: ${contractAddress}`);

    const contractArtifact = {
        address: contractAddress,
        network: "sepolia",
        chainId: 11155111,
        deployer: wallet.address,
        oracleAddress: oracleAddress,
        deploymentTx: contract.deploymentTransaction().hash,
        deployedAt: new Date().toISOString(),
        abi: abi,
        bytecode: bytecode
    };

    // Save in backend
    const backendOutDir = path.join(__dirname, '..', 'src', 'contracts');
    if (!fs.existsSync(backendOutDir)) {
        fs.mkdirSync(backendOutDir, { recursive: true });
    }
    fs.writeFileSync(
        path.join(backendOutDir, 'SatelliteEscrow.json'),
        JSON.stringify(contractArtifact, null, 2)
    );
    console.log(`Saved backend contract artifact to ${path.join(backendOutDir, 'SatelliteEscrow.json')}`);

    // Save in frontend
    const frontendOutDir = path.join(__dirname, '..', '..', 'DSRM', 'src', 'contracts');
    if (!fs.existsSync(frontendOutDir)) {
        fs.mkdirSync(frontendOutDir, { recursive: true });
    }
    fs.writeFileSync(
        path.join(frontendOutDir, 'SatelliteEscrow.json'),
        JSON.stringify(contractArtifact, null, 2)
    );
    console.log(`Saved frontend contract artifact to ${path.join(frontendOutDir, 'SatelliteEscrow.json')}`);

    return contractArtifact;
}

if (require.main === module) {
    main().catch(err => {
        console.error("Deployment failed:", err);
        process.exit(1);
    });
}

module.exports = { compileContract, main };
