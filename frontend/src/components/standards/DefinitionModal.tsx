import type { FormEvent, ReactNode } from 'react';
import { X } from 'lucide-react';

export const definitionInputClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10 disabled:bg-slate-50 disabled:text-slate-400';

export function DefinitionModal({
  title,
  children,
  onSubmit,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/60 bg-white p-4 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div>
      </form>
    </div>
  );
}

export function DefinitionField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
