import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Link2,
  Loader2,
  MessageSquareText,
  Send,
  Route,
  Square,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  type AgentBackend,
  type AgentContextScope,
  type AgentMessage,
  type AgentRun,
  type AgentRunEvent,
  type AgentJobStatus,
  buildAgentRunEventsUrl,
  cancelAgentRun,
  createAgentMessage,
  createAgentSession,
  getAgentRun,
  getAgentSession,
  listAgentBackends,
} from '../../lib/api';
import { useToast } from '../ui/Toast';

const STATUS_VIEW: Record<AgentJobStatus, { label: string; className: string }> = {
  queued: {
    label: '排队中',
    className: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  running: {
    label: '运行中',
    className: 'bg-primary-50 text-primary-700 ring-primary-200',
  },
  completed: {
    label: '已完成',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  failed: {
    label: '失败',
    className: 'bg-red-50 text-red-700 ring-red-200',
  },
  cancelled: {
    label: '已取消',
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
  },
};

const TERMINAL_STATUSES: AgentJobStatus[] = ['completed', 'failed', 'cancelled'];
const MAX_INPUT_LENGTH = 6000;
const MAX_STORED_EVENTS = 60;
const ACTIVE_SESSION_STORAGE_KEY = 'smart-design-agent:active-session-id';
const SESSION_DRAFTS_STORAGE_KEY = 'smart-design-agent:session-drafts';
const SYSTEM_ERROR_MARKERS = ['<system-reminder>', 'program not found', '找不到程序', 'internal server error'];
const DATA_QA_PREVIEW_ROW_LIMIT = 20;
export const GLOBAL_AGENT_ASSISTANT_OPEN_EVENT = 'smart-design-agent:open';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  runId?: string | null;
  status?: AgentJobStatus;
  events?: AgentRunEvent[];
  result?: Record<string, unknown> | null;
  error?: string | null;
  streamError?: string | null;
}

interface AssistantContext {
  scope: AgentContextScope;
  ref: Record<string, unknown>;
}

interface GlobalAgentAssistantProps {
  currentProjectId?: string | null;
  openSignal?: string | null;
}

interface AgentAssistantOpenDetail {
  prompt?: string;
  projectId?: string | null;
}

interface ProjectAgentWorkspaceProps {
  projectId: string;
}

interface DataQaColumn {
  key: string;
  label?: string;
}

interface DataQaChartPoint {
  x: unknown;
  y: number;
}

interface DataQaChart {
  type?: string;
  x?: string;
  y?: string;
  data?: DataQaChartPoint[];
}

interface DataQaResult {
  generated_sql?: string;
  columns?: DataQaColumn[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  truncated?: boolean;
  chart?: DataQaChart | null;
  execution_steps?: Array<Record<string, unknown>>;
  warnings?: string[];
}

export function GlobalAgentAssistant({ currentProjectId = null, openSignal = null }: GlobalAgentAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => readActiveSessionId());
  const [sessionTitle, setSessionTitle] = useState('AI Harness');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<AssistantContext>(() => buildDefaultContext(currentProjectId));
  const [prompt, setPrompt] = useState('');
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null);
  const [agentBackends, setAgentBackends] = useState<AgentBackend[]>([]);
  const [backendsError, setBackendsError] = useState<string | null>(null);
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const { error: showError, success } = useToast();

  const isActiveRun = currentRun ? !TERMINAL_STATUSES.includes(currentRun.status) : false;
  const isBusy = isLoadingSession || isCreating || isCancelling || isActiveRun;
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const contextLabel = formatContextLabel(context, currentProjectId);
  const defaultBackend = agentBackends.find((backend) => backend.is_default) ?? agentBackends[0] ?? null;
  const hasLoadedBackends = agentBackends.length > 0 || Boolean(backendsError);
  const isBackendAvailable = !hasLoadedBackends || (!backendsError && agentBackends.some((backend) => backend.status === 'available'));
  const backendErrorMessage = defaultBackend?.health_message || backendsError || 'AI Harness 运行后端不可用';

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const updateAssistantMessage = useCallback((messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((previous) =>
      previous.map((message) => (message.id === messageId ? updater(message) : message)),
    );
  }, []);

  const refreshRun = useCallback(
    async (runId: string, messageId: string) => {
      const run = await getAgentRun(runId);
      setCurrentRun(run);
      setMessages((previous) => upsertAssistantRunMessage(previous, run, messageId));
      if (TERMINAL_STATUSES.includes(run.status)) {
        setActiveAssistantMessageId((current) => (current === messageId ? null : current));
      }
      return run;
    },
    [],
  );

  const openEventStream = useCallback(
    (runId: string, messageId: string, options?: { replay?: boolean; afterSeq?: number }) => {
      closeStream();
      const replay = options?.replay ?? true;
      const afterSeq = options?.afterSeq ?? 0;

      if (replay) {
        updateAssistantMessage(messageId, (message) => ({ ...message, events: [], streamError: null }));
      }

      const source = new EventSource(buildAgentRunEventsUrl(runId, afterSeq), {
        withCredentials: true,
      });
      sourceRef.current = source;

      source.addEventListener('agent-event', (event: Event) => {
        const parsed = parseAgentEvent(event);
        if (!parsed) {
          updateAssistantMessage(messageId, (message) => ({ ...message, streamError: '事件流数据解析失败' }));
          return;
        }

        updateAssistantMessage(messageId, (message) => ({
          ...message,
          events: appendAgentEvent(message.events ?? [], parsed),
          status: isProgressEvent(parsed.event_type) && !isTerminalStatus(message.status) ? 'running' : message.status,
          content: isProgressEvent(parsed.event_type) && !message.result && !message.error ? '正在处理请求...' : message.content,
          streamError: null,
        }));

        if (isProgressEvent(parsed.event_type)) {
          setCurrentRun((run) =>
            run && run.id === runId && !TERMINAL_STATUSES.includes(run.status) ? { ...run, status: 'running' } : run,
          );
        }

        if (parsed.event_type === 'completed' || parsed.event_type === 'failed' || parsed.event_type === 'cancelled') {
          closeStream();
          void refreshRun(runId, messageId);
        }
      });

      source.addEventListener('agent-error', (event: Event) => {
        const message = parseAgentError(event) ?? '事件流连接失败';
        updateAssistantMessage(messageId, (chatMessage) => ({ ...chatMessage, streamError: message }));
      });

      source.onerror = () => {
        updateAssistantMessage(messageId, (message) => ({
          ...message,
          streamError: '事件流连接中断，正在等待重连',
        }));
      };
    },
    [closeStream, refreshRun, updateAssistantMessage],
  );

  const loadSession = useCallback(
    async (targetSessionId: string) => {
      setIsLoadingSession(true);
      try {
        const detail = await getAgentSession(targetSessionId);
        setSessionId(detail.session.id);
        setSessionTitle(detail.session.title || 'AI Harness');
        setContext({
          scope: detail.session.context_scope,
          ref: detail.session.context_ref ?? {},
        });
        const restoredMessages = detail.messages.map((message) => messageToChatMessage(message));
        setMessages(restoredMessages);
        writeActiveSessionId(detail.session.id);
        setPrompt(readDraft(detail.session.id));

        const lastRunMessage = [...detail.messages].reverse().find((message) => message.role === 'assistant' && message.run_id);
        if (!lastRunMessage?.run_id) {
          return;
        }
        const run = await getAgentRun(lastRunMessage.run_id);
        setCurrentRun(run);
        setMessages((previous) => upsertAssistantRunMessage(previous, run, lastRunMessage.id));
        if (!TERMINAL_STATUSES.includes(run.status)) {
          setActiveAssistantMessageId(lastRunMessage.id);
          openEventStream(run.id, lastRunMessage.id, { replay: true, afterSeq: 0 });
        }
      } catch (error) {
        console.error(error);
        clearActiveSessionId();
        setSessionId(null);
        setMessages([]);
        setCurrentRun(null);
        showError('AI 会话加载失败');
      } finally {
        setIsLoadingSession(false);
      }
    },
    [openEventStream, showError],
  );

  useEffect(() => {
    if (openSignal) {
      setIsOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as AgentAssistantOpenDetail | undefined) : undefined;
      const projectId = typeof detail?.projectId === 'string' && detail.projectId ? detail.projectId : currentProjectId;

      setIsOpen(true);
      if (typeof detail?.prompt === 'string' && detail.prompt.trim()) {
        setPrompt(detail.prompt);
      }
      if (projectId) {
        setContext({ scope: 'project', ref: { project_id: projectId } });
      }
    };

    window.addEventListener(GLOBAL_AGENT_ASSISTANT_OPEN_EVENT, handleOpenRequest);
    return () => window.removeEventListener(GLOBAL_AGENT_ASSISTANT_OPEN_EVENT, handleOpenRequest);
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId) {
      setContext({ scope: 'project', ref: { project_id: currentProjectId } });
    } else {
      setContext((current) => (current.scope === 'project' ? { scope: 'none', ref: {} } : current));
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (!isOpen || !sessionId || messages.length > 0 || isLoadingSession) {
      return;
    }
    void loadSession(sessionId);
  }, [isOpen, isLoadingSession, loadSession, messages.length, sessionId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    async function loadBackends() {
      try {
        const backends = await listAgentBackends();
        if (!cancelled) {
          setAgentBackends(backends);
          setBackendsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setBackendsError(error instanceof Error ? error.message : '运行后端状态加载失败');
        }
      }
    }
    void loadBackends();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    writeDraft(sessionId, prompt);
  }, [prompt, sessionId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [isOpen, messages, lastAssistantMessage?.content, lastAssistantMessage?.status]);

  const handleSend = useCallback(async () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      showError('请输入内容');
      return;
    }
    if (isActiveRun) {
      showError('当前任务运行中，请等待完成或先取消');
      return;
    }
    if (!isBackendAvailable) {
      showError(backendErrorMessage);
      return;
    }

    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: normalizedPrompt,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      id: createId('assistant'),
      role: 'assistant',
      content: '正在创建任务...',
      createdAt: new Date().toISOString(),
      status: 'queued',
      events: [],
    };
    const sendContext = buildSendContext(context, currentProjectId);

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setPrompt('');
    setIsCreating(true);
    setContext(sendContext);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await createAgentSession({
          title: buildSessionTitle(normalizedPrompt),
          context_scope: sendContext.scope,
          context_ref: sendContext.ref,
        });
        activeSessionId = session.id;
        setSessionId(session.id);
        setSessionTitle(session.title || 'AI Harness');
        writeActiveSessionId(session.id);
        const legacyMessages = readLegacyProjectMessages(currentProjectId);
        if (legacyMessages.length > 0) {
          setMessages((previous) => [...legacyMessages, ...previous]);
        }
      }

      const result = await createAgentMessage(activeSessionId, {
        prompt: normalizedPrompt,
        context_scope: sendContext.scope,
        context_ref: sendContext.ref,
        capability_profile: 'full_access',
        backend_id: null,
      });

      const savedUserMessage = messageToChatMessage(result.user_message);
      const savedAssistantMessage = messageToChatMessage(result.assistant_message, result.run);
      setMessages((previous) =>
        previous.map((message) => {
          if (message.id === userMessage.id) return savedUserMessage;
          if (message.id === assistantMessage.id) return savedAssistantMessage;
          return message;
        }),
      );
      setCurrentRun(result.run);
      setActiveAssistantMessageId(result.assistant_message.id);
      openEventStream(result.run.id, result.assistant_message.id, { replay: true, afterSeq: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI Harness 任务创建失败';
      updateAssistantMessage(assistantMessage.id, (chatMessage) => ({
        ...chatMessage,
        status: 'failed',
        content: message,
        error: message,
      }));
      showError(message);
    } finally {
      setIsCreating(false);
    }
  }, [
    context,
    currentProjectId,
    isActiveRun,
    isBackendAvailable,
    backendErrorMessage,
    openEventStream,
    prompt,
    sessionId,
    showError,
    updateAssistantMessage,
  ]);

  const handleCancelRun = async () => {
    if (!currentRun || !activeAssistantMessageId || !isActiveRun) {
      return;
    }

    setIsCancelling(true);
    try {
      const run = await cancelAgentRun(currentRun.id);
      setCurrentRun(run);
      setMessages((previous) => upsertAssistantRunMessage(previous, run, activeAssistantMessageId));
      success('已请求取消任务');
    } catch (error) {
      showError(error instanceof Error ? error.message : '取消失败');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleNewSession = () => {
    closeStream();
    clearActiveSessionId();
    setSessionId(null);
    setSessionTitle('AI Harness');
    setMessages([]);
    setCurrentRun(null);
    setActiveAssistantMessageId(null);
    setPrompt('');
    setContext(buildDefaultContext(currentProjectId));
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-xl shadow-primary-600/30 ring-1 ring-white/70 transition hover:-translate-y-0.5 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          title="AI Harness"
        >
          {isActiveRun ? <Loader2 className="h-6 w-6 animate-spin" /> : <MessageSquareText className="h-6 w-6" />}
          {isActiveRun && (
            <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
          )}
        </button>
      )}

      {isOpen && (
        <section className="fixed inset-x-3 bottom-3 z-[60] flex max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/90 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/5 backdrop-blur-xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(720px,calc(100vh-3rem))] sm:w-[420px]">
          <header className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-900">AI Harness</h2>
                  <p className="truncate text-xs text-slate-500">{sessionTitle}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleNewSession}
                  disabled={isBusy}
                  className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  新会话
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  title="收起"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
                <Link2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{contextLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <Route className="h-3.5 w-3.5" />
                自动路由
              </span>
              <span
                className={clsx(
                  'inline-flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1',
                  isBackendAvailable
                    ? 'bg-slate-50 text-slate-600 ring-slate-200'
                    : 'bg-red-50 text-red-700 ring-red-100',
                )}
                title={defaultBackend?.health_message ?? undefined}
              >
                {isBackendAvailable ? <Activity className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{formatBackendLabel(defaultBackend, backendsError, agentBackends)}</span>
              </span>
              {context.scope !== 'none' && (
                <button
                  type="button"
                  onClick={() => setContext({ scope: 'none', ref: {} })}
                  disabled={isBusy}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  清除上下文
                </button>
              )}
              {currentProjectId && context.scope !== 'project' && (
                <button
                  type="button"
                  onClick={() => setContext({ scope: 'project', ref: { project_id: currentProjectId } })}
                  disabled={isBusy}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-200 transition hover:bg-primary-50 disabled:opacity-50"
                >
                  使用当前项目
                </button>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {renderAssistantBody({ isLoadingSession, messages })}
            <div ref={bottomRef} />
          </div>

          <footer className="border-t border-slate-100 bg-white/95 px-4 py-3">
            {isActiveRun && (
              <div className="mb-2 flex items-center justify-between rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs text-primary-700">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  AI Harness 正在执行
                </span>
                <button
                  type="button"
                  onClick={() => void handleCancelRun()}
                  disabled={isCancelling}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  取消
                </button>
              </div>
            )}
            {!isBackendAvailable && (
              <div className="mb-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                {backendErrorMessage}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">输入给 AI Harness 的请求</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                rows={2}
                maxLength={MAX_INPUT_LENGTH}
                  disabled={isBusy || !isBackendAvailable}
                  className="max-h-32 min-h-[48px] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-5 text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-slate-400"
                  placeholder="直接输入问题或任务，Enter 发送"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!prompt.trim() || isBusy || !isBackendAvailable}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm shadow-primary-600/20 transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:pointer-events-none disabled:opacity-50"
                title="发送"
              >
                {isCreating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}

export function ProjectAgentWorkspace({ projectId }: ProjectAgentWorkspaceProps) {
  return <GlobalAgentAssistant currentProjectId={projectId} openSignal={`project-agent-workspace:${projectId}`} />;
}

function renderAssistantBody({ isLoadingSession, messages }: { isLoadingSession: boolean; messages: ChatMessage[] }) {
  if (isLoadingSession) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center text-sm text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在恢复 AI 会话
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center text-center text-sm text-slate-400">
        <div>
          <Bot className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p>直接描述目标，AI 会自行选择需要的工具和上下文。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <ChatMessageRow key={message.id} message={message} />
      ))}
    </div>
  );
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const dataQaResult = isUser ? null : extractDataQaResult(message.result);
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'min-w-0',
          dataQaResult ? 'w-full max-w-[96%]' : 'max-w-[88%]',
          isUser ? 'text-right' : 'text-left',
        )}
      >
        <div
          className={clsx(
            'rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm',
            isUser
              ? 'bg-primary-600 text-white shadow-primary-600/15'
              : 'border border-slate-100 bg-white text-slate-700 shadow-slate-100',
          )}
        >
          {!isUser && message.status && <StatusBadge status={message.status} />}
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
        {dataQaResult && <DataQaResultPanel dataQa={dataQaResult} />}
        {!isUser && (
          <ProcessDetails events={message.events ?? []} streamError={message.streamError} error={message.error} />
        )}
        <div className={clsx('mt-1 text-[11px] text-slate-400', isUser ? 'pr-1' : 'pl-1')}>
          {formatDateTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function DataQaResultPanel({ dataQa }: { dataQa: DataQaResult }) {
  const columns = normalizeDataQaColumns(dataQa);
  const rows = Array.isArray(dataQa.rows) ? dataQa.rows : [];
  const previewRows = rows.slice(0, DATA_QA_PREVIEW_ROW_LIMIT);
  const warnings = Array.isArray(dataQa.warnings) ? dataQa.warnings.filter(Boolean) : [];

  return (
    <div className="mt-2 space-y-2 rounded-2xl border border-primary-100 bg-primary-50/40 p-3 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-semibold text-primary-700">
          <Database className="h-3.5 w-3.5" />
          智能问数结果
        </span>
        <span>
          {typeof dataQa.row_count === 'number' ? `${dataQa.row_count} 行` : `${rows.length} 行`}
          {dataQa.truncated ? ' · 已截断' : ''}
        </span>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
          {warnings.join('；')}
        </div>
      )}

      <DataQaChartView chart={dataQa.chart ?? null} />
      <DataQaTable columns={columns} rows={previewRows} totalRows={rows.length} />

      <details className="rounded-xl border border-slate-100 bg-white/90">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-600">
          <span>SQL 与执行详情</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </summary>
        <div className="space-y-2 border-t border-slate-100 p-3">
          {dataQa.generated_sql && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
              {dataQa.generated_sql}
            </pre>
          )}
          {Array.isArray(dataQa.execution_steps) && dataQa.execution_steps.length > 0 && (
            <div className="space-y-1">
              {dataQa.execution_steps.map((step, index) => (
                <div key={`${String(step.step ?? 'step')}-${index}`} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
                  {formatExecutionStep(step)}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function DataQaChartView({ chart }: { chart: DataQaChart | null }) {
  const points = Array.isArray(chart?.data)
    ? chart.data.filter((item): item is DataQaChartPoint => typeof item.y === 'number' && Number.isFinite(item.y))
    : [];
  if (points.length === 0) {
    return null;
  }

  const maxValue = Math.max(...points.map((point) => Math.abs(point.y)), 1);
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <BarChart3 className="h-3.5 w-3.5 text-primary-600" />
        {formatChartType(chart?.type)}
      </div>
      <div className="space-y-2">
        {points.slice(0, 8).map((point, index) => {
          const width = `${Math.max(4, Math.round((Math.abs(point.y) / maxValue) * 100))}%`;
          return (
            <div key={`${String(point.x)}-${index}`} className="grid grid-cols-[minmax(72px,0.8fr)_minmax(120px,1.2fr)] items-center gap-2 text-xs">
              <span className="truncate text-slate-500" title={String(point.x ?? '')}>
                {formatCellValue(point.x)}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 rounded-full bg-primary-500" style={{ width }} />
                <span className="shrink-0 tabular-nums text-slate-600">{formatCellValue(point.y)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DataQaTable({
  columns,
  rows,
  totalRows,
}: {
  columns: DataQaColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
}) {
  if (columns.length === 0) {
    return null;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white px-3 py-4 text-center text-xs text-slate-400">
        没有明细数据
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <div className="max-h-72 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-left font-semibold">
                  {column.label || column.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="text-slate-700">
                {columns.map((column) => (
                  <td key={column.key} className="max-w-40 whitespace-nowrap px-3 py-2">
                    <span className="block truncate" title={formatCellValue(row[column.key])}>
                      {formatCellValue(row[column.key])}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > rows.length && (
        <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
          仅预览前 {rows.length} 行
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentJobStatus }) {
  const view = STATUS_VIEW[status];
  return (
    <span className={clsx('mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', view.className)}>
      {status === 'running' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === 'queued' ? (
        <Clock className="h-3 w-3" />
      ) : status === 'completed' ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : status === 'failed' ? (
        <AlertCircle className="h-3 w-3" />
      ) : (
        <Square className="h-3 w-3" />
      )}
      {view.label}
    </span>
  );
}

function ProcessDetails({
  events,
  streamError,
  error,
}: {
  events: AgentRunEvent[];
  streamError?: string | null;
  error?: string | null;
}) {
  if (events.length === 0 && !streamError && !error) {
    return null;
  }

  return (
    <details className="mt-2 rounded-xl border border-slate-100 bg-slate-50/80 text-left">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-500">
        <span>查看过程{events.length > 0 ? ` (${events.length})` : ''}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </summary>
      <div className="border-t border-slate-100 p-2">
        {streamError && (
          <div className="mb-2 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-700">
            {streamError}
          </div>
        )}
        {error && (
          <div className="mb-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-700">
            {error}
          </div>
        )}
        {events.length === 0 ? (
          <div className="px-2.5 py-3 text-center text-xs text-slate-400">暂无过程事件</div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <AgentEventRow key={`${event.seq}-${event.event_type}`} event={event} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function AgentEventRow({ event }: { event: AgentRunEvent }) {
  const isError = event.event_type === 'failed' || event.event_type === 'runner_error';
  const isDone = event.event_type === 'completed';
  const payload = compactEventPayload(event);
  const iconClassName = clsx(
    'mt-0.5 rounded-lg p-1.5',
    isError && 'bg-red-50 text-red-600',
    isDone && 'bg-emerald-50 text-emerald-600',
    !isError && !isDone && 'bg-primary-50 text-primary-700',
  );

  return (
    <div className="flex gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
      <span className={iconClassName}>
        {isError ? <AlertCircle className="h-3.5 w-3.5" /> : isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-slate-500">
            #{event.seq} {formatEventType(event.event_type)}
          </span>
          {event.created_at && <span className="text-[10px] text-slate-400">{formatDateTime(event.created_at)}</span>}
        </div>
        {event.message && <p className="mt-1 text-xs leading-5 text-slate-600">{event.message}</p>}
        {payload && Object.keys(payload).length > 0 && (
          <details className="mt-2 rounded-lg bg-slate-50 text-[11px] leading-5 text-slate-600">
            <summary className="cursor-pointer px-2 py-1 font-semibold text-slate-500">原始数据</summary>
            <pre className="max-h-28 overflow-auto border-t border-slate-100 p-2">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function formatEventType(eventType: string) {
  const labels: Record<string, string> = {
    queued: '排队',
    started: '开始',
    context: '上下文',
    runtime_config: '运行配置',
    tool: '工具',
    tool_call: '工具调用',
    tool_result: '工具结果',
    assistant_message: '回复',
    usage: '用量',
    runner_error: '运行错误',
    scope_resolved: '范围',
    catalog_selected: '目录',
    query_planned: '计划',
    query_retry: '重试',
    sql_compiled: 'SQL',
    sql_executed: '执行',
    answer_generated: '解读',
    completed: '完成',
    failed: '失败',
    cancelled: '取消',
    cancel_requested: '取消请求',
  };
  return labels[eventType] ?? eventType;
}

function compactEventPayload(event: AgentRunEvent) {
  if (!event.payload || Object.keys(event.payload).length === 0) {
    return null;
  }
  if (event.event_type === 'assistant_message' && typeof event.payload.message === 'string') {
    return null;
  }
  return event.payload;
}

function parseAgentEvent(event: Event): AgentRunEvent | null {
  const messageEvent = event as MessageEvent<string>;
  try {
    const parsed = JSON.parse(messageEvent.data) as AgentRunEvent;
    if (typeof parsed.seq !== 'number' || typeof parsed.event_type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseAgentError(event: Event): string | null {
  const messageEvent = event as MessageEvent<string>;
  try {
    const parsed = JSON.parse(messageEvent.data) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return null;
  }
}

function appendAgentEvent(events: AgentRunEvent[], event: AgentRunEvent) {
  if (events.some((item) => item.seq === event.seq)) {
    return events;
  }
  return [...events, event].sort((left, right) => left.seq - right.seq).slice(-MAX_STORED_EVENTS);
}

function upsertAssistantRunMessage(messages: ChatMessage[], run: AgentRun, messageId: string) {
  const existingMessage = messages.find((message) => message.id === messageId);
  const nextMessage = runToAssistantMessage(run, messageId, existingMessage?.events ?? []);
  if (!existingMessage) {
    return [...messages, nextMessage];
  }
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          ...nextMessage,
          events: message.events ?? nextMessage.events,
          streamError: message.streamError ?? null,
        }
      : message,
  );
}

function messageToChatMessage(message: AgentMessage, run?: AgentRun): ChatMessage {
  if (message.role === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      content: run ? formatRunContent(run) : message.content,
      createdAt: message.created_at,
      runId: message.run_id,
      status: run?.status,
      result: run?.result ?? message.structured_content,
      error: run?.error ?? null,
      events: [],
    };
  }

  return {
    id: message.id,
    role: 'user',
    content: message.content,
    createdAt: message.created_at,
  };
}

function runToAssistantMessage(run: AgentRun, messageId: string, events: AgentRunEvent[] = []): ChatMessage {
  return {
    id: messageId,
    role: 'assistant',
    content: formatRunContent(run, events),
    createdAt: run.created_at || new Date().toISOString(),
    runId: run.id,
    status: run.status,
    result: run.result,
    error: run.error,
    events,
  };
}

function formatRunContent(run: AgentRun, events: AgentRunEvent[] = []) {
  if (run.status === 'failed') {
    return run.error || extractEventAnswer(events) || '任务失败';
  }
  if (run.status === 'cancelled') {
    return '任务已取消';
  }
  if (run.status === 'completed') {
    if (!run.result) {
      return extractEventAnswer(events) ?? '任务已完成，但没有返回内容。';
    }
    return extractResultText(run.result) ?? extractEventAnswer(events) ?? '任务已完成，但没有返回内容。';
  }
  if (run.cancel_requested) {
    return '正在取消任务...';
  }
  return run.status === 'queued' ? '任务已创建，等待运行。' : '正在处理请求...';
}

function extractResultText(result: Record<string, unknown>) {
  const directText = pickTextValue(result, ['answer', 'text', 'message', 'content', 'summary', 'output', 'recommendation']);
  if (directText && !looksLikeRuntimeError(directText)) {
    return directText;
  }
  if (directText) {
    return null;
  }
  const nestedResult = result.result;
  if (isRecord(nestedResult)) {
    const nestedText = pickTextValue(nestedResult, ['answer', 'text', 'message', 'content', 'summary', 'output']);
    if (nestedText && !looksLikeRuntimeError(nestedText)) {
      return nestedText;
    }
    if (nestedText) {
      return null;
    }
  }
  return hasMeaningfulValue(result) ? JSON.stringify(result, null, 2) : null;
}

function extractDataQaResult(result: Record<string, unknown> | null | undefined): DataQaResult | null {
  if (!isRecord(result?.data_qa)) {
    return null;
  }
  const dataQa = result.data_qa;
  const rows = Array.isArray(dataQa.rows)
    ? dataQa.rows.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
  const columns = Array.isArray(dataQa.columns)
    ? dataQa.columns
        .filter(isRecord)
        .map((column) => ({
          key: String(column.key ?? '').trim(),
          label: typeof column.label === 'string' ? column.label : undefined,
        }))
        .filter((column) => column.key)
    : undefined;
  return {
    generated_sql: typeof dataQa.generated_sql === 'string' ? dataQa.generated_sql : undefined,
    columns,
    rows,
    row_count: typeof dataQa.row_count === 'number' ? dataQa.row_count : undefined,
    truncated: Boolean(dataQa.truncated),
    chart: isRecord(dataQa.chart) ? normalizeDataQaChart(dataQa.chart) : null,
    execution_steps: Array.isArray(dataQa.execution_steps)
      ? dataQa.execution_steps.filter((step): step is Record<string, unknown> => isRecord(step))
      : [],
    warnings: Array.isArray(dataQa.warnings)
      ? dataQa.warnings.map((warning) => String(warning)).filter((warning) => warning.trim())
      : [],
  };
}

function normalizeDataQaChart(chart: Record<string, unknown>): DataQaChart {
  const data = Array.isArray(chart.data)
    ? chart.data
        .filter(isRecord)
        .map((point) => ({ x: point.x, y: Number(point.y) }))
        .filter((point) => Number.isFinite(point.y))
    : [];
  return {
    type: typeof chart.type === 'string' ? chart.type : undefined,
    x: typeof chart.x === 'string' ? chart.x : undefined,
    y: typeof chart.y === 'string' ? chart.y : undefined,
    data,
  };
}

function normalizeDataQaColumns(dataQa: DataQaResult): DataQaColumn[] {
  if (Array.isArray(dataQa.columns) && dataQa.columns.length > 0) {
    return dataQa.columns.filter((column) => column.key);
  }
  const firstRow = Array.isArray(dataQa.rows) ? dataQa.rows.find(isRecord) : null;
  if (!firstRow) {
    return [];
  }
  return Object.keys(firstRow).map((key) => ({ key, label: key }));
}

function formatExecutionStep(step: Record<string, unknown>) {
  const label = typeof step.step === 'string' ? formatEventType(step.step) : '步骤';
  const details = Object.entries(step)
    .filter(([key]) => key !== 'step')
    .map(([key, value]) => `${key}: ${formatCellValue(value)}`)
    .join(' · ');
  return details ? `${label} · ${details}` : label;
}

function formatChartType(type: string | undefined) {
  const labels: Record<string, string> = {
    bar: '柱状图',
    column: '柱状图',
    line: '趋势图',
    pie: '占比图',
    table: '明细表',
  };
  return labels[type ?? ''] ?? '图表';
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (typeof value === 'string') {
    return value.trim() || '-';
  }
  return JSON.stringify(value);
}

function extractEventAnswer(events: AgentRunEvent[]) {
  const answerEvents = [...events]
    .reverse()
    .filter((event) => ['assistant_message', 'runner', 'assistant', 'message', 'result', 'text'].includes(event.event_type));

  for (const event of answerEvents) {
    const eventText = event.message?.trim();
    if (eventText && !looksLikeRuntimeError(eventText)) {
      return eventText;
    }

    const payloadText = pickTextValue(event.payload, ['answer', 'message', 'text', 'content', 'summary', 'output']);
    if (payloadText && !looksLikeRuntimeError(payloadText)) {
      return payloadText;
    }

    const result = event.payload.result;
    if (isRecord(result)) {
      const resultText = extractResultText(result);
      if (resultText && !looksLikeRuntimeError(resultText)) {
        return resultText;
      }
    }

    const structuredOutput = extractStructuredOutput(event.payload);
    if (structuredOutput && !looksLikeRuntimeError(structuredOutput)) {
      return structuredOutput;
    }
  }

  return null;
}

function extractStructuredOutput(payload: Record<string, unknown>) {
  const toolResults = payload.tool_results;
  if (!Array.isArray(toolResults)) {
    return null;
  }

  for (const toolResult of [...toolResults].reverse()) {
    if (!isRecord(toolResult) || typeof toolResult.output !== 'string') {
      continue;
    }
    try {
      const parsedOutput = JSON.parse(toolResult.output) as unknown;
      if (!isRecord(parsedOutput) || !isRecord(parsedOutput.structured_output)) {
        continue;
      }
      const structuredText = pickTextValue(parsedOutput.structured_output, ['answer', 'output', 'text', 'message', 'content']);
      if (structuredText) {
        return structuredText;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function pickTextValue(result: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return Boolean(value.trim());
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasMeaningfulValue);
  }
  if (isRecord(value)) {
    return Object.values(value).some(hasMeaningfulValue);
  }
  return false;
}

function buildDefaultContext(currentProjectId: string | null): AssistantContext {
  if (currentProjectId) {
    return { scope: 'project', ref: { project_id: currentProjectId } };
  }
  return { scope: 'none', ref: {} };
}

function buildSendContext(context: AssistantContext, currentProjectId: string | null): AssistantContext {
  if (!currentProjectId) {
    return context;
  }
  if (context.scope === 'project' && context.ref.project_id === currentProjectId) {
    return context;
  }
  return { scope: 'project', ref: { project_id: currentProjectId } };
}

function formatContextLabel(context: AssistantContext, currentProjectId: string | null) {
  if (context.scope === 'project') {
    const projectId = typeof context.ref.project_id === 'string' ? context.ref.project_id : currentProjectId;
    return projectId ? `项目上下文: ${projectId}` : '项目上下文';
  }
  if (context.scope === 'current_page') {
    return '当前页面上下文';
  }
  if (context.scope === 'database') {
    return '数据库上下文';
  }
  if (context.scope === 'workspace') {
    return '代码库上下文';
  }
  return '无固定上下文';
}

function formatBackendLabel(backend: AgentBackend | null, error: string | null, backends: AgentBackend[]) {
  if (error) {
    return '运行后端状态未知';
  }
  if (!backend) {
    return '自动路由';
  }
  const modelLabel =
    backend.execution_model === 'one_shot_cli'
      ? '单次运行'
      : backend.execution_model === 'controlled_runner'
        ? '受控执行'
        : '持久会话';
  const availableCount = backends.filter((item) => item.status === 'available').length;
  return `自动路由 · ${backend.label} · ${modelLabel}${availableCount > 1 ? ` +${availableCount - 1}` : ''}`;
}

function buildSessionTitle(prompt: string) {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'AI Harness';
  }
  return compact.length > 36 ? `${compact.slice(0, 36)}...` : compact;
}

function readLegacyProjectMessages(projectId: string | null): ChatMessage[] {
  if (!projectId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(`smart-design-agent-chat:${projectId}`);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isLegacyChatMessage)
      .filter((message) => message.role === 'user' || !looksLikeRuntimeError(message.content))
      .slice(-10)
      .map((message) => ({
        id: createId(`legacy-${message.role}`),
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      }));
  } catch {
    return [];
  }
}

function isLegacyChatMessage(value: unknown): value is { role: ChatRole; content: string; createdAt: string } {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function readActiveSessionId() {
  return window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
}

function writeActiveSessionId(sessionId: string) {
  window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
}

function clearActiveSessionId() {
  window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
}

function readDraft(sessionId: string) {
  return readDrafts()[sessionId] ?? '';
}

function writeDraft(sessionId: string, value: string) {
  const drafts = readDrafts();
  if (value.trim()) {
    drafts[sessionId] = value;
  } else {
    delete drafts[sessionId];
  }
  window.localStorage.setItem(SESSION_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

function readDrafts(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SESSION_DRAFTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function isTerminalStatus(status: AgentJobStatus | undefined) {
  return status ? TERMINAL_STATUSES.includes(status) : false;
}

function isProgressEvent(eventType: string) {
  return [
    'started',
    'context',
    'runtime_config',
    'tool',
    'tool_call',
    'tool_result',
    'assistant_message',
    'scope_resolved',
    'catalog_selected',
    'query_planned',
    'sql_compiled',
    'sql_executed',
    'answer_generated',
    'text',
    'runner',
    'message',
    'assistant',
    'result',
    'usage',
    'runner_error',
  ].includes(eventType);
}

function looksLikeRuntimeError(text: string) {
  const normalized = text.toLowerCase();
  return SYSTEM_ERROR_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDateTime(value: string | object) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}
