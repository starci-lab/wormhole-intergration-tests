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
import { SolanaSigner, SolanaAddress } from "@wormhole-foundation/sdk-solana";
import {
  nativeTokenId,
  signSendWait,
  wormhole,
  WormholeMessageId,
} from "@wormhole-foundation/sdk";
import solana from "@wormhole-foundation/sdk/solana";
import aptos from "@wormhole-foundation/sdk/aptos";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token"

describe("Sould Aptos to Solana work", () => {
  it("Should complete with native token transfer", async () => {
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

    //my Solana wallet, has > 0 SOL
    const solanaAccount = Keypair.fromSecretKey(
      Buffer.from(
        "e8d6d56a61033f825df1ff28b45ae47c10c613091566ec21db2998302677f9c9e0b32b877ac1d3cd1cb468991605967640c53986bb3598a29fd6652541cab2f0",
        "hex"
      )
    );
    console.log(solanaAccount.publicKey.toBase58())
    const solanaClient = new Connection(clusterApiUrl("devnet"), "confirmed");

    //ensure solana balance > 0
    const solanaBalance = await solanaClient.getBalance(
      solanaAccount.publicKey
    );
    console.log(`Solana balance: ${solanaBalance} SOL`);
    expect(solanaBalance).toBeGreaterThan(0);

    //transfer Aptos to Solana
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
    const solanaSigner = new SolanaSigner(
      "Solana",
      solanaAccount,
      solanaClient
    );
    const mint = new PublicKey("7EvFD3JKCJVdtkAYdaSVKJsrPEJCzy2neJha7TREGrCa")
    const rpc = clusterApiUrl("devnet");
    const ataAccount = await getOrCreateAssociatedTokenAccount(new Connection(rpc), solanaAccount, mint, solanaAccount.publicKey, true)
    console.log(ataAccount.address.toBase58())

    //get aptos bridge
    const amount = 0.01; // 0.01 APT
    const wh = await wormhole("Testnet", [solana, aptos]);
    const decimals = await wh.getDecimals(
      "Aptos",
      nativeTokenId("Aptos").address
    );
    const aptosChain = wh.getChain("Aptos");
    const aptosTokenBridge = await aptosChain.getTokenBridge();

    //transfer in aptos
    const txGenerator = aptosTokenBridge.transfer(
      //signer
      new AptosAddress(aptosAccount.accountAddress.toString()),
      //recipient
      {
        address: new SolanaAddress(ataAccount.address.toString()),
        chain: "Solana",
      },
      //token,
      nativeTokenId("Aptos").address,
      //amount
      BigInt(amount * Math.pow(10, decimals))
    );

    const transactionIds = await signSendWait(
      aptosChain,
      txGenerator,
      aptosSigner
    );

    const { txid } = transactionIds.at(-1)!;
    console.log(`Transfer transaction: ${txid}`);

    let wormholeMessage: WormholeMessageId | undefined = undefined;
    for (let repeat = 0; repeat < 30; repeat++) {
      console.log(`Checking for wormhole message ${txid} - ${repeat}`);
      const [_wormholeMessage] = await aptosChain.parseTransaction(txid);
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

    //redeem in solana
    const solanaChain = wh.getChain("Solana");
    const solanaTokenBridge = await solanaChain.getTokenBridge();
    const txGenerator2 = solanaTokenBridge.redeem(
      //signer
      new SolanaAddress(solanaAccount.publicKey.toBase58()),
      //recipient
      vaa
    );
    const transactionIds2 = await signSendWait(
      solanaChain,
      txGenerator2,
      solanaSigner
    );
    const { txid: txid2 } = transactionIds2.at(-1)!;
    console.log(`Redeem transaction: ${txid2}`);
  }, 30000);
});
