import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SearchableSelectOption {
  value: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
}

interface SearchableSelectProps<TValue extends string = string> {
  value: TValue;
  options: SearchableSelectOption[];
  onChange: (value: TValue) => void;
  className?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  clearable?: boolean;
  popoverClassName?: string;
}

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function SearchableSelect<TValue extends string = string>({
  value,
  options,
  onChange,
  className,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  clearable = false,
  popoverClassName,
}: SearchableSelectProps<TValue>) {
  const { t } = useTranslation();
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) => {
      const haystack = normalizeText(`${option.label} ${option.value} ${option.keywords ?? ''}`);
      return haystack.includes(normalizedQuery);
    });
  }, [options, query]);

  const enabledOptions = filteredOptions.filter((option) => !option.disabled);
  const activeOptionIndex = Math.min(activeIndex, Math.max(0, enabledOptions.length - 1));

  const closeSelect = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setPosition({
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width,
      });
    };

    updatePosition();
    searchInputRef.current?.focus();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      closeSelect();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeSelect, open]);

  const commitValue = (nextValue: string) => {
    onChange(nextValue as TValue);
    closeSelect();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeSelect();
      buttonRef.current?.focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, enabledOptions.length - 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const option = enabledOptions[activeOptionIndex];
      if (option) {
        commitValue(option.value);
      }
    }
  };

  const popover = open && position ? createPortal(
    <div
      ref={popoverRef}
      id={`${id}-listbox`}
      role="listbox"
      aria-activedescendant={`${id}-option-${activeOptionIndex}`}
      className={clsx(
        'fixed z-[130] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-black/5',
        popoverClassName,
      )}
      style={{ left: position.left, top: position.top, width: position.width }}
      onKeyDown={handleKeyDown}
    >
      <div className="border-b border-slate-100 p-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={searchPlaceholder ?? t('common.searchOptions')}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-9 py-2 text-sm text-slate-700 outline-none transition focus:border-adnoc-blue focus:bg-white focus:ring-2 focus:ring-adnoc-blue/10"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>
      <div className="max-h-72 overflow-auto p-1">
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-slate-400">{emptyMessage ?? t('common.noOptions')}</div>
        ) : (
          filteredOptions.map((option) => {
            const enabledIndex = enabledOptions.findIndex((enabledOption) => enabledOption.value === option.value);
            const selected = option.value === value;
            const active = enabledIndex === activeOptionIndex;
            return (
              <button
                key={option.value}
                id={`${id}-option-${Math.max(enabledIndex, 0)}`}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => {
                  if (enabledIndex >= 0) {
                    setActiveIndex(enabledIndex);
                  }
                }}
                onClick={() => commitValue(option.value)}
                className={clsx(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition',
                  selected ? 'bg-adnoc-blue/10 font-semibold text-adnoc-blue' : 'text-slate-700',
                  active && !selected ? 'bg-slate-100' : '',
                  option.disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-slate-100',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => {
          if (open) {
            closeSelect();
            return;
          }
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={clsx(
          'inline-flex min-h-10 w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        <span className={clsx('min-w-0 flex-1 truncate', selectedOption ? '' : 'text-slate-400')}>
          {selectedOption?.label ?? placeholder ?? t('common.choose')}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          {clearable && value ? (
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                commitValue('');
              }}
              className="rounded-md p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronDown className={clsx('h-4 w-4 text-slate-400 transition', open ? 'rotate-180' : '')} />
        </span>
      </button>
      {popover}
    </>
  );
}
