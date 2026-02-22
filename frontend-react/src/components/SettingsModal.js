/**
 * SettingsModal.js – UI for managing GitHub PAT and API keys
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useApp } from '../App';

export default function SettingsModal({ isOpen, onClose }) {
    const { API_BASE } = useApp();
    const [config, setConfig] = useState({ github_pat_set: false, nvidia_api_key_set: false });
    const [form, setForm] = useState({ github_pat: '', nvidia_api_key: '' });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const fetchConfig = useCallback(async () => {
        try {
            const { data } = await axios.get(`${API_BASE}/config`);
            setConfig(data);
        } catch (err) {
            console.error('Failed to fetch config:', err);
        }
    }, [API_BASE]);

    useEffect(() => {
        if (isOpen) {
            fetchConfig();
            setMessage('');
        }
    }, [isOpen, fetchConfig]);

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        try {
            await axios.post(`${API_BASE}/config`, form);
            setMessage('✅ Configuration saved successfully!');
            setForm({ github_pat: '', nvidia_api_key: '' });
            fetchConfig();
        } catch (err) {
            setMessage('❌ Failed to save configuration.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content card">
                <div className="modal-header">
                    <h2>⚙️ Settings</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="glow-divider" />

                <form className="settings-form" onSubmit={handleSave}>
                    <div className="field-group">
                        <label className="field-label">GitHub Personal Access Token</label>
                        <div className="token-status">
                            {config.github_pat_set ?
                                <span className="badge badge-green">✓ Token Configured</span> :
                                <span className="badge badge-red">✗ Token Missing</span>
                            }
                        </div>
                        <input
                            type="password"
                            placeholder="ghp_xxxxxxxxxxxx"
                            value={form.github_pat}
                            onChange={(e) => setForm({ ...form, github_pat: e.target.value })}
                        />
                        <p className="field-help">Required for cloning private repos and pushing fixes.</p>
                    </div>

                    <div className="glow-divider" />


                    {message && <div className={`config-message ${message.includes('✅') ? 'success' : 'error'}`}>{message}</div>}

                    <div className="modal-footer">
                        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>

            <style>{MODAL_STYLES}</style>
        </div>
    );
}

const MODAL_STYLES = `
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-content {
    width: 100%;
    max-width: 500px;
    padding: 0 !important;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes modal-pop {
    from { transform: scale(0.9); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
  }
  .modal-header h2 { margin: 0; font-size: 1.25rem; }
  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
  }
  .settings-form { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
  .token-status { margin-bottom: 8px; }
  .field-help { font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 12px; }
  .config-message {
    padding: 10px;
    border-radius: 4px;
    font-size: 0.85rem;
    text-align: center;
  }
  .config-message.success { background: rgba(16, 185, 129, 0.1); color: #10b981; }
  .config-message.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
`;

