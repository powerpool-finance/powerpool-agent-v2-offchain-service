import bodyParser from 'body-parser';
import express from 'express';
import morgan from 'morgan';
import * as ethers from 'ethers';
import {writeScriptsPathToDir, isIpfsHash, getDirPath} from "./helper";
import { join } from 'path';
import Ipfs from "./ipfs";
import fs from "fs";
import { PassThrough } from 'node:stream';
import Dockerode from 'dockerode';

const docker = new Dockerode({socketPath: '/var/run/docker.sock'});

const scriptPathByIpfsHash = {};

export async function runService(_port?) {
    const port = _port || 3423;

    const scriptsBuildDir = 'scriptsBuild', scriptsFetchedDir = 'scriptsFetched', scriptToExecuteDir = 'scriptToExecute';

    [scriptsFetchedDir, scriptToExecuteDir].forEach((scriptDir) => {
        const dirPath = getDirPath(scriptDir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath);
        }
        const localScripts = fs.readdirSync(dirPath);
        for (let i = 0; i < localScripts.length; i++) {
            fs.unlinkSync(join(dirPath, localScripts[i]));
        }
    });

    const containers = await docker.listContainers();
    // const ipfsContainer = containers.filter(c => c.Image.indexOf('ipfs') === 0)[0];
    // console.log('ipfsContainer', JSON.stringify(ipfsContainer, null, 2));

    const ipfs = new Ipfs();
    let ipfsError;
    do {
        try {
            await ipfs.init(`http://ipfs-service`);
            await writeScriptsPathToDir(ipfs, scriptPathByIpfsHash, scriptsBuildDir);
            ipfsError = null;
        } catch (e) {
            ipfsError = e;
            console.error('IPFS connection error:', e.message, 'trying to reconnect...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } while (!!ipfsError);
    console.log('scriptPathByIpfsHash', scriptPathByIpfsHash);

    const service = express();
    service.use(morgan('combined'));
    service.use(bodyParser.json());
    service.use(bodyParser.urlencoded({extended: true}));

    service.post('/offchain-resolve/:resolverContractAddress', async (req, res) => {
        const {resolverCalldata, rpcUrl, network, chainId, agent, from, jobAddress, jobId} = req.body;

        console.log('toUtf8String', resolverCalldata);
        const resolverIpfsHash = ethers.toUtf8String(resolverCalldata);
        console.log('1 resolverIpfsHash', resolverIpfsHash);
        if (!isIpfsHash(resolverIpfsHash)) {
            return res.send(500, "Incorrect resolver response");
        }

        console.log('1 scriptPathByIpfsHash[resolverIpfsHash]', scriptPathByIpfsHash[resolverIpfsHash]);
        if (!scriptPathByIpfsHash[resolverIpfsHash]) {
            scriptPathByIpfsHash[resolverIpfsHash] = await ipfs.downloadFile(scriptsFetchedDir, resolverIpfsHash);
        }
        console.log('2 scriptPathByIpfsHash[resolverIpfsHash]', scriptPathByIpfsHash[resolverIpfsHash]);
        if (!scriptPathByIpfsHash[resolverIpfsHash]) {
            return res.send(500, "Content not found in IPFS by hash: " + resolverIpfsHash);
        }

        const scriptToExecutePath = getDirPath(scriptToExecuteDir);
        fs.cpSync(scriptPathByIpfsHash[resolverIpfsHash], `${scriptToExecutePath}/${resolverIpfsHash}.cjs`);
        fs.writeFileSync(`${scriptToExecutePath}/healthcheck.cjs`, `console.log('container is active');`);

        function checksScriptToExecuteExists(label) {
            console.log(label, `${scriptToExecutePath}/${resolverIpfsHash}.cjs`, 'exists', fs.existsSync(`${scriptToExecutePath}/${resolverIpfsHash}.cjs`));
        }
        checksScriptToExecuteExists('start');

        const scriptData = {...req.body, ...req.params};

        let finished = false, overTimeout = null;
        const maxExecutionSeconds = process.env.MAX_EXECUTION_TIME ? parseInt(process.env.MAX_EXECUTION_TIME, 10) : 30;
        console.log('startContainer, maxExecutionSeconds:', maxExecutionSeconds);

        const {container} = await startContainer(resolverIpfsHash, containers, scriptData,  (chunk: Buffer, error: Buffer) => {
            if (finished) {
                return;
            }
            if (error) {
                executionFinished();
                console.log('stdError:', error.toString());
                return res.send(500, error.toString());
            }
            const log = chunk.toString();
            console.log('stdOut:', log);
            const resultFlag = '[RESULT_TX_DATA]:';
            if (log.includes(resultFlag)) {
                executionFinished();
                const resultCalldata = log.split(resultFlag)[1].replace(/\r?\n/, '').trim();
                console.log('resultCalldata', resultCalldata);
                return resultCalldata ? res.send(200, {resultCalldata}) : res.send(500, 'Tx data not found');
            }
        }).catch(e => {
            executionFinished();
            console.error('startContainer catch', e);
            return res.send(500, e.message);
        });

        overTimeout = setTimeout(() => {
            console.log('overTimeout, jobAddress:', jobAddress, 'finished:', finished);
            if (finished) {
                return;
            }
            executionFinished();
            return res.send(500, `Max execution time: ${maxExecutionSeconds} seconds`);
        }, maxExecutionSeconds * 1000);

        async function executionFinished() {
            console.log('executionFinished, jobAddress:', jobAddress);
            checksScriptToExecuteExists('finish');
            finished = true;
            overTimeout && clearTimeout(overTimeout);

            return new Promise((resolve) => {
                setTimeout(async () => {
                    try {
                        const {State} = await container.inspect();
                        if (State.Running) {
                            await container.stop({t: 0});
                        }
                    } catch (e) {
                        console.error('Container stop error', e);
                    }
                    try {
                        await docker.pruneContainers();
                    } catch (e) {
                        console.error('Container pruneContainers error', e);
                    }
                    resolve(null);
                }, 100);
            })
        }
    });
    console.log('service.listen', port);
    return service.listen(port);
}


async function startContainer(ipfsHash, containers, params, onStdOut) {
    const AGENT_API_PORT = process.env.AGENT_API_PORT || 8099;
    const COMPOSE_MODE = parseInt(process.env.COMPOSE_MODE);
    const OFFCHAIN_INTERNAL_HOST = process.env.OFFCHAIN_INTERNAL_HOST || 'host.docker.internal';
    if (!COMPOSE_MODE) {
        params['rpcUrl'] = params['rpcUrl'].replace('127.0.0.1', OFFCHAIN_INTERNAL_HOST);
    }
    const beforeStart = Date.now();
    const serviceContainer = containers.filter(c => c.Image.includes('offchain-service'))[0];
    const agentContainer = containers.filter(c => c.Image.includes('power-agent-node'))[0];

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    // Can't see stream when perform container.exec on later point of time.
    stdoutStream.on('data', d => onStdOut(d));
    stderrStream.on('data', d => onStdOut(null, d));
    const scriptToExecutePath = COMPOSE_MODE ? serviceContainer.Mounts.filter(m => m.Destination === '/scriptToExecute')[0].Source : getDirPath('scriptToExecute');
    console.log('serviceContainer.Mounts', serviceContainer.Mounts);
    console.log('scriptToExecutePath', scriptToExecutePath);

    const container = await docker.createContainer({
        Image: 'node:18-alpine',
        User: 'node',
        WorkingDir: '/home/node/app',
        Volumes: {
            '/scriptToExecute': {}
        },
        Env: COMPOSE_MODE ? [`AGENT_API_HOST=http:/${agentContainer.Names[0]}:${AGENT_API_PORT}`] : [`AGENT_API_HOST=http://${OFFCHAIN_INTERNAL_HOST}:${AGENT_API_PORT}`],
        // https://docs.docker.com/engine/api/v1.37/#tag/Container/operation/ContainerCreate
        Healthcheck: {
            Test: ["node", "/scriptToExecute/healthcheck.cjs"],
            Interval: 30 * 10**9,
            Timeout: 10**9,
            Retries: 10**9,
            StartPeriod: 5 * 10**9
        },
        HostConfig: {
            AutoRemove: true,
            // NetworkMode: COMPOSE_MODE ? "container:" + agentContainer.Id : 'host',
            NetworkMode: COMPOSE_MODE ? agentContainer.HostConfig.NetworkMode : 'host',
            ExtraHosts: COMPOSE_MODE ? [] : ['host.docker.internal:host-gateway'],
            Mounts: [
                {
                    Type: 'bind',
                    Name: 'scriptToExecute',
                    Source: scriptToExecutePath,
                    Target: '/scriptToExecute',
                    ReadOnly: true,
                },
            ],
        },
        ExposedPorts: {
            // '80/tcp': {}
        },
        Cmd: [`node`, `/scriptToExecute/${ipfsHash}.cjs`, JSON.stringify(params)]
    });

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    const containerId = await container.start();
    console.log('containerId', containerId, 'took to start: ' + ((Date.now() - beforeStart) / 1000));
    return {containerId, container, stdoutStream};
}
