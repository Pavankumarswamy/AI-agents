import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function FolderPickerModal({ isOpen, onClose, onSelect, API_BASE }) {
    const [currentPath, setCurrentPath] = useState('');
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const browse = React.useCallback(async (path = '') => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await axios.post(`${API_BASE}/local/browse`, { path });
            setCurrentPath(data.current_path);
            setFolders(data.folders);
        } catch (err) {
            setError(err.response?.data?.detail || err.message);
        } finally {
            setLoading(false);
        }
    }, [API_BASE]);

    useEffect(() => {
        if (isOpen) browse();
    }, [isOpen, browse]);

    if (!isOpen) return null;

    const goUp = () => {
        const parts = currentPath.split(/[\\/]/).filter(Boolean);
        if (parts.length <= 1) return; // Top level
        const parent = currentPath.substring(0, currentPath.lastIndexOf('\\')) || currentPath.substring(0, currentPath.lastIndexOf('/'));
        browse(parent);
    };

    return (
        <div className="picker-overlay">
            <div className="picker-modal card">
                <div className="picker-header">
                    <h3>📂 Select Local Project Folder</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="picker-body">
                    <div className="path-bar">
                        <button className="up-btn" onClick={goUp} title="Go up">⬆</button>
                        <input type="text" value={currentPath} readOnly className="path-input" />
                    </div>

                    {error && <div className="error-text">⚠️ {error}</div>}

                    <div className="folder-list scrollable">
                        {loading ? (
                            <div className="loading-state"><span className="spinner"></span> Loading folders...</div>
                        ) : (
                            <>
                                {folders.map(f => (
                                    <div
                                        key={f.path}
                                        className="folder-item"
                                        onDoubleClick={() => browse(f.path)}
                                        onClick={() => setCurrentPath(f.path)}
                                    >
                                        <span className="folder-icon">📁</span>
                                        <span className="folder-name">{f.name}</span>
                                    </div>
                                ))}
                                {folders.length === 0 && !loading && <div className="empty-state">No subdirectories found.</div>}
                            </>
                        )}
                    </div>
                </div>

                <div className="picker-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="btn-primary"
                        onClick={() => { onSelect(currentPath); onClose(); }}
                        disabled={!currentPath}
                    >
                        Select Folder
                    </button>
                </div>
            </div>

            <style>{PICKER_STYLES}</style>
        </div>
    );
}

const PICKER_STYLES = `
    .picker-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    }
    .picker-modal {
        width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .picker-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .picker-header h3 { margin: 0; font-size: 1.1rem; color: var(--text-primary); }
    .close-btn { background: transparent; font-size: 1.5rem; color: var(--text-muted); }
    .picker-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
    .path-bar { display: flex; gap: 8px; }
    .up-btn { padding: 8px 12px; background: var(--bg-card); border-radius: var(--radius-sm); border: 1px solid var(--border); }
    .path-input { flex: 1; padding: 8px 12px; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.8rem; }
    
    .folder-list {
        height: 300px;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 4px;
    }
    .folder-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        cursor: pointer;
        border-radius: var(--radius-xs);
        transition: background 0.2s;
        user-select: none;
    }
    .folder-item:hover { background: rgba(255,255,255,0.05); }
    .folder-item.selected { background: rgba(79, 142, 247, 0.15); color: var(--accent-blue); }
    .folder-icon { font-size: 1.2rem; }
    .folder-name { font-size: 0.9rem; color: var(--text-primary); }
    
    .picker-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--border);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    }
    .loading-state { display: flex; align-items: center; justify-content: center; height: 100%; gap: 10px; color: var(--text-muted); }
    .error-text { color: var(--accent-red); font-size: 0.85rem; padding: 0 4px; }
`;
