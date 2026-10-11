import { useEffect, useRef } from "react";
import type { UseChat } from "../../hooks/useChat";
import ChatSidebar from "./ChatSidebar";
import ChatThread from "./ChatThread";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "../ui/Icon";

interface ChatWorkspaceProps {
  chat: UseChat;
  /** Text carried over from the command dock */
  draft: string;
  draftVersion: number;
  voiceOn: boolean;
  onSend: (text: string) => void;
  onToggleVoice: () => void;
  onClose: () => void;
}

/** JARVIS-style chat: 80% of the screen, history on the left, live thread on the right. */
export default function ChatWorkspace({ chat, draft, draftVersion, voiceOn, onSend, onToggleVoice, onClose }: ChatWorkspaceProps) {
  const composerRef = useRef<ComposerHandle>(null);

  useEffect(() => {
    composerRef.current?.setDraft(draft);
    composerRef.current?.focus();
  }, [draft, draftVersion]);

  useEffect(() => {
    void chat.refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="scrim scrim--chat" onClick={onClose} />
      <section className="workspace" role="dialog" aria-label="Chat with VECTOR">
        <header className="workspace__bar">
          <button className="btn btn--ghost workspace__back" onClick={onClose}>
            <Icon name="back" size={16} /> Main console
          </button>
          <h1 className="workspace__title" title={chat.activeTitle}>{chat.activeTitle}</h1>
          <span className="workspace__hint">Esc to go back</span>
        </header>

        <div className="workspace__body">
          <ChatSidebar
            conversations={chat.conversations}
            activeId={chat.activeId}
            onSelect={(id) => void chat.openConversation(id)}
            onNew={() => {
              chat.newConversation();
              composerRef.current?.focus();
            }}
            onRename={chat.rename}
            onDelete={chat.remove}
          />
          <div className="workspace__main">
            <ChatThread
              messages={chat.messages}
              pendingActions={chat.pendingActions}
              isStreaming={chat.isStreaming}
              onResolveAction={(id, approve) => void chat.resolveAction(id, approve)}
              onSuggestion={onSend}
            />
            <Composer
              ref={composerRef}
              isStreaming={chat.isStreaming}
              voiceOn={voiceOn}
              onSend={onSend}
              onStop={chat.stop}
              onToggleVoice={onToggleVoice}
            />
          </div>
        </div>
      </section>
    </>
  );
}
