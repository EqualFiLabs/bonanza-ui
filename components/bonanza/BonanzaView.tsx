"use client";

import { useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";

import { TxButton } from "@/components/shell/TxButton";
import { useWalletGate } from "@/components/shell/WalletGate";
import { CREATE_POSITION_KEY, useCreatePosition } from "@/components/shell/usePositionActions";
import { deployment, publicClient } from "@/lib/chain/client";
import { activationAbi, operatorAbi } from "@/lib/contracts/abis";
import { lotteryAbi } from "@/lib/contracts/generated/lottery";
import {
  BASE_MULTIPLIER_BPS,
  nextStakeStart,
  STAKE_LOCK_SECONDS,
  unlockAt,
} from "@/lib/protocol/accounting";
import {
  countdown,
  formatAmount,
  formatToken,
  parseAmount,
  percent,
  roundedDuration,
} from "@/lib/protocol/format";
import { tokenOf } from "@/lib/protocol/rounds";
import type { StakingAccount } from "@/lib/protocol/types";
import { useProtocol } from "@/providers/protocol-context";
import { useTx } from "@/providers/tx-context";
import { useWalletState } from "@/providers/wallet-context";

const LOCK_HOURS = Number(STAKE_LOCK_SECONDS) / 3_600;

const lottery = () => ({ address: deployment!.lottery, abi: lotteryAbi });

/** BONANZA carries its backing token's decimals. */
function useBonanza() {
  const { protocol } = useProtocol();
  const { decimals } = tokenOf(protocol, protocol.bindings.underlying);
  return { decimals, bonanza: (value: bigint) => formatAmount(value, decimals, 2) };
}

const multiplier = (position: StakingAccount) =>
  position.registered ? position.multiplierBps : BASE_MULTIPLIER_BPS;

function Stake({ position }: { position: StakingAccount }) {
  const { protocol, now } = useProtocol();
  const { bonanza, decimals } = useBonanza();
  const { busy, run } = useTx();
  const gate = useWalletGate();
  const [tab, setTab] = useState<"stake" | "unstake">("stake");
  const [text, setText] = useState("");
  const txKey = `${tab}-${position.id}`;

  const amount = parseAmount(text, decimals);
  const value = amount ?? 0n;
  const free = position.balance - position.staked;
  const unlock = unlockAt(position.stakeStart);
  const locked = position.staked > 0n && now < unlock;
  const staking = tab === "stake";
  const weightAfter = ((position.staked + value) * multiplier(position)) / BASE_MULTIPLIER_BPS;
  const lockAfter =
    value > 0n
      ? unlockAt(nextStakeStart(position.staked, position.stakeStart, value, now)) - now
      : locked
        ? unlock - now
        : null;

  const submit = async () => {
    const done = await run(
      txKey,
      async () => ({
        ...lottery(),
        functionName: staking ? "stakeBonanza" : "unstakeBonanza",
        args: [position.id, value],
      }),
      {
        action: `${staking ? "Stake" : "Unstake"} ${bonanza(value)} BONANZA`,
        success: `${staking ? "Staked" : "Unstaked"} ${bonanza(value)} BONANZA`,
      }
    );
    if (done) setText("");
  };

  const action = () => {
    if (gate) return gate;
    // A transaction keeps its own button until it finishes, whatever the next poll shows.
    if (busy[txKey]) return <TxButton txKey={txKey}>{staking ? "Stake" : "Unstake"}</TxButton>;
    if (staking) {
      if (protocol.paused) {
        return (
          <TxButton txKey={txKey} disabled>
            Staking is paused
          </TxButton>
        );
      }
      if (amount === null || value === 0n) {
        return (
          <TxButton txKey={txKey} disabled>
            Enter an amount
          </TxButton>
        );
      }
      if (value > free) {
        return (
          <>
            <TxButton txKey={txKey} disabled>
              Not enough unstaked BONANZA
            </TxButton>
            <p className="why">This position has {bonanza(free)} unstaked.</p>
          </>
        );
      }
      return (
        <TxButton txKey={txKey} onClick={() => void submit()}>
          Stake {bonanza(value)} BONANZA
        </TxButton>
      );
    }
    if (position.staked === 0n) {
      return (
        <TxButton txKey={txKey} disabled>
          Nothing staked
        </TxButton>
      );
    }
    if (locked) {
      return (
        <>
          <TxButton txKey={txKey} disabled>
            Still locked
          </TxButton>
          <p className="why">Unstaking opens {LOCK_HOURS} hours after the weighted stake time.</p>
        </>
      );
    }
    if (amount === null || value === 0n) {
      return (
        <TxButton txKey={txKey} disabled>
          Enter an amount
        </TxButton>
      );
    }
    if (value > position.staked) {
      return (
        <TxButton txKey={txKey} disabled>
          More than is staked
        </TxButton>
      );
    }
    return (
      <TxButton txKey={txKey} onClick={() => void submit()}>
        Unstake {bonanza(value)} BONANZA
      </TxButton>
    );
  };

  return (
    <section className="card" aria-label="Stake">
      <h2 className="disp">Stake</h2>
      <div className="stats">
        <div>
          <span>Staked</span>
          <b>{bonanza(position.staked)}</b>
        </div>
        <div>
          <span>Revenue weight</span>
          <b>{bonanza(position.weight)}</b>
        </div>
        <div>
          <span>Share of stakers</span>
          <b>{percent(position.weight, protocol.totalWeight, 3)}</b>
        </div>
      </div>
      {position.staked > 0n ? (
        <p className="note">
          {locked ? (
            <>
              Unstaking opens in <b className="mono">{countdown(unlock - now)}</b>
            </>
          ) : (
            "Unlocked. You can unstake at any time."
          )}
        </p>
      ) : null}
      <div className="seg">
        {(["stake", "unstake"] as const).map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setText("");
            }}
          >
            {name === "stake" ? "Stake" : "Unstake"}
          </button>
        ))}
      </div>
      <div className="amount">
        <input
          inputMode="decimal"
          placeholder="0"
          value={text}
          aria-label="BONANZA amount"
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setText(formatUnits(staking ? free : position.staked, decimals))}
        >
          Max {bonanza(staking ? free : position.staked)}
        </button>
        <span>BONANZA</span>
      </div>
      <div className="calc">
        {staking ? (
          <>
            <div className="rowline">
              <span>Revenue weight after</span>
              <span className="mono">{bonanza(weightAfter)}</span>
            </div>
            <div className="rowline">
              <span>Unlock after this stake</span>
              <span className="mono">
                {lockAfter !== null ? `in ${roundedDuration(lockAfter)}` : "—"}
                <span className="sub">Time served counts, weighted by size</span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="rowline">
              <span>Stake left after</span>
              <span className="mono">
                {bonanza(position.staked > value ? position.staked - value : 0n)}
              </span>
            </div>
            <div className="rowline">
              <span>Lock</span>
              <span className="mono">
                {locked ? `${countdown(unlock - now)} left` : "Unlocked"}
              </span>
            </div>
          </>
        )}
      </div>
      {action()}
    </section>
  );
}

function Revenue({ position }: { position: StakingAccount }) {
  const { protocol } = useProtocol();
  const { address } = useWalletState();
  const { run } = useTx();
  const gate = useWalletGate();
  return (
    <section className="card" aria-label="Revenue">
      <h2 className="disp">Revenue</h2>
      {protocol.revenueAssets.map((asset) => {
        const token = tokenOf(protocol, asset);
        const amount = position.revenue[asset] ?? 0n;
        const key = `position-revenue-${position.id}-${asset}`;
        return (
          <div className="listrow" key={asset}>
            <div>
              <b className="mono">{formatToken(amount, token)}</b>
              {amount === 0n ? <span className="sub">Nothing to claim yet</span> : null}
            </div>
            {gate ? null : (
              <div>
                <TxButton
                  txKey={key}
                  tone="plain"
                  small
                  disabled={amount === 0n}
                  onClick={() =>
                    void run(
                      key,
                      async () => ({
                        ...lottery(),
                        functionName: "claimBonanzaRevenue",
                        args: [position.id, asset, address],
                      }),
                      {
                        action: `Claim ${formatToken(amount, token)}`,
                        pending: "Claiming…",
                        success: `Claimed ${formatToken(amount, token)}`,
                      }
                    )
                  }
                >
                  Claim
                </TxButton>
              </div>
            )}
          </div>
        );
      })}
      <p className="note">
        Revenue is booked to staked weight the moment a ticket sells. Claims stay open while the
        protocol is paused.
      </p>
    </section>
  );
}

function OperatorBoost({ position }: { position: StakingAccount }) {
  const { protocol } = useProtocol();
  const { address } = useWalletState();
  const { busy, run } = useTx();
  const gate = useWalletGate();
  const [text, setText] = useState("");
  const operatorId = /^\d+$/.test(text.trim()) ? BigInt(text.trim()) : null;
  const registerKey = `register-${position.id}`;
  const removeKey = `remove-boost-${position.id}`;
  // The card stays as it was until its own transaction finishes.
  const registered = busy[removeKey] ? true : busy[registerKey] ? false : position.registered;

  const register = async () => {
    const done = await run(
      registerKey,
      async () => {
        const [owner, tier] = await Promise.all([
          publicClient.readContract({
            address: protocol.bindings.operators,
            abi: operatorAbi,
            functionName: "ownerOf",
            args: [operatorId!],
          }),
          publicClient.readContract({
            address: protocol.bindings.registry,
            abi: activationAbi,
            functionName: "multiplierBps",
            args: [operatorId!],
          }),
        ]);
        if (owner !== address) throw new Error(`This wallet doesn't own Operator #${operatorId}.`);
        if (tier < BASE_MULTIPLIER_BPS) {
          throw new Error(`Operator #${operatorId} isn't active yet.`);
        }
        return {
          ...lottery(),
          functionName: "registerBonanzaOperator",
          args: [position.id, operatorId],
        };
      },
      { action: `Register Operator #${operatorId}`, success: `Operator #${operatorId} registered` }
    );
    if (done) setText("");
  };

  const accountAction = (key: string, functionName: string, label: string, success: string) => (
    <div>
      <TxButton
        txKey={key}
        tone="plain"
        disabled={Boolean(gate)}
        onClick={() =>
          void run(key, async () => ({ ...lottery(), functionName, args: [position.id] }), {
            action: label,
            success,
          })
        }
      >
        {label}
      </TxButton>
    </div>
  );

  return (
    <section className="card" aria-label="Operator boost">
      <h2 className="disp">Operator boost</h2>
      {registered ? (
        <>
          <div className="stats pair">
            <div>
              <span>Registered</span>
              <b>Operator #{position.operatorId.toString()}</b>
            </div>
            <div>
              <span>Multiplier</span>
              <b>{(Number(position.multiplierBps) / 10_000).toFixed(2)}×</b>
            </div>
          </div>
          <p className="note">
            Your boost ends if the Operator NFT or this position changes hands, and boosted revenue
            not yet checkpointed goes to other stakers.
          </p>
          <div className="pair-actions">
            {accountAction(
              `checkpoint-${position.id}`,
              "checkpointBonanzaAccount",
              "Checkpoint",
              "Checkpoint booked"
            )}
            {accountAction(removeKey, "removeBonanzaOperator", "Remove boost", "Boost removed")}
          </div>
        </>
      ) : (
        <>
          <p className="muted small-text">
            Register an Operator you own to boost this position. Each Operator can boost one
            account.
          </p>
          <label className="field-label">
            Operator ID
            <input
              className="input mono"
              inputMode="numeric"
              value={text}
              placeholder="#"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {gate ?? (
            <TxButton
              txKey={registerKey}
              disabled={operatorId === null || protocol.paused || !protocol.boostsEnabled}
              onClick={() => void register()}
            >
              {protocol.paused
                ? "Registration is paused"
                : protocol.boostsEnabled
                  ? operatorId === null
                    ? "Enter an Operator ID"
                    : `Register Operator #${operatorId}`
                  : "Registration is closed"}
            </TxButton>
          )}
        </>
      )}
    </section>
  );
}

function Reserve() {
  const { protocol } = useProtocol();
  const { bonanza } = useBonanza();
  const { inventory, backing, custody } = protocol.reserve;
  return (
    <section className="card" aria-label="Reward reserve">
      <h2 className="disp">Reserve</h2>
      <div className="rowline">
        <span>Reward inventory</span>
        <span className="mono">{bonanza(inventory)} BONANZA</span>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${percent(inventory, backing)} of supply remains in inventory`}
      >
        <i style={{ width: percent(inventory, backing) }} />
      </div>
      <div className="rowline">
        <span>Total supply</span>
        <span className="mono">{bonanza(backing)}</span>
      </div>
      <div className="rowline">
        <span>STATICS backing</span>
        <span className="mono">{bonanza(backing)}</span>
      </div>
      <div className="rowline">
        <span>Held in accounts</span>
        <span className="mono">{bonanza(custody)}</span>
      </div>
      <div className="rowline">
        <span>Total staked weight</span>
        <span className="mono">{bonanza(protocol.totalWeight)}</span>
      </div>
    </section>
  );
}

function Conversions({ position }: { position: StakingAccount }) {
  const { protocol, account } = useProtocol();
  const { bonanza, decimals } = useBonanza();
  const { address } = useWalletState();
  const { busy, run } = useTx();
  const gate = useWalletGate();
  const [unwrapText, setUnwrapText] = useState("");
  const [wrapText, setWrapText] = useState("");
  const { wrapEnabled, unwrapEnabled, wrapCap, wrapOutstanding } = protocol.reserve;
  const underlying = tokenOf(protocol, protocol.bindings.underlying);
  const free = position.balance - position.staked;
  const room = wrapCap > wrapOutstanding ? wrapCap - wrapOutstanding : 0n;

  const unwrapKey = `unwrap-${position.id}`;
  const wrapKey = `wrap-${position.id}`;
  const wrapApproveKey = `wrap-approve-${position.id}`;
  const unwrapAmount = parseAmount(unwrapText, decimals) ?? 0n;
  const wrapAmount = parseAmount(wrapText, decimals) ?? 0n;
  const held = account?.balances[underlying.address] ?? 0n;
  const allowance = account?.allowances[underlying.address] ?? 0n;

  const unwrapAction = () => {
    if (gate) return gate;
    if (busy[unwrapKey]) return <TxButton txKey={unwrapKey}>Unwrap</TxButton>;
    if (unwrapAmount === 0n) {
      return (
        <TxButton txKey={unwrapKey} disabled>
          Enter an amount
        </TxButton>
      );
    }
    if (unwrapAmount > free) {
      return (
        <TxButton txKey={unwrapKey} disabled>
          Not enough unstaked BONANZA
        </TxButton>
      );
    }
    return (
      <TxButton
        txKey={unwrapKey}
        onClick={async () => {
          const done = await run(
            unwrapKey,
            async () => ({
              ...lottery(),
              functionName: "unwrapBonanza",
              args: [position.id, unwrapAmount, address],
            }),
            {
              action: `Unwrap ${bonanza(unwrapAmount)} BONANZA`,
              success: `Unwrapped ${bonanza(unwrapAmount)} BONANZA`,
            }
          );
          if (done) setUnwrapText("");
        }}
      >
        Unwrap {bonanza(unwrapAmount)} BONANZA
      </TxButton>
    );
  };

  const wrapAction = () => {
    if (gate) return gate;
    if (busy[wrapApproveKey]) return <TxButton txKey={wrapApproveKey}>Approve</TxButton>;
    if (busy[wrapKey]) return <TxButton txKey={wrapKey}>Wrap</TxButton>;
    if (protocol.paused) {
      return (
        <TxButton txKey={wrapKey} disabled>
          Wrapping is paused
        </TxButton>
      );
    }
    if (wrapAmount === 0n) {
      return (
        <TxButton txKey={wrapKey} disabled>
          Enter an amount
        </TxButton>
      );
    }
    if (wrapAmount > room) {
      return (
        <TxButton txKey={wrapKey} disabled>
          Only {bonanza(room)} left under the cap
        </TxButton>
      );
    }
    if (wrapAmount > held) {
      return (
        <TxButton txKey={wrapKey} disabled>
          Not enough {underlying.symbol}
        </TxButton>
      );
    }
    if (allowance < wrapAmount) {
      return (
        <TxButton
          txKey={wrapApproveKey}
          onClick={() =>
            void run(
              wrapApproveKey,
              async () => ({
                address: underlying.address as Address,
                abi: erc20Abi,
                functionName: "approve",
                args: [deployment!.lottery, wrapAmount],
              }),
              { action: `Approve ${formatToken(wrapAmount, underlying)}`, success: "Approved" }
            )
          }
        >
          Approve {formatToken(wrapAmount, underlying)}
        </TxButton>
      );
    }
    return (
      <TxButton
        txKey={wrapKey}
        onClick={async () => {
          const done = await run(
            wrapKey,
            async () => ({
              ...lottery(),
              functionName: "wrapBonanza",
              args: [position.id, wrapAmount],
            }),
            {
              action: `Wrap ${formatToken(wrapAmount, underlying)}`,
              success: `Wrapped ${formatToken(wrapAmount, underlying)}`,
            }
          );
          if (done) setWrapText("");
        }}
      >
        Wrap {formatToken(wrapAmount, underlying)}
      </TxButton>
    );
  };

  return (
    <section className="card" aria-label="Conversions">
      <h2 className="disp">Conversions</h2>
      <div className="listrow">
        <div>
          <b>Unwrap to {underlying.symbol}</b>
          <span className="sub">Burn unstaked BONANZA for its backing</span>
        </div>
        <span className={`closed ${unwrapEnabled ? "on" : ""}`}>
          {unwrapEnabled ? "OPEN" : "CLOSED"}
        </span>
      </div>
      {unwrapEnabled ? (
        <>
          <div className="amount">
            <input
              inputMode="decimal"
              placeholder="0"
              value={unwrapText}
              aria-label="BONANZA to unwrap"
              onChange={(event) => setUnwrapText(event.target.value)}
            />
            <span>BONANZA</span>
          </div>
          {unwrapAction()}
        </>
      ) : null}
      <div className="listrow">
        <div>
          <b>Wrap {underlying.symbol}</b>
          <span className="sub">Mint BONANZA 1:1 into this position</span>
        </div>
        <span className={`closed ${wrapEnabled ? "on" : ""}`}>
          {wrapEnabled ? "OPEN" : "CLOSED"}
        </span>
      </div>
      {wrapEnabled ? (
        <>
          <div className="meter">
            <i style={{ width: percent(wrapOutstanding, wrapCap) }} />
          </div>
          <div className="rowline">
            <span>Wrap cap</span>
            <span className="mono">
              {bonanza(wrapOutstanding)} of {bonanza(wrapCap)}
            </span>
          </div>
          <div className="amount">
            <input
              inputMode="decimal"
              placeholder="0"
              value={wrapText}
              aria-label={`${underlying.symbol} to wrap`}
              onChange={(event) => setWrapText(event.target.value)}
            />
            <span>{underlying.symbol}</span>
          </div>
          {wrapAction()}
        </>
      ) : null}
    </section>
  );
}

export function BonanzaView() {
  const { protocol, account, accountLoading } = useProtocol();
  const { bonanza } = useBonanza();
  const gate = useWalletGate();
  const createPosition = useCreatePosition();
  const [chosen, setChosen] = useState<bigint | null>(null);
  const { unwrapEnabled } = protocol.reserve;
  const positions = account?.positions ?? [];
  const position = positions.find((entry) => entry.id === chosen) ?? positions[0];

  const heading = (
    <div className="pagehead">
      <h1 className="disp">BONANZA</h1>
      <p>Earn BONANZA by playing. Stake it in a position for a share of every ticket sold.</p>
    </div>
  );

  if (gate) {
    return (
      <>
        {heading}
        <div className="cards">
          <div className="empty">
            Connect a wallet to stake BONANZA.
            {gate}
          </div>
          <Reserve />
        </div>
      </>
    );
  }
  if (accountLoading || !account) {
    return (
      <>
        {heading}
        <div className="empty">Reading your positions…</div>
      </>
    );
  }
  if (!position) {
    return (
      <>
        {heading}
        <div className="cards">
          <div className="empty">
            BONANZA lives on a Statics position, which you can sell or move like any NFT.
            <TxButton txKey={CREATE_POSITION_KEY} onClick={createPosition}>
              Create a position
            </TxButton>
          </div>
          <Reserve />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="hero-bonanza">
        <div>
          <div className="eyebrow">BONANZA · Position #{position.id.toString()}</div>
          <h1 className="disp">
            {bonanza(position.balance)}
            <small>BONANZA</small>
          </h1>
          <p className="muted hero-note">
            {unwrapEnabled
              ? `Redeems 1:1 for ${tokenOf(protocol, protocol.bindings.underlying).symbol}`
              : "Backed 1:1 by STATICS · no market price · earns revenue when staked"}
          </p>
        </div>
        {positions.length > 1 ? (
          <label className="field-label position-select">
            Position
            <select
              value={position.id.toString()}
              onChange={(event) => setChosen(BigInt(event.target.value))}
            >
              {positions.map((entry) => (
                <option key={entry.id.toString()} value={entry.id.toString()}>
                  Position #{entry.id.toString()}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="cards">
        <div className="stack">
          <Stake key={position.id.toString()} position={position} />
          <Revenue position={position} />
        </div>
        <div className="stack">
          <OperatorBoost position={position} />
          <Reserve />
          <Conversions position={position} />
        </div>
      </div>
    </>
  );
}
