"use client";

import { useTx } from "@/providers/tx-context";

type TxButtonProps = Readonly<{
  txKey: string;
  tone?: "primary" | "win" | "plain";
  small?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}>;

export function TxButton({
  txKey,
  tone = "primary",
  small = false,
  disabled = false,
  onClick,
  children,
}: TxButtonProps) {
  const { busy, errors } = useTx();
  const pending = busy[txKey];
  const toneClass = tone === "plain" ? "" : tone;
  return (
    <>
      <button
        type="button"
        className={`btn ${toneClass} ${small ? "small" : ""}`.trim()}
        disabled={disabled || Boolean(pending)}
        aria-busy={pending ? true : undefined}
        onClick={onClick}
      >
        {pending ? (
          <>
            <i className="spin" aria-hidden="true" />
            {pending}
          </>
        ) : (
          children
        )}
      </button>
      {errors[txKey] ? (
        <p className="err" role="alert">
          {errors[txKey]}
        </p>
      ) : null}
    </>
  );
}
