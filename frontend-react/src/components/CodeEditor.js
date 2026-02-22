import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import axios from 'axios';
import { useApp } from '../App';
import ChatSidebar from './ChatSidebar';

export default function CodeEditor() {
    const { runState, setRunState, API_BASE, setSnippets } = useApp();
    const files = useMemo(() => runState.live?.files || [], [runState.live?.files]);
    const fixes = useMemo(() => runState.result?.fixes_table || [], [runState.result?.fixes_table]);
    const fixedPaths = useMemo(() => new Set(fixes.filter(f => f.status === 'fixed').map(f => f.file)), [fixes]);

    const [openPaths, setOpenPaths] = useState([]);
    const [activePath, setActivePath] = useState(null);
    const [diffMode, setDiffMode] = useState(false);
    const [showTerminal, setShowTerminal] = useState(true);
    const [terminalHeight, setTerminalHeight] = useState(300);
    const [saving, setSaving] = useState(false);
    const [localValue, setLocalValue] = useState('');
    const lastSyncedPath = useRef(null);
    const debounceTimer = useRef(null);
    const editorRef = useRef(null);

    // Build a quick lookup: file path → {content, original_content}
    const fileMap = useMemo(() => {
        const m = {};
        if (!Array.isArray(files)) return m;
        files.forEach(f => {
            if (f && f.path) {
                m[f.path] = {
                    content: f.content || '',
                    original: f.original_content || f.content || ''
                };
            }
        });
        return m;
    }, [files]);

    // Get currently selected file data
    const currentFileData = activePath ? fileMap[activePath] : null;

    // Open a file (add to tabs if not present)
    const handleSelect = useCallback((path) => {
        if (!path) return;
        setOpenPaths(prev => prev.includes(path) ? prev : [...prev, path]);
        setActivePath(path);
    }, []);

    const closeTab = (e, path) => {
        e.stopPropagation();
        const newPaths = openPaths.filter(p => p !== path);
        setOpenPaths(newPaths);
        if (activePath === path) {
            setActivePath(newPaths.length > 0 ? newPaths[newPaths.length - 1] : null);
        }
    };

    // Sync localValue ONLY when selecting a NEW file
    useEffect(() => {
        if (activePath !== lastSyncedPath.current) {
            if (activePath && fileMap[activePath]) {
                setLocalValue(fileMap[activePath].content);
            } else {
                setLocalValue('');
            }
            lastSyncedPath.current = activePath;
        }
    }, [activePath, fileMap]);

    const persistSave = async (path, content) => {
        if (!runState.runId || !path) return;
        setSaving(true);
        try {
            await axios.post(`${API_BASE}/save`, {
                run_id: runState.runId,
                file_path: path,
                content: content
            });
            console.log(`[Save] Persistent sync complete for ${path}`);
        } catch (err) {
            console.error('[Save] Persistent sync failed:', err);
        } finally {
            setTimeout(() => setSaving(false), 600);
        }
    };

    const handleEditorChange = (value) => {
        setLocalValue(value);

        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(async () => {
            if (activePath) {
                setRunState(prev => ({
                    ...prev,
                    live: {
                        ...prev.live,
                        files: (prev.live.files || []).map(f =>
                            f.path === activePath ? { ...f, content: value } : f
                        )
                    }
                }));
                persistSave(activePath, value);
            }
        }, 1000);
    };

    const defineGGU AITheme = useCallback((monaco) => {
        if (!monaco) return;
        try {
            monaco.editor.defineTheme('GGU AI-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                    'editor.background': '#0d0f1a',
                    'diffEditor.insertedTextBackground': '#123d1d', // Green bg for additions
                    'diffEditor.removedTextBackground': '#3d1212',  // Red bg for deletions
                    'editor.lineHighlightBackground': '#1e2132',
                    'editor.selectionBackground': '#262b45',
                }
            });
        } catch (e) {
            console.error('Failed to define Monaco theme:', e);
        }
    }, []);

    const handleEditorMount = (editor, monaco) => {
        editorRef.current = editor;

        // Add Ctrl + S (or Cmd + S) shortcut
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            const currentVal = editor.getValue();
            const currentPath = lastSyncedPath.current;
            if (currentPath) {
                console.log(`[Manual-Save] Triggered for ${currentPath}`);
                persistSave(currentPath, currentVal);
            }
        });

        // Add 'Send to GGU AI' Context Menu Action
        editor.addAction({
            id: 'send-to-GGU AI',
            label: 'Send to GGU AI',
            contextMenuOrder: 1,
            contextMenuGroupId: 'navigation',
            run: (ed) => {
                const selection = ed.getSelection();
                const text = ed.getModel().getValueInRange(selection);
                if (text && lastSyncedPath.current) {
                    setSnippets(prev => [...prev, {
                        path: lastSyncedPath.current,
                        content: text,
                        id: Date.now()
                    }]);
                }
            }
        });
    };

    // Terminal Resizing
    const minTerminalHeight = 100;
    const maxTerminalHeight = 800;
    const startResizing = useCallback((mouseDownEvent) => {
        const handleMouseMove = (mouseMoveEvent) => {
            const delta = mouseDownEvent.clientY - mouseMoveEvent.clientY;
            setTerminalHeight(prev => {
                const newHeight = prev + delta;
                return Math.max(minTerminalHeight, Math.min(maxTerminalHeight, newHeight));
            });
        };
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const handleCreate = async (type, parentPath = '') => {
        const name = window.prompt(`Enter ${type} name:`);
        if (!name || !runState.runId) return;

        try {
            const { data } = await axios.post(`${API_BASE}/create`, {
                run_id: runState.runId,
                parent_path: parentPath,
                name,
                type
            });
            // Update global state with the returned new file list
            setRunState(prev => ({
                ...prev,
                live: { ...prev.live, files: data.files }
            }));
        } catch (err) {
            console.error('Failed to create item:', err);
            alert('Creation failed: ' + (err.response?.data?.detail || err.message));
        }
    };

    // Group files into a simple tree by directory
    const tree = useMemo(() => {
        const validPaths = files?.filter(f => f && typeof f.path === 'string').map(f => f.path) || [];
        try {
            return buildTree(validPaths);
        } catch (e) {
            console.error('Failed to build file tree:', e);
            return [];
        }
    }, [files]);

    return (
        <div className="code-editor-shell">
            {/* ── File Tree ── */}
            <div className="file-tree scrollable">
                <div className="file-tree-header">
                    <div className="tree-header-left">
                        <span className="section-label">📁 Files</span>
                        <span className="badge badge-gray">{files.length}</span>
                    </div>
                    <div className="tree-header-actions">
                        <button className="icon-btn-tree" title="New File" onClick={() => handleCreate('file')}>📄+</button>
                        <button className="icon-btn-tree" title="New Folder" onClick={() => handleCreate('folder')}>📁+</button>
                    </div>
                </div>
                {files.length === 0 ? (
                    <p className="tree-empty">Files will appear after cloning…</p>
                ) : (
                    <TreeNode nodes={tree} fileMap={fileMap} fixedPaths={fixedPaths} selected={activePath} onSelect={handleSelect} onCreation={handleCreate} />
                )}
            </div>

            {/* ── Editor Pane ── */}
            <div className="editor-pane">
                {/* Toolbar */}
                {/* Tab Bar */}
                <div className="editor-tab-bar scrollable-x">
                    {openPaths.map(path => (
                        <div
                            key={path}
                            className={`editor-tab ${activePath === path ? 'active' : ''}`}
                            onClick={() => setActivePath(path)}
                        >
                            <span className="tab-icon">{getFileIcon(path.split('/').pop())}</span>
                            <span className="tab-name">{path.split('/').pop()}</span>
                            <button className="tab-close" onClick={(e) => closeTab(e, path)}>×</button>
                        </div>
                    ))}
                </div>

                {/* Toolbar */}
                <div className="editor-toolbar">
                    <div className="editor-path-wrap">
                        <span className="editor-path mono">{activePath || 'Select a file'}</span>
                        {saving && <span className="save-indicator pulse">● Saving...</span>}
                    </div>
                    {activePath && fixedPaths.has(activePath) && (
                        <label className="diff-toggle">
                            <input type="checkbox" checked={diffMode} onChange={e => setDiffMode(e.target.checked)} />
                            <span> Show Diff</span>
                        </label>
                    )}
                    <button className="icon-btn-tree" title="Toggle Terminal" onClick={() => setShowTerminal(!showTerminal)}>
                        {showTerminal ? '🔽 Term' : '🔼 Term'}
                    </button>
                </div>

                {/* Monaco */}
                <div className="editor-container">
                    {!activePath ? (
                        <div className="editor-placeholder">
                            <div style={{ fontSize: '2.5rem' }}>📝</div>
                            <p>Select a file to view its contents</p>
                        </div>
                    ) : diffMode ? (
                        <DiffEditor
                            original={currentFileData?.original || ''}
                            modified={currentFileData?.content || ''}
                            language={detectLang(activePath)}
                            theme="GGU AI-dark"
                            beforeMount={defineGGU AITheme}
                            options={MONACO_OPTIONS}
                        />
                    ) : (
                        <Editor
                            value={localValue}
                            language={detectLang(activePath)}
                            theme="GGU AI-dark"
                            onChange={handleEditorChange}
                            onMount={handleEditorMount}
                            beforeMount={defineGGU AITheme}
                            options={{ ...MONACO_OPTIONS, readOnly: false }}
                        />
                    )}
                </div>

                {/* Integrated Terminal */}
                {showTerminal && (
                    <div style={{ height: terminalHeight, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                        <div className="terminal-resizer" onMouseDown={startResizing} />
                        <Terminal
                            runId={runState.runId}
                            API_BASE={API_BASE}
                            onClose={() => setShowTerminal(false)}
                            onFileClick={handleSelect}
                            onSetHeight={setTerminalHeight}
                        />
                    </div>
                )}
            </div>

            {/* ── Chat Sidebar (Right) ── */}
            {runState.runId && (
                <ChatSidebar
                    currentFile={activePath ? { path: activePath, content: currentFileData?.content } : null}
                    onFileSelect={handleSelect}
                />
            )}

            <style>{STYLES}</style>
        </div>
    );
}

// ── Terminal Component ────────────────────────────────────────────────────────
function Terminal({ runId, API_BASE, onClose, onFileClick, onSetHeight }) {
    const [history, setHistory] = useState([
        { type: 'info', content: 'Microsoft Windows [Version 10.0.19045.5445]' },
        { type: 'info', content: '(c) Microsoft Corporation. All rights reserved.\n' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [cwd, setCwd] = useState('C:\\GGU AI\\workspace');
    const scrollRef = useRef(null);
    const socketRef = useRef(null);

    const [socketStatus, setSocketStatus] = useState('connecting'); // 'connecting', 'open', 'closed'
    const retryCount = useRef(0);

    const connect = useCallback(() => {
        if (!runId) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let host = API_BASE.replace('http://', '').replace('https://', '');
        if (!host || host.includes(':3000')) host = '127.0.0.1:8000';

        const wsUrl = `${protocol}//${host}/ws/terminal/${runId}`;
        setSocketStatus('connecting');

        const ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'output' || data.type === 'error') {
                // Strip ANSI escape codes (colors, formatting) for a cleaner terminal
                const ESC = String.fromCharCode(27);
                const ansiRegex = new RegExp(`${ESC}\\\\[[0-9;]*[mK]`, 'g');
                const cleanContent = data.content.replace(ansiRegex, '');

                // Handle \r (Carriage Return) for progress bars and live status updates
                if (data.content.includes('\r')) {
                    setHistory(prev => {
                        if (prev.length === 0) return [{ type: data.type, content: cleanContent }];
                        const newHistory = [...prev];
                        newHistory[newHistory.length - 1] = { type: data.type, content: cleanContent };
                        return newHistory;
                    });
                } else {
                    setHistory(prev => [...prev, { type: data.type, content: cleanContent }]);
                }
            } else if (data.type === 'cwd') {
                setCwd(data.content);
            } else if (data.type === 'done') {
                setLoading(false);
            }
        };

        ws.onopen = () => {
            setSocketStatus('open');
            retryCount.current = 0;
            ws.send(JSON.stringify({ command: 'cd', cwd: null }));
        };

        ws.onerror = () => setSocketStatus('closed');

        ws.onclose = () => {
            setSocketStatus('closed');
            if (retryCount.current < 5) {
                retryCount.current++;
                setTimeout(connect, 2000);
            }
        };
    }, [runId, API_BASE]);

    useEffect(() => {
        connect();
        return () => socketRef.current?.close();
    }, [connect]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [history]);

    const execute = (e) => {
        if (e.key !== 'Enter' || !input.trim() || loading) return;
        const cmd = input.trim();

        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            setHistory(prev => [...prev, { type: 'error', content: 'Connection Lost. Please wait...' }]);
            return;
        }

        setInput('');
        setHistory(prev => [...prev, { type: 'input', content: `${cwd}>${cmd}` }]);
        setLoading(true);

        // Send command through WebSocket for real-time streaming
        socketRef.current.send(JSON.stringify({ command: cmd, cwd: cwd }));
    };

    return (
        <div className="terminal-panel cmd-theme">
            <div className="terminal-header cmd-header">
                <span className="terminal-title">Command Prompt</span>
                <div className="cmd-header-actions">
                    <span className="cmd-btn" title="Minimize" onClick={() => onSetHeight(100)}>-</span>
                    <span className="cmd-btn" title="Maximize" onClick={() => onSetHeight(500)}>+</span>
                    <span className="cmd-btn close" title="Close" onClick={onClose}>x</span>
                </div>
            </div>
            <div className="terminal-body scrollable cmd-body" ref={scrollRef}>
                {history.map((h, i) => {
                    const content = h.content;
                    // Detect file paths and HTTP/HTTPS URLs
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const pathRegex = /([a-zA-Z]:\\[\\\w\s.-]+|[/\w\s.-]+\.\w+)/g;

                    // Combined splitting logic
                    const parts = content.split(/((?:https?:\/\/[^\s]+)|(?:[a-zA-Z]:\\[\\\w\s.-]+|[/\w\s.-]+\.\w+))/g);

                    return (
                        <div key={i} className={`terminal-line line-${h.type}`}>
                            {parts.map((part, pi) => {
                                if (urlRegex.test(part)) {
                                    return (
                                        <a key={pi} href={part} target="_blank" rel="noopener noreferrer" className="clickable-path">
                                            {part}
                                        </a>
                                    );
                                }
                                if (pathRegex.test(part)) {
                                    return (
                                        <span
                                            key={pi}
                                            className="clickable-path"
                                            onClick={() => onFileClick(part.trim())}
                                        >
                                            {part}
                                        </span>
                                    );
                                }
                                return part;
                            })}
                        </div>
                    );
                })}
                {!loading && socketStatus === 'open' && (
                    <div className="terminal-input-wrap">
                        <span className="prompt">{cwd}&gt;</span>
                        <input
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={execute}
                            autoFocus
                            spellCheck="false"
                        />
                    </div>
                )}
                {socketStatus === 'connecting' && <div className="terminal-line line-info pulse">Re-connecting to GGU AI Shell...</div>}
                {socketStatus === 'closed' && (
                    <div className="terminal-line line-error">
                        Connection Lost. <button className="btn-mini" onClick={connect}>Retry Now</button>
                    </div>
                )}
            </div>
        </div>
    );
}


// ── Tree rendering ────────────────────────────────────────────────────────
function TreeNode({ nodes, fileMap, fixedPaths, selected, onSelect, onCreation, depth = 0 }) {
    if (!Array.isArray(nodes)) return null;
    return (
        <div>
            {nodes.map(node => (
                <TreeItem key={node.path} node={node} fileMap={fileMap} fixedPaths={fixedPaths} selected={selected} onSelect={onSelect} onCreation={onCreation} depth={depth} />
            ))}
        </div>
    );
}

function TreeItem({ node, fileMap, fixedPaths, selected, onSelect, onCreation, depth }) {
    const [open, setOpen] = useState(false);
    if (!node) return null;
    const isDir = !!node.children;
    const isFixed = !isDir && fixedPaths.has(node.path);
    const isSel = selected === node.path;

    return (
        <div>
            <div
                className={`tree-item ${isSel ? 'tree-item-selected' : ''} ${isFixed ? 'tree-item-fixed' : ''} ${depth > 0 ? 'tree-item-nested' : ''}`}
                style={{ paddingLeft: 10 }}
                onClick={() => isDir ? setOpen(o => !o) : onSelect(node.path)}
            >
                <span className="tree-icon">{isDir ? (open ? '📂' : '📁') : getFileIcon(node.name)}</span>
                <span className="tree-name">{node.name}</span>
                {isDir && (
                    <div className="tree-item-hover-actions">
                        <button className="btn-mini" onClick={(e) => { e.stopPropagation(); onCreation('file', node.path); }}>+</button>
                        <button className="btn-mini" onClick={(e) => { e.stopPropagation(); onCreation('folder', node.path); }}>📂+</button>
                    </div>
                )}
                {isFixed && <span className="badge badge-green" style={{ fontSize: '0.65rem', padding: '1px 5px', marginLeft: 'auto' }}>Fixed</span>}
            </div>
            {isDir && open && (
                <div className="tree-children">
                    <TreeNode nodes={node.children} fileMap={fileMap} fixedPaths={fixedPaths} selected={selected} onSelect={onSelect} onCreation={onCreation} depth={depth + 1} />
                </div>
            )}
        </div>
    );
}


// ── Helpers ───────────────────────────────────────────────────────────────
function buildTree(paths) {
    const root = [];
    const map = {};

    paths.forEach(p => {
        const parts = p.split('/');
        let current = root;
        let accumulated = '';

        parts.forEach((part, i) => {
            accumulated = accumulated ? `${accumulated}/${part}` : part;
            const isLast = i === parts.length - 1;

            if (!map[accumulated]) {
                const node = { name: part, path: accumulated, children: isLast ? undefined : [] };
                map[accumulated] = node;
                current.push(node);
            }
            if (!isLast) current = map[accumulated].children;
        });
    });

    // Sort to show folders first, then files
    const sortNodes = (nodes) => {
        nodes.sort((a, b) => {
            const aIsDir = !!a.children;
            const bIsDir = !!b.children;
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.name.localeCompare(b.name);
        });
        nodes.forEach(n => { if (n.children) sortNodes(n.children); });
    };

    sortNodes(root);
    return root;
}

function detectLang(path) {
    const ext = path.split('.').pop();
    return { py: 'python', js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'shell' }[ext] || 'plaintext';
}

function getFileIcon(name) {
    const ext = name.split('.').pop();
    return { py: '🐍', js: '📜', ts: '📘', json: '🗂', md: '📄', yaml: '⚙️', yml: '⚙️', sh: '💻', txt: '📝' }[ext] || '📄';
}

const MONACO_OPTIONS = {
    fontSize: 13,
    lineNumbers: 'on',
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
    fontLigatures: true,
    automaticLayout: true,
    fixedOverflowWidgets: true,
    renderWhitespace: 'selection',
};

const STYLES = `
  .code-editor-shell { display: flex; height: 100%; overflow: hidden; }
  .file-tree { width: 240px; flex-shrink: 0; border-right: 1px solid var(--border); background: var(--bg-secondary); display: flex; flex-direction: column; }
  .file-tree-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .tree-empty { padding: 16px 12px; color: var(--text-muted); font-size: 0.82rem; }
  .tree-item { display: flex; align-items: center; gap: 6px; padding: 5px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem; transition: var(--transition); }
  .tree-item:hover { background: var(--bg-card); }
  .tree-item-selected { background: rgba(79,142,247,0.15) !important; color: var(--accent-blue); }
  .tree-item-fixed .tree-name { color: var(--accent-green); }
  .tree-icon { font-size: 0.9rem; flex-shrink: 0; }
  .tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  
  .tree-header-left { display: flex; align-items: center; gap: 8px; }
  .tree-header-actions { display: flex; gap: 4px; }
  .icon-btn-tree { background: transparent; padding: 2px 6px; border-radius: 4px; color: var(--text-muted); font-size: 0.8rem; border: 1px solid transparent; }
  .icon-btn-tree:hover { background: var(--border); color: var(--text-primary); border-color: var(--border-bright); }
  .tree-item-hover-actions { display: none; gap: 4px; margin-left: 8px; }
  .tree-item:hover .tree-item-hover-actions { display: flex; }
  .btn-mini { background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-muted); font-size: 0.7rem; padding: 0 4px; border-radius: 3px; cursor: pointer; }
  .btn-mini:hover { border-color: var(--accent-blue); color: var(--text-primary); }
  
  .tree-children { margin-left: 14px; border-left: 1px solid var(--border-muted); position: relative; }
  .tree-item { position: relative; transition: 0.2s; }
  .tree-item-nested::before { content: ''; position: absolute; left: -14px; top: 12px; width: 10px; height: 1px; background: var(--border-muted); }
  .tree-item-selected { background: rgba(79, 142, 247, 0.1) !important; color: var(--accent-blue); }

  .editor-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .editor-path { font-size: 0.75rem; color: var(--text-muted); opacity: 0.7; }
  .editor-path-wrap { display: flex; align-items: center; gap: 12px; }
  .save-indicator { font-size: 0.72rem; color: var(--accent-green); font-weight: 600; }
  .diff-toggle { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 0.8rem; cursor: pointer; }
  .editor-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); }

  /* Tabs */
  .editor-tab-bar { display: flex; background: var(--bg-card); border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; flex-shrink: 0; }
  .editor-tab-bar::-webkit-scrollbar { display: none; }
  .editor-tab { display: flex; align-items: center; gap: 8px; padding: 0 14px; height: 36px; border-right: 1px solid var(--border); cursor: pointer; color: var(--text-muted); font-size: 0.78rem; font-weight: 500; transition: 0.2s; position: relative; min-width: 120px; max-width: 200px; }
  .editor-tab:hover { background: rgba(255,255,255,0.03); color: var(--text-primary); }
  .editor-tab.active { background: var(--bg-secondary); color: var(--accent-blue); }
  .editor-tab.active::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--accent-blue); }
  
  .tab-icon { font-size: 0.9rem; opacity: 0.8; }
  .tab-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab-close { background: transparent; border: none; color: var(--text-muted); font-size: 1.1rem; line-height: 1; padding: 2px 4px; border-radius: 4px; opacity: 0; transition: 0.2s; }
  .editor-tab:hover .tab-close { opacity: 1; }
  .tab-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

  .editor-container { flex: 1; position: relative; overflow: hidden; }
  
  .terminal-resizer { height: 4px; background: var(--border); cursor: ns-resize; transition: 0.2s; flex-shrink: 0; z-index: 10; }
  .terminal-resizer:hover { background: var(--accent-blue); box-shadow: 0 0 10px rgba(79, 142, 247, 0.5); }

  /* Terminal (CMD Theme) */
  .terminal-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .clickable-path { color: var(--accent-cyan); text-decoration: underline; cursor: pointer; transition: 0.2s; }
  .clickable-path:hover { color: var(--accent-blue); text-shadow: 0 0 5px var(--accent-blue); }

  .cmd-theme { background: #000 !important; border-top: 2px solid #333 !important; }
  .cmd-header { background: #fff !important; color: #000 !important; height: 30px !important; display: flex !important; justify-content: space-between !important; align-items: center !important; padding-left: 10px !important; flex-shrink: 0; }
  .cmd-header .terminal-title { color: #333 !important; font-family: 'Segoe UI', sans-serif; font-weight: 500; font-size: 0.75rem; }
  .cmd-header-actions { display: flex; align-items: stretch; height: 100%; }
  .cmd-btn { padding: 0 12px; display: flex; align-items: center; cursor: pointer; font-size: 0.9rem; transition: 0.2s; }
  .cmd-btn:hover { background: #e5e5e5; }
  .cmd-btn.close:hover { background: #e81123; color: #fff; }
  
  .cmd-body { font-family: 'Consolas', 'Courier New', monospace !important; color: #ccc !important; padding: 4px 8px !important; }
  .terminal-line { white-space: pre-wrap !important; word-break: break-all !important; margin-bottom: 2px; }
  .line-input { color: #ccc !important; font-weight: 400 !important; }
  .line-output { color: #ccc !important; }
  .line-info { color: #ccc !important; font-style: normal !important; }
  .line-error { color: #ff5252 !important; }
  
  .cmd-body .prompt { color: #ccc !important; margin-right: 4px; }
  .cmd-body input { font-family: 'Consolas', monospace !important; font-size: 1rem !important; }
`;

