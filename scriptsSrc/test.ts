
(async () => {
    const params = JSON.parse(process.argv[2]);
    const {agent: agentAddress, resolverContractAddress, resolverCalldata, rpcUrl, chainId, from} = params;

    let fetchFailed = false;
    try {
        console.log(
            'config',
            await fetch('http://ipfs-service:5001/api/v0/id', {method: 'POST'}).then(r => r.json())
        );
    } catch (e) {
        fetchFailed = true;
        console.log('ipfs request failed as expected:', e.message);
    }

    if (!fetchFailed) {
        throw new Error('Ipfs fetch should be failed')
    }

    const {data: {result: blockNumber}} = await fetch(rpcUrl, {
        method: 'POST',
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: []})
    }).then(r => r.json());

    console.log(`[RESULT_TX_DATA]: Test success at block ${blockNumber}`);
})();