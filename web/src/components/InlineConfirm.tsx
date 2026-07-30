import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MsgKey } from '../i18n'
import { useHub } from '../store'
import { Button, type ButtonVariant } from './Button'
import { ReservedText } from './ReservedText'

/**
 * Destructive actions confirm INLINE: the button morphs to
 * "Confirm — unsubscribe? / 确认退订？" and reverts after 3s untouched.
 */
export function InlineConfirm({
  labelKey,
  confirmKey = 'confirm.unsubscribe',
  onConfirm,
  variant = 'destructive',
  disabled,
  className,
}: {
  labelKey: MsgKey
  confirmKey?: MsgKey
  onConfirm: () => void
  variant?: ButtonVariant
  disabled?: boolean
  className?: string
}): ReactNode {
  const { t } = useHub()
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onClick = (): void => {
    if (armed) {
      if (timer.current) clearTimeout(timer.current)
      setArmed(false)
      onConfirm()
      return
    }
    setArmed(true)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }

  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={armed ? t(confirmKey) : t(labelKey)}
    >
      {armed ? <ReservedText k={confirmKey} center /> : <ReservedText k={labelKey} center />}
    </Button>
  )
}
