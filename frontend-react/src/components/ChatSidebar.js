/**
 * ChatSidebar.js – Interactive sidebar to chat with agents
 */
import React, { useState, useRef, useEffect, memo } from 'react';
import axios from 'axios';
import { useApp } from '../App';

const ChatSidebar = memo(({ currentFile, onFileSelect }) => {
    const { API_BASE, runState, setRunState, configStatus, snippets, setSnippets } = useApp();
    const [input, setInput] = useState('');
    const [showConfig, setShowConfig] = useState(false);
    const [apiData, setApiData] = useState(() => {
        return JSON.parse(localStorage.getItem('rift_custom_api') || '{}');
    });

    const [messages, setMessages] = useState([]);
    const [sessionId, setSessionId] = useState('default');
    const [availableSessions, setAvailableSessions] = useState(['default']);
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef(null);
    const sessionTabsListRef = useRef(null);

    const activeModel = apiData.model || configStatus.nvidia_model || 'Loading...';

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        const fetchHistory = async () => {
            const welcomeMsg = { role: 'agent', content: 'Hello! I am **PAVAN**. I can help you fix bugs, explain code, or run scans. How can I help today? ⚡', isTyped: true };

            if (!runState.runId) {
                setMessages([welcomeMsg]);
                return;
            }
            try {
                // Fetch Messages
                const { data } = await axios.get(`${API_BASE}/chat/history/${runState.runId}?session_id=${sessionId}`);
                if (data.history && data.history.length > 0) {
                    setMessages(data.history.map(m => ({ ...m, isTyped: true })));
                } else {
                    setMessages([welcomeMsg]);
                }

                // Fetch unique session labels for this run
                const sessData = await axios.get(`${API_BASE}/chat/sessions/${runState.runId}`);
                if (sessData.data.sessions) {
                    setAvailableSessions(sessData.data.sessions);
                }
            } catch (err) {
                console.error('Failed to fetch chat history:', err);
                setMessages([welcomeMsg]);
            }
        };
        fetchHistory();
    }, [runState.runId, sessionId, API_BASE]);

    useEffect(() => {
        localStorage.setItem('rift_custom_api', JSON.stringify(apiData));
    }, [apiData]);

    const sendMessage = async () => {
        if (!input.trim() || loading) return;

        const userMsg = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            const repoFiles = runState.live?.files || [];
            const activeFile = repoFiles.find(f => f.path === currentFile?.path);

            // Combine snippets into the message if any exist
            let finalMessage = userMsg;
            if (snippets.length > 0) {
                finalMessage += "\n\n### ATTACHED CODE SNIPPETS\n";
                snippets.forEach(s => {
                    finalMessage += `File: ${s.path}\n\`\`\`\n${s.content}\n\`\`\`\n`;
                });
            }

            const { data } = await axios.post(`${API_BASE}/chat`, {
                message: finalMessage,
                run_id: runState.runId,
                file_path: currentFile?.path,
                file_content: activeFile?.content || '',
                api_data: Object.keys(apiData).length > 0 ? apiData : null,
                repo_context: repoFiles.map(f => ({ path: f.path, content: f.content })),
                session_id: sessionId
            });

            // Clear snippets after sending
            setSnippets([]);

            // Start typing animation for agent response
            setMessages(prev => [...prev, { role: 'agent', content: data.response, isTyped: false }]);

            // If the agent created a new file, sync the global state to refresh the file tree
            if (data.live) {
                setRunState(prev => ({
                    ...prev,
                    live: {
                        ...prev.live,
                        files: data.live.files
                    }
                }));
            }
        } catch (err) {
            setMessages(prev => [...prev, { role: 'agent', content: '⚠️ Failed to connect to agent.' }]);
        } finally {
            setLoading(false);
        }
    };

    const applyProvider = (p) => {
        const presets = {
            openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o' },
            anthropic: { base_url: 'https://api.anthropic.com/v1', model: 'claude-3-opus-20240229' },
            ollama: { base_url: 'http://localhost:11434/v1', model: 'llama3' },
            nvidia: { base_url: 'https://integrate.api.nvidia.com/v1', model: 'mistralai/mixtral-8x22b-instruct-v0.1' }
        };
        setApiData({ ...apiData, ...presets[p] });
    };

    return (
        <div className="chat-sidebar">
            <div className="chat-header">
                <div className="header-row top-row">
                    <div className="header-main">
                        <div className="agent-identity">
                            <div className="agent-avatar pulse-slow">
                                <span className="avatar-icon">💬</span>
                            </div>
                            <span className="agent-name">PAVAN</span>
                        </div>
                    </div>

                    <div className="header-actions">
                        <div className={`active-model-badge ${Object.keys(apiData).length > 0 ? 'badge-custom' : ''}`} title={activeModel}>
                            <span className="dot"></span>
                            <span className="model-name">{activeModel.split('/').pop()}</span>
                        </div>
                        <button className="settings-btn" onClick={() => setShowConfig(!showConfig)} title="Provider Settings">
                            ⚙️
                        </button>
                    </div>
                </div>

                <div className="header-row bottom-row">
                    <div className="session-tabs-container scrollable-x" ref={sessionTabsListRef}>
                        <div className="session-tabs-list">
                            {availableSessions.map(s => (
                                <div
                                    key={s}
                                    className={`session-tab-item ${s === sessionId ? 'active' : ''}`}
                                    onClick={() => setSessionId(s)}
                                    title={s}
                                >
                                    <span className="tab-icon">💬</span>
                                    <span className="tab-label">{s}</span>
                                </div>
                            ))}
                            <div className="add-session-tab" onClick={() => {
                                const newId = window.prompt("New Chat Topic:", `Topic ${availableSessions.length + 1}`);
                                if (newId) {
                                    setSessionId(newId);
                                    setAvailableSessions(prev => [...new Set([...prev, newId])]);
                                }
                            }} title="Start New Chat Session">
                                ➕
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {showConfig && (
                <div className="chat-config-panel anim-slide-down">
                    <div className="config-inner">
                        <div className="config-header">
                            <h5>LLM Configuration</h5>
                            <button className="btn-text" onClick={() => setApiData({})}>Reset</button>
                        </div>
                        <div className="provider-grid">
                            <button onClick={() => applyProvider('openai')} className="provider-btn">OpenAI</button>
                            <button onClick={() => applyProvider('anthropic')} className="provider-btn">Anthropic</button>
                            <button onClick={() => applyProvider('nvidia')} className="provider-btn">NVIDIA</button>
                            <button onClick={() => applyProvider('ollama')} className="provider-btn">Ollama</button>
                        </div>
                        <div className="config-fields">
                            <div className="field-group">
                                <label>Base URL</label>
                                <input placeholder="https://..." value={apiData.base_url || ''} onChange={e => setApiData({ ...apiData, base_url: e.target.value })} />
                            </div>
                            <div className="field-group">
                                <label>Model Name</label>
                                <input placeholder="gpt-4o..." value={apiData.model || ''} onChange={e => setApiData({ ...apiData, model: e.target.value })} />
                            </div>
                            <div className="field-group">
                                <label>API Key</label>
                                <input type="password" placeholder="sk-..." value={apiData.api_key || ''} onChange={e => setApiData({ ...apiData, api_key: e.target.value })} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="chat-messages scrollable" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div key={i} className={`chat-msg ${m.role === 'user' ? 'msg-user' : 'msg-agent'}`}>
                        <div className="msg-bubble">
                            {m.role === 'agent' && !m.isTyped ? (
                                <TypeWriter
                                    text={m.content}
                                    onComplete={() => {
                                        const newMsgs = [...messages];
                                        newMsgs[i].isTyped = true;
                                        setMessages(newMsgs);
                                    }}
                                    render={(displayed) => <InteractiveMarkdown content={displayed} onFileSelect={onFileSelect} />}
                                />
                            ) : (
                                <InteractiveMarkdown content={m.content} onFileSelect={onFileSelect} />
                            )}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="chat-msg msg-agent">
                        <div className="msg-bubble thinking-bubble">
                            <span className="dot-loader"></span>
                            <span className="dot-loader"></span>
                            <span className="dot-loader"></span>
                        </div>
                    </div>
                )}
            </div>
            {/* ── Chat Input ── */}
            <div className="chat-footer">
                {snippets.length > 0 && (
                    <div className="snippets-preview">
                        {snippets.map(s => (
                            <div key={s.id} className="snippet-chip">
                                <span className="chip-label">{s.path.split('/').pop()}</span>
                                <button className="chip-remove" onClick={() => setSnippets(prev => prev.filter(x => x.id !== s.id))}>×</button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="input-wrap">
                    <textarea
                        rows="1"
                        placeholder="Ask PAVAN anything..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                    />
                    <button className="send-btn" onClick={sendMessage} disabled={!input.trim() || loading}>
                        {loading ? <span className="spinner-small" /> : '▲'}
                    </button>
                </div>
            </div>
            <style>{STYLES}</style>
        </div>
    );
});

function TypeWriter({ text, onComplete, render }) {
    const [displayed, setDisplayed] = useState('');
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (index < text.length) {
            const timeout = setTimeout(() => {
                let nextJump = 1;
                // Performance optimization: jump more characters if it's a long message
                if (text.length > 300) nextJump = 3;

                setDisplayed(prev => prev + text.substring(index, index + nextJump));
                setIndex(prev => prev + nextJump);
            }, 5);
            return () => clearTimeout(timeout);
        } else {
            onComplete();
        }
    }, [index, text, onComplete]);

    return render(displayed);
}

function InteractiveMarkdown({ content, onFileSelect }) {
    if (!content) return null;
    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
        <div className="md-container">
            {parts.map((part, i) => {
                if (part.startsWith('```')) {
                    const match = part.match(/```(\w*)\n([\s\S]*?)```/);
                    const lang = match ? match[1] : '';
                    const code = match ? (match[2] || '') : part.slice(3, -3);
                    return (
                        <div key={i} className="md-code-block">
                            <div className="code-header"><span>{lang || 'code'}</span></div>
                            <pre><code>{code.trim()}</code></pre>
                        </div>
                    );
                }
                const lines = part.split('\n');
                const elements = [];
                let currentTableLines = [];

                const flushTable = () => {
                    if (currentTableLines.length > 0) {
                        elements.push(<MarkdownTable key={`table-${elements.length}`} rows={currentTableLines} onFileSelect={onFileSelect} />);
                        currentTableLines = [];
                    }
                };

                lines.forEach((line, li) => {
                    const isTableRow = line.trim().startsWith('|') && line.includes('|');

                    if (isTableRow) {
                        currentTableLines.push(line);
                    } else {
                        flushTable();
                        elements.push(renderMarkdownLine(line, li, onFileSelect));
                    }
                });
                flushTable();

                return <div key={i}>{elements}</div>;
            })}
        </div>
    );
}

function processSegments(text, onFileSelect) {
    let processed = text;
    // Handle the specific duplication case: "Text [Text]" -> "[Text]"
    // If a word is followed by itself in brackets, we keep only the bracketed one (which is clickable)
    processed = processed.replace(/(\b\w+[.\w+]*\b)\s*\[\1\]/g, '[$1]');

    processed = processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const citationRegex = /\[((?:\d+|[a-zA-Z0-9_/.-]+))\]/g;
    const segments = [];
    let lastIdx = 0;
    let m;
    while ((m = citationRegex.exec(processed)) !== null) {
        segments.push(<span key={`t-${segments.length}`} dangerouslySetInnerHTML={{ __html: processed.substring(lastIdx, m.index) }} />);
        const citeText = m[1];
        const isFile = citeText.includes('.') || citeText.includes('/');
        segments.push(
            <span key={`c-${segments.length}`} className={`md-citation ${isFile ? 'md-citation-clickable' : ''}`} onClick={() => isFile && onFileSelect && onFileSelect(citeText)}>
                {citeText}
            </span>
        );
        lastIdx = citationRegex.lastIdx;
    }
    segments.push(<span key={`t-${segments.length}`} dangerouslySetInnerHTML={{ __html: processed.substring(lastIdx) }} />);
    return segments;
}

function renderMarkdownLine(line, li, onFileSelect) {
    let processed = line;

    // Parse Header Depth
    let headerLevel = 0;
    if (processed.startsWith('##### ')) headerLevel = 5;
    else if (processed.startsWith('#### ')) headerLevel = 4;
    else if (processed.startsWith('### ')) headerLevel = 3;
    else if (processed.startsWith('## ')) headerLevel = 2;
    else if (processed.startsWith('# ')) headerLevel = 1;

    const headerPrefix = '#'.repeat(headerLevel) + ' ';
    if (headerLevel > 0) processed = processed.replace(headerPrefix, '');

    const segments = processSegments(processed, onFileSelect);

    if (headerLevel > 0) {
        const Tag = `h${headerLevel}`;
        return <Tag key={li} className={`md-h${headerLevel}`}>{segments}</Tag>;
    }

    if (line.trim().startsWith('- ')) return <li key={li} className="md-li">{segments}</li>;
    return <p key={li} className="md-p">{segments}</p>;
}

function MarkdownTable({ rows, onFileSelect }) {
    // Filter out separator rows like | --- | --- |
    const contentRows = rows.filter(r => !r.includes('---'));
    if (contentRows.length === 0) return null;

    const parsed = contentRows.map(row => {
        // The condition for filtering cells should be inside the map for cells, not the filter for rows.
        // This ensures empty cells are preserved if they are between non-empty cells.
        return row.split('|').filter((cell, index, array) => {
            return (cell.trim() !== '') || (index > 0 && index < array.length - 1);
        }).map(cell => cell.trim());
    });

    const headers = parsed[0];
    const data = parsed.slice(1);

    return (
        <div className="md-table-wrapper scrollable">
            <table className="md-table">
                <thead>
                    <tr>{headers.map((h, i) => <th key={i}>{processSegments(h, onFileSelect)}</th>)}</tr>
                </thead>
                <tbody>
                    {data.map((row, ri) => (
                        <tr key={ri}>
                            {row.map((cell, ci) => <td key={ci}>{processSegments(cell, onFileSelect)}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const STYLES = `
  .chat-sidebar { width: 340px; background: var(--bg-secondary); border-left: 1px solid var(--border); display: flex; flex-direction: column; height: 100%; position: relative; }
  .chat-header { border-bottom: 1px solid var(--border); background: var(--bg-card); z-index: 10; display: flex; flex-direction: column; }
  .header-row { padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; }
  .header-row.top-row { border-bottom: 1px solid rgba(255,255,255,0.03); }
  .header-row.bottom-row { padding: 0; background: rgba(0,0,0,0.15); height: 32px; }
  
  .header-main { display: flex; align-items: center; flex-shrink: 0; }
  .header-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
  
  .agent-identity { display: flex; align-items: center; gap: 8px; }
  .agent-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--accent-blue); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .avatar-icon { font-size: 1.1rem; color: #fff; }
  .agent-status { display: flex; flex-direction: column; font-size: 0.75rem; line-height: 1.2; }
  .agent-name { font-weight: 700; color: var(--text-primary); }
  .status-dot { width: 6px; height: 6px; background: var(--accent-green); border-radius: 50%; display: inline-block; margin-right: 4px; }
  .status-label { color: var(--text-muted); display: flex; align-items: center; }

  .settings-btn { background: none; border: none; padding: 4px; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 1.1rem; filter: grayscale(1) brightness(1.5); color: #fff; }
  .settings-btn:hover { background: rgba(255,255,255,0.05); transform: rotate(45deg); }

  .active-model-badge { font-size: 0.62rem; padding: 2px 8px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
  .model-name { overflow: hidden; text-overflow: ellipsis; max-width: 100px; }
  .active-model-badge .dot { width: 6px; height: 6px; background: var(--accent-green); border-radius: 50%; box-shadow: 0 0 8px var(--accent-green); flex-shrink: 0; }
  .badge-custom { border-color: var(--accent-blue); color: var(--accent-blue); }

  .settings-toggle { background: transparent; border: 1px solid var(--border); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; color: var(--text-muted); flex-shrink: 0; }
  .settings-toggle:hover { border-color: var(--text-muted); color: var(--text-primary); }
  .settings-toggle.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; transform: rotate(45deg); }
  .gear-icon { font-size: 0.9rem; }

  .chat-config-panel { position: absolute; top: 52px; left: 0; right: 0; background: rgba(13, 15, 26, 0.95); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); z-index: 5; padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
  .config-inner { display: flex; flex-direction: column; gap: 14px; }
  .config-header { display: flex; justify-content: space-between; align-items: center; }
  .config-header h5 { margin: 0; color: var(--accent-cyan); font-size: 0.85rem; letter-spacing: 0.5px; }
  
  .provider-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .provider-btn { background: var(--bg-card); border: 1px solid var(--border); padding: 6px; border-radius: 4px; font-size: 0.72rem; color: var(--text-secondary); cursor: pointer; transition: 0.2s; }
  .provider-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); background: rgba(79, 142, 247, 0.1); }

  .config-fields { display: flex; flex-direction: column; gap: 10px; }
  .field-group { display: flex; flex-direction: column; gap: 4px; }
  .field-group label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; }
  .field-group input { background: #000; border: 1px solid var(--border); padding: 8px; border-radius: 4px; font-size: 0.78rem; color: var(--text-primary); width: 100%; transition: border 0.3s; }
  .field-group input:focus { border-color: var(--accent-blue); outline: none; }

  .chat-messages { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 16px; }
  .msg-bubble { padding: 12px 16px; border-radius: 12px; font-size: 0.88rem; line-height: 1.6; background: var(--bg-card); border: 1px solid var(--border); position: relative; }
  .msg-user { align-self: flex-end; }
  .msg-user .msg-bubble { background: var(--accent-blue); color: #fff; border: none; border-bottom-right-radius: 2px; }
  .msg-agent { align-self: flex-start; }
  .msg-agent .msg-bubble { border-bottom-left-radius: 2px; }

  .thinking-bubble { display: flex; gap: 4px; padding: 10px 14px; align-items: center; width: fit-content; }
  .dot-loader { width: 6px; height: 6px; background: var(--accent-blue); border-radius: 50%; opacity: 0.4; animation: dotPulse 1.4s infinite ease-in-out; }
  .dot-loader:nth-child(2) { animation-delay: 0.2s; }
  .dot-loader:nth-child(3) { animation-delay: 0.4s; }

  @keyframes dotPulse { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1.1); opacity: 1; } }

  .chat-input { flex: 1; background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: #fff; font-size: 0.85rem; }
  .chat-send { background: var(--accent-blue); color: #fff; border: none; width: 42px; border-radius: 8px; cursor: pointer; font-size: 1.1rem; transition: transform 0.2s; }
  .chat-send:active { transform: scale(0.9); }

  .pulse-slow { animation: pulseSlow 4s infinite; }
  @keyframes pulseSlow { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

  /* Tabbed Sessions */
  .session-tabs-container { width: 100%; overflow-x: auto; scrollbar-width: none; }
  .session-tabs-container::-webkit-scrollbar { display: none; }
  .session-tabs-list { display: flex; align-items: stretch; height: 32px; padding: 0 4px; }
  
  .session-tab-item { padding: 0 12px; display: flex; align-items: center; gap: 6px; font-size: 0.68rem; font-weight: 600; color: var(--text-muted); cursor: pointer; border-right: 1px solid rgba(255,255,255,0.05); transition: 0.2s; white-space: nowrap; border-bottom: 2px solid transparent; }
  .session-tab-item:hover { background: rgba(255,255,255,0.03); color: var(--text-secondary); }
  .session-tab-item.active { background: var(--bg-card); color: var(--accent-purple); border-bottom-color: var(--accent-purple); }
  .tab-icon { font-size: 0.8rem; opacity: 0.6; }
  .tab-label { max-width: 80px; overflow: hidden; text-overflow: ellipsis; }

  .add-session-tab { padding: 0 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.75rem; border-left: 1px solid rgba(255,255,255,0.05); opacity: 0.5; transition: 0.2s; }
  .add-session-tab:hover { opacity: 1; background: rgba(168, 85, 247, 0.1); color: var(--accent-purple); }

  .md-h1, .md-h2, .md-h3 { color: var(--text-primary); margin: 16px 0 8px; font-weight: 800; }
  .md-h1 { font-size: 1.5rem; border-bottom: 2px solid var(--accent-blue); padding-bottom: 4px; }
  .md-h2 { font-size: 1.3rem; }
  .md-h3 { font-size: 1.1rem; }
  .md-h4 { font-size: 1rem; color: var(--accent-cyan); border-left: 3px solid var(--accent-cyan); padding-left: 8px; margin: 12px 0 6px; }
  .md-h5 { font-size: 0.9rem; color: var(--accent-purple); font-weight: 700; margin: 10px 0 4px; display: flex; align-items: center; gap: 6px; }
  .md-h5::before { content: '◈'; font-size: 0.8rem; }
  .md-citation { background: rgba(79, 142, 247, 0.1); border: 1px solid rgba(79, 142, 247, 0.2); color: var(--accent-blue); padding: 0 4px; border-radius: 3px; font-size: 0.72rem; }
  .md-citation-clickable { cursor: pointer; background: rgba(79, 142, 247, 0.2); }
  .md-citation-clickable:hover { background: var(--accent-blue); color: white; }
  .md-code-block { margin: 12px 0; background: #08090f; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-bright); }
  .code-header { background: #161822; padding: 6px 12px; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid var(--border); }
  .md-code-block pre { padding: 14px; overflow-x: auto; font-family: 'JetBrains Mono', mono; font-size: 0.82rem; color: #e5e7eb; line-height: 1.5; }

  /* Tables */
  .md-table-wrapper { width: 100%; margin: 16px 0; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); }
  .md-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .md-table th { background: #161822; color: var(--accent-cyan); text-align: left; padding: 10px 14px; font-weight: 700; border-bottom: 1.5px solid var(--border-bright); }
  .md-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text-secondary); line-height: 1.4; }
  .md-table tr:last-child td { border-bottom: none; }
  .md-table tr:hover td { background: rgba(255,255,255,0.02); color: #fff; }

  /* Footer & Input */
  .chat-footer { padding: 12px; border-top: 1px solid var(--border); background: var(--bg-card); display: flex; flex-direction: column; gap: 8px; }
  .input-wrap { display: flex; align-items: flex-end; gap: 8px; background: #000; border: 1.5px solid var(--border); border-radius: 12px; padding: 8px 12px; transition: var(--transition); }
  .input-wrap:focus-within { border-color: var(--accent-blue); box-shadow: 0 0 10px rgba(79, 142, 247, 0.15); }
  .input-wrap textarea { flex: 1; background: transparent; border: none; outline: none; color: #fff; font-family: inherit; font-size: 0.88rem; resize: none; min-height: 24px; max-height: 160px; line-height: 1.6; padding: 2px 0; }
  .send-btn { background: var(--accent-blue); color: #fff; border: none; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; transition: var(--transition); flex-shrink: 0; }
  .send-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.1); box-shadow: var(--glow-blue); }
  .send-btn:disabled { opacity: 0.3; transform: none; }
  .spinner-small { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }

  /* Snippets Preview */
  .snippets-preview { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 4px; }
  .snippet-chip { display: flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--border-bright); padding: 4px 10px; border-radius: 6px; font-size: 0.72rem; animation: slideIn 0.2s ease-out; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
  .chip-label { color: var(--accent-cyan); font-weight: 600; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-remove { background: transparent; color: var(--text-muted); font-size: 1.1rem; cursor: pointer; line-height: 1; }
  .chip-remove:hover { color: var(--accent-red); }

  @keyframes slideIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default ChatSidebar;
