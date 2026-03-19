import {
  startTransition,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useT } from "../i18n";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface StreamingAssistantMessage {
  id: string;
  content: string;
  loading: boolean;
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAIChatStream({ activeNoteId }: { activeNoteId?: string }) {
  const t = useT();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<StreamingAssistantMessage | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const streamingContentRef = useRef("");
  const deferredStreamingContent = useDeferredValue(streamingMessage?.content ?? "");

  const renderedMessages = useMemo(() => {
    if (!streamingMessage) {
      return history;
    }

    return [
      ...history,
      {
        id: streamingMessage.id,
        role: "assistant" as const,
        content: deferredStreamingContent,
      },
    ];
  }, [deferredStreamingContent, history, streamingMessage]);

  const clearConversation = useCallback(() => {
    setHistory([]);
    setStreamingMessage(null);
    streamingContentRef.current = "";
  }, []);

  const finalizeAssistantMessage = useCallback((content: string) => {
    setHistory(prev => [
      ...prev,
      {
        id: createMessageId("assistant"),
        role: "assistant",
        content,
      },
    ]);
    setStreamingMessage(null);
    streamingContentRef.current = "";
  }, []);

  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId("user"),
      role: "user",
      content: question,
    };
    const streamingId = createMessageId("stream");

    setInput("");
    setStreaming(true);
    setHistory(prev => [...prev, userMessage]);
    setStreamingMessage({
      id: streamingId,
      content: "",
      loading: true,
    });
    streamingContentRef.current = "";

    try {
      const channel = new Channel<string>();
      channel.onmessage = chunk => {
        streamingContentRef.current += chunk;
        startTransition(() => {
          setStreamingMessage(prev =>
            prev
              ? {
                  ...prev,
                  content: streamingContentRef.current,
                  loading: false,
                }
              : prev
          );
        });
      };

      await invoke("ask_vault", {
        question,
        activeNoteId: activeNoteId ?? null,
        onEvent: channel,
      });

      finalizeAssistantMessage(streamingContentRef.current);
    } catch (cause) {
      const message = `${t("ai.error")}${cause instanceof Error ? cause.message : String(cause)}`;
      finalizeAssistantMessage(message);
    } finally {
      setStreaming(false);
    }
  }, [activeNoteId, finalizeAssistantMessage, input, streaming]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
  }, []);

  return {
    renderedMessages,
    streamingMessage,
    input,
    setInput,
    streaming,
    handleSubmit,
    handleKeyDown,
    handleInputChange,
    clearConversation,
  };
}
