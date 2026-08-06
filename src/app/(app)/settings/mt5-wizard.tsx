'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight, HelpCircle, Lock, Server } from 'lucide-react';
import { FormMessage } from '@/components/ui/form';
import { Num } from '@/components/ui/kpi';
import { connectMt5Action, type Mt5FormState } from './mt5-actions';

type Step = 'welcome' | 'login' | 'server' | 'password' | 'processing' | 'success';

const STEPS: Step[] = ['welcome', 'login', 'server', 'password'];

/*
 * There is no list of servers here, and there cannot be one.
 *
 * This step used to be a `<select>` over five invented `MetaQuotes-*` names. Every MetaTrader
 * broker runs its own servers under its own naming — `FTMO-Server4`, `ICMarketsSC-MT5`,
 * `Pepperstone-MT5-Live1` — so a closed list of five could not express a single real account,
 * including the one this product was being connected to. The field is what the broker calls
 * the server, typed exactly; MetaApi resolves the broker from that name.
 *
 * MetaApi publishes no catalogue to autocomplete against. What it does do is answer an
 * unrecognised name with the near matches for the broker it detected, which the connect
 * action turns into "did you mean…" — see `MetaApiError.serverSuggestions`.
 */

export interface WizardLabels {
  /** The account's own words, shared with the connected card so both name things alike. */
  login: string;
  server: string;
  connect: string;
  investorWarning: string;
  /** Shown only when connecting a different account would discard the stored book. */
  replaceTitle: string;
  replaceConfirm: string;
  replaceCancel: string;
  wizard: {
    step: string;
    of: string;
    back: string;
    /** The disclosure that opens a step's "where do I find this?" note. */
    help: string;
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
      /** An example of the shape, not a suggestion: brokers name servers however they like. */
      placeholder: string;
      /** Where to read the name off MetaTrader, on the desktop and on the phone. */
      help: string;
    };
    password: {
      title: string;
      label: string;
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
  /* The connect outcomes (invalid / rejected / unreachable / sync-failed / connected / too-soon)
     are not passed in: the server action already returns them translated and filled in, and the
     wizard renders that text as-is. */
}

export function Mt5ConnectWizard({
  labels,
}: {
  labels: WizardLabels;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const [formData, setFormData] = useState({
    login: '',
    server: '',
    investorPassword: '',
  });
  // The action is called directly rather than through `useActionState`. Its state only lands on
  // the *next* render, so the branch below read the state from before the attempt: the first
  // connect always looked like a success, and a broker rejection put "Done! Your account is
  // connected" on screen with the error left on a step nobody was looking at any more.
  const [state, setState] = useState<Mt5FormState>({});
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
      if (!formData.server.trim()) return;
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

      const result = await connectMt5Action({}, formDataObj);
      setState(result);
      // A replace confirmation is neither success nor a bad password — it is a question, and
      // the answer needs the credentials still on screen to resubmit with.
      setStep(result.confirmReplace ? 'password' : result.error ? 'password' : 'success');
    }
  };

  const confirmReplace = async () => {
    setStep('processing');
    const body = new FormData();
    body.append('login', formData.login || '');
    body.append('server', formData.server || '');
    body.append('investorPassword', formData.investorPassword || '');
    body.append('confirmReplace', 'yes');

    const result = await connectMt5Action({}, body);
    setState(result);
    setStep(result.error ? 'password' : 'success');
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
      <ProgressBar current={stepIndex + 1} total={totalSteps} labels={labels} />

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
            onConfirmReplace={confirmReplace}
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

function ProgressBar({
  current,
  total,
  labels,
}: {
  current: number;
  total: number;
  labels: WizardLabels;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 overflow-hidden rounded-full bg-line/40">
        <div
          className="h-1 bg-brand transition-all"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
      {/* "Step 1 of 4" rather than "1 / 4": the words are already written and translated, and
          the bare fraction next to a bar reads as a ratio of something rather than a position. */}
      <span className="text-dim text-xs font-medium whitespace-nowrap">
        {labels.wizard.step} <Num>{current}</Num> {labels.wizard.of} <Num>{total}</Num>
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

      <HelpNote
        labels={labels}
        text={labels.wizard.login.help}
        open={showHelp}
        onToggle={onToggleHelp}
      />

      <StepNav
        labels={labels}
        onBack={onBack}
        onNext={onNext}
        next={labels.wizard.welcome.action}
        disabled={!value.trim()}
      />
    </div>
  );
}

/**
 * A step's "where do I find this?" note.
 *
 * The label is its own string. It used to be the first thirty characters of the help text
 * itself with an ellipsis stuck on — so the button read as a sentence cut in half, and opening
 * it showed the same sentence again in full — with a hard-coded English "Help" behind it on
 * one step and a hard-coded Hebrew "איפה למצוא?" on the other.
 */
function HelpNote({
  labels,
  text,
  open,
  onToggle,
}: {
  labels: WizardLabels;
  text: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {open ? (
        <div className="border-info/30 bg-info/10 flex gap-2 rounded-[10px] border p-3">
          <HelpCircle size={16} className="text-info mt-0.5 shrink-0" />
          <p className="text-text/80 text-xs leading-relaxed">{text}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-dim hover:text-text text-start text-xs font-medium transition-colors"
      >
        {open ? '▼' : '▶'} {labels.wizard.help}
      </button>
    </>
  );
}

/**
 * Back and forward, the same pair on every step.
 *
 * No arrow glyphs: `←` and `→` are physical directions, and in Hebrew — which is the default
 * locale — "back" points the other way, so every step pointed its buttons at the wrong sides.
 * Both buttons say where they go, which needs no direction at all. Back was also labelled with
 * the *next* step's word, so it read "← Next" in English and "← התחל" ("Start") in Hebrew.
 */
function StepNav({
  labels,
  onBack,
  onNext,
  next,
  disabled = false,
}: {
  labels: WizardLabels;
  onBack: () => void;
  onNext: () => void;
  next: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="button"
        onClick={onBack}
        className="border-line text-dim hover:text-text flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors"
      >
        {labels.wizard.back}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={disabled}
        className="bg-brand flex-1 rounded-[10px] px-3 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-40"
      >
        {next}
      </button>
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
        <input
          id="server"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={labels.wizard.server.placeholder}
          dir="ltr"
          autoFocus
          required
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          className="border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2.5 text-sm"
        />
      </div>

      <div className="border-dim/30 bg-dim/5 flex gap-2 rounded-[10px] border p-3">
        <Server size={16} className="text-dim mt-0.5 shrink-0" />
        <p className="text-dim text-xs leading-relaxed">{labels.wizard.server.help}</p>
      </div>

      <StepNav
        labels={labels}
        onBack={onBack}
        onNext={onNext}
        next={labels.wizard.welcome.action}
      />
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
  onConfirmReplace,
}: {
  labels: WizardLabels;
  onConfirmReplace: () => void;
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

      {/*
        The one destructive answer this form can produce, made explicit before it happens.
        Rendered here rather than as a browser confirm() so the trade count is on screen next
        to the two account numbers — "93 trades" is the fact someone needs to weigh, and a
        modal that says "are you sure?" gives them nothing to weigh it against.
      */}
      {state.confirmReplace ? (
        <div className="border-neg/40 bg-neg/10 flex flex-col gap-2.5 rounded-[10px] border px-3 py-3">
          <div className="flex gap-2">
            <AlertCircle size={15} className="text-neg mt-px shrink-0" />
            <div>
              <p className="text-text text-xs font-bold">{labels.replaceTitle}</p>
              <p className="text-text/90 mt-1 text-xs leading-relaxed">
                {state.confirmReplace.body}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirmReplace}
              className="bg-neg rounded-[10px] px-3 py-1.5 text-xs font-semibold text-white"
            >
              {labels.replaceConfirm}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="border-line text-dim hover:text-text rounded-[10px] border px-3 py-1.5 text-xs"
            >
              {labels.replaceCancel}
            </button>
          </div>
        </div>
      ) : null}

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

      <HelpNote
        labels={labels}
        text={labels.wizard.password.help}
        open={showHelp}
        onToggle={onToggleHelp}
      />

      {/* The last step's button says what it does — this is where the account is connected,
          and "Next" on the button that submits credentials undersells the moment. */}
      <StepNav
        labels={labels}
        onBack={onBack}
        onNext={onNext}
        next={labels.connect}
        disabled={!value}
      />
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

      {/* `dt`/`dd` only mean anything inside a `dl` — they were sitting in plain `div`s, which
          is invalid markup and leaves a screen reader with two labels attached to nothing. */}
      <dl className="border-line grid gap-3 border-t pt-3">
        <div>
          <dt className="text-dim text-xs">{labels.login}</dt>
          <dd className="text-text mt-1 text-sm font-medium">
            <Num>#{login}</Num>
          </dd>
        </div>
        <div>
          <dt className="text-dim text-xs">{labels.server}</dt>
          <dd className="text-text mt-1 text-sm font-medium">{server}</dd>
        </div>
      </dl>

      <div className="bg-pos/5 rounded-[10px] p-3 text-center">
        <p className="text-text text-xs font-medium">{labels.wizard.success.status}</p>
        {/* The backfill's own words when it has them — "92 trades imported" says more than
            "connected", and the action already returns it. */}
        {imported ? <p className="text-dim mt-1 text-xs">{imported}</p> : null}
      </div>

      {/* Connecting revalidates the layout, so this card is usually replaced by the connected
          one within a moment — but "usually" is not "always", and without this the last step of
          a four-step wizard is a screen with nothing to press. */}
      <Link
        href="/dashboard"
        className="bg-brand rounded-[10px] px-3 py-2 text-center text-sm font-bold text-white transition-opacity hover:opacity-90"
      >
        {labels.wizard.success.action}
      </Link>
    </div>
  );
}
