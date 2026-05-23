/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const success = useCallback((message: string) => addToast('success', message), [addToast]);
  const error = useCallback((message: string) => addToast('error', message), [addToast]);
  const info = useCallback((message: string) => addToast('info', message), [addToast]);
  const value = useMemo(
    () => ({
      toast: addToast,
      success,
      error,
      info,
    }),
    [addToast, error, info, success],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-3">
        {toasts.map((toastMessage) => (
          <div
            key={toastMessage.id}
            className={clsx(
              'pointer-events-auto flex w-80 items-start gap-3 rounded-2xl border bg-white/90 p-4 shadow-xl backdrop-blur-xl transition-all animate-in slide-in-from-right-4 fade-in duration-300',
              toastMessage.type === 'success' && 'border-green-200/50',
              toastMessage.type === 'error' && 'border-red-200/50',
              toastMessage.type === 'info' && 'border-blue-200/50'
            )}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />}
            {toastMessage.type === 'error' && <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />}
            {toastMessage.type === 'info' && <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />}
            <div className="flex-1">
              <p className={clsx(
                "text-sm font-medium",
                toastMessage.type === 'success' && 'text-green-900',
                toastMessage.type === 'error' && 'text-red-900',
                toastMessage.type === 'info' && 'text-blue-900',
              )}>{toastMessage.message}</p>
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== toastMessage.id))}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
