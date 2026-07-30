import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { SNAP, useReducedMotionSafe } from '../motion'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon'

const BASE =
  'inline-flex h-[28px] items-center justify-center gap-[6px] rounded-std ' +
  'font-ui text-[13px] font-medium leading-none select-none whitespace-nowrap ' +
  'disabled:opacity-40 disabled:pointer-events-none cursor-pointer'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'px-[12px] bg-[var(--accent-fill)] text-[var(--on-accent)] ' +
    'border border-[var(--accent-fill-border)] ' +
    'hover:bg-[var(--accent-fill-hover)] active:bg-[var(--accent-fill-pressed)]',
  secondary:
    'px-[12px] bg-transparent text-[var(--text-1)] border border-[var(--line-2)] ' +
    'hover:bg-[var(--bg-2)]',
  ghost: 'px-[10px] bg-transparent text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]',
  destructive:
    'px-[12px] bg-transparent text-[var(--state-error)] border border-[var(--state-error)] ' +
    'hover:bg-[color-mix(in_srgb,var(--state-error)_10%,transparent)]',
  icon:
    'w-[28px] px-0 bg-transparent text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]',
}

export interface ButtonProps {
  variant?: ButtonVariant
  children?: ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  className?: string
  'aria-label'?: string
}

export function Button({
  variant = 'secondary',
  children,
  onClick,
  disabled,
  title,
  type = 'button',
  className,
  ...rest
}: ButtonProps): ReactNode {
  const snap = useReducedMotionSafe(SNAP)
  return (
    <motion.button
      type={type}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={snap}
      className={`${BASE} ${VARIANTS[variant]} ${className ?? ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={rest['aria-label']}
    >
      {children}
    </motion.button>
  )
}
