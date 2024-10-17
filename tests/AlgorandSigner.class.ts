import type {
    Network,
    SignedTx,
    UnsignedTransaction,
} from "@wormhole-foundation/sdk-connect"
import {
    AlgorandChains,
    AlgorandUnsignedTransaction,
} from "@wormhole-foundation/sdk-algorand"
import { SignAndSendSigner } from "@wormhole-foundation/sdk-definitions"
import algosdk, {
    Algodv2,
    Transaction,
    assignGroupID,
    signTransaction,
    waitForConfirmation,
} from "algosdk"

export class AlgorandSigner<N extends Network, C extends AlgorandChains>
implements SignAndSendSigner<N, C>
{
    private _algodClient: Algodv2

    constructor(
        private _address: string,
        private _network: N,
        private _account: algosdk.Account,
        private _debug: boolean = false
    ) {
        this._algodClient = new Algodv2("", "https://testnet-api.algonode.cloud")
    }

    chain(): C {
        return "Algorand" as C
    }

    address(): string {
        return this._address
    }

    async signAndSend(
        txns: Array<UnsignedTransaction>
    ): Promise<Array<SignedTx>> {
        const txids: Array<SignedTx> = []

        const ungrouped = txns.map((txn) => {
            return txn.transaction.tx
        }) as Array<Transaction>

        const grouped = assignGroupID(ungrouped)

        const groupedUnsignedTxns = txns.map((txn, idx) => {
            txn.transaction.tx = grouped[idx]
            return txn
        }) as Array<AlgorandUnsignedTransaction<N, C>>

        const signedTxns: Array<Uint8Array> = []

        for (let i = 0; i < groupedUnsignedTxns.length; i++) {
            const unsignedTxn = groupedUnsignedTxns.at(i)!

            const { description, transaction: tsp } = unsignedTxn
            const { tx, signer } = tsp
            const txId = tx.txID()
            txids.push(txId)

            if (this._debug) {
                console.log(`Signing ${description} for ${this.address()}`)
            }
            
            let signedTxn: Uint8Array
            if (signer) {
                signedTxn = await signer.signTxn(tx)
                signedTxns.push(signedTxn)
            }
            signedTxn = signTransaction(tx as never, this._account.sk).blob

            signedTxns.push(signedTxn)
        }

        const { txid } = await this._algodClient
            .sendRawTransaction(
                signedTxns
            )
            .do()

        await waitForConfirmation(this._algodClient, txid, 15)

        return txids
    }
}