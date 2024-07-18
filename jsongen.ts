import Wallet from 'ethereumjs-wallet';
import fs from 'fs';

let {PRIVATE_KEY, PASS} = process.env;

if (!PRIVATE_KEY || PRIVATE_KEY.length === 0) {
  console.log('You need to specify a PRIVATE_KEY environment variable');
  process.exit(1);
}

if (!PASS || PASS.length === 0) {
  console.log('You need to specify a PASS environment variable for the JSON key');
  process.exit(1);
}

if (PRIVATE_KEY.startsWith('0x')) {
  PRIVATE_KEY = PRIVATE_KEY.substring(2);
}
let key = Buffer.from(PRIVATE_KEY, 'hex');
let wallet = Wallet['default'].fromPrivateKey(key);

if (!fs.existsSync('./keys/')) {
  fs.mkdirSync('./keys/');
}

(async function () {
  let s = await wallet.toV3String(PASS, {
    n: 32768,
  });
  const fullName = `./keys/${wallet.getV3Filename()}`;
  fs.writeFileSync(fullName, JSON.stringify(s));
  console.log(`V3 key was written to ${fullName}`);
})();
