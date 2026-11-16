// Settings › Connect AI: whether AI apps may use Milo (through MCP), and connecting one.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, inDesktop } from "../../lib/api";
import { useUi } from "../../lib/store";
import { HelpTip } from "../../components/HelpTip";

type Access = "off" | "read" | "write";

export function AiSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["aiSetup"], queryFn: api.aiSetup, staleTime: 0 });
  const notify = useUi.getState().notify;
  if (!data) return null;
  const access = data.access as Access;
  const refresh = () => qc.invalidateQueries({ queryKey: ["aiSetup"] });

  const choose = async (a: Access) => {
    try {
      await api.setAiAccess(a);
      refresh();
    } catch (e) {
      notify({ text: String(e), error: true });
    }
  };
  const connect = async () => {
    try {
      await api.connectClaudeDesktop();
      refresh();
      notify({ text: "Milo is added to Claude Desktop. Quit and open Claude Desktop to start using it." });
    } catch (e) {
      notify({ text: String(e), error: true });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.snippet);
      notify({ text: "Settings copied. Paste them into the AI app's MCP settings." });
    } catch (e) {
      notify({ text: String(e), error: true });
    }
  };

  return (
    <div className="sub-blocks">
      <div className="setting">
        <div className="setting-text">
          <span className="setting-title">AI apps may</span>
          <HelpTip label="About AI apps">
            AI apps such as Claude Desktop can use Milo through MCP: read your calendar and to-dos, and if you allow it,
            add or change them. What they read goes to that AI service. Nothing is ever deleted: a change keeps the
            earlier version, and something archived can be brought back.
          </HelpTip>
        </div>
        <div className="setting-control">
          <div className="segmented" role="radiogroup" aria-label="AI apps may">
            {([["off", "Nothing"], ["read", "Read"], ["write", "Read and change"]] as [Access, string][]).map(([v, text]) => (
              <button key={v} role="radio" aria-checked={access === v} className={access === v ? "on" : ""} onClick={() => choose(v)}>
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>

      {access !== "off" && (
        <>
          <div className="setting">
            <div className="setting-text">
              <span className="setting-title">Claude Desktop</span>
            </div>
            <div className="setting-control">
              {data.claudeConnected ? (
                <span className="muted">Connected</span>
              ) : data.claudeFound ? (
                <button className="btn" onClick={connect}>Add Milo to Claude Desktop</button>
              ) : (
                <span className="muted">{inDesktop ? "Not found on this computer" : "Only in the desktop app"}</span>
              )}
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <span className="setting-title">Another AI app</span>
              <HelpTip label="About another AI app">
                Apps that use MCP (Claude Code, Cursor, ...) start Milo themselves. Paste these settings where the app
                lists its MCP servers.
              </HelpTip>
            </div>
            <div className="setting-control">
              <button className="btn" onClick={copy}>Copy settings</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
