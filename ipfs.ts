// import { strings } from '@helia/strings';
// import { createHelia } from "helia";
import axios from "axios";
import * as fs from "fs";

export default class Ipfs {
    helia;
    s;
    ipfsGateway;
    constructor() {

    }

    async init() {
        // this.helia = await createHelia();
        // this.s = strings(this.helia);
        this.ipfsGateway = [
          'https://ipfs.io',
          'https://cloudflare-ipfs.com',
          'https://ipfs.eth.aragon.network',
          'https://gateway.pinata.cloud',
          'https://dweb.link',
          'https://4everland.io'
        ];
    }

    async downloadFile(dirName, ipfsHash) {
        const path = `${dirName}/${ipfsHash}.js`;
        // const content = await this.s.get(ipfsHash);
        // fs.writeFileSync(path, content)
        // return path;

        const writer = fs.createWriteStream(path);
        for (let gateway of this.ipfsGateway) {
            let data;
            try {
                ({ data } = await axios.get(`${gateway}/ipfs/${ipfsHash}`, {responseType: 'stream'}));
            } catch (e) {
                continue;
            }
            let error = null;
            data.pipe(writer);
            return new Promise((resolve, reject) => {
                writer.on('error', err => {
                    error = err;
                    writer.close();
                    reject(err);
                });
                writer.on('close', () => error || resolve(path));
            });
        }
    }
}
