/**
 * HistoryView.js – Manage previous repo clones
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useApp } from '../App';

export default function HistoryView() {
    const { API_BASE } = useApp();
    const [repos, setRepos] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchRepos = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_BASE}/repos`);
            setRepos(data);
        } catch (err) {
            console.error('Failed to fetch repos:', err);
        } finally {
            setLoading(false);
        }
    }, [API_BASE]);

    useEffect(() => {
        fetchRepos();
    }, [fetchRepos]);

    const deleteRepo = async (runId) => {
        if (!window.confirm('Delete this repository clone?')) return;
        try {
            await axios.delete(`${API_BASE}/repos/${runId}`);
            setRepos(prev => prev.filter(r => r.run_id !== runId));
        } catch (err) {
            const msg = err.response?.data?.detail || 'Failed to delete repository.';
            alert(`Delete failed: ${msg}`);
        }
    };

    const downloadRepo = async (runId, repoName) => {
        setLoading(true);
        try {
            console.log('Downloading ZIP for run:', runId);
            const response = await fetch(`${API_BASE}/download/${runId}`);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(errData.detail || 'Download failed');
            }

            const blob = await response.blob();
            if (blob.size < 100) {
                throw new Error('The downloaded file seems empty or corrupted.');
            }

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const fileName = repoName ? `${repoName}.zip` : `fixed_repo_${runId}.zip`;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download error:', err);
            alert(`Download failed: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (loading && repos.length === 0) {
        return <div className="history-page empty-state">🔍 Scanning for repositories…</div>;
    }

    return (
        <div className="history-page scrollable">
            <div className="history-header">
                <h2>📦 Repository Management</h2>
                <p>Manage disk space by deleting old cloned repositories or downloading previous fixes.</p>
                <button className="btn-secondary" onClick={fetchRepos} disabled={loading} style={{ marginTop: 8 }}>
                    {loading ? 'Refreshing…' : '🔄 Refresh List'}
                </button>
            </div>

            <div className="glow-divider" />

            {repos.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">📁</div>
                    <p>No repository clones found on disk.</p>
                </div>
            ) : (
                <div className="history-grid">
                    {repos.map(repo => (
                        <div key={repo.run_id} className="repo-card card card-hover">
                            <div className="repo-info">
                                <div className="repo-name mono">📂 {repo.repo_name}</div>
                                <div className="repo-meta">
                                    <span>🆔 {repo.run_id.slice(0, 8)}…</span>
                                    <span>💾 {repo.size_mb} MB</span>
                                    <span>📅 {new Date(repo.created_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="repo-actions">
                                <button className="repo-btn btn-down" onClick={() => downloadRepo(repo.run_id, repo.repo_name)}>
                                    ⏬ Download
                                </button>
                                <button className="repo-btn btn-del" onClick={() => deleteRepo(repo.run_id)}>
                                    🗑️ Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <style>{STYLES}</style>
        </div>
    );
}

const STYLES = `
  .history-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 32px 24px;
    width: 100%;
  }
  .history-header h2 { color: var(--accent-cyan); margin-bottom: 4px; }
  .history-header p { color: var(--text-secondary); font-size: 0.9rem; }
  
  .history-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 24px;
  }
  
  .repo-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-radius: var(--radius-md);
  }
  
  .repo-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .repo-name {
    font-weight: 700;
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  .repo-meta {
    display: flex;
    gap: 16px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  
  .repo-actions {
    display: flex;
    gap: 8px;
  }
  
  .repo-btn {
    padding: 8px 14px;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .btn-down {
    background: rgba(34, 211, 238, 0.1);
    color: var(--accent-cyan);
    border: 1px solid rgba(34, 211, 238, 0.3);
  }
  .btn-down:hover { background: var(--accent-cyan); color: #000; }
  
  .btn-del {
    background: rgba(239, 68, 68, 0.1);
    color: var(--accent-red);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .btn-del:hover { background: var(--accent-red); color: #fff; }

  .btn-secondary {
    background: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
  }
  .btn-secondary:hover { border-color: var(--accent-blue); color: var(--text-primary); }
`;
