import bodyParser from 'body-parser';
import express from 'express';
import morgan from 'morgan';
import * as ethers from 'ethers';
import {writeScriptsPathToDir, isIpfsHash, getDirPath} from "./helper";
import Ipfs from "./ipfs";
import fs from "fs";
import { PassThrough } from 'node:stream';
import Dockerode from 'dockerode';

const docker = new Dockerode({socketPath: '/var/run/docker.sock'});

const scriptPathByIpfsHash = {};

export async function runService(_port?) {
    const port = _port || 3423;

    const scriptsBuildDir = 'scriptsBuild', scriptsFetchedDir = 'scriptsFetched';
    await writeScriptsPathToDir(scriptPathByIpfsHash, scriptsBuildDir);
    await writeScriptsPathToDir(scriptPathByIpfsHash, scriptsFetchedDir);
    console.log('scriptPathByIpfsHash', scriptPathByIpfsHash);

    const ipfs = new Ipfs();
    await ipfs.init();

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

        const scriptToExecutePath = getDirPath('scriptToExecute');
        if (!fs.existsSync(scriptToExecutePath)) {
            fs.mkdirSync(scriptToExecutePath);
        }
        const localScripts = fs.readdirSync(scriptToExecutePath);
        for (let i = 0; i < localScripts.length; i++) {
            fs.unlinkSync(`${scriptToExecutePath}/${localScripts[i]}`);
        }

        fs.cpSync(scriptPathByIpfsHash[resolverIpfsHash], `${scriptToExecutePath}/index.cjs`);

        const scriptData = {...req.body, ...req.params};
        if (!parseInt(process.env.COMPOSE_MODE)) {
            scriptData['rpcUrl'] = rpcUrl.replace('127.0.0.1', 'host.docker.internal');
        }

        console.log('startContainer');
        let finished = false, overTimeout = null;
        async function executionFinished() {
            finished = true;
            overTimeout && clearTimeout(overTimeout);

            return new Promise((resolve) => {
                setTimeout(async () => {
                    try {
                        const {State} = await container.inspect();
                        if (State.Running) {
                            container.kill();
                        }
                    } catch (e) {
                        console.error('Container kills error', e);
                    }
                    resolve(null);
                }, 100);
            })
        }
        const maxExecutionSeconds = process.env.MAX_EXECUTION_TIME ? parseInt(process.env.MAX_EXECUTION_TIME, 10) : 30;
        const {container} = await startContainer(scriptData,  (chunk: Buffer, error: Buffer) => {
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
            if (finished) {
                return;
            }
            executionFinished();
            return res.send(500, `Max execution time: ${maxExecutionSeconds} seconds`);
        }, maxExecutionSeconds * 1000);
    });

    console.log('service.listen', port);
    return service.listen(port);
}


async function startContainer(params, onStdOut) {
    const AGENT_API_PORT = process.env.AGENT_API_PORT || 8099;
    const COMPOSE_MODE = parseInt(process.env.COMPOSE_MODE);
    const beforeStart = Date.now();
    const containers = await docker.listContainers();
    const serviceContainer = containers.filter(c => c.Image.includes('offchain-service'))[0];
    const agentContainer = containers.filter(c => c.Image.includes('power-agent-node'))[0];

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    // Can't see stream when perform container.exec on later point of time.
    stdoutStream.on('data', d => onStdOut(d));
    stderrStream.on('data', d => onStdOut(null, d));

    const container = await docker.createContainer({
        Image: 'node:18-alpine',
        User: 'node',
        WorkingDir: '/home/node/app',
        Volumes: {
            '/scriptToExecute': {}
        },
        Env: COMPOSE_MODE ? [`AGENT_API_HOST=http:/${agentContainer.Names[0]}:${AGENT_API_PORT}`] : ['AGENT_API_HOST=http://host.docker.internal:' + AGENT_API_PORT],
        HostConfig: {
            // NetworkMode: COMPOSE_MODE ? "container:" + agentContainer.Id : 'host',
            NetworkMode: COMPOSE_MODE ? agentContainer.HostConfig.NetworkMode : 'host',
            ExtraHosts: COMPOSE_MODE ? [] : ['host.docker.internal:host-gateway'],
            Mounts: [
                {
                    Type: 'bind',
                    Name: 'scriptToExecute',
                    Source: COMPOSE_MODE ? serviceContainer.Mounts.filter(m => m.Destination === '/scriptToExecute')[0].Source : getDirPath('scriptToExecute'),
                    Target: '/scriptToExecute',
                    ReadOnly: true,
                },
            ],
        },
        ExposedPorts: {
            // '80/tcp': {}
        },
        Cmd: [`node`, `/scriptToExecute/index.cjs`, JSON.stringify(params)]
    });

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    const containerId = await container.start();
    console.log('containerId', containerId, 'took to start: ' + ((Date.now() - beforeStart) / 1000));
    return {containerId, container, stdoutStream};
}
