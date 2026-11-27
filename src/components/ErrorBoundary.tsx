import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Terjadi kesalahan pada aplikasi.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('C-SYNC ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let parsedDetail: string | null = null;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed?.error) {
          parsedDetail = `${parsed.operationType?.toUpperCase() || 'OP'} · ${parsed.path || '-'} — ${parsed.error}`;
        }
      } catch {
        parsedDetail = null;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 text-red-700 mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-lg font-semibold text-slate-900">
                Terjadi Gangguan Sistem
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              C-SYNC mendeteksi kendala akses atau sinkronisasi data. Silakan muat ulang halaman untuk memulihkan sesi Anda.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-xs font-mono-tabular text-slate-700 break-words">
              {parsedDetail || this.state.errorMessage}
            </div>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Muat Ulang C-SYNC
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
