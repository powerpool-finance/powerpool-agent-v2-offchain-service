import axios from 'axios';
import * as ethers from 'ethers';
import bodyParser from 'body-parser';
import express from 'express';
import morgan from 'morgan';
import { assert } from 'chai';
import { runService } from "../index";
const offchainServicePort = 3423;
const rpcMockServicePort = 7654;

describe('Container Execution', function () {
    before(async () => {
        try {
            await runService(offchainServicePort);
        } catch (e) { }
    });
    after(async () => {
        process.exit();
    });

    this.timeout(100000)
    it('run service and execute container on request', async function () {
        const service = express();
        service.use(morgan('combined'));
        service.use(bodyParser.json());
        service.use(bodyParser.urlencoded({extended: true}));

        service.post('/', async (req, res) => {
            res.send({data: {result: 42}});
        });
        service.listen(rpcMockServicePort);

        const consumer = '0x178dC8584eaf23642aF9014116043277eC3E79be';
        const offchainUrl = `http://localhost:${offchainServicePort}/offchain-resolve/${consumer}`;
        console.log('offchainUrl', offchainUrl);

        const result = await axios.post(offchainUrl, {
            resolverCalldata: ethers.hexlify(ethers.toUtf8Bytes('bafkreicg6im5dugbrrh2v5vib25unpowbts5gwlmzwnzbplrwrsxldgvfe')),
            rpcUrl: `http://127.0.0.1:${rpcMockServicePort}/`,
            network: null,
            chainId: null,
            agent: null,
            from: null,
            jobAddress: null,
            jobId: null,
        })
            .then(r => r.data)
            .catch(e => {
                console.error('error', e);
                assert(false, e.message);
            });
        assert.equal(result.resultCalldata, "Test success at block 42")
    });
});
