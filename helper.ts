import {ethers} from 'ethers';
import fs from "fs";
import BN from 'bn.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Ipfs from "./ipfs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// async function stringToIpfsHash(str): Promise<string> {
//     const code = 0x55;
//     const bytes = new TextEncoder().encode(str);
//     return sha256.digest(bytes).then(res => CID.createV1(code, res)).then(cid => cid.toString());
// }
// async function fileToIpfsHash(path): Promise<string> {
//     const code = 0x55;
//     return sha256.digest(fs.readFileSync(path)).then(res => CID.createV1(code, res)).then(cid => cid.toString());
// }

function isIpfsHash(value) {
    return true;
    if (!value) {
        return false;
    }
    return (startsWith(value, 'Qm') || isCidHash(value)) && /^\w+$/.test(value);
}

function isCidHash(value) {
    if (!value) {
        return false;
    }
    return startsWith(value.codec, 'dag-') || (isString(value) && value.length === 59 && /^\w+$/.test(value) && (startsWith(value, 'zd') || startsWith(value, 'ba')));
}

function startsWith(string, substr) {
    return string.indexOf(substr) === 0;
}

function isString(str) {
    return typeof str === 'string' || str instanceof String;
}

function toByteArray(integer) {
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

function hashOfPubKey(wallet, elipticCurve) {
    const privateKey = Number(BigInt(wallet.signingKey.privateKey));
    const pkhHex = ethers.keccak256(toByteArray(privateKey)).slice(2);
    const pkh = new BN(pkhHex, 16);

    const pubkey = elipticCurve.g.mul(pkh);
    return hashOfKey(pubkey);
}

function hashOfKey(pubk) {
    return ethers.solidityPackedKeccak256(["uint256[]"], [ptToUint2562(pubk)]);
}

function ptToUint2562(pt) {
    return [pt.getX(), pt.getY()].map(p => '0x' + p.toString(16));
}

function hashOfPrivateKey(wallet) {
    const privateKey = Number(BigInt(wallet.signingKey.privateKey));
    return ethers.keccak256(toByteArray(privateKey)).slice(2);
}

function basePath() {
    return (process.env.COMPOSE_MODE ? '' : `${__dirname}`);
}

function getDirPath(dirName) {
    return join(basePath(), `${dirName}`);
}

async function writeScriptsPathToDir(ipfs: Ipfs, scriptPathByIpfsHash, dirName) {
    const scriptsDir = getDirPath(dirName);
    console.log('writeScriptsPathToDir scriptsDir', scriptsDir);
    if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir);
        return;
    }
    const localScripts = fs.readdirSync(scriptsDir);
    for (let i = 0; i < localScripts.length; i++) {
        const fileName = localScripts[i];
        const scriptPath = `${scriptsDir}/${fileName}`;
        scriptPathByIpfsHash[await ipfs.saveFile(scriptPath)] = `${getDirPath(dirName)}/${fileName}`;
    }
}

export {
    getDirPath,
    writeScriptsPathToDir,
    // stringToIpfsHash,
    isIpfsHash,
    toByteArray,
    hashOfPubKey,
    hashOfPrivateKey
}
