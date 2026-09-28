'use client';

import React, { useState } from 'react';
import {
  Upload,
  Video,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Download,
  RefreshCw,
} from 'lucide-react';

import { signIn, signOut, signUp, useSession } from '@/lib/auth-client';

interface PlanUsage {
  email: string;
  tier: 'free' | 'creator' | 'agency';
  usedSeconds: number;
  maxSeconds: number;
}

type TargetRatio = '9:16' | '1:1' | '16:9';
type TrackingMode = 'auto_center' | 'smart_face' | 'manual_crop';

interface CompleteJob {
  id: string;
  url: string;
}

interface RatioOption {
  id: TargetRatio;
  title: string;
  desc: string;
}

interface ModeOption {
  id: TrackingMode;
  title: string;
  desc: string;
}

const RATIO_OPTIONS: RatioOption[] = [
  { id: '9:16', title: '9:16 Vertical', desc: 'TikTok, Shorts, Reels' },
  { id: '1:1', title: '1:1 Square', desc: 'Feed Posts' },
  { id: '16:9', title: '16:9 Landscape', desc: 'Standard Stream' },
];

const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'auto_center',
    title: 'Auto Static Focus',
    desc: 'Locks strictly into absolute screen coordinates',
  },
  {
    id: 'smart_face',
    title: 'AI Smart Face Track',
    desc: 'Follows face/movement dynamics algorithmically',
  },
  {
    id: 'manual_crop',
    title: 'Manual Aspect Clip',
    desc: 'Manually specify regional output parameters',
  },
];

const PROCESS_STEPS = [
  { text: 'Analyzing subject composition vectors...', delay: 1000, prog: 20 },
  { text: 'Tracking focal elements & clipping viewports...', delay: 1500, prog: 55 },
  { text: 'Generating dynamic aspect boundaries...', delay: 1000, prog: 85 },
  { text: 'Finalizing dual-stream layout export...', delay: 800, prog: 100 },
];

export default function FlipcastDashboard() {
  const { data: session, isPending: sessionPending } = useSession();
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');
  const [authBusy, setAuthBusy] = useState(false);
  const user: PlanUsage = {
    email: session?.user?.email ?? 'creator@musespark.io (preview)',
    tier: 'free',
    usedSeconds: 75,
    maxSeconds: 180,
  };
  const [selectedFile, setSelectedFile] = useState<FileList | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [targetRatio, setTargetRatio] = useState<TargetRatio>('9:16');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('auto_center');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processStatus, setProcessStatus] = useState<string>('');
  const [completeJob, setCompleteJob] = useState<CompleteJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files);
      setCompleteJob(null);
      setError(null);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      const file = files[0];
      if (file.size > 500 * 1024 * 1024) {
        setError('File exceeds 500MB limit.');
        return;
      }
      setSelectedFile(files);
      setCompleteJob(null);
      setError(null);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setError('Enter an email and password to continue.');
      return;
    }
    setAuthBusy(true);
    setError(null);
    try {
      if (authMode === 'signUp') {
        const res = await signUp.email({
          email: authEmail,
          password: authPassword,
          name: authEmail.split('@')[0],
        });
        if (res.error) throw new Error(res.error.message || 'Sign-up failed');
      } else {
        const res = await signIn.email({ email: authEmail, password: authPassword });
        if (res.error) throw new Error(res.error.message || 'Sign-in failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const simulateProcessing = async () => {
    if (!selectedFile || isProcessing) return;
    const fileName = selectedFile[0].name;
    setIsProcessing(true);
    setCompleteJob(null);
    setError(null);
    setProgress(0);

    try {
      await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          targetRatio,
          mode: trackingMode,
        }),
      });
    } catch {
      // Simulation continues even if API is unreachable in preview mode.
    }

    for (const step of PROCESS_STEPS) {
      setProcessStatus(step.text);
      await new Promise((res) => setTimeout(res, step.delay));
      setProgress(step.prog);
    }

    setIsProcessing(false);
    setCompleteJob({
      id: Math.random().toString(36).substring(5).toUpperCase(),
      url: '#',
    });
  };

  const usagePercentage = (user.usedSeconds / user.maxSeconds) * 100;
  const selectedFileName = selectedFile?.[0]?.name ?? null;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-6 bg-slate-900 border border-slate-800 rounded-2xl gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-600/20">
            <Layers className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Flipcast
              <span className="text-xs bg-indigo-500/10 text-indigo-400 font-semibold px-2 py-0.5 rounded-full border border-indigo-500/20">
                by Muse Spark
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              {sessionPending ? 'Checking session…' : user.email}
            </p>
            {session?.user && (
              <button
                onClick={() => signOut()}
                className="text-[11px] text-slate-500 hover:text-slate-300 font-semibold transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
        <div className="w-full sm:w-64 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Monthly AI Render Engine</span>
            <span className="text-white font-semibold">
              {user.usedSeconds}s / {user.maxSeconds}s
            </span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${usagePercentage}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Tier: {user.tier}
            </span>
            <button className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
              Upgrade Tier →
            </button>
          </div>
        </div>
      </header>

      {/* Auth */}
      {!sessionPending && !session?.user && (
        <section className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white tracking-tight">
              {authMode === 'signUp' ? 'Create account' : 'Sign in'}
            </h2>
            <button
              onClick={() => setAuthMode(authMode === 'signUp' ? 'signIn' : 'signUp')}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold"
            >
              {authMode === 'signUp' ? 'Have an account? Sign in' : 'New here? Sign up'}
            </button>
          </div>
          <form onSubmit={handleAuth} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
            <input
              type="email"
              required
              placeholder="you@studio.com"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="h-10 px-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="h-10 px-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={authBusy}
              className="h-10 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 rounded-xl text-xs font-bold text-white transition-colors"
            >
              {authBusy ? 'Please wait…' : authMode === 'signUp' ? 'Sign up' : 'Sign in'}
            </button>
          </form>
          <p className="text-[11px] text-slate-600">
            Auth by Better Auth + open-source Postgres. Jobs persist only when signed in.
          </p>
        </section>
      )}

      {/* Upload zone */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 cursor-pointer ${
          dragActive
            ? 'border-indigo-500 bg-indigo-500/5'
            : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900'
        }`}
      >
        <input
          type="file"
          accept="video/*"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        {selectedFile ? (
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <Video className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white">{selectedFileName}</p>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              Stage Ready
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 bg-slate-800 rounded-full">
              <Upload className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-200">
              Drag &amp; drop your source asset or browse
            </p>
            <p className="text-xs text-slate-500">
              Supports horizontal high-definition formats up to 500MB
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Engine parameters */}
      <section className="grid md:grid-cols-2 gap-6">
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <h2 className="text-sm font-bold text-white tracking-tight">Engine Parameters</h2>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Target Output Aspect Ratio
          </p>
          <div className="grid gap-3">
            {RATIO_OPTIONS.map((ratio) => (
              <button
                key={ratio.id}
                onClick={() => setTargetRatio(ratio.id)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  targetRatio === ratio.id
                    ? 'border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500'
                    : 'border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400'
                }`}
              >
                <p className="text-sm font-semibold text-white">{ratio.title}</p>
                <p className="text-xs text-slate-500">{ratio.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            Focal Tracking Engine Mode
          </h2>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Select processing pipeline
          </p>
          <div className="grid gap-3">
            {MODE_OPTIONS.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setTrackingMode(mode.id)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  trackingMode === mode.id
                    ? 'border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500'
                    : 'border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400'
                }`}
              >
                <p className="text-sm font-semibold text-white flex items-center gap-2">
                  {mode.id === 'smart_face' && <Sparkles className="h-3.5 w-3.5 text-indigo-400" />}
                  {mode.title}
                </p>
                <p className="text-xs text-slate-500">{mode.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Action */}
      <button
        onClick={simulateProcessing}
        disabled={!selectedFile || isProcessing}
        className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl text-xs font-semibold text-white transition-all shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 group"
      >
        {isProcessing ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            Compiling Spatial Frames...
          </>
        ) : (
          <>
            Initialize Flipcast Transformation
            <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </>
        )}
      </button>

      {/* Pipeline queue */}
      <section className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <h2 className="text-sm font-bold text-white tracking-tight">Pipeline Execution Queue</h2>

        {!selectedFile && !isProcessing && !completeJob && (
          <p className="text-sm text-slate-500">
            No active transformations currently initialized in queue pipeline.
          </p>
        )}

        {isProcessing && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-200 flex items-center gap-2">
                <Video className="h-4 w-4 text-indigo-400" />
                {selectedFileName}
              </span>
              <span className="font-bold text-indigo-400">{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">{processStatus}</p>
          </div>
        )}

        {completeJob && !isProcessing && (
          <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-3">
            <p className="text-sm font-bold text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Transformation Complete
            </p>
            <div className="grid sm:grid-cols-3 gap-2 text-xs">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  Job ID
                </p>
                <p className="text-white font-mono font-bold">JOB_ID: {completeJob.id}</p>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  Format
                </p>
                <p className="text-white font-bold">FORMAT: {targetRatio} Vertical Matrix</p>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  Engine
                </p>
                <p className="text-white font-bold">ENGINE: {trackingMode}</p>
              </div>
            </div>
            <a
              href={completeJob.url}
              className="inline-flex items-center gap-2 h-10 px-5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-bold text-white transition-colors"
            >
              <Download className="h-4 w-4" />
              Download Media Deliverable
            </a>
          </div>
        )}
      </section>

      <footer className="text-center text-[11px] text-slate-600">
        Flipcast Core Infrastructure Engine v1.0.0
      </footer>
    </div>
  );
}
