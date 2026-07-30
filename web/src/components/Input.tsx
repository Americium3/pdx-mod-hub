import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { KbdChip } from './KbdChip'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  kbdHint?: string
}

/** 32px input on --inset with 1px --line-2 and the amber focus ring. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, kbdHint, className, ...rest },
  ref,
): ReactNode {
  return (
    <span className={`relative inline-flex items-center ${className ?? ''}`}>
      {icon ? (
        <span className="pointer-events-none absolute left-[9px] text-[var(--text-3)]">{icon}</span>
      ) : null}
      <input
        ref={ref}
        {...rest}
        className={`h-[32px] w-full rounded-std border border-[var(--line-2)] bg-[var(--inset)] font-ui text-[13px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus-visible:outline-none ${icon ? 'pl-[30px]' : 'pl-[10px]'} ${kbdHint ? 'pr-[34px]' : 'pr-[10px]'}`}
      />
      {kbdHint ? (
        <span className="pointer-events-none absolute right-[7px]">
          <KbdChip>{kbdHint}</KbdChip>
        </span>
      ) : null}
    </span>
  )
})
