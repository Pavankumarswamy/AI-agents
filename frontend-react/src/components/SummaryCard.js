/**
 * SummaryCard.js – Run summary with CI/CD status badge
 */
import React from 'react';
import { useApp } from '../App';

export default function SummaryCard() {
    const { runState } = useApp();
    const { repoUrl, teamName, leaderName, branchName, status, live, result } = runState;

    const summary = result?.run_summary;
    const ciStatus = summary?.final_ci_status || (status === 'running' ? 'RUNNING' : '—');

    const statusBadge = {
        PASSED: { cls: 'badge-green', icon: '✓', label: 'PASSED' },
        FAILED: { cls: 'badge-red', icon: '✗', label: 'FAILED' },
        RUNNING: { cls: 'badge-blue', icon: '⟳', label: 'RUNNING' },
        '—': { cls: 'badge-gray', icon: '—', label: 'PENDING' },
    }[ciStatus] || { cls: 'badge-gray', icon: '—', label: ciStatus };

    return (
        <div className="card summary-card">
            <div className="summary-header">
                <h3>📋 Run Summary</h3>
                <span className={`badge ${statusBadge.cls}`}>
                    {statusBadge.icon} {statusBadge.label}
                </span>
            </div>
            <div className="glow-divider" />

            <div className="summary-grid">
                <SummaryRow label="Repository" value={repoUrl || '—'} mono link={repoUrl} />
                <SummaryRow label="Team" value={teamName || '—'} />
                <SummaryRow label="Leader" value={leaderName || '—'} />
                <SummaryRow label="Branch" value={branchName || '—'} mono highlight />
                <SummaryRow label="Phase" value={live?.phase ? `[${live.phase.toUpperCase()}]` : '—'} />
                {summary && <>
                    <SummaryRow label="Failures Found" value={summary.failures_found ?? '—'} />
                    <SummaryRow label="Fixes Applied" value={summary.fixes_applied ?? '—'} color="green" />
                    <SummaryRow label="Fixes Failed" value={summary.fixes_failed ?? '—'} color="red" />
                    <SummaryRow label="Commits" value={summary.total_commits ?? '—'} />
                    <SummaryRow label="Total Time" value={summary.total_time_human || '—'} />
                </>}
            </div>
        </div>
    );
}

function SummaryRow({ label, value, mono, link, highlight, color }) {
    const colorMap = { green: 'var(--accent-green)', red: 'var(--accent-red)' };
    const style = color ? { color: colorMap[color], fontWeight: 600 }
        : highlight ? { color: 'var(--accent-cyan)', fontWeight: 600 }
            : {};
    return (
        <div className="summary-row">
            <span className="summary-label">{label}</span>
            {link
                ? <a href={link} target="_blank" rel="noreferrer" className={`summary-value mono`} style={{ color: 'var(--accent-blue)', wordBreak: 'break-all' }}>{value}</a>
                : <span className={`summary-value ${mono ? 'mono' : ''}`} style={{ wordBreak: 'break-all', ...style }}>{String(value)}</span>
            }
        </div>
    );
}


