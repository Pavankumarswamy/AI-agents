/**
 * TerminalView.js – Interactive embedded terminal with full stdin support.
 * Uses WebSocket for real-time bidirectional communication.
 * Supports interactive programs like `flutter run` that prompt for user input.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../App';

// Always target the backend directly — React dev server doesn't proxy WebSockets

export default function TerminalView() {
  const {
    runState,
    terminalLines,
    terminalWsRef,
    isTerminalRunning,
    setIsTerminalRunning,
    terminalCwd
  } = useApp();

  const runId = runState?.runId;

  const [inputValue, setInputValue] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [, setHistoryPos] = useState(-1);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalLines]);

  const sendMessage = useCallback((payload) => {
    if (terminalWsRef.current && terminalWsRef.current.readyState === WebSocket.OPEN) {
      terminalWsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, [terminalWsRef]);

  const runCommand = useCallback(() => {
    const cmd = inputValue.trim();
    if (!cmd) return;

    // If process is running, send as stdin
    if (isTerminalRunning) {
      sendMessage({ type: 'stdin', data: cmd });
      setInputValue('');
      setHistoryPos(-1);
      return;
    }

    // Otherwise, start a new command
    if (!terminalWsRef.current || terminalWsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setCmdHistory(prev => [cmd, ...prev.slice(0, 49)]);
    setHistoryPos(-1);
    setIsTerminalRunning(true);
    setInputValue('');
    sendMessage({ type: 'command', command: cmd, cwd: terminalCwd || null });
  }, [inputValue, isTerminalRunning, terminalCwd, sendMessage, terminalWsRef, setIsTerminalRunning]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      runCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistoryPos(prev => {
        const next = Math.min(prev + 1, cmdHistory.length - 1);
        if (!isTerminalRunning) setInputValue(cmdHistory[next] || '');
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistoryPos(prev => {
        const next = Math.max(prev - 1, -1);
        if (!isTerminalRunning) setInputValue(next === -1 ? '' : (cmdHistory[next] || ''));
        return next;
      });
    } else if (e.key === 'c' && e.ctrlKey) {
      // Ctrl+C - kill process
      sendMessage({ type: 'stdin', data: '\x03' });
      setIsTerminalRunning(false);
    }
  }, [runCommand, cmdHistory, isTerminalRunning, sendMessage, setIsTerminalRunning]);

  const cwdLabel = terminalCwd ? terminalCwd.split(/[/\\]/).filter(Boolean).pop() || terminalCwd : (runId ? '~' : 'no workspace');
  const hasWorkspace = !!runId;
  const isConnected = terminalWsRef.current?.readyState === WebSocket.OPEN;

  return (
    <div className="terminal-card" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-header">
        <div className="terminal-title-group">
          <span>💻</span>
          <span className="terminal-title">Terminal</span>
          {terminalCwd && <span className="terminal-cwd-badge">{cwdLabel}</span>}
          <span className={`terminal-ws-dot ${isConnected ? 'connected' : ''}`} title={isConnected ? 'Connected' : 'Disconnected'} />
        </div>
        <div className="terminal-controls">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
      </div>
      <div className="glow-divider" />
      <div className="terminal-body" ref={scrollRef}>
        <pre className="terminal-content">
          {terminalLines.map((l) => (
            typeof l === 'string'
              ? <span key={l.id || Math.random()}>{l}</span>
              : <span key={l.id} className={`t-${l.type}`}>{l.text}</span>
          ))}
        </pre>
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt">
          <span className="prompt-path">{cwdLabel}</span>
          <span className="prompt-arrow">{isTerminalRunning ? '⟩' : '>'}</span>
        </span>
        <input
          ref={inputRef}
          className="terminal-input"
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !hasWorkspace ? 'Open a workspace first...'
              : isTerminalRunning ? 'Type input and press Enter (Ctrl+C to kill)...'
                : 'Type a command and press Enter...'
          }
          disabled={!hasWorkspace}
          autoComplete="off"
          spellCheck={false}
        />
        {isTerminalRunning && <span className="terminal-spinner" title="Running..." />}
        <button
          className="terminal-run-btn"
          onClick={runCommand}
          disabled={!hasWorkspace || !inputValue.trim()}
          title={isTerminalRunning ? 'Send input' : 'Run command'}
        >
          {isTerminalRunning ? '↵' : '▶'}
        </button>
      </div>
      <style>{TERMINAL_STYLES}</style>
    </div>
  );
}

const TERMINAL_STYLES = `
  .terminal-card {
    background: #080b14 !important;
    border: 1px solid #1e2940;
    padding: 0 !important;
    display: flex;
    flex-direction: column;
    /* Let it grow to fill the column, but never shrink below its content */
    flex: 1 1 auto;
    min-height: 200px;
    max-height: 500px;
    margin-bottom: 16px;
    border-radius: 10px;
    overflow: hidden;
    cursor: text;
  }
  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    background: #111827;
    border-bottom: 1px solid #1e2940;
    flex-shrink: 0;
    gap: 8px;
  }
  .terminal-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .terminal-title {
    font-size: 0.78rem;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  .terminal-cwd-badge {
    background: rgba(79, 142, 247, 0.12);
    border: 1px solid rgba(79, 142, 247, 0.3);
    color: #4f8ef7;
    font-size: 0.68rem;
    font-family: 'Fira Code', monospace;
    padding: 1px 8px;
    border-radius: 20px;
    font-weight: 600;
  }
  .terminal-ws-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #374151;
    flex-shrink: 0;
    transition: background 0.3s;
  }
  .terminal-ws-dot.connected { background: #10b981; box-shadow: 0 0 6px #10b981; }
  .terminal-controls { display: flex; gap: 6px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot-red { background: #ef4444; }
  .dot-yellow { background: #f59e0b; }
  .dot-green { background: #10b981; }
  .terminal-body {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 14px 130px;
    font-family: 'Fira Code', 'Courier New', monospace;
    font-size: 0.79rem;
    line-height: 1.55;
  }
  .terminal-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: #d1e8ff;
  }
  .t-error { color: #f87171; }
  .t-system { color: #6b7280; font-style: italic; }
  .terminal-body::-webkit-scrollbar { width: 5px; }
  .terminal-body::-webkit-scrollbar-thumb { background: #263348; border-radius: 3px; }
  /* Input Row */
  .terminal-input-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #1e2940;
    background: #0b0f1c;
    flex-shrink: 0;
  }
  .terminal-prompt {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: 'Fira Code', monospace;
    font-size: 0.78rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .prompt-path { color: #10b981; font-weight: 700; }
  .prompt-arrow { color: #4f8ef7; font-weight: 700; }
  .terminal-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-family: 'Fira Code', 'Courier New', monospace;
    font-size: 0.79rem;
    caret-color: #4f8ef7;
    min-width: 0;
  }
  .terminal-input::placeholder { color: #344b6a; }
  .terminal-input:disabled { opacity: 0.4; cursor: not-allowed; }
  .terminal-run-btn {
    background: rgba(79, 142, 247, 0.15);
    border: 1px solid rgba(79, 142, 247, 0.3);
    color: #4f8ef7;
    border-radius: 5px;
    width: 28px;
    height: 28px;
    font-size: 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: 0.15s;
  }
  .terminal-run-btn:hover:not(:disabled) { background: #4f8ef7; color: #fff; }
  .terminal-run-btn:disabled { opacity: 0.25; cursor: not-allowed; }
  .terminal-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(79,142,247,0.2);
    border-top-color: #f59e0b;
    border-radius: 50%;
    animation: t-spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes t-spin { to { transform: rotate(360deg); } }
`;
