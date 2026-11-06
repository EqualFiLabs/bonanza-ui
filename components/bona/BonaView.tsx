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

/** BONA carries its backing token's decimals. */
function useBona() {
  const { protocol } = useProtocol();
  const { decimals } = tokenOf(protocol, protocol.bindings.underlying);
  return { decimals, bona: (value: bigint) => formatAmount(value, decimals, 2) };
}

const multiplier = (position: StakingAccount) =>
  position.registered ? position.multiplierBps : BASE_MULTIPLIER_BPS;

function Stake({ position }: { position: StakingAccount }) {
  const { protocol, now } = useProtocol();
  const { bona, decimals } = useBona();
  const { run } = useTx();
  const gate = useWalletGate();
  const [tab, setTab] = useState<"stake" | "unstake">("stake");
  const [text, setText] = useState("");

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
      tab,
      async () => ({
        ...lottery(),
        functionName: staking ? "stakeFiddy" : "unstakeFiddy",
        args: [position.id, value],
      }),
      {
        action: `${staking ? "Stake" : "Unstake"} ${bona(value)} BONA`,
        success: `${staking ? "Staked" : "Unstaked"} ${bona(value)} BONA`,
      }
    );
    if (done) setText("");
  };

  const action = () => {
    if (gate) return gate;
    if (staking) {
      if (protocol.paused) {
        return (
          <TxButton txKey="stake" disabled>
            Staking is paused
          </TxButton>
        );
      }
      if (amount === null || value === 0n) {
        return (
          <TxButton txKey="stake" disabled>
            Enter an amount
          </TxButton>
        );
      }
      if (value > free) {
        return (
          <>
            <TxButton txKey="stake" disabled>
              Not enough unstaked BONA
            </TxButton>
            <p className="why">This position has {bona(free)} unstaked.</p>
          </>
        );
      }
      return (
        <TxButton txKey="stake" onClick={() => void submit()}>
          Stake {bona(value)} BONA
        </TxButton>
      );
    }
    if (position.staked === 0n) {
      return (
        <TxButton txKey="unstake" disabled>
          Nothing staked
        </TxButton>
      );
    }
    if (locked) {
      return (
        <>
          <TxButton txKey="unstake" disabled>
            Still locked
          </TxButton>
          <p className="why">Unstaking opens {LOCK_HOURS} hours after the weighted stake time.</p>
        </>
      );
    }
    if (amount === null || value === 0n) {
      return (
        <TxButton txKey="unstake" disabled>
          Enter an amount
        </TxButton>
      );
    }
    if (value > position.staked) {
      return (
        <TxButton txKey="unstake" disabled>
          More than is staked
        </TxButton>
      );
    }
    return (
      <TxButton txKey="unstake" onClick={() => void submit()}>
        Unstake {bona(value)} BONA
      </TxButton>
    );
  };

  return (
    <section className="card" aria-label="Stake">
      <h2 className="disp">Stake</h2>
      <div className="stats">
        <div>
          <span>Staked</span>
          <b>{bona(position.staked)}</b>
        </div>
        <div>
          <span>Revenue weight</span>
          <b>{bona(position.weight)}</b>
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
          aria-label="BONA amount"
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setText(formatUnits(staking ? free : position.staked, decimals))}
        >
          Max {bona(staking ? free : position.staked)}
        </button>
        <span>BONA</span>
      </div>
      <div className="calc">
        {staking ? (
          <>
            <div className="rowline">
              <span>Revenue weight after</span>
              <span className="mono">{bona(weightAfter)}</span>
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
                {bona(position.staked > value ? position.staked - value : 0n)}
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
                        functionName: "claimFiddyRevenue",
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
  const { run } = useTx();
  const gate = useWalletGate();
  const [text, setText] = useState("");
  const operatorId = /^\d+$/.test(text.trim()) ? BigInt(text.trim()) : null;

  const register = async () => {
    const done = await run(
      "register",
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
          functionName: "registerFiddyOperator",
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
      {position.registered ? (
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
              "checkpoint",
              "checkpointFiddyAccount",
              "Checkpoint",
              "Checkpoint booked"
            )}
            {accountAction("remove-boost", "removeFiddyOperator", "Remove boost", "Boost removed")}
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
              txKey="register"
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
  const { bona } = useBona();
  const { inventory, backing, custody } = protocol.reserve;
  return (
    <section className="card" aria-label="Reward reserve">
      <h2 className="disp">Reserve</h2>
      <div className="rowline">
        <span>Reward inventory</span>
        <span className="mono">{bona(inventory)} BONA</span>
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
        <span className="mono">{bona(backing)}</span>
      </div>
      <div className="rowline">
        <span>STATICS backing</span>
        <span className="mono">{bona(backing)}</span>
      </div>
      <div className="rowline">
        <span>Held in accounts</span>
        <span className="mono">{bona(custody)}</span>
      </div>
      <div className="rowline">
        <span>Total staked weight</span>
        <span className="mono">{bona(protocol.totalWeight)}</span>
      </div>
    </section>
  );
}

function Conversions({ position }: { position: StakingAccount }) {
  const { protocol, account } = useProtocol();
  const { bona, decimals } = useBona();
  const { address } = useWalletState();
  const { run } = useTx();
  const gate = useWalletGate();
  const [unwrapText, setUnwrapText] = useState("");
  const [wrapText, setWrapText] = useState("");
  const { wrapEnabled, unwrapEnabled, wrapCap, wrapOutstanding } = protocol.reserve;
  const underlying = tokenOf(protocol, protocol.bindings.underlying);
  const free = position.balance - position.staked;
  const room = wrapCap > wrapOutstanding ? wrapCap - wrapOutstanding : 0n;

  const unwrapAmount = parseAmount(unwrapText, decimals) ?? 0n;
  const wrapAmount = parseAmount(wrapText, decimals) ?? 0n;
  const held = account?.balances[underlying.address] ?? 0n;
  const allowance = account?.allowances[underlying.address] ?? 0n;

  const unwrapAction = () => {
    if (gate) return gate;
    if (unwrapAmount === 0n) {
      return (
        <TxButton txKey="unwrap" disabled>
          Enter an amount
        </TxButton>
      );
    }
    if (unwrapAmount > free) {
      return (
        <TxButton txKey="unwrap" disabled>
          Not enough unstaked BONA
        </TxButton>
      );
    }
    return (
      <TxButton
        txKey="unwrap"
        onClick={async () => {
          const done = await run(
            "unwrap",
            async () => ({
              ...lottery(),
              functionName: "unwrapFiddy",
              args: [position.id, unwrapAmount, address],
            }),
            {
              action: `Unwrap ${bona(unwrapAmount)} BONA`,
              success: `Unwrapped ${bona(unwrapAmount)} BONA`,
            }
          );
          if (done) setUnwrapText("");
        }}
      >
        Unwrap {bona(unwrapAmount)} BONA
      </TxButton>
    );
  };

  const wrapAction = () => {
    if (gate) return gate;
    if (protocol.paused) {
      return (
        <TxButton txKey="wrap" disabled>
          Wrapping is paused
        </TxButton>
      );
    }
    if (wrapAmount === 0n) {
      return (
        <TxButton txKey="wrap" disabled>
          Enter an amount
        </TxButton>
      );
    }
    if (wrapAmount > room) {
      return (
        <TxButton txKey="wrap" disabled>
          Only {bona(room)} left under the cap
        </TxButton>
      );
    }
    if (wrapAmount > held) {
      return (
        <TxButton txKey="wrap" disabled>
          Not enough {underlying.symbol}
        </TxButton>
      );
    }
    if (allowance < wrapAmount) {
      return (
        <TxButton
          txKey="wrap-approve"
          onClick={() =>
            void run(
              "wrap-approve",
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
        txKey="wrap"
        onClick={async () => {
          const done = await run(
            "wrap",
            async () => ({
              ...lottery(),
              functionName: "wrapFiddy",
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
          <span className="sub">Burn unstaked BONA for its backing</span>
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
              aria-label="BONA to unwrap"
              onChange={(event) => setUnwrapText(event.target.value)}
            />
            <span>BONA</span>
          </div>
          {unwrapAction()}
        </>
      ) : null}
      <div className="listrow">
        <div>
          <b>Wrap {underlying.symbol}</b>
          <span className="sub">Mint BONA 1:1 into this position</span>
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
              {bona(wrapOutstanding)} of {bona(wrapCap)}
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

export function BonaView() {
  const { protocol, account, accountLoading } = useProtocol();
  const { bona } = useBona();
  const gate = useWalletGate();
  const createPosition = useCreatePosition();
  const [chosen, setChosen] = useState<bigint | null>(null);
  const { unwrapEnabled } = protocol.reserve;
  const positions = account?.positions ?? [];
  const position = positions.find((entry) => entry.id === chosen) ?? positions[0];

  const heading = (
    <div className="pagehead">
      <h1 className="disp">BONA</h1>
      <p>Earn BONA by playing. Stake it in a position for a share of every ticket sold.</p>
    </div>
  );

  if (gate) {
    return (
      <>
        {heading}
        <div className="cards">
          <div className="empty">
            Connect a wallet to stake BONA.
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
            BONA lives on a Statics position, which you can sell or move like any NFT.
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
      <div className="hero-bona">
        <div>
          <div className="eyebrow">BONA · Position #{position.id.toString()}</div>
          <h1 className="disp">
            {bona(position.balance)}
            <small>BONA</small>
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
