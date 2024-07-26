// @ts-ignore
const EC = require('elliptic').ec;
const BN = require('bn.js');
const { solidityPackedKeccak256, keccak256, getAddress, Contract, AbiCoder, Interface, WebSocketProvider, JsonRpcProvider } = require("ethers");
const abiCoder = new AbiCoder();

class ProofGenerator {
	elipticCurve;
	order;
	fieldSize;

	constructor(fieldSize) {
		this.elipticCurve = new EC('secp256k1');
		this.order = new BN(this.elipticCurve.curve.n.toString());
		this.fieldSize = new BN(fieldSize, 16);
	}

	numberToUint256(number) {
		let hexNumber = number.toString(16);
		return '0x' + '0'.repeat(64 - hexNumber.length) + hexNumber;
	}

	modPow(base, exponent, modulus) {
		let result = new BN(1);
		base = base.mod(modulus);

		while (exponent.gt(new BN(0))) {
			if (!exponent.isEven()) {
				result = result.mul(base).mod(modulus);
			}
			exponent = exponent.shrn(1);
			base = base.mul(base).mod(modulus);
		}
		return result;
	}

	toByteArray(integer) {
		let hexString = integer.toString(16);

		if (hexString.length % 2 !== 0) {
			hexString = '0' + hexString;
		}
		const numBytes = hexString.length / 2;
		const byteArray = new Uint8Array(numBytes);
		for (let i = 0; i < numBytes; i++) {
			byteArray[i] = parseInt(hexString.substr(i * 2, 2), 16);
		}
		return byteArray;
	}

	hashToCurve(pk, seed) {
		const domsep = this.numberToUint256(new BN(1));
		let concatenatedHex = (
			domsep
			+ this.numberToUint256(pk.getX()).slice(2)
			+ this.numberToUint256(pk.getY()).slice(2)
			+ this.numberToUint256(seed).slice(2)
		);

		let hash = keccak256(Buffer.from(concatenatedHex.slice(2), 'hex')).slice(2);
		let h = new BN(hash, 16);

		while (true) {
			try {
				let y2 = h.mul(h.mul(h).mod(this.fieldSize)).mod(this.fieldSize).add(new BN(7)).mod(this.fieldSize);
				let y = this.modPow(y2, this.fieldSize.add(new BN(1)).div(new BN(4)), this.fieldSize);
				let pt = this.elipticCurve.curve.point(h.toString(16), y.toString(16));
				if (!this.elipticCurve.curve.validate(pt)) {
					throw new Error("Invalid point");
				}
				return pt.getY().isEven() ? pt : pt.neg();
			} catch (e) {
				hash = keccak256(Buffer.from(this.numberToUint256(h).slice(2), 'hex')).slice(2);
				h = new BN(hash, 16);
			}
		}
	}

	ptToAddress(pt) {
		const ptXBytes = pt.x.toString(16).padStart(64, '0');
		const ptYBytes = pt.y.toString(16).padStart(64, '0');
		const hash = keccak256(Buffer.from(ptXBytes + ptYBytes, 'hex')).slice(2);
		return '0x' + hash.substring(hash.length - 40);
	}

	marshalPoint(pt) {
		const ptXBytes = pt.x.toString(16).padStart(64, '0');
		const ptYBytes = pt.y.toString(16).padStart(64, '0');
		return ptXBytes + ptYBytes;
	}

	ptToUint2562(pt) {
		return [pt.getX(), pt.getY()].map(p => '0x' + p.toString(16));
	}

	getPreSeed(agent, sender, subId, nonce) {
		return new BN(this.getPreSeedHash(agent, sender, subId, nonce).slice(2), 16);
	}

	getSeedBlockHashKeccak(seed, blockHash, privkey) {
		return new BN(solidityPackedKeccak256(['uint256', "bytes32", "bytes32"], [seed.toString(10), blockHash, this.hashOfPubKey(privkey)]).slice(2), 16);
	}

	getSeedBlockHashKeccakWithPublicKeyHash(seed, blockHash, pkHash) {
		return new BN(solidityPackedKeccak256(['uint256', "bytes32", "bytes32"], [seed.toString(10), blockHash, pkHash]).slice(2), 16);
	}

	getPreSeedHash(agent, sender, subId, nonce) {
		return keccak256(abiCoder.encode(
			["address", "address", "uint64", "uint64"],
			[agent, getAddress(sender), subId, nonce]
		));
	}

	getRequestId(agent, preSeed) {
		return new BN(keccak256(abiCoder.encode(
			["address", "uint256"],
			[agent, preSeed.toString(10)]
		)).slice(2), 16).toString(10);
	}

	hashOfPubKey(privkey) {
		const pkhHex = keccak256(this.toByteArray(privkey)).slice(2);
		const pkh = new BN(pkhHex, 16);

		const generator = this.elipticCurve.g;
		const pubkey = generator.mul(pkh);
		return this.hashOfKey(pubkey);
	}

	getPubKeyArray(privkey) {
		const pkhHex = keccak256(this.toByteArray(privkey)).slice(2);
		const pkh = new BN(pkhHex, 16);

		const generator = this.elipticCurve.g;
		const pubkey = generator.mul(pkh);
		return this.ptToUint2562(pubkey);
	}

	hashOfKey(pubk) {
		return solidityPackedKeccak256(["uint256[]"], [this.ptToUint2562(pubk)]);
	}

	hashMuchToScalar(h, pubk, gamma, uw, v) {
		const chlinkDomSep = 2;
		return solidityPackedKeccak256(
			["uint256", "uint256[]", "uint256[]", "uint256[]", "uint256[]", "address"],
			[chlinkDomSep, this.ptToUint2562(h), this.ptToUint2562(pubk), this.ptToUint2562(gamma), this.ptToUint2562(v), getAddress(uw)],
		);
	}

	ptToStr(pt) {
		return [pt.getX().toString(16), pt.getY().toString(16)];
	}

	genProofWithNonce(seed, nonce, pkhHash) {
		const pkh = new BN(pkhHash, 16);

		const generator = this.elipticCurve.g;
		const pubkey = generator.mul(pkh);

		const h = this.hashToCurve(pubkey, seed);

		const gamma = h.mul(pkh);
		const u = generator.mul(new BN(nonce));

		const witness = this.ptToAddress(u);

		const v = h.mul(new BN(nonce));

		const cHex = this.hashMuchToScalar(h, pubkey, gamma, witness, v);
		const c = new BN(cHex.slice(2), 16);

		const s = new BN(nonce).sub(c.mul(pkh)).umod(this.elipticCurve.curve.n);

		const output = this.numberToUint256(3) + this.marshalPoint(gamma);

		const outputHashHex = keccak256(Buffer.from(output.slice(2), 'hex')).slice(2);
		const outputHash = '0x' + outputHashHex;

		return {
			pubkey: pubkey,
			gamma: gamma,
			c: c.toString(16),
			s: s.toString(16),
			seed: seed,
			output: outputHash
		};
	}

	PROJECTIVE_MULTIPLICATION(x1, z1, x2, z2) {
		return [x1.mul(x2), z1.mul(z2)];
	}

	PROJECTIVE_SUBTRACTION(x1, z1, x2, z2) {
		let p1 = z2.mul(x1);
		let p2 = x2.mul(z1).neg();
		let sum = p1.add(p2).mod(this.fieldSize);

		if (sum.isNeg()) {
			sum = sum.add(this.fieldSize);
		}

		let product = z1.mul(z2).mod(this.fieldSize);

		if (product.isNeg()) {
			product = product.add(this.fieldSize);
		}

		return [sum, product];
	}

	PROJECTIVE_ECCADDITION(pt1, pt2) {
		let x1 = new BN(pt1.x, 10), y1 = new BN(pt1.y, 10);
		let x2 = new BN(pt2.x, 10), y2 = new BN(pt2.y, 10);
		let z1 = new BN(1), z2 = new BN(1);
		let [lx, lz] = [y2.sub(y1), x2.sub(x1)];
		let [sx, dx] = this.PROJECTIVE_MULTIPLICATION(lx, lz, lx, lz);
		[sx, dx] = this.PROJECTIVE_SUBTRACTION(sx, dx, x1, z1);
		[sx, dx] = this.PROJECTIVE_SUBTRACTION(sx, dx, x2, z2);
		let [sy, dy] = this.PROJECTIVE_SUBTRACTION(x1, z1, sx, dx);
		[sy, dy] = this.PROJECTIVE_MULTIPLICATION(sy, dy, lx, lz);
		[sy, dy] = this.PROJECTIVE_SUBTRACTION(sy, dy, y1, z1);
		let sz;
		if (!dx.eq(dy)) {
			sx = sx.mul(dy);
			sy = sy.mul(dx);
			sz = dx.mul(dy);
		} else {
			sz = dx;
		}
		return [sx.mod(this.fieldSize), sy.mod(this.fieldSize), sz.mod(this.fieldSize)];
	}

	modinvPRIME(a, ord) {
		return a.toRed(BN.red(ord)).redInvm().fromRed();
	}

	solProofAsInChlink(seed, nonce, privkeyHash) {
		const proof = this.genProofWithNonce(seed, nonce, privkeyHash);

		const cPoint = this.elipticCurve.keyFromPublic(proof.pubkey).getPublic().mul(new BN(proof.c, 16));
		const sGPoint = this.elipticCurve.g.mul(new BN(proof.s, 16));
		const u = cPoint.add(sGPoint);

		const hash = this.hashToCurve(proof.pubkey, proof.seed);

		const cgw = this.elipticCurve.keyFromPublic(proof.gamma).getPublic().mul(new BN(proof.c, 16));
		const shw = this.elipticCurve.keyFromPublic(hash).getPublic().mul(new BN(proof.s, 16));
		const [_, __, PROJDENOM] = this.PROJECTIVE_ECCADDITION(cgw, shw);

		const zinv = this.modinvPRIME(new BN(PROJDENOM), this.fieldSize);

		return {
			proof: proof,
			uw: this.ptToAddress(u),
			cgw: cgw,
			shw: shw,
			zinv: zinv.toString(16)
		};
	}

	ptToArr(pt) {
		return [this.numberToUint256(pt.getX()), this.numberToUint256(pt.getY())]
	}

	ptToArrNat(pt) {
		return ["0x" + pt.getX().toString(16), "0x" + pt.getY().toString(16)]
	}

	formatProofAsProof(proof, preSeed) {
		return [
			this.ptToArrNat(proof["proof"]["pubkey"]),
			this.ptToArrNat(proof["proof"]["gamma"]),
			"0x" + proof["proof"]["c"],
			"0x" + proof["proof"]["s"],
			'0x' + preSeed.toString(16),
			getAddress(proof["uw"]),
			this.ptToArrNat(proof["cgw"]),
			this.ptToArrNat(proof["shw"]),
			"0x" + proof["zinv"],
		]
	}

	encodeProof(formattedProof, abiJsonString, contractAddress) {
		const contract = new Contract(contractAddress, JSON.parse(abiJsonString));
		return contract.interface.encodeFunctionData('verifyVRFProof', formattedProof);
	}
}

const g = new ProofGenerator("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");

(async () => {
	const params = JSON.parse(process.argv[2]);
	const {agent: agentAddress, resolverContractAddress, resolverCalldata, rpcUrl, chainId, from} = params;
	const agentApiHost = process.env.AGENT_API_HOST || 'http://localhost:8099';
	console.log('agentApiHost', agentApiHost);

	try {
		let provider;
		if (rpcUrl.indexOf('ws') === 0) {
			provider = new WebSocketProvider(rpcUrl, chainId);
		} else {
			provider = new JsonRpcProvider(rpcUrl, chainId);
		}

		const consumerAbi = JSON.parse('[{"inputs":[],"name":"getRequestData","outputs":[{"internalType":"uint256","name":"subscriptionId","type":"uint256"},{"internalType":"uint256","name":"requestAtBlock","type":"uint256"},{"internalType":"bytes32","name":"requestAtBlockHash","type":"bytes32"},{"internalType":"uint256","name":"requestId","type":"uint256"},{"internalType":"uint64","name":"requestNonce","type":"uint64"},{"internalType":"uint32","name":"numbRandomWords","type":"uint32"},{"internalType":"uint32","name":"callbackGasLimit","type":"uint32"}],"stateMutability":"view","type":"function"}]');
		const consumer = new Contract(resolverContractAddress, consumerAbi, provider);
		const [subscriptionId, requestAtBlock, requestAtBlockHash, requestId, requestNonce, numbRandomWords, callbackGasLimit] = await consumer.getRequestData();
		console.log('requestAtBlock', requestAtBlock, 'requestAtBlockHash', requestAtBlockHash, 'requestId', requestId);
		console.log('agentAddress', agentAddress, 'resolverContractAddress', resolverContractAddress, 'subscriptionId', subscriptionId, 'requestNonce', requestNonce);
		const seed = g.getPreSeed(resolverContractAddress, resolverContractAddress, subscriptionId, requestNonce);
		console.log('seed', seed);

		const {hash: publicKeyHash} = await fetch(`${agentApiHost}/api/v1/public-key-hash/${params.from}`).then(r => r.json());
		const {hash: privateKeyHash} = await fetch(`${agentApiHost}/api/v1/private-key-hash/${params.from}`).then(r => r.json());
		console.log('publicKeyHash', publicKeyHash, 'privateKeyHash', privateKeyHash);
		const seedBlockHash = g.getSeedBlockHashKeccakWithPublicKeyHash(seed, requestAtBlockHash, publicKeyHash);
		const proofAsInChlink = g.solProofAsInChlink(seedBlockHash, requestNonce, privateKeyHash);
		const formattedProof = g.formatProofAsProof(proofAsInChlink, seed);

		const coordinatorAbi = JSON.parse('[{"inputs":[{"components":[{"internalType":"uint256[2]","name":"pk","type":"uint256[2]"},{"internalType":"uint256[2]","name":"gamma","type":"uint256[2]"},{"internalType":"uint256","name":"c","type":"uint256"},{"internalType":"uint256","name":"s","type":"uint256"},{"internalType":"uint256","name":"seed","type":"uint256"},{"internalType":"address","name":"uWitness","type":"address"},{"internalType":"uint256[2]","name":"cGammaWitness","type":"uint256[2]"},{"internalType":"uint256[2]","name":"sHashWitness","type":"uint256[2]"},{"internalType":"uint256","name":"zInv","type":"uint256"}],"internalType":"struct VRF.Proof","name":"proof","type":"tuple"},{"components":[{"internalType":"uint64","name":"blockNum","type":"uint64"},{"internalType":"uint64","name":"subId","type":"uint64"},{"internalType":"uint32","name":"callbackGasLimit","type":"uint32"},{"internalType":"uint32","name":"numWords","type":"uint32"},{"internalType":"address","name":"sender","type":"address"}],"internalType":"struct VRFAgentCoordinator.RequestCommitment","name":"rc","type":"tuple"}],"name":"fulfillRandomWords","outputs":[],"stateMutability":"nonpayable","type":"function"}]')
		const coordinatorInterface = new Interface(coordinatorAbi);
		console.log('[RESULT_TX_DATA]:', coordinatorInterface.encodeFunctionData('fulfillRandomWords', [formattedProof, {
			sender: resolverContractAddress,
			numWords: numbRandomWords,
			blockNum: requestAtBlock,
			subId: subscriptionId,
			callbackGasLimit,
		}]));
	} catch (e) {
		console.error('VRFProofGenerator error', e);
	}
})();