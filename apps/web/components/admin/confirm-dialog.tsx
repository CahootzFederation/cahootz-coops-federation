'use client';

import { useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  /** Asks for a reason first; the confirm button stays off until it's at least 3 characters. */
  reasonLabel?: string;
}

/**
 * The admin's confirm step, in place of the browser's confirm and prompt boxes.
 * `request` opens it; `onConfirm` gets the reason when one was asked for.
 */
export function ConfirmDialog({
  request,
  onConfirm,
  onClose,
}: {
  request: ConfirmRequest | null;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [request]);
  const needsReason = !!request?.reasonLabel;
  const ready = !needsReason || reason.trim().length >= 3;

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="border-white/10 bg-[#111214] text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {needsReason && (
          <label className="block text-xs font-medium text-slate-300">
            {request?.reasonLabel}
            <textarea
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/15 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white">Go back</AlertDialogCancel>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              onConfirm(needsReason ? reason.trim() : undefined);
              onClose();
            }}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              request?.danger ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-emerald-400 text-black hover:bg-emerald-300'
            }`}
          >
            {request?.confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
