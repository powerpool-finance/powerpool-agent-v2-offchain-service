// @ts-ignore
import {formatUnits} from "ethers/lib.commonjs/utils/units";

const { Contract, Interface, WebSocketProvider, JsonRpcProvider, formatUnits, formatEther } = require("ethers");

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

		const clientAbi = JSON.parse('[{"inputs":[],"name":"getRequestData","outputs":[{"internalType":"uint256","name":"subscriptionId","type":"uint256"},{"internalType":"uint256","name":"requestAtBlock","type":"uint256"},{"internalType":"bytes32","name":"requestAtBlockHash","type":"bytes32"},{"internalType":"uint256","name":"requestId","type":"uint256"},{"internalType":"uint64","name":"requestNonce","type":"uint64"},{"internalType":"uint32","name":"numbRandomWords","type":"uint32"},{"internalType":"uint32","name":"callbackGasLimit","type":"uint32"}],"stateMutability":"view","type":"function"}]');
		const client = new Contract(resolverContractAddress, clientAbi, provider);

		const curTimestamp = new Date().getTime() / 1000;
		const {orderIds, orders} = await client.getOrdersToExecute(0, 20);
		let orderToExecute, quote;
		for (let i = 0; i < orders.length; i++) {
			const order = orders[i];
			order.id = orderIds[i];
			if (!order.active && parseInt(order.deactivateOn.toString()) < curTimestamp) {
				continue;
			}
			if (parseInt(order.executedAt.toString()) + parseInt(order.buyPeriod.toString()) > curTimestamp) {
				continue;
			}
			quote = await fetch(`https://api.dln.trade/v1.0/dln/order/quote?${new URLSearchParams({
				srcChainId: chainId,
				srcChainTokenIn: order.tokenData.tokenToSell,
				srcChainTokenInAmount: order.tokenData.amountToSell,
				dstChainId: order.marketChainId,
				dstChainTokenOut: order.tokenToBuy,
				dstChainTokenOutRecipient: order.recipient,
				srcChainOrderAuthorityAddress: order.owner,
				dstChainOrderAuthorityAddress: order.owner,
				affiliateFeePercent: '0.1',
				affiliateFeeRecipient: order.recipient, // referral
				prependOperatingExpense: true,
			} as any).toString()}`, { method: 'GET' }).then(r => r.json());
			const {estimation} = quote;
			const price = formatUnits(order.tokenData.amountToSell, estimation.srcChainTokenIn.decimals) / formatUnits(estimation.dstChainTokenOut.recommendedAmount, estimation.dstChainTokenOut.decimals);
			if (price < formatEther(order.tokenData.minPrice) || price > formatEther(order.tokenData.maxPrice)) {
				continue;
			}
			orderToExecute = order;
		}

		const txToExecute = await fetch(`https://api.dln.trade/v1.0/dln/order/create-tx?${new URLSearchParams({
			srcChainId: chainId,
			srcChainTokenIn: orderToExecute.tokenData.tokenToSell,
			srcChainTokenInAmount: orderToExecute.tokenData.amountToSell,
			dstChainId: orderToExecute.marketChainId,
			dstChainTokenOut: orderToExecute.tokenToBuy,
			dstChainTokenOutRecipient: orderToExecute.recipient,
			srcChainOrderAuthorityAddress: orderToExecute.owner,
			dstChainOrderAuthorityAddress: orderToExecute.owner,
			dstChainTokenOutAmount: quote.estimation.dstChainTokenOut.recommendedAmount,
			affiliateFeePercent: '0.1',
			affiliateFeeRecipient: orderToExecute.recipient, // referral
		} as any).toString()}`, { method: 'GET' }).then(r => r.json());

		const dlnAbi = '[{"inputs":[],"name":"AdminBadRole","type":"error"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"AffiliateFeeDistributionFailed","type":"error"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"expectedBalance","type":"uint256"},{"internalType":"uint256","name":"actualBalance","type":"uint256"}],"name":"CallCausedBalanceDiscrepancy","type":"error"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"CallFailed","type":"error"},{"inputs":[],"name":"EthTransferFailed","type":"error"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"NotEnoughSrcFundsIn","type":"error"},{"inputs":[],"name":"NotSupportedRouter","type":"error"},{"inputs":[],"name":"SignatureInvalidV","type":"error"},{"inputs":[{"internalType":"address","name":"srcTokenOut","type":"address"}],"name":"SwapEmptyResult","type":"error"},{"inputs":[{"internalType":"address","name":"srcRouter","type":"address"}],"name":"SwapFailed","type":"error"},{"inputs":[],"name":"WrongArgumentLength","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint8","name":"version","type":"uint8"}],"name":"Initialized","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"address","name":"recipient","type":"address"}],"name":"Refund","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"role","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"previousAdminRole","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"newAdminRole","type":"bytes32"}],"name":"RoleAdminChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"role","type":"bytes32"},{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"sender","type":"address"}],"name":"RoleGranted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"role","type":"bytes32"},{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"sender","type":"address"}],"name":"RoleRevoked","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"srcSwapRouter","type":"address"},{"indexed":false,"internalType":"bool","name":"isSupported","type":"bool"}],"name":"SupportedRouter","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"router","type":"address"},{"indexed":false,"internalType":"address","name":"tokenIn","type":"address"},{"indexed":false,"internalType":"uint256","name":"amountIn","type":"uint256"},{"indexed":false,"internalType":"address","name":"tokenOut","type":"address"},{"indexed":false,"internalType":"uint256","name":"amountOut","type":"uint256"}],"name":"SwapExecuted","type":"event"},{"inputs":[],"name":"DEFAULT_ADMIN_ROLE","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"NATIVE_TOKEN","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"deBridgeGate","outputs":[{"internalType":"contract IDeBridgeGateExtended","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"}],"name":"getRoleAdmin","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"grantRole","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"hasRole","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract IDeBridgeGateExtended","name":"_deBridgeGate","type":"address"}],"name":"initialize","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"renounceRole","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"rescueFunds","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"role","type":"bytes32"},{"internalType":"address","name":"account","type":"address"}],"name":"revokeRole","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_srcTokenIn","type":"address"},{"internalType":"uint256","name":"_srcAmountIn","type":"uint256"},{"internalType":"bytes","name":"_srcTokenInPermitEnvelope","type":"bytes"},{"components":[{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"bool","name":"useAssetFee","type":"bool"},{"internalType":"uint32","name":"referralCode","type":"uint32"},{"internalType":"bytes","name":"autoParams","type":"bytes"}],"internalType":"struct ICrossChainForwarder.GateParams","name":"_gateParams","type":"tuple"}],"name":"sendV2","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"_srcTokenIn","type":"address"},{"internalType":"uint256","name":"_srcAmountIn","type":"uint256"},{"internalType":"bytes","name":"_srcTokenInPermitEnvelope","type":"bytes"},{"internalType":"uint256","name":"_affiliateFeeAmount","type":"uint256"},{"internalType":"address","name":"_affiliateFeeRecipient","type":"address"},{"components":[{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"bool","name":"useAssetFee","type":"bool"},{"internalType":"uint32","name":"referralCode","type":"uint32"},{"internalType":"bytes","name":"autoParams","type":"bytes"}],"internalType":"struct ICrossChainForwarder.GateParams","name":"_gateParams","type":"tuple"}],"name":"sendV3","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"_srcTokenIn","type":"address"},{"internalType":"uint256","name":"_srcAmountIn","type":"uint256"},{"internalType":"bytes","name":"_srcTokenInPermitEnvelope","type":"bytes"},{"internalType":"address","name":"_srcSwapRouter","type":"address"},{"internalType":"bytes","name":"_srcSwapCalldata","type":"bytes"},{"internalType":"address","name":"_srcTokenOut","type":"address"},{"internalType":"uint256","name":"_srcTokenExpectedAmountOut","type":"uint256"},{"internalType":"address","name":"_srcTokenRefundRecipient","type":"address"},{"internalType":"address","name":"_target","type":"address"},{"internalType":"bytes","name":"_targetData","type":"bytes"}],"name":"strictlySwapAndCall","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"_srcTokenIn","type":"address"},{"internalType":"uint256","name":"_srcAmountIn","type":"uint256"},{"internalType":"bytes","name":"_srcTokenInPermitEnvelope","type":"bytes"},{"components":[{"internalType":"address","name":"swapRouter","type":"address"},{"internalType":"bytes","name":"swapCalldata","type":"bytes"},{"internalType":"address","name":"tokenOut","type":"address"},{"internalType":"uint256","name":"tokenOutExpectedAmount","type":"uint256"},{"internalType":"address","name":"tokenOutRefundRecipient","type":"address"}],"internalType":"struct CrosschainForwarder.SwapDetails","name":"_swapDetails","type":"tuple"},{"internalType":"address","name":"_target","type":"address"},{"internalType":"bytes","name":"_targetData","type":"bytes"},{"internalType":"bytes32","name":"_orderId","type":"bytes32"}],"name":"strictlySwapAndCallDln","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"supportedRouters","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_srcTokenIn","type":"address"},{"internalType":"uint256","name":"_srcAmountIn","type":"uint256"},{"internalType":"bytes","name":"_srcTokenInPermitEnvelope","type":"bytes"},{"internalType":"address","name":"_srcSwapRouter","type":"address"},{"internalType":"bytes","name":"_srcSwapCalldata","type":"bytes"},{"internalType":"address","name":"_srcTokenOut","type":"address"},{"components":[{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"bool","name":"useAssetFee","type":"bool"},{"internalType":"uint32","name":"referralCode","type":"uint32"},{"internalType":"bytes","name":"autoParams","type":"bytes"}],"internalType":"struct ICrossChainForwarder.GateParams","name":"_gateParams","type":"tuple"}],"name":"swapAndSendV2","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"_srcTokenIn","type":"address"},{"internalType":"uint256","name":"_srcAmountIn","type":"uint256"},{"internalType":"bytes","name":"_srcTokenInPermitEnvelope","type":"bytes"},{"internalType":"uint256","name":"_affiliateFeeAmount","type":"uint256"},{"internalType":"address","name":"_affiliateFeeRecipient","type":"address"},{"internalType":"address","name":"_srcSwapRouter","type":"address"},{"internalType":"bytes","name":"_srcSwapCalldata","type":"bytes"},{"internalType":"address","name":"_srcTokenOut","type":"address"},{"components":[{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"receiver","type":"address"},{"internalType":"bool","name":"useAssetFee","type":"bool"},{"internalType":"uint32","name":"referralCode","type":"uint32"},{"internalType":"bytes","name":"autoParams","type":"bytes"}],"internalType":"struct ICrossChainForwarder.GateParams","name":"_gateParams","type":"tuple"}],"name":"swapAndSendV3","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"_srcSwapRouter","type":"address"},{"internalType":"bool","name":"_isSupported","type":"bool"}],"name":"updateSupportedRouter","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"version","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"pure","type":"function"},{"stateMutability":"payable","type":"receive"}]';
		const dlnInterface = new Interface(dlnAbi);
		const tx = dlnInterface.parseTransaction(txToExecute.tx);

		console.log('[RESULT_TX_DATA]:', client.interface.encodeFunctionData('initiateOrderExecution', [
			orderToExecute.id,
			tx._srcSwapRouter,
			tx._srcSwapCalldata,
			tx._target,
			tx._targetData,
		]));
	} catch (e) {
		console.error('VRFProofGenerator error', e);
	}
})();