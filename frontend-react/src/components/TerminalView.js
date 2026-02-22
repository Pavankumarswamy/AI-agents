/**
 * TerminalView.js – Displays raw execution output from the backend.
 */
import React, { useEffect, useRef } from 'react';
import { useApp } from '../App';

export default function TerminalView() {
    const { runState } = useApp();
    const output = runState.live?.terminal_output || '';
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [output]);

    if (!output && runState.status === 'idle') return null;

    return (
        <div className="card terminal-card">
            <div className="terminal-header">
                <h3>💻 Execution Output</h3>
                <div className="terminal-controls">
                    <span className="dot dot-red"></span>
                    <span className="dot dot-yellow"></span>
                    <span className="dot dot-green"></span>
                </div>
            </div>
            <div className="glow-divider" />
            <div className="terminal-body" ref={scrollRef}>
                <pre className="terminal-content">
                    {output || (runState.status === 'running' ? 'Waiting for execution output...' : 'No output available.')}
                </pre>
            </div>
            <style>{TERMINAL_STYLES}</style>
        </div>
    );
}

const TERMINAL_STYLES = `
  .terminal-card {
    background: #0a0c14 !important;
    border: 1px solid #1e293b;
    padding: 0 !important;
    display: flex;
    flex-direction: column;
    min-height: 200px;
    max-height: 400px;
    margin-bottom: 16px;
  }
  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: #111827;
    border-bottom: 1px solid #1e293b;
  }
  .terminal-header h3 {
    margin: 0;
    font-size: 0.85rem;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .terminal-controls {
    display: flex;
    gap: 6px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dot-red { background: #ef4444; }
  .dot-yellow { background: #f59e0b; }
  .dot-green { background: #10b981; }
  .terminal-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    font-family: 'Fira Code', 'Courier New', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
  }
  .terminal-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: #e2e8f0;
  }
  .terminal-body::-webkit-scrollbar {
    width: 6px;
  }
  .terminal-body::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 3px;
  }
`;
