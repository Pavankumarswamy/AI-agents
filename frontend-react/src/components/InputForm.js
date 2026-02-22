/**
 * InputForm.js – Repo URL, team name, leader name inputs + Run Agent button
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useApp } from '../App';
import FolderPickerModal from './FolderPickerModal';

export default function InputForm() {
    const { startRun, startLocalRun, loadWorkspace, runState, configStatus, API_BASE } = useApp();
    const isRunning = runState.status === 'running';

    const [mode, setMode] = useState('github'); // 'github', 'local', or 'saved'
    const [savedWorkspaces, setSavedWorkspaces] = useState([]);
    const [loadingSaved, setLoadingSaved] = useState(false);
    const [form, setForm] = useState({
        repoUrl: '',
        localPath: '',
        teamName: 'AI PROJECT',
        leaderName: 'SPKS',
    });
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    const branchPreview = deriveBranch(form.teamName, form.leaderName);

    const fetchWorkspaces = useCallback(async () => {
        setLoadingSaved(true);
        try {
            const { data } = await axios.get(`${API_BASE}/workspaces`);
            setSavedWorkspaces(data.workspaces || []);
        } catch (err) {
            console.error('Failed to fetch workspaces:', err);
        } finally {
            setLoadingSaved(false);
        }
    }, [API_BASE]);

    useEffect(() => {
        if (mode === 'saved') {
            fetchWorkspaces();
        }
    }, [mode, fetchWorkspaces]);

    function deriveBranch(team, leader) {
        const clean = s => s.replace(/[^A-Za-z0-9 ]/g, '').trim().toUpperCase().replace(/ /g, '_');
        if (!team && !leader) return 'TEAM_LEADER_AI_Fix';
        return `${clean(team) || 'TEAM'}_${clean(leader) || 'LEADER'}_AI_Fix`;
    }

    const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

    const handleSubmit = e => {
        e.preventDefault();
        if (mode === 'github') {
            if (!form.repoUrl.trim()) return;
            startRun({ repoUrl: form.repoUrl, teamName: form.teamName, leaderName: form.leaderName });
        } else {
            if (!form.localPath.trim()) return;
            startLocalRun({ path: form.localPath, teamName: form.teamName, leaderName: form.leaderName });
        }
    };

    return (
        <div className="input-page">
            <div className="input-hero">
                <h1>🧬 Autonomous Project Workspace</h1>
                <p className="input-subtitle">
                    Mount a local folder or clone a GitHub repo to start building with the AI agent.
                </p>

                {mode === 'github' && !configStatus.github_pat_set && (
                    <div className="error-banner" style={{ marginTop: 24, justifyContent: 'center' }}>
                        <span>⚠️</span> GitHub Token missing! Please configure it in <strong>Settings</strong> to clone private repos.
                    </div>
                )}
            </div>

            <div className="source-toggle card">
                <button className={`toggle-btn ${mode === 'github' ? 'active' : ''}`} onClick={() => setMode('github')}>
                    🌐 GitHub Remote
                </button>
                <button className={`toggle-btn ${mode === 'local' ? 'active' : ''}`} onClick={() => setMode('local')}>
                    💻 Local Device
                </button>
                <button className={`toggle-btn ${mode === 'saved' ? 'active' : ''}`} onClick={() => setMode('saved')}>
                    🧬 Autonomous Project Workspace
                </button>
            </div>

            <form className="input-form card" onSubmit={handleSubmit}>
                {mode === 'github' ? (
                    <div className="field-group animate-fade">
                        <label className="field-label">GitHub Repository URL</label>
                        <input
                            type="url"
                            name="repoUrl"
                            placeholder="https://github.com/owner/repo"
                            value={form.repoUrl}
                            onChange={handleChange}
                            required
                            disabled={isRunning}
                        />
                    </div>
                ) : mode === 'local' ? (
                    <div className="field-group animate-fade">
                        <label className="field-label">Project Folder Path</label>
                        <div className="input-with-action">
                            <input
                                type="text"
                                name="localPath"
                                placeholder="C:\Users\Name\Projects\my-app"
                                value={form.localPath}
                                onChange={handleChange}
                                required
                                disabled={isRunning}
                            />
                            <button
                                type="button"
                                className="action-btn"
                                onClick={() => setIsPickerOpen(true)}
                                disabled={isRunning}
                            >
                                📂 Browse
                            </button>
                        </div>
                        <span className="field-hint">Select a project folder directly from your device.</span>
                    </div>
                ) : (
                    <div className="field-group animate-fade">
                        <label className="field-label">🧬 Autonomous Project Workspace</label>
                        {loadingSaved ? (
                            <div className="loading-placeholder">🔍 Searching for workspaces…</div>
                        ) : savedWorkspaces.length === 0 ? (
                            <div className="empty-saved">No saved workspaces found. Clone or mount one first!</div>
                        ) : (
                            <div className="saved-list">
                                {savedWorkspaces.map(ws => (
                                    <div key={ws.run_id} className="saved-item card-hover" onClick={() => loadWorkspace(ws.run_id)}>
                                        <div className="saved-item-info">
                                            <div className="saved-title">🏢 {ws.team_name}</div>
                                            <div className="saved-path">{ws.path}</div>
                                        </div>
                                        <div className="saved-actions">
                                            <div className="saved-badge">{ws.status}</div>
                                            <button
                                                className="delete-ws-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm('Delete this workspace and all its data?')) {
                                                        axios.delete(`${API_BASE}/repos/${ws.run_id}`).then(() => fetchWorkspaces());
                                                    }
                                                }}
                                                title="Delete Workspace"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="field-row">
                    <div className="field-group">
                        <label className="field-label">Workspace Title</label>
                        <input
                            type="text"
                            name="teamName"
                            placeholder="e.g. AI PROJECT"
                            value={form.teamName}
                            onChange={handleChange}
                            disabled={isRunning}
                        />
                    </div>
                    <div className="field-group">
                        <label className="field-label">Project Owner</label>
                        <input
                            type="text"
                            name="leaderName"
                            placeholder="e.g. SPKS"
                            value={form.leaderName}
                            onChange={handleChange}
                            disabled={isRunning}
                        />
                    </div>
                </div>

                <div className="branch-preview">
                    <span className="section-label">{mode === 'github' ? 'AI-Fix Branch' : 'Local Context'}</span>
                    <span className="branch-name mono">
                        {mode === 'github' ? `🔀 ${branchPreview}` : `📂 ${form.leaderName || 'Project'}_Dev_Session`}
                    </span>
                </div>

                {mode !== 'saved' && (
                    <button type="submit" className="btn-primary run-btn" disabled={isRunning || (mode === 'github' && !form.repoUrl) || (mode === 'local' && !form.localPath)}>
                        {isRunning ? (
                            <><span className="spinner" /> Mounting Workspace…</>
                        ) : (
                            mode === 'github' ? '▶ Run Agent & Clone' : '▶ Mount Local Folder'
                        )}
                    </button>
                )}
            </form>

            <FolderPickerModal
                isOpen={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                onSelect={(path) => setForm(f => ({ ...f, localPath: path }))}
                API_BASE={useApp().API_BASE}
            />

            <div className="info-grid">
                {INFO_CARDS.map(c => (
                    <div key={c.title} className="info-card card card-hover">
                        <div className="info-card-icon">{c.icon}</div>
                        <div>
                            <div className="info-card-title">{c.title}</div>
                            <div className="info-card-desc">{c.desc}</div>
                        </div>
                    </div>
                ))}
            </div>

            <style>{STYLES}</style>
        </div>
    );
}

const INFO_CARDS = [
    { icon: '🔍', title: 'Discovery', desc: 'Auto-detects all test files in the repository' },
    { icon: '🐳', title: 'Sandboxed', desc: 'Tests run in isolated Docker containers' },
    { icon: '🤖', title: 'LLM-Powered', desc: 'Ollama / OpenAI generate precise patches' },
    { icon: '🔁', title: 'Iterative', desc: 'Up to 5 retry loops until all tests pass' },
    { icon: '📊', title: 'Scored', desc: 'Score breakdown with bonuses & penalties' },
    { icon: '🚀', title: 'Auto-Push', desc: 'Commits & pushes to a dedicated AI-Fix branch' },
];

const STYLES = `
  .input-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    overflow-y: auto;
    height: 100%;
  }
  .input-hero h1 { background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .input-subtitle { color: var(--text-secondary); margin-top: 6px; }
  .input-form { display: flex; flex-direction: column; gap: 18px; }
  .field-group { display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .field-label { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.5px; color: var(--text-secondary); text-transform: uppercase; }
  .field-row { display: flex; gap: 16px; }
  .branch-preview { display: flex; align-items: center; gap: 12px; background: var(--bg-primary); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
  .branch-name { color: var(--accent-cyan); font-size: 0.85rem; }
  .run-btn { align-self: flex-start; display: flex; align-items: center; gap: 10px; padding: 12px 32px; font-size: 1rem; }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .info-card { display: flex; align-items: flex-start; gap: 12px; padding: 14px; }
  .info-card-icon { font-size: 1.4rem; flex-shrink: 0; }
  .info-card-title { font-weight: 600; font-size: 0.88rem; color: var(--text-primary); margin-bottom: 2px; }
  .info-card-desc  { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.5; }

  .source-toggle {
    display: flex;
    gap: 8px;
    padding: 6px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
  }
  .toggle-btn {
    flex: 1;
    padding: 10px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    background: transparent;
    transition: all 0.2s ease;
  }
  .toggle-btn:hover { background: var(--bg-card); color: var(--text-primary); }
  .toggle-btn.active {
    background: var(--bg-primary);
    color: var(--accent-blue);
    box-shadow: var(--shadow-sm);
  }

  .field-hint { font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; }
  .animate-fade { animation: fadeIn 0.3s ease; }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .input-with-action {
    display: flex;
    gap: 12px;
  }
  .input-with-action input {
    flex: 1;
  }
  .action-btn {
    padding: 0 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 600;
    transition: all 0.2s;
    white-space: nowrap;
  }
  .action-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent-blue);
    color: var(--accent-blue);
  }

  .saved-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; max-height: 300px; overflow-y: auto; padding-right: 4px; }
  .saved-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; transition: 0.2s; }
  .saved-item:hover { border-color: var(--accent-blue); background: var(--bg-card); }
  .saved-item-info { flex: 1; }
  .saved-title { font-weight: 700; color: var(--text-primary); font-size: 0.9rem; }
  .saved-path { font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }
  .saved-actions { display: flex; align-items: center; gap: 12px; }
  .saved-badge { font-size: 0.65rem; padding: 2px 8px; border-radius: 10px; background: rgba(255,255,255,0.05); color: var(--text-secondary); text-transform: uppercase; font-weight: 700; }
  .delete-ws-btn { background: transparent; border: none; font-size: 0.9rem; cursor: pointer; opacity: 0.4; transition: 0.2s; }
  .delete-ws-btn:hover { opacity: 1; transform: scale(1.1); }
  .empty-saved { padding: 32px; text-align: center; color: var(--text-muted); font-size: 0.85rem; border: 1px dashed var(--border); border-radius: var(--radius-md); }
  .loading-placeholder { padding: 20px; text-align: center; color: var(--accent-cyan); font-size: 0.85rem; }
`;
