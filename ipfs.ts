// import { createHeliaHTTP } from '@helia/http'
// import { strings } from '@helia/strings'
// import {delegatedHTTPRouting, httpGatewayRouting} from '@helia/routers'
// import { unixfs } from '@helia/unixfs'
// import { CID } from 'multiformats/cid'
// import {bitswap, trustlessGateway} from "@helia/block-brokers";
// const streamPipeline = promisify(stream.pipeline);
import * as fs from "fs";
import axios from "axios";
import FormData from 'form-data';
import { promisify } from 'util';
import * as stream from 'stream';
const finished = promisify(stream.finished);

export default class Ipfs {
    gatewayUrl;
    // helia;
    constructor() {

    }

    async init(gatewayUrl) {
        console.log('Ipfs gatewayUrl:', gatewayUrl);
        this.gatewayUrl = gatewayUrl;
        // const libp2p = await createLibp2p()
        // this.helia = await createHeliaHTTP({
        //     start: true,
        //     blockBrokers: [
        //         bitswap(),
        //         trustlessGateway({allowLocal: true}),
        //     ],
        //     routers: [
        //         delegatedHTTPRouting('https://delegated-ipfs.dev'),
        //         httpGatewayRouting({gateways: [gatewayUrl]}),
        //     ]
        // })
    }

    async saveFile(path: string) {
        // Read the file
        const fileStream = fs.createReadStream(path);
        console.log('saveFile path', path, 'content.length:', fs.readFileSync(path, {encoding: 'utf8'}).length)
        // Create a FormData object
        const formData = new FormData();
        formData.append('file', fileStream);

        try {
            const response = await axios.post(`${this.gatewayUrl}:5001/api/v0/add?cid-version=1`, formData, {
                headers: formData.getHeaders(),
                maxContentLength: 2e6,
                timeout: 20000,
            } as Object);
            if (!response.data.Hash) {
                throw new Error(`HTTP error! status: ${response.status}, response: ${JSON.stringify(response.data)}`);
            }
            return response.data.Hash; // The IPFS hash of the added file
        } catch (error) {
            console.error('Error adding file to IPFS:', error.message);
            throw error;
        }
        // const {data: {result: blockNumber}} = await fetch(
        //     `http://127.0.0.1:5001/api/v0/add?${new URLSearchParams({'cid-version': 1} as any).toString()}`,
        //     {
        //     method: 'POST',
        //     body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: []})
        // }).then(r => r.json());
        //
        // const s = strings(this.helia)
        // return s.add(fs.readFileSync(path, {encoding: 'utf8'})).then(cid => cid.toString());
    }

    async downloadFile(dirName, ipfsHash) {
        const path = `${dirName}/${ipfsHash}.cjs`;
        const writer = fs.createWriteStream(path);
        return axios
            .post(`${this.gatewayUrl}:5001/api/v0/cat?arg=${ipfsHash}`, {}, {
                responseType: 'stream',
                maxContentLength: 2e6,
                timeout: 20000,
            })
            .then(async response => {
                response.data.pipe(writer);
                await finished(writer); //this is a Promise
                return path;
            })
            .catch(e => {
                console.error(ipfsHash, 'downloadFile', e.message);
                return undefined;
            });
        // const heliaFs = unixfs(this.helia)
        // const decoder = new TextDecoder()
        // let text = ''
        // for await (const chunk of heliaFs.cat(CID.parse(ipfsHash))) {
        //     text += decoder.decode(chunk, {
        //         stream: true
        //     })
        // }
        //
        // fs.writeFileSync(path, text, 'utf8');
        // return path;
    }
}
