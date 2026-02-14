import { HealthScoreBreakdown, scoreColor, scoreBgColor } from '../../utils/healthScore';

interface HealthScoreBadgeProps {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
}

export function HealthScoreBadge({ score, size = 'md' }: HealthScoreBadgeProps) {
  if (score === null) {
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-lg';
    return (
      <div className={`${sizeClasses} rounded-full bg-surface-dark border border-border flex items-center justify-center text-text-muted font-bold`}>
        —
      </div>
    );
  }

  const color = scoreColor(score);
  const bgColor = scoreBgColor(score);
  const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-lg';

  return (
    <div className={`${sizeClasses} rounded-full ${bgColor}/20 border-2 ${bgColor.replace('bg-', 'border-')}/50 flex items-center justify-center ${color} font-bold`}>
      {score}
    </div>
  );
}

interface HealthScoreDetailProps {
  breakdown: HealthScoreBreakdown | null;
}

export function HealthScoreDetail({ breakdown }: HealthScoreDetailProps) {
  if (!breakdown) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 text-center">
        <div className="text-4xl font-bold text-text-muted mb-1">—</div>
        <div className="text-text-secondary text-sm">Health Score</div>
        <div className="text-text-muted text-xs mt-1">
          Run email, SSL, and security scans to calculate health score
        </div>
      </div>
    );
  }

  const color = scoreColor(breakdown.total);
  const bgColor = scoreBgColor(breakdown.total);

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-center gap-4 mb-4">
        <div className={`text-4xl font-bold ${color}`}>{breakdown.total}</div>
        <div>
          <div className="text-text-secondary text-sm font-medium">Health Score</div>
          <div className="text-text-muted text-xs">
            {breakdown.total >= 90 ? 'Excellent' :
             breakdown.total >= 70 ? 'Good' :
             breakdown.total >= 50 ? 'Needs Improvement' : 'Critical'}
          </div>
        </div>
      </div>

      {/* Component bars */}
      <div className="flex flex-col gap-2">
        {breakdown.components.map(comp => (
          <div key={comp.label} className="flex items-center gap-2">
            <span className="text-text-muted text-xs w-16 text-right">{comp.label}</span>
            <div className="flex-1 h-2 bg-surface-dark rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${bgColor}`}
                style={{ width: `${(comp.score / comp.max) * 100}%`, opacity: 0.8 }}
              />
            </div>
            <span className="text-text-secondary text-xs w-10">{comp.score}/{comp.max}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
