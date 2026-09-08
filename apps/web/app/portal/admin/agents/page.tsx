'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { Loader2, AlertCircle, ArrowLeft, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AgentMetadata {
  key: string;
  name: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
}

export default function AgentPlaygroundPage() {
  const [agents, setAgents] = useState<AgentMetadata[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<unknown>(null);

  useEffect(() => {
    fetch('/api/admin/agents')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load agents.');
        setAgents(data.agents);
        if (data.agents.length > 0) setSelectedKey(data.agents[0].key);
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to load agents.'));
  }, []);

  const selectedAgent = agents?.find((a) => a.key === selectedKey) || null;

  async function handleSubmit(formData: unknown) {
    if (!selectedAgent) return;
    setRunError(null);
    setOutput(null);
    setIsRunning(true);
    try {
      const response = await fetch(`/api/admin/agents/${selectedAgent.key}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Agent run failed (HTTP ${response.status}).`);
      }
      setOutput(data.output);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Agent run failed.');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/portal/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Commons Admin
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white">Agent Playground</h1>
        <p className="mt-1 text-sm text-slate-400">
          Run registered OpenAI agents with structured input and inspect the output. Each run calls the real API and costs real money.
        </p>
      </div>

      {listError && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{listError}</span>
        </div>
      )}

      {!agents && !listError && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {agents && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-1">
            {agents.map((a) => (
              <button
                key={a.key}
                onClick={() => { setSelectedKey(a.key); setOutput(null); setRunError(null); }}
                className={`w-full rounded-[8px] border px-3 py-2 text-left text-sm transition-colors ${
                  a.key === selectedKey
                    ? 'border-blue-500/50 bg-blue-500/10 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className="min-w-0 space-y-4">
            {selectedAgent && (
              <>
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedAgent.name}</h2>
                  <p className="text-sm text-slate-400">{selectedAgent.description}</p>
                </div>

                <div className="rjsf-form rounded-[8px] border border-white/10 bg-white/5 p-4">
                  <Form
                    schema={selectedAgent.inputSchema}
                    validator={validator}
                    onSubmit={({ formData }) => handleSubmit(formData)}
                    disabled={isRunning}
                  >
                    <Button type="submit" className="mt-2 gap-2" disabled={isRunning}>
                      {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Run Agent
                    </Button>
                  </Form>
                  <style jsx>{`
                    .rjsf-form :global(label) {
                      display: block;
                      margin-bottom: 4px;
                      font-size: 0.8rem;
                      color: #cbd5e1;
                    }
                    .rjsf-form :global(input),
                    .rjsf-form :global(select),
                    .rjsf-form :global(textarea) {
                      width: 100%;
                      background: white;
                      color: #0f172a;
                      border: 1px solid #475569;
                      border-radius: 6px;
                      padding: 6px 10px;
                      font-size: 0.875rem;
                    }
                    .rjsf-form :global(fieldset) {
                      border: none;
                      padding: 0;
                      margin: 0 0 12px 0;
                    }
                    .rjsf-form :global(.field) {
                      margin-bottom: 12px;
                    }
                    .rjsf-form :global(.array-item) {
                      border: 1px solid rgba(255, 255, 255, 0.1);
                      border-radius: 6px;
                      padding: 10px;
                      margin-bottom: 10px;
                    }
                    .rjsf-form :global(.btn) {
                      background: rgba(255, 255, 255, 0.1);
                      color: white;
                      border: 1px solid rgba(255, 255, 255, 0.2);
                      border-radius: 6px;
                      padding: 4px 10px;
                      font-size: 0.8rem;
                      margin-top: 4px;
                      margin-right: 4px;
                    }
                    .rjsf-form :global(.text-danger) {
                      color: #fca5a5;
                      font-size: 0.75rem;
                    }
                  `}</style>
                </div>

                {runError && (
                  <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{runError}</span>
                  </div>
                )}

                {output !== null && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-white">Output</h3>
                    <pre className="max-h-96 w-full overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-white/10 bg-black/40 p-4 text-xs text-emerald-300">
                      {JSON.stringify(output, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
