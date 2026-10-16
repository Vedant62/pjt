"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { Notice, StatusBadge } from "@/components/ui";
import { GATEWAY_URL, fmtDuration, useChainNow } from "@/lib/cashew";
import { useGatewaySession } from "@/lib/session";

type Msg = {
  role: "user" | "assistant";
  content: string;
  meta?: { promptTokens?: number; completionTokens?: number; ttftMs?: number; totalMs?: number; gridJobId?: string | null; cache?: string | null };
};
type PaymentRequired = { status: string; subId: string; nextChargeAt: number | null; planId: string; message: string };

export default function ChatPage() {
  const { address } = useAccount();
  const { session, signIn, signOut, error: authErr, busy: authBusy } = useGatewaySession();
  const now = useChainNow();
  const [model, setModel] = useState("qwen3:8b");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState<PaymentRequired | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const models = useQuery({
    queryKey: ["models"],
    retry: false,
    queryFn: async () => (await (await fetch(`${GATEWAY_URL}/v1/models`)).json()).data as { id: string; available: boolean | null }[],
  });
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    if (!session || !input.trim()) return;
    setErr(null);
    setPay(null);
    const history: Msg[] = [...msgs, { role: "user", content: input.trim() }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    const t0 = performance.now();
    try {
      const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ model, stream: true, max_tokens: 256, messages: history.map(({ role, content }) => ({ role, content: content.replace(/^<think>[\s\S]*?<\/think>/, "") })) }),
      });
      if (r.status === 402) {
        const j = await r.json();
        setPay(j.error);
        setMsgs(history);
        return;
      }
      if (r.status === 401) {
        signOut();
        throw new Error("Session expired — sign in again.");
      }
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error?.message ?? `HTTP ${r.status}`);
      }
      const meta: Msg["meta"] = { gridJobId: r.headers.get("x-grid-job-id"), cache: r.headers.get("x-cashew-entitlement-cache") };
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let content = "";
      let reasoning = ""; // qwen3 streams its thinking separately as reasoning_content
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (meta.ttftMs === undefined) meta.ttftMs = performance.now() - t0;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const delta = j.choices?.[0]?.delta ?? {};
            if (delta.reasoning_content || delta.reasoning) reasoning += delta.reasoning_content ?? delta.reasoning;
            if (delta.content) content += delta.content;
            if (j.usage) (meta.promptTokens = j.usage.prompt_tokens), (meta.completionTokens = j.usage.completion_tokens);
          } catch {}
        }
        setMsgs([...history, { role: "assistant", content: reasoning ? `<think>${reasoning}</think>${content}` : content, meta: { ...meta } }]);
      }
      meta.totalMs = performance.now() - t0;
      setMsgs([...history, { role: "assistant", content: reasoning ? `<think>${reasoning}</think>${content}` : content, meta }]);
    } catch (e) {
      setErr((e as Error).message);
      setMsgs(history);
    } finally {
      setSending(false);
    }
  }

  async function createKey() {
    const r = await fetch(`${GATEWAY_URL}/keys`, { method: "POST", headers: { authorization: `Bearer ${session!.token}` } });
    const j = await r.json();
    if (r.ok) setApiKey(j.key);
    else setErr(j.error?.message);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Chat</h1>
          <p className="mt-1 text-sm text-stone-600">OpenAI-compatible access to AI Power Grid through the Cashew Gateway, gated by your on-chain subscription.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input !w-auto" value={model} onChange={(e) => setModel(e.target.value)}>
            {(models.data ?? [{ id: "qwen3:8b", available: null }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.available === false ? " (offline)" : ""}
              </option>
            ))}
          </select>
          {session && (
            <button className="btn-secondary" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </div>

      {!address ? (
        <Notice>Connect a wallet first.</Notice>
      ) : !session ? (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">Sign in with Ethereum</div>
            <div className="text-stone-500">One signature (no transaction) proves you control this wallet. The gateway then checks your subscription on-chain.</div>
            {authErr && <div className="mt-1 text-red-700">{authErr}</div>}
          </div>
          <button className="btn-primary" onClick={signIn} disabled={authBusy}>
            {authBusy ? "Waiting for signature…" : "Sign in"}
          </button>
        </div>
      ) : null}

      {pay && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">402 Payment Required</span>
            <span className="text-sm">On-chain status:</span>
            <StatusBadge status={pay.status} />
            {pay.subId !== "0" && <span className="text-sm text-stone-600">sub #{pay.subId}</span>}
            {pay.nextChargeAt && (
              <span className="text-sm text-stone-600">
                {pay.status === "Cancelled" ? "paid through" : "next charge was due"} {fmtDuration(now - pay.nextChargeAt)} ago
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-red-900">{pay.message}</p>
          <Link href={`/plans/${pay.planId}`} className="btn-primary mt-3">
            Go to plan #{pay.planId} →
          </Link>
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}

      <div className="card min-h-[320px] space-y-4">
        {msgs.length === 0 && <p className="text-sm text-stone-400">Ask something. Responses stream from the grid (or the mock upstream in local mode).</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-cashew-600 text-white" : "bg-stone-100"}`}>
              <Content text={m.content || (sending && i === msgs.length - 1 ? "…" : "")} />
              {m.meta && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-stone-200 pt-1.5 text-[11px] text-stone-500">
                  {m.meta.ttftMs !== undefined && <span>TTFT {Math.round(m.meta.ttftMs)} ms</span>}
                  {m.meta.totalMs !== undefined && <span>total {Math.round(m.meta.totalMs)} ms</span>}
                  {m.meta.promptTokens !== undefined && <span>{m.meta.promptTokens} prompt + {m.meta.completionTokens} completion tokens</span>}
                  {m.meta.cache && <span>entitlement {m.meta.cache}</span>}
                  {m.meta.gridJobId && <span className="mono">job {m.meta.gridJobId}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className="input" placeholder={session ? "Message qwen…" : "Sign in to chat"} value={input} onChange={(e) => setInput(e.target.value)} disabled={!session || sending} />
        <button className="btn-primary" disabled={!session || sending || !input.trim()}>
          {sending ? "Streaming…" : "Send"}
        </button>
      </form>

      {session && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <div className="font-medium">API key for curl / SDKs</div>
              <div className="text-stone-500">Bound to {session.address}; works only while the subscription is entitled. Only its hash is stored.</div>
            </div>
            <button className="btn-secondary" onClick={createKey}>
              Create API key
            </button>
          </div>
          {apiKey && (
            <pre className="mono mt-3 overflow-x-auto rounded-lg bg-stone-900 p-3 text-stone-100">{`curl ${GATEWAY_URL}/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"hi"}],"max_tokens":64}'`}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Render qwen3 <think>…</think> blocks muted. */
function Content({ text }: { text: string }) {
  const m = text.match(/^<think>([\s\S]*?)(<\/think>|$)([\s\S]*)$/);
  if (!m) return <div className="whitespace-pre-wrap">{text}</div>;
  return (
    <div>
      <div className="mb-1 whitespace-pre-wrap border-l-2 border-stone-300 pl-2 text-xs italic text-stone-500">{m[1].trim() || "thinking…"}</div>
      <div className="whitespace-pre-wrap">{m[3].trim()}</div>
    </div>
  );
}
