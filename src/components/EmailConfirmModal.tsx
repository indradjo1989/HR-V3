import React, { useState } from 'react';
import { Mail, Send, X } from 'lucide-react';
import { PendingEmailDispatch } from '../types';

interface EmailConfirmModalProps {
  pending: PendingEmailDispatch | null;
  hasGmailToken: boolean;
  onReconnectGmail: () => Promise<boolean>;
  onConfirmSend: (editableSubject: string, editableBody: string) => Promise<void>;
  onSkip: () => void;
}

export const EmailConfirmModal: React.FC<EmailConfirmModalProps> = ({
  pending,
  hasGmailToken,
  onReconnectGmail,
  onConfirmSend,
  onSkip,
}) => {
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [subject, setSubject] = useState(pending?.subject || '');
  const [body, setBody] = useState(pending?.body || '');

  React.useEffect(() => {
    if (pending) {
      setSubject(pending.subject);
      setBody(pending.body);
      setErrorMsg(null);
    }
  }, [pending]);

  if (!pending) return null;

  const uniqueRecipients = Array.from(
    new Set(pending.to.map((e) => e.trim()).filter(Boolean))
  );

  const handleSend = async () => {
    setSending(true);
    setErrorMsg(null);
    try {
      if (!hasGmailToken) {
        const reconnected = await onReconnectGmail();
        if (!reconnected) {
          setErrorMsg('Izin Gmail diperlukan untuk mengirim email.');
          setSending(false);
          return;
        }
      }
      await onConfirmSend(subject, body);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengirim email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Konfirmasi Kirim Notifikasi Gmail
              </h3>
              <p className="text-xs text-slate-500">{pending.contextLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="font-medium text-slate-700">Penerima Email: </span>
            <span className="font-mono-tabular text-slate-900">
              {uniqueRecipients.join(', ')}
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Subjek Email
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Isi Pesan
            </label>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {!hasGmailToken && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Sesi token Gmail perlu otorisasi ulang saat mengirim. Klik kirim untuk menghubungkan akun Google Anda.
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={onSkip}
            disabled={sending}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Simpan Notifikasi In-App Saja
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || uniqueRecipients.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? 'Mengirim...' : 'Kirim Email via Gmail'}
          </button>
        </div>
      </div>
    </div>
  );
};
