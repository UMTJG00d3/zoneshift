interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="step-indicator">
      {steps.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;
        let className = 'step';
        if (isActive) className += ' step-active';
        if (isComplete) className += ' step-complete';

        return (
          <div key={stepNum} className={className}>
            <span className="step-number">
              {isComplete ? '\u2713' : stepNum}
            </span>
            <span className="step-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
