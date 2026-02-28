import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import axios from 'axios';
import { useApp } from '../App';
import ChatSidebar from './ChatSidebar';
import TerminalView from './TerminalView';

export default function CodeEditor() {
    const {
        runState, setRunState, API_BASE, setSnippets, loadWorkspace,
        openPaths, activePath, setActivePath, openFile, closeFile
    } = useApp();
    const files = useMemo(() => runState.live?.files || [], [runState.live?.files]);
    const fixes = useMemo(() => runState.result?.fixes_table || [], [runState.result?.fixes_table]);
    const fixedPaths = useMemo(() => new Set(fixes.filter(f => f.status === 'fixed').map(f => f.file)), [fixes]);

    const [diffMode, setDiffMode] = useState(false);
    const [showTerminal, setShowTerminal] = useState(true);
    const [terminalHeight, setTerminalHeight] = useState(300);
    const [chatWidth, setChatWidth] = useState(380);
    const [saving, setSaving] = useState(false);
    const [localValue, setLocalValue] = useState('');
    const lastSyncedPath = useRef(null);
    const debounceTimer = useRef(null);
    const editorRef = useRef(null);
    const [contextMenu, setContextMenu] = useState(null);

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

    const currentFileData = activePath ? fileMap[activePath] : null;

    const closeTab = (e, path) => {
        e.stopPropagation();
        closeFile(path);
    };

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

    const defineGGUAITheme = useCallback((monaco) => {
        if (!monaco) return;
        try {
            monaco.editor.defineTheme('gguai-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                    'editor.background': '#0d0f1a',
                    'diffEditor.insertedTextBackground': '#123d1d',
                    'diffEditor.removedTextBackground': '#3d1212',
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
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            const currentVal = editor.getValue();
            const currentPath = lastSyncedPath.current;
            if (currentPath) {
                persistSave(currentPath, currentVal);
            }
        });
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

    const startResizing = useCallback((mouseDownEvent) => {
        const handleMouseMove = (mouseMoveEvent) => {
            const delta = mouseDownEvent.clientY - mouseMoveEvent.clientY;
            setTerminalHeight(prev => {
                const newHeight = prev + delta;
                return Math.max(100, Math.min(800, newHeight));
            });
        };
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const startChatResizing = useCallback((mouseDownEvent) => {
        const startX = mouseDownEvent.clientX;
        const startWidth = chatWidth;
        const handleMouseMove = (mouseMoveEvent) => {
            const delta = startX - mouseMoveEvent.clientX;
            const newWidth = startWidth + delta;
            setChatWidth(Math.max(250, Math.min(800, newWidth)));
        };
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [chatWidth]);

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
            setRunState(prev => ({
                ...prev,
                live: { ...prev.live, files: data.files }
            }));
        } catch (err) {
            console.error('Failed to create item:', err);
            alert('Creation failed: ' + (err.response?.data?.detail || err.message));
        }
    };

    const handleDelete = async (path) => {
        if (!window.confirm(`Are you sure you want to delete ${path}?`)) return;
        try {
            const { data } = await axios.post(`${API_BASE}/delete`, {
                run_id: runState.runId,
                path: path
            });
            setRunState(prev => ({
                ...prev,
                live: { ...prev.live, files: data.files }
            }));
            closeFile(path);
        } catch (err) {
            console.error('Failed to delete item:', err);
            alert('Deletion failed: ' + (err.response?.data?.detail || err.message));
        }
    };

    const handleContextMenu = (e, path) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, path });
    };

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

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
            <div className="file-tree scrollable">
                <div className="file-tree-header">
                    <div className="tree-header-left">
                        <span className="section-label">📁 Files</span>
                        <span className="badge badge-gray">{files.length}</span>
                    </div>
                    <div className="tree-header-actions">
                        <button className="icon-btn-tree" title="Refresh Tree" onClick={() => loadWorkspace(runState.runId)}>🔄</button>
                        <button className="icon-btn-tree" title="New File" onClick={() => handleCreate('file')}>📄+</button>
                        <button className="icon-btn-tree" title="New Folder" onClick={() => handleCreate('folder')}>📁+</button>
                    </div>
                </div>
                {files.length === 0 ? (
                    <p className="tree-empty">Files will appear after cloning…</p>
                ) : (
                    <TreeNode
                        nodes={tree}
                        fileMap={fileMap}
                        fixedPaths={fixedPaths}
                        selected={activePath}
                        onSelect={openFile}
                        onCreation={handleCreate}
                        onContextMenu={handleContextMenu}
                    />
                )}
            </div>

            {contextMenu && (
                <div
                    className="tree-context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="menu-item menu-item-danger" onClick={() => { handleDelete(contextMenu.path); setContextMenu(null); }}>
                        🗑️ Delete
                    </div>
                </div>
            )}

            <div className="editor-pane">
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
                            theme="gguai-dark"
                            beforeMount={defineGGUAITheme}
                            options={MONACO_OPTIONS}
                        />
                    ) : (
                        <Editor
                            value={localValue}
                            language={detectLang(activePath)}
                            theme="gguai-dark"
                            onChange={handleEditorChange}
                            onMount={handleEditorMount}
                            beforeMount={defineGGUAITheme}
                            options={{ ...MONACO_OPTIONS, readOnly: false }}
                        />
                    )}
                </div>

                {showTerminal && (
                    <div style={{ height: terminalHeight, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                        <div className="terminal-resizer" onMouseDown={startResizing} />
                        <div className="embedded-terminal-wrapper" style={{ flex: 1, minHeight: 0 }}>
                            <TerminalView />
                        </div>
                    </div>
                )}
            </div>

            {runState.runId && (
                <>
                    <div className="chat-resizer-h" onMouseDown={startChatResizing} />
                    <div className="chat-sidebar-resizable" style={{ width: chatWidth }}>
                        <ChatSidebar
                            currentFile={activePath ? { path: activePath, content: currentFileData?.content } : null}
                            onFileSelect={openFile}
                        />
                    </div>
                </>
            )}

            <style>{STYLES}</style>
        </div>
    );
}

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
    automaticLayout: true,
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
  .editor-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .editor-path { font-size: 0.75rem; color: var(--text-muted); opacity: 0.7; }
  .editor-path-wrap { display: flex; align-items: center; gap: 12px; }
  .save-indicator { font-size: 0.72rem; color: var(--accent-green); font-weight: 600; }
  .diff-toggle { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 0.8rem; cursor: pointer; }
  .editor-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); }
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
  .chat-resizer-h { width: 4px; cursor: col-resize; background: var(--border); transition: 0.2s; flex-shrink: 0; z-index: 10; }
  .chat-resizer-h:hover { background: var(--accent-blue); box-shadow: 0 0 10px rgba(79, 142, 247, 0.5); }
  .chat-sidebar-resizable { display: flex; flex-direction: column; flex-shrink: 0; }
  .editor-container { flex: 1; position: relative; overflow: hidden; }
  .terminal-resizer { height: 4px; background: var(--border); cursor: ns-resize; transition: 0.2s; flex-shrink: 0; z-index: 10; }
  .terminal-resizer:hover { background: var(--accent-blue); box-shadow: 0 0 10px rgba(79, 142, 247, 0.5); }
  .embedded-terminal-wrapper { background: #000; }
  .tree-context-menu { position: fixed; background: var(--bg-secondary); border: 1px solid var(--border-bright); border-radius: 6px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 1000; min-width: 140px; padding: 4px; }
  .menu-item { padding: 8px 12px; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 8px; }
  .menu-item:hover { background: var(--bg-card); }
  .menu-item-danger { color: #f87171; }
  .menu-item-danger:hover { background: rgba(248, 113, 113, 0.1); }
`;

function TreeNode({ nodes, fileMap, fixedPaths, selected, onSelect, onCreation, onContextMenu, depth = 0 }) {
    if (!Array.isArray(nodes)) return null;
    return (
        <div>
            {nodes.map(node => (
                <TreeItem
                    key={node.path}
                    node={node}
                    fileMap={fileMap}
                    fixedPaths={fixedPaths}
                    selected={selected}
                    onSelect={onSelect}
                    onCreation={onCreation}
                    onContextMenu={onContextMenu}
                    depth={depth}
                />
            ))}
        </div>
    );
}

function TreeItem({ node, fileMap, fixedPaths, selected, onSelect, onCreation, onContextMenu, depth }) {
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
                onContextMenu={(e) => onContextMenu(e, node.path)}
            >
                <span className="tree-icon">{isDir ? (open ? '📂' : '📁') : getFileIcon(node.name)}</span>
                <span className="tree-name">{node.name}</span>
                {isDir && (
                    <div className="tree-item-hover-actions">
                        <button className="btn-mini" onClick={(e) => { e.stopPropagation(); onCreation('file', node.path); }}>+</button>
                        <button className="btn-mini" onClick={(e) => { e.stopPropagation(); onCreation('folder', node.path); }}>📁+</button>
                    </div>
                )}
                {isFixed && <span className="badge badge-green" style={{ fontSize: '0.65rem', padding: '1px 5px', marginLeft: 'auto' }}>Fixed</span>}
            </div>
            {isDir && open && (
                <div className="tree-children">
                    <TreeNode
                        nodes={node.children}
                        fileMap={fileMap}
                        fixedPaths={fixedPaths}
                        selected={selected}
                        onSelect={onSelect}
                        onCreation={onCreation}
                        onContextMenu={onContextMenu}
                        depth={depth + 1}
                    />
                </div>
            )}
        </div>
    );
}
