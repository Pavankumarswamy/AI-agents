/**
 * ChatSidebar.js – Interactive sidebar to chat with agents
 */
import React, { useState, useRef, useEffect, memo } from 'react';
import axios from 'axios';
import { useApp } from '../App';

const ChatSidebar = memo(({ currentFile, onFileSelect }) => {
    const { API_BASE, runState, setRunState, configStatus, snippets, setSnippets } = useApp();
    const [input, setInput] = useState('');
    const [mentionQuery, setMentionQuery] = useState(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionMap, setMentionMap] = useState({}); // Stores @label -> fullPath mapping
    const [showSettings, setShowSettings] = useState(false);
    const [localApiData, setLocalApiData] = useState(() => JSON.parse(localStorage.getItem('GGU AI_custom_api') || '{}'));
    const apiData = localApiData;

    const [messages, setMessages] = useState([]);
    const [sessionId, setSessionId] = useState('default');
    const [availableSessions, setAvailableSessions] = useState(['default']);
    const [loading, setLoading] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isReiteration, setIsReiteration] = useState(false);
    const scrollRef = useRef(null);
    const sessionTabsListRef = useRef(null);

    const [chatMode, setChatMode] = useState('fast');
    const [theme, setTheme] = useState('default');

    useEffect(() => {
        document.body.className = '';
        if (theme !== 'default') {
            document.body.classList.add(`theme-${theme}`);
        }
    }, [theme]);

    const activeModel = apiData.model || configStatus.nvidia_model || 'Loading...';

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        const fetchHistory = async () => {
            const welcomeMsg = { role: 'agent', content: 'Hello! I am **GGU AI**. I can help you fix bugs, explain code, or run scans. How can I help today? ⚡', isTyped: true };

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



    const handleInputChange = (e) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart;
        setInput(value);

        // Detect @ mention
        const textBeforeCursor = value.substring(0, cursorPos);
        const lastAtIndices = [...textBeforeCursor.matchAll(/@/g)];
        if (lastAtIndices.length > 0) {
            const lastAtIndex = lastAtIndices[lastAtIndices.length - 1].index;
            const query = textBeforeCursor.substring(lastAtIndex + 1);
            // Only trigger if no space between @ and cursor
            if (!query.includes(' ')) {
                setMentionQuery(query);
                setMentionIndex(0);
                return;
            }
        }
        setMentionQuery(null);
    };

    const suggestions = mentionQuery !== null
        ? (runState.live?.files || [])
            .map(f => f.path)
            .filter(p => p.toLowerCase().includes(mentionQuery.toLowerCase()))
            .slice(0, 8)
        : [];

    const applyMention = (filePath) => {
        const cursorPos = document.getElementById('chat-input-area').selectionStart;
        const textBeforeCursor = input.substring(0, cursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        const textAfterCursor = input.substring(cursorPos);

        const fileName = filePath.split('/').pop();
        const label = `@${fileName}`;

        // Update mention map
        setMentionMap(prev => ({ ...prev, [label]: filePath }));

        const newValue = input.substring(0, lastAtIndex) + label + ' ' + textAfterCursor;
        setInput(newValue);
        setMentionQuery(null);
        // Focus back
        setTimeout(() => document.getElementById('chat-input-area').focus(), 10);
    };

    const sendMessage = async () => {
        if (!input.trim() || loading) return;

        // Process input to replace labels with technical brackets for backend
        let technicalMsg = input;
        Object.entries(mentionMap).forEach(([label, path]) => {
            // Use regex to replace all occurrences of the label (boundary check)
            const regex = new RegExp(`${label}\\b`, 'g');
            technicalMsg = technicalMsg.replace(regex, `[${path}]`);
        });

        const userMsg = input; // Displayed to user
        const finalBackendMsg = technicalMsg; // Sent to backend

        setInput('');
        setMentionMap({});
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);
        setIsVerifying(false);
        setIsReiteration(false);

        try {
            const repoFiles = runState.live?.files || [];
            const activeFile = repoFiles.find(f => f.path === currentFile?.path);

            // Combine snippets into the message if any exist
            let payloadMessage = finalBackendMsg;
            if (snippets.length > 0) {
                payloadMessage += "\n\n### ATTACHED CODE SNIPPETS\n";
                snippets.forEach(s => {
                    payloadMessage += `File: ${s.path}\n\`\`\`\n${s.content}\n\`\`\`\n`;
                });
            }

            // Show verifying indicator after a short delay (if actions might be taken)
            const verifyTimer = setTimeout(() => setIsVerifying(true), 800);

            const { data } = await axios.post(`${API_BASE}/chat`, {
                message: payloadMessage,
                run_id: runState.runId,
                file_path: currentFile?.path,
                file_content: activeFile?.content || '',
                api_data: Object.keys(apiData).length > 0 ? apiData : null,
                repo_context: repoFiles.map(f => ({ path: f.path, content: f.content })),
                session_id: sessionId,
                chat_mode: chatMode
            });

            clearTimeout(verifyTimer);
            setIsVerifying(false);

            // Clear snippets after sending
            setSnippets([]);

            const newMsgs = [];

            // Add main agent response
            if (data.response) {
                newMsgs.push({ role: 'agent', content: data.response, isTyped: false });
            }

            // Add verification log bubble if there were any actions
            if (data.verification_log && data.verification_log.length > 0) {
                const hasAnyAction = data.verification_log.some(v => v.actions_taken);
                if (hasAnyAction) {
                    newMsgs.push({
                        role: 'verification',
                        content: data.verification_log,
                        isReiteration: data.is_reiteration,
                        isTyped: true
                    });
                }
            }

            if (data.is_reiteration) setIsReiteration(true);

            setMessages(prev => [...prev, ...newMsgs]);

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
            setIsVerifying(false);
            setMessages(prev => [...prev, { role: 'agent', content: '⚠️ Failed to connect to agent.' }]);
        } finally {
            setLoading(false);
        }
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
                            <span className="agent-name">GGU AI</span>
                        </div>
                    </div>

                    <div className="header-actions">
                        <div className={`active-model-badge ${Object.keys(apiData).length > 0 ? 'badge-custom' : ''}`} title={activeModel}>
                            <span className="dot"></span>
                            <span className="model-name">{activeModel.split('/').pop()}</span>
                        </div>
                        <button
                            className={`settings-toggle ${showSettings ? 'active' : ''}`}
                            onClick={() => setShowSettings(v => !v)}
                            title="Custom LLM Settings"
                        >
                            <span className="gear-icon">⚙</span>
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

            {/* ── Custom LLM Config Panel ── */}
            {showSettings && (
                <div className="chat-config-panel" style={{ marginTop: '30px' }}>
                    <div className="config-inner">
                        <div className="config-header">
                            <h5>⚙️ Custom LLM Setup</h5>
                            <button className="settings-toggle" onClick={() => setShowSettings(false)} style={{ fontSize: '0.8rem' }}>✕</button>
                        </div>
                        <div className="config-fields">
                            <div className="field-group">
                                <label>Base URL</label>
                                <input
                                    type="text"
                                    placeholder="https://api.openai.com/v1  (or Ollama: http://localhost:11434/v1)"
                                    value={localApiData.base_url || ''}
                                    onChange={e => setLocalApiData(p => ({ ...p, base_url: e.target.value }))}
                                />
                            </div>
                            <div className="field-group">
                                <label>API Key</label>
                                <input
                                    type="password"
                                    placeholder="sk-... (leave blank for Ollama)"
                                    value={localApiData.api_key || ''}
                                    onChange={e => setLocalApiData(p => ({ ...p, api_key: e.target.value }))}
                                />
                            </div>
                            <div className="field-group">
                                <label>Model Name</label>
                                <input
                                    type="text"
                                    placeholder="gpt-4o / llama3 / mistral / etc."
                                    value={localApiData.model || ''}
                                    onChange={e => setLocalApiData(p => ({ ...p, model: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="provider-grid">
                            <button className="provider-btn" onClick={() => {
                                const d = { base_url: 'https://api.openai.com/v1', model: 'gpt-4o' };
                                setLocalApiData(p => ({ ...p, ...d }));
                            }}>🤖 OpenAI</button>
                            <button className="provider-btn" onClick={() => {
                                const d = { base_url: 'http://localhost:11434/v1', api_key: 'ollama', model: 'llama3' };
                                setLocalApiData(p => ({ ...p, ...d }));
                            }}>🦙 Ollama</button>
                            <button className="provider-btn" onClick={() => {
                                const d = { base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' };
                                setLocalApiData(p => ({ ...p, ...d }));
                            }}>🌿 Claude</button>
                            <button className="provider-btn" onClick={() => {
                                const d = { base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' };
                                setLocalApiData(p => ({ ...p, ...d }));
                            }}>⚡ Groq</button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <button className="provider-btn" style={{ flex: 1, background: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' }} onClick={() => {
                                localStorage.setItem('GGU AI_custom_api', JSON.stringify(localApiData));
                                setShowSettings(false);
                            }}>💾 Save & Use</button>
                            <button className="provider-btn" style={{ flex: 0.5, color: '#ff5252' }} onClick={() => {
                                localStorage.removeItem('GGU AI_custom_api');
                                setLocalApiData({});
                                setShowSettings(false);
                            }}>🗑 Clear</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="chat-messages scrollable" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div key={i} className={`chat-msg msg-${m.role}`}>
                        {m.role === 'verification' ? (
                            <VerificationBubble log={m.content} isReiteration={m.isReiteration} />
                        ) : (
                            <div className="msg-bubble">
                                {m.role === 'agent' && !m.isTyped ? (
                                    <TypeWriter
                                        text={m.content}
                                        onScroll={() => {
                                            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                                        }}
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
                        )}
                    </div>
                ))}
                {loading && (
                    <div className="chat-msg msg-agent">
                        <div className="msg-bubble thinking-bubble">
                            {isVerifying ? (
                                <span className="verify-status">
                                    {isReiteration ? '🔁 Re-iterating to fix...' : '🔍 Verifying work...'}
                                </span>
                            ) : (
                                <>
                                    <span className="dot-loader"></span>
                                    <span className="dot-loader"></span>
                                    <span className="dot-loader"></span>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {/* ── Chat Input ── */}
            <div className="chat-footer">
                <div className="chat-options-bar" style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <div className="mode-selector" style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <button
                            className={`mode-btn ${chatMode === 'plan' ? 'active' : ''}`}
                            onClick={() => setChatMode('plan')}
                            style={{ padding: '4px 8px', fontSize: '0.7rem', background: chatMode === 'plan' ? 'var(--accent-blue)' : 'transparent', color: chatMode === 'plan' ? '#fff' : 'var(--text-secondary)' }}
                        >📖 Plan Mode</button>
                        <button
                            className={`mode-btn ${chatMode === 'fast' ? 'active' : ''}`}
                            onClick={() => setChatMode('fast')}
                            style={{ padding: '4px 8px', fontSize: '0.7rem', background: chatMode === 'fast' ? 'var(--accent-green)' : 'transparent', color: chatMode === 'fast' ? '#fff' : 'var(--text-secondary)' }}
                        >⚡ Fast Mode</button>
                    </div>

                    <select
                        value={theme}
                        onChange={e => setTheme(e.target.value)}
                        style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem', padding: '0 8px', outline: 'none' }}
                    >
                        <option value="default">Default Theme</option>
                        <option value="black">Black</option>
                        <option value="white">White</option>
                        <option value="chackers-green">Chackers Green</option>
                    </select>
                </div>
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
                    {mentionQuery !== null && suggestions.length > 0 && (
                        <div className="mention-suggestions">
                            {suggestions.map((s, idx) => (
                                <div
                                    key={s}
                                    className={`mention-item ${idx === mentionIndex ? 'active' : ''}`}
                                    onClick={() => applyMention(s)}
                                >
                                    <span className="file-icon">📄</span>
                                    <span className="file-path">{s}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <textarea
                        id="chat-input-area"
                        rows="1"
                        placeholder="Ask GGU AI anything (type @ to reference files)..."
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={(e) => {
                            if (mentionQuery !== null && suggestions.length > 0) {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setMentionIndex(prev => (prev + 1) % suggestions.length);
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setMentionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
                                } else if (e.key === 'Enter' || e.key === 'Tab') {
                                    e.preventDefault();
                                    applyMention(suggestions[mentionIndex]);
                                } else if (e.key === 'Escape') {
                                    setMentionQuery(null);
                                }
                            } else if (e.key === 'Enter' && !e.shiftKey) {
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

function VerificationBubble({ log, isReiteration }) {
    if (!log || log.length === 0) return null;
    const hasFailures = log.some(v => !v.tool_success && v.actions_taken);
    return (
        <div className={`verify-bubble ${hasFailures ? 'verify-failure' : 'verify-success'}`}>
            <div className="verify-header">
                <span className="verify-icon">{hasFailures ? '⚠️' : '✅'}</span>
                <span className="verify-title">
                    {hasFailures ? 'Verification: Issues Detected' : 'Verification: All Actions Passed'}
                </span>
                {isReiteration && <span className="reiteration-badge">🔁 Auto-Fixed</span>}
            </div>
            {log.map((entry, i) => (
                entry.actions_taken && (
                    <div key={i} className="verify-entry">
                        <div className="verify-iter-label">Iteration {entry.iteration}</div>
                        {entry.feedback.map((fb, fi) => {
                            const isSuccess = fb.startsWith('Successfully');
                            const isFail = fb.includes('FAILED') || fb.includes('failed') || fb.includes('Error') || fb.startsWith('Failed') || fb.startsWith('Command failed');
                            return (
                                <div key={fi} className={`verify-line ${isSuccess ? 'vl-ok' : isFail ? 'vl-fail' : 'vl-info'}`}>
                                    <span className="vl-icon">{isSuccess ? '✅' : isFail ? '❌' : '📋'}</span>
                                    <span className="vl-text">{fb}</span>
                                </div>
                            );
                        })}
                    </div>
                )
            ))}
        </div>
    );
}

function TypeWriter({ text, onComplete, onScroll, render }) {
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
                if (onScroll) onScroll();
            }, 5);
            return () => clearTimeout(timeout);
        } else {
            onComplete();
        }
    }, [index, text, onComplete, onScroll]);

    return render(displayed);
}

function InteractiveMarkdown({ content, onFileSelect }) {
    if (!content) return null;
    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
        <div className="md-container">
            {parts.map((part, i) => {
                if (part.startsWith('```')) {
                    const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
                    const lang = match ? match[1] : '';
                    const code = match ? (match[2] || '') : part.slice(3, -3);
                    return (
                        <div key={i} className="md-code-block">
                            <div className="code-header"><span>{lang || 'code'}</span></div>
                            <pre><code>{code}</code></pre>
                        </div>
                    );
                }
                const lines = part.split('\n');
                const elements = [];
                let currentListLines = [];
                let currentTableLines = [];

                const flushTable = () => {
                    if (currentTableLines.length > 0) {
                        elements.push(<MarkdownTable key={`table-${elements.length}`} rows={currentTableLines} onFileSelect={onFileSelect} />);
                        currentTableLines = [];
                    }
                };

                const flushList = () => {
                    if (currentListLines.length > 0) {
                        elements.push(
                            <ul key={`list-${elements.length}`} className="md-ul">
                                {currentListLines.map((line, idx) => (
                                    <li key={idx} className="md-li">
                                        {processSegments(line.trim().replace(/^- /, ''), onFileSelect)}
                                    </li>
                                ))}
                            </ul>
                        );
                        currentListLines = [];
                    }
                };

                lines.forEach((line, li) => {
                    const trimmedLine = line.trim();
                    const isTableRow = trimmedLine.startsWith('|') && line.includes('|');
                    const isListItem = trimmedLine.startsWith('- ');

                    if (isTableRow) {
                        flushList();
                        currentTableLines.push(line);
                    } else if (isListItem) {
                        flushTable();
                        currentListLines.push(line);
                    } else {
                        flushTable();
                        flushList();
                        if (trimmedLine) {
                            elements.push(renderMarkdownLine(line, li, onFileSelect));
                        }
                    }
                });
                flushTable();
                flushList();

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
        const fullPath = m[1];
        const isFile = fullPath.includes('.') || fullPath.includes('/');

        // Suppress specific system files like checker.py
        if (fullPath.includes('checker.py')) {
            lastIdx = citationRegex.lastIdx;
            continue;
        }

        // Extract filename for display (hide the path)
        const fileName = fullPath.includes('/') ? fullPath.split('/').pop() : fullPath;

        segments.push(
            <span key={`c-${segments.length}`}
                className={`md-citation ${isFile ? 'md-citation-clickable' : ''}`}
                onClick={() => isFile && onFileSelect && onFileSelect(fullPath)}
                title={fullPath}
            >
                {fileName}
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

    if (line.trim().startsWith('- ')) {
        const cleanListLine = processed.replace(/^- /, '');
        return <li key={li} className="md-li">{processSegments(cleanListLine, onFileSelect)}</li>;
    }
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
  .chat-sidebar { width: 100%; background: var(--bg-secondary); border-left: 1px solid var(--border); display: flex; flex-direction: column; height: 100%; position: relative; }

  /* Verification Bubble */
  .msg-verification { align-self: stretch; width: 100%; }
  .verify-bubble { border-radius: 10px; padding: 10px 14px; font-size: 0.78rem; border: 1px solid; margin: 4px 0; width: 100%; box-sizing: border-box; }
  .verify-success { background: rgba(0, 200, 150, 0.07); border-color: rgba(0, 200, 150, 0.4); }
  .verify-failure { background: rgba(255, 80, 80, 0.07); border-color: rgba(255, 80, 80, 0.35); }
  .verify-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 700; }
  .verify-icon { font-size: 0.9rem; }
  .verify-title { color: var(--text-primary); font-size: 0.78rem; flex: 1; }
  .reiteration-badge { background: linear-gradient(135deg, #7c3aed, #a855f7); color: #fff; font-size: 0.62rem; padding: 2px 8px; border-radius: 12px; font-weight: 700; animation: reiterPulse 1.5s infinite; }
  @keyframes reiterPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(168,85,247,0.4); } 50% { box-shadow: 0 0 0 6px rgba(168,85,247,0); } }
  .verify-entry { margin-bottom: 8px; }
  .verify-iter-label { font-size: 0.62rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 700; }
  .verify-line { display: flex; align-items: flex-start; gap: 6px; padding: 3px 0; }
  .vl-icon { flex-shrink: 0; font-size: 0.8rem; }
  .vl-text { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; flex: 1; }
  .vl-ok .vl-text { color: #4ade80; }
  .vl-fail .vl-text { color: #f87171; }
  .vl-info .vl-text { color: var(--text-muted); }

  /* Verify status in thinking bubble */
  .verify-status { font-size: 0.78rem; color: var(--accent-cyan); font-weight: 600; animation: verifyPulse 1.2s ease-in-out infinite; padding: 2px 0; }
  @keyframes verifyPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
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

  .chat-messages { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 16px; overflow-x: hidden; }
  .msg-bubble { 
    padding: 12px 16px; 
    border-radius: 12px; 
    font-size: 0.88rem; 
    line-height: 1.6; 
    background: var(--bg-card); 
    border: 1px solid var(--border); 
    position: relative; 
    max-width: 95%;
    word-break: break-word;
    overflow-wrap: break-word;
    box-sizing: border-box;
  }
  .msg-user { align-self: flex-end; width: 100%; }
  .msg-user .msg-bubble { background: linear-gradient(135deg, #2979ff, #448aff); color: #ffffff; font-weight: 700; border: none; border-bottom-right-radius: 2px; max-width: 100%; padding: 5px 12px; box-shadow: 0 2px 12px rgba(41, 121, 255, 0.5); text-shadow: 0 1px 2px rgba(0,0,0,0.15); }
  .msg-agent { align-self: flex-start; width: fit-content; max-width: 100%; }
  .msg-agent .msg-bubble { border-bottom-left-radius: 2px; width: 100%; }
  
  .msg-system { align-self: stretch; width: 100%; }
  .msg-system .msg-bubble { 
    background: rgba(0,0,0,0.5); 
    border: 1px dashed var(--accent-cyan); 
    color: var(--accent-cyan); 
    font-family: 'JetBrains Mono', monospace; 
    font-size: 0.75rem;
    padding: 8px 12px;
    max-width: 100%;
  }

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
  .md-citation { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
  .md-citation-clickable { cursor: pointer; background: rgba(79, 142, 247, 0.15); border-color: var(--accent-blue); color: #fff; }
  .md-citation-clickable:hover { background: var(--accent-blue); color: white; border-color: var(--accent-blue); }
  .md-code-block { margin: 12px 0; background: #08090f; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-bright); }
  .code-header { background: #161822; padding: 6px 12px; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid var(--border); }
  .md-code-block pre { padding: 14px; overflow-x: auto; font-family: 'JetBrains Mono', mono; font-size: 0.82rem; color: #e5e7eb; line-height: 1.5; }

  /* Tables */
  .md-table-wrapper { width: 100%; margin: 16px 0; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); overflow-x: auto; }
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

  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* Markdown specific styles */
  .md-p { margin: 8px 0; line-height: 1.6; color: var(--text-secondary); }
  .md-ul { margin: 10px 0; padding-left: 20px; list-style-type: disc; }
  .md-li { margin: 6px 0; color: var(--text-secondary); line-height: 1.5; }
  .md-li::marker { color: var(--accent-blue); }

  /* Snippets Preview */
  .snippets-preview { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 4px; }
  .snippet-chip { display: flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--border-bright); padding: 4px 10px; border-radius: 6px; font-size: 0.72rem; animation: slideIn 0.2s ease-out; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
  .chip-label { color: var(--accent-cyan); font-weight: 600; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-remove { background: transparent; color: var(--text-muted); font-size: 1.1rem; cursor: pointer; line-height: 1; }
  .chip-remove:hover { color: var(--accent-red); }

  /* Mentions */
  .mention-suggestions {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background: var(--bg-card);
    border: 1px solid var(--accent-blue);
    border-radius: 8px;
    margin-bottom: 8px;
    box-shadow: 0 -10px 30px rgba(0,0,0,0.5);
    z-index: 100;
    overflow: hidden;
  }
  .mention-item {
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.82rem;
    color: var(--text-secondary);
    transition: var(--transition);
  }
  .mention-item:hover, .mention-item.active {
    background: rgba(79, 142, 247, 0.1);
    color: var(--text-primary);
  }
  .mention-item.active {
    border-left: 3px solid var(--accent-blue);
  }
  .mention-item .file-icon { opacity: 0.6; }
  .mention-item .file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  @keyframes slideIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default ChatSidebar;

