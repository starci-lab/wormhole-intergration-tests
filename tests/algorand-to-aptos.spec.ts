import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  sleep,
} from "@aptos-labs/ts-sdk";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AptosAccount, AptosClient } from "aptos";
import { AptosSigner, AptosAddress } from "@wormhole-foundation/sdk-aptos";
import { AlgorandAddress, AlgorandSigner } from "@wormhole-foundation/sdk-algorand";
import {
  nativeTokenId,
  signSendWait,
  wormhole,
  WormholeMessageId,
} from "@wormhole-foundation/sdk";
import algorand from "@wormhole-foundation/sdk/algorand";
import aptos from "@wormhole-foundation/sdk/aptos";
import algosdk from "algosdk";
describe("Sould Algorand to Aptos work", () => {
  it("Should complete with native token transfer", async () => {
    //my Algorand wallet, has > 0 ALGO
    const algorandMnemonic = algosdk.secretKeyToMnemonic(
      Uint8Array.from(
        Buffer.from(
          "68e2ea5fbc75d067d168b5ce0fd23d0905afc18045ceba82f8c7315e1a5b6af05f7110c73389361108b216f00d8865aeaa0bba97d089e890e927a62c466013d2",
          "base64"
        )
      )
    )
    const algorandAccount = algosdk.mnemonicToSecretKey(
       algorandMnemonic
    );
    const algorandClient = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud")
    const accountInformation = await algorandClient.accountInformation(algorandAccount.addr).do();
    console.log(accountInformation)
    const accountBalance = accountInformation.amount
    console.log(`Algorand balance: ${accountInformation} ALGO`);
    expect(Number(accountBalance)).toBeGreaterThan(0);

    //my Aptos wallet, has > 0 APT
    const aptosAccount = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(
        "0x20c324e81735323b34ed79b28136bee01ae08e2b977291c3399a51a9c81b101d"
      ),
      address:
        "0x14baf48e4826e1470890519d51efab9918e33b1663f4aaa7b8acf4e86293edca",
    });
    //ensure aptos balance > 0
    const aptosClient = new Aptos(
      new AptosConfig({
        network: Network.TESTNET,
      })
    );
    const aptosBalance = await aptosClient.getAccountAPTAmount({
      accountAddress: aptosAccount.accountAddress,
    });
    console.log(`Aptos balance: ${aptosBalance} APT`);
    expect(aptosBalance).toBeGreaterThan(0);

    //transfer Algorand to Aptos
    const algorandSigner = new AlgorandSigner(
      "Algorand",
      algorandClient as never,
      algorandMnemonic,
      true
    );

    const _aptosAccount = AptosAccount.fromAptosAccountObject({
      privateKeyHex: aptosAccount.privateKey.toString(),
      publicKeyHex: aptosAccount.publicKey.toString(),
      address: aptosAccount.accountAddress.toString(),
    });
    const _aptosClient = new AptosClient(
      "https://api.testnet.aptoslabs.com/v1"
    );
    const aptosSigner = new AptosSigner(
      "Aptos",
      _aptosAccount,
      _aptosClient,
      true
    );

    //get algorand bridge
    const amount = 0.01; // 0.01 APT
    const wh = await wormhole("Testnet", [algorand, aptos]);
    const decimals = await wh.getDecimals(
      "Algorand",
      nativeTokenId("Algorand").address
    );
    const algorandChain = wh.getChain("Algorand");
    const algorandTokenBridge = await algorandChain.getTokenBridge();

    //transfer in aptos
    const txGenerator = algorandTokenBridge.transfer(
      //signer
      new AlgorandAddress(algorandAccount.addr.toString()),
      //recipient
      {
        address: new AptosAddress(aptosAccount.accountAddress.toString()),
        chain: "Aptos",
      },
      //token,
      nativeTokenId("Algorand").address,
      //amount
      BigInt(amount * Math.pow(10, decimals))
    );

    const transactionIds = await signSendWait(
      algorandChain,
      txGenerator,
      algorandSigner
    );

    const { txid } = transactionIds.at(-1)!;
    console.log(`Transfer transaction: ${txid}`);

    let wormholeMessage: WormholeMessageId | undefined = undefined;
    for (let repeat = 0; repeat < 30; repeat++) {
      console.log(`Checking for wormhole message ${txid} - ${repeat}`);
      const [_wormholeMessage] = await algorandChain.parseTransaction(txid);
      if (_wormholeMessage) {
        wormholeMessage = _wormholeMessage;
        break;
      } else {
        await sleep(1000);
      }
    }
    if (!wormholeMessage) throw new Error("Wormhole message not found");
    const vaa = await wh.getVaa(
      wormholeMessage,
      "TokenBridge:Transfer",
      60_000
    );

    //redeem in aptos
    const aptosChain = wh.getChain("Aptos");
    const solanaTokenBridge = await aptosChain.getTokenBridge();
    const txGenerator2 = solanaTokenBridge.redeem(
      //signer
      new AptosAddress(aptosAccount.publicKey.toString()),
      //recipient
      vaa
    );
    const transactionIds2 = await signSendWait(
      aptosChain,
      txGenerator2,
      aptosSigner
    );
    const { txid: txid2 } = transactionIds2.at(-1)!;
    console.log(`Redeem transaction: ${txid2}`);
  }, 30000);
});
