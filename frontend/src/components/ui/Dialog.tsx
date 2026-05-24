/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DialogField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

interface DialogOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PromptOptions extends DialogOptions {
  inputPlaceholder?: string;
}

interface FormOptions extends DialogOptions {
  fields: DialogField[];
}

/* internal type representing a dialog in the queue */
type DialogState =
  | ({ id: string; type: 'confirm'; resolve: (v: string | null) => void } & DialogOptions)
  | ({ id: string; type: 'prompt'; resolve: (v: string | null) => void } & PromptOptions)
  | ({ id: string; type: 'form'; resolve: (v: Record<string, string> | null) => void } & FormOptions);

interface DialogContextType {
  confirm: (options: DialogOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  form: (options: FormOptions) => Promise<Record<string, string> | null>;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialogs, setDialogs] = useState<DialogState[]>([]);

  const confirm = useCallback((options: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      const id = Math.random().toString(36).substr(2, 9);
      setDialogs((prev) => [
        ...prev,
        { ...options, id, type: 'confirm', resolve: (val) => resolve(val !== null) },
      ]);
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      const id = Math.random().toString(36).substr(2, 9);
      setDialogs((prev) => [
        ...prev,
        { ...options, id, type: 'prompt', resolve },
      ]);
    });
  }, []);

  const form = useCallback((options: FormOptions) => {
    return new Promise<Record<string, string> | null>((resolve) => {
      const id = Math.random().toString(36).substr(2, 9);
      setDialogs((prev) => [
        ...prev,
        { ...options, id, type: 'form', resolve },
      ]);
    });
  }, []);

  const value = useMemo(
    () => ({
      confirm,
      prompt,
      form,
    }),
    [confirm, form, prompt],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="relative z-[100]">
          {dialogs.map((d) => (
            <DialogOverlay
              key={d.id}
              dialog={d}
              onClose={() => setDialogs((prev) => prev.filter((x) => x.id !== d.id))}
            />
          ))}
        </div>,
        document.body,
      )}
    </DialogContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Overlay                                                            */
/* ------------------------------------------------------------------ */

function DialogOverlay({ dialog, onClose }: { dialog: DialogState; onClose: () => void }) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    if (dialog.type === 'form') {
      return Object.fromEntries(dialog.fields.map((f) => [f.key, '']));
    }
    return {};
  });

  const handleResolve = (val: string | Record<string, string> | null) => {
    if (dialog.type === 'form') {
      dialog.resolve(typeof val === 'object' || val === null ? val : null);
    } else {
      dialog.resolve(typeof val === 'string' || val === null ? val : null);
    }
    onClose();
  };

  /* check whether the form is valid */
  const isFormValid =
    dialog.type === 'form'
      ? dialog.fields.filter((f) => f.required !== false).every((f) => formValues[f.key]?.trim())
      : true;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[1.5rem] border border-white/60 bg-white/80 p-5 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200 sm:rounded-[2rem] sm:p-8">
        <h3 className="mb-2 text-xl font-black tracking-tight text-slate-900">{dialog.title}</h3>
        {dialog.description && <p className="mb-6 text-sm text-slate-500">{dialog.description}</p>}

        {/* ---- single prompt input ---- */}
        {dialog.type === 'prompt' && (
          <div className="mb-8">
            <input
              type="text"
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={dialog.inputPlaceholder || t('common.choose')}
              className="w-full rounded-2xl border border-slate-200/80 bg-white/50 px-4 py-3 text-sm text-slate-700 shadow-sm transition-all focus:border-adnoc-blue focus:outline-none focus:ring-4 focus:ring-adnoc-blue/10"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) handleResolve(inputValue.trim());
              }}
            />
          </div>
        )}

        {/* ---- multi-field form ---- */}
        {dialog.type === 'form' && (
          <div className="mb-8 space-y-4">
            {dialog.fields.map((field, idx) => (
              <div key={field.key}>
                <label className="mb-1.5 block text-sm font-semibold text-slate-600">
                  {field.label}
                  {field.required !== false && <span className="ml-0.5 text-red-400">*</span>}
                </label>
                <input
                  type="text"
                  autoFocus={idx === 0}
                  value={formValues[field.key] ?? ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder || t('common.choose')}
                  className="w-full rounded-2xl border border-slate-200/80 bg-white/50 px-4 py-3 text-sm text-slate-700 shadow-sm transition-all focus:border-adnoc-blue focus:outline-none focus:ring-4 focus:ring-adnoc-blue/10"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isFormValid) {
                      const trimmed = Object.fromEntries(
                        Object.entries(formValues).map(([k, v]) => [k, v.trim()]),
                      );
                      handleResolve(trimmed);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {dialog.type === 'confirm' && <div className="mb-8" />}

        {/* ---- Buttons ---- */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            onClick={() => handleResolve(null)}
            className="flex-1 rounded-xl bg-slate-100/80 px-4 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
          >
            {dialog.cancelText || t('common.cancel')}
          </button>
          <button
            onClick={() => {
              if (dialog.type === 'prompt') {
                handleResolve(inputValue.trim());
              } else if (dialog.type === 'form') {
                const trimmed = Object.fromEntries(
                  Object.entries(formValues).map(([k, v]) => [k, v.trim()]),
                );
                handleResolve(trimmed);
              } else {
                handleResolve('yes');
              }
            }}
            disabled={
              (dialog.type === 'prompt' && !inputValue.trim()) ||
              (dialog.type === 'form' && !isFormValid)
            }
            className={clsx(
              'flex-1 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50',
              dialog.danger
                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                : 'bg-adnoc-blue hover:bg-blue-700 shadow-blue-500/20',
            )}
          >
            {dialog.confirmText || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useDialog() {
  const context = useContext(DialogContext);
  if (context === undefined) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}
