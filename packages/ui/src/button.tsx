import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<AriaButtonProps, 'className'> {
  variant?: ButtonVariant;
  className?: string;
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium outline-offset-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90',
  secondary: 'border border-line-strong bg-surface-raised text-fg hover:bg-surface-sunken',
  ghost: 'text-fg hover:bg-surface-sunken',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return <AriaButton {...props} className={`${BASE} ${VARIANTS[variant]} ${className}`} />;
}
