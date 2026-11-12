"use client";

import { useEffect, useRef, useState } from "react";
import { ago, type TokenView } from "@/lib/near";
import { api, useStream, type ChatMessage } from "@/lib/social";
import { useWallet } from "@/lib/wallet";
import { SlabIcon } from "./Brand";

function short(a: string) {
  return a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/** Live per-token chat. Badges are snapshotted server-side from on-chain balances. */
export function Chat({ t, compact }: { t: TokenView; compact?: boolean }) {
  const { accountId, chat, chatSignIn, signIn } = useWallet();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setMsgs([]);
    api<ChatMessage[]>(`/tokens/${t.token_id}/messages?limit=100`)
      .then((m) => {
        setMsgs(m);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [t.token_id]);

  useStream(`token:${t.token_id}`, {
    message: (m) => setMsgs((xs) => (xs.some((x) => x.id === (m as ChatMessage).id) ? xs : [...xs.slice(-299), m as ChatMessage])),
    hide: (d) => setMsgs((xs) => xs.filter((x) => x.id !== (d as { id: number }).id)),
  });

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function send() {
    if (!text.trim() || !chat) return;
    setSending(true);
    setErr(null);
    try {
      const m = await api<ChatMessage>(`/tokens/${t.token_id}/messages`, {
        method: "POST",
        session: chat,
        body: JSON.stringify({ text, replyTo: reply?.id }),
      });
      setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
      setText("");
      setReply(null);
      stick.current = true;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function hide(id: number) {
    await api(`/messages/${id}`, { method: "DELETE", session: chat }).catch((e) => setErr((e as Error).message));
  }

  const byId = new Map(msgs.map((m) => [m.id, m]));
  const canModerate = accountId === t.creator;

  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <div
        className="chat-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {offline && <div className="empty small">Chat server unreachable.</div>}
        {!offline && msgs.length === 0 && <div className="empty small">No messages yet. Say gm to ${t.meta.symbol}.</div>}
        {msgs.map((m) => {
          const parent = m.reply_to ? byId.get(m.reply_to) : null;
          return (
            <div key={m.id} className={`msg ${m.account === accountId ? "mine" : ""}`}>
              <div className="msg-head">
                <span className="mono">{short(m.account)}</span>
                {m.is_dev === 1 && <span className="badge warn">DEV</span>}
                {m.holder_pct >= 0.01 && <span className="badge green">{m.holder_pct >= 1 ? m.holder_pct.toFixed(1) : m.holder_pct.toFixed(2)}%</span>}
                <span className="muted small">{ago(m.ts)}</span>
                <span className="msg-actions">
                  <button className="link" onClick={() => setReply(m)}>reply</button>
                  {(canModerate || m.account === accountId) && <button className="link" onClick={() => hide(m.id)}>hide</button>}
                </span>
              </div>
              {parent && <div className="msg-quote"><SlabIcon name="reply" size={11} /> {short(parent.account)}: {parent.text.slice(0, 80)}</div>}
              <div className="msg-text">{m.text}</div>
            </div>
          );
        })}
      </div>

      <div className="chat-input">
        {reply && (
          <div className="row between small muted" style={{ marginBottom: 6 }}>
            <span>Replying to {short(reply.account)}</span>
            <button className="link" onClick={() => setReply(null)}>cancel</button>
          </div>
        )}
        {err && <div className="small bad" style={{ marginBottom: 6 }}>{err}</div>}
        {!accountId ? (
          <button className="btn block" onClick={signIn}>Connect wallet to chat</button>
        ) : !chat ? (
          <button className="btn block" onClick={chatSignIn}>Sign in to chat (free, no gas)</button>
        ) : (
          <div className="row">
            <input
              className="input"
              placeholder={`Message $${t.meta.symbol} or tag @agent…`}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            />
            <button className="btn primary" disabled={sending || !text.trim()} onClick={send}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
}
