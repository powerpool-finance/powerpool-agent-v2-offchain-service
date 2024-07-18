
(async () => {
    const params = JSON.parse(process.argv[2]);
    const {agent: agentAddress, resolverContractAddress, resolverCalldata, rpcUrl, chainId, from} = params;

    const {data: {result: blockNumber}} = await fetch(rpcUrl, {
        method: 'POST',
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: []})
    }).then(r => r.json());

    console.log(`[RESULT_TX_DATA]: Test success at block ${blockNumber}`);
})();