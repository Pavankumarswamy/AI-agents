/**
 * ScorePanel.js – Score breakdown with RadialBarChart (Recharts)
 */
import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { useApp } from '../App';

export default function ScorePanel() {
    const { runState } = useApp();
    const score = runState.result?.score_breakdown;

    if (!score) {
        return (
            <div className="card score-card">
                <h3>🏆 Score Breakdown</h3>
                <div className="glow-divider" />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Score will appear after the run completes.</p>
            </div>
        );
    }

    const total = Math.max(0, Math.min(score.total, 120));
    const data = [{ name: 'Score', value: total, fill: total >= 90 ? 'var(--accent-green)' : total >= 60 ? 'var(--accent-yellow)' : 'var(--accent-red)' }];

    return (
        <div className="card score-card">
            <h3>🏆 Score Breakdown</h3>
            <div className="glow-divider" />

            <div className="score-body">
                {/* Radial chart */}
                <div className="score-chart-wrap">
                    <ResponsiveContainer width="100%" height={130}>
                        <RadialBarChart
                            cx="50%" cy="80%"
                            innerRadius="60%" outerRadius="80%"
                            startAngle={180} endAngle={0}
                            barSize={14}
                            data={data}
                        >
                            <PolarAngleAxis type="number" domain={[0, 120]} angleAxisId={0} tick={false} />
                            <RadialBar
                                background={{ fill: 'var(--bg-primary)' }}
                                dataKey="value"
                                angleAxisId={0}
                                cornerRadius={8}
                            />
                        </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="score-number" style={{ color: data[0].fill }}>{total}</div>
                    <div className="score-label">/ 120</div>
                </div>

                {/* Breakdown list */}
                <div className="score-rows">
                    <ScoreRow label="Base Score" value={`+${score.base}`} positive />
                    <ScoreRow label="Speed Bonus (<5 min)" value={score.time_bonus ? `+${score.time_bonus}` : '—'} positive={score.time_bonus > 0} />
                    <ScoreRow label="Commit Penalty" value={score.commit_penalty ? `-${score.commit_penalty}` : '—'} negative={score.commit_penalty > 0} />
                    <div className="score-total-row">
                        <span>Total</span>
                        <span style={{ color: data[0].fill, fontWeight: 800, fontSize: '1.1rem' }}>{total}</span>
                    </div>
                    {score.breakdown_notes?.map((note, i) => (
                        <p key={i} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{note}</p>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ScoreRow({ label, value, positive, negative }) {
    const color = positive ? 'var(--accent-green)'
        : negative ? 'var(--accent-red)'
            : 'var(--text-secondary)';
    return (
        <div className="score-row">
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{label}</span>
            <span style={{ color, fontWeight: 600, fontSize: '0.88rem' }}>{value}</span>
        </div>
    );
}


