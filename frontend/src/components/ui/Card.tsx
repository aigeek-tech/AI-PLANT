import React from 'react';
import { clsx } from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
}

export function Card({ children, className, title, action }: CardProps) {
  return (
    <div className={clsx("bg-white rounded-xl shadow-sm border border-gray-100 p-6", className)}>
        {(title || action) && (
            <div className="flex items-center justify-between mb-6">
                {title && <h3 className="font-semibold text-gray-800 text-lg">{title}</h3>}
                {action && <div>{action}</div>}
            </div>
        )}
      {children}
    </div>
  );
}
