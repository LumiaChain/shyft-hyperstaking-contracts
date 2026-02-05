import { network } from "hardhat";
import { processTx } from "./libraries/utils";

// Simulate a Hyperlane handle call by sending a raw transaction to the recipient
async function main() {
  const mailbox = "0x63386891cc01ff6DaEF27FC349431eD56da17E9d";
  const recipient = "0x6EF866091F2cee3A58279AF877C2266498c95D31";

  const handleCalldata =
    "0x56d5d475" +
    "0000000000000000000000000000000000000000000000000000000000aa36a7" +
    "000000000000000000000000fea618e29263a0501533fd438fd33618139f6e7b" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "000000000000000000000000000000000000000000000000000000000000008b" +
    "0000000000000000000000000000000000000000bba6ef00ebe301508b987334" +
    "f3a68f05c023dc7b1454657374204e6174697665205374726174656779000000" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000574455448310000000000000000000000000000000000" +
    "0000000000000000000012000000000000000000000000000000000000000000";

  // 1) impersonate mailbox on a forked network
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [mailbox],
  });

  // give it some ETH for gas
  await network.provider.send("hardhat_setBalance", [
    mailbox,
    "0x56BC75E2D63100000", // 100 ETH in hex
  ]);

  // const mailboxSigner = await ethers.getImpersonatedSigner(mailbox);

  // 2) send raw tx with given calldata
  const tx = await network.provider.send("eth_sendTransaction", [
    {
      from: mailbox,
      to: recipient,
      data: handleCalldata,
      value: "0x0",
    },
  ]);

  await processTx(tx, "Simulate Hyperlane handle");

  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [mailbox],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
