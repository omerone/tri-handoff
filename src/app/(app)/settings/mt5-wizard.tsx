'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, Check, ChevronRight, HelpCircle, Lock, Server } from 'lucide-react';
import { FormMessage } from '@/components/ui/form';
import { connectMt5Action, type Mt5FormState } from './mt5-actions';

type Step = 'welcome' | 'login' | 'server' | 'password' | 'processing' | 'success';

const STEPS: Step[] = ['welcome', 'login', 'server', 'password'];

const SERVERS = [
  'MetaQuotes-Live01',
  'MetaQuotes-Live02',
  'MetaQuotes-Live03',
  'MetaQuotes-Demo01',
  'MetaQuotes-Demo02',
];

export interface WizardLabels {
  wizard: {
    title: string;
    step: string;
    of: string;
    welcome: {
      title: string;
      subtitle: string;
      hint: string;
      action: string;
    };
    login: {
      title: string;
      label: string;
      hint: string;
      help: string;
    };
    server: {
      title: string;
      label: string;
      hint: string;
      live: string;
      demo: string;
    };
    password: {
      title: string;
      label: string;
      warning: string;
      hint: string;
      help: string;
    };
    processing: {
      validating: string;
      syncing: string;
    };
    success: {
      title: string;
      subtitle: string;
      status: string;
      action: string;
    };
  };
  investorWarning: string;
  connectInvalid: string;
  connectRejected: string;
  connectUnreachable: string;
  connectSyncFailed: string;
  connected: string;
  tooSoon: string;
}

export function Mt5ConnectWizard({
  labels,
}: {
  labels: WizardLabels;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const [formData, setFormData] = useState({
    login: '',
    server: SERVERS[0] || 'MetaQuotes-Live01',
    investorPassword: '',
  });
  const [state, action] = useActionState<Mt5FormState, FormData>(connectMt5Action, {});
  const [showHelp, setShowHelp] = useState<string | null>(null);

  const stepIndex = Math.max(0, STEPS.indexOf(step));
  const totalSteps = STEPS.length;

  const handleNext = async () => {
    if (step === 'welcome') {
      setStep('login');
    } else if (step === 'login') {
      if (!formData.login.trim()) {
        return;
      }
      setStep('server');
    } else if (step === 'server') {
      setStep('password');
    } else if (step === 'password') {
      if (!formData.investorPassword) {
        return;
      }
      setStep('processing');

      const formDataObj = new FormData();
      formDataObj.append('login', formData.login || '');
      formDataObj.append('server', formData.server || '');
      formDataObj.append('investorPassword', formData.investorPassword || '');

      await action(formDataObj);
      if (!state?.error) {
        setStep('success');
      } else {
        setStep('password');
      }
    }
  };

  const handleBack = () => {
    if (step === 'welcome') return;
    if (step === 'processing' || step === 'success') return;

    const currentIndex = STEPS.indexOf(step);
    if (currentIndex > 0 && currentIndex <= STEPS.length) {
      const prevStep = STEPS[currentIndex - 1];
      if (prevStep) {
        setStep(prevStep);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ProgressBar current={stepIndex + 1} total={totalSteps} />

      <div className="rounded-[10px] border border-line bg-raised p-6">
        {step === 'welcome' && (
          <WelcomeStep labels={labels} onNext={handleNext} />
        )}

        {step === 'login' && (
          <LoginStep
            labels={labels}
            value={formData.login}
            onChange={(login) => setFormData({ ...formData, login })}
            onNext={handleNext}
            onBack={handleBack}
            showHelp={showHelp === 'login'}
            onToggleHelp={() => setShowHelp(showHelp === 'login' ? null : 'login')}
          />
        )}

        {step === 'server' && (
          <ServerStep
            labels={labels}
            value={formData.server}
            onChange={(server) => setFormData({ ...formData, server })}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}

        {step === 'password' && (
          <PasswordStep
            labels={labels}
            value={formData.investorPassword}
            onChange={(password) => setFormData({ ...formData, investorPassword: password })}
            onNext={handleNext}
            onBack={handleBack}
            showHelp={showHelp === 'password'}
            onToggleHelp={() => setShowHelp(showHelp === 'password' ? null : 'password')}
            state={state}
          />
        )}

        {step === 'processing' && <ProcessingStep labels={labels} />}

        {step === 'success' && (
          <SuccessStep
            labels={labels}
            login={formData.login}
            server={formData.server}
            imported={state.notice}
          />
        )}
      </div>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 overflow-hidden rounded-full bg-line/40">
        <div
          className="h-1 bg-brand transition-all"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
      <span className="text-dim text-xs font-medium">
        {current} / {total}
      </span>
    </div>
  );
}

function WelcomeStep({
  labels,
  onNext,
}: {
  labels: WizardLabels;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/20">
        <Lock size={24} className="text-brand" />
      </div>
      <div>
        <h2 className="text-text font-bold">{labels.wizard.welcome.title}</h2>
        <p className="text-dim mt-1 text-sm">{labels.wizard.welcome.subtitle}</p>
      </div>
      <p className="text-dim text-xs">{labels.wizard.welcome.hint}</p>
      <button
        onClick={onNext}
        className="bg-brand rounded-[10px] px-4 py-2.5 font-bold text-white transition-opacity hover:opacity-90"
      >
        {labels.wizard.welcome.action}
      </button>
    </div>
  );
}

function LoginStep({
  labels,
  value,
  onChange,
  onNext,
  onBack,
  showHelp,
  onToggleHelp,
}: {
  labels: WizardLabels;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-text font-bold">{labels.wizard.login.title}</h2>
        <p className="text-dim mt-1 text-xs">{labels.wizard.login.hint}</p>
      </div>

      <div>
        <label htmlFor="login-field" className="flex flex-col gap-1.5">
          <span className="text-dim text-xs font-semibold">{labels.wizard.login.label}</span>
          <input
            id="login-field"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="50214437"
            dir="ltr"
            autoFocus
            required
            className="border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2.5 text-sm"
          />
        </label>
      </div>

      {showHelp && (
        <div className="border-info/30 bg-info/10 flex gap-2 rounded-[10px] border p-3">
          <HelpCircle size={16} className="text-info mt-0.5 shrink-0" />
          <p className="text-text/80 text-xs leading-relaxed">{labels.wizard.login.help}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleHelp}
        className="text-dim hover:text-text text-xs font-medium transition-colors text-left"
      >
        {showHelp ? '▼' : '▶'} {labels.wizard.login.help ? labels.wizard.login.help.substring(0, 30) + '…' : 'Help'}
      </button>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="border-line text-dim flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors hover:text-text"
        >
          ← {labels.wizard.welcome.action}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!value.trim()}
          className="bg-brand flex-1 rounded-[10px] px-3 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-40"
        >
          {labels.wizard.welcome.action} →
        </button>
      </div>
    </div>
  );
}

function ServerStep({
  labels,
  value,
  onChange,
  onNext,
  onBack,
}: {
  labels: WizardLabels;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-text font-bold">{labels.wizard.server.title}</h2>
        <p className="text-dim mt-1 text-xs">{labels.wizard.server.hint}</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="server" className="text-dim text-xs font-semibold">
          {labels.wizard.server.label}
        </label>
        <select
          id="server"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border-line bg-raised text-text rounded-[10px] border px-3 py-2.5 text-sm"
        >
          <optgroup label={labels.wizard.server.live}>
            {SERVERS.filter((s) => s.includes('Live')).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </optgroup>
          <optgroup label={labels.wizard.server.demo}>
            {SERVERS.filter((s) => s.includes('Demo')).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="border-dim/30 bg-dim/5 flex gap-2 rounded-[10px] border p-3">
        <Server size={16} className="text-dim mt-0.5 shrink-0" />
        <p className="text-dim text-xs leading-relaxed">
          {value.includes('Live') ? labels.wizard.server.live : labels.wizard.server.demo}
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="border-line text-dim flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors hover:text-text"
        >
          ← {labels.wizard.welcome.action}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="bg-brand flex-1 rounded-[10px] px-3 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          {labels.wizard.welcome.action} →
        </button>
      </div>
    </div>
  );
}

function PasswordStep({
  labels,
  value,
  onChange,
  onNext,
  onBack,
  showHelp,
  onToggleHelp,
  state,
}: {
  labels: WizardLabels;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
  state: Mt5FormState;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-text font-bold">{labels.wizard.password.title}</h2>
        <p className="text-dim mt-1 text-xs">{labels.wizard.password.hint}</p>
      </div>

      <div className="border-warn/30 bg-warn/10 flex gap-2 rounded-[10px] border px-3 py-2.5">
        <AlertCircle size={15} className="text-warn mt-px shrink-0" />
        <p className="text-text/90 text-xs leading-relaxed">{labels.investorWarning}</p>
      </div>

      <FormMessage error={state.error} />

      <div>
        <label htmlFor="password-field" className="flex flex-col gap-1.5">
          <span className="text-dim text-xs font-semibold">{labels.wizard.password.label}</span>
          <input
            id="password-field"
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            required
            autoFocus
            className="border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2.5 text-sm"
          />
        </label>
      </div>

      {showHelp && (
        <div className="border-info/30 bg-info/10 flex gap-2 rounded-[10px] border p-3">
          <HelpCircle size={16} className="text-info mt-0.5 shrink-0" />
          <p className="text-text/80 text-xs leading-relaxed">{labels.wizard.password.help}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleHelp}
        className="text-dim hover:text-text text-xs font-medium transition-colors text-left"
      >
        {showHelp ? '▼' : '▶'} איפה למצוא?
      </button>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="border-line text-dim flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors hover:text-text"
        >
          ← {labels.wizard.welcome.action}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!value}
          className="bg-brand flex-1 rounded-[10px] px-3 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-40"
        >
          {labels.wizard.welcome.action} ✓
        </button>
      </div>
    </div>
  );
}

function ProcessingStep({ labels }: { labels: WizardLabels }) {
  return (
    <div className="flex flex-col gap-4 py-6 text-center">
      <div className="mx-auto">
        <div className="animate-spin">
          <ChevronRight size={24} className="text-brand" />
        </div>
      </div>
      <div>
        <p className="text-text font-bold">{labels.wizard.processing.validating}</p>
        <p className="text-dim mt-2 text-xs">{labels.wizard.processing.syncing}</p>
      </div>
    </div>
  );
}

function SuccessStep({
  labels,
  login,
  server,
  imported,
}: {
  labels: WizardLabels;
  login: string;
  server: string;
  /** What the first sync brought back, when the action reported it. */
  imported?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-pos/20">
          <Check size={24} className="text-pos" />
        </div>
        <div>
          <h2 className="text-text font-bold">{labels.wizard.success.title}</h2>
          <p className="text-dim mt-1 text-sm">{labels.wizard.success.subtitle}</p>
        </div>
      </div>

      <div className="border-line grid gap-3 border-t pt-3">
        <div>
          <dt className="text-dim text-xs">Login</dt>
          <dd className="text-text mt-1 text-sm font-medium">#{login}</dd>
        </div>
        <div>
          <dt className="text-dim text-xs">Server</dt>
          <dd className="text-text mt-1 text-sm font-medium">{server}</dd>
        </div>
      </div>

      <div className="bg-pos/5 rounded-[10px] p-3 text-center">
        <p className="text-text text-xs font-medium">{labels.wizard.success.status}</p>
        {/* The backfill's own words when it has them — "92 trades imported" says more than
            "connected", and the action already returns it. */}
        {imported ? <p className="text-dim mt-1 text-xs">{imported}</p> : null}
      </div>
    </div>
  );
}
