
(async () => {
    const params = JSON.parse(process.argv[2]);
    const {agent: agentAddress, resolverContractAddress, resolverCalldata, rpcUrl, chainId, from} = params;

    await new Promise((resolve) => setTimeout(resolve, 30 * 60 * 1000)); // wait 30 minutes

    console.log(`[RESULT_TX_DATA]: Test failed`);
})();